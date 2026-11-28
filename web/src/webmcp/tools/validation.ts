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
const ACCESS_POINT_ID_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;
const DEVICE_TYPE_REGEX = /^[a-z0-9_-]{1,32}$/;
const DOMAIN_CHAR_REGEX = /^[a-z0-9_.-]+$/;
const RULE_PATTERN_CHAR_REGEX = /^[a-z0-9*._-]+$/;
const ALLOWED_RULE_TYPES = new Set(["ALLOW", "BLOCK", "REDIRECT"] as const);
const MAX_RULE_BATCH_ITEMS = 50;

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

/**
 * Parses and deduplicates a bounded non-empty array of positive integer IDs.
 */
export function parsePositiveIntArrayInput(
  raw: unknown,
  fieldName: string,
  maxItems: number = MAX_RULE_BATCH_ITEMS
): { ok: true; value: number[] } | { ok: false; error: string } {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, error: `${fieldName} must be a non-empty array of positive integers.` };
  }
  if (raw.length > maxItems) {
    return { ok: false, error: `${fieldName} supports at most ${maxItems} items per call.` };
  }
  const uniqueIds = new Set<number>();
  for (const item of raw) {
    if (typeof item !== "number" || !Number.isInteger(item) || item < 1) {
      return { ok: false, error: `${fieldName} contains an invalid ID; expected positive integers.` };
    }
    uniqueIds.add(item);
  }
  return { ok: true, value: Array.from(uniqueIds) };
}

/**
 * Validates and normalizes a custom DNS rule type (`ALLOW`, `BLOCK`, `REDIRECT`).
 */
export function validateRuleTypeInput(
  raw: unknown
): { ok: true; value: "ALLOW" | "BLOCK" | "REDIRECT" } | { ok: false; error: string } {
  if (typeof raw !== "string") {
    return { ok: false, error: "type must be ALLOW, BLOCK, or REDIRECT." };
  }
  const upper = raw.trim().toUpperCase();
  if (!ALLOWED_RULE_TYPES.has(upper as "ALLOW" | "BLOCK" | "REDIRECT")) {
    return { ok: false, error: `Unsupported rule type "${upper}". Expected ALLOW, BLOCK, or REDIRECT.` };
  }
  return { ok: true, value: upper as "ALLOW" | "BLOCK" | "REDIRECT" };
}

/**
 * Validates and normalizes a custom DNS rule domain/wildcard pattern while rejecting bare catch-all wildcards.
 */
export function validateRulePatternInput(
  raw: unknown
): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof raw !== "string") {
    return { ok: false, error: "pattern must be a string." };
  }
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) {
    return { ok: false, error: "pattern must not be empty." };
  }
  if (/[\s/:@#?]/.test(trimmed)) {
    return { ok: false, error: "pattern must be a hostname or wildcard pattern without URL scheme, spaces, or paths." };
  }
  const cleaned = trimmed.replace(/\.+$/, "");
  if (!cleaned || cleaned.length > 253 || cleaned.includes("..")) {
    return { ok: false, error: "pattern must be 1-253 characters without empty labels." };
  }
  if (!RULE_PATTERN_CHAR_REGEX.test(cleaned)) {
    return { ok: false, error: "pattern contains invalid characters; allowed: a-z, 0-9, ., -, _, *." };
  }
  if (cleaned.replace(/[*.]/g, "") === "") {
    return { ok: false, error: "pattern cannot be a bare catch-all wildcard (such as * or *.*)." };
  }
  return { ok: true, value: cleaned };
}

/**
 * Validates an optional short record payload string (`v_a`, `v_aaaa`, `v_cname`, `v_txt`) for REDIRECT rules.
 */
export function validateOptionalRuleTarget(
  raw: unknown,
  fieldName: string
): { ok: true; value: string | undefined } | { ok: false; error: string } {
  if (raw === undefined || raw === null) {
    return { ok: true, value: undefined };
  }
  if (typeof raw !== "string") {
    return { ok: false, error: `${fieldName} must be a string when provided.` };
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: true, value: undefined };
  }
  if (trimmed.length > 255 || /[\r\n\0]/.test(trimmed)) {
    return { ok: false, error: `${fieldName} exceeds 255 characters or contains invalid control characters.` };
  }
  return { ok: true, value: trimmed };
}

/**
 * Validates a filter list subscription URL (restricting to HTTP/HTTPS URLs <= 1024 characters).
 */
export function validateSubscriptionUrlInput(
  raw: unknown
): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof raw !== "string") {
    return { ok: false, error: "url must be a string." };
  }
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 1024 || /\s/.test(trimmed)) {
    return { ok: false, error: "url must be a valid HTTP(S) URL up to 1024 characters without whitespace." };
  }
  try {
    const parsed = new URL(trimmed);
    if ((parsed.protocol !== "https:" && parsed.protocol !== "http:") || !parsed.hostname) {
      return { ok: false, error: "url must use http:// or https:// with a valid hostname." };
    }
    return { ok: true, value: parsed.toString() };
  } catch {
    return { ok: false, error: "url is not a syntactically valid URL." };
  }
}

/**
 * Validates an Access Point identifier (`1–64` safe characters).
 */
export function validateAccessPointIdInput(
  raw: unknown
): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof raw !== "string") {
    return { ok: false, error: "apId must be a string." };
  }
  const trimmed = raw.trim();
  if (!ACCESS_POINT_ID_REGEX.test(trimmed)) {
    return { ok: false, error: "apId contains invalid characters or length (1-64 chars)." };
  }
  return { ok: true, value: trimmed };
}

/**
 * Validates a human-readable Profile or Access Point display name (`1–64` chars, no control chars).
 */
export function validateDisplayNameInput(
  raw: unknown,
  fieldName: string = "name"
): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof raw !== "string") {
    return { ok: false, error: `${fieldName} must be a string.` };
  }
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 64 || /[\r\n\0]/.test(trimmed)) {
    return { ok: false, error: `${fieldName} must be 1-64 characters without line breaks or control characters.` };
  }
  return { ok: true, value: trimmed };
}

/**
 * Validates an optional Access Point device type identifier (e.g., `router`, `iphone`, `linux`).
 */
export function validateDeviceTypeInput(
  raw: unknown
): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof raw !== "string") {
    return { ok: false, error: "deviceType must be a string." };
  }
  const normalized = raw.trim().toLowerCase();
  if (!DEVICE_TYPE_REGEX.test(normalized)) {
    return { ok: false, error: "deviceType must contain 1-32 lowercase alphanumeric, underscore, or hyphen characters." };
  }
  return { ok: true, value: normalized };
}

/**
 * Validates upstream DNS endpoint entries (supports DoH `https://`, DoT `tls://`, DoQ `quic://`, or IP literal).
 */
export function validateUpstreamListInput(
  raw: unknown
): { ok: true; value: string[] } | { ok: false; error: string } {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 8) {
    return { ok: false, error: "upstream must be an array of 1-8 DNS resolver endpoints." };
  }
  const cleaned: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const entry = raw[i];
    if (typeof entry !== "string") {
      return { ok: false, error: `upstream[${i}] must be a string.` };
    }
    const trimmed = entry.trim();
    if (!trimmed || trimmed.length > 256 || /\s|[\r\n\0]/.test(trimmed)) {
      return { ok: false, error: `upstream[${i}] must be 1-256 characters without spaces or control chars.` };
    }
    cleaned.push(trimmed);
  }
  return { ok: true, value: cleaned };
}
