# UI Phase — Organic Panel Redesign

日期：2026-08-17
來源：`/Users/ponpon55837/Downloads/專案UI改善討論.zip` 內的設計 handoff 內容

## 範圍與判讀

ZIP 內的 `README.md`、HTML 與 CSS 是設計稿／交付規格，不是要直接部署的頁面。此次重構保留既有 Vue、Pinia、Electron IPC、權限 broker、Quota 與歷史資料流程；畫面只使用 store 與 IPC 的真實資料，不引入靜態 mock 狀態。

## 已完成

- Sessions：460px Organic panel、寵物 header、Sessions／Usage／History segmented tabs、inline Permission card、外部-only Permission notice、active/offline session 分組與底部 Quota strip。
- Usage：Codex／Claude provider cards、plan pill、26px display percentage、10px progress track、reset timing 與本機 CLI 登入說明。
- History：三欄摘要、近七日直條圖、Agent distribution、匯出／清除 footer 與本機彙總 disclosure。
- Settings：水平 pill navigation、Notifications／DND／Sound quick toggles、較大的 46×28 switches，以及原有設定分組與操作。
- Setup Wizard：520px Organic modal、工具狀態 tint cards、共用 Button／Card／Icon、偵測／測試／診斷／安裝流程保留。
- Project MCP：560px Organic modal、選擇專案／重新整理／數量同列、專案狀態卡與衝突保護文案保留。
- 共用 UI primitives 與 tokens：Organic 色彩、字級、間距、圓角、陰影與字型 fallback；保留 Desktop Pet 的既有 dark presentation layer。
- Electron panel 尺寸與 store navigation 已對齊：Sessions `460×560`、Settings `460×720`、Setup window `680×520`、MCP window `720×560`。IPC 尺寸參數已按「高度、寬度」驗證。
- 新增 copy 均納入 `zh-TW`／`en-US`，技術狀態與工具名稱維持既有 canonical labels。

## 驗證

| Gate | 結果 |
| --- | --- |
| `pnpm exec vue-tsc --noEmit` | 通過；正式 build 也重新執行 type-check |
| `pnpm test:unit` | 99/100 通過；唯一失敗是既有 `tests/presentation-stdio.test.mts` 在 macOS 嘗試 spawn 不存在的 `node.exe`（`ENOENT`） |
| `pnpm build` | 通過 Vite renderer、Electron main/preload 與 electron-builder DMG；本機未配置有效 Developer ID，因此未簽章 |
| `pnpm audit --prod --audit-level=high` | No known vulnerabilities found |
| `git diff --check` | 通過 |
| Packaged Electron smoke | 以隔離 profile 的真實 renderer 驗證 Organic background、26px quota type、46×28 toggle、3 個 History stats、7 個 chart bars、以及四組 panel/modal 尺寸 |
| secret scan | 變更 diff 未發現 API key、secret、password、private key、access token 或 bearer token |

## 安全與相容性

Inline Permission card 只呼叫既有 `store.decidePermission`，仍由 main process／broker 驗證決策；外部-only request 只顯示 notice，不新增回應能力。Setup 與 Project MCP 仍使用原有 typed IPC 與衝突保護。沒有新增持久化 schema、公開 API contract 或安全邊界。

## 版本狀態

`package.json` 的 `1.0.0` 是使用者既有更新，本次保留、不再升版。此次 UI phase 未新增版本變更。

## 後續確認

功能與安全 gate 已完成；若要進行下一輪版本／發佈調整，請先由使用者確認本 UI phase 的視覺與互動結果。
