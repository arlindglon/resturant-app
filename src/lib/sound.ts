// Customer-side chimes (Web Audio API — no audio assets needed).
// Friendly, pleasant melodies — very different from the LOUD kitchen alarms.
//
// Autoplay policy: browsers block sound until the user interacts with the
// page. `primeAudio()` is attached to the first pointerdown/keydown on the
// menu page; every chime call fails silently if audio is still locked.

export type CustomerChime = 'cooking' | 'ready' | 'served'

let ctx: AudioContext | null = null

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null
  try {
    if (!ctx) {
      const Ctor: typeof AudioContext | undefined =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctor) return null
      ctx = new Ctor()
    }
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  } catch {
    return null
  }
}

/** Call once on the user's first gesture — unlocks audio on iOS/Android. */
export function primeAudio() {
  const c = getCtx()
  if (!c) return
  try {
    // 1-sample silent buffer — the classic iOS Safari unlock trick
    const buf = c.createBuffer(1, 1, 22050)
    const src = c.createBufferSource()
    src.buffer = buf
    src.connect(c.destination)
    src.start(0)
  } catch {
    /* ignore */
  }
}

function tone(
  c: AudioContext,
  freq: number,
  at: number,
  dur: number,
  peak = 0.5,
  type: OscillatorType = 'sine'
) {
  const t0 = c.currentTime + at
  const osc = c.createOscillator()
  const gain = c.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, t0)
  gain.gain.setValueAtTime(0.0001, t0)
  gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.02)
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  osc.connect(gain)
  gain.connect(c.destination)
  osc.start(t0)
  osc.stop(t0 + dur + 0.05)
}

/**
 * 🔔 Live-tracking chimes for the customer:
 *  - cooking: quick rising "doo-doom" (your food is being cooked)
 *  - ready:   bright double fanfare (impossible to miss — come get it!)
 *  - served:  warm resolving chime (enjoy your meal)
 */
export function playCustomerChime(kind: CustomerChime) {
  const c = getCtx()
  if (!c || c.state !== 'running') return // still locked by autoplay policy — skip
  if (kind === 'cooking') {
    tone(c, 659.25, 0, 0.18, 0.45) // E5
    tone(c, 880, 0.15, 0.26, 0.45) // A5
    tone(c, 1108.73, 0.32, 0.3, 0.3) // C#6 sparkle
  } else if (kind === 'ready') {
    // cheerful ascending fanfare, repeated twice
    const seq: [number, number][] = [
      [783.99, 0], [987.77, 0.13], [1174.66, 0.26], [1567.98, 0.42],
    ]
    for (const [f, t] of seq) {
      tone(c, f, t, 0.32, 0.5, 'triangle')
      tone(c, f * 2, t, 0.32, 0.12) // bright harmonic layer
    }
    for (const [f, t] of seq) tone(c, f, t + 0.62, 0.26, 0.38, 'triangle')
  } else {
    tone(c, 987.77, 0, 0.2, 0.42, 'triangle') // B5
    tone(c, 783.99, 0.18, 0.38, 0.42, 'triangle') // G5 resolve
    tone(c, 523.25, 0.36, 0.5, 0.3, 'sine') // C5 warm tail
  }
}
