// Birthday discount core — shared by webhook, cron & admin "Run Now"
import { db } from '@/lib/db'
import { getSettingNumber } from '@/lib/settings'
import { SETTING_KEYS } from '@/lib/constants'
import { sendText } from '@/lib/messenger'
import { emitEvent } from '@/lib/emit'
import { appendLedger, LEDGER_TYPES } from '@/lib/ledger'
import { deviceMatch } from '@/lib/device'

export interface AntiFraudResult {
  ok: boolean
  reason?: string
}

/** 7-layer anti-fraud check (device + fingerprint + psid + phone + session + bill).
 *  Per-offer lock: when an occasionId is given, the lock applies to THAT offer
 *  only — different occasion offers stay claimable independently. */
export async function antiFraudCheck(p: {
  psid: string
  phone: string
  deviceId: string
  deviceFp?: string | null
  sessionId: string
  occasionId?: string | null
}): Promise<AntiFraudResult> {
  const deviceOr = deviceMatch({ id: p.deviceId, fp: p.deviceFp || null })

  if (p.occasionId) {
    // ── per-offer lock: THIS occasion offer already claimed by the same
    //    customer / phone / session / device? (other offers stay claimable)
    const prior = await db.birthdayClaim.findFirst({
      where: {
        occasionId: p.occasionId,
        OR: [
          { psid: p.psid },
          { phone: p.phone },
          { sessionId: p.sessionId },
          ...(deviceOr.length > 0 ? [{ OR: deviceOr }] : []),
        ],
      },
    })
    if (prior) return { ok: false, reason: 'এই অফারটি আগেই দাবি করা হয়েছে — একবারই প্রযোজ্য।' }
  } else {
    // ── legacy birthday (no occasion selected): lifetime locks ──
    // 1. Facebook ID already claimed lifetime discount?
    const byPsid = await db.customer.findUnique({ where: { psid: p.psid } })
    if (byPsid?.discountClaimed) return { ok: false, reason: 'জন্মদিনের ছাড়টি ইতোমধ্যে দাবি করা হয়েছে।' }

    // 2. Phone already claimed?
    const byPhone = await db.customer.findUnique({ where: { phone: p.phone } })
    if (byPhone?.discountClaimed) return { ok: false, reason: 'এই ফোন নম্বর ইতোমধ্যে ছাড় নিয়েছে।' }

    // 3. Device (id OR fingerprint) already claimed the legacy birthday — lifetime?
    if (deviceOr.length > 0) {
      const byDevice = await db.birthdayClaim.findFirst({ where: { OR: deviceOr, occasionId: null } })
      if (byDevice) return { ok: false, reason: 'জন্মদিনের ছাড়টি আগেই দাবি করা হয়েছে — একবারই প্রযোজ্য।' }
    }

    // 4. This bill already got the discount?
    const session = await db.tableSession.findUnique({ where: { id: p.sessionId } })
    if (session?.birthdayGranted) return { ok: false, reason: 'এই বিলে ইতোমধ্যে ছাড় প্রয়োগ করা হয়েছে।' }
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
  if (subtotal < minBill) return { ok: false, reason: `ন্যূনতম বিল ৳${minBill} হলে ছাড় প্রযোজ্য।` }

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
}): Promise<{ ok: boolean; message: string }> {
  // occasion override (anniversary, wedding, custom occasion from admin panel)
  let amount = await getSettingNumber(SETTING_KEYS.BIRTHDAY_DISCOUNT_AMOUNT, 50)
  if (p.occasionId) {
    const occ = await db.occasionOffer.findUnique({ where: { id: p.occasionId } }).catch(() => null)
    if (!occ || !occ.active) return { ok: false, message: 'নির্বাচিত অফারটি এখন সক্রিয় নয়' }
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
    return { ok: false, message: check.reason || 'অ্যান্টি-ফ্রড চেক ব্যর্থ' }
  }

  const session = await db.tableSession.findUnique({
    where: { id: p.sessionId },
    include: { table: true },
  })
  if (!session) return { ok: false, message: 'সেশন পাওয়া যায়নি' }

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

  if (!targetOrder) return { ok: false, message: 'কোনো অর্ডার পাওয়া যায়নি' }

  const discount = Math.min(amount, targetOrder.total)
  const prevDiscount = targetOrder.birthdayDiscount || 0

  await db.$transaction([
    db.order.update({
      where: { id: targetOrder.id },
      // increment: several occasion offers may stack on the same bill
      data: { birthdayDiscount: { increment: discount }, total: { decrement: discount } },
    }),
    db.tableSession.update({
      where: { id: p.sessionId },
      data: { birthdayGranted: true },
    }),
    db.customer.upsert({
      where: { psid: p.psid },
      update: { phone: p.phone, discountClaimed: true, claimedAt: new Date(), birthday: p.birthday || undefined },
      create: {
        psid: p.psid,
        firstName: p.firstName,
        lastName: p.lastName || '',
        phone: p.phone,
        birthday: p.birthday || null,
        discountClaimed: true,
        claimedAt: new Date(),
      },
    }),
    db.birthdayClaim.create({
      data: {
        psid: p.psid,
        phone: p.phone,
        deviceId: p.deviceId,
        deviceFp: p.deviceFp || null,
        tableNumber: p.tableNumber,
        sessionId: p.sessionId,
        occasionId: p.occasionId || null,
        amount: discount,
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
    birthdayDiscount: prevDiscount + discount,
  })
  return { ok: true, message: `৳${discount} ছাড় প্রয়োগ হয়েছে!` }
}

/** Daily cron: birthday greetings + voucher */
export async function runBirthdayCron(): Promise<{ sent: number; skipped: boolean }> {
  if (!process.env.META_PAGE_TOKEN) return { sent: 0, skipped: true }

  const tz = await (await import('@/lib/settings')).getSetting(SETTING_KEYS.BIRTHDAY_TIMEZONE)
  const now = new Date()
  // today's month/day in restaurant timezone
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, month: '2-digit', day: '2-digit' })
  const [mm, dd] = fmt.format(now).split('/').map(Number)

  const customers = await db.customer.findMany()
  let sent = 0
  for (const c of customers) {
    if (!c.birthday) continue
    const bm = c.birthday.getMonth() + 1
    const bd = c.birthday.getDate()
    if (bm !== mm || bd !== dd) continue
    const ok = await sendText(
      c.psid,
      `🎂 শুভ জন্মদিন ${c.firstName}!\n\nআপনার বিশেষ দিনে আমাদের পক্ষ থেকে ছোট্ট উপহার — কুপন "BDAY${mm}${dd}" ব্যবহার করে আজকের অর্ডারে ১৫% ছাড় নিন! 🎉\nআমরা অপেক্ষায় আছি।`
    )
    if (ok) sent++
  }
  return { sent, skipped: false }
}
