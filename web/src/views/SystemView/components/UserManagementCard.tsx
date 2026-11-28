import React from "react";
import {
  Card,
  Elevation,
  H4,
  Button,
  Intent,
  HTMLTable,
  Tag,
  Switch,
  type OverlayToaster,
} from "@blueprintjs/core";
import { ShieldCheck, UserPlus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatDateTime } from "../../../utils/date";
import type { UserInfo, InviteCodeInfo } from "../../../services";
import { useUserManagementActions } from "./userManagement/useUserManagementActions";
import { InviteCodesSection, InviteCodeCreateDialog } from "./userManagement/InviteCodesSection";
import { CreateUserDialog } from "./userManagement/CreateUserDialog";

export interface UserManagementCardProps {
  users: UserInfo[];
  currentUserId: string;
  onRefresh: () => void;
  inviteCodes?: InviteCodeInfo[];
  onRefreshInviteCodes?: () => void;
  registrationEnabled?: boolean;
  inviteCodeEnabled?: boolean;
  maxUsers?: string | number;
  onRefreshSettings?: () => void;
  onSavingChange?: (saving: boolean) => void;
  toasterRef?: React.RefObject<OverlayToaster | null>;
}

/**
 * Administrator card for managing system user accounts, registration switches, and invite codes.
 */
