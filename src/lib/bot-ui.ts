// Messenger Rich-UI অ্যাকশন লেয়ার — কুইক-রিপ্লাই বাটন, কার্ড-ক্যারোসেল আর
// পার্সিস্টেন্ট মেনুর পেছনের "এক ট্যাপে সঠিক উত্তর" ইঞ্জিন।
//
// কাস্টমার বাটনে ট্যাপ করলে webhook-এ quick_reply.payload / postback.payload
// আসে — AI-র জন্য অপেক্ষা নয়, এখান থেকে সরাসরি লাইভ ডাটাবেসের উত্তর যায়:
//   [🍕 মেনু]          → খাবারের কার্ড-ক্যারোসেল (ছবি+নাম+দাম+অর্ডার বাটন)
//                        + নিচে ক্যাটাগরি চিপ (ট্যাপ → সেই ক্যাটাগরির কার্ড)
//   [🍱 ক্যাটাগরি]      → __CAT__:<id> — সেই ক্যাটাগরির আইটেম-ক্যারোসেল
//   [📄 টেক্সট মেনু]    → ছবি ছাড়া পুরো মেনু (ফ্রি-ফেসবুক/ডাটা-ছাড়া কাস্টমার)
//   [🔥 অফার]          → চলমান অফার/কুপন/হ্যাপি আওয়ার (bot-static)
//   [📍 লোকেশন]        → AI নলেজ-বেস থেকে ঠিকানা (AI নিভে থাকলে উষ্ণ স্ট্যাটিক)
//   [☎️ হেল্পলাইন]      → AI নলেজ-বেস থেকে যোগাযোগ (ফোন/সময় — admin-লেখা)
import { db } from '@/lib/db'
import { getSetting } from '@/lib/settings'
import { SETTING_KEYS } from '@/lib/constants'
import { buildStaticReply } from '@/lib/bot-static'
import { t, type BotLang } from '@/lib/bot-text'
import {
  sendQuickReplies,
  sendGenericCarousel,
  sendText,
  type QuickReply,
  type CarouselCard,
} from '@/lib/messenger'

/* ───────────────────── deterministic action payloads ───────────────────── */

export const BOT_ACTIONS = {
  MENU: '__MENU__',
  OFFERS: '__OFFERS__',
  LOCATION: '__LOCATION__',
  HELPLINE: '__HELPLINE__',
  ORDER: '__ORDER__',
  TEXTMENU: '__TEXTMENU__',
  CAT: '__CAT__', // prefix-form: __CAT__:<categoryId> বা __CAT__:all
  ACT: '__ACT__', // prefix-form: __ACT__:<botActionId> — admin-এর কাস্টম অ্যাকশন
  HOME: '__HOME__', // ⬅️ পেছনে → বটের হোম-মেনু (৫টা মূল বাটনের স্ক্রিন)
} as const

export type BotActionKey = (typeof BOT_ACTIONS)[keyof typeof BOT_ACTIONS]

export const CAT_PAYLOAD_PREFIX = '__CAT__:'
export const ACT_PAYLOAD_PREFIX = '__ACT__:'

/** ক্যাটাগরি-চিপ/মেনু-বাটনের payload বানায় (categoryId='all' → সব খাবার) */
export function catPayload(categoryId: string): string {
  return `${CAT_PAYLOAD_PREFIX}${categoryId}`
}

/** কাস্টম-অ্যাকশন (BotAction) বাটনের payload */
export function actPayload(id: string): string {
  return `${ACT_PAYLOAD_PREFIX}${id}`
}

/** পার্সিস্টেন্ট-মেনু বাটনের payload হিসেবে গ্রহণযোগ্য কি না (admin validation) */
export function isValidMenuPayload(payload: string): boolean {
  const p = (payload || '').trim()
  if (!p) return false
  if (p === BOT_ACTIONS.CAT || p.startsWith(CAT_PAYLOAD_PREFIX)) return p === BOT_ACTIONS.CAT || p.length > CAT_PAYLOAD_PREFIX.length
  if (p === BOT_ACTIONS.ACT || p.startsWith(ACT_PAYLOAD_PREFIX)) return p === BOT_ACTIONS.ACT || p.length > ACT_PAYLOAD_PREFIX.length
  return (Object.values(BOT_ACTIONS) as string[]).includes(p)
}

