/**
 * @file rulesTools.ts
 * @description Phase 2 WebMCP tools for inspecting and mutating per-Profile custom DNS rules:
 *   - `dnsworker_list_rules` (read)
 *   - `dnsworker_add_rule` (write + HITL confirmation)
 *   - `dnsworker_add_rules_bulk` (write + HITL confirmation)
 *   - `dnsworker_update_rule` (write + HITL confirmation)
 *   - `dnsworker_toggle_rules_bulk` (write + HITL confirmation)
 *   - `dnsworker_delete_rules` (write + destructive HITL confirmation)
 */

import type { ProfileFetchOptions, Rule } from "../../services";
import { emitWebMcpDataChanged } from "../events";
import { boundResultList, sanitizeUntrustedString, wrapUntrustedData } from "../sanitize";
import { defineWebMcpTool, type AppToolDefinition } from "../types";
import {
  parsePositiveIntArrayInput,
  parsePositiveIntInput,
  resolveProfileIdInput,
  validateOptionalRuleTarget,
  validateRulePatternInput,
  validateRuleTypeInput,
} from "./validation";

const MAX_RULES_LIMIT = 50;

export interface RulesToolDeps {
  getProfileRules: (profileId: string, options?: ProfileFetchOptions) => Promise<Rule[]>;
  addProfileRule: (
    profileId: string,
    rule: Omit<Rule, "id">,
    options?: ProfileFetchOptions
  ) => Promise<void>;
  addProfileRulesBulk: (
    profileId: string,
    rules: Omit<Rule, "id">[],
    options?: ProfileFetchOptions
  ) => Promise<{ count: number }>;
  updateProfileRule: (
    profileId: string,
    rule: Rule,
    options?: ProfileFetchOptions
  ) => Promise<void>;
  toggleProfileRulesBulk: (
    profileId: string,
    ruleIds: number[],
    enabled: boolean,
    options?: ProfileFetchOptions
  ) => Promise<{ success: boolean; count: number; enabled: boolean }>;
  deleteProfileRulesBulk: (
    profileId: string,
    ruleIds: number[],
    options?: ProfileFetchOptions
  ) => Promise<{ success: boolean; count: number }>;
}

interface ListRulesInput extends Record<string, unknown> {
  profileId?: string;
  type?: "ALLOW" | "BLOCK" | "REDIRECT";
  enabled?: boolean;
  search?: string;
  limit?: number;
}

interface RuleDraftPayload {
  type: "ALLOW" | "BLOCK" | "REDIRECT";
  pattern: string;
  include_subdomains: boolean;
  enabled: boolean;
  v_a?: string;
  v_aaaa?: string;
  v_cname?: string;
  v_txt?: string;
}

interface AddRuleInput extends Record<string, unknown> {
  profileId?: string;
  rule: RuleDraftPayload;
}

interface AddRulesBulkInput extends Record<string, unknown> {
  profileId?: string;
  rules: RuleDraftPayload[];
}

interface UpdateRuleInput extends Record<string, unknown> {
  profileId?: string;
  id: number;
  type?: "ALLOW" | "BLOCK" | "REDIRECT";
  pattern?: string;
  include_subdomains?: boolean;
  enabled?: boolean;
  v_a?: string | null;
  v_aaaa?: string | null;
  v_cname?: string | null;
  v_txt?: string | null;
}

interface ToggleRulesBulkInput extends Record<string, unknown> {
  profileId?: string;
  ruleIds: number[];
  enabled: boolean;
}

interface DeleteRulesInput extends Record<string, unknown> {
  profileId?: string;
  ruleIds: number[];
}

