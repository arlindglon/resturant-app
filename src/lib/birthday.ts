// Birthday discount core — shared by webhook, cron & admin "Run Now"
import { db } from '@/lib/db'
import { getSetting, getSettingNumber } from '@/lib/settings'
import { SETTING_KEYS } from '@/lib/constants'
import { sendText, sendRnToToken } from '@/lib/messenger'
import { botQuickReplies } from '@/lib/bot-ui'
import { emitEvent } from '@/lib/emit'
import { appendLedger, LEDGER_TYPES } from '@/lib/ledger'
import { deviceMatch } from '@/lib/device'
import { nextCustomerCode } from '@/lib/customer-code'
import { t, pickBotLang, globalBotLang, type BotLang } from '@/lib/bot-text'

export interface AntiFraudResult {
  ok: boolean
  reason?: string
}

/** 7-layer anti-fraud check (device + fingerprint + psid + phone + session + bill).
 *  ONE offer per bill: any occasion offer used in this session blocks the others.
 *  Per-offer lifetime lock: the SAME offer can be claimed once per customer/device
 *  — different offers stay claimable on later visits. */
export async function antiFraudCheck(p: {
  psid: string
  phone: string
  deviceId: string
  deviceFp?: string | null
  sessionId: string
  occasionId?: string | null
  lang?: BotLang // pack language for the customer-facing block reasons (default bn)
}): Promise<AntiFraudResult> {
  const L = p.lang ?? 'bn'
  const deviceOr = deviceMatch({ id: p.deviceId, fp: p.deviceFp || null })

  if (p.occasionId) {
    // ── 1. one offer per bill: this session already used ANY occasion offer? ──
    const sessionOffer = await db.birthdayClaim.findFirst({
      where: { sessionId: p.sessionId, occasionId: { not: null } },
    })
    if (sessionOffer) {
      return { ok: false, reason: t(L, 'blockOnePerBill') }
    }
    const sessionRow = await db.tableSession.findUnique({ where: { id: p.sessionId } })
    if (sessionRow?.birthdayGranted) {
      return { ok: false, reason: t(L, 'blockOnePerBill') }
    }

    // ── 2. THIS offer already claimed earlier by the same customer / phone / device?
    //    (other offers remain claimable on other bills)
    const prior = await db.birthdayClaim.findFirst({
      where: {
        occasionId: p.occasionId,
        OR: [
          { psid: p.psid },
          ...(p.phone ? [{ phone: p.phone }] : []),
          ...(deviceOr.length > 0 ? [{ OR: deviceOr }] : []),
        ],
      },
    })
    if (prior) return { ok: false, reason: t(L, 'blockOfferUsed') }
  } else {
    // ── legacy birthday (no occasion selected): lifetime locks ──
    // 1. Facebook ID already claimed lifetime discount?
    const byPsid = await db.customer.findUnique({ where: { psid: p.psid } })
    if (byPsid?.discountClaimed) return { ok: false, reason: t(L, 'blockBirthdayUsed') }

    // 2. Phone already claimed?
    const byPhone = await db.customer.findUnique({ where: { phone: p.phone } })
    if (byPhone?.discountClaimed) return { ok: false, reason: t(L, 'blockPhoneUsed') }

    // 3. Device (id OR fingerprint) already claimed the legacy birthday — lifetime?
    if (deviceOr.length > 0) {
      const byDevice = await db.birthdayClaim.findFirst({ where: { OR: deviceOr, occasionId: null } })
      if (byDevice) return { ok: false, reason: t(L, 'blockDeviceUsed') }
    }

    // 4. This bill already got the discount?
    const session = await db.tableSession.findUnique({ where: { id: p.sessionId } })
    if (session?.birthdayGranted) return { ok: false, reason: t(L, 'blockBillUsed') }
  }

  // 5. Minimum bill? (occasion-specific min overrides the global birthday min)
  let minBill = await getSettingNumber(SETTING_KEYS.BIRTHDAY_MIN_BILL, 500)
  if (p.occasionId) {
    const occ = await db.occasionOffer.findUnique({ where: { id: p.occasionId } }).catch(() => null)
    if (occ && occ.active) minBill = occ.minBill
  }
  const orders = await db.order.aggregate({
    where: { sessionId: p.sessionId, status: { notIn: ['CANCELLED'] } },
    _sum: { subtotal: true },
  })
  const subtotal = orders._sum.subtotal || 0
  if (subtotal < minBill) return { ok: false, reason: t(L, 'blockMinBill', { min: minBill }) }

  return { ok: true }
}

