---
title: Architecture & Comparison Matrix
description: Feature comparison between DNS Worker's Cloudflare Workers Edge (Serverless) mode and standalone Serverfull mode across DNS protocols (UDP 53, DoT 853, DoH), storage backends, and operations.
---

**DNS Worker** can be deployed serverless on Cloudflare Workers or standalone (Serverfull) on your own Linux/Windows host or VPS. Both modes share the same domain-blocking engine, local-first dashboard, and post-quantum encrypted audit logging, while differing in transport listeners and operational ownership.

## Deployment Mode Comparison Matrix

| Feature / Dimension | ☁️ Cloudflare Workers Edge (Recommended) | 🖥️ Standalone Server / VPS (Serverfull) |
|---|---|---|
| **Primary Advantage** | **Zero server maintenance** via Cloudflare Anycast | Complete local data control, native UDP 53 & Android DoT 853 |
| **Runtime Platform** | Cloudflare Global Edge Network | Linux / VPS / macOS / Windows (`Node.js >= 22.5` / `Bun >= 1.4`) |
| **Storage Backend** | Cloudflare D1 (or Turso / libSQL) | Native SQLite (`node:sqlite`) or Turso / libSQL |
| **Supported Protocols** | **DoH** (RFC 8484, HTTP/1.1+, HTTP/2, and HTTP/3) | **UDP 53** (RFC 1035) + **DoT 853** (RFC 7858) + **DoH** (HTTP/1.1+, HTTP/2, HTTP/3) |
| **Maintenance Overhead** | No OS patching, firewalls, or daemon management | Self-managed OS, TLS certificates, and `systemd` service |
| **Router / LAN Integration** | Forward via DoH client (`cloudflared`, AdGuard Home, OpenWrt) | **Direct UDP 53** (point router DNS directly to host IP) |
| **Android Private DNS** | Supported via DoH clients or compatible OS releases | **Native DoT 853** with SNI routing (`<token>.dns.example.com`) |
| **Post-Quantum Zero-Knowledge E2EE** | ✅ NIST FIPS 203 **P256-MLKEM768** + Passkey WebAuthn | ✅ NIST FIPS 203 **P256-MLKEM768** + Passkey WebAuthn |
| **Local-First Web Dashboard** | ✅ In-browser SQLite WASM + OPFS 0ms queries | ✅ In-browser SQLite WASM + OPFS 0ms queries |
| **Cost & Infrastructure** | Fits Cloudflare free tier quotas | Runs on existing VPS, mini-PC, or home NAS |

---

## Which One Should You Choose?

### ☁️ Choose Cloudflare Workers Edge (Primary / Recommended)
- You want a **maintenance-free** protective DNS resolver that scales automatically;
- You travel frequently or need minimal DNS latency from 300+ locations worldwide;
- You prefer not to manage Linux server daemons, firewalls, or SSL renewals manually;
- You want free tier deployment on world-class global infrastructure.

### 🖥️ Choose Standalone Server / VPS (Serverfull Alternative)
- You want to configure network-wide ad blocking for routers and smart TVs via classic UDP 53;
- You want to use Android's built-in "Private DNS" setting on port 853 without third-party apps;
- You prefer keeping 100% of query logs and SQLite files on your private NVMe storage.
