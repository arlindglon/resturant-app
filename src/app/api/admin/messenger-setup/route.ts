// /api/admin/messenger-setup — 🧩 সেটআপ-উইজার্ডের এক-স্টপ API
// GET  → এক কলেই পুরো অবস্থা: টোকেন-টেস্ট (কোন পেজ, Page-token কি না) +
//        নিজের webhook-কে handshake করিয়ে 403/200 ধরা + ৮টা সাবস্ক্রাইব-ফিল্ড
//        যাচাই + শেষ webhook-ইভেন্ট + শেষ পাঠানো-এরর — উইজার্ডের ✅/❌ চেকলিস্ট এটা দিয়েই বসে।
// POST → action: 'save' (Page ID/Token/Verify Token সেভ — সব admin প্যানেল থেকে,
//                 Vercel env ছোঁয়া লাগে না) | 'auto-page-id' (টোকেন থেকে Page ID
//                 অটো-পূরণ) | 'subscribe-fields' (৮ ফিল্ড এক কলে মেরামত)
import { NextRequest } from 'next/server'
import { ok, fail } from '@/lib/api'
import { requirePerm } from '@/lib/staff-auth'
import { SETTING_KEYS } from '@/lib/constants'
import { getSetting, setSettings } from '@/lib/settings'
import {
  testPageToken,
  pageTokenInfo,
  verifyTokenInfo,
  selfHandshake,
  subscribedFields,
  subscribeAllMessagingFields,
  lastSendErrorWithHint,
} from '@/lib/messenger'

/** Public origin (Vercel/লোকাল) — webhook-URL দেখানোর জন্য */
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

  // ক্রম গুরুত্বপূর্ণ নয় — সব স্বাধীন; তবে handshake আগে চলুক (দ্রুত, নিজের ডোমেইন)
  const handshake = await selfHandshake(baseUrl(req))
  const tokenTest = await testPageToken()
  const subscribed = await subscribedFields()

  return ok({
    webhookUrl: `${baseUrl(req)}/api/webhook/messenger`,
    pageId: (await getSetting(SETTING_KEYS.META_PAGE_ID)).trim(),
    pageIdFromToken: tokenTest.pageId,
    pageName: tokenTest.pageName,
    tokenTest,
    tokenInfo: await pageTokenInfo(),
    verifyInfo: await verifyTokenInfo(),
    handshake,
    subscribed,
    lastWebhookAt: await getSetting('messenger_last_event_at'),
    lastWebhookInfo: await getSetting('messenger_last_event_info'),
    // শেষ পাঠানো-এরর + বাংলা ফিক্স-ইঙ্গিত (💡) — উইজার্ডের সতর্ক-বাক্সে হুবহু দেখায়
    lastSendError: await lastSendErrorWithHint(),
  })
}

export async function POST(req: NextRequest) {
  const denied = await requirePerm('settings')
  if (denied) return denied

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const action = String(body.action || '')

  // ── ৩টা মান একসাথে সেভ (যেটা দেওয়া হয়েছে সেটাই) ──
  if (action === 'save') {
    const updates: Record<string, string> = {}
    if (typeof body.pageToken === 'string') {
      const tok = body.pageToken.trim().replace(/[\s\u200B-\u200D]/g, '')
      if (tok && !/^EAA[a-zA-Z0-9_-]{20,}$/.test(tok)) {
        return fail('এটা Page Access Token-এর মতো দেখাচ্ছে না (EAA… দিয়ে শুরু হয়) — User token নাকি অসম্পূর্ণ কপি, আবার দেখুন।', 400)
      }
      updates[SETTING_KEYS.MESSENGER_PAGE_TOKEN] = tok
    }
    if (typeof body.verifyToken === 'string') {
      const tok = body.verifyToken.trim().replace(/[\s\u200B-\u200D]/g, '')
      if (tok && (tok.length < 6 || tok.length > 128)) {
        return fail('Verify Token ৬–১২৮ অক্ষরের হতে হবে — আবার দিন।', 400)
      }
      updates[SETTING_KEYS.META_VERIFY_TOKEN] = tok
    }
    if (typeof body.pageId === 'string') {
      const pid = body.pageId.trim().replace(/[^0-9]/g, '')
      updates[SETTING_KEYS.META_PAGE_ID] = pid
    }
    if (Object.keys(updates).length === 0) return fail('নতুন কোনো মান পাওয়া যায়নি', 400)
    await setSettings(updates)
    return ok({
      saved: Object.keys(updates),
      pageId: (await getSetting(SETTING_KEYS.META_PAGE_ID)).trim(),
      tokenInfo: await pageTokenInfo(),
      verifyInfo: await verifyTokenInfo(),
    })
  }

  // ── টোকেন থেকে Page ID অটো-পূরণ (মালিকের হাতে লেখার ঝামেলা নেই) ──
  if (action === 'auto-page-id') {
    const t = await testPageToken()
    if (!t.ok || !t.pageId) return fail(`Page ID আনা যায়নি — ${t.error || 'টোকেন আগে সেভ/যাচাই করুন'}`, 400)
    await setSettings({ [SETTING_KEYS.META_PAGE_ID]: t.pageId })
    return ok({ pageId: t.pageId, pageName: t.pageName, isPageToken: t.isPageToken ?? true })
  }

  // ── ৮টা webhook-ফিল্ড এক কলে সাবস্ক্রাইব (মেরামত) ──
  if (action === 'subscribe-fields') {
    const r = await subscribeAllMessagingFields()
    if (!r.ok) return fail(r.error || 'সাবস্ক্রাইব করা যায়নি', 502)
    return ok({ fields: r.fields })
  }

  return fail('অজানা অ্যাকশন', 400)
}
