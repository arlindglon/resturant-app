// POST /api/birthday/direct-claim — instant occasion discount, no Messenger needed.
// Used when the admin's "মেসেঞ্জার অফার" switch is OFF: the customer fills name +
// date on the bill page and the discount is applied to the current bill right away.
// (When the switch is ON the bill page uses the m.me referral flow instead.)
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, fail } from '@/lib/api'
import { getValidSession } from '@/lib/session'
import { getSetting } from '@/lib/settings'
import { SETTING_KEYS } from '@/lib/constants'
import { deviceIdentity } from '@/lib/device'
import { applyBirthdayDiscount } from '@/lib/birthday'

export async function POST(req: NextRequest) {
  const session = await getValidSession()
  if (!session) return fail('অবৈধ সেশন', 403, 'SESSION_INVALID')

  const body = await req.json().catch(() => ({}))
  const name = (body.name || '').toString().trim().slice(0, 60)
  const birthday = (body.birthday || '').toString()
  const occasionId = (body.occasionId || '').toString() || null
  const device = deviceIdentity(req, body)

  // Direct claim is only for "messenger offer OFF" mode
  const messengerEnabled = await getSetting(SETTING_KEYS.MESSENGER_AUTO_REPLY_ENABLED)
  if (messengerEnabled !== 'false') {
    return fail('মেসেঞ্জার অফার চালু আছে — মেসেঞ্জার চ্যাট থেকে দাবি করুন।', 400, 'USE_MESSENGER')
  }

  if (!name) return fail('নাম লিখুন', 400)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthday)) return fail('তারিখ সিলেক্ট করুন', 400)

  // occasion (if selected) must be an active offer
  if (occasionId) {
    const occ = await db.occasionOffer.findUnique({ where: { id: occasionId } })
    if (!occ || !occ.active) return fail('নির্বাচিত অফারটি এখন সক্রিয় নয়', 400)
  }

  const deviceId = device.id || session.deviceId || device.fp || 'unknown'

  const result = await applyBirthdayDiscount({
    psid: `direct:${deviceId}`,
    firstName: name,
    phone: `direct:${deviceId}`,
    birthday: new Date(birthday),
    deviceId,
    deviceFp: device.fp,
    sessionId: session.sessionId,
    tableNumber: session.tableNumber,
    occasionId,
  })

  if (!result.ok) return fail(result.message, 400, 'CLAIM_FAILED')
  return ok({ applied: true, message: result.message })
}
