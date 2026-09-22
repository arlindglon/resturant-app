// GET /api/occasions — public: active occasion offers + special note + master switch
// (consumed by the customer bill page)
import { db } from '@/lib/db'
import { ok } from '@/lib/api'
import { ensureDefaultOccasions, isOfferMasterEnabled, getSpecialNote, toOccasionDTO } from '@/lib/occasions'

export async function GET() {
  await ensureDefaultOccasions()
  const [offers, masterEnabled, specialNote] = await Promise.all([
    db.occasionOffer.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    }),
    isOfferMasterEnabled(),
    getSpecialNote(),
  ])
  return ok({
    masterEnabled,
    specialNote,
    occasions: offers.map(toOccasionDTO),
  })
}
