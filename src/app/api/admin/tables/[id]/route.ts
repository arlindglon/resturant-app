// PATCH/DELETE /api/admin/tables/[id]
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, fail, isAdmin } from '@/lib/api'
import { requirePerm } from '@/lib/staff-auth'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requirePerm('tables')
  if (denied) return denied
  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const data: { number?: number; seats?: number } = {}
  if (body.number !== undefined) {
    const n = parseInt(body.number, 10)
    if (!n || isNaN(n)) return fail('অবৈধ নম্বর', 400)
    data.number = n
  }
  if (body.seats !== undefined) data.seats = parseInt(body.seats, 10) || 4

  try {
    const table = await db.restaurantTable.update({ where: { id }, data })
    return ok({ table })
  } catch {
    return fail('আপডেট ব্যর্থ (নম্বর ডুপ্লিকেট?)', 400)
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    await db.restaurantTable.delete({ where: { id } })
    return ok({ deleted: true })
  } catch {
    return fail('ডিলিট ব্যর্থ — আগে সংশ্লিষ্ট অর্ডার/সেশন দেখে নিন', 400)
  }
}
