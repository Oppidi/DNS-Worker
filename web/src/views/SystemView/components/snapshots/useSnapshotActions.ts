import type React from "react";
import { useState, useEffect, useMemo, useRef } from "react";
import { Intent, type OverlayToaster } from "@blueprintjs/core";
import { useTranslation } from "react-i18next";

import type { DatabaseSnapshotItem, DatabaseSnapshotOverview } from "../../../../services";
import {
  abortDatabaseSnapshot,
  deleteDatabaseSnapshots,
  downloadDatabaseSnapshot,
  getDatabaseSnapshots,
  startDatabaseSnapshot,
} from "../../../../services";
import { useDeploymentMode } from "../../../../hooks/useDeploymentMode";

export interface UseSnapshotActionsParams {
  overview: DatabaseSnapshotOverview;
  onOverviewUpdated: (next: DatabaseSnapshotOverview) => void;
  toasterRef?: React.RefObject<OverlayToaster | null>;
}

export interface UseSnapshotActionsResult {
  startingCapture: boolean;
  abortingCapture: boolean;
  deleting: boolean;
  downloadingFilename: string | null;
  deleteTargetFilenames: string[] | null;
  setDeleteTargetFilenames: React.Dispatch<React.SetStateAction<string[] | null>>;
  validSelected: string[];
  selectedSet: Set<string>;
  allSelected: boolean;
  partiallySelected: boolean;
  clearSelection: () => void;
  handleToggleSelectAll: (checked: boolean) => void;
  handleToggleSelectRow: (filename: string) => void;
  handleStartCapture: () => Promise<void>;
  handleAbortCapture: () => Promise<void>;
  handleConfirmDelete: () => Promise<void>;
  handleDownloadSnapshot: (filename: string) => Promise<void>;
}

/**
 * Encapsulates snapshot capture/abort/delete/download actions, status polling,
 * demo-mode simulation timers, and bulk row selection state.
 */
