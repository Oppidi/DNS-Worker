/**
 * @file database.ts
 * @description Admin REST API handlers for `/api/admin/database` (snapshots, storage overview, and Turso migrations).
 */

import { Env, User } from "../../../types";
import {
  getDatabaseService,
  isTursoConfigured,
  getTursoMigrationStats,
  runTursoMigrations
} from "../../../lib/turso";
import { detectServerfullMode } from "../../../router/runtimeConfig";
import { buildDemoSnapshotOverview, isDemoMode } from "../../../lib/demoConfig";
import { getOrCreateJwtSecret } from "../../../lib/auth";
import { importJwtSecret, signJWT } from "../../../lib/jwt";
import { decodePathSegment } from "./users";

async function handleAdminSnapshotsRequest(
  request: Request,
  env: Env,
  user: User,
  pathParts: string[],
  demoMode: boolean
): Promise<Response> {
  if (demoMode) {
    if (request.method === 'GET' && !pathParts[4]) {
      return new Response(JSON.stringify(buildDemoSnapshotOverview(env)), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
      });
    }
    return new Response(JSON.stringify({ error: "Database snapshot operations are disabled in Demo Mode" }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const isServerfull = detectServerfullMode(env);
  const dbService = getDatabaseService(env, isServerfull);
  const snapshotBridge = isServerfull && dbService === 'File' ? env.SERVERFULL_SNAPSHOT_BRIDGE : undefined;

  if (!snapshotBridge) {
    return new Response(JSON.stringify({ error: "Database snapshots are only supported in Serverfull File mode" }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (request.method === 'GET' && !pathParts[4]) {
    const overview = await snapshotBridge.getOverview();
    return new Response(JSON.stringify(overview), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
    });
  }

  if (request.method === 'POST' && pathParts[4] && pathParts[5] === 'ticket') {
    const decodedName = decodePathSegment(pathParts[4]);
    if (decodedName === null) return new Response("Invalid filename encoding", { status: 400 });

    const overview = await snapshotBridge.getOverview();
    if (!overview.snapshots.some((snap) => snap.filename === decodedName)) {
      return new Response("Snapshot not found", { status: 404 });
    }
    if (!user.sessionId) {
      return new Response("Active session required", { status: 401 });
    }

    const secret = await getOrCreateJwtSecret(env);
    const jwtKey = await importJwtSecret(secret);
    const expiresIn = 14400;
    const ticket = await signJWT(
      {
        purpose: "snapshot_download",
        filename: decodedName,
        userId: user.id,
        sessionId: user.sessionId,
        exp: Math.floor(Date.now() / 1000) + expiresIn,
      },
      jwtKey
    );

    const downloadUrl = `/api/admin/database/snapshots/${encodeURIComponent(decodedName)}/download?ticket=${encodeURIComponent(ticket)}`;
    return new Response(JSON.stringify({ ticket, downloadUrl, expiresIn }), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
    });
  }

  if (request.method === 'GET' && pathParts[4] && pathParts[5] === 'download') {
    const decodedName = decodePathSegment(pathParts[4]);
    if (decodedName === null) return new Response("Invalid filename encoding", { status: 400 });
    const download = await snapshotBridge.openSnapshotDownload(decodedName, request.headers.get('Range'));
    if (!download) return new Response("Snapshot not found", { status: 404 });
    if (download.status === 416) {
      return new Response(null, {
        status: 416,
        headers: {
          'Content-Range': download.contentRange || `bytes */${download.sizeBytes}`,
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'private, no-store, no-transform'
        }
      });
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/zstd',
      'Content-Disposition': `attachment; filename="${download.filename}"`,
      'Content-Length': String(download.contentLength),
      'Accept-Ranges': 'bytes',
      'ETag': download.etag,
      'Cache-Control': 'private, no-store, no-transform',
      'Vary': 'Authorization',
      'X-Accel-Buffering': 'no'
    };
    if (download.status === 206 && download.contentRange) {
      headers['Content-Range'] = download.contentRange;
    }

    return new Response(download.stream, { status: download.status, headers });
  }

  if (request.method === 'POST' && !pathParts[4]) {
    try {
      const activeCapture = await snapshotBridge.startCapture();
      return new Response(JSON.stringify({ success: true, activeCapture }), {
        status: 202,
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      if (msg === 'SNAPSHOT_IN_PROGRESS') {
        return new Response(JSON.stringify({ error: 'Snapshot capture is already in progress' }), {
          status: 409,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (msg.startsWith('ZSTD_UNSUPPORTED')) {
        return new Response(JSON.stringify({ error: 'Zstd compression is not supported in the current Node.js runtime (requires Node.js >= 22.15).' }), {
          status: 501,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      console.error('[Admin Snapshot] Failed to start capture:', err);
      return new Response(JSON.stringify({ error: 'Failed to start snapshot capture' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  if (request.method === 'POST' && pathParts[4] === 'abort') {
    const result = await snapshotBridge.abortCapture();
    return new Response(JSON.stringify({ success: true, ...result }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (request.method === 'DELETE') {
    if (pathParts[4]) {
      const decodedName = decodePathSegment(pathParts[4]);
      if (decodedName === null) return new Response("Invalid filename encoding", { status: 400 });
      const result = await snapshotBridge.deleteSnapshots([decodedName]);
      return new Response(JSON.stringify({ success: true, ...result }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    let body: { filenames?: unknown };
    try {
      body = (await request.json()) as { filenames?: unknown };
    } catch {
      return new Response("Invalid JSON payload", { status: 400 });
    }
    const rawList = Array.isArray(body?.filenames) ? body.filenames : [];
    const filenames = rawList.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
    if (filenames.length === 0) {
      return new Response("Missing snapshot filenames", { status: 400 });
    }
    const result = await snapshotBridge.deleteSnapshots(filenames);
    return new Response(JSON.stringify({ success: true, ...result }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  return new Response("Method Not Allowed", { status: 405 });
}

/**
 * Handles `/api/admin/database/*` endpoints.
 */
export async function handleAdminDatabaseRequest(
  request: Request,
  env: Env,
  user: User,
  pathParts: string[]
): Promise<Response> {
  const isServerfull = detectServerfullMode(env);
  const dbService = getDatabaseService(env, isServerfull);
  const isTurso = dbService === 'Turso' && isTursoConfigured(env);
  const demoMode = isDemoMode(env);
  const snapshotBridge = isServerfull && dbService === 'File' && !demoMode
    ? env.SERVERFULL_SNAPSHOT_BRIDGE
    : undefined;

  if (pathParts[3] === 'snapshots') {
    return handleAdminSnapshotsRequest(request, env, user, pathParts, demoMode);
  }

  if (request.method === 'GET' && !pathParts[3]) {
    const [stats, snapshotOverview] = await Promise.all([
      env.DB ? getTursoMigrationStats(env.DB as any) : Promise.resolve(null),
      demoMode
        ? Promise.resolve(buildDemoSnapshotOverview(env))
        : snapshotBridge
          ? snapshotBridge.getOverview()
          : Promise.resolve(null)
    ]);
    return new Response(JSON.stringify({
      databaseService: dbService,
      isTurso,
      configured: Boolean(env.DB),
      migrations: stats,
      snapshotOverview
    }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  }

  if (request.method === 'POST' && pathParts[3] === 'migrate') {
    if (!env.DB) {
      return new Response(JSON.stringify({ error: "Database is not configured" }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    try {
      const appliedCount = await runTursoMigrations(env.DB as any, undefined, { maxMigrations: 15 });
      const stats = await getTursoMigrationStats(env.DB as any);
      return new Response(JSON.stringify({
        success: true,
        appliedCount,
        hasMore: !stats.completed,
        stats
      }), { headers: { 'Content-Type': 'application/json' } });
    } catch (err: any) {
      const errMsg = err instanceof Error ? err.message : String(err || '');
      console.error('[Admin Database Migrate] Migration execution failed:', err);
      return new Response(JSON.stringify({
        success: false,
        error: errMsg ? `Database migration failed: ${errMsg}` : 'Database migration failed'
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  return new Response("Not Found", { status: 404 });
}
