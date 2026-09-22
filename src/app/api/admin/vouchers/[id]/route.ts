// PATCH/DELETE /api/admin/vouchers/[id]
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, fail, isAdmin } from '@/lib/api'
import { requirePerm } from '@/lib/staff-auth'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requirePerm('vouchers')
  if (denied) return denied
  const { id } = await params
  const body = await req.json().catch(() => ({}))

  const data: Record<string, unknown> = {}
  if (body.title !== undefined) data.title = body.title.toString().trim()
  if (body.description !== undefined) data.description = body.description || null
  if (body.discountValue !== undefined) {
    const v = parseFloat(body.discountValue)
    if (isNaN(v) || v <= 0) return fail('সঠিক ছাড় দিন', 400)
    data.discountValue = v
  }
  if (body.maxDiscount !== undefined) data.maxDiscount = body.maxDiscount ? parseFloat(body.maxDiscount) : null
  if (body.minOrderAmount !== undefined) data.minOrderAmount = parseFloat(body.minOrderAmount) || 0
  if (body.startTime !== undefined) data.startTime = body.startTime || null
  if (body.endTime !== undefined) data.endTime = body.endTime || null
  if (body.daysOfWeek !== undefined) data.daysOfWeek = Array.isArray(body.daysOfWeek) && body.daysOfWeek.length > 0 ? JSON.stringify(body.daysOfWeek) : null
  if (body.specificDate !== undefined) data.specificDate = body.specificDate ? new Date(body.specificDate) : null
  if (body.setMenuIds !== undefined) data.setMenuIds = Array.isArray(body.setMenuIds) && body.setMenuIds.length > 0 ? JSON.stringify(body.setMenuIds) : null
  if (body.minQuantity !== undefined) data.minQuantity = body.minQuantity ? parseInt(body.minQuantity, 10) : null
  if (body.usageLimit !== undefined) data.usageLimit = body.usageLimit ? parseInt(body.usageLimit, 10) : null
  if (body.singleUse !== undefined) data.singleUse = Boolean(body.singleUse)
  if (body.active !== undefined) data.active = Boolean(body.active)

  try {
    const voucher = await db.voucher.update({ where: { id }, data })
    return ok({ voucher })
  } catch {
    return fail('আপডেট ব্যর্থ', 400)
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    await db.voucher.delete({ where: { id } })
    return ok({ deleted: true })
  } catch {
    return fail('ডিলিট ব্যর্থ', 400)
  }
}
