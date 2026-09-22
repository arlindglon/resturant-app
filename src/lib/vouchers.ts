// ============================================================
// VOUCHER RULE ENGINE
// Rules: GENERAL | HOT_TIME | SPECIAL_DAY | SET_MENU_QTY
// Limits: single-use per device, campaign usageLimit
// ============================================================
import { db } from '@/lib/db'
import { DISCOUNT_TYPES, VOUCHER_RULES } from '@/lib/constants'
import { appendLedger, LEDGER_TYPES } from '@/lib/ledger'

export interface CartLine {
  itemId: string
  quantity: number
}

/** Device identity for anti-fraud: persistent id + sticky fingerprint */
export interface DeviceIdentity {
  id: string | null
  fp: string | null
}

export interface VoucherValidation {
  ok: boolean
  discount: number
  shortfall?: number
  needed?: number
  message?: string
  voucher?: {
    id: string
    code: string
    title: string
    discountType: string
    discountValue: number
    maxDiscount: number | null
  }
}

function parseJSON<T>(s: string | null | undefined, fallback: T): T {
  try { return JSON.parse(s || '') ?? fallback } catch { return fallback }
}

function minutesOfDay(d: Date) { return d.getHours() * 60 + d.getMinutes() }
function parseHHMM(s: string) { const [h, m] = s.split(':').map(Number); return (h || 0) * 60 + (m || 0) }

function isWithinTimeWindow(v: { daysOfWeek?: string | null; startTime?: string | null; endTime?: string | null }, now: Date): boolean {
  if (v.daysOfWeek) {
    const days = parseJSON<number[]>(v.daysOfWeek, [])
    if (days.length > 0 && !days.includes(now.getDay())) return false
  }
  if (v.startTime && v.endTime) {
    const mins = minutesOfDay(now)
    const start = parseHHMM(v.startTime)
    const end = parseHHMM(v.endTime)
    const inWindow = start <= end ? mins >= start && mins <= end : mins >= start || mins <= end
    if (!inWindow) return false
  }
  return true
}

/**
 * ANTI-FRAUD DEVICE DEDUP (cross-table safe):
 * A device (persistent id OR sticky fingerprint) may use ANY voucher code
 * exactly ONCE — ever. Using it at table 1 and walking to table 2 to retry
 * is blocked and recorded in the security ledger.
 */
async function deviceAlreadyUsed(
  voucherId: string,
  device: DeviceIdentity
): Promise<boolean> {
  const or: Record<string, string>[] = []
  if (device.id) or.push({ deviceId: device.id })
  if (device.fp) or.push({ deviceFp: device.fp })
  if (or.length === 0) return false
  const used = await db.voucherUse.findFirst({ where: { voucherId, OR: or } })
  return Boolean(used)
}

/** Validate a voucher against cart & time context. Never throws. */
export async function validateVoucher(
  codeOrId: string,
  subtotal: number,
  cart: CartLine[],
  device: DeviceIdentity,
  sessionId: string | null,
  opts: { tableNumber?: number | null; context?: 'preview' | 'order' } = {},
  now = new Date()
): Promise<VoucherValidation> {
  const voucher = await db.voucher.findFirst({
    where: {
      OR: [{ code: codeOrId.toUpperCase() }, { id: codeOrId }],
    },
  })
  if (!voucher || !voucher.active) return { ok: false, discount: 0, message: 'কুপন কোডটি সঠিক নয় বা নিষ্ক্রিয়।' }

  // campaign limit
  if (voucher.usageLimit !== null && voucher.usedCount >= voucher.usageLimit) {
    return { ok: false, discount: 0, message: 'এই অফারের সর্বোচ্চ ব্যবহার সীমা শেষ হয়ে গেছে।' }
  }

  // ---- per-session dedup (same table session can't reuse a code) ----
  if (sessionId) {
    const usedInSession = await db.voucherUse.count({
      where: { voucherId: voucher.id, sessionId },
    })
    if (usedInSession > 0) {
      return { ok: false, discount: 0, message: 'এই কুপনটি এই সেশনে ইতোমধ্যে ব্যবহার করা হয়েছে।' }
    }
  }

  // ---- cross-table device dedup (device id OR fingerprint, lifetime) ----
  if (await deviceAlreadyUsed(voucher.id, device)) {
    await appendLedger({
      type: LEDGER_TYPES.VOUCHER_BLOCKED,
      sessionId,
      deviceId: device.id,
      deviceFp: device.fp,
      tableNumber: opts.tableNumber ?? null,
      payload: {
        code: voucher.code,
        reason: 'device_lifetime_dedup',
        context: opts.context || 'preview',
        note: 'device tried to reuse a voucher (possibly from another table)',
      },
    })
    // NOTE: never hint at the anti-fraud mechanics (device/table re-use) in
    // customer-facing text — a scammer could learn to retry from another device.
    return {
      ok: false,
      discount: 0,
      message: '🚫 দুঃখিত! এই কুপনটি আপনি ইতিমধ্যেই ব্যবহার করে ফেলেছেন। প্রতিটি কুপন শুধু একবারই ব্যবহার করা যায়।',
    }
  }

  // min order
  if (subtotal < voucher.minOrderAmount) {
    return { ok: false, discount: 0, message: `এই কুপনের জন্য ন্যূনতম ৳${voucher.minOrderAmount} অর্ডার প্রয়োজন।` }
  }

  switch (voucher.ruleType) {
    case VOUCHER_RULES.HOT_TIME: {
      if (!isWithinTimeWindow(voucher, now)) {
        return { ok: false, discount: 0, message: `⏰ এটি ফ্ল্যাশ ডিল — শুধু ${voucher.startTime}-${voucher.endTime} সময়ে প্রযোজ্য।` }
      }
      break
    }
    case VOUCHER_RULES.SPECIAL_DAY: {
      let days = parseJSON<number[]>(voucher.daysOfWeek, [])
      if (voucher.specificDate) {
        const d1 = voucher.specificDate
        const same = d1.getFullYear() === now.getFullYear() && d1.getMonth() === now.getMonth() && d1.getDate() === now.getDate()
        if (!same) return { ok: false, discount: 0, message: 'এই স্পেশাল ডে অফারটি আজ প্রযোজ্য নয়।' }
      } else if (days.length > 0 && !days.includes(now.getDay())) {
        return { ok: false, discount: 0, message: 'এই অফারটি শুধু নির্দিষ্ট দিনে প্রযোজ্য।' }
      }
      break
    }
    case VOUCHER_RULES.SET_MENU_QTY: {
      const setIds = parseJSON<string[]>(voucher.setMenuIds, [])
      const need = voucher.minQuantity || 1
      if (setIds.length === 0) break
      // count matching set-menu items in cart
      const cartItems = await db.menuItem.findMany({
        where: { id: { in: cart.map((c) => c.itemId) } },
        select: { id: true, isSetMenu: true },
      })
      const cartSetIds = new Set(cartItems.filter((i) => i.isSetMenu).map((i) => i.id))
      let matchedQty = 0
      for (const line of cart) {
        if (setIds.includes(line.itemId) || (cartSetIds.has(line.itemId) && setIds.includes(line.itemId))) {
          matchedQty += line.quantity
        }
      }
      if (matchedQty < need) {
        const shortfall = need - matchedQty
        const pct = voucher.discountType === DISCOUNT_TYPES.PERCENT ? `${voucher.discountValue}%` : `৳${voucher.discountValue}`
        return {
          ok: false,
          discount: 0,
          shortfall,
          needed: need,
          message: `আর মাত্র ${shortfall}টি সেট মেনু যোগ করলেই পাবেন ${pct} ছাড়!`,
        }
      }
      break
    }
    case VOUCHER_RULES.GENERAL:
    default:
      break
  }

  // compute discount
  let discount = 0
  if (voucher.discountType === DISCOUNT_TYPES.PERCENT) {
    discount = Math.round(subtotal * (voucher.discountValue / 100) * 100) / 100
    if (voucher.maxDiscount) discount = Math.min(discount, voucher.maxDiscount)
  } else {
    discount = Math.min(voucher.discountValue, subtotal)
  }

  return {
    ok: true,
    discount,
    voucher: {
      id: voucher.id,
      code: voucher.code,
      title: voucher.title,
      discountType: voucher.discountType,
      discountValue: voucher.discountValue,
      maxDiscount: voucher.maxDiscount,
    },
  }
}

