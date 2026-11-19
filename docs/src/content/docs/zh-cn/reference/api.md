---
title: API / 应用程序接口
description: DNS Worker 身份认证、配置文件、过滤列表、日志分析、端到端加密与系统管理的 HTTP / WebSocket 接口参考。
---

DNS Worker 在与控制台 / Worker 相同的域名下提供基于 `/api/*` 的 JSON REST API（以及用于实时查询日志的 WebSocket 数据流）。

## 认证机制、CSRF 与前置拦截

### Bearer Token 与 Refresh Cookie

- **公开接口**无需携带 `Authorization` 请求头：
  - `GET /api/auth/config`、`GET /api/auth/check-username`
  - `POST /api/auth/signup`、`POST /api/auth/prelogin`、`POST /api/auth/login`
  - `POST /api/auth/refresh`、`POST /api/auth/logout`
  - `GET|POST /api/auth/unlock-session`（在锁屏处理器内部直接校验 `Authorization: Bearer <accessToken>`）
  - `POST /api/auth/forgot-password/init`、`POST /api/auth/forgot-password/verify`、`POST /api/auth/forgot-password/reset`
  - `GET /api/clientinfo`、`GET /api/substitute`、`GET /api/resolve`、`GET /api/geoip`、`GET /api/icon/:domain`、`GET /api/presets/*`
- **受保护接口**必须在请求头中携带 `Authorization: Bearer <accessToken>`。令牌缺失或无效时返回 `401 Unauthorized`。
- **刷新流程**：`POST /api/auth/login` 与 `POST /api/auth/signup` 会下发 `HttpOnly` 的 `refresh_token` Cookie，客户端随后可调用 `POST /api/auth/refresh` 换取新的 Access Token。

### 双重提交 CSRF 防护（Double-Submit）

所有已认证的变更类请求（`POST`、`PUT`、`PATCH`、`DELETE`），以及携带 Refresh Cookie 发起的 `POST /api/auth/refresh` 和 `POST /api/auth/logout`，均受双重提交 CSRF 校验保护：

1. 服务端响应会写入 `csrf_token` Cookie。
2. 客户端发起变更请求时，必须在请求头 `X-CSRF-Token` 中携带一致的值。
3. 缺失或不匹配时将返回 `403 Forbidden`（`CSRF validation failed`）。

### 会话锁定（Paused / Locked Sessions）

当通过 `POST /api/auth/lock-session` 锁定会话后，后续已认证 API 请求将返回 `403`（`session_paused`），仅放行以下接口：

- `GET|POST /api/auth/unlock-session`
- `POST /api/auth/refresh`
- `POST /api/auth/logout`
- `PATCH /api/account/me`（仅限修改 `locale` 语言字段）

### 就绪检查、配额门控与常见状态码

| 状态码 | 含义 | 说明 |
| --- | --- | --- |
| `400` | Bad Request | JSON 请求体格式错误、缺少必填参数或字段校验未通过 |
| `401` | Unauthorized | 缺少 Bearer Token，或会话已过期 / 被吊销 |
| `403` | Forbidden | CSRF 校验失败、`session_paused` 锁定中、缺少二次高危认证，或非管理员调用 `/api/admin/*` |
| `503` | Service Unavailable | `error: "configuration_error"`（数据库或 `JWT_SECRET` 未就绪）或 `error: "database_quota_exceeded"`（Turso 读取配额耗尽；此时 DoH 故障开放解析仍保持可用） |

---

## 快速示例（`curl`）

```bash
# 1. 登录并保存 Cookie（包含 refresh_token 与 csrf_token）
curl -s -c cookies.txt -X POST https://dns.example.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"your-password"}'

# 从 cookies.txt 提取 CSRF Token，并将登录响应中的 accessToken 赋值给 ACCESS_TOKEN
CSRF=$(awk '$6=="csrf_token"{print $7}' cookies.txt)

# 2. 获取配置文件列表
curl -s -b cookies.txt https://dns.example.com/api/profiles \
  -H "Authorization: Bearer $ACCESS_TOKEN"

# 3. 测试指定配置文件的域名规则匹配（变更类请求必须携带 X-CSRF-Token）
curl -s -b cookies.txt -X POST https://dns.example.com/api/profiles/<profileId>/test \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "X-CSRF-Token: $CSRF" \
  -H "Content-Type: application/json" \
  -d '{"domain":"ads.example.com","type":"A"}'
```

