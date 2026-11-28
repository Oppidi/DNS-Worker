import React, { useState } from "react";
import { Dialog, Button, Intent, Callout, Switch, Tag } from "@blueprintjs/core";
import { Copy, ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatDateTime } from "../../../utils/date";
import type { FilterList } from "../types";
import { ListMetadataCard } from "./listDetails/ListMetadataCard";
import { ListDomainChecker } from "./listDetails/ListDomainChecker";
import { ListDetailsFooter } from "./listDetails/ListDetailsFooter";

export interface ListDetailsDialogProps {
  profileId: string;
  selectedList: FilterList | null;
  onClose: () => void;
  onCopy: (url: string) => void;
  onDelete: (id: number) => void;
  /** Enables or disables the list; the parent refetches and the filter is rebuilt. */
  onToggleEnabled: (id: number, enabled: boolean) => Promise<void>;
  /** Adds an ALLOW rule so this domain resolves even while the list blocks it. */
  onAllowDomain: (domain: string) => Promise<void>;
  /** Triggers manual sync for this single list */
  onSyncSingle?: (id: number) => Promise<void>;
  /** Whether this list is currently syncing */
  syncingSingle?: boolean;
  /** Progress percentage (0-100) for single list sync */
  syncSingleProgress?: number;
}

/**
 * Modal displaying filter list metadata, scope notices, enable toggle, interactive
 * domain test tool, and single-list sync/delete controls.
 */
export const ListDetailsDialog: React.FC<ListDetailsDialogProps> = ({
  profileId,
  selectedList,
  onClose,
  onCopy,
  onDelete,
  onToggleEnabled,
  onAllowDomain,
  onSyncSingle,
  syncingSingle: externalSyncingSingle = false,
  syncSingleProgress = 0,
}) => {
  const { t } = useTranslation();
  const [toggling, setToggling] = useState(false);
  const [localSyncingSingle, setLocalSyncingSingle] = useState(false);
  const [resetSignal, setResetSignal] = useState(0);
  const syncingSingle = externalSyncingSingle || localSyncingSingle;

  const handleClose = (): void => {
    setResetSignal((prev) => prev + 1);
    onClose();
  };

  const handleDelete = (id: number): void => {
    setResetSignal((prev) => prev + 1);
    onDelete(id);
  };

  const handleToggle = async (enabled: boolean): Promise<void> => {
    if (!selectedList) return;
    setToggling(true);
    try {
      await onToggleEnabled(selectedList.id, enabled);
    } finally {
      setToggling(false);
    }
  };

  const handleSync = async (): Promise<void> => {
    if (!selectedList || !onSyncSingle) return;
    setLocalSyncingSingle(true);
    try {
      await onSyncSingle(selectedList.id);
    } finally {
      setLocalSyncingSingle(false);
    }
  };

  return (
    <Dialog
      isOpen={selectedList !== null}
      onClose={handleClose}
      title={t("filtering.listDetails", "List Details")}
      icon="info-sign"
    >
      <div className="p-6 space-y-4">
        {selectedList?.sync_error && (
          <Callout intent={Intent.WARNING} title={t("filtering.syncError")} icon="warning-sign">
            {selectedList.sync_error}
          </Callout>
        )}

        <div className="bg-gray-50 dark:bg-gray-800 px-3.5 py-3 rounded-lg border border-gray-200 dark:border-gray-700 font-mono text-sm flex items-center justify-between gap-2">
          {selectedList?.url && /^https?:\/\//i.test(selectedList.url) ? (
            <a
              href={selectedList.url}
              target="_blank"
              rel="noopener noreferrer"
              title={t("setup.learnMore", "Open link")}
              className="inline-flex items-center gap-1.5 min-w-0 break-all text-blue-600 dark:text-blue-400 hover:underline"
            >
              <span>{selectedList.url}</span>
              <ExternalLink size={13} className="shrink-0 opacity-75" />
            </a>
          ) : (
            <span className="break-all min-w-0">{selectedList?.url}</span>
          )}
          <div className="flex items-center gap-1.5 shrink-0">
            {(selectedList?.scopes?.includes("user") || selectedList?.scope === "user") && (
              <Tag intent={Intent.SUCCESS} minimal className="font-sans">
                {t("filtering.tagUser", "账号")}
              </Tag>
            )}
            {(selectedList?.scopes?.includes("system") || selectedList?.scope === "system") && (
              <Tag intent={Intent.PRIMARY} minimal className="font-sans">
                {t("filtering.tagSystem", "系统")}
              </Tag>
            )}
            <Button
              minimal
              small
              icon={<Copy size={14} />}
              title={t("setup.copyUrl", "Copy link")}
              aria-label={t("setup.copyUrl", "Copy link")}
              onClick={() => {
                if (selectedList) onCopy(selectedList.url);
              }}
            />
          </div>
        </div>

        {(selectedList?.scopes?.includes("system") || selectedList?.scope === "system") && (
          <Callout intent={Intent.PRIMARY} icon="info-sign" className="text-xs">
            {t(
              "filtering.systemListNotice",
              "此列表由系统下发并应用于所有配置。可在当前配置中停用，但不可在配置中删除。"
            )}
          </Callout>
        )}

        {(selectedList?.scopes?.includes("user") || selectedList?.scope === "user") && (
          <Callout intent={Intent.SUCCESS} icon="info-sign" className="text-xs">
            {t(
              "filtering.userListNotice",
              "此列表为账号级规则并应用于所有配置。可在当前配置中停用；如需删除，请前往「账号」管理页面。"
            )}
          </Callout>
        )}

        <div className="flex items-center justify-between border border-gray-200 dark:border-gray-700 rounded-lg p-3">
          <div>
            <div className="text-sm font-bold">{t("filtering.listEnabled", "List active")}</div>
            <div className="text-xs opacity-60">
              {t(
                "filtering.listEnabledHint",
                "Disable to stop filtering with this list without deleting it. Its subscription and sync history are kept."
              )}
            </div>
          </div>
          <Switch
            large
            checked={!!selectedList?.enabled}
            disabled={toggling}
            onChange={(e) => handleToggle((e.target as HTMLInputElement).checked)}
          />
        </div>

        <ListMetadataCard selectedList={selectedList} t={t} />

        <ListDomainChecker
          profileId={profileId}
          selectedList={selectedList}
          resetSignal={resetSignal}
          onAllowDomain={onAllowDomain}
          t={t}
        />

        <div className="flex justify-between items-center gap-3">
          <span className="text-xs opacity-50 truncate min-w-0">
            {t("filtering.tableLastSync")}:{" "}
            {selectedList?.last_synced_at
              ? formatDateTime(new Date(selectedList.last_synced_at * 1000))
              : "-"}
          </span>
        </div>
      </div>

      <ListDetailsFooter
        selectedList={selectedList}
        onSyncSingle={onSyncSingle}
        syncingSingle={syncingSingle}
        syncSingleProgress={syncSingleProgress}
        onSync={handleSync}
        onDelete={handleDelete}
        onClose={handleClose}
        t={t}
      />
    </Dialog>
  );
};
