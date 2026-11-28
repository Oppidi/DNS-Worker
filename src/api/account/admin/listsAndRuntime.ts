/**
 * @file listsAndRuntime.ts
 * @description Admin REST API handlers for system list distribution (`/api/admin/distribute-filter`)
 * and Serverfull runtime version/restart management (`/api/admin/runtime`).
 */

import { Env, ExecutionContext, ServerfullRuntimeStatus } from "../../../types";
import { ListModel } from "../../../models/list";
import { ListBloomModel } from "../../../models/listBloom";
import { isSafeUrlWithDnsCheck } from "../../../utils/validator";
import { syncGlobalList } from "../../../utils/sync/singleListSync";
import { rebuildProfileBloom } from "../../../utils/sync";
import { pipeline } from "../../../pipeline";
import { detectServerfullMode } from "../../../router/runtimeConfig";
import { isDemoMode } from "../../../lib/demoConfig";

function triggerAsyncBloomRebuilds(profileIds: string[], env: Env, ctx: ExecutionContext, contextLabel: string): void {
  for (const profileId of profileIds) {
    ctx.waitUntil(
      rebuildProfileBloom(profileId, env, ctx)
        .then(() => pipeline.clearCache(profileId, true, env))
        .catch((e) => console.error(`[Admin] Failed to rebuild bloom for profile ${profileId} (${contextLabel}):`, e))
    );
  }
}

/**
 * Handles `/api/admin/distribute-filter` (GET distributed lists, POST distribute, DELETE/POST revoke).
 */
