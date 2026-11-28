/**
 * @file users.ts
 * @description Admin REST API handlers for user management (`/api/admin/users`) and invite codes (`/api/admin/invite-codes`).
 */

import { Env, User, ExecutionContext } from "../../../types";
import { hashPassword } from "../../../utils/crypto";
import { UserModel } from "../../../models/user";
import { ProfileModel } from "../../../models/profile";
import { SystemSettingsModel } from "../../../models/systemSettings";
import { InviteCodeModel } from "../../../models/inviteCode";
import { PASSWORD_REGEX, USERNAME_REGEX } from "../../../utils/validator";
import { ensureDemoDataSeeded } from "../../../lib/demoMode";

/**
 * Safely decodes a URL path segment, returning `null` if percent-encoding is malformed.
 */
export function decodePathSegment(raw: string): string | null {
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

/**
 * Handles `/api/admin/users` (GET list, POST create, DELETE revoke caches + user).
 */
export async function handleAdminUsersRequest(
  request: Request,
  env: Env,
  user: User,
  pathParts: string[],
  ctx: ExecutionContext
): Promise<Response> {
  const userModel = new UserModel(env.DB, env);
  const profileModel = new ProfileModel(env.DB);

  if (request.method === 'GET') {
    await ensureDemoDataSeeded(env, user.id);
    const users = await userModel.listAll();
    return new Response(JSON.stringify(users), { headers: { 'Content-Type': 'application/json' } });
  }

  if (request.method === 'POST') {
    const { username, password, role } = await request.json() as any;
    const trimmedUsername = typeof username === "string" ? username.trim() : "";
    if (!trimmedUsername || !USERNAME_REGEX.test(trimmedUsername)) {
      return new Response("Invalid username format", { status: 400 });
    }
    if (!password || !PASSWORD_REGEX.test(password)) {
      return new Response("Password format error", { status: 400 });
    }
    if (await userModel.isUsernameConflict(trimmedUsername)) {
      return new Response("username_exists", { status: 400 });
    }

    const systemSettings = new SystemSettingsModel(env.DB);
    const maxUsersSetting = await systemSettings.get('max_users');
    const rawMaxUsers = maxUsersSetting !== null ? maxUsersSetting : env.MAX_USERS;
    const maxUsers = rawMaxUsers !== undefined && rawMaxUsers !== null && rawMaxUsers !== ""
      ? parseInt(String(rawMaxUsers), 10)
      : 0;
    if (maxUsers > 0 && (await userModel.count()) >= maxUsers) {
      return new Response("max_users_reached", { status: 400 });
    }

    const hashedPassword = await hashPassword(password, 2);
    const userId = await userModel.generateUniqueUserId(trimmedUsername);
    try {
      await userModel.create({
        id: userId,
        username: trimmedUsername,
        passwordHash: hashedPassword,
        role: role || 'user',
        passwordVersion: 2
      });
      return new Response(JSON.stringify({ id: userId }), { status: 201 });
    } catch (e: any) {
      console.error("[Admin API] Create user failed:", e?.message || e);
      return new Response("Failed to create user", { status: 400 });
    }
  }

  if (request.method === 'DELETE' && pathParts[3]) {
    const targetId = pathParts[3];
    if (targetId === user.id) return new Response("Cannot delete yourself", { status: 400 });
    const { invalidateAuthUserCacheByUserId } = await import("../../../lib/middleware");
    const { revokeOwnerCachesAndKeys } = await import("../../../lib/accessKeyRegistry");
    invalidateAuthUserCacheByUserId(targetId);
    const flushRevocations = await revokeOwnerCachesAndKeys(env, targetId);
    await profileModel.deleteByOwner(targetId);
    await userModel.delete(targetId);
    ctx.waitUntil(flushRevocations());
    return new Response(null, { status: 204 });
  }

  return new Response("Not Found", { status: 404 });
}

/**
 * Handles `/api/admin/invite-codes` (GET list, POST create, DELETE revoke).
 */
export async function handleAdminInviteCodesRequest(
  request: Request,
  env: Env,
  user: User,
  pathParts: string[]
): Promise<Response> {
  const inviteCodeModel = new InviteCodeModel(env.DB);

  if (request.method === 'GET') {
    const codes = await inviteCodeModel.listAll();
    return new Response(JSON.stringify(codes), { headers: { 'Content-Type': 'application/json' } });
  }

  if (request.method === 'POST') {
    let body: { code?: string; max_uses?: number; expires_at?: number | null } = {};
    try {
      body = (await request.json()) as { code?: string; max_uses?: number; expires_at?: number | null };
    } catch {
      return new Response("Invalid JSON payload", { status: 400 });
    }

    const maxUsesRaw = body.max_uses ?? 1;
    const maxUses = typeof maxUsesRaw === 'number' ? Math.floor(maxUsesRaw) : parseInt(String(maxUsesRaw), 10);
    if (!Number.isFinite(maxUses) || maxUses < 1) {
      return new Response("invalid_max_uses", { status: 400 });
    }

    let expiresAt: number | null = null;
    if (body.expires_at !== undefined && body.expires_at !== null) {
      const parsedExp = Number(body.expires_at);
      const now = Math.floor(Date.now() / 1000);
      if (!Number.isFinite(parsedExp) || parsedExp <= now) {
        return new Response("invalid_expires_at", { status: 400 });
      }
      expiresAt = Math.floor(parsedExp);
    }

    try {
      const created = await inviteCodeModel.create({
        code: typeof body.code === 'string' ? body.code : undefined,
        maxUses,
        expiresAt,
        createdBy: user.id
      });
      return new Response(JSON.stringify(created), {
        status: 201,
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === 'invite_code_exists') {
        return new Response("invite_code_exists", { status: 409 });
      }
      if (msg === 'invalid_invite_code_format' || msg === 'invalid_max_uses' || msg === 'invalid_expires_at') {
        return new Response(msg, { status: 400 });
      }
      console.error("[Admin API] Create invite code failed:", msg);
      return new Response("Failed to create invite code", { status: 400 });
    }
  }

  if (request.method === 'DELETE' && pathParts[3]) {
    const targetCode = decodePathSegment(pathParts[3]);
    if (!targetCode) return new Response("Invalid invite code", { status: 400 });
    const deleted = await inviteCodeModel.delete(targetCode);
    if (!deleted) return new Response("Not Found", { status: 404 });
    return new Response(null, { status: 204 });
  }

  return new Response("Not Found", { status: 404 });
}
