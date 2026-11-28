import React from "react";
import {
  Card,
  Elevation,
  H4,
  Tag,
  Intent,
  Button,
  Callout,
  Spinner,
  Tooltip,
  type OverlayToaster,
} from "@blueprintjs/core";
import { Server, RefreshCw, RotateCcw, AlertCircle } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { ServerfullRuntimeStatus } from "../../../services";
import { formatDateTime } from "../../../utils/date";
import { useServerfullRuntimeActions } from "./runtime/useServerfullRuntimeActions";
import { ReleaseChannelsSection } from "./runtime/ReleaseChannelsSection";
import { RestartConfirmDialog } from "./runtime/RestartConfirmDialog";

export interface ServerfullRuntimeCardProps {
  status: ServerfullRuntimeStatus | null;
  onRefresh: (forceRefresh?: boolean) => Promise<void>;
  toasterRef?: React.RefObject<OverlayToaster | null>;
}

/**
 * Displays Serverfull runtime details, 3-channel update status (`latest`, `alpha`, `canary`),
 * host CLI update commands, and safe graceful restart controls for administrators.
 */
export const ServerfullRuntimeCard: React.FC<ServerfullRuntimeCardProps> = ({
  status,
  onRefresh,
  toasterRef,
}) => {
  const { t } = useTranslation();
  const actions = useServerfullRuntimeActions({
    status,
    onRefresh,
    toasterRef,
    t,
  });

  if (!status || !status.supported) {
    return null;
  }

  const getInstallMethodLabel = (method: ServerfullRuntimeStatus["installMethod"]): string => {
    switch (method) {
      case "npm-global":
        return t("system.runtime.installNpmGlobal", "npm 全局安装");
      case "docker":
        return t("system.runtime.installDocker", "Docker 容器");
      case "source":
        return t("system.runtime.installSource", "源码构建");
      case "npx":
        return "npx";
      default:
        return t("system.runtime.installUnknown", "独立运行");
    }
  };

  const getServiceManagerLabel = (mgr: ServerfullRuntimeStatus["serviceManager"]): string => {
    switch (mgr) {
      case "systemd":
        return "systemd";
      case "docker":
        return "Docker";
      case "schtasks":
        return t("system.runtime.supervisorSchtasks", "Windows 计划任务");
      default:
        return t("system.runtime.supervisorNone", "无守护进程");
    }
  };

  const restartButton = (
    <Button
      intent={Intent.WARNING}
      icon={<RotateCcw size={14} />}
      text={
        actions.restarting
          ? t("system.runtime.restarting", "正在重启...")
          : t("system.runtime.restartButton", "重启服务")
      }
      disabled={!status.canRestart || actions.restarting}
      loading={actions.restarting}
      onClick={() => actions.setConfirmOpen(true)}
    />
  );

  return (
    <>
      <Card elevation={Elevation.ONE} className="p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <H4
              className="flex items-center space-x-2 text-base font-semibold m-0"
              style={{ margin: 0 }}
            >
              <Server className="w-5 h-5 text-emerald-500 shrink-0" />
              <span>{t("system.runtime.title", "版本与服务运行状态 (管理员)")}</span>
            </H4>
            <Tag minimal round intent={Intent.PRIMARY} className="font-mono">
              v{status.currentVersion}
            </Tag>
            <Tag minimal round>{status.currentChannel}</Tag>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <Button
              minimal
              icon={<RefreshCw size={14} className={actions.checking ? "animate-spin" : ""} />}
              text={t("system.runtime.checkUpdates", "检查更新")}
              loading={actions.checking}
              disabled={actions.restarting}
              onClick={actions.handleCheckUpdates}
            />
            {!status.canRestart ? (
              <Tooltip
                content={actions.getRestartDisabledReason(status.restartReason)}
                placement="top-end"
              >
                <span>{restartButton}</span>
              </Tooltip>
            ) : (
              restartButton
            )}
          </div>
        </div>

        {actions.restarting && (
          <Callout intent={Intent.WARNING} icon={<Spinner size={18} />}>
            <div className="text-sm font-medium">
              {t("system.runtime.restartingBanner", "正在触发优雅重启并等待服务恢复...")}
            </div>
            <div className="text-xs opacity-80 mt-0.5">
              {t(
                "system.runtime.restartingBannerDesc",
                "期间 DNS 解析与控制台会短暂断开约 5–10 秒，恢复后将自动刷新状态。"
              )}
            </div>
          </Callout>
        )}

        {status.checkError && (
          <Callout intent={Intent.WARNING} icon={<AlertCircle size={16} />}>
            <div className="text-xs">
              {t("system.runtime.registryErrorPrefix", "检查 npm 仓库版本失败：")}
              <span className="font-mono">{status.checkError}</span>
            </div>
          </Callout>
        )}

        {/* Runtime environment summary */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <span className="text-xs uppercase font-semibold text-gray-500 tracking-wider">
              {t("system.runtime.runtimeEngine", "运行环境")}
            </span>
            <div className="font-medium mt-1 break-all">
              {status.runtime} ({status.workersCount}{" "}
              {status.workersCount > 1 ? "workers" : "worker"})
            </div>
          </div>

          <div>
            <span className="text-xs uppercase font-semibold text-gray-500 tracking-wider">
              {t("system.runtime.installMethod", "部署方式")}
            </span>
            <div className="font-medium mt-1">{getInstallMethodLabel(status.installMethod)}</div>
          </div>

          <div>
            <span className="text-xs uppercase font-semibold text-gray-500 tracking-wider">
              {t("system.runtime.supervisor", "进程托管")}
            </span>
            <div className="font-medium mt-1">{getServiceManagerLabel(status.serviceManager)}</div>
          </div>

          <div>
            <span className="text-xs uppercase font-semibold text-gray-500 tracking-wider">
              {t("system.runtime.startedAt", "启动时间")}
            </span>
            <div className="text-xs text-gray-600 dark:text-gray-300 mt-1">
              {status.startedAt ? formatDateTime(new Date(status.startedAt * 1000)) : "-"}
            </div>
          </div>
        </div>

        <ReleaseChannelsSection
          status={status}
          selectedChannel={actions.selectedChannel}
          onSelectChannel={actions.setSelectedChannel}
          sudoOverride={actions.sudoOverride}
          onToggleSudo={actions.setSudoOverride}
          copiedChannel={actions.copiedChannel}
          onCopyCommand={actions.handleCopyCommand}
          t={t}
        />
      </Card>

      <RestartConfirmDialog
        isOpen={actions.confirmOpen}
        submitting={actions.submittingRestart}
        onClose={() => actions.setConfirmOpen(false)}
        onConfirm={actions.handleConfirmRestart}
        t={t}
      />
    </>
  );
};
