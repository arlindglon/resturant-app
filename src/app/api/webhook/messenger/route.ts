// Meta Messenger Webhook
// GET  — verification handshake
// POST — message/referral/postback receiver:
//   referral (ref=token) → greet + Graph API name + 1-tap phone quick reply
//   quick_reply SHARE_PHONE → anti-fraud (7 checks) → apply ৳ discount → digital receipt
// Security: when META_APP_SECRET is configured, every POST must carry a valid
// X-Hub-Signature-256 HMAC — forged/fake webhook events can never apply discounts.
import { NextRequest } from 'next/server'
import crypto from 'crypto'
import { db } from '@/lib/db'
import { fail, ok } from '@/lib/api'
import { fetchProfileName, askPhoneQuickReply, sendReceipt } from '@/lib/messenger'
import { applyBirthdayDiscount } from '@/lib/birthday'
import { setSettings } from '@/lib/settings'


// ── diagnostics: record when Meta last called us (admin panel shows this) ──
const KEY_LAST_EVENT = 'messenger_last_event_at'
const KEY_LAST_INFO = 'messenger_last_event_info'
const KEY_LAST_VERIFY = 'messenger_last_verify_at'

async function recordVerify() {
  try {
    await setSettings({ [KEY_LAST_VERIFY]: new Date().toISOString() })
  } catch (e) {
    console.error('[webhook:diag]', e)
  }
}

/** throttle: skip DB write when an event for the same info was recorded <15s ago */
let lastDiagWrite = 0
let lastDiagInfo = ''
async function recordEvent(info: string) {
  const now = Date.now()
  if (info === lastDiagInfo && now - lastDiagWrite < 15_000) return
  lastDiagWrite = now
  lastDiagInfo = info
  try {
    await setSettings({ [KEY_LAST_EVENT]: new Date().toISOString(), [KEY_LAST_INFO]: info })
  } catch (e) {
    console.error('[webhook:diag]', e)
  }
}

function summarizeEvents(body: {
  entry?: { messaging?: { referral?: unknown; postback?: unknown; message?: { quick_reply?: unknown; text?: string; attachments?: unknown[] } }[] }[]
}): string {
  const kinds = new Set<string>()
  for (const entry of body.entry || []) {
    for (const ev of entry.messaging || []) {
      if (ev.referral) kinds.add('referral(m.me লিঙ্ক)')
      else if (ev.postback) kinds.add('postback')
      else if (ev.message?.quick_reply) kinds.add('quick_reply(ফোন শেয়ার)')
      else if (ev.message) kinds.add('message(সাধারণ টেক্সট)')
    }
  }
  return kinds.size ? [...kinds].join(', ') : 'unknown'
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams
  const mode = params.get('hub.mode')
  const token = params.get('hub.verify_token')
  const challenge = params.get('hub.challenge')
  if (mode === 'subscribe' && token === process.env.META_VERIFY_TOKEN) {
    // successful handshake = the webhook was just saved in the Meta App dashboard
    await recordVerify()
    return new Response(challenge, { status: 200 })
  }
  return fail('Verification failed', 403)
}

