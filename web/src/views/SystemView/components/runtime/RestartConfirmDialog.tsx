import React from "react";
import { Button, Callout, Dialog, Intent } from "@blueprintjs/core";
import { RotateCcw } from "lucide-react";
import type { TFunction } from "i18next";

export interface RestartConfirmDialogProps {
  isOpen: boolean;
  submitting: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  t: TFunction;
}

/**
 * Confirmation dialog explaining graceful shutdown, WAL checkpoint flush,
 * and brief downtime before triggering a Serverfull process restart.
 */
export const RestartConfirmDialog: React.FC<RestartConfirmDialogProps> = ({
  isOpen,
  submitting,
  onClose,
  onConfirm,
  t,
}) => (
  <Dialog
    isOpen={isOpen}
    onClose={() => {
      if (!submitting) onClose();
    }}
    title={t("system.runtime.restartConfirmTitle", "确认优雅重启服务")}
    icon="refresh"
  >
    <div className="p-6 space-y-4">
      <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed m-0">
        {t(
          "system.runtime.restartConfirmDesc",
          "确认重启 DNS Worker 服务吗？服务会先刷新日志与 SQLite WAL 检查点并优雅退出，随后由 systemd 或 Docker 自动拉起。"
        )}
      </p>
      <Callout intent={Intent.WARNING}>
        <div className="text-xs leading-relaxed">
          {t(
            "system.runtime.restartConfirmWarning",
            "重启期间 UDP / DoT / DoH 解析与 Web 控制台将短暂不可用（约 5–10 秒）。请确认当前使用 systemd 或设置了容器自动重启策略（restart: unless-stopped / always）。"
          )}
        </div>
      </Callout>
      <div className="flex justify-end gap-2 pt-2">
        <Button text={t("account.cancel", "取消")} disabled={submitting} onClick={onClose} />
        <Button
          intent={Intent.WARNING}
          icon={<RotateCcw size={14} />}
          text={t("system.runtime.confirmRestartAction", "立即重启")}
          loading={submitting}
          onClick={onConfirm}
        />
      </div>
    </div>
  </Dialog>
);
