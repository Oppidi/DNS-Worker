/**
 * @file profilesTools.ts
 * @description Phase 3 WebMCP tools for reading and tuning DNS Worker Profile settings:
 *   - `dnsworker_get_profile_settings` (read, strictly strips `profile_key`)
 *   - `dnsworker_update_profile_settings` (write + HITL confirmation)
 *   - `dnsworker_toggle_pause_filtering` (write + HITL confirmation)
 */

import type { GlobalProfileSettings, Profile, ProfileFetchOptions } from "../../services";
import { emitWebMcpDataChanged } from "../events";
import { sanitizeUntrustedString, wrapUntrustedData } from "../sanitize";
import { defineWebMcpTool, type AppToolDefinition } from "../types";
import {
  resolveProfileIdInput,
  validateDisplayNameInput,
  validateOptionalRuleTarget,
  validateUpstreamListInput,
} from "./validation";

const BLOCK_MODES = new Set(["NULL_IP", "NXDOMAIN", "NODATA", "CUSTOM_IP"] as const);
const DEFAULT_POLICIES = new Set(["ALLOW", "BLOCK"] as const);
const MAX_PAUSE_SECONDS = 86_400;
const MIN_PAUSE_SECONDS = 60;

export interface ProfilesToolDeps {
  getProfileDetails: (profileId: string, options?: ProfileFetchOptions) => Promise<Profile>;
  updateProfileSettings: (
    profileId: string,
    settings: GlobalProfileSettings,
    options?: ProfileFetchOptions
  ) => Promise<void>;
  renameProfile: (
    profileId: string,
    name: string,
    options?: ProfileFetchOptions
  ) => Promise<void>;
}

interface GetProfileSettingsInput extends Record<string, unknown> {
  profileId?: string;
}

interface UpdateProfileSettingsInput extends Record<string, unknown> {
  profileId?: string;
  name?: string;
  default_policy?: "ALLOW" | "BLOCK";
  block_mode?: "NULL_IP" | "NXDOMAIN" | "NODATA" | "CUSTOM_IP";
  custom_block_ipv4?: string;
  custom_block_ipv6?: string;
  log_retention_days?: number;
  skip_log_on_pass?: boolean;
  upstream?: string[];
  ecs_enabled?: boolean;
  ecs_use_client_ip?: boolean;
  best_effort_ech_enabled?: boolean;
  best_effort_ech_fronting_domain?: string;
}

interface TogglePauseFilteringInput extends Record<string, unknown> {
  profileId?: string;
  enabled: boolean;
  duration_seconds?: number;
}

function parseProfileSettingsSafe(rawSettings?: string): GlobalProfileSettings {
  if (!rawSettings) {
    return {
      upstream: [],
      ecs: { enabled: false, use_client_ip: false },
      log_retention_days: 7,
      default_policy: "ALLOW",
    };
  }
  try {
    return JSON.parse(rawSettings) as GlobalProfileSettings;
  } catch {
    return {
      upstream: [],
      ecs: { enabled: false, use_client_ip: false },
      log_retention_days: 7,
      default_policy: "ALLOW",
    };
  }
}

function projectSafeSettings(settings: GlobalProfileSettings): Record<string, unknown> {
  return {
    upstream: Array.isArray(settings.upstream)
      ? settings.upstream.map((u) => sanitizeUntrustedString(String(u), 256))
      : [],
    default_policy: settings.default_policy ?? "ALLOW",
    block_mode: settings.block_mode ?? "NULL_IP",
    custom_block_ipv4: settings.custom_block_ipv4
      ? sanitizeUntrustedString(settings.custom_block_ipv4, 64)
      : undefined,
    custom_block_ipv6: settings.custom_block_ipv6
      ? sanitizeUntrustedString(settings.custom_block_ipv6, 128)
      : undefined,
    log_retention_days: settings.log_retention_days ?? 0,
    skip_log_on_pass: Boolean(settings.skip_log_on_pass),
    ecs: settings.ecs ?? { enabled: false, use_client_ip: false },
    best_effort_ech: settings.best_effort_ech ?? { enabled: false },
    ttl_override: settings.ttl_override,
    pause_filtering: settings.pause_filtering,
  };
}

/**
 * Creates the `profiles` WebMCP tool group for DNS resolution policy inspection and tuning.
 */
