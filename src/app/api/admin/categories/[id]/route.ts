// PATCH/DELETE /api/admin/categories/[id]
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
  if (body.imageUrl !== undefined) data.imageUrl = body.imageUrl || null
  if (body.sortOrder !== undefined) data.sortOrder = parseInt(body.sortOrder, 10) || 0
  if (body.active !== undefined) data.active = Boolean(body.active)

  try {
    const category = await db.category.update({ where: { id }, data })
    return ok({ category })
  } catch {
    return fail('আপডেট ব্যর্থ', 400)
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    await db.category.delete({ where: { id } })
    return ok({ deleted: true })
  } catch {
    return fail('ডিলিট ব্যর্থ', 400)
  }
}
