/**
 * @file globalSync.ts
 * @description System-wide cron global list updater and affected-profile batch recombiner.
 */

import { Env, ExecutionContext } from "../../../types";
import { ProfileModel } from "../../../models/profile";
import { ListModel } from "../../../models/list";
import { ProfileBloomModel } from "../../../models/profileBloom";
import { ListBloomModel } from "../../../models/listBloom";
import { combineAndPromote } from "../combine";
import { syncGlobalList } from "../singleListSync";

/**
 * 【Cron / 系统侧统一更新专用】
 * 周期性扫描全系统活跃的唯一订阅列表 URL，挑选最陈旧的一个进行网络同步与布隆编译。
 * 若上游列表内容发生实质变动，自动触发所有订阅该列表的 Profile 进行合并晋升。
 * 若上游命中 304 Not Modified，0 重新编译与 0 Profile 级合并消耗。
 */
export async function syncNextGlobalList(
  env: Env,
  ctx: ExecutionContext
): Promise<boolean> {
  const listModel = new ListModel(env.DB);
  const listBloomModel = new ListBloomModel(env.DB);
  const profileBloomModel = new ProfileBloomModel(env.DB);
  const profileModel = new ProfileModel(env.DB);
  const now = Math.floor(Date.now() / 1000);

  const syncIntervalSec = Number(env.SYNC_PROFILE_INTERVAL_SEC) || 86400;
  const cutoffTime = now - syncIntervalSec;

  const staleUrls = await listModel.getDistinctActiveUrls(cutoffTime, 1);
  if (staleUrls.length === 0) {
    return false;
  }

  const targetUrl = staleUrls[0];
  console.log(`[Sync System] Checking unified update for global list: ${targetUrl}`);

  try {
    const { notModified, syncError } = await syncGlobalList(targetUrl, env, listModel, listBloomModel, now);

    if (!notModified && !syncError) {
      const affectedProfiles = await listModel.getProfilesSubscribingToUrl(targetUrl);
      console.log(`[Sync System] List updated: recompiling filters for ${affectedProfiles.length} affected profile(s).`);

      const maxDomains = Number(env.MAX_SYNC_DOMAINS) || 1000000;
      const falsePositiveRate = Number(env.BLOOM_FALSE_POSITIVE_RATE) || 0.0001;
      const maxRecombine = Number(env.MAX_RECOMBINE_PER_CRON) || 50;
      const batchProfiles = affectedProfiles.slice(0, maxRecombine);

      for (let i = 0; i < batchProfiles.length; i++) {
        const profileId = batchProfiles[i];
        try {
          await combineAndPromote(
            profileId,
            listModel,
            listBloomModel,
            profileBloomModel,
            profileModel,
            ctx,
            now,
            maxDomains,
            falsePositiveRate,
            env
          );
        } catch (combErr) {
          console.error(`[Sync System] Failed to recombine profile ${profileId}:`, combErr);
        }
        if ((i + 1) % 10 === 0) {
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }
      }
    } else if (notModified) {
      console.log(`[Sync System] List ${targetUrl} 304 Not Modified: 0 profiles need recombine.`);
    }

    return true;
  } catch (err) {
    console.error(`[Sync System] Error updating global list ${targetUrl}:`, err);
    return false;
  }
}
