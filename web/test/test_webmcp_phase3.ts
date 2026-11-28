import assert from "node:assert";
import { WEBMCP_DATA_CHANGED_EVENT } from "../src/webmcp/events";
import { WebMcpRegistry } from "../src/webmcp/registry";
import type { NavigatorModelContext, WebMcpNativeToolDescriptor, WebMcpRuntimeState } from "../src/webmcp/types";
import { createAccessPointsWebMcpTools } from "../src/webmcp/tools/accessPointsTools";
import { createAdminOpsWebMcpTools } from "../src/webmcp/tools/adminOpsTools";
import { createProfilesWebMcpTools } from "../src/webmcp/tools/profilesTools";
import {
  validateAccessPointIdInput,
  validateDeviceTypeInput,
  validateDisplayNameInput,
  validateUpstreamListInput,
} from "../src/webmcp/tools/validation";
import type { AccessPoint, Profile, UserInfo } from "../src/services";

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
  console.log(">>> [TEST] Running WebMCP Phase 3 (Access Points + Profiles + Admin Ops) Tests...");

  // 1. Phase 3 validators
  console.log("1. Testing Phase 3 validators...");
  {
    assert.deepStrictEqual(validateAccessPointIdInput(" ap_router_1 "), {
      ok: true,
      value: "ap_router_1",
    });
    assert.strictEqual(validateAccessPointIdInput("bad id!").ok, false);
    assert.deepStrictEqual(validateDisplayNameInput(" Home Router "), {
      ok: true,
      value: "Home Router",
    });
    assert.strictEqual(validateDisplayNameInput("bad\nname").ok, false);
    assert.deepStrictEqual(validateDeviceTypeInput(" iPhone "), { ok: true, value: "iphone" });
    assert.deepStrictEqual(validateUpstreamListInput([" https://1.1.1.1/dns-query "]), {
      ok: true,
      value: ["https://1.1.1.1/dns-query"],
    });
    assert.strictEqual(validateUpstreamListInput([]).ok, false);
    console.log("   ✓ Phase 3 validators passed.");
  }

  // 2. Access Points group (secret token exclusion, bind, create, UI sync event)
  console.log("2. Testing access_points WebMCP tool group...");
  {
    let apDb: AccessPoint[] = [
      {
        id: "ap_1",
        profile_id: "prof_main",
        name: "LivingRoom\u202ERouter",
        token: "ap_secret_token_do_not_expose",
        device_type: "router",
        created_at: 1700000000,
      },
      {
        id: "ap_2",
        profile_id: null,
        name: "SparePhone",
        token: "ap_secret_2",
        device_type: "iphone",
        created_at: 1700000005,
      },
    ];
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
      const apTools = createAccessPointsWebMcpTools({
        getAccessPoints: async () => apDb,
        updateAccessPoint: async (apId, updates) => {
          const idx = apDb.findIndex((a) => a.id === apId);
          apDb[idx] = { ...apDb[idx], ...updates, updated_at: 1700000100 };
          return apDb[idx];
        },
        createAccessPoint: async (name, profileId, deviceType) => {
          const created: AccessPoint = {
            id: "ap_3",
            name,
            profile_id: profileId ?? null,
            device_type: deviceType,
            token: "created_secret_token",
            created_at: 1700000200,
          };
          apDb = [...apDb, created];
          return created;
        },
      });

      const { registry, confirmCalls } = createHarness(true);
      registry.registerGroup("access_points", apTools);
      registry.setRuntimeState(createState());

      const listRes = await registry.invokeTool("dnsworker_list_access_points", { scope: "all" });
      assert.strictEqual(listRes.isError, undefined);
      const listJson = listRes.content[0].text;
      assert.strictEqual(listJson.includes("ap_secret_token_do_not_expose"), false);
      const listData = JSON.parse(listJson).data.data;
      assert.strictEqual(listData.totalMatching, 2);
      assert.strictEqual(listData.accessPoints[0].hasToken, true);
      assert.strictEqual(listData.accessPoints[0].name.includes("\u202E"), false);

      // Rebind ap_2 to prof_main with HITL confirm
      const bindRes = await registry.invokeTool("dnsworker_bind_access_point", {
        apId: "ap_2",
        profileId: "prof_main",
        name: "WorkPhone",
      });
      assert.strictEqual(bindRes.isError, undefined);
      assert.strictEqual(confirmCalls.length, 1);
      assert.strictEqual(apDb[1].profile_id, "prof_main");
      assert.strictEqual(apDb[1].name, "WorkPhone");
      assert.strictEqual(bindRes.content[0].text.includes("ap_secret_2"), false);

      // Create access point without leaking token
      const createRes = await registry.invokeTool("dnsworker_create_access_point", {
        name: "OfficeMac",
        deviceType: "macos",
      });
      assert.strictEqual(createRes.isError, undefined);
      assert.strictEqual(createRes.content[0].text.includes("created_secret_token"), false);
      assert.strictEqual(
        emittedEvents.some(
          (e) =>
            e.type === WEBMCP_DATA_CHANGED_EVENT &&
            (e.detail as { scope?: string }).scope === "access_points"
        ),
        true
      );
    } finally {
      (globalThis as { window?: unknown }).window = originalWindow;
      (globalThis as { CustomEvent?: unknown }).CustomEvent = originalCustomEvent;
    }
    console.log("   ✓ Access Points WebMCP tool group passed.");
  }

  // 3. Profiles group (profile_key stripping, merge-patch update, pause_filtering, redirectOn404=false)
  console.log("3. Testing profiles WebMCP tool group...");
  {
    const redirectFlags: Array<boolean | undefined> = [];
    let storedProfile: Profile = {
      id: "prof_main",
      name: "Primary",
      profile_key: "super_secret_routing_key",
      created_at: 1700000000,
      updated_at: 1700000010,
      settings: JSON.stringify({
        upstream: ["https://cloudflare-dns.com/dns-query"],
        ecs: { enabled: false, use_client_ip: false },
        log_retention_days: 14,
        default_policy: "ALLOW",
        block_mode: "NXDOMAIN",
      }),
    };

    const profileTools = createProfilesWebMcpTools({
      getProfileDetails: async (_pid, opts) => {
        redirectFlags.push(opts?.redirectOn404);
        return storedProfile;
      },
      updateProfileSettings: async (_pid, nextSettings, opts) => {
        redirectFlags.push(opts?.redirectOn404);
        storedProfile = { ...storedProfile, settings: JSON.stringify(nextSettings) };
      },
      renameProfile: async (_pid, name, opts) => {
        redirectFlags.push(opts?.redirectOn404);
        storedProfile = { ...storedProfile, name };
      },
    });

    const { registry } = createHarness(true);
    registry.registerGroup("profiles", profileTools);
    registry.setRuntimeState(createState());

    const getRes = await registry.invokeTool("dnsworker_get_profile_settings", {});
    assert.strictEqual(getRes.isError, undefined);
    assert.strictEqual(getRes.content[0].text.includes("super_secret_routing_key"), false);
    assert.strictEqual(JSON.parse(getRes.content[0].text).data.data.settings.block_mode, "NXDOMAIN");

    const updRes = await registry.invokeTool("dnsworker_update_profile_settings", {
      name: "FamilySafe",
      log_retention_days: 30,
      ecs_enabled: true,
    });
    assert.strictEqual(updRes.isError, undefined);
    assert.strictEqual(storedProfile.name, "FamilySafe");
    const parsedSettings = JSON.parse(storedProfile.settings || "{}");
    assert.strictEqual(parsedSettings.log_retention_days, 30);
    assert.strictEqual(parsedSettings.block_mode, "NXDOMAIN"); // Preserved unedited field!
    assert.strictEqual(parsedSettings.ecs.enabled, true);

    const pauseRes = await registry.invokeTool("dnsworker_toggle_pause_filtering", {
      enabled: true,
      duration_seconds: 600,
    });
    assert.strictEqual(pauseRes.isError, undefined);
    const pauseData = JSON.parse(pauseRes.content[0].text).data.pause_filtering;
    assert.strictEqual(pauseData.enabled, true);
    assert.strictEqual(pauseData.duration_seconds, 600);
    assert.strictEqual(typeof pauseData.expires_at, "number");
    assert.strictEqual(redirectFlags.every((f) => f === false), true);
    console.log("   ✓ Profiles WebMCP tool group passed.");
  }

  // 4. Admin Ops group (strict RBAC isolation + secret filtering + invite code masking)
  console.log("4. Testing admin_ops WebMCP tool group & RBAC gate...");
  {
    const sampleUsers: UserInfo[] = [
      { id: "u_1", username: "admin", role: "admin", totp_enabled: true, mfa_enabled: true, passkeys_count: 1 },
      { id: "u_2", username: "bob", role: "user", totp_enabled: false, mfa_enabled: false },
    ];
    const adminTools = createAdminOpsWebMcpTools({
      getRuntimeStatus: async () => ({
        supported: true,
        currentVersion: "1.3.7",
        currentChannel: "latest",
        startedAt: 1700000000,
        runtime: "node v22",
        platform: "linux",
        installMethod: "docker",
        serviceManager: "docker",
        workersCount: 4,
        canRestart: true,
        restartReason: null,
        checkedAt: 1700000500,
        checkError: null,
        channels: {
          latest: { channel: "latest", version: "1.3.7", updateAvailable: false, updateCommand: "" },
          alpha: { channel: "alpha", version: null, updateAvailable: false, updateCommand: "" },
          canary: { channel: "canary", version: null, updateAvailable: false, updateCommand: "" },
        },
      }),
      getDatabaseStatus: async () => ({
        databaseService: "Local SQLite",
        isTurso: false,
        configured: true,
        migrations: {
          completed: true,
          totalAvailable: 12,
          appliedCount: 12,
          pendingCount: 0,
          lastApplied: "0012.sql",
          pendingFiles: [],
        },
      }),
      getDatabaseSnapshots: async () => ({
        supported: true,
        storage: {
          dbPath: "/data/dns.db",
          snapshotDir: "/data/snapshots",
          sameFilesystem: true,
          diskTotalBytes: 1000,
          diskFreeBytes: 600,
          diskUsedBytes: 400,
          dbMainBytes: 100,
          dbWalBytes: 10,
          dbShmBytes: 1,
          dbTotalBytes: 111,
          snapshotsTotalBytes: 50,
        },
        snapshots: [{ filename: "snap1.sqlite.zst", sizeBytes: 50, createdAt: 1700000400, expiresAt: 1700600000 }],
        activeCapture: null,
        config: { retentionDays: 7, maxCount: 5, snapshotDir: "/data/snapshots" },
      }),
      getUsers: async () => sampleUsers,
      getSystemSettings: async () => ({
        registration_enabled: "false",
        jwt_secret: "TOP_SECRET_MUST_BE_STRIPPED",
        webhook_api_key: "ANOTHER_SECRET_STRIPPED",
      }),
      getInviteCodes: async () => [
        { code: "INV12345SECRET", max_uses: 5, remaining_uses: 3, expires_at: null, created_at: 1700000000, last_used_at: null },
      ],
      getDistributedFilters: async () => [
        { url: "https://example.org/global.txt", profileCount: 2, userCount: 1, usernames: ["bob"] },
      ],
    });

    const { registry, registered } = createHarness(true);
    registry.registerGroup("admin_ops", adminTools);

    // Non-admin user: tools hidden and rejected at invoke time
    registry.setRuntimeState(createState({ userRole: "user" }));
    assert.strictEqual(registered.has("dnsworker_admin_get_runtime_status"), false);
    const forbiddenRes = await registry.invokeTool("dnsworker_admin_get_runtime_status", {});
    assert.strictEqual(forbiddenRes.isError, true);
    assert.strictEqual(JSON.parse(forbiddenRes.content[0].text).error.code, "FORBIDDEN_ROLE");

    // Admin user: tools registered and sanitize secrets / invite codes
    registry.setRuntimeState(createState({ userRole: "admin" }));
    assert.strictEqual(registered.has("dnsworker_admin_get_runtime_status"), true);
    assert.strictEqual(registered.has("dnsworker_admin_get_database_status"), true);

    const cfgRes = await registry.invokeTool("dnsworker_admin_get_system_config_summary", {});
    const cfgText = cfgRes.content[0].text;
    assert.strictEqual(cfgText.includes("TOP_SECRET_MUST_BE_STRIPPED"), false);
    assert.strictEqual(cfgText.includes("ANOTHER_SECRET_STRIPPED"), false);
    assert.strictEqual(cfgText.includes("INV12345SECRET"), false);
    const cfgData = JSON.parse(cfgText).data.data;
    assert.strictEqual(cfgData.settings.registration_enabled, "false");
    assert.strictEqual(cfgData.inviteCodesSummary.items[0].codePrefix, "INV1***");

    const dbRes = await registry.invokeTool("dnsworker_admin_get_database_status", { includeSnapshots: true });
    assert.strictEqual(dbRes.content[0].text.includes("/data/dns.db"), false);
    assert.strictEqual(JSON.parse(dbRes.content[0].text).data.data.snapshotSummary.count, 1);

    const usersRes = await registry.invokeTool("dnsworker_admin_list_users_summary", { limit: 10 });
    assert.strictEqual(JSON.parse(usersRes.content[0].text).data.data.totalUsers, 2);

    console.log("   ✓ Admin Ops WebMCP tool group & RBAC gate passed.");
  }

  console.log("All WebMCP Phase 3 tests passed!");
}

runTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
