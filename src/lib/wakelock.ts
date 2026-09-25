// Screen Wake Lock helper (shared by Admin panel + KDS).
//
// WHY: on mobile, a locked screen / background tab suspends JS timers —
// polling stops, so status changes are never detected and no sound plays
// (desktop tabs stay visible, which is why they always worked). Holding a
// wake lock keeps the screen on so the panel keeps polling + chiming,
// exactly like a desktop.
//
// The API needs a secure context (HTTPS) and browser user activation.
// All functions never throw.

interface WakeLockHandle {
  released: boolean
  release(): Promise<void>
  addEventListener(type: string, cb: () => void): void
}

type WakeLockNav = Navigator & {
  wakeLock?: { request(type: 'screen'): Promise<WakeLockHandle> }
}

let sentinel: WakeLockHandle | null = null

export function wakeLockSupported(): boolean {
  return typeof navigator !== 'undefined' && Boolean((navigator as WakeLockNav).wakeLock)
}

/** Request (or re-use) the screen wake lock. Returns true when held. */
export async function requestWakeLock(): Promise<boolean> {
  try {
    const nav = navigator as WakeLockNav
    if (!nav.wakeLock) return false
    if (sentinel && !sentinel.released) return true
    sentinel = await nav.wakeLock.request('screen')
    sentinel.addEventListener('release', () => {
      sentinel = null
    })
    return true
  } catch {
    return false
  }
}

/** Drop the wake lock (battery saver when sound/screen-keep is disabled). */
export async function releaseWakeLock(): Promise<void> {
  try {
    await sentinel?.release()
  } catch {
    /* ignore */
  } finally {
    sentinel = null
  }
}

export function isWakeLockHeld(): boolean {
  return Boolean(sentinel && !sentinel.released)
}
