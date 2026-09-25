// POST /api/admin/customers/[id]/message — admin sends a Messenger message
// (offer, greeting, event wish…) to a customer via the Page Send API.
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, fail } from '@/lib/api'
import { requirePerm } from '@/lib/staff-auth'
import { messengerConfigured, sendText } from '@/lib/messenger'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requirePerm('tables')
  if (denied) return denied
  const { id } = await params
  const body = await req.json().catch(() => ({}))

  const text = (body.text || '').toString().trim().slice(0, 1900)
  if (!text) return fail('মেসেজ লিখুন', 400)
  if (!messengerConfigured()) {
    return fail('META_PAGE_TOKEN সেট করা নেই — প্রথমে মেসেঞ্জার ইন্টিগ্রেশন সেটআপ করুন।', 400, 'NOT_CONFIGURED')
  }

  const customer = await db.customer.findUnique({ where: { id } })
  if (!customer) return fail('কাস্টমার পাওয়া যায়নি', 404)
  if (customer.psid.startsWith('direct:')) {
    return fail('এই কাস্টমার মেসেঞ্জারে চ্যাট করেননি — মেসেজ পাঠানো সম্ভব নয়।', 400, 'NO_MESSENGER')
  }

  const sent = await sendText(customer.psid, text)
  if (!sent) return fail('মেসেজ পাঠানো যায়নি — টোকেন/সংযোগ চেক করুন।', 502, 'SEND_FAILED')
  return ok({ sent: true })
}
