/**
 * @file demoConfig.ts
 * @description Demo Mode environment inspection, public endpoint payload builders, and re-exports from `./demo/*`.
 */

import { DEFAULT_SUBSTITUTE_DOMAIN } from "../constants/presets";
import type { Env } from "../types";
import {
  DEFAULT_DEMO_DOMAIN,
  DEMO_CLIENT_INFO,
  DEMO_SUBSTITUTE_IPS,
  type DemoClientInfoDefaults,
} from "./demo/fixtures";

export * from "./demo/fixtures";
export * from "./demo/analytics";
export * from "./demo/snapshots";

export interface DemoClientInfoPayload extends DemoClientInfoDefaults {
  connectedProfileId: string | null;
  substituteDomain: string;
  dotDomain: string;
  isServerfull: boolean;
  mode: "serverfull" | "cloudflare";
  isDemoMode: true;
  demoDomain: string;
}

export interface DemoSubstitutePayload {
  ip: string | null;
  ipv6: string | null;
  ipv4List: string[];
  ipv6List: string[];
}

export interface DemoGeoIpPayload {
  success: true;
  ip: string;
  country: string;
  country_code: string;
  region: string;
  city: string;
  timezone: { id: string };
  connection: { org: string };
}

/**
 * Checks whether Demo Mode is enabled via environment configuration (`DEMO_MODE`).
 */
export function isDemoMode(env?: Partial<Env>): boolean {
  const raw = env?.DEMO_MODE;
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "number") return raw === 1;
  if (typeof raw === "string") {
    const normalized = raw.trim().toLowerCase();
    return normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on";
  }
  return false;
}

/**
 * Resolves the canonical hostname displayed throughout Demo Mode endpoints and instructions.
 */
export function getDemoDomain(env?: Partial<Env>): string {
  const raw = (env?.DEMO_DOMAIN ?? "").toString().trim();
  if (!raw) return DEFAULT_DEMO_DOMAIN;
  return raw.replace(/^https?:\/\//i, "").replace(/\/+$/, "") || DEFAULT_DEMO_DOMAIN;
}

/**
 * Builds the canonical `/api/clientinfo` response object for Demo Mode from `DEMO_CLIENT_INFO`.
 */
export function buildDemoClientInfoPayload(
  env: Partial<Env>,
  options: { isServerfull: boolean; connectedProfileId: string | null }
): DemoClientInfoPayload {
  const demoDomain = getDemoDomain(env);
  return {
    ...DEMO_CLIENT_INFO,
    connectedProfileId: options.connectedProfileId,
    substituteDomain: env.SUBSTITUTE_DOMAIN || DEFAULT_SUBSTITUTE_DOMAIN,
    dotDomain: demoDomain,
    isServerfull: options.isServerfull,
    mode: options.isServerfull ? "serverfull" : "cloudflare",
    isDemoMode: true,
    demoDomain,
  };
}

/**
 * Builds the canonical `/api/substitute` response object for Demo Mode from `DEMO_SUBSTITUTE_IPS`.
 */
export function getDemoSubstitutePayload(): DemoSubstitutePayload {
  return {
    ip: DEMO_SUBSTITUTE_IPS.ipv4[0] ?? null,
    ipv6: DEMO_SUBSTITUTE_IPS.ipv6[0] ?? null,
    ipv4List: [...DEMO_SUBSTITUTE_IPS.ipv4],
    ipv6List: [...DEMO_SUBSTITUTE_IPS.ipv6],
  };
}

/**
 * Builds the canonical `/api/geoip` response object for Demo Mode from `DEMO_CLIENT_INFO`.
 */
export function getDemoGeoIpPayload(ip?: string): DemoGeoIpPayload {
  return {
    success: true,
    ip: ip?.trim() || DEMO_CLIENT_INFO.ip,
    country: DEMO_CLIENT_INFO.country,
    country_code: DEMO_CLIENT_INFO.countryCode,
    region: DEMO_CLIENT_INFO.region,
    city: DEMO_CLIENT_INFO.city,
    timezone: { id: DEMO_CLIENT_INFO.timezone },
    connection: { org: DEMO_CLIENT_INFO.asOrganization },
  };
}

/**
 * Builds the canonical `/api/resolve` response object for Demo Mode from `DEMO_SUBSTITUTE_IPS`.
 */
export function getDemoResolvePayload(): { ipv4: string[]; ipv6: string[] } {
  return {
    ipv4: [...DEMO_SUBSTITUTE_IPS.ipv4],
    ipv6: [...DEMO_SUBSTITUTE_IPS.ipv6],
  };
}
