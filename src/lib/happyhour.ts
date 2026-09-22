// Happy Hour pricing engine — computes live discounted prices server-side
// Supports two schedule modes:
//  1. WEEKLY DAYS  — daysOfWeek JSON [0..6]; [] = every day
//  2. DATE RANGE   — startDate + endDate set → applies every day in the
//                    inclusive range (daysOfWeek ignored)
import { db } from '@/lib/db'

export interface HappyHourInfo {
  id: string
  name: string
  percent: number
  finalPrice: number
}

/** Shape of an active happy-hour rule (subset used by the engine) */
export interface HappyHourRule {
  id: string
  name: string
  discountPercent: number
  daysOfWeek: string
  startTime: string
  endTime: string
  startDate: Date | null
  endDate: Date | null
  itemIds: string | null
}

/** Load every active rule in ONE query — callers compute prices in memory. */
export async function loadActiveRules(): Promise<HappyHourRule[]> {
  return db.happyHour.findMany({ where: { active: true } })
}

function minutesOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes()
}

function parseHHMM(s: string): number {
  const [h, m] = s.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

/** midnight of `d`'s day (local server time) — used for date-range compare */
function midnightOf(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

/** Is the rule's date-range satisfied today? Both bounds inclusive. */
function inDateRange(
  startDate: Date | null | undefined,
  endDate: Date | null | undefined,
  now: Date
): boolean {
  if (!startDate || !endDate) return true // no range configured → always pass
  const today = midnightOf(now)
  return startDate.getTime() <= today.getTime() && today.getTime() <= endDate.getTime()
}

/** true when the rule uses the custom date-to-date mode */
export function isDateRangeRule(r: { startDate?: Date | null; endDate?: Date | null }): boolean {
  return Boolean(r.startDate && r.endDate)
}

/** schedule gate shared by both rule modes (date-range OR weekly-days) */
function ruleDayOk(r: HappyHourRule, now: Date): boolean {
  if (isDateRangeRule(r)) {
    if (!inDateRange(r.startDate, r.endDate, now)) return false
  } else {
    let days: number[] = []
    try { days = JSON.parse(r.daysOfWeek || '[]') } catch { /* ignore */ }
    const day = now.getDay()
    if (days.length > 0 && !days.includes(day)) return false
  }
  return true
}

/** Pure, no DB — best active happy-hour for an item right now from pre-loaded rules. */
export function bestHappyHourForItem(
  rules: HappyHourRule[],
  itemId: string,
  basePrice: number,
  now: Date
): HappyHourInfo | null {
  const mins = minutesOfDay(now)
  let best: HappyHourInfo | null = null
  for (const r of rules) {
    if (!ruleDayOk(r, now)) continue
    const start = parseHHMM(r.startTime)
    const end = parseHHMM(r.endTime)
    // supports overnight windows (e.g. 22:00 → 02:00)
    const inWindow = start <= end ? mins >= start && mins <= end : mins >= start || mins <= end
    if (!inWindow) continue
    let itemIds: string[] = []
    try { itemIds = JSON.parse(r.itemIds || '[]') } catch { /* ignore */ }
    if (itemIds.length > 0 && !itemIds.includes(itemId)) continue
    const finalPrice = Math.max(0, Math.round(basePrice * (1 - r.discountPercent / 100) * 100) / 100)
    if (!best || r.discountPercent > best.percent) {
      best = { id: r.id, name: r.name, percent: r.discountPercent, finalPrice }
    }
  }
  return best
}

/** Pure, no DB — banner text for the best live discount right now. */
export function bestBannerText(rules: HappyHourRule[], now: Date): string | null {
  const mins = minutesOfDay(now)
  let best: { name: string; percent: number } | null = null
  for (const r of rules) {
    if (!ruleDayOk(r, now)) continue
    const start = parseHHMM(r.startTime)
    const end = parseHHMM(r.endTime)
    const inWindow = start <= end ? mins >= start && mins <= end : mins >= start || mins <= end
    if (!inWindow) continue
    if (!best || r.discountPercent > best.percent) {
      best = { name: r.name, percent: r.discountPercent }
    }
  }
  return best ? `🔥 Happy Hour: ${best.name} — ${best.percent}% OFF` : null
}

/** Returns the best active happy-hour for an item right now (null if none) */
export async function getActiveHappyHourForItem(
  itemId: string,
  basePrice: number,
  now = new Date()
): Promise<HappyHourInfo | null> {
  const rules = await loadActiveRules()
  return bestHappyHourForItem(rules, itemId, basePrice, now)
}

/** Banner text for the menu header when any happy hour is live — shows the BEST discount */
export async function getLiveHappyHourBanner(now = new Date()): Promise<string | null> {
  const rules = await loadActiveRules()
  return bestBannerText(rules, now)
}

/* ───────── shared API-side parsing/validation helpers ───────── */

export interface ParsedDateRange {
  startDate: Date | null
  endDate: Date | null
}

/**
 * Parse & validate an optional "YYYY-MM-DD" → "YYYY-MM-DD" range from an
 * admin payload. Returns {null,null} when neither value provided (weekly mode).
 * Throws Error with a Bengali message when invalid.
 */
export function parseDateRange(startVal: unknown, endVal: unknown): ParsedDateRange {
  const hasStart = typeof startVal === 'string' && startVal.length > 0
  const hasEnd = typeof endVal === 'string' && endVal.length > 0
  if (!hasStart && !hasEnd) return { startDate: null, endDate: null }
  if (hasStart !== hasEnd) {
    throw new Error('তারিখ রেঞ্জে শুরু ও শেষ — দুটোই দিন (বা দুটোই ফাঁকা)')
  }
  const startStr = String(startVal)
  const endStr = String(endVal)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startStr) || !/^\d{4}-\d{2}-\d{2}$/.test(endStr)) {
    throw new Error('সঠিক তারিখ দিন (YYYY-MM-DD)')
  }
  const startDate = new Date(`${startStr}T00:00:00`)
  const endDate = new Date(`${endStr}T23:59:59.999`)
  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    throw new Error('সঠিক তারিখ দিন (YYYY-MM-DD)')
  }
  if (endDate.getTime() < startDate.getTime()) {
    throw new Error('শেষ তারিখ শুরুর তারিখের আগে হতে পারে না')
  }
  return { startDate, endDate }
}