export function useSnapshotActions({
  overview,
  onOverviewUpdated,
  toasterRef,
}: UseSnapshotActionsParams): UseSnapshotActionsResult {
  const { t } = useTranslation();
  const { isDemoMode } = useDeploymentMode();

  const [startingCapture, setStartingCapture] = useState(false);
  const [abortingCapture, setAbortingCapture] = useState(false);
  const [selectedFilenames, setSelectedFilenames] = useState<string[]>([]);
  const [deleteTargetFilenames, setDeleteTargetFilenames] = useState<string[] | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [downloadingFilename, setDownloadingFilename] = useState<string | null>(null);

  const wasCapturingRef = useRef<boolean>(Boolean(overview.activeCapture));
  const abortedByUserRef = useRef<boolean>(false);
  const demoTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearDemoTimers = () => {
    for (const timer of demoTimersRef.current) {
      clearTimeout(timer);
    }
    demoTimersRef.current = [];
  };

  useEffect(() => clearDemoTimers, []);

  const snapshots = overview.snapshots;
  const isCapturing = Boolean(overview.activeCapture);

  // Poll snapshot status while a capture subprocess is active (real Serverfull only)
  useEffect(() => {
    if (!isCapturing || isDemoMode) {
      return;
    }

    const timer = setInterval(async () => {
      try {
        const next = await getDatabaseSnapshots();
        onOverviewUpdated(next);

        if (!next.activeCapture && wasCapturingRef.current) {
          wasCapturingRef.current = false;
          if (abortedByUserRef.current) {
            abortedByUserRef.current = false;
          } else {
            toasterRef?.current?.show({
              message: t("account.snapshotCaptureSuccess", "数据库快照撷取完成"),
              intent: Intent.SUCCESS,
              icon: "tick",
            });
          }
        }
      } catch (err) {
        console.error("Failed to poll snapshot status:", err);
      }
    }, 400);

    return () => clearInterval(timer);
  }, [isCapturing, isDemoMode, onOverviewUpdated, toasterRef, t]);

  const validSelected = useMemo(() => {
    const existingSet = new Set(snapshots.map((s) => s.filename));
    return selectedFilenames.filter((name) => existingSet.has(name));
  }, [snapshots, selectedFilenames]);

  const selectedSet = useMemo(() => new Set(validSelected), [validSelected]);
  const allSelected = snapshots.length > 0 && validSelected.length === snapshots.length;
  const partiallySelected = validSelected.length > 0 && validSelected.length < snapshots.length;

  const startDemoCapture = () => {
    clearDemoTimers();
    abortedByUserRef.current = false;
    const startedAt = Math.floor(Date.now() / 1000);
    const hex = Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0");
    const d = new Date(startedAt * 1000);
    const pad = (n: number) => String(n).padStart(2, "0");
    const id = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z-${hex}`;

    onOverviewUpdated({
      ...overview,
      activeCapture: { id, startedAt, stage: "vacuumming", progress: 8 },
    });

    const demoSteps: Array<{ delayMs: number; stage: "vacuumming" | "compressing"; progress: number }> = [
      { delayMs: 350, stage: "vacuumming", progress: 26 },
      { delayMs: 700, stage: "vacuumming", progress: 48 },
      { delayMs: 1050, stage: "compressing", progress: 64 },
      { delayMs: 1400, stage: "compressing", progress: 85 },
      { delayMs: 1750, stage: "compressing", progress: 97 },
    ];

    const stepTimers = demoSteps.map((step) =>
      setTimeout(() => {
        if (abortedByUserRef.current) return;
        onOverviewUpdated({
          ...overview,
          activeCapture: { id, startedAt, stage: step.stage, progress: step.progress },
        });
      }, step.delayMs)
    );

    const finishTimer = setTimeout(() => {
      if (abortedByUserRef.current) return;
      const retentionSec = overview.config.retentionDays > 0 ? overview.config.retentionDays * 86400 : 0;
      const newItem: DatabaseSnapshotItem = {
        filename: `dns-worker-snapshot-${id}.sqlite.zst`,
        sizeBytes: 14_680_064,
        createdAt: startedAt,
        expiresAt: retentionSec > 0 ? startedAt + retentionSec : 0,
      };
      const nextSnapshots = [newItem, ...overview.snapshots].slice(0, overview.config.maxCount);
      const nextSnapsBytes = nextSnapshots.reduce((sum, s) => sum + s.sizeBytes, 0);
      const prevSnapsBytes = overview.storage?.snapshotsTotalBytes ?? 0;
      const delta = nextSnapsBytes - prevSnapsBytes;
      onOverviewUpdated({
        ...overview,
        snapshots: nextSnapshots,
        activeCapture: null,
        storage: overview.storage
          ? {
              ...overview.storage,
              snapshotsTotalBytes: nextSnapsBytes,
              diskUsedBytes: Math.max(0, overview.storage.diskUsedBytes + delta),
              diskFreeBytes: Math.max(0, overview.storage.diskFreeBytes - delta),
            }
          : null,
      });
      toasterRef?.current?.show({
        message: t("account.snapshotCaptureSuccess", "数据库快照撷取完成"),
        intent: Intent.SUCCESS,
        icon: "tick",
      });
    }, 2100);

    demoTimersRef.current = [...stepTimers, finishTimer];
  };

  const handleStartCapture = async () => {
    if (isDemoMode) {
      startDemoCapture();
      return;
    }

    setStartingCapture(true);
    abortedByUserRef.current = false;
    try {
      const res = await startDatabaseSnapshot();
      wasCapturingRef.current = true;
      onOverviewUpdated({ ...overview, activeCapture: res.activeCapture });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "";
      toasterRef?.current?.show({
        message: msg || t("account.snapshotCaptureFailed", "启动快照撷取失败"),
        intent: Intent.DANGER,
        icon: "error",
      });
    } finally {
      setStartingCapture(false);
    }
  };

  const handleAbortCapture = async () => {
    if (isDemoMode) {
      abortedByUserRef.current = true;
      clearDemoTimers();
      onOverviewUpdated({ ...overview, activeCapture: null });
      toasterRef?.current?.show({
        message: t("account.snapshotAbortedToast", "已停止并放弃当前快照撷取"),
        intent: Intent.WARNING,
        icon: "cross",
      });
      return;
    }

    setAbortingCapture(true);
    abortedByUserRef.current = true;
    try {
      await abortDatabaseSnapshot();
      const next = await getDatabaseSnapshots();
      wasCapturingRef.current = Boolean(next.activeCapture);
      onOverviewUpdated(next);
      toasterRef?.current?.show({
        message: t("account.snapshotAbortedToast", "已停止并放弃当前快照撷取"),
        intent: Intent.WARNING,
        icon: "cross",
      });
    } catch (e: unknown) {
      abortedByUserRef.current = false;
      const msg = e instanceof Error ? e.message : "";
      toasterRef?.current?.show({
        message: msg || t("account.snapshotAbortFailed", "放弃快照失败"),
        intent: Intent.DANGER,
        icon: "error",
      });
    } finally {
      setAbortingCapture(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTargetFilenames || deleteTargetFilenames.length === 0) return;

    if (isDemoMode) {
      const deletedSet = new Set(deleteTargetFilenames);
      const nextSnapshots = overview.snapshots.filter((s) => !deletedSet.has(s.filename));
      const nextSnapsBytes = nextSnapshots.reduce((sum, s) => sum + s.sizeBytes, 0);
      const prevSnapsBytes = overview.storage?.snapshotsTotalBytes ?? 0;
      const delta = prevSnapsBytes - nextSnapsBytes;
      setSelectedFilenames((prev) => prev.filter((name) => !deletedSet.has(name)));
      setDeleteTargetFilenames(null);
      onOverviewUpdated({
        ...overview,
        snapshots: nextSnapshots,
        storage: overview.storage
          ? {
              ...overview.storage,
              snapshotsTotalBytes: nextSnapsBytes,
              diskUsedBytes: Math.max(0, overview.storage.diskUsedBytes - delta),
              diskFreeBytes: overview.storage.diskFreeBytes + delta,
            }
          : null,
      });
      toasterRef?.current?.show({
        message: t("account.snapshotDeleteSuccess", {
          count: deletedSet.size,
          defaultValue: `已删除 ${deletedSet.size} 个快照`,
        }),
        intent: Intent.SUCCESS,
        icon: "tick",
      });
      return;
    }

    setDeleting(true);
    try {
      const res = await deleteDatabaseSnapshots(deleteTargetFilenames);
      const deletedSet = new Set(deleteTargetFilenames);
      setSelectedFilenames((prev) => prev.filter((name) => !deletedSet.has(name)));
      setDeleteTargetFilenames(null);
      const next = await getDatabaseSnapshots();
      onOverviewUpdated(next);
      toasterRef?.current?.show({
        message: t("account.snapshotDeleteSuccess", {
          count: res.deletedCount,
          defaultValue: `已删除 ${res.deletedCount} 个快照`,
        }),
        intent: Intent.SUCCESS,
        icon: "tick",
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "";
      toasterRef?.current?.show({
        message: msg || t("account.snapshotDeleteFailed", "删除快照失败"),
        intent: Intent.DANGER,
        icon: "error",
      });
    } finally {
      setDeleting(false);
    }
  };

  const handleDownloadSnapshot = async (filename: string) => {
    if (isDemoMode) {
      toasterRef?.current?.show({
        message: t("account.snapshotDemoDownloadBlocked", "演示模式仅提供前端展示，不支持下载真实数据库快照"),
        intent: Intent.PRIMARY,
        icon: "info-sign",
      });
      return;
    }

    setDownloadingFilename(filename);
    try {
      await downloadDatabaseSnapshot(filename);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "";
      toasterRef?.current?.show({
        message: msg || t("account.snapshotDownloadFailed", "下载快照失败"),
        intent: Intent.DANGER,
        icon: "error",
      });
    } finally {
      setDownloadingFilename((cur) => (cur === filename ? null : cur));
    }
  };

  return {
    startingCapture,
    abortingCapture,
    deleting,
    downloadingFilename,
    deleteTargetFilenames,
    setDeleteTargetFilenames,
    validSelected,
    selectedSet,
    allSelected,
    partiallySelected,
    clearSelection: () => setSelectedFilenames([]),
    handleToggleSelectAll: (checked: boolean) =>
      setSelectedFilenames(checked ? snapshots.map((s) => s.filename) : []),
    handleToggleSelectRow: (filename: string) =>
      setSelectedFilenames((prev) =>
        prev.includes(filename) ? prev.filter((item) => item !== filename) : [...prev, filename]
      ),
    handleStartCapture,
    handleAbortCapture,
    handleConfirmDelete,
    handleDownloadSnapshot,
  };
}
