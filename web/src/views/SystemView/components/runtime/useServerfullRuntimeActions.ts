import { useState, useEffect, useRef, useCallback } from "react";
import { Intent, type OverlayToaster } from "@blueprintjs/core";
import type { TFunction } from "i18next";
import type { ReleaseChannel, ServerfullRuntimeStatus } from "../../../../services";
import { getRuntimeStatus, restartServerfullService } from "../../../../services";

const RESTART_POLL_INTERVAL_MS = 2000;
const MAX_RESTART_POLL_ATTEMPTS = 30;

export interface UseServerfullRuntimeActionsParams {
  status: ServerfullRuntimeStatus | null;
  onRefresh: (forceRefresh?: boolean) => Promise<void>;
  toasterRef?: React.RefObject<OverlayToaster | null>;
  t: TFunction;
}

export interface UseServerfullRuntimeActionsResult {
  checking: boolean;
  confirmOpen: boolean;
  setConfirmOpen: (open: boolean) => void;
  restarting: boolean;
  submittingRestart: boolean;
  copiedChannel: ReleaseChannel | null;
  selectedChannel: ReleaseChannel | null;
  setSelectedChannel: (ch: ReleaseChannel) => void;
  sudoOverride: boolean | null;
  setSudoOverride: (val: boolean) => void;
  getRestartDisabledReason: (reason: string | null) => string;
  handleCheckUpdates: () => Promise<void>;
  handleCopyCommand: (channel: ReleaseChannel, cmd: string) => void;
  handleConfirmRestart: () => Promise<void>;
}

/**
 * Manages update-check requests, CLI copy feedback, sudo/channel selection state,
 * and graceful service restart recovery polling for ServerfullRuntimeCard.
 */
export function useServerfullRuntimeActions({
  status,
  onRefresh,
  toasterRef,
  t,
}: UseServerfullRuntimeActionsParams): UseServerfullRuntimeActionsResult {
  const [checking, setChecking] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [submittingRestart, setSubmittingRestart] = useState(false);
  const [copiedChannel, setCopiedChannel] = useState<ReleaseChannel | null>(null);
  const [selectedChannel, setSelectedChannel] = useState<ReleaseChannel | null>(null);
  const [sudoOverride, setSudoOverride] = useState<boolean | null>(null);
  const pollTimerRef = useRef<number | null>(null);
  const copyTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (pollTimerRef.current !== null) {
        window.clearInterval(pollTimerRef.current);
      }
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  const getRestartDisabledReason = useCallback(
    (reason: string | null): string => {
      if (reason === "demo_mode") {
        return t("system.runtime.restartDisabledDemo", "演示模式下已禁用服务重启。");
      }
      if (reason === "windows_no_auto_restart") {
        return t(
          "system.runtime.restartDisabledWindows",
          "Windows 计划任务脚本暂未启用退出自动拉起，请在宿主机运行 dns-worker service restart。"
        );
      }
      return t(
        "system.runtime.restartDisabledUnmanaged",
        "当前进程未由 systemd 或 Docker 自动重启策略托管，为避免断网停服已禁用网页端重启。"
      );
    },
    [t]
  );

  const handleCheckUpdates = useCallback(async (): Promise<void> => {
    setChecking(true);
    try {
      await onRefresh(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toasterRef?.current?.show({
        message: msg || t("system.runtime.checkFailed", "检查更新失败"),
        intent: Intent.DANGER,
        icon: "error",
      });
    } finally {
      setChecking(false);
    }
  }, [onRefresh, t, toasterRef]);

  const handleCopyCommand = useCallback((channel: ReleaseChannel, cmd: string): void => {
    navigator.clipboard.writeText(cmd).then(() => {
      setCopiedChannel(channel);
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
      copyTimerRef.current = window.setTimeout(() => {
        setCopiedChannel((prev) => (prev === channel ? null : prev));
      }, 2000);
    });
  }, []);

  const startRecoveryPolling = useCallback(
    (previousStartedAt: number): void => {
      if (pollTimerRef.current !== null) {
        window.clearInterval(pollTimerRef.current);
      }

      let attempts = 0;
      let sawConnectionDrop = false;

      pollTimerRef.current = window.setInterval(async () => {
        attempts += 1;
        try {
          const nextStatus = await getRuntimeStatus(false);
          const restarted =
            (nextStatus.startedAt && nextStatus.startedAt !== previousStartedAt) ||
            sawConnectionDrop;

          if (restarted) {
            if (pollTimerRef.current !== null) {
              window.clearInterval(pollTimerRef.current);
              pollTimerRef.current = null;
            }
            setRestarting(false);
            await onRefresh(false);
            toasterRef?.current?.show({
              message: t("system.runtime.restartSuccess", "服务已完成重启并恢复运行"),
              intent: Intent.SUCCESS,
              icon: "tick",
            });
            return;
          }
        } catch {
          sawConnectionDrop = true;
        }

        if (attempts >= MAX_RESTART_POLL_ATTEMPTS) {
          if (pollTimerRef.current !== null) {
            window.clearInterval(pollTimerRef.current);
            pollTimerRef.current = null;
          }
          setRestarting(false);
          toasterRef?.current?.show({
            message: t(
              "system.runtime.restartTimeout",
              "等待服务恢复超时，请检查宿主机服务状态或刷新页面。"
            ),
            intent: Intent.WARNING,
            icon: "warning-sign",
          });
        }
      }, RESTART_POLL_INTERVAL_MS);
    },
    [onRefresh, t, toasterRef]
  );

  const handleConfirmRestart = useCallback(async (): Promise<void> => {
    if (!status) return;
    setSubmittingRestart(true);
    try {
      const res = await restartServerfullService();
      setConfirmOpen(false);
      setRestarting(true);
      startRecoveryPolling(res.startedAt);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toasterRef?.current?.show({
        message:
          msg === "restart_unsupported"
            ? getRestartDisabledReason(status.restartReason)
            : msg || t("system.runtime.restartFailed", "触发重启失败"),
        intent: Intent.DANGER,
        icon: "error",
      });
    } finally {
      setSubmittingRestart(false);
    }
  }, [getRestartDisabledReason, startRecoveryPolling, status, t, toasterRef]);

  return {
    checking,
    confirmOpen,
    setConfirmOpen,
    restarting,
    submittingRestart,
    copiedChannel,
    selectedChannel,
    setSelectedChannel,
    sudoOverride,
    setSudoOverride,
    getRestartDisabledReason,
    handleCheckUpdates,
    handleCopyCommand,
    handleConfirmRestart,
  };
}
