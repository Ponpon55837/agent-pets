# 成長重設與資料庫整理

設定頁「成長」分頁底部有兩個使用者觸發的維護操作。兩者都走 IPC（`growth-reset`、`db-maintenance-run`），只接受設定面板視窗，並各有最短間隔（重設 5 秒、整理 10 秒）。啟動流程不會做任何 VACUUM。

## 本機資料庫

| 檔案 | 內容 | 保留期 |
|---|---|---|
| `history.sqlite` | 事件、session、每日統計、本機用量 | 預設 90 天（`HistoryStore` 的 `retentionDays`），執行期每 6 小時分批清理 |
| `progression.sqlite` | XP 帳本、每隻寵物進度、session 活動計時 | XP 帳本永久保留；活動計時閒置超過 `ACTIVITY_RETENTION_MS` 後清除 |
| `achievements.sqlite` | 成就事實、計數器、本機 token 去重帳本 | 事實永久保留；token 去重列在保留期＋1 天後壓縮 |

資料庫整理沿用上面三套既有的清理邏輯，沒有另外定義保留期。

## 重設成長資料

清除所有寵物的 XP、連續天數、成就事實與本機 token 帳本。保留 `pets` 表、目前選擇的寵物、歷史紀錄與所有設定。

- 原子性：進度與成就是兩個檔案，沒有跨檔交易。成就端先 `BEGIN IMMEDIATE` 並刪除，在提交前呼叫進度端的重設（自成交易並先提交）。進度端失敗時成就端回復，所以兩邊一起成功或一起不變。僅剩的縫隙是進度端提交後成就端 COMMIT 才失敗；此時回報失敗，重設可重複執行，再按一次即可。
- 防止補回：重設時間（`achievement_metadata.growth_reset_at`）與清除在同一個交易寫入。history reconcile 只取重設時間以後的 session，本機 token 同步忽略重設前的記錄，所以剛清掉的資料不會被歷史或本機 log 補回。
- 廣播：重設後以既有的 `progression-updated`、`achievements-updated` 通知寵物與面板兩個視窗。
- 成就資料庫暫時開不起來時回報 `unavailable`，不做半套。

## 資料庫整理

順序：保留期清理（history 分批、XP 活動計時、本機 token 去重列）→ 對三個資料庫 `PRAGMA optimize`、`VACUUM`、`wal_checkpoint(TRUNCATE)`。

- 有開啟中的交易時拒絕（`busy`）；本機用量掃描進行中時回 `scanning`，請使用者稍後再試。清理過程會讓出事件迴圈，所以 VACUUM 前會再檢查一次掃描狀態。同時只允許一個整理工作。
- 大小：回報整理前後的磁碟占用（資料庫檔 + `-wal` 檔，三個資料庫加總）。選它而不是 `page_count * page_size`，因為 WAL 模式下未 checkpoint 的資料還在 `-wal`，頁數會低估整理前的實際占用。
