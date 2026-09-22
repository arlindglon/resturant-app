// PATCH/DELETE /api/admin/menu-items/[id] — includes instant Out of Stock toggle
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, fail, isAdmin } from '@/lib/api'
import { requirePerm } from '@/lib/staff-auth'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requirePerm('menu')
  if (denied) return denied
  const { id } = await params
  const body = await req.json().catch(() => ({}))

  const data: Record<string, unknown> = {}
  if (body.name !== undefined) data.name = body.name.toString().trim()
  if (body.description !== undefined) data.description = body.description || null
  if (body.price !== undefined) {
    const p = parseFloat(body.price)
    if (isNaN(p) || p < 0) return fail('সঠিক দাম দিন', 400)
    data.price = p
  }
  if (body.categoryId !== undefined) data.categoryId = body.categoryId
  if (body.imageUrl !== undefined) data.imageUrl = body.imageUrl || null
  if (body.isAvailable !== undefined) data.isAvailable = Boolean(body.isAvailable) // Out of Stock switch
  if (body.isSetMenu !== undefined) data.isSetMenu = Boolean(body.isSetMenu)
  if (body.spiceLevels !== undefined) data.spiceLevels = body.spiceLevels ? JSON.stringify(body.spiceLevels) : null
  if (body.addons !== undefined) data.addons = body.addons ? JSON.stringify(body.addons) : null
  if (body.upsellIds !== undefined) data.upsellIds = body.upsellIds ? JSON.stringify(body.upsellIds) : null
  if (body.sortOrder !== undefined) data.sortOrder = parseInt(body.sortOrder, 10) || 0

  try {
    const item = await db.menuItem.update({ where: { id }, data })
    return ok({ item })
  } catch {
    return fail('আপডেট ব্যর্থ', 400)
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    await db.menuItem.delete({ where: { id } })
    return ok({ deleted: true })
  } catch {
    return fail('ডিলিট ব্যর্থ', 400)
  }
}
