/**
 * @file types.ts
 * @description Core TypeScript contracts for the WebMCP (`navigator.modelContext`) foundation layer,
 * including browser API bindings, tool security metadata, and runtime context state.
 */

export interface WebMcpToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface WebMcpTextContent {
  type: "text";
  text: string;
}

export interface WebMcpToolResult {
  content: WebMcpTextContent[];
  isError?: boolean;
}

export interface WebMcpClient {
  requestUserInteraction?: <T>(callback: () => Promise<T>) => Promise<T>;
}

export type WebMcpJsonSchema = {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
};

export interface WebMcpNativeToolDescriptor {
  name: string;
  description: string;
  inputSchema: WebMcpJsonSchema;
  annotations?: WebMcpToolAnnotations;
  execute: (input: Record<string, unknown>, client?: WebMcpClient) => Promise<WebMcpToolResult>;
}

export interface NavigatorModelContext {
  registerTool: (tool: WebMcpNativeToolDescriptor) => void;
  unregisterTool?: (name: string) => void;
  clearContext?: () => void;
  provideContext?: (options: { tools: WebMcpNativeToolDescriptor[] }) => void;
}

export type ToolAccessLevel = "read" | "write";
export type ToolRoleScope = "user" | "admin";

export interface ToolCapabilityPolicy {
  /** Whether an active authenticated user session is required (defaults to `true`). */
  requiresAuth?: boolean;
  /** Whether the session must not be in IdleSessionLock locked state (defaults to `true`). */
  requiresUnlocked?: boolean;
  /** Whether unlocked E2EE keys are required when E2EE is enabled for the account. */
  requiresE2eeUnlocked?: boolean;
  /** Whether this tool may run while `DEMO_MODE=true` is active. */
  allowInDemoMode?: boolean;
  /** Minimum role needed to expose/execute the tool (defaults to `'user'`). */
  roleScope?: ToolRoleScope;
  /** Read vs mutating classification; `'write'` enforces human-in-the-loop confirmation. */
  access: ToolAccessLevel;
}

export interface WebMcpRuntimeState {
  isSupported: boolean;
  isEnabled: boolean;
  isLoggedIn: boolean;
  isLocked: boolean;
  isDemoMode: boolean;
  isE2eeEnabled: boolean;
  isE2eeUnlocked: boolean;
  userRole: string | null;
  activeProfileId: string | null;
  deploymentMode: "cloudflare" | "serverfull";
}

export interface AppToolExecutionContext {
  runtimeState: WebMcpRuntimeState;
  client?: WebMcpClient;
}

export type WebMcpErrorCode =
  | "WEBMCP_DISABLED"
  | "AUTH_REQUIRED"
  | "SESSION_LOCKED"
  | "FORBIDDEN_ROLE"
  | "DEMO_MODE_READONLY"
  | "E2EE_LOCKED"
  | "CONFIRMATION_DENIED"
  | "INVALID_INPUT"
  | "EXECUTION_TIMEOUT"
  | "INTERNAL_ERROR";

export type AppToolHandler<TInput extends Record<string, unknown> = Record<string, unknown>> = (
  input: TInput,
  ctx: AppToolExecutionContext
) => Promise<unknown>;

export interface AppToolDefinition<TInput extends Record<string, unknown> = Record<string, unknown>> {
  name: string;
  description: string;
  inputSchema: WebMcpJsonSchema;
  annotations?: WebMcpToolAnnotations;
  policy: ToolCapabilityPolicy;
  /** Optional explicit human confirmation prompt callback for mutating operations. */
  confirmDescription?: (input: TInput) => string;
  /** Optional input validator returning normalized payload or an error string. */
  validateInput?: (raw: Record<string, unknown>) => { ok: true; value: TInput } | { ok: false; error: string };
  execute: AppToolHandler<TInput>;
}

export type HumanConfirmFn = (toolName: string, summary: string, client?: WebMcpClient) => Promise<boolean>;
