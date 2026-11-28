/**
 * @file phase2Defaults.ts
 * @description Wires browser-runtime DNS Worker services into Phase 2 WebMCP mutating/read tool packs.
 * Kept separate from factory modules so Phase 2 tool validation & execution stay pure and Node-testable.
 */

import {
  addCustomProfileList,
  addProfileRule,
  addProfileRulesBulk,
  addUserList,
  deleteProfileRulesBulk,
  getPresetFilters,
  getProfileLists,
  getProfileRules,
  getProfileSyncStatus,
  getUserLists,
  syncProfileLists,
  syncSingleProfileList,
  toggleProfileList,
  toggleProfileRulesBulk,
  toggleUserList,
  updateProfileRule,
} from "../../services";
import type { FilteringToolDeps } from "./filteringTools";
import type { RulesToolDeps } from "./rulesTools";

export function createBrowserRulesDeps(): RulesToolDeps {
  return {
    getProfileRules,
    addProfileRule,
    addProfileRulesBulk,
    updateProfileRule,
    toggleProfileRulesBulk,
    deleteProfileRulesBulk,
  };
}

export function createBrowserFilteringDeps(): FilteringToolDeps {
  return {
    getProfileLists,
    getProfileSyncStatus,
    toggleProfileList,
    addCustomProfileList,
    syncProfileLists,
    syncSingleProfileList,
    getUserLists,
    addUserList,
    toggleUserList,
    getPresetFilters,
  };
}
