/**
 * @file filteringTools.ts
 * @description Phase 2 WebMCP tools for managing external DNS filter list subscriptions and sync state:
 *   - `dnsworker_list_filter_subscriptions` (read)
 *   - `dnsworker_list_preset_filters` (read)
 *   - `dnsworker_get_sync_status` (read)
 *   - `dnsworker_toggle_filter_list` (write + HITL confirmation)
 *   - `dnsworker_subscribe_filter_list` (write + HITL confirmation)
 *   - `dnsworker_sync_filter_lists` (write + HITL confirmation)
 */

import type { FilterList, ProfileFetchOptions, SyncProgress, UserList } from "../../services";
import { emitWebMcpDataChanged } from "../events";
import { boundResultList, sanitizeUntrustedString, wrapUntrustedData } from "../sanitize";
import { defineWebMcpTool, type AppToolDefinition } from "../types";
import {
  parsePositiveIntInput,
  resolveProfileIdInput,
  validateSubscriptionUrlInput,
} from "./validation";

const MAX_LISTS_LIMIT = 50;

export interface PresetFilterItem {
  label?: string;
  name?: string;
  url?: string;
  description?: string;
  category?: string;
}

export interface FilteringToolDeps {
  getProfileLists: (profileId: string, options?: ProfileFetchOptions) => Promise<FilterList[]>;
  getProfileSyncStatus: (profileId: string, options?: ProfileFetchOptions) => Promise<SyncProgress>;
  toggleProfileList: (
    profileId: string,
    listId: number,
    enabled: boolean,
    options?: ProfileFetchOptions
  ) => Promise<void>;
  addCustomProfileList: (
    profileId: string,
    url: string,
    options?: ProfileFetchOptions
  ) => Promise<{ id?: number }>;
  syncProfileLists: (profileId: string, options?: ProfileFetchOptions) => Promise<void>;
  syncSingleProfileList: (
    profileId: string,
    listId: number,
    options?: ProfileFetchOptions
  ) => Promise<void>;
  getUserLists: () => Promise<UserList[]>;
  addUserList: (url: string) => Promise<{ id?: number; list?: Pick<UserList, "id"> }>;
  toggleUserList: (id: number, enabled: boolean) => Promise<void>;
  getPresetFilters: () => Promise<PresetFilterItem[]>;
}

interface ListSubscriptionsInput extends Record<string, unknown> {
  profileId?: string;
  scope?: "all" | "profile" | "user" | "system";
  enabledOnly?: boolean;
  limit?: number;
}

interface ListPresetFiltersInput extends Record<string, unknown> {
  limit?: number;
}

interface GetSyncStatusInput extends Record<string, unknown> {
  profileId?: string;
}

interface ToggleFilterListInput extends Record<string, unknown> {
  scope: "profile" | "user";
  profileId?: string;
  listId: number;
  enabled: boolean;
}

interface SubscribeFilterListInput extends Record<string, unknown> {
  scope: "profile" | "user";
  profileId?: string;
  url: string;
}

interface SyncFilterListsInput extends Record<string, unknown> {
  profileId?: string;
  listId?: number;
}

function projectProfileFilterList(list: FilterList): Record<string, unknown> {
  return {
    id: list.id,
    url: sanitizeUntrustedString(list.url, 512),
    enabled: Boolean(list.enabled),
    scope: list.scope ?? "profile",
    scopes: list.scopes,
    is_system: Boolean(list.is_system),
    user_list_id: list.user_list_id,
    last_synced_at: list.last_synced_at ?? null,
    sync_error: list.sync_error ? sanitizeUntrustedString(list.sync_error, 256) : null,
    metadata: list.metadata ?? null,
  };
}

function projectUserFilterList(list: UserList): Record<string, unknown> {
  return {
    id: list.id,
    url: sanitizeUntrustedString(list.url, 512),
    enabled: Boolean(list.enabled),
    scope: list.is_system ? "system" : "user",
    is_system: Boolean(list.is_system),
    created_at: list.created_at,
    last_synced_at: list.last_synced_at ?? null,
    sync_error: list.sync_error ? sanitizeUntrustedString(list.sync_error, 256) : null,
  };
}

/**
 * Creates the Phase 2 `filtering` WebMCP tool group.
 */
