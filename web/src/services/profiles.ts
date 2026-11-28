import type {
  Profile,
  AccessPoint,
  LogEntry,
  Rule,
  FilterList,
  GlobalProfileSettings,
  TestResponse
} from "./types";

export interface ProfileFetchOptions {
  signal?: AbortSignal;
  /** Redirects to `/404` on HTTP 404 when true (default for UI views); set false for headless/WebMCP callers. */
  redirectOn404?: boolean;
}

/**
 * 包装 fetch 方法，当请求 Profile 相关接口遇到 404 (不存在或无权限) 时，直接引导前端至 404 界面
 */
export async function profileFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
  redirectOn404: boolean = true
): Promise<Response> {
  const res = await fetch(input, init);
  if (res.status === 404 && redirectOn404) {
    window.location.href = "/404";
  }
  return res;
}

const PROFILE_METADATA_TTL_MS = 30_000;

interface CachedResourceEntry<T> {
  data: T;
  expiresAt: number;
}

class TtlResourceCache<T> {
  private readonly cache = new Map<string, CachedResourceEntry<T>>();
  private readonly inFlight = new Map<string, Promise<T>>();

  async getOrFetch(key: string, fetcher: () => Promise<T>): Promise<T> {
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }
    const existing = this.inFlight.get(key);
    if (existing) {
      return existing;
    }
    const promise = fetcher()
      .then((data) => {
        this.cache.set(key, { data, expiresAt: Date.now() + PROFILE_METADATA_TTL_MS });
        return data;
      })
      .finally(() => {
        this.inFlight.delete(key);
      });
    this.inFlight.set(key, promise);
    return promise;
  }

  invalidate(key?: string): void {
    if (key === undefined) {
      this.cache.clear();
      this.inFlight.clear();
    } else {
      this.cache.delete(key);
      this.inFlight.delete(key);
    }
  }
}

const profileDetailsCache = new TtlResourceCache<Profile>();
const profileAccessPointsCache = new TtlResourceCache<AccessPoint[]>();

export async function getProfiles(options?: ProfileFetchOptions): Promise<Profile[]> {
  const res = await profileFetch("/api/profiles", { signal: options?.signal }, options?.redirectOn404 ?? true);
  if (!res.ok) throw new Error(`Failed to fetch profiles (${res.status})`);
  return res.json();
}

export async function getProfileDetails(profileId: string, options?: ProfileFetchOptions): Promise<Profile> {
  if (options?.redirectOn404 === false) {
    const res = await profileFetch(`/api/profiles/${profileId}`, { signal: options.signal }, false);
    if (!res.ok) throw new Error(`Failed to fetch profile details (${res.status})`);
    return res.json();
  }
  return profileDetailsCache.getOrFetch(profileId, async () => {
    const res = await profileFetch(`/api/profiles/${profileId}`, { signal: options?.signal });
    if (!res.ok) throw new Error("Failed to fetch profile details");
    return res.json();
  });
}

