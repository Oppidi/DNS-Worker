/**
 * @file settings.ts
 * @description Admin REST API handler for system settings (`/api/admin/settings`) with key allowlisting.
 */

import { Env } from "../../../types";
import { SystemSettingsModel } from "../../../models/systemSettings";

/**
 * Allowlist of system setting keys that can be updated via administrative REST APIs.
 * Prevents key namespace pollution and blocks attempts to overwrite internal timestamps or runtime secrets.
 */
const ALLOWED_ADMIN_SETTINGS_KEYS = new Set<string>([
  'turnstile_site_key',
  'turnstile_secret_key',
  'turnstile_enabled_signup',
  'turnstile_enabled_login',
  'registration_enabled',
  'invite_code_enabled',
  'max_users'
]);

/**
 * Handles `/api/admin/settings` (GET masked settings, PATCH allowlisted updates).
 */
export async function handleAdminSettingsRequest(request: Request, env: Env): Promise<Response> {
  const systemSettings = new SystemSettingsModel(env.DB);

  if (request.method === 'GET') {
    const settings = await systemSettings.getAll();
    delete settings.jwt_secret;
    return new Response(JSON.stringify(settings), { headers: { 'Content-Type': 'application/json' } });
  }

  if (request.method === 'PATCH') {
    let body: Record<string, unknown> = {};
    try {
      body = await request.json() as Record<string, unknown>;
    } catch {
      return new Response("Invalid JSON payload", { status: 400 });
    }

    const filteredSettings: Record<string, string> = {};
    for (const [key, value] of Object.entries(body)) {
      if (ALLOWED_ADMIN_SETTINGS_KEYS.has(key)) {
        if (typeof value === 'string') {
          filteredSettings[key] = value.slice(0, 1024);
        } else if (typeof value === 'number') {
          filteredSettings[key] = String(value);
        }
      }
    }

    if (filteredSettings.max_users !== undefined) {
      const parsed = parseInt(filteredSettings.max_users, 10);
      filteredSettings.max_users = isNaN(parsed) || parsed < 0 ? "0" : String(parsed);
    }

    if (Object.keys(filteredSettings).length > 0) {
      await systemSettings.setMany(filteredSettings);
    }
    return new Response(JSON.stringify({ success: true }));
  }

  return new Response("Not Found", { status: 404 });
}
