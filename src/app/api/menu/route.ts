// GET /api/menu — public menu with happy-hour pricing pre-computed
import { db } from '@/lib/db'
import { ok } from '@/lib/api'
import { parseJSON } from '@/lib/api'
import { getActiveHappyHourForItem, getLiveHappyHourBanner } from '@/lib/happyhour'

export async function GET() {
  const [categories, banner] = await Promise.all([
    db.category.findMany({
      where: { active: true },
      orderBy: { sortOrder: 'asc' },
      include: {
        items: {
          orderBy: { sortOrder: 'asc' },
        },
      },
    }),
    getLiveHappyHourBanner(),
  ])

  const now = new Date()
  const data = await Promise.all(
    categories.map(async (c) => ({
      id: c.id,
      name: c.name,
      imageUrl: c.imageUrl,
      items: await Promise.all(
        c.items.map(async (i) => {
          const happy = i.isAvailable ? await getActiveHappyHourForItem(i.id, i.price, now) : null
          return {
            id: i.id,
            name: i.name,
            description: i.description,
            basePrice: i.price,
            price: happy ? happy.finalPrice : i.price,
            imageUrl: i.imageUrl,
            isAvailable: i.isAvailable,
            isSetMenu: i.isSetMenu,
            spiceLevels: parseJSON<string[]>(i.spiceLevels, []),
            addons: parseJSON<{ name: string; price: number }[]>(i.addons, []),
            upsellIds: parseJSON<string[]>(i.upsellIds, []),
            happyHour: happy ? { active: true, percent: happy.percent, name: happy.name } : null,
          }
        })
      ),
    }))
  )

  return ok({ categories: data, happyHourBanner: banner })
}
