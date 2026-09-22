// GET /api/branding — public restaurant identity (name + logo) + developer note.
// Every customer-facing page reads this so admin changes propagate everywhere.
import { ok } from '@/lib/api'
import { getSettingFresh } from '@/lib/settings'
import { SETTING_KEYS, SETTING_DEFAULTS } from '@/lib/constants'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const [name, logoUrl, devEnabled, devText, devLink, homeLinks] = await Promise.all([
      getSettingFresh(SETTING_KEYS.RESTAURANT_NAME),
      getSettingFresh(SETTING_KEYS.RESTAURANT_LOGO_URL),
      getSettingFresh(SETTING_KEYS.DEVELOPER_NOTE_ENABLED),
      getSettingFresh(SETTING_KEYS.DEVELOPER_NOTE_TEXT),
      getSettingFresh(SETTING_KEYS.DEVELOPER_NOTE_LINK),
      getSettingFresh(SETTING_KEYS.HOME_LINKS_ENABLED),
    ])
    return ok({
      name: name || SETTING_DEFAULTS[SETTING_KEYS.RESTAURANT_NAME] || 'Smart QR Restaurant',
      logoUrl: logoUrl || '',
      devNote: {
        enabled: devEnabled !== 'false',
        text: devText || '',
        link: devLink || '',
      },
      homeLinks: homeLinks !== 'false',
    })
  } catch {
    return ok({
      name: SETTING_DEFAULTS[SETTING_KEYS.RESTAURANT_NAME] || 'Smart QR Restaurant',
      logoUrl: '',
      devNote: { enabled: true, text: '', link: '' },
      homeLinks: true,
    })
  }
}