---

## 身份认证（`/api/auth/*`）

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| `GET` | `/api/auth/config` | Public | 返回公开认证配置（是否开放注册、Turnstile Site Key、运行模式标识等）。 |
| `GET` | `/api/auth/check-username?username=...` | Public | 注册前检查用户名是否可用及密码策略元信息。 |
| `POST` | `/api/auth/signup` | Public | 注册新账户并签发 Access / Refresh Token。 |
| `POST` | `/api/auth/prelogin` | Public | 查询目标用户的登录方式（Passkey、MFA、无密码登录状态等）。 |
| `POST` | `/api/auth/login` | Public | 使用密码、Passkey 断言或 TOTP / MFA 完成登录并写入会话 Cookie。 |
| `POST` | `/api/auth/refresh` | Cookie + CSRF | 轮换 `refresh_token` Cookie 并返回新的短期 Access Token。 |
| `POST` | `/api/auth/logout` | Cookie + CSRF | 注销当前会话并清理认证 Cookie。 |
| `GET` | `/api/auth/unlock-session` | Bearer | 获取当前会话锁定状态及可用解锁方式（PIN / Passkey / 密码）。 |
| `POST` | `/api/auth/unlock-session` | Bearer | 使用 PIN、Passkey 或密码解锁已暂停的会话。 |
| `POST` | `/api/auth/lock-session` | Bearer + CSRF | 将当前会话标记为锁定（Paused）状态。 |
| `POST` | `/api/auth/forgot-password/init` | Public | 初始化找回密码流程。 |
| `POST` | `/api/auth/forgot-password/verify` | Public | 校验找回密码恢复密钥或挑战信息。 |
| `POST` | `/api/auth/forgot-password/reset` | Public | 完成密码重置并更新相关凭据状态。 |

---

## 系统与公共工具（`/api/*`）

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| `GET` | `/api/clientinfo` | Public | 返回探测到的客户端 IP 与请求网络信息。 |
| `GET` | `/api/substitute` | Public | 返回部署元信息、运行模式（`serverfull` 或 Worker）及版本号。 |
| `GET` | `/api/presets/upstreams` | Public | 获取内置上游 DoH/DoT 解析器预设列表。 |
| `GET` | `/api/presets/filters` | Public | 获取预设过滤规则列表 URL 与分类。 |
| `GET` | `/api/presets/ech-fronting-domains` | Public | 获取预设 ECH / Fronting 域名列表。 |
| `GET` | `/api/icon/:domain` | Public | 代理获取目标域名的站点图标（Favicon）。 |
| `GET` | `/api/geoip?ip=...` | Public | 查询指定 IP 的 GeoIP 地理位置与 ASN 信息。 |
| `GET` | `/api/resolve?name=...` | Public | 执行 DNS 记录解析查询（支持 `name` 或 `domain` 查询参数）。 |

---

## 账户与安全（`/api/account/*`）

### 个人资料、审计日志与会话管理

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| `GET` | `/api/account/me` | Bearer | 获取当前账户信息、角色、偏好设置（`locale`）及安全状态摘要。 |
| `PATCH` | `/api/account/me` | Bearer + CSRF | 更新账户偏好设置（如 `locale`；锁屏状态下仅允许更新 `locale`）。 |
| `DELETE` | `/api/account/me` | Bearer + CSRF | 注销并删除当前账户（需先通过高危二次认证 Step-up Reauth）。 |
| `POST` | `/api/account/delete` | Bearer + CSRF | 删除账户的备选 POST 接口（需 Step-up Reauth）。 |
| `DELETE` | `/api/account/logs` | Bearer + CSRF | 清空当前用户旗下所有配置文件的 DNS 查询日志。 |
| `GET` | `/api/account/activity?limit=&before=` | Bearer | 分页查询账户安全审计事件记录。 |
| `GET` | `/api/account/sessions` | Bearer | 列出当前账户所有活跃会话。 |
| `DELETE` | `/api/account/sessions/others` | Bearer + CSRF | 踢出除当前会话外的所有其他会话。 |
| `DELETE` | `/api/account/sessions/:id` | Bearer + CSRF | 按会话 ID 注销指定会话。 |

