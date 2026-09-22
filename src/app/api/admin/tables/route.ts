// Tables CRUD
// GET /api/admin/tables, POST create
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, fail, isAdmin } from '@/lib/api'
import { requirePerm } from '@/lib/staff-auth'

export async function GET() {
  const denied = await requirePerm('tables')
  if (denied) return denied
  const tables = await db.restaurantTable.findMany({
    orderBy: { number: 'asc' },
    include: {
      sessions: {
        where: { active: true, clearedAt: null },
        orderBy: { scannedAt: 'desc' },
        take: 1,
      },
      _count: { select: { orders: true } },
    },
  })
  return ok({
    tables: tables.map((t) => ({
      id: t.id,
      number: t.number,
      seats: t.seats,
      status: t.status,
      totalOrders: t._count.orders,
      activeSession: t.sessions[0]
        ? { id: t.sessions[0].id, scannedAt: t.sessions[0].scannedAt, expiresAt: t.sessions[0].expiresAt }
        : null,
    })),
  })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const number = parseInt(body.number, 10)
  const seats = parseInt(body.seats, 10) || 4
  if (!number || isNaN(number)) return fail('টেবিল নম্বর প্রয়োজন', 400)

  const exists = await db.restaurantTable.findUnique({ where: { number } })
  if (exists) return fail('এই নম্বরের টেবিল আছে', 400)

  const table = await db.restaurantTable.create({ data: { number, seats } })
  return ok({ table })
}
