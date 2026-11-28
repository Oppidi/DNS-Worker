/**
 * @file analytics.ts
 * @description Deterministic synthetic analytics and ISP telemetry generators for Demo Mode.
 */

import {
  DEFAULT_DEMO_DOMAIN,
  DEMO_CLIENT_POOL,
  DEMO_TRAFFIC_TEMPLATES,
} from "./fixtures";

export interface DemoAnalyticsQueryOptions {
  profileId: string;
  range: string | null;
  since: number;
  until: number;
  accessPointId?: string;
  demoDomain?: string;
}

export interface DemoAnalyticsResultPayload {
  summary: { action: string; count: number }[];
  trend: { timestamp: number; action: string; count: number }[];
  top_allowed: { domain: string; count: number }[];
  top_blocked: { domain: string; count: number }[];
  clients: { client_ip: string; geo_country: string | null; count: number }[];
  destinations: { country_code: string; country: string; count: number }[];
}

function hashSeedString(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function resolveDemoAnalyticsBucketSec(range: string | null): number {
  switch (range) {
    case "10m":
    case "1h":
      return 60;
    case "7d":
    case "30d":
      return 86400;
    case "24h":
    case "custom":
    default:
      return range === null ? 60 : 3600;
  }
}

function distributeByWeight<T>(items: readonly T[], total: number, weights: readonly number[]): number[] {
  if (items.length === 0 || total <= 0) return items.map(() => 0);
  const weightSum = weights.reduce((acc, w) => acc + w, 0) || items.length;
  const counts = items.map((_, i) => Math.floor((total * (weights[i] ?? 1)) / weightSum));
  let assigned = counts.reduce((acc, c) => acc + c, 0);
  let idx = 0;
  while (assigned < total) {
    counts[idx % counts.length] += 1;
    assigned += 1;
    idx += 1;
  }
  return counts;
}

/**
 * Dynamically generates continuous, mathematically consistent Demo Mode `/stats` analytics
 * for any requested time window, profile, or Access Point filter.
 */
export function buildDemoAnalyticsPayload(
  options: DemoAnalyticsQueryOptions
): DemoAnalyticsResultPayload {
  const safeUntil = Number.isFinite(options.until) ? Math.floor(options.until) : Math.floor(Date.now() / 1000);
  const safeSince = Number.isFinite(options.since)
    ? Math.min(Math.floor(options.since), safeUntil)
    : safeUntil - 3600;
  const bucketSec = resolveDemoAnalyticsBucketSec(options.range);
  const baseSeed = hashSeedString(`${options.profileId}|${options.accessPointId || "all"}`);
  const apScale = options.accessPointId ? 0.3 : 1;

  const startBucket = Math.floor(safeSince / bucketSec) * bucketSec;
  const endBucket = Math.max(startBucket, Math.floor(safeUntil / bucketSec) * bucketSec);
  const totalSpanBuckets = Math.floor((endBucket - startBucket) / bucketSec) + 1;
  const maxRenderedBuckets = 744;
  const stepMultiplier = totalSpanBuckets > maxRenderedBuckets ? Math.ceil(totalSpanBuckets / maxRenderedBuckets) : 1;
  const effectiveStep = bucketSec * stepMultiplier;

  const passScale = bucketSec >= 86400 ? 3200 : bucketSec >= 3600 ? 150 : 6;
  const blockScale = bucketSec >= 86400 ? 950 : bucketSec >= 3600 ? 45 : 2;
  const redirectScale = bucketSec >= 86400 ? 320 : bucketSec >= 3600 ? 15 : 1;

  const trend: { timestamp: number; action: string; count: number }[] = [];
  let totalPass = 0;
  let totalBlock = 0;
  let totalRedirect = 0;

  for (let ts = startBucket, idx = 0; ts <= endBucket; ts += effectiveStep, idx++) {
    const wave = 0.72 + 0.48 * (0.5 + 0.5 * Math.sin(idx * 0.55 + (baseSeed % 11)));
    const jitter = ((hashSeedString(`${baseSeed}:${ts}`) % 37) - 18) / 100;
    const factor = Math.max(0.35, (wave + jitter) * apScale * stepMultiplier);

    const passCount = Math.max(2, Math.round(passScale * factor));
    const blockCount = Math.max(1, Math.round(blockScale * factor));
    const redirectCount = Math.max(idx % 3 === 0 ? 1 : 0, Math.round(redirectScale * factor * 0.85));

    totalPass += passCount;
    totalBlock += blockCount;
    totalRedirect += redirectCount;

    trend.push({ timestamp: ts, action: "PASS", count: passCount });
    trend.push({ timestamp: ts, action: "BLOCK", count: blockCount });
    if (redirectCount > 0) {
      trend.push({ timestamp: ts, action: "REDIRECT", count: redirectCount });
    }
  }

  const summary = [
    { action: "PASS", count: totalPass },
    { action: "BLOCK", count: totalBlock },
    { action: "REDIRECT", count: totalRedirect },
  ];

  const passTemplates = DEMO_TRAFFIC_TEMPLATES.filter((t) => t.action === "PASS");
  const blockTemplates = DEMO_TRAFFIC_TEMPLATES.filter((t) => t.action === "BLOCK");
  const passCounts = distributeByWeight(passTemplates, totalPass, passTemplates.map((_, i) => Math.max(2, passTemplates.length + 2 - i)));
  const blockCounts = distributeByWeight(blockTemplates, totalBlock, blockTemplates.map((_, i) => Math.max(2, blockTemplates.length + 2 - i)));

  const demoDomain = options.demoDomain?.trim() || DEFAULT_DEMO_DOMAIN;
  const top_allowed = passTemplates
    .map((tpl, i) => ({ domain: tpl.domain.replace(DEFAULT_DEMO_DOMAIN, demoDomain), count: passCounts[i] || 0 }))
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const top_blocked = blockTemplates
    .map((tpl, i) => ({ domain: tpl.domain.replace(DEFAULT_DEMO_DOMAIN, demoDomain), count: blockCounts[i] || 0 }))
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const totalQueries = totalPass + totalBlock + totalRedirect;
  const clientPool = options.accessPointId
    ? [DEMO_CLIENT_POOL[baseSeed % DEMO_CLIENT_POOL.length]]
    : DEMO_CLIENT_POOL;
  const clientCounts = distributeByWeight(clientPool, totalQueries, clientPool.map((_, i) => Math.max(1, clientPool.length - i)));

  const clients = clientPool
    .map((client, i) => ({ client_ip: client.clientIp, geo_country: client.geoCountry, count: clientCounts[i] || 0 }))
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count);

  const destAggregate = new Map<string, { country_code: string; country: string; count: number }>();
  const geoTemplates = DEMO_TRAFFIC_TEMPLATES.filter((t) => Boolean(t.destCode));
  const geoCounts = distributeByWeight(
    geoTemplates,
    totalPass + totalBlock,
    geoTemplates.map((_, i) => Math.max(1, geoTemplates.length - i))
  );
  geoTemplates.forEach((tpl, i) => {
    const c = geoCounts[i] || 0;
    if (c <= 0) return;
    const prev = destAggregate.get(tpl.destCode);
    if (prev) {
      prev.count += c;
    } else {
      destAggregate.set(tpl.destCode, { country_code: tpl.destCode, country: tpl.destCountry, count: c });
    }
  });

  const destinations = Array.from(destAggregate.values()).sort((a, b) => b.count - a.count);
  return { summary, trend, top_allowed, top_blocked, clients, destinations };
}

