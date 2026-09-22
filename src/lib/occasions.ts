// Occasion offer engine — birthday / wedding anniversary / custom CRM campaigns
// Replaces the hard-coded "birthday only" offer with admin-managed occasions.
import { db } from '@/lib/db'
import { getSetting, getSettingNumber } from '@/lib/settings'
import { SETTING_KEYS } from '@/lib/constants'

export interface OccasionOfferDTO {
  id: string
  name: string
  emoji: string
  dateLabel: string
  description: string | null
  discount: number
  minBill: number
  active: boolean
  sortOrder: number
}

export function toOccasionDTO(o: {
  id: string
  name: string
  emoji: string
  dateLabel: string
  description: string | null
  discount: number
  minBill: number
  active: boolean
  sortOrder: number
}): OccasionOfferDTO {
  return {
    id: o.id,
    name: o.name,
    emoji: o.emoji,
    dateLabel: o.dateLabel,
    description: o.description,
    discount: o.discount,
    minBill: o.minBill,
    active: o.active,
    sortOrder: o.sortOrder,
  }
}

let seededInThisInstance = false

/**
 * Idempotent auto-seed: the very first time the occasions table is empty we
 * create a default "জন্মদিন" offer from the legacy birthday settings, plus a
 * "বিয়ের বার্ষিকী" example the restaurant can edit or delete.
 */
export async function ensureDefaultOccasions(): Promise<void> {
  if (seededInThisInstance) return
  try {
    const count = await db.occasionOffer.count()
    if (count === 0) {
      const discount = await getSettingNumber(SETTING_KEYS.BIRTHDAY_DISCOUNT_AMOUNT, 50)
      const minBill = await getSettingNumber(SETTING_KEYS.BIRTHDAY_MIN_BILL, 500)
      await db.occasionOffer.createMany({
        data: [
          {
            name: 'জন্মদিন',
            emoji: '🎂',
            dateLabel: 'আপনার জন্মদিন',
            description: 'আপনার বিশেষ দিনে বিলের উপর ইনস্ট্যান্ট ছাড়!',
            discount,
            minBill,
            sortOrder: 0,
          },
          {
            name: 'বিয়ের বার্ষিকী',
            emoji: '💍',
            dateLabel: 'বিয়ের বার্ষিকীর তারিখ',
            description: 'আপনার প্রিয়জনের সাথে বিশেষ মুহূর্ত উদযাপন করুন!',
            discount: 100,
            minBill: 1000,
            sortOrder: 1,
          },
        ],
      })
    }
    seededInThisInstance = true
  } catch {
    // never break the caller for seeding issues
  }
}

export async function isOfferMasterEnabled(): Promise<boolean> {
  return (await getSetting(SETTING_KEYS.OFFER_MASTER_ENABLED)) !== 'false'
}

export interface SpecialNoteDTO {
  enabled: boolean
  text: string
}

export async function getSpecialNote(): Promise<SpecialNoteDTO> {
  const [enabled, text] = await Promise.all([
    getSetting(SETTING_KEYS.OFFER_SPECIAL_NOTE_ENABLED),
    getSetting(SETTING_KEYS.OFFER_SPECIAL_NOTE),
  ])
  return { enabled: enabled === 'true', text: text || '' }
}
