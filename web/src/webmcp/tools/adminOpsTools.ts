/**
 * @file adminOpsTools.ts
 * @description Strictly read-only administrator WebMCP diagnostic tools (`roleScope: 'admin'`):
 *   - `dnsworker_admin_get_runtime_status`
 *   - `dnsworker_admin_get_database_status`
 *   - `dnsworker_admin_list_users_summary`
 *   - `dnsworker_admin_get_system_config_summary`
 * Destructive or privileged actions (user deletion, DB snapshot restore, service restarts) remain permanently excluded.
 */

import type {
  DatabaseSnapshotOverview,
  DatabaseStatusResponse,
  DistributedFilterItem,
  InviteCodeInfo,
  ServerfullRuntimeStatus,
  UserInfo,
} from "../../services";
import { boundResultList, sanitizeUntrustedString, wrapUntrustedData } from "../sanitize";
import { defineWebMcpTool, type AppToolDefinition } from "../types";
import { parsePositiveIntInput } from "./validation";

const MAX_USERS_LIMIT = 50;
const SECRET_SETTING_KEY_REGEX = /(secret|token|password|private|key|salt|jwt)/i;

export interface AdminOpsToolDeps {
  getRuntimeStatus: (forceRefresh?: boolean) => Promise<ServerfullRuntimeStatus>;
  getDatabaseStatus: () => Promise<DatabaseStatusResponse>;
  getDatabaseSnapshots: () => Promise<DatabaseSnapshotOverview>;
  getUsers: () => Promise<UserInfo[]>;
  getSystemSettings: () => Promise<Record<string, string>>;
  getInviteCodes: () => Promise<InviteCodeInfo[]>;
  getDistributedFilters: () => Promise<DistributedFilterItem[]>;
}

interface GetRuntimeStatusInput extends Record<string, unknown> {
  forceRefresh?: boolean;
}

interface GetDatabaseStatusInput extends Record<string, unknown> {
  includeSnapshots?: boolean;
}

interface ListUsersSummaryInput extends Record<string, unknown> {
  limit?: number;
}

function projectSafeDatabaseStatus(
  status: DatabaseStatusResponse,
  snapshots?: DatabaseSnapshotOverview | null
): Record<string, unknown> {
  const storage = snapshots?.storage ?? status.snapshotOverview?.storage ?? null;
  const items = snapshots?.snapshots ?? status.snapshotOverview?.snapshots ?? [];

  return {
    databaseService: sanitizeUntrustedString(status.databaseService, 64),
    isTurso: status.isTurso,
    configured: status.configured,
    migrations: status.migrations,
    storageSummary: storage
      ? {
          sameFilesystem: storage.sameFilesystem,
          diskTotalBytes: storage.diskTotalBytes,
          diskFreeBytes: storage.diskFreeBytes,
          diskUsedBytes: storage.diskUsedBytes,
          dbTotalBytes: storage.dbTotalBytes,
          snapshotsTotalBytes: storage.snapshotsTotalBytes,
        }
      : null,
    snapshotSummary: {
      supported: Boolean(snapshots?.supported ?? status.snapshotOverview?.supported),
      count: items.length,
      latestCreatedAt: items[0]?.createdAt ?? null,
      activeCapture: snapshots?.activeCapture ?? status.snapshotOverview?.activeCapture ?? null,
    },
  };
}

/**
 * Creates the read-only `admin_ops` WebMCP tool group gated by `roleScope: "admin"`.
 */