export async function handleAdminDistributeFilterRequest(
  request: Request,
  env: Env,
  pathParts: string[],
  ctx: ExecutionContext
): Promise<Response> {
  const listModel = new ListModel(env.DB);

  if (request.method === 'GET') {
    const distributed = await listModel.getDistributedSystemLists();
    return new Response(JSON.stringify(distributed), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (request.method === 'DELETE' || (request.method === 'POST' && pathParts[3] === 'revoke')) {
    let rawUrl = '';
    try {
      const body = await request.json() as { url?: unknown };
      if (typeof body?.url === 'string') rawUrl = body.url.trim();
    } catch {
      const searchUrl = new URL(request.url).searchParams.get('url');
      if (searchUrl) rawUrl = searchUrl.trim();
    }

    if (!rawUrl) {
      return new Response("Missing list URL to revoke", { status: 400 });
    }

    const canonicalUrl = ListModel.normalizeUrl(rawUrl);
    const revokeResult = await listModel.revokeSystemList(canonicalUrl);
    triggerAsyncBloomRebuilds(revokeResult.affectedProfileIds, env, ctx, 'after revoke');

    return new Response(JSON.stringify({
      success: true,
      url: canonicalUrl,
      revokedCount: revokeResult.revokedProfilesCount,
      affectedProfilesCount: revokeResult.affectedProfileIds.length,
      affectedUserCount: revokeResult.affectedUsernames.length,
      affectedUsernames: revokeResult.affectedUsernames
    }), { headers: { 'Content-Type': 'application/json' } });
  }

  if (request.method !== 'POST') {
    return new Response("Method Not Allowed", { status: 405 });
  }

  let body: { url?: unknown };
  try {
    body = await request.json() as { url?: unknown };
  } catch {
    return new Response("Invalid JSON payload", { status: 400 });
  }

  const rawUrl = typeof body?.url === 'string' ? body.url.trim() : '';
  if (!rawUrl) {
    return new Response("Missing list URL", { status: 400 });
  }

  if (!(await isSafeUrlWithDnsCheck(rawUrl))) {
    return new Response("Invalid list URL. Private networks, localhosts, and internal domains are not allowed.", { status: 400 });
  }

  const canonicalUrl = ListModel.normalizeUrl(rawUrl);
  const listBloomModel = new ListBloomModel(env.DB);
  const now = Math.floor(Date.now() / 1000);

  if (!(await listBloomModel.hasListBloom(canonicalUrl))) {
    const syncRes = await syncGlobalList(canonicalUrl, env, listModel, listBloomModel, now);
    if (syncRes.syncError) {
      return new Response(JSON.stringify({ error: syncRes.syncError }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  const result = await listModel.distributeListToAllUsers(canonicalUrl);
  triggerAsyncBloomRebuilds(result.affectedProfileIds, env, ctx, 'after distribute');

  return new Response(JSON.stringify({
    success: true,
    url: canonicalUrl,
    totalUsers: result.totalUsers,
    addedCount: result.addedCount,
    skippedCount: result.skippedCount,
    failedCount: result.failedCount,
    addedUsernames: result.addedUsernames,
    skippedUsernames: result.skippedUsernames,
    failedUsernames: result.failedUsernames,
    affectedProfilesCount: result.affectedProfileIds.length
  }), { headers: { 'Content-Type': 'application/json' } });
}

/**
 * Handles `/api/admin/runtime` (GET status & update channels, POST restart).
 */
export async function handleAdminRuntimeRequest(
  request: Request,
  env: Env,
  pathParts: string[]
): Promise<Response> {
  const isServerfull = detectServerfullMode(env);
  const demoMode = isDemoMode(env);
  const jsonHeaders = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store'
  };

  if (request.method === 'POST' && pathParts[3] === 'restart') {
    if (demoMode) {
      return new Response(JSON.stringify({ error: "Service restart is disabled in Demo Mode" }), {
        status: 403,
        headers: jsonHeaders
      });
    }
    if (!isServerfull || !env.SERVERFULL_LIFECYCLE_BRIDGE) {
      return new Response(JSON.stringify({ error: "Not supported outside Serverfull mode" }), {
        status: 404,
        headers: jsonHeaders
      });
    }
    try {
      const restartResult = await env.SERVERFULL_LIFECYCLE_BRIDGE.requestRestart();
      return new Response(JSON.stringify(restartResult), { status: 202, headers: jsonHeaders });
    } catch (e: unknown) {
      if (e instanceof Error && e.message === 'restart_unsupported') {
        return new Response(JSON.stringify({ error: "restart_unsupported" }), { status: 400, headers: jsonHeaders });
      }
      console.error("[Admin API] Failed to schedule service restart:", e);
      return new Response(JSON.stringify({ error: "Failed to schedule restart" }), { status: 500, headers: jsonHeaders });
    }
  }

  if (request.method === 'GET' && !pathParts[3]) {
    if (demoMode) {
      const nowSec = Math.floor(Date.now() / 1000);
      const demoStatus: ServerfullRuntimeStatus = {
        supported: true,
        currentVersion: '1.3.5',
        currentChannel: 'latest',
        startedAt: nowSec - 3600,
        runtime: 'Demo Runtime',
        platform: 'linux',
        installMethod: 'docker',
        serviceManager: 'docker',
        workersCount: 1,
        canRestart: false,
        restartReason: 'demo_mode',
        checkedAt: nowSec,
        checkError: null,
        channels: {
          latest: { channel: 'latest', version: '1.3.5', updateAvailable: false, updateCommand: 'docker pull hugokoo/dns-worker:latest' },
          alpha: { channel: 'alpha', version: '1.3.5-alpha.demo001', updateAvailable: false, updateCommand: 'docker pull hugokoo/dns-worker:alpha' },
          canary: { channel: 'canary', version: '1.3.5-canary.demo002', updateAvailable: false, updateCommand: 'docker pull hugokoo/dns-worker:canary' }
        }
      };
      return new Response(JSON.stringify(demoStatus), { headers: jsonHeaders });
    }

    if (!isServerfull || !env.SERVERFULL_LIFECYCLE_BRIDGE) {
      return new Response(JSON.stringify({ supported: false }), { headers: jsonHeaders });
    }

    const forceRefresh = new URL(request.url).searchParams.get('refresh') === '1';
    const runtimeStatus = await env.SERVERFULL_LIFECYCLE_BRIDGE.getStatus({ forceRefresh });
    return new Response(JSON.stringify(runtimeStatus), { headers: jsonHeaders });
  }

  return new Response("Method Not Allowed", { status: 405 });
}
