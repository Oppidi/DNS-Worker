/**
 * @file validation.ts
 * @description Shared input parsing and normalization helpers for DNS Worker WebMCP tools.
 */

const ALLOWED_RECORD_TYPES = new Set([
  "A",
  "AAAA",
  "CNAME",
  "TXT",
  "MX",
  "HTTPS",
  "SVCB",
  "NS",
  "PTR",
  "SOA",
]);

const PROFILE_ID_REGEX = /^[a-zA-Z0-9_-]{3,32}$/;
const DOMAIN_CHAR_REGEX = /^[a-z0-9_.-]+$/;

/**
 * Normalizes and validates a queried hostname (strips optional URL scheme, port, path, and trailing dots).
 */
export function normalizeDomainInput(
  raw: unknown
): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof raw !== "string") {
    return { ok: false, error: "domain must be a string." };
  }
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .split("/")[0]
    .split(":")[0]
    .replace(/\.+$/, "");

  if (!cleaned || cleaned.length > 253 || !DOMAIN_CHAR_REGEX.test(cleaned)) {
    return { ok: false, error: "domain must be a valid DNS hostname (1-253 chars)." };
  }
  return { ok: true, value: cleaned };
}

/**
 * Resolves `profileId` either from explicit tool arguments or the currently selected Profile in UI state.
 */
export function resolveProfileIdInput(
  rawProfileId: unknown,
  activeProfileId: string | null
): { ok: true; value: string } | { ok: false; error: string } {
  const candidate =
    typeof rawProfileId === "string" && rawProfileId.trim().length > 0
      ? rawProfileId.trim()
      : activeProfileId;

  if (!candidate) {
    return {
      ok: false,
      error: "profileId is required when no active Profile is selected in the dashboard.",
    };
  }
  if (!PROFILE_ID_REGEX.test(candidate)) {
    return { ok: false, error: "profileId contains invalid characters or length." };
  }
  return { ok: true, value: candidate };
}

/**
 * Normalizes a DNS RR query type string (defaults to `"A"`).
 */
export function normalizeRecordTypeInput(
  raw: unknown
): { ok: true; value: string } | { ok: false; error: string } {
  if (raw === undefined || raw === null || raw === "") {
    return { ok: true, value: "A" };
  }
  if (typeof raw !== "string") {
    return { ok: false, error: "recordType must be a string." };
  }
  const upper = raw.trim().toUpperCase();
  if (!ALLOWED_RECORD_TYPES.has(upper)) {
    return {
      ok: false,
      error: `Unsupported recordType "${upper}". Allowed: ${Array.from(ALLOWED_RECORD_TYPES).join(", ")}.`,
    };
  }
  return { ok: true, value: upper };
}

/**
 * Parses a strictly positive integer identifier.
 */
export function parsePositiveIntInput(
  raw: unknown,
  fieldName: string
): { ok: true; value: number } | { ok: false; error: string } {
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1) {
    return { ok: false, error: `${fieldName} must be a positive integer.` };
  }
  return { ok: true, value: raw };
}
