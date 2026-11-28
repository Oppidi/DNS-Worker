/**
 * @file admin.ts
 * @description Top-level router dispatching `/api/admin/*` requests to focused domain handlers under `./admin/*`.
 */

import { Env, User, ExecutionContext } from "../../types";
import { handleAdminUsersRequest, handleAdminInviteCodesRequest } from "./admin/users";
import { handleAdminSettingsRequest } from "./admin/settings";
import { handleAdminDatabaseRequest } from "./admin/database";
import { handleAdminDistributeFilterRequest, handleAdminRuntimeRequest } from "./admin/listsAndRuntime";

/**
 * Handle admin requests to `/api/admin/...`
 */
export async function handleAdminRequest(
  request: Request,
  env: Env,
  user: User,
  pathParts: string[],
  ctx: ExecutionContext
): Promise<Response> {
  switch (pathParts[2]) {
    case 'users':
      return handleAdminUsersRequest(request, env, user, pathParts, ctx);
    case 'invite-codes':
      return handleAdminInviteCodesRequest(request, env, user, pathParts);
    case 'settings':
      return handleAdminSettingsRequest(request, env);
    case 'database':
      return handleAdminDatabaseRequest(request, env, user, pathParts);
    case 'distribute-filter':
      return handleAdminDistributeFilterRequest(request, env, pathParts, ctx);
    case 'runtime':
      return handleAdminRuntimeRequest(request, env, pathParts);
    default:
      return new Response("Not Found", { status: 404 });
  }
}
