import assert from "node:assert";
import { WEBMCP_DATA_CHANGED_EVENT, WEBMCP_PREF_CHANGED_EVENT } from "../src/webmcp/events";
import { setWebMcpPreferenceEnabled } from "../src/webmcp/policy";
import { WebMcpRegistry } from "../src/webmcp/registry";
import type { NavigatorModelContext, WebMcpNativeToolDescriptor, WebMcpRuntimeState } from "../src/webmcp/types";
import { createFilteringWebMcpTools } from "../src/webmcp/tools/filteringTools";
import { createRulesWebMcpTools } from "../src/webmcp/tools/rulesTools";
import {
  parsePositiveIntArrayInput,
  validateRulePatternInput,
  validateSubscriptionUrlInput,
} from "../src/webmcp/tools/validation";
import type { FilterList, Rule, UserList } from "../src/services";

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

function createHarness(confirmResult: boolean = true) {
  const registered = new Map<string, WebMcpNativeToolDescriptor>();
  const confirmCalls: Array<{ toolName: string; summary: string }> = [];
  const mockContext: NavigatorModelContext = {
    registerTool: (t) => registered.set(t.name, t),
    unregisterTool: (name) => registered.delete(name),
    clearContext: () => registered.clear(),
  };
  const registry = new WebMcpRegistry({
    getModelContext: () => mockContext,
    confirmWriteFn: async (toolName, summary) => {
      confirmCalls.push({ toolName, summary });
      return confirmResult;
    },
  });
  return { registry, registered, confirmCalls };
}