export async function createProfile(name: string): Promise<Profile> {
  const res = await profileFetch("/api/profiles", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name })
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function deleteProfile(id: string): Promise<void> {
  const res = await profileFetch(`/api/profiles/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await res.text());
  profileDetailsCache.invalidate(id);
  profileAccessPointsCache.invalidate(id);
}

export async function updateProfileSettings(profileId: string, settings: GlobalProfileSettings): Promise<void> {
  const res = await profileFetch(`/api/profiles/${profileId}/settings`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings)
  });
  if (!res.ok) throw new Error(await res.text());
  profileDetailsCache.invalidate(profileId);
}

export async function getProfileLists(profileId: string, options?: ProfileFetchOptions): Promise<FilterList[]> {
  const res = await profileFetch(
    `/api/profiles/${profileId}/lists`,
    { signal: options?.signal },
    options?.redirectOn404 ?? true
  );
  if (!res.ok) throw new Error(`Failed to fetch lists (${res.status})`);
  return res.json();
}

/** Result of testing one domain against a single external list's bloom filter. */
export interface ListCheckResult {
  domain: string;
  blocked: boolean;
  whitelisted?: boolean;
  /** The entry that matched: the domain itself, or a parent when a wildcard higher up matched. */
  matchedEntry?: string | null;
  /** False when the list has not finished syncing, so no filter exists yet. */
  synced: boolean;
  /** Configured bloom false-positive rate, so the UI can qualify a match. */
  falsePositiveRate?: number;
  /** Whether the list is currently active. A disabled list still has a bloom. */
  enabled?: boolean;
}

/**
 * Asks whether a list blocks a domain. External lists are stored only as bloom
 * filters, so their entries cannot be listed or substring-searched - but
 * membership is answerable in microseconds, which is what the UI needs.
 */
export async function checkDomainAgainstList(
  profileId: string,
  listId: number,
  domain: string,
  options?: ProfileFetchOptions
): Promise<ListCheckResult> {
  const res = await profileFetch(
    `/api/profiles/${profileId}/lists/${listId}/check?domain=${encodeURIComponent(domain)}`,
    { signal: options?.signal },
    options?.redirectOn404 ?? true
  );
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

/**
 * Enables or disables an external list without deleting it. Disabled lists are
 * skipped by the sync orchestrator and excluded when the merged profile bloom
 * is rebuilt, so the subscription and its sync history are preserved.
 */
export async function toggleProfileList(
  profileId: string,
  listId: number,
  enabled: boolean,
  options?: ProfileFetchOptions
): Promise<void> {
  const res = await profileFetch(
    `/api/profiles/${profileId}/lists/${listId}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
      signal: options?.signal,
    },
    options?.redirectOn404 ?? true
  );
  if (!res.ok) throw new Error(await res.text());
}

/**
 * Retains a system-distributed list as a user-level list, removing the system tag
 * so that subsequent administrator revocations will not remove it.
 */
