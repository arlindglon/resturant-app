// ✍️ AI মেনু-লেখক API — ড্রাফট তালিকা (GET) + মালিকের নোট থেকে AI জেনারেশন (POST)
// সব পথেই ai_menu_drafts টেবিল লেজি-মাইগ্রেট হয় (প্রথম ব্যবহারে নিজেই তৈরি)।
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, fail } from '@/lib/api'
import { requirePerm } from '@/lib/staff-auth'
import { ensureDraftTable, generateMenuDrafts } from '@/lib/ai-menu-writer'
import { generateFoodPhoto } from '@/lib/ai-image'
import type { AiMenuDraft } from '@prisma/client'

export const maxDuration = 300

export async function GET() {
  const denied = await requirePerm('menu')
  if (denied) return denied
  await ensureDraftTable()
  const [pending, decided] = await Promise.all([
    db.aiMenuDraft.findMany({ where: { status: 'PENDING' }, orderBy: { createdAt: 'desc' }, take: 50 }),
    db.aiMenuDraft.findMany({ where: { status: { not: 'PENDING' } }, orderBy: { decidedAt: 'desc' }, take: 20 }),
  ])
  return ok({ pending, decided })
}

export async function POST(req: NextRequest) {
  const denied = await requirePerm('menu')
  if (denied) return denied
  const body = await req.json().catch(() => ({}))
  const text = (body.text || '').toString().trim()
  const withImage = Boolean(body.withImage)
  if (text.length < 2) return fail('আগে বক্সে আইটেমের কথা লিখুন', 400)
  if (text.length > 3000) return fail('নোট খুব বড় — একবারে ৩০০০ অক্ষরের মধ্যে লিখুন', 400)

  await ensureDraftTable()

  // বর্তমান ক্যাটাগরি-নামগুলো AI-কে দেওয়া হয় — মানানসই হলে সেগুলোরই হুবহু নাম ব্যবহার করবে
  const categories = await db.category.findMany({ select: { name: true }, orderBy: { sortOrder: 'asc' } })
  const gen = await generateMenuDrafts(text, categories.map((c) => c.name))
  if (!gen.ok || gen.items.length === 0) return fail(gen.error || 'AI ড্রাফট বানাতে পারেনি — আবার চেষ্টা করুন', 502)

  const imageErrors: string[] = []
  const drafts: AiMenuDraft[] = []
  for (const item of gen.items) {
    let imageUrl: string | null = null
    if (withImage) {
      const photo = await generateFoodPhoto(item.name, item.description)
      if (photo.ok && photo.url) imageUrl = photo.url
      else if (photo.error) imageErrors.push(`${item.name}: ${photo.error}`)
    }
    const d = await db.aiMenuDraft.create({
      data: {
        rawText: text,
        name: item.name,
        category: item.category,
        description: item.description || null,
        price: item.price,
        imageUrl,
        isSetMenu: item.isSetMenu,
        spiceLevels: item.spiceLevels.length ? JSON.stringify(item.spiceLevels) : null,
        note: item.advice || null,
        status: 'PENDING',
      },
    })
    drafts.push(d)
  }
  return ok({ count: drafts.length, drafts, imageErrors })
}
