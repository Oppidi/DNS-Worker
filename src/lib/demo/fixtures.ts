/**
 * @file fixtures.ts
 * @description Canonical Demo Mode static fixtures, sample rules, external lists, Access Points, and Passkey specs.
 */

import type { AccessPointDeviceType } from "../../constants/deviceTypes";
import type { ListMetadataStats } from "../../types";

/** Default domain displayed across UI endpoints and instructions when demo mode is active. */
export const DEFAULT_DEMO_DOMAIN = "dns.worker.domain";

/** Canonical demo client identity & location telemetry (Single Source of Truth). */
export interface DemoClientInfoDefaults {
  ip: string;
  country: string;
  countryCode: string;
  region: string;
  city: string;
  timezone: string;
  asn: number;
  asOrganization: string;
}

export const DEMO_CLIENT_INFO: Readonly<DemoClientInfoDefaults> = {
  ip: "203.0.113.42",
  country: "Japan",
  countryCode: "JP",
  region: "Tokyo",
  city: "Tokyo",
  timezone: "Asia/Tokyo",
  asn: 13335,
  asOrganization: "Cloudflare, Inc.",
};

/** Canonical demo substitute domain IPs returned by `/api/substitute` & `/api/resolve`. */
export const DEMO_SUBSTITUTE_IPS: Readonly<{
  ipv4: readonly string[];
  ipv6: readonly string[];
}> = {
  ipv4: ["198.51.100.10", "198.51.100.20"],
  ipv6: ["2001:db8::53", "2001:db8::54"],
};

export interface DemoAccessPointSpec {
  name: string;
  targetProfileRole: "primary" | "office" | "kids" | "unbound";
  deviceType: AccessPointDeviceType;
}

/** Canonical demo Access Point devices across desktop, mobile, tablet, router, NAS, TV, and browser. */
export const DEMO_ACCESS_POINT_SPECS: readonly DemoAccessPointSpec[] = [
  { name: "OpenWrt-Router", targetProfileRole: "primary", deviceType: "openwrt" },
  { name: "MacBook-Pro", targetProfileRole: "primary", deviceType: "macos" },
  { name: "TrueNAS-NAS", targetProfileRole: "office", deviceType: "nas" },
  { name: "Windows-11-Desktop", targetProfileRole: "primary", deviceType: "windows" },
  { name: "iPhone-16", targetProfileRole: "primary", deviceType: "ios" },
  { name: "Pixel-9-Android", targetProfileRole: "primary", deviceType: "android" },
  { name: "Linux-Workstation", targetProfileRole: "office", deviceType: "linux" },
  { name: "Chrome-Browser-Work", targetProfileRole: "office", deviceType: "chrome" },
  { name: "Kids-iPad", targetProfileRole: "kids", deviceType: "ios" },
  { name: "Smart-TV-LivingRoom", targetProfileRole: "unbound", deviceType: "android_tv" },
];

/** Prefix shared by synthetic Passkey credentials seeded for Demo Mode showcase. */
export const DEMO_PASSKEY_PREFIX = "demo-pk-";

/**
 * Returns true if the credential ID belongs to a synthetic Demo Mode Passkey.
 */
export function isDemoPasskeyCredentialId(credentialId?: string | null): boolean {
  return typeof credentialId === "string" && credentialId.startsWith(DEMO_PASSKEY_PREFIX);
}

export interface DemoPasskeySpec {
  idSuffix: string;
  name: string;
  aaguid: string;
  transports: readonly string[];
  algorithm: number;
  signCount: number;
  createdOffsetSec: number;
  lastUsedOffsetSec: number;
}

/**
 * Canonical demo WebAuthn Passkeys showcasing cloud-synced password managers,
 * platform biometrics, and external FIDO2 hardware security keys.
 */
