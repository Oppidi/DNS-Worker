/**
 * @file profileSync.ts
 * @description Per-profile list synchronization, manual full/single recombine, and fast bloom rebuild orchestration.
 */

import { Env, ExecutionContext } from "../../../types";
import { ProfileModel } from "../../../models/profile";
import { ListModel } from "../../../models/list";
import { ProfileBloomModel } from "../../../models/profileBloom";
import { ListBloomModel } from "../../../models/listBloom";
import { combineAndPromote } from "../combine";
import { syncSingleList, syncGlobalList } from "../singleListSync";
import { inFlightSyncs, updateInFlightProgress, type SyncProgress } from "./progress";

function runSerializedProfileTask(
  profileId: string,
  type: SyncProgress["type"] & string,
  initialProgress: SyncProgress,
  listId: number | undefined,
  executor: () => Promise<void>
): Promise<void> {
  const syncPromise = (async () => {
    try {
      await executor();
    } finally {
      inFlightSyncs.delete(profileId);
    }
  })();

  inFlightSyncs.set(profileId, {
    type,
    ...(listId !== undefined ? { listId } : {}),
    progress: initialProgress,
    promise: syncPromise
  });
  return syncPromise;
}

/**
 * 【Cron 专用】每次触发时处理指定 Profile 下单个最旧的订阅列表。
 */
export async function syncNextListForProfile(
  profileId: string,
  env: Env,
  ctx: ExecutionContext
): Promise<void> {
  const activeSync = inFlightSyncs.get(profileId);
  if (activeSync) {
    console.log(
      `[Sync] Profile ${profileId}: another sync (${activeSync.type}) is already in-flight. Skipping cron sync pass.`
    );
    return;
  }

  return runSerializedProfileTask(
    profileId,
    "next",
    { syncing: true, type: "next", stage: "fetching", current: 0, total: 1, percent: 25 },
    undefined,
    () => _executeSyncNextListForProfile(profileId, env, ctx)
  );
}

async function _executeSyncNextListForProfile(
  profileId: string,
  env: Env,
  ctx: ExecutionContext
): Promise<void> {
  const profileModel = new ProfileModel(env.DB);
  const listModel = new ListModel(env.DB);
  const profileBloomModel = new ProfileBloomModel(env.DB);
  const listBloomModel = new ListBloomModel(env.DB);
  const now = Math.floor(Date.now() / 1000);

  try {
    const profile = await profileModel.getById(profileId);
    if (!profile) {
      console.error(`[Sync] Profile ${profileId} not found.`);
      return;
    }

    const lastFullSync: number = profile.list_updated_at ?? 0;
    const activeLists = (await listModel.getLists(profileId)).filter((l) => !!l.enabled);

    if (activeLists.length === 0) {
      await profileBloomModel.clearProfileBlooms(profileId);
      await profileModel.updateListUpdatedAt(profileId, now);
      return;
    }

    const isNewCycle = !activeLists.some((l) => (l.last_synced_at ?? 0) > lastFullSync);
    if (isNewCycle) {
      console.log(`[Sync] Profile ${profileId}: starting a new sync cycle.`);
    }

    const pendingLists = activeLists
      .filter((l) => (l.last_synced_at ?? 0) <= lastFullSync)
      .sort((a, b) => (a.last_synced_at ?? 0) - (b.last_synced_at ?? 0));

    const maxDomains = Number(env.MAX_SYNC_DOMAINS) || 1000000;
    const falsePositiveRate = Number(env.BLOOM_FALSE_POSITIVE_RATE) || 0.0001;

    if (pendingLists.length === 0) {
      await profileModel.updateListUpdatedAt(profileId, now);
      await combineAndPromote(profileId, listModel, listBloomModel, profileBloomModel, profileModel, ctx, now, maxDomains, falsePositiveRate, env);
      return;
    }

    await syncSingleList(profileId, pendingLists[0], env, listModel, listBloomModel, now);

    const activeUpdatedLists = (await listModel.getLists(profileId)).filter((l) => !!l.enabled);
    const allDone = activeUpdatedLists.every((l) => (l.last_synced_at ?? 0) > lastFullSync);

    if (allDone) {
      await profileModel.updateListUpdatedAt(profileId, now);
      await combineAndPromote(profileId, listModel, listBloomModel, profileBloomModel, profileModel, ctx, now, maxDomains, falsePositiveRate, env);
      console.log(
        `[Sync] Profile ${profileId}: all ${activeUpdatedLists.length} list(s) processed — combined Bloom filter promoted to active.`
      );
    }
  } catch (e) {
    console.error(`[Sync] Critical failure in sync pass for Profile ${profileId}:`, e);
    await profileModel.updateListUpdatedAt(profileId, now);
  }
}