/** Persist usage after successful order placement (with device identity for lifetime dedup) */
export async function recordVoucherUse(
  voucherId: string,
  sessionId: string | null,
  device: DeviceIdentity,
  opts: { orderId?: string | null; tableNumber?: number | null; code?: string | null; discount?: number } = {}
) {
  await db.voucherUse.create({
    data: {
      voucherId,
      sessionId,
      deviceId: device.id,
      deviceFp: device.fp,
      tableNumber: opts.tableNumber ?? null,
      orderId: opts.orderId ?? null,
    },
  })
  await db.voucher.update({ where: { id: voucherId }, data: { usedCount: { increment: 1 } } })

  await appendLedger({
    type: LEDGER_TYPES.VOUCHER_APPLIED,
    sessionId,
    deviceId: device.id,
    deviceFp: device.fp,
    tableNumber: opts.tableNumber ?? null,
    payload: {
      code: opts.code || voucherId,
      discount: opts.discount ?? null,
      orderId: opts.orderId ?? null,
    },
  })
}

/** Which vouchers should appear in the cart slider right now (time-filtered) */
export async function getSliderVouchers(now = new Date()) {
  const vouchers = await db.voucher.findMany({
    where: { active: true },
    orderBy: { createdAt: 'desc' },
  })
  return vouchers
    .filter((v) => {
      if (v.usageLimit !== null && v.usedCount >= v.usageLimit) return false
      if (v.ruleType === VOUCHER_RULES.HOT_TIME) return isWithinTimeWindow(v, now)
      if (v.ruleType === VOUCHER_RULES.SPECIAL_DAY) {
        if (v.specificDate) {
          const d = v.specificDate
          return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
        }
        const days = parseJSON<number[]>(v.daysOfWeek, [])
        return days.length === 0 || days.includes(now.getDay())
      }
      return true // GENERAL + SET_MENU_QTY always show (cart-validated on apply)
    })
    .map((v) => ({
      id: v.id,
      code: v.code,
      title: v.title,
      description: v.description,
      discountType: v.discountType,
      discountValue: v.discountValue,
      maxDiscount: v.maxDiscount,
      minOrderAmount: v.minOrderAmount,
      ruleType: v.ruleType,
      startTime: v.startTime,
      endTime: v.endTime,
      minQuantity: v.minQuantity,
      setMenuIds: parseJSON<string[]>(v.setMenuIds, []),
      badge:
        v.ruleType === VOUCHER_RULES.HOT_TIME
          ? `⏰ ${v.startTime}-${v.endTime}`
          : v.ruleType === VOUCHER_RULES.SPECIAL_DAY
            ? '📅 Special Day'
            : v.ruleType === VOUCHER_RULES.SET_MENU_QTY
              ? `🍽️ Min ${v.minQuantity} সেট`
              : '🎁 সবার জন্য',
    }))
}
