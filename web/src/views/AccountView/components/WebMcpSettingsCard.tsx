import React, { useEffect, useState } from "react";
import { Card, Callout, Elevation, H4, Intent, Switch, Tag } from "@blueprintjs/core";
import { Bot } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  isBrowserWebMcpSupported,
  isWebMcpPreferenceEnabled,
  setWebMcpPreferenceEnabled,
  webMcpRegistry,
  WEBMCP_PREF_CHANGED_EVENT,
  WEBMCP_TOOLS_CHANGED_EVENT,
} from "../../../webmcp";

/**
 * Account preferences card inspecting browser WebMCP (`navigator.modelContext`) availability,
 * toggling local browser agent access, and listing currently registered WebMCP tool names.
 */
export const WebMcpSettingsCard: React.FC = () => {
  const { t } = useTranslation();
  const isSupported = isBrowserWebMcpSupported();
  const [isEnabled, setIsEnabled] = useState<boolean>(() => isWebMcpPreferenceEnabled());
  const [snapshot, setSnapshot] = useState(() => webMcpRegistry.getInspectionSnapshot());

  useEffect(() => {
    const syncSnapshot = (): void => {
      setIsEnabled(isWebMcpPreferenceEnabled());
      setSnapshot(webMcpRegistry.getInspectionSnapshot());
    };

    syncSnapshot();
    window.addEventListener(WEBMCP_PREF_CHANGED_EVENT, syncSnapshot);
    window.addEventListener(WEBMCP_TOOLS_CHANGED_EVENT, syncSnapshot);
    return () => {
      window.removeEventListener(WEBMCP_PREF_CHANGED_EVENT, syncSnapshot);
      window.removeEventListener(WEBMCP_TOOLS_CHANGED_EVENT, syncSnapshot);
    };
  }, []);

  const handleToggle = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const nextEnabled = event.currentTarget.checked;
    setWebMcpPreferenceEnabled(nextEnabled);
    setIsEnabled(nextEnabled);
  };

  return (
    <Card elevation={Elevation.ONE} className="rounded-lg! p-5!">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <Bot size={18} className="text-blue-600 dark:text-blue-400" />
            <H4 className="mb-0!">{t("account.webmcp.title", "WebMCP 浏览器 AI 接口")}</H4>
            <Tag
              minimal
              round
              intent={isSupported ? (isEnabled ? Intent.SUCCESS : Intent.WARNING) : Intent.NONE}
            >
              {!isSupported
                ? t("account.webmcp.browserUnsupported", "当前浏览器不支持 navigator.modelContext")
                : isEnabled
                ? t("account.webmcp.enabledBadge", "已启用 ({{count}} 个活跃工具)", {
                    count: snapshot.activeToolNames.length,
                  })
                : t("account.webmcp.disabledBadge", "已在本地停用")}
            </Tag>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-0!">
            {t(
              "account.webmcp.description",
              "允许支持 WebMCP 的浏览器内置或扩展 AI 代理，在当前已解锁会话与人机确认（HITL）保护下调用 DNS Worker 诊断与规则调优工具。"
            )}
          </p>
        </div>

        <Switch
          checked={isEnabled}
          large
          className="mb-0! shrink-0"
          label={
            isEnabled
              ? t("common.enabled", "已启用")
              : t("common.disabled", "已停用")
          }
          onChange={handleToggle}
        />
      </div>

      {!isSupported && (
        <Callout intent={Intent.NONE} className="mt-4! text-xs!">
          {t(
            "account.webmcp.unsupportedHint",
            "未检测到 navigator.modelContext（实验性浏览器标准，例如 Chrome 需启用 #enable-webmcp-testing）。开关状态仍会保存在本地，控制台其余功能不受影响。"
          )}
        </Callout>
      )}

      {isSupported && isEnabled && snapshot.activeToolNames.length > 0 && (
        <div className="mt-4 pt-3 border-t border-gray-200 dark:border-gray-700/70 space-y-2">
          <div className="text-xs font-medium text-gray-600 dark:text-gray-300">
            {t("account.webmcp.activeToolsLabel", "当前会话已激活工具：")}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {snapshot.activeToolNames.map((name) => (
              <Tag key={name} minimal className="font-mono! text-[11px]!">
                {name}
              </Tag>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
};
