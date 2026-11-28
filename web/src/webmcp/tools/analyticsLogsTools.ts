/**
 * @file analyticsLogsTools.ts
 * @description Phase 1 read-only WebMCP tools for Local-First OPFS logs and profile analytics:
 *   - `dnsworker_list_profiles_summary`: lists user profiles with sanitized metadata and block policies
 *   - `dnsworker_query_local_logs`: queries locally persisted/decrypted OPFS SQLite logs
 *   - `dnsworker_get_analytics_summary`: queries aggregated metrics (local OPFS or remote fallback)
 *   - `dnsworker_get_log_detail`: inspects a single query log entry
 */

import type {
  AnalyticsData,
  LocalAnalyticsParams,
  LocalQueryLogsParams,
  LocalQueryResult,
  LocalStorageInfo,
  LogEntry,
  Profile,
  ProfileFetchOptions,
  SyncWatermark,
} from "../../services";
import { boundResultList, sanitizeUntrustedString, wrapUntrustedData } from "../sanitize";
import { defineWebMcpTool, type AppToolDefinition } from "../types";
import { parsePositiveIntInput, resolveProfileIdInput } from "./validation";

const MAX_LOG_LIMIT = 50;
const ALLOWED_LOG_ACTIONS = new Set(["PASS", "BLOCK", "REDIRECT", "FAIL"]);

export interface AnalyticsLogsToolDeps {
  getProfiles: (options?: ProfileFetchOptions) => Promise<Profile[]>;
  getProfileAnalytics: (
    profileId: string,
    type: string,
    queryParams: string,
    options?: ProfileFetchOptions
  ) => Promise<AnalyticsData>;
  getProfileLogDetails: (
    profileId: string,
    logId: number,
    timestamp?: number,
    options?: ProfileFetchOptions
  ) => Promise<LogEntry>;
  localDb: {
    getWatermark: (profileId: string) => Promise<SyncWatermark | null>;
    getStorageInfo: () => Promise<LocalStorageInfo>;
    queryLogs: (params: LocalQueryLogsParams) => Promise<LocalQueryResult>;
    queryAnalytics: (params: LocalAnalyticsParams) => Promise<AnalyticsData>;
  };
}

interface QueryLocalLogsInput extends Record<string, unknown> {
  profileId?: string;
  search?: string;
  action?: string;
  accessPointId?: string;
  since?: number;
  until?: number;
  limit: number;
  offset: number;
}

interface GetAnalyticsSummaryInput extends Record<string, unknown> {
  profileId?: string;
  hours: number;
  source: "auto" | "local" | "remote";
}

interface GetLogDetailInput extends Record<string, unknown> {
  profileId?: string;
  logId: number;
  timestamp?: number;
}

function sanitizeLogRow(row: LogEntry): Record<string, unknown> {
  return {
    id: row.id,
    timestamp: row.timestamp,
    domain: sanitizeUntrustedString(row.domain, 253),
    recordType: sanitizeUntrustedString(row.record_type, 16),
    action: row.action,
    reason: row.reason ? sanitizeUntrustedString(row.reason, 180) : null,
    clientIp: sanitizeUntrustedString(row.client_ip, 64),
    geoCountry: row.geo_country ? sanitizeUntrustedString(row.geo_country, 32) : null,
    answer: row.answer ? sanitizeUntrustedString(row.answer, 180) : null,
    accessPointName: row.access_point_name
      ? sanitizeUntrustedString(row.access_point_name, 80)
      : null,
    upstream: row.upstream ? sanitizeUntrustedString(row.upstream, 128) : null,
    latencyMs: row.latency ?? null,
    destCountry: row.dest_country ? sanitizeUntrustedString(row.dest_country, 64) : null,
    destIsp: row.dest_isp ? sanitizeUntrustedString(row.dest_isp, 128) : null,
    isEncrypted: Boolean(row.encrypted_payload),
  };
}