export const DEMO_PASSKEY_SPECS: readonly DemoPasskeySpec[] = [
  {
    idSuffix: "icloud-keychain",
    name: "iCloud Keychain",
    aaguid: "fbfc3007-154e-4ecc-8c0b-6e020557d7bd",
    transports: ["internal", "hybrid"],
    algorithm: -7,
    signCount: 14,
    createdOffsetSec: 21 * 86400,
    lastUsedOffsetSec: 2 * 3600,
  },
  {
    idSuffix: "google-password-manager",
    name: "Google Password Manager",
    aaguid: "ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4",
    transports: ["internal", "hybrid"],
    algorithm: -7,
    signCount: 9,
    createdOffsetSec: 18 * 86400,
    lastUsedOffsetSec: 6 * 3600,
  },
  {
    idSuffix: "windows-hello",
    name: "Windows Hello",
    aaguid: "08987058-cadc-4b81-b6e1-30de50dcbe96",
    transports: ["internal"],
    algorithm: -7,
    signCount: 27,
    createdOffsetSec: 12 * 86400,
    lastUsedOffsetSec: 26 * 3600,
  },
  {
    idSuffix: "yubikey",
    name: "YubiKey",
    aaguid: "2fc0579f-8113-47ea-b116-bb5a8db9202a",
    transports: ["usb", "nfc"],
    algorithm: -7,
    signCount: 5,
    createdOffsetSec: 7 * 86400,
    lastUsedOffsetSec: 4 * 86400,
  },
];

export interface DemoRuleSpec {
  type: "ALLOW" | "BLOCK" | "REDIRECT";
  pattern: string;
  include_subdomains: boolean;
  v_a?: string | null;
  v_aaaa?: string | null;
  v_cname?: string | null;
  v_txt?: string | null;
}

/** Primary demo Custom Rules seeded for the main Profile. */
export const DEMO_PRIMARY_RULES: readonly DemoRuleSpec[] = [
  { type: "BLOCK", pattern: "metrics.icloud-tracker.example", include_subdomains: true },
  { type: "BLOCK", pattern: "ads-sdk.mobile-analytics.example", include_subdomains: true },
  { type: "BLOCK", pattern: "pixel.ad-exchange.example", include_subdomains: false },
  { type: "BLOCK", pattern: "telemetry.smarttv-vendor.example", include_subdomains: true },
  { type: "ALLOW", pattern: "api.github.com", include_subdomains: false },
  { type: "ALLOW", pattern: "cdn.jsdelivr.net", include_subdomains: false },
  { type: "ALLOW", pattern: "ocsp.digicert.com", include_subdomains: false },
  { type: "REDIRECT", pattern: "nas.home.lan", include_subdomains: false, v_a: "192.168.10.50", v_aaaa: "fd00:10::50" },
  { type: "REDIRECT", pattern: "router.home.lan", include_subdomains: false, v_a: "192.168.10.1" },
  { type: "REDIRECT", pattern: "docs.internal.lan", include_subdomains: false, v_cname: `portal.${DEFAULT_DEMO_DOMAIN}` },
  { type: "REDIRECT", pattern: `status.${DEFAULT_DEMO_DOMAIN}`, include_subdomains: false, v_txt: "v=demo1 profile=default" },
];

/** Demo Custom Rules seeded for the Kids Safe companion Profile. */
export const DEMO_KIDS_RULES: readonly DemoRuleSpec[] = [
  { type: "BLOCK", pattern: "gaming-ads.example", include_subdomains: true },
  { type: "ALLOW", pattern: "khanacademy.org", include_subdomains: true },
  { type: "ALLOW", pattern: "wikipedia.org", include_subdomains: true },
];

export interface DemoListSpec {
  url: string;
  enabled: boolean;
  stats: ListMetadataStats;
}

