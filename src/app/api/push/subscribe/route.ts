// POST /api/push/subscribe — কাস্টমারের ব্রাউজার-পুশ সাবস্ক্রিপশন জমা (পাবলিক এন্ডপয়েন্ট)
// endpoint দিয়ে upsert — একই ব্রাউজার বারবার সাবস্ক্রাইব করলে একটাই রো। সাথে সাথে
// একটা ওয়েলকাম পুশ যায় ("চালু হয়েছে") — কাস্টমার সাথে সাথেই নিশ্চিত হয়।
import { NextRequest } from 'next/server'
import { ok, fail } from '@/lib/api'
import { db } from '@/lib/db'
import { ensurePushTable, pushEnabled, sendWebPush } from '@/lib/webpush-server'

export async function POST(req: NextRequest) {
  if (!(await pushEnabled())) return fail('নোটিফিকেশন এখন বন্ধ আছে', 403)
  await ensurePushTable()
  const body = (await req.json().catch(() => ({}))) as {
    endpoint?: unknown
    keys?: { p256dh?: unknown; auth?: unknown }
    deviceId?: unknown
    tableNumber?: unknown
  }
  const endpoint = typeof body.endpoint === 'string' ? body.endpoint.trim() : ''
  const p256dh = typeof body.keys?.p256dh === 'string' ? body.keys.p256dh : ''
  const auth = typeof body.keys?.auth === 'string' ? body.keys.auth : ''
  if (!endpoint.startsWith('https://') || !p256dh || !auth) return fail('সাবস্ক্রিপশন ডেটা অসম্পূর্ণ')
  const deviceId = typeof body.deviceId === 'string' ? body.deviceId.slice(0, 120) : null
  const tableNumber = Number.isInteger(body.tableNumber) ? (body.tableNumber as number) : null
  const userAgent = (req.headers.get('user-agent') || '').slice(0, 300) || null

  await db.pushSubscription.upsert({
    where: { endpoint },
    create: { endpoint, p256dh, auth, deviceId, tableNumber, userAgent },
    update: { p256dh, auth, deviceId, tableNumber: tableNumber ?? undefined, lastError: null },
  })

  // ওয়েলকাম পুশ (best-effort — ব্যর্থ হলেও সাবস্ক্রিপশন থাকবে)
  const subs = await db.pushSubscription.findMany({ where: { endpoint } })
  void sendWebPush(subs, { title: '🔔 নোটিফিকেশন চালু হয়েছে!', body: 'অর্ডার রেডি হলেই এখানেই জানিয়ে দেবো। ধন্যবাদ! 🙏', tag: 'welcome', url: '/menu' })

  return ok({ saved: true })
}
