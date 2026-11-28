/**
 * @file accessPointsTools.ts
 * @description Phase 3 WebMCP tools for inspecting and managing device Access Point bindings:
 *   - `dnsworker_list_access_points` (read, token omitted)
 *   - `dnsworker_bind_access_point` (write + HITL confirmation)
 *   - `dnsworker_create_access_point` (write + HITL confirmation, token omitted)
 * Note: Token rotation (`rotateAccessPointToken`) and Access Point deletion remain permanently excluded.
 */

import type { AccessPoint } from "../../services";
import { emitWebMcpDataChanged } from "../events";
import { boundResultList, sanitizeUntrustedString, wrapUntrustedData } from "../sanitize";
import { defineWebMcpTool, type AppToolDefinition } from "../types";
import {
  parsePositiveIntInput,
  resolveProfileIdInput,
  validateAccessPointIdInput,
  validateDeviceTypeInput,
  validateDisplayNameInput,
} from "./validation";

const MAX_ACCESS_POINTS_LIMIT = 50;

export interface AccessPointsToolDeps {
  getAccessPoints: () => Promise<AccessPoint[]>;
  updateAccessPoint: (
    apId: string,
    updates: { name?: string; profile_id?: string | null; device_type?: string }
  ) => Promise<AccessPoint>;
  createAccessPoint: (
    name: string,
    profileId?: string | null,
    deviceType?: string
  ) => Promise<AccessPoint>;
}

interface ListAccessPointsInput extends Record<string, unknown> {
  scope?: "all" | "profile" | "unbound";
  profileId?: string;
  limit?: number;
}

interface BindAccessPointInput extends Record<string, unknown> {
  apId: string;
  profileId?: string | null;
  name?: string;
  deviceType?: string;
}

interface CreateAccessPointInput extends Record<string, unknown> {
  name: string;
  profileId?: string | null;
  deviceType?: string;
}

function projectSafeAccessPoint(ap: AccessPoint): Record<string, unknown> {
  return {
    id: ap.id,
    name: sanitizeUntrustedString(ap.name, 64),
    profile_id: ap.profile_id ?? null,
    device_type: ap.device_type ? sanitizeUntrustedString(ap.device_type, 32) : undefined,
    hasToken: Boolean(ap.token),
    created_at: ap.created_at,
    updated_at: ap.updated_at ?? null,
  };
}

/**
 * Creates the `access_points` WebMCP tool group for safe device inspection and Profile binding.
 */
