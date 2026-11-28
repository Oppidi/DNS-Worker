/**
 * @file useWebMcpBridge.ts
 * @description React lifecycle hook synchronizing DNS Worker authentication, IdleSessionLock,
 * deployment mode, and E2EE unlock state with the shared WebMcpRegistry.
 */

import { useCallback, useEffect, useState } from "react";
import type { UserInfo } from "../services";
import { e2ee } from "../services";
import { getAccessToken } from "../utils/token";
import { createBaseWebMcpTools } from "./baseTools";
import { WEBMCP_PREF_CHANGED_EVENT } from "./events";
import { createAccessPointsWebMcpTools } from "./tools/accessPointsTools";
import { createAdminOpsWebMcpTools } from "./tools/adminOpsTools";
import { createAnalyticsLogsWebMcpTools } from "./tools/analyticsLogsTools";
import { createDiagnosticsWebMcpTools } from "./tools/diagnosticsTools";
import { createFilteringWebMcpTools } from "./tools/filteringTools";
import {
  createBrowserAnalyticsLogsDeps,
  createBrowserDiagnosticsDeps,
} from "./tools/phase1Defaults";
import {
  createBrowserFilteringDeps,
  createBrowserRulesDeps,
} from "./tools/phase2Defaults";
import {
  createBrowserAccessPointsDeps,
  createBrowserAdminOpsDeps,
  createBrowserProfilesDeps,
} from "./tools/phase3Defaults";
import { createProfilesWebMcpTools } from "./tools/profilesTools";
import { createRulesWebMcpTools } from "./tools/rulesTools";
import {
  isBrowserWebMcpSupported,
  isWebMcpPreferenceEnabled,
  setWebMcpPreferenceEnabled,
} from "./policy";
import { webMcpRegistry } from "./registry";
import type { WebMcpRuntimeState } from "./types";

export interface UseWebMcpBridgeParams {
  isLoggedIn: boolean;
  isDemoMode: boolean;
  deploymentMode: "cloudflare" | "serverfull";
  currentUser: UserInfo | null;
  activeProfileId: string | null;
}

export interface UseWebMcpBridgeResult {
  isSupported: boolean;
  isEnabled: boolean;
  setEnabled: (enabled: boolean) => void;
  activeToolNames: string[];
}

const SESSION_LOCKED_STORAGE_KEY = "dns_worker_session_locked";

