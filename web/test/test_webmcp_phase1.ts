import assert from "node:assert";
import { WebMcpRegistry } from "../src/webmcp/registry";
import type { NavigatorModelContext, WebMcpNativeToolDescriptor, WebMcpRuntimeState } from "../src/webmcp/types";
import { createDiagnosticsWebMcpTools } from "../src/webmcp/tools/diagnosticsTools";
import { createAnalyticsLogsWebMcpTools } from "../src/webmcp/tools/analyticsLogsTools";
import {
  normalizeDomainInput,
  normalizeRecordTypeInput,
  parsePositiveIntInput,
  resolveProfileIdInput,
} from "../src/webmcp/tools/validation";
import { profileFetch } from "../src/services/profiles";

function createState(overrides: Partial<WebMcpRuntimeState> = {}): WebMcpRuntimeState {
  return {
    isSupported: true,
    isEnabled: true,
    isLoggedIn: true,
    isLocked: false,
    isDemoMode: false,
    isE2eeEnabled: false,
    isE2eeUnlocked: false,
    userRole: "user",
    activeProfileId: "prof_main",
    deploymentMode: "cloudflare",
    ...overrides,
  };
}

function createHarness() {
  const registered = new Map<string, WebMcpNativeToolDescriptor>();
  const mockContext: NavigatorModelContext = {
    registerTool: (t) => registered.set(t.name, t),
    unregisterTool: (name) => registered.delete(name),
    clearContext: () => registered.clear(),
  };
  const registry = new WebMcpRegistry({ getModelContext: () => mockContext });
  return { registry, registered };
}

