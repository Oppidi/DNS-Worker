import { useState, useEffect, useCallback } from "react";
import { Intent, type OverlayToaster } from "@blueprintjs/core";
import type { TFunction } from "i18next";
import {
  PASSWORD_REGEX,
  USERNAME_REGEX,
  INVITE_CODE_REGEX,
  checkPasswordBreached,
  hashPasswordClient,
  formatApiErrorMessage,
} from "../../../../utils/auth";
import type { UserInfo, InviteCodeInfo } from "../../../../services";
import {
  createUser,
  deleteUser,
  createInviteCode,
  deleteInviteCode,
  updateSystemSettings,
} from "../../../../services";
import { executeWithTimeout } from "../../../../utils/async";

export type InviteExpiryPreset = "never" | "1d" | "7d" | "30d" | "custom";
export type UserRole = "admin" | "user";

export interface UseUserManagementActionsParams {
  users: UserInfo[];
  inviteCodes: InviteCodeInfo[];
  registrationEnabled: boolean;
  inviteCodeEnabled: boolean;
  maxUsers?: string | number;
  onRefresh: () => void;
  onRefreshInviteCodes?: () => void;
  onRefreshSettings?: () => void;
  onSavingChange?: (saving: boolean) => void;
  toasterRef?: React.RefObject<OverlayToaster | null>;
  t: TFunction;
}

export interface UseUserManagementActionsResult {
  isDialogOpen: boolean;
  setIsDialogOpen: (open: boolean) => void;
  newUsername: string;
  setNewUsername: (val: string) => void;
  newUserPassword: string;
  setNewUserPassword: (val: string) => void;
  newUserRole: UserRole;
  setNewUserRole: (role: UserRole) => void;
  createLoading: boolean;
  showNewUserPassword: boolean;
  setShowNewUserPassword: (show: boolean) => void;
  isRegistrationEnabled: boolean;
  isInviteCodeEnabled: boolean;
  toggleLoading: boolean;
  inviteToggleLoading: boolean;
  isInviteDialogOpen: boolean;
  setIsInviteDialogOpen: (open: boolean) => void;
  inviteCodeInput: string;
  setInviteCodeInput: (val: string) => void;
  inviteMaxUses: string;
  setInviteMaxUses: (val: string) => void;
  inviteExpiryPreset: InviteExpiryPreset;
  setInviteExpiryPreset: (preset: InviteExpiryPreset) => void;
  inviteCustomExpiry: string;
  setInviteCustomExpiry: (val: string) => void;
  createInviteLoading: boolean;
  copiedCode: string | null;
  nowSec: number;
  maxUsersLimit: number;
  isQuotaReached: boolean;
  minCustomExpiryStr: string;
  handleToggleRegistration: (checked: boolean) => Promise<void>;
  handleToggleInviteCode: (checked: boolean) => Promise<void>;
  handleCreateUser: () => Promise<void>;
  handleDeleteUser: (id: string) => Promise<void>;
  handleCreateInviteCode: () => Promise<void>;
  handleDeleteInviteCode: (code: string) => Promise<void>;
  handleCopyInviteCode: (code: string) => void;
}

/**
 * Resolves an expiration preset into a nullable Unix timestamp (seconds).
 * Returns `undefined` when a custom date string is missing or invalid.
 */
function resolveInviteExpiresAt(
  preset: InviteExpiryPreset,
  customExpiry: string,
  currentSec: number
): number | null | undefined {
  if (preset === "1d") return currentSec + 86400;
  if (preset === "7d") return currentSec + 7 * 86400;
  if (preset === "30d") return currentSec + 30 * 86400;
  if (preset === "custom") {
    const parsedMs = new Date(customExpiry).getTime();
    if (!customExpiry || Number.isNaN(parsedMs) || Math.floor(parsedMs / 1000) <= currentSec) {
      return undefined;
    }
    return Math.floor(parsedMs / 1000);
  }
  return null;
}

/**
 * Manages state and API mutations for user accounts, registration toggles, and invite codes.
 */
