// PUT    /api/admin/receipts/[id] — edit payment method / paid time (syncs to orders too)
// DELETE /api/admin/receipts/[id] — remove the whole transaction from EVERYWHERE:
//   receipt + its orders + order items + voucher-use rollback (usedCount decremented).
//   After deletion the amount/order no longer counts in history, overview or analytics.
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, fail, parseJSON } from '@/lib/api'
import { requirePerm } from '@/lib/staff-auth'
import { appendLedger, LEDGER_TYPES } from '@/lib/ledger'

const METHODS = ['CASH', 'CARD', 'BKASH', 'NAGAD', 'ONLINE']

interface ReceiptOrderRef {
  orderNo: number
}

/** extract order numbers stored in the receipt snapshot */
function orderNosOf(itemsJson: string): number[] {
  const parsed = parseJSON<ReceiptOrderRef[]>(itemsJson, [])
  return parsed
    .map((o) => Number(o?.orderNo))
    .filter((n) => Number.isFinite(n) && n > 0)
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requirePerm('tables')
  if (denied) return denied
  const { id } = await params

  const receipt = await db.receipt.findUnique({ where: { id } })
  if (!receipt) return fail('রসিদ পাওয়া যায়নি', 404)

  const body = await req.json().catch(() => ({}))
  const data: { paymentMethod?: string; paidAt?: Date } = {}

  if (body.paymentMethod !== undefined && body.paymentMethod !== null && body.paymentMethod !== '') {
    if (!METHODS.includes(String(body.paymentMethod))) return fail('ভুল পেমেন্ট মেথড', 400)
    data.paymentMethod = String(body.paymentMethod)
  }
  if (body.paidAt) {
    const d = new Date(String(body.paidAt))
    if (isNaN(d.getTime())) return fail('ভুল তারিখ/সময়', 400)
    data.paidAt = d
  }
  if (Object.keys(data).length === 0) return fail('পেমেন্ট মেথড বা সময় — কিছু একটা দিন', 400)

  const nos = orderNosOf(receipt.itemsJson)
  await db.$transaction([
    db.receipt.update({ where: { id }, data }),
    ...(data.paymentMethod
      ? [db.order.updateMany({ where: { orderNo: { in: nos } }, data: { paymentMethod: data.paymentMethod } })]
      : []),
    ...(data.paidAt
      ? [db.order.updateMany({ where: { orderNo: { in: nos } }, data: { paidAt: data.paidAt } })]
      : []),
  ])

  await appendLedger({
    type: LEDGER_TYPES.TRANSACTION_EDITED,
    sessionId: receipt.sessionId,
    tableNumber: receipt.tableNumber,
    payload: {
      receiptNo: receipt.receiptNo,
      paymentMethod: data.paymentMethod ?? null,
      paidAt: data.paidAt ? data.paidAt.toISOString() : null,
    },
  })

  return ok({ updated: true })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requirePerm('tables')
  if (denied) return denied
  const { id } = await params

  const receipt = await db.receipt.findUnique({ where: { id } })
  if (!receipt) return fail('রসিদ পাওয়া যায়নি', 404)

  const nos = orderNosOf(receipt.itemsJson)
  const orders = await db.order.findMany({
    where: { orderNo: { in: nos } },
    select: { id: true },
  })
  const orderIds = orders.map((o) => o.id)

  // voucher uses of this session — roll back the ones tied to the deleted
  // orders (or all, when nothing else remains in the session)
  const uses = await db.voucherUse.findMany({
    where: { sessionId: receipt.sessionId },
    select: { id: true, voucherId: true, orderId: true },
  })
  const remainingElsewhere = await db.order.count({
    where: { sessionId: receipt.sessionId, ...(orderIds.length ? { id: { notIn: orderIds } } : {}) },
  })
  const rollback = uses.filter(
    (u) => (u.orderId && orderIds.includes(u.orderId)) || remainingElsewhere === 0
  )
  const dec = new Map<string, number>()
  for (const u of rollback) dec.set(u.voucherId, (dec.get(u.voucherId) || 0) + 1)

  await db.$transaction([
    db.order.deleteMany({ where: { id: { in: orderIds } } }), // order_items cascade via FK
    db.voucherUse.deleteMany({ where: { id: { in: rollback.map((u) => u.id) } } }),
    ...[...dec.entries()].map(([vid, c]) =>
      db.voucher.update({ where: { id: vid }, data: { usedCount: { decrement: c } } })
    ),
    db.receipt.delete({ where: { id } }),
  ])

  // security log (hash-chain entry) — deletion is deliberate, must stay traceable
  await appendLedger({
    type: LEDGER_TYPES.TRANSACTION_DELETED,
    sessionId: receipt.sessionId,
    tableNumber: receipt.tableNumber,
    payload: {
      receiptNo: receipt.receiptNo,
      total: receipt.total,
      orders: orderIds.length,
      method: receipt.paymentMethod,
    },
  })

  return ok({ deleted: true, receiptNo: receipt.receiptNo })
}