async function runTests(): Promise<void> {
  console.log(">>> [TEST] Running WebMCP Phase 2 (Rules + Filtering + HITL + UI Sync) Tests...");

  // 1. Phase 2 validation helpers
  console.log("1. Testing Phase 2 rule & subscription URL validators...");
  {
    assert.deepStrictEqual(validateRulePatternInput(" *.Ads.Example.COM. "), {
      ok: true,
      value: "*.ads.example.com",
    });
    assert.strictEqual(validateRulePatternInput("*").ok, false);
    assert.strictEqual(validateRulePatternInput("*.*").ok, false);
    assert.strictEqual(validateRulePatternInput("https://ads.example.com/bad").ok, false);

    assert.deepStrictEqual(validateSubscriptionUrlInput(" https://example.com/hosts.txt "), {
      ok: true,
      value: "https://example.com/hosts.txt",
    });
    assert.strictEqual(validateSubscriptionUrlInput("ftp://example.com/hosts.txt").ok, false);
    assert.strictEqual(validateSubscriptionUrlInput("javascript:alert(1)").ok, false);

    assert.deepStrictEqual(parsePositiveIntArrayInput([3, 1, 3, 2], "ruleIds"), {
      ok: true,
      value: [3, 1, 2],
    });
    assert.strictEqual(parsePositiveIntArrayInput([], "ruleIds").ok, false);
    console.log("   ✓ Phase 2 validators passed.");
  }

  // 2. Rules group: read filtering, HITL write gating, update merge, Demo Mode guard, UI event emission
  console.log("2. Testing rules WebMCP tool group...");
  {
    let rulesDb: Rule[] = [
      { id: 10, type: "BLOCK", pattern: "tracker\u202E.bad.example", include_subdomains: 1, enabled: 1, created_at: 1700000000 },
      { id: 11, type: "ALLOW", pattern: "safe.example.com", include_subdomains: 0, enabled: 1, created_at: 1700000001 },
      { id: 12, type: "REDIRECT", pattern: "local.dev", v_a: "127.0.0.1", enabled: 0, created_at: 1700000002 },
    ];
    const redirectFlags: Array<boolean | undefined> = [];
    const emittedEvents: Array<{ type: string; detail: unknown }> = [];

    const originalWindow = (globalThis as { window?: unknown }).window;
    const originalCustomEvent = (globalThis as { CustomEvent?: unknown }).CustomEvent;

    class MockCustomEvent<T> {
      type: string;
      detail: T;
      constructor(type: string, init?: { detail?: T }) {
        this.type = type;
        this.detail = init?.detail as T;
      }
    }

    (globalThis as { CustomEvent?: unknown }).CustomEvent = MockCustomEvent;
    (globalThis as { window?: unknown }).window = {
      dispatchEvent: (ev: { type: string; detail: unknown }) => {
        emittedEvents.push({ type: ev.type, detail: ev.detail });
        return true;
      },
    };

    try {
      const rulesTools = createRulesWebMcpTools({
        getProfileRules: async (_pid, opts) => {
          redirectFlags.push(opts?.redirectOn404);
          return rulesDb;
        },
        addProfileRule: async (_pid, rule, opts) => {
          redirectFlags.push(opts?.redirectOn404);
          rulesDb.push({ ...rule, id: 13 });
        },
        addProfileRulesBulk: async (_pid, rules, opts) => {
          redirectFlags.push(opts?.redirectOn404);
          return { count: rules.length };
        },
        updateProfileRule: async (_pid, updated, opts) => {
          redirectFlags.push(opts?.redirectOn404);
          rulesDb = rulesDb.map((r) => (r.id === updated.id ? updated : r));
        },
        toggleProfileRulesBulk: async (_pid, ruleIds, enabled, opts) => {
          redirectFlags.push(opts?.redirectOn404);
          return { success: true, count: ruleIds.length, enabled };
        },
        deleteProfileRulesBulk: async (_pid, ruleIds, opts) => {
          redirectFlags.push(opts?.redirectOn404);
          rulesDb = rulesDb.filter((r) => !ruleIds.includes(r.id));
          return { success: true, count: ruleIds.length };
        },
      });

      const { registry, registered, confirmCalls } = createHarness(true);
      registry.registerGroup("rules", rulesTools);
      registry.setRuntimeState(createState());

      // All 6 rules tools registered in normal unlocked state
      assert.strictEqual(registered.has("dnsworker_list_rules"), true);
      assert.strictEqual(registered.has("dnsworker_add_rule"), true);
      assert.strictEqual(registered.get("dnsworker_delete_rules")?.annotations?.destructiveHint, true);

      // List + filter + bidi sanitize
      const listRes = await registry.invokeTool("dnsworker_list_rules", { type: "BLOCK" });
      assert.strictEqual(listRes.isError, undefined);
      const listPayload = JSON.parse(listRes.content[0].text);
      assert.strictEqual(listPayload.data._untrustedDataOnly, true);
      assert.strictEqual(listPayload.data.data.totalMatching, 1);
      assert.strictEqual(listPayload.data.data.rules[0].pattern, "tracker .bad.example");
      assert.strictEqual(listPayload.data.data.rules[0].pattern.includes("\u202E"), false);

      // Add rule rejects REDIRECT without target
      const badRedirectRes = await registry.invokeTool("dnsworker_add_rule", {
        type: "REDIRECT",
        pattern: "noop.example.com",
      });
      assert.strictEqual(badRedirectRes.isError, true);
      assert.strictEqual(JSON.parse(badRedirectRes.content[0].text).error.code, "INVALID_INPUT");

      // Add valid rule triggers HITL confirm & emits UI refresh event
      const addRes = await registry.invokeTool("dnsworker_add_rule", {
        type: "ALLOW",
        pattern: "api.example.com",
      });
      assert.strictEqual(addRes.isError, undefined);
      assert.strictEqual(confirmCalls.length, 1);
      assert.strictEqual(confirmCalls[0].toolName, "dnsworker_add_rule");
      assert.strictEqual(
        emittedEvents.some(
          (e) =>
            e.type === WEBMCP_DATA_CHANGED_EVENT &&
            (e.detail as { scope?: string; profileId?: string }).scope === "rules" &&
            (e.detail as { profileId?: string }).profileId === "prof_main"
        ),
        true
      );

      // Partial update preserves existing target v_a on rule #12
      const updateRes = await registry.invokeTool("dnsworker_update_rule", {
        id: 12,
        enabled: true,
      });
      assert.strictEqual(updateRes.isError, undefined);
      const updated12 = rulesDb.find((r) => r.id === 12);
      assert.strictEqual(updated12?.enabled, true);
      assert.strictEqual(updated12?.v_a, "127.0.0.1");

      // Bulk toggle & delete
      const toggleRes = await registry.invokeTool("dnsworker_toggle_rules_bulk", {
        ruleIds: [10, 11],
        enabled: false,
      });
      assert.strictEqual(JSON.parse(toggleRes.content[0].text).data.count, 2);

      const delRes = await registry.invokeTool("dnsworker_delete_rules", { ruleIds: [13] });
      assert.strictEqual(JSON.parse(delRes.content[0].text).data.count, 1);
      assert.strictEqual(rulesDb.some((r) => r.id === 13), false);
      assert.strictEqual(redirectFlags.every((flag) => flag === false), true);

      // Demo mode hides mutating rules tools & blocks direct invocation
      registry.setRuntimeState(createState({ isDemoMode: true }));
      assert.strictEqual(registered.has("dnsworker_list_rules"), true);
      assert.strictEqual(registered.has("dnsworker_add_rule"), false);
      const demoWriteRes = await registry.invokeTool("dnsworker_delete_rules", { ruleIds: [10] });
      assert.strictEqual(demoWriteRes.isError, true);
      assert.strictEqual(JSON.parse(demoWriteRes.content[0].text).error.code, "DEMO_MODE_READONLY");

      // Denied HITL confirmation fails closed
      const { registry: deniedRegistry } = createHarness(false);
      deniedRegistry.registerGroup("rules", rulesTools);
      deniedRegistry.setRuntimeState(createState());
      const deniedRes = await deniedRegistry.invokeTool("dnsworker_add_rule", {
        type: "BLOCK",
        pattern: "denied.example.com",
      });
      assert.strictEqual(deniedRes.isError, true);
      assert.strictEqual(JSON.parse(deniedRes.content[0].text).error.code, "CONFIRMATION_DENIED");
    } finally {
      (globalThis as { window?: unknown }).window = originalWindow;
      (globalThis as { CustomEvent?: unknown }).CustomEvent = originalCustomEvent;
    }
    console.log("   ✓ Rules WebMCP tool group passed.");
  }

  // 3. Filtering group: read subscriptions/presets/status + toggle/subscribe/sync writes
  console.log("3. Testing filtering WebMCP tool group...");
  {
    const redirectFlags: Array<boolean | undefined> = [];
    let lastToggleScope: string | null = null;
    let lastSyncedMode: string | null = null;

    const sampleProfileLists: FilterList[] = [
      {
        id: 1,
        url: "https://filters.example.com/ads.txt",
        enabled: true,
        scope: "profile",
        last_synced_at: 1700001000,
        sync_error: "Timeout\u202E warning",
      },
      {
        id: 2,
        url: "https://filters.example.com/system.txt",
        enabled: true,
        scope: "system",
        is_system: 1,
      },
    ];
    const sampleUserLists: UserList[] = [
      {
        id: 50,
        user_id: "usr_1",
        url: "https://user.example.com/block.txt",
        is_system: 0,
        enabled: true,
        created_at: 1700000500,
      },
    ];

    const filteringTools = createFilteringWebMcpTools({
      getProfileLists: async (_pid, opts) => {
        redirectFlags.push(opts?.redirectOn404);
        return sampleProfileLists;
      },
      getProfileSyncStatus: async (_pid, opts) => {
        redirectFlags.push(opts?.redirectOn404);
        return { syncing: true, type: "all", stage: "fetching", current: 1, total: 2, percent: 50 };
      },
      toggleProfileList: async (_pid, _listId, _enabled, opts) => {
        redirectFlags.push(opts?.redirectOn404);
        lastToggleScope = "profile";
      },
      addCustomProfileList: async (_pid, _url, opts) => {
        redirectFlags.push(opts?.redirectOn404);
        return { id: 99 };
      },
      syncProfileLists: async (_pid, opts) => {
        redirectFlags.push(opts?.redirectOn404);
        lastSyncedMode = "all";
      },
      syncSingleProfileList: async (_pid, _listId, opts) => {
        redirectFlags.push(opts?.redirectOn404);
        lastSyncedMode = "single";
      },
      getUserLists: async () => sampleUserLists,
      addUserList: async () => ({ id: 51 }),
      toggleUserList: async () => {
        lastToggleScope = "user";
      },
      getPresetFilters: async () => [{ label: "OISD Big", url: "https://big.oisd.nl" }],
    });

    const { registry } = createHarness(true);
    registry.registerGroup("filtering", filteringTools);
    registry.setRuntimeState(createState());

    const subRes = await registry.invokeTool("dnsworker_list_filter_subscriptions", { scope: "all" });
    assert.strictEqual(subRes.isError, undefined);
    const subOuter = JSON.parse(subRes.content[0].text).data;
    assert.strictEqual(subOuter._untrustedDataOnly, true);
    const subData = subOuter.data;
    assert.strictEqual(subData.profileLists.length, 2);
    assert.strictEqual(subData.userLists.length, 1);
    assert.strictEqual(subData.profileLists[0].sync_error, "Timeout warning");

    const presetRes = await registry.invokeTool("dnsworker_list_preset_filters", {});
    assert.strictEqual(JSON.parse(presetRes.content[0].text).data.data.presets[0].label, "OISD Big");

    const statusRes = await registry.invokeTool("dnsworker_get_sync_status", {});
    assert.strictEqual(JSON.parse(statusRes.content[0].text).data.percent, 50);

    await registry.invokeTool("dnsworker_toggle_filter_list", {
      scope: "user",
      listId: 50,
      enabled: false,
    });
    assert.strictEqual(lastToggleScope, "user");

    const subscribeRes = await registry.invokeTool("dnsworker_subscribe_filter_list", {
      scope: "profile",
      url: "https://example.org/newlist.txt",
    });
    assert.strictEqual(JSON.parse(subscribeRes.content[0].text).data.id, 99);

    const syncRes = await registry.invokeTool("dnsworker_sync_filter_lists", { listId: 1 });
    assert.strictEqual(JSON.parse(syncRes.content[0].text).data.mode, "single");
    assert.strictEqual(lastSyncedMode, "single");
    assert.strictEqual(redirectFlags.every((f) => f === false), true);

    console.log("   ✓ Filtering WebMCP tool group passed.");
  }

  // 4. Local preference persistence & change notification
  console.log("4. Testing WebMCP preference persistence & event broadcast...");
  {
    const store = new Map<string, string>();
    const prefEvents: boolean[] = [];
    const originalStorage = (globalThis as { localStorage?: unknown }).localStorage;
    const originalWindow = (globalThis as { window?: unknown }).window;
    const originalCustomEvent = (globalThis as { CustomEvent?: unknown }).CustomEvent;

    class MockCustomEvent<T> {
      type: string;
      detail: T;
      constructor(type: string, init?: { detail?: T }) {
        this.type = type;
        this.detail = init?.detail as T;
      }
    }

    (globalThis as { CustomEvent?: unknown }).CustomEvent = MockCustomEvent;
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
    };
    (globalThis as { window?: unknown }).window = {
      dispatchEvent: (ev: { type: string; detail?: { enabled?: boolean } }) => {
        if (ev.type === WEBMCP_PREF_CHANGED_EVENT && typeof ev.detail?.enabled === "boolean") {
          prefEvents.push(ev.detail.enabled);
        }
        return true;
      },
    };

    try {
      setWebMcpPreferenceEnabled(false);
      setWebMcpPreferenceEnabled(true);
      assert.strictEqual(store.get("dns_worker_webmcp_enabled"), "true");
      assert.deepStrictEqual(prefEvents, [false, true]);
    } finally {
      (globalThis as { localStorage?: unknown }).localStorage = originalStorage;
      (globalThis as { window?: unknown }).window = originalWindow;
      (globalThis as { CustomEvent?: unknown }).CustomEvent = originalCustomEvent;
    }
    console.log("   ✓ WebMCP preference persistence & event broadcast passed.");
  }

  console.log("All WebMCP Phase 2 tests passed!");
}

runTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