/** Demo External Blocklist subscriptions and pre-synced statistics. */
export const DEMO_EXTERNAL_LISTS: readonly DemoListSpec[] = [
  {
    url: "https://big.oisd.nl",
    enabled: true,
    stats: {
      total_rules: 342810, exact_rules: 12410, subdomain_rules: 329980,
      wildcard_rules: 0, regex_rules: 0, exception_rules: 420,
      rewrite_rules: 0, comment_lines: 1850, unsupported_lines: 0, total_bytes: 7824190,
    },
  },
  {
    url: "https://adguardteam.github.io/HostlistsRegistry/assets/filter_1.txt",
    enabled: true,
    stats: {
      total_rules: 98420, exact_rules: 4120, subdomain_rules: 93800,
      wildcard_rules: 0, regex_rules: 12, exception_rules: 310,
      rewrite_rules: 178, comment_lines: 640, unsupported_lines: 0, total_bytes: 2145300,
    },
  },
  {
    url: "https://raw.githubusercontent.com/hagezi/dns-blocklists/main/adblock/pro.plus.txt",
    enabled: true,
    stats: {
      total_rules: 412650, exact_rules: 8300, subdomain_rules: 403950,
      wildcard_rules: 0, regex_rules: 0, exception_rules: 400,
      rewrite_rules: 0, comment_lines: 1220, unsupported_lines: 0, total_bytes: 9412800,
    },
  },
  {
    url: "https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts",
    enabled: false,
    stats: {
      total_rules: 158900, exact_rules: 158900, subdomain_rules: 0,
      wildcard_rules: 0, regex_rules: 0, exception_rules: 0,
      rewrite_rules: 0, comment_lines: 980, unsupported_lines: 0, total_bytes: 4920100,
    },
  },
];

export interface DemoTrafficTemplate {
  domain: string;
  recordType: string;
  action: "PASS" | "BLOCK" | "REDIRECT";
  reason: string;
  answer: string;
  destCode: string;
  destCountry: string;
  destCity: string;
  destRegion: string;
  destIsp: string;
  destAsn: string;
  latencyMs: number;
}

