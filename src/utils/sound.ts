// 用 Web Audio 即時合成短音效：不必附帶或授權音檔，聲音也夠小、沒有載入延遲。
let ctx: AudioContext | null = null

function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!ctx) {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext
    if (!AudioCtx) return null
    ctx = new AudioCtx()
  }
  return ctx
}

let masterVolume = 0.6

/** 桌面偏好設定的 0–100。 */
export function setSoundVolume(percent: number): void {
  masterVolume = Math.min(1, Math.max(0, percent / 100))
}

function beep(freq: number, startAt: number, duration: number, baseGain: number, type: OscillatorType = 'sine') {
  const gain = baseGain * masterVolume * 1.6
  const audio = getContext()
  if (!audio) return
  const osc = audio.createOscillator()
  const gainNode = audio.createGain()
  osc.type = type
  osc.frequency.value = freq
  gainNode.gain.setValueAtTime(0, audio.currentTime + startAt)
  gainNode.gain.linearRampToValueAtTime(gain, audio.currentTime + startAt + 0.01)
  gainNode.gain.linearRampToValueAtTime(0, audio.currentTime + startAt + duration)
  osc.connect(gainNode)
  gainNode.connect(audio.destination)
  osc.start(audio.currentTime + startAt)
  osc.stop(audio.currentTime + startAt + duration + 0.02)
}

export type SoundCue = 'success' | 'error' | 'waiting-permission' | 'waiting-input'

// 多個請求同時到達時，不能疊成一連串嗶聲。
const CUE_THROTTLE_MS = 3_000
const lastPlayed = new Map<SoundCue, number>()

interface Tone {
  freq: number
  startAt: number
  duration: number
  gain: number
  type?: OscillatorType
}

// 每個 cue 的音形只寫在這張表；新增 cue 時漏了音形會編譯失敗。
const CUE_TONES: Record<SoundCue, readonly Tone[]> = {
  success: [
    { freq: 660, startAt: 0, duration: 0.09, gain: 0.12 },
    { freq: 880, startAt: 0.09, duration: 0.13, gain: 0.12 },
  ],
  // 兩個下降音聽起來像「糟糕」，比單一刺耳的嗡聲溫和。
  error: [
    { freq: 330, startAt: 0, duration: 0.12, gain: 0.1, type: 'triangle' },
    { freq: 220, startAt: 0.13, duration: 0.2, gain: 0.1, type: 'triangle' },
  ],
  // 輕柔的上升兩音：agent 是在詢問，不是警報。
  'waiting-input': [
    { freq: 440, startAt: 0, duration: 0.08, gain: 0.08 },
    { freq: 587, startAt: 0.1, duration: 0.12, gain: 0.08 },
  ],
  // 上升再下降的三音，和兩音上升的成功音效明顯不同。
  'waiting-permission': [
    { freq: 988, startAt: 0, duration: 0.09, gain: 0.1, type: 'triangle' },
    { freq: 740, startAt: 0.12, duration: 0.09, gain: 0.1, type: 'triangle' },
    { freq: 988, startAt: 0.24, duration: 0.14, gain: 0.1, type: 'triangle' },
  ],
}

export function playCue(cue: SoundCue, options: { preview?: boolean } = {}) {
  const audio = getContext()
  if (!audio || masterVolume <= 0) return
  const nowMs = Date.now()
  if (!options.preview && nowMs - (lastPlayed.get(cue) ?? 0) < CUE_THROTTLE_MS) return
  lastPlayed.set(cue, nowMs)
  if (audio.state === 'suspended') audio.resume()

  for (const tone of CUE_TONES[cue]) beep(tone.freq, tone.startAt, tone.duration, tone.gain, tone.type)
}