/**
 * 【用户侧 / Profile 手动触发全量合并专用】
 */
export async function syncAllListsForProfile(
  profileId: string,
  env: Env,
  ctx: ExecutionContext
): Promise<void> {
  const activeSync = inFlightSyncs.get(profileId);
  if (activeSync) {
    if (activeSync.type === "all") {
      console.log(`[Sync] Profile ${profileId}: manual sync already in-flight. Joining active promise.`);
      return activeSync.promise;
    }
    console.log(`[Sync] Profile ${profileId}: waiting for in-flight ${activeSync.type} sync to finish before running manual sync.`);
    await activeSync.promise.catch(() => {});
  }

  const postWaitSync = inFlightSyncs.get(profileId);
  if (postWaitSync && postWaitSync.type === "all") {
    return postWaitSync.promise;
  }

  return runSerializedProfileTask(
    profileId,
    "all",
    { syncing: true, type: "all", stage: "preparing", current: 0, total: 0, percent: 5 },
    undefined,
    () => _executeSyncAllListsForProfile(profileId, env, ctx)
  );
}

async function _executeSyncAllListsForProfile(
  profileId: string,
  env: Env,
  ctx: ExecutionContext
): Promise<void> {
  const profileModel = new ProfileModel(env.DB);
  const listModel = new ListModel(env.DB);
  const profileBloomModel = new ProfileBloomModel(env.DB);
  const listBloomModel = new ListBloomModel(env.DB);
  const now = Math.floor(Date.now() / 1000);

  try {
    const profile = await profileModel.getById(profileId);
    if (!profile) {
      console.error(`[Sync] Profile ${profileId} not found.`);
      return;
    }

    const activeLists = (await listModel.getLists(profileId)).filter((l) => !!l.enabled);
    if (activeLists.length === 0) {
      await profileBloomModel.clearProfileBlooms(profileId);
      await profileModel.updateListUpdatedAt(profileId, now);
      return;
    }

    updateInFlightProgress(profileId, { stage: "fetching", current: 0, total: activeLists.length, percent: 10 });

    for (let idx = 0; idx < activeLists.length; idx++) {
      const list = activeLists[idx];
      const [hasBloom, meta] = await Promise.all([
        listBloomModel.hasListBloom(list.url),
        listModel.getGlobalListMetadata(list.url)
      ]);
      if (!hasBloom || !meta?.stats) {
        await syncGlobalList(list.url, env, listModel, listBloomModel, now);
      }
      updateInFlightProgress(profileId, {
        current: idx + 1,
        total: activeLists.length,
        percent: Math.round(10 + ((idx + 1) / activeLists.length) * 70)
      });
    }

    await profileModel.updateListUpdatedAt(profileId, now);
    updateInFlightProgress(profileId, { stage: "combining", percent: 85 });

    await combineAndPromote(
      profileId,
      listModel,
      listBloomModel,
      profileBloomModel,
      profileModel,
      ctx,
      now,
      Number(env.MAX_SYNC_DOMAINS) || 1000000,
      Number(env.BLOOM_FALSE_POSITIVE_RATE) || 0.0001,
      env
    );
    updateInFlightProgress(profileId, { stage: "done", percent: 100 });
    console.log(`[Sync] Profile ${profileId}: manual recombine cycle complete.`);
  } catch (e) {
    console.error(`[Sync] Critical failure in manual sync for Profile ${profileId}:`, e);
    await profileModel.updateListUpdatedAt(profileId, now);
  }
}

/**
 * 【用户侧 / 单个列表手动触发合并专用】
 */
export async function syncSingleListForProfile(
  profileId: string,
  listId: number,
  env: Env,
  ctx: ExecutionContext
): Promise<void> {
  const activeSync = inFlightSyncs.get(profileId);
  if (activeSync) {
    if (activeSync.type === "single" && activeSync.listId === listId) {
      console.log(`[Sync] Profile ${profileId}: sync for list #${listId} already in-flight. Joining active promise.`);
      return activeSync.promise;
    }
    if (activeSync.type === "all") {
      console.log(`[Sync] Profile ${profileId}: full sync in-flight (covers list #${listId}). Joining active promise.`);
      return activeSync.promise;
    }
    console.log(`[Sync] Profile ${profileId}: waiting for in-flight ${activeSync.type} sync to finish before syncing list #${listId}.`);
    await activeSync.promise.catch(() => {});
  }

  const postWaitSync = inFlightSyncs.get(profileId);
  if (postWaitSync && ((postWaitSync.type === "single" && postWaitSync.listId === listId) || postWaitSync.type === "all")) {
    return postWaitSync.promise;
  }

  return runSerializedProfileTask(
    profileId,
    "single",
    { syncing: true, type: "single", listId, stage: "preparing", current: 0, total: 1, percent: 10 },
    listId,
    () => _executeSyncSingleListForProfile(profileId, listId, env, ctx)
  );
}

