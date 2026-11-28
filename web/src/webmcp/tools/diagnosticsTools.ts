/**
 * @file diagnosticsTools.ts
 * @description Phase 1 read-only WebMCP diagnostic tools:
 *   - `dnsworker_diagnose_domain`: simulates full DNS resolution and checks local + external filter lists
 *   - `dnsworker_check_domain_in_list`: tests a domain against a single external filter list bloom filter
 *   - `dnsworker_get_network_probe`: returns client network and GeoIP probe telemetry
 */

import type {
  ClientInfo,
  FilterList,
  ListCheckResult,
  ProfileFetchOptions,
  Rule,
  SubstituteInfo,
  TestResponse,
} from "../../services";
import { boundResultList, sanitizeUntrustedString, wrapUntrustedData } from "../sanitize";
import { defineWebMcpTool, type AppToolDefinition } from "../types";
import {
  normalizeDomainInput,
  normalizeRecordTypeInput,
  parsePositiveIntInput,
  resolveProfileIdInput,
} from "./validation";

const MAX_LIST_CHECKS_PER_DIAGNOSIS = 25;

export interface DiagnosticsToolDeps {
  testResolution: (
    profileId: string,
    payload: { domain: string; type: string },
    options?: ProfileFetchOptions
  ) => Promise<TestResponse>;
  getProfileLists: (profileId: string, options?: ProfileFetchOptions) => Promise<FilterList[]>;
  checkDomainAgainstList: (
    profileId: string,
    listId: number,
    domain: string,
    options?: ProfileFetchOptions
  ) => Promise<ListCheckResult>;
  getProfileRules: (profileId: string, options?: ProfileFetchOptions) => Promise<Rule[]>;
  getClientInfo: () => Promise<ClientInfo>;
  getSubstituteInfo: () => Promise<SubstituteInfo>;
}

function ruleMatchesDomain(rule: Rule, domain: string): boolean {
  const pattern = rule.pattern.trim().toLowerCase();
  if (!pattern) return false;
  if (pattern === domain) return true;
  if (pattern.startsWith("*.")) {
    const base = pattern.slice(2);
    return domain === base || domain.endsWith(`.${base}`);
  }
  const allowSubdomains = rule.include_subdomains === 1 || rule.include_subdomains === true;
  if (allowSubdomains && domain.endsWith(`.${pattern}`)) {
    return true;
  }
  return false;
}

interface DiagnoseDomainInput extends Record<string, unknown> {
  domain: string;
  profileId?: string;
  recordType: string;
}

interface CheckListDomainInput extends Record<string, unknown> {
  domain: string;
  listId: number;
  profileId?: string;
}

/**
 * Builds the `diagnostics` WebMCP read-only tool pack.
 */
