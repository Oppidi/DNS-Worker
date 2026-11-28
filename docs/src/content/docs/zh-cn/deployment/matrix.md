---
title: 架构与部署选型
description: 对比 DNS Worker 的 Cloudflare Workers 边缘无服务器模式与独立服务器 Serverfull 模式在协议支持（UDP 53、DoT 853、DoH）、数据库后端与运维成本上的差异。
---

**DNS Worker** 可运行于 Cloudflare Workers 无服务器边缘环境，也可独立部署在自有 Linux / Windows 主机或 VPS（Serverfull 模式）上。两种部署方式共享同一套域名拦截引擎、本地优先分析面板与后量子端到端加密日志体系，但在网络协议入口与运维方式上各有侧重。

## 部署模式对比矩阵

| 特性维度 | ☁️ Cloudflare Workers 边缘模式 (默认推荐) | 🖥️ 独立服务器 / VPS (Serverfull 自建模式) |
|---|---|---|
| **适用特点** | **免服务器运维，依托 Cloudflare Anycast 网络接入** | 100% 本地数据控制，原生支持路由器 UDP 53 与安卓 DoT |
| **运行平台** | Cloudflare 全球边缘节点 | Linux / VPS / macOS / Windows (`Node.js >= 22.5` / `Bun >= 1.4`) |
| **存储后端** | Cloudflare D1（或 Turso / libSQL） | 原生内置 SQLite (`node:sqlite`) 或 Turso / libSQL |
| **支持协议** | **DoH** (RFC 8484，兼容 HTTP/1.1+、HTTP/2 与 HTTP/3) | **UDP 53** (RFC 1035) + **DoT 853** (RFC 7858) + **DoH** (HTTP/1.1+ / HTTP/2 / HTTP/3) |
| **运维开销** | 无需管理主机系统、防火墙或守护进程 | 需自行维护宿主机系统、TLS 证书与 `systemd` 服务 |
| **路由器 / 内网接入** | 需前置 DoH 转发客户端（如 OpenWrt、`cloudflared`、AdGuard Home） | **原生支持 UDP 53**（路由器 DNS 直接填写服务器 IP） |
| **安卓原生私密 DNS** | 需配合支持 DoH 的系统版本或客户端 | **原生支持 DoT 853**（支持 SNI 路由 `<token>.dns.example.com`） |
| **后量子零知识 E2EE** | ✅ NIST FIPS 203 **P256-MLKEM768** + Passkey WebAuthn | ✅ NIST FIPS 203 **P256-MLKEM768** + Passkey WebAuthn |
| **本地优先 Web 仪表盘** | ✅ 浏览器端 SQLite WASM + OPFS 0ms 查询 | ✅ 浏览器端 SQLite WASM + OPFS 0ms 查询 |
| **运行成本** | 兼容 Cloudflare 免费配额 | 运行在自有 VPS、小主机或家庭 NAS |

---

## 我该如何选择？

### ☁️ 选择 Cloudflare Workers 边缘模式 (首选推荐)
- 追求**完全省心免维护**，无需为操作系统升级、进程挂掉或网络波动操心；
- 经常跨地域/跨国出行，需要全球 300+ 节点就近接入与极低解析延迟；
- 零硬件成本，完全基于 Cloudflare 免费配额即可稳定运行。

### 🖥️ 选择独立服务器 / VPS 模式 (Serverfull 自建方案)
- 需要为家庭局域网、智能电视或传统 IoT 路由器提供原生 UDP 53 无感拦截；
- 希望在 Android 系统设置中直接填入“私密 DNS”域名（853 端口）且不想安装第三方 App；
- 坚持将所有 DNS 查询历史与日志数据严格保存在自有 NVMe 物理硬盘中。
