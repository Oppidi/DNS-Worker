/**
 * @file microBatch.ts
 * @description Pure in-memory aggregation and atomic SQL statement generation for log micro-batches.
 */

import { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import { ResolutionLog } from "../../../types";

interface RollupItem {
  profileId: string;
  metricType: string;
  hourTimestamp: number;
  key: string;
  subKey: string;
  accessPointId: string;
  count: number;
}

function accumulateRollup(map: Map<string, RollupItem>, item: Omit<RollupItem, 'count'>): void {
  const mapKey = `${item.profileId}|${item.metricType}|${item.hourTimestamp}|${item.key}|${item.subKey}|${item.accessPointId}`;
  const existing = map.get(mapKey);
  if (existing) {
    existing.count++;
  } else {
    map.set(mapKey, { ...item, count: 1 });
  }
}

function extractDestFields(log: ResolutionLog): { destCode: string; destCountry: string; destIsp: string } {
  let destCode = log.dest_country_code || '';
  let destCountry = log.dest_country || '';
  let destIsp = log.dest_isp || '';

  if ((!destCode || !destCountry || !destIsp) && log.dest_geoip && log.dest_geoip.startsWith('{')) {
    try {
      const parsed = JSON.parse(log.dest_geoip);
      if (!destCode) destCode = parsed.country_code || '';
      if (!destCountry) destCountry = parsed.country || '';
      if (!destIsp) destIsp = parsed.isp || parsed.org || '';
    } catch {}
  }

  return { destCode, destCountry, destIsp };
}

/**
 * Generates atomic `hourly_rollups` UPSERT statements for in-flight log micro-batches.
 */
export async function buildMicroBatchRollupStatements(
  db: D1Database,
  logs: ResolutionLog[],
  options?: {
    encryptedProfiles?: Set<string>;
    redactedProfiles?: Set<string>;
    encryptRollup?: (
      profileId: string,
      payload: { metricType: string; key: string; subKey: string }
    ) => Promise<string | null>;
  }
): Promise<D1PreparedStatement[]> {
  if (!logs || logs.length === 0) return [];

  const map = new Map<string, RollupItem>();

  for (const log of logs) {
    if (!log.profile_id) continue;
    const hourTimestamp = Math.floor(log.timestamp / 3600) * 3600;
    const accessPointId = log.access_point_id || '';

    if (log.action) {
      accumulateRollup(map, {
        profileId: log.profile_id,
        metricType: 'action',
        hourTimestamp,
        key: log.action,
        subKey: '',
        accessPointId
      });
    }

    if (log.client_ip && log.client_ip !== '[Encrypted]') {
      accumulateRollup(map, {
        profileId: log.profile_id,
        metricType: 'client',
        hourTimestamp,
        key: log.client_ip,
        subKey: log.geo_country || '',
        accessPointId
      });
    }

    const { destCode, destCountry, destIsp } = extractDestFields(log);
    if (destCode) {
      const codeUpper = destCode.toUpperCase();
      accumulateRollup(map, {
        profileId: log.profile_id,
        metricType: 'dest',
        hourTimestamp,
        key: codeUpper,
        subKey: destCountry,
        accessPointId
      });

      if (destIsp) {
        accumulateRollup(map, {
          profileId: log.profile_id,
          metricType: 'isp',
          hourTimestamp,
          key: codeUpper,
          subKey: destIsp,
          accessPointId
        });
      }
    }
  }

  const statements: D1PreparedStatement[] = [];
  for (const item of map.values()) {
    if (
      item.metricType !== 'action' &&
      (options?.redactedProfiles?.has(item.profileId) ||
        options?.encryptedProfiles?.has(item.profileId))
    ) {
      continue;
    }

    statements.push(
      db.prepare(`
        INSERT INTO hourly_rollups (profile_id, metric_type, hour_timestamp, key, sub_key, access_point_id, count)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (profile_id, metric_type, hour_timestamp, key, sub_key, access_point_id)
        DO UPDATE SET count = count + excluded.count
      `).bind(
        item.profileId,
        item.metricType,
        item.hourTimestamp,
        item.key,
        item.subKey,
        item.accessPointId,
        item.count
      )
    );
  }

  return statements;
}
