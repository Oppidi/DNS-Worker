---
title: 常驻后台服务管理 (systemd & Windows)
description: 使用 dns-worker service 子命令在 Linux systemd（最小权限 CAP_NET_BIND_SERVICE）与 Windows 计划任务中注册、启动、开机自启与运维 DNS Worker 守护进程。
---

**DNS Worker** 内置跨平台服务生命周期管理器（`dns-worker service`），支持将 Serverfull DNS 服务注册为 **Linux systemd 守护进程**或 **Windows 计划任务**，统一管理启停、开机自启与日志追踪。

| 平台 | 服务后端 | 默认执行权限 | 特权端口（53 / 853）机制 | 配置与日志位置 |
| :--- | :--- | :--- | :--- | :--- |
| **Linux** | `systemd` 服务 | 调用 `sudo` 的非 root 用户 | 通过 `CAP_NET_BIND_SERVICE` 授予绑定权限 | `/etc/dns-worker/.env` · `journalctl` |
| **Windows** | Windows 计划任务 (`schtasks`) | 系统管理员权限控制台 | 计划任务系统权限运行 | 默认 `.env` 目录 · 计划任务事件 |

## Linux systemd 服务

### 1. 服务安装与注册

```bash
# 默认以调用 sudo 的当前用户运行（推荐）
sudo dns-worker service install

# 或者指定以 root 或特定用户运行
sudo dns-worker service install --user root
```

:::tip[安全机制提示]
为遵循最小权限原则，服务默认以非 root 用户运行，并通过 Linux 内核特权 `CAP_NET_BIND_SERVICE` 绑定 53 与 853 端口。
:::

### 2. 常用管理命令

```bash
# 查看服务实时状态
sudo dns-worker service status

# 追踪服务实时运行日志 (journalctl)
sudo dns-worker service logs

# 重启服务
sudo dns-worker service restart

# 设置开机自启
sudo dns-worker service enable

# 取消开机自启
sudo dns-worker service disable

# 停止服务
sudo dns-worker service stop

# 彻底卸载服务
sudo dns-worker service uninstall
```

---

## Windows 计划任务

在 Windows 环境下以管理员身份运行 PowerShell 或 CMD：

```powershell
# 安装计划任务并在系统启动时自启
dns-worker service install

# 查看任务状态
dns-worker service status

# 启停管理
dns-worker service start
dns-worker service stop
dns-worker service restart
```