function sanitizeAnalyticsData(data: AnalyticsData): Record<string, unknown> {
  return {
    summary: data.summary ?? [],
    topBlocked: boundResultList(
      (data.top_blocked ?? []).map((item) => ({
        domain: sanitizeUntrustedString(item.domain, 253),
        count: item.count,
      })),
      15
    ),
    topAllowed: boundResultList(
      (data.top_allowed ?? []).map((item) => ({
        domain: sanitizeUntrustedString(item.domain, 253),
        count: item.count,
      })),
      15
    ),
    topClients: boundResultList(
      (data.clients ?? []).map((item) => ({
        clientIp: sanitizeUntrustedString(item.client_ip, 64),
        geoCountry: sanitizeUntrustedString(item.geo_country, 32),
        count: item.count,
      })),
      10
    ),
    destinations: boundResultList(
      (data.destinations ?? []).map((item) => ({
        countryCode: sanitizeUntrustedString(item.country_code, 16),
        country: sanitizeUntrustedString(item.country, 64),
        count: item.count,
      })),
      15
    ),
    trendBucketsCount: Array.isArray(data.trend) ? data.trend.length : 0,
  };
}

function parseSafeProfileSettingsSummary(settingsJson?: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(settingsJson || "{}") as Record<string, unknown>;
    return {
      defaultPolicy: parsed.default_policy ?? "ALLOW",
      blockMode: parsed.block_mode ?? "NULL_IP",
      logRetentionDays: parsed.log_retention_days ?? null,
      upstreamCount: Array.isArray(parsed.upstream) ? parsed.upstream.length : 0,
    };
  } catch {
    return {};
  }
}

/**
 * Builds the `analytics_logs` WebMCP read-only tool pack.
 */
