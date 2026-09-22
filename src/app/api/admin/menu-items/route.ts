// Menu items CRUD
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, fail, isAdmin } from '@/lib/api'
import { requirePerm } from '@/lib/staff-auth'

export async function GET() {
  const denied = await requirePerm('menu')
  if (denied) return denied
  const items = await db.menuItem.findMany({
    orderBy: { sortOrder: 'asc' },
    include: { category: { select: { id: true, name: true } } },
  })
  return ok({ items })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))

  const name = (body.name || '').toString().trim()
  const categoryId = (body.categoryId || '').toString()
  const price = parseFloat(body.price)
  if (!name) return fail('আইটেমের নাম প্রয়োজন', 400)
  if (!categoryId) return fail('ক্যাটাগরি নির্বাচন করুন', 400)
  if (isNaN(price) || price < 0) return fail('সঠিক দাম দিন', 400)

  const item = await db.menuItem.create({
    data: {
      name,
      categoryId,
      price,
      description: body.description || null,
      imageUrl: body.imageUrl || null,
      isAvailable: body.isAvailable !== false,
      isSetMenu: Boolean(body.isSetMenu),
      spiceLevels: body.spiceLevels ? JSON.stringify(body.spiceLevels) : null,
      addons: body.addons ? JSON.stringify(body.addons) : null,
      upsellIds: body.upsellIds ? JSON.stringify(body.upsellIds) : null,
    },
  })
  return ok({ item })
}
