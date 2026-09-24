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
import { fetchMessengerProfile, askPhoneQuickReply, sendReceipt, sendText } from '@/lib/messenger'
import { applyBirthdayDiscount } from '@/lib/birthday'
import { setSettings, getSetting } from '@/lib/settings'
import { SETTING_KEYS } from '@/lib/constants'
import { parseDateLoose, parsePhoneLoose } from '@/lib/verify'
import { nextCustomerCode } from '@/lib/customer-code'
import { buildKnowledgeBase } from '@/lib/knowledge'
import {
  aiChatEnabled,
  chatWithCustomer,
  verificationChat,
  getGeminiConfig,
  loadChatHistory,
  saveChatTurn,
} from '@/lib/gemini'


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
    is_echo?: boolean // our own page-sent messages echoed back — never reply to those
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

/**
 * Real customer name from the Facebook profile. Falls back to '' — we NEVER
 * greet people with a placeholder word like "Customer".
 */
function politeName(p: { firstName?: string | null; lastName?: string | null }): string {
  const f = (p.firstName || '').trim()
  const l = (p.lastName || '').trim()
  const full = `${f} ${l}`.trim()
  if (!full || /^customer$/i.test(full)) return ''
  return full
}

/** greeting head that never shows a placeholder name */
function greet(name: string): string {
  return name ? `স্বাগতম ${name}! 🎉` : 'স্বাগতম! 🎉'
}

/** friendly follow-the-page nudge (link shown when the page username is configured) */
async function followNudge(): Promise<string> {
  const username = ((await getSetting(SETTING_KEYS.MESSENGER_PAGE_USERNAME)) || '').trim()
  if (!username) return ''
  return `\n\n💙 আমাদের Facebook পেজ Follow করে রাখুন — নতুন অফার সবার আগে পাবেন!\n${'https://facebook.com/'}${username}`
}

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
  name: string,
  offer: { name: string; emoji: string; discount: number; askText: string | null; fieldType: string } | null,
  tableNumber: number,
): Promise<void> {
  const fieldType = offer?.fieldType || 'DATE'
  const ask = offer?.askText?.trim() || defaultAsk(fieldType)
  const head = offer
    ? `${offer.emoji || '🎁'} ${offer.name} — ৳${offer.discount} ছাড় অফার!\n\n${greet(name)} দারুণ পছন্দ! 😊\n\nশুধু ছোট্ট একটা যাচাই দরকার — ${ask}`
    : `${greet(name)}\n\n${ask}`
  const tail = `\n\nযেভাবে সুবিধা হয় লিখতে পারেন (বাংলা/English)।\n✅ তথ্যটি মিলে গেলেই ছাড়টি আপনার বিলে (টেবিল ${tableNumber}) যোগ হয়ে যাবে।`
  const text = head + tail

  if (fieldType === 'PHONE') {
    await askPhoneQuickReply(psid, text)
  } else {
    await sendText(psid, text)
  }
}

/** upsert the CRM customer from a Facebook profile */
async function upsertCustomer(psid: string): Promise<{ name: string; firstName: string; lastName: string }> {
  const profile = await fetchMessengerProfile(psid)
  const firstName = profile.firstName
  const lastName = profile.lastName
  // only overwrite the stored name when Facebook actually returned one — a failed
  // Graph lookup must never wipe a real name the AI learned earlier (নাম যাচাই বাকি loop)
  await db.customer.upsert({
    where: { psid },
    update: {
      ...(firstName ? { firstName } : {}),
      ...(lastName ? { lastName } : {}),
      lastSeenAt: new Date(),
    },
    create: {
      psid,
      code: await nextCustomerCode(), // unique CRM code (C-0001…) for quick lookup
      firstName: firstName || 'নাম যাচাই বাকি',
      lastName: lastName || '',
      lastSeenAt: new Date(),
    },
  })
  return { name: politeName({ firstName, lastName }), firstName, lastName }
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
  name: string,
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
  lines.push(`\nধন্যবাদ${name ? ` ${name}` : ''}! 🙏 আবার আসবেন — বিল আপডেট ও অফার পেতে এই চ্যাটটি রেখে দিন।`)
  lines.push(await followNudge())
  await sendReceipt(psid, [{ text: lines.join('\n') }])
}

/* ───────────────────────── AI chatbot (Gemini) ───────────────────────── */

/**
 * General conversation path (no pending offer claim): the customer just talked
 * to the page. Gemini answers in the customer's own language (বাংলা/বাংলিশ/
 * English/Hindi…) using the live knowledge base, and any customer data that
 * appears naturally (name / phone / address / special day) lands in the CRM.
 */
