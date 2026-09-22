// ============================================================
// Geo-Fence Security — customers may only scan/use tables while
// physically inside the restaurant's pinned circle area.
// - Admin pins lat/lng + radius (meters) in the admin panel
// - /api/scan and /api/orders call checkGeofence() with the
//   device's browser GPS coords; outside → 403 (Bengali message)
// - Fence OFF or no pin set → always allowed
// ============================================================
import { getSettingFresh } from '@/lib/settings'
import { SETTING_KEYS } from '@/lib/constants'

export interface GeoCoords {
  lat?: number
  lng?: number
  acc?: number // GPS accuracy in meters (browser gives this)
}

export interface GeoCheckResult {
  ok: boolean
  code?: 'GEO_REQUIRED' | 'GEO_OUTSIDE'
  error?: string
  distance?: number
}

/** Great-circle distance between two points, in meters (Haversine). */
export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

export async function checkGeofence(coords?: GeoCoords): Promise<GeoCheckResult> {
  // FRESH reads (no cache) — toggling the fence or moving the pin must take
  // effect immediately, not up to 30s later.
  const enabled = (await getSettingFresh(SETTING_KEYS.GEO_FENCE_ENABLED)) !== 'false'
  if (!enabled) return { ok: true }

  const pinLat = parseFloat(await getSettingFresh(SETTING_KEYS.GEO_LAT))
  const pinLng = parseFloat(await getSettingFresh(SETTING_KEYS.GEO_LNG))
  // no pin saved yet → nothing to enforce (admin must pin first)
  if (isNaN(pinLat) || isNaN(pinLng)) return { ok: true }

  const lat = typeof coords?.lat === 'number' ? coords.lat : NaN
  const lng = typeof coords?.lng === 'number' ? coords.lng : NaN
  if (isNaN(lat) || isNaN(lng)) {
    return {
      ok: false,
      code: 'GEO_REQUIRED',
      error:
        '📍 লোকেশন পাওয়া যায়নি — রেস্টুরেন্টের এলাকা ভেরিফাই করতে ব্রাউজারে লোকেশন পারমিশন চালু করে আবার চেষ্টা করুন।',
    }
  }

  const radius = parseFloat(await getSettingFresh(SETTING_KEYS.GEO_RADIUS_METERS))
  const radiusSafe = isNaN(radius) || radius <= 0 ? 200 : radius
  // forgive weak GPS: allow up to `accuracy` meters of slack (capped 300m)
  const acc =
    typeof coords?.acc === 'number' && coords.acc > 0 ? Math.min(Math.round(coords.acc), 300) : 0
  const distance = Math.round(haversineMeters(lat, lng, pinLat, pinLng))

  if (distance > radiusSafe + acc) {
    return {
      ok: false,
      code: 'GEO_OUTSIDE',
      distance,
      error: `📍 দুঃখিত — আপনি রেস্টুরেন্টের এলাকার বাইরে আছেন (প্রায় ${Math.round(distance / 10) * 10} মিটার দূরে)। টেবিলে বসে QR স্ক্যান করুন।`,
    }
  }

  return { ok: true, distance }
}
