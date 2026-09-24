// POST /api/admin/bills/pay — mark a table session's bill as PAID.
// Body: {
//   sessionId,
//   method: "CASH"|"CARD"|"BKASH"|"NAGAD"|"ONLINE",
//   returns?: [{ orderId, itemId, returnedQty }]   // bill-time item returns
// }
// BILL-READINESS GUARD: সব অর্ডার সার্ভ হওয়ার আগে (ও খাওয়া-দাওয়া শেষ হওয়ার
// আগে) বিল নেওয়া যাবে না — অপরিশোধিত প্রতিটি অর্ডার অবশ্যই SERVED হতে হবে।
// Marks every non-cancelled order of the session billPaid + COMPLETED.
// AUTO TABLE CLEAR: বিল পরিশোধ হতেই টেবিল অটো-ক্লিয়ার — active সেশন ধ্বংস
// (পুরনো QR লিঙ্ক আর কাজ করবে না), টেবিল → FREE, খোলা ওয়েটার কল → DONE।
// RETURNS: the admin can exclude returned items right at bill collection —
//   • per item: lineTotal is recomputed as (quantity − returnedQty) × unitPrice
//   • ANTI-SCAM RULE: if ANY item of the session is returned, EVERY
//     promo/voucher discount of the session is auto-voided (0) — otherwise a
//     customer could save money with a coupon at order time and then return
//     food at bill time. (Happy-hour savings are already baked into the
//     unitPrice snapshot and birthday/occasion discounts stay as-is.)
// Writes BILL_PAID (+ ITEM_RETURNED + SESSION_CLEARED) blocks to the ledger.
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, fail } from '@/lib/api'
import { ORDER_STATUS, TABLE_STATUS } from '@/lib/constants'
import { appendLedger, LEDGER_TYPES } from '@/lib/ledger'
import { destroySession } from '@/lib/session'
import { emitEvent } from '@/lib/emit'
import { requirePerm } from '@/lib/staff-auth'

const METHODS = ['CASH', 'CARD', 'BKASH', 'NAGAD', 'ONLINE'] as const

/** বিল-রেডিনেস এররে দেখানোর জন্য অর্ডার স্ট্যাটাসের বাংলা নাম */
const STATUS_BN: Record<string, string> = {
  PLACED: 'প্লেসড',
  COOKING: 'রান্নায়',
  READY: 'রেডি — পরিবেশন বাকি',
  SERVED: 'সার্ভড',
  COMPLETED: 'সম্পন্ন',
  CANCELLED: 'বাতিল',
}

interface ReturnLine {
  orderId: string
  itemId: string
  returnedQty: number
}

const r2 = (n: number) => Math.round(n * 100) / 100

