/**
 * @file progress.ts
 * @description Per-profile in-memory synchronization mutex and progress tracker.
 */

export interface SyncProgress {
  syncing: boolean;
  type?: "all" | "single" | "next" | "rebuild";
  listId?: number;
  stage: "preparing" | "fetching" | "combining" | "done";
  current: number;
  total: number;
  percent: number;
}

export interface InFlightSync {
  type: "all" | "next" | "single" | "rebuild";
  listId?: number;
  progress: SyncProgress;
  promise: Promise<void>;
}

/**
 * 内存级 Profile 同步并发互斥锁（按 profileId 隔离）。
 * 彻底防止多协程导致的大列表重复拉取、内存飙升与 D1 SQLite 数据库写锁冲突。
 */
export const inFlightSyncs = new Map<string, InFlightSync>();

/**
 * 返回指定 Profile 当前正在进行中的同步进度；若未在同步则返回空闲状态。
 */
export function getProfileSyncProgress(profileId: string): SyncProgress {
  const active = inFlightSyncs.get(profileId);
  if (!active) {
    return { syncing: false, stage: "done", current: 0, total: 0, percent: 0 };
  }
  return { ...active.progress };
}

export function updateInFlightProgress(profileId: string, patch: Partial<SyncProgress>): void {
  const active = inFlightSyncs.get(profileId);
  if (active) {
    active.progress = { ...active.progress, ...patch };
  }
}

/**
 * 检查指定 profile 是否正在进行同步（供监控或测试使用）
 */
export function isProfileSyncing(profileId: string): boolean {
  return inFlightSyncs.has(profileId);
}

/**
 * 仅供测试套件重置互斥锁状态
 */
export function _resetInFlightSyncsForTesting(): void {
  inFlightSyncs.clear();
}