function parseRuleDraft(
  raw: unknown,
  labelPrefix: string = ""
): { ok: true; value: RuleDraftPayload } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: `${labelPrefix}rule must be an object.` };
  }
  const obj = raw as Record<string, unknown>;
  const typeRes = validateRuleTypeInput(obj.type);
  if (!typeRes.ok) {
    return { ok: false, error: `${labelPrefix}${typeRes.error}` };
  }
  const patternRes = validateRulePatternInput(obj.pattern);
  if (!patternRes.ok) {
    return { ok: false, error: `${labelPrefix}${patternRes.error}` };
  }
  if (obj.include_subdomains !== undefined && typeof obj.include_subdomains !== "boolean") {
    return { ok: false, error: `${labelPrefix}include_subdomains must be a boolean.` };
  }
  if (obj.enabled !== undefined && typeof obj.enabled !== "boolean") {
    return { ok: false, error: `${labelPrefix}enabled must be a boolean.` };
  }

  const vA = validateOptionalRuleTarget(obj.v_a, `${labelPrefix}v_a`);
  if (!vA.ok) return vA;
  const vAaaa = validateOptionalRuleTarget(obj.v_aaaa, `${labelPrefix}v_aaaa`);
  if (!vAaaa.ok) return vAaaa;
  const vCname = validateOptionalRuleTarget(obj.v_cname, `${labelPrefix}v_cname`);
  if (!vCname.ok) return vCname;
  const vTxt = validateOptionalRuleTarget(obj.v_txt, `${labelPrefix}v_txt`);
  if (!vTxt.ok) return vTxt;

  if (typeRes.value === "REDIRECT" && !vA.value && !vAaaa.value && !vCname.value && !vTxt.value) {
    return {
      ok: false,
      error: `${labelPrefix}REDIRECT rule requires at least one target field (v_a, v_aaaa, v_cname, or v_txt).`,
    };
  }

  const draft: RuleDraftPayload = {
    type: typeRes.value,
    pattern: patternRes.value,
    include_subdomains: obj.include_subdomains ?? true,
    enabled: obj.enabled ?? true,
  };
  if (typeRes.value === "REDIRECT") {
    if (vA.value !== undefined) draft.v_a = vA.value;
    if (vAaaa.value !== undefined) draft.v_aaaa = vAaaa.value;
    if (vCname.value !== undefined) draft.v_cname = vCname.value;
    if (vTxt.value !== undefined) draft.v_txt = vTxt.value;
  }

  return { ok: true, value: draft };
}

function projectRuleForOutput(rule: Rule): Record<string, unknown> {
  return {
    id: rule.id,
    type: rule.type,
    pattern: sanitizeUntrustedString(rule.pattern, 255),
    include_subdomains: Boolean(rule.include_subdomains ?? false),
    enabled: rule.enabled === undefined ? true : Boolean(rule.enabled),
    v_a: rule.v_a ? sanitizeUntrustedString(rule.v_a, 255) : undefined,
    v_aaaa: rule.v_aaaa ? sanitizeUntrustedString(rule.v_aaaa, 255) : undefined,
    v_cname: rule.v_cname ? sanitizeUntrustedString(rule.v_cname, 255) : undefined,
    v_txt: rule.v_txt ? sanitizeUntrustedString(rule.v_txt, 255) : undefined,
    created_at: typeof rule.created_at === "number" ? rule.created_at : undefined,
  };
}

function normalizeOptionalPatchTarget(
  raw: unknown,
  existingValue: string | undefined,
  fieldName: string
): { ok: true; value: string | undefined } | { ok: false; error: string } {
  if (raw === undefined) {
    return { ok: true, value: existingValue };
  }
  if (raw === null || raw === "") {
    return { ok: true, value: undefined };
  }
  return validateOptionalRuleTarget(raw, fieldName);
}

/**
 * Creates the Phase 2 `rules` WebMCP tool group.
 */
