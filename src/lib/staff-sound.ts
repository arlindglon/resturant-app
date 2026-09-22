// ============================================================
// STAFF SOUND ENGINE — shared by Admin panel + KDS display.
// WebAudio chain: oscillator → tone gain → COMPRESSOR (loudness
// glue) → MASTER GAIN → destination, so chimes stay audible in
// noisy restaurant environments without clipping.
//
// Browser autoplay policy: AudioContext only starts after a user
// gesture — call armStaffSound() from a pointerdown/click handler
// (a module flag remembers it). All functions never throw.
// ============================================================

export type StaffVolume = 'boost' | 'normal'

const COMPRESSOR_THRESHOLD_DB = -14
const COMPRESSOR_RATIO = 14
const MASTER_GAIN: Record<StaffVolume, number> = { boost: 3.4, normal: 1.4 }

let ctx: AudioContext | null = null
let compressor: DynamicsCompressorNode | null = null
let master: GainNode | null = null
let armed = false
let volume: StaffVolume = 'boost'

type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext }

/** Build (or reuse) the audio graph. Returns null when unsupported/broken. */
function ensureChain(): boolean {
  try {
    if (typeof window === 'undefined') return false
    const Ctor = window.AudioContext ?? (window as WebkitWindow).webkitAudioContext
    if (!Ctor) return false
    if (!ctx || ctx.state === 'closed') {
      ctx = new Ctor()
      compressor = ctx.createDynamicsCompressor()
      compressor.threshold.value = COMPRESSOR_THRESHOLD_DB
      compressor.ratio.value = COMPRESSOR_RATIO
      master = ctx.createGain()
      master.gain.value = MASTER_GAIN[volume]
      compressor.connect(master)
      master.connect(ctx.destination)
    }
    return Boolean(ctx && compressor && master)
  } catch {
    return false
  }
}

/** One scheduled tone through the compressor chain. Internal only. */
function tone(
  freq: number,
  startOffset: number,
  duration: number,
  peak: number,
  type: OscillatorType = 'triangle'
): void {
  if (!ctx || !compressor) return
  const t0 = ctx.currentTime + startOffset
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, t0)
  // attack/decay envelope so beeps are soft, not clicks
  gain.gain.setValueAtTime(0.0001, t0)
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + 0.02)
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration)
  osc.connect(gain)
  gain.connect(compressor)
  osc.start(t0)
  osc.stop(t0 + duration + 0.05)
}

/** Arm the engine — MUST be called from inside a user gesture handler. */
export function armStaffSound(v: StaffVolume = 'boost'): boolean {
  try {
    volume = v
    if (!ensureChain()) return false
    armed = true
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {})
    return true
  } catch {
    return false
  }
}

/** Kill all audio (mute). Chimes become silent no-ops until re-armed. */
export function disarmStaffSound(): void {
  armed = false
  try {
    ctx?.close().catch(() => {})
  } catch {
    /* ignore */
  }
  ctx = null
  compressor = null
  master = null
}

/** Change volume live (works whether armed or not — remembered for next arm). */
export function setStaffVolume(v: StaffVolume): void {
  volume = v
  try {
    if (master && ctx && ctx.state !== 'closed') {
      master.gain.setTargetAtTime(MASTER_GAIN[v], ctx.currentTime, 0.05)
    }
  } catch {
    /* ignore */
  }
}

export function isStaffSoundArmed(): boolean {
  return armed
}

/** Short 880 Hz confirmation blip after arming / toggling. */
export function staffConfirmBeep(): void {
  if (!armed) return
  try {
    tone(880, 0, 0.14, 0.25, 'sine')
  } catch {
    /* audio must never crash the panel */
  }
}

/**
 * staffChime('order')  — 6 repeating pairs of triangle tones 1175 Hz + 1568 Hz
 *                        with soft harmonics, total ~1.4 s (bright "ding-ding").
 * staffChime('waiter') — alternating 880/622 Hz square + sawtooth pattern
 *                        (urgent doorbell-ish "bzz-bong").
 */
export function staffChime(kind: 'order' | 'waiter'): void {
  if (!armed) return
  try {
    if (kind === 'order') {
      const PAIRS = 6
      const STEP = 0.23 // 6 × 0.23 ≈ 1.4 s
      for (let i = 0; i < PAIRS; i++) {
        const t = i * STEP
        tone(1175, t, 0.13, 0.2, 'triangle')
        tone(1568, t + 0.105, 0.12, 0.16, 'triangle')
        // harmonics for extra cut-through
        tone(2350, t, 0.07, 0.05, 'sine')
        tone(3136, t + 0.105, 0.06, 0.04, 'sine')
      }
    } else {
      // waiter: alternating 880/622, square + sawtooth, 4 beats
      const beats: Array<[number, OscillatorType]> = [
        [880, 'square'],
        [622, 'sawtooth'],
        [880, 'square'],
        [622, 'sawtooth'],
      ]
      beats.forEach(([freq, type], i) => {
        tone(freq, i * 0.24, 0.18, 0.14, type)
      })
    }
  } catch {
    /* audio must never crash the panel */
  }
}