/** payload → action key (unknown payload → null) */
export function botActionFromPayload(payload: string | undefined | null): BotActionKey | null {
  const p = (payload || '').trim()
  if (!p) return null
  if (p === BOT_ACTIONS.CAT || p.startsWith(CAT_PAYLOAD_PREFIX)) return BOT_ACTIONS.CAT
  if (p === BOT_ACTIONS.ACT || p.startsWith(ACT_PAYLOAD_PREFIX)) return BOT_ACTIONS.ACT
  const values = Object.values(BOT_ACTIONS) as string[]
  return values.includes(p) ? (p as BotActionKey) : null
}

/** প্রতিটি উত্তরের নিচে থাকা ট্যাপ-বাটন সেট — কথোপকথন কখনো গলধঃকরা লাগে না */
export function botQuickReplies(lang: BotLang): QuickReply[] {
  void lang
  return [
    { title: '🍕 মেনু দেখুন', payload: BOT_ACTIONS.MENU },
    { title: '🔥 আজকের অফার', payload: BOT_ACTIONS.OFFERS },
    { title: '📍 লোকেশন', payload: BOT_ACTIONS.LOCATION },
    { title: '☎️ হেল্পলাইন', payload: BOT_ACTIONS.HELPLINE },
    { title: '📄 টেক্সট মেনু', payload: BOT_ACTIONS.TEXTMENU },
  ]
}

/* ───────────────────── persistent menu (admin-editable) ───────────────────── */

export interface BotMenuEntry {
  title: string // ≤20 chars (Meta নিয়ম)
  payload: string // BOT_ACTIONS বা __CAT__:<id> / __ACT__:<id>
}

/**
 * ডিফল্ট পার্সিস্টেন্ট মেনু — admin নিজের মতো বদলানোর আগে এটাই চলে।
 * Meta নতুন নিয়ম (২০২৫): call_to_actions = flat লিস্ট, সর্বোচ্চ ২০ বাটন
 * (পুরনো "৩ টপ-লেভেল + nested" স্কিমা বাতিল — nested টাইপ আর বৈধ নয়)।
 */
export const DEFAULT_MENU_ENTRIES: BotMenuEntry[] = [
  { title: '🍕 মেনু', payload: BOT_ACTIONS.MENU },
  { title: '🔥 অফার', payload: BOT_ACTIONS.OFFERS },
  { title: '📍 লোকেশন', payload: BOT_ACTIONS.LOCATION },
  { title: '☎️ হেল্পলাইন', payload: BOT_ACTIONS.HELPLINE },
  { title: '📄 টেক্সট মেনু', payload: BOT_ACTIONS.TEXTMENU },
]

/**
 * admin-সেট করা পার্সিস্টেন্ট-মেনু বাটন (DB setting MESSENGER_MENU_JSON) —
 * সেট না থাকলে/ভাঙা হলে ডিফল্ট। প্রতিবার লাইভ ডাটাবেস থেকে পড়ে —
 * তাই admin প্যানেল থেকে add/edit/delete করলেই সঙ্গে সঙ্গে প্রতিফলিত হয়।
 */
export async function botPersistentMenuEntries(): Promise<BotMenuEntry[]> {
  try {
    const raw = await getSetting(SETTING_KEYS.MESSENGER_MENU_JSON)
    if (raw && raw.trim()) {
      const parsed = JSON.parse(raw) as unknown
      if (Array.isArray(parsed)) {
        const cleaned = parsed
          .filter(
            (e): e is BotMenuEntry =>
              !!e && typeof e === 'object' && typeof (e as BotMenuEntry).title === 'string' && typeof (e as BotMenuEntry).payload === 'string'
          )
          .map((e) => ({ title: e.title.trim().slice(0, 20), payload: e.payload.trim() }))
          .filter((e) => e.title && isValidMenuPayload(e.payload))
          .slice(0, 20)
        if (cleaned.length) return cleaned
      }
    }
  } catch {
    // ভাঙা JSON → ডিফল্টে ফেরা
  }
  return DEFAULT_MENU_ENTRIES
}

