// 📊 ডেইলি অটো রিপোর্ট (WhatsApp) — admin/owner/partner-দের জন্য
// ট্রান্সপোর্ট: CallMeBot (ফ্রি, কোনো Meta ডকুমেন্ট/রিভিউ লাগে না) —
// প্রতি রিসিপিয়েন্ট একবার তাদের বটকে মেসেজ দিয়ে নিজের API key নেয় (admin-এ গাইড আছে)।
import { db } from '@/lib/db'
import { getSetting, setSettings } from '@/lib/settings'
import { SETTING_KEYS, taka, ORDER_STATUS } from '@/lib/constants'
import { toBn } from '@/lib/bn'

export interface WaRecipient {
  label: string
  phone: string // দেশের কোডসহ (8801XXXXXXXXX) — CallMeBot ফরম্যাট, +/স্পেস ছাড়া
  apiKey: string
}

/** রিসিপিয়েন্ট-লিস্ট পার্স+ভ্যালিডেশন — ভাঙা এন্ট্রি বাদ, ≤১০ জন, ফোন ডিজিট-নরমালাইজ */
export function parseWaRecipients(raw: string): WaRecipient[] {
  if (!raw || !raw.trim()) return []
  let arr: unknown
  try {
    arr = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(arr)) return []
  const out: WaRecipient[] = []
  for (const it of arr) {
    if (!it || typeof it !== 'object') continue
    const o = it as Record<string, unknown>
    const label = String(o.label ?? '').trim().slice(0, 30)
    let phone = String(o.phone ?? '').replace(/[^0-9]/g, '')
    const apiKey = String(o.apiKey ?? '').trim().slice(0, 64)
    if (phone.startsWith('0') && phone.length >= 10) phone = `880${phone.replace(/^0+/, '')}`
    if (!phone || phone.length < 8 || phone.length > 15 || !apiKey) continue
    out.push({ label: label || 'প্রাপক', phone, apiKey })
    if (out.length >= 10) break
  }
  return out
}

