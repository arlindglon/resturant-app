// GET/POST /api/admin/push — কাস্টমার ওয়েব-পুশ: পরিসংখ্যান, টেস্ট, ব্রডকাস্ট, চালু/বন্ধ
import { NextRequest } from 'next/server'
import { ok, fail } from '@/lib/api'
import { db } from '@/lib/db'
import { requirePerm } from '@/lib/staff-auth'
import { getSetting, setSettings } from '@/lib/settings'
import { SETTING_KEYS } from '@/lib/constants'
import { allSubs, ensurePushTable, pushEnabled, sendWebPush } from '@/lib/webpush-server'

export async function GET() {
  const denied = await requirePerm('tables')
  if (denied) return denied
  const subs = await allSubs()
  return ok({
    enabled: await pushEnabled(),
    count: subs.length,
    adminCount: subs.filter((s) => s.role === 'admin').length,
    publicKeySet: Boolean((await getSetting(SETTING_KEYS.PUSH_VAPID_PUBLIC)).trim()),
    lastResult: await getSetting(SETTING_KEYS.PUSH_LAST_RESULT),
    subs: subs.slice(0, 30).map((s) => ({
      id: s.id,
      endpointTail: s.endpoint.slice(-24),
      deviceId: s.deviceId ? s.deviceId.slice(0, 10) + '…' : null,
      tableNumber: s.tableNumber,
      hasError: Boolean(s.lastError),
      createdAt: s.createdAt,
    })),
  })
}

export async function POST(req: NextRequest) {
  const denied = await requirePerm('settings')
  if (denied) return denied
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const action = String(body.action || '')

  if (action === 'toggle') {
    const enabled = body.enabled === true
    await setSettings({ [SETTING_KEYS.PUSH_ENABLED]: enabled ? 'true' : 'false' })
    return ok({ enabled })
  }

  if (action === 'remove') {
    const id = String(body.id || '')
    if (!id) return fail('id প্রয়োজন')
    const res = await db.pushSubscription.deleteMany({ where: { id } })
    return ok({ removed: res.count })
  }

  // 📱 এই ডিভাইসকে অ্যাডমিন-অ্যালার্ট ডিভাইস হিসেবে নেওয়া — নতুন অর্ডার + ওয়েটার-কল এখানেই পুশ হবে
  if (action === 'subscribe-device') {
    await ensurePushTable()
    const keys = (body.keys || {}) as { p256dh?: unknown; auth?: unknown }
    const endpoint = typeof body.endpoint === 'string' ? body.endpoint.trim() : ''
    const p256dh = typeof keys.p256dh === 'string' ? keys.p256dh : ''
    const auth = typeof keys.auth === 'string' ? keys.auth : ''
    if (!endpoint.startsWith('https://') || !p256dh || !auth) return fail('সাবস্ক্রিপশন ডেটা অসম্পূর্ণ')
    const userAgent = (req.headers.get('user-agent') || '').slice(0, 300) || null
    await db.pushSubscription.upsert({
      where: { endpoint },
      create: { endpoint, p256dh, auth, role: 'admin', userAgent },
      update: { p256dh, auth, role: 'admin', lastError: null },
    })
    // সাথে সাথেই একটা টেস্ট পুশ — মালিক নিশ্চিত হতে পারেন অ্যালার্ট আসছে
    const sub = await db.pushSubscription.findUnique({ where: { endpoint } })
    if (sub) {
      void sendWebPush([sub], {
        title: '✅ অ্যালার্ট চালু হয়েছে!',
        body: 'এখন থেকে নতুন অর্ডার আর ওয়েটার-কল এই ডিভাইসেই সাথে সাথে পাবেন।',
        tag: 'admin-welcome',
        url: '/kds',
      }).catch(() => {})
    }
    return ok({ saved: true })
  }

  if (action === 'test' || action === 'broadcast') {
    const title = String(body.title || '').trim().slice(0, 64) || (action === 'test' ? '🔔 টেস্ট নোটিফিকেশন' : '🎁 বিশেষ ঘোষণা!')
    const text = String(body.body || '').trim().slice(0, 240) || (action === 'test' ? 'এটা ছিল একটা টেস্ট — সবকিছু ঠিকঠাক কাজ করছে ✅' : 'আজকের অফার দেখতে মেনু খুলুন!')
    const url = String(body.url || '/menu').trim().slice(0, 200) || '/menu'
    const subs = await allSubs()
    if (!subs.length) return ok({ total: 0, sent: 0, failed: 0, cleaned: 0, errors: [], message: 'এখনো কোনো কাস্টমার সাবস্ক্রাইব করেনি — মেনু পেজে 🔔 বাটনে চাপলেই সাবস্ক্রাইব হয়।' })
    const result = await sendWebPush(subs, { title, body: text, tag: action === 'test' ? 'test' : 'broadcast', url })
    return ok(result)
  }

  return fail('অজানা action')
}
