/**
 * @file dnsCommon.ts
 * @description Shared DNS pipeline execution, rate-limiting, and RFC 1035/7858 TCP length-prefix framing utilities for Serverfull DNS servers.
 */

import net from 'node:net';
import { Buffer } from 'node:buffer';
import { Env, Context, ExecutionContext } from '../types';
import { parseDNSQueryFromRaw } from '../utils/dns';
import { pipeline } from '../pipeline';
import { resolveDefaultProfile, resolveProfileByKey } from '../api/doh';
import { hasAlreadyTriedFailOpen, resolveFailOpenFallback } from '../pipeline/resolver/transport';
import { recordActiveDnsConnection } from '../lib/activeDns';
import { zeroizeBuffer } from '../utils/memory';

/**
 * Maximum RFC 7858 / RFC 1035 TCP DNS frame buffer: 2-byte length prefix + 65535-byte DNS message.
 */
export const MAX_TCP_DNS_BUFFER = 65537;

/**
 * Parameters for executing a Classic DNS (port 53 UDP/TCP) query through the filtering pipeline.
 */
export interface ClassicDnsQueryParams {
  rawBytes: Uint8Array;
  remoteIp: string;
  defaultProfileKey?: string;
  env: Env;
  protocolTag: 'UDP' | 'TCP';
  onAnswer: (answer: Uint8Array) => void;
}

/**
 * Creates a bounded per-IP token-bucket rate limiter to mitigate DNS packet/query floods.
 *
 * @param maxTokens - Burst token capacity per IP.
 * @param refillPerSec - Sustained refill rate per second.
 * @param maxBuckets - Maximum tracked IP buckets before LRU eviction.
 * @returns Predicate returning true if the packet/query is within budget.
 */
export function createIpRateLimiter(
  maxTokens: number = 120,
  refillPerSec: number = 60,
  maxBuckets: number = 10000
): (remoteIp: string) => boolean {
  const rateBuckets = new Map<string, { tokens: number; lastRefillMs: number }>();
  const refillPerMs = refillPerSec / 1000;

  return (remoteIp: string): boolean => {
    const now = Date.now();
    let bucket = rateBuckets.get(remoteIp);
    if (!bucket) {
      if (rateBuckets.size >= maxBuckets) {
        const firstKey = rateBuckets.keys().next().value;
        if (firstKey !== undefined) rateBuckets.delete(firstKey);
      }
      bucket = { tokens: maxTokens - 1, lastRefillMs: now };
      rateBuckets.set(remoteIp, bucket);
      return true;
    }

    const elapsed = Math.max(0, now - bucket.lastRefillMs);
    bucket.tokens = Math.min(maxTokens, bucket.tokens + elapsed * refillPerMs);
    bucket.lastRefillMs = now;
    if (bucket.tokens < 1) {
      return false;
    }
    bucket.tokens -= 1;
    return true;
  };
}

/**
 * Executes a Classic DNS query (UDP or TCP port 53) against the filtering pipeline with fail-open fallback.
 *
 * @param params - Query buffer, client address, profile settings, environment, and answer callback.
 */
