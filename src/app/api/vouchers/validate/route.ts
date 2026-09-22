// POST /api/vouchers/validate — apply coupon / slider offer to current cart
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, fail, parseJSON } from '@/lib/api'
import { validateVoucher } from '@/lib/vouchers'
import { getActiveHappyHourForItem } from '@/lib/happyhour'
import { getValidSession } from '@/lib/session'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const code = typeof body.code === 'string' ? body.code.trim() : ''
    const deviceId = typeof body.deviceId === 'string' ? body.deviceId.slice(0, 80) : null
    const deviceFp = typeof body.deviceFp === 'string' ? body.deviceFp.slice(0, 40) : null
    const items: { itemId: string; quantity: number; addons?: string[] }[] = Array.isArray(body.items) ? body.items : []

    if (!code) return fail('কুপন কোড লিখুন', 400)
    if (items.length === 0) return fail('কার্টে কোনো আইটেম নেই', 400)

    // session-aware preview (per-session dedup + table number for the ledger)
    const session = await getValidSession()

    // compute subtotal exactly like order placement (with happy hour pricing + addons)
    let subtotal = 0
    for (const line of items) {
      const mi = await db.menuItem.findUnique({ where: { id: line.itemId } })
      if (!mi) continue
      const qty = Math.max(1, Number(line.quantity) || 1)
      const happy = await getActiveHappyHourForItem(mi.id, mi.price)
      // addon pricing (same as order placement)
      const availableAddons = parseJSON<{ name: string; price: number }[]>(mi.addons, [])
      const chosenNames = Array.isArray(line.addons) ? line.addons : []
      const addonSum = availableAddons.filter((a) => chosenNames.includes(a.name)).reduce((s, a) => s + a.price, 0)
      const unit = (happy ? happy.finalPrice : mi.price) + addonSum
      subtotal += unit * qty
    }
    subtotal = Math.round(subtotal * 100) / 100

    const result = await validateVoucher(
      code,
      subtotal,
      items,
      { id: deviceId, fp: deviceFp },
      session?.sessionId || null,
      { tableNumber: session?.tableNumber ?? null, context: 'preview' }
    )
    if (!result.ok) {
      return fail(result.message || 'কুপন প্রযোজ্য নয়', 400, result.shortfall ? 'SET_MENU_SHORTFALL' : 'VOUCHER_INVALID')
    }

    return ok({
      discount: result.discount,
      voucher: result.voucher,
      subtotal,
    })
  } catch (e) {
    console.error('[vouchers:validate]', e)
    return fail('ভ্যালিডেশন ব্যর্থ', 500)
  }
}