export function createProfilesWebMcpTools(deps: ProfilesToolDeps): AppToolDefinition[] {
  const getProfileSettingsTool = defineWebMcpTool<GetProfileSettingsInput>({
    name: "dnsworker_get_profile_settings",
    description:
      "Reads a Profile's DNS strategy configuration (upstreams, default policy, block mode, ECH/ECS, log retention, and pause state) while excluding `profile_key` secrets.",
    inputSchema: {
      type: "object",
      properties: {
        profileId: { type: "string", description: "Optional Profile ID; defaults to active Profile." },
      },
      additionalProperties: false,
    },
    policy: {
      access: "read",
      requiresAuth: true,
      requiresUnlocked: true,
    },
    validateInput: (raw) => {
      if (raw.profileId !== undefined && raw.profileId !== "") {
        const res = resolveProfileIdInput(raw.profileId, null);
        if (!res.ok) return res;
        return { ok: true, value: { profileId: res.value } };
      }
      return { ok: true, value: {} };
    },
    execute: async (input, { runtimeState }) => {
      const pidRes = resolveProfileIdInput(input.profileId, runtimeState.activeProfileId);
      if (!pidRes.ok) throw new Error(pidRes.error);
      const profileId = pidRes.value;

      const profile = await deps.getProfileDetails(profileId, { redirectOn404: false });
      const parsed = parseProfileSettingsSafe(profile.settings);

      return wrapUntrustedData("profile_settings", {
        id: profile.id,
        name: sanitizeUntrustedString(profile.name, 64),
        created_at: profile.created_at ?? null,
        updated_at: profile.updated_at ?? null,
        settings: projectSafeSettings(parsed),
      });
    },
  });

  const updateProfileSettingsTool = defineWebMcpTool<UpdateProfileSettingsInput>({
    name: "dnsworker_update_profile_settings",
    description:
      "Updates Profile DNS policy settings (upstreams, default_policy, block_mode, ECS, Best-Effort ECH, log retention, or profile name) using safe merge-patch semantics (requires human confirmation).",
    inputSchema: {
      type: "object",
      properties: {
        profileId: { type: "string", description: "Optional Profile ID; defaults to active Profile." },
        name: { type: "string", description: "Optional new Profile display name (1–64 chars)." },
        default_policy: { type: "string", enum: ["ALLOW", "BLOCK"], description: "Fallback DNS policy." },
        block_mode: {
          type: "string",
          enum: ["NULL_IP", "NXDOMAIN", "NODATA", "CUSTOM_IP"],
          description: "DNS response mode for blocked domains.",
        },
        custom_block_ipv4: { type: "string", description: "Custom IPv4 returned when block_mode is CUSTOM_IP." },
        custom_block_ipv6: { type: "string", description: "Custom IPv6 returned when block_mode is CUSTOM_IP." },
        log_retention_days: {
          type: "number",
          minimum: 0,
          maximum: 3650,
          description: "Server log retention days (0–3650).",
        },
        skip_log_on_pass: { type: "boolean", description: "Skip recording allowed (PASS) queries." },
        upstream: {
          type: "array",
          minItems: 1,
          maxItems: 8,
          items: { type: "string" },
          description: "Upstream DNS endpoints (e.g. https://cloudflare-dns.com/dns-query).",
        },
        ecs_enabled: { type: "boolean", description: "Enable EDNS Client Subnet forwarding." },
        ecs_use_client_ip: { type: "boolean", description: "Derive ECS prefix from client IP." },
        best_effort_ech_enabled: { type: "boolean", description: "Enable Best-Effort ECH mitigation." },
        best_effort_ech_fronting_domain: { type: "string", description: "Optional ECH fronting domain." },
      },
      additionalProperties: false,
    },
    policy: {
      access: "write",
      requiresAuth: true,
      requiresUnlocked: true,
    },
    confirmDescription: (input) => {
      const changed = Object.keys(input).filter((k) => k !== "profileId" && input[k] !== undefined);
      return (
        `Update Profile settings [${changed.join(", ")}]` +
        (input.profileId ? ` on profile ${input.profileId}` : " on active profile") +
        "?"
      );
    },
    validateInput: (raw) => {
      let profileId: string | undefined;
      if (raw.profileId !== undefined && raw.profileId !== "") {
        const res = resolveProfileIdInput(raw.profileId, null);
        if (!res.ok) return res;
        profileId = res.value;
      }

      const patchKeys = [
        "name",
        "default_policy",
        "block_mode",
        "custom_block_ipv4",
        "custom_block_ipv6",
        "log_retention_days",
        "skip_log_on_pass",
        "upstream",
        "ecs_enabled",
        "ecs_use_client_ip",
        "best_effort_ech_enabled",
        "best_effort_ech_fronting_domain",
      ];
      if (!patchKeys.some((k) => raw[k] !== undefined)) {
        return { ok: false, error: "Provide at least one Profile field or setting to update." };
      }

      const parsed: UpdateProfileSettingsInput = { profileId };

      if (raw.name !== undefined) {
        const nameRes = validateDisplayNameInput(raw.name, "name");
        if (!nameRes.ok) return nameRes;
        parsed.name = nameRes.value;
      }

      if (raw.default_policy !== undefined) {
        if (typeof raw.default_policy !== "string" || !DEFAULT_POLICIES.has(raw.default_policy as "ALLOW" | "BLOCK")) {
          return { ok: false, error: "default_policy must be ALLOW or BLOCK." };
        }
        parsed.default_policy = raw.default_policy as "ALLOW" | "BLOCK";
      }

      if (raw.block_mode !== undefined) {
        if (
          typeof raw.block_mode !== "string" ||
          !BLOCK_MODES.has(raw.block_mode as "NULL_IP" | "NXDOMAIN" | "NODATA" | "CUSTOM_IP")
        ) {
          return { ok: false, error: "block_mode must be NULL_IP, NXDOMAIN, NODATA, or CUSTOM_IP." };
        }
        parsed.block_mode = raw.block_mode as "NULL_IP" | "NXDOMAIN" | "NODATA" | "CUSTOM_IP";
      }

      const ipv4Res = validateOptionalRuleTarget(raw.custom_block_ipv4, "custom_block_ipv4");
      if (!ipv4Res.ok) return ipv4Res;
      if (ipv4Res.value !== undefined) parsed.custom_block_ipv4 = ipv4Res.value;

      const ipv6Res = validateOptionalRuleTarget(raw.custom_block_ipv6, "custom_block_ipv6");
      if (!ipv6Res.ok) return ipv6Res;
      if (ipv6Res.value !== undefined) parsed.custom_block_ipv6 = ipv6Res.value;

      if (raw.log_retention_days !== undefined) {
        if (
          typeof raw.log_retention_days !== "number" ||
          !Number.isInteger(raw.log_retention_days) ||
          raw.log_retention_days < 0 ||
          raw.log_retention_days > 3650
        ) {
          return { ok: false, error: "log_retention_days must be an integer between 0 and 3650." };
        }
        parsed.log_retention_days = raw.log_retention_days;
      }

      for (const boolKey of ["skip_log_on_pass", "ecs_enabled", "ecs_use_client_ip", "best_effort_ech_enabled"] as const) {
        if (raw[boolKey] !== undefined) {
          if (typeof raw[boolKey] !== "boolean") {
            return { ok: false, error: `${boolKey} must be a boolean.` };
          }
          parsed[boolKey] = raw[boolKey] as boolean;
        }
      }

      if (raw.upstream !== undefined) {
        const upRes = validateUpstreamListInput(raw.upstream);
        if (!upRes.ok) return upRes;
        parsed.upstream = upRes.value;
      }

      const echRes = validateOptionalRuleTarget(
        raw.best_effort_ech_fronting_domain,
        "best_effort_ech_fronting_domain"
      );
      if (!echRes.ok) return echRes;
      if (echRes.value !== undefined) parsed.best_effort_ech_fronting_domain = echRes.value;

      return { ok: true, value: parsed };
    },
    execute: async (input, { runtimeState }) => {
      const pidRes = resolveProfileIdInput(input.profileId, runtimeState.activeProfileId);
      if (!pidRes.ok) throw new Error(pidRes.error);
      const profileId = pidRes.value;

      const profile = await deps.getProfileDetails(profileId, { redirectOn404: false });
      const currentSettings = parseProfileSettingsSafe(profile.settings);

      const nextSettings: GlobalProfileSettings = {
        ...currentSettings,
        upstream: input.upstream ?? currentSettings.upstream,
        default_policy: input.default_policy ?? currentSettings.default_policy,
        block_mode: input.block_mode ?? currentSettings.block_mode,
        custom_block_ipv4: input.custom_block_ipv4 ?? currentSettings.custom_block_ipv4,
        custom_block_ipv6: input.custom_block_ipv6 ?? currentSettings.custom_block_ipv6,
        log_retention_days: input.log_retention_days ?? currentSettings.log_retention_days,
        skip_log_on_pass: input.skip_log_on_pass ?? currentSettings.skip_log_on_pass,
        ecs: {
          ...currentSettings.ecs,
          ...(input.ecs_enabled !== undefined ? { enabled: input.ecs_enabled } : {}),
          ...(input.ecs_use_client_ip !== undefined ? { use_client_ip: input.ecs_use_client_ip } : {}),
        },
        best_effort_ech: {
          enabled: input.best_effort_ech_enabled ?? currentSettings.best_effort_ech?.enabled ?? false,
          ...(input.best_effort_ech_fronting_domain !== undefined
            ? { fronting_domain: input.best_effort_ech_fronting_domain }
            : currentSettings.best_effort_ech?.fronting_domain !== undefined
            ? { fronting_domain: currentSettings.best_effort_ech.fronting_domain }
            : {}),
        },
      };

      if (
        nextSettings.block_mode === "CUSTOM_IP" &&
        !nextSettings.custom_block_ipv4 &&
        !nextSettings.custom_block_ipv6
      ) {
        throw new Error("CUSTOM_IP block_mode requires at least one of custom_block_ipv4 or custom_block_ipv6.");
      }

      const hasSettingsUpdate = [
        input.default_policy,
        input.block_mode,
        input.custom_block_ipv4,
        input.custom_block_ipv6,
        input.log_retention_days,
        input.skip_log_on_pass,
        input.upstream,
        input.ecs_enabled,
        input.ecs_use_client_ip,
        input.best_effort_ech_enabled,
        input.best_effort_ech_fronting_domain,
      ].some((v) => v !== undefined);

      if (input.name && input.name !== profile.name) {
        await deps.renameProfile(profileId, input.name, { redirectOn404: false });
      }
      if (hasSettingsUpdate) {
        await deps.updateProfileSettings(profileId, nextSettings, { redirectOn404: false });
      }

      emitWebMcpDataChanged({ scope: "profile_settings", profileId });
      emitWebMcpDataChanged({ scope: "rules", profileId });

      return {
        updated: true,
        profileId,
        name: input.name ?? sanitizeUntrustedString(profile.name, 64),
        settings: projectSafeSettings(nextSettings),
      };
    },
  });

  const togglePauseFilteringTool = defineWebMcpTool<TogglePauseFilteringInput>({
    name: "dnsworker_toggle_pause_filtering",
    description:
      "Temporarily pauses or resumes adblock/filter evaluation for a Profile with an automatic Unix-second expiration timer (requires human confirmation).",
    inputSchema: {
      type: "object",
      properties: {
        profileId: { type: "string", description: "Optional Profile ID; defaults to active Profile." },
        enabled: { type: "boolean", description: "True to pause filtering; false to resume immediately." },
        duration_seconds: {
          type: "number",
          minimum: MIN_PAUSE_SECONDS,
          maximum: MAX_PAUSE_SECONDS,
          description: "Pause duration in seconds (60–86400; defaults to 300 when enabling pause).",
        },
      },
      required: ["enabled"],
      additionalProperties: false,
    },
    policy: {
      access: "write",
      requiresAuth: true,
      requiresUnlocked: true,
    },
    confirmDescription: (input) =>
      input.enabled
        ? `Pause DNS filtering for ${input.duration_seconds ?? 300}s` +
          (input.profileId ? ` on profile ${input.profileId}` : " on active profile") +
          "?"
        : `Resume DNS filtering immediately` +
          (input.profileId ? ` on profile ${input.profileId}` : " on active profile") +
          "?",
    validateInput: (raw) => {
      let profileId: string | undefined;
      if (raw.profileId !== undefined && raw.profileId !== "") {
        const res = resolveProfileIdInput(raw.profileId, null);
        if (!res.ok) return res;
        profileId = res.value;
      }

      if (typeof raw.enabled !== "boolean") {
        return { ok: false, error: "enabled must be a boolean." };
      }

      let duration = 300;
      if (raw.duration_seconds !== undefined) {
        if (
          typeof raw.duration_seconds !== "number" ||
          !Number.isInteger(raw.duration_seconds) ||
          raw.duration_seconds < MIN_PAUSE_SECONDS ||
          raw.duration_seconds > MAX_PAUSE_SECONDS
        ) {
          return {
            ok: false,
            error: `duration_seconds must be an integer between ${MIN_PAUSE_SECONDS} and ${MAX_PAUSE_SECONDS}.`,
          };
        }
        duration = raw.duration_seconds;
      }

      return { ok: true, value: { profileId, enabled: raw.enabled, duration_seconds: duration } };
    },
    execute: async (input, { runtimeState }) => {
      const pidRes = resolveProfileIdInput(input.profileId, runtimeState.activeProfileId);
      if (!pidRes.ok) throw new Error(pidRes.error);
      const profileId = pidRes.value;

      const profile = await deps.getProfileDetails(profileId, { redirectOn404: false });
      const currentSettings = parseProfileSettingsSafe(profile.settings);
      const duration = input.duration_seconds ?? 300;
      const nowSec = Math.floor(Date.now() / 1000);
      const pauseFiltering = {
        enabled: input.enabled,
        duration_seconds: input.enabled ? duration : 0,
        expires_at: input.enabled ? nowSec + duration : 0,
      };

      const nextSettings: GlobalProfileSettings = {
        ...currentSettings,
        pause_filtering: pauseFiltering,
      };

      await deps.updateProfileSettings(profileId, nextSettings, { redirectOn404: false });
      emitWebMcpDataChanged({ scope: "profile_settings", profileId });

      return {
        updated: true,
        profileId,
        pause_filtering: pauseFiltering,
      };
    },
  });

  return [
    getProfileSettingsTool,
    updateProfileSettingsTool,
    togglePauseFilteringTool,
  ] as AppToolDefinition[];
}
