// GET/PUT /api/admin/settings — full settings incl. session_duration_minutes
import { NextRequest } from 'next/server'
import { ok, fail } from '@/lib/api'
import { getAllSettings, getSetting, setSettings } from '@/lib/settings'
import { SETTING_KEYS } from '@/lib/constants'
import { requirePerm } from '@/lib/staff-auth'
import { messengerConfigured } from '@/lib/messenger'

/** Public origin of this deployment (Vercel or local) — for webhook URL display */
function baseUrl(req: NextRequest): string {
  const custom = process.env.PUBLIC_BASE_URL
  if (custom) return custom.replace(/\/+$/, '')
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || 'localhost:3000'
  const proto = req.headers.get('x-forwarded-proto') || (host.startsWith('localhost') ? 'http' : 'https')
  return `${proto}://${host}`
}

export async function GET(req: NextRequest) {
  const denied = await requirePerm('settings')
  if (denied) return denied
  const settings = await getAllSettings()
  return ok({
    settings,
    meta: {
      sessionDurationHint: 'QR স্ক্যানে তৈরি HMAC সেশন কুকির মেয়াদ (মিনিট)। নতুন স্ক্যান থেকে কার্যকর হবে।',
      messengerConfigured: messengerConfigured(),
      metaEnv: {
        pageToken: Boolean(process.env.META_PAGE_TOKEN),
        pageId: Boolean(process.env.META_PAGE_ID),
        verifyToken: Boolean(process.env.META_VERIFY_TOKEN),
        appSecret: Boolean(process.env.META_APP_SECRET),
      },
      webhookUrl: `${baseUrl(req)}/api/webhook/messenger`,
      lastWebhookAt: await getSetting('messenger_last_event_at'),
      lastWebhookInfo: await getSetting('messenger_last_event_info'),
      lastVerifyAt: await getSetting('messenger_last_verify_at'),
    },
  })
}

export async function PUT(req: NextRequest) {
  // SECURITY GATE — settings can only be changed by main admin / sub-admin
  // with the 'settings' permission (previously missing → anyone could update!)
  const denied = await requirePerm('settings')
  if (denied) return denied

  const body = await req.json().catch(() => ({}))

  const allowed = Object.values(SETTING_KEYS) as string[]
  const updates: Record<string, string> = {}

  for (const [k, v] of Object.entries(body)) {
    if (!allowed.includes(k)) continue
    if (k === SETTING_KEYS.SESSION_DURATION_MINUTES) {
      const n = parseInt(String(v), 10)
      if (isNaN(n) || n < 5 || n > 24 * 60) return fail('সেশন মেয়াদ ৫ মিনিট - ২৪ ঘণ্টার মধ্যে দিন', 400)
      updates[k] = String(n)
    } else if (k === SETTING_KEYS.KITCHEN_DELAY_ALERT_MINUTES) {
      const n = parseInt(String(v), 10)
      if (isNaN(n) || n < 1 || n > 240) return fail('ডিলে অ্যালার্ট ১-২৪০ মিনিটের মধ্যে দিন', 400)
      updates[k] = String(n)
    } else if (k === SETTING_KEYS.BIRTHDAY_DISCOUNT_AMOUNT || k === SETTING_KEYS.BIRTHDAY_MIN_BILL) {
      const n = parseFloat(String(v))
      if (isNaN(n) || n < 0) return fail('সঠিক পরিমাণ দিন', 400)
      updates[k] = String(n)
    } else {
      updates[k] = String(v).slice(0, 2000)
    }
  }

  if (Object.keys(updates).length === 0) return fail('কোনো বৈধ সেটিংস পাওয়া যায়নি', 400)

  await setSettings(updates)
  const settings = await getAllSettings()
  return ok({ settings, updated: Object.keys(updates) })
}
