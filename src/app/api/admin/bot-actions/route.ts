// CRUD /api/admin/bot-actions — মেসেঞ্জার বটের কাস্টম অ্যাকশন (BotAction)
// admin-এর 🤖 মেসেঞ্জার ট্যাব থেকে: বাটনের নাম + ব্যাখ্যা + রিপ্লাই-ধরন
// (সাধারণ টেক্সট বা কার্ড-স্লাইডার) + কার্ডের কনটেন্ট — সব এখান থেকে।
// কাস্টমারের কাছে payload __ACT__:<id> হিসেবে যায় (bot-ui.ts) — ইনস্ট্যান্ট রিপ্লাই।
import { ok } from '@/lib/api'
import { requirePerm } from '@/lib/staff-auth'
import { db } from '@/lib/db'

interface BotCardInput {
  title?: unknown
  subtitle?: unknown
  imageUrl?: unknown
  buttonTitle?: unknown
  buttonUrl?: unknown
}

interface BotActionInput {
  id?: unknown
  title?: unknown
  desc?: unknown
  replyType?: unknown
  replyText?: unknown
  cards?: unknown
  active?: unknown
}

const isUrl = (s: unknown): s is string => typeof s === 'string' && /^https?:\/\/\S+$/i.test(s.trim())

function cleanCards(raw: unknown): { ok: true; json: string } | { ok: false; error: string } {
  if (raw === undefined || raw === null || raw === '') return { ok: true, json: '[]' }
  if (!Array.isArray(raw)) return { ok: false, error: 'কার্ড-তালিকা অ্যারে নয়' }
  if (raw.length > 10) return { ok: false, error: 'সর্বোচ্চ ১০টা কার্ড' }
  const cards: { title: string; subtitle: string; imageUrl: string; buttonTitle: string; buttonUrl: string }[] = []
  for (const r of raw as BotCardInput[]) {
    const title = typeof r?.title === 'string' ? r.title.trim().slice(0, 80) : ''
    if (!title) return { ok: false, error: 'প্রতিটা কার্ডের নাম দিতে হবে' }
    cards.push({
      title,
      subtitle: typeof r?.subtitle === 'string' ? r.subtitle.trim().slice(0, 80) : '',
      imageUrl: isUrl(r?.imageUrl) ? (r.imageUrl as string).trim() : '',
      buttonTitle: typeof r?.buttonTitle === 'string' && r.buttonTitle.trim() ? r.buttonTitle.trim().slice(0, 20) : '🛒 অর্ডার করুন',
      buttonUrl: isUrl(r?.buttonUrl) ? (r.buttonUrl as string).trim() : '',
    })
  }
  return { ok: true, json: JSON.stringify(cards) }
}

interface ValidAction {
  title: string
  desc: string
  replyType: 'text' | 'cards'
  replyText: string
  cardsJson: string
  active: boolean
}

function validate(body: BotActionInput): { ok: true; data: ValidAction } | { ok: false; error: string } {
  const title = typeof body.title === 'string' ? body.title.trim().slice(0, 20) : ''
  if (!title) return { ok: false, error: 'অ্যাকশনের নাম দিন (≤২০ অক্ষর)' }
  const replyType = body.replyType === 'cards' ? 'cards' : 'text'
  const replyText = typeof body.replyText === 'string' ? body.replyText.trim().slice(0, 1900) : ''
  if (replyType === 'text' && !replyText) return { ok: false, error: 'টেক্সট-রিপ্লাই খালি রাখা যাবে না' }
  let cardsJson = '[]'
  if (replyType === 'cards') {
    const c = cleanCards(body.cards)
    if (!c.ok) return c
    cardsJson = c.json
  }
  return {
    ok: true,
    data: {
      title,
      desc: typeof body.desc === 'string' ? body.desc.trim().slice(0, 190) : '',
      replyType: replyType as 'text' | 'cards',
      replyText,
      cardsJson,
      active: body.active !== false,
    },
  }
}

export async function GET() {
  const denied = await requirePerm('settings')
  if (denied) return denied
  const actions = await db.botAction.findMany({ orderBy: [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }] })
  return ok({
    actions: actions.map((a) => ({
      id: a.id,
      title: a.title,
      desc: a.desc,
      replyType: a.replyType,
      replyText: a.replyText,
      cards: a.cardsJson ? JSON.parse(a.cardsJson) : [],
      active: a.active,
    })),
  })
}

export async function POST(req: Request) {
  const denied = await requirePerm('settings')
  if (denied) return denied
  let body: BotActionInput
  try {
    body = (await req.json()) as BotActionInput
  } catch {
    return ok({ ok: false, error: 'ভাঙা রিকোয়েস্ট' })
  }
  const v = validate(body)
  if (!v.ok) return ok({ ok: false, error: v.error })
  const count = await db.botAction.count()
  if (count >= 20) return ok({ ok: false, error: 'সর্বোচ্চ ২০টা কাস্টম অ্যাকশন রাখা যায়' })
  const created = await db.botAction.create({ data: { ...v.data, sortOrder: count } })
  return ok({ ok: true, id: created.id })
}

export async function PUT(req: Request) {
  const denied = await requirePerm('settings')
  if (denied) return denied
  let body: BotActionInput
  try {
    body = (await req.json()) as BotActionInput
  } catch {
    return ok({ ok: false, error: 'ভাঙা রিকোয়েস্ট' })
  }
  const id = typeof body.id === 'string' ? body.id : ''
  if (!id) return ok({ ok: false, error: 'অ্যাকশন id নেই' })
  const v = validate(body)
  if (!v.ok) return ok({ ok: false, error: v.error })
  try {
    await db.botAction.update({ where: { id }, data: v.data })
  } catch {
    return ok({ ok: false, error: 'অ্যাকশন খুঁজে পাওয়া যায়নি' })
  }
  return ok({ ok: true })
}

export async function DELETE(req: Request) {
  const denied = await requirePerm('settings')
  if (denied) return denied
  const id = new URL(req.url).searchParams.get('id') || ''
  if (!id) return ok({ ok: false, error: 'অ্যাকশন id নেই' })
  try {
    await db.botAction.delete({ where: { id } })
  } catch {
    // আগেই নেই — ঠিক আছে
  }
  return ok({ ok: true })
}
