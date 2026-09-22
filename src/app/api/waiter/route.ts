// Waiter calls
// POST /api/waiter — customer sends signal (session required)
// GET  /api/waiter — list (admin/kds)
// PATCH /api/waiter — resolve (admin/kds)
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, fail, isAdmin } from '@/lib/api'
import { getValidSession } from '@/lib/session'
import { WAITER_TYPES } from '@/lib/constants'
import { emitEvent } from '@/lib/emit'

export async function POST(req: NextRequest) {
  const session = await getValidSession()
  if (!session) return fail('অবৈধ সেশন', 403, 'SESSION_INVALID')

  const body = await req.json().catch(() => ({}))
  const type = body.type as string
  if (!(Object.values(WAITER_TYPES) as string[]).includes(type)) return fail('অবৈধ সিগন্যাল টাইপ', 400)

  // rate limit: same table+type pending within 30s → ignore
  const recent = await db.waiterCall.findFirst({
    where: {
      tableId: session.tableId,
      type,
      status: 'PENDING',
      createdAt: { gte: new Date(Date.now() - 30_000) },
    },
  })
  if (recent) return ok({ call: recent, throttled: true })

  const call = await db.waiterCall.create({
    data: { tableId: session.tableId, tableNumber: session.tableNumber, type, status: 'PENDING' },
  })

  emitEvent('waiter:new', { id: call.id, tableNumber: call.tableNumber, type: call.type, createdAt: call.createdAt })
  return ok({ call, throttled: false })
}

export async function GET(req: NextRequest) {
  if (!(await isAdmin())) {
    // KDS also reads this — allow without admin but only pending list
    const status = req.nextUrl.searchParams.get('status') || 'PENDING'
    const calls = await db.waiterCall.findMany({
      where: { status },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
    return ok({ calls })
  }
  const calls = await db.waiterCall.findMany({ orderBy: { createdAt: 'desc' }, take: 100 })
  return ok({ calls })
}

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const { id, status } = body
  if (!id || !status) return fail('id ও status প্রয়োজন', 400)

  const call = await db.waiterCall.update({
    where: { id },
    data: { status, resolvedAt: status === 'DONE' ? new Date() : null },
  })

  emitEvent('waiter:resolved', { id: call.id, status })
  return ok({ call })
}