export async function keepProfileList(profileId: string, listId: number): Promise<{ success: boolean; id: number; is_system: number }> {
  const res = await profileFetch(`/api/profiles/${profileId}/lists/${listId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "keep" })
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function addCustomProfileList(
  profileId: string,
  url: string,
  options?: ProfileFetchOptions
): Promise<{ id?: number }> {
  const res = await profileFetch(
    `/api/profiles/${profileId}/lists`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
      signal: options?.signal,
    },
    options?.redirectOn404 ?? true
  );
  if (!res.ok) throw new Error(await res.text());
  try {
    return await res.json();
  } catch {
    return {};
  }
}

export async function deleteCustomProfileList(profileId: string, listId: number): Promise<void> {
  const res = await profileFetch(`/api/profiles/${profileId}/lists`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: listId })
  });
  if (!res.ok) throw new Error(await res.text());
}

export async function syncProfileLists(profileId: string, options?: ProfileFetchOptions): Promise<void> {
  const res = await profileFetch(
    `/api/profiles/${profileId}/lists/sync`,
    {
      method: "POST",
      signal: options?.signal,
    },
    options?.redirectOn404 ?? true
  );
  if (!res.ok) throw new Error(await res.text());
}

export interface SyncProgress {
  syncing: boolean;
  type?: "all" | "single" | "next" | "rebuild";
  listId?: number;
  stage: "preparing" | "fetching" | "combining" | "done";
  current: number;
  total: number;
  percent: number;
}

export async function getProfileSyncStatus(
  profileId: string,
  options?: ProfileFetchOptions
): Promise<SyncProgress> {
  const res = await profileFetch(
    `/api/profiles/${profileId}/lists/sync-status`,
    { signal: options?.signal },
    options?.redirectOn404 ?? true
  );
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function syncSingleProfileList(
  profileId: string,
  listId: number,
  options?: ProfileFetchOptions
): Promise<void> {
  const res = await profileFetch(
    `/api/profiles/${profileId}/lists/${listId}/sync`,
    {
      method: "POST",
      signal: options?.signal,
    },
    options?.redirectOn404 ?? true
  );
  if (!res.ok) throw new Error(await res.text());
}

export async function getProfileRules(profileId: string, options?: ProfileFetchOptions): Promise<Rule[]> {
  const res = await profileFetch(
    `/api/profiles/${profileId}/rules`,
    { signal: options?.signal },
    options?.redirectOn404 ?? true
  );
  if (!res.ok) throw new Error(`Failed to fetch rules (${res.status})`);
  return res.json();
}

export async function addProfileRule(
  profileId: string,
  rule: Omit<Rule, "id">,
  options?: ProfileFetchOptions
): Promise<void> {
  const res = await profileFetch(
    `/api/profiles/${profileId}/rules`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(rule),
      signal: options?.signal,
    },
    options?.redirectOn404 ?? true
  );
  if (!res.ok) throw new Error(await res.text());
}

export async function addProfileRulesBulk(
  profileId: string,
  rules: Omit<Rule, "id">[],
  options?: ProfileFetchOptions
): Promise<{ count: number }> {
  const res = await profileFetch(
    `/api/profiles/${profileId}/rules`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(rules),
      signal: options?.signal,
    },
    options?.redirectOn404 ?? true
  );
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function addProfileListsBulk(
  profileId: string,
  urls: (string | { url: string; enabled?: boolean | number })[]
): Promise<{ count: number }> {
  const res = await profileFetch(`/api/profiles/${profileId}/lists`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(urls)
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function updateProfileRule(
  profileId: string,
  rule: Rule,
  options?: ProfileFetchOptions
): Promise<void> {
  const res = await profileFetch(
    `/api/profiles/${profileId}/rules`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(rule),
      signal: options?.signal,
    },
    options?.redirectOn404 ?? true
  );
  if (!res.ok) throw new Error(await res.text());
}

export async function deleteProfileRule(
  profileId: string,
  ruleId: number,
  options?: ProfileFetchOptions
): Promise<void> {
  const res = await profileFetch(
    `/api/profiles/${profileId}/rules`,
    {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: ruleId }),
      signal: options?.signal,
    },
    options?.redirectOn404 ?? true
  );
  if (!res.ok) throw new Error(await res.text());
}

/**
 * Deletes multiple custom rules from a profile in a single batch API call.
 */
export async function deleteProfileRulesBulk(
  profileId: string,
  ruleIds: number[],
  options?: ProfileFetchOptions
): Promise<{ success: boolean; count: number }> {
  const res = await profileFetch(
    `/api/profiles/${profileId}/rules`,
    {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: ruleIds }),
      signal: options?.signal,
    },
    options?.redirectOn404 ?? true
  );
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

/**
 * Enables or disables multiple custom rules in a single batch API call without deleting them.
 */
export async function toggleProfileRulesBulk(
  profileId: string,
  ruleIds: number[],
  enabled: boolean,
  options?: ProfileFetchOptions
): Promise<{ success: boolean; count: number; enabled: boolean }> {
  const res = await profileFetch(
    `/api/profiles/${profileId}/rules`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: ruleIds, enabled }),
      signal: options?.signal,
    },
    options?.redirectOn404 ?? true
  );
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getProfileAccessPoints(profileId: string): Promise<AccessPoint[]> {
  return profileAccessPointsCache.getOrFetch(profileId, async () => {
    const res = await profileFetch(`/api/profiles/${profileId}/access_points`);
    if (!res.ok) throw new Error("Failed to fetch access points");
    return res.json();
  });
}

export async function getAccessPoints(): Promise<AccessPoint[]> {
  const res = await fetch("/api/access_points");
  if (!res.ok) throw new Error("Failed to fetch access points");
  return res.json();
}

export async function createAccessPoint(
  name: string,
  profileId?: string | null,
  deviceType?: string
): Promise<AccessPoint> {
  const res = await fetch("/api/access_points", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      profile_id: profileId ?? null,
      ...(deviceType ? { device_type: deviceType } : {}),
    }),
  });
  if (!res.ok) throw new Error(await res.text());
  profileAccessPointsCache.invalidate(profileId ?? undefined);
  return res.json();
}

export async function updateAccessPoint(
  apId: string,
  updates: { name?: string; profile_id?: string | null; device_type?: string }
): Promise<AccessPoint> {
  const res = await fetch(`/api/access_points/${apId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error(await res.text());
  profileAccessPointsCache.invalidate();
  return res.json();
}

export async function rotateAccessPointToken(apId: string): Promise<{ token: string }> {
  const res = await fetch(`/api/access_points/${apId}/rotate_token`, {
    method: "POST",
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function deleteAccessPoint(apId: string): Promise<void> {
  const res = await fetch(`/api/access_points/${apId}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(await res.text());
  profileAccessPointsCache.invalidate();
}

export async function addProfileAccessPoint(profileId: string, name: string): Promise<AccessPoint> {
  const res = await profileFetch(`/api/profiles/${profileId}/access_points`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name })
  });
  if (!res.ok) throw new Error(await res.text());
  profileAccessPointsCache.invalidate(profileId);
  return res.json();
}

export async function deleteProfileAccessPoint(profileId: string, apId: string): Promise<void> {
  const res = await profileFetch(`/api/profiles/${profileId}/access_points/${apId}`, {
    method: "DELETE"
  });
  if (!res.ok) throw new Error(await res.text());
  profileAccessPointsCache.invalidate(profileId);
}

export async function renameProfileAccessPoint(profileId: string, apId: string, name: string): Promise<void> {
  const res = await profileFetch(`/api/profiles/${profileId}/access_points/${apId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name })
  });
  if (!res.ok) throw new Error(await res.text());
  profileAccessPointsCache.invalidate(profileId);
}

export async function rotateProfileAccessPointToken(profileId: string, apId: string): Promise<{ token: string }> {
  const res = await profileFetch(`/api/profiles/${profileId}/access_points/${apId}/rotate_token`, {
    method: "POST"
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getProfileLogs(profileId: string, queryParams: string, options?: ProfileFetchOptions): Promise<LogEntry[]> {
  const query = queryParams.startsWith("?") ? queryParams.slice(1) : queryParams;
  const res = await profileFetch(
    `/api/profiles/${profileId}/logs?${query}`,
    { signal: options?.signal },
    options?.redirectOn404 ?? true
  );
  if (!res.ok) throw new Error(`Failed to fetch logs (${res.status})`);
  return res.json();
}

export async function exportProfileLogs(profileId: string, queryParams: string): Promise<any[]> {
  const query = queryParams.startsWith("?") ? queryParams.slice(1) : queryParams;
  const res = await profileFetch(`/api/profiles/${profileId}/logs/export?${query}`);
  if (!res.ok) throw new Error("Failed to export logs");
  return res.json();
}

export async function getProfileLogDetails(
  profileId: string,
  logId: number,
  timestamp?: number,
  options?: ProfileFetchOptions
): Promise<LogEntry> {
  const query = timestamp !== undefined ? `?timestamp=${timestamp}` : "";
  const res = await profileFetch(
    `/api/profiles/${profileId}/logs/${logId}${query}`,
    { signal: options?.signal },
    options?.redirectOn404 ?? true
  );
  if (!res.ok) throw new Error(`Failed to fetch log details (${res.status})`);
  return res.json();
}

export async function clearProfileLogs(profileId: string): Promise<void> {
  const res = await profileFetch(`/api/profiles/${profileId}/logs`, {
    method: "DELETE"
  });
  if (!res.ok) throw new Error(await res.text());
}

export async function getProfileAnalytics(profileId: string, type: string, queryParams: string, options?: ProfileFetchOptions): Promise<any> {
  const query = queryParams.startsWith("?") ? queryParams.slice(1) : queryParams;
  const path = type ? `/${type}` : "";
  const res = await profileFetch(
    `/api/profiles/${profileId}/analytics${path}?${query}`,
    { signal: options?.signal },
    options?.redirectOn404 ?? true
  );
  if (!res.ok) throw new Error(`Failed to fetch analytics${type ? ` for ${type}` : ""} (${res.status})`);
  return res.json();
}

export async function testResolution(
  profileId: string,
  payload: { domain: string; type: string },
  options?: ProfileFetchOptions
): Promise<TestResponse> {
  const res = await profileFetch(
    `/api/profiles/${profileId}/test`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: options?.signal,
    },
    options?.redirectOn404 ?? true
  );
  if (!res.ok) throw new Error(`Resolution test failed (${res.status})`);
  return res.json();
}

export async function renameProfile(profileId: string, name: string): Promise<void> {
  const res = await profileFetch(`/api/profiles/${profileId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name })
  });
  if (!res.ok) throw new Error(await res.text());
  profileDetailsCache.invalidate(profileId);
}
