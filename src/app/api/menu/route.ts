// GET /api/menu — public menu with happy-hour pricing pre-computed
// PERFORMANCE: one rules query total (was 1 query PER ITEM — N+1), plus a
// 15s in-memory cache + CDN s-maxage so repeat hits return instantly.
import { db } from '@/lib/db'
import { ok } from '@/lib/api'
import { parseJSON } from '@/lib/api'
import { loadActiveRules, bestHappyHourForItem, bestBannerText } from '@/lib/happyhour'

const CACHE_TTL_MS = 15_000
let cache: { ts: number; payload: unknown } | null = null

export async function GET() {
  if (cache && Date.now() - cache.ts < CACHE_TTL_MS) {
    return ok(cache.payload, 200, { 'Cache-Control': 'public, s-maxage=15, stale-while-revalidate=60' })
  }

  const [categories, rules] = await Promise.all([
    db.category.findMany({
      where: { active: true },
      orderBy: { sortOrder: 'asc' },
      include: {
        items: {
          orderBy: { sortOrder: 'asc' },
        },
      },
    }),
    loadActiveRules(),
  ])

  const now = new Date()
  const data = categories.map((c) => ({
    id: c.id,
    name: c.name,
    imageUrl: c.imageUrl,
    items: c.items.map((i) => {
      const happy = i.isAvailable ? bestHappyHourForItem(rules, i.id, i.price, now) : null
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
    }),
  }))

  const payload = { categories: data, happyHourBanner: bestBannerText(rules, now) }
  cache = { ts: Date.now(), payload }
  return ok(payload, 200, { 'Cache-Control': 'public, s-maxage=15, stale-while-revalidate=60' })
}