/* ───────────────────── instant menu builders (no AI) ───────────────────── */

const BN_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯']

/** 180 → "১৮০", 179.5 → "১৭৯.৫" — বাংলা অঙ্কে (ফ্রি-মোড কাস্টমারও পড়তে পারে) */
function bnNum(n: number | string): string {
  return String(n).replace(/[0-9]/g, (d) => BN_DIGITS[Number(d)])
}

function priceBn(price: number): string {
  const p = Number.isInteger(price) ? String(price) : String(Math.round(price * 100) / 100)
  return `${bnNum(p)}৳`
}

/**
 * ⬅️ পেছনে — বটের হোম-মেনুতে ফেরা (payload __HOME__)। আগে এটা __MENU__ ছিল —
 * ফলে পেছনে চাপলে আবার সেই মেনু-কার্ড + একই ক্যাটাগরি-চিপ এসে কাস্টমার
 * একই জায়গায় ঘুরপাক খেত। এখন পেছনে = হোম-স্ক্রিন (৫টা মূল বাটন)।
 */
export const BACK_CHIP: QuickReply = { title: '⬅️ পেছনে', payload: BOT_ACTIONS.HOME }

/** মেনু-উত্তরের নিচের ক্যাটাগরি-চিপ: [🍽️ সব] + ক্যাটাগরিগুলো + [📄 টেক্সট মেনু] */
async function menuChips(lang: BotLang): Promise<QuickReply[]> {
  void lang
  const cats = await db.category
    .findMany({
      where: { active: true },
      orderBy: { sortOrder: 'asc' as const },
      select: { id: true, name: true },
      take: 7,
    })
    .catch(() => [] as { id: string; name: string }[])
  return [
    { title: '🍽️ সব খাবার', payload: catPayload('all') },
    ...cats.map((c) => ({ title: c.name.slice(0, 19), payload: catPayload(c.id) })),
    { title: '📄 টেক্সট মেনু', payload: BOT_ACTIONS.TEXTMENU },
  ].slice(0, 10)
}

/**
 * আইটেম-তালিকা → সোয়াইপ-ক্যারোসেল (ছবি-সহ হলে) নইলে টেক্সট-তালিকা।
 * কার্ডের টাইটেলেই দাম স্পষ্ট: "চিকেন চিজ বার্গার — ১৮০৳" — ছবি না দেখলেও
 * ফ্রি-মোড কাস্টমার নাম+দাম পরিষ্কার পড়তে পারে (Meta generic টেমপ্লেট
 * ছবি ১.৯১:১ ল্যান্ডস্কেপে দেখায় — লম্বা ছবি স্বয়ংক্রিয়ভাবে ফিট হয়)।
 */
