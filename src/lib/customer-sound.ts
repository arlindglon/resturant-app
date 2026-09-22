'use client'

// Customer order-status sound engine (WebAudio, zero deps).
// Plays distinct cues on live order status transitions:
//   PLACED   → soft double ding (confirmation)
//   COOKING  → sizzle-ish noise burst + low two-tone rumble
//   READY    → bright ascending 3-note chime (880/1100/1320 Hz)
//   SERVED   → warm happy 4-note motif
//   CANCELLED→ descending two-tone
// Loud by design: master gain 2.6 → dynamics compressor → destination.
// The AudioContext is armed on the first user gesture (pointerdown/keydown)
// and lazily resumed inside every play call (mobile autoplay policies).

let ctx: AudioContext | null = null
let master: GainNode | null = null

function ensureContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  try {
    if (!ctx) {
      const AC =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AC) return null
      ctx = new AC()

      // master chain: gain(2.6) → compressor → destination (loud & clean)
      const comp = ctx.createDynamicsCompressor()
      comp.threshold.value = -16
      comp.knee.value = 20
      comp.ratio.value = 8
      comp.attack.value = 0.003
      comp.release.value = 0.2

      master = ctx.createGain()
      master.gain.value = 2.6
      master.connect(comp)
      comp.connect(ctx.destination)
    }
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  } catch {
    return null
  }
}

/** Call on/before any user gesture so mobile browsers unlock audio. */
export function armAudio(): void {
  ensureContext()
}

// Arm on the first user gesture (idempotent — listener stays but exits fast).
if (typeof window !== 'undefined') {
  const onFirstGesture = () => {
    ensureContext()
    window.removeEventListener('pointerdown', onFirstGesture)
    window.removeEventListener('keydown', onFirstGesture)
  }
  window.addEventListener('pointerdown', onFirstGesture, { passive: true })
  window.addEventListener('keydown', onFirstGesture, { passive: true })
}

interface ToneOpts {
  type?: OscillatorType
  vol?: number
  glideTo?: number
}

function tone(freq: number, start: number, dur: number, opts: ToneOpts = {}) {
  const c = ensureContext()
  if (!c || !master) return
  try {
    const t0 = c.currentTime + start
    const osc = c.createOscillator()
    const g = c.createGain()
    osc.type = opts.type ?? 'sine'
    osc.frequency.setValueAtTime(freq, t0)
    if (opts.glideTo) osc.frequency.exponentialRampToValueAtTime(opts.glideTo, t0 + dur)
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.linearRampToValueAtTime(opts.vol ?? 0.5, t0 + 0.02)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    osc.connect(g)
    g.connect(master)
    osc.start(t0)
    osc.stop(t0 + dur + 0.05)
  } catch {
    /* audio unavailable — stay silent */
  }
}

/** short filtered white-noise burst — the "sizzle" texture */
function noiseBurst(start: number, dur: number, vol: number) {
  const c = ensureContext()
  if (!c || !master) return
  try {
    const len = Math.max(1, Math.floor(c.sampleRate * dur))
    const buf = c.createBuffer(1, len, c.sampleRate)
    const data = buf.getChannelData(0)
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
    const src = c.createBufferSource()
    src.buffer = buf
    const bp = c.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = 3200
    bp.Q.value = 0.7
    const g = c.createGain()
    const t0 = c.currentTime + start
    g.gain.setValueAtTime(vol, t0)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    src.connect(bp)
    bp.connect(g)
    g.connect(master)
    src.start(t0)
    src.stop(t0 + dur)
  } catch {
    /* audio unavailable — stay silent */
  }
}

export function playStatusSound(status: string): void {
  if (typeof window === 'undefined') return
  const c = ensureContext()
  if (!c) return
  try {
    switch (status) {
      case 'PLACED': {
        // soft double ding — order confirmation
        tone(1046.5, 0, 0.18, { type: 'sine', vol: 0.5 })
        tone(1318.5, 0.16, 0.3, { type: 'sine', vol: 0.55 })
        break
      }
      case 'COOKING': {
        // sizzle + short low rumble two-tone
        noiseBurst(0, 0.38, 0.5)
        tone(150, 0.02, 0.22, { type: 'sawtooth', vol: 0.4 })
        tone(220, 0.2, 0.26, { type: 'sawtooth', vol: 0.35 })
        break
      }
      case 'READY': {
        // bright ascending 3-note chime
        tone(880, 0, 0.22, { type: 'triangle', vol: 0.6 })
        tone(1100, 0.16, 0.22, { type: 'triangle', vol: 0.6 })
        tone(1320, 0.32, 0.42, { type: 'triangle', vol: 0.65 })
        break
      }
      case 'SERVED': {
        // warm happy 4-note motif (C5-E5-G5-C6)
        tone(523.25, 0, 0.18, { type: 'triangle', vol: 0.55 })
        tone(659.25, 0.15, 0.18, { type: 'triangle', vol: 0.55 })
        tone(783.99, 0.3, 0.18, { type: 'triangle', vol: 0.55 })
        tone(1046.5, 0.45, 0.42, { type: 'triangle', vol: 0.6 })
        break
      }
      case 'CANCELLED': {
        // descending two-tone — oh no
        tone(660, 0, 0.25, { type: 'sine', vol: 0.5 })
        tone(440, 0.22, 0.4, { type: 'sine', vol: 0.5 })
        break
      }
    }
  } catch {
    /* never let sound break the UI */
  }
}
