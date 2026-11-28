import React from "react";
import {
  H5,
  Button,
  Intent,
  HTMLTable,
  Dialog,
  FormGroup,
  InputGroup,
  HTMLSelect,
  Tag,
} from "@blueprintjs/core";
import { Trash2, KeyRound, Plus, Copy, Check } from "lucide-react";
import type { TFunction } from "i18next";
import { formatDateTime } from "../../../../utils/date";
import type { InviteCodeInfo } from "../../../../services";
import type { InviteExpiryPreset } from "./useUserManagementActions";

export interface InviteCodesSectionProps {
  inviteCodes: InviteCodeInfo[];
  nowSec: number;
  copiedCode: string | null;
  onCopyInviteCode: (code: string) => void;
  onDeleteInviteCode: (code: string) => Promise<void>;
  onOpenCreateDialog: () => void;
  t: TFunction;
}

/**
 * Displays existing invite codes with copy, usage counts, expiration badges, and deletion controls.
 */
export const InviteCodesSection: React.FC<InviteCodesSectionProps> = ({
  inviteCodes,
  nowSec,
  copiedCode,
  onCopyInviteCode,
  onDeleteInviteCode,
  onOpenCreateDialog,
  t,
}) => (
  <div className="pt-4 border-t border-gray-100 dark:border-gray-800 space-y-3">
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <H5 className="flex items-center space-x-2 text-sm font-semibold m-0" style={{ margin: 0 }}>
          <KeyRound className="w-4 h-4 text-blue-500 shrink-0" />
          <span>{t("account.inviteCodeList", "邀请码列表")}</span>
        </H5>
        <Tag minimal round>{inviteCodes.length}</Tag>
      </div>
      <Button
        small
        icon={<Plus size={14} />}
        intent={Intent.PRIMARY}
        text={t("account.createInviteCode", "创建邀请码")}
        onClick={onOpenCreateDialog}
      />
    </div>

    {inviteCodes.length === 0 ? (
      <div className="rounded-lg border border-dashed border-gray-200 dark:border-gray-800 py-5 text-center text-xs text-gray-500 dark:text-gray-400">
        {t("account.noInviteCodes", "暂无邀请码，点击右上角创建邀请码。")}
      </div>
    ) : (
      <div className="overflow-x-auto">
        <HTMLTable interactive striped className="w-full whitespace-nowrap">
          <thead>
            <tr>
              <th className="whitespace-nowrap">{t("account.inviteCode", "邀请码")}</th>
              <th className="whitespace-nowrap">{t("account.inviteTotalUses", "总次数")}</th>
              <th className="whitespace-nowrap">{t("account.inviteRemainingUses", "剩余可用次数")}</th>
              <th className="whitespace-nowrap">{t("account.inviteExpiresAt", "有效期")}</th>
              <th className="whitespace-nowrap">{t("account.inviteLastUsedAt", "上次使用时间")}</th>
              <th className="text-right whitespace-nowrap">{t("account.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {inviteCodes.map((ic) => {
              const isExpired = ic.expires_at !== null && ic.expires_at <= nowSec;
              const isExhausted = ic.remaining_uses <= 0;
              return (
                <tr key={ic.code}>
                  <td className="whitespace-nowrap">
                    <div className="inline-flex items-center gap-1.5">
                      <code className="text-xs font-mono font-semibold tracking-wider select-all">
                        {ic.code}
                      </code>
                      <Button
                        minimal
                        small
                        icon={
                          copiedCode === ic.code ? (
                            <Check size={12} className="text-green-500" />
                          ) : (
                            <Copy size={12} />
                          )
                        }
                        title={t("common.copy", "复制")}
                        onClick={() => onCopyInviteCode(ic.code)}
                      />
                    </div>
                  </td>
                  <td className="text-xs font-mono whitespace-nowrap">{ic.max_uses}</td>
                  <td className="whitespace-nowrap">
                    <Tag
                      minimal
                      round
                      intent={isExhausted ? Intent.DANGER : Intent.SUCCESS}
                      className="font-mono"
                    >
                      {ic.remaining_uses}
                    </Tag>
                  </td>
                  <td className="text-xs whitespace-nowrap">
                    {ic.expires_at === null ? (
                      <span className="text-gray-500 dark:text-gray-400">
                        {t("account.inviteNeverExpires", "永久有效")}
                      </span>
                    ) : (
                      <div className="inline-flex items-center gap-1.5">
                        <span
                          className={
                            isExpired ? "text-red-500 line-through" : "text-gray-600 dark:text-gray-300"
                          }
                        >
                          {formatDateTime(new Date(ic.expires_at * 1000))}
                        </span>
                        {isExpired && (
                          <Tag minimal intent={Intent.DANGER}>
                            {t("account.inviteExpiredBadge", "已过期")}
                          </Tag>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="text-xs text-gray-500 whitespace-nowrap">
                    {ic.last_used_at ? formatDateTime(new Date(ic.last_used_at * 1000)) : "-"}
                  </td>
                  <td className="text-right whitespace-nowrap">
                    <Button
                      minimal
                      intent={Intent.DANGER}
                      icon={<Trash2 size={14} />}
                      onClick={() => onDeleteInviteCode(ic.code)}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </HTMLTable>
      </div>
    )}
  </div>
);

export interface InviteCodeCreateDialogProps {
  isOpen: boolean;
  onClose: () => void;
  inviteCodeInput: string;
  onInviteCodeInputChange: (val: string) => void;
  inviteMaxUses: string;
  onInviteMaxUsesChange: (val: string) => void;
  inviteExpiryPreset: InviteExpiryPreset;
  onInviteExpiryPresetChange: (preset: InviteExpiryPreset) => void;
  inviteCustomExpiry: string;
  onInviteCustomExpiryChange: (val: string) => void;
  minCustomExpiryStr: string;
  createInviteLoading: boolean;
  onSubmit: () => Promise<void>;
  t: TFunction;
}

/**
 * Modal dialog for generating a custom or random registration invite code.
 */
export const InviteCodeCreateDialog: React.FC<InviteCodeCreateDialogProps> = ({
  isOpen,
  onClose,
  inviteCodeInput,
  onInviteCodeInputChange,
  inviteMaxUses,
  onInviteMaxUsesChange,
  inviteExpiryPreset,
  onInviteExpiryPresetChange,
  inviteCustomExpiry,
  onInviteCustomExpiryChange,
  minCustomExpiryStr,
  createInviteLoading,
  onSubmit,
  t,
}) => (
  <Dialog
    isOpen={isOpen}
    onClose={onClose}
    title={t("account.createInviteCode", "创建邀请码")}
    icon="key"
  >
    <form
      className="p-6 space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!createInviteLoading) {
          void onSubmit();
        }
      }}
    >
      <FormGroup
        label={t("account.inviteCodeOptionalLabel", "邀请码（可选）")}
        helperText={t(
          "account.inviteCodeOptionalHelper",
          "留空将自动生成 6 位大写英文字母或数字；手动填写需为 6 位大写字母/数字。"
        )}
      >
        <InputGroup
          value={inviteCodeInput}
          maxLength={6}
          className="font-mono uppercase tracking-widest"
          placeholder={t("account.inviteCodeOptionalPlaceholder", "留空自动随机生成")}
          onChange={(e) => {
            const sanitized = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
            onInviteCodeInputChange(sanitized);
          }}
          autoFocus
        />
      </FormGroup>
      <FormGroup label={t("account.inviteTotalUses", "总次数")}>
        <InputGroup
          type="number"
          min={1}
          value={inviteMaxUses}
          onChange={(e) => onInviteMaxUsesChange(e.target.value)}
        />
      </FormGroup>
      <FormGroup label={t("account.inviteExpiresAt", "有效期")}>
        <HTMLSelect
          fill
          value={inviteExpiryPreset}
          onChange={(e) => onInviteExpiryPresetChange(e.target.value as InviteExpiryPreset)}
          options={[
            { label: t("account.inviteNeverExpires", "永久有效"), value: "never" },
            { label: t("account.inviteExpiry1d", "24 小时后过期"), value: "1d" },
            { label: t("account.inviteExpiry7d", "7 天后过期"), value: "7d" },
            { label: t("account.inviteExpiry30d", "30 天后过期"), value: "30d" },
            { label: t("account.inviteExpiryCustom", "自定义过期时间"), value: "custom" },
          ]}
        />
      </FormGroup>
      {inviteExpiryPreset === "custom" && (
        <FormGroup label={t("account.inviteCustomExpiryLabel", "截止时间")}>
          <InputGroup
            type="datetime-local"
            min={minCustomExpiryStr}
            value={inviteCustomExpiry}
            onChange={(e) => onInviteCustomExpiryChange(e.target.value)}
          />
        </FormGroup>
      )}
      <div className="flex justify-end gap-2 mt-6">
        <Button type="button" text={t("account.cancel")} onClick={onClose} />
        <Button
          type="submit"
          intent={Intent.PRIMARY}
          text={t("account.createNow")}
          loading={createInviteLoading}
        />
      </div>
    </form>
  </Dialog>
);
