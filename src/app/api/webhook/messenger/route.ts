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
import { NextRequest, after } from 'next/server'
import crypto from 'crypto'
import { db } from '@/lib/db'
import { fail, ok } from '@/lib/api'
import { fetchMessengerProfile, askPhoneQuickReply, sendReceipt, sendText, sendRnOptInRequest, markdownEnabled } from '@/lib/messenger'
import { applyBirthdayDiscount } from '@/lib/birthday'
import { setSettings, getSetting } from '@/lib/settings'
import { SETTING_KEYS } from '@/lib/constants'
import { parseDateLoose, parsePhoneLoose } from '@/lib/verify'
import { nextCustomerCode } from '@/lib/customer-code'
import { usedVoucherIdsForPsid } from '@/lib/vouchers'
import { buildKnowledgeBase } from '@/lib/knowledge'
import { buildStaticReply } from '@/lib/bot-static'
import { t, pickBotLang, globalBotLang, aiLanguageFor, nameVar, type BotLang } from '@/lib/bot-text'
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
  // Marketing/Notification Messages opt-in (customer tapped [Get Updates] on
  // the opt-in card). Meta delivers the PSID as sender OR recipient depending
  // on the event type. New API: token comes as optin.notification_messages_token
  // and optin.payload is a string; legacy events carried optin.payload.token.
  optin?: {
    type?: string
    payload?: string | { token?: string; recurring_notification_topic?: string }
    notification_messages_token?: string
    notification_messages_timezone?: string
    title?: string
    user_token_status?: string
    ref?: string
  }
  message?: {
    text?: string
    mid?: string // Meta message id — re-delivery dedup
    is_echo?: boolean // our own page-sent messages echoed back — never reply to those
    quick_reply?: { payload?: string }
    attachments?: { type: string; payload?: unknown }[]
  }
}

// AI + Messenger কল webhook-এর after()-ফেজে চলে — Meta সাথে সাথেই 200 পায়,
// তাই টাইমআউট-জনিত একই মেসেজের বারবার re-delivery (একই fallback ৪ বার!) আর হয় না
// মালিকের নির্দেশ: কৃত্রিম টাইমআউট নেই — AI যত ইচ্ছা সময় নিয়ে বিশ্লেষণ করুক।
// ৩০০s = Vercel ফাংশনের সর্বোচ্চ (Fluid compute, Hobby)।
export const maxDuration = 300

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
        // Meta re-delivery dedup: একই message-id দ্বিতীয়বার এলে আর প্রসেস নয়
        // (নতুবা এক প্রশ্নের উত্তর ২-৩ বার চলে যেত)
        const mid = event.message?.mid
        if (mid) {
          if (seenMids.has(mid)) continue
          seenMids.set(mid, Date.now())
          if (seenMids.size > 1000) {
            const cutoff = Date.now() - 10 * 60 * 1000
            for (const [m, ts] of seenMids) {
              if (ts < cutoff) seenMids.delete(m)
            }
          }
        }
        after(() => handleEvent(event).catch((e) => console.error('[webhook:handler]', e)))
      }
    }
    return ok({ received: true })
  } catch (e) {
    console.error('[webhook:POST]', e)
    return ok({ received: true }) // always 200 for Meta
  }
}

/** processed message ids (re-delivery guard) — per instance, 10-minute window */
const seenMids = new Map<string, number>()

/**
 * ক্রস-ইনস্ট্যান্স ডুপ্লিকেট গার্ড: Meta একই মেসেজ অন্য instance-এ দিলে
 * (মেমরি-ডিডুপ তখন কাজ করে না) DB-তে এইমাত্র (৬০ সেকেন্ডে) একই কাস্টমার-টেক্সট
 * সেভ থাকলে সেটা ডুপ্লিকেট — দ্বিতীয়বার উত্তর যাবে না।
 */
