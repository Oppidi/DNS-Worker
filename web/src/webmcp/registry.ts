/**
 * @file registry.ts
 * @description Centralized WebMCP tool registry and policy-enforced execution harness.
 * Decouples business tool modules from `navigator.modelContext` lifecycle and fail-closed security guards.
 */

import { evaluateToolExecutionPolicy, isToolEligibleForRegistration } from "./policy";
import { sanitizeUntrustedString } from "./sanitize";
import type {
  AppToolDefinition,
  HumanConfirmFn,
  NavigatorModelContext,
  WebMcpClient,
  WebMcpErrorCode,
  WebMcpNativeToolDescriptor,
  WebMcpRuntimeState,
  WebMcpToolResult,
} from "./types";

const DEFAULT_TOOL_TIMEOUT_MS = 15_000;

export interface WebMcpRegistryOptions {
  /** Overrides `navigator.modelContext` resolution (useful for deterministic unit testing). */
  getModelContext?: () => NavigatorModelContext | null;
  /** Overrides write-action human confirmation prompt (defaults to WebMCP interaction + confirm). */
  confirmWriteFn?: HumanConfirmFn;
  /** Execution timeout in milliseconds per tool invocation. */
  timeoutMs?: number;
}

const DEFAULT_RUNTIME_STATE: WebMcpRuntimeState = {
  isSupported: false,
  isEnabled: false,
  isLoggedIn: false,
  isLocked: true,
  isDemoMode: false,
  isE2eeEnabled: false,
  isE2eeUnlocked: false,
  userRole: null,
  activeProfileId: null,
  deploymentMode: "cloudflare",
};

/**
 * Formats a successful structured payload into a compliant WebMCP tool result.
 */
export function formatToolSuccess(data: unknown): WebMcpToolResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({ ok: true, data }),
      },
    ],
  };
}

/**
 * Formats a structured error payload without leaking stack traces or triggering page redirects.
 */
export function formatToolError(code: WebMcpErrorCode, message: string): WebMcpToolResult {
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: JSON.stringify({
          ok: false,
          error: {
            code,
            message: sanitizeUntrustedString(message, 512),
          },
        }),
      },
    ],
  };
}

type BrowserWebMcpHostGlobals = typeof globalThis & {
  window?: { confirm?: (message?: string) => boolean };
  navigator?: { modelContext?: NavigatorModelContext };
};

/**
 * Default browser human-in-the-loop confirmation handler for mutating (`write`) WebMCP tools.
 * Uses `client.requestUserInteraction` when available, falling back to `window.confirm`,
 * and failing closed in headless/non-interactive contexts.
 */
export async function defaultHumanConfirm(
  _toolName: string,
  summary: string,
  client?: WebMcpClient
): Promise<boolean> {
  const host = globalThis as BrowserWebMcpHostGlobals;
  const confirmFn = host.window?.confirm;
  if (typeof confirmFn !== "function") {
    return false;
  }
  const promptText = `[DNS Worker WebMCP]\n${summary}`;
  if (client?.requestUserInteraction) {
    return Boolean(await client.requestUserInteraction(async () => confirmFn(promptText)));
  }
  return Boolean(confirmFn(promptText));
}

function defaultGetModelContext(): NavigatorModelContext | null {
  const host = globalThis as BrowserWebMcpHostGlobals;
  return host.navigator?.modelContext ?? null;
}

/**
 * Manages grouped application tool definitions and synchronizes active browser registrations
 * with live authentication, lock, RBAC, and Demo Mode runtime state.
 */
export class WebMcpRegistry {
  private readonly groups = new Map<string, AppToolDefinition[]>();
  private readonly activeNames = new Set<string>();
  private runtimeState: WebMcpRuntimeState = DEFAULT_RUNTIME_STATE;
  private readonly getModelContext: () => NavigatorModelContext | null;
  private readonly confirmWriteFn: HumanConfirmFn;
  private readonly timeoutMs: number;

  constructor(options: WebMcpRegistryOptions = {}) {
    this.getModelContext = options.getModelContext ?? defaultGetModelContext;
    this.confirmWriteFn = options.confirmWriteFn ?? defaultHumanConfirm;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS;
  }

  /**
   * Registers or replaces a named module group of tools (for example `'base'`, `'rules'`, `'logs'`),
   * immediately syncing eligibility against the current runtime state.
   */
  registerGroup(groupName: string, tools: readonly AppToolDefinition[]): void {
    this.groups.set(groupName, [...tools]);
    this.syncRegistrations();
  }

  /**
   * Removes an entire tool group and unregisters its tools from the browser context.
   */
  unregisterGroup(groupName: string): void {
    if (!this.groups.has(groupName)) {
      return;
    }
    this.groups.delete(groupName);
    this.syncRegistrations();
  }

  /**
   * Updates live security/runtime state and reconciles active browser tool registrations.
   */
  setRuntimeState(nextState: WebMcpRuntimeState): void {
    this.runtimeState = nextState;
    this.syncRegistrations();
  }

