/**
 * @file phase1Defaults.ts
 * @description Wires browser-runtime DNS Worker frontend services into Phase 1 WebMCP tool modules.
 * Kept separate from tool factory modules so core tool logic remains pure and Node-testable.
 */

import {
  checkDomainAgainstList,
  getClientInfo,
  getProfileAnalytics,
  getProfileLists,
  getProfileLogDetails,
  getProfileRules,
  getProfiles,
  getSubstituteInfo,
  localDb,
  testResolution,
} from "../../services";
import type { AnalyticsLogsToolDeps } from "./analyticsLogsTools";
import type { DiagnosticsToolDeps } from "./diagnosticsTools";

export function createBrowserDiagnosticsDeps(): DiagnosticsToolDeps {
  return {
    testResolution,
    getProfileLists,
    checkDomainAgainstList,
    getProfileRules,
    getClientInfo,
    getSubstituteInfo,
  };
}

export function createBrowserAnalyticsLogsDeps(): AnalyticsLogsToolDeps {
  return {
    getProfiles,
    getProfileAnalytics,
    getProfileLogDetails,
    localDb,
  };
}
