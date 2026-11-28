import React from "react";
import { Alert, Button, Checkbox, HTMLTable, Intent } from "@blueprintjs/core";
import { Download, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { clsx } from "clsx";

import type { DatabaseSnapshotItem } from "../../../../services";
import { formatBytes } from "../../../../utils/formatBytes";
import { formatDateTime } from "../../../../utils/date";

export interface SnapshotListTableProps {
  snapshots: DatabaseSnapshotItem[];
  validSelected: string[];
  selectedSet: Set<string>;
  allSelected: boolean;
  partiallySelected: boolean;
  deleting: boolean;
  downloadingFilename: string | null;
  deleteTargetFilenames: string[] | null;
  onClearSelection: () => void;
  onToggleSelectAll: (checked: boolean) => void;
  onToggleSelectRow: (filename: string) => void;
  onRequestDelete: (filenames: string[] | null) => void;
  onConfirmDelete: () => Promise<void>;
  onDownload: (filename: string) => Promise<void>;
}

/**
 * Renders the completed snapshots table, bulk selection bar, and delete confirmation dialog.
 */
export const SnapshotListTable: React.FC<SnapshotListTableProps> = ({
  snapshots,
  validSelected,
  selectedSet,
  allSelected,
  partiallySelected,
  deleting,
  downloadingFilename,
  deleteTargetFilenames,
  onClearSelection,
  onToggleSelectAll,
  onToggleSelectRow,
  onRequestDelete,
  onConfirmDelete,
  onDownload,
}) => {
  const { t } = useTranslation();

  return (
    <>
      {validSelected.length > 0 && (
        <div className="px-3.5 py-2 rounded-lg border border-blue-200 dark:border-blue-800/70 bg-blue-50/70 dark:bg-blue-950/30 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-blue-700 dark:text-blue-300">
              {t("account.snapshotSelectedCount", {
                count: validSelected.length,
                defaultValue: `已选择 ${validSelected.length} 项`,
              })}
            </span>
            <Button
              size="small"
              variant="minimal"
              text={t("account.snapshotClearSelection", "取消选择")}
              onClick={onClearSelection}
              disabled={deleting}
            />
          </div>
          <Button
            size="small"
            intent={Intent.DANGER}
            icon={<Trash2 size={13} />}
            text={t("account.snapshotDeleteSelected", {
              count: validSelected.length,
              defaultValue: `删除 (${validSelected.length})`,
            })}
            loading={deleting}
            onClick={() => onRequestDelete(validSelected)}
          />
        </div>
      )}

      {snapshots.length === 0 ? (
        <div className="text-xs text-gray-500 dark:text-gray-400 border border-dashed border-gray-200 dark:border-gray-700 rounded-lg py-6 text-center select-none">
          {t("account.snapshotEmpty", "暂无已完成快照。点击右上角“撷取”可生成紧凑的 .sqlite.zst 数据库备份。")}
        </div>
      ) : (
        <div className="w-full max-w-full overflow-x-auto">
          <HTMLTable striped className="w-full min-w-max whitespace-nowrap">
            <thead>
              <tr>
                <th className="w-10 align-middle">
                  <div className="flex items-center justify-center">
                    <Checkbox
                      checked={allSelected}
                      indeterminate={partiallySelected}
                      aria-label={t("account.snapshotSelectAll", "全选快照")}
                      className="mb-0!"
                      onChange={(e) => onToggleSelectAll(e.currentTarget.checked)}
                    />
                  </div>
                </th>
                <th>{t("account.snapshotColFilename", "快照文件")}</th>
                <th className="w-28">{t("account.snapshotColSize", "大小")}</th>
                <th className="w-44">{t("account.snapshotColCreatedAt", "创建时间")}</th>
                <th className="w-44">{t("account.snapshotColExpiresAt", "有效期至")}</th>
                <th className="w-28 text-right">{t("account.snapshotColActions", "操作")}</th>
              </tr>
            </thead>
            <tbody>
              {snapshots.map((snap) => {
                const isSelected = selectedSet.has(snap.filename);
                return (
                  <tr key={snap.filename} className={clsx(isSelected && "bg-blue-50/70! dark:bg-blue-950/35!")}>
                    <td className="w-10 align-middle">
                      <div className="flex items-center justify-center">
                        <Checkbox
                          checked={isSelected}
                          aria-label={`${t("account.snapshotSelectRow", "选择快照")} ${snap.filename}`}
                          className="mb-0!"
                          onChange={() => onToggleSelectRow(snap.filename)}
                        />
                      </div>
                    </td>
                    <td className="font-mono text-xs align-middle">{snap.filename}</td>
                    <td className="font-mono text-xs align-middle">{formatBytes(snap.sizeBytes)}</td>
                    <td className="text-xs text-gray-500 dark:text-gray-400 align-middle">
                      {formatDateTime(new Date(snap.createdAt * 1000))}
                    </td>
                    <td className="text-xs text-gray-500 dark:text-gray-400 align-middle">
                      {snap.expiresAt > 0
                        ? formatDateTime(new Date(snap.expiresAt * 1000))
                        : t("account.snapshotNeverExpires", "永不过期")}
                    </td>
                    <td className="align-middle text-right">
                      <div className="inline-flex items-center justify-end gap-1">
                        <Button
                          minimal
                          small
                          icon={<Download size={14} />}
                          loading={downloadingFilename === snap.filename}
                          disabled={Boolean(downloadingFilename && downloadingFilename !== snap.filename)}
                          title={t("account.snapshotDownload", "下载快照")}
                          aria-label={t("account.snapshotDownload", "下载快照")}
                          onClick={() => onDownload(snap.filename)}
                        />
                        <Button
                          minimal
                          small
                          intent={Intent.DANGER}
                          icon={<Trash2 size={14} />}
                          title={t("account.snapshotDeleteOne", "删除快照")}
                          aria-label={t("account.snapshotDeleteOne", "删除快照")}
                          onClick={() => onRequestDelete([snap.filename])}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </HTMLTable>
        </div>
      )}

      <Alert
        isOpen={Boolean(deleteTargetFilenames && deleteTargetFilenames.length > 0)}
        cancelButtonText={t("rules.cancel", "取消")}
        confirmButtonText={t("rules.delete", "删除")}
        icon="trash"
        intent={Intent.DANGER}
        loading={deleting}
        onCancel={() => {
          if (!deleting) onRequestDelete(null);
        }}
        onConfirm={onConfirmDelete}
      >
        <p>
          {deleteTargetFilenames && deleteTargetFilenames.length > 1
            ? t("account.snapshotDeleteBulkConfirm", {
                count: deleteTargetFilenames.length,
                defaultValue: `确定要永久删除选中的 ${deleteTargetFilenames.length} 个数据库快照吗？此操作不可撤销。`,
              })
            : t("account.snapshotDeleteSingleConfirm", {
                filename: deleteTargetFilenames?.[0] || "",
                defaultValue: `确定要永久删除数据库快照 "${deleteTargetFilenames?.[0] || ""}" 吗？此操作不可撤销。`,
              })}
        </p>
      </Alert>
    </>
  );
};
