// POST /api/admin/messenger-test — live diagnostics for the Meta Messenger integration:
// 1. validates META_PAGE_TOKEN against Graph /me (shows WHICH page it belongs to)
// 2. reports which Meta env vars are present + when the webhook last received an event
// 3. probes the profile of the newest chatting customer — proves whether
//    names/photos can be fetched (the reason behind "Customer" names in CRM)
// 4. LIVE SEND probe to the newest chatting customer — returns the EXACT Graph
//    error when sends fail (dev-mode / permission / 24h-window — all invisible before)
import { db } from '@/lib/db'
import { ok } from '@/lib/api'
import { requirePerm } from '@/lib/staff-auth'
import { testPageToken, fetchMessengerProfile, probeSend, pageTokenInfo, verifyTokenInfo, KEY_LAST_SEND_ERROR } from '@/lib/messenger'
import { getSetting } from '@/lib/settings'

export async function POST() {
  const denied = await requirePerm('settings')
  if (denied) return denied

  const tokenTest = await testPageToken()

  // profile probe on the most recent messenger customer (skip direct-claim pseudo psids)
  let profileTest: { ok: boolean; name: string | null; error: string | null } | null = null
  let probePsid: string | null = null
  const probeCustomer = await db.customer.findFirst({
    where: { psid: { not: { startsWith: 'direct:' } } },
    orderBy: { lastSeenAt: 'desc' },
    select: { psid: true },
  }).catch(() => null)
  if (probeCustomer) {
    probePsid = probeCustomer.psid
    const p = await fetchMessengerProfile(probeCustomer.psid)
    profileTest = {
      ok: p.ok,
      name: p.ok ? [p.firstName, p.lastName].filter(Boolean).join(' ') || null : null,
      error: p.error,
    }
  }

  // live send probe — sends a tiny test message to the newest chatting customer
  // and returns the EXACT Graph rejection (with a Bangla fix hint) when it fails
  const sendProbe = probePsid ? await probeSend(probePsid) : null

  return ok({
    tokenTest,
    profileTest,
    sendProbe: sendProbe ? { psid: probePsid, ...sendProbe } : null,
    env: {
      pageToken: Boolean(process.env.META_PAGE_TOKEN),
      pageId: Boolean(process.env.META_PAGE_ID),
      verifyToken: Boolean(process.env.META_VERIFY_TOKEN),
      appSecret: Boolean(process.env.META_APP_SECRET),
    },
    // কোন টোকেন চলছে: admin সেটিং (messenger_page_token) নাকি Vercel env — শেষ ৬ অক্ষরসহ
    tokenInfo: await pageTokenInfo(),
    // কোন verify token চলছে: admin সেটিং (meta_verify_token) নাকি Vercel env — শেষ ৪ অক্ষরসহ
    verifyTokenInfo: await verifyTokenInfo(),
    lastWebhookAt: await getSetting('messenger_last_event_at'),
    lastWebhookInfo: await getSetting('messenger_last_event_info'),
    lastVerifyAt: await getSetting('messenger_last_verify_at'),
    lastSendError: await getSetting(KEY_LAST_SEND_ERROR),
  })
}
