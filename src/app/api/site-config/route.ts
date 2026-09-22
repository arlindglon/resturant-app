// GET /api/site-config — public site configuration (safe fields only)
import { ok } from '@/lib/api'
import { getSetting } from '@/lib/settings'
import { SETTING_KEYS } from '@/lib/constants'

export const dynamic = 'force-dynamic'

export async function GET() {
  const [
    staffLinks,
    restaurantName,
    logoUrl,
    titleSuffix,
    receiptSubtitle,
    receiptThanks,
    poweredBy,
    developerEnabled,
    developerText,
    developerLink,
    specialNoteEnabled,
    geoEnabled,
    geoLat,
    geoLng,
    geoRadius,
  ] = await Promise.all([
    getSetting(SETTING_KEYS.STAFF_LINKS_ENABLED),
    getSetting(SETTING_KEYS.RESTAURANT_NAME),
    getSetting(SETTING_KEYS.RESTAURANT_LOGO_URL),
    getSetting(SETTING_KEYS.TITLE_SUFFIX),
    getSetting(SETTING_KEYS.RECEIPT_SUBTITLE),
    getSetting(SETTING_KEYS.RECEIPT_THANKS),
    getSetting(SETTING_KEYS.POWERED_BY),
    getSetting(SETTING_KEYS.DEVELOPER_NOTE_ENABLED),
    getSetting(SETTING_KEYS.DEVELOPER_NOTE_TEXT),
    getSetting(SETTING_KEYS.DEVELOPER_NOTE_LINK),
    getSetting(SETTING_KEYS.ITEM_SPECIAL_NOTE_ENABLED),
    getSetting(SETTING_KEYS.GEO_FENCE_ENABLED),
    getSetting(SETTING_KEYS.GEO_LAT),
    getSetting(SETTING_KEYS.GEO_LNG),
    getSetting(SETTING_KEYS.GEO_RADIUS_METERS),
  ])

  const lat = parseFloat(geoLat || '')
  const lng = parseFloat(geoLng || '')

  return ok(
    {
      staffLinksEnabled: staffLinks !== 'false',
      restaurantName,
      logoUrl,
      titleSuffix: titleSuffix || 'Smart Restaurant System',
      receiptSubtitle: receiptSubtitle || 'ডিজিটাল রসিদ',
      receiptThanks: receiptThanks || 'ধন্যবাদ! আবার আসবেন 🙏',
      poweredBy: poweredBy ?? 'Powered by Smart QR',
      developerNote: {
        enabled: developerEnabled !== 'false',
        text: developerText || '',
        link: developerLink || '',
      },
      specialNoteEnabled: specialNoteEnabled !== 'false',
      geoFence: {
        enabled: geoEnabled === 'true',
        lat: isNaN(lat) ? null : lat,
        lng: isNaN(lng) ? null : lng,
        radiusMeters: parseInt(geoRadius || '200', 10) || 200,
      },
    },
    200,
    { 'Cache-Control': 'public, s-maxage=10, stale-while-revalidate=30' }
  )
}
