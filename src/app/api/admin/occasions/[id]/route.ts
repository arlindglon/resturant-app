// PATCH/DELETE /api/admin/occasions/[id]
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, fail } from '@/lib/api'
import { requirePerm } from '@/lib/staff-auth'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requirePerm('settings')
  if (denied) return denied
  const { id } = await params
  const body = await req.json().catch(() => ({}))

  const existing = await db.occasionOffer.findUnique({ where: { id } })
  if (!existing) return fail('অকেশন পাওয়া যায়নি', 404)

  const data: Record<string, unknown> = {}
  if (typeof body.name === 'string' && body.name.trim()) data.name = body.name.trim().slice(0, 80)
  if (typeof body.emoji === 'string' && body.emoji.trim()) data.emoji = body.emoji.trim().slice(0, 8)
  if (typeof body.dateLabel === 'string') data.dateLabel = body.dateLabel.trim().slice(0, 80)
  if (typeof body.description === 'string') data.description = body.description.trim().slice(0, 300) || null
  if (body.discount !== undefined) {
    const d = parseFloat(body.discount)
    if (isNaN(d) || d <= 0) return fail('ছাড়ের পরিমাণ (৳) দিন', 400)
    data.discount = d
  }
  if (body.minBill !== undefined) {
    const m = parseFloat(body.minBill)
    if (isNaN(m) || m < 0) return fail('ন্যূনতম বিল (৳) দিন', 400)
    data.minBill = m
  }
  if (typeof body.active === 'boolean') data.active = body.active
  if (body.sortOrder !== undefined) data.sortOrder = parseInt(body.sortOrder, 10) || 0

  const occasion = await db.occasionOffer.update({ where: { id }, data })
  return ok({ occasion })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requirePerm('settings')
  if (denied) return denied
  const { id } = await params
  const existing = await db.occasionOffer.findUnique({ where: { id } })
  if (!existing) return fail('অকেশন পাওয়া যায়নি', 404)
  await db.occasionOffer.delete({ where: { id } })
  return ok({ deleted: true })
}
