// Meta Messenger Webhook
// GET  — verification handshake
// POST — message/referral/postback receiver.
//
// NEW occasion-offer conversation flow (auto-verify):
//   1. customer taps "Claim on Messenger" on the bill page → m.me?ref=TOKEN
//   2. referral event → bot greets (collects first/last name via Graph API)
//      and asks for the OFFER's verification data (admin-configured askText,
//      validated by fieldType: DATE / PHONE / TEXT)
//   3. customer replies:
//        • correct data → offer auto-applies to the bill + digital receipt
//        • wrong data (e.g. a phone number for a birthday-date offer) →
//          the bot re-asks — NO discount, scammers get nothing
//   4. every reply is stored on the customer record (admin 👥 কাস্টমার tab)
//
// Security: when META_APP_SECRET is configured, every POST must carry a valid
// X-Hub-Signature-256 HMAC — forged/fake webhook events can never apply discounts.
import { NextRequest } from 'next/server'
import crypto from 'crypto'
import { db } from '@/lib/db'
import { fail, ok } from '@/lib/api'
import { fetchProfileName, askPhoneQuickReply, sendReceipt, sendText } from '@/lib/messenger'
import { applyBirthdayDiscount } from '@/lib/birthday'
import { setSettings } from '@/lib/settings'
import { parseDateLoose, parsePhoneLoose } from '@/lib/verify'


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

/* ───────────────────────── conversation helpers ───────────────────────── */

/** default ask-text per field type (when the admin left askText empty) */
function defaultAsk(fieldType: string): string {
  if (fieldType === 'PHONE') return 'যাচাইয়ের জন্য আপনার ফোন নম্বরটি পাঠান।'
  if (fieldType === 'TEXT') return 'যাচাইয়ের জন্য নিচে আপনার তথ্যটি লিখে পাঠান।'
  return 'যাচাইয়ের জন্য তারিখটি লিখে পাঠান (যেমন: 15/03/1995 বা 15 মার্চ 1995)।'
}

/** wrong-data retry text per field type */
function retryAsk(fieldType: string): string {
  if (fieldType === 'PHONE') {
    return '😔 এটি সঠিক ফোন নম্বর মনে হচ্ছে না। ১১ ডিজিটের নম্বর লিখে পাঠান (যেমন: 01712345678)।'
  }
  if (fieldType === 'TEXT') {
    return '😔 বুঝতে পারা যায়নি — একটু পরিষ্কার করে আবার লিখে পাঠান।'
  }
  return '😔 এটি সঠিক তারিখ মনে হচ্ছে না। এভাবে লিখে পাঠান: 15/03/1995 অথবা 15 মার্চ 1995।'
}

/** build + send the "send me your verification data" message for an offer */
async function askVerificationData(
  psid: string,
  firstName: string,
  offer: { name: string; emoji: string; discount: number; askText: string | null; fieldType: string } | null,
  tableNumber: number,
): Promise<void> {
  const fieldType = offer?.fieldType || 'DATE'
  const ask = offer?.askText?.trim() || defaultAsk(fieldType)
  const head = offer
    ? `${offer.emoji || '🎁'} ${offer.name} — ৳${offer.discount} ছাড় অফার!\n\nস্বাগতম ${firstName}! 🎉\n\n${ask}`
    : `স্বাগতম ${firstName}! 🎉\n\n${ask}`
  const tail = `\n\n✅ সঠিক তথ্য পাঠালেই ছাড়টি আপনার বিলে (টেবিল ${tableNumber}) যোগ হয়ে যাবে।`
  const text = head + tail

  if (fieldType === 'PHONE') {
    await askPhoneQuickReply(psid, text)
  } else {
    await sendText(psid, text)
  }
}

/** upsert the CRM customer from a Facebook profile */
async function upsertCustomer(psid: string): Promise<{ firstName: string; lastName: string }> {
  const { firstName, lastName } = await fetchProfileName(psid)
  await db.customer.upsert({
    where: { psid },
    update: { firstName, lastName: lastName || '', lastSeenAt: new Date() },
    create: { psid, firstName, lastName: lastName || '', lastSeenAt: new Date() },
  })
  return { firstName, lastName }
}

/** find the newest PENDING referral token opened from this conversation */
async function pendingToken(psid: string) {
  return db.referralToken.findFirst({
    where: { status: 'PENDING', psid },
    orderBy: { createdAt: 'desc' },
  })
}

