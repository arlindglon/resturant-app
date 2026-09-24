// Client-side API helper
export interface ApiResponse<T> {
  ok: boolean
  data?: T
  error?: string
  code?: string
}

/** দুর্বল/থ্রটল করা ইন্টারনেটে রিকোয়েস্ট অনন্তকাল ঝুলে থাকা ঠেকায় (12s) */
const TIMEOUT_MS = 12_000

/** AI-জাতীয় লম্বা কলের জন্য — মালিকের নির্দেশ: AI যত সময় লাগে নেবে, কোনো কৃত্রিম টাইমআউট নয় */
export const NO_TIMEOUT_MS = 300_000

function timeoutSignal(ms: number): AbortSignal | undefined {
  try {
    return typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal ? AbortSignal.timeout(ms) : undefined
  } catch {
    return undefined
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

interface Attempt<T> {
  res: ApiResponse<T>
  /** network failure / timeout / bad-gateway → worth an automatic retry */
  transient: boolean
}

async function attempt<T>(url: string, options?: RequestInit, timeoutMs = TIMEOUT_MS): Promise<Attempt<T>> {
  try {
    const res = await fetch(url, {
      ...options,
      signal: timeoutSignal(timeoutMs),
      headers: { 'Content-Type': 'application/json', ...(options?.headers || {}) },
    })
    const json = await res.json().catch(() => ({ ok: false, error: 'সার্ভার রেসপন্স পার্স করা যায়নি' }))
    return { res: json as ApiResponse<T>, transient: !res.ok && res.status >= 502 }
  } catch {
    return { res: { ok: false, error: 'নেটওয়ার্ক সমস্যা — আবার চেষ্টা করুন' }, transient: true }
  }
}

async function request<T>(url: string, options?: RequestInit, timeoutMs?: number): Promise<ApiResponse<T>> {
  const method = (options?.method || 'GET').toUpperCase()
  const first = await attempt<T>(url, options, timeoutMs)
  // GET হলে স্বয়ংক্রিয় রিট্রাই: দুর্বল নেটওয়ার্কে প্যাকেট-ঝরা বা টাইমআউট হলে
  // এক-দুইবারের রিট্রাইতেই লোড হয়ে যায় — "সাইট খুলছে না" অনুভূতি কমে।
  // লেখা-জাতীয় (POST/PUT/PATCH/DELETE) রিকোয়েস্ট কখনো অটো-রিট্রাই হয় না
  // (ডাবল অর্ডার/ডাবল পেমেন্টের ঝুঁকি) — শুধু টাইমআউট আছে।
  if (method === 'GET' && first.transient) {
    const waits = [700, 1800]
    for (const w of waits) {
      await sleep(w)
      const again = await attempt<T>(url, options, timeoutMs)
      if (!again.transient || again.res.ok) return again.res
    }
  }
  return first.res
}

export const api = {
  get: <T>(url: string, timeoutMs?: number) => request<T>(url, undefined, timeoutMs),
  post: <T>(url: string, body?: unknown, timeoutMs?: number) =>
    request<T>(url, { method: 'POST', body: JSON.stringify(body || {}) }, timeoutMs),
  patch: <T>(url: string, body?: unknown, timeoutMs?: number) =>
    request<T>(url, { method: 'PATCH', body: JSON.stringify(body || {}) }, timeoutMs),
  put: <T>(url: string, body?: unknown, timeoutMs?: number) =>
    request<T>(url, { method: 'PUT', body: JSON.stringify(body || {}) }, timeoutMs),
  del: <T>(url: string, timeoutMs?: number) => request<T>(url, { method: 'DELETE' }, timeoutMs),
}

// ============================================================
// DEVICE IDENTITY — sticky, fraud-resistant device tracking
// 1. uuid stored in localStorage AND a 1-year cookie (clearing
//    one storage layer no longer resets identity)
// 2. a lightweight browser fingerprint suffix (UA + screen +
//    timezone + cores hash) that survives full storage wipes —
//    server checks BOTH deviceId and fingerprint for promo /
//    birthday one-time enforcement
// ============================================================

const LS_KEY = 'qr_device_id'
const COOKIE_KEY = 'qr_device'

function setCookie(name: string, value: string, days: number) {
  try {
    const maxAge = days * 24 * 60 * 60
    document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${maxAge}; SameSite=Lax`
  } catch { /* ignore */ }
}

function readCookie(name: string): string | null {
  try {
    const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`))
    return match ? decodeURIComponent(match[1]) : null
  } catch {
    return null
  }
}

/** 8-hex-char stable browser fingerprint component */
function fingerprint(): string {
  try {
    const nav = navigator as Navigator & { hardwareConcurrency?: number; deviceMemory?: number }
    const raw = [
      nav.userAgent,
      `${screen.width}x${screen.height}x${screen.colorDepth}`,
      Intl.DateTimeFormat().resolvedOptions().timeZone || 'tz',
      nav.hardwareConcurrency || 0,
      nav.language,
      new Date().getTimezoneOffset(),
    ].join('|')
    let h1 = 0x811c9dc5
    let h2 = 0x1000193
    for (let i = 0; i < raw.length; i++) {
      h1 = (h1 ^ raw.charCodeAt(i)) * 0x01000193
      h2 = (h2 + raw.charCodeAt(i) * (i + 7)) * 0x85ebca6b
      h1 >>>= 0
      h2 >>>= 0
    }
    return (h1.toString(16) + h2.toString(16)).slice(0, 12).padStart(12, '0')
  } catch {
    return 'unknown-fp'
  }
}

export function getDeviceFp(): string {
  if (typeof window === 'undefined') return ''
  return fingerprint()
}

export function getDeviceId(): string {
  if (typeof window === 'undefined') return ''

  const fp = fingerprint()
  let id = localStorage.getItem(LS_KEY)
  const cookieId = readCookie(COOKIE_KEY)

  // restore from cookie if localStorage was wiped
  if (!id && cookieId) {
    id = cookieId
    localStorage.setItem(LS_KEY, id)
  }
  // restore from localStorage if cookie was wiped
  if (id && id !== cookieId) setCookie(COOKIE_KEY, id, 365)

  // fresh device (both layers empty) → generate with fingerprint suffix
  if (!id) {
    id = `${crypto.randomUUID()}.${fp}`
    localStorage.setItem(LS_KEY, id)
    setCookie(COOKIE_KEY, id, 365)
  }

  return id
}
