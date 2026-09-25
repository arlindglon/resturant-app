// Messenger Rich-UI অ্যাকশন লেয়ার — কুইক-রিপ্লাই বাটন, কার্ড-ক্যারোসেল আর
// পার্সিস্টেন্ট মেনুর পেছনের "এক ট্যাপে সঠিক উত্তর" ইঞ্জিন।
//
// কাস্টমার বাটনে ট্যাপ করলে webhook-এ quick_reply.payload / postback.payload
// আসে — AI-র জন্য অপেক্ষা নয়, এখান থেকে সরাসরি লাইভ ডাটাবেসের উত্তর যায়:
//   [🍕 মেনু]      → খাবারের কার্ড-ক্যারোসেল (ছবি+দাম+অর্ডার বাটন)
//   [🔥 অফার]      → চলমান অফার/কুপন/হ্যাপি আওয়ার (bot-static)
//   [📍 লোকেশন]    → AI নলেজ-বেস থেকে ঠিকানা (AI নিভে থাকলে উষ্ণ স্ট্যাটিক)
//   [☎️ হেল্পলাইন]  → AI নলেজ-বেস থেকে যোগাযোগ (ফোন/সময় — admin-লেখা)
import { db } from '@/lib/db'
import { getSetting } from '@/lib/settings'
import { SETTING_KEYS } from '@/lib/constants'
import { buildStaticReply } from '@/lib/bot-static'
import { t, type BotLang } from '@/lib/bot-text'
import { sendQuickReplies, sendGenericCarousel, sendText, type QuickReply, type CarouselCard } from '@/lib/messenger'

/* ───────────────────── deterministic action payloads ───────────────────── */

export const BOT_ACTIONS = {
  MENU: '__MENU__',
  OFFERS: '__OFFERS__',
  LOCATION: '__LOCATION__',
  HELPLINE: '__HELPLINE__',
  ORDER: '__ORDER__',
} as const

export type BotActionKey = (typeof BOT_ACTIONS)[keyof typeof BOT_ACTIONS]

/** payload → action key (unknown payload → null) */
export function botActionFromPayload(payload: string | undefined | null): BotActionKey | null {
  const p = (payload || '').trim()
  if (!p) return null
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
  ]
}

/** চ্যাটবক্সের নিচের ফিক্সড পার্সিস্টেন্ট মেনু — Meta-তে সর্বোচ্চ ৩টা টপ-লেভেল */
export function botPersistentMenuEntries(): { title: string; payload: string }[] {
  return [
    { title: '🍕 মেনু', payload: BOT_ACTIONS.MENU },
    { title: '🔥 অফার', payload: BOT_ACTIONS.OFFERS },
    { title: '📍 লোকেশন', payload: BOT_ACTIONS.LOCATION },
    { title: '☎️ হেল্পলাইন', payload: BOT_ACTIONS.HELPLINE }, // → "ℹ️ আরও" নেস্টেডে যাবে
  ]
}

/* ───────────────────── action handlers (deterministic, no AI wait) ───────────────────── */

/**
 * কার্ড-ক্যারোসেল + মেনু উত্তর। ছবি-সহ আইটেম থাকলে সোয়াইপ-গ্যালারি যায়
 * (ছবি+নাম+দাম+[অর্ডার করুন]); নাহলে টেক্সট-মেনু (bot-static)।
 */
