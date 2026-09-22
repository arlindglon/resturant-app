// GET /api/admin/receipts — paid transaction history with date filters.
// Query: ?period=today|yesterday|weekly|monthly|yearly|custom&from=YYYY-MM-DD&to=YYYY-MM-DD
// Day boundaries are computed in the restaurant's timezone (birthday_timezone, default Asia/Dhaka).
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, parseJSON } from '@/lib/api'
import { getSetting } from '@/lib/settings'
import { SETTING_KEYS } from '@/lib/constants'
import { requirePerm } from '@/lib/staff-auth'

export interface ReceiptOrder {
  orderNo: number
  items: { name: string; qty: number; returnedQty?: number; unitPrice: number; lineTotal: number; spiceLevel?: string | null; addons?: string; specialNote?: string | null }[]
  subtotal: number
  returnedAmount?: number
  happyHourDiscount: number
  voucherDiscount: number
  voucherVoided?: boolean
  birthdayDiscount: number
  voucherCode?: string | null
  total: number
}

function tzOffsetMinutes(tz: string): number {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false })
    const parts = dtf.formatToParts(new Date())
    const get = (t: string) => parseInt(parts.find((p) => p.type === t)?.value || '0', 10)
    const asUTC = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'))
    return (asUTC - Date.now()) / 60000
  } catch {
    return 360 // Asia/Dhaka
  }
}

function dayRange(tz: string, d: Date): [Date, Date] {
  const off = tzOffsetMinutes(tz)
  const local = new Date(d.getTime() - off * 60000)
  const startLocal = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate())
  return [new Date(startLocal + off * 60000), new Date(startLocal + 86400000 + off * 60000)]
}

export async function GET(req: NextRequest) {
  const denied = await requirePerm('tables')
  if (denied) return denied

  const url = new URL(req.url)
  const period = url.searchParams.get('period') || 'all'
  const fromS = url.searchParams.get('from')
  const toS = url.searchParams.get('to')

  const tz = await getSetting(SETTING_KEYS.BIRTHDAY_TIMEZONE) || 'Asia/Dhaka'
  const now = new Date()
  let from: Date | null = null
  let to: Date | null = null

  if (period === 'today') {
    ;[from, to] = dayRange(tz, now)
  } else if (period === 'yesterday') {
    ;[from, to] = dayRange(tz, new Date(now.getTime() - 86400000))
  } else if (period === 'weekly') {
    ;[to] = dayRange(tz, now)
    ;[from] = dayRange(tz, new Date(now.getTime() - 6 * 86400000))
  } else if (period === 'monthly') {
    const off = tzOffsetMinutes(tz)
    const local = new Date(now.getTime() - off * 60000)
    from = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) + off * 60000)
    ;[to] = dayRange(tz, now)
  } else if (period === 'yearly') {
    const off = tzOffsetMinutes(tz)
    const local = new Date(now.getTime() - off * 60000)
    from = new Date(Date.UTC(local.getUTCFullYear(), 0, 1) + off * 60000)
    ;[to] = dayRange(tz, now)
  } else if (period === 'custom') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(fromS || '') && /^\d{4}-\d{2}-\d{2}$/.test(toS || '')) {
      const off = tzOffsetMinutes(tz)
      from = new Date(Date.UTC(
        parseInt(fromS!.slice(0, 4), 10),
        parseInt(fromS!.slice(5, 7), 10) - 1,
        parseInt(fromS!.slice(8, 10), 10)
      ) + off * 60000)
      to = new Date(Date.UTC(
        parseInt(toS!.slice(0, 4), 10),
        parseInt(toS!.slice(5, 7), 10) - 1,
        parseInt(toS!.slice(8, 10), 10)
      ) + 86400000 + off * 60000)
    }
  }

  const where = from && to ? { paidAt: { gte: from, lt: to } } : {}
  const receipts = await db.receipt.findMany({
    where,
    orderBy: { paidAt: 'desc' },
    take: 500,
  })

  const total = receipts.reduce((s, r) => s + r.total, 0)
  const discounts = receipts.reduce((s, r) => s + r.discountTotal, 0)

  return ok({
    receipts: receipts.map((r) => ({
      id: r.id,
      receiptNo: r.receiptNo,
      tableNumber: r.tableNumber,
      ordersCount: r.ordersCount,
      subtotal: r.subtotal,
      discountTotal: r.discountTotal,
      total: r.total,
      paymentMethod: r.paymentMethod,
      paidAt: r.paidAt,
      items: parseJSON<ReceiptOrder[]>(r.itemsJson, []),
    })),
    summary: {
      count: receipts.length,
      total: Math.round(total * 100) / 100,
      discounts: Math.round(discounts * 100) / 100,
    },
    period,
  })
}
