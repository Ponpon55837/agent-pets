# Edge Peek 視覺調整工作紀錄

日期：2026-09-24
版本基線：`1.2.0`
狀態：樣式已實作；Electron 目視驗收待確認

## 使用者選定方向

使用者選擇 A+B 混搭：沿用低干擾、貼齊螢幕邊緣的短把手輪廓，以目前寵物的局部造型作為主要視覺提示。移除裝飾球體、「OPEN」文字與多餘箭頭；保留明確可操作的把手。

這項方向已先記錄到 Work Intelligence 的 Agent Pets 專案決策中。

## 目標與範圍

- 在 Edge 模式把目前啟用的寵物縮成小型探頭視窗，與貼邊把手整合。
- 使用既有設計 token 與 regular Liquid Glass 材質，保持底色足夠不透明；不新增巢狀玻璃層。
- 保留 42×96 DIP Edge window、650ms dwell、四邊停靠、原位置還原、拖曳、點擊展開、鍵盤操作與右鍵隱藏行為。
- 不修改 main process 幾何、IPC、偏好設定、寵物 spritesheet 格式或版本號。

## 視覺與可及性驗收條件

- Edge 把手貼齊工作區邊界；外緣平順接合，內側圓角。
- 把手以寵物臉部局部取代現有球體／文字，四個停靠方向都維持清楚、精簡的構圖。
- 保留可辨識的互動區、鍵盤焦點環與展開的輔助標籤。
- 支援 reduced motion、reduced transparency 與 increased contrast；狀態不只靠透明度或發光表達。
- 不影響 Normal／Mini 的寵物呈現、透明區 click-through 或待處理 Permission 強制回 Normal。

## 驗證紀錄

### 已完成

- Edge 把手改為目前寵物的局部探頭，移除裝飾球體、「OPEN」字樣與方向箭頭，保留貼邊把手和內側提示條。
- 沿用既有 `PetAnimation` 寵物圖像；Edge 預覽凍結動畫，並以容器裁切維持小尺寸。
- 套用既有 Liquid Glass surface、border、focus 與 transition tokens，新增單一 Edge 把手陰影 token。
- 保留原有點擊、Enter／Space 展開、拖曳、右鍵隱藏及 Edge window 幾何流程；未修改 main process、preload、IPC、權限或偏好設定。
- 加入 reduced motion、reduced transparency、increased contrast 樣式處理。
- 將 presentation stdio 測試改用目前 Node 執行檔路徑，避免在非 Windows 環境尋找固定的 `node.exe`。

### 檢查結果

- `pnpm exec vue-tsc --noEmit`：通過。
- `pnpm exec vite build`：通過，包含 renderer、Electron main 與 preload 建置。
- `pnpm test:unit`：通過，115 項通過、0 項失敗。
- `git diff --check`：通過。
- 未在 Electron 原生桌面視窗開啟 Edge 模式做目視驗收；本次工作環境無法操控原生桌面視窗，因此寵物臉部裁切、四邊貼合和實際透明材質仍待確認。

### 安全與版本

- 安全檢視：產品程式差異限於 renderer 元件、樣式與設計 token，沒有新增 IPC、檔案存取、程序啟動或權限流程；測試只將既有子程序測試改用目前 Node 執行檔路徑。
- 版本仍為 `1.2.0`；未修改任何版本欄位。
- 依專案流程，桌面目視及功能驗收完成後，再由使用者確認是否進行版本更新。
