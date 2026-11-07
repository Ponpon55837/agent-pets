# 不碰 Keychain 與正式版資料的 e2e

自動化測試不能觸發 macOS 鑰匙圈提示，也不能動到你日常使用的 Agent Pets。

1. 建置：`pnpm exec vite build`
2. 啟動隔離版本：`node scripts/e2e-isolated-electron.mjs`
   - 使用全新的暫時 HOME 與 userData。
   - 在任何 App 程式碼執行前就安裝假的 `safeStorage`，所以不會讀寫鑰匙圈。
3. 避免和正式版搶埠：開發版可用環境變數改埠，打包版一律忽略這些變數。

   | 變數 | 預設 |
   | --- | --- |
   | `AGENT_PETS_EVENT_PORT` | 17373 |
   | `AGENT_PETS_PERMISSION_PORT` | 17374 |
   | `AGENT_PETS_PRESENTATION_PORT` | 17375 |

   只接受 1024–65535 的整數。安裝好的 hook 腳本仍然送到預設埠，所以要驗證真實 hook 時請關閉正式版。

單元測試（`pnpm test:unit`）完全不啟動 Electron。想縮短迭代可用 `pnpm test:unit:watch`，或
`node --test --experimental-strip-types tests/<file>.test.mts --test-name-pattern "<名稱>"`。
