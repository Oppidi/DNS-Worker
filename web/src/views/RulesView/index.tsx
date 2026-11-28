import React from "react";
import { Callout, Intent, Button, Spinner } from "@blueprintjs/core";
import { Download } from "lucide-react";
import { useTranslation } from "react-i18next";
import { clsx } from "clsx";

import type { RulesViewProps } from "./types";
import { AddRuleCard } from "./components/AddRuleCard";
import { RulesTable } from "./components/RulesTable";
import { EditRuleDialog } from "./components/EditRuleDialog";
import { SelfRedirectPopover } from "./components/SelfRedirectPopover";
import { BulkRulesActionBar } from "./components/BulkRulesActionBar";
import { useRulesManager } from "./hooks/useRulesManager";
import { useIsMobile } from "../../hooks/useIsMobile";
import { PAGE_CONTAINER_STANDARD } from "../../constants/layout";
import { useStickyHeaderTitle } from "../../layouts/HeaderTitleContext";

/**
 * Displays and manages custom DNS rules for a specific profile, including creation,
 * editing, bulk actions, and AdGuard list export.
 */
export const RulesView: React.FC<RulesViewProps> = ({
  profileId,
  prefill,
  onPrefillUsed,
  toasterRef,
}) => {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const headerTitleRef = useStickyHeaderTitle<HTMLDivElement>(t("rules.title"));
  const manager = useRulesManager({
    profileId,
    prefill,
    onPrefillUsed,
    toasterRef,
    t,
  });

  return (
    <div className={clsx("md:px-8 w-full min-w-0 mx-auto", PAGE_CONTAINER_STANDARD, isMobile ? "p-1" : "px-8")}>
      <div className="mb-8">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div className="w-full md:w-auto flex-1">
            <div ref={headerTitleRef} className="flex items-center gap-3">
              <h1 className="bp6-heading m-0">{t("rules.title")}</h1>
              {manager.loading && <Spinner size={20} />}
            </div>
            <p className="bp6-text-muted mt-2!">{t("rules.subtitle")}</p>
          </div>

          <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
            {!manager.loading && !manager.hasSelfRedirect && (
              <SelfRedirectPopover
                isOpen={manager.isPromptOpen}
                onInteraction={manager.setIsPromptOpen}
                onApply={manager.handleApplySelfRedirect}
                t={t}
              />
            )}
            <Button
              type="button"
              size="large"
              icon={<Download size={18} />}
              text={t("rules.exportList", "导出列表")}
              className="ml-auto md:ml-0"
              disabled={manager.loading || manager.rules.length === 0}
              onClick={() => manager.handleExportAdGuardList(manager.rules)}
            />
          </div>
        </div>
      </div>

      <Callout intent={Intent.PRIMARY} icon="info-sign" className="mb-6">
        <p>
          {t(
            "rules.wildcardDisclaimer",
            "若要匹配子域名，需使用通配符 *.example.com ，example.com 不会匹配子域名。"
          )}
        </p>
      </Callout>

      <AddRuleCard
        newRule={manager.newRule}
        setNewRule={manager.setNewRule}
        addRule={manager.addRule}
        loading={manager.isAdding}
      />

      {manager.loading && manager.rules.length === 0 ? (
        <div className="p-16 flex flex-col justify-center items-center gap-3">
          <Spinner size={32} />
          <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">
            {t("common.loading", "加载中...")}
          </span>
        </div>
      ) : manager.rules.length === 0 ? (
        <Callout title={t("rules.noRulesTitle")}>{t("rules.noRulesDesc")}</Callout>
      ) : (
        <div className="relative">
          <BulkRulesActionBar
            selectedCount={manager.selectedRuleIds.length}
            selectedRules={manager.selectedRules}
            hasActiveSelected={manager.hasActiveSelected}
            hasDisabledSelected={manager.hasDisabledSelected}
            isDeletingBulk={manager.isDeletingBulk}
            isTogglingBulk={manager.isTogglingBulk}
            isBulkDeleteAlertOpen={manager.isBulkDeleteAlertOpen}
            onClearSelection={() => manager.setSelectedRuleIds([])}
            onBulkToggleEnabled={manager.handleBulkToggleEnabled}
            onExportSelected={manager.handleExportAdGuardList}
            onOpenDeleteAlert={() => manager.setIsBulkDeleteAlertOpen(true)}
            onCloseDeleteAlert={() => {
              if (!manager.isDeletingBulk) manager.setIsBulkDeleteAlertOpen(false);
            }}
            onConfirmBulkDelete={manager.handleConfirmBulkDelete}
            t={t}
          />
          <RulesTable
            rules={manager.rules}
            startEdit={manager.startEdit}
            getBlockDetail={manager.getBlockDetail}
            selectedIds={manager.selectedRuleIds}
            onToggleSelect={manager.handleToggleSelectRule}
            onToggleSelectAll={manager.handleToggleSelectAll}
          />
        </div>
      )}

      <EditRuleDialog
        editRule={manager.editRule}
        setEditRule={manager.setEditRule}
        saveEditRule={manager.saveEditRule}
        cancelEdit={manager.cancelEdit}
        deleteRule={manager.deleteRule}
        isSaving={manager.isSaving}
        isDeleting={manager.isDeleting}
      />
    </div>
  );
};