async function sendItemsCarouselOrText(
  psid: string,
  lang: BotLang,
  items: { name: string; price: number; description?: string | null; imageUrl?: string | null; category?: { name: string } | null }[],
  baseUrl: string | null
): Promise<void> {
  const chips = [...(await menuChips(lang)), BACK_CHIP].slice(0, 11)
  const withImage = items.filter((i) => i.imageUrl && /^https?:\/\//i.test(i.imageUrl))
  const cards: CarouselCard[] = withImage.slice(0, 10).map((i) => ({
    title: `${i.name} — ${priceBn(i.price)}`.slice(0, 80),
    subtitle: (i.description?.trim() || i.category?.name || '').slice(0, 80),
    imageUrl: i.imageUrl,
    buttonTitle: '🛒 অর্ডার করুন',
    buttonUrl: baseUrl?.trim() ? baseUrl.trim() : undefined,
    buttonPayload: BOT_ACTIONS.ORDER,
  }))
  if (cards.length >= 2) {
    if (await sendGenericCarousel(psid, cards, chips)) return
    // ক্যারোসেল রিজেক্ট হলে (টোকেন/ফরম্যাট) নিচের টেক্সট-তালিকাই যাবে
  }
  const lines = items.slice(0, 12).map((i) => `• ${i.name} — ${priceBn(i.price)}`)
  if (!lines.length) {
    await sendQuickReplies(psid, t(lang, 'staticMenuHead'), chips)
    return
  }
  const text = `${t(lang, 'staticMenuHead')}\n${lines.join('\n')}\n${t(lang, 'staticMoreMenu')}`
  await sendQuickReplies(psid, text, chips)
}

/** লম্বা টেক্সটকে ≤max অক্ষরের টুকরোতে ভাগ (লাইন-বাউন্ডারিতে — শব্দ কাটে না) */
function chunkByLine(text: string, max: number): string[] {
  if (text.length <= max) return [text]
  const out: string[] = []
  let cur = ''
  for (const line of text.split('\n')) {
    if (cur && (cur + '\n' + line).length > max) {
      out.push(cur)
      cur = line
    } else {
      cur = cur ? `${cur}\n${line}` : line
    }
  }
  if (cur.trim()) out.push(cur)
  return out.length ? out : [text.slice(0, max)]
}

/**
 * [📄 সাধারণ টেক্সট মেনু] — ছবি ছাড়া পুরো মেনু, ক্যাটাগরি-অনুযায়ী সাজানো।
 * ফ্রি-ফেসবুক/ডাটা-ছাড়া কাস্টমারও এক সেকেন্ডে সব পড়তে পারে। লম্বা হলে
 * একাধিক মেসেজে ভেঙে যায় (Messenger ২০০০-অক্ষর লিমিট)।
 */
async function sendTextMenuAction(psid: string, lang: BotLang): Promise<void> {
  const items = await db.menuItem
    .findMany({
      where: { isAvailable: true },
      orderBy: [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }],
      include: { category: { select: { name: true } } },
      take: 100,
    })
    .catch(() => [])
  if (!items.length) {
    await sendQuickReplies(psid, t(lang, 'staticMenuHead'), botQuickReplies(lang))
    return
  }
  // ক্রম রেখে ক্যাটাগরি-ভাগ (sortOrder অনুযায়ী আসা আইটেম গ্রুপ করে)
  const groups: { name: string; lines: string[] }[] = []
  for (const i of items) {
    const gname = i.category?.name || 'অন্যান্য'
    const last = groups[groups.length - 1]
    if (last && last.name === gname) last.lines.push(`• ${i.name} — ${priceBn(i.price)}`)
    else groups.push({ name: gname, lines: [`• ${i.name} — ${priceBn(i.price)}`] })
  }
  const full = `📄 পুরো মেনু (ছবি ছাড়া)\n\n${groups.map((g) => `◼ ${g.name}\n${g.lines.join('\n')}`).join('\n\n')}`
  const chunks = chunkByLine(full, 1800)
  for (let idx = 0; idx < chunks.length; idx++) {
    const isLast = idx === chunks.length - 1
    if (isLast) await sendQuickReplies(psid, chunks[idx], botQuickReplies(lang))
    else await sendText(psid, chunks[idx])
  }
}

/* ───────────────────── action handlers (deterministic, no AI wait) ───────────────────── */

/**
 * 🏠 হোম-মেনু অ্যাকশন (__HOME__) — ⬅️ পেছনে / "home" লিখলে বটের হোম-স্ক্রিন:
 * উষ্ণ স্বাগতম + ৫টা মূল বাটন (মেনু/অফার/লোকেশন/হেল্পলাইন/টেক্সট মেনু)।
 * কার্ড-ভিউ/ক্যাটাগরি/অফার থেকে এক ট্যাপে শুরুর জায়গায় — ঘুরপাক নেই।
 */
async function sendHomeAction(psid: string, lang: BotLang): Promise<void> {
  await sendQuickReplies(psid, t(lang, 'homeMenuText'), botQuickReplies(lang))
}