### 凭据、MFA、Passkeys 与恢复密钥

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| `POST` | `/api/account/password` | Bearer + CSRF | 修改账户登录密码（需 Step-up Reauth）。 |
| `POST` | `/api/account/migrate-password` | Bearer + CSRF | 迁移或升级密码哈希版本。 |
| `POST` | `/api/account/pin` | Bearer + CSRF | 设置或更新会话快速锁屏 PIN 码。 |
| `DELETE` | `/api/account/pin` | Bearer + CSRF | 移除会话锁屏 PIN 码。 |
| `POST` | `/api/account/recovery-keys/rotate` | Bearer + CSRF | 轮换并生成新的一次性恢复密钥，旧密钥随即失效。 |
| `GET` | `/api/account/totp/setup` | Bearer | 生成 TOTP 密钥及 `otpauth://` 配置 URI。 |
| `POST` | `/api/account/totp/confirm` | Bearer + CSRF | 校验动态验证码并正式启用 TOTP。 |
| `POST` | `/api/account/totp/test` | Bearer + CSRF | 测试当前输入的 TOTP 验证码是否有效。 |
| `PATCH` | `/api/account/totp/settings` | Bearer + CSRF | 更新 MFA 与无密码登录开关（与 `/api/account/mfa/settings` 共用处理逻辑）。 |
| `DELETE` | `/api/account/totp` | Bearer + CSRF | 关闭并解除当前账户的 TOTP 两步验证。 |
| `PATCH` | `/api/account/mfa/settings` | Bearer + CSRF | 更新 MFA / 无密码登录安全策略设置。 |
| `GET` | `/api/account/passkeys` | Bearer | 列出已绑定的 WebAuthn Passkeys。 |
| `POST` | `/api/account/passkeys/auth-options` | Bearer + CSRF | 下发用于二次校验或测试的 WebAuthn 认证挑战选项。 |
| `POST` | `/api/account/passkeys/test` | Bearer + CSRF | 验证 Passkey 断言（不修改凭据）。 |
| `POST` | `/api/account/passkeys/register/options` | Bearer + CSRF | 下发注册新 Passkey 所需的 WebAuthn 注册选项。 |
| `POST` | `/api/account/passkeys/register/verify` | Bearer + CSRF | 校验新 Passkey 注册凭据并保存。 |
| `PATCH` | `/api/account/passkeys/:id` | Bearer + CSRF | 重命名已绑定的 Passkey。 |
| `DELETE` | `/api/account/passkeys/:id` | Bearer + CSRF | 删除已绑定的 Passkey。 |

### 用户级过滤列表与账户 E2EE

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| `GET` | `/api/account/user-lists` | Bearer | 获取账户级过滤列表（自动继承至名下所有配置文件）。 |
| `POST` | `/api/account/user-lists` | Bearer + CSRF | 新增用户级过滤列表。 |
| `PATCH` | `/api/account/user-lists/:id` | Bearer + CSRF | 更新用户级过滤列表状态（如启用 / 停用）。 |
| `DELETE` | `/api/account/user-lists/:id` | Bearer + CSRF | 删除用户级过滤列表。 |
| `GET` | `/api/account/e2ee/status` | Bearer | 查询账户级 E2EE 状态与密钥封装情况。 |
| `GET` | `/api/account/e2ee/wrapped-key` | Bearer | 获取使用密码 / Passkey PRF 封装的数据加密密钥（DEK）。 |
| `GET` | `/api/account/e2ee/recovery-wrapped-key` | Bearer | 获取使用恢复密钥封装的 DEK。 |
| `POST` | `/api/account/e2ee/init` | Bearer + CSRF | 初始化账户 E2EE 封装密钥。 |
| `POST` | `/api/account/e2ee/wrap` | Bearer + CSRF | 追加保存 DEK 的新封装副本（例如绑定新 Passkey PRF 时）。 |
| `POST` | `/api/account/e2ee/wrap-recovery` | Bearer + CSRF | 保存由恢复密钥封装的 DEK 副本。 |
| `POST` | `/api/account/e2ee/enable` | Bearer + CSRF | 在账户上启用 E2EE 加密模式。 |
| `DELETE` | `/api/account/e2ee` | Bearer + CSRF | 停用账户 E2EE（传入 `?purge=true` 可一并清理密文数据）。 |

