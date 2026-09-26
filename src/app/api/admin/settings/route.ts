// GET/PUT /api/admin/settings — full settings incl. session_duration_minutes
import { NextRequest } from 'next/server'
import { ok, fail } from '@/lib/api'
import { getAllSettings, getSetting, setSettings } from '@/lib/settings'
import { SETTING_KEYS } from '@/lib/constants'
import { requirePerm } from '@/lib/staff-auth'
import { messengerConfigured, pageTokenInfo, verifyTokenInfo } from '@/lib/messenger'

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
  // SECURITY: Page Access Token কখনোই প্লেইন-টেক্সটে ব্রাউজারে যাবে না —
  // মাস্কড মার্কার-ই যথেষ্ট (UI শুধু সোর্স/শেষ-৬-অক্ষর দেখায়)
  const adminToken = (settings[SETTING_KEYS.MESSENGER_PAGE_TOKEN] || '').trim()
  if (adminToken) settings[SETTING_KEYS.MESSENGER_PAGE_TOKEN] = '__SET__'
  return ok({
    settings,
    meta: {
      sessionDurationHint: 'QR স্ক্যানে তৈরি HMAC সেশন কুকির মেয়াদ (মিনিট)। নতুন স্ক্যান থেকে কার্যকর হবে।',
      messengerConfigured: await messengerConfigured(),
      tokenInfo: await pageTokenInfo(),
      verifyTokenInfo: await verifyTokenInfo(),
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
      lastSendError: await getSetting('messenger_last_send_error'),
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
    } else if (k === SETTING_KEYS.GEMINI_API_KEYS) {
      // multi-key rotation list — one key per line, allow plenty of keys
      updates[k] = String(v).slice(0, 20000)
    } else if (k === SETTING_KEYS.GEMINI_PERSONA || k === SETTING_KEYS.AI_DELIVERY_RULES || k === SETTING_KEYS.AI_EXTRA_INFO) {
      updates[k] = String(v).slice(0, 8000)
    } else if (k === SETTING_KEYS.MESSENGER_PAGE_TOKEN) {
      // Page Access Token — ফাঁকা মানে env-এ ফেরা; অবৈধ অক্ষর (স্পেস/নতুন লাইন) ছাঁটাই
      const tok = String(v).trim().replace(/[\s\u200B-\u200D]/g, '')
      if (tok && !/^EAA[a-zA-Z0-9_-]{20,}$/.test(tok)) {
        return fail('টোকেনটি দেখতে Page Access Token-এর মতো নয় (EAA… দিয়ে শুরু হয়) — আবার কপি করুন।', 400)
      }
      updates[k] = tok
    } else if (k === SETTING_KEYS.META_VERIFY_TOKEN) {
      // Webhook Verify Token — ফাঁকা মানে env-এ ফেরা; স্পেস/নতুন-লাইন ছাঁটাই,
      // ৬–১২৮ অক্ষরের মধ্যে হতে হবে (Meta ড্যাশবোর্ডে যেটা পেস্ট করা হয়)
      const tok = String(v).trim().replace(/[\s\u200B-\u200D]/g, '')
      if (tok && (tok.length < 6 || tok.length > 128)) {
        return fail('Verify Token ৬–১২৮ অক্ষরের হতে হবে — আবার দিন।', 400)
      }
      updates[k] = tok
    } else {
      updates[k] = String(v).slice(0, 2000)
    }
  }

  if (Object.keys(updates).length === 0) return fail('কোনো বৈধ সেটিংস পাওয়া যায়নি', 400)

  await setSettings(updates)
  const settings = await getAllSettings()
  // রেসপন্সেও টোকেন প্লেইন-টেক্সটে ফেরবে না
  if ((settings[SETTING_KEYS.MESSENGER_PAGE_TOKEN] || '').trim()) {
    settings[SETTING_KEYS.MESSENGER_PAGE_TOKEN] = '__SET__'
  }
  return ok({ settings, updated: Object.keys(updates) })
}
