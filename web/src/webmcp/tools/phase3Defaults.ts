/**
 * @file phase3Defaults.ts
 * @description Wires browser-runtime DNS Worker services into Phase 3 WebMCP tool packs
 * (`access_points`, `profiles`, `admin_ops`) while keeping factory modules Node-testable.
 */

import {
  createAccessPoint,
  getAccessPoints,
  getDatabaseSnapshots,
  getDatabaseStatus,
  getDistributedFilters,
  getInviteCodes,
  getProfileDetails,
  getRuntimeStatus,
  getSystemSettings,
  getUsers,
  renameProfile,
  updateAccessPoint,
  updateProfileSettings,
} from "../../services";
import type { AccessPointsToolDeps } from "./accessPointsTools";
import type { AdminOpsToolDeps } from "./adminOpsTools";
import type { ProfilesToolDeps } from "./profilesTools";

export function createBrowserAccessPointsDeps(): AccessPointsToolDeps {
  return {
    getAccessPoints,
    updateAccessPoint,
    createAccessPoint,
  };
}

export function createBrowserProfilesDeps(): ProfilesToolDeps {
  return {
    getProfileDetails,
    updateProfileSettings,
    renameProfile,
  };
}

export function createBrowserAdminOpsDeps(): AdminOpsToolDeps {
  return {
    getRuntimeStatus,
    getDatabaseStatus,
    getDatabaseSnapshots,
    getUsers,
    getSystemSettings,
    getInviteCodes,
    getDistributedFilters,
  };
}