async function aiGeneralReply(psid: string, profileName: string, customerMessage: string): Promise<boolean> {
  const cfg = await getGeminiConfig()
  if (!cfg.enabled || !cfg.keys.length) return false

  // CRM notes & tags → the bot genuinely remembers this customer
  // ("আবার দেখা হলো রাকিব ভাই! গতবারের মতো বিরিয়ানি হবে?")
  let customerNotes: string | undefined
  try {
    const cust = await db.customer.findUnique({
      where: { psid },
      select: { notes: { orderBy: { createdAt: 'desc' as const }, take: 10, select: { kind: true, text: true } } },
    })
    if (cust?.notes?.length) {
      customerNotes = cust.notes.map((n) => `- ${n.text}`).join('\n')
    }
  } catch {
    /* notes are optional — chat works without them */
  }

  const [kb, history] = await Promise.all([buildKnowledgeBase(), loadChatHistory(psid, 10)])
  const ai = await chatWithCustomer({
    knowledgeBase: kb.text,
    history,
    customerMessage,
    customerName: profileName,
    customerNotes,
    extraPersona: cfg.persona,
    cfg,
  })
  if (!ai.ok || !ai.reply) {
    console.error('[webhook:ai]', ai.error)
    return false
  }

  await sendText(psid, ai.reply)

  // history + CRM writes are best-effort — never block the conversation
  // (the customer turn was already saved by the caller before routing)
  await saveChatTurn(psid, 'bot', ai.reply)
  await saveAiCrmData(psid, ai.extracted)
  return true
}