export function createFilteringWebMcpTools(deps: FilteringToolDeps): AppToolDefinition[] {
  const listSubscriptionsTool = defineWebMcpTool<ListSubscriptionsInput>({
    name: "dnsworker_list_filter_subscriptions",
    description:
      "Lists Profile-level, account user-level, and system-distributed DNS filter list subscriptions along with sync timestamps and metadata.",
    inputSchema: {
      type: "object",
      properties: {
        profileId: { type: "string", description: "Optional Profile ID; defaults to active Profile." },
        scope: {
          type: "string",
          enum: ["all", "profile", "user", "system"],
          description: "Filter subscription scope (default 'all').",
        },
        enabledOnly: { type: "boolean", description: "When true, returns only enabled lists." },
        limit: { type: "number", minimum: 1, maximum: MAX_LISTS_LIMIT, description: "Max lists returned per section (default 50)." },
      },
      additionalProperties: false,
    },
    policy: {
      access: "read",
      requiresAuth: true,
      requiresUnlocked: true,
    },
    validateInput: (raw) => {
      let profileId: string | undefined;
      if (raw.profileId !== undefined && raw.profileId !== "") {
        const res = resolveProfileIdInput(raw.profileId, null);
        if (!res.ok) return res;
        profileId = res.value;
      }

      let scope: "all" | "profile" | "user" | "system" = "all";
      if (raw.scope !== undefined) {
        if (
          raw.scope !== "all" &&
          raw.scope !== "profile" &&
          raw.scope !== "user" &&
          raw.scope !== "system"
        ) {
          return { ok: false, error: "scope must be 'all', 'profile', 'user', or 'system'." };
        }
        scope = raw.scope;
      }

      if (raw.enabledOnly !== undefined && typeof raw.enabledOnly !== "boolean") {
        return { ok: false, error: "enabledOnly must be a boolean." };
      }

      let limit = MAX_LISTS_LIMIT;
      if (raw.limit !== undefined) {
        const limRes = parsePositiveIntInput(raw.limit, "limit");
        if (!limRes.ok) return limRes;
        if (limRes.value > MAX_LISTS_LIMIT) {
          return { ok: false, error: `limit cannot exceed ${MAX_LISTS_LIMIT}.` };
        }
        limit = limRes.value;
      }

      return { ok: true, value: { profileId, scope, enabledOnly: raw.enabledOnly, limit } };
    },
    execute: async (input, { runtimeState }) => {
      const limit = input.limit ?? MAX_LISTS_LIMIT;
      const scope = input.scope ?? "all";

      if (scope === "user") {
        const userLists = await deps.getUserLists();
        const filteredUser = userLists.filter((l) => !input.enabledOnly || Boolean(l.enabled));
        const boundedUser = boundResultList(filteredUser, limit);
        return wrapUntrustedData("filter_subscriptions", {
          scope,
          profileLists: [],
          userLists: boundedUser.items.map(projectUserFilterList),
          totalUserMatching: filteredUser.length,
          truncated: boundedUser.truncated,
        });
      }

      const pidRes = resolveProfileIdInput(input.profileId, runtimeState.activeProfileId);
      if (!pidRes.ok) throw new Error(pidRes.error);
      const profileId = pidRes.value;

      const [profileLists, userLists] = await Promise.all([
        deps.getProfileLists(profileId, { redirectOn404: false }),
        scope === "all" ? deps.getUserLists().catch(() => []) : Promise.resolve([]),
      ]);

      const filteredProfile = profileLists.filter((l) => {
        if (scope === "profile" && l.scope !== "profile") return false;
        if (scope === "system" && !l.is_system && l.scope !== "system") return false;
        if (input.enabledOnly && !l.enabled) return false;
        return true;
      });
      const boundedProfile = boundResultList(filteredProfile, limit);
      const boundedUser = boundResultList(
        userLists.filter((l) => !input.enabledOnly || Boolean(l.enabled)),
        limit
      );

      return wrapUntrustedData("filter_subscriptions", {
        profileId,
        scope,
        totalProfileMatching: filteredProfile.length,
        profileLists: boundedProfile.items.map(projectProfileFilterList),
        userLists: scope === "all" ? boundedUser.items.map(projectUserFilterList) : [],
        truncated: boundedProfile.truncated || boundedUser.truncated,
      });
    },
  });

  const listPresetFiltersTool = defineWebMcpTool<ListPresetFiltersInput>({
    name: "dnsworker_list_preset_filters",
    description: "Lists curated preset DNS blocklist recommendations configured on the DNS Worker server.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", minimum: 1, maximum: MAX_LISTS_LIMIT, description: "Max presets to return (default 50)." },
      },
      additionalProperties: false,
    },
    policy: {
      access: "read",
      requiresAuth: true,
      requiresUnlocked: true,
    },
    validateInput: (raw) => {
      let limit = MAX_LISTS_LIMIT;
      if (raw.limit !== undefined) {
        const limRes = parsePositiveIntInput(raw.limit, "limit");
        if (!limRes.ok) return limRes;
        if (limRes.value > MAX_LISTS_LIMIT) {
          return { ok: false, error: `limit cannot exceed ${MAX_LISTS_LIMIT}.` };
        }
        limit = limRes.value;
      }
      return { ok: true, value: { limit } };
    },
    execute: async (input) => {
      const rawPresets = await deps.getPresetFilters();
      const normalized = (Array.isArray(rawPresets) ? rawPresets : []).map((item) => ({
        label: sanitizeUntrustedString(String(item.label ?? item.name ?? "Preset"), 128),
        url: sanitizeUntrustedString(String(item.url ?? ""), 512),
        category: item.category ? sanitizeUntrustedString(String(item.category), 64) : undefined,
        description: item.description ? sanitizeUntrustedString(String(item.description), 256) : undefined,
      }));
      const bounded = boundResultList(normalized, input.limit ?? MAX_LISTS_LIMIT);
      return wrapUntrustedData("preset_filters", {
        totalPresets: normalized.length,
        truncated: bounded.truncated,
        presets: bounded.items,
      });
    },
  });

  const getSyncStatusTool = defineWebMcpTool<GetSyncStatusInput>({
    name: "dnsworker_get_sync_status",
    description: "Checks live backend filter list synchronization and bloom-rebuild progress for a Profile.",
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

      const status = await deps.getProfileSyncStatus(profileId, { redirectOn404: false });
      return {
        profileId,
        ...status,
      };
    },
  });

  const toggleFilterListTool = defineWebMcpTool<ToggleFilterListInput>({
    name: "dnsworker_toggle_filter_list",
    description:
      "Enables or disables an external filter list subscription at either 'profile' scope (also allows overriding inherited lists per profile) or 'user' account scope (requires human confirmation).",
    inputSchema: {
      type: "object",
      properties: {
        scope: {
          type: "string",
          enum: ["profile", "user"],
          description: "Target list scope: 'profile' (default) or 'user' (account-wide).",
        },
        profileId: { type: "string", description: "Required when scope is 'profile'; defaults to active Profile." },
        listId: { type: "number", minimum: 1, description: "Subscription list ID." },
        enabled: { type: "boolean", description: "Desired enabled state." },
      },
      required: ["listId", "enabled"],
      additionalProperties: false,
    },
    policy: {
      access: "write",
      requiresAuth: true,
      requiresUnlocked: true,
    },
    confirmDescription: (input) =>
      `${input.enabled ? "Enable" : "Disable"} ${input.scope}-level filter list #${input.listId}` +
      (input.scope === "profile" && input.profileId ? ` on profile ${input.profileId}` : "") +
      "?",
    validateInput: (raw) => {
      const scope = raw.scope === undefined ? "profile" : raw.scope;
      if (scope !== "profile" && scope !== "user") {
        return { ok: false, error: "scope must be 'profile' or 'user'." };
      }

      let profileId: string | undefined;
      if (raw.profileId !== undefined && raw.profileId !== "") {
        const res = resolveProfileIdInput(raw.profileId, null);
        if (!res.ok) return res;
        profileId = res.value;
      }

      const idRes = parsePositiveIntInput(raw.listId, "listId");
      if (!idRes.ok) return idRes;

      if (typeof raw.enabled !== "boolean") {
        return { ok: false, error: "enabled must be a boolean." };
      }

      return {
        ok: true,
        value: {
          scope,
          profileId,
          listId: idRes.value,
          enabled: raw.enabled,
        },
      };
    },
    execute: async (input, { runtimeState }) => {
      if (input.scope === "user") {
        await deps.toggleUserList(input.listId, input.enabled);
        emitWebMcpDataChanged({ scope: "user_lists" });
        emitWebMcpDataChanged({ scope: "filtering" });
        return {
          updated: true,
          scope: "user",
          listId: input.listId,
          enabled: input.enabled,
        };
      }

      const pidRes = resolveProfileIdInput(input.profileId, runtimeState.activeProfileId);
      if (!pidRes.ok) throw new Error(pidRes.error);
      const profileId = pidRes.value;

      await deps.toggleProfileList(profileId, input.listId, input.enabled, { redirectOn404: false });
      emitWebMcpDataChanged({ scope: "filtering", profileId });
      return {
        updated: true,
        scope: "profile",
        profileId,
        listId: input.listId,
        enabled: input.enabled,
      };
    },
  });

  const subscribeFilterListTool = defineWebMcpTool<SubscribeFilterListInput>({
    name: "dnsworker_subscribe_filter_list",
    description:
      "Subscribes a Profile or account user-level configuration to an HTTP(S) filter list URL (requires human confirmation).",
    inputSchema: {
      type: "object",
      properties: {
        scope: {
          type: "string",
          enum: ["profile", "user"],
          description: "Subscription scope: 'profile' (default) or 'user' (all user profiles).",
        },
        profileId: { type: "string", description: "Optional Profile ID when scope is 'profile'." },
        url: { type: "string", description: "HTTP or HTTPS URL pointing to a hosts/AdBlock filter list." },
      },
      required: ["url"],
      additionalProperties: false,
    },
    policy: {
      access: "write",
      requiresAuth: true,
      requiresUnlocked: true,
    },
    confirmDescription: (input) =>
      `Subscribe ${input.scope === "user" ? "account user-level lists" : input.profileId ? `profile ${input.profileId}` : "active profile"} to filter URL "${sanitizeUntrustedString(input.url, 180)}"?`,
    validateInput: (raw) => {
      const scope = raw.scope === undefined ? "profile" : raw.scope;
      if (scope !== "profile" && scope !== "user") {
        return { ok: false, error: "scope must be 'profile' or 'user'." };
      }

      let profileId: string | undefined;
      if (raw.profileId !== undefined && raw.profileId !== "") {
        const res = resolveProfileIdInput(raw.profileId, null);
        if (!res.ok) return res;
        profileId = res.value;
      }

      const urlRes = validateSubscriptionUrlInput(raw.url);
      if (!urlRes.ok) return urlRes;

      return {
        ok: true,
        value: {
          scope,
          profileId,
          url: urlRes.value,
        },
      };
    },
    execute: async (input, { runtimeState }) => {
      if (input.scope === "user") {
        const created = await deps.addUserList(input.url);
        emitWebMcpDataChanged({ scope: "user_lists" });
        emitWebMcpDataChanged({ scope: "filtering" });
        return {
          subscribed: true,
          scope: "user",
          id: created.id ?? created.list?.id ?? null,
          url: input.url,
        };
      }

      const pidRes = resolveProfileIdInput(input.profileId, runtimeState.activeProfileId);
      if (!pidRes.ok) throw new Error(pidRes.error);
      const profileId = pidRes.value;

      const created = await deps.addCustomProfileList(profileId, input.url, { redirectOn404: false });
      emitWebMcpDataChanged({ scope: "filtering", profileId });
      return {
        subscribed: true,
        scope: "profile",
        profileId,
        id: created.id ?? null,
        url: input.url,
      };
    },
  });

  const syncFilterListsTool = defineWebMcpTool<SyncFilterListsInput>({
    name: "dnsworker_sync_filter_lists",
    description:
      "Triggers an asynchronous sync/bloom rebuild for either a specific listId or all enabled lists in a Profile (requires human confirmation). Poll dnsworker_get_sync_status for completion.",
    inputSchema: {
      type: "object",
      properties: {
        profileId: { type: "string", description: "Optional Profile ID; defaults to active Profile." },
        listId: { type: "number", minimum: 1, description: "Optional specific list ID to sync; omits for full Profile sync." },
      },
      additionalProperties: false,
    },
    policy: {
      access: "write",
      requiresAuth: true,
      requiresUnlocked: true,
    },
    confirmDescription: (input) =>
      input.listId !== undefined
        ? `Trigger filter sync for list #${input.listId}${input.profileId ? ` on profile ${input.profileId}` : ""}?`
        : `Trigger full filter list synchronization${input.profileId ? ` on profile ${input.profileId}` : ""}?`,
    validateInput: (raw) => {
      let profileId: string | undefined;
      if (raw.profileId !== undefined && raw.profileId !== "") {
        const res = resolveProfileIdInput(raw.profileId, null);
        if (!res.ok) return res;
        profileId = res.value;
      }

      let listId: number | undefined;
      if (raw.listId !== undefined) {
        const idRes = parsePositiveIntInput(raw.listId, "listId");
        if (!idRes.ok) return idRes;
        listId = idRes.value;
      }

      return { ok: true, value: { profileId, listId } };
    },
    execute: async (input, { runtimeState }) => {
      const pidRes = resolveProfileIdInput(input.profileId, runtimeState.activeProfileId);
      if (!pidRes.ok) throw new Error(pidRes.error);
      const profileId = pidRes.value;

      if (input.listId !== undefined) {
        await deps.syncSingleProfileList(profileId, input.listId, { redirectOn404: false });
      } else {
        await deps.syncProfileLists(profileId, { redirectOn404: false });
      }

      emitWebMcpDataChanged({ scope: "filtering", profileId });
      return {
        started: true,
        mode: input.listId !== undefined ? "single" : "all",
        profileId,
        listId: input.listId ?? null,
        hint: "Sync runs asynchronously; call dnsworker_get_sync_status to monitor progress.",
      };
    },
  });

  return [
    listSubscriptionsTool,
    listPresetFiltersTool,
    getSyncStatusTool,
    toggleFilterListTool,
    subscribeFilterListTool,
    syncFilterListsTool,
  ] as AppToolDefinition[];
}
