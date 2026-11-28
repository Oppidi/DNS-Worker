import React, { useState } from "react";
import { Button, Intent, PopoverNext } from "@blueprintjs/core";
import { Trash2 } from "lucide-react";
import type { TFunction } from "i18next";
import type { FilterList } from "../../types";
import { SyncProgressButton } from "../SyncProgressButton";

export interface ListDetailsFooterProps {
  selectedList: FilterList | null;
  onSyncSingle?: (id: number) => Promise<void>;
  syncingSingle: boolean;
  syncSingleProgress: number;
  onSync: () => Promise<void>;
  onDelete: (id: number) => void;
  onClose: () => void;
  t: TFunction;
}

/**
 * Dialog action footer providing deletion confirmation (for profile-owned lists),
 * manual single-list synchronization, and dialog dismissal.
 */
export const ListDetailsFooter: React.FC<ListDetailsFooterProps> = ({
  selectedList,
  onSyncSingle,
  syncingSingle,
  syncSingleProgress,
  onSync,
  onDelete,
  onClose,
  t,
}) => {
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  return (
    <div className="p-4 border-t border-gray-100 dark:border-gray-800 flex justify-between items-center">
      {selectedList?.scope === "profile" ? (
        <PopoverNext
          isOpen={deleteConfirmOpen}
          onInteraction={setDeleteConfirmOpen}
          placement="top-start"
          portalClassName="z-20000"
          content={
            <div className="p-3 space-y-3 max-w-xs">
              <p className="text-xs font-semibold leading-relaxed m-0 text-gray-800 dark:text-gray-200">
                {t(
                  "filtering.deleteConfirm",
                  "Are you sure you want to delete this list? This action cannot be undone."
                )}
              </p>
              <div className="flex justify-end gap-2">
                <Button
                  small
                  variant="minimal"
                  text={t("common.cancel", "Cancel")}
                  onClick={() => setDeleteConfirmOpen(false)}
                />
                <Button
                  small
                  intent={Intent.DANGER}
                  text={t("common.confirm", "Confirm")}
                  onClick={() => {
                    if (!selectedList) return;
                    const id = selectedList.id;
                    setDeleteConfirmOpen(false);
                    onDelete(id);
                  }}
                />
              </div>
            </div>
          }
        >
          <Button
            icon={<Trash2 size={14} />}
            intent={Intent.DANGER}
            text={t("rules.delete", "Delete")}
            onClick={() => setDeleteConfirmOpen(true)}
          />
        </PopoverNext>
      ) : (
        <span className="text-xs text-gray-400 italic">
          {t("filtering.cannotDeleteUserListDesc", "账号级与系统级列表不可在配置中删除")}
        </span>
      )}
      <div className="flex gap-2">
        {onSyncSingle && (
          <SyncProgressButton
            syncing={syncingSingle}
            progress={syncSingleProgress}
            intent={Intent.PRIMARY}
            iconSize={14}
            label={t("filtering.syncSingle", "同步此列表")}
            syncingLabel={t("filtering.syncing", "同步中...")}
            onClick={() => void onSync()}
          />
        )}
        <Button onClick={onClose} text={t("rules.close", "Close")} />
      </div>
    </div>
  );
};