export function createAdminOpsWebMcpTools(deps: AdminOpsToolDeps): AppToolDefinition[] {
  const getRuntimeStatusTool = defineWebMcpTool<GetRuntimeStatusInput>({
    name: "dnsworker_admin_get_runtime_status",
    description:
      "[Admin Read-Only] Inspects Serverfull Node runtime status, version/release channel, worker count, and update availability.",
    inputSchema: {
      type: "object",
      properties: {
        forceRefresh: {
          type: "boolean",
          description: "Bypass cached npm release check when true (default false).",
        },
      },
      additionalProperties: false,
    },
    policy: {
      access: "read",
      roleScope: "admin",
      requiresAuth: true,
      requiresUnlocked: true,
    },
    validateInput: (raw) => {
      if (raw.forceRefresh !== undefined && typeof raw.forceRefresh !== "boolean") {
        return { ok: false, error: "forceRefresh must be a boolean." };
      }
      return { ok: true, value: { forceRefresh: raw.forceRefresh ?? false } };
    },
    execute: async (input) => {
      const status = await deps.getRuntimeStatus(Boolean(input.forceRefresh));
      return wrapUntrustedData("admin_runtime_status", {
        supported: status.supported,
        currentVersion: sanitizeUntrustedString(status.currentVersion, 32),
        currentChannel: status.currentChannel,
        startedAt: status.startedAt,
        runtime: sanitizeUntrustedString(status.runtime, 64),
        platform: sanitizeUntrustedString(status.platform, 64),
        installMethod: status.installMethod,
        serviceManager: status.serviceManager,
        workersCount: status.workersCount,
        canRestart: status.canRestart,
        checkedAt: status.checkedAt,
        checkError: status.checkError ? sanitizeUntrustedString(status.checkError, 200) : null,
        channels: status.channels,
      });
    },
  });

  const getDatabaseStatusTool = defineWebMcpTool<GetDatabaseStatusInput>({
    name: "dnsworker_admin_get_database_status",
    description:
      "[Admin Read-Only] Inspects active database backend (D1/Turso/Local SQLite), migration completion status, disk usage, and snapshot summary.",
    inputSchema: {
      type: "object",
      properties: {
        includeSnapshots: {
          type: "boolean",
          description: "Also query detailed snapshot metrics when supported (default true).",
        },
      },
      additionalProperties: false,
    },
    policy: {
      access: "read",
      roleScope: "admin",
      requiresAuth: true,
      requiresUnlocked: true,
    },
    validateInput: (raw) => {
      if (raw.includeSnapshots !== undefined && typeof raw.includeSnapshots !== "boolean") {
        return { ok: false, error: "includeSnapshots must be a boolean." };
      }
      return { ok: true, value: { includeSnapshots: raw.includeSnapshots ?? true } };
    },
    execute: async (input) => {
      const [status, snapshots] = await Promise.all([
        deps.getDatabaseStatus(),
        input.includeSnapshots !== false
          ? deps.getDatabaseSnapshots().catch(() => null)
          : Promise.resolve(null),
      ]);
      return wrapUntrustedData("admin_database_status", projectSafeDatabaseStatus(status, snapshots));
    },
  });

  const listUsersSummaryTool = defineWebMcpTool<ListUsersSummaryInput>({
    name: "dnsworker_admin_list_users_summary",
    description:
      "[Admin Read-Only] Lists registered DNS Worker accounts with role, MFA/Passkey, and PIN lock posture (never exposes credentials).",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          minimum: 1,
          maximum: MAX_USERS_LIMIT,
          description: "Maximum user entries to return (default 50).",
        },
      },
      additionalProperties: false,
    },
    policy: {
      access: "read",
      roleScope: "admin",
      requiresAuth: true,
      requiresUnlocked: true,
    },
    validateInput: (raw) => {
      let limit = MAX_USERS_LIMIT;
      if (raw.limit !== undefined) {
        const res = parsePositiveIntInput(raw.limit, "limit");
        if (!res.ok) return res;
        if (res.value > MAX_USERS_LIMIT) {
          return { ok: false, error: `limit cannot exceed ${MAX_USERS_LIMIT}.` };
        }
        limit = res.value;
      }
      return { ok: true, value: { limit } };
    },
    execute: async (input) => {
      const users = await deps.getUsers();
      const bounded = boundResultList(users, input.limit ?? MAX_USERS_LIMIT);
      return wrapUntrustedData("admin_users", {
        totalUsers: users.length,
        returnedCount: bounded.items.length,
        truncated: bounded.truncated,
        users: bounded.items.map((u) => ({
          id: u.id,
          username: sanitizeUntrustedString(u.username, 64),
          role: u.role,
          totp_enabled: Boolean(u.totp_enabled),
          passkeys_count: u.passkeys_count ?? 0,
          mfa_enabled: Boolean(u.mfa_enabled),
          pin_enabled: Boolean(u.pin_enabled),
          max_log_retention_days: u.max_log_retention_days ?? null,
        })),
      });
    },
  });

  const getSystemConfigSummaryTool = defineWebMcpTool<Record<string, unknown>>({
    name: "dnsworker_admin_get_system_config_summary",
    description:
      "[Admin Read-Only] Summarizes non-secret global system settings, masked invite code capacity, and system-distributed filter URLs.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    policy: {
      access: "read",
      roleScope: "admin",
      requiresAuth: true,
      requiresUnlocked: true,
    },
    execute: async () => {
      const [settings, inviteCodes, distributedFilters] = await Promise.all([
        deps.getSystemSettings(),
        deps.getInviteCodes().catch(() => [] as InviteCodeInfo[]),
        deps.getDistributedFilters().catch(() => [] as DistributedFilterItem[]),
      ]);

      const safeSettings: Record<string, string> = {};
      for (const [key, value] of Object.entries(settings)) {
        if (SECRET_SETTING_KEY_REGEX.test(key)) {
          continue;
        }
        safeSettings[sanitizeUntrustedString(key, 64)] = sanitizeUntrustedString(String(value), 256);
      }

      const boundedInvites = boundResultList(inviteCodes, 25);
      const boundedFilters = boundResultList(distributedFilters, 25);

      return wrapUntrustedData("admin_system_config", {
        settings: safeSettings,
        inviteCodesSummary: {
          totalCount: inviteCodes.length,
          activeCount: inviteCodes.filter((c) => c.remaining_uses > 0).length,
          truncated: boundedInvites.truncated,
          items: boundedInvites.items.map((c) => ({
            codePrefix: `${sanitizeUntrustedString(c.code.slice(0, 4), 4)}***`,
            max_uses: c.max_uses,
            remaining_uses: c.remaining_uses,
            expires_at: c.expires_at,
            created_at: c.created_at,
          })),
        },
        distributedFiltersSummary: {
          totalCount: distributedFilters.length,
          truncated: boundedFilters.truncated,
          items: boundedFilters.items.map((f) => ({
            url: sanitizeUntrustedString(f.url, 512),
            profileCount: f.profileCount,
            userCount: f.userCount,
          })),
        },
      });
    },
  });

  return [
    getRuntimeStatusTool,
    getDatabaseStatusTool,
    listUsersSummaryTool,
    getSystemConfigSummaryTool,
  ] as AppToolDefinition[];
}
