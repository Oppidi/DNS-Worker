/**
 * @file snapshots.ts
 * @description Synthetic Serverfull storage and `.sqlite.zst` snapshot overview generator for Demo Mode.
 */

import type { DatabaseSnapshotItem, DatabaseSnapshotOverview, Env } from "../../types";

function formatDemoUtcStamp(unixSec: number): string {
  const d = new Date(unixSec * 1000);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

/**
 * Builds deterministic, non-sensitive Serverfull storage and `.sqlite.zst` snapshot showcase data
 * for Demo Mode so visitors can inspect the storage bar charts and snapshot table safely.
 */
export function buildDemoSnapshotOverview(env?: Partial<Env>): DatabaseSnapshotOverview {
  const nowSec = Math.floor(Date.now() / 1000);
  const rawRetention = env?.SERVERFULL_SNAPSHOT_RETENTION_DAYS;
  const parsedRetention = Number(rawRetention);
  const retentionDays =
    rawRetention !== undefined && rawRetention !== null && String(rawRetention).trim() !== "" && Number.isFinite(parsedRetention) && parsedRetention >= 0
      ? Math.floor(parsedRetention)
      : 7;

  const rawMaxCount = env?.SERVERFULL_SNAPSHOT_MAX_COUNT;
  const parsedMax = Number(rawMaxCount);
  const maxCount =
    rawMaxCount !== undefined && rawMaxCount !== null && String(rawMaxCount).trim() !== "" && Number.isFinite(parsedMax) && parsedMax >= 1
      ? Math.floor(parsedMax)
      : 3;

  const retentionSec = retentionDays > 0 ? retentionDays * 86400 : 0;
  const ts1 = nowSec - 6 * 3600;
  const ts2 = nowSec - 2 * 86400;

  const snapshots: DatabaseSnapshotItem[] = [
    {
      filename: `dns-worker-snapshot-${formatDemoUtcStamp(ts1)}-a4f9c2.sqlite.zst`,
      sizeBytes: 14_892_416,
      createdAt: ts1,
      expiresAt: retentionSec > 0 ? ts1 + retentionSec : 0,
    },
    {
      filename: `dns-worker-snapshot-${formatDemoUtcStamp(ts2)}-8b13e7.sqlite.zst`,
      sizeBytes: 14_417_920,
      createdAt: ts2,
      expiresAt: retentionSec > 0 ? ts2 + retentionSec : 0,
    },
  ].slice(0, maxCount);

  const snapshotsTotalBytes = snapshots.reduce((sum, item) => sum + item.sizeBytes, 0);
  const dbMainBytes = 50_331_648;
  const dbWalBytes = 4_718_592;
  const dbShmBytes = 32_768;
  const dbTotalBytes = dbMainBytes + dbWalBytes + dbShmBytes;
  const diskTotalBytes = 68_719_476_736;
  const diskFreeBytes = 44_238_163_968;
  const diskUsedBytes = diskTotalBytes - diskFreeBytes;

  return {
    supported: true,
    storage: {
      dbPath: "/var/lib/dns-worker/dns_worker.sqlite",
      snapshotDir: "/var/lib/dns-worker",
      sameFilesystem: true,
      diskTotalBytes,
      diskFreeBytes,
      diskUsedBytes,
      dbMainBytes,
      dbWalBytes,
      dbShmBytes,
      dbTotalBytes,
      snapshotsTotalBytes,
    },
    snapshots,
    activeCapture: null,
    config: {
      retentionDays,
      maxCount,
      snapshotDir: "/var/lib/dns-worker",
    },
  };
}