export function createAnalyticsLogsWebMcpTools(deps: AnalyticsLogsToolDeps): AppToolDefinition[] {
  const listProfilesTool: AppToolDefinition = {
    name: "dnsworker_list_profiles_summary",
    description:
      "Lists accessible DNS Worker policy Profiles (excluding routing secret keys) along with block mode and log retention settings.",
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
    execute: async (_input, { runtimeState }) => {
      const profiles = await deps.getProfiles({ redirectOn404: false });
      return wrapUntrustedData("profiles_list", {
        activeProfileId: runtimeState.activeProfileId,
        profiles: boundResultList(
          profiles.map((p) => ({
            id: p.id,
            name: sanitizeUntrustedString(p.name, 80),
            createdAt: p.created_at,
            updatedAt: p.updated_at,
            policy: parseSafeProfileSettingsSummary(p.settings),
          })),
          50
        ),
      });
    },
  };

  const queryLocalLogsTool: AppToolDefinition<QueryLocalLogsInput> = {
    name: "dnsworker_query_local_logs",
    description:
      "Queries DNS query logs from DNS Worker's browser-local OPFS SQLite database (with transparent E2EE decryption when unlocked and zero cloud DB reads).",
    inputSchema: {
      type: "object",
      properties: {
        profileId: {
          type: "string",
          description: "Optional Profile ID; defaults to the currently selected dashboard Profile.",
        },
        search: {
          type: "string",
          description: "Optional domain/reason search filter.",
        },
        action: {
          type: "string",
          description: "Optional verdict filter: PASS, BLOCK, REDIRECT, or FAIL.",
        },
        accessPointId: {
          type: "string",
          description: "Optional Access Point ID filter.",
        },
        since: {
          type: "number",
          description: "Optional start Unix timestamp in seconds.",
        },
        until: {
          type: "number",
          description: "Optional end Unix timestamp in seconds.",
        },
        limit: {
          type: "number",
          description: "Max rows to return (1-50, defaults to 20).",
        },
        offset: {
          type: "number",
          description: "Pagination offset (defaults to 0).",
        },
      },
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
      requiresE2eeUnlocked: true,
      allowInDemoMode: true,
      roleScope: "user",
    },
    validateInput(raw) {
      if (raw.profileId !== undefined && typeof raw.profileId !== "string") {
        return { ok: false, error: "profileId must be a string." };
      }
      if (raw.search !== undefined && typeof raw.search !== "string") {
        return { ok: false, error: "search must be a string." };
      }
      let normalizedAction: string | undefined;
      if (raw.action !== undefined && raw.action !== "") {
        if (typeof raw.action !== "string") {
          return { ok: false, error: "action must be a string." };
        }
        const upper = raw.action.trim().toUpperCase();
        if (!ALLOWED_LOG_ACTIONS.has(upper)) {
          return { ok: false, error: "action must be one of PASS, BLOCK, REDIRECT, FAIL." };
        }
        normalizedAction = upper;
      }
      if (raw.accessPointId !== undefined && typeof raw.accessPointId !== "string") {
        return { ok: false, error: "accessPointId must be a string." };
      }
      if (raw.since !== undefined && (typeof raw.since !== "number" || !Number.isFinite(raw.since))) {
        return { ok: false, error: "since must be a finite Unix timestamp (seconds)." };
      }
      if (raw.until !== undefined && (typeof raw.until !== "number" || !Number.isFinite(raw.until))) {
        return { ok: false, error: "until must be a finite Unix timestamp (seconds)." };
      }
      const rawLimit = raw.limit === undefined ? 20 : raw.limit;
      if (typeof rawLimit !== "number" || !Number.isInteger(rawLimit) || rawLimit < 1) {
        return { ok: false, error: "limit must be an integer >= 1." };
      }
      const rawOffset = raw.offset === undefined ? 0 : raw.offset;
      if (typeof rawOffset !== "number" || !Number.isInteger(rawOffset) || rawOffset < 0) {
        return { ok: false, error: "offset must be a non-negative integer." };
      }

      return {
        ok: true,
        value: {
          profileId: raw.profileId,
          search: raw.search ? sanitizeUntrustedString(raw.search, 128) : undefined,
          action: normalizedAction,
          accessPointId: raw.accessPointId ? raw.accessPointId.trim() : undefined,
          since: raw.since,
          until: raw.until,
          limit: Math.min(rawLimit, MAX_LOG_LIMIT),
          offset: rawOffset,
        },
      };
    },
    execute: async (input, { runtimeState }) => {
      const profileCheck = resolveProfileIdInput(input.profileId, runtimeState.activeProfileId);
      if (!profileCheck.ok) {
        throw new Error(profileCheck.error);
      }
      const profileId = profileCheck.value;

      const [watermark, result] = await Promise.all([
        deps.localDb.getWatermark(profileId),
        deps.localDb.queryLogs({
          profileId,
          search: input.search,
          action: input.action,
          accessPointId: input.accessPointId,
          since: input.since,
          until: input.until,
          limit: input.limit,
          offset: input.offset,
        }),
      ]);

      return wrapUntrustedData("local_opfs_logs", {
        profileId,
        totalMatched: result.total,
        stats: result.stats ?? null,
        localSyncWatermark: watermark
          ? {
              earliestTimestamp: watermark.earliest_timestamp,
              latestTimestamp: watermark.latest_timestamp,
              lastSyncedAt: watermark.last_synced_at,
              totalSyncedCount: watermark.total_synced_count,
            }
          : null,
        hint:
          result.total === 0 && !watermark
            ? "No logs are cached in browser OPFS for this profile yet; open the Logs view once to synchronize initial entries."
            : undefined,
        rows: result.rows.map(sanitizeLogRow),
      });
    },
  };

  const getAnalyticsSummaryTool: AppToolDefinition<GetAnalyticsSummaryInput> = {
    name: "dnsworker_get_analytics_summary",
    description:
      "Retrieves DNS traffic analytics (block rate, top blocked/allowed domains, top clients, destination countries) for a Profile over a specified hour window.",
    inputSchema: {
      type: "object",
      properties: {
        profileId: {
          type: "string",
          description: "Optional Profile ID; defaults to the currently selected dashboard Profile.",
        },
        hours: {
          type: "number",
          description: "Lookback window in hours (1-720, defaults to 24).",
        },
        source: {
          type: "string",
          description: "Data source preference: auto (default), local (OPFS), or remote (server rollups).",
        },
      },
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
      requiresE2eeUnlocked: true,
      allowInDemoMode: true,
      roleScope: "user",
    },
    validateInput(raw) {
      if (raw.profileId !== undefined && typeof raw.profileId !== "string") {
        return { ok: false, error: "profileId must be a string." };
      }
      const rawHours = raw.hours === undefined ? 24 : raw.hours;
      if (typeof rawHours !== "number" || !Number.isFinite(rawHours) || rawHours < 1 || rawHours > 720) {
        return { ok: false, error: "hours must be a number between 1 and 720." };
      }
      const rawSource = raw.source === undefined ? "auto" : raw.source;
      if (rawSource !== "auto" && rawSource !== "local" && rawSource !== "remote") {
        return { ok: false, error: "source must be 'auto', 'local', or 'remote'." };
      }
      return {
        ok: true,
        value: {
          profileId: raw.profileId,
          hours: Math.floor(rawHours),
          source: rawSource,
        },
      };
    },
    execute: async (input, { runtimeState }) => {
      const profileCheck = resolveProfileIdInput(input.profileId, runtimeState.activeProfileId);
      if (!profileCheck.ok) {
        throw new Error(profileCheck.error);
      }
      const profileId = profileCheck.value;
      const until = Math.floor(Date.now() / 1000);
      const since = until - input.hours * 3600;
      const bucketSec = input.hours <= 6 ? 300 : input.hours <= 48 ? 3600 : 86400;

      let resolvedSource: "local" | "remote" = input.source === "remote" ? "remote" : "local";
      if (input.source === "auto") {
        const storage = await deps.localDb.getStorageInfo().catch(() => null);
        const profileLocalRows =
          storage?.profileStats.find((s) => s.profile_id === profileId)?.count ?? 0;
        resolvedSource = profileLocalRows > 0 || runtimeState.isE2eeEnabled ? "local" : "remote";
      }

      const data =
        resolvedSource === "local"
          ? await deps.localDb.queryAnalytics({ profileId, since, until, bucketSec })
          : await deps.getProfileAnalytics(
              profileId,
              "",
              `since=${since}&until=${until}`,
              { redirectOn404: false }
            );

      return wrapUntrustedData(`analytics_${resolvedSource}`, {
        profileId,
        source: resolvedSource,
        since,
        until,
        hours: input.hours,
        analytics: sanitizeAnalyticsData(data),
      });
    },
  };

  const getLogDetailTool: AppToolDefinition<GetLogDetailInput> = {
    name: "dnsworker_get_log_detail",
    description:
      "Fetches detailed audit metadata for a specific DNS query log ID (answer, upstream, client GeoIP, latency, and block reason).",
    inputSchema: {
      type: "object",
      properties: {
        logId: { type: "number", description: "Numeric log entry ID." },
        profileId: {
          type: "string",
          description: "Optional Profile ID; defaults to the currently selected dashboard Profile.",
        },
        timestamp: {
          type: "number",
          description: "Optional Unix timestamp (seconds) to narrow indexed lookup.",
        },
      },
      required: ["logId"],
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
      requiresE2eeUnlocked: true,
      allowInDemoMode: true,
      roleScope: "user",
    },
    validateInput(raw) {
      const idCheck = parsePositiveIntInput(raw.logId, "logId");
      if (!idCheck.ok) return idCheck;
      if (raw.profileId !== undefined && typeof raw.profileId !== "string") {
        return { ok: false, error: "profileId must be a string." };
      }
      if (
        raw.timestamp !== undefined &&
        (typeof raw.timestamp !== "number" || !Number.isFinite(raw.timestamp))
      ) {
        return { ok: false, error: "timestamp must be a finite Unix timestamp (seconds)." };
      }
      return {
        ok: true,
        value: {
          profileId: raw.profileId,
          logId: idCheck.value,
          timestamp: raw.timestamp,
        },
      };
    },
    execute: async (input, { runtimeState }) => {
      const profileCheck = resolveProfileIdInput(input.profileId, runtimeState.activeProfileId);
      if (!profileCheck.ok) {
        throw new Error(profileCheck.error);
      }
      const entry = await deps.getProfileLogDetails(
        profileCheck.value,
        input.logId,
        input.timestamp,
        { redirectOn404: false }
      );
      return wrapUntrustedData("profile_log_detail", {
        profileId: profileCheck.value,
        entry: sanitizeLogRow(entry),
      });
    },
  };

  return [
    listProfilesTool,
    defineWebMcpTool(queryLocalLogsTool),
    defineWebMcpTool(getAnalyticsSummaryTool),
    defineWebMcpTool(getLogDetailTool),
  ];
}
