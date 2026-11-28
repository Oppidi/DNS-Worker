/**
 * @file aggregation.ts
 * @description Model responsible for maintaining and computing hourly rollups
 * across resolution logs, clients, destinations, and domains in a unified table.
 */

import { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import { SystemSettingsModel } from "../systemSettings";
import { ResolutionLog } from "../../types";
import { buildMicroBatchRollupStatements } from "./aggregation/microBatch";
import {
  buildDomainRollupInsertStatement,
  buildProfileHourlyRollupStatements
} from "./aggregation/sqlRollups";

export class LogAggregationModel {
  private tablesEnsured = false;

  constructor(private readonly db: D1Database) {}

  /**
   * Automatically creates the unified `hourly_rollups` table if it does not exist yet.
   */
  async ensureRollupTables(): Promise<void> {
    if (this.tablesEnsured) return;
    if (typeof this.db.exec !== 'function') return;
    try {
      await this.db.exec(`
        CREATE TABLE IF NOT EXISTS hourly_rollups (
            profile_id TEXT NOT NULL,
            metric_type TEXT NOT NULL,
            hour_timestamp INTEGER NOT NULL,
            key TEXT NOT NULL,
            sub_key TEXT NOT NULL DEFAULT '',
            access_point_id TEXT NOT NULL DEFAULT '',
            count INTEGER NOT NULL DEFAULT 1,
            PRIMARY KEY (
                profile_id,
                metric_type,
                hour_timestamp,
                key,
                sub_key,
                access_point_id
            )
        ) WITHOUT ROWID;
      `);
      this.tablesEnsured = true;
    } catch (e: any) {
      console.warn("[LogAggregationModel] ensureRollupTables notice:", e.message || e);
    }
  }

  /**
   * Generates atomic UPSERT statements for in-flight log micro-batches.
   */
  async createRollupUpsertStatements(
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
    return buildMicroBatchRollupStatements(this.db, logs, options);
  }

  /**
   * Retrieves the latest completed hour timestamp aggregated in hourly_rollups for a profile and metric.
   */
  async getLatestRollupHour(profileId: string, metricType = 'action'): Promise<number | null> {
    try {
      const row = await this.db.prepare(
        "SELECT MAX(hour_timestamp) as max_hour FROM hourly_rollups WHERE profile_id = ? AND metric_type = ?"
      ).bind(profileId, metricType).first<{ max_hour: number | null }>();
      return row?.max_hour ?? null;
    } catch {
      await this.ensureRollupTables();
      return null;
    }
  }

  async getLatestClientRollupHour(profileId: string): Promise<number | null> {
    return this.getLatestRollupHour(profileId, 'client');
  }

  async getLatestDestinationRollupHour(profileId: string): Promise<number | null> {
    return this.getLatestRollupHour(profileId, 'dest');
  }

  async getLatestISPRollupHour(profileId: string): Promise<number | null> {
    return this.getLatestRollupHour(profileId, 'isp');
  }

  async getLatestDomainRollupHour(profileId: string): Promise<number | null> {
    return this.getLatestRollupHour(profileId, 'domain');
  }

  /**
   * Aggregates completed hours of raw logs into `'domain'` rollups only.
   */
  async aggregateDomainRollups(untilSec?: number, minDomainCount = 1): Promise<number> {
    await this.ensureRollupTables();
    const currentHourStart = Math.floor(Date.now() / 1000 / 3600) * 3600;
    const effectiveUntil = untilSec !== undefined ? Math.min(untilSec, currentHourStart) : currentHourStart;

    try {
      const { results: profiles } = await this.db.prepare("SELECT id FROM profiles").all<{ id: string }>();

      let insertedRows = 0;
      for (const profile of profiles ?? []) {
        const latestHour = await this.getLatestDomainRollupHour(profile.id);
        let since: number;
        if (latestHour !== null) {
          since = latestHour + 3600;
        } else {
          const oldest = await this.db.prepare(
            "SELECT MIN(timestamp) AS ts FROM logs WHERE profile_id = ? AND (encrypt_version IS NULL OR encrypt_version = 0)"
          ).bind(profile.id).first<{ ts: number | null }>();
          if (oldest?.ts === null || oldest?.ts === undefined) continue;
          since = Math.floor(oldest.ts / 3600) * 3600;
        }

        if (since >= effectiveUntil) continue;
        const result = await buildDomainRollupInsertStatement(
          this.db,
          profile.id,
          since,
          effectiveUntil,
          minDomainCount,
          false
        ).run();
        insertedRows += result.meta.changes || 0;
      }
      return insertedRows;
    } catch (e: any) {
      console.error("[LogAggregationModel] aggregateDomainRollups failed:", e.message || e);
      return 0;
    }
  }

  /**
   * Aggregates completed hours of raw logs into the unified hourly_rollups table.
   */
  async aggregateHourlyRollups(
    sinceSec?: number,
    untilSec?: number,
    minDomainCount = 1
  ): Promise<number> {
    await this.ensureRollupTables();
    const currentHourStart = Math.floor(Date.now() / 1000 / 3600) * 3600;
    const effectiveUntil = untilSec !== undefined ? Math.min(untilSec, currentHourStart) : currentHourStart;

    let effectiveSince = sinceSec;
    const systemSettings = new SystemSettingsModel(this.db);

    if (effectiveSince === undefined) {
      const lastAggregatedStr = await systemSettings.get("last_hourly_rollup_timestamp");
      if (lastAggregatedStr) {
        const lastHour = parseInt(lastAggregatedStr, 10);
        if (!isNaN(lastHour) && lastHour > 0) {
          effectiveSince = Math.max(lastHour, effectiveUntil - 86400);
        }
      }
      if (effectiveSince === undefined) {
        effectiveSince = Math.max(0, effectiveUntil - 3600);
      }
    }

    if (effectiveSince >= effectiveUntil) {
      return 0;
    }

    try {
      const { results: profiles } = await this.db.prepare("SELECT id FROM profiles").all<{ id: string }>();

      if (!profiles || profiles.length === 0) {
        await systemSettings.set("last_hourly_rollup_timestamp", String(effectiveUntil));
        return 0;
      }

      let totalAggregatedRows = 0;

      for (const profile of profiles) {
        const hasAnyLogs = await this.db
          .prepare("SELECT 1 FROM logs WHERE profile_id = ? AND timestamp >= ? AND timestamp < ? LIMIT 1")
          .bind(profile.id, effectiveSince, effectiveUntil)
          .first();
        if (!hasAnyLogs) continue;

        const hasPlaintextLogs = Boolean(
          await this.db
            .prepare(
              "SELECT 1 FROM logs WHERE profile_id = ? AND timestamp >= ? AND timestamp < ? AND (encrypt_version IS NULL OR encrypt_version = 0) LIMIT 1"
            )
            .bind(profile.id, effectiveSince, effectiveUntil)
            .first()
        );

        const statements = buildProfileHourlyRollupStatements(
          this.db,
          profile.id,
          effectiveSince,
          effectiveUntil,
          hasPlaintextLogs,
          minDomainCount
        );
        const results = await this.db.batch(statements);
        for (const res of results) {
          totalAggregatedRows += res.meta.changes || 0;
        }
      }

      await systemSettings.set("last_hourly_rollup_timestamp", String(effectiveUntil));
      return totalAggregatedRows;
    } catch (e: any) {
      console.error("[LogAggregationModel] aggregateHourlyRollups failed:", e.message || e);
      return 0;
    }
  }
}
