// /api/admin/customer-notes — per-customer CRM notes & tags.
// Admin writes observations/strategy ("VIP — always orders kacchi",
// "wants catering quote") — the bot reads them and personalizes every chat;
// the AI chatbot itself saves notable facts here (kind=AI).
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, fail } from '@/lib/api'
import { requirePerm } from '@/lib/staff-auth'

export async function GET(req: NextRequest) {
  const denied = await requirePerm('tables')
  if (denied) return denied

  const customerId = req.nextUrl.searchParams.get('customerId')
  if (!customerId) return fail('customerId দিন', 400)

  const notes = await db.customerNote.findMany({
    where: { customerId },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })
  return ok({ notes })
}

export async function POST(req: NextRequest) {
  const denied = await requirePerm('tables')
  if (denied) return denied

  const body = await req.json().catch(() => ({}))
  const customerId = String(body.customerId || '')
  const text = String(body.text || '').trim()
  const kind = body.kind === 'TAG' ? 'TAG' : 'NOTE'
  if (!customerId || !text) return fail('কাস্টমার ও নোটের লেখা দিন', 400)

  const exists = await db.customer.findUnique({ where: { id: customerId }, select: { id: true } })
  if (!exists) return fail('কাস্টমার পাওয়া যায়নি', 404)

  const note = await db.customerNote.create({
    data: { customerId, text: text.slice(0, 500), kind, createdBy: 'admin' },
  })
  return ok({ note })
}

export async function DELETE(req: NextRequest) {
  const denied = await requirePerm('tables')
  if (denied) return denied

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return fail('id দিন', 400)
  await db.customerNote.delete({ where: { id } }).catch(() => null)
  return ok({ deleted: true })
}
