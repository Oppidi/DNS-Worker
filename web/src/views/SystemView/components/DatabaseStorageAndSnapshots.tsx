import React, { useMemo } from "react";
import { Button, Callout, Intent, Spinner, Tag, type OverlayToaster } from "@blueprintjs/core";
import { Archive, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { clsx } from "clsx";

import type { DatabaseSnapshotOverview } from "../../../services";
import { StorageUsageSection } from "./snapshots/StorageUsageSection";
import { SnapshotListTable } from "./snapshots/SnapshotListTable";
import { useSnapshotActions } from "./snapshots/useSnapshotActions";

export interface DatabaseStorageAndSnapshotsProps {
  overview: DatabaseSnapshotOverview;
  onOverviewUpdated: (next: DatabaseSnapshotOverview) => void;
  toasterRef?: React.RefObject<OverlayToaster | null>;
}

/**
 * Displays Serverfull File-mode storage breakdown bar charts and manages
 * abortable `.sqlite.zst` database snapshots (capture, download, single & bulk delete).
 */
export const DatabaseStorageAndSnapshots: React.FC<DatabaseStorageAndSnapshotsProps> = ({
  overview,
  onOverviewUpdated,
  toasterRef,
}) => {
  const { t } = useTranslation();
  const actions = useSnapshotActions({ overview, onOverviewUpdated, toasterRef });

  const activeCapture = overview.activeCapture;
  const isCapturing = Boolean(activeCapture);
  const capturePct = Math.max(0, Math.min(100, Math.round(activeCapture?.progress ?? 0)));

  const captureStageLabel = useMemo(() => {
    if (!activeCapture) return "";
    if (activeCapture.stage === "cancelling") {
      return t("account.snapshotStageCancelling", "正在停止并清理临时文件...");
    }
    if (activeCapture.stage === "compressing") {
      return t("account.snapshotStageCompressing", "正在进行 Zstd (.sqlite.zst) 压缩...");
    }
    return t("account.snapshotStageVacuum", "正在导出一致性数据库副本...");
  }, [activeCapture, t]);

  return (
    <>
      {overview.storage && <StorageUsageSection storage={overview.storage} />}

      <div className="pt-4 border-t border-gray-100 dark:border-gray-800 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <Archive size={16} className="text-violet-500 shrink-0" />
              <span className="text-sm font-semibold">
                {t("account.snapshotsTitle", "数据库快照 (.sqlite.zst)")}
              </span>
              <Tag minimal intent={Intent.NONE} className="font-mono text-xs">
                {overview.snapshots.length} / {overview.config.maxCount}
              </Tag>
              <Tag minimal intent={Intent.PRIMARY} className="text-xs">
                {overview.config.retentionDays > 0
                  ? t("account.snapshotRetentionDays", {
                      days: overview.config.retentionDays,
                      defaultValue: `有效期 ${overview.config.retentionDays} 天`,
                    })
                  : t("account.snapshotNeverExpires", "永不过期")}
              </Tag>
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400 font-mono break-all">
              {t("account.snapshotStorageDirLabel", "存储目录")}: {overview.config.snapshotDir}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {isCapturing ? (
              <Button
                intent={Intent.DANGER}
                icon={<X size={14} />}
                text={t("account.snapshotAbort", "放弃")}
                loading={actions.abortingCapture}
                disabled={actions.abortingCapture || activeCapture?.stage === "cancelling"}
                onClick={actions.handleAbortCapture}
              />
            ) : (
              <Button
                intent={Intent.PRIMARY}
                text={t("account.snapshotCapture", "撷取")}
                loading={actions.startingCapture}
                disabled={actions.startingCapture}
                onClick={actions.handleStartCapture}
              />
            )}
          </div>
        </div>

        {isCapturing && activeCapture && (
          <Callout
            intent={activeCapture.stage === "cancelling" ? Intent.WARNING : Intent.PRIMARY}
            icon={null}
            className="py-2.5 space-y-2"
          >
            <div className="flex items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2.5 min-w-0">
                <Spinner size={15} />
                <span className="truncate">{captureStageLabel}</span>
              </div>
              <span className="font-mono font-semibold tabular-nums shrink-0">{capturePct}%</span>
            </div>
            <div className="w-full h-1.5 rounded-full overflow-hidden bg-gray-200/80 dark:bg-gray-700/80">
              <div
                className={clsx(
                  "h-full rounded-full transition-all duration-300",
                  activeCapture.stage === "cancelling" ? "bg-amber-500" : "bg-blue-500"
                )}
                style={{ width: `${capturePct}%` }}
              />
            </div>
          </Callout>
        )}

        <SnapshotListTable
          snapshots={overview.snapshots}
          validSelected={actions.validSelected}
          selectedSet={actions.selectedSet}
          allSelected={actions.allSelected}
          partiallySelected={actions.partiallySelected}
          deleting={actions.deleting}
          downloadingFilename={actions.downloadingFilename}
          deleteTargetFilenames={actions.deleteTargetFilenames}
          onClearSelection={actions.clearSelection}
          onToggleSelectAll={actions.handleToggleSelectAll}
          onToggleSelectRow={actions.handleToggleSelectRow}
          onRequestDelete={actions.setDeleteTargetFilenames}
          onConfirmDelete={actions.handleConfirmDelete}
          onDownload={actions.handleDownloadSnapshot}
        />
      </div>
    </>
  );
};