/**
 * 🍕 মেনু অ্যাকশন — জনপ্রিয় আইটেমের কার্ড-ক্যারোসেল + নিচে ক্যাটাগরি-চিপ।
 * ক্যাটাগরি চিপে ট্যাপ → সেই ক্যাটাগরির কার্ড (__CAT__ অ্যাকশন) — সবই ইনস্ট্যান্ট।
 */
async function sendMenuAction(psid: string, lang: BotLang): Promise<void> {
  const [items, baseUrl] = await Promise.all([
    db.menuItem
      .findMany({
        where: { isAvailable: true },
        orderBy: [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }],
        include: { category: { select: { name: true } } },
        take: 24,
      })
      .catch(() => []), // DB-blip হলেও নীরবতা নয় — fallback টেক্সট-মেনু যাবে
    getSetting(SETTING_KEYS.PUBLIC_BASE_URL),
  ])
  await sendItemsCarouselOrText(psid, lang, items, baseUrl)
}

/** __CAT__:<id> — নির্দিষ্ট ক্যাটাগরির আইটেম-ক্যারোসেল (id 'all'/অজানা → সব) */
async function sendCategoryAction(psid: string, lang: BotLang, categoryId: string): Promise<void> {
  const [items, baseUrl] = await Promise.all([
    db.menuItem
      .findMany({
        where: { isAvailable: true, ...(categoryId && categoryId !== 'all' ? { categoryId } : {}) },
        orderBy: [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }],
        include: { category: { select: { name: true } } },
        take: 24,
      })
      .catch(() => []), // DB-blip হলেও fallback উত্তর যাবে
    getSetting(SETTING_KEYS.PUBLIC_BASE_URL),
  ])
  await sendItemsCarouselOrText(psid, lang, items, baseUrl)
}

/** [অর্ডার করুন] পোস্টব্যাক (সাইট-URL কনফিগার না থাকলে কার্ডের বাটন এটাই পায়) */
async function sendOrderHelp(psid: string, lang: BotLang): Promise<void> {
  await sendQuickReplies(
    psid,
    t(lang, 'orderHelp'),
    botQuickReplies(lang),
  )
}

/**
 * 🔥 অফার অ্যাকশন — টেক্সট নয়, কার্ড-স্লাইডার: চলমান অকেশন-অফার ও কুপন
 * প্রতিটা কার্ডে নাম+ছাড়+শর্ত (ফ্রি-মোডেও পড়া যায়) + [অর্ডার করুন] বাটন।
 * একটাও অফার না থাকলে উষ্ণ টেক্সট (bot-static)।
 */
async function sendOffersAction(psid: string, lang: BotLang): Promise<void> {
  const [offers, vouchers, baseUrl] = await Promise.all([
    db.occasionOffer
      .findMany({ where: { active: true }, orderBy: [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }], take: 6 })
      .catch(() => []),
    db.voucher
      .findMany({ where: { active: true }, orderBy: { createdAt: 'desc' as const }, take: 6 })
      .catch(() => []),
    getSetting(SETTING_KEYS.PUBLIC_BASE_URL),
  ])
  const chips = [BACK_CHIP, ...botQuickReplies(lang)].slice(0, 11)
  const cards: CarouselCard[] = [
    ...offers.map((o) => ({
      title: `${o.emoji || '🎁'} ${o.name} — ${bnNum(Math.round(o.discount * 100) / 100)}%`.slice(0, 80),
      subtitle: [o.dateLabel, o.minBill > 0 ? `ন্যূনতম বিল ৳${bnNum(Math.round(o.minBill * 100) / 100)}` : '', o.description?.trim()].filter(Boolean).join(' • ').slice(0, 80),
      buttonTitle: '🎁 অফার নিন',
      buttonUrl: baseUrl?.trim() ? baseUrl.trim() : undefined,
      buttonPayload: BOT_ACTIONS.ORDER,
    })),
    ...vouchers.map((v) => ({
      title: `🎟️ ${v.code} — ${v.discountType === 'PERCENT' ? `${bnNum(Math.round(v.discountValue * 100) / 100)}%` : `৳${bnNum(Math.round(v.discountValue * 100) / 100)}`}`.slice(0, 80),
      subtitle: [v.title, v.minOrderAmount > 0 ? `ন্যূনতম অর্ডার ৳${bnNum(Math.round(v.minOrderAmount * 100) / 100)}` : ''].filter(Boolean).join(' • ').slice(0, 80),
      buttonTitle: '🎁 কুপন নিন',
      buttonUrl: baseUrl?.trim() ? baseUrl.trim() : undefined,
      buttonPayload: BOT_ACTIONS.ORDER,
    })),
  ].slice(0, 10)
  if (cards.length) {
    if (await sendGenericCarousel(psid, cards, chips)) return
  }
  const text = await buildStaticReply({ lang, message: 'offer', psid })
  await sendQuickReplies(psid, text, chips)
}

