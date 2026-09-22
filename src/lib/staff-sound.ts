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
  // WebAudio suspended (mobile until unlocked / after interruption)?
  // → pre-rendered <audio> fallback keeps the beep audible
  if (!ctx || ctx.state !== 'running') {
    playFallback('confirm')
    return
  }
  try {
    tone(880, 0, 0.14, 0.25, 'sine')
  } catch {
    /* audio must never crash the panel */
  }
}

/**
 * staffChime('order')   — 6 repeating pairs of triangle tones 1175 Hz + 1568 Hz
 *                         with soft harmonics, total ~1.4 s (bright "ding-ding").
 * staffChime('waiter')  — alternating 880/622 Hz square + sawtooth pattern
 *                         (urgent doorbell-ish "bzz-bong").
 * staffChime('cooking') — low warm double tone 523→392 Hz ("kitchen started").
 * staffChime('ready')   — bright ascending triple 988→1319→1568 Hz ×2
 *                         ("food READY — serve it!").
 * staffChime('served')  — soft descending pair 784→587 Hz ("table served").
 */
export function staffChime(kind: 'order' | 'waiter' | 'cooking' | 'ready' | 'served'): void {
  if (!armed) return
  // WebAudio suspended (mobile autoplay policy not yet satisfied, or the
  // context got suspended by a call/backgrounding) → fall back to a
  // pre-rendered WAV played through an <audio> element, which most
  // mobile browsers unlock with the same tap.
  if (!ctx || ctx.state !== 'running') {
    playFallback(kind)
    return
  }
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
    } else if (kind === 'waiter') {
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
    } else if (kind === 'cooking') {
      // cooking started: warm low double
      tone(523, 0, 0.16, 0.18, 'sine')
      tone(392, 0.18, 0.2, 0.16, 'sine')
    } else if (kind === 'ready') {
      // order READY: bright ascending triple ×2 — impossible to miss
      const seq = [988, 1319, 1568]
      for (let rep = 0; rep < 2; rep++) {
        seq.forEach((f, i) => {
          tone(f, rep * 0.45 + i * 0.12, 0.11, 0.2, 'triangle')
        })
        tone(2093, rep * 0.45 + 2 * 0.12, 0.14, 0.08, 'sine')
      }
    } else {
      // served: soft descending pair
      tone(784, 0, 0.14, 0.12, 'sine')
      tone(587, 0.15, 0.18, 0.1, 'sine')
    }
  } catch {
    /* audio must never crash the panel */
  }
}

// ============================================================
// <audio> WAV FALLBACK ENGINE — mobile rescue
// -----------------------------------------------------------
// Some mobile browsers / in-app webviews (Messenger, Facebook)
// keep WebAudio suspended even after a gesture. We synthesize the
// SAME chimes as raw 16-bit WAV bytes in pure JS (no WebAudio
// needed), cache them as object URLs and play via a plain
// <audio> element — the most universally unlocked audio path.
// ============================================================

type FallbackKind = 'order' | 'waiter' | 'cooking' | 'ready' | 'served' | 'confirm'

const FALLBACK_SR = 22050

type FbWave = 'sine' | 'tri' | 'buzz'

interface FbTone {
  at: number
  dur: number
  f: number
  v: number
  w: FbWave
}

// same musical patterns as the WebAudio versions
const FB_CHIMES: Record<FallbackKind, FbTone[]> = {
  confirm: [{ at: 0, dur: 0.14, f: 880, v: 0.5, w: 'sine' }],
  order: (() => {
    const t: FbTone[] = []
    for (let i = 0; i < 6; i++) {
      const at = i * 0.23
      t.push({ at, dur: 0.13, f: 1175, v: 0.6, w: 'tri' })
      t.push({ at: at + 0.105, dur: 0.12, f: 1568, v: 0.5, w: 'tri' })
    }
    return t
  })(),
  waiter: [
    { at: 0, dur: 0.18, f: 880, v: 0.5, w: 'buzz' },
    { at: 0.24, dur: 0.18, f: 622, v: 0.5, w: 'buzz' },
    { at: 0.48, dur: 0.18, f: 880, v: 0.5, w: 'buzz' },
    { at: 0.72, dur: 0.18, f: 622, v: 0.5, w: 'buzz' },
  ],
  cooking: [
    { at: 0, dur: 0.16, f: 523, v: 0.6, w: 'sine' },
    { at: 0.18, dur: 0.2, f: 392, v: 0.55, w: 'sine' },
  ],
  ready: (() => {
    const t: FbTone[] = []
    for (let r = 0; r < 2; r++) {
      const b = r * 0.45
      t.push(
        { at: b, dur: 0.11, f: 988, v: 0.6, w: 'tri' },
        { at: b + 0.12, dur: 0.11, f: 1319, v: 0.6, w: 'tri' },
        { at: b + 0.24, dur: 0.14, f: 1568, v: 0.65, w: 'tri' }
      )
    }
    return t
  })(),
  served: [
    { at: 0, dur: 0.14, f: 784, v: 0.45, w: 'sine' },
    { at: 0.15, dur: 0.18, f: 587, v: 0.4, w: 'sine' },
  ],
}