---

## 配置文件（`/api/profiles/*`）

### 核心配置、参数与测试

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| `GET` | `/api/profiles` | Bearer | 列出当前用户拥有的所有 DNS 配置文件。 |
| `POST` | `/api/profiles` | Bearer + CSRF | 创建新的 DNS 配置文件并生成默认 DoH 密钥。 |
| `GET` | `/api/profiles/:id` | Bearer | 获取指定配置文件的完整配置详情。 |
| `PATCH` | `/api/profiles/:id` | Bearer + CSRF | 更新配置文件基本信息（如名称）。 |
| `DELETE` | `/api/profiles/:id` | Bearer + CSRF | 删除配置文件及其关联的规则、列表与日志。 |
| `POST` | `/api/profiles/:id/rotate_key` | Bearer + CSRF | 轮换配置文件主 DoH 接入密钥（`/:key`）。 |
| `PATCH` | `/api/profiles/:id/settings` | Bearer + CSRF | 更新解析器高级设置（上游 DoH/DoT、ECS、ECH、日志隐私与缓存选项等）。 |
| `POST` | `/api/profiles/:id/test` | Bearer + CSRF | 模拟测试 `{ "domain": "...", "type": "A" }` 的规则与列表命中结果（`domain` 最长 253 字符，`type` 默认为 `A`）。 |

### 接入点（Access Points）

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| `GET` | `/api/profiles/:id/access_points` | Bearer | 列出配置文件下按设备/场景划分的独立 DoH 接入点。 |
| `POST` | `/api/profiles/:id/access_points` | Bearer + CSRF | 创建新的命名接入点令牌，用于在日志中识别设备来源。 |
| `POST` | `/api/profiles/:id/access_points/:apId/rotate_token` | Bearer + CSRF | 轮换指定接入点的 DoH 令牌。 |
| `PATCH` | `/api/profiles/:id/access_points/:apId` | Bearer + CSRF | 更新接入点名称或启用状态。 |
| `DELETE` | `/api/profiles/:id/access_points/:apId` | Bearer + CSRF | 删除指定接入点。 |

### 自定义规则

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| `GET` | `/api/profiles/:id/rules` | Bearer | 列出配置文件的放行、拦截与重写规则。 |
| `POST` | `/api/profiles/:id/rules` | Bearer + CSRF | 新增单条规则或批量导入多条规则。 |
| `PUT` | `/api/profiles/:id/rules` | Bearer + CSRF | 覆盖或更新配置文件下的自定义规则。 |
| `DELETE` | `/api/profiles/:id/rules` | Bearer + CSRF | 删除一条或多条自定义规则。 |

### 过滤列表

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| `GET` | `/api/profiles/:id/lists` | Bearer | 获取配置文件关联的过滤列表（含配置文件级、用户级 `User` 与系统级 `System` 标签）。 |
| `GET` | `/api/profiles/:id/lists/sync-status` | Bearer | 查询各过滤列表的最近同步时间、规则条目数及异常状态。 |
| `GET` | `/api/profiles/:id/lists/:listId/check?domain=...` | Bearer | 检查指定域名是否命中该过滤列表。 |
| `POST` | `/api/profiles/:id/lists` | Bearer + CSRF | 向配置文件添加单个或批量外部过滤列表 URL。 |
| `PATCH` | `/api/profiles/:id/lists/:listId` | Bearer + CSRF | 启用、停用或修改过滤列表挂载配置。 |
| `POST` | `/api/profiles/:id/lists/sync` | Bearer + CSRF | 立即同步该配置文件下的所有可用过滤列表。 |
| `POST` | `/api/profiles/:id/lists/:listId/sync` | Bearer + CSRF | 立即同步单个过滤列表。 |
| `DELETE` | `/api/profiles/:id/lists/:listId` | Bearer + CSRF | 从配置文件移除配置文件级过滤列表。 |

