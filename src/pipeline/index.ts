import { Context, DNSQuery, ProfileSettings, ResolutionResult } from "../types";
import { DEFAULT_FAIL_OPEN_UPSTREAM } from "../constants/presets";
import { buildResponse } from "../utils/dns";
import {
  computeDnsCacheKey,
  computeDnsCacheKeySync,
  getCachedDnsEntry,
  pipelineCache,
  syncDnsCacheSize
} from "./cache";
import { pipelineConfig } from "./config";
import { pipelineResolver } from "./resolver";
import { pipelineFilter } from "./filter";

function nowHighResMs(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

/**
 * Normalizes stage timings and total latency to 2 decimal places (`0.01ms` granularity)
 * and guarantees `sum(timings) === latency` via largest-remainder rounding.
 */
function buildReconciledTimings(
  rawStages: Record<string, number>,
  totalElapsedMs: number
): { latency: number; timings: Record<string, number> } {
  const entries = Object.entries(rawStages);
  const clampedTotal = Math.max(0, totalElapsedMs);
  if (entries.length === 0) {
    return { latency: Math.round(clampedTotal * 100) / 100, timings: {} };
  }

  const totalCenti = Math.round(clampedTotal * 100);
  const floors: Array<{ key: string; centi: number; frac: number }> = entries.map(([key, val]) => {
    const scaled = Math.max(0, val) * 100;
    const floorVal = Math.floor(scaled);
    return { key, centi: floorVal, frac: scaled - floorVal };
  });

  let sumFloor = floors.reduce((acc, item) => acc + item.centi, 0);
  let diff = totalCenti - sumFloor;

  if (diff > 0) {
    const byLargestFrac = [...floors].sort((a, b) => b.frac - a.frac);
    for (let i = 0; i < diff; i++) {
      byLargestFrac[i % byLargestFrac.length].centi += 1;
    }
  } else if (diff < 0) {
    // Cap sum to totalCenti when rounded stage sums exceed totalCenti (e.g. edge clock jitter)
    const bySmallestFrac = [...floors].sort((a, b) => a.frac - b.frac);
    let remaining = -diff;
    for (const item of bySmallestFrac) {
      if (remaining <= 0) break;
      const take = Math.min(item.centi, remaining);
      item.centi -= take;
      remaining -= take;
    }
  }

  const finalCenti = floors.reduce((acc, item) => acc + item.centi, 0);
  const timings: Record<string, number> = {};
  for (const item of floors) {
    timings[item.key] = item.centi / 100;
  }

  return {
    latency: finalCenti / 100,
    timings
  };
}

/**
 * Returns true when filtering is actively paused and has not yet reached its Unix expiry timestamp.
 *
 * @param settings - Current profile settings.
 * @param nowSec - Current Unix timestamp in seconds.
 * @returns Whether filtering rules and default block policy should be bypassed.
 */
export function isFilteringPaused(
  settings: ProfileSettings,
  nowSec: number = Math.floor(Date.now() / 1000)
): boolean {
  const pause = settings.pause_filtering;
  if (!pause?.enabled) return false;
  if (pause.expires_at > 0 && nowSec >= pause.expires_at) {
    return false;
  }
  return true;
}

export const pipeline = {
  clearCache: pipelineCache.clear,

  async process(request: Request, query: DNSQuery, context: Context): Promise<ResolutionResult> {
    const procStart = nowHighResMs();
    const rawTimings: Record<string, number> = {};
    let mark = procStart;
    const track = (name: string) => {
      const now = nowHighResMs();
      rawTimings[name] = (rawTimings[name] || 0) + Math.max(0, now - mark);
      mark = now;
    };

    const finalize = (result: ResolutionResult): ResolutionResult => {
      const elapsedMs = Math.max(0, nowHighResMs() - procStart);
      if (mark < procStart + elapsedMs) {
        // Capture any trailing synchronous work cleanly without losing it from the sum
        const trailing = Math.max(0, procStart + elapsedMs - mark);
        if (trailing > 0.005) {
          rawTimings.finalize = (rawTimings.finalize || 0) + trailing;
        }
      }
      const reconciled = buildReconciledTimings(rawTimings, elapsedMs);
      return {
        ...result,
        latency: reconciled.latency,
        timings: reconciled.timings
      };
    };

    // 动态同步统一 DNS 缓存上限（默认为 20k）
    syncDnsCacheSize(context.env);

    // 特殊域名 & 缓存检查 (L1)
    if (query.name.toLowerCase() === 'dns_worker' && query.type === 'TXT') {
      const answer = buildResponse(query.raw, 'TXT', context.profileId || 'dns_worker');
      track('internal_verify');
      return finalize({ answer, ttl: 60, action: "PASS", reason: "Internal Verification" });
    }

    const dnsCacheKey =
      computeDnsCacheKeySync(context.profileId, query.name, query.type) ??
      (await computeDnsCacheKey(context.profileId, query.name, query.type));
    const cached = getCachedDnsEntry(dnsCacheKey);
    if (cached) {
      // 这里的 cached.answer 已经是完整的 DNS 报文
      // 关键：DNS ID 必须匹配原始查询。ID 位于报文的前 2 字节。
      const response = new Uint8Array(cached.answer);
      if (response.length >= 2 && query.raw.length >= 2) {
        response[0] = query.raw[0];
        response[1] = query.raw[1];
      }

      track('dns_cache_mem');
      return finalize({
        answer: response,
        ttl: Math.ceil((cached.expiresAt - Date.now()) / 1000),
        action: cached.action,
        reason: cached.reason
      });
    }
    track('dns_cache_check');

    // 加载配置
    const config = await pipelineConfig.load(context, track);
    if (!config) {
      const failOpenUpstream = context.env.FAIL_OPEN_UPSTREAM || DEFAULT_FAIL_OPEN_UPSTREAM;
      console.warn(`[Pipeline] Config unavailable for profile ${context.profileId}. Failing open to ${failOpenUpstream}`);
      const fallbackSettings: ProfileSettings = {
        upstream: [failOpenUpstream],
        default_policy: "ALLOW",
        log_retention_days: 0,
        ecs: { enabled: true, use_client_ip: true }
      };
      const final = await pipelineResolver.resolve(request, query, context, fallbackSettings, "PASS", "Fail-Open Fallback", track);
      return finalize(final);
    }

    // 停用过滤检查：若开启且未过期，跳过所有过滤规则与默认拦截策略，直接流向上游服务器
    if (isFilteringPaused(config.settings)) {
      track('pause_check');
      const bypassed = await pipelineResolver.resolve(request, query, context, config.settings, "PASS", "Filtering Paused", track);
      return finalize(bypassed);
    }

    // 匹配规则 (本地 + 外部)
    const matchResult = await pipelineFilter.match(
      request,
      query,
      context,
      config.settings,
      config.rules,
      config.bloom,
      track,
      config.adguard
    );
    if (matchResult) return finalize(matchResult);

    // 默认策略 & 最终解析
    if (config.settings.default_policy === 'BLOCK') {
      const block = await pipelineResolver.block(request, query, context, config.settings, "BLOCK", "Default Policy", undefined, undefined, track);
      return finalize(block);
    }

    const final = await pipelineResolver.resolve(request, query, context, config.settings, "PASS", undefined, track);
    return finalize(final);
  }
};