/** Apply birthday discount to the session's latest open order + lock customer */
export async function applyBirthdayDiscount(p: {
  psid: string
  firstName: string
  lastName?: string
  phone: string
  birthday?: Date | null
  deviceId: string
  deviceFp?: string | null
  sessionId: string
  tableNumber: number
  occasionId?: string | null
  occasionName?: string | null
  dataText?: string | null // verification data the customer provided (messenger flow)
  lang?: BotLang // pack language for the customer-facing messages (default bn)
}): Promise<{ ok: boolean; message: string }> {
  const L = p.lang ?? 'bn'
  // occasion override (anniversary, wedding, custom occasion from admin panel)
  let amount = await getSettingNumber(SETTING_KEYS.BIRTHDAY_DISCOUNT_AMOUNT, 50)
  if (p.occasionId) {
    const occ = await db.occasionOffer.findUnique({ where: { id: p.occasionId } }).catch(() => null)
    if (!occ || !occ.active) return { ok: false, message: t(L, 'errOfferInactive') }
    amount = occ.discount
  }

  const check = await antiFraudCheck(p)
  if (!check.ok) {
    await appendLedger({
      type: LEDGER_TYPES.BIRTHDAY_BLOCKED,
      sessionId: p.sessionId,
      deviceId: p.deviceId,
      deviceFp: p.deviceFp || null,
      tableNumber: p.tableNumber,
      payload: { psid: p.psid, phone: p.phone, reason: check.reason || 'anti_fraud' },
    })
    return { ok: false, message: check.reason || t(L, 'errFraudFallback') }
  }

  const session = await db.tableSession.findUnique({
    where: { id: p.sessionId },
    include: { table: true },
  })
  if (!session) return { ok: false, message: t(L, 'errNoSession') }

  // apply to the most recent non-completed order, else latest order
  const targetOrder =
    (await db.order.findFirst({
      where: { sessionId: p.sessionId, status: { notIn: ['CANCELLED', 'COMPLETED'] } },
      orderBy: { placedAt: 'desc' },
    })) ||
    (await db.order.findFirst({
      where: { sessionId: p.sessionId },
      orderBy: { placedAt: 'desc' },
    }))

  if (!targetOrder) return { ok: false, message: t(L, 'errNoOrder') }

  const discount = Math.min(amount, targetOrder.total)
  const prevDiscount = targetOrder.birthdayDiscount || 0

  await db.$transaction([
    db.order.update({
      where: { id: targetOrder.id },
      // one occasion offer per bill — discount replaces (never stacks)
      data: { birthdayDiscount: discount, total: { decrement: discount - prevDiscount } },
    }),
    db.tableSession.update({
      where: { id: p.sessionId },
      data: { birthdayGranted: true },
    }),
    db.customer.upsert({
      where: { psid: p.psid },
      update: { phone: p.phone || undefined, discountClaimed: true, claimedAt: new Date(), birthday: p.birthday || undefined, dataText: p.dataText || undefined },
      create: {
        psid: p.psid,
        code: await nextCustomerCode(), // unique CRM code (C-0001…) for quick lookup
        firstName: p.firstName,
        lastName: p.lastName || '',
        phone: p.phone || null,
        birthday: p.birthday || null,
        discountClaimed: true,
        claimedAt: new Date(),
        dataText: p.dataText || null,
      },
    }),
    db.birthdayClaim.create({
      data: {
        psid: p.psid,
        phone: p.phone || '',
        deviceId: p.deviceId,
        deviceFp: p.deviceFp || null,
        tableNumber: p.tableNumber,
        sessionId: p.sessionId,
        occasionId: p.occasionId || null,
        amount: discount,
        dataText: p.dataText || null,
      },
    }),
  ])
  await appendLedger({
    type: LEDGER_TYPES.BIRTHDAY_CLAIMED,
    sessionId: p.sessionId,
    deviceId: p.deviceId,
    deviceFp: p.deviceFp || null,
    tableNumber: p.tableNumber,
    payload: {
      psid: p.psid,
      phone: p.phone,
      amount: discount,
      occasionId: p.occasionId || null,
      lifetimeLock: !p.occasionId,
    },
  })

  emitEvent('order:status', {
    id: targetOrder.id,
    status: targetOrder.status,
    birthdayDiscount: discount,
  })
  return { ok: true, message: t(L, 'applySuccess', { amt: discount }) }
}

/** Daily cron: birthday greetings + voucher.
 *  🔔 Recurring Notifications অপট-ইন করা কাস্টমার থাকলে আগে RN দিয়ে চেষ্টা
 *  করি — এটি ২৪ ঘণ্টার উইন্ডোর বাইরেও (যেকোনো সময়) পৌঁছায়; ব্যর্থ হলে
 *  আগের মতো সাধারণ টেক্সটে ফলব্যাক। */
export async function runBirthdayCron(): Promise<{ sent: number; skipped: boolean }> {
  if (!process.env.META_PAGE_TOKEN) return { sent: 0, skipped: true }

  const tz = await (await import('@/lib/settings')).getSetting(SETTING_KEYS.BIRTHDAY_TIMEZONE)
  const now = new Date()
  // today's month/day in restaurant timezone
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, month: '2-digit', day: '2-digit' })
  const [mm, dd] = fmt.format(now).split('/').map(Number)

  const customers = await db.customer.findMany()
  const globalLang = await globalBotLang()
  let sent = 0
  for (const c of customers) {
    if (!c.birthday) continue
    const bm = c.birthday.getMonth() + 1
    const bd = c.birthday.getDate()
    if (bm !== mm || bd !== dd) continue
    // never greet with a placeholder word — real name only
    const nm = c.firstName && !/^customer$/i.test(c.firstName) && c.firstName !== 'নাম যাচাই বাকি' ? c.firstName : ''
    // ভাষা: কাস্টমারের মার্ক করা ভাষা > admin গ্লোবাল সেটিং > বাংলা
    const wish = t(pickBotLang(c.language, globalLang), 'birthdayWish', {
      name: nm ? ` ${nm}` : '',
      coupon: `BDAY${mm}${dd}`,
    })
    // 🔔 RN-চালু কাস্টমার → নোটিফিকেশন টোকেন দিয়ে পাঠাই (24h window-নির্ভর নয়)
    if (c.rnToken) {
      const rn = await sendRnToToken(c.rnToken, wish)
      if (rn.ok) {
        sent++
        continue
      }
      console.error('[cron:rn-birthday]', c.psid, rn.error) // fall through to text
    }
    // টেক্সট-পথেও নিচে মেনু-বাটন যায় (সবসময়-বাটন নিয়ম)
    const ok = await sendText(c.psid, wish, {
      quickReplies: botQuickReplies(pickBotLang(c.language, globalLang)),
    })
    if (ok) sent++
  }
  return { sent, skipped: false }
}