async function runTests(): Promise<void> {
  console.log(">>> [TEST] Running WebMCP Phase 1 (Diagnostics + Analytics/Logs + Safe Fetch) Tests...");

  // 1. Input validation helpers
  console.log("1. Testing validation helpers...");
  {
    assert.deepStrictEqual(normalizeDomainInput("https://Ads.Example.COM:8443/path."), {
      ok: true,
      value: "ads.example.com",
    });
    assert.strictEqual(normalizeDomainInput("bad domain!").ok, false);
    assert.deepStrictEqual(resolveProfileIdInput(undefined, "prof_main"), {
      ok: true,
      value: "prof_main",
    });
    assert.strictEqual(resolveProfileIdInput("bad id!", null).ok, false);
    assert.deepStrictEqual(normalizeRecordTypeInput("txt"), { ok: true, value: "TXT" });
    assert.strictEqual(normalizeRecordTypeInput("AXFR").ok, false);
    assert.deepStrictEqual(parsePositiveIntInput(12, "listId"), { ok: true, value: 12 });
    assert.strictEqual(parsePositiveIntInput(0, "listId").ok, false);
    console.log("   ✓ Validation helpers passed.");
  }

  // 2. Non-redirecting profileFetch(..., false) on HTTP 404
  console.log("2. Testing profileFetch redirectOn404=false behavior...");
  {
    const originalFetch = globalThis.fetch;
    const originalWindow = (globalThis as { window?: unknown }).window;
    let redirected = false;

    (globalThis as { window?: unknown }).window = {
      location: {
        set href(_v: string) {
          redirected = true;
        },
        get href() {
          return "/";
        },
      },
    };
    globalThis.fetch = (async () => new Response("Not Found", { status: 404 })) as typeof fetch;

    try {
      const noRedirectRes = await profileFetch("/api/profiles/missing", undefined, false);
      assert.strictEqual(noRedirectRes.status, 404);
      assert.strictEqual(redirected, false, "WebMCP calls must NOT trigger window.location redirect on 404");

      const uiRedirectRes = await profileFetch("/api/profiles/missing", undefined, true);
      assert.strictEqual(uiRedirectRes.status, 404);
      assert.strictEqual(redirected, true, "Default UI calls keep 404 redirect behavior");
    } finally {
      globalThis.fetch = originalFetch;
      (globalThis as { window?: unknown }).window = originalWindow;
    }
    console.log("   ✓ profileFetch redirectOn404 isolation passed.");
  }

  // 3. Diagnostics tools
  console.log("3. Testing diagnostics WebMCP tool group...");
  {
    const { registry, registered } = createHarness();
    const redirectFlags: Array<boolean | undefined> = [];

    const diagTools = createDiagnosticsWebMcpTools({
      testResolution: async (_pid, payload, opts) => {
        redirectFlags.push(opts?.redirectOn404);
        return {
          action: "BLOCK",
          reason: `Matched external filter\u202E ${payload.domain}`,
          ttl: 60,
          latency: 4,
          answer: "0.0.0.0",
          client_ip: "198.51.100.1",
          geo_country: "US",
          answers: [{ type: "A", data: "0.0.0.0", ttl: 60 }],
        };
      },
      getProfileRules: async (_pid, opts) => {
        redirectFlags.push(opts?.redirectOn404);
        return [
          { id: 1, type: "BLOCK", pattern: "*.tracker.example.com", enabled: 1 },
          { id: 2, type: "ALLOW", pattern: "disabled.example.com", enabled: 0 },
        ];
      },
      getProfileLists: async (_pid, opts) => {
        redirectFlags.push(opts?.redirectOn404);
        return [
          { id: 10, url: "https://big.oisd.nl", enabled: true, scope: "system" },
          { id: 11, url: "https://disabled.list", enabled: false, scope: "profile" },
        ];
      },
      checkDomainAgainstList: async (_pid, listId, domain, opts) => {
        redirectFlags.push(opts?.redirectOn404);
        return {
          domain,
          blocked: listId === 10,
          whitelisted: false,
          matchedEntry: listId === 10 ? "||tracker.example.com^" : null,
          synced: true,
          enabled: true,
        };
      },
      getClientInfo: async () => ({
        ip: "198.51.100.2",
        asn: 64512,
        asOrganization: "Example ISP",
        country: "SG",
        city: "Singapore",
        mode: "cloudflare",
        substituteDomain: "www.wto.org",
      }),
      getSubstituteInfo: async () => ({
        ip: "198.51.100.10",
        ipv6: null,
        ipv4List: ["198.51.100.10"],
        ipv6List: [],
      }),
    });

    registry.registerGroup("diagnostics", diagTools);
    registry.setRuntimeState(createState());
    assert(registered.has("dnsworker_diagnose_domain"));
    assert(registered.has("dnsworker_check_domain_in_list"));
    assert(registered.has("dnsworker_get_network_probe"));

    const diagRes = JSON.parse(
      (
        await registry.invokeTool("dnsworker_diagnose_domain", {
          domain: "https://sub.tracker.example.com/pixel",
        })
      ).content[0].text
    );

    assert.strictEqual(diagRes.ok, true);
    assert.strictEqual(diagRes.data._untrustedDataOnly, true);
    assert.strictEqual(diagRes.data.data.domain, "sub.tracker.example.com");
    assert.strictEqual(diagRes.data.data.resolution.action, "BLOCK");
    assert(!diagRes.data.data.resolution.reason.includes("\u202E"));
    assert.strictEqual(diagRes.data.data.matchingLocalRules.items.length, 1);
    assert.strictEqual(diagRes.data.data.externalListMatches.items.length, 1);
    assert.strictEqual(diagRes.data.data.checkedEnabledListsCount, 1);
    assert(redirectFlags.every((flag) => flag === false), "All diagnostic calls must set redirectOn404: false");

    const singleListRes = JSON.parse(
      (
        await registry.invokeTool("dnsworker_check_domain_in_list", {
          domain: "sub.tracker.example.com",
          listId: 10,
        })
      ).content[0].text
    );
    assert.strictEqual(singleListRes.ok, true);
    assert.strictEqual(singleListRes.data.data.blocked, true);

    const probeRes = JSON.parse((await registry.invokeTool("dnsworker_get_network_probe")).content[0].text);
    assert.strictEqual(probeRes.ok, true);
    assert.strictEqual(probeRes.data.data.clientInfo.ip, "198.51.100.2");
    console.log("   ✓ Diagnostics tools passed.");
  }

  // 4. Analytics & Local-First OPFS Log tools
  console.log("4. Testing analytics_logs WebMCP tool group...");
  {
    const { registry } = createHarness();
    const tools = createAnalyticsLogsWebMcpTools({
      getProfiles: async (opts) => {
        assert.strictEqual(opts?.redirectOn404, false);
        return [
          {
            id: "prof_main",
            profile_key: "super_secret_routing_key",
            owner_id: "u1",
            name: "Main\u0007Profile",
            settings: JSON.stringify({ default_policy: "ALLOW", block_mode: "NXDOMAIN", log_retention_days: 30, upstream: ["https://1.1.1.1/dns-query"] }),
            created_at: 1700000000,
            updated_at: 1700000100,
          },
        ];
      },
      getProfileAnalytics: async (_pid, _type, _q, opts) => {
        assert.strictEqual(opts?.redirectOn404, false);
        return {
          summary: [{ action: "BLOCK", count: 12 }],
          trend: [],
          top_allowed: [{ domain: "ok.example.com", count: 40 }],
          top_blocked: [{ domain: "ads.example.com", count: 12 }],
          clients: [{ client_ip: "192.0.2.1", geo_country: "JP", count: 52 }],
          destinations: [{ country_code: "US", country: "United States", count: 40 }],
        };
      },
      getProfileLogDetails: async (_pid, id, _ts, opts) => {
        assert.strictEqual(opts?.redirectOn404, false);
        return {
          id,
          timestamp: 1700000050,
          domain: "ads.example.com",
          record_type: "A",
          action: "BLOCK",
          reason: "List match",
          client_ip: "192.0.2.1",
        };
      },
      localDb: {
        getWatermark: async () => null,
        getStorageInfo: async () => ({
          totalRows: 0,
          isOpfs: true,
          profileStats: [],
        }),
        queryLogs: async () => ({
          rows: [],
          total: 0,
          stats: { total: 0, pass: 0, block: 0, redirect: 0 },
        }),
        queryAnalytics: async () => ({
          summary: [],
          trend: [],
          top_allowed: [],
          top_blocked: [],
          clients: [],
          destinations: [],
        }),
      },
    });

    registry.registerGroup("analytics_logs", tools);

    // E2EE enabled & locked -> allow profile list, block encrypted log/analytics queries with E2EE_LOCKED
    registry.setRuntimeState(createState({ isE2eeEnabled: true, isE2eeUnlocked: false }));

    const profilesRes = JSON.parse((await registry.invokeTool("dnsworker_list_profiles_summary")).content[0].text);
    assert.strictEqual(profilesRes.ok, true);
    const listedProfile = profilesRes.data.data.profiles.items[0];
    assert.strictEqual(listedProfile.profile_key, undefined, "profile_key routing secret must never be exposed");
    assert.strictEqual(listedProfile.policy.blockMode, "NXDOMAIN");

    const lockedLogRes = JSON.parse((await registry.invokeTool("dnsworker_query_local_logs")).content[0].text);
    assert.strictEqual(lockedLogRes.error.code, "E2EE_LOCKED");

    // Disable E2EE -> allow local log query, analytics fallback, and log detail
    registry.setRuntimeState(createState({ isE2eeEnabled: false, isE2eeUnlocked: false }));
    const localLogsOk = JSON.parse((await registry.invokeTool("dnsworker_query_local_logs")).content[0].text);
    assert.strictEqual(localLogsOk.ok, true);
    assert(localLogsOk.data.data.hint.includes("OPFS"));

    const analyticsRes = JSON.parse(
      (await registry.invokeTool("dnsworker_get_analytics_summary", { hours: 24, source: "auto" })).content[0].text
    );
    assert.strictEqual(analyticsRes.ok, true);
    assert.strictEqual(analyticsRes.data.data.source, "remote");
    assert.strictEqual(analyticsRes.data.data.analytics.topBlocked.items[0].domain, "ads.example.com");

    const detailRes = JSON.parse((await registry.invokeTool("dnsworker_get_log_detail", { logId: 99 })).content[0].text);
    assert.strictEqual(detailRes.ok, true);
    assert.strictEqual(detailRes.data.data.entry.id, 99);
    console.log("   ✓ Analytics & Local-First OPFS Log tools passed.");
  }

  console.log("\n>>> [TEST] All WebMCP Phase 1 tests passed successfully!");
}

runTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
