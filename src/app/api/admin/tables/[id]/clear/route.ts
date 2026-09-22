// POST /api/admin/tables/[id]/clear — "Clear Table": permanently kills the
// HMAC session so the saved link can never order again (HTTP 403 afterwards).
// CASCADE: pending (not-yet-cooked) orders → CANCELLED so KDS/admin never cook
// a dead order; open waiter calls → DONE. Cooking/ready/served orders are kept
// for the historical record (they were actually made).
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, fail } from '@/lib/api'
import { destroySession } from '@/lib/session'
import { ORDER_STATUS, TABLE_STATUS } from '@/lib/constants'
import { emitEvent } from '@/lib/emit'
import { appendLedger, LEDGER_TYPES } from '@/lib/ledger'
import { requirePerm } from '@/lib/staff-auth'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requirePerm('tables')
  if (denied) return denied
  const { id } = await params

  const table = await db.restaurantTable.findUnique({ where: { id } })
  if (!table) return fail('টেবিল পাওয়া যায়নি', 404)

  // 1) destroy all active sessions of this table
  const activeSessions = await db.tableSession.findMany({
    where: { tableId: id, active: true, clearedAt: null },
  })
  for (const s of activeSessions) {
    await destroySession(s.id)
  }

  // 2) pending orders (still waiting to be cooked) → CANCELLED + notify
  const sessionIds = activeSessions.map((s) => s.id)
  let cancelledOrders = 0
  if (sessionIds.length > 0) {
    const pendingOrders = await db.order.findMany({
      where: { tableId: id, sessionId: { in: sessionIds }, status: { in: [ORDER_STATUS.PLACED, ORDER_STATUS.COOKING] } },
    })
    for (const o of pendingOrders) {
      await db.order.update({
        where: { id: o.id },
        data: { status: ORDER_STATUS.CANCELLED },
      })
      emitEvent('order:status', { orderId: o.id, orderNo: o.orderNo, tableNumber: o.tableNumber, status: ORDER_STATUS.CANCELLED })
      cancelledOrders++
    }

    // 3) open waiter calls → resolved
    await db.waiterCall.updateMany({
      where: { tableId: id, status: 'PENDING' },
      data: { status: 'DONE', resolvedAt: new Date() },
    })

    // 4) ledger audit block
    await appendLedger({
      type: LEDGER_TYPES.SESSION_CLEARED,
      tableNumber: table.number,
      payload: { sessionsKilled: activeSessions.length, cancelledOrders },
    })
  }

  await db.restaurantTable.update({
    where: { id },
    data: { status: TABLE_STATUS.FREE },
  })

  emitEvent('table:cleared', { tableNumber: table.number })
  return ok({ cleared: true, sessionsKilled: activeSessions.length, cancelledOrders })
}
