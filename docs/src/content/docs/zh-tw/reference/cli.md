---
title: CLI 命令手冊
description: dns-worker 命令列完整參考手冊，涵蓋前臺守護程序引數（UDP 53、DoT 853、HTTP 10080、HTTPS 10443）、status 診斷、config 配置管理、reset 出廠重置與 service 後臺服務管理。
---

**DNS Worker CLI（`dns-worker`）** 用於獨立部署模式下啟動解析服務、管理 `/etc/dns-worker/.env` 配置、執行執行狀態診斷與註冊系統級後臺服務。通過 `npm install -g dns-worker`（或 `bun install -g dns-worker`）安裝後即可使用；配置優先順序遵循 **命令列引數 > 環境變數 / `.env` > 內建預設值**。

| 命令 | 用途 | 常用場景 |
| :--- | :--- | :--- |
| `dns-worker [options]` | 在前臺啟動 DNS / HTTP / DoT 服務 | 除錯驗證或容器前臺入口 |
| `dns-worker status` | 檢查埠監聽、證書與 SQLite 連通性 | 排查 UDP 53 / DoT 853 啟動異常 |
| `dns-worker config <subcommand>` | 初始化、檢視或匯出 `.env` 模板 | 管理 Serverfull 配置檔案 |
| `dns-worker reset [--force\|-y]` | 恢復預設配置並重建空資料庫 | 重置環境或指令碼化測試初始化 |
| `sudo dns-worker service <action>` | 管理 Linux `systemd` / Windows 計劃任務 | 生產環境守護程序與開機自啟 |

## 主守護程序

```bash
dns-worker [options]
```

在前臺直接啟動服務。命令列引數擁有最高優先順序，可覆蓋 `.env` 配置：
- `-s, --status`：輸出執行狀態與資料庫健康度檢查
- `-f, --force, -y, --yes`：跳過重置命令的互動式二次確認
- `-p, --port, --http-port <number>`：HTTP 控制面板與 DoH 埠（預設：10080）
- `--https-port <number>`：HTTPS 控制面板與 DoH 埠（預設：10443）
- `--dns-port <number>`：傳統 UDP DNS 埠（預設：53）
- `--dot-port <number>`：加密 DoT 埠（預設：853）
- `--dot-domain <domain>`：對外基準域名（如 `dns.example.com`）
- `-u, --user <username>`：服務執行系統使用者

---

## 狀態與診斷：`status`

```bash
dns-worker status
```

檢查網路埠監聽情況、TLS 證書有效性以及 SQLite 資料庫連通性。

---

## 配置管理：`config`

```bash
# 查看当前激活的配置路径与已加载文件
dns-worker config show

# 输出当前正在生效的 .env 文件绝对路径
dns-worker config path

# 在标准配置目录生成干净的默认 .env 模板
dns-worker config init

# 输出内置的完整配置模板原始内容
dns-worker config template
```

---

## 恢復出廠重置：`reset`

```bash
# 交互式重置（包含二次确认防误触提示）
dns-worker reset

# 自动化/脚本强制重置（跳过确认提示）
dns-worker reset --force
# 或
dns-worker reset -y
```

將系統完全恢復至初始安裝狀態：
- **恢復預設配置**：將標準路徑下的 `.env` 配置檔案強制覆蓋恢復為內建預設模板。
- **清空資料庫**：安全清空並清理 SQLite 資料庫檔案（`*.sqlite`、`*-wal`、`*-shm`）。
- **重構全新架構**：從第 1 項遷移起重新完整執行所有資料庫 Schema 遷移，生成立即可用的全新空白資料庫。
- **二次防誤觸確認**：在終端互動環境下會要求輸入 `yes` 二次確認，防止生產環境誤操作導致資料丟失。

---

## 後臺服務管理：`service`

```bash
# 安装系统服务 (可选 --user <username>)
sudo dns-worker service install [--user <username>]

# 控制服务启停与重启
sudo dns-worker service start
sudo dns-worker service stop
sudo dns-worker service restart

# 开启 / 关闭开机自启
sudo dns-worker service enable
sudo dns-worker service disable

# 实时状态与日志监控
sudo dns-worker service status
sudo dns-worker service logs

# 完全卸载系统服务
sudo dns-worker service uninstall
```
