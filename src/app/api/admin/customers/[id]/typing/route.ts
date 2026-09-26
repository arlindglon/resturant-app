// POST /api/admin/customers/[id]/typing — admin লিখছে এমন লাইভ সংকেত।
// মালিকের নিয়ম: admin ওপাশ থেকে লিখলে কাস্টমারের Messenger-এ "..." টাইপিং-ইন্ডিকেটর
// জ্বলে উঠবে — যেন সে বুঝতে পারে পেজের মানুষটি এখনই উত্তর লিখছে।
// ফ্রন্টএন্ড টাইপ করার সময় ৪ সেকেন্ড পরপর পিং পাঠায় (Meta-র ইন্ডিকেটর ~২০ সেকেন্ডে
// নিজে নিভে যায়); মেসেজ পাঠানো হলে সেটি নিজে থেকেই মুছে যায়।
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, fail } from '@/lib/api'
import { requirePerm } from '@/lib/staff-auth'
import { sendTypingOn } from '@/lib/messenger'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requirePerm('tables')
  if (denied) return denied
  const { id } = await params
  const customer = await db.customer.findUnique({ where: { id }, select: { psid: true } })
  if (!customer) return fail('কাস্টমার পাওয়া যায়নি', 404)
  if (customer.psid.startsWith('direct:')) {
    return fail('এই কাস্টমার Messenger-এ চ্যাট করেননি — টাইপিং-সিগন্যাল যাবে না।', 400, 'NO_MESSENGER')
  }
  const sent = await sendTypingOn(customer.psid)
  return ok({ typing: sent })
}
