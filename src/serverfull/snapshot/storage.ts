/**
 * @file storage.ts
 * @description Filesystem inspection, retention pruning, lock reading, and byte-range stream serving for snapshots.
 */

import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { DatabaseSnapshotItem, DatabaseStorageStats } from '../../types';
import {
  LOCK_FILENAME,
  ORPHAN_TMP_AGE_MS,
  ResolvedSnapshotConfig,
  SNAPSHOT_FILE_REGEX,
  SnapshotLockState,
  getFileSizeSafe,
  isProcessAlive,
  parseSnapshotTimestamp,
} from './config';

/**
 * Ensures the configured snapshot directory exists on disk.
 */
export function ensureSnapshotDir(snapshotDir: string): void {
  if (!fs.existsSync(snapshotDir)) {
    fs.mkdirSync(snapshotDir, { recursive: true });
  }
}

/**
 * Resolves the lockfile path inside the snapshot directory.
 */
export function getSnapshotLockPath(snapshotDir: string): string {
  return path.join(snapshotDir, LOCK_FILENAME);
}

/**
 * Removes orphaned `.tmp-*` snapshot staging artifacts for a given capture ID or stale age threshold.
 */
export function cleanupTempSnapshotArtifacts(snapshotDir: string, captureId?: string): void {
  try {
    const entries = fs.readdirSync(snapshotDir);
    const nowMs = Date.now();
    for (const entry of entries) {
      if (!entry.startsWith('.tmp-')) continue;
      const full = path.join(snapshotDir, entry);
      if (captureId && entry.startsWith(`.tmp-${captureId}`)) {
        fs.rmSync(full, { force: true });
        continue;
      }
      try {
        const stat = fs.statSync(full);
        if (nowMs - stat.mtimeMs > ORPHAN_TMP_AGE_MS) {
          fs.rmSync(full, { force: true });
        }
      } catch {}
    }
  } catch {}
}

/**
 * Reads active snapshot capture lockfile, cleaning up stale state if the owning subprocess crashed.
 */