/** Render a tone list into a mono float track (pure math, no WebAudio). */
function synthTrack(tones: FbTone[]): Float32Array {
  const total = Math.max(...tones.map((t) => t.at + t.dur)) + 0.05
  const n = Math.ceil(total * FALLBACK_SR)
  const data = new Float32Array(n)
  for (const t of tones) {
    const start = Math.floor(t.at * FALLBACK_SR)
    const len = Math.floor(t.dur * FALLBACK_SR)
    for (let i = 0; i < len; i++) {
      const idx = start + i
      if (idx >= n) break
      const sec = i / FALLBACK_SR
      // soft attack + exponential decay — same envelope as WebAudio tones
      const env = Math.min(1, sec / 0.015) * Math.exp(-3.2 * (sec / t.dur))
      const ph = 2 * Math.PI * t.f * sec
      let s: number
      if (t.w === 'sine') s = Math.sin(ph)
      else if (t.w === 'tri') s = (2 / Math.PI) * Math.asin(Math.sin(ph))
      else s = 0.6 * Math.sign(Math.sin(ph)) + 0.4 * Math.sin(ph * 3)
      data[idx] += s * env * t.v
    }
  }
  return data
}

/** Wrap float samples in a 16-bit PCM WAV file and return an object URL. */
function toWavUrl(data: Float32Array): string {
  const buf = new ArrayBuffer(44 + data.length * 2)
  const dv = new DataView(buf)
  const w = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i))
  }
  w(0, 'RIFF')
  dv.setUint32(4, 36 + data.length * 2, true)
  w(8, 'WAVE')
  w(12, 'fmt ')
  dv.setUint32(16, 16, true)
  dv.setUint16(20, 1, true) // PCM
  dv.setUint16(22, 1, true) // mono
  dv.setUint32(24, FALLBACK_SR, true)
  dv.setUint32(28, FALLBACK_SR * 2, true)
  dv.setUint16(32, 2, true)
  dv.setUint16(34, 16, true)
  w(36, 'data')
  dv.setUint32(40, data.length * 2, true)
  let off = 44
  for (let i = 0; i < data.length; i++, off += 2) {
    const s = Math.max(-1, Math.min(1, data[i]))
    dv.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }))
}

const fbUrls: Partial<Record<FallbackKind, string>> = {}

function fbUrl(kind: FallbackKind): string | null {
  try {
    if (!fbUrls[kind]) fbUrls[kind] = toWavUrl(synthTrack(FB_CHIMES[kind]))
    return fbUrls[kind]
  } catch {
    return null
  }
}

function playFallback(kind: FallbackKind): void {
  try {
    const url = fbUrl(kind)
    if (!url) return
    const a = new Audio(url)
    a.volume = 1
    void a.play().catch(() => {
      /* still gesture-locked — nothing more we can do */
    })
  } catch {
    /* ignore */
  }
}

/**
 * Call INSIDE a user gesture: primes a near-silent <audio> element so
 * later chimes can play through the HTMLAudio fallback (in-app webviews
 * that never unlock WebAudio).
 */
let silentUrl: string | null = null
export function unlockStaffAudioFallback(): void {
  if (typeof window === 'undefined') return
  try {
    if (!silentUrl) {
      silentUrl = toWavUrl(synthTrack([{ at: 0, dur: 0.1, f: 440, v: 0.002, w: 'sine' }]))
    }
    const a = new Audio(silentUrl)
    a.volume = 0.01
    void a.play().catch(() => {
      /* ignore */
    })
  } catch {
    /* ignore */
  }
}