/** X-Hub-Signature-256 check (only enforced when META_APP_SECRET is set) */
function validSignature(rawBody: string, header: string | null): boolean {
  const secret = process.env.META_APP_SECRET
  if (!secret) return true // not configured → skip (local/test mode)
  if (!header?.startsWith('sha256=')) return false
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')
  const a = Buffer.from(header)
  const b = Buffer.from(expected)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

interface WebhookEntry {
  id: string
  messaging?: MessagingEvent[]
}

interface MessagingEvent {
  sender?: { id: string }
  recipient?: { id: string }
  referral?: { ref?: string; source?: string; type?: string }
  postback?: { payload?: string; referral?: { ref?: string } }
  message?: {
    text?: string
    quick_reply?: { payload?: string }
    attachments?: { type: string; payload?: unknown }[]
  }
}

export async function POST(req: NextRequest) {
  try {
    const raw = await req.text()
    if (!validSignature(raw, req.headers.get('x-hub-signature-256'))) {
      console.warn('[webhook:POST] invalid X-Hub-Signature-256 — rejected')
      return fail('Invalid signature', 401)
    }
    const body = JSON.parse(raw)
    if (body.object !== 'page') return ok({ received: true })

    // diagnostics: any accepted POST proves Meta → our webhook connection works
    recordEvent(summarizeEvents(body)).catch(() => {})

    for (const entry of body.entry as WebhookEntry[]) {
      for (const event of entry.messaging || []) {
        await handleEvent(event).catch((e) => console.error('[webhook:handler]', e))
      }
    }
    return ok({ received: true })
  } catch (e) {
    console.error('[webhook:POST]', e)
    return ok({ received: true }) // always 200 for Meta
  }
}

async function handleEvent(event: MessagingEvent) {
  const psid = event.sender?.id
  if (!psid) return

  // Case 1: customer opened m.me?ref=TOKEN (referral or postback)
  const ref = event.referral?.ref || event.postback?.referral?.ref
  if (ref) {
    const tokenRow = await db.referralToken.findUnique({ where: { token: ref } })
    if (!tokenRow || tokenRow.status !== 'PENDING') {
      await fetchProfileName(psid)
      return
    }
    const { firstName, lastName } = await fetchProfileName(psid)
    // store psid on the token so the phone-share step matches THIS conversation
    await db.referralToken.update({
      where: { token: ref },
      data: { name: `${firstName} ${lastName}`.trim(), psid },
    })
    await askPhoneQuickReply(
      psid,
      `স্বাগতম ${firstName}! 🎉\n\nবিল আপডেট ও ডিজিটাল রিসিট পেতে আপনার ফোন নম্বরে চাপ দিন (নিচে ১-ট্যাপ বাটন আসবে)।`
    )
    return
  }

  // Case 2: 1-tap phone share quick reply
  const qrPayload = event.message?.quick_reply?.payload
  const phoneFromAttachment = extractPhone(event)
  if ((qrPayload === 'SHARE_PHONE' || phoneFromAttachment) && phoneFromAttachment) {
    const phone = phoneFromAttachment
    // find the pending referral token: prefer the one opened from THIS psid's
    // ref chat; legacy rows (no psid) fall back to the newest pending token
    const tokenRow =
      (await db.referralToken.findFirst({
        where: { status: 'PENDING', psid },
        orderBy: { createdAt: 'desc' },
      })) ||
      (await db.referralToken.findFirst({
        where: { status: 'PENDING', psid: null },
        orderBy: { createdAt: 'desc' },
      })) ||
      (await db.referralToken.findFirst({
        where: { status: 'PENDING' },
        orderBy: { createdAt: 'desc' },
      }))
    if (!tokenRow) {
      await sendReceipt(psid, [{ text: 'দুঃখিত, অফারটি খুঁজে পাওয়া যায়নি। রেস্তোরাঁয় স্টাফদের জানান।' }])
      return
    }

    const { firstName, lastName } = await fetchProfileName(psid)
    const result = await applyBirthdayDiscount({
      psid,
      firstName,
      lastName,
      phone,
      birthday: tokenRow.birthday,
      deviceId: tokenRow.deviceId,
      deviceFp: tokenRow.deviceFp,
      sessionId: tokenRow.sessionId,
      tableNumber: tokenRow.tableNumber,
      occasionId: tokenRow.occasionId,
      occasionName: tokenRow.occasionName,
    })

    if (!result.ok) {
      await sendReceipt(psid, [{ text: `😔 ${result.message}` }])
      return
    }

    // mark claimed + send digital receipt
    await db.referralToken.update({ where: { id: tokenRow.id }, data: { status: 'CLAIMED', phone } })

    const orders = await db.order.findMany({
      where: { sessionId: tokenRow.sessionId },
      include: { items: true },
      orderBy: { placedAt: 'asc' },
    })
    const lines: string[] = [`🧾 ডিজিটাল রিসিট — টেবিল ${tokenRow.tableNumber}`]
    let payable = 0
    for (const o of orders) {
      payable += o.total
      lines.push(`অর্ডার #${o.orderNo}:`)
      for (const i of o.items) {
        lines.push(`  • ${i.itemName} ×${i.quantity} — ৳${i.lineTotal}`)
      }
      if (o.voucherDiscount) lines.push(`  কুপন ছাড়: -৳${o.voucherDiscount}`)
      if (o.happyHourDiscount) lines.push(`  হ্যাপি আওয়ার ছাড়: -৳${o.happyHourDiscount}`)
      if (o.birthdayDiscount) lines.push(`  🎁 অফারের ছাড়: -৳${o.birthdayDiscount}`)
    }
    lines.push(`\nমোট প্রদেয়: ৳${Math.round(payable * 100) / 100}`)
    lines.push(`\nধন্যবাদ ${firstName}! 🙏 আবার আসবেন — বিল আপডেট ও অফার পেতে এই চ্যাটটি রেখে দিন।`)

    await sendReceipt(psid, [{ text: lines.join('\n') }])
  }
}

function extractPhone(event: MessagingEvent): string | null {
  // 1-tap phone quick reply arrives as attachment type 'fallback' with payload text, or as message text
  if (event.message?.text) {
    const digits = event.message.text.replace(/[^\d+]/g, '')
    if (/^\+?\d{10,15}$/.test(digits)) return digits
  }
  for (const att of event.message?.attachments || []) {
    const payload = att.payload as { text?: string } | undefined
    if (payload?.text) {
      const digits = payload.text.replace(/[^\d+]/g, '')
      if (/^\+?\d{10,15}$/.test(digits)) return digits
    }
  }
  return null
}
