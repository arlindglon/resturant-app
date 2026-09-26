// GET /api/admin/quick-replies — চ্যাট-বাটন (কুইক-রিপ্লাই) তালিকা + অ্যাকশন-অপশন
// PUT /api/admin/quick-replies — বাটন add/edit/delete/ক্রমবদল সেভ
//
// 📸 এই বাটনগুলোই প্রতিটা উত্তরের নিচে দেখায় (স্ক্রিনশট-ফরম্যাট):
//    🍕 মেনু দেখুন · 🔥 আজকের অফার · 📍 লোকেশন · ☎️ হেল্পলাইন · 📄 টেক্সট মেনু
// মেসেজের সাথেই যায় — Meta permission/persistent-menu sync লাগে না,
// তাই সেভ করলেই সঙ্গে সঙ্গে লাইভ, কোনো রকমের গ্রাফ-এরর হয় না।
// স্টোরেজ: DB setting MESSENGER_QUICK_REPLIES_JSON — JSON [{title,payload}];
// ফাঁকা/ভাঙা = ডিফল্ট ৫ বাটন। botQuickReplies() প্রতিবার এখান থেকেই পড়ে।
import { ok } from '@/lib/api'
import { requirePerm } from '@/lib/staff-auth'
import { setSettings } from '@/lib/settings'
import { SETTING_KEYS } from '@/lib/constants'
import { db } from '@/lib/db'
import {
  BOT_ACTIONS,
  actPayload,
  botQuickReplies,
  catPayload,
  isValidMenuPayload,
  type QuickReplyEntry,
} from '@/lib/bot-ui'

// desc = কাস্টমার বাটনে ট্যাপ করলে ঠিক কী হয় (admin-প্যানেলে প্রতিটা রো-র নিচে mark)
const FIXED_ACTIONS = [
  { payload: BOT_ACTIONS.MENU, title: '🍕 মেনু (কার্ড-স্লাইডার)', desc: 'সব খাবারের কার্ড-স্লাইডার + নিচে ক্যাটাগরি বাটন (সেট মেনু, বার্গার...) — ক্যাটাগরিতে ট্যাপ করলে ওই ক্যাটাগরির কার্ড' },
  { payload: BOT_ACTIONS.OFFERS, title: '🔥 অফার', desc: 'চলমান অকেশন-অফার ও কুপন-কোডের কার্ড-স্লাইডার (ছাড়% + শর্ত সহ)' },
  { payload: BOT_ACTIONS.LOCATION, title: '📍 লোকেশন', desc: 'দোকানের ঠিকানা ও খোলার সময় (AI নলেজ-বেস থেকে; AI নিভে থাকলে স্ট্যাটিক ঠিকানা)' },
  { payload: BOT_ACTIONS.HELPLINE, title: '☎️ হেল্পলাইন', desc: 'ফোন নম্বর ও যোগাযোগের তথ্য (AI নলেজ-বেস থেকে)' },
  { payload: BOT_ACTIONS.TEXTMENU, title: '📄 টেক্সট মেনু', desc: 'ছবি ছাড়া পুরো মেনু টেক্সট আকারে — ফ্রি-ফেসবুক/ডাটা-ছাড়া কাস্টমারের জন্য' },
  { payload: BOT_ACTIONS.ORDER, title: '🛒 অর্ডার-গাইড', desc: 'কিভাবে অর্ডার করবেন — ধাপে ধাপে গাইড কার্ড' },
  { payload: BOT_ACTIONS.HOME, title: '🏠 হোম-মেনু', desc: 'বটের হোম-স্ক্রিন — উষ্ণ স্বাগতম + মূল বাটনগুলো; কার্ড-ভিউতে ⬅️ পেছনে চাপলেও এখানেই ফেরে' },
]

export async function GET() {
  const denied = await requirePerm('settings')
  if (denied) return denied

  const [entries, categories, customActions] = await Promise.all([
    botQuickReplies('bn') as Promise<QuickReplyEntry[]>,
    db.category.findMany({
      where: { active: true },
      orderBy: { sortOrder: 'asc' as const },
      select: { id: true, name: true },
      take: 20,
    }),
    db.botAction.findMany({
      orderBy: [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }],
      select: { id: true, title: true, desc: true, active: true },
    }),
  ])
  return ok({
    entries,
    actions: FIXED_ACTIONS,
    categories: categories.map((c) => ({
      payload: catPayload(c.id),
      title: c.name,
      desc: 'ওই ক্যাটাগরির সব খাবারের কার্ড-স্লাইডার (নাম + দাম + অর্ডার বাটন সহ)',
    })),
    customActions: customActions.map((a) => ({
      payload: actPayload(a.id),
      title: a.title,
      desc: a.desc || (a.active ? 'কাস্টম অ্যাকশন' : 'কাস্টম অ্যাকশন (বন্ধ আছে — ট্যাপ করলে মেনু যাবে)'),
    })),
  })
}

export async function PUT(req: Request) {
  const denied = await requirePerm('settings')
  if (denied) return denied

  let body: { entries?: unknown }
  try {
    body = (await req.json()) as { entries?: unknown }
  } catch {
    return ok({ ok: false, error: 'ভাঙা রিকোয়েস্ট (JSON নয়)' })
  }
  if (!Array.isArray(body.entries)) return ok({ ok: false, error: 'বাটন-তালিকা অ্যারে নয়' })
  if (body.entries.length > 10) return ok({ ok: false, error: 'সর্বোচ্চ ১০টা চ্যাট-বাটন রাখা যায় (Messenger নিয়ম)' })

  const cleaned: QuickReplyEntry[] = []
  const seen = new Set<string>()
  for (const raw of body.entries) {
    const e = raw as { title?: unknown; payload?: unknown }
    const title = typeof e?.title === 'string' ? e.title.trim().slice(0, 20) : ''
    const payload = typeof e?.payload === 'string' ? e.payload.trim() : ''
    if (!title) return ok({ ok: false, error: 'বাটনের নাম ফাঁকা রাখা যাবে না' })
    if (!isValidMenuPayload(payload)) return ok({ ok: false, error: `অজানা অ্যাকশন: ${payload.slice(0, 30) || '(ফাঁকা)'}` })
    if (seen.has(payload)) return ok({ ok: false, error: 'একই অ্যাকশন দুইবার রাখা যাবে না' })
    seen.add(payload)
    cleaned.push({ title, payload })
  }
  if (!cleaned.length) return ok({ ok: false, error: 'অন্তত ১টা বাটন রাখতে হবে' })

  // সেভ (DB) — এরপর থেকে botQuickReplies() এটাই পড়বে; setSettings ক্যাশও সতেজ করে
  await setSettings({ [SETTING_KEYS.MESSENGER_QUICK_REPLIES_JSON]: JSON.stringify(cleaned) })
  return ok({ ok: true, entries: cleaned })
}
