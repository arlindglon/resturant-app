// ✍️ AI মেনু-লেখক API — ড্রাফট সিদ্ধান্ত (POST: approve/reject) + ডিলিট (DELETE)
//
// approve: admin চেক করা/এডিট করা ফিল্ড দিয়ে আসল menu_items-এ আইটেম তৈরি হয় —
// ক্যাটাগরি-নাম মিললে পুরনো ক্যাটাগরিতে যায়, না মিললে নতুন ক্যাটাগরি নিজেই তৈরি হয়
// (sortOrder সবার শেষে)। অ্যাপ্রুভ/রিজেক্ট দুটোতেই ড্রাফটে decidedAt বসে।
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, fail } from '@/lib/api'
import { requirePerm } from '@/lib/staff-auth'
import { ensureDraftTable } from '@/lib/ai-menu-writer'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requirePerm('menu')
  if (denied) return denied
  await ensureDraftTable()
  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const action = (body.action || '').toString()

  const draft = await db.aiMenuDraft.findUnique({ where: { id } })
  if (!draft) return fail('ড্রাফট খুঁজে পাওয়া যায়নি', 404)
  if (draft.status !== 'PENDING') return fail('এই ড্রাফটের সিদ্ধান্ত আগেই নেওয়া হয়েছে', 400)

  if (action === 'reject') {
    await db.aiMenuDraft.update({ where: { id }, data: { status: 'REJECTED', decidedAt: new Date() } })
    return ok({ status: 'REJECTED' })
  }

  if (action !== 'approve') return fail('action approve বা reject হতে হবে', 400)

  // admin-এডিট করা ফিল্ড (না দিলে AI-প্রস্তাব অপরিবর্তিত)
  const name = (body.name !== undefined ? String(body.name) : draft.name).trim()
  const categoryName = (body.category !== undefined ? String(body.category) : draft.category).trim()
  const description = body.description !== undefined ? String(body.description).trim() : (draft.description || '')
  const price = body.price !== undefined ? parseFloat(body.price) : draft.price
  if (!name) return fail('আইটেমের নাম দিন', 400)
  if (!categoryName) return fail('ক্যাটাগরির নাম দিন', 400)
  if (price === null || isNaN(price) || price <= 0) return fail('সঠিক দাম দিন', 400)

  // ক্যাটাগরি ম্যাচ (ট্রিম+কেস-অসংবেদী) — না পেলে নতুন তৈরি
  const allCats = await db.category.findMany({ select: { id: true, name: true, sortOrder: true } })
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')
  let category = allCats.find((c) => norm(c.name) === norm(categoryName))
  if (!category) {
    const maxSort = allCats.reduce((m, c) => Math.max(m, c.sortOrder), 0)
    category = await db.category.create({ data: { name: categoryName, sortOrder: maxSort + 1 } })
  }

  // ওই ক্যাটাগরিতে সবার শেষে বসাও
  const lastItem = await db.menuItem.findFirst({ where: { categoryId: category.id }, orderBy: { sortOrder: 'desc' }, select: { sortOrder: true } })
  const spiceLevels = draft.spiceLevels || null

  const item = await db.menuItem.create({
    data: {
      name,
      categoryId: category.id,
      price,
      description: description || null,
      imageUrl: draft.imageUrl || null,
      isAvailable: true,
      isSetMenu: draft.isSetMenu,
      spiceLevels,
    },
  })
  await db.menuItem.update({ where: { id: item.id }, data: { sortOrder: (lastItem?.sortOrder ?? 0) + 1 } })
  await db.aiMenuDraft.update({ where: { id }, data: { status: 'APPROVED', decidedAt: new Date(), name, category: category.name, price } })

  return ok({ status: 'APPROVED', item, category: category.name })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requirePerm('menu')
  if (denied) return denied
  const { id } = await params
  await ensureDraftTable()
  try {
    await db.aiMenuDraft.delete({ where: { id } })
  } catch {
    return fail('ড্রাফট খুঁজে পাওয়া যায়নি', 404)
  }
  return ok({ deleted: true })
}