  /**
   * Returns a shallow snapshot of registered groups and active tool names.
   */
  getInspectionSnapshot(): {
    groups: Array<{ group: string; toolNames: string[] }>;
    activeToolNames: string[];
  } {
    const groups: Array<{ group: string; toolNames: string[] }> = [];
    for (const [group, tools] of this.groups.entries()) {
      groups.push({ group, toolNames: tools.map((t) => t.name) });
    }
    return {
      groups,
      activeToolNames: Array.from(this.activeNames),
    };
  }

  /**
   * Invokes a registered tool by name directly (primary testability seam and unified executor).
   */
  async invokeTool(
    name: string,
    rawInput: Record<string, unknown> = {},
    client?: WebMcpClient
  ): Promise<WebMcpToolResult> {
    const tool = this.findToolByName(name);
    if (!tool) {
      return formatToolError("INVALID_INPUT", `Unknown WebMCP tool: ${name}`);
    }
    return this.executeWrapped(tool, rawInput, client);
  }

  private findToolByName(name: string): AppToolDefinition | undefined {
    for (const tools of this.groups.values()) {
      const hit = tools.find((item) => item.name === name);
      if (hit) {
        return hit;
      }
    }
    return undefined;
  }

  private syncRegistrations(): void {
    const modelContext = this.getModelContext();
    if (!modelContext || typeof modelContext.registerTool !== "function") {
      this.activeNames.clear();
      return;
    }

    const desiredTools = new Map<string, AppToolDefinition>();
    for (const tools of this.groups.values()) {
      for (const tool of tools) {
        if (isToolEligibleForRegistration(tool.policy, this.runtimeState)) {
          desiredTools.set(tool.name, tool);
        }
      }
    }

    // Remove tools that are no longer eligible (e.g., locked, logged out, disabled, role change)
    for (const registeredName of Array.from(this.activeNames)) {
      if (!desiredTools.has(registeredName)) {
        try {
          modelContext.unregisterTool?.(registeredName);
        } catch {
          // Ignore browser cleanup failures when tab/context is tearing down
        }
        this.activeNames.delete(registeredName);
      }
    }

    // If session is locked, logged out, or disabled and browser exposes clearContext, ensure clean slate
    if (desiredTools.size === 0 && typeof modelContext.clearContext === "function") {
      try {
        modelContext.clearContext();
      } catch {
        // Ignore clearContext errors on partial browser implementations
      }
    }

    // Register newly eligible tools
    for (const [name, tool] of desiredTools.entries()) {
      if (!this.activeNames.has(name)) {
        try {
          modelContext.registerTool(this.toNativeDescriptor(tool));
          this.activeNames.add(name);
        } catch (err) {
          console.warn(`[WebMCP] Failed to register tool "${name}":`, err);
        }
      }
    }
  }

  private toNativeDescriptor(tool: AppToolDefinition): WebMcpNativeToolDescriptor {
    return {
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      annotations: tool.annotations ?? {
        readOnlyHint: tool.policy.access === "read",
      },
      execute: (input, client) => this.executeWrapped(tool, input ?? {}, client),
    };
  }

  private async executeWrapped(
    tool: AppToolDefinition,
    rawInput: Record<string, unknown>,
    client?: WebMcpClient
  ): Promise<WebMcpToolResult> {
    const safeRawInput = rawInput && typeof rawInput === "object" && !Array.isArray(rawInput) ? rawInput : {};
    let validatedInput = safeRawInput;

    if (tool.validateInput) {
      const validation = tool.validateInput(safeRawInput);
      if (!validation.ok) {
        return formatToolError("INVALID_INPUT", validation.error);
      }
      validatedInput = validation.value;
    }

    const policyCheck = await evaluateToolExecutionPolicy(
      tool,
      validatedInput,
      this.runtimeState,
      client,
      this.confirmWriteFn
    );
    if (!policyCheck.allowed) {
      return formatToolError(policyCheck.code ?? "WEBMCP_DISABLED", policyCheck.reason ?? "Tool execution denied.");
    }

    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      const executionPromise = tool.execute(validatedInput, {
        runtimeState: this.runtimeState,
        client,
      });

      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`TOOL_TIMEOUT:${this.timeoutMs}`));
        }, this.timeoutMs);
      });

      const result = await Promise.race([executionPromise, timeoutPromise]);
      return formatToolSuccess(result);
    } catch (err: unknown) {
      if (err instanceof Error && err.message.startsWith("TOOL_TIMEOUT:")) {
        return formatToolError("EXECUTION_TIMEOUT", `Tool "${tool.name}" timed out after ${this.timeoutMs}ms.`);
      }
      const message = err instanceof Error ? err.message : "Unexpected WebMCP tool execution error.";
      return formatToolError("INTERNAL_ERROR", message);
    } finally {
      if (timer !== null) {
        clearTimeout(timer);
      }
    }
  }
}

/** Shared singleton registry used by the Web Console and modular feature tool packs. */
export const webMcpRegistry = new WebMcpRegistry();