/**
 * ⭐ কাস্টম অ্যাকশন (__ACT__:<id>) — admin মেসেঞ্জার-ট্যাবে বানানো রিপ্লাই:
 * replyType='text' → কাস্টম টেক্সট; 'cards' → কাস্টম কার্ড-স্লাইডার
 * (প্রোমো-কোড, কাস্টম ডিটেইলস, ব্রাঞ্চ-মেনু — যা খুশি)। সবই ইনস্ট্যান্ট, AI ছাড়া।
 */
async function sendCustomAction(psid: string, lang: BotLang, actionId: string): Promise<void> {
  const chips = [BACK_CHIP, ...botQuickReplies(lang)].slice(0, 11)
  const act = await db.botAction
    .findUnique({ where: { id: actionId } })
    .catch(() => null)
  if (!act || !act.active) {
    // admin ডিলিট/বন্ধ করে ফেলেছে → মেনু-হোমই সবচেয়ে দরকারি উত্তর
    await sendMenuAction(psid, lang)
    return
  }
  if (act.replyType === 'cards' && act.cardsJson) {
    try {
      const raw = JSON.parse(act.cardsJson) as {
        title?: string
        subtitle?: string
        imageUrl?: string
        buttonTitle?: string
        buttonUrl?: string
      }[]
      const baseUrl = await getSetting(SETTING_KEYS.PUBLIC_BASE_URL)
      const cards: CarouselCard[] = raw
        .filter((c) => c && typeof c.title === 'string' && c.title.trim())
        .slice(0, 10)
        .map((c) => ({
          title: c.title!.slice(0, 80),
          subtitle: (c.subtitle || '').slice(0, 80),
          imageUrl: c.imageUrl && /^https?:\/\//i.test(c.imageUrl) ? c.imageUrl : undefined,
          buttonTitle: (c.buttonTitle || '🛒 অর্ডার করুন').slice(0, 20),
          buttonUrl: c.buttonUrl && /^https?:\/\//i.test(c.buttonUrl) ? c.buttonUrl : baseUrl?.trim() || undefined,
          buttonPayload: BOT_ACTIONS.ORDER,
        }))
      if (cards.length && (await sendGenericCarousel(psid, cards, chips))) return
    } catch {
      // ভাঙা JSON → নিচের টেক্সট-ফলব্যাক
    }
  }
  const text = (act.replyText || '').trim() || t(lang, 'staticMenuHead')
  // লম্বা টেক্সট হলে চাংক (Messenger ২০০০-অক্ষর লিমিট)
  const chunks = chunkByLine(text, 1800)
  for (let idx = 0; idx < chunks.length; idx++) {
    const isLast = idx === chunks.length - 1
    if (isLast) await sendQuickReplies(psid, chunks[idx], chips)
    else await sendText(psid, chunks[idx])
  }
}

/**
 * 📍 লোকেশন / ☎️ হেল্পলাইন — মালিকের নির্দেশ: Messenger-এ AI নয়। admin-এর লেখা
 * তথ্য (AI_EXTRA_INFO / ডেলিভারি রুলস) থেকেই সঙ্গে সঙ্গে উত্তর যায়
 * (buildStaticReply-এর topic-মোড — ইনস্ট্যান্ট, ডাটাবেস-নির্ভর, কখনো ব্যর্থ হয় না)।
 */
