// POST /api/admin/rn — Meta Marketing/Notification Messages actions (admin panel)
//   action=ask       → opt-in request card (title + logo, NO template needed)
//                      সব যোগ্য কাস্টমারকে: মেসেঞ্জার কাস্টমার, এখনো অপট-ইন করেনি,
//                      শেষ ৬০ দিনে অ্যাকটিভ, এবং শেষ জিজ্ঞাসা ১৪ দিনের পুরোনো (no-nag)
//   action=broadcast → সব 🔔 অপট-ইন করা কাস্টমারের notification_messages_token-এ
//                      অফার-টেক্সট পাঠানো — ২৪ ঘণ্টার উইন্ডোর বাইরেও কাজ করে
//                      (সাপ্তাহিক অফার / উৎসব / জন্মদিনের সারপ্রাইজ)
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, fail } from '@/lib/api'
import { requirePerm } from '@/lib/staff-auth'
import { getSetting } from '@/lib/settings'
import { SETTING_KEYS } from '@/lib/constants'
import { sendRnOptInRequest, sendRnToToken } from '@/lib/messenger'
import { t, pickBotLang, globalBotLang, nameVar } from '@/lib/bot-text'

const ASK_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000
const ASK_ACTIVE_WINDOW_MS = 60 * 24 * 60 * 60 * 1000

export async function POST(req: NextRequest) {
  const denied = await requirePerm('settings')
  if (denied) return denied

  const body = (await req.json().catch(() => ({}))) as { action?: string; title?: string; text?: string }
  const action = body.action === 'broadcast' ? 'broadcast' : body.action === 'ask' ? 'ask' : null
  if (!action) return fail('action দিন: ask | broadcast', 400)

  if (action === 'broadcast') {
    const base = ((await getSetting(SETTING_KEYS.PUBLIC_BASE_URL)) || '').trim().replace(/\/+$/, '')
    const globalLang = await globalBotLang()
    const customers = await db.customer.findMany({
      where: { rnToken: { not: null } },
      select: { psid: true, rnToken: true, firstName: true, lastName: true, language: true },
    })
    let sent = 0
    const errors: string[] = []
    for (const c of customers) {
      // admin-নির্ধারিত টেক্সট সবাই পায়; ফাঁকা রাখলে প্রতি কাস্টমারের ভাষায় ডিফল্ট অফার-লেখা যায়
      const lang = pickBotLang(c.language, globalLang)
      const name = (c.firstName || '').trim()
      const text =
        body.text?.trim() ||
        t(lang, 'rnBroadcastDefault', {
          name: nameVar(name),
          base: base ? t(lang, 'rnOrderLink', { url: base }) : '',
        })
      const r = await sendRnToToken(c.rnToken as string, text)
      if (r.ok) sent++
      else errors.push(`${c.firstName || c.psid}: ${r.error}`)
    }
    return ok({ total: customers.length, sent, failed: customers.length - sent, errors: errors.slice(0, 8) })
  }

  // ask — opt-in request to recently-active customers who have NOT opted in yet
  // (কাস্টমার-নির্দিষ্ট টাইটেল পাঠানো যায় না — এক কার্ডে এক টাইটেল; গ্লোবাল ভাষার ডিফল্ট)
  const title =
    body.title?.trim() ||
    ((await getSetting(SETTING_KEYS.META_RN_TITLE)) || '').trim() ||
    t(await globalBotLang(), 'rnTitleDefault')
  const logo = ((await getSetting(SETTING_KEYS.RESTAURANT_LOGO_URL)) || '').trim() || null
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
    const r = await sendRnOptInRequest(c.psid, { title, imageUrl: logo })
    if (r.ok) sent++
    else errors.push(`${c.firstName || c.psid}: ${r.error}`)
  }
  return ok({ total: customers.length, sent, failed: customers.length - sent, errors: errors.slice(0, 8) })
}
