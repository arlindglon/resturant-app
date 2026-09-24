// Static knowledge-base answers — the bot's "never empty-handed" guarantee.
//
// আগে AI (Gemini) fail করলে কাস্টমার পেত "সমস্যা হচ্ছে, পরে লিখুন" জাতীয়
// লজ্জার মেসেজ — কোনো উত্তরই না। এখন AI চলে না হলেও বট ঠিক উত্তরই দেয়:
// লাইভ ডাটাবেস থেকে চলমান অফার / কুপন / হ্যাপি আওয়ার / জনপ্রিয় মেনু সাজিয়ে
// কাস্টমারের প্রশ্ন অনুযায়ী সঠিক তথ্য যায় (কোনো "system problem" টেক্সট নেই)।
//
// কীওয়ার্ড রাউটার:
//   • offer/অফার/ছাড়/coupon… → চলমান অফার + কুপন + হ্যাপি আওয়ার
//   • menu/মেনু/দাম/price/খাবার… → মেনু আইটেম + দাম
//   • অন্য কিছু → উষ্ণ সমাচার + অফারের সারসংক্ষেপ
// (এই ফাইল কখনো দুঃখপ্রকাশ করে না — হয় সঠিক তথ্য, নয় উষ্ণ আমন্ত্রণ)
import { db } from '@/lib/db'
import { usedVoucherIdsForPsid } from '@/lib/vouchers'
import { t, type BotLang } from '@/lib/bot-text'

const DISC_RE = /offer|অফার|ছাড়|discou?nt|coupon|কুপন|vau?cher|deal|promo|সেল|sale|ফ্রি|claim/i
const MENU_RE = /menu|মেনু|খাবার|khabar|price|দাম|item|খাওয়া|khaowa|food|কি আছে|কী আছে|ki ki ase|ki ase/i

export async function buildStaticReply(opts: { lang: BotLang; message: string; psid?: string }): Promise<string> {
  const msg = opts.message || ''
  const wantsOffers = DISC_RE.test(msg)
  const wantsMenu = MENU_RE.test(msg)

  const [offers, vouchers, happyHours, menuItems, excludeVoucherIds] = await Promise.all([
    db.occasionOffer.findMany({ where: { active: true }, orderBy: [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }] }),
    db.voucher.findMany({ where: { active: true }, orderBy: { createdAt: 'desc' as const }, take: 12 }),
    db.happyHour.findMany({ where: { active: true } }),
    db.menuItem.findMany({
      where: { isAvailable: true },
      orderBy: [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }],
      include: { category: { select: { name: true } } },
      take: 12,
    }),
    opts.psid ? usedVoucherIdsForPsid(opts.psid).catch(() => [] as string[]) : Promise.resolve([] as string[]),
  ])
  const liveVouchers = excludeVoucherIds.length ? vouchers.filter((v) => !excludeVoucherIds.includes(v.id)) : vouchers

  const sections: string[] = []
  const hasOffers = offers.length > 0 || liveVouchers.length > 0 || happyHours.length > 0

  if (wantsOffers || (!wantsMenu && hasOffers)) {
    const lines: string[] = [t(opts.lang, 'staticOffersHead')]
    for (const o of offers) {
      lines.push(
        t(opts.lang, 'staticOccasionLine', { emoji: o.emoji || '🎁', name: o.name, discount: o.discount, min: o.minBill })
      )
    }
    for (const v of liveVouchers) {
      const disc = v.discountType === 'PERCENT' ? `${v.discountValue}%` : `৳${v.discountValue}`
      const min = v.minOrderAmount > 0 ? t(opts.lang, 'staticMinBill', { min: v.minOrderAmount }) : ''
      lines.push(t(opts.lang, 'staticVoucherLine', { code: v.code, title: v.title, disc, min }))
    }
    for (const h of happyHours) {
      lines.push(t(opts.lang, 'staticHappyLine', { name: h.name, percent: h.discountPercent, start: h.startTime, end: h.endTime }))
    }
    lines.push(hasOffers ? t(opts.lang, 'staticOfferHowTo') : t(opts.lang, 'staticNoOffers'))
    sections.push(lines.filter(Boolean).join('\n'))
  }

  if (wantsMenu && menuItems.length) {
    const menuLines = menuItems
      .slice(0, 8)
      .map((i) => `• ${i.name}: ৳${Math.round(i.price * 100) / 100}`)
    sections.push([t(opts.lang, 'staticMenuHead'), ...menuLines, t(opts.lang, 'staticMoreMenu')].join('\n'))
  }

  if (!sections.length) {
    // কিছুই ম্যাচ হয়নি → উষ্ণ সমাচার + যা আছে তার সারসংক্ষেপ
    sections.push(t(opts.lang, 'staticGreetBack'))
    if (hasOffers) sections.push(t(opts.lang, 'staticOfferHowTo'))
  }

  sections.push(t(opts.lang, 'staticBye'))
  return sections.filter(Boolean).join('\n\n')
}