async function _executeSyncSingleListForProfile(
  profileId: string,
  listId: number,
  env: Env,
  ctx: ExecutionContext
): Promise<void> {
  const listModel = new ListModel(env.DB);
  const listBloomModel = new ListBloomModel(env.DB);
  const profileBloomModel = new ProfileBloomModel(env.DB);
  const profileModel = new ProfileModel(env.DB);
  const now = Math.floor(Date.now() / 1000);

  try {
    const list = await listModel.getListById(listId, profileId);
    if (!list) {
      console.error(`[Sync] List ${listId} not found in profile ${profileId}`);
      return;
    }

    updateInFlightProgress(profileId, { stage: "fetching", current: 0, total: 1, percent: 25 });
    const [hasBloom, meta] = await Promise.all([
      listBloomModel.hasListBloom(list.url),
      listModel.getGlobalListMetadata(list.url)
    ]);
    if (!hasBloom || !meta?.stats) {
      await syncGlobalList(list.url, env, listModel, listBloomModel, now);
    }
    updateInFlightProgress(profileId, { stage: "combining", current: 1, total: 1, percent: 75 });

    if (list.enabled) {
      await profileModel.updateListUpdatedAt(profileId, now);
      await combineAndPromote(
        profileId,
        listModel,
        listBloomModel,
        profileBloomModel,
        profileModel,
        ctx,
        now,
        Number(env.MAX_SYNC_DOMAINS) || 1000000,
        Number(env.BLOOM_FALSE_POSITIVE_RATE) || 0.0001,
        env
      );
    }
    updateInFlightProgress(profileId, { stage: "done", percent: 100 });
    console.log(`[Sync] Profile ${profileId}: list #${listId} merged from system storage.`);
  } catch (e) {
    console.error(`[Sync] Critical failure in single list merge for Profile ${profileId}, list ${listId}:`, e);
  }
}

/**
 * 快速重构并合并 Profile 的布隆过滤器（纯内存合并，不触发外部网络下载）。
 */
export async function rebuildProfileBloom(
  profileId: string,
  env: Env,
  ctx: ExecutionContext
): Promise<void> {
  const activeSync = inFlightSyncs.get(profileId);
  if (activeSync) {
    console.log(`[Sync] Profile ${profileId}: waiting for in-flight ${activeSync.type} sync before rebuilding bloom.`);
    await activeSync.promise.catch(() => {});
  }

  return runSerializedProfileTask(
    profileId,
    "rebuild",
    { syncing: true, type: "rebuild", stage: "combining", current: 0, total: 1, percent: 50 },
    undefined,
    () => _executeRebuildProfileBloom(profileId, env, ctx)
  );
}

async function _executeRebuildProfileBloom(
  profileId: string,
  env: Env,
  ctx: ExecutionContext
): Promise<void> {
  const listModel = new ListModel(env.DB);
  const listBloomModel = new ListBloomModel(env.DB);
  const profileBloomModel = new ProfileBloomModel(env.DB);
  const profileModel = new ProfileModel(env.DB);

  const profile = await profileModel.getById(profileId);
  const priorListUpdatedAt = profile?.list_updated_at ?? 0;

  const rawActiveLists = (await listModel.getLists(profileId)).filter((l) => !!l.enabled);
  const seenUrls = new Set<string>();
  const activeLists = rawActiveLists.filter((l) => {
    const norm = ListModel.normalizeUrl(l.url);
    if (seenUrls.has(norm)) return false;
    seenUrls.add(norm);
    return true;
  });
  const presence = await Promise.all(
    activeLists.map((l) => listBloomModel.hasListBloom(l.url).catch(() => true))
  );

  const missingIndex = presence.findIndex((present) => !present);
  if (missingIndex !== -1) {
    const missing = activeLists[missingIndex];
    try {
      await syncGlobalList(missing.url, env, listModel, listBloomModel, Math.floor(Date.now() / 1000));
    } catch (e) {
      console.error(`[Sync] fetch of list ${missing.url} during rebuild failed:`, e);
    }
  }

  await combineAndPromote(
    profileId,
    listModel,
    listBloomModel,
    profileBloomModel,
    profileModel,
    ctx,
    Math.floor(Date.now() / 1000),
    Number(env.MAX_SYNC_DOMAINS) || 1000000,
    Number(env.BLOOM_FALSE_POSITIVE_RATE) || 0.0001,
    env
  );

  await profileModel.updateListUpdatedAt(profileId, priorListUpdatedAt);
}