async function isDuplicateCustomerMessage(psid: string, text: string): Promise<boolean> {
  try {
    const recent = await db.chatMessage.findFirst({
      where: {
        psid,
        role: 'customer',
        text: text.slice(0, 3000),
        createdAt: { gte: new Date(Date.now() - 60_000) },
      },
      select: { id: true },
    })
    return !!recent
  } catch {
    return false
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

/**
 * greeting head that never shows a placeholder name (localized)
 */
function greet(name: string, lang: BotLang): string {
  return t(lang, 'greet', { name: nameVar(name) })
}

/** friendly follow-the-page nudge (link shown when the page username is configured) */
async function followNudge(lang: BotLang): Promise<string> {
  const username = ((await getSetting(SETTING_KEYS.MESSENGER_PAGE_USERNAME)) || '').trim()
  if (!username) return ''
  return t(lang, 'followNudge', { url: `https://facebook.com/${username}` })
}

/** default ask-text per field type (when the admin left askText empty) */
function defaultAsk(fieldType: string, lang: BotLang): string {
  if (fieldType === 'PHONE') return t(lang, 'askPhone')
  if (fieldType === 'TEXT') return t(lang, 'askText')
  return t(lang, 'askDate')
}

/** wrong-data retry text per field type */
function retryAsk(fieldType: string, lang: BotLang): string {
  if (fieldType === 'PHONE') return t(lang, 'retryPhone')
  if (fieldType === 'TEXT') return t(lang, 'retryText')
  return t(lang, 'retryDate')
}

/** build + send the "send me your verification data" message for an offer */
async function askVerificationData(
  psid: string,
  name: string,
  offer: { name: string; emoji: string; discount: number; askText: string | null; fieldType: string } | null,
  tableNumber: number,
  lang: BotLang,
): Promise<void> {
  const fieldType = offer?.fieldType || 'DATE'
  const ask = offer?.askText?.trim() || defaultAsk(fieldType, lang)
  const head = offer
    ? t(lang, 'askOfferHead', {
        emoji: offer.emoji || '🎁',
        offer: offer.name,
        discount: offer.discount,
        greet: greet(name, lang),
        ask,
      })
    : `${greet(name, lang)}\n\n${ask}`
  const tail = t(lang, 'askTail', { table: tableNumber })
  const text = head + tail

  if (fieldType === 'PHONE') {
    await askPhoneQuickReply(psid, text)
  } else {
    await sendText(psid, text)
  }
}

/** upsert the CRM customer from a Facebook profile */
async function upsertCustomer(psid: string): Promise<{ name: string; firstName: string; lastName: string; language: string | null }> {
  const profile = await fetchMessengerProfile(psid)
  const firstName = profile.firstName
  const lastName = profile.lastName
  // only overwrite the stored name when Facebook actually returned one — a failed
  // Graph lookup must never wipe a real name the AI learned earlier (নাম যাচাই বাকি loop)
  const row = await db.customer.upsert({
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
  return { name: politeName({ firstName, lastName }), firstName, lastName, language: row.language }
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
  info: { tableNumber: number; sessionId: string },
  lang: BotLang,
): Promise<void> {
  const orders = await db.order.findMany({
    where: { sessionId: info.sessionId },
    include: { items: true },
    orderBy: { placedAt: 'asc' },
  })
  const lines: string[] = [t(lang, 'receiptTitle', { table: info.tableNumber })]
  let payable = 0
  for (const o of orders) {
    payable += o.total
    lines.push(t(lang, 'receiptOrderNo', { no: o.orderNo }))
    for (const i of o.items) {
      lines.push(`  • ${i.itemName} ×${i.quantity} — ৳${i.lineTotal}`)
    }
    if (o.voucherDiscount) lines.push(t(lang, 'receiptCoupon', { amt: o.voucherDiscount }))
    if (o.happyHourDiscount) lines.push(t(lang, 'receiptHappy', { amt: o.happyHourDiscount }))
    if (o.birthdayDiscount) lines.push(t(lang, 'receiptOffer', { amt: o.birthdayDiscount }))
  }
  lines.push(t(lang, 'receiptTotal', { amt: Math.round(payable * 100) / 100 }))
  lines.push(t(lang, 'receiptThanks', { name: nameVar(name) }))
  lines.push(await followNudge(lang))
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
  // admin-marked language → the bot always replies in it; no mark → the global
  // bot_language setting; both empty → the AI mirrors the customer's language
  let customerNotes: string | undefined
  let customerLanguage: string | null | undefined
  try {
    const cust = await db.customer.findUnique({
      where: { psid },
      select: {
        language: true,
        notes: { orderBy: { createdAt: 'desc' as const }, take: 10, select: { kind: true, text: true } },
      },
    })
    customerLanguage = await aiLanguageFor(cust?.language)
    if (cust?.notes?.length) {
      customerNotes = cust.notes.map((n) => `- ${n.text}`).join('\n')
    }
  } catch {
    /* notes are optional — chat works without them */
  }

  const [kb, history] = await Promise.all([
    buildKnowledgeBase({ excludeVoucherIds: await usedVoucherIdsForPsid(psid) }),
    loadChatHistory(psid, 10),
  ])
  const chatOpts = {
    knowledgeBase: kb.text,
    history,
    customerMessage,
    customerName: profileName,
    customerNotes,
    customerLanguage,
    extraPersona: cfg.persona,
    formatting: await markdownEnabled(), // বন্ধ থাকলে AI মার্কডাউন চিহ্নই লিখবে না
    cfg,
  }
  // রোটেশন ইঞ্জিনেই বহু key × বহু মডেল × রিট্রাই-রাউন্ড আছে — এখানে আর দ্বিতীয়
  // পুরো চেষ্টা নয় (আগের ডাবল-রিট্রাই ফ্রি-কোটা দ্রুত শেষ করে দিত)
  const ai = await chatWithCustomer(chatOpts)
  if (!ai.ok || !ai.reply) {
    console.error('[webhook:ai]', ai.error)
    // ডায়াগনস্টিকস: শেষ AI ব্যর্থতার কারণ admin প্যানেলে দেখা যাবে (১ মিনিট থ্রটল)
    recordAiError(ai.error || 'unknown')
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
  extracted: { name: string | null; phone: string | null; address: string | null; specialDay: string | null; specialDayLabel: string | null; note: string | null; language?: string | null },
): Promise<void> {
  const has = extracted.name || extracted.phone || extracted.address || extracted.specialDay || extracted.note || extracted.language
  if (!has) return
  try {
    // a stated phone only counts when it parses; a special day only when it parses as a date
    const phone = extracted.phone ? parsePhoneLoose(extracted.phone) : null
    const day = extracted.specialDay ? parseDateLoose(extracted.specialDay) : null
    // a learned name also fills a placeholder profile name ("নাম যাচাই বাকি" / "Customer")
    // so the admin sees the real name on the CRM card right away
    const current = extracted.name || extracted.language
      ? await db.customer.findUnique({ where: { psid }, select: { firstName: true, language: true } })
      : null
    const fillsName = !!extracted.name && isPlaceholderName(current?.firstName)
    // detected language only fills an EMPTY preference — the admin's manual
    // mark always wins and is never overwritten by the AI
    const fillsLanguage = !!extracted.language && !current?.language
    await db.customer.updateMany({
      where: { psid },
      data: {
        ...(extracted.name ? { statedName: extracted.name.slice(0, 120) } : {}),
        ...(fillsName ? { firstName: extracted.name!.slice(0, 60), lastName: '' } : {}),
        ...(phone ? { phone } : {}),
        ...(extracted.address ? { address: extracted.address.slice(0, 500) } : {}),
        ...(day ? { birthday: day.date } : {}),
        ...(day && extracted.specialDayLabel ? { eventLabel: extracted.specialDayLabel.slice(0, 80) } : {}),
        ...(fillsLanguage ? { language: extracted.language } : {}),
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

/** last AI failure (admin diagnostics) — written at most once a minute */
const KEY_LAST_AI_ERR = 'gemini_last_error'
let lastAiErrWrite = 0
let lastAiErrText = ''
function recordAiError(error: string) {
  const text = `${new Date().toISOString()} — ${error}`.slice(0, 500)
  if (text === lastAiErrText && Date.now() - lastAiErrWrite < 60_000) return
  lastAiErrWrite = Date.now()
  lastAiErrText = text
  setSettings({ [KEY_LAST_AI_ERR]: text }).catch(() => {})
}

/* ───────────────────── Recurring Notifications (24h-বাইপাস মার্কেটিং) ───────────────────── */

const RN_ASK_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000 // ask at most every 14 days — never nag

/**
 * store/refresh the Recurring Notifications opt-in token on the CRM customer.
 * This is the moment the customer becomes reachable FOREVER (beyond Meta's
 * 24-hour window) — the birthday cron and admin broadcasts use this token.
 */
async function handleRnOptIn(psid: string, optin: NonNullable<MessagingEvent['optin']>): Promise<void> {
  try {
    await upsertCustomer(psid) // ensure the CRM row exists (code, name, …)
    if (optin.user_token_status === 'REVOKED') {
      await db.customer.updateMany({ where: { psid }, data: { rnToken: null, rnTopic: null, rnOptInAt: null } })
      console.log('[webhook:rn] opt-in revoked —', psid)
      return
    }
    const token = optin.notification_messages_token || (typeof optin.payload === 'object' && optin.payload?.token) || ''
    if (!token) return
    const topic = optin.title || (typeof optin.payload === 'string' ? optin.payload : null) || (typeof optin.payload === 'object' ? optin.payload?.recurring_notification_topic : null) || null
    await db.customer.updateMany({
      where: { psid },
      data: {
        rnToken: token,
        rnTopic: topic,
        rnOptInAt: new Date(),
      },
    })
    console.log('[webhook:rn] opt-in stored —', psid)
  } catch (e) {
    console.error('[webhook:rn]', e)
  }
}

/**
 * একবারই (১৪ দিন কুলডাউন) RN অপট-ইন কার্ড পাঠাই — কাস্টমার যখন সবচেয়ে
 * এনগেজড (অফার নিয়েছে / চ্যাট করছে)। কার্ডের [Opt-in] বাটনে ক্লিক করলেই
 * ২৪ ঘণ্টা পার হলেও সাপ্তাহিক অফার ও জন্মদিনের সারপ্রাইজ পাঠানো যাবে।
 */
async function maybeAskRnOptIn(psid: string): Promise<void> {
  try {
    const cust = await db.customer.findUnique({ where: { psid }, select: { rnToken: true, rnAskedAt: true, language: true } })
    if (!cust || cust.rnToken) return // ইতোমধ্যে অপট-ইন করা — আর ভদ্রতা দেখানোর দরকার নেই
    if (cust.rnAskedAt && Date.now() - cust.rnAskedAt.getTime() < RN_ASK_COOLDOWN_MS) return // no-nag guard
    await db.customer.update({ where: { psid }, data: { rnAskedAt: new Date() } })
    // কার্ডের টাইটেলও কাস্টমারের ভাষায় (admin টাইটেল না দিলে প্যাক-ডিফল্ট)
    const lang = pickBotLang(cust.language, await globalBotLang())
    const title = ((await getSetting(SETTING_KEYS.META_RN_TITLE)) || '').trim() || t(lang, 'rnTitleDefault')
    const logo = ((await getSetting(SETTING_KEYS.RESTAURANT_LOGO_URL)) || '').trim() || null
    const r = await sendRnOptInRequest(psid, { title, imageUrl: logo })
    if (!r.ok) console.error('[webhook:rn-ask]', r.error)
  } catch (e) {
    console.error('[webhook:rn-ask]', e)
  }
}

/* ───────────────────────── event routing ───────────────────────── */

async function handleEvent(event: MessagingEvent) {
  // Case 0: Recurring Notifications opt-in — the customer tapped [Opt-in] on the
  // RN template card. The PSID may arrive as sender OR recipient (Meta uses
  // recipient for marketing-message opt-ins), so check both.
  if (event.optin && (event.optin.notification_messages_token || (typeof event.optin.payload === 'object' && event.optin.payload?.token) || event.optin.user_token_status === 'REVOKED')) {
    const psidOptin = event.sender?.id || event.recipient?.id
    if (psidOptin) await handleRnOptIn(psidOptin, event.optin)
    return
  }
  const psid = event.sender?.id
  if (!psid) return
  // our own outgoing messages are echoed back as messages — never self-reply
  if (event.message?.is_echo) return

  // Case 1: customer opened m.me?ref=TOKEN (referral or postback)
  const ref = event.referral?.ref || event.postback?.referral?.ref
  if (ref) {
    const tokenRow = await db.referralToken.findUnique({ where: { token: ref } })
    const cust = await upsertCustomer(psid)
    const { name } = cust
    // ভাষা: কাস্টমারের মার্ক করা ভাষা > admin গ্লোবাল সেটিং > বাংলা
    const lang = pickBotLang(cust.language, await globalBotLang())

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
    const askedText = offer?.askText?.trim() || defaultAsk(fieldType, lang)
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
      lang,
    )
    return
  }

  // Case 2: customer sent something in the chat
  const text = event.message?.text || extractAttachmentText(event)
  const sharedPhone = extractPhone(event)

  if (event.message) {
    const cust = await upsertCustomer(psid)
    const { name, lastName } = cust
    // ভাষা: কাস্টমারের মার্ক করা ভাষা > admin গ্লোবাল সেটিং > বাংলা — এই কথোপকথনের সব স্ট্যাটিক মেসেজ এতেই যাবে
    const lang = pickBotLang(cust.language, await globalBotLang())
    const tokenRow = await pendingToken(psid)
    const dataTextIn = (text || sharedPhone || '').trim()
    if (dataTextIn) {
      // ক্রস-ইনস্ট্যান্স ডুপ্লিকেট — একই প্রশ্নে দ্বিতীয় উত্তর কখনো যাবে না
      if (await isDuplicateCustomerMessage(psid, dataTextIn)) return
      await saveChatTurn(psid, 'customer', dataTextIn)
    }

    // 2a. no pending claim → AI chat (AI down → লাইভ নলেজ বেস থেকে সঠিক উত্তর)
    if (!tokenRow) {
      const aiOn = dataTextIn ? await aiChatEnabled() : false
      const aiHandled = aiOn ? await aiGeneralReply(psid, name, dataTextIn) : false
      if (!aiHandled && dataTextIn) {
        // AI চলেনি (কোটা/নেটওয়ার্ক) বা বন্ধ — কখনোই "সমস্যা হচ্ছে, পরে লিখুন"
        // জাতীয় মেসেজ যায় না। লাইভ ডাটাবেস থেকে চলমান অফার/কুপন/মেনু সাজিয়ে
        // কাস্টমারের প্রশ্নের সঠিক উত্তরই যায় (bot-static.ts)।
        const staticReply = await buildStaticReply({ lang, message: dataTextIn, psid })
        await sendText(psid, staticReply)
        await saveChatTurn(psid, 'bot', staticReply)
      }
      // সরাসরি পেজে মেসেজ দেওয়া কাস্টমারও RN-এর সুযোগ পাক (একবারই, কুলডাউন গার্ড সহ)
      await maybeAskRnOptIn(psid)
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
      // admin-marked / global language → the verify conversation respects it too
      const markedLang = await db.customer.findUnique({ where: { psid }, select: { language: true } })
      const ai = await verificationChat({
        fieldType: fieldType as 'DATE' | 'PHONE' | 'TEXT',
        offerName: offer?.name || 'বিশেষ অফার',
        askText: offer?.askText?.trim() || defaultAsk(fieldType, lang),
        lastAskSent: tokenRow.askedText,
        askCount,
        knowledgeBase: kb.text,
        history,
        customerMessage: dataText,
        customerLanguage: await aiLanguageFor(markedLang?.language),
        formatting: await markdownEnabled(),
        cfg,
      })

      // customer said the occasion doesn't apply (not married / not my birthday…)
      // → close the claim gracefully, pivot warmly to offers that DO fit them
      if (ai.ok && ai.action === 'CANCEL') {
        await db.referralToken.update({
          where: { id: tokenRow.id },
          data: { status: 'CANCELLED', dataText: dataText.slice(0, 300) },
        })
        const pivot = ai.reply || t(lang, 'cancelPivot')
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
          await sendText(psid, retryAsk(fieldType, lang))
          await db.referralToken.update({ where: { id: tokenRow.id }, data: { askCount: askCount + 1 } })
        } else {
          await sendText(psid, t(lang, 'softWait'))
        }
        return
      }
    }

    // 2d. WRONG data / AI off → re-ask at most twice, then STOP nagging (soft mode:
    // friendly chat; if the datum arrives later the parsers still apply the offer)
    if (!validData) {
      const askCount = tokenRow.askCount || 0
      if (askCount < 2) {
        await sendText(psid, retryAsk(fieldType, lang))
        await db.referralToken.update({ where: { id: tokenRow.id }, data: { askCount: askCount + 1 } })
      } else {
        const handled = await aiGeneralReply(psid, name, dataText)
        if (!handled) {
          await sendText(psid, t(lang, 'softWaitMore'))
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
      lang,
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

    await sendText(psid, t(lang, 'verifySuccess', { name: nameVar(name) }))
    await sendBillReceipt(
      psid,
      name,
      {
        tableNumber: tokenRow.tableNumber,
        sessionId: tokenRow.sessionId,
      },
      lang,
    )

    // সবচেয়ে এনগেজড মুহূর্ত — অফার পেয়ে খুশি কাস্টমারকে একবারই (১৪ দিন
    // কুলডাউন) RN অপট-ইন কার্ড দেখাই: ২৪ ঘণ্টা পার হলেও ভবিষ্যতের সব
    // অফার/জন্মদিনের শুভেচ্ছা তাকে পৌঁছে দেওয়ার লিগ্যাল চ্যানেল চালু হয়
    await maybeAskRnOptIn(psid)
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
