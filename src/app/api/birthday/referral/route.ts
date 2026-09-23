// POST /api/birthday/referral — customer picks an offer on the bill page and
// gets an m.me deep link with a unique ref token. NO name/date is collected
// here — the bot asks for the offer's verification data in the messenger chat.
// ANTI-REPEAT: ONE offer per bill (session); the SAME offer once per device —
// different offers stay claimable on later bills.
import { NextRequest } from 'next/server'
import crypto from 'crypto'
import { db } from '@/lib/db'
import { ok, fail } from '@/lib/api'
import { getValidSession } from '@/lib/session'
import { getSetting } from '@/lib/settings'
import { SETTING_KEYS } from '@/lib/constants'
import { deviceIdentity, deviceMatch } from '@/lib/device'
import { appendLedger, LEDGER_TYPES } from '@/lib/ledger'

/**
 * Accepts any reasonable form of the page identity and returns the bare
 * m.me username/page-id: strips https://, m.me/, facebook.com/, @, spaces,
 * trailing slashes & query. Returns '' when nothing usable remains.
 */
function sanitizePageUsername(raw: string): string {
  return raw
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^(www\.)?(m\.me|facebook\.com|fb\.com|fb\.me)\//i, '')
    .replace(/^@/, '')
    .replace(/[/?#].*$/, '')
    .trim()
}

export async function POST(req: NextRequest) {
  const session = await getValidSession()
  if (!session) return fail('অবৈধ সেশন', 403, 'SESSION_INVALID')

  const body = await req.json().catch(() => ({}))
  const occasionId = (body.occasionId || '').toString() || null
  const device = deviceIdentity(req, body)

  // Messenger offer master switch (admin panel on/off)
  const messengerEnabled = await getSetting(SETTING_KEYS.MESSENGER_AUTO_REPLY_ENABLED)
  if (messengerEnabled === 'false') {
    return fail('এই মুহূর্তে মেসেঞ্জার অফার বন্ধ আছে।', 403, 'OFFER_DISABLED')
  }

  if (!occasionId) return fail('প্রথমে একটি অফার বেছে নিন', 400)

  // occasion (birthday / anniversary / custom) must be an active offer
  const occ = await db.occasionOffer.findUnique({ where: { id: occasionId } })
  if (!occ || !occ.active) return fail('নির্বাচিত অফারটি এখন সক্রিয় নয়', 400)
  const occasion = { id: occ.id, name: occ.name, minBill: occ.minBill }

  // ── ANTI-REPEAT 1: ONE offer per bill — this session already used any offer?
  const sessionOffer = await db.birthdayClaim.findFirst({
    where: { sessionId: session.sessionId, occasionId: { not: null } },
  })
  const s = await db.tableSession.findUnique({ where: { id: session.sessionId } })
  if (sessionOffer || s?.birthdayGranted) {
    return fail('এই বিলে ইতোমধ্যে একটি অফার ব্যবহার করা হয়েছে — প্রতি বিলে একটি অফারই প্রযোজ্য।', 403, 'ALREADY_CLAIMED')
  }

  // ── ANTI-REPEAT 2: THIS offer already claimed by this device (earlier bills)?
  const dm = deviceMatch(device)
  if (dm.length > 0) {
    const priorClaim = await db.birthdayClaim.findFirst({
      where: { occasionId, OR: dm },
    })
    if (priorClaim) {
      await appendLedger({
        type: LEDGER_TYPES.BIRTHDAY_BLOCKED,
        sessionId: session.sessionId,
        deviceId: device.id,
        deviceFp: device.fp,
        tableNumber: session.tableNumber,
        payload: {
          reason: 'offer_repeat_referral',
          occasionId,
          priorClaimTable: priorClaim.tableNumber,
        },
      })
      return fail('এই অফারটি আগেই দাবি করা হয়েছে — একবারই প্রযোজ্য।', 403, 'ALREADY_CLAIMED')
    }
  }

  // ── ANTI-REPEAT 3: bill >= min? (occasion-specific min, else global birthday min)
  const minBill = occasion.minBill
  const agg = await db.order.aggregate({
    where: { sessionId: session.sessionId, status: { notIn: ['CANCELLED'] } },
    _sum: { subtotal: true },
  })
  if ((agg._sum.subtotal || 0) < minBill) {
    return fail(`এই অফারের জন্য ন্যূনতম বিল ৳${minBill} প্রয়োজন`, 400)
  }

  // reuse this session's pending token for THE SAME offer (different offers get their own token)
  const existing = await db.referralToken.findFirst({
    where: { sessionId: session.sessionId, status: 'PENDING', occasionId: occasion.id },
  })

  const token =
    existing ||
    (await db.referralToken.create({
      data: {
        token: crypto.randomBytes(16).toString('hex'),
        name: 'Customer',
        sessionId: session.sessionId,
        tableNumber: session.tableNumber,
        deviceId: device.id || session.deviceId || 'unknown',
        deviceFp: device.fp,
        occasionId: occasion.id,
        occasionName: occasion.name,
      },
    }))

  const pageUsername = sanitizePageUsername(
    (await getSetting(SETTING_KEYS.MESSENGER_PAGE_USERNAME)) || ''
  )
  if (!pageUsername) {
    return fail('মেসেঞ্জার পেজ এখনো কনফিগার করা হয়নি — অনুগ্রহ করে রেস্তোরাঁ ম্যানেজারকে জানান।', 500, 'MESSENGER_NOT_CONFIGURED')
  }
  const link = `https://m.me/${pageUsername}?ref=${token.token}`

  await appendLedger({
    type: LEDGER_TYPES.REFERRAL_ISSUED,
    sessionId: session.sessionId,
    deviceId: device.id,
    deviceFp: device.fp,
    tableNumber: session.tableNumber,
    payload: { occasionId: occasion.id, referral: token.token.slice(0, 8) + '…' },
  })

  return ok({ link, token: token.token })
}