export async function sendInfoAction(psid: string, lang: BotLang, action: BotActionKey): Promise<void> {
  const topic = action === BOT_ACTIONS.LOCATION ? 'location' : 'helpline'
  const text = await buildStaticReply({ lang, message: '', psid, topic })
  await sendQuickReplies(psid, text, botQuickReplies(lang))
}

/**
 * কুইক-রিপ্লাই/পোস্টব্যাক পেলোডের ডিটারমিনিস্টিক হ্যান্ডলার — সব উত্তর ইনস্ট্যান্ট
 * ডাটাবেস-নির্ভর (মালিকের নির্দেশ: Messenger-এর কোনো বাটন-উত্তরে AI নেই)।
 * rawPayload = কাঁচা payload (__CAT__:<id> / __ACT__:<id> ভাঙার জন্য)।
 * রিটার্ন: handled = সামলানো হয়েছে; echo = AI-history-তে রাখার সংক্ষিপ্ত লাইন।
 */
export async function handleBotUiAction(
  psid: string,
  lang: BotLang,
  action: BotActionKey,
  rawPayload?: string | null,
): Promise<{ handled: boolean; echo: string | null }> {
  switch (action) {
    case BOT_ACTIONS.MENU: {
      await sendMenuAction(psid, lang)
      return { handled: true, echo: t(lang, 'staticMenuHead') }
    }
    case BOT_ACTIONS.CAT: {
      const id = (rawPayload || '').trim().slice(CAT_PAYLOAD_PREFIX.length) || 'all'
      await sendCategoryAction(psid, lang, id)
      return { handled: true, echo: `${t(lang, 'staticMenuHead')} (cat:${id.slice(0, 12)})` }
    }
    case BOT_ACTIONS.TEXTMENU: {
      await sendTextMenuAction(psid, lang)
      return { handled: true, echo: t(lang, 'staticMenuHead') }
    }
    case BOT_ACTIONS.OFFERS: {
      await sendOffersAction(psid, lang)
      return { handled: true, echo: '🔥 অফার কার্ড পাঠানো হয়েছে' }
    }
    case BOT_ACTIONS.ACT: {
      const id = (rawPayload || '').trim().slice(ACT_PAYLOAD_PREFIX.length)
      await sendCustomAction(psid, lang, id)
      return { handled: true, echo: `কাস্টম অ্যাকশন (act:${id.slice(0, 10)})` }
    }
    case BOT_ACTIONS.ORDER: {
      await sendOrderHelp(psid, lang)
      return { handled: true, echo: t(lang, 'orderHelp').slice(0, 200) }
    }
    case BOT_ACTIONS.HOME: {
      await sendHomeAction(psid, lang)
      return { handled: true, echo: '🏠 হোম-মেনু পাঠানো হয়েছে' }
    }
    case BOT_ACTIONS.LOCATION:
    case BOT_ACTIONS.HELPLINE: {
      await sendInfoAction(psid, lang, action)
      return { handled: true, echo: action === BOT_ACTIONS.LOCATION ? '📍 লোকেশন-উত্তর পাঠানো হয়েছে' : '☎️ হেল্পলাইন-উত্তর পাঠানো হয়েছে' }
    }
    default:
      return { handled: false, echo: null }
  }
}

