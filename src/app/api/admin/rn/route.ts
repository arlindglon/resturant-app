// POST /api/admin/rn — Meta Recurring Notifications actions (admin panel)
//   action=ask       → RN অপট-ইন রিকোয়েস্ট কার্ড (টেমপ্লেট) সব যোগ্য কাস্টমারকে:
//                      মেসেঞ্জার কাস্টমার, এখনো অপট-ইন করেনি, শেষ ৬০ দিনে
//                      অ্যাকটিভ, এবং শেষ জিজ্ঞাসা ১৪ দিনের পুরোনো (no-nag)
//   action=broadcast → RN টেমপ্লেট সব 🔔 অপট-ইন করা কাস্টমারের notification
//                      token-এ পাঠানো — ২৪ ঘণ্টার উইন্ডোর বাইরেও কাজ করে
//                      (সাপ্তাহিক অফার / উৎসব / জন্মদিনের সারপ্রাইজ)
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, fail } from '@/lib/api'
import { requirePerm } from '@/lib/staff-auth'
import { getSetting } from '@/lib/settings'
import { SETTING_KEYS } from '@/lib/constants'
import { sendRnOptInTemplate, sendRnToToken } from '@/lib/messenger'

const ASK_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000
const ASK_ACTIVE_WINDOW_MS = 60 * 24 * 60 * 60 * 1000

export async function POST(req: NextRequest) {
  const denied = await requirePerm('settings')
  if (denied) return denied

  const body = (await req.json().catch(() => ({}))) as { action?: string }
  const action = body.action === 'broadcast' ? 'broadcast' : body.action === 'ask' ? 'ask' : null
  if (!action) return fail('action দিন: ask | broadcast', 400)

  const templateId = ((await getSetting(SETTING_KEYS.META_RN_TEMPLATE_ID)) || '').trim()
  if (!templateId) {
    return fail(
      'আগে Meta App Dashboard → Messenger → Recurring Notifications-এ একটি টেমপ্লেট বানিয়ে তার Template ID সেটিংসে বসিয়ে সেভ করুন',
      400
    )
  }

  if (action === 'broadcast') {
    const customers = await db.customer.findMany({
      where: { rnToken: { not: null } },
      select: { psid: true, rnToken: true, firstName: true, lastName: true },
    })
    let sent = 0
    const errors: string[] = []
    for (const c of customers) {
      const r = await sendRnToToken(templateId, c.rnToken as string)
      if (r.ok) sent++
      else errors.push(`${c.firstName || c.psid}: ${r.error}`)
    }
    return ok({ total: customers.length, sent, failed: customers.length - sent, errors: errors.slice(0, 8) })
  }

  // ask — opt-in request to recently-active customers who have NOT opted in yet
  const since = new Date(Date.now() - ASK_ACTIVE_WINDOW_MS)
  const cooldownBefore = new Date(Date.now() - ASK_COOLDOWN_MS)
  const customers = await db.customer.findMany({
    where: {
      rnToken: null,
      psid: { not: { startsWith: 'direct:' } },
      lastSeenAt: { gte: since },
      OR: [{ rnAskedAt: null }, { rnAskedAt: { lt: cooldownBefore } }],
    },
    select: { psid: true, firstName: true },
  })
  let sent = 0
  const errors: string[] = []
  for (const c of customers) {
    await db.customer.update({ where: { psid: c.psid }, data: { rnAskedAt: new Date() } }).catch(() => {})
    const r = await sendRnOptInTemplate(c.psid, templateId)
    if (r.ok) sent++
    else errors.push(`${c.firstName || c.psid}: ${r.error}`)
  }
  return ok({ total: customers.length, sent, failed: customers.length - sent, errors: errors.slice(0, 8) })
}
