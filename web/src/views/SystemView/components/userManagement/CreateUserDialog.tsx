import React from "react";
import {
  Button,
  Intent,
  Dialog,
  FormGroup,
  InputGroup,
  HTMLSelect,
} from "@blueprintjs/core";
import type { TFunction } from "i18next";
import type { UserRole } from "./useUserManagementActions";

export interface CreateUserDialogProps {
  isOpen: boolean;
  onClose: () => void;
  newUsername: string;
  onUsernameChange: (val: string) => void;
  newUserPassword: string;
  onPasswordChange: (val: string) => void;
  newUserRole: UserRole;
  onRoleChange: (role: UserRole) => void;
  showPassword: boolean;
  onToggleShowPassword: () => void;
  createLoading: boolean;
  onSubmit: () => Promise<void>;
  t: TFunction;
}

/**
 * Modal dialog for administrators to create a new user account with username, password, and role.
 */
export const CreateUserDialog: React.FC<CreateUserDialogProps> = ({
  isOpen,
  onClose,
  newUsername,
  onUsernameChange,
  newUserPassword,
  onPasswordChange,
  newUserRole,
  onRoleChange,
  showPassword,
  onToggleShowPassword,
  createLoading,
  onSubmit,
  t,
}) => (
  <Dialog
    isOpen={isOpen}
    onClose={onClose}
    title={t("account.createNewUser")}
    icon="user"
  >
    <form
      className="p-6 space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!createLoading) {
          void onSubmit();
        }
      }}
    >
      <FormGroup label={t("account.username")}>
        <InputGroup
          value={newUsername}
          onChange={(e) => onUsernameChange(e.target.value)}
          placeholder={t("auth.usernamePlaceholder")}
          autoFocus
        />
      </FormGroup>
      <FormGroup label={t("account.initialPassword")}>
        <InputGroup
          type={showPassword ? "text" : "password"}
          value={newUserPassword}
          onChange={(e) => onPasswordChange(e.target.value)}
          placeholder={t("auth.passwordPlaceholder")}
          rightElement={
            <Button
              type="button"
              minimal={true}
              icon={showPassword ? "eye-open" : "eye-off"}
              onClick={onToggleShowPassword}
              title={
                showPassword
                  ? t("auth.hidePassword", "Hide password")
                  : t("auth.showPassword", "Show password")
              }
            />
          }
        />
      </FormGroup>
      <FormGroup label={t("account.userRole")}>
        <HTMLSelect
          fill
          value={newUserRole}
          onChange={(e) => onRoleChange(e.target.value as UserRole)}
          options={[
            { label: t("account.roleUser"), value: "user" },
            { label: t("account.roleAdmin"), value: "admin" },
          ]}
        />
      </FormGroup>
      <div className="flex justify-end gap-2 mt-6">
        <Button type="button" text={t("account.cancel")} onClick={onClose} />
        <Button
          type="submit"
          intent={Intent.PRIMARY}
          text={t("account.createNow")}
          loading={createLoading}
        />
      </div>
    </form>
  </Dialog>
);
