// GET /api/admin/customers/[id]/fb-profile — "এই PSID কোন Facebook ইউজার?"
// Meta-র privacy নিয়মে PSID থেকে profile link/username পাওয়া যায় না, কিন্তু
// Page token দিয়ে কাস্টমারের FB নাম (first/last) + প্রোফাইল ছবি আনা যায় —
// admin সেই নাম+ছবি মিলিয়ে Meta Business Suite Inbox-এ কাস্টমারকে খুঁজে নেন।
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, fail } from '@/lib/api'
import { requirePerm } from '@/lib/staff-auth'
import { messengerConfigured, fetchMessengerProfile } from '@/lib/messenger'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requirePerm('tables')
  if (denied) return denied
  const { id } = await params

  const customer = await db.customer.findUnique({ where: { id } })
  if (!customer) return fail('কাস্টমার পাওয়া যায়নি', 404)

  // bill-page customer — never chatted on Messenger → no Facebook identity
  if (customer.psid.startsWith('direct:')) {
    return ok({ messenger: false, psid: customer.psid })
  }
  if (!messengerConfigured()) {
    return fail('META_PAGE_TOKEN সেট করা নেই (Vercel env)', 400, 'NOT_CONFIGURED')
  }

  const p = await fetchMessengerProfile(customer.psid)
  if (!p.ok) return fail(p.error || 'Facebook প্রোফাইল আনা যায়নি', 502, 'GRAPH_ERROR')
  return ok({
    messenger: true,
    psid: customer.psid,
    firstName: p.firstName,
    lastName: p.lastName,
    profilePic: p.profilePic,
  })
}
