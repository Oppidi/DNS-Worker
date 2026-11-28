import React from "react";
import { Button, Intent, Switch, Tag } from "@blueprintjs/core";
import { Check, Copy, ShieldCheck } from "lucide-react";
import type { TFunction } from "i18next";
import type { ReleaseChannel, ServerfullRuntimeStatus } from "../../../../services";
import { formatDateTime } from "../../../../utils/date";

const RELEASE_CHANNELS: ReleaseChannel[] = ["latest", "alpha", "canary"];

export interface ReleaseChannelsSectionProps {
  status: ServerfullRuntimeStatus;
  selectedChannel: ReleaseChannel | null;
  onSelectChannel: (channel: ReleaseChannel) => void;
  sudoOverride: boolean | null;
  onToggleSudo: (useSudo: boolean) => void;
  copiedChannel: ReleaseChannel | null;
  onCopyCommand: (channel: ReleaseChannel, cmd: string) => void;
  t: TFunction;
}

/**
 * Renders release channel selector tabs (`latest`, `alpha`, `canary`), optional `sudo` prefix toggle,
 * channel version status badge, and host CLI update command box.
 */
export const ReleaseChannelsSection: React.FC<ReleaseChannelsSectionProps> = ({
  status,
  selectedChannel,
  onSelectChannel,
  sudoOverride,
  onToggleSudo,
  copiedChannel,
  onCopyCommand,
  t,
}) => {
  const getChannelLabel = (channel: ReleaseChannel): string => {
    if (channel === "latest") return t("system.runtime.channelStable", "正式版 (latest)");
    if (channel === "alpha") return t("system.runtime.channelAlpha", "测试版 (alpha)");
    return t("system.runtime.channelCanary", "金丝雀版 (canary)");
  };

  const activeChannel: ReleaseChannel = selectedChannel ?? status.currentChannel ?? "latest";
  const activeInfo = status.channels[activeChannel];
  const isCurrentChannel = status.currentChannel === activeChannel;
  const hasRemoteVersion = Boolean(activeInfo?.version);
  const hasUpdate = isCurrentChannel && Boolean(activeInfo?.updateAvailable);
  const supportsSudoToggle = status.platform !== "win32" && status.installMethod !== "source";
  const defaultUseSudo =
    supportsSudoToggle &&
    (status.serviceManager === "systemd" ||
      status.installMethod === "npm-global" ||
      status.installMethod === "npx");
  const useSudo = supportsSudoToggle && (sudoOverride ?? defaultUseSudo);
  const displayCommand = activeInfo?.updateCommand
    ? useSudo
      ? activeInfo.updateCommand
          .split(" && ")
          .map((part) => (part.startsWith("sudo ") ? part : `sudo ${part}`))
          .join(" && ")
      : activeInfo.updateCommand
    : "";

  return (
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <span className="text-xs uppercase font-semibold text-gray-500 tracking-wider">
          {t("system.runtime.channelsTitle", "发布通道与宿主机更新命令")}
        </span>
        {status.checkedAt && (
          <span className="text-xs text-gray-500">
            {t("system.runtime.lastChecked", "上次检查")}:{" "}
            {formatDateTime(new Date(status.checkedAt * 1000))}
          </span>
        )}
      </div>

      {/* Channel Track Tabs (Select channel first, defaulting to active running channel) */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div
          className="inline-flex flex-wrap items-center gap-1 bg-gray-100/80 dark:bg-gray-800/70 p-1 rounded-lg self-start"
          role="tablist"
          aria-label={t("system.runtime.channelsTitle", "发布通道")}
        >
          {RELEASE_CHANNELS.map((ch) => {
            const selected = activeChannel === ch;
            const isRunningChannel = status.currentChannel === ch;
            return (
              <Button
                key={ch}
                minimal
                small
                active={selected}
                intent={selected ? Intent.PRIMARY : Intent.NONE}
                onClick={() => onSelectChannel(ch)}
                className="text-xs font-medium"
              >
                <span className="inline-flex items-center gap-1.5">
                  <span>{getChannelLabel(ch)}</span>
                  {isRunningChannel && (
                    <Tag minimal round intent={Intent.PRIMARY} className="text-[10px] leading-none">
                      {t("system.runtime.currentChannelBadge", "当前")}
                    </Tag>
                  )}
                </span>
              </Button>
            );
          })}
        </div>

        {supportsSudoToggle && (
          <Switch
            checked={useSudo}
            label={t("system.runtime.sudoToggle", "使用 sudo")}
            onChange={(e) => onToggleSudo(e.currentTarget.checked)}
            className="mb-0 text-xs"
          />
        )}
      </div>

      {/* Focused Selected Channel Card */}
      <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-900/40 p-4 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {t("system.runtime.channelLatestVersion", "通道最新版本")}:
            </span>
            <code className="text-sm font-mono font-semibold text-gray-900 dark:text-gray-100">
              {hasRemoteVersion ? `v${activeInfo.version}` : "-"}
            </code>
          </div>

          <div className="flex items-center gap-2">
            {isCurrentChannel ? (
              hasRemoteVersion && (
                <Tag minimal intent={hasUpdate ? Intent.WARNING : Intent.SUCCESS}>
                  {hasUpdate
                    ? t("system.runtime.updateAvailable", "有新版本")
                    : t("system.runtime.upToDate", "已是最新")}
                </Tag>
              )
            ) : (
              <Tag minimal intent={Intent.NONE}>
                {t("system.runtime.otherChannelBadge", "非当前运行通道")}
              </Tag>
            )}
          </div>
        </div>

        {!isCurrentChannel && (
          <div className="text-xs text-gray-500 dark:text-gray-400">
            {t("system.runtime.channelSwitchHint", {
              current: status.currentChannel,
              target: activeChannel,
              defaultValue: `当前运行在 ${status.currentChannel} 通道；如需切换至 ${activeChannel} 通道，可在宿主机执行下方命令。`,
            })}
          </div>
        )}

        {displayCommand && (
          <div className="flex items-center justify-between gap-2 rounded bg-gray-100 dark:bg-gray-950/70 px-3 py-2 border border-gray-200/80 dark:border-gray-800">
            <code
              className="text-xs font-mono text-gray-800 dark:text-gray-200 overflow-x-auto whitespace-nowrap select-all"
              title={displayCommand}
            >
              {displayCommand}
            </code>
            <Button
              minimal
              small
              icon={
                copiedChannel === activeChannel ? (
                  <Check size={14} className="text-green-500" />
                ) : (
                  <Copy size={14} />
                )
              }
              title={t("common.copy", "复制")}
              onClick={() => onCopyCommand(activeChannel, displayCommand)}
            />
          </div>
        )}
      </div>

      <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
        <ShieldCheck className="w-3.5 h-3.5 shrink-0 text-emerald-500" />
        <span>
          {t(
            "system.runtime.securityHint",
            "出于宿主机安全边界考量，软件包安装需在宿主机终端或容器编排侧执行；更新完成后可通过右上角安全重启服务。"
          )}
        </span>
      </div>
    </div>
  );
};
