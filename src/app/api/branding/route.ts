// GET /api/branding — public restaurant identity (name + logo) + developer note.
// Every customer-facing page reads this so admin changes propagate everywhere.
import { db } from '@/lib/db'
import { ok } from '@/lib/api'
import { SETTING_KEYS, SETTING_DEFAULTS } from '@/lib/constants'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    // PERFORMANCE: ৬টা আলাদা সেটিং কলের বদলে এক কুয়েরিতে সব (১ RTT) —
    // প্রতিটা কাস্টমার পেজ-লোডে এই এন্ডপয়েন্ট হিট করে, তাই ফ্রেশ পড়াই রাখা হয়
    const rows = await db.setting.findMany({
      where: {
        key: {
          in: [
            SETTING_KEYS.RESTAURANT_NAME,
            SETTING_KEYS.RESTAURANT_LOGO_URL,
            SETTING_KEYS.DEVELOPER_NOTE_ENABLED,
            SETTING_KEYS.DEVELOPER_NOTE_TEXT,
            SETTING_KEYS.DEVELOPER_NOTE_LINK,
            SETTING_KEYS.HOME_LINKS_ENABLED,
          ],
        },
      },
      select: { key: true, value: true },
    })
    const s = new Map(rows.map((r) => [r.key, r.value]))
    const g = (key: string) => s.get(key) ?? ''
    const name = g(SETTING_KEYS.RESTAURANT_NAME)
    return ok(
      {
        name: name || SETTING_DEFAULTS[SETTING_KEYS.RESTAURANT_NAME] || 'Smart QR Restaurant',
        logoUrl: g(SETTING_KEYS.RESTAURANT_LOGO_URL),
        devNote: {
          enabled: g(SETTING_KEYS.DEVELOPER_NOTE_ENABLED) !== 'false',
          text: g(SETTING_KEYS.DEVELOPER_NOTE_TEXT),
          link: g(SETTING_KEYS.DEVELOPER_NOTE_LINK),
        },
        homeLinks: g(SETTING_KEYS.HOME_LINKS_ENABLED) !== 'false',
      },
      200,
      { 'Cache-Control': 'public, s-maxage=10, stale-while-revalidate=30' }
    )
  } catch {
    return ok({
      name: SETTING_DEFAULTS[SETTING_KEYS.RESTAURANT_NAME] || 'Smart QR Restaurant',
      logoUrl: '',
      devNote: { enabled: true, text: '', link: '' },
      homeLinks: true,
    })
  }
}
