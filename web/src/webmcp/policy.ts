/**
 * @file policy.ts
 * @description Centralized security and capability policy evaluator for WebMCP tool registration and execution.
 * Enforces authentication, session lock state, RBAC roles, Demo Mode restrictions, E2EE unlock state,
 * and human-in-the-loop confirmation before mutating tools execute.
 */

import { emitWebMcpPreferenceChanged } from "./events";
import type {
  AppToolDefinition,
  HumanConfirmFn,
  ToolCapabilityPolicy,
  WebMcpClient,
  WebMcpErrorCode,
  WebMcpRuntimeState,
} from "./types";

const WEBMCP_ENABLED_STORAGE_KEY = "dns_worker_webmcp_enabled";

export interface PolicyEvaluationResult {
  allowed: boolean;
  code?: WebMcpErrorCode;
  reason?: string;
}

type StorageLike = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
};

type WebMcpGlobalEnv = typeof globalThis & {
  localStorage?: StorageLike;
  navigator?: { modelContext?: unknown };
};

function getGlobalStorage(): StorageLike | undefined {
  return (globalThis as WebMcpGlobalEnv).localStorage;
}

/**
 * Reads user preference controlling whether WebMCP tools may be exposed in this browser.
 * Defaults to `true` (browser feature detection + login/lock gates remain strictly enforced).
 */
export function isWebMcpPreferenceEnabled(): boolean {
  const storage = getGlobalStorage();
  if (!storage) {
    return true;
  }
  try {
    return storage.getItem(WEBMCP_ENABLED_STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

/**
 * Persists user preference for exposing WebMCP tools on this device and notifies active listeners.
 */
export function setWebMcpPreferenceEnabled(enabled: boolean): void {
  const storage = getGlobalStorage();
  if (storage) {
    try {
      storage.setItem(WEBMCP_ENABLED_STORAGE_KEY, enabled ? "true" : "false");
    } catch {
      // Ignore storage quota/security errors in restricted contexts
    }
  }
  emitWebMcpPreferenceChanged(enabled);
}

/**
 * Checks whether the current browser runtime exposes the WebMCP `navigator.modelContext` API.
 */
export function isBrowserWebMcpSupported(): boolean {
  const nav = (globalThis as WebMcpGlobalEnv).navigator;
  return Boolean(nav && "modelContext" in nav && nav.modelContext);
}

/**
 * Evaluates whether a tool should currently be registered/visible to AI agents
 * given the active session, lock, role, and Demo Mode state.
 */
export function isToolEligibleForRegistration(
  policy: ToolCapabilityPolicy,
  state: WebMcpRuntimeState
): boolean {
  if (!state.isSupported || !state.isEnabled) {
    return false;
  }
  if (policy.requiresAuth !== false && !state.isLoggedIn) {
    return false;
  }
  if (policy.requiresUnlocked !== false && state.isLocked) {
    return false;
  }
  if (policy.roleScope === "admin" && state.userRole !== "admin") {
    return false;
  }
  if (policy.access === "write" && state.isDemoMode && policy.allowInDemoMode !== true) {
    return false;
  }
  return true;
}

/**
 * Validates all runtime security gates immediately prior to tool execution.
 * Failing closed here protects against stale registrations or race conditions during lock transitions.
 */
export async function evaluateToolExecutionPolicy<TInput extends Record<string, unknown>>(
  tool: AppToolDefinition<TInput>,
  input: TInput,
  state: WebMcpRuntimeState,
  client?: WebMcpClient,
  confirmWriteFn?: HumanConfirmFn
): Promise<PolicyEvaluationResult> {
  const { policy } = tool;

  if (!state.isEnabled) {
    return { allowed: false, code: "WEBMCP_DISABLED", reason: "WebMCP integration is disabled by user preference." };
  }
  if (policy.requiresAuth !== false && !state.isLoggedIn) {
    return { allowed: false, code: "AUTH_REQUIRED", reason: "Authentication is required before invoking WebMCP tools." };
  }
  if (policy.requiresUnlocked !== false && state.isLocked) {
    return { allowed: false, code: "SESSION_LOCKED", reason: "Session is currently locked; unlock with your PIN first." };
  }
  if (policy.roleScope === "admin" && state.userRole !== "admin") {
    return { allowed: false, code: "FORBIDDEN_ROLE", reason: "Administrator role is required for this tool." };
  }
  if (policy.access === "write" && state.isDemoMode && policy.allowInDemoMode !== true) {
    return { allowed: false, code: "DEMO_MODE_READONLY", reason: "Mutating operations are disabled in Demo Mode." };
  }
  if (policy.requiresE2eeUnlocked && state.isE2eeEnabled && !state.isE2eeUnlocked) {
    return {
      allowed: false,
      code: "E2EE_LOCKED",
      reason: "End-to-end encryption is enabled, but the decryption key is not unlocked in memory yet.",
    };
  }

  if (policy.access === "write") {
    const summary = tool.confirmDescription
      ? tool.confirmDescription(input)
      : `Confirm executing write action "${tool.name}"?`;

    if (!confirmWriteFn) {
      return {
        allowed: false,
        code: "CONFIRMATION_DENIED",
        reason: "No human confirmation handler is configured for mutating WebMCP tools.",
      };
    }

    let confirmed = false;
    try {
      confirmed = await confirmWriteFn(tool.name, summary, client);
    } catch {
      confirmed = false;
    }

    if (!confirmed) {
      return {
        allowed: false,
        code: "CONFIRMATION_DENIED",
        reason: "Write operation was cancelled or denied during human confirmation.",
      };
    }
  }

  return { allowed: true };
}