async function sendMenuAction(psid: string, lang: BotLang): Promise<void> {
  const [items, baseUrl] = await Promise.all([
    db.menuItem.findMany({
      where: { isAvailable: true },
      orderBy: [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }],
      include: { category: { select: { name: true } } },
      take: 24,
    }),
    getSetting(SETTING_KEYS.PUBLIC_BASE_URL),
  ])
  const withImage = items.filter((i) => i.imageUrl && /^https?:\/\//i.test(i.imageUrl))
  const cards: CarouselCard[] = withImage.slice(0, 10).map((i) => ({
    title: i.name,
    subtitle: `৳${Math.round(i.price * 100) / 100}${i.category?.name ? ` • ${i.category.name}` : ''}`,
    imageUrl: i.imageUrl,
    buttonTitle: '🛒 অর্ডার করুন',
    buttonUrl: baseUrl?.trim() ? baseUrl.trim() : undefined,
    buttonPayload: BOT_ACTIONS.ORDER,
  }))
  if (cards.length >= 2) {
    const okCarousel = await sendGenericCarousel(psid, cards, botQuickReplies(lang))
    if (okCarousel) return
    // ক্যারোসেল রিজেক্ট হলে (টোকেন/ফরম্যাট) নিচের টেক্সট-মেনুই যাবে
  }
  const staticText = await buildStaticReply({ lang, message: 'menu', psid })
  await sendQuickReplies(psid, staticText, botQuickReplies(lang))
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
 * AI-নির্ভর অ্যাকশন (লোকেশন/হেল্পলাইন): admin যা লিখেছে (AI_EXTRA_INFO/ডেলিভারি
 * রুলস) তার ভেতর থেকেই সঠিক উত্তর — synthetic মেসেজ দিয়ে সাধারণ চ্যাট-পথেই যায়।
 * handler নিজে কিছু না পাঠালে (AI বন্ধ/ব্যর্থ) caller-এর static fallback চলে।
 */
export async function sendAiActionReply(
  psid: string,
  lang: BotLang,
  action: BotActionKey,
  /** caller-এর aiGeneralReply (typing + history + CRM সহ) — এটাই সব কাজ করে */
  aiReply: (message: string) => Promise<boolean>,
): Promise<void> {
  const synthetic =
    action === BOT_ACTIONS.LOCATION
      ? t(lang, 'askLocationSynthetic')
      : t(lang, 'askHelplineSynthetic')
  const handled = await aiReply(synthetic)
  if (!handled) {
    const text = await buildStaticReply({ lang, message: action === BOT_ACTIONS.LOCATION ? 'location address' : 'helpline contact', psid })
    await sendQuickReplies(psid, text, botQuickReplies(lang))
  }
}

/**
 * কুইক-রিপ্লাই/পোস্টব্যাক পেলোডের ডিটারমিনিস্টিক হ্যান্ডলার।
 * রিটার্ন: handled = সামলানো হয়েছে (AI routing বাদ); echo = AI-history-তে
 * রাখার সংক্ষিপ্ত লাইন (LOCATION/HELPLINE-এ aiReply নিজেই history সামলায় → null)।
 */
export async function handleBotUiAction(
  psid: string,
  lang: BotLang,
  action: BotActionKey,
  aiReply?: (message: string) => Promise<boolean>,
): Promise<{ handled: boolean; echo: string | null }> {
  switch (action) {
    case BOT_ACTIONS.MENU: {
      await sendMenuAction(psid, lang)
      return { handled: true, echo: t(lang, 'staticMenuHead') }
    }
    case BOT_ACTIONS.OFFERS: {
      const text = await buildStaticReply({ lang, message: 'offer', psid })
      await sendQuickReplies(psid, text, botQuickReplies(lang))
      return { handled: true, echo: text.slice(0, 300) }
    }
    case BOT_ACTIONS.ORDER: {
      await sendOrderHelp(psid, lang)
      return { handled: true, echo: t(lang, 'orderHelp').slice(0, 200) }
    }
    case BOT_ACTIONS.LOCATION:
    case BOT_ACTIONS.HELPLINE: {
      if (aiReply) {
        await sendAiActionReply(psid, lang, action, aiReply)
        return { handled: true, echo: null }
      }
      return { handled: false, echo: null }
    }
    default:
      return { handled: false, echo: null }
  }
}

/** টেক্সট ইন্টেন্ট ম্যাচার — কাস্টমার টাইপ করলেও একই কার্ড/বাটন-উত্তর পাক */
const ACTION_TEXT_RE: { action: BotActionKey; re: RegExp }[] = [
  { action: BOT_ACTIONS.MENU, re: /^(?:menu|মেনু|food menu|menu dekhaw|menu dekao|মেনু দেখাও|মেনু দেখুন|খাবার(?:ের)? (?:তালিকা|লিস্ট|menu)|khabar(?:er)? list|what(?:'s| is) on the menu|show me the menu)\b/i },
  { action: BOT_ACTIONS.OFFERS, re: /^(?:offer|offers|অফার|অফারস|ki ki offer|offer ki ki|offer gul?[oa]?(?: dew| deaw| dekhaw)?|discount|discou?nt|কুপন|coupon)\b/i },
  { action: BOT_ACTIONS.LOCATION, re: /^(?:location|লোকেশন|ঠিকানা|address|kothay|কোথায়|where are you(?: located)?|map)\b/i },
  { action: BOT_ACTIONS.HELPLINE, re: /^(?:helpline|হেল্পলাইন|যোগাযোগ|contact|phone number|ফোন নম্বর|hotline|হটলাইন)\b/i },
]

export function botActionFromText(text: string): BotActionKey | null {
  const msg = (text || '').trim()
  if (!msg || msg.length > 60) return null
  for (const { action, re } of ACTION_TEXT_RE) if (re.test(msg)) return action
  return null
}
