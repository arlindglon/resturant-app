// Bengali (বাংলা) display helpers shared by KDS + Admin UIs.
// Pure functions — safe on both server & client.

const BN_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯']

/** Convert latin digits to Bengali digits: 12 → "১২" */
export function toBn(input: number | string): string {
  return String(input).replace(/\d/g, (d) => BN_DIGITS[Number(d)])
}

/** ৳ amount with Bengali digits: 450 → "৳৪৫০" */
export function bnTaka(n: number): string {
  const rounded = Math.round(n * 100) / 100
  const s = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2)
  return `৳${toBn(s)}`
}

const pad2 = (n: number) => String(n).padStart(2, '0')

/** Relative elapsed time in Bengali: "১২ মিনিট আগে" */
export function bnElapsed(from: string | Date, nowTs: number = Date.now()): string {
  const t = typeof from === 'string' ? new Date(from).getTime() : from.getTime()
  if (isNaN(t)) return '—'
  const mins = Math.max(0, Math.floor((nowTs - t) / 60000))
  if (mins < 1) return 'এইমাত্র'
  if (mins < 60) return `${toBn(mins)} মিনিট আগে`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (h < 24) return m === 0 ? `${toBn(h)} ঘণ্টা আগে` : `${toBn(h)} ঘণ্টা ${toBn(m)} মিনিট আগে`
  const d = Math.floor(h / 24)
  return `${toBn(d)} দিন আগে`
}

/** Live clock "১৪:২৩:০৫" (24h, Bengali digits) */
export function bnClock(d: Date): string {
  return toBn(`${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`)
}

/** Date + time "০৫/০১/২০২৫ ১৪:২৩" */
export function bnDateTime(iso: string | Date | null | undefined): string {
  if (!iso) return '—'
  const d = typeof iso === 'string' ? new Date(iso) : iso
  if (isNaN(d.getTime())) return '—'
  return toBn(`${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`)
}

/** Date only "০৫ জানু, ২০২৫" — accepts "YYYY-MM-DD" or ISO datetime */
export function bnDateOnly(iso: string | Date | null | undefined): string {
  if (!iso) return '—'
  let d: Date
  if (typeof iso === 'string') {
    // "YYYY-MM-DD" slice → parse as local date to avoid TZ shifts
    if (/^\d{4}-\d{2}-\d{2}/.test(iso)) {
      const [y, m, day] = iso.slice(0, 10).split('-').map(Number)
      d = new Date(y, m - 1, day)
    } else {
      d = new Date(iso)
    }
  } else {
    d = iso
  }
  if (isNaN(d.getTime())) return '—'
  const MONTHS = ['জানু', 'ফেব্রু', 'মার্চ', 'এপ্রি', 'মে', 'জুন', 'জুলা', 'আগ', 'সেপ্ট', 'অক্টো', 'নভে', 'ডিসে']
  return `${toBn(d.getDate())} ${MONTHS[d.getMonth()]}, ${toBn(d.getFullYear())}`
}

export const BN_DAYS_SHORT = ['রবি', 'সোম', 'মঙ্গল', 'বুধ', 'বৃহঃ', 'শুক্র', 'শনি']
export const BN_DAYS_FULL = ['রবিবার', 'সোমবার', 'মঙ্গলবার', 'বুধবার', 'বৃহস্পতিবার', 'শুক্রবার', 'শনিবার']

/** Day indices → Bengali text; empty = "প্রতিদিন" */
export function bnDays(days: number[]): string {
  if (!days || days.length === 0) return 'প্রতিদিন'
  return [...days].sort((a, b) => a - b).map((d) => BN_DAYS_SHORT[d] ?? '').join(', ')
}

/** Safe JSON parse for DB-stored JSON strings (happy hours / vouchers) */
export function parseJsonSafe<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback
  try {
    const v = JSON.parse(s)
    return (v ?? fallback) as T
  } catch {
    return fallback
  }
}
