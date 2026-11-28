---
title: Local-First Architecture (OPFS)
description: How DNS Worker runs WebAssembly SQLite inside a Web Worker backed by Origin Private File System (OPFS) for 0ms local log queries and incremental sync.
---

**DNS Worker** implements a **Local-First** analytics architecture in its Web Dashboard using an in-browser **WebAssembly SQLite engine backed by the Origin Private File System (OPFS)**. High-frequency log filtering and chart aggregations execute locally inside a dedicated Web Worker rather than hitting the remote database on every filter change.

## Cloud Querying vs. Local-First OPFS

| Dimension | Traditional Cloud-Only Querying | DNS Worker Local-First (WASM + OPFS) |
| :--- | :--- | :--- |
| **Execution Location** | Round-trip SQL query on every UI filter | Dedicated in-browser Web Worker |
| **Local Persistence** | None (re-fetched per session) | Browser **Origin Private File System (OPFS)** |
| **Filter Latency** | Bounded by WAN RTT and DB scan time | **0ms local SQL queries** across tens of thousands of logs |
| **Database Read Quota** | Consumed on every chart toggle or scroll | Minimized via cursor-based incremental delta sync |

## Core Mechanisms

1. **Worker-Thread Isolation**: SQLite WASM executes off the main UI thread so heavy multi-dimensional aggregations (client IP, status code, block reason, destination country) never stall scrolling or charts.
2. **OPFS Local Persistence**: Synced query records persist in the browser's private filesystem across reloads.
3. **Incremental Delta Sync & Client-Side Decryption**: The dashboard fetches only newly recorded entries since the latest synced timestamp; when post-quantum E2EE is enabled, ciphertexts are decrypted locally in the client Web Worker before indexing.

## Frequently Asked Questions

### Does clearing browser site data permanently erase DNS logs?
No. Your backend database (Cloudflare D1, Turso, or Serverfull SQLite) remains the persistent source of truth within your configured log retention window; logging back in re-syncs retained logs into OPFS.
