// Verification-data parsers for the Messenger offer flow.
// The bot asks the customer for the offer's required data (per OccasionOffer
// fieldType) and these helpers decide whether the reply is acceptable.
// Wrong data (e.g. a phone number where a date is required) NEVER unlocks
// the discount — the bot re-asks instead.

const BN_DIGITS = '০১২৩৪৫৬৭৮৯'

function bnToEnDigits(s: string): string {
  return s.replace(/[০-৯]/g, (d) => String(BN_DIGITS.indexOf(d)))
}

const MONTHS: Record<string, number> = {
  // English
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9,
  september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
  // Bengali
  'জানুয়ারি': 1, 'জানুয়ারী': 1, 'জানু': 1,
  'ফেব্রুয়ারি': 2, 'ফেব্রুয়ারী': 2, 'ফেব': 2,
  'মার্চ': 3, 'এপ্রিল': 4, 'এপরিল': 4, 'মে': 5, 'জুন': 6, 'জুলাই': 7,
  'আগস্ট': 8, 'অগাস্ট': 8, 'সেপ্টেম্বর': 9, 'সেপ্ট': 9,
  'অক্টোবর': 10, 'অক্টোবের': 10, 'নভেম্বর': 11, 'নভে': 11, 'ডিসেম্বর': 12, 'ডিসে': 12,
}

export interface ParsedDate {
  date: Date
  /** "15/03/1995" style normalized string (Bengali digits for display) */
  normalized: string
}

/** Try hard to find a real date in free text. Returns null when none found. */
export function parseDateLoose(input: string): ParsedDate | null {
  const text = bnToEnDigits(input).trim()
  if (!text) return null
  const now = new Date()

  // ── 1. numeric dd/mm/yyyy · dd-mm-yyyy · dd.mm.yyyy (also yyyy first) ──
  const num = text.match(/(\d{1,4})\s*[\/\-.]\s*(\d{1,2})(?:\s*[\/\-.]\s*(\d{2,4}))?/)
  if (num) {
    const a = parseInt(num[1], 10)
    const b = parseInt(num[2], 10)
    let y = num[3] ? parseInt(num[3], 10) : now.getFullYear()
    if (y < 100) y += y > 70 ? 1900 : 2000
    if (a >= 1 && a <= 31 && b >= 1 && b <= 12) {
      // Bangladeshi convention: day first
      const d = new Date(y, b - 1, a)
      if (d.getDate() === a && d.getMonth() === b - 1) {
        return { date: d, normalized: `${a}/${b}/${y}` }
      }
    }
    if (num[1].length === 4 && b >= 1 && b <= 12 && num[3]) {
      // yyyy-mm-dd (ISO style)
      const c = parseInt(num[3], 10)
      if (c >= 1 && c <= 31) {
        const d = new Date(a, b - 1, c)
        if (d.getDate() === c && d.getMonth() === b - 1) {
          return { date: d, normalized: `${c}/${b}/${a}` }
        }
      }
    }
  }

  // ── 2. "15 March 1995" / "March 15" / "১৫ মার্চ" (month name, any order) ──
  const lower = text.toLowerCase()
  const dayFirst = lower.match(/(\d{1,2})\s*([a-z\u0980-\u09FF]+)/i)
  const monthFirst = lower.match(/([a-z\u0980-\u09FF]+)\s*(\d{1,2})/i)
  for (const m of [dayFirst, monthFirst]) {
    if (!m) continue
    const dayNum = parseInt(m[1].match(/\d+/)?.[0] ?? m[2].match(/\d+/)?.[0] ?? '', 10)
    const word = (m[1].match(/[a-z\u0980-\u09FF]+/i)?.[0] ?? m[2].match(/[a-z\u0980-\u09FF]+/i)?.[0] ?? '').trim()
    const month = MONTHS[word]
    if (month && dayNum >= 1 && dayNum <= 31) {
      const yearM = lower.match(/(19|20)\d{2}/)
      const y = yearM ? parseInt(yearM[0], 10) : now.getFullYear()
      const d = new Date(y, month - 1, dayNum)
      if (d.getDate() === dayNum && d.getMonth() === month - 1) {
        return { date: d, normalized: `${dayNum}/${month}/${y}` }
      }
    }
  }

  return null
}

/** Extract a phone number (10–15 digits, optional +) from free text. */
export function parsePhoneLoose(input: string): string | null {
  const text = bnToEnDigits(input).replace(/[^\d+]/g, '')
  const m = text.match(/^\+?\d{10,15}$/)
  return m ? m[0] : null
}
