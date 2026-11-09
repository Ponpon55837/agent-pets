// Short synthesized cues via Web Audio — no audio asset files to ship or
// license, and the sounds stay tiny and instant.
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

/** 0-100 from the desktop preference. */
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

// Several requests arriving together must not stack into a burst of beeps.
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
  // Two falling notes read as "oh no" rather than a single harsh buzz.
  error: [
    { freq: 330, startAt: 0, duration: 0.12, gain: 0.1, type: 'triangle' },
    { freq: 220, startAt: 0.13, duration: 0.2, gain: 0.1, type: 'triangle' },
  ],
  // A soft rising pair: the agent is asking, not alarming.
  'waiting-input': [
    { freq: 440, startAt: 0, duration: 0.08, gain: 0.08 },
    { freq: 587, startAt: 0.1, duration: 0.12, gain: 0.08 },
  ],
  // Rising-falling three-note figure, clearly different from the
  // two-note rising success cue.
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