export async function POST(req: NextRequest) {
  const denied = await requirePerm('tables')
  if (denied) return denied

  const body = await req.json().catch(() => ({}))
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
  const method = METHODS.includes(body.method) ? body.method : 'CASH'

  if (!sessionId) return fail('sessionId প্রয়োজন', 400)

  const session = await db.tableSession.findUnique({
    where: { id: sessionId },
    include: { table: true },
  })
  if (!session) return fail('সেশন পাওয়া যায়নি', 404)

  const orders = await db.order.findMany({
    where: { sessionId, status: { notIn: ['CANCELLED'] } },
    include: { items: true },
    orderBy: { placedAt: 'asc' },
  })
  if (orders.length === 0) return fail('এই সেশনে বিল করার মতো কোনো অর্ডার নেই', 400)

  const alreadyPaid = orders.every((o) => o.billPaid)
  if (alreadyPaid) return fail('এই বিল আগেই পরিশোধ হয়েছে', 400)

  // ── BILL-READINESS GUARD: serve first, bill later ────────────────────
  // অপরিশোধিত প্রতিটি অর্ডার সার্ভড হতে হবে — রান্নায়/রেডি থাকলে বিল নয়।
  // (আগেই পরিশোধিত অর্ডার COMPLETED — ওগুলো বাদ; আংশিক বিলের পর নতুন
  // অর্ডার এলে শুধু নতুনগুলোই সার্ভ হওয়া দেখা হয়)
  const notServed = orders.filter(
    (o) => !o.billPaid && o.status !== ORDER_STATUS.SERVED && o.status !== ORDER_STATUS.COMPLETED
  )
  if (notServed.length > 0) {
    const list = notServed.map((o) => `#${o.orderNo} — ${STATUS_BN[o.status] || o.status}`).join(', ')
    return fail(`সব খাবার সার্ভ ও খাওয়া-দাওয়া শেষ হওয়ার আগে বিল নেওয়া যাবে না (বাকি: ${list})`, 400)
  }

  // ── parse & validate requested returns ──────────────────────────────
  const rawReturns: ReturnLine[] = Array.isArray(body.returns) ? body.returns : []
  const itemsById = new Map(orders.flatMap((o) => o.items).map((i) => [i.id, i]))
  const returns = new Map<string, number>() // orderItemId -> returnedQty
  for (const r of rawReturns) {
    if (!r || typeof r.orderId !== 'string' || typeof r.itemId !== 'string') continue
    if (!orders.some((o) => o.id === r.orderId)) {
      return fail('রিটার্নের অর্ডারটি এই সেশনে নেই', 400)
    }
    const item = itemsById.get(r.itemId)
    if (!item || item.orderId !== r.orderId) {
      return fail('রিটার্নের আইটেমটি খুঁজে পাওয়া যায়নি', 400)
    }
    const qty = Math.floor(Number(r.returnedQty))
    if (!Number.isFinite(qty) || qty < 0 || qty > item.quantity) {
      return fail(`${item.itemName}-এর রিটার্ন সংখ্যা সঠিক নয় (সর্বোচ্চ ${item.quantity})`, 400)
    }
    if (qty > 0) returns.set(item.id, qty)
  }

  const anyReturn = returns.size > 0

  // ── recompute per-order totals with returns + voucher void ─────────
  // voucher void is SESSION-WIDE (anti-scam): one return kills every coupon
  // discount on this table's bill
  const orderUpdates: { id: string; subtotal: number; voucherDiscount: number; returnedAmount: number; total: number }[] = []
  for (const o of orders) {
    let newSubtotal = 0
    let returnedAmount = 0
    for (const it of o.items) {
      const rq = returns.get(it.id) ?? 0
      newSubtotal += (it.quantity - rq) * it.unitPrice
      returnedAmount += rq * it.unitPrice
    }
    newSubtotal = r2(newSubtotal)
    returnedAmount = r2(returnedAmount)
    // ANTI-SCAM: any return in the session → coupon discount auto-voided
    const newVoucher = anyReturn ? 0 : o.voucherDiscount
    const newTotal = Math.max(0, r2(newSubtotal - newVoucher - o.birthdayDiscount))
    orderUpdates.push({ id: o.id, subtotal: newSubtotal, voucherDiscount: newVoucher, returnedAmount, total: newTotal })
  }

  const payable = r2(orderUpdates.reduce((s, u) => s + u.total, 0))
  const returnTotal = r2(orderUpdates.reduce((s, u) => s + u.returnedAmount, 0))
  const voucherVoidedTotal = r2(orders.reduce((s, o) => s + (anyReturn ? o.voucherDiscount : 0), 0))
  const now = new Date()

  await db.$transaction([
    // returned items → persisted (returnedQty + adjusted lineTotal)
    ...Array.from(returns.entries()).map(([itemId, rq]) => {
      const it = itemsById.get(itemId)!
      return db.orderItem.update({
        where: { id: itemId },
        data: { returnedQty: rq, lineTotal: r2((it.quantity - rq) * it.unitPrice) },
      })
    }),
    // orders → recomputed totals + coupon void
    ...orderUpdates.map((u) =>
      db.order.update({
        where: { id: u.id },
        data: {
          subtotal: u.subtotal,
          voucherDiscount: u.voucherDiscount,
          returnedAmount: u.returnedAmount,
          total: u.total,
        },
      })
    ),
    // unpaid orders → paid + completed
    ...orders
      .filter((o) => !o.billPaid)
      .map((o) =>
        db.order.update({
          where: { id: o.id },
          data: {
            billPaid: true,
            paidAt: now,
            paymentMethod: method,
            status: ORDER_STATUS.COMPLETED,
            completedAt: now,
          },
        })
      ),
  ])

  // ledger: return block first (audit trail), then the payment block
  if (anyReturn) {
    await appendLedger({
      type: LEDGER_TYPES.ITEM_RETURNED,
      sessionId,
      tableNumber: session.table.number,
      payload: {
        items: Array.from(returns.entries()).map(([itemId, rq]) => {
          const it = itemsById.get(itemId)!
          return { name: it.itemName, returnedQty: rq, unitPrice: it.unitPrice, value: r2(rq * it.unitPrice) }
        }),
        returnTotal,
        voucherVoided: anyReturn && voucherVoidedTotal > 0,
        voucherVoidedAmount: voucherVoidedTotal,
      },
    })
  }

  // notify customer bill page (polls) + ledger block
  emitEvent('bill:paid', { sessionId, tableNumber: session.table.number, method, payable })
  await appendLedger({
    type: LEDGER_TYPES.BILL_PAID,
    sessionId,
    tableNumber: session.table.number,
    payload: {
      method,
      payable,
      returnTotal,
      voucherVoidedTotal,
      orders: orders.length,
      paidAt: now.toISOString(),
    },
  })

  // ── permanent receipt record (transaction history + printable invoice) ──
  const receiptSubtotal = r2(orderUpdates.reduce((s, u) => s + u.subtotal, 0))
  const receiptDiscount =
    r2(
      orderUpdates.reduce(
        (s, u, ix) => s + orders[ix].happyHourDiscount + u.voucherDiscount + orders[ix].birthdayDiscount,
        0
      )
    )
  const voucherCodesVoided = orders
    .filter((o) => o.voucherCode && anyReturn)
    .map((o) => o.voucherCode as string)
  const receipt = await db.receipt.create({
    data: {
      sessionId,
      tableNumber: session.table.number,
      ordersCount: orders.length,
      subtotal: receiptSubtotal,
      discountTotal: receiptDiscount,
      total: payable,
      paymentMethod: method,
      itemsJson: JSON.stringify(
        orders.map((o, ix) => ({
          orderNo: o.orderNo,
          placedAt: o.placedAt,
          items: o.items.map((i) => ({
            name: i.itemName,
            qty: i.quantity,
            returnedQty: returns.get(i.id) ?? 0,
            unitPrice: i.unitPrice,
            spiceLevel: i.spiceLevel,
            addons: i.addons,
            specialNote: i.specialNote,
            lineTotal: r2((i.quantity - (returns.get(i.id) ?? 0)) * i.unitPrice),
          })),
          subtotal: orderUpdates[ix].subtotal,
          returnedAmount: orderUpdates[ix].returnedAmount,
          happyHourDiscount: o.happyHourDiscount,
          voucherDiscount: orderUpdates[ix].voucherDiscount,
          voucherVoided: anyReturn && o.voucherDiscount > 0,
          birthdayDiscount: o.birthdayDiscount,
          voucherCode: o.voucherCode,
          total: orderUpdates[ix].total,
        }))
      ),
      paidAt: now,
    },
  })

  // ── AUTO TABLE CLEAR: বিল পরিশোধ = খাওয়া-দাওয়ার সমাপ্তি ──────────────
  // পরিশোধ হতেই: ১) টেবিলের সব active সেশন স্থায়ীভাবে ধ্বংস (পুরনো QR লিঙ্ক
  // আর অর্ডার করতে পারে না), ২) খোলা ওয়েটার কল → DONE, ৩) টেবিল → FREE —
  // admin আর আলাদা করে "টেবিল ক্লিয়ার" চাপতে হয় না, নতুন কাস্টমার সাথে সাথেই
  // স্ক্যান করে নতুন সেশন খুলতে পারে।
  let tableCleared = false
  try {
    const activeSessions = await db.tableSession.findMany({
      where: { tableId: session.tableId, active: true, clearedAt: null },
    })
    for (const s of activeSessions) {
      await destroySession(s.id) // প্রতিটির জন্য SESSION_CLEARED লেজার ব্লকও যায়
    }
    await db.waiterCall.updateMany({
      where: { tableId: session.tableId, status: 'PENDING' },
      data: { status: 'DONE', resolvedAt: new Date() },
    })
    await db.restaurantTable.update({
      where: { id: session.tableId },
      data: { status: TABLE_STATUS.FREE },
    })
    emitEvent('table:cleared', { tableNumber: session.table.number })
    tableCleared = true
  } catch (e) {
    // পেমেন্ট অবশ্যই সফল — অটো-ক্লিয়ার কোনো কারণে আটকে গেলে admin ম্যানুয়ালি
    // ক্লিয়ার করতে পারবে; বিল/রসিদ কখনোই ব্যর্থ করা হবে না
    console.error('[bills:pay] auto table clear failed', e)
  }

  return ok({
    sessionId,
    tableNumber: session.table.number,
    method,
    payable,
    returnTotal,
    voucherVoidedTotal,
    voucherCodesVoided,
    receiptId: receipt.id,
    receiptNo: receipt.receiptNo,
    ordersPaid: orders.filter((o) => !o.billPaid).length || orders.length,
    tableCleared,
  })
}
