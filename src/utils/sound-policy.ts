import type { SoundCue } from '@/utils/sound'

export interface SoundGate {
  soundEnabled: boolean
  dndEnabled: boolean
  soundOnPermission: boolean
  soundOnError: boolean
  soundOnSuccess: boolean
  /** The pet window is actually on screen (not hidden by fullscreen / tray). */
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

/** Whether a cue may be heard: master switch, DND, per-cue switch and visibility. */
export function shouldPlayCue(cue: SoundCue, gate: SoundGate): boolean {
  if (!gate.soundEnabled || gate.dndEnabled || !gate.petVisible) return false
  const cueSwitch = CUE_SWITCHES[cue]
  return cueSwitch ? gate[cueSwitch] : true
}
