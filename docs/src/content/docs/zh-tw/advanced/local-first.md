---
title: 本地優先架構 (Local-First OPFS)
description: DNS Worker 瀏覽器端 WebAssembly SQLite 與 Origin Private File System (OPFS) 本地日誌儲存、增量同步及 0ms 多維查詢機制說明。
---

**DNS Worker** 在 Web 控制台中採用基於 **WebAssembly SQLite + Origin Private File System（OPFS）** 的本地優先（Local-First）查詢架構，將高頻日誌檢索與統計聚合從服務端資料庫遷移至瀏覽器本地 Worker 中執行，兼顧本地互動響應速度與雲端 D1/Turso 讀取配額控制。

## 傳統雲端查詢與本地優先對比

| 維度 | 傳統雲端 SQL 直查 | DNS Worker 本地優先架構 (WASM + OPFS) |
| :--- | :--- | :--- |
| **查詢執行位置** | 每次篩選/翻頁均向雲端發請求 | 瀏覽器專屬後臺 Web Worker 內本地執行 |
| **持久儲存介質** | 僅遠端資料庫 | 瀏覽器私有高效能檔案系統 **OPFS** 本地副本 |
| **過濾響應延遲** | 依賴網路 RTT 與遠端行掃描 | **0ms 本地 SQL 篩選**，多維度圖表即時切換 |
| **資料庫讀取消耗** | 每次互動均消耗 D1 / Turso 行讀取配額 | 僅增量拉取新增日誌，服務端讀取開銷顯著下降 |

## 核心工作機制

1. **Web Worker 執行緒隔離**：SQLite WASM 引擎執行在獨立後臺 Worker 執行緒中，掃描與聚合上萬條解析日誌不會阻塞主執行緒 UI 渲染。
2. **OPFS 持久化本地快取**：加密與明文解析記錄同步落盤至瀏覽器的 Origin Private File System，重新整理或重新開啟標籤頁時可直接複用歷史資料集。
3. **增量游標同步與客戶端解密**：控制台僅按時間戳游標增量拉取服務端新增日誌；對於啟用了後量子 E2EE 的賬戶，密文在客戶端 Web Worker 內解密後再寫入本地 SQLite，服務端全程不接觸明文。

## 常見問題

### 清除瀏覽器快取是否會丟失 DNS 查詢日誌？
不會。服務端資料庫（Cloudflare D1、Turso 或 Serverfull SQLite）始終儲存保留期限內的持久化記錄；清理瀏覽器 OPFS 後，重新登入控制台即可按留存週期重新增量同步。
