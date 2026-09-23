// POST /api/birthday/referral — customer submits name+birthday on bill page,
// gets an m.me deep link with unique ref token.
// ANTI-REPEAT (per offer): each occasion offer can be claimed once per device
// (id or fingerprint) / session — but DIFFERENT offers stay claimable.
import { NextRequest } from 'next/server'
import crypto from 'crypto'
import { db } from '@/lib/db'
import { ok, fail } from '@/lib/api'
import { getValidSession } from '@/lib/session'
import { getSetting, getSettingNumber } from '@/lib/settings'
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
  const name = (body.name || '').toString().trim().slice(0, 60)
  const birthday = (body.birthday || '').toString()
  const occasionId = (body.occasionId || '').toString() || null
  const device = deviceIdentity(req, body)

  // Messenger offer master switch (admin panel on/off)
  const messengerEnabled = await getSetting(SETTING_KEYS.MESSENGER_AUTO_REPLY_ENABLED)
  if (messengerEnabled === 'false') {
    return fail('এই মুহূর্তে মেসেঞ্জার অফার বন্ধ আছে।', 403, 'OFFER_DISABLED')
  }

  if (!name) return fail('নাম লিখুন', 400)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthday)) return fail('তারিখ সিলেক্ট করুন', 400)

  // occasion (birthday / anniversary / custom) — falls back to birthday defaults
  let occasion: { id: string; name: string; minBill: number } | null = null
  if (occasionId) {
    const occ = await db.occasionOffer.findUnique({ where: { id: occasionId } })
    if (!occ || !occ.active) return fail('নির্বাচিত অফারটি এখন সক্রিয় নয়', 400)
    occasion = { id: occ.id, name: occ.name, minBill: occ.minBill }
  }

  // ── ANTI-REPEAT (per offer): this session/device already claimed THIS offer?
  //    Different occasion offers stay claimable independently.
  const dm = deviceMatch(device)
  if (occasionId) {
    const priorClaim = await db.birthdayClaim.findFirst({
      where: {
        occasionId,
        OR: [{ sessionId: session.sessionId }, ...(dm.length > 0 ? [{ OR: dm }] : [])],
      },
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
  } else {
    // legacy birthday (no occasion): lifetime locks
    const s = await db.tableSession.findUnique({ where: { id: session.sessionId } })
    if (s?.birthdayGranted) return fail('এই বিলে ইতোমধ্যে জন্মদিনের ছাড় দাবি করা হয়েছে।', 400)
    if (dm.length > 0) {
      const priorClaim = await db.birthdayClaim.findFirst({ where: { OR: dm, occasionId: null } })
      if (priorClaim) {
        await appendLedger({
          type: LEDGER_TYPES.BIRTHDAY_BLOCKED,
          sessionId: session.sessionId,
          deviceId: device.id,
          deviceFp: device.fp,
          tableNumber: session.tableNumber,
          payload: { reason: 'device_repeat_referral', priorClaimTable: priorClaim.tableNumber },
        })
        return fail('জন্মদিনের ছাড়টি আগেই দাবি করা হয়েছে — একবারই প্রযোজ্য।', 403, 'ALREADY_CLAIMED')
      }
    }
  }

  // ── ANTI-REPEAT 3: bill >= min? (occasion-specific min, else global birthday min)
  const minBill = occasion ? occasion.minBill : await getSettingNumber(SETTING_KEYS.BIRTHDAY_MIN_BILL, 500)
  const agg = await db.order.aggregate({
    where: { sessionId: session.sessionId, status: { notIn: ['CANCELLED'] } },
    _sum: { subtotal: true },
  })
  if ((agg._sum.subtotal || 0) < minBill) {
    return fail(`এই অফারের জন্য ন্যূনতম বিল ৳${minBill} প্রয়োজন`, 400)
  }

  // reuse this session's pending token for THE SAME offer (different offers get their own token)
  const existing = await db.referralToken.findFirst({
    where: { sessionId: session.sessionId, status: 'PENDING', occasionId: occasion?.id || null },
  })

  const token =
    existing ||
    (await db.referralToken.create({
      data: {
        token: crypto.randomBytes(16).toString('hex'),
        name,
        birthday: new Date(birthday),
        sessionId: session.sessionId,
        tableNumber: session.tableNumber,
        deviceId: device.id || session.deviceId || 'unknown',
        deviceFp: device.fp,
        occasionId: occasion?.id || null,
        occasionName: occasion?.name || null,
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
    payload: { name, referral: token.token.slice(0, 8) + '…' },
  })

  return ok({ link, token: token.token })
}
