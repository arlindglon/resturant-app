// Vouchers CRUD — full rule builder
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, fail, isAdmin } from '@/lib/api'
import { DISCOUNT_TYPES, VOUCHER_RULES } from '@/lib/constants'
import { requirePerm } from '@/lib/staff-auth'

export async function GET() {
  const denied = await requirePerm('vouchers')
  if (denied) return denied
  const vouchers = await db.voucher.findMany({
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { uses: true } } },
  })
  return ok({ vouchers })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))

  const code = (body.code || '').toString().trim().toUpperCase()
  const title = (body.title || '').toString().trim()
  const discountType = body.discountType === DISCOUNT_TYPES.FIXED ? DISCOUNT_TYPES.FIXED : DISCOUNT_TYPES.PERCENT
  const discountValue = parseFloat(body.discountValue)
  const ruleType = Object.values(VOUCHER_RULES).includes(body.ruleType) ? body.ruleType : VOUCHER_RULES.GENERAL

  if (!code) return fail('কুপন কোড প্রয়োজন', 400)
  if (!title) return fail('শিরোনাম প্রয়োজন', 400)
  if (isNaN(discountValue) || discountValue <= 0) return fail('সঠিক ছাড়ের পরিমাণ দিন', 400)
  if (discountType === DISCOUNT_TYPES.PERCENT && discountValue > 90) return fail('পার্সেন্টেজ ৯০ এর কম দিন', 400)

  const exists = await db.voucher.findUnique({ where: { code } })
  if (exists) return fail('এই কোড আগে থেকেই আছে', 400)

  const voucher = await db.voucher.create({
    data: {
      code,
      title,
      description: body.description || null,
      discountType,
      discountValue,
      maxDiscount: body.maxDiscount ? parseFloat(body.maxDiscount) : null,
      minOrderAmount: parseFloat(body.minOrderAmount) || 0,
      ruleType,
      startTime: body.startTime || null,
      endTime: body.endTime || null,
      daysOfWeek: Array.isArray(body.daysOfWeek) && body.daysOfWeek.length > 0 ? JSON.stringify(body.daysOfWeek) : null,
      specificDate: body.specificDate ? new Date(body.specificDate) : null,
      setMenuIds: Array.isArray(body.setMenuIds) && body.setMenuIds.length > 0 ? JSON.stringify(body.setMenuIds) : null,
      minQuantity: body.minQuantity ? parseInt(body.minQuantity, 10) : null,
      usageLimit: body.usageLimit ? parseInt(body.usageLimit, 10) : null,
      singleUse: Boolean(body.singleUse),
      active: body.active !== false,
    },
  })
  return ok({ voucher })
}
