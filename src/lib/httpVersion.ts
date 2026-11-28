/**
 * @file httpVersion.ts
 * @description HTTP protocol version policy enforcement (`MIN_HTTP_VERSION`) and
 * RFC 7838 / RFC 9110 §7.8 HTTP version upgrade guidance helpers for DoH and Worker/Serverfull responses.
 */

import { Env } from '../types';

/**
 * Discrete scaled HTTP version identifiers (`major * 10 + minor`) to avoid float precision issues.
 * - `10`: HTTP/1.0
 * - `11`: HTTP/1.1 (default minimum)
 * - `20`: HTTP/2
 * - `30`: HTTP/3
 */
export type HttpVersionCode = 10 | 11 | 20 | 30;

/** Default minimum allowed HTTP version (`1.1`). */
export const DEFAULT_MIN_HTTP_VERSION: HttpVersionCode = 11;

/**
 * Parses a raw HTTP protocol label or numeric version string into a normalized `HttpVersionCode`.
 *
 * @param raw - Protocol string or number (e.g. `"1.1"`, `"HTTP/1.1"`, `"2"`, `"HTTP/2.0"`, `"3"`).
 * @returns Normalized version code (`10 | 11 | 20 | 30`), or `null` if unrecognized.
 */
export function parseHttpVersion(raw: string | number | undefined | null): HttpVersionCode | null {
  if (raw === undefined || raw === null) {
    return null;
  }
  const normalized = String(raw).trim().toUpperCase().replace(/^HTTP\//, '');
  if (!normalized) {
    return null;
  }
  if (normalized === '1.0' || normalized === '1') {
    return 10;
  }
  if (normalized === '1.1') {
    return 11;
  }
  if (normalized === '2' || normalized === '2.0' || normalized === 'H2') {
    return 20;
  }
  if (normalized === '3' || normalized === '3.0' || normalized === 'H3') {
    return 30;
  }
  return null;
}

/**
 * Formats an `HttpVersionCode` into a human-readable HTTP protocol string.
 */
export function formatHttpVersion(version: HttpVersionCode): string {
  switch (version) {
    case 10:
      return 'HTTP/1.0';
    case 11:
      return 'HTTP/1.1';
    case 20:
      return 'HTTP/2';
    case 30:
      return 'HTTP/3';
  }
}

/**
 * Resolves the configured minimum allowed HTTP version from `env.MIN_HTTP_VERSION`, defaulting to `1.1`.
 */
export function getMinHttpVersion(env?: Pick<Env, 'MIN_HTTP_VERSION'>): HttpVersionCode {
  return parseHttpVersion(env?.MIN_HTTP_VERSION) ?? DEFAULT_MIN_HTTP_VERSION;
}

/**
 * Extracts and parses the client-facing HTTP version from Cloudflare `request.cf.httpProtocol`
 * or trusted `X-Http-Version` proxy header.
 */
export function getRequestHttpVersion(request: Request): HttpVersionCode | null {
  const cfProto = (request as Request & { cf?: { httpProtocol?: string } }).cf?.httpProtocol;
  const rawProto = cfProto || request.headers.get('X-Http-Version');
  return parseHttpVersion(rawProto);
}

/**
 * Builds an RFC 7838 `Alt-Svc` header advertising HTTP/3 (and HTTP/2 fallback when allowed).
 *
 * @param port - Target HTTPS port (443 on Workers edge, or `SERVERFULL_HTTPS_PORT` in Serverfull).
 * @param minVersion - Optional minimum allowed HTTP version (omits `h2` if HTTP/3 is mandated).
 */
export function buildAltSvcHeader(
  port: number = 443,
  minVersion: HttpVersionCode = DEFAULT_MIN_HTTP_VERSION
): string {
  const safePort = Number.isFinite(port) && port > 0 ? Math.floor(port) : 443;
  const services = [`h3=":${safePort}"; ma=86400`, `h3-29=":${safePort}"; ma=86400`];
  if (minVersion <= 20) {
    services.push(`h2=":${safePort}"; ma=86400`);
  }
  return services.join(', ');
}

/**
 * Computes the advertised `Upgrade` protocol tokens (RFC 9110 §7.8) for HTTP/1.x responses.
 */
export function buildUpgradeHeader(minVersion: HttpVersionCode = DEFAULT_MIN_HTTP_VERSION): string {
  return minVersion >= 30 ? 'h3' : 'h3, h2';
}

/**
 * Attaches standard HTTP version upgrade guidance headers to an outgoing response:
 * - `Alt-Svc` (RFC 7838) advertising HTTP/3 and HTTP/2 when the client is not already on HTTP/3.
 * - `Upgrade` (RFC 9110 §7.8) only for HTTP/1.x requests (`< 2.0`) to stay RFC 9113 §8.2.2 compliant on HTTP/2+.
 */
export function applyHttpUpgradeGuidanceHeaders(
  response: Response,
  requestVersion: HttpVersionCode | null,
  minVersion: HttpVersionCode = DEFAULT_MIN_HTTP_VERSION,
  altSvcPort: number = 443
): Response {
  const headers = new Headers(response.headers);
  let modified = false;

  if ((requestVersion === null || requestVersion < 30) && !headers.has('Alt-Svc')) {
    headers.set('Alt-Svc', buildAltSvcHeader(altSvcPort, minVersion));
    modified = true;
  }

  // RFC 9113 §8.2.2 prohibits `Upgrade` on HTTP/2+; emit only when client connected via HTTP/1.0 or HTTP/1.1
  if (requestVersion !== null && requestVersion < 20 && !headers.has('Upgrade')) {
    headers.set('Upgrade', buildUpgradeHeader(minVersion));
    modified = true;
  }

  if (!modified) {
    return response;
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

/**
 * Builds an HTTP `505 HTTP Version Not Supported` response accompanied by `Upgrade` and `Alt-Svc` guidance headers.
 */
export function buildHttpVersionRejectedResponse(
  requestVersion: HttpVersionCode,
  minVersion: HttpVersionCode
): Response {
  const reqLabel = formatHttpVersion(requestVersion);
  const minLabel = formatHttpVersion(minVersion);

  return new Response(
    `This server requires ${minLabel} or later (received ${reqLabel}). Please upgrade your client to use HTTP/2 or HTTP/3.\n`,
    {
      status: 505,
      statusText: 'HTTP Version Not Supported',
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Upgrade': buildUpgradeHeader(minVersion),
        'Alt-Svc': buildAltSvcHeader(443, minVersion),
        'Vary': 'X-Http-Version'
      }
    }
  );
}
