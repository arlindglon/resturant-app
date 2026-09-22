// GET /api/bill — session bill summary + birthday offer eligibility
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, fail, parseJSON } from '@/lib/api'
import { getValidSession } from '@/lib/session'
import { getSetting, getSettingNumber } from '@/lib/settings'
import { SETTING_KEYS } from '@/lib/constants'
import { deviceIdentity, deviceMatch } from '@/lib/device'

export async function GET(req: NextRequest) {
  const session = await getValidSession()
  if (!session) return fail('অবৈধ সেশন', 403, 'SESSION_INVALID')

  const [orders, birthdayAmount, minBill, messengerEnabled, occasions] = await Promise.all([
    db.order.findMany({
      where: { sessionId: session.sessionId, status: { notIn: ['CANCELLED'] } },
      orderBy: { placedAt: 'asc' },
      include: { items: true },
    }),
    getSettingNumber(SETTING_KEYS.BIRTHDAY_DISCOUNT_AMOUNT, 50),
    getSettingNumber(SETTING_KEYS.BIRTHDAY_MIN_BILL, 500),
    getSetting(SETTING_KEYS.MESSENGER_AUTO_REPLY_ENABLED),
    db.occasionOffer.findMany({ where: { active: true }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }),
  ])

  const subtotal = orders.reduce((s, o) => s + o.subtotal, 0)
  const voucherDiscount = orders.reduce((s, o) => s + o.voucherDiscount, 0)
  const birthdayDiscount = orders.reduce((s, o) => s + o.birthdayDiscount, 0)
  const happyHourDiscount = orders.reduce((s, o) => s + o.happyHourDiscount, 0)
  const total = orders.reduce((s, o) => s + o.total, 0) // totals already exclude discounts

  const sessionRow = await db.tableSession.findUnique({ where: { id: session.sessionId } })
  const alreadyClaimed = Boolean(sessionRow?.birthdayGranted)

  // ── anti-repeat: has THIS device (id or fingerprint) claimed at any table ever?
  const device = deviceIdentity(req)
  const dm = deviceMatch(device)
  const deviceAlreadyClaimed = dm.length > 0 ? Boolean(await db.birthdayClaim.findFirst({ where: { OR: dm } })) : false

  // ── payment state (admin marked the bill paid)
  const paidOrders = orders.filter((o) => o.billPaid)
  const billPaid = orders.length > 0 && paidOrders.length === orders.length
  const lastPaid = paidOrders.length > 0 ? paidOrders[paidOrders.length - 1] : null

  // printable receipt (created when admin collected the bill)
  const receipt = await db.receipt.findFirst({
    where: { sessionId: session.sessionId },
    orderBy: { paidAt: 'desc' },
    select: { id: true, receiptNo: true },
  })

  return ok({
    tableNumber: session.tableNumber,
    orders: orders.map((o) => ({
      id: o.id,
      orderNo: o.orderNo,
      status: o.status,
      subtotal: o.subtotal,
      returnedAmount: o.returnedAmount,
      voucherDiscount: o.voucherDiscount,
      happyHourDiscount: o.happyHourDiscount,
      birthdayDiscount: o.birthdayDiscount,
      total: o.total,
      billPaid: o.billPaid,
      paidAt: o.paidAt,
      paymentMethod: o.paymentMethod,
      placedAt: o.placedAt,
      items: o.items.map((i) => ({
        itemName: i.itemName,
        quantity: i.quantity,
        returnedQty: i.returnedQty,
        unitPrice: i.unitPrice,
        spiceLevel: i.spiceLevel,
        addons: parseJSON<{ name: string; price: number }[]>(i.addons, []),
        specialNote: i.specialNote,
        lineTotal: i.lineTotal,
      })),
    })),
    summary: {
      subtotal: Math.round(subtotal * 100) / 100,
      happyHourDiscount,
      voucherDiscount,
      birthdayDiscount,
      payable: Math.round(total * 100) / 100,
    },
    payment: {
      billPaid,
      paymentMethod: lastPaid?.paymentMethod || null,
      paidAt: lastPaid?.paidAt || null,
      receiptId: receipt?.id || null,
      receiptNo: receipt?.receiptNo || null,
    },
    birthdayOffer: {
      // master switch from admin panel + a device that ever claimed never sees the offer again
      enabled: messengerEnabled !== 'false',
      eligible: messengerEnabled !== 'false' && subtotal >= minBill && !alreadyClaimed && !deviceAlreadyClaimed,
      amount: birthdayAmount,
      minBill,
      alreadyClaimed,
      deviceAlreadyClaimed,
    },
    occasions: occasions.map((o) => ({
      id: o.id,
      name: o.name,
      emoji: o.emoji,
      dateLabel: o.dateLabel,
      description: o.description,
      discount: o.discount,
      minBill: o.minBill,
      eligible: subtotal >= o.minBill,
    })),
  })
}
