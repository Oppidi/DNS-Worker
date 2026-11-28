---
title: 本地优先架构 (Local-First OPFS)
description: DNS Worker 浏览器端 WebAssembly SQLite 与 Origin Private File System (OPFS) 本地日志存储、增量同步及 0ms 多维查询机制说明。
---

**DNS Worker** 在 Web 控制台中采用基于 **WebAssembly SQLite + Origin Private File System（OPFS）** 的本地优先（Local-First）查询架构，将高频日志检索与统计聚合从服务端数据库迁移至浏览器本地 Worker 中执行，兼顾本地交互响应速度与云端 D1/Turso 读取配额控制。

## 传统云端查询与本地优先对比

| 维度 | 传统云端 SQL 直查 | DNS Worker 本地优先架构 (WASM + OPFS) |
| :--- | :--- | :--- |
| **查询执行位置** | 每次筛选/翻页均向云端发请求 | 浏览器专属后台 Web Worker 内本地执行 |
| **持久存储介质** | 仅远端数据库 | 浏览器私有高性能文件系统 **OPFS** 本地副本 |
| **过滤响应延迟** | 依赖网络 RTT 与远端行扫描 | **0ms 本地 SQL 筛选**，多维度图表即时切换 |
| **数据库读取消耗** | 每次交互均消耗 D1 / Turso 行读取配额 | 仅增量拉取新增日志，服务端读取开销显著下降 |

## 核心工作机制

1. **Web Worker 线程隔离**：SQLite WASM 引擎运行在独立后台 Worker 线程中，扫描与聚合上万条解析日志不会阻塞主线程 UI 渲染。
2. **OPFS 持久化本地缓存**：加密与明文解析记录同步落盘至浏览器的 Origin Private File System，刷新或重新打开标签页时可直接复用历史数据集。
3. **增量光标同步与客户端解密**：控制台仅按时间戳游标增量拉取服务端新增日志；对于启用了后量子 E2EE 的账户，密文在客户端 Web Worker 内解密后再写入本地 SQLite，服务端全程不接触明文。

## 常见问题

### 清除浏览器缓存是否会丢失 DNS 查询日志？
不会。服务端数据库（Cloudflare D1、Turso 或 Serverfull SQLite）始终保存保留期限内的持久化记录；清理浏览器 OPFS 后，重新登录控制台即可按留存周期重新增量同步。