export function createRulesWebMcpTools(deps: RulesToolDeps): AppToolDefinition[] {
  const listRulesTool = defineWebMcpTool<ListRulesInput>({
    name: "dnsworker_list_rules",
    description:
      "Lists custom ALLOW, BLOCK, and REDIRECT rules configured for a DNS Worker Profile with optional filters.",
    inputSchema: {
      type: "object",
      properties: {
        profileId: { type: "string", description: "Optional Profile ID; defaults to active Profile." },
        type: { type: "string", enum: ["ALLOW", "BLOCK", "REDIRECT"], description: "Optional rule type filter." },
        enabled: { type: "boolean", description: "Optional enabled state filter." },
        search: { type: "string", description: "Optional substring filter matching domain pattern or redirect value." },
        limit: { type: "number", minimum: 1, maximum: MAX_RULES_LIMIT, description: "Max rules to return (default 50)." },
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

      let typeFilter: "ALLOW" | "BLOCK" | "REDIRECT" | undefined;
      if (raw.type !== undefined) {
        const typeRes = validateRuleTypeInput(raw.type);
        if (!typeRes.ok) return typeRes;
        typeFilter = typeRes.value;
      }

      if (raw.enabled !== undefined && typeof raw.enabled !== "boolean") {
        return { ok: false, error: "enabled filter must be a boolean." };
      }

      let search: string | undefined;
      if (raw.search !== undefined) {
        if (typeof raw.search !== "string" || raw.search.length > 200) {
          return { ok: false, error: "search must be a string up to 200 characters." };
        }
        const cleaned = raw.search.trim().toLowerCase();
        if (cleaned) search = cleaned;
      }

      let limit = MAX_RULES_LIMIT;
      if (raw.limit !== undefined) {
        const limRes = parsePositiveIntInput(raw.limit, "limit");
        if (!limRes.ok) return limRes;
        if (limRes.value > MAX_RULES_LIMIT) {
          return { ok: false, error: `limit cannot exceed ${MAX_RULES_LIMIT}.` };
        }
        limit = limRes.value;
      }

      return { ok: true, value: { profileId, type: typeFilter, enabled: raw.enabled, search, limit } };
    },
    execute: async (input, { runtimeState }) => {
      const pidRes = resolveProfileIdInput(input.profileId, runtimeState.activeProfileId);
      if (!pidRes.ok) throw new Error(pidRes.error);
      const profileId = pidRes.value;

      const allRules = await deps.getProfileRules(profileId, { redirectOn404: false });
      const filtered = allRules.filter((rule) => {
        if (input.type && rule.type !== input.type) return false;
        const isEnabled = rule.enabled === undefined ? true : Boolean(rule.enabled);
        if (input.enabled !== undefined && isEnabled !== input.enabled) return false;
        if (input.search) {
          const haystacks = [rule.pattern, rule.v_a, rule.v_aaaa, rule.v_cname, rule.v_txt]
            .filter((val): val is string => typeof val === "string")
            .map((val) => val.toLowerCase());
          if (!haystacks.some((val) => val.includes(input.search as string))) {
            return false;
          }
        }
        return true;
      });

      const bounded = boundResultList(filtered, input.limit ?? MAX_RULES_LIMIT);
      return wrapUntrustedData("custom_rules", {
        profileId,
        totalConfigured: allRules.length,
        totalMatching: filtered.length,
        returnedCount: bounded.items.length,
        truncated: bounded.truncated,
        rules: bounded.items.map(projectRuleForOutput),
      });
    },
  });

  const addRuleTool = defineWebMcpTool<AddRuleInput>({
    name: "dnsworker_add_rule",
    description:
      "Adds a single custom ALLOW, BLOCK, or REDIRECT rule to a DNS Worker Profile (requires human confirmation).",
    inputSchema: {
      type: "object",
      properties: {
        profileId: { type: "string", description: "Optional Profile ID; defaults to active Profile." },
        type: { type: "string", enum: ["ALLOW", "BLOCK", "REDIRECT"], description: "Rule action type." },
        pattern: { type: "string", description: "Domain or wildcard pattern (e.g., ads.example.com or *.example.com)." },
        include_subdomains: { type: "boolean", description: "Whether subdomains match this rule (default true)." },
        enabled: { type: "boolean", description: "Initial enabled state (default true)." },
        v_a: { type: "string", description: "Optional IPv4 target for REDIRECT rules." },
        v_aaaa: { type: "string", description: "Optional IPv6 target for REDIRECT rules." },
        v_cname: { type: "string", description: "Optional CNAME target for REDIRECT rules." },
        v_txt: { type: "string", description: "Optional TXT payload for REDIRECT rules." },
      },
      required: ["type", "pattern"],
      additionalProperties: false,
    },
    policy: {
      access: "write",
      requiresAuth: true,
      requiresUnlocked: true,
    },
    confirmDescription: (input) =>
      `Add custom ${input.rule.type} rule for "${sanitizeUntrustedString(input.rule.pattern, 128)}"` +
      ` (subdomains: ${input.rule.include_subdomains ? "yes" : "no"})` +
      (input.profileId ? ` on profile ${input.profileId}` : "") +
      "?",
    validateInput: (raw) => {
      let profileId: string | undefined;
      if (raw.profileId !== undefined && raw.profileId !== "") {
        const res = resolveProfileIdInput(raw.profileId, null);
        if (!res.ok) return res;
        profileId = res.value;
      }
      const parsed = parseRuleDraft(raw);
      if (!parsed.ok) return parsed;
      return { ok: true, value: { profileId, rule: parsed.value } };
    },
    execute: async (input, { runtimeState }) => {
      const pidRes = resolveProfileIdInput(input.profileId, runtimeState.activeProfileId);
      if (!pidRes.ok) throw new Error(pidRes.error);
      const profileId = pidRes.value;

      await deps.addProfileRule(profileId, input.rule, { redirectOn404: false });
      emitWebMcpDataChanged({ scope: "rules", profileId });
      return {
        added: true,
        profileId,
        rule: input.rule,
      };
    },
  });

  const addRulesBulkTool = defineWebMcpTool<AddRulesBulkInput>({
    name: "dnsworker_add_rules_bulk",
    description:
      "Adds up to 50 custom DNS rules in one atomic batch for a Profile (requires human confirmation).",
    inputSchema: {
      type: "object",
      properties: {
        profileId: { type: "string", description: "Optional Profile ID; defaults to active Profile." },
        rules: {
          type: "array",
          minItems: 1,
          maxItems: MAX_RULES_LIMIT,
          items: {
            type: "object",
            properties: {
              type: { type: "string", enum: ["ALLOW", "BLOCK", "REDIRECT"] },
              pattern: { type: "string" },
              include_subdomains: { type: "boolean" },
              enabled: { type: "boolean" },
              v_a: { type: "string" },
              v_aaaa: { type: "string" },
              v_cname: { type: "string" },
              v_txt: { type: "string" },
            },
            required: ["type", "pattern"],
            additionalProperties: false,
          },
        },
      },
      required: ["rules"],
      additionalProperties: false,
    },
    policy: {
      access: "write",
      requiresAuth: true,
      requiresUnlocked: true,
    },
    confirmDescription: (input) => {
      const preview = input.rules
        .slice(0, 3)
        .map((r) => `${r.type}:${sanitizeUntrustedString(r.pattern, 64)}`)
        .join(", ");
      const suffix = input.rules.length > 3 ? ` (+${input.rules.length - 3} more)` : "";
      return `Add ${input.rules.length} custom rule(s) [${preview}${suffix}]` +
        (input.profileId ? ` on profile ${input.profileId}` : "") +
        "?";
    },
    validateInput: (raw) => {
      let profileId: string | undefined;
      if (raw.profileId !== undefined && raw.profileId !== "") {
        const res = resolveProfileIdInput(raw.profileId, null);
        if (!res.ok) return res;
        profileId = res.value;
      }
      if (!Array.isArray(raw.rules) || raw.rules.length === 0) {
        return { ok: false, error: "rules must be a non-empty array." };
      }
      if (raw.rules.length > MAX_RULES_LIMIT) {
        return { ok: false, error: `rules batch supports at most ${MAX_RULES_LIMIT} items.` };
      }
      const normalizedRules: RuleDraftPayload[] = [];
      for (let i = 0; i < raw.rules.length; i++) {
        const parsed = parseRuleDraft(raw.rules[i], `rules[${i}].`);
        if (!parsed.ok) return parsed;
        normalizedRules.push(parsed.value);
      }
      return { ok: true, value: { profileId, rules: normalizedRules } };
    },
    execute: async (input, { runtimeState }) => {
      const pidRes = resolveProfileIdInput(input.profileId, runtimeState.activeProfileId);
      if (!pidRes.ok) throw new Error(pidRes.error);
      const profileId = pidRes.value;

      const res = await deps.addProfileRulesBulk(profileId, input.rules, { redirectOn404: false });
      emitWebMcpDataChanged({ scope: "rules", profileId });
      return {
        added: true,
        profileId,
        count: res.count,
      };
    },
  });

  const updateRuleTool = defineWebMcpTool<UpdateRuleInput>({
    name: "dnsworker_update_rule",
    description:
      "Updates an existing custom DNS rule by ID, merging provided fields with the saved rule (requires human confirmation).",
    inputSchema: {
      type: "object",
      properties: {
        profileId: { type: "string", description: "Optional Profile ID; defaults to active Profile." },
        id: { type: "number", minimum: 1, description: "Rule ID to update." },
        type: { type: "string", enum: ["ALLOW", "BLOCK", "REDIRECT"] },
        pattern: { type: "string" },
        include_subdomains: { type: "boolean" },
        enabled: { type: "boolean" },
        v_a: { type: ["string", "null"] },
        v_aaaa: { type: ["string", "null"] },
        v_cname: { type: ["string", "null"] },
        v_txt: { type: ["string", "null"] },
      },
      required: ["id"],
      additionalProperties: false,
    },
    policy: {
      access: "write",
      requiresAuth: true,
      requiresUnlocked: true,
    },
    confirmDescription: (input) =>
      `Update custom rule #${input.id}` +
      (input.pattern ? ` (pattern -> "${sanitizeUntrustedString(input.pattern, 100)}")` : "") +
      (input.type ? ` (type -> ${input.type})` : "") +
      (input.enabled !== undefined ? ` (enabled -> ${String(input.enabled)})` : "") +
      (input.profileId ? ` on profile ${input.profileId}` : "") +
      "?",
    validateInput: (raw) => {
      let profileId: string | undefined;
      if (raw.profileId !== undefined && raw.profileId !== "") {
        const res = resolveProfileIdInput(raw.profileId, null);
        if (!res.ok) return res;
        profileId = res.value;
      }

      const idRes = parsePositiveIntInput(raw.id, "id");
      if (!idRes.ok) return idRes;

      const patchKeys = ["type", "pattern", "include_subdomains", "enabled", "v_a", "v_aaaa", "v_cname", "v_txt"];
      if (!patchKeys.some((key) => raw[key] !== undefined)) {
        return { ok: false, error: "Provide at least one rule field to update." };
      }

      let type: "ALLOW" | "BLOCK" | "REDIRECT" | undefined;
      if (raw.type !== undefined) {
        const typeRes = validateRuleTypeInput(raw.type);
        if (!typeRes.ok) return typeRes;
        type = typeRes.value;
      }

      let pattern: string | undefined;
      if (raw.pattern !== undefined) {
        const patRes = validateRulePatternInput(raw.pattern);
        if (!patRes.ok) return patRes;
        pattern = patRes.value;
      }

      if (raw.include_subdomains !== undefined && typeof raw.include_subdomains !== "boolean") {
        return { ok: false, error: "include_subdomains must be a boolean." };
      }
      if (raw.enabled !== undefined && typeof raw.enabled !== "boolean") {
        return { ok: false, error: "enabled must be a boolean." };
      }

      const checkTarget = (key: "v_a" | "v_aaaa" | "v_cname" | "v_txt") => {
        if (raw[key] === undefined || raw[key] === null) return { ok: true as const };
        return validateOptionalRuleTarget(raw[key], key);
      };
      for (const key of ["v_a", "v_aaaa", "v_cname", "v_txt"] as const) {
        const res = checkTarget(key);
        if (!res.ok) return res;
      }

      return {
        ok: true,
        value: {
          profileId,
          id: idRes.value,
          type,
          pattern,
          include_subdomains: raw.include_subdomains as boolean | undefined,
          enabled: raw.enabled as boolean | undefined,
          v_a: raw.v_a as string | null | undefined,
          v_aaaa: raw.v_aaaa as string | null | undefined,
          v_cname: raw.v_cname as string | null | undefined,
          v_txt: raw.v_txt as string | null | undefined,
        },
      };
    },
    execute: async (input, { runtimeState }) => {
      const pidRes = resolveProfileIdInput(input.profileId, runtimeState.activeProfileId);
      if (!pidRes.ok) throw new Error(pidRes.error);
      const profileId = pidRes.value;

      const existingRules = await deps.getProfileRules(profileId, { redirectOn404: false });
      const existing = existingRules.find((r) => r.id === input.id);
      if (!existing) {
        throw new Error(`Rule #${input.id} not found on profile "${profileId}".`);
      }

      const nextType = input.type ?? existing.type;
      const vA = normalizeOptionalPatchTarget(input.v_a, existing.v_a, "v_a");
      if (!vA.ok) throw new Error(vA.error);
      const vAaaa = normalizeOptionalPatchTarget(input.v_aaaa, existing.v_aaaa, "v_aaaa");
      if (!vAaaa.ok) throw new Error(vAaaa.error);
      const vCname = normalizeOptionalPatchTarget(input.v_cname, existing.v_cname, "v_cname");
      if (!vCname.ok) throw new Error(vCname.error);
      const vTxt = normalizeOptionalPatchTarget(input.v_txt, existing.v_txt, "v_txt");
      if (!vTxt.ok) throw new Error(vTxt.error);

      if (nextType === "REDIRECT" && !vA.value && !vAaaa.value && !vCname.value && !vTxt.value) {
        throw new Error("REDIRECT rules require at least one target value (v_a, v_aaaa, v_cname, or v_txt).");
      }

      const mergedRule: Rule = {
        id: existing.id,
        type: nextType,
        pattern: input.pattern ?? existing.pattern,
        include_subdomains: input.include_subdomains ?? Boolean(existing.include_subdomains ?? false),
        enabled: input.enabled ?? (existing.enabled === undefined ? true : Boolean(existing.enabled)),
        ...(nextType === "REDIRECT"
          ? {
              v_a: vA.value,
              v_aaaa: vAaaa.value,
              v_cname: vCname.value,
              v_txt: vTxt.value,
            }
          : {}),
      };

      await deps.updateProfileRule(profileId, mergedRule, { redirectOn404: false });
      emitWebMcpDataChanged({ scope: "rules", profileId });
      return {
        updated: true,
        profileId,
        rule: projectRuleForOutput(mergedRule),
      };
    },
  });

  const toggleRulesBulkTool = defineWebMcpTool<ToggleRulesBulkInput>({
    name: "dnsworker_toggle_rules_bulk",
    description:
      "Enables or disables up to 50 custom rules by ID without deleting them (requires human confirmation).",
    inputSchema: {
      type: "object",
      properties: {
        profileId: { type: "string", description: "Optional Profile ID; defaults to active Profile." },
        ruleIds: {
          type: "array",
          minItems: 1,
          maxItems: MAX_RULES_LIMIT,
          items: { type: "number", minimum: 1 },
        },
        enabled: { type: "boolean", description: "Target enabled state." },
      },
      required: ["ruleIds", "enabled"],
      additionalProperties: false,
    },
    policy: {
      access: "write",
      requiresAuth: true,
      requiresUnlocked: true,
    },
    confirmDescription: (input) =>
      `${input.enabled ? "Enable" : "Disable"} ${input.ruleIds.length} custom rule(s)` +
      ` (IDs: ${input.ruleIds.slice(0, 5).join(", ")}${input.ruleIds.length > 5 ? ", ..." : ""})` +
      (input.profileId ? ` on profile ${input.profileId}` : "") +
      "?",
    validateInput: (raw) => {
      let profileId: string | undefined;
      if (raw.profileId !== undefined && raw.profileId !== "") {
        const res = resolveProfileIdInput(raw.profileId, null);
        if (!res.ok) return res;
        profileId = res.value;
      }
      const idsRes = parsePositiveIntArrayInput(raw.ruleIds, "ruleIds", MAX_RULES_LIMIT);
      if (!idsRes.ok) return idsRes;
      if (typeof raw.enabled !== "boolean") {
        return { ok: false, error: "enabled must be a boolean." };
      }
      return { ok: true, value: { profileId, ruleIds: idsRes.value, enabled: raw.enabled } };
    },
    execute: async (input, { runtimeState }) => {
      const pidRes = resolveProfileIdInput(input.profileId, runtimeState.activeProfileId);
      if (!pidRes.ok) throw new Error(pidRes.error);
      const profileId = pidRes.value;

      const result = await deps.toggleProfileRulesBulk(profileId, input.ruleIds, input.enabled, {
        redirectOn404: false,
      });
      emitWebMcpDataChanged({ scope: "rules", profileId });
      return {
        ...result,
        profileId,
      };
    },
  });

  const deleteRulesTool = defineWebMcpTool<DeleteRulesInput>({
    name: "dnsworker_delete_rules",
    description:
      "Permanently deletes one or more custom rules (up to 50) by ID from a Profile (requires destructive confirmation).",
    inputSchema: {
      type: "object",
      properties: {
        profileId: { type: "string", description: "Optional Profile ID; defaults to active Profile." },
        ruleIds: {
          type: "array",
          minItems: 1,
          maxItems: MAX_RULES_LIMIT,
          items: { type: "number", minimum: 1 },
        },
      },
      required: ["ruleIds"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
    },
    policy: {
      access: "write",
      requiresAuth: true,
      requiresUnlocked: true,
    },
    confirmDescription: (input) =>
      `Permanently delete ${input.ruleIds.length} custom rule(s)` +
      ` (IDs: ${input.ruleIds.slice(0, 5).join(", ")}${input.ruleIds.length > 5 ? ", ..." : ""})` +
      (input.profileId ? ` on profile ${input.profileId}` : "") +
      "?",
    validateInput: (raw) => {
      let profileId: string | undefined;
      if (raw.profileId !== undefined && raw.profileId !== "") {
        const res = resolveProfileIdInput(raw.profileId, null);
        if (!res.ok) return res;
        profileId = res.value;
      }
      const idsRes = parsePositiveIntArrayInput(raw.ruleIds, "ruleIds", MAX_RULES_LIMIT);
      if (!idsRes.ok) return idsRes;
      return { ok: true, value: { profileId, ruleIds: idsRes.value } };
    },
    execute: async (input, { runtimeState }) => {
      const pidRes = resolveProfileIdInput(input.profileId, runtimeState.activeProfileId);
      if (!pidRes.ok) throw new Error(pidRes.error);
      const profileId = pidRes.value;

      const result = await deps.deleteProfileRulesBulk(profileId, input.ruleIds, {
        redirectOn404: false,
      });
      emitWebMcpDataChanged({ scope: "rules", profileId });
      return {
        ...result,
        profileId,
      };
    },
  });

  return [
    listRulesTool,
    addRuleTool,
    addRulesBulkTool,
    updateRuleTool,
    toggleRulesBulkTool,
    deleteRulesTool,
  ] as AppToolDefinition[];
}
