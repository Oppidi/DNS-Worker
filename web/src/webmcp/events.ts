/**
 * @file events.ts
 * @description Lightweight browser custom-event helpers synchronizing WebMCP state, user preferences,
 * and dashboard view refreshes after agent-driven mutations. Safe in non-DOM/Node environments.
 */

export const WEBMCP_DATA_CHANGED_EVENT = "dns_worker_webmcp_data_changed";
export const WEBMCP_PREF_CHANGED_EVENT = "dns_worker_webmcp_pref_changed";
export const WEBMCP_TOOLS_CHANGED_EVENT = "dns_worker_webmcp_tools_changed";

export type WebMcpDataScope = "rules" | "filtering" | "user_lists" | "all";

export interface WebMcpDataChangedDetail {
  scope: WebMcpDataScope;
  profileId?: string;
}

type EventTargetGlobals = typeof globalThis & {
  window?: {
    dispatchEvent?: (event: Event) => boolean;
    addEventListener?: (type: string, listener: EventListener) => void;
    removeEventListener?: (type: string, listener: EventListener) => void;
  };
  CustomEvent?: new <T>(type: string, eventInitDict?: { detail?: T }) => CustomEvent<T>;
};

/**
 * Dispatches an in-page notification when a WebMCP mutating tool updates rules or filter subscriptions
 * so open UI panels refresh without forcing a full browser reload.
 */
export function emitWebMcpDataChanged(detail: WebMcpDataChangedDetail): void {
  const host = globalThis as EventTargetGlobals;
  if (!host.window?.dispatchEvent || typeof host.CustomEvent !== "function") {
    return;
  }
  host.window.dispatchEvent(new host.CustomEvent(WEBMCP_DATA_CHANGED_EVENT, { detail }));
}

/**
 * Subscribes a React view or hook to WebMCP mutation events matching the requested data scope.
 */
export function subscribeWebMcpDataChanged(
  handler: (detail: WebMcpDataChangedDetail) => void
): () => void {
  const host = globalThis as EventTargetGlobals;
  if (!host.window?.addEventListener || !host.window?.removeEventListener) {
    return () => {};
  }
  const listener: EventListener = (event: Event): void => {
    const custom = event as CustomEvent<WebMcpDataChangedDetail>;
    if (custom.detail) {
      handler(custom.detail);
    }
  };
  host.window.addEventListener(WEBMCP_DATA_CHANGED_EVENT, listener);
  return () => {
    host.window?.removeEventListener?.(WEBMCP_DATA_CHANGED_EVENT, listener);
  };
}

/**
 * Broadcasts local WebMCP preference toggles (`enabled`/`disabled`) between Settings UI cards and `useWebMcpBridge`.
 */
export function emitWebMcpPreferenceChanged(enabled: boolean): void {
  const host = globalThis as EventTargetGlobals;
  if (!host.window?.dispatchEvent || typeof host.CustomEvent !== "function") {
    return;
  }
  host.window.dispatchEvent(new host.CustomEvent(WEBMCP_PREF_CHANGED_EVENT, { detail: { enabled } }));
}

/**
 * Notifies UI status cards whenever `WebMcpRegistry` reconciles its active tool list.
 */
export function emitWebMcpToolsChanged(): void {
  const host = globalThis as EventTargetGlobals;
  if (!host.window?.dispatchEvent || typeof host.CustomEvent !== "function") {
    return;
  }
  host.window.dispatchEvent(new host.CustomEvent(WEBMCP_TOOLS_CHANGED_EVENT));
}
