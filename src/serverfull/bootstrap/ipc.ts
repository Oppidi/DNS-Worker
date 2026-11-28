/**
 * @file ipc.ts
 * @description Worker-process cluster IPC publishers and cache-invalidation message handlers.
 */

import { registerActiveDnsSyncPublisher, applySyncedActiveDnsConnection } from '../../lib/activeDns';
import {
  registerProfileKeyInvalidatePublisher,
  invalidateProfileKeyCache,
  registerProfileCacheInvalidatePublisher,
  clearLocalProfileCache,
} from '../../pipeline/cache';
import {
  registerAuthCacheInvalidatePublisher,
  invalidateAuthUserCache,
  invalidateAuthUserCacheByUserId,
} from '../../lib/middleware';
import {
  registerSystemSettingsInvalidatePublisher,
  invalidateSystemSettingsCache,
} from '../../models/systemSettings';

/**
 * Registers IPC publishers and inbound message handlers on cluster worker processes so local
 * in-memory auth, profile, pipeline, active-DNS, and system-settings caches stay consistent across workers.
 */
export function registerWorkerIpcHandlers(): void {
  registerActiveDnsSyncPublisher((ip, profileId, expiresAt) => {
    try {
      process.send?.({ type: 'ACTIVE_DNS_SYNC', ip, profileId, expiresAt });
    } catch {}
  });

  registerProfileKeyInvalidatePublisher((profileKey) => {
    try {
      process.send?.({ type: 'PROFILE_KEY_INVALIDATE', profileKey });
    } catch {}
  });

  registerAuthCacheInvalidatePublisher((payload) => {
    try {
      process.send?.({ type: 'AUTH_CACHE_INVALIDATE', ...payload });
    } catch {}
  });

  registerProfileCacheInvalidatePublisher((profileId, clearBloom) => {
    try {
      process.send?.({ type: 'PROFILE_CACHE_INVALIDATE', profileId, clearBloom });
    } catch {}
  });

  registerSystemSettingsInvalidatePublisher((keys) => {
    try {
      process.send?.({ type: 'SYSTEM_SETTINGS_INVALIDATE', keys });
    } catch {}
  });

  process.on('message', (message: unknown) => {
    if (!message || typeof message !== 'object') {
      return;
    }
    const msgType = (message as { type?: string }).type;
    if (msgType === 'ACTIVE_DNS_SYNC') {
      const payload = message as { ip?: unknown; profileId?: unknown; expiresAt?: unknown };
      if (
        typeof payload.ip === 'string' &&
        typeof payload.profileId === 'string' &&
        typeof payload.expiresAt === 'number'
      ) {
        applySyncedActiveDnsConnection(payload.ip, payload.profileId, payload.expiresAt);
      }
    } else if (msgType === 'PROFILE_KEY_INVALIDATE') {
      const payload = message as { profileKey?: unknown };
      if (typeof payload.profileKey === 'string') {
        invalidateProfileKeyCache(payload.profileKey, false);
      }
    } else if (msgType === 'AUTH_CACHE_INVALIDATE') {
      const payload = message as { sessionId?: unknown; userId?: unknown };
      if (typeof payload.sessionId === 'string') {
        invalidateAuthUserCache(payload.sessionId, false);
      }
      if (typeof payload.userId === 'string') {
        invalidateAuthUserCacheByUserId(payload.userId, false);
      }
    } else if (msgType === 'PROFILE_CACHE_INVALIDATE') {
      const payload = message as { profileId?: unknown; clearBloom?: unknown };
      if (typeof payload.profileId === 'string') {
        void clearLocalProfileCache(payload.profileId, Boolean(payload.clearBloom), true);
      }
    } else if (msgType === 'SYSTEM_SETTINGS_INVALIDATE') {
      const payload = message as { keys?: unknown };
      if (Array.isArray(payload.keys)) {
        invalidateSystemSettingsCache(payload.keys.filter((k): k is string => typeof k === 'string'));
      }
    }
  });
}
