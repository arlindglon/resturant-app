// POST /api/admin/messenger-test — live diagnostics for the Meta Messenger integration:
// 1. validates META_PAGE_TOKEN against Graph /me (shows WHICH page it belongs to)
// 2. reports which Meta env vars are present + when the webhook last received an event
import { ok } from '@/lib/api'
import { requirePerm } from '@/lib/staff-auth'
import { testPageToken } from '@/lib/messenger'
import { getSetting } from '@/lib/settings'

export async function POST() {
  const denied = await requirePerm('settings')
  if (denied) return denied

  const tokenTest = await testPageToken()
  return ok({
    tokenTest,
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
