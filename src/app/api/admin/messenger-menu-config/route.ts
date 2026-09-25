// GET  /api/admin/messenger-menu-config — পার্সিস্টেন্ট-মেনু বাটন-তালিকা (admin-সম্পাদনযোগ্য)
//   + প্রতিটা অ্যাকশনের desc (ব্যাখ্যা-mark: ট্যাপ করলে কী হয়) + লাইভ ক্যাটাগরি + কাস্টম অ্যাকশন
// PUT  /api/admin/messenger-menu-config — বাটন add/edit/delete/save
//   + সঙ্গে সঙ্গে Meta পেজে সিঙ্ক (get_started + greeting সহ — setPersistentMenu)
// Meta নতুন স্কিমা: call_to_actions = flat লিস্ট সর্বোচ্চ ২০ বাটন (nested টাইপ বাতিল)।
// বাটন payload: __MENU__/__OFFERS__/__LOCATION__/__HELPLINE__/__TEXTMENU__ /
// __CAT__:<categoryId> (ক্যাটাগরি-কার্ড) / __ACT__:<botActionId> (কাস্টম অ্যাকশন)।
import { ok } from '@/lib/api'
import { requirePerm } from '@/lib/staff-auth'
import { setPersistentMenu } from '@/lib/messenger'
import { setSettings } from '@/lib/settings'
import { SETTING_KEYS } from '@/lib/constants'
import { db } from '@/lib/db'
import {
  BOT_ACTIONS,
  actPayload,
  botPersistentMenuEntries,
  catPayload,
  isValidMenuPayload,
  type BotMenuEntry,
} from '@/lib/bot-ui'

const GREETING =
  'আসসালামু আলাইকুম! 👋 Tea and Treat-এ স্বাগতম — মেনু, অফার বা লোকেশন জানতে নিচের বাটনে চাপুন বা লিখুন।'

// desc = কাস্টমার বাটনে ট্যাপ করলে ঠিক কী হয় (admin-প্যানেলে প্রতিটা রো-র নিচে mark হিসেবে দেখানো হয়)
const FIXED_ACTIONS = [
  { payload: BOT_ACTIONS.MENU, title: '🍕 মেনু', desc: 'সব খাবারের কার্ড-স্লাইডার + নিচে ক্যাটাগরি বাটন (সেট মেনু, বার্গার...) — ক্যাটাগরিতে ট্যাপ করলে ওই ক্যাটাগরির কার্ড' },
  { payload: BOT_ACTIONS.OFFERS, title: '🔥 অফার', desc: 'চলমান অকেশন-অফার ও কুপন-কোডের কার্ড-স্লাইডার (ছাড়% + শর্ত সহ)' },
  { payload: BOT_ACTIONS.LOCATION, title: '📍 লোকেশন', desc: 'দোকানের ঠিকানা ও খোলার সময় (AI নলেজ-বেস থেকে; AI নিভে থাকলে স্ট্যাটিক ঠিকানা)' },
  { payload: BOT_ACTIONS.HELPLINE, title: '☎️ হেল্পলাইন', desc: 'ফোন নম্বর ও যোগাযোগের তথ্য (AI নলেজ-বেস থেকে)' },
  { payload: BOT_ACTIONS.TEXTMENU, title: '📄 টেক্সট মেনু', desc: 'ছবি ছাড়া পুরো মেনু টেক্সট আকারে — ফ্রি-ফেসবুক/ডাটা-ছাড়া কাস্টমারের জন্য' },
]

export async function GET() {
  const denied = await requirePerm('settings')
  if (denied) return denied

  const [entries, categories, customActions] = await Promise.all([
    botPersistentMenuEntries(),
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
      desc: `ওই ক্যাটাগরির সব খাবারের কার্ড-স্লাইডার (নাম + দাম + অর্ডার বাটন সহ)`,
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
  if (body.entries.length > 20) return ok({ ok: false, error: 'সর্বোচ্চ ২০টা বাটন রাখা যায় (Meta নিয়ম)' })

  const cleaned: BotMenuEntry[] = []
  for (const raw of body.entries) {
    const e = raw as { title?: unknown; payload?: unknown }
    const title = typeof e?.title === 'string' ? e.title.trim().slice(0, 20) : ''
    const payload = typeof e?.payload === 'string' ? e.payload.trim() : ''
    if (!title) return ok({ ok: false, error: 'বাটনের নাম ফাঁকা রাখা যাবে না' })
    if (!isValidMenuPayload(payload)) return ok({ ok: false, error: `অজানা অ্যাকশন: ${payload.slice(0, 30) || '(ফাঁকা)'}` })
    cleaned.push({ title, payload })
  }
  if (!cleaned.length) return ok({ ok: false, error: 'অন্তত ১টা বাটন রাখতে হবে' })

  // সেভ (DB) — এরপর থেকে botPersistentMenuEntries() এটাই পড়বে
  await setSettings({ [SETTING_KEYS.MESSENGER_MENU_JSON]: JSON.stringify(cleaned) })

  // সঙ্গে সঙ্গে Meta-তে সিঙ্ক (get_started + greeting সহ)
  const r = await setPersistentMenu(cleaned, { getStartedPayload: BOT_ACTIONS.MENU, greeting: GREETING })
  if (!r.ok) return ok({ ok: true, synced: false, error: r.error || 'সেভ হয়েছে, কিন্তু Meta-তে সিঙ্ক ব্যর্থ' })
  return ok({ ok: true, synced: true, buttons: r.buttons })
}
