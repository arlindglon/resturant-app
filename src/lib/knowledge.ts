// Dynamic knowledge base for the AI chatbot — built LIVE from the database:
// menu (with prices), current occasion offers, voucher campaigns, happy-hour
// rules + admin-written delivery rules / extra info. Cached 60s per instance
// so a busy chat hour never hammers the DB.
import { db } from '@/lib/db'
import { getSetting } from '@/lib/settings'
import { SETTING_KEYS } from '@/lib/constants'

export interface KnowledgeBase {
  text: string
  stats: { categories: number; items: number; offers: number; vouchers: number; happyHours: number }
  builtAt: number
}

let cache: KnowledgeBase | null = null
const TTL_MS = 60_000

const taka = (n: number) => `৳${Math.round(n * 100) / 100}`

export function invalidateKnowledgeCache() {
  cache = null
}

export async function buildKnowledgeBase(): Promise<KnowledgeBase> {
  if (cache && Date.now() - cache.builtAt < TTL_MS) return cache

  const [restaurantName, currency, deliveryRules, extraInfo, pageUsername, categories, items, offers, vouchers, happyHours] =
    await Promise.all([
      getSetting(SETTING_KEYS.RESTAURANT_NAME),
      getSetting(SETTING_KEYS.CURRENCY),
      getSetting(SETTING_KEYS.AI_DELIVERY_RULES),
      getSetting(SETTING_KEYS.AI_EXTRA_INFO),
      getSetting(SETTING_KEYS.MESSENGER_PAGE_USERNAME),
      db.category.findMany({ where: { active: true }, orderBy: { sortOrder: 'asc' } }),
      db.menuItem.findMany({ where: { isAvailable: true }, orderBy: { sortOrder: 'asc' }, include: { category: true } }),
      db.occasionOffer.findMany({ where: { active: true }, orderBy: { sortOrder: 'asc' } }),
      db.voucher.findMany({ where: { active: true }, orderBy: { createdAt: 'desc' }, take: 20 }),
      db.happyHour.findMany({ where: { active: true } }),
    ])

  const cur = currency || '৳'
  const lines: string[] = []

  lines.push(`রেস্টুরেন্টের নাম: ${restaurantName || 'Smart QR Restaurant'}`)
  if (pageUsername) lines.push(`Facebook পেজ: facebook.com/${pageUsername}`)

  // ── menu ──
  if (items.length) {
    const byCat = new Map<string, string[]>()
    for (const it of items) {
      const cat = it.category?.name || 'অন্যান্য'
      if (!byCat.has(cat)) byCat.set(cat, [])
      const desc = it.description ? ` — ${it.description.slice(0, 80)}` : ''
      const set = it.isSetMenu ? ' [সেট মেনু]' : ''
      byCat.get(cat)!.push(`${it.name}: ${cur}${it.price}${set}${desc}`)
    }
    lines.push('\nমেনু ও দাম:')
    for (const [cat, list] of byCat) {
      lines.push(`【${cat}】`)
      for (const l of list) lines.push(`- ${l}`)
    }
  } else {
    lines.push('\nমেনু: এখনো মেনু যোগ করা হয়নি।')
  }

  // ── occasion offers (birthday / anniversary style) ──
  if (offers.length) {
    lines.push('\nবর্তমান বিশেষ অফারসমূহ (জন্মদিন/বার্ষিকী ছাড়):')
    for (const o of offers) {
      lines.push(`- ${o.emoji} ${o.name}: ${cur}${o.discount} ছাড় (মিনিমাম বিল ${cur}${o.minBill}) — বিল পেজে "Claim on Messenger" দিয়ে যাচাই করে নেওয়া যায়`)
    }
  }

  // ── vouchers ──
  if (vouchers.length) {
    lines.push('\nকুপন/ভাউচার ক্যাম্পেইন:')
    for (const v of vouchers) {
      const disc = v.discountType === 'PERCENT' ? `${v.discountValue}%` : `${cur}${v.discountValue}`
      const min = v.minOrderAmount > 0 ? ` (মিনিমাম অর্ডার ${cur}${v.minOrderAmount})` : ''
      lines.push(`- কোড "${v.code}" — ${v.title}: ${disc} ছাড়${min}`)
    }
  }

  // ── happy hour ──
  if (happyHours.length) {
    lines.push('\nহ্যাপি আওয়ার:')
    for (const h of happyHours) {
      lines.push(`- ${h.name}: ${h.discountPercent}% ছাড়, সময় ${h.startTime}-${h.endTime}`)
    }
  }

  // ── admin-written rules ──
  lines.push('\nডেলিভারি রুলস:')
  lines.push(deliveryRules?.trim() || 'সরাসরি ডেলিভারি নেই — রেস্তোরাঁয় এসে খেতে স্বাগতম। (মালিক চাইলে সেটিংসে ডেলিভারি রুলস লিখে দিতে পারবেন)')
  if (extraInfo?.trim()) {
    lines.push('\nবাড়তি তথ্য:')
    lines.push(extraInfo.trim())
  }

  const kb: KnowledgeBase = {
    text: lines.join('\n'),
    stats: {
      categories: categories.length,
      items: items.length,
      offers: offers.length,
      vouchers: vouchers.length,
      happyHours: happyHours.length,
    },
    builtAt: Date.now(),
  }
  cache = kb
  return kb
}
