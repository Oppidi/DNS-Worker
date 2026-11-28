import { useState, useEffect, useMemo, useCallback } from "react";
import { Intent, type OverlayToaster } from "@blueprintjs/core";
import type { TFunction } from "i18next";
import type { Rule, ProfileSettings, RulesViewProps } from "../types";
import { downloadAdGuardRulesList } from "../utils/adguardExport";
import {
  getProfileRules,
  getProfileDetails,
  addProfileRule,
  updateProfileRule,
  deleteProfileRule,
  deleteProfileRulesBulk,
  toggleProfileRulesBulk,
  getClientInfo,
} from "../../../services";

export interface NewRuleDraft {
  type: Rule["type"];
  pattern: string;
  include_subdomains?: boolean;
  v_a: string;
  v_aaaa: string;
  v_txt: string;
  v_cname: string;
}

const INITIAL_NEW_RULE: NewRuleDraft = {
  type: "BLOCK",
  pattern: "",
  include_subdomains: false,
  v_a: "",
  v_aaaa: "",
  v_txt: "",
  v_cname: "",
};

export interface UseRulesManagerParams {
  profileId: string;
  prefill?: RulesViewProps["prefill"];
  onPrefillUsed?: () => void;
  toasterRef?: React.RefObject<OverlayToaster | null>;
  t: TFunction;
}

export interface UseRulesManagerResult {
  rules: Rule[];
  settings: ProfileSettings | null;
  loading: boolean;
  isAdding: boolean;
  isSaving: boolean;
  isDeleting: boolean;
  newRule: NewRuleDraft;
  setNewRule: React.Dispatch<React.SetStateAction<NewRuleDraft>>;
  editRule: Rule | null;
  setEditRule: React.Dispatch<React.SetStateAction<Rule | null>>;
  selectedRuleIds: number[];
  setSelectedRuleIds: React.Dispatch<React.SetStateAction<number[]>>;
  selectedRules: Rule[];
  hasActiveSelected: boolean;
  hasDisabledSelected: boolean;
  isBulkDeleteAlertOpen: boolean;
  setIsBulkDeleteAlertOpen: (open: boolean) => void;
  isDeletingBulk: boolean;
  isTogglingBulk: boolean;
  hasSelfRedirect: boolean;
  isPromptOpen: boolean;
  setIsPromptOpen: (open: boolean) => void;
  handleApplySelfRedirect: () => void;
  getBlockDetail: () => string;
  addRule: () => Promise<void>;
  saveEditRule: () => Promise<void>;
  cancelEdit: () => void;
  startEdit: (rule: Rule) => void;
  deleteRule: (id: number) => Promise<void>;
  handleToggleSelectRule: (id: number) => void;
  handleToggleSelectAll: (checked: boolean) => void;
  handleBulkToggleEnabled: (enabled: boolean) => Promise<void>;
  handleConfirmBulkDelete: () => Promise<void>;
  handleExportAdGuardList: (targetRules: Rule[]) => void;
}

/**
 * Manages rule CRUD, bulk actions, AdGuard list export, prefill handling,
 * and self-redirect helper state for a profile's RulesView.
 */
