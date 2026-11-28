/**
 * @file baseTools.ts
 * @description Minimal read-only diagnostic tools belonging strictly to the WebMCP foundation layer.
 * Feature modules (rules, logs, filter lists, access points) register their own groups separately.
 */

import type { WebMcpRegistry } from "./registry";
import type { AppToolDefinition } from "./types";

/**
 * Creates the foundational read-only WebMCP tools bound to the target registry instance.
 */
export function createBaseWebMcpTools(registry: WebMcpRegistry): AppToolDefinition[] {
  return [
    {
      name: "dnsworker_get_session_context",
      description:
        "Returns sanitized DNS Worker Web Console session context (deployment mode, demo mode flag, active profile ID, E2EE status, and user role) without exposing secrets or tokens.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        destructiveHint: false,
      },
      policy: {
        access: "read",
        requiresAuth: true,
        requiresUnlocked: true,
        allowInDemoMode: true,
        roleScope: "user",
      },
      execute: async (_input, { runtimeState }) => ({
        deploymentMode: runtimeState.deploymentMode,
        isDemoMode: runtimeState.isDemoMode,
        userRole: runtimeState.userRole,
        activeProfileId: runtimeState.activeProfileId,
        e2ee: {
          enabled: runtimeState.isE2eeEnabled,
          unlocked: runtimeState.isE2eeUnlocked,
        },
      }),
    },
    {
      name: "dnsworker_list_capabilities",
      description:
        "Lists currently active WebMCP capability groups and registered tool names for this DNS Worker session.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        destructiveHint: false,
      },
      policy: {
        access: "read",
        requiresAuth: true,
        requiresUnlocked: true,
        allowInDemoMode: true,
        roleScope: "user",
      },
      execute: async () => registry.getInspectionSnapshot(),
    },
  ];
}
