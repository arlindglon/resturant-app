// GET /api/admin/tables/live — per-table live tracking:
// active session + joined devices + this session's orders (status, payment)
// + bill totals + pending waiter calls. Powers the admin Tables tab.
import { db } from '@/lib/db'
import { ok, fail, isAdmin, parseJSON } from '@/lib/api'
import { requirePerm } from '@/lib/staff-auth'

export async function GET() {
  const denied = await requirePerm('tables')
  if (denied) return denied

  const tables = await db.restaurantTable.findMany({
    orderBy: { number: 'asc' },
    include: {
      sessions: {
        where: { active: true, clearedAt: null },
        orderBy: { scannedAt: 'desc' },
        take: 1,
        include: {
          devices: { orderBy: { firstSeen: 'asc' } },
          orders: {
            where: { status: { notIn: ['CANCELLED'] } },
            orderBy: { placedAt: 'asc' },
            include: { items: true },
          },
        },
      },
      waiterCalls: {
        where: { status: 'PENDING' },
        orderBy: { createdAt: 'desc' },
      },
    },
  })

  return ok({
    tables: tables.map((t) => {
      const s = t.sessions[0]
      const orders = s?.orders || []
      const subtotal = orders.reduce((sum, o) => sum + o.subtotal, 0)
      const payable = orders.reduce((sum, o) => sum + o.total, 0)
      const paidTotal = orders.filter((o) => o.billPaid).reduce((sum, o) => sum + o.total, 0)
      const allPaid = orders.length > 0 && orders.every((o) => o.billPaid)

      return {
        id: t.id,
        number: t.number,
        seats: t.seats,
        status: t.status,
        pendingCalls: t.waiterCalls.map((c) => ({ id: c.id, type: c.type, createdAt: c.createdAt })),
        session: s
          ? {
              id: s.id,
              scannedAt: s.scannedAt,
              expiresAt: s.expiresAt,
              birthdayGranted: s.birthdayGranted,
              guests: s.devices.map((d) => ({
                id: d.id,
                deviceId: d.deviceId.slice(0, 13),
                firstSeen: d.firstSeen,
              })),
              orders: orders.map((o) => ({
                id: o.id,
                orderNo: o.orderNo,
                status: o.status,
                subtotal: o.subtotal,
                voucherDiscount: o.voucherDiscount,
                happyHourDiscount: o.happyHourDiscount,
                birthdayDiscount: o.birthdayDiscount,
                total: o.total,
                billPaid: o.billPaid,
                paymentMethod: o.paymentMethod,
                voucherCode: o.voucherCode,
                placedAt: o.placedAt,
                itemCount: o.items.reduce((n, i) => n + i.quantity, 0),
                items: o.items.map((i) => ({
                  itemName: i.itemName,
                  quantity: i.quantity,
                  spiceLevel: i.spiceLevel,
                  addons: parseJSON<{ name: string; price: number }[]>(i.addons, []),
                  specialNote: i.specialNote,
                })),
              })),
              bill: {
                subtotal: Math.round(subtotal * 100) / 100,
                payable: Math.round(payable * 100) / 100,
                paidTotal: Math.round(paidTotal * 100) / 100,
                allPaid,
              },
            }
          : null,
      }
    }),
  })
}
