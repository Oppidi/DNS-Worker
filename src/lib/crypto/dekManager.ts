/**
 * @file dekManager.ts
 * @description Zero-Knowledge Post-Quantum DEK (Data Encryption Key) Lifecycle Manager.
 * Operates as an independent key producer: generates and rotates hybrid KEM keys per isolate,
 * persists kem_keys (containing ONLY client-decapsulatable ciphertext kem_ct) to D1,
 * and maintains an active in-memory pool for the lifetime of the Worker isolate.
 *
 * NOTE: The server NEVER persists the plaintext DEK or any server-decryptable wrapper.
 * Once the isolate terminates, ephemeral shared secrets are destroyed from server memory,
 * ensuring strict forward secrecy and zero-knowledge data-at-rest encryption.
 */

import { D1Database } from "@cloudflare/workers-types";
import {
  encapsulatePqcDek,
  deriveDekFromSharedSecret,
  fromBase64,
} from "./e2ee";
import { generateLogId } from "../../models/log/core";
import { zeroizeBuffer } from "../../utils/memory";

export interface ActiveDek {
  kemKeyId: string;
  dek: CryptoKey;
  profileId: string;
  pqcPublicKeyBase64: string;
  createdAt: number;
  expiresAt: number;
}

/** 1 hour DEK lifetime in milliseconds */
export const DEK_LIFETIME_MS = 3600 * 1000;

/** In-memory pool of currently active DEKs per profile in this isolate */
const activeDekMap = new Map<string, ActiveDek>();

/** Monotonic generation counter per profile to prevent stale rotateDek from reviving invalidated keys */
const dekGenerations = new Map<string, number>();

/** Mutex to deduplicate concurrent in-flight DEK provisionings per profile in this isolate */
const inFlightDekPromises = new Map<string, { pk: string; promise: Promise<ActiveDek> }>();

/**
 * Key Provider / Consumer Interface:
 * Retrieves the currently published DEK for a profile if still within its valid lifetime.
 * Returns null if not yet initialized or expired in this worker isolate.
 *
 * @param profileId Profile identifier
 * @returns ActiveDek or null if not yet initialized or expired
 */
export function getCurrentDek(profileId: string): ActiveDek | null {
  const existing = activeDekMap.get(profileId);
  if (existing && existing.expiresAt > Date.now()) {
    return existing;
  }
  return null;
}

/**
 * Key Producer Interface:
 * Ensures an active DEK is available in this isolate for the profile.
 * If none exists or the existing key has exceeded its rotation window,
 * generates a fresh post-quantum hybrid KEM key, writes kem_ct to D1,
 * and publishes the new key to the active in-memory pool.
 *
 * Uses inFlightDekPromises mutex to ensure parallel concurrent requests
 * do not generate duplicate keys simultaneously.
 *
 * @param db D1 Database instance
 * @param profileId Profile identifier
 * @param pqcPublicKeyBase64 1249-byte hybrid public key in Base64
 * @returns The active DEK
 */
export async function ensureActiveDek(
  db: D1Database,
  profileId: string,
  pqcPublicKeyBase64: string
): Promise<ActiveDek> {
  const now = Date.now();
  const existing = activeDekMap.get(profileId);

  // If existing key is still within its rotation window and matches the recipient public key, continue using it
  if (existing && existing.expiresAt > now && existing.pqcPublicKeyBase64 === pqcPublicKeyBase64) {
    return existing;
  }

  // Deduplicate concurrent in-flight requests for the same profile and public key
  const inFlight = inFlightDekPromises.get(profileId);
  if (inFlight && inFlight.pk === pqcPublicKeyBase64) {
    return await inFlight.promise;
  }

  let promise!: Promise<ActiveDek>;
  promise = (async () => {
    try {
      return await rotateDek(db, profileId, pqcPublicKeyBase64);
    } finally {
      const current = inFlightDekPromises.get(profileId);
      if (current && current.promise === promise) {
        inFlightDekPromises.delete(profileId);
      }
    }
  })();

  inFlightDekPromises.set(profileId, { pk: pqcPublicKeyBase64, promise });
  return await promise;
}

/**
 * Key Producer Interface:
 * Generates a new DEK via P256-MLKEM768 encapsulation, persists kem_ct to D1 kem_keys,
 * and atomically updates the in-memory active pool.
 *
 * @param db D1 Database instance
 * @param profileId Profile identifier
 * @param pqcPublicKeyBase64 1249-byte hybrid public key in Base64
 * @returns Newly minted ActiveDek
 */
export async function rotateDek(
  db: D1Database,
  profileId: string,
  pqcPublicKeyBase64: string
): Promise<ActiveDek> {
  const startGen = dekGenerations.get(profileId) ?? 0;
  const now = Date.now();
  const nowSec = Math.floor(now / 1000);
  const expiresAtSec = nowSec + 3600;

  // 1. Encapsulate with recipient's hybrid public key (1,249 bytes)
  const pkBytes = fromBase64(pqcPublicKeyBase64);
  const { kemCtBase64, sharedSecret } = encapsulatePqcDek(pkBytes);

  // 2. Derive 256-bit AES-GCM DEK via HKDF-SHA256 and scrub raw shared secret
  let dek: CryptoKey;
  try {
    dek = await deriveDekFromSharedSecret(sharedSecret);
  } finally {
    zeroizeBuffer(sharedSecret);
  }

  // 3. Generate unique kem_key_id
  const kemKeyId = `kem_${generateLogId()}`;

  // 4. Persist KEM ciphertext to kem_keys table in D1 (fail closed so logs never reference unpersisted keys)
  try {
    await db
      .prepare(
        "INSERT INTO kem_keys (id, profile_id, kem_ct, created_at, expires_at) VALUES (?, ?, ?, ?, ?)"
      )
      .bind(kemKeyId, profileId, kemCtBase64, nowSec, expiresAtSec)
      .run();
  } catch (err) {
    console.error(`[DekManager] Failed to persist kem_key ${kemKeyId} to D1:`, err);
    throw err;
  }

  // 5. Publish to in-memory active pool only if not invalidated while awaiting D1
  const activeDek: ActiveDek = {
    kemKeyId,
    dek,
    profileId,
    pqcPublicKeyBase64,
    createdAt: now,
    expiresAt: now + DEK_LIFETIME_MS,
  };

  if ((dekGenerations.get(profileId) ?? 0) === startGen) {
    activeDekMap.set(profileId, activeDek);
  }
  return activeDek;
}

/**
 * Invalidates the active DEK for a profile (e.g. when user updates or disables E2EE).
 */
export function invalidateActiveDek(profileId: string): void {
  dekGenerations.set(profileId, (dekGenerations.get(profileId) ?? 0) + 1);
  activeDekMap.delete(profileId);
  inFlightDekPromises.delete(profileId);
}
