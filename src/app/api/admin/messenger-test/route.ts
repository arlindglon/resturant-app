// POST /api/admin/messenger-test — live diagnostics for the Meta Messenger integration:
// 1. validates META_PAGE_TOKEN against Graph /me (shows WHICH page it belongs to)
// 2. reports which Meta env vars are present + when the webhook last received an event
// 3. probes the profile of the newest chatting customer — proves whether
//    names/photos can be fetched (the reason behind "Customer" names in CRM)
import { db } from '@/lib/db'
import { ok } from '@/lib/api'
import { requirePerm } from '@/lib/staff-auth'
import { testPageToken, fetchMessengerProfile } from '@/lib/messenger'
import { getSetting } from '@/lib/settings'

export async function POST() {
  const denied = await requirePerm('settings')
  if (denied) return denied

  const tokenTest = await testPageToken()

  // profile probe on the most recent messenger customer (skip direct-claim pseudo psids)
  let profileTest: { ok: boolean; name: string | null; error: string | null } | null = null
  const probeCustomer = await db.customer.findFirst({
    where: { psid: { not: { startsWith: 'direct:' } } },
    orderBy: { lastSeenAt: 'desc' },
    select: { psid: true },
  }).catch(() => null)
  if (probeCustomer) {
    const p = await fetchMessengerProfile(probeCustomer.psid)
    profileTest = {
      ok: p.ok,
      name: p.ok ? [p.firstName, p.lastName].filter(Boolean).join(' ') || null : null,
      error: p.error,
    }
  }

  return ok({
    tokenTest,
    profileTest,
    env: {
      pageToken: Boolean(process.env.META_PAGE_TOKEN),
      pageId: Boolean(process.env.META_PAGE_ID),
      verifyToken: Boolean(process.env.META_VERIFY_TOKEN),
      appSecret: Boolean(process.env.META_APP_SECRET),
    },
    lastWebhookAt: await getSetting('messenger_last_event_at'),
    lastWebhookInfo: await getSetting('messenger_last_event_info'),
    lastVerifyAt: await getSetting('messenger_last_verify_at'),
  })
}