/** send the digital receipt after a successful claim */
async function sendBillReceipt(
  psid: string,
  firstName: string,
  t: { tableNumber: number; sessionId: string },
): Promise<void> {
  const orders = await db.order.findMany({
    where: { sessionId: t.sessionId },
    include: { items: true },
    orderBy: { placedAt: 'asc' },
  })
  const lines: string[] = [`🧾 ডিজিটাল রিসিট — টেবিল ${t.tableNumber}`]
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

/* ───────────────────────── event routing ───────────────────────── */

async function handleEvent(event: MessagingEvent) {
  const psid = event.sender?.id
  if (!psid) return

  // Case 1: customer opened m.me?ref=TOKEN (referral or postback)
  const ref = event.referral?.ref || event.postback?.referral?.ref
  if (ref) {
    const tokenRow = await db.referralToken.findUnique({ where: { token: ref } })
    const { firstName, lastName } = await upsertCustomer(psid)

    if (!tokenRow || tokenRow.status !== 'PENDING') return

    // remember who this conversation belongs to
    await db.referralToken.update({
      where: { token: ref },
      data: { name: `${firstName} ${lastName}`.trim() || 'Customer', psid },
    })

    // load the offer the customer picked on the bill page
    const offer = tokenRow.occasionId
      ? await db.occasionOffer.findUnique({ where: { id: tokenRow.occasionId } })
      : null

    // remember what we asked (shown in the admin panel)
    const fieldType = offer?.fieldType || 'DATE'
    const askedText = offer?.askText?.trim() || defaultAsk(fieldType)
    await db.referralToken.update({ where: { id: tokenRow.id }, data: { askedText } })

    await askVerificationData(
      psid,
      firstName,
      offer
        ? {
            name: offer.name,
            emoji: offer.emoji,
            discount: offer.discount,
            askText: offer.askText,
            fieldType: offer.fieldType,
          }
        : null,
      tokenRow.tableNumber,
    )
    return
  }

  // Case 2: customer sent something in the chat
  const text = event.message?.text || extractAttachmentText(event)
  const sharedPhone = extractPhone(event)

  if (event.message) {
    const { firstName, lastName } = await upsertCustomer(psid)
    const tokenRow = await pendingToken(psid)

    // 2a. no pending claim → friendly info (customer data still saved for CRM)
    if (!tokenRow) {
      await sendText(
        psid,
        `স্বাগতম ${firstName}! 🎉\n\nআমাদের বিশেষ অফার নিতে রেস্তোরাঁর বিল পেজ থেকে "🎉 Claim on Messenger" চাপুন — সেখান থেকে যাচাই করে ছাড় নিতে পারবেন।`
      )
      return
    }

    // 2b. load the offer's verification requirement
    const offer = tokenRow.occasionId
      ? await db.occasionOffer.findUnique({ where: { id: tokenRow.occasionId } })
      : null
    const fieldType = offer?.fieldType || 'DATE'

    // decide what the customer actually sent
    let dataText = (text || '').trim()
    if (sharedPhone && !dataText) dataText = sharedPhone

    let validData: string | null = null
    let parsedBirthday: Date | null = null
    let parsedPhone = ''

    if (fieldType === 'PHONE') {
      const phone = sharedPhone || parsePhoneLoose(dataText)
      if (phone) {
        validData = phone
        parsedPhone = phone
      }
    } else if (fieldType === 'DATE') {
      const d = parseDateLoose(dataText)
      if (d) {
        validData = d.normalized
        parsedBirthday = d.date
      }
    } else {
      // TEXT — any meaningful answer
      if (dataText.length >= 2) validData = dataText.slice(0, 300)
    }

    // 2c. WRONG data → re-ask, NO discount (scam attempt blocked)
    if (!validData) {
      await sendText(psid, retryAsk(fieldType))
      return
    }

    // 2d. correct data → AUTO-VERIFY: apply the offer to the bill right away
    const result = await applyBirthdayDiscount({
      psid,
      firstName,
      lastName,
      phone: parsedPhone,
      birthday: parsedBirthday,
      deviceId: tokenRow.deviceId,
      deviceFp: tokenRow.deviceFp,
      sessionId: tokenRow.sessionId,
      tableNumber: tokenRow.tableNumber,
      occasionId: tokenRow.occasionId,
      occasionName: tokenRow.occasionName,
      dataText: validData,
    })

    // keep the collected data on the customer profile (CRM)
    try {
      await db.customer.updateMany({
        where: { psid },
        data: {
          dataText: validData,
          ...(parsedBirthday ? { birthday: parsedBirthday } : {}),
          ...(parsedPhone ? { phone: parsedPhone } : {}),
          eventLabel: offer?.name || null,
        },
      })
    } catch {
      // phone may collide with another customer's number — dataText already
      // saved via the claim; never block the discount for a CRM hiccup
    }

    if (!result.ok) {
      await sendText(psid, `😔 ${result.message}`)
      return
    }

    // claim completed
    await db.referralToken.update({
      where: { id: tokenRow.id },
      data: { status: 'CLAIMED', phone: parsedPhone || null, birthday: parsedBirthday || undefined, dataText: validData },
    })

    await sendText(psid, `✅ যাচাই সফল — ${firstName}, আপনার অফারটি বিলে যোগ হয়েছে! 🎉`)
    await sendBillReceipt(psid, firstName, {
      tableNumber: tokenRow.tableNumber,
      sessionId: tokenRow.sessionId,
    })
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

function extractAttachmentText(event: MessagingEvent): string {
  for (const att of event.message?.attachments || []) {
    const payload = att.payload as { text?: string } | undefined
    if (payload?.text) return payload.text
  }
  return ''
}
