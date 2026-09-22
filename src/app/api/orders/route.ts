// Orders API
// POST /api/orders — place order (SESSION PROTECTED — 403 if invalid)
// GET  /api/orders  — my session's live orders (status tracker)
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, fail, parseJSON } from '@/lib/api'
import { getValidSession } from '@/lib/session'
import { getActiveHappyHourForItem } from '@/lib/happyhour'
import { validateVoucher, recordVoucherUse } from '@/lib/vouchers'
import { ORDER_STATUS } from '@/lib/constants'
import { emitEvent } from '@/lib/emit'
import { appendLedger, LEDGER_TYPES } from '@/lib/ledger'
import { checkGeoFence } from '@/lib/geo'

interface IncomingItem {
  itemId: string
  quantity: number
  spiceLevel?: string
  addons?: string[] // addon names
  specialNote?: string
}

export async function POST(req: NextRequest) {
  try {
    // ---- SECURITY GATE: HMAC session validation ----
    const session = await getValidSession()
    if (!session) {
      return fail('নিষিদ্ধ: অবৈধ বা মেয়াদোত্তীর্ণ সেশন। রেস্তোরাঁর টেবিলে QR স্ক্যান করুন।', 403, 'SESSION_INVALID')
    }

    const body = await req.json().catch(() => ({}))
    const deviceId = typeof body.deviceId === 'string' ? body.deviceId.slice(0, 80) : session.deviceId
    const deviceFp = typeof body.deviceFp === 'string' ? body.deviceFp.slice(0, 40) : null
    const device = { id: deviceId, fp: deviceFp }
    const items: IncomingItem[] = Array.isArray(body.items) ? body.items : []
    const voucherCode = typeof body.voucherCode === 'string' ? body.voucherCode.trim() : ''

    // GEOFENCE: re-check at order time (customer may have left the area)
    const geo = await checkGeoFence({ lat: Number(body.lat), lng: Number(body.lng) })
    if (!geo.allowed) {
      return fail(geo.message, 403, geo.code)
    }

    if (items.length === 0) return fail('কার্টে কোনো আইটেম নেই', 400)

    // fetch menu items
    const ids = items.map((i) => i.itemId)
    const menuItems = await db.menuItem.findMany({ where: { id: { in: ids } } })
    const menuMap = new Map(menuItems.map((m) => [m.id, m]))

    // build order items with happy-hour pricing
    const orderItems: {
      itemId: string
      itemName: string
      unitPrice: number
      basePrice: number
      quantity: number
      spiceLevel: string | null
      addons: string
      specialNote: string | null
      lineTotal: number
    }[] = []

    let subtotal = 0
    let happyHourDiscount = 0

    for (const line of items) {
      const mi = menuMap.get(line.itemId)
      if (!mi) return fail(`মেনু আইটেম পাওয়া যায়নি: ${line.itemId}`, 400)
      if (!mi.isAvailable) return fail(`"${mi.name}" এই মুহূর্তে Out of Stock 😔`, 400)

      const qty = Math.max(1, Math.min(50, Number(line.quantity) || 1))
      const happy = await getActiveHappyHourForItem(mi.id, mi.price)
      const unitPrice = happy ? happy.finalPrice : mi.price
      if (happy) happyHourDiscount += (mi.price - unitPrice) * qty

      // addons pricing
      const availableAddons = parseJSON<{ name: string; price: number }[]>(mi.addons, [])
      const chosenNames = Array.isArray(line.addons) ? line.addons : []
      const chosen = availableAddons.filter((a) => chosenNames.includes(a.name))
      const addonSum = chosen.reduce((s, a) => s + a.price, 0)

      const unit = unitPrice + addonSum
      const lineTotal = unit * qty
      subtotal += lineTotal

      orderItems.push({
        itemId: mi.id,
        itemName: mi.name,
        unitPrice: unit,
        basePrice: mi.price,
        quantity: qty,
        spiceLevel: line.spiceLevel || null,
        addons: JSON.stringify(chosen),
        specialNote: (line.specialNote || '').slice(0, 200) || null,
        lineTotal,
      })
    }

    subtotal = Math.round(subtotal * 100) / 100

    // ---- Voucher ----
    let voucherDiscount = 0
    let appliedCode: string | null = null
    let voucherId: string | null = null
    if (voucherCode) {
      const v = await validateVoucher(voucherCode, subtotal, items, device, session.sessionId, {
        tableNumber: session.tableNumber,
        context: 'order',
      })
      if (!v.ok) return fail(v.message || 'কুপন প্রযোজ্য নয়', 400, 'VOUCHER_INVALID')
      voucherDiscount = v.discount
      appliedCode = v.voucher!.code
      voucherId = v.voucher!.id
    }

    const total = Math.max(0, Math.round((subtotal - voucherDiscount) * 100) / 100)

    const order = await db.order.create({
      data: {
        tableId: session.tableId,
        tableNumber: session.tableNumber,
        sessionId: session.sessionId,
        status: ORDER_STATUS.PLACED,
        subtotal,
        happyHourDiscount: Math.round(happyHourDiscount * 100) / 100,
        voucherDiscount,
        total,
        voucherCode: appliedCode,
        items: { create: orderItems },
      },
      include: { items: true },
    })

    if (voucherId) {
      await recordVoucherUse(voucherId, session.sessionId, device, {
        orderId: order.id,
        tableNumber: order.tableNumber,
        code: appliedCode,
        discount: voucherDiscount,
      })
    }

    await appendLedger({
      type: LEDGER_TYPES.ORDER_PLACED,
      sessionId: session.sessionId,
      deviceId,
      deviceFp,
      tableNumber: order.tableNumber,
      payload: { orderNo: order.orderNo, subtotal: order.subtotal, total: order.total, voucherCode: appliedCode },
    })

    emitEvent('order:new', {
      id: order.id,
      orderNo: order.orderNo,
      tableNumber: order.tableNumber,
      status: order.status,
      placedAt: order.placedAt,
      items: order.items.map((i) => ({ itemName: i.itemName, quantity: i.quantity, spiceLevel: i.spiceLevel, addons: i.addons, specialNote: i.specialNote })),
    })

    return ok({
      order: {
        id: order.id,
        orderNo: order.orderNo,
        status: order.status,
        tableNumber: order.tableNumber,
        subtotal: order.subtotal,
        happyHourDiscount: order.happyHourDiscount,
        voucherDiscount: order.voucherDiscount,
        birthdayDiscount: order.birthdayDiscount,
        total: order.total,
      },
    })
  } catch (e) {
    console.error('[orders:POST]', e)
    return fail('অর্ডার নেওয়া যায়নি, আবার চেষ্টা করুন', 500)
  }
}

export async function GET() {
  const session = await getValidSession()
  if (!session) return fail('অবৈধ সেশন', 403, 'SESSION_INVALID')

  const orders = await db.order.findMany({
    where: { sessionId: session.sessionId },
    orderBy: { placedAt: 'desc' },
    include: { items: true },
  })

  return ok({
    tableNumber: session.tableNumber,
    orders: orders.map((o) => ({
      id: o.id,
      orderNo: o.orderNo,
      status: o.status,
      subtotal: o.subtotal,
      happyHourDiscount: o.happyHourDiscount,
      voucherDiscount: o.voucherDiscount,
      birthdayDiscount: o.birthdayDiscount,
      total: o.total,
      placedAt: o.placedAt,
      items: o.items.map((i) => ({
        itemName: i.itemName,
        quantity: i.quantity,
        spiceLevel: i.spiceLevel,
        addons: parseJSON<{ name: string; price: number }[]>(i.addons, []),
        specialNote: i.specialNote,
        lineTotal: i.lineTotal,
      })),
    })),
  })
}
