// PATCH /api/admin/customers/[id] — admin edits the CRM record:
// name (manual entry when Facebook/AI never learned it), event label
// ("জন্মদিন" / "বিয়ের বার্ষিকী" / custom), event date, phone.
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, fail } from '@/lib/api'
import { requirePerm } from '@/lib/staff-auth'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requirePerm('tables')
  if (denied) return denied
  const { id } = await params
  const body = await req.json().catch(() => ({}))

  const existing = await db.customer.findUnique({ where: { id } })
  if (!existing) return fail('কাস্টমার পাওয়া যায়নি', 404)

  const data: Record<string, unknown> = {}
  // admin-typed full name goes into firstName (lastName cleared so the display
  // never doubles up "রাকিব ইসলাম" + leftover FB surname)
  if (typeof body.firstName === 'string') {
    const name = body.firstName.trim().slice(0, 80)
    if (name) {
      data.firstName = name
      data.lastName = ''
    }
  }
  if (typeof body.eventLabel === 'string') data.eventLabel = body.eventLabel.trim().slice(0, 60) || null
  if (typeof body.phone === 'string') {
    const phone = body.phone.replace(/[^\d+]/g, '')
    data.phone = phone || null
  }
  if (typeof body.birthday === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.birthday)) {
    data.birthday = new Date(body.birthday)
  } else if (body.birthday === null || body.birthday === '') {
    data.birthday = null
  }

  const customer = await db.customer.update({ where: { id }, data })
  return ok({ customer })
}