export function createAccessPointsWebMcpTools(deps: AccessPointsToolDeps): AppToolDefinition[] {
  const listAccessPointsTool = defineWebMcpTool<ListAccessPointsInput>({
    name: "dnsworker_list_access_points",
    description:
      "Lists user-owned DNS Access Points with their bound Profile IDs and device types (secret endpoint tokens are never exposed).",
    inputSchema: {
      type: "object",
      properties: {
        scope: {
          type: "string",
          enum: ["all", "profile", "unbound"],
          description: "Filter mode: 'all' (default), 'profile', or 'unbound'.",
        },
        profileId: {
          type: "string",
          description: "Target Profile ID when scope is 'profile' (defaults to active Profile).",
        },
        limit: {
          type: "number",
          minimum: 1,
          maximum: MAX_ACCESS_POINTS_LIMIT,
          description: "Maximum Access Points to return (default 50).",
        },
      },
      additionalProperties: false,
    },
    policy: {
      access: "read",
      requiresAuth: true,
      requiresUnlocked: true,
    },
    validateInput: (raw) => {
      const scope = raw.scope === undefined ? "all" : raw.scope;
      if (scope !== "all" && scope !== "profile" && scope !== "unbound") {
        return { ok: false, error: "scope must be 'all', 'profile', or 'unbound'." };
      }

      let profileId: string | undefined;
      if (raw.profileId !== undefined && raw.profileId !== "") {
        const res = resolveProfileIdInput(raw.profileId, null);
        if (!res.ok) return res;
        profileId = res.value;
      }

      let limit = MAX_ACCESS_POINTS_LIMIT;
      if (raw.limit !== undefined) {
        const limRes = parsePositiveIntInput(raw.limit, "limit");
        if (!limRes.ok) return limRes;
        if (limRes.value > MAX_ACCESS_POINTS_LIMIT) {
          return { ok: false, error: `limit cannot exceed ${MAX_ACCESS_POINTS_LIMIT}.` };
        }
        limit = limRes.value;
      }

      return { ok: true, value: { scope, profileId, limit } };
    },
    execute: async (input, { runtimeState }) => {
      const allAps = await deps.getAccessPoints();
      const scope = input.scope ?? "all";
      let targetProfileId: string | undefined;

      if (scope === "profile") {
        const pidRes = resolveProfileIdInput(input.profileId, runtimeState.activeProfileId);
        if (!pidRes.ok) throw new Error(pidRes.error);
        targetProfileId = pidRes.value;
      }

      const filtered = allAps.filter((ap) => {
        if (scope === "unbound") return !ap.profile_id;
        if (scope === "profile") return ap.profile_id === targetProfileId;
        return true;
      });

      const bounded = boundResultList(filtered, input.limit ?? MAX_ACCESS_POINTS_LIMIT);
      return wrapUntrustedData("access_points", {
        scope,
        totalConfigured: allAps.length,
        totalMatching: filtered.length,
        returnedCount: bounded.items.length,
        truncated: bounded.truncated,
        accessPoints: bounded.items.map(projectSafeAccessPoint),
      });
    },
  });

  const bindAccessPointTool = defineWebMcpTool<BindAccessPointInput>({
    name: "dnsworker_bind_access_point",
    description:
      "Updates an Access Point's Profile binding (assigning a Profile ID or null to unbind), display name, or device type (requires human confirmation).",
    inputSchema: {
      type: "object",
      properties: {
        apId: { type: "string", description: "Access Point ID to update." },
        profileId: {
          type: ["string", "null"],
          description: "Target Profile ID to bind, or null to unbind.",
        },
        name: { type: "string", description: "Optional updated display name (1–64 chars)." },
        deviceType: { type: "string", description: "Optional device type tag (e.g., router, iphone, macos)." },
      },
      required: ["apId"],
      additionalProperties: false,
    },
    policy: {
      access: "write",
      requiresAuth: true,
      requiresUnlocked: true,
    },
    confirmDescription: (input) => {
      const parts: string[] = [`Update Access Point ${input.apId}`];
      if (input.profileId !== undefined) {
        parts.push(input.profileId === null ? "unbind Profile" : `bind -> profile ${input.profileId}`);
      }
      if (input.name !== undefined) {
        parts.push(`rename -> "${sanitizeUntrustedString(input.name, 48)}"`);
      }
      if (input.deviceType !== undefined) {
        parts.push(`deviceType -> ${input.deviceType}`);
      }
      return `${parts.join(", ")}?`;
    },
    validateInput: (raw) => {
      const apRes = validateAccessPointIdInput(raw.apId);
      if (!apRes.ok) return apRes;

      if (raw.profileId === undefined && raw.name === undefined && raw.deviceType === undefined) {
        return { ok: false, error: "Provide at least one field to update (profileId, name, or deviceType)." };
      }

      let profileId: string | null | undefined;
      if (raw.profileId !== undefined) {
        if (raw.profileId === null) {
          profileId = null;
        } else {
          const pidRes = resolveProfileIdInput(raw.profileId, null);
          if (!pidRes.ok) return pidRes;
          profileId = pidRes.value;
        }
      }

      let name: string | undefined;
      if (raw.name !== undefined) {
        const nameRes = validateDisplayNameInput(raw.name, "name");
        if (!nameRes.ok) return nameRes;
        name = nameRes.value;
      }

      let deviceType: string | undefined;
      if (raw.deviceType !== undefined) {
        const dtRes = validateDeviceTypeInput(raw.deviceType);
        if (!dtRes.ok) return dtRes;
        deviceType = dtRes.value;
      }

      return { ok: true, value: { apId: apRes.value, profileId, name, deviceType } };
    },
    execute: async (input) => {
      const updates: { name?: string; profile_id?: string | null; device_type?: string } = {};
      if (input.profileId !== undefined) updates.profile_id = input.profileId;
      if (input.name !== undefined) updates.name = input.name;
      if (input.deviceType !== undefined) updates.device_type = input.deviceType;

      const updated = await deps.updateAccessPoint(input.apId, updates);
      emitWebMcpDataChanged({
        scope: "access_points",
        profileId: typeof input.profileId === "string" ? input.profileId : undefined,
      });
      return {
        updated: true,
        accessPoint: projectSafeAccessPoint(updated),
      };
    },
  });

  const createAccessPointTool = defineWebMcpTool<CreateAccessPointInput>({
    name: "dnsworker_create_access_point",
    description:
      "Creates a new device Access Point and optionally binds it to a Profile (requires human confirmation; secret routing token stays inside dashboard Setup view).",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Display name for the new Access Point (1–64 chars)." },
        profileId: {
          type: ["string", "null"],
          description: "Optional Profile ID to bind (defaults to active Profile when omitted; pass null for unbound).",
        },
        deviceType: { type: "string", description: "Optional device type tag (e.g., router, android, windows)." },
      },
      required: ["name"],
      additionalProperties: false,
    },
    policy: {
      access: "write",
      requiresAuth: true,
      requiresUnlocked: true,
    },
    confirmDescription: (input) =>
      `Create Access Point "${sanitizeUntrustedString(input.name, 64)}"` +
      (input.profileId === null
        ? " (unbound)"
        : input.profileId
        ? ` bound to profile ${input.profileId}`
        : " bound to active profile") +
      "?",
    validateInput: (raw) => {
      const nameRes = validateDisplayNameInput(raw.name, "name");
      if (!nameRes.ok) return nameRes;

      let profileId: string | null | undefined;
      if (raw.profileId === null) {
        profileId = null;
      } else if (raw.profileId !== undefined && raw.profileId !== "") {
        const pidRes = resolveProfileIdInput(raw.profileId, null);
        if (!pidRes.ok) return pidRes;
        profileId = pidRes.value;
      }

      let deviceType: string | undefined;
      if (raw.deviceType !== undefined && raw.deviceType !== "") {
        const dtRes = validateDeviceTypeInput(raw.deviceType);
        if (!dtRes.ok) return dtRes;
        deviceType = dtRes.value;
      }

      return { ok: true, value: { name: nameRes.value, profileId, deviceType } };
    },
    execute: async (input, { runtimeState }) => {
      const resolvedProfileId =
        input.profileId === null ? null : input.profileId ?? runtimeState.activeProfileId ?? null;

      const created = await deps.createAccessPoint(input.name, resolvedProfileId, input.deviceType);
      emitWebMcpDataChanged({
        scope: "access_points",
        profileId: resolvedProfileId ?? undefined,
      });

      return {
        created: true,
        accessPoint: projectSafeAccessPoint(created),
        hint: "Access Point secret tokens and connection URLs are omitted from AI outputs; view them in Setup or Manage Access Points.",
      };
    },
  });

  return [
    listAccessPointsTool,
    bindAccessPointTool,
    createAccessPointTool,
  ] as AppToolDefinition[];
}