export async function executeClassicDnsQuery(params: ClassicDnsQueryParams): Promise<void> {
  const { rawBytes, remoteIp, defaultProfileKey, env, protocolTag, onAnswer } = params;
  const tag = `[${protocolTag} DNS]`;

  try {
    const query = parseDNSQueryFromRaw(rawBytes);
    if (!query) {
      return; // Drop invalid / malformed packets
    }

    const ctx: ExecutionContext = {
      waitUntil(promise: Promise<unknown>) {
        promise.catch((err) => console.error(`[${protocolTag} Background Task Error]:`, err));
      },
      passThroughOnException() {}
    } as ExecutionContext;

    // Determine profile:
    // 1. Configured default profile key
    // 2. Safe default profile fallback to FAIL_OPEN_UPSTREAM (log_retention_days: 0)
    let profile = null;
    if (defaultProfileKey) {
      profile = await resolveProfileByKey(defaultProfileKey, env, ctx);
    }
    if (!profile) {
      profile = await resolveDefaultProfile(env, ctx);
    }
    if (!profile) {
      return;
    }

    const context: Context = {
      profileId: profile.id,
      accessPointId: profile.access_point_id,
      accessPointName: profile.access_point_name,
      startTime: Date.now(),
      env,
      ctx,
      isEmergencyFallback: Boolean(profile.isEmergencyFallback)
    };

    const host = remoteIp.includes(':') ? `[${remoteIp}]` : remoteIp;
    const request = new Request(`http://${host}/${profile.profile_key || profile.id || 'default'}`, {
      headers: {
        'CF-Connecting-IP': remoteIp,
        'Accept': 'application/dns-message',
        'Content-Type': 'application/dns-message'
      }
    });

    const result = await pipeline.process(request, query, context);
    if (!profile.isEmergencyFallback && profile.id !== 'default') {
      const activeDnsTtl = Number(env.ACTIVE_DNS_CACHE_TTL) || 60;
      ctx.waitUntil(recordActiveDnsConnection(null, remoteIp, profile.id, activeDnsTtl, true));
    }
    if (!result || result.action === 'FAIL' || !result.answer || result.answer.length === 0) {
      if (!hasAlreadyTriedFailOpen(result, env)) {
        const fallbackRes = await resolveFailOpenFallback(env, rawBytes);
        if (fallbackRes.answer && fallbackRes.answer.length > 0) {
          onAnswer(fallbackRes.answer);
        }
      }
      return;
    }

    onAnswer(result.answer);
  } catch (err) {
    console.error(`${tag} Message handling exception:`, err);
    try {
      const transportRes = await resolveFailOpenFallback(env, rawBytes);
      if (transportRes.answer && transportRes.answer.length > 0) {
        onAnswer(transportRes.answer);
      }
    } catch (fallbackErr) {
      console.error(`${tag} Fail-open upstream fallback failed:`, fallbackErr);
    }
  } finally {
    zeroizeBuffer(rawBytes);
  }
}

/**
 * Attaches an RFC 1035 / RFC 7858 2-byte length-prefixed DNS message reader to a stream socket.
 *
 * @param socket - TCP or TLS client socket.
 * @param onFrame - Sequential async handler invoked for each complete wire DNS frame.
 */
export function attachLengthPrefixedDnsReader(
  socket: net.Socket,
  onFrame: (frame: Buffer) => Promise<void>
): void {
  let buffer = Buffer.alloc(0);
  let processingChain: Promise<void> = Promise.resolve();

  socket.on('data', (chunk: Buffer) => {
    if (buffer.length + chunk.length > MAX_TCP_DNS_BUFFER) {
      socket.destroy();
      return;
    }
    buffer = Buffer.concat([buffer, chunk]);

    const frames: Buffer[] = [];
    while (buffer.length >= 2) {
      const msgLen = buffer.readUInt16BE(0);
      if (msgLen === 0) {
        socket.destroy();
        return;
      }
      if (buffer.length < 2 + msgLen) {
        // Incomplete message frame, wait for more data
        break;
      }

      frames.push(Buffer.from(buffer.subarray(2, 2 + msgLen)));
      buffer = buffer.subarray(2 + msgLen);
    }

    if (frames.length > 0) {
      processingChain = processingChain.then(async () => {
        for (const frame of frames) {
          if (socket.destroyed) break;
          await onFrame(frame);
        }
      });
    }
  });
}

/**
 * Frames a DNS wire answer with its 2-byte big-endian length prefix and writes to a TCP/TLS socket.
 *
 * @param socket - Writable TCP or TLS socket.
 * @param answer - Raw wire-format DNS response packet.
 */
export function sendLengthPrefixedDnsAnswer(socket: net.Socket, answer: Uint8Array): void {
  if (!socket.destroyed && socket.writable) {
    if (answer.length > 65535) {
      // Clamp oversized local synthesis errors to a minimal 12-byte SERVFAIL rather than overflowing uint16 length
      const servfail = Buffer.alloc(14);
      servfail.writeUInt16BE(12, 0);
      if (answer.length >= 2) {
        servfail[2] = answer[0];
        servfail[3] = answer[1];
      }
      servfail[4] = 0x81;
      servfail[5] = 0x02;
      socket.write(servfail);
      return;
    }
    const responseBuf = Buffer.allocUnsafe(2 + answer.length);
    responseBuf.writeUInt16BE(answer.length, 0);
    responseBuf.set(answer, 2);
    socket.write(responseBuf);
  }
}