function readSessionLockedFlag(): boolean {
  if (typeof sessionStorage === "undefined") {
    return false;
  }
  try {
    return sessionStorage.getItem(SESSION_LOCKED_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

/**
 * Synchronizes `webMcpRegistry` with live React auth/lock/E2EE state and registers
 * foundational WebMCP diagnostic tools when `navigator.modelContext` is supported.
 */
export function useWebMcpBridge({
  isLoggedIn,
  isDemoMode,
  deploymentMode,
  currentUser,
  activeProfileId,
}: UseWebMcpBridgeParams): UseWebMcpBridgeResult {
  const isSupported = isBrowserWebMcpSupported();
  const [isEnabled, setIsEnabledState] = useState<boolean>(() => isWebMcpPreferenceEnabled());
  const [isLocked, setIsLocked] = useState<boolean>(() => readSessionLockedFlag());
  const [isE2eeEnabled, setIsE2eeEnabled] = useState<boolean>(false);
  const [activeToolNames, setActiveToolNames] = useState<string[]>([]);

  const setEnabled = useCallback((enabled: boolean): void => {
    setWebMcpPreferenceEnabled(enabled);
    setIsEnabledState(enabled);
  }, []);

  // Register foundational, diagnostics/analytics, rules/filtering, access points/profiles, and admin ops groups
  useEffect(() => {
    webMcpRegistry.registerGroup("base", createBaseWebMcpTools(webMcpRegistry));
    webMcpRegistry.registerGroup(
      "diagnostics",
      createDiagnosticsWebMcpTools(createBrowserDiagnosticsDeps())
    );
    webMcpRegistry.registerGroup(
      "analytics_logs",
      createAnalyticsLogsWebMcpTools(createBrowserAnalyticsLogsDeps())
    );
    webMcpRegistry.registerGroup("rules", createRulesWebMcpTools(createBrowserRulesDeps()));
    webMcpRegistry.registerGroup("filtering", createFilteringWebMcpTools(createBrowserFilteringDeps()));
    webMcpRegistry.registerGroup(
      "access_points",
      createAccessPointsWebMcpTools(createBrowserAccessPointsDeps())
    );
    webMcpRegistry.registerGroup("profiles", createProfilesWebMcpTools(createBrowserProfilesDeps()));
    webMcpRegistry.registerGroup("admin_ops", createAdminOpsWebMcpTools(createBrowserAdminOpsDeps()));
    return () => {
      webMcpRegistry.unregisterGroup("admin_ops");
      webMcpRegistry.unregisterGroup("profiles");
      webMcpRegistry.unregisterGroup("access_points");
      webMcpRegistry.unregisterGroup("filtering");
      webMcpRegistry.unregisterGroup("rules");
      webMcpRegistry.unregisterGroup("analytics_logs");
      webMcpRegistry.unregisterGroup("diagnostics");
      webMcpRegistry.unregisterGroup("base");
    };
  }, []);

  // Sync E2EE enabled flag for the active unlocked account without blocking initial render
  useEffect(() => {
    const unlockedSession = isLoggedIn && Boolean(getAccessToken()) && !isLocked && !readSessionLockedFlag();
    if (!unlockedSession) {
      setIsE2eeEnabled(false);
      return;
    }

    let cancelled = false;
    void e2ee
      .getUserStatus()
      .then((status) => {
        if (!cancelled) {
          setIsE2eeEnabled(Boolean(status?.enabled));
        }
      })
      .catch(() => {
        // Keep conservative false/previous state on transient network failure
      });

    return () => {
      cancelled = true;
    };
  }, [isLoggedIn, isLocked, currentUser?.id]);

  // Track IdleSessionLock transitions and local WebMCP preference toggles from Settings cards
  useEffect(() => {
    const handleLockChange = (event: Event): void => {
      const customEvent = event as CustomEvent<{ locked?: boolean }>;
      if (typeof customEvent.detail?.locked === "boolean") {
        setIsLocked(customEvent.detail.locked);
      } else {
        setIsLocked(readSessionLockedFlag());
      }
    };
    const handlePaused = (): void => {
      setIsLocked(true);
    };
    const handlePrefChange = (event: Event): void => {
      const customEvent = event as CustomEvent<{ enabled?: boolean }>;
      if (typeof customEvent.detail?.enabled === "boolean") {
        setIsEnabledState(customEvent.detail.enabled);
      } else {
        setIsEnabledState(isWebMcpPreferenceEnabled());
      }
    };

    window.addEventListener("dns_worker_lock_changed", handleLockChange);
    window.addEventListener("session_paused", handlePaused);
    window.addEventListener(WEBMCP_PREF_CHANGED_EVENT, handlePrefChange);
    return () => {
      window.removeEventListener("dns_worker_lock_changed", handleLockChange);
      window.removeEventListener("session_paused", handlePaused);
      window.removeEventListener(WEBMCP_PREF_CHANGED_EVENT, handlePrefChange);
    };
  }, []);

  // Reconcile runtime state on every relevant auth/lock/profile/preference transition
  useEffect(() => {
    const hasToken = Boolean(getAccessToken());
    const nextState: WebMcpRuntimeState = {
      isSupported,
      isEnabled,
      isLoggedIn: isLoggedIn && hasToken,
      isLocked: isLocked || readSessionLockedFlag(),
      isDemoMode,
      isE2eeEnabled,
      isE2eeUnlocked: e2ee.isUnlocked(),
      userRole: currentUser?.role ?? null,
      activeProfileId,
      deploymentMode,
    };

    webMcpRegistry.setRuntimeState(nextState);
    setActiveToolNames(webMcpRegistry.getInspectionSnapshot().activeToolNames);
  }, [
    isSupported,
    isEnabled,
    isLoggedIn,
    isLocked,
    isDemoMode,
    isE2eeEnabled,
    deploymentMode,
    currentUser,
    activeProfileId,
  ]);

  return {
    isSupported,
    isEnabled,
    setEnabled,
    activeToolNames,
  };
}