/** persist the data the AI picked up during small talk (CRM enrichment) */
async function saveAiCrmData(
  psid: string,
  extracted: { name: string | null; phone: string | null; address: string | null; specialDay: string | null; specialDayLabel: string | null; note: string | null },
): Promise<void> {
  const has = extracted.name || extracted.phone || extracted.address || extracted.specialDay || extracted.note
  if (!has) return
  try {
    // a stated phone only counts when it parses; a special day only when it parses as a date
    const phone = extracted.phone ? parsePhoneLoose(extracted.phone) : null
    const day = extracted.specialDay ? parseDateLoose(extracted.specialDay) : null
    // a learned name also fills a placeholder profile name ("নাম যাচাই বাকি" / "Customer")
    // so the admin sees the real name on the CRM card right away
    const current = extracted.name
      ? await db.customer.findUnique({ where: { psid }, select: { firstName: true } })
      : null
    const fillsName = !!extracted.name && isPlaceholderName(current?.firstName)
    await db.customer.updateMany({
      where: { psid },
      data: {
        ...(extracted.name ? { statedName: extracted.name.slice(0, 120) } : {}),
        ...(fillsName ? { firstName: extracted.name!.slice(0, 60), lastName: '' } : {}),
        ...(phone ? { phone } : {}),
        ...(extracted.address ? { address: extracted.address.slice(0, 500) } : {}),
        ...(day ? { birthday: day.date } : {}),
        ...(day && extracted.specialDayLabel ? { eventLabel: extracted.specialDayLabel.slice(0, 80) } : {}),
        lastSeenAt: new Date(),
      },
    })
    // notable fact from the conversation → CRM note the admin can act on
    if (extracted.note) {
      const cust = await db.customer.findUnique({ where: { psid }, select: { id: true } })
      if (cust) {
        const text = extracted.note.slice(0, 500)
        const dup = await db.customerNote.findFirst({
          where: { customerId: cust.id, kind: 'AI', text, createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
        })
        if (!dup) await db.customerNote.create({ data: { customerId: cust.id, kind: 'AI', text, createdBy: 'ai' } })
      }
    }
  } catch {
    /* pre-migration DB or phone unique-collision — never block the chat */
  }
}

/** FB profile lookup can fail silently → placeholder names the webhook stores */
function isPlaceholderName(name?: string | null): boolean {
  const n = (name || '').trim()
  return !n || n === 'Customer' || n === 'নাম যাচাই বাকি'
}

/* ───────────────────────── event routing ───────────────────────── */

async function handleEvent(event: MessagingEvent) {
  const psid = event.sender?.id
  if (!psid) return
  // our own outgoing messages are echoed back as messages — never self-reply
  if (event.message?.is_echo) return

  // Case 1: customer opened m.me?ref=TOKEN (referral or postback)
  const ref = event.referral?.ref || event.postback?.referral?.ref
  if (ref) {
    const tokenRow = await db.referralToken.findUnique({ where: { token: ref } })
    const { name } = await upsertCustomer(psid)

    if (!tokenRow || tokenRow.status !== 'PENDING') return

    // remember who this conversation belongs to
    await db.referralToken.update({
      where: { token: ref },
      data: { name: name || 'নাম যাচাই বাকি', psid },
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
      name,
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
    const { name, lastName } = await upsertCustomer(psid)
    const tokenRow = await pendingToken(psid)
    const dataTextIn = (text || sharedPhone || '').trim()
    if (dataTextIn) await saveChatTurn(psid, 'customer', dataTextIn)

    // 2a. no pending claim → AI chat (or friendly info fallback)
    if (!tokenRow) {
      const aiHandled =
        dataTextIn && (await aiChatEnabled())
          ? await aiGeneralReply(psid, name, dataTextIn)
          : false
      if (!aiHandled) {
        await sendText(
          psid,
          `${greet(name)}\n\nআমাদের বিশেষ অফার নিতে রেস্তোরাঁর বিল পেজ থেকে "🎉 Claim on Messenger" চাপুন — সেখান থেকে যাচাই করে ছাড় নিতে পারবেন।${await followNudge()}`
        )
      }
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

    // 2c. parsers failed → AI verification CONVERSATION (human, sales-pro, never
    // nagging): answers what the customer actually said, extracts the datum from
    // ANY language, and gracefully cancels when the occasion doesn't apply.
    // Every extracted datum is re-validated with the SAME deterministic parsers —
    // the AI can never bypass verification or invent a discount.
    if (!validData && dataText && (await aiChatEnabled())) {
      const cfg = await getGeminiConfig()
      const [kb, hist] = await Promise.all([buildKnowledgeBase(), loadChatHistory(psid, 8)])
      // history already contains the current customer message (saved by the caller) — drop the duplicate
      const history = hist.filter((h, i) => !(i === hist.length - 1 && h.role === 'user' && h.text === dataText))
      const askCount = tokenRow.askCount || 0
      const ai = await verificationChat({
        fieldType: fieldType as 'DATE' | 'PHONE' | 'TEXT',
        offerName: offer?.name || 'বিশেষ অফার',
        askText: offer?.askText?.trim() || defaultAsk(fieldType),
        lastAskSent: tokenRow.askedText,
        askCount,
        knowledgeBase: kb.text,
        history,
        customerMessage: dataText,
        cfg,
      })

      // customer said the occasion doesn't apply (not married / not my birthday…)
      // → close the claim gracefully, pivot warmly to offers that DO fit them
      if (ai.ok && ai.action === 'CANCEL') {
        await db.referralToken.update({
          where: { id: tokenRow.id },
          data: { status: 'CANCELLED', dataText: dataText.slice(0, 300) },
        })
        const pivot = ai.reply || 'কোনো সমস্যা নেই! 😊 আমাদের আরও দারুণ অফার আছে — রেস্তোরাঁয় এসে উপভোগ করুন!'
        await sendText(psid, pivot)
        await saveChatTurn(psid, 'bot', pivot)
        return
      }

      if (ai.ok && ai.extracted) {
        if (fieldType === 'PHONE') {
          const p = parsePhoneLoose(ai.extracted)
          if (p) {
            validData = p
            parsedPhone = p
          }
        } else if (fieldType === 'DATE') {
          const d = parseDateLoose(ai.extracted)
          if (d) {
            validData = d.normalized
            parsedBirthday = d.date
          }
        } else if (ai.extracted.length >= 2) {
          validData = ai.extracted.slice(0, 300)
        }
      }

      // still nothing → the AI's warm reply (max 2 gentle asks, then it just
      // chats like a friend). The pending token STAYS alive — deterministic
      // parsers keep running on every next message, so late data still applies
      // the offer silently.
      if (!validData && ai.ok) {
        if (ai.reply) {
          await sendText(psid, ai.reply)
          await saveChatTurn(psid, 'bot', ai.reply)
        }
        if (askCount < 2) {
          await db.referralToken.update({
            where: { id: tokenRow.id },
            data: { askCount: askCount + 1, ...(ai.reply ? { askedText: ai.reply.slice(0, 300) } : {}) },
          })
        }
        return
      }

      // AI down (quota/network) → static retry while we haven't nagged, else soft
      if (!validData && !ai.ok) {
        if (askCount < 2) {
          await sendText(psid, retryAsk(fieldType))
          await db.referralToken.update({ where: { id: tokenRow.id }, data: { askCount: askCount + 1 } })
        } else {
          await sendText(psid, '😊 ঠিক আছে! সুবিধামতো সময়ে তথ্যটি পাঠিয়ে দিলেই অফারটি আপনার বিলে যোগ হয়ে যাবে।')
        }
        return
      }
    }

    // 2d. WRONG data / AI off → re-ask at most twice, then STOP nagging (soft mode:
    // friendly chat; if the datum arrives later the parsers still apply the offer)
    if (!validData) {
      const askCount = tokenRow.askCount || 0
      if (askCount < 2) {
        await sendText(psid, retryAsk(fieldType))
        await db.referralToken.update({ where: { id: tokenRow.id }, data: { askCount: askCount + 1 } })
      } else {
        const handled = await aiGeneralReply(psid, name, dataText)
        if (!handled) {
          await sendText(psid, '😊 ঠিক আছে! সুবিধামতো সময়ে তথ্যটি পাঠিয়ে দিলেই অফারটি আপনার বিলে যোগ হয়ে যাবে। আর কিছু জানতে চাইলে বলুন!')
        }
      }
      return
    }

    // 2e. correct data → AUTO-VERIFY: apply the offer to the bill right away
    const result = await applyBirthdayDiscount({
      psid,
      firstName: name || 'নাম যাচাই বাকি',
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

    await sendText(
      psid,
      `✅ যাচাই সফল${name ? ` — ${name}` : ''}, আপনার অফারটি বিলে যোগ হয়েছে! 🎉`
    )
    await sendBillReceipt(psid, name, {
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