export function useRulesManager({
  profileId,
  prefill,
  onPrefillUsed,
  toasterRef,
  t,
}: UseRulesManagerParams): UseRulesManagerResult {
  const [rules, setRules] = useState<Rule[]>([]);
  const [settings, setSettings] = useState<ProfileSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [newRule, setNewRule] = useState<NewRuleDraft>(INITIAL_NEW_RULE);

  const [editRule, setEditRule] = useState<Rule | null>(null);
  const [selectedRuleIds, setSelectedRuleIds] = useState<number[]>([]);
  const [isBulkDeleteAlertOpen, setIsBulkDeleteAlertOpen] = useState(false);
  const [isDeletingBulk, setIsDeletingBulk] = useState(false);
  const [isTogglingBulk, setIsTogglingBulk] = useState(false);
  const [substituteDomain, setSubstituteDomain] = useState<string>("www.wto.org");
  const [isPromptOpen, setIsPromptOpen] = useState(false);

  useEffect(() => {
    getClientInfo()
      .then((info) => {
        if (info.substituteDomain) {
          setSubstituteDomain(info.substituteDomain);
        }
      })
      .catch((e) => console.warn("Failed to fetch clientInfo for substituteDomain:", e));
  }, []);

  const hasSelfRedirect = useMemo(() => {
    const currentHost = window.location.hostname.trim().toLowerCase();
    if (!currentHost) return false;
    return rules.some((r) => {
      if (r.type !== "REDIRECT") return false;
      const pattern = r.pattern.trim().toLowerCase();
      return pattern === currentHost || pattern === `*.${currentHost}`;
    });
  }, [rules]);

  const handleApplySelfRedirect = useCallback((): void => {
    setIsPromptOpen(false);
    setNewRule({
      type: "REDIRECT",
      pattern: window.location.hostname,
      include_subdomains: false,
      v_a: "",
      v_aaaa: "",
      v_txt: "",
      v_cname: substituteDomain || "www.wto.org",
    });
    setTimeout(() => {
      document.getElementById("rule-pattern")?.focus();
    }, 100);
  }, [substituteDomain]);

  useEffect(() => {
    if (prefill) {
      setNewRule({
        type: prefill.type,
        pattern: prefill.domain,
        include_subdomains: false,
        v_a: prefill.recordType === "A" ? "0.0.0.0" : "",
        v_aaaa: prefill.recordType === "AAAA" ? "::" : "",
        v_txt: prefill.recordType === "TXT" ? "Pre-filled" : "",
        v_cname: prefill.recordType === "CNAME" ? "target.com" : "",
      });
      onPrefillUsed?.();
    }
  }, [prefill, onPrefillUsed]);

  const fetchRules = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const [rulesData, profileData] = await Promise.all([
        getProfileRules(profileId),
        getProfileDetails(profileId),
      ]);

      setRules(rulesData);
      const validIds = new Set(rulesData.map((r) => r.id));
      setSelectedRuleIds((prev) => prev.filter((id) => validIds.has(id)));
      setSettings(JSON.parse(profileData.settings || "{}"));
    } catch (e) {
      console.error("Failed to fetch data", e);
    } finally {
      setLoading(false);
    }
  }, [profileId]);

  useEffect(() => {
    setSelectedRuleIds([]);
    void fetchRules();
  }, [fetchRules]);

  const getBlockDetail = useCallback((): string => {
    if (!settings) return t("rules.detailBlock");
    const mode = settings.block_mode || "NULL_IP";
    switch (mode) {
      case "NXDOMAIN":
        return "NXDOMAIN";
      case "NODATA":
        return "NODATA";
      case "CUSTOM_IP":
        return `${settings.custom_block_ipv4 || "0.0.0.0"} / ${settings.custom_block_ipv6 || "::"}`;
      default:
        return "0.0.0.0 / ::";
    }
  }, [settings, t]);

  /**
   * Validates and normalizes a domain pattern against existing rules, reporting toast errors on failure.
   */
  const validateRulePattern = useCallback(
    (pattern: string, excludeRuleId?: number): string | null => {
      const trimmedPattern = pattern.trim();
      if (!trimmedPattern) {
        toasterRef?.current?.show({
          message: t("rules.patternEmpty", "Domain pattern cannot be empty"),
          intent: Intent.DANGER,
        });
        return null;
      }
      const normalizedPattern = trimmedPattern.toLowerCase();
      const duplicate = rules.some(
        (r) => r.id !== excludeRuleId && r.pattern.trim().toLowerCase() === normalizedPattern
      );
      if (duplicate) {
        toasterRef?.current?.show({
          message: t("rules.duplicatePattern", "Rule for this domain already exists"),
          intent: Intent.DANGER,
        });
        return null;
      }
      return trimmedPattern;
    },
    [rules, t, toasterRef]
  );

  const addRule = useCallback(async (): Promise<void> => {
    const trimmedPattern = validateRulePattern(newRule.pattern);
    if (!trimmedPattern) return;

    setIsAdding(true);
    try {
      await addProfileRule(profileId, {
        ...newRule,
        pattern: trimmedPattern,
        include_subdomains: 0,
      });
      toasterRef?.current?.show({
        message: t("rules.addSuccess", "Rule added successfully"),
        intent: Intent.SUCCESS,
      });
      setNewRule(INITIAL_NEW_RULE);
      await fetchRules();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : undefined;
      toasterRef?.current?.show({
        message: message || t("rules.addFailed", "Failed to add rule"),
        intent: Intent.DANGER,
      });
    } finally {
      setIsAdding(false);
    }
  }, [fetchRules, newRule, profileId, t, toasterRef, validateRulePattern]);

  const saveEditRule = useCallback(async (): Promise<void> => {
    if (!editRule) return;
    const trimmedPattern = validateRulePattern(editRule.pattern, editRule.id);
    if (!trimmedPattern) return;

    setIsSaving(true);
    try {
      await updateProfileRule(profileId, {
        ...editRule,
        pattern: trimmedPattern,
        include_subdomains: 0,
        enabled: editRule.enabled !== 0 && editRule.enabled !== false,
      } as Rule);
      toasterRef?.current?.show({
        message: t("rules.updateSuccess", "Rule updated successfully"),
        intent: Intent.SUCCESS,
      });
      setEditRule(null);
      await fetchRules();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : undefined;
      toasterRef?.current?.show({
        message: message || t("rules.updateFailed", "Failed to update rule"),
        intent: Intent.DANGER,
      });
    } finally {
      setIsSaving(false);
    }
  }, [editRule, fetchRules, profileId, t, toasterRef, validateRulePattern]);

  const cancelEdit = useCallback((): void => {
    setEditRule(null);
  }, []);

  const startEdit = useCallback((rule: Rule): void => {
    setEditRule({
      ...rule,
      include_subdomains: rule.include_subdomains === 1 || rule.include_subdomains === true,
      enabled: rule.enabled !== 0 && rule.enabled !== false,
    });
  }, []);

  const deleteRule = useCallback(
    async (id: number): Promise<void> => {
      setIsDeleting(true);
      try {
        await deleteProfileRule(profileId, id);
      } catch (e) {
        console.error(e);
      } finally {
        setIsDeleting(false);
      }
      setEditRule(null);
      await fetchRules();
    },
    [fetchRules, profileId]
  );

  const handleToggleSelectRule = useCallback((id: number): void => {
    setSelectedRuleIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  }, []);

  const handleToggleSelectAll = useCallback(
    (checked: boolean): void => {
      setSelectedRuleIds(checked ? rules.map((r) => r.id) : []);
    },
    [rules]
  );

  const selectedRules = useMemo(() => {
    const selectedSet = new Set(selectedRuleIds);
    return rules.filter((r) => selectedSet.has(r.id));
  }, [rules, selectedRuleIds]);

  const hasActiveSelected = useMemo(
    () => selectedRules.some((r) => r.enabled !== 0 && r.enabled !== false),
    [selectedRules]
  );

  const hasDisabledSelected = useMemo(
    () => selectedRules.some((r) => r.enabled === 0 || r.enabled === false),
    [selectedRules]
  );

  const handleBulkToggleEnabled = useCallback(
    async (enabled: boolean): Promise<void> => {
      if (selectedRuleIds.length === 0) return;
      setIsTogglingBulk(true);
      try {
        const targetCount = selectedRuleIds.length;
        const res = await toggleProfileRulesBulk(profileId, selectedRuleIds, enabled);
        const updatedCount = typeof res?.count === "number" ? res.count : targetCount;
        setSelectedRuleIds([]);
        toasterRef?.current?.show({
          message: enabled
            ? t("rules.enableBulkSuccess", {
                count: updatedCount,
                defaultValue: `已启用 ${updatedCount} 条规则`,
              })
            : t("rules.disableBulkSuccess", {
                count: updatedCount,
                defaultValue: `已停用 ${updatedCount} 条规则`,
              }),
          intent: Intent.SUCCESS,
        });
        await fetchRules();
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "";
        toasterRef?.current?.show({
          message: message || t("rules.toggleBulkFailed", "批量更新规则状态失败"),
          intent: Intent.DANGER,
        });
      } finally {
        setIsTogglingBulk(false);
      }
    },
    [fetchRules, profileId, selectedRuleIds, t, toasterRef]
  );

  const handleConfirmBulkDelete = useCallback(async (): Promise<void> => {
    if (selectedRuleIds.length === 0) return;
    setIsDeletingBulk(true);
    try {
      const targetCount = selectedRuleIds.length;
      const res = await deleteProfileRulesBulk(profileId, selectedRuleIds);
      const deletedCount = typeof res?.count === "number" ? res.count : targetCount;
      setSelectedRuleIds([]);
      setIsBulkDeleteAlertOpen(false);
      toasterRef?.current?.show({
        message: t("rules.deleteBulkSuccess", {
          count: deletedCount,
          defaultValue: `已删除 ${deletedCount} 条规则`,
        }),
        intent: Intent.SUCCESS,
      });
      await fetchRules();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "";
      toasterRef?.current?.show({
        message: message || t("rules.deleteBulkFailed", "批量删除规则失败"),
        intent: Intent.DANGER,
      });
    } finally {
      setIsDeletingBulk(false);
    }
  }, [fetchRules, profileId, selectedRuleIds, t, toasterRef]);

  const handleExportAdGuardList = useCallback(
    (targetRules: Rule[]): void => {
      const safeProfileLabel = profileId
        .trim()
        .replace(/[^a-zA-Z0-9_-]+/g, "-")
        .replace(/^-+|-+$/g, "");
      const filename = `dns-worker-rules-${safeProfileLabel || "profile"}.txt`;
      const exportedCount = downloadAdGuardRulesList(targetRules, filename, profileId);
      if (exportedCount === 0) {
        toasterRef?.current?.show({
          message: t("rules.exportEmpty", "没有可导出的规则"),
          intent: Intent.WARNING,
        });
        return;
      }
      toasterRef?.current?.show({
        message: t("rules.exportSuccess", {
          count: exportedCount,
          defaultValue: `已导出 ${exportedCount} 条 AdGuard Home 兼容规则`,
        }),
        intent: Intent.SUCCESS,
      });
    },
    [profileId, t, toasterRef]
  );

  return {
    rules,
    settings,
    loading,
    isAdding,
    isSaving,
    isDeleting,
    newRule,
    setNewRule,
    editRule,
    setEditRule,
    selectedRuleIds,
    setSelectedRuleIds,
    selectedRules,
    hasActiveSelected,
    hasDisabledSelected,
    isBulkDeleteAlertOpen,
    setIsBulkDeleteAlertOpen,
    isDeletingBulk,
    isTogglingBulk,
    hasSelfRedirect,
    isPromptOpen,
    setIsPromptOpen,
    handleApplySelfRedirect,
    getBlockDetail,
    addRule,
    saveEditRule,
    cancelEdit,
    startEdit,
    deleteRule,
    handleToggleSelectRule,
    handleToggleSelectAll,
    handleBulkToggleEnabled,
    handleConfirmBulkDelete,
    handleExportAdGuardList,
  };
}
