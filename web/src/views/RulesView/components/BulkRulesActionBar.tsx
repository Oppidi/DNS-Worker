import React from "react";
import { Alert, Button, Intent } from "@blueprintjs/core";
import { Trash2, Download, Ban, CheckCircle } from "lucide-react";
import type { TFunction } from "i18next";
import type { Rule } from "../types";

export interface BulkRulesActionBarProps {
  selectedCount: number;
  selectedRules: Rule[];
  hasActiveSelected: boolean;
  hasDisabledSelected: boolean;
  isDeletingBulk: boolean;
  isTogglingBulk: boolean;
  isBulkDeleteAlertOpen: boolean;
  onClearSelection: () => void;
  onBulkToggleEnabled: (enabled: boolean) => Promise<void>;
  onExportSelected: (rules: Rule[]) => void;
  onOpenDeleteAlert: () => void;
  onCloseDeleteAlert: () => void;
  onConfirmBulkDelete: () => Promise<void>;
  t: TFunction;
}

/**
 * Multi-select action bar and confirmation alert for bulk-enabling, disabling,
 * exporting, or deleting profile custom rules.
 */
export const BulkRulesActionBar: React.FC<BulkRulesActionBarProps> = ({
  selectedCount,
  selectedRules,
  hasActiveSelected,
  hasDisabledSelected,
  isDeletingBulk,
  isTogglingBulk,
  isBulkDeleteAlertOpen,
  onClearSelection,
  onBulkToggleEnabled,
  onExportSelected,
  onOpenDeleteAlert,
  onCloseDeleteAlert,
  onConfirmBulkDelete,
  t,
}) => (
  <>
    {selectedCount > 0 && (
      <div className="mb-3 px-4 py-2.5 rounded-lg border border-blue-200 dark:border-blue-800/70 bg-blue-50/70 dark:bg-blue-950/30 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-blue-700 dark:text-blue-300">
            {t("rules.selectedCount", {
              count: selectedCount,
              defaultValue: `已选择 ${selectedCount} 项`,
            })}
          </span>
          <Button
            size="small"
            variant="minimal"
            text={t("rules.clearSelection", "取消选择")}
            onClick={onClearSelection}
            disabled={isDeletingBulk || isTogglingBulk}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {hasDisabledSelected && (
            <Button
              type="button"
              size="small"
              variant="outlined"
              intent={Intent.SUCCESS}
              icon={<CheckCircle size={14} />}
              text={t("rules.enableSelected", {
                count: selectedCount,
                defaultValue: `启用 (${selectedCount})`,
              })}
              loading={isTogglingBulk}
              disabled={isDeletingBulk || isTogglingBulk}
              onClick={() => onBulkToggleEnabled(true)}
            />
          )}
          {hasActiveSelected && (
            <Button
              type="button"
              size="small"
              variant="outlined"
              intent={Intent.WARNING}
              icon={<Ban size={14} />}
              text={t("rules.disableSelected", {
                count: selectedCount,
                defaultValue: `停用 (${selectedCount})`,
              })}
              loading={isTogglingBulk}
              disabled={isDeletingBulk || isTogglingBulk}
              onClick={() => onBulkToggleEnabled(false)}
            />
          )}
          <Button
            type="button"
            size="small"
            variant="outlined"
            icon={<Download size={14} />}
            text={t("rules.exportSelected", {
              count: selectedCount,
              defaultValue: `导出 (${selectedCount})`,
            })}
            disabled={isDeletingBulk || isTogglingBulk}
            onClick={() => onExportSelected(selectedRules)}
          />
          <Button
            type="button"
            size="small"
            intent={Intent.DANGER}
            icon={<Trash2 size={14} />}
            text={t("rules.deleteSelected", {
              count: selectedCount,
              defaultValue: `删除 (${selectedCount})`,
            })}
            loading={isDeletingBulk}
            disabled={isTogglingBulk}
            onClick={onOpenDeleteAlert}
          />
        </div>
      </div>
    )}

    <Alert
      isOpen={isBulkDeleteAlertOpen}
      confirmButtonText={t("rules.delete", "删除")}
      cancelButtonText={t("rules.cancel", "取消")}
      intent={Intent.DANGER}
      icon="trash"
      loading={isDeletingBulk}
      onConfirm={onConfirmBulkDelete}
      onCancel={onCloseDeleteAlert}
    >
      <p>
        {t("rules.confirmDeleteBulk", {
          count: selectedCount,
          defaultValue: `确定要删除选中的 ${selectedCount} 条规则吗？`,
        })}
      </p>
    </Alert>
  </>
);