/** Sample DNS resolution log templates across PASS, BLOCK, and REDIRECT decisions. */
export const DEMO_TRAFFIC_TEMPLATES: readonly DemoTrafficTemplate[] = [
  { domain: "api.github.com", recordType: "A", action: "PASS", reason: "Custom Rule (ALLOW)", answer: "140.82.121.6", destCode: "US", destCountry: "United States", destCity: "San Francisco", destRegion: "California", destIsp: "GitHub, Inc.", destAsn: "AS36459 GitHub, Inc.", latencyMs: 9 },
  { domain: "cloudflare.com", recordType: "HTTPS", action: "PASS", reason: "Upstream Resolved", answer: "104.16.132.229", destCode: "US", destCountry: "United States", destCity: "San Jose", destRegion: "California", destIsp: "Cloudflare, Inc.", destAsn: "AS13335 Cloudflare, Inc.", latencyMs: 4 },
  { domain: "cdn.jsdelivr.net", recordType: "A", action: "PASS", reason: "Custom Rule (ALLOW)", answer: "151.101.1.229", destCode: "JP", destCountry: "Japan", destCity: "Tokyo", destRegion: "Tokyo", destIsp: "Fastly, Inc.", destAsn: "AS54113 Fastly, Inc.", latencyMs: 6 },
  { domain: "www.google.com", recordType: "AAAA", action: "PASS", reason: "Upstream Resolved", answer: "2404:6800:4008:c02::6a", destCode: "SG", destCountry: "Singapore", destCity: "Singapore", destRegion: "Singapore", destIsp: "Google LLC", destAsn: "AS15169 Google LLC", latencyMs: 11 },
  { domain: "apple.com", recordType: "HTTPS", action: "PASS", reason: "Upstream Resolved", answer: "17.253.144.10", destCode: "US", destCountry: "United States", destCity: "Cupertino", destRegion: "California", destIsp: "Apple Inc.", destAsn: "AS714 Apple Inc.", latencyMs: 8 },
  { domain: "registry.npmjs.org", recordType: "A", action: "PASS", reason: "Upstream Resolved", answer: "104.16.25.34", destCode: "DE", destCountry: "Germany", destCity: "Frankfurt", destRegion: "Hesse", destIsp: "Cloudflare, Inc.", destAsn: "AS13335 Cloudflare, Inc.", latencyMs: 14 },
  { domain: "s3.amazonaws.com", recordType: "A", action: "PASS", reason: "Upstream Resolved", answer: "52.217.163.80", destCode: "US", destCountry: "United States", destCity: "Ashburn", destRegion: "Virginia", destIsp: "Amazon.com, Inc.", destAsn: "AS16509 Amazon.com, Inc.", latencyMs: 17 },
  { domain: "assets.ubuntu.com", recordType: "AAAA", action: "PASS", reason: "Upstream Resolved", answer: "2620:2d:4000:1::27", destCode: "GB", destCountry: "United Kingdom", destCity: "London", destRegion: "England", destIsp: "Canonical Group Limited", destAsn: "AS41231 Canonical Group Limited", latencyMs: 19 },
  { domain: "store.steampowered.com", recordType: "A", action: "PASS", reason: "Upstream Resolved", answer: "23.214.172.81", destCode: "CA", destCountry: "Canada", destCity: "Toronto", destRegion: "Ontario", destIsp: "Akamai Technologies, Inc.", destAsn: "AS20940 Akamai International B.V.", latencyMs: 13 },
  { domain: "ovhcloud.com", recordType: "A", action: "PASS", reason: "Upstream Resolved", answer: "198.27.92.1", destCode: "FR", destCountry: "France", destCity: "Paris", destRegion: "Ile-de-France", destIsp: "OVH SAS", destAsn: "AS16276 OVH SAS", latencyMs: 22 },
  { domain: "www.wto.org", recordType: "A", action: "PASS", reason: "Upstream Resolved", answer: "193.242.192.60", destCode: "NL", destCountry: "Netherlands", destCity: "Amsterdam", destRegion: "North Holland", destIsp: "Cloudflare, Inc.", destAsn: "AS13335 Cloudflare, Inc.", latencyMs: 12 },
  { domain: "metrics.icloud-tracker.example", recordType: "A", action: "BLOCK", reason: "Custom Rule (BLOCK)", answer: "0.0.0.0", destCode: "US", destCountry: "United States", destCity: "Ashburn", destRegion: "Virginia", destIsp: "Amazon.com, Inc.", destAsn: "AS16509 Amazon.com, Inc.", latencyMs: 2 },
  { domain: "ads-sdk.mobile-analytics.example", recordType: "HTTPS", action: "BLOCK", reason: "External List (oisd)", answer: "0.0.0.0", destCode: "US", destCountry: "United States", destCity: "San Jose", destRegion: "California", destIsp: "Google LLC", destAsn: "AS15169 Google LLC", latencyMs: 2 },
  { domain: "doubleclick-metrics.example", recordType: "A", action: "BLOCK", reason: "External List (hagezi)", answer: "0.0.0.0", destCode: "DE", destCountry: "Germany", destCity: "Nuremberg", destRegion: "Bavaria", destIsp: "Hetzner Online GmbH", destAsn: "AS24940 Hetzner Online GmbH", latencyMs: 3 },
  { domain: "telemetry.smarttv-vendor.example", recordType: "AAAA", action: "BLOCK", reason: "Custom Rule (BLOCK)", answer: "::", destCode: "JP", destCountry: "Japan", destCity: "Tokyo", destRegion: "Tokyo", destIsp: "Amazon Data Services Japan", destAsn: "AS16509 Amazon.com, Inc.", latencyMs: 2 },
  { domain: "nas.home.lan", recordType: "A", action: "REDIRECT", reason: "Custom Redirect", answer: "192.168.10.50", destCode: "", destCountry: "", destCity: "", destRegion: "", destIsp: "", destAsn: "", latencyMs: 1 },
  { domain: "docs.internal.lan", recordType: "CNAME", action: "REDIRECT", reason: "Custom Redirect", answer: `portal.${DEFAULT_DEMO_DOMAIN}`, destCode: "", destCountry: "", destCity: "", destRegion: "", destIsp: "", destAsn: "", latencyMs: 1 },
];

export interface DemoClientProfile {
  apName: string;
  clientIp: string;
  geoCountry: string;
}

/** Simulated client IP & GeoIP pool mapped to primary demo Access Points. */
export const DEMO_CLIENT_POOL: readonly DemoClientProfile[] = [
  { apName: "MacBook-Pro", clientIp: "203.0.113.10", geoCountry: "JP" },
  { apName: "Windows-11-Desktop", clientIp: "203.0.113.18", geoCountry: "US" },
  { apName: "iPhone-16", clientIp: "203.0.113.24", geoCountry: "JP" },
  { apName: "Pixel-9-Android", clientIp: "198.51.100.88", geoCountry: "SG" },
  { apName: "OpenWrt-Router", clientIp: "2001:db8::42", geoCountry: "US" },
  { apName: "TrueNAS-NAS", clientIp: "198.51.100.120", geoCountry: "DE" },
];
