import assert from "node:assert";
import { WebMcpRegistry } from "../web/src/webmcp/registry";
import { createBaseWebMcpTools } from "../web/src/webmcp/baseTools";
import type {
  AppToolDefinition,
  NavigatorModelContext,
  WebMcpNativeToolDescriptor,
  WebMcpRuntimeState,
} from "../web/src/webmcp/types";
import {
  boundResultList,
  sanitizeUntrustedString,
  wrapUntrustedData,
} from "../web/src/webmcp/sanitize";

function createMockState(overrides: Partial<WebMcpRuntimeState> = {}): WebMcpRuntimeState {
  return {
    isSupported: true,
    isEnabled: true,
    isLoggedIn: true,
    isLocked: false,
    isDemoMode: false,
    isE2eeEnabled: false,
    isE2eeUnlocked: false,
    userRole: "user",
    activeProfileId: "prof_default",
    deploymentMode: "cloudflare",
    ...overrides,
  };
}

async function runTests(): Promise<void> {
  console.log(">>> [TEST] Running WebMCP Foundation Layer Unit Tests...");

  // 1. Test graceful no-op when browser does not support navigator.modelContext
  console.log("1. Testing graceful behavior without navigator.modelContext...");
  {
    const registry = new WebMcpRegistry({ getModelContext: () => null });
    registry.registerGroup("base", createBaseWebMcpTools(registry));
    registry.setRuntimeState(createMockState({ isSupported: false }));
    assert.deepStrictEqual(registry.getInspectionSnapshot().activeToolNames, []);
    console.log("   ✓ Unsupported browser degrades cleanly with zero errors.");
  }

  // 2. Test dynamic registration & automatic unregistration across lock/logout transitions
  console.log("2. Testing tool registration and lock/logout revocation...");
  {
    const registeredMap = new Map<string, WebMcpNativeToolDescriptor>();
    let clearedCount = 0;

    const mockContext: NavigatorModelContext = {
      registerTool(tool) {
        registeredMap.set(tool.name, tool);
      },
      unregisterTool(name) {
        registeredMap.delete(name);
      },
      clearContext() {
        clearedCount++;
        registeredMap.clear();
      },
    };

    const registry = new WebMcpRegistry({ getModelContext: () => mockContext });
    registry.registerGroup("base", createBaseWebMcpTools(registry));

    // Unlocked & logged in -> base tools registered
    registry.setRuntimeState(createMockState());
    assert(registeredMap.has("dnsworker_get_session_context"), "Session context tool should register");
    assert(registeredMap.has("dnsworker_list_capabilities"), "Capabilities tool should register");

    const ctxResult = await registry.invokeTool("dnsworker_get_session_context");
    assert.strictEqual(ctxResult.isError, undefined);
    const parsedCtx = JSON.parse(ctxResult.content[0].text);
    assert.strictEqual(parsedCtx.ok, true);
    assert.strictEqual(parsedCtx.data.activeProfileId, "prof_default");

    // Lock session -> immediately unregister + clearContext
    registry.setRuntimeState(createMockState({ isLocked: true }));
    assert.strictEqual(registeredMap.size, 0, "Locked session must expose 0 WebMCP tools");
    assert(clearedCount >= 1, "clearContext should run when transitioning to zero eligible tools");

    // Direct invocation of stale tool closure must still fail closed with SESSION_LOCKED
    const lockedCall = await registry.invokeTool("dnsworker_get_session_context");
    assert.strictEqual(lockedCall.isError, true);
    assert.strictEqual(JSON.parse(lockedCall.content[0].text).error.code, "SESSION_LOCKED");

    // Unlock and then logout -> AUTH_REQUIRED
    registry.setRuntimeState(createMockState({ isLocked: false, isLoggedIn: false }));
    assert.strictEqual(registeredMap.size, 0);
    const unauthCall = await registry.invokeTool("dnsworker_get_session_context");
    assert.strictEqual(unauthCall.isError, true);
    assert.strictEqual(JSON.parse(unauthCall.content[0].text).error.code, "AUTH_REQUIRED");
    console.log("   ✓ Registration lifecycle and fail-closed lock/logout guards passed.");
  }

  // 3. Test RBAC, E2EE gate, Demo Mode write guard, HITL confirmation, validation, and timeout
  console.log("3. Testing RBAC, E2EE, Demo Mode, HITL write confirmation, and timeouts...");
  {
    const registeredMap = new Map<string, WebMcpNativeToolDescriptor>();
    let confirmResponse = false;

    const registry = new WebMcpRegistry({
      getModelContext: () => ({
        registerTool: (tool) => registeredMap.set(tool.name, tool),
        unregisterTool: (name) => registeredMap.delete(name),
      }),
      confirmWriteFn: async () => confirmResponse,
      timeoutMs: 50,
    });

    const sampleTools: AppToolDefinition[] = [
      {
        name: "admin_diag",
        description: "Admin-only read diagnostic",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        policy: { access: "read", roleScope: "admin" },
        execute: async () => ({ admin: true }),
      },
      {
        name: "e2ee_query",
        description: "Requires unlocked E2EE key",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        policy: { access: "read", requiresE2eeUnlocked: true },
        execute: async () => ({ decryptedRows: 3 }),
      },
      {
        name: "write_rule",
        description: "Mutating action requiring confirmation",
        inputSchema: {
          type: "object",
          properties: { pattern: { type: "string" } },
          required: ["pattern"],
          additionalProperties: false,
        },
        validateInput: (raw) =>
          typeof raw.pattern === "string" && raw.pattern.trim().length > 0
            ? { ok: true, value: { pattern: raw.pattern.trim() } }
            : { ok: false, error: "pattern must be a non-empty string" },
        policy: { access: "write", allowInDemoMode: false },
        confirmDescription: (input) => `Block ${String(input.pattern)}?`,
        execute: async (input) => ({ added: input.pattern }),
      },
      {
        name: "slow_tool",
        description: "Simulates stuck backend call",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        policy: { access: "read" },
        execute: () => new Promise((resolve) => setTimeout(() => resolve({ ok: true }), 200)),
      },
    ];

    registry.registerGroup("test", sampleTools);
    registry.setRuntimeState(
      createMockState({
        userRole: "user",
        isE2eeEnabled: true,
        isE2eeUnlocked: false,
        isDemoMode: true,
      })
    );

    assert(!registeredMap.has("admin_diag"), "Admin tool hidden for regular user");
    assert(!registeredMap.has("write_rule"), "Write tool hidden in Demo Mode");

    const e2eeErr = JSON.parse((await registry.invokeTool("e2ee_query")).content[0].text);
    assert.strictEqual(e2eeErr.error.code, "E2EE_LOCKED");

    const demoErr = JSON.parse(
      (await registry.invokeTool("write_rule", { pattern: "ads.example.com" })).content[0].text
    );
    assert.strictEqual(demoErr.error.code, "DEMO_MODE_READONLY");

    // Promote to admin, unlock E2EE, disable Demo Mode
    registry.setRuntimeState(
      createMockState({
        userRole: "admin",
        isE2eeEnabled: true,
        isE2eeUnlocked: true,
        isDemoMode: false,
      })
    );
    assert(registeredMap.has("admin_diag"));
    assert(registeredMap.has("write_rule"));

    const invalidErr = JSON.parse((await registry.invokeTool("write_rule", { pattern: "   " })).content[0].text);
    assert.strictEqual(invalidErr.error.code, "INVALID_INPUT");

    confirmResponse = false;
    const deniedErr = JSON.parse(
      (await registry.invokeTool("write_rule", { pattern: "ads.example.com" })).content[0].text
    );
    assert.strictEqual(deniedErr.error.code, "CONFIRMATION_DENIED");

    confirmResponse = true;
    const writeOk = JSON.parse(
      (await registry.invokeTool("write_rule", { pattern: "  ads.example.com " })).content[0].text
    );
    assert.strictEqual(writeOk.ok, true);
    assert.strictEqual(writeOk.data.added, "ads.example.com");

    const timeoutErr = JSON.parse((await registry.invokeTool("slow_tool")).content[0].text);
    assert.strictEqual(timeoutErr.error.code, "EXECUTION_TIMEOUT");
    console.log("   ✓ RBAC, E2EE gate, Demo Mode guard, validation, HITL confirm, and timeout passed.");
  }

  // 4. Test sanitization against control characters, bidi overrides, and oversized payloads
  console.log("4. Testing untrusted output sanitization...");
  {
    const dirty = "evil\u0000domain\u202E.example.com\n\t";
    const clean = sanitizeUntrustedString(dirty, 32);
    assert(!clean.includes("\u0000") && !clean.includes("\u202E") && !clean.includes("\n"));

    const longStr = "a".repeat(300);
    const truncated = sanitizeUntrustedString(longStr, 50);
    assert(truncated.length <= 50 && truncated.endsWith("... [truncated]"));

    const wrapped = wrapUntrustedData("dns_logs", { domain: clean });
    assert.strictEqual(wrapped._untrustedDataOnly, true);
    assert.strictEqual(wrapped.source, "dns_logs");

    const bounded = boundResultList([1, 2, 3, 4], 2);
    assert.deepStrictEqual(bounded, { items: [1, 2], totalCount: 4, truncated: true });
    console.log("   ✓ Untrusted output sanitization and list bounding passed.");
  }

  console.log("\n>>> [TEST] All WebMCP Foundation Layer tests passed successfully!");
}

runTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