/**
 * Builds country-level ISP distribution for `/api/profiles/:id/analytics/isps` in Demo Mode.
 */
export function buildDemoAnalyticsIspsPayload(options: {
  countryCode?: string;
  profileId: string;
  range: string | null;
  since: number;
  until: number;
  accessPointId?: string;
  limit?: number;
}): { name: string; count: number }[] {
  const analytics = buildDemoAnalyticsPayload(options);
  const totalForCountry = options.countryCode
    ? analytics.destinations.find((d) => d.country_code.toUpperCase() === options.countryCode!.toUpperCase())?.count ||
      analytics.destinations[0]?.count ||
      50
    : analytics.summary.reduce((acc, s) => acc + s.count, 0);

  const upperCode = options.countryCode?.trim().toUpperCase();
  const matchingTemplates = DEMO_TRAFFIC_TEMPLATES.filter(
    (t) => Boolean(t.destIsp) && (!upperCode || t.destCode.toUpperCase() === upperCode)
  );
  const ispSource =
    matchingTemplates.length > 0
      ? matchingTemplates
      : DEMO_TRAFFIC_TEMPLATES.filter((t) => Boolean(t.destIsp));

  const uniqueIsps = Array.from(new Set(ispSource.map((t) => t.destIsp)));
  const counts = distributeByWeight(uniqueIsps, totalForCountry, uniqueIsps.map((_, i) => Math.max(1, uniqueIsps.length - i)));
  const cap = options.limit && options.limit > 0 ? options.limit : 20;

  return uniqueIsps
    .map((name, i) => ({ name, count: counts[i] || 0 }))
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, cap);
}
