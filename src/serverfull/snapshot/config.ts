/**
 * @file config.ts
 * @description Shared constants, configuration resolution, lock schema, and atomic/process helpers for Serverfull snapshots.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { Env } from '../../types';
import { getDefaultDbPath } from '../paths';

export const SNAPSHOT_FILE_REGEX =
  /^dns-worker-snapshot-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z-([a-f0-9]{6})\.sqlite\.zst$/;

export const LOCK_FILENAME = '.snapshot-active.json';

export const ORPHAN_TMP_AGE_MS = 10 * 60 * 1000;

export interface SnapshotLockState {
  id: string;
  pid: number;
  workerPid?: number;
  startedAt: number;
  stage: 'vacuumming' | 'compressing' | 'cancelling';
  progress: number;
  cancelRequested: boolean;
}

export interface ResolvedSnapshotConfig {
  dbPath: string;
  dbDir: string;
  snapshotDir: string;
  retentionDays: number;
  maxCount: number;
}

/**
 * Writes JSON data atomically via a temporary file rename so concurrent lock readers never see torn writes.
 */
export function writeJsonAtomic(filePath: string, data: unknown): void {
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data), 'utf-8');
  fs.renameSync(tmpPath, filePath);
}

/**
 * Resolves snapshot directory, retention window (default 7 days), and max retained count (default 3)
 * from Serverfull environment configuration.
 */
export function resolveSnapshotConfig(env: Partial<Env>): ResolvedSnapshotConfig {
  const rawDbPath = (env.SERVERFULL_DB_PATH || process.env.SERVERFULL_DB_PATH || process.env.DB_PATH || getDefaultDbPath()).trim();
  const dbPath = path.resolve(rawDbPath);
  const dbDir = path.dirname(dbPath);

  const rawSnapshotDir = (env.SERVERFULL_SNAPSHOT_DIR ?? process.env.SERVERFULL_SNAPSHOT_DIR ?? '').toString().trim();
  const snapshotDir = rawSnapshotDir ? path.resolve(rawSnapshotDir) : dbDir;

  const rawRetention = env.SERVERFULL_SNAPSHOT_RETENTION_DAYS ?? process.env.SERVERFULL_SNAPSHOT_RETENTION_DAYS;
  let retentionDays = 7;
  if (rawRetention !== undefined && rawRetention !== null && String(rawRetention).trim() !== '') {
    const parsed = Number(rawRetention);
    if (Number.isFinite(parsed) && parsed >= 0) {
      retentionDays = Math.floor(parsed);
    }
  }

  const rawMaxCount = env.SERVERFULL_SNAPSHOT_MAX_COUNT ?? process.env.SERVERFULL_SNAPSHOT_MAX_COUNT;
  let maxCount = 3;
  if (rawMaxCount !== undefined && rawMaxCount !== null && String(rawMaxCount).trim() !== '') {
    const parsed = Number(rawMaxCount);
    if (Number.isFinite(parsed) && parsed >= 1) {
      maxCount = Math.floor(parsed);
    }
  }

  return {
    dbPath,
    dbDir,
    snapshotDir,
    retentionDays,
    maxCount,
  };
}

/**
 * Reads a file's byte length safely without throwing on missing entries.
 */
export function getFileSizeSafe(filePath: string): number {
  try {
    const stat = fs.statSync(filePath);
    return stat.isFile() ? stat.size : 0;
  } catch {
    return 0;
  }
}

/**
 * Checks whether an OS process with the given positive integer PID is currently alive.
 */
export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    return code === 'EPERM';
  }
}

/**
 * Extracts Unix seconds timestamp from a canonical snapshot filename, falling back on mismatch.
 */
export function parseSnapshotTimestamp(filename: string, fallbackSec: number): number {
  const match = SNAPSHOT_FILE_REGEX.exec(filename);
  if (!match) return fallbackSec;
  const [, yr, mo, dy, hr, mi, sc] = match;
  const utcMs = Date.UTC(
    Number(yr),
    Number(mo) - 1,
    Number(dy),
    Number(hr),
    Number(mi),
    Number(sc)
  );
  return Number.isFinite(utcMs) ? Math.floor(utcMs / 1000) : fallbackSec;
}

/**
 * Formats a Unix seconds timestamp as compact UTC ISO string (`YYYYMMDDTHHMMSSZ`) for snapshot filenames.
 */
export function formatSnapshotTimestampUtc(unixSec: number): string {
  const d = new Date(unixSec * 1000);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}
