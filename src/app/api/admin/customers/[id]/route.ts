// PATCH /api/admin/customers/[id] — admin edits the CRM record:
// name (manual entry when Facebook/AI never learned it), chat language the
// bot must use, event label ("জন্মদিন" / "বিয়ের বার্ষিকী" / custom), date, phone.
// DELETE /api/admin/customers/[id] — full CRM wipe of ONE customer: profile,
// notes, chat memory, pending claim tokens, claim history. The same person
// messaging again starts completely fresh (new C-code, "নাম যাচাই বাকি",
// AI learns name/birthday/phone from zero — নতুন কাস্টমারের মতো সেটআপ)।
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, fail } from '@/lib/api'
import { requirePerm } from '@/lib/staff-auth'
import { LANGUAGE_CODES } from '@/lib/constants'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requirePerm('tables')
  if (denied) return denied
  const { id } = await params
  const body = await req.json().catch(() => ({}))

  const existing = await db.customer.findUnique({ where: { id } })
  if (!existing) return fail('কাস্টমার পাওয়া যায়নি', 404)

  const data: Record<string, unknown> = {}
  // admin-typed full name goes into firstName (lastName cleared so the display
  // never doubles up "রাকিব ইসলাম" + leftover FB surname).
  // EMPTY string = CLEAR the manual name → back to the "নাম যাচাই বাকি"
  // placeholder so Facebook/AI can learn the real name again.
  if (typeof body.firstName === 'string') {
    const name = body.firstName.trim().slice(0, 80)
    if (name) {
      data.firstName = name
      data.lastName = ''
    } else {
      data.firstName = 'নাম যাচাই বাকি'
      data.lastName = null
    }
  }
  if (typeof body.eventLabel === 'string') data.eventLabel = body.eventLabel.trim().slice(0, 60) || null
  // admin marks the language the bot must always use with this customer
  // ("" / null clears the mark → the bot mirrors the customer again)
  if (body.language === null || body.language === '') data.language = null
  else if (typeof body.language === 'string' && LANGUAGE_CODES.includes(body.language)) data.language = body.language
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

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requirePerm('tables')
  if (denied) return denied
  const { id } = await params

  const customer = await db.customer.findUnique({ where: { id } })
  if (!customer) return fail('কাস্টমার পাওয়া যায়নি', 404)

  // পুরো স্লেট মুছে দাও — একই মানুষ আবার মেসেঞ্জারে এলে একদম নতুন কাস্টমার
  // (নতুন C-কোড, নাম/জন্মদিন/ফোন সব নতুন করে শেখা হবে)।
  // $transaction — মাঝপথে ব্যর্থ হলে আংশিক মুছে-ফেলা রোলব্যাক হয় (কাস্টমারের
  // অর্ধেক তথ্য রয়ে যাওয়ার ভয় নেই)।
  try {
    await db.$transaction([
      db.chatMessage.deleteMany({ where: { psid: customer.psid } }),
      db.referralToken.deleteMany({ where: { psid: customer.psid } }),
      db.birthdayClaim.deleteMany({ where: { psid: customer.psid } }),
      // অতি-পুরনো claim rows (customerId দিয়ে লিংকড) — FK বাধা যেন না দেয়
      db.birthdayClaim.updateMany({ where: { customerId: id }, data: { customerId: null } }),
      // notes cascade-এ যায়; phone/code unique বাধা free হয় রো-টা ডিলিটেই
      db.customer.delete({ where: { id } }),
    ])
  } catch (e) {
    console.error('[customers:DELETE]', e)
    return fail('ডিলিট করা যায়নি — ডাটাবেস ত্রুটি, আবার চেষ্টা করুন।', 500)
  }

  return ok({ deleted: true })
}
