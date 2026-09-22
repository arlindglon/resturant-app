// GET /api/admin/analytics — dashboard KPIs
import { db } from '@/lib/db'
import { ok, parseJSON } from '@/lib/api'
import { requirePerm } from '@/lib/staff-auth'

export async function GET() {
  const denied = await requirePerm('overview')
  if (denied) return denied


  const startOfDay = new Date()
  startOfDay.setHours(0, 0, 0, 0)

  const [todayOrders, allTime, popular, activeTables, customers, vouchersUsed] = await Promise.all([
    db.order.findMany({
      where: { placedAt: { gte: startOfDay }, status: { notIn: ['CANCELLED'] } },
      include: { items: true },
    }),
    db.order.aggregate({
      where: { status: { notIn: ['CANCELLED'] } },
      _sum: { total: true, happyHourDiscount: true, voucherDiscount: true, birthdayDiscount: true },
      _count: true,
    }),
    db.orderItem.groupBy({
      by: ['itemName'],
      _sum: { quantity: true },
      orderBy: { _sum: { quantity: 'desc' } },
      take: 5,
    }),
    db.restaurantTable.findMany({ orderBy: { number: 'asc' } }),
    db.customer.count(),
    db.voucherUse.count(),
  ])

  // avg cooking time (cookingAt → readyAt)
  const cookTimed = await db.order.findMany({
    where: { cookingAt: { not: null }, readyAt: { not: null } },
    select: { cookingAt: true, readyAt: true },
    take: 500,
    orderBy: { placedAt: 'desc' },
  })
  const avgCookingMinutes =
    cookTimed.length > 0
      ? Math.round(
          (cookTimed.reduce((s, o) => s + (o.readyAt!.getTime() - o.cookingAt!.getTime()), 0) / cookTimed.length / 60000) * 10
        ) / 10
      : 0

  const todayRevenue = todayOrders.reduce((s, o) => s + o.total, 0)

  return ok({
    todayRevenue: Math.round(todayRevenue * 100) / 100,
    todayOrders: todayOrders.length,
    allTimeRevenue: Math.round((allTime._sum.total || 0) * 100) / 100,
    allTimeOrders: allTime._count,
    totalDiscounts: {
      happyHour: Math.round((allTime._sum.happyHourDiscount || 0) * 100) / 100,
      voucher: Math.round((allTime._sum.voucherDiscount || 0) * 100) / 100,
      birthday: Math.round((allTime._sum.birthdayDiscount || 0) * 100) / 100,
    },
    avgCookingMinutes,
    popularItems: popular.map((p) => ({ name: p.itemName, count: p._sum.quantity || 0 })),
    tables: activeTables.map((t) => ({ id: t.id, number: t.number, status: t.status, seats: t.seats })),
    totalCustomers: customers,
    totalVouchersUsed: vouchersUsed,
    currency: parseJSON('৳', '৳'),
  })
}
