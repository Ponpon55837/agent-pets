import type { BrowserWindow, IpcMainEvent, IpcMainInvokeEvent, WebContents } from 'electron'

// 受測程式只碰 Electron 物件的少數成員，完整實作上百個成員沒有意義。
// 呼叫端只給用到的成員（Partial 仍會檢查每個成員的型別），唯一的轉型集中在這裡。

export function fakeBrowserWindow(members: Partial<BrowserWindow> = {}): BrowserWindow {
  return members as unknown as BrowserWindow
}

export function fakeWebContents(members: Partial<WebContents> = {}): WebContents {
  return members as unknown as WebContents
}

/** 測試以物件身分（`===`）辨識事件來源，所以每次呼叫都回傳新的物件。 */
export function fakeIpcMainEvent(members: Partial<IpcMainEvent> = {}): IpcMainEvent {
  return { ...members } as unknown as IpcMainEvent
}

export function fakeIpcMainInvokeEvent(members: Partial<IpcMainInvokeEvent> = {}): IpcMainInvokeEvent {
  return { ...members } as unknown as IpcMainInvokeEvent
}
