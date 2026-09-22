// Happy Hours CRUD
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, fail, isAdmin } from '@/lib/api'
import { parseDateRange } from '@/lib/happyhour'
import { requirePerm } from '@/lib/staff-auth'

export async function GET() {
  const denied = await requirePerm('happy')
  if (denied) return denied
  const rules = await db.happyHour.findMany({ orderBy: { createdAt: 'desc' } })
  return ok({ happyHours: rules })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))

  const name = (body.name || '').toString().trim()
  const percent = parseFloat(body.discountPercent)
  if (!name) return fail('নাম প্রয়োজন', 400)
  if (isNaN(percent) || percent <= 0 || percent > 90) return fail('১-৯০% এর মধ্যে ছাড় দিন', 400)
  if (!/^\d{2}:\d{2}$/.test(body.startTime || '') || !/^\d{2}:\d{2}$/.test(body.endTime || '')) {
    return fail('সঠিক সময় দিন (HH:mm)', 400)
  }

  let dateRange
  try {
    dateRange = parseDateRange(body.startDate, body.endDate)
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'তারিখ ভুল', 400)
  }

  const rule = await db.happyHour.create({
    data: {
      name,
      discountPercent: percent,
      daysOfWeek: JSON.stringify(Array.isArray(body.daysOfWeek) ? body.daysOfWeek : []),
      startTime: body.startTime,
      endTime: body.endTime,
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
      itemIds: Array.isArray(body.itemIds) && body.itemIds.length > 0 ? JSON.stringify(body.itemIds) : null,
      active: body.active !== false,
    },
  })
  return ok({ happyHour: rule })
}
