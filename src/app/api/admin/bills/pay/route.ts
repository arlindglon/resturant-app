// POST /api/admin/bills/pay — mark a table session's bill as PAID.
// Body: { sessionId, method: "CASH"|"CARD"|"BKASH"|"NAGAD"|"ONLINE" }
// Marks every non-cancelled order of the session billPaid + COMPLETED,
// writes a BILL_PAID block to the security ledger and notifies clients.
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, fail, isAdmin } from '@/lib/api'
import { ORDER_STATUS } from '@/lib/constants'
import { appendLedger, LEDGER_TYPES } from '@/lib/ledger'
import { emitEvent } from '@/lib/emit'
import { requirePerm } from '@/lib/staff-auth'

const METHODS = ['CASH', 'CARD', 'BKASH', 'NAGAD', 'ONLINE'] as const

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

  const payable = Math.round(orders.reduce((s, o) => s + o.total, 0) * 100) / 100
  const now = new Date()

  await db.$transaction([
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

  // notify customer bill page (polls) + ledger block
  emitEvent('bill:paid', { sessionId, tableNumber: session.table.number, method, payable })
  await appendLedger({
    type: LEDGER_TYPES.BILL_PAID,
    sessionId,
    tableNumber: session.table.number,
    payload: { method, payable, orders: orders.length, paidAt: now.toISOString() },
  })

  // ── permanent receipt record (transaction history + printable invoice) ──
  const receiptSubtotal = Math.round(orders.reduce((s, o) => s + o.subtotal, 0) * 100) / 100
  const receiptDiscount =
    Math.round(orders.reduce((s, o) => s + o.happyHourDiscount + o.voucherDiscount + o.birthdayDiscount, 0) * 100) / 100
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
        orders.map((o) => ({
          orderNo: o.orderNo,
          placedAt: o.placedAt,
          items: o.items.map((i) => ({
            name: i.itemName,
            qty: i.quantity,
            unitPrice: i.unitPrice,
            spiceLevel: i.spiceLevel,
            addons: i.addons,
            specialNote: i.specialNote,
            lineTotal: i.lineTotal,
          })),
          subtotal: o.subtotal,
          happyHourDiscount: o.happyHourDiscount,
          voucherDiscount: o.voucherDiscount,
          birthdayDiscount: o.birthdayDiscount,
          voucherCode: o.voucherCode,
          total: o.total,
        }))
      ),
      paidAt: now,
    },
  })

  return ok({
    sessionId,
    tableNumber: session.table.number,
    method,
    payable,
    receiptId: receipt.id,
    receiptNo: receipt.receiptNo,
    ordersPaid: orders.filter((o) => !o.billPaid).length || orders.length,
  })
}