export function createDiagnosticsWebMcpTools(deps: DiagnosticsToolDeps): AppToolDefinition[] {
  const diagnoseDomainTool: AppToolDefinition<DiagnoseDomainInput> = {
    name: "dnsworker_diagnose_domain",
    description:
      "Simulates DNS resolution for a domain in a DNS Worker Profile and inspects matching local custom rules plus enabled external filter lists to explain why a domain is blocked, redirected, or allowed.",
    inputSchema: {
      type: "object",
      properties: {
        domain: {
          type: "string",
          description: "Target DNS hostname or URL (e.g. 'ads.example.com').",
        },
        profileId: {
          type: "string",
          description: "Optional Profile ID; defaults to the currently selected dashboard Profile.",
        },
        recordType: {
          type: "string",
          description: "DNS record type (A, AAAA, CNAME, TXT, MX, HTTPS, SVCB). Defaults to A.",
        },
      },
      required: ["domain"],
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
    validateInput(raw) {
      const domainCheck = normalizeDomainInput(raw.domain);
      if (!domainCheck.ok) return domainCheck;
      const typeCheck = normalizeRecordTypeInput(raw.recordType);
      if (!typeCheck.ok) return typeCheck;
      if (raw.profileId !== undefined && typeof raw.profileId !== "string") {
        return { ok: false, error: "profileId must be a string." };
      }
      return {
        ok: true,
        value: {
          domain: domainCheck.value,
          profileId: raw.profileId,
          recordType: typeCheck.value,
        },
      };
    },
    execute: async (input, { runtimeState }) => {
      const profileCheck = resolveProfileIdInput(input.profileId, runtimeState.activeProfileId);
      if (!profileCheck.ok) {
        throw new Error(profileCheck.error);
      }
      const profileId = profileCheck.value;
      const fetchOpts: ProfileFetchOptions = { redirectOn404: false };

      const [resolutionRes, rulesRes, listsRes] = await Promise.allSettled([
        deps.testResolution(profileId, { domain: input.domain, type: input.recordType }, fetchOpts),
        deps.getProfileRules(profileId, fetchOpts),
        deps.getProfileLists(profileId, fetchOpts),
      ]);

      const resolution =
        resolutionRes.status === "fulfilled"
          ? {
              action: resolutionRes.value.action,
              reason: sanitizeUntrustedString(resolutionRes.value.reason ?? "", 180),
              ttl: resolutionRes.value.ttl,
              latencyMs: resolutionRes.value.latency ?? null,
              answers: boundResultList(
                (resolutionRes.value.answers ?? []).map((ans) => ({
                  type: sanitizeUntrustedString(ans.type, 16),
                  data: sanitizeUntrustedString(ans.data, 180),
                  ttl: ans.ttl,
                })),
                10
              ),
            }
          : {
              error: sanitizeUntrustedString(
                resolutionRes.reason instanceof Error
                  ? resolutionRes.reason.message
                  : "Resolution test failed",
                180
              ),
            };

      const rules = rulesRes.status === "fulfilled" ? rulesRes.value : [];
      const matchingLocalRules = boundResultList(
        rules
          .filter((r) => r.enabled !== 0 && r.enabled !== false && ruleMatchesDomain(r, input.domain))
          .map((r) => ({
            id: r.id,
            type: r.type,
            pattern: sanitizeUntrustedString(r.pattern, 160),
          })),
        20
      );

      const allLists = listsRes.status === "fulfilled" ? listsRes.value : [];
      const enabledLists = allLists
        .filter((item) => Boolean(item.enabled))
        .slice(0, MAX_LIST_CHECKS_PER_DIAGNOSIS);

      const listChecks = await Promise.allSettled(
        enabledLists.map(async (list) => {
          const verdict = await deps.checkDomainAgainstList(profileId, list.id, input.domain, fetchOpts);
          return { list, verdict };
        })
      );

      const externalListMatches: Array<Record<string, unknown>> = [];
      let failedChecksCount = 0;

      for (const item of listChecks) {
        if (item.status === "rejected") {
          failedChecksCount++;
          continue;
        }
        const { list, verdict } = item.value;
        if (verdict.blocked || verdict.whitelisted) {
          externalListMatches.push({
            listId: list.id,
            scope: list.scope ?? "profile",
            url: sanitizeUntrustedString(list.url, 180),
            synced: verdict.synced,
            blocked: verdict.blocked,
            whitelisted: Boolean(verdict.whitelisted),
            matchedEntry: verdict.matchedEntry
              ? sanitizeUntrustedString(verdict.matchedEntry, 160)
              : null,
          });
        }
      }

      return wrapUntrustedData("domain_diagnosis", {
        profileId,
        domain: input.domain,
        recordType: input.recordType,
        resolution,
        matchingLocalRules,
        externalListMatches: boundResultList(externalListMatches, 25),
        checkedEnabledListsCount: enabledLists.length,
        totalListsCount: allLists.length,
        failedChecksCount,
      });
    },
  };

  const checkListDomainTool: AppToolDefinition<CheckListDomainInput> = {
    name: "dnsworker_check_domain_in_list",
    description:
      "Checks whether a domain is blocked or whitelisted (@@) inside a specific subscribed external filter list's compiled Bloom filter.",
    inputSchema: {
      type: "object",
      properties: {
        domain: { type: "string", description: "Target hostname (e.g. 'tracker.example.com')." },
        listId: { type: "number", description: "Numeric ID of the filter list." },
        profileId: {
          type: "string",
          description: "Optional Profile ID; defaults to the currently selected dashboard Profile.",
        },
      },
      required: ["domain", "listId"],
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
    validateInput(raw) {
      const domainCheck = normalizeDomainInput(raw.domain);
      if (!domainCheck.ok) return domainCheck;
      const listIdCheck = parsePositiveIntInput(raw.listId, "listId");
      if (!listIdCheck.ok) return listIdCheck;
      if (raw.profileId !== undefined && typeof raw.profileId !== "string") {
        return { ok: false, error: "profileId must be a string." };
      }
      return {
        ok: true,
        value: {
          domain: domainCheck.value,
          listId: listIdCheck.value,
          profileId: raw.profileId,
        },
      };
    },
    execute: async (input, { runtimeState }) => {
      const profileCheck = resolveProfileIdInput(input.profileId, runtimeState.activeProfileId);
      if (!profileCheck.ok) {
        throw new Error(profileCheck.error);
      }
      const res = await deps.checkDomainAgainstList(
        profileCheck.value,
        input.listId,
        input.domain,
        { redirectOn404: false }
      );
      return wrapUntrustedData("filter_list_check", {
        profileId: profileCheck.value,
        listId: input.listId,
        domain: sanitizeUntrustedString(res.domain, 253),
        synced: res.synced,
        enabled: res.enabled ?? null,
        blocked: res.blocked,
        whitelisted: Boolean(res.whitelisted),
        matchedEntry: res.matchedEntry ? sanitizeUntrustedString(res.matchedEntry, 180) : null,
        falsePositiveRate: res.falsePositiveRate ?? null,
      });
    },
  };

  const networkProbeTool: AppToolDefinition = {
    name: "dnsworker_get_network_probe",
    description:
      "Retrieves client IP/GeoIP/ASN telemetry and deployment domain configuration from DNS Worker's network probe endpoints.",
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
    execute: async () => {
      const [clientRes, subRes] = await Promise.allSettled([
        deps.getClientInfo(),
        deps.getSubstituteInfo(),
      ]);

      const clientInfo =
        clientRes.status === "fulfilled"
          ? {
              ip: sanitizeUntrustedString(clientRes.value.ip, 64),
              asn: clientRes.value.asn,
              asOrganization: sanitizeUntrustedString(clientRes.value.asOrganization, 128),
              country: sanitizeUntrustedString(clientRes.value.country, 64),
              region: clientRes.value.region
                ? sanitizeUntrustedString(clientRes.value.region, 64)
                : null,
              city: sanitizeUntrustedString(clientRes.value.city, 64),
              mode: clientRes.value.mode ?? null,
              substituteDomain: clientRes.value.substituteDomain
                ? sanitizeUntrustedString(clientRes.value.substituteDomain, 160)
                : null,
              dotDomain: clientRes.value.dotDomain
                ? sanitizeUntrustedString(clientRes.value.dotDomain, 160)
                : null,
            }
          : null;

      const substituteInfo =
        subRes.status === "fulfilled"
          ? {
              ip: subRes.value.ip ? sanitizeUntrustedString(subRes.value.ip, 64) : null,
              ipv6: subRes.value.ipv6 ? sanitizeUntrustedString(subRes.value.ipv6, 64) : null,
              ipv4Count: subRes.value.ipv4List?.length ?? (subRes.value.ip ? 1 : 0),
              ipv6Count: subRes.value.ipv6List?.length ?? (subRes.value.ipv6 ? 1 : 0),
            }
          : null;

      return wrapUntrustedData("network_probe", {
        clientInfo,
        substituteInfo,
      });
    },
  };

  return [
    defineWebMcpTool(diagnoseDomainTool),
    defineWebMcpTool(checkListDomainTool),
    networkProbeTool,
  ];
}
