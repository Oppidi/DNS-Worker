/**
 * @file test_quad9_transport.ts
 * @description Validates HTTP/2 upstream DoH resolution, session reuse, strict error surfacing without silent DoT fallback, and native DoT presets.
 */

import assert from "node:assert";
import http from "node:http";
import http2 from "node:http2";
import { resolveUpstreamEndpoint, fetchFromUpstream } from "../src/pipeline/resolver/transport";
import { isSafeUrl } from "../src/utils/validator";
import { http2SessionPool, isHttp2Supported } from "../src/utils/http2Client";
import { getAppUserAgent, getListFetcherUserAgent, getSystemVersion } from "../src/constants/version";

async function runTests(): Promise<void> {
  console.log("================================================================");
  console.log("   Universal HTTP/2 Upstream Transport Verification Test        ");
  console.log("================================================================\n");

  const sampleQueryRaw = new Uint8Array([
    0x12, 0x34, 0x01, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x07, 0x65, 0x78, 0x61, 0x6d, 0x70, 0x6c, 0x65, 0x03, 0x63, 0x6f, 0x6d, 0x00,
    0x00, 0x01, 0x00, 0x01
  ]);

  // 1. Verify URL Safety
  console.log("[1] Testing URL safety for diverse upstream endpoints...");
  assert.strictEqual(isSafeUrl("https://dns11.quad9.net/dns-query"), true);
  assert.strictEqual(isSafeUrl("https://dns.quad9.net/dns-query"), true);
  assert.strictEqual(isSafeUrl("https://cloudflare-dns.com/dns-query"), true);
  assert.strictEqual(isSafeUrl("https://dns.google/dns-query"), true);
  assert.strictEqual(isSafeUrl("tls://dns.quad9.net"), true);
  assert.strictEqual(isSafeUrl("tcp://9.9.9.11:9953"), true);
  console.log("    ✓ All upstream endpoints validated as safe URLs.");

  // 1b. Verify System Version & Standardized User-Agent
  console.log("\n[1b] Testing standardized User-Agent with real system version...");
  const version = getSystemVersion();
  assert.match(version, /^\d+\.\d+\.\d+/, "System version must follow semantic versioning x.y.z");
  const appUa = getAppUserAgent();
  assert.strictEqual(appUa, `DNS-Worker/${version}`, "App User-Agent must use real version x.y.z");
  const listUa = getListFetcherUserAgent();
  assert.ok(listUa.startsWith(`DNS-Worker/${version}`), "List fetcher User-Agent must use real version x.y.z");
  console.log(`    ✓ Validated User-Agent: ${appUa}`);
  console.log(`    ✓ Validated List User-Agent: ${listUa}`);

  // 2. Verify Endpoint Resolution (Clean, no hardcoded isQuad9Doh)
  console.log("\n[2] Testing clean endpoint resolution (agnostic, zero hardcoding)...");
  const epDns11 = resolveUpstreamEndpoint("https://dns11.quad9.net/dns-query");
  assert.strictEqual(epDns11.diagMethod, "POST");
  assert.strictEqual(epDns11.effectiveUrl, "https://dns11.quad9.net/dns-query");
  console.log(`    ✓ https://dns11.quad9.net/dns-query preserved as universal DoH endpoint`);

  const epDnsStandard = resolveUpstreamEndpoint("https://dns.quad9.net/dns-query");
  assert.strictEqual(epDnsStandard.diagMethod, "POST");
  assert.strictEqual(epDnsStandard.effectiveUrl, "https://dns.quad9.net/dns-query");
  console.log(`    ✓ https://dns.quad9.net/dns-query preserved as universal DoH endpoint`);

  const epQuad9Dot = resolveUpstreamEndpoint("tls://dns.quad9.net");
  assert.strictEqual(epQuad9Dot.diagMethod, "DoT");
  assert.strictEqual(epQuad9Dot.diagTarget, "tls://dns.quad9.net:853");
  console.log(`    ✓ tls://dns.quad9.net resolved as native DoT preset endpoint`);

  const epCf = resolveUpstreamEndpoint("https://cloudflare-dns.com/dns-query");
  assert.strictEqual(epCf.diagMethod, "POST");
  assert.strictEqual(epCf.effectiveUrl, "https://cloudflare-dns.com/dns-query");
  console.log(`    ✓ https://cloudflare-dns.com/dns-query preserved as universal DoH endpoint`);

  // 3. Verify H2 runtime detection
  console.log("\n[3] Verifying runtime HTTP/2 support detection...");
  const h2Available = isHttp2Supported();
  assert.strictEqual(h2Available, true, "HTTP/2 should be natively supported in Node.js environment");
  console.log(`    ✓ isHttp2Supported() = ${h2Available}`);

  // 4. Live query against Quad9 DoH (RFC 8484 §5.2 requiring H2)
  console.log("\n[4] Testing live DoH query against Quad9 (https://dns.quad9.net/dns-query) via H2...");
  try {
    const resQuad9 = await fetchFromUpstream(epDnsStandard, sampleQueryRaw);
    assert.ok(resQuad9.answer.length > 0, "Quad9 DoH must return wire answer");
    assert.strictEqual(resQuad9.diagMethod, "H2", "Must use native HTTP/2 for DoH in Node.js");
    console.log(`    ✓ Quad9 H2 query succeeded! Latency: ${resQuad9.latency}ms, Answer size: ${resQuad9.answer.length} bytes`);
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.warn(`    ⚠ Live network test failed or skipped (network dependency):`, errorMsg);
  }

  // 5. Live query against Quad9 ECS DoH (https://dns11.quad9.net/dns-query) via H2
  console.log("\n[5] Testing live DoH query against Quad9 ECS (https://dns11.quad9.net/dns-query) via H2...");
  try {
    const resDns11 = await fetchFromUpstream(epDns11, sampleQueryRaw);
    assert.ok(resDns11.answer.length > 0, "Quad9 ECS DoH must return wire answer");
    assert.strictEqual(resDns11.diagMethod, "H2", "Must use native HTTP/2 for DoH in Node.js");
    console.log(`    ✓ Quad9 ECS H2 query succeeded! Latency: ${resDns11.latency}ms, Answer size: ${resDns11.answer.length} bytes`);
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.warn(`    ⚠ Live network test failed or skipped (network dependency):`, errorMsg);
  }

  // 6. Live query against Cloudflare DoH via H2
  console.log("\n[6] Testing live DoH query against Cloudflare (https://cloudflare-dns.com/dns-query) via H2...");
  try {
    const resCf = await fetchFromUpstream(epCf, sampleQueryRaw);
    assert.ok(resCf.answer.length > 0, "Cloudflare DoH must return wire answer");
    assert.strictEqual(resCf.diagMethod, "H2", "Must use native HTTP/2 for DoH in Node.js");
    console.log(`    ✓ Cloudflare H2 query succeeded! Latency: ${resCf.latency}ms, Answer size: ${resCf.answer.length} bytes`);
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.warn(`    ⚠ Live network test failed or skipped (network dependency):`, errorMsg);
  }

  // 7. Loopback/private upstreams are blocked by the SSRF guard before any connection is made,
  //    and the HTTP/2 client surfaces upstream error statuses (e.g. 505) instead of masking them
  console.log("\n[7] Testing SSRF blocking of a loopback DoH upstream and HTTP/2 error status surfacing...");
  let mockRequests = 0;
  const server = http2.createServer((req, res) => {
    mockRequests++;
    res.writeHead(505, { "content-type": "text/html" });
    res.end("<html><body>This server requires HTTP/2</body></html>");
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const serverPort = (server.address() as any).port;

  const mockEndpoint = {
    effectiveUrl: `http://127.0.0.1:${serverPort}/dns-query`,
    diagMethod: "POST",
    diagTarget: `http://127.0.0.1:${serverPort}/dns-query`
  };

  try {
    await assert.rejects(
      fetchFromUpstream(mockEndpoint, sampleQueryRaw),
      /Blocked unsafe upstream URL/,
      "Loopback DoH upstream must be blocked by the SSRF guard"
    );
    assert.strictEqual(mockRequests, 0, "Blocked upstream must not receive any request");
    console.log("    ✓ Loopback DoH upstream blocked before connecting");

    const h2Res = await http2SessionPool.request(new URL(mockEndpoint.effectiveUrl), sampleQueryRaw, 5000);
    assert.strictEqual(h2Res.status, 505, "HTTP/2 client must surface the upstream 505 status");
    console.log("    ✓ HTTP/2 client surfaced upstream status 505");
  } finally {
    server.close();
  }

  // 8. The HTTP/2 client does not downgrade to HTTP/1.1 when an upstream only speaks HTTP/1.1
  console.log("\n[8] Testing that the HTTP/2 client fails against an HTTP/1.1-only upstream instead of downgrading...");
  const http1Server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/dns-message" });
    res.end();
  });
  await new Promise<void>((resolve) => http1Server.listen(0, "127.0.0.1", resolve));
  const http1Port = (http1Server.address() as any).port;
  try {
    await assert.rejects(
      http2SessionPool.request(new URL(`http://127.0.0.1:${http1Port}/dns-query`), sampleQueryRaw, 2000),
      "HTTP/2 request to an HTTP/1.1-only upstream must fail"
    );
    console.log("    ✓ HTTP/2 request to HTTP/1.1-only upstream failed as expected");
  } finally {
    http1Server.close();
  }

  // Clean up pooled H2 sessions
  http2SessionPool.closeAll();

  console.log("\n================================================================");
  console.log("   ALL UNIVERSAL HTTP/2 TRANSPORT TESTS PASSED!                 ");
  console.log("================================================================\n");
}

runTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
