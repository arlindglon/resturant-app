// GET  /api/admin/messenger-menu-config — পার্সিস্টেন্ট-মেনু বাটন-তালিকা (admin-সম্পাদনযোগ্য)
//   + পাওয়া-যাচ্ছে অ্যাকশন ও লাইভ ক্যাটাগরি-তালিকা (বাটন-যোগ ড্রপডাউনের জন্য)
// PUT  /api/admin/messenger-menu-config — বাটন add/edit/delete/save
//   + সঙ্গে সঙ্গে Meta পেজে সিঙ্ক (get_started + greeting সহ — setPersistentMenu)
// বাটন payload: __MENU__/__OFFERS__/__LOCATION__/__HELPLINE__/__TEXTMENU__ বা
// __CAT__:<categoryId> (ক্যাটাগরি-কার্ড সরাসরি) — webhook-এর Rich-UI সামলায়।
import { ok } from '@/lib/api'
import { requirePerm } from '@/lib/staff-auth'
import { setPersistentMenu } from '@/lib/messenger'
import { setSettings } from '@/lib/settings'
import { SETTING_KEYS } from '@/lib/constants'
import { db } from '@/lib/db'
import {
  BOT_ACTIONS,
  botPersistentMenuEntries,
  catPayload,
  isValidMenuPayload,
  type BotMenuEntry,
} from '@/lib/bot-ui'

const GREETING =
  'আসসালামু আলাইকুম! 👋 Tea and Treat-এ স্বাগতম — মেনু, অফার বা লোকেশন জানতে নিচের বাটনে চাপুন বা লিখুন।'

const FIXED_ACTIONS = [
  { payload: BOT_ACTIONS.MENU, title: '🍕 মেনু কার্ড (সব খাবার)' },
  { payload: BOT_ACTIONS.OFFERS, title: '🔥 আজকের অফার' },
  { payload: BOT_ACTIONS.LOCATION, title: '📍 লোকেশন ও সময়' },
  { payload: BOT_ACTIONS.HELPLINE, title: '☎️ হেল্পলাইন' },
  { payload: BOT_ACTIONS.TEXTMENU, title: '📄 সাধারণ টেক্সট মেনু' },
]

export async function GET() {
  const denied = await requirePerm('settings')
  if (denied) return denied

  const [entries, categories] = await Promise.all([
    botPersistentMenuEntries(),
    db.category.findMany({
      where: { active: true },
      orderBy: { sortOrder: 'asc' as const },
      select: { id: true, name: true },
      take: 20,
    }),
  ])
  return ok({
    entries,
    actions: FIXED_ACTIONS,
    categories: categories.map((c) => ({ payload: catPayload(c.id), title: c.name })),
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
  if (body.entries.length > 8) return ok({ ok: false, error: 'সর্বোচ্চ ৮টা বাটন রাখা যায় (Meta নিয়ম)' })

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
  return ok({ ok: true, synced: true })
}
