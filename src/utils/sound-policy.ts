import type { SoundCue } from '@/utils/sound'

export interface SoundGate {
  soundEnabled: boolean
  dndEnabled: boolean
  soundOnPermission: boolean
  soundOnError: boolean
  soundOnSuccess: boolean
  /** 寵物視窗確實在螢幕上（沒有被全螢幕或收進系統匣）。 */
  petVisible: boolean
}

type CueSwitch = 'soundOnPermission' | 'soundOnError' | 'soundOnSuccess'

// 每個 cue 各自的開關；null 表示只跟總開關（waiting-input 沒有獨立開關）。
// 用 Record 讓新增 cue 時一定要決定它跟哪個開關。
const CUE_SWITCHES: Record<SoundCue, CueSwitch | null> = {
  'waiting-permission': 'soundOnPermission',
  error: 'soundOnError',
  success: 'soundOnSuccess',
  'waiting-input': null,
}

/** 這個音效能不能播：總開關、勿擾、各音效開關與可見性都要通過。 */
export function shouldPlayCue(cue: SoundCue, gate: SoundGate): boolean {
  if (!gate.soundEnabled || gate.dndEnabled || !gate.petVisible) return false
  const cueSwitch = CUE_SWITCHES[cue]
  return cueSwitch ? gate[cueSwitch] : true
}
