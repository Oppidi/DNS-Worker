---
title: 架構與部署選型
description: 對比 DNS Worker 的 Cloudflare Workers 邊緣無伺服器模式與獨立伺服器 Serverfull 模式在協議支援（UDP 53、DoT 853、DoH）、資料庫後端與運維成本上的差異。
---

**DNS Worker** 可運行於 Cloudflare Workers 無伺服器邊緣環境，也可獨立部署在自有 Linux / Windows 主機或 VPS（Serverfull 模式）上。兩種部署方式共享同一套域名攔截引擎、本地優先分析面板與後量子端到端加密日誌體系，但在網路協議入口與運維方式上各有側重。

## 部署模式對比矩陣

| 特性維度 | ☁️ Cloudflare Workers 邊緣模式 (預設推薦) | 🖥️ 獨立伺服器 / VPS (Serverfull 自建模式) |
|---|---|---|
| **適用特點** | **免伺服器運維，依託 Cloudflare Anycast 網路接入** | 100% 本地資料控制，原生支援路由器 UDP 53 與安卓 DoT |
| **執行平臺** | Cloudflare 全球邊緣節點 | Linux / VPS / macOS / Windows (`Node.js >= 22.5` / `Bun >= 1.4`) |
| **儲存後端** | Cloudflare D1（或 Turso / libSQL） | 原生內建 SQLite (`node:sqlite`) 或 Turso / libSQL |
| **支援協議** | **DoH** (RFC 8484，相容 HTTP/1.1+、HTTP/2 與 HTTP/3) | **UDP 53** (RFC 1035) + **DoT 853** (RFC 7858) + **DoH** (HTTP/1.1+ / HTTP/2 / HTTP/3) |
| **運維開銷** | 無需管理主機系統、防火牆或守護程序 | 需自行維護宿主機系統、TLS 證書與 `systemd` 服務 |
| **路由器 / 內網接入** | 需前置 DoH 轉發客戶端（如 OpenWrt、`cloudflared`、AdGuard Home） | **原生支援 UDP 53**（路由器 DNS 直接填寫伺服器 IP） |
| **安卓原生私密 DNS** | 需配合支援 DoH 的系統版本或客戶端 | **原生支援 DoT 853**（支援 SNI 路由 `<token>.dns.example.com`） |
| **後量子零知識 E2EE** | ✅ NIST FIPS 203 **P256-MLKEM768** + Passkey WebAuthn | ✅ NIST FIPS 203 **P256-MLKEM768** + Passkey WebAuthn |
| **本地優先 Web 儀表盤** | ✅ 瀏覽器端 SQLite WASM + OPFS 0ms 查詢 | ✅ 瀏覽器端 SQLite WASM + OPFS 0ms 查詢 |
| **執行成本** | 相容 Cloudflare 免費配額 | 執行在自有 VPS、小主機或家庭 NAS |

---

## 我該如何選擇？

### ☁️ 選擇 Cloudflare Workers 邊緣模式 (首選推薦)
- 追求**完全省心免維護**，無需為作業系統升級、程序掛掉或網路波動操心；
- 經常跨地域/跨國出行，需要全球 300+ 節點就近接入與極低解析延遲；
- 零硬體成本，完全基於 Cloudflare 免費配額即可穩定執行。

### 🖥️ 選擇獨立伺服器 / VPS 模式 (Serverfull 自建方案)
- 需要為家庭區域網、智慧電視或傳統 IoT 路由器提供原生 UDP 53 無感攔截；
- 希望在 Android 系統設定中直接填入“私密 DNS”域名（853 埠）且不想安裝第三方 App；
- 堅持將所有 DNS 查詢歷史與日誌資料嚴格儲存在自有 NVMe 物理硬碟中。