export function useUserManagementActions({
  users,
  inviteCodes,
  registrationEnabled,
  inviteCodeEnabled,
  maxUsers,
  onRefresh,
  onRefreshInviteCodes,
  onRefreshSettings,
  onSavingChange,
  toasterRef,
  t,
}: UseUserManagementActionsParams): UseUserManagementActionsResult {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserRole, setNewUserRole] = useState<UserRole>("user");
  const [createLoading, setCreateLoading] = useState(false);
  const [showNewUserPassword, setShowNewUserPassword] = useState(false);

  const [isRegistrationEnabled, setIsRegistrationEnabled] = useState(registrationEnabled);
  const [isInviteCodeEnabled, setIsInviteCodeEnabled] = useState(inviteCodeEnabled);
  const [toggleLoading, setToggleLoading] = useState(false);
  const [inviteToggleLoading, setInviteToggleLoading] = useState(false);

  // Invite code creation modal & clipboard state
  const [isInviteDialogOpen, setIsInviteDialogOpen] = useState(false);
  const [inviteCodeInput, setInviteCodeInput] = useState("");
  const [inviteMaxUses, setInviteMaxUses] = useState("1");
  const [inviteExpiryPreset, setInviteExpiryPreset] = useState<InviteExpiryPreset>("never");
  const [inviteCustomExpiry, setInviteCustomExpiry] = useState("");
  const [createInviteLoading, setCreateInviteLoading] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));

  const maxUsersLimit =
    maxUsers !== undefined && maxUsers !== null && maxUsers !== ""
      ? parseInt(String(maxUsers), 10)
      : 0;
  const isQuotaReached = maxUsersLimit > 0 && users.length >= maxUsersLimit;

  useEffect(() => {
    setIsRegistrationEnabled(registrationEnabled);
  }, [registrationEnabled]);

  useEffect(() => {
    setIsInviteCodeEnabled(inviteCodeEnabled);
  }, [inviteCodeEnabled]);

  useEffect(() => {
    setNowSec(Math.floor(Date.now() / 1000));
  }, [inviteCodes]);

  const toggleBooleanSetting = useCallback(
    async (
      settingKey: "registration_enabled" | "invite_code_enabled",
      checked: boolean,
      previousState: boolean,
      setValue: (val: boolean) => void,
      setLoading: (val: boolean) => void
    ): Promise<void> => {
      setValue(checked);
      setLoading(true);
      onSavingChange?.(true);
      try {
        await executeWithTimeout(
          updateSystemSettings({ [settingKey]: String(checked) }),
          10000
        );
        toasterRef?.current?.show({
          message: t("common.saveSuccess", "保存成功"),
          intent: Intent.SUCCESS,
          icon: "tick",
        });
        onRefreshSettings?.();
      } catch (err: unknown) {
        console.error(err);
        setValue(previousState);
        const msg = err instanceof Error ? err.message : undefined;
        toasterRef?.current?.show({
          message: msg || t("common.saveFailed", "保存失败"),
          intent: Intent.DANGER,
          icon: "error",
        });
      } finally {
        setLoading(false);
        onSavingChange?.(false);
      }
    },
    [onRefreshSettings, onSavingChange, t, toasterRef]
  );

  const handleToggleRegistration = useCallback(
    (checked: boolean) =>
      toggleBooleanSetting(
        "registration_enabled",
        checked,
        isRegistrationEnabled,
        setIsRegistrationEnabled,
        setToggleLoading
      ),
    [isRegistrationEnabled, toggleBooleanSetting]
  );

  const handleToggleInviteCode = useCallback(
    (checked: boolean) =>
      toggleBooleanSetting(
        "invite_code_enabled",
        checked,
        isInviteCodeEnabled,
        setIsInviteCodeEnabled,
        setInviteToggleLoading
      ),
    [isInviteCodeEnabled, toggleBooleanSetting]
  );

  const handleCreateUser = useCallback(async (): Promise<void> => {
    const trimmedUsername = newUsername.trim();
    if (!USERNAME_REGEX.test(trimmedUsername)) {
      alert(t("account.formatTipUsername"));
      return;
    }
    if (!PASSWORD_REGEX.test(newUserPassword)) {
      alert(t("account.formatTipPassword"));
      return;
    }
    setCreateLoading(true);
    try {
      const breachCheck = await checkPasswordBreached(newUserPassword, trimmedUsername);
      if (breachCheck.breached) {
        alert(
          t(
            "auth.passwordLeaked",
            "This password has been exposed in a data breach or is too predictable. Please choose a different password."
          )
        );
        setCreateLoading(false);
        return;
      }
      const clientHash = await hashPasswordClient(newUserPassword, trimmedUsername);
      await createUser({ username: trimmedUsername, password: clientHash, role: newUserRole });
      setIsDialogOpen(false);
      setNewUsername("");
      setNewUserPassword("");
      setShowNewUserPassword(false);
      onRefresh();
    } catch (err: unknown) {
      console.error(err);
      alert(formatApiErrorMessage(err, t));
    } finally {
      setCreateLoading(false);
    }
  }, [newUserPassword, newUserRole, newUsername, onRefresh, t]);

  const handleDeleteUser = useCallback(
    async (id: string): Promise<void> => {
      if (!confirm(t("account.confirmDeleteUser"))) return;
      try {
        await deleteUser(id);
        onRefresh();
      } catch (err: unknown) {
        console.error(err);
      }
    },
    [onRefresh, t]
  );

  const handleCreateInviteCode = useCallback(async (): Promise<void> => {
    const normalizedCode = inviteCodeInput.trim().toUpperCase();
    if (normalizedCode && !INVITE_CODE_REGEX.test(normalizedCode)) {
      alert(t("account.inviteCodeFormatError", "邀请码必须为 6 位大写英文字母或数字。"));
      return;
    }

    const maxUsesNum = parseInt(inviteMaxUses, 10);
    if (!Number.isFinite(maxUsesNum) || maxUsesNum < 1) {
      alert(t("account.inviteMaxUsesError", "总次数必须为大于等于 1 的整数。"));
      return;
    }

    const currentSec = Math.floor(Date.now() / 1000);
    const expiresAt = resolveInviteExpiresAt(inviteExpiryPreset, inviteCustomExpiry, currentSec);
    if (expiresAt === undefined) {
      alert(t("account.inviteExpiryError", "请选择晚于当前时间的有效过期时间。"));
      return;
    }

    setCreateInviteLoading(true);
    try {
      await createInviteCode({
        ...(normalizedCode ? { code: normalizedCode } : {}),
        max_uses: maxUsesNum,
        expires_at: expiresAt,
      });
      setIsInviteDialogOpen(false);
      setInviteCodeInput("");
      setInviteMaxUses("1");
      setInviteExpiryPreset("never");
      setInviteCustomExpiry("");
      onRefreshInviteCodes?.();
      toasterRef?.current?.show({
        message: t("account.inviteCodeCreated", "邀请码已创建"),
        intent: Intent.SUCCESS,
        icon: "tick",
      });
    } catch (err: unknown) {
      console.error(err);
      alert(formatApiErrorMessage(err, t));
    } finally {
      setCreateInviteLoading(false);
    }
  }, [
    inviteCodeInput,
    inviteCustomExpiry,
    inviteExpiryPreset,
    inviteMaxUses,
    onRefreshInviteCodes,
    t,
    toasterRef,
  ]);

  const handleDeleteInviteCode = useCallback(
    async (code: string): Promise<void> => {
      if (
        !confirm(
          t("account.confirmDeleteInviteCode", {
            code,
            defaultValue: `确定要删除邀请码 ${code} 吗？`,
          })
        )
      ) {
        return;
      }
      try {
        await deleteInviteCode(code);
        onRefreshInviteCodes?.();
      } catch (err: unknown) {
        console.error(err);
      }
    },
    [onRefreshInviteCodes, t]
  );

  const handleCopyInviteCode = useCallback((code: string): void => {
    navigator.clipboard.writeText(code).then(() => {
      setCopiedCode(code);
      setTimeout(() => setCopiedCode((prev) => (prev === code ? null : prev)), 2000);
    });
  }, []);

  const minCustomExpiryStr = new Date(Date.now() + 60000)
    .toLocaleString("sv-SE")
    .replace(" ", "T")
    .slice(0, 16);

  return {
    isDialogOpen,
    setIsDialogOpen,
    newUsername,
    setNewUsername,
    newUserPassword,
    setNewUserPassword,
    newUserRole,
    setNewUserRole,
    createLoading,
    showNewUserPassword,
    setShowNewUserPassword,
    isRegistrationEnabled,
    isInviteCodeEnabled,
    toggleLoading,
    inviteToggleLoading,
    isInviteDialogOpen,
    setIsInviteDialogOpen,
    inviteCodeInput,
    setInviteCodeInput,
    inviteMaxUses,
    setInviteMaxUses,
    inviteExpiryPreset,
    setInviteExpiryPreset,
    inviteCustomExpiry,
    setInviteCustomExpiry,
    createInviteLoading,
    copiedCode,
    nowSec,
    maxUsersLimit,
    isQuotaReached,
    minCustomExpiryStr,
    handleToggleRegistration,
    handleToggleInviteCode,
    handleCreateUser,
    handleDeleteUser,
    handleCreateInviteCode,
    handleDeleteInviteCode,
    handleCopyInviteCode,
  };
}