### 查询日志、实时推送与统计分析

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| `GET` | `/api/profiles/:id/logs` | Bearer | 分页检索 DNS 查询日志（支持状态、域名、客户端、时间区间过滤）。 |
| `GET` | `/api/profiles/:id/logs/export` | Bearer | 导出配置文件的查询日志。 |
| `GET` | `/api/profiles/:id/logs/:logId` | Bearer | 查询单条日志记录详情。 |
| `DELETE` | `/api/profiles/:id/logs` | Bearer + CSRF | 清空该配置文件下存储的查询日志。 |
| `POST` | `/api/profiles/:id/logs/ws-ticket` | Bearer + CSRF | 签发一次性短期 Ticket，用于建立实时日志 WebSocket 连接。 |
| `GET` (WS) | `/api/profiles/:id/logs/ws` | Ticket | WebSocket 升级端点，用于实时接收 DNS 查询事件流。 |
| `GET` | `/api/profiles/:id/analytics` | Bearer | 获取配置文件综合统计分析概览。 |
| `GET` | `/api/profiles/:id/analytics/summary` | Bearer | 获取请求总数、拦截量、缓存命中及响应延迟汇总。 |
| `GET` | `/api/profiles/:id/analytics/trend` | Bearer | 获取按时间分桶的查询趋势与拦截率数据。 |
| `GET` | `/api/profiles/:id/analytics/top_allowed` | Bearer | 获取最常放行的域名排行榜。 |
| `GET` | `/api/profiles/:id/analytics/top_blocked` | Bearer | 获取最常拦截的域名排行榜。 |
| `GET` | `/api/profiles/:id/analytics/clients` | Bearer | 按客户端 IP / 接入点统计查询分布。 |
| `GET` | `/api/profiles/:id/analytics/destinations` | Bearer | 按目标国家 / GeoIP 统计流量分布。 |
| `GET` | `/api/profiles/:id/analytics/isps` | Bearer | 按目标 ASN / ISP 运营商统计查询分布。 |

### 配置文件级 E2EE

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| `GET` | `/api/profiles/:id/e2ee/status` | Bearer | 查询该配置文件是否已启用独立 E2EE。 |
| `GET` | `/api/profiles/:id/e2ee/wrapped-key` | Bearer | 获取该配置文件已封装的加密密钥。 |
| `POST` | `/api/profiles/:id/e2ee/init` | Bearer + CSRF | 初始化配置文件级 E2EE 密钥。 |
| `POST` | `/api/profiles/:id/e2ee/wrap` | Bearer + CSRF | 更新或追加配置文件密钥封装副本。 |
| `DELETE` | `/api/profiles/:id/e2ee` | Bearer + CSRF | 停用配置文件级 E2EE。 |

---

## 系统管理（`/api/admin/*`）

所有 `/api/admin/*` 接口均要求当前已认证用户具备 `role === 'admin'` 权限，否则返回 `403 Forbidden`。

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| `GET` | `/api/admin/users` | Admin | 列出所有已注册用户及其配额使用情况。 |
| `POST` | `/api/admin/users` | Admin + CSRF | 以管理员身份创建新用户账户。 |
| `DELETE` | `/api/admin/users/:id` | Admin + CSRF | 删除指定用户账户及其名下资源。 |
| `GET` | `/api/admin/settings` | Admin | 获取全局系统设置（Turnstile、注册开关、配额限制等）。 |
| `PATCH` | `/api/admin/settings` | Admin + CSRF | 更新全局系统设置。 |
| `GET` | `/api/admin/database` | Admin | 检查数据库驱动类型、迁移状态、Schema 就绪情况及运行模式（`serverfull` 或 Worker）。 |
| `POST` | `/api/admin/database/migrate` | Admin + CSRF | 执行待处理的数据库 Schema 迁移。 |
| `GET` | `/api/admin/distribute-filter` | Admin | 列出当前生效的系统级下发过滤列表。 |
| `POST` | `/api/admin/distribute-filter` | Admin + CSRF | 下发系统级过滤列表至全局配置（标记为 `System`）。 |
| `DELETE` | `/api/admin/distribute-filter` | Admin + CSRF | 撤销已下发的系统级过滤列表。 |
| `POST` | `/api/admin/distribute-filter/revoke` | Admin + CSRF | 撤销系统级过滤列表的备选 POST 接口。 |