/** CallMeBot-এ WhatsApp পাঠানো — GET whatsapp.php?phone&text&apikey */
export async function sendWhatsAppCallMeBot(recipient: WaRecipient, text: string): Promise<{ ok: boolean; info: string }> {
  try {
    const url = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(recipient.phone)}&text=${encodeURIComponent(text)}&apikey=${encodeURIComponent(recipient.apiKey)}`
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
    const body = (await res.text().catch(() => '')).slice(0, 200)
    if (res.ok) return { ok: true, info: 'queued' }
    return { ok: false, info: `HTTP ${res.status} ${body}` }
  } catch (err) {
    return { ok: false, info: (err as Error)?.message?.slice(0, 120) || 'নেটওয়ার্ক ব্যর্থ' }
  }
}

/** আজ (Asia/Dhaka) = "YYYY-MM-DD" */
export function dhakaToday(now = new Date()): string {
  return now.toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' })
}

function dhakaDayLabel(now = new Date()): string {
  const s = now.toLocaleDateString('bn-BD', { timeZone: 'Asia/Dhaka', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  return s
}

/** আজকের রিপোর্ট টেক্সট বানানো (DB থেকে — লাইভ সংখ্যা) */
export async function buildDailyReport(now = new Date()): Promise<string> {
  const name = (await getSetting(SETTING_KEYS.RESTAURANT_NAME))?.trim() || 'Smart QR Restaurant'
  const cur = (await getSetting(SETTING_KEYS.CURRENCY))?.trim() || '৳'
  const start = new Date(`${dhakaToday(now)}T00:00:00+06:00`)

  const [ordersToday, unpaidAgg, occupiedTables, pendingCalls, newCustomers, topItems] = await Promise.all([
    db.order.findMany({
      where: { placedAt: { gte: start }, status: { not: ORDER_STATUS.CANCELLED } },
      select: { total: true, billPaid: true, paymentMethod: true, voucherDiscount: true, happyHourDiscount: true, birthdayDiscount: true, tableNumber: true },
    }),
    db.order.aggregate({ where: { placedAt: { gte: start }, billPaid: false, status: { not: ORDER_STATUS.CANCELLED } }, _sum: { total: true } }),
    db.restaurantTable.count({ where: { status: 'OCCUPIED' } }),
    db.waiterCall.count({ where: { status: 'PENDING' } }),
    db.customer.count({ where: { createdAt: { gte: start } } }),
    db.orderItem.groupBy({
      by: ['itemName'],
      where: { order: { placedAt: { gte: start }, status: { not: ORDER_STATUS.CANCELLED } } },
      _sum: { quantity: true },
      orderBy: { _sum: { quantity: 'desc' } },
      take: 5,
    }),
  ])

  const totalSales = ordersToday.reduce((s, o) => s + o.total, 0)
  const discounts = ordersToday.reduce((s, o) => s + o.voucherDiscount + o.happyHourDiscount + o.birthdayDiscount, 0)
  const paid = ordersToday.filter((o) => o.billPaid)
  const paidTotal = paid.reduce((s, o) => s + o.total, 0)
  const byMethod = new Map<string, number>()
  for (const o of paid) {
    const m = o.paymentMethod || 'অন্যান্য'
    byMethod.set(m, (byMethod.get(m) || 0) + o.total)
  }
  const methodLine = [...byMethod.entries()].map(([m, v]) => `${m === 'CASH' ? 'নগদ' : m === 'BKASH' ? 'বিকাশ' : m === 'NAGAD' ? 'নগদ(ন্যাগাদ)' : m === 'CARD' ? 'কার্ড' : m} ${toBn(taka(v))}`).join(' · ')
  const topLine = topItems.map((t) => `${t.itemName} (${toBn(t._sum.quantity || 0)})`).join(', ')

  const L: string[] = []
  L.push(`📊 *${name}* — আজকের রিপোর্ট`)
  L.push(`📅 ${dhakaDayLabel(now)}`)
  L.push('')
  L.push(`🧾 মোট অর্ডার: *${toBn(ordersToday.length)}* টা`)
  L.push(`💰 মোট বিক্রি: *${cur}${toBn(totalSales.toFixed(totalSales % 1 === 0 ? 0 : 2))}*`)
  if (discounts > 0) L.push(`🎁 ডিসকাউন্ট দেওয়া হয়েছে: ${toBn(taka(discounts))}`)
  if (methodLine) L.push(`💳 বিল পেমেন্ট: ${methodLine}`)
  L.push(`🏦 কালেক্টেড: ${toBn(taka(paidTotal))}${unpaidAgg._sum.total ? ` · এখনো বাকি (খোলা বিল): ${toBn(taka(unpaidAgg._sum.total))}` : ''}`)
  if (topLine) L.push(`🏆 টপ আইটেম: ${topLine}`)
  L.push(`🪑 এখন ব্যস্ত টেবিল: ${toBn(occupiedTables)} · ⏳ অপেক্ষমাণ ওয়েটার-কল: ${toBn(pendingCalls)}`)
  L.push(`👥 আজকের নতুন কাস্টমার: ${toBn(newCustomers)} জন`)
  L.push('')
  L.push('শুভ রাত্রি — কাল আবার রিপোর্ট আসবে 🌙')
  return L.join('\n')
}

export interface DailyReportResult {
  skipped: boolean
  reason?: string
  total: number
  sent: number
  failed: number
  details: { label: string; phoneMasked: string; ok: boolean; info: string }[]
  preview?: string
}

/** দিনে একবার (idempotent) — cron বা manual "এখনই পাঠান" (force: true) */
export async function runDailyReport(opts?: { force?: boolean; now?: Date }): Promise<DailyReportResult> {
  const now = opts?.now ?? new Date()
  const enabled = (await getSetting(SETTING_KEYS.WA_REPORT_ENABLED)).trim() !== 'false'
  const recipients = parseWaRecipients(await getSetting(SETTING_KEYS.WA_REPORT_RECIPIENTS))
  const today = dhakaToday(now)

  if (!recipients.length) {
    const preview = await buildDailyReport(now)
    return { skipped: true, reason: 'কোনো প্রাপক (WhatsApp নম্বর + API key) যোগ করা হয়নি — admin-এর সেটিংস ট্যাবে যোগ করুন।', total: 0, sent: 0, failed: 0, details: [], preview }
  }
  if (!enabled && !opts?.force) {
    return { skipped: true, reason: 'ডেইলি রিপোর্ট বন্ধ আছে (সেটিংস ট্যাব থেকে চালু করুন)।', total: 0, sent: 0, failed: 0, details: [] }
  }
  if (!opts?.force && (await getSetting(SETTING_KEYS.WA_REPORT_LAST_DATE)).trim() === today) {
    return { skipped: true, reason: `আজ (${today}) এর রিপোর্ট আগেই পাঠানো হয়েছে — দিনে একবারই যায়।`, total: 0, sent: 0, failed: 0, details: [] }
  }

  const text = await buildDailyReport(now)
  const details: DailyReportResult['details'] = []
  let sent = 0
  for (const r of recipients) {
    const res = await sendWhatsAppCallMeBot(r, text)
    if (res.ok) sent++
    details.push({ label: r.label, phoneMasked: r.phone.slice(0, 5) + '…' + r.phone.slice(-3), ok: res.ok, info: res.info })
  }
  const summary = `${now.toISOString()} — ${sent}/${recipients.length} পাঠানো গেছে${sent < recipients.length ? ` (ব্যর্থ: ${details.filter((d) => !d.ok).map((d) => `${d.label}: ${d.info}`).join('; ').slice(0, 200)})` : ''}`
  await setSettings({ [SETTING_KEYS.WA_REPORT_LAST_DATE]: today, [SETTING_KEYS.WA_REPORT_LAST_RESULT]: summary })
  return { skipped: false, total: recipients.length, sent, failed: recipients.length - sent, details }
}
