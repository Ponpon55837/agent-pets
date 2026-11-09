# Sprite 圖集規格單一來源與寵物包 behaviorManifest

## 範圍

- 新增 `src/types/pet-atlas.ts`：格子尺寸、欄列數、v1/v2 列數、上限、列名、固定動作表（列號與每格時長）、behaviorManifest 上下限，以及 `resolvePetMotion`。
- 主程序 `electron/pet-sprite-validation.ts`、`pet-behavior-manifest.ts`、`pet-import.ts`、`ipc/pet-assets.ts`、`ipc/pets.ts` 與畫面端 `PetAnimation.vue`、`DesktopPet.vue/.css`、`App.vue`、`agentStore.ts`、`pet-motion-plan.ts`、`pet-atlas-preview.ts`、`status-line-fit.ts` 改從這裡匯入。CSS 的格寬改用 App.vue 設定的 `--pet-cell-w`。
- `behaviorManifest` 從只認 `walk`／`sleep` 放寬為任何動作（`idle`、`waving`、`jumping`、`failed`、`waiting`、`running`、`review`、`walk`、`sleep`）。

## 安全邊界

`pet.json` 與插件外觀的 `behaviorManifest` 視為不受信任輸入：

- 只讀 `PET_MOTION_NAMES` 中的自有屬性（`Object.hasOwn`），未知鍵與繼承鍵一律忽略。
- `row` 0–63、`frames` 1–16、`frameDurations` 1–16 個有限數字並夾在 60–3000 ms；任一欄不合法就丟掉整筆，該動作用內建值。
- 已知實際圖集尺寸時（zip 匯入、插件外觀載入）再丟掉列號 ≥ 列數或格數 > 欄數的項目；zip 匯入沿用 `behavior-row-out-of-range` 警告（文案改為涵蓋列與格）。
- 自訂寵物的 `pet.json` 在載入時不讀圖檔，由畫面端 `resolvePetMotion` 在圖載入後用 `naturalWidth/Height` 再篩一次；時長陣列一定和格數等長，不會產生 `NaN` 延遲（修正原本 `frameDurations` 比 `frames` 短時的問題）。

## 驗證

- `pnpm exec vue-tsc --noEmit`、`pnpm run lint`、`pnpm run check:design:strict`（`--font-xl` 未使用為既有狀態）通過。
- `pnpm run test:unit`：1222 個，1221 通過、1 略過、0 失敗。新增 `tests/pet-atlas.test.mts`（規格對照、正向／反向解析、繼承鍵、格線篩選、resolver 回退、窄圖集、禁止重複字面值），`tests/pet-import.test.mts` 新增覆蓋任何動作與超出圖集的案例。
- `node scripts/e2e-isolated-electron.mjs --hook-port-base 27473`（假 safeStorage、隔離 HOME，未觸發鑰匙圈）：寵物 canvas 384×416 backing／192×208 CSS；idle 6 個不同影格；thinking→review@8、tool-running→running@7、waiting-input→waiting@6、error→failed@5、success→jumping@4（0.1 s）→waving@3（1.7 s）→idle@0（3.1 s）；覆蓋 `idle: {row: 9, frames: 4}` 實際播第 9 列；`idle: {row: 40}`、`review: {row: 9, frames: 20}` 在 8×11 圖上回退內建列。

## 殘餘風險

- 只在 macOS 驗證；Windows／Linux 未實測。
- 事件是透過 store 注入，未經真實 hook 送達。
- 使用者手動編輯 `custom/<id>/pet.json` 時，主程序只做上下限檢查，實際列數檢查在畫面端。

## 版本建議

公開的寵物包介面（`behaviorManifest`）放寬，屬公開契約變更，建議 minor；待使用者確認後再改版本。
