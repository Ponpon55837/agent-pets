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

function beep(freq: number, startAt: number, duration: number, gain: number, type: OscillatorType = 'sine') {
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

export type SoundCue = 'success' | 'error' | 'waiting-permission'

export function playCue(cue: SoundCue) {
  const audio = getContext()
  if (!audio) return
  if (audio.state === 'suspended') audio.resume()

  switch (cue) {
    case 'success':
      beep(660, 0, 0.09, 0.12)
      beep(880, 0.09, 0.13, 0.12)
      break
    case 'error':
      beep(220, 0, 0.18, 0.12, 'sawtooth')
      break
    case 'waiting-permission':
      beep(520, 0, 0.08, 0.1)
      beep(520, 0.14, 0.08, 0.1)
      break
  }
}
