// GET/POST /api/admin/occasions — occasion offers (birthday, anniversary,
// wedding, custom…) each with its own discount amount + minimum bill.
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, fail } from '@/lib/api'
import { requirePerm } from '@/lib/staff-auth'

export async function GET() {
  const denied = await requirePerm('settings')
  if (denied) return denied
  const occasions = await db.occasionOffer.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] })
  return ok({ occasions })
}

export async function POST(req: NextRequest) {
  const denied = await requirePerm('settings')
  if (denied) return denied
  const body = await req.json().catch(() => ({}))

  const name = (body.name || '').toString().trim().slice(0, 80)
  const emoji = (body.emoji || '🎉').toString().trim().slice(0, 8) || '🎉'
  const dateLabel = (body.dateLabel || '').toString().trim().slice(0, 80)
  const description = (body.description || '').toString().trim().slice(0, 300) || null
  const discount = parseFloat(body.discount)
  const minBill = parseFloat(body.minBill)
  const active = body.active !== false
  const sortOrder = parseInt(body.sortOrder, 10) || 0

  if (!name) return fail('অকেশনের নাম লিখুন', 400)
  if (isNaN(discount) || discount <= 0) return fail('ছাড়ের পরিমাণ (৳) দিন', 400)
  if (isNaN(minBill) || minBill < 0) return fail('ন্যূনতম বিল (৳) দিন', 400)

  const occasion = await db.occasionOffer.create({
    data: { name, emoji, dateLabel, description, discount, minBill, active, sortOrder },
  })
  return ok({ occasion })
}
