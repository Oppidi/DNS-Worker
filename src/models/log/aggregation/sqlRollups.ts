/**
 * @file sqlRollups.ts
 * @description SQL query builders for hourly domain-only backfills and full per-profile hourly rollups.
 */

import { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";

/**
 * Prepares the SQL statement inserting completed-hour `'domain'` rollups for a single profile window.
 */
export function buildDomainRollupInsertStatement(
  db: D1Database,
  profileId: string,
  sinceSec: number,
  untilSec: number,
  minDomainCount: number,
  onConflictUpdate: boolean
): D1PreparedStatement {
  const conflictClause = onConflictUpdate
    ? "ON CONFLICT (profile_id, metric_type, hour_timestamp, key, sub_key, access_point_id)\n      DO UPDATE SET count = excluded.count"
    : "ON CONFLICT (profile_id, metric_type, hour_timestamp, key, sub_key, access_point_id)\n      DO NOTHING";

  return db.prepare(`
    INSERT INTO hourly_rollups (profile_id, metric_type, hour_timestamp, key, sub_key, access_point_id, count)
    SELECT
        ?,
        'domain',
        (timestamp / 3600) * 3600 AS hour_timestamp,
        domain,
        action,
        COALESCE(access_point_id, ''),
        COUNT(*) AS count
    FROM logs
    WHERE profile_id = ? AND timestamp >= ? AND timestamp < ?
      AND domain IS NOT NULL AND domain != '' AND domain != '[Encrypted]'
      AND (encrypt_version IS NULL OR encrypt_version = 0)
      AND domain NOT LIKE 'enc:%'
    GROUP BY (timestamp / 3600) * 3600, domain, action, COALESCE(access_point_id, '')
    HAVING COUNT(*) >= ?
    ${conflictClause}
  `).bind(profileId, profileId, sinceSec, untilSec, minDomainCount);
}

/**
 * Builds the set of hourly rollup INSERT/UPSERT statements for one profile within `[effectiveSince, effectiveUntil)`.
 */
export function buildProfileHourlyRollupStatements(
  db: D1Database,
  profileId: string,
  effectiveSince: number,
  effectiveUntil: number,
  hasPlaintextLogs: boolean,
  minDomainCount: number
): D1PreparedStatement[] {
  const statements: D1PreparedStatement[] = [
    db.prepare(`
      INSERT INTO hourly_rollups (profile_id, metric_type, hour_timestamp, key, sub_key, access_point_id, count)
      SELECT
          ?,
          'action',
          (timestamp / 3600) * 3600 AS hour_timestamp,
          action,
          '',
          COALESCE(access_point_id, ''),
          COUNT(*) AS count
      FROM logs
      WHERE profile_id = ? AND timestamp >= ? AND timestamp < ?
      GROUP BY (timestamp / 3600) * 3600, action, COALESCE(access_point_id, '')
      ON CONFLICT (profile_id, metric_type, hour_timestamp, key, sub_key, access_point_id)
      DO UPDATE SET count = excluded.count
    `).bind(profileId, profileId, effectiveSince, effectiveUntil),
  ];

  if (hasPlaintextLogs) {
    statements.push(
      db.prepare(`
        INSERT INTO hourly_rollups (profile_id, metric_type, hour_timestamp, key, sub_key, access_point_id, count)
        SELECT
            ?,
            'client',
            (timestamp / 3600) * 3600 AS hour_timestamp,
            client_ip,
            COALESCE(geo_country, ''),
            COALESCE(access_point_id, ''),
            COUNT(*) AS count
        FROM logs
        WHERE profile_id = ? AND timestamp >= ? AND timestamp < ?
          AND (encrypt_version IS NULL OR encrypt_version = 0)
          AND client_ip IS NOT NULL AND client_ip != '' AND client_ip != '[Encrypted]'
        GROUP BY (timestamp / 3600) * 3600, client_ip, COALESCE(geo_country, ''), COALESCE(access_point_id, '')
        ON CONFLICT (profile_id, metric_type, hour_timestamp, key, sub_key, access_point_id)
        DO UPDATE SET count = excluded.count
      `).bind(profileId, profileId, effectiveSince, effectiveUntil),

      db.prepare(`
        INSERT INTO hourly_rollups (profile_id, metric_type, hour_timestamp, key, sub_key, access_point_id, count)
        SELECT
            ?,
            'dest',
            (timestamp / 3600) * 3600 AS hour_timestamp,
            UPPER(CASE
              WHEN dest_country_code IS NOT NULL AND dest_country_code != '' THEN dest_country_code
              WHEN dest_geoip IS NOT NULL AND dest_geoip != '' AND dest_geoip LIKE '{%' THEN json_extract(dest_geoip, '$.country_code')
              ELSE ''
            END) AS key,
            MAX(CASE
              WHEN dest_country IS NOT NULL AND dest_country != '' THEN dest_country
              WHEN dest_geoip IS NOT NULL AND dest_geoip != '' AND dest_geoip LIKE '{%' THEN json_extract(dest_geoip, '$.country')
              ELSE 'Unknown'
            END) AS sub_key,
            COALESCE(access_point_id, '') AS access_point_id,
            COUNT(*) AS count
        FROM logs
        WHERE profile_id = ? AND timestamp >= ? AND timestamp < ?
          AND (encrypt_version IS NULL OR encrypt_version = 0)
          AND (
            (dest_country_code IS NOT NULL AND dest_country_code != '')
            OR
            (dest_geoip IS NOT NULL AND dest_geoip != '' AND dest_geoip LIKE '{%' AND json_extract(dest_geoip, '$.country_code') IS NOT NULL AND json_extract(dest_geoip, '$.country_code') != '')
          )
        GROUP BY (timestamp / 3600) * 3600,
                 UPPER(CASE
                   WHEN dest_country_code IS NOT NULL AND dest_country_code != '' THEN dest_country_code
                   WHEN dest_geoip IS NOT NULL AND dest_geoip != '' AND dest_geoip LIKE '{%' THEN json_extract(dest_geoip, '$.country_code')
                   ELSE ''
                 END),
                 COALESCE(access_point_id, '')
        ON CONFLICT (profile_id, metric_type, hour_timestamp, key, sub_key, access_point_id)
        DO UPDATE SET count = excluded.count
      `).bind(profileId, profileId, effectiveSince, effectiveUntil),

      buildDomainRollupInsertStatement(db, profileId, effectiveSince, effectiveUntil, minDomainCount, true),

      db.prepare(`
        INSERT INTO hourly_rollups (profile_id, metric_type, hour_timestamp, key, sub_key, access_point_id, count)
        SELECT
            ?,
            'isp',
            (timestamp / 3600) * 3600 AS hour_timestamp,
            UPPER(CASE
              WHEN dest_country_code IS NOT NULL AND dest_country_code != '' THEN dest_country_code
              WHEN dest_geoip IS NOT NULL AND dest_geoip != '' AND dest_geoip LIKE '{%' THEN json_extract(dest_geoip, '$.country_code')
              ELSE ''
            END) AS key,
            CASE
              WHEN dest_isp IS NOT NULL AND dest_isp != '' THEN dest_isp
              WHEN dest_geoip IS NOT NULL AND dest_geoip != '' AND dest_geoip LIKE '{%' THEN COALESCE(NULLIF(json_extract(dest_geoip, '$.isp'), ''), json_extract(dest_geoip, '$.org'))
              ELSE ''
            END AS sub_key,
            COALESCE(access_point_id, '') AS access_point_id,
            COUNT(*) AS count
        FROM logs
        WHERE profile_id = ? AND timestamp >= ? AND timestamp < ?
          AND (encrypt_version IS NULL OR encrypt_version = 0)
          AND (
            (dest_isp IS NOT NULL AND dest_isp != '')
            OR
            (dest_geoip IS NOT NULL AND dest_geoip != '' AND dest_geoip LIKE '{%' AND (
              (json_extract(dest_geoip, '$.isp') IS NOT NULL AND json_extract(dest_geoip, '$.isp') != '')
              OR
              (json_extract(dest_geoip, '$.org') IS NOT NULL AND json_extract(dest_geoip, '$.org') != '')
            ))
          )
        GROUP BY (timestamp / 3600) * 3600,
                 key,
                 sub_key,
                 COALESCE(access_point_id, '')
        HAVING sub_key != ''
        ON CONFLICT (profile_id, metric_type, hour_timestamp, key, sub_key, access_point_id)
        DO UPDATE SET count = excluded.count
      `).bind(profileId, profileId, effectiveSince, effectiveUntil)
    );
  }

  return statements;
}
