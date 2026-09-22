// Categories CRUD
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, fail, isAdmin } from '@/lib/api'
import { requirePerm } from '@/lib/staff-auth'

export async function GET() {
  const denied = await requirePerm('menu')
  if (denied) return denied
  const categories = await db.category.findMany({
    orderBy: { sortOrder: 'asc' },
    include: { _count: { select: { items: true } } },
  })
  return ok({ categories })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const name = (body.name || '').toString().trim()
  if (!name) return fail('ক্যাটাগরির নাম প্রয়োজন', 400)

  const max = await db.category.aggregate({ _max: { sortOrder: true } })
  const category = await db.category.create({
    data: {
      name,
      imageUrl: body.imageUrl || null,
      sortOrder: (max._max.sortOrder || 0) + 1,
    },
  })
  return ok({ category })
}
