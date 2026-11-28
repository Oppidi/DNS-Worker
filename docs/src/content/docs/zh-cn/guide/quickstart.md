---
title: 快速上手
description: 快速部署并运行 DNS Worker 的两种方式：通过 Wrangler CLI 一条龙初始化 Cloudflare Workers + D1 边缘实例，或使用 npm/bun 安装 dns-worker CLI 启动本地独立服务（端口 53 / 10080）。
---

**DNS Worker** 提供两种部署路径：**Cloudflare Workers 无服务器边缘模式**（面向免运维的互联网 DoH 接入）以及 **Serverfull 独立服务器模式**（面向需要本地 UDP 53 端口或 Android 原生 DoT 853 的自建主机）。

| 部署方式 | 前置条件 | 核心命令 | 默认服务入口 |
| :--- | :--- | :--- | :--- |
| **Cloudflare Workers** | Cloudflare 账号、Node.js、`wrangler` | `npm run db:setup && npm run db:migrate:prod && npm run deploy` | `https://<worker>.workers.dev` |
| **Serverfull (CLI)** | `Node.js >= 22.5` 或 `Bun >= 1.4` | `npm install -g dns-worker && dns-worker config init && dns-worker` | `http://localhost:10080` · `127.0.0.1:53` |

---

## 方案 1：部署至 Cloudflare Workers（Serverless 边缘模式 / 首选推荐）

免去繁琐的服务器配置与运维，依托 Cloudflare 全球 300+ 节点实现高可用解析。

### 1. 克隆仓库并安装依赖
```bash
git clone https://github.com/Oppidi/DNS-Worker.git
cd DNS-Worker
npm install
```

### 2. 创建 Cloudflare D1 分布式数据库
```bash
# 登录 Cloudflare 账号
npx wrangler login

# 创建专属 D1 数据库
npm run db:setup
```
将控制台输出的 `database_id` 填入项目根目录 `wrangler.toml` 的 `[[d1_databases]]` 中：
```toml
[[d1_databases]]
binding = "DB"
database_name = "dns_worker_db"
database_id = "填写您的_database_id"
```

### 3. 初始化数据表结构并一键部署
```bash
# 1. 向云端 D1 数据库应用初始化数据表结构
npm run db:migrate:prod

# 2. 编译 Web 控制台并一键部署 Worker
npm run deploy
```

部署完成后，您的专属控制面板与 DoH 解析终端即刻上线：`https://<您的Worker名>.workers.dev`（或您绑定的自定义顶级域名）。

---

## 方案 2：独立服务器 / VPS 部署（Serverfull Node.js / Bun 模式）

若您需要内网路由器直接通过 UDP 53 解析，或直接使用 Android 原生私密 DNS（DoT 853 端口）：

```bash
# 1. 全局安装 CLI（支持 npm 或 bun）
npm install -g dns-worker
# 或使用 bun: bun install -g dns-worker

# 2. 初始化持久化数据目录与默认环境变量
dns-worker config init

# 3. 启动 DNS Worker 守护服务（运行于 Node.js >= 22.5 或 Bun >= 1.4）
dns-worker
```

启动后即可访问本地管理面板 `http://localhost:10080` 及经典 UDP DNS `127.0.0.1:53`。

---

## 下一步

- [浏览架构选型与双引擎对比](/DNS-Worker/zh-cn/deployment/matrix/)
- [深入了解 Cloudflare Workers 边缘模式](/DNS-Worker/zh-cn/deployment/cloudflare/)
- [管理接入点、绑定 Profile 与配置各平台客户端](/DNS-Worker/zh-cn/networking/endpoints/)
- [独立服务器 TLS 证书申请与配置](/DNS-Worker/zh-cn/advanced/tls-certs/)
