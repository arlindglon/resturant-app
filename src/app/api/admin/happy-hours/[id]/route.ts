// PATCH/DELETE /api/admin/happy-hours/[id]
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, fail, isAdmin } from '@/lib/api'
import { parseDateRange } from '@/lib/happyhour'
import { requirePerm } from '@/lib/staff-auth'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requirePerm('happy')
  if (denied) return denied
  const { id } = await params
  const body = await req.json().catch(() => ({}))

  const data: Record<string, unknown> = {}
  if (body.name !== undefined) data.name = body.name.toString().trim()
  if (body.discountPercent !== undefined) {
    const p = parseFloat(body.discountPercent)
    if (isNaN(p) || p <= 0 || p > 90) return fail('১-৯০% এর মধ্যে ছাড় দিন', 400)
    data.discountPercent = p
  }
  if (body.daysOfWeek !== undefined) data.daysOfWeek = JSON.stringify(Array.isArray(body.daysOfWeek) ? body.daysOfWeek : [])
  if (body.startTime !== undefined) data.startTime = body.startTime
  if (body.endTime !== undefined) data.endTime = body.endTime
  // date-range: only re-validate when either bound sent (avoid breaking the
  // simple "active toggle" PATCH which sends neither)
  if (body.startDate !== undefined || body.endDate !== undefined) {
    try {
      const range = parseDateRange(body.startDate, body.endDate)
      data.startDate = range.startDate
      data.endDate = range.endDate
    } catch (e) {
      return fail(e instanceof Error ? e.message : 'তারিখ ভুল', 400)
    }
  }
  if (body.itemIds !== undefined) data.itemIds = Array.isArray(body.itemIds) && body.itemIds.length > 0 ? JSON.stringify(body.itemIds) : null
  if (body.active !== undefined) data.active = Boolean(body.active)

  try {
    const happyHour = await db.happyHour.update({ where: { id }, data })
    return ok({ happyHour })
  } catch {
    return fail('আপডেট ব্যর্থ', 400)
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    await db.happyHour.delete({ where: { id } })
    return ok({ deleted: true })
  } catch {
    return fail('ডিলিট ব্যর্থ', 400)
  }
}
