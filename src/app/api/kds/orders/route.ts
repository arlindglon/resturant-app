// Kitchen Display System API
// GET /api/kds/orders — live queue + waiter calls + delay threshold
// PATCH /api/kds/orders — chef status updates
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, fail, parseJSON } from '@/lib/api'
import { getSettingNumber } from '@/lib/settings'
import { SETTING_KEYS, ORDER_STATUS } from '@/lib/constants'
import { emitEvent } from '@/lib/emit'
import { kdsGuard } from '@/lib/staff-auth'

export async function GET() {
  const denied = await kdsGuard()
  if (denied) return denied
  const [orders, calls, delayMinutes] = await Promise.all([
    db.order.findMany({
      where: { status: { in: [ORDER_STATUS.PLACED, ORDER_STATUS.COOKING, ORDER_STATUS.READY] } },
      orderBy: { placedAt: 'asc' },
      include: { items: true },
    }),
    db.waiterCall.findMany({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
    }),
    getSettingNumber(SETTING_KEYS.KITCHEN_DELAY_ALERT_MINUTES, 15),
  ])

  return ok({
    delayMinutes,
    orders: orders.map((o) => ({
      id: o.id,
      orderNo: o.orderNo,
      tableNumber: o.tableNumber,
      status: o.status,
      placedAt: o.placedAt,
      cookingAt: o.cookingAt,
      readyAt: o.readyAt,
      items: o.items.map((i) => ({
        itemName: i.itemName,
        quantity: i.quantity,
        spiceLevel: i.spiceLevel,
        addons: parseJSON<{ name: string; price: number }[]>(i.addons, []),
        specialNote: i.specialNote,
      })),
    })),
    waiterCalls: calls,
  })
}

export async function PATCH(req: NextRequest) {
  const denied = await kdsGuard()
  if (denied) return denied
  const body = await req.json().catch(() => ({}))
  const { id, status } = body
  if (!id || !status) return fail('id ও status প্রয়োজন', 400)
  if (![ORDER_STATUS.COOKING, ORDER_STATUS.READY, ORDER_STATUS.SERVED, ORDER_STATUS.COMPLETED, ORDER_STATUS.CANCELLED].includes(status)) {
    return fail('অবৈধ স্ট্যাটাস', 400)
  }

  const now = new Date()
  const data: Record<string, unknown> = { status }
  if (status === ORDER_STATUS.COOKING) data.cookingAt = now
  if (status === ORDER_STATUS.READY) data.readyAt = now
  if (status === ORDER_STATUS.SERVED) data.servedAt = now
  if (status === ORDER_STATUS.COMPLETED) data.completedAt = now

  const order = await db.order.update({ where: { id }, data })

  // 🔔 অর্ডার রেডি হলে সেই টেবিলের সব ডিভাইসে অটো ওয়েব-পুশ (best-effort — কখনো কিচেনের রেসপন্স ফেল করাবে না)
  if (status === ORDER_STATUS.READY) {
    try {
      const { notifySessionDevices } = await import('@/lib/webpush-server')
      await notifySessionDevices(order.sessionId, order.tableNumber, {
        title: `🔔 টেবিল ${order.tableNumber} — অর্ডার রেডি!`,
        body: 'আপনার খাবার তৈরি হয়ে গেছে — পরিবেশন করা হচ্ছে। খেতে সবুজ থাকুন! 🍽️',
        tag: `order-${order.id}`,
        url: '/menu',
      })
    } catch {
      /* পুশ ব্যর্থ হলেও কিচেন-ফ্লো অক্ষুণ্ণ */
    }
  }

  // if all orders of session are served/completed, free the table status flag is NOT auto —
  // table cleared manually by cashier.

  emitEvent('order:status', { id: order.id, orderNo: order.orderNo, status: order.status })
  return ok({ order })
}
