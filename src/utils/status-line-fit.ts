// 寵物狀態列的寬度預算：狀態詞永遠完整、狀態列永遠單行。
// 放不下時依序拿掉「+N」、插件徽章（由後往前），再讓名稱以省略號縮短、拿掉名稱，最後才拿掉 Quota 百分比
// （分段條仍在，百分比也還在提示框與 aria-label 裡）。
// 寬度由呼叫端的 measure() 提供（renderer 用 canvas measureText，測試用假的），
// 這裡只做加總與取捨，所以是純函式。

export type StatusLinePart = 'label' | 'state' | 'badge' | 'readout'
export type MeasureText = (text: string, part: StatusLinePart) => number

export interface StatusLineFitInput {
  /** 狀態列的內容寬度（外寬扣掉 padding 與邊框）。 */
  contentWidth: number
  /** 工具家族名稱；沒有家族的整體狀態列為 ''。 */
  label: string
  /** 狀態列上的狀態詞，永遠不縮短。 */
  state: string
  /** Quota 百分比文字（如 '71%'）；沒有 Quota 時為 null。 */
  readout: string | null
  /** 插件徽章文字，依顯示順序。 */
  badges: readonly string[]
  /** 超過每隻寵物上限的徽章數（「+N」）。 */
  hiddenCount: number
}

export interface StatusLineFit {
  showLabel: boolean
  showReadout: boolean
  badgeCount: number
  showOverflow: boolean
}

// 與 DesktopPet.css 對應的尺寸；tests/status-line-fit.test.mts 會檢查兩邊一致。
export const STATUS_LINE_GEOMETRY = {
  /** .status-line 左右 padding 各 9px＋邊框各 1px。 */
  chromeX: 20,
  /** .status-line 項目之間的 gap。 */
  gap: 5,
  /** .line-dot 寬度。 */
  dot: 8,
  /** .line-sep 的 margin-left 3px，加上 .line-text + .line-state 從 gap 拉回的 -2px。 */
  sepMargin: 1,
  /** .plugin-status-badges 的 gap。 */
  badgeGap: 3,
  /** .plugin-badge-pill 左右 padding 各 5px＋邊框各 1px。 */
  badgeChrome: 12,
  /** .plugin-badge-anchor 的 flex-basis：徽章最寬到這裡。 */
  badgeMax: 42,
  /** .plugin-badge-overflow 的 max-width。 */
  overflowMax: 36,
  /** .quota-readout 的 min-width。 */
  readoutMin: 25,
  /** 預留給次像素捨入與字型差異的空間。 */
  slack: 2,
} as const

/** 多寵物狀態列的最小寬度（.multi-pet-status-line），仍在 0.6 倍寵物欄內。 */
export const MULTI_PET_LINE_MIN_W = 112

/** 狀態列內容寬度：單寵物以寵物寬度為上限，多寵物填滿各自的寵物欄。 */
export function statusLineContentWidth(multiPet: boolean, petScale: number, petWidth = 250): number {
  const outer = multiPet ? Math.max(192 * petScale - 12, MULTI_PET_LINE_MIN_W) : petWidth - 14
  return outer - STATUS_LINE_GEOMETRY.chromeX
}

export function fitStatusLine(input: StatusLineFitInput, measure: MeasureText): StatusLineFit {
  const g = STATUS_LINE_GEOMETRY
  const budget = input.contentWidth - g.slack
  const stateWidth = measure(input.state, 'state')
  // 徽章比名稱先讓位：只要還有徽章，名稱就要完整寬度；徽章都拿掉後，名稱才可縮到 CSS 的 min-width（2ch）。
  const sepWidth = measure('·', 'state') + g.sepMargin
  const labelFull = input.label ? measure(input.label, 'label') + sepWidth : 0
  const labelMin = input.label ? Math.min(labelFull, measure('00', 'label') + sepWidth) : 0
  const readoutWidth = input.readout ? Math.max(g.readoutMin, measure(input.readout, 'readout')) : 0
  const badgeWidths = input.badges.map(text => Math.min(g.badgeMax, measure(text, 'badge') + g.badgeChrome))
  const overflowWidth = input.hiddenCount > 0
    ? Math.min(g.overflowMax, measure(`+${input.hiddenCount}`, 'badge') + g.badgeChrome)
    : 0

  const width = (fit: StatusLineFit): number => {
    const items = [g.dot, stateWidth]
    if (fit.showLabel && labelFull > 0) items.push(fit.badgeCount > 0 || fit.showOverflow ? labelFull : labelMin)
    if (fit.showReadout && readoutWidth > 0) items.push(readoutWidth)
    const group = [...badgeWidths.slice(0, fit.badgeCount), ...(fit.showOverflow && overflowWidth > 0 ? [overflowWidth] : [])]
    if (group.length > 0) items.push(group.reduce((sum, w) => sum + w, 0) + g.badgeGap * (group.length - 1))
    return items.reduce((sum, w) => sum + w, 0) + g.gap * (items.length - 1)
  }

  const candidates: StatusLineFit[] = [
    { showLabel: true, showReadout: true, badgeCount: badgeWidths.length, showOverflow: input.hiddenCount > 0 },
  ]
  if (input.hiddenCount > 0) candidates.push({ showLabel: true, showReadout: true, badgeCount: badgeWidths.length, showOverflow: false })
  for (let count = badgeWidths.length - 1; count >= 0; count -= 1) {
    candidates.push({ showLabel: true, showReadout: true, badgeCount: count, showOverflow: false })
  }
  candidates.push({ showLabel: false, showReadout: true, badgeCount: 0, showOverflow: false })
  const last: StatusLineFit = { showLabel: false, showReadout: false, badgeCount: 0, showOverflow: false }
  return candidates.find(fit => width(fit) <= budget) ?? last
}
