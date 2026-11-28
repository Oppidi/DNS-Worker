import React from "react";
import { HardDrive } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { DatabaseStorageStats } from "../../../../services";
import { formatBytes } from "../../../../utils/formatBytes";

export interface StorageUsageSectionProps {
  storage: DatabaseStorageStats;
}

/**
 * Formats a share of a disk/total capacity into a compact percentage label.
 */
function formatPercent(part: number, total: number): string {
  if (!Number.isFinite(total) || total <= 0 || part <= 0) return "0%";
  const pct = (part / total) * 100;
  if (pct < 0.01) return "<0.01%";
  if (pct < 1) return `${pct.toFixed(2)}%`;
  return `${pct.toFixed(1)}%`;
}

/**
 * Displays Serverfull File-mode disk distribution and database-vs-snapshot storage breakdown bars.
 */
export const StorageUsageSection: React.FC<StorageUsageSectionProps> = ({ storage }) => {
  const { t } = useTranslation();

  const diskTotal = storage.diskTotalBytes;
  const diskFree = storage.diskFreeBytes;
  const dbTotal = storage.dbTotalBytes;
  const snapTotal = storage.snapshotsTotalBytes;
  const sameFs = storage.sameFilesystem;
  const snapOnSameDisk = sameFs ? snapTotal : 0;
  const otherUsed = Math.max(0, storage.diskUsedBytes - dbTotal - snapOnSameDisk);

  const dbPct = diskTotal > 0 ? (dbTotal / diskTotal) * 100 : 0;
  const snapSamePct = diskTotal > 0 ? (snapOnSameDisk / diskTotal) * 100 : 0;
  const otherPct = diskTotal > 0 ? (otherUsed / diskTotal) * 100 : 0;

  const dataCombined = dbTotal + snapTotal;
  const dbMainRelPct = dataCombined > 0 ? (storage.dbMainBytes / dataCombined) * 100 : 0;
  const dbWalRelPct = dataCombined > 0 ? ((storage.dbWalBytes + storage.dbShmBytes) / dataCombined) * 100 : 0;
  const snapRelPct = dataCombined > 0 ? (snapTotal / dataCombined) * 100 : 0;

  return (
    <div className="pt-4 border-t border-gray-100 dark:border-gray-800 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <HardDrive size={16} className="text-blue-500 shrink-0" />
          <span className="text-sm font-semibold">
            {t("account.storageUsageTitle", "存储空间占用 (Serverfull)")}
          </span>
        </div>
        <div className="text-xs font-mono text-gray-500 dark:text-gray-400 truncate max-w-full" title={storage.dbPath}>
          {storage.dbPath}
        </div>
      </div>

      {diskTotal > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
            <span>{t("account.storageDiskBarLabel", "磁盘空间分布")}</span>
            <span className="font-mono">
              {t("account.storageUsedSummary", {
                used: formatBytes(storage.diskUsedBytes),
                total: formatBytes(diskTotal),
                defaultValue: `已用 ${formatBytes(storage.diskUsedBytes)} / ${formatBytes(diskTotal)}`,
              })}
            </span>
          </div>
          <div className="w-full h-3.5 rounded-full overflow-hidden bg-emerald-500/15 dark:bg-emerald-950/40 border border-gray-200 dark:border-gray-700 flex">
            {dbTotal > 0 && (
              <div
                className="h-full bg-blue-500 transition-all duration-300"
                style={{ width: `${dbPct}%`, minWidth: "4px" }}
                title={`${t("account.storageDbSize", "数据库占用")}: ${formatBytes(dbTotal)} (${formatPercent(dbTotal, diskTotal)})`}
              />
            )}
            {snapOnSameDisk > 0 && (
              <div
                className="h-full bg-violet-500 transition-all duration-300"
                style={{ width: `${snapSamePct}%`, minWidth: "4px" }}
                title={`${t("account.storageSnapshotsSize", "快照占用")}: ${formatBytes(snapOnSameDisk)} (${formatPercent(snapOnSameDisk, diskTotal)})`}
              />
            )}
            {otherUsed > 0 && (
              <div
                className="h-full bg-gray-400/70 dark:bg-gray-600 transition-all duration-300"
                style={{ width: `${otherPct}%`, minWidth: "2px" }}
                title={`${t("account.storageOtherUsed", "其他已用")}: ${formatBytes(otherUsed)} (${formatPercent(otherUsed, diskTotal)})`}
              />
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-gray-600 dark:text-gray-300">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-xs bg-blue-500 shrink-0" />
              <span>{t("account.storageDbSize", "数据库占用")}:</span>
              <span className="font-mono font-medium">{formatBytes(dbTotal)}</span>
              <span className="opacity-60">({formatPercent(dbTotal, diskTotal)})</span>
            </span>
            {sameFs && (
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs bg-violet-500 shrink-0" />
                <span>{t("account.storageSnapshotsSize", "快照占用")}:</span>
                <span className="font-mono font-medium">{formatBytes(snapTotal)}</span>
                <span className="opacity-60">({formatPercent(snapTotal, diskTotal)})</span>
              </span>
            )}
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-xs bg-gray-400/70 dark:bg-gray-600 shrink-0" />
              <span>{t("account.storageOtherUsed", "其他已用")}:</span>
              <span className="font-mono font-medium">{formatBytes(otherUsed)}</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-xs bg-emerald-500/40 border border-emerald-500/50 shrink-0" />
              <span>{t("account.storageDiskFree", "剩余可用")}:</span>
              <span className="font-mono font-medium">{formatBytes(diskFree)}</span>
              <span className="opacity-60">({formatPercent(diskFree, diskTotal)})</span>
            </span>
          </div>
        </div>
      )}

      {dataCombined > 0 && (
        <div className="space-y-2 pt-1">
          <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
            <span>{t("account.storageDbVsSnapshotsLabel", "数据库与快照空间对比")}</span>
            <span className="font-mono">{formatBytes(dataCombined)}</span>
          </div>
          <div className="w-full h-2.5 rounded-full overflow-hidden bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 flex">
            {storage.dbMainBytes > 0 && (
              <div
                className="h-full bg-blue-500 transition-all duration-300"
                style={{ width: `${dbMainRelPct}%`, minWidth: "3px" }}
                title={`${t("account.storageDbMain", "主库文件")}: ${formatBytes(storage.dbMainBytes)}`}
              />
            )}
            {(storage.dbWalBytes + storage.dbShmBytes) > 0 && (
              <div
                className="h-full bg-sky-400 transition-all duration-300"
                style={{ width: `${dbWalRelPct}%`, minWidth: "3px" }}
                title={`WAL / SHM: ${formatBytes(storage.dbWalBytes + storage.dbShmBytes)}`}
              />
            )}
            {snapTotal > 0 && (
              <div
                className="h-full bg-violet-500 transition-all duration-300"
                style={{ width: `${snapRelPct}%`, minWidth: "3px" }}
                title={`${t("account.storageSnapshotsSize", "快照占用")}: ${formatBytes(snapTotal)}`}
              />
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-xs bg-blue-500 shrink-0" />
              <span>{t("account.storageDbMain", "主库文件")}: {formatBytes(storage.dbMainBytes)}</span>
            </span>
            {(storage.dbWalBytes + storage.dbShmBytes) > 0 && (
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-xs bg-sky-400 shrink-0" />
                <span>WAL/SHM: {formatBytes(storage.dbWalBytes + storage.dbShmBytes)}</span>
              </span>
            )}
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-xs bg-violet-500 shrink-0" />
              <span>{t("account.storageSnapshotsSize", "快照占用")}: {formatBytes(snapTotal)}</span>
            </span>
          </div>
        </div>
      )}

      {!sameFs && storage.snapshotDiskTotalBytes !== undefined && storage.snapshotDiskTotalBytes > 0 && (
        <div className="text-xs text-gray-500 dark:text-gray-400 font-mono">
          {t("account.storageSeparateSnapshotDisk", {
            dir: storage.snapshotDir,
            free: formatBytes(storage.snapshotDiskFreeBytes ?? 0),
            total: formatBytes(storage.snapshotDiskTotalBytes),
            defaultValue: `快照卷 (${storage.snapshotDir}): 可用 ${formatBytes(storage.snapshotDiskFreeBytes ?? 0)} / 总计 ${formatBytes(storage.snapshotDiskTotalBytes)}`,
          })}
        </div>
      )}
    </div>
  );
};