export const UserManagementCard: React.FC<UserManagementCardProps> = ({
  users,
  currentUserId,
  onRefresh,
  inviteCodes = [],
  onRefreshInviteCodes,
  registrationEnabled = true,
  inviteCodeEnabled = false,
  maxUsers,
  onRefreshSettings,
  onSavingChange,
  toasterRef,
}) => {
  const { t } = useTranslation();
  const actions = useUserManagementActions({
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
  });

  return (
    <>
      <Card elevation={Elevation.ONE} className="space-y-4 overflow-hidden">
        <div className="pb-4 border-b border-gray-100 dark:border-gray-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <H4 className="flex items-center space-x-2 text-base font-semibold m-0" style={{ margin: 0 }}>
              <ShieldCheck className="w-5 h-5 text-red-500 shrink-0" />
              <span>{t("account.userManagement")}</span>
            </H4>
            {actions.maxUsersLimit > 0 ? (
              <Tag minimal intent={actions.isQuotaReached ? Intent.DANGER : Intent.PRIMARY} round>
                {users.length} / {actions.maxUsersLimit}
              </Tag>
            ) : (
              <Tag minimal round>{users.length}</Tag>
            )}
          </div>
          <div className="flex items-center gap-4 flex-wrap">
            <Switch
              label={t("account.enableRegistration", "开放新账号注册")}
              checked={actions.isRegistrationEnabled}
              disabled={actions.toggleLoading}
              onChange={(e) => actions.handleToggleRegistration(e.currentTarget.checked)}
              className="mb-0"
            />
            <Switch
              label={t("account.enableInviteCode", "启用邀请码注册")}
              checked={actions.isInviteCodeEnabled}
              disabled={actions.inviteToggleLoading}
              onChange={(e) => actions.handleToggleInviteCode(e.currentTarget.checked)}
              className="mb-0"
            />
            <Button
              className="whitespace-nowrap"
              icon={<UserPlus size={16} />}
              intent={Intent.SUCCESS}
              text={t("account.createUser")}
              disabled={actions.isQuotaReached}
              title={
                actions.isQuotaReached
                  ? t("auth.maxUsersReached", "当前系统已达到账号数量上限，无法创建新账号。")
                  : undefined
              }
              onClick={() => actions.setIsDialogOpen(true)}
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <HTMLTable interactive striped className="w-full whitespace-nowrap">
            <thead>
              <tr>
                <th className="whitespace-nowrap">{t("account.username")}</th>
                <th className="whitespace-nowrap">{t("account.role")}</th>
                <th className="whitespace-nowrap">MFA</th>
                <th className="whitespace-nowrap">ID</th>
                <th className="whitespace-nowrap">{t("account.inviteCode", "邀请码")}</th>
                <th className="whitespace-nowrap">{t("account.createdAt")}</th>
                <th className="whitespace-nowrap">{t("account.lastResolve")}</th>
                <th className="text-right whitespace-nowrap">{t("account.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td className="font-bold whitespace-nowrap">{u.username}</td>
                  <td className="whitespace-nowrap">
                    <Tag
                      minimal
                      intent={u.role === "admin" ? Intent.DANGER : Intent.NONE}
                      className="whitespace-nowrap"
                    >
                      {u.role === "admin" ? t("account.roleAdmin") : t("account.roleUser")}
                    </Tag>
                  </td>
                  <td className="whitespace-nowrap">
                    <div className="flex flex-wrap gap-1">
                      {Boolean(u.totp_enabled) && (
                        <Tag minimal intent={Intent.SUCCESS} className="whitespace-nowrap">
                          TOTP
                        </Tag>
                      )}
                      {Boolean(u.passkeys_count && u.passkeys_count > 0) && (
                        <Tag minimal intent={Intent.PRIMARY} className="whitespace-nowrap">
                          Passkey
                        </Tag>
                      )}
                      {!u.totp_enabled && !(u.passkeys_count && u.passkeys_count > 0) && (
                        <Tag
                          minimal
                          intent={Intent.NONE}
                          style={{ color: "#8a9ba8" }}
                          className="whitespace-nowrap"
                        >
                          {t("account.mfaNone", "无")}
                        </Tag>
                      )}
                    </div>
                  </td>
                  <td className="whitespace-nowrap">
                    <code className="text-xs">{u.id}</code>
                  </td>
                  <td className="whitespace-nowrap">
                    {u.invite_code ? (
                      <code className="text-xs font-mono">{u.invite_code}</code>
                    ) : (
                      <span className="text-xs text-gray-400">-</span>
                    )}
                  </td>
                  <td className="text-xs text-gray-500 whitespace-nowrap">
                    {u.created_at ? formatDateTime(new Date(u.created_at * 1000)) : "-"}
                  </td>
                  <td className="text-xs text-gray-500 whitespace-nowrap">
                    {u.last_resolve_at ? formatDateTime(new Date(u.last_resolve_at * 1000)) : "-"}
                  </td>
                  <td className="text-right whitespace-nowrap">
                    <div className="inline-flex items-center gap-1">
                      <Button
                        minimal
                        intent={Intent.DANGER}
                        icon={<Trash2 size={14} />}
                        disabled={u.id === currentUserId}
                        onClick={() => actions.handleDeleteUser(u.id)}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </HTMLTable>
        </div>

        <InviteCodesSection
          inviteCodes={inviteCodes}
          nowSec={actions.nowSec}
          copiedCode={actions.copiedCode}
          onCopyInviteCode={actions.handleCopyInviteCode}
          onDeleteInviteCode={actions.handleDeleteInviteCode}
          onOpenCreateDialog={() => actions.setIsInviteDialogOpen(true)}
          t={t}
        />
      </Card>

      <CreateUserDialog
        isOpen={actions.isDialogOpen}
        onClose={() => {
          actions.setIsDialogOpen(false);
          actions.setShowNewUserPassword(false);
        }}
        newUsername={actions.newUsername}
        onUsernameChange={actions.setNewUsername}
        newUserPassword={actions.newUserPassword}
        onPasswordChange={actions.setNewUserPassword}
        newUserRole={actions.newUserRole}
        onRoleChange={actions.setNewUserRole}
        showPassword={actions.showNewUserPassword}
        onToggleShowPassword={() =>
          actions.setShowNewUserPassword(!actions.showNewUserPassword)
        }
        createLoading={actions.createLoading}
        onSubmit={actions.handleCreateUser}
        t={t}
      />

      <InviteCodeCreateDialog
        isOpen={actions.isInviteDialogOpen}
        onClose={() => actions.setIsInviteDialogOpen(false)}
        inviteCodeInput={actions.inviteCodeInput}
        onInviteCodeInputChange={actions.setInviteCodeInput}
        inviteMaxUses={actions.inviteMaxUses}
        onInviteMaxUsesChange={actions.setInviteMaxUses}
        inviteExpiryPreset={actions.inviteExpiryPreset}
        onInviteExpiryPresetChange={actions.setInviteExpiryPreset}
        inviteCustomExpiry={actions.inviteCustomExpiry}
        onInviteCustomExpiryChange={actions.setInviteCustomExpiry}
        minCustomExpiryStr={actions.minCustomExpiryStr}
        createInviteLoading={actions.createInviteLoading}
        onSubmit={actions.handleCreateInviteCode}
        t={t}
      />
    </>
  );
};
