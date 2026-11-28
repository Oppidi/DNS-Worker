/**
 * @file database.ts
 * @description Serverfull database initialization (SQLite / Turso), schema migrations, and graceful WAL shutdown.
 */

import path from 'node:path';
import type { Env } from '../../types';
import type { ServerfullConfig } from '../config';
import { initServerfullDb } from '../db';
import { ServerfullSnapshotManager } from '../snapshot';
import { createTursoClient, maskDatabaseUrl } from '../../lib/turso';
import { runTursoMigrations } from '../../lib/turso/migrate';
import { initCloudflareIpRanges } from '../../utils/ech/sync';
import { formatDiagnostic } from '../format';
import type { SqliteMaintenanceHandle } from './cron';

/**
 * Initializes the configured Serverfull database backend (`File` SQLite or `Turso` libSQL),
 * runs primary-process schema migrations, and loads synced Cloudflare proxy CIDRs.
 */
export async function initConfiguredDatabase(
  config: ServerfullConfig,
  env: Env,
  isPrimary: boolean
): Promise<SqliteMaintenanceHandle | null> {
  let localSqliteDb: SqliteMaintenanceHandle | null = null;

  if (config.databaseService === 'Turso') {
    if (!config.tursoDatabaseUrl || !config.tursoAuthToken) {
      console.error(formatDiagnostic({
        level: 'error',
        title: 'Database Configuration Error',
        message: "DATABASE_SERVICE is set to 'Turso', but TURSO_DATABASE_URL or TURSO_AUTH_TOKEN is missing.",
        solutions: [
          'Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN in .env or via CLI arguments (--turso-url, --turso-token).',
          "Alternatively, set DATABASE_SERVICE='File' to use local SQLite.",
        ],
      }));
      process.exit(1);
    }

    const tursoDb = createTursoClient(config.tursoDatabaseUrl, config.tursoAuthToken);
    if (isPrimary) {
      console.log(`[Database] Using Turso Database: ${maskDatabaseUrl(config.tursoDatabaseUrl)}`);
      const migrationsDir = path.join(config.packageRoot, 'migrations');
      try {
        await runTursoMigrations(tursoDb, migrationsDir);
      } catch (err: unknown) {
        console.warn(
          '[Database] Turso startup migration check failed; continuing in fail-open DNS mode:',
          err instanceof Error ? err.message : String(err)
        );
      }
    }
    env.DB = tursoDb;
  } else if (config.databaseService === 'D1') {
    console.error(formatDiagnostic({
      level: 'error',
      title: 'Database Configuration Error',
      message: "DATABASE_SERVICE='D1' is designed for Cloudflare Workers environments with D1 bindings.",
      solutions: [
        "In Serverfull mode, please set DATABASE_SERVICE='File' (default local SQLite) or DATABASE_SERVICE='Turso'.",
      ],
    }));
    process.exit(1);
  } else {
    // Default: 'File' (Local SQLite with WAL mode)
    const skipMigrations = !isPrimary;
    const db = initServerfullDb(config.dbPath, config.packageRoot, skipMigrations);
    localSqliteDb = db;
    env.DB = db;
    env.SERVERFULL_SNAPSHOT_BRIDGE = new ServerfullSnapshotManager(env);
  }

  // Load synced Cloudflare Proxy CIDRs from DB so CF-Connecting-IP passthrough verification uses latest ranges
  if (env.DB) {
    await initCloudflareIpRanges(env.DB);
  }

  return localSqliteDb;
}

/**
 * Safely checkpoints (when primary/single-process) and closes the local SQLite database handle.
 */
export function closeLocalSqliteSafely(
  localSqliteDb: SqliteMaintenanceHandle | null,
  shouldTruncate: boolean,
  logPrefix: string
): void {
  if (!localSqliteDb) return;
  try {
    if (shouldTruncate) {
      localSqliteDb.checkpoint?.('TRUNCATE');
    }
    localSqliteDb.rawDb.close();
    console.log(`${logPrefix} Database connection closed.`);
  } catch {}
}