/** টেক্সট ইন্টেন্ট ম্যাচার — কাস্টমার টাইপ করলেও একই কার্ড/বাটন-উত্তর পাক */
// শব্দের শেষ সীমা: \b বাংলা অক্ষরে কাজ করে না (ASCII-only boundary) — তাই
// সেপারেটর/শেষ-অবস্থান lookahead দিয়ে। ASCII শব্দেও "menu s"/"home page e"
// জাতীয় মিস-ম্যাচ আটকায়, আগের \b-এর মতোই কড়া।
const INTENT_TAIL = '(?=[\\s\\d,!?।,.;:—–-]|$)'
const re = (src: string) => new RegExp(`^(?:${src})${INTENT_TAIL}`, 'i')
const ACTION_TEXT_RE: { action: BotActionKey; re: RegExp }[] = [
  // ⬅️ পেছনে/home লিখলেও হোম-মেনু
  { action: BOT_ACTIONS.HOME, re: re('back|home(?: menu| page)?|shuru|start(?: over)?|হোম|পেছনে|পিছনে|মূল মেনু|শুরু') },
  { action: BOT_ACTIONS.TEXTMENU, re: re('text menu|full menu|লিখিত মেনু|সাধারণ মেনু|পুরো মেনু|সব মেনু') },
  { action: BOT_ACTIONS.MENU, re: re("menu|মেনু|food menu|menu dekhaw|menu dekao|মেনু দেখাও|মেনু দেখুন|খাবার(?:ের)? (?:তালিকা|লিস্ট|menu)|khabar(?:er)? list|what(?:'s| is) on the menu|show me the menu") },
  { action: BOT_ACTIONS.OFFERS, re: re('offer|offers|অফার|অফারস|ki ki offer|offer ki ki|offer gul?[oa]?(?: dew| deaw| dekhaw)?|discount|discou?nt|কুপন|coupon') },
  { action: BOT_ACTIONS.LOCATION, re: re('location|লোকেশন|ঠিকানা|address|kothay|কোথায়|where are you(?: located)?|map') },
  { action: BOT_ACTIONS.HELPLINE, re: re('helpline|হেল্পলাইন|যোগাযোগ|contact|phone number|ফোন নম্বর|hotline|হটলাইন') },
  // "order"/"অর্ডার" লিখলেও অর্ডার-গাইড কার্ড — AI নয়, ডিটারমিনিস্টিক DB-উত্তর
  { action: BOT_ACTIONS.ORDER, re: re('order|orders|অর্ডার|অর্ডারস|order korbo|order dibo|অর্ডার করব|কিভাবে অর্ডার|কীভাবে অর্ডার|how to order|place (?:an )?order') },
]

export function botActionFromText(text: string): BotActionKey | null {
  const msg = (text || '').trim()
  if (!msg || msg.length > 60) return null
  for (const { action, re } of ACTION_TEXT_RE) if (re.test(msg)) return action
  return null
}

/* ───────────────── greeting fast-path (AI লেটেন্সি ছাড়া ইনস্ট্যান্ট উত্তর) ───────────────── */

/**
 * শুধু-শুভেচ্ছা মেসেজ ("hi", "hello", "salam", "হ্যালো", "kemon achen"…) —
 * মালিকের নির্দেশ: এসব মেসেজে AI দিয়ে উত্তর দেওয়ার দরকার নেই (৩০-৯০ সেকেন্ড
 * অপেক্ষা নয়) — সঙ্গে সঙ্গে উষ্ণ স্বাগতম + মেনু-বাটন যাবে।
 * পুরো মেসেজটাই গ্রিটিং হতে হবে (শেষে বিরামচিহ্ন ছাড়া অন্য কিছু থাকলে —
 * "hi menu den", "hi 5 er discount ache?" — সেটা AI/অন্য ইনটেন্টের জন্য যায়)।
 */
const GREETING_RE =
  /^(?:h+i+|he?y+|he?l+o+|salam(?:u alaik(?:um|us))?|assalam(?:u|o)? ?alaik(?:um|us)|assalamualaik(?:um|us)|asalamualaik(?:um|us)|slam|namaste|nomoshkar|namskar|good ?(?:morning|afternoon|evening)|হাই+|হ্যালো|হেলো|হেলু+|আসসালাম(?:ু)? ?আলাইকুম|সালাম|নমস্কার|নমস্তে|কেমন আছ(?:েন|ো)|কি খবর|ki khobor|kemon a(?:ch|sh)(?:o|en)|assalamualaikum)[!।.,?]*$/i

export function isGreetingText(text: string): boolean {
  const msg = (text || '').trim()
  if (!msg || msg.length > 30) return false
  return GREETING_RE.test(msg)
}