export function readActiveSnapshotLock(snapshotDir: string): SnapshotLockState | null {
  const lockPath = getSnapshotLockPath(snapshotDir);
  if (!fs.existsSync(lockPath)) return null;

  try {
    const parsed = JSON.parse(fs.readFileSync(lockPath, 'utf-8')) as SnapshotLockState;
    if (!parsed || typeof parsed.id !== 'string' || typeof parsed.pid !== 'number') {
      fs.rmSync(lockPath, { force: true });
      return null;
    }
    if (!isProcessAlive(parsed.pid)) {
      cleanupTempSnapshotArtifacts(snapshotDir, parsed.id);
      fs.rmSync(lockPath, { force: true });
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Lists completed `.sqlite.zst` snapshots, evicts expired entries and excess oldest entries beyond `maxCount`.
 */
export function pruneAndListSnapshotFiles(cfg: ResolvedSnapshotConfig): DatabaseSnapshotItem[] {
  ensureSnapshotDir(cfg.snapshotDir);

  if (!readActiveSnapshotLock(cfg.snapshotDir)) {
    cleanupTempSnapshotArtifacts(cfg.snapshotDir);
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const retentionSec = cfg.retentionDays > 0 ? cfg.retentionDays * 86400 : 0;

  let entries: string[] = [];
  try {
    entries = fs.readdirSync(cfg.snapshotDir);
  } catch {
    return [];
  }

  const items: DatabaseSnapshotItem[] = [];
  for (const entry of entries) {
    if (!SNAPSHOT_FILE_REGEX.test(entry)) continue;
    const fullPath = path.join(cfg.snapshotDir, entry);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(fullPath);
      if (!stat.isFile()) continue;
    } catch {
      continue;
    }

    const fallbackCreated = Math.floor(stat.mtimeMs / 1000);
    const createdAt = parseSnapshotTimestamp(entry, fallbackCreated);
    const expiresAt = retentionSec > 0 ? createdAt + retentionSec : 0;

    if (expiresAt > 0 && nowSec >= expiresAt) {
      try { fs.rmSync(fullPath, { force: true }); } catch {}
      continue;
    }

    items.push({
      filename: entry,
      sizeBytes: stat.size,
      createdAt,
      expiresAt,
    });
  }

  items.sort((a, b) => (b.createdAt !== a.createdAt ? b.createdAt - a.createdAt : b.filename.localeCompare(a.filename)));

  if (items.length > cfg.maxCount) {
    const excess = items.splice(cfg.maxCount);
    for (const old of excess) {
      try { fs.rmSync(path.join(cfg.snapshotDir, old.filename), { force: true }); } catch {}
    }
  }

  return items;
}

/**
 * Computes disk capacity/free space for the SQLite database path and snapshot directory.
 */
export function computeSnapshotStorageStats(
  cfg: ResolvedSnapshotConfig,
  snapshots?: DatabaseSnapshotItem[]
): DatabaseStorageStats {
  ensureSnapshotDir(cfg.snapshotDir);

  const dbMainBytes = getFileSizeSafe(cfg.dbPath);
  const dbWalBytes = getFileSizeSafe(`${cfg.dbPath}-wal`);
  const dbShmBytes = getFileSizeSafe(`${cfg.dbPath}-shm`);
  const dbTotalBytes = dbMainBytes + dbWalBytes + dbShmBytes;

  const currentSnapshots = snapshots ?? pruneAndListSnapshotFiles(cfg);
  const snapshotsTotalBytes = currentSnapshots.reduce((sum, item) => sum + item.sizeBytes, 0);

  let diskTotalBytes = 0;
  let diskFreeBytes = 0;
  const dbStatTarget = fs.existsSync(cfg.dbDir) ? cfg.dbDir : path.dirname(cfg.dbDir);
  try {
    const statFs = fs.statfsSync(dbStatTarget);
    diskTotalBytes = Number(statFs.blocks) * Number(statFs.bsize);
    diskFreeBytes = Number(statFs.bavail) * Number(statFs.bsize);
  } catch {
    diskTotalBytes = 0;
    diskFreeBytes = 0;
  }
  const diskUsedBytes = Math.max(0, diskTotalBytes - diskFreeBytes);

  let sameFilesystem: boolean;
  let snapshotDiskTotalBytes: number | undefined;
  let snapshotDiskFreeBytes: number | undefined;

  try {
    const dbDev = fs.statSync(dbStatTarget).dev;
    const snapDev = fs.statSync(cfg.snapshotDir).dev;
    sameFilesystem = dbDev === snapDev;
    if (!sameFilesystem) {
      const snapStatFs = fs.statfsSync(cfg.snapshotDir);
      snapshotDiskTotalBytes = Number(snapStatFs.blocks) * Number(snapStatFs.bsize);
      snapshotDiskFreeBytes = Number(snapStatFs.bavail) * Number(snapStatFs.bsize);
    }
  } catch {
    sameFilesystem = cfg.dbDir === cfg.snapshotDir;
  }

  return {
    dbPath: cfg.dbPath,
    snapshotDir: cfg.snapshotDir,
    sameFilesystem,
    diskTotalBytes,
    diskFreeBytes,
    diskUsedBytes,
    dbMainBytes,
    dbWalBytes,
    dbShmBytes,
    dbTotalBytes,
    snapshotsTotalBytes,
    snapshotDiskTotalBytes,
    snapshotDiskFreeBytes,
  };
}

/**
 * Deletes validated snapshot files inside the resolved snapshot directory.
 */
export function deleteSnapshotFiles(cfg: ResolvedSnapshotConfig, filenames: string[]): { deletedCount: number } {
  ensureSnapshotDir(cfg.snapshotDir);
  const resolvedDir = path.resolve(cfg.snapshotDir);

  let deletedCount = 0;
  for (const rawName of new Set(filenames)) {
    if (!SNAPSHOT_FILE_REGEX.test(rawName)) continue;
    const targetPath = path.resolve(resolvedDir, rawName);
    if (!targetPath.startsWith(resolvedDir + path.sep)) continue;
    if (fs.existsSync(targetPath)) {
      fs.rmSync(targetPath, { force: true });
      deletedCount++;
    }
  }

  return { deletedCount };
}

/**
 * Opens a stream for downloading a validated `.sqlite.zst` snapshot with HTTP Range (`206` / `416`) support.
 */
export function openSnapshotDownloadStream(
  cfg: ResolvedSnapshotConfig,
  filename: string,
  rangeHeader?: string | null
): {
  stream: ReadableStream<Uint8Array> | null;
  status: 200 | 206 | 416;
  sizeBytes: number;
  contentLength: number;
  contentRange?: string;
  etag: string;
  filename: string;
} | null {
  if (!SNAPSHOT_FILE_REGEX.test(filename)) {
    return null;
  }

  const resolvedDir = path.resolve(cfg.snapshotDir);
  const targetPath = path.resolve(resolvedDir, filename);
  if (!targetPath.startsWith(resolvedDir + path.sep)) {
    return null;
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(targetPath);
    if (!stat.isFile()) return null;
  } catch {
    return null;
  }

  const sizeBytes = stat.size;
  const etag = `"${sizeBytes}-${Math.floor(stat.mtimeMs)}"`;

  if (rangeHeader && rangeHeader.trim().toLowerCase().startsWith('bytes=')) {
    const rangeSpec = rangeHeader.trim().slice(6).split(',')[0]?.trim() || '';
    const match = /^(\d*)-(\d*)$/.exec(rangeSpec);
    if (!match || (match[1] === '' && match[2] === '') || sizeBytes === 0) {
      return { stream: null, status: 416, sizeBytes, contentLength: 0, contentRange: `bytes */${sizeBytes}`, etag, filename };
    }

    let start: number;
    let end: number;
    if (match[1] === '') {
      const suffixLen = Number(match[2]);
      if (!Number.isFinite(suffixLen) || suffixLen <= 0) {
        return { stream: null, status: 416, sizeBytes, contentLength: 0, contentRange: `bytes */${sizeBytes}`, etag, filename };
      }
      start = Math.max(0, sizeBytes - suffixLen);
      end = sizeBytes - 1;
    } else {
      start = Number(match[1]);
      end = match[2] === '' ? sizeBytes - 1 : Math.min(sizeBytes - 1, Number(match[2]));
    }

    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start >= sizeBytes || end < start) {
      return { stream: null, status: 416, sizeBytes, contentLength: 0, contentRange: `bytes */${sizeBytes}`, etag, filename };
    }

    const nodeStream = fs.createReadStream(targetPath, { start, end });
    return {
      stream: Readable.toWeb(nodeStream) as unknown as ReadableStream<Uint8Array>,
      status: 206,
      sizeBytes,
      contentLength: end - start + 1,
      contentRange: `bytes ${start}-${end}/${sizeBytes}`,
      etag,
      filename,
    };
  }

  const nodeStream = fs.createReadStream(targetPath);
  return {
    stream: Readable.toWeb(nodeStream) as unknown as ReadableStream<Uint8Array>,
    status: 200,
    sizeBytes,
    contentLength: sizeBytes,
    etag,
    filename,
  };
}
