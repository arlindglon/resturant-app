// ============================================================
// Geofence — restaurant area enforcement.
// If the admin pins a location + radius and enables the fence,
// table scan / order placement is BLOCKED from outside the circle.
// ============================================================
import { getSetting, getSettingNumber } from '@/lib/settings'
import { SETTING_KEYS } from '@/lib/constants'

export interface GeoFenceConfig {
  enabled: boolean
  lat: number | null
  lng: number | null
  radiusMeters: number
}

export interface GeoPoint {
  lat: number
  lng: number
}

export async function getGeoFenceConfig(): Promise<GeoFenceConfig> {
  const [enabled, latS, lngS, radius] = await Promise.all([
    getSetting(SETTING_KEYS.GEO_FENCE_ENABLED),
    getSetting(SETTING_KEYS.GEO_LAT),
    getSetting(SETTING_KEYS.GEO_LNG),
    getSettingNumber(SETTING_KEYS.GEO_RADIUS_METERS, 200),
  ])
  const lat = parseFloat(latS || '')
  const lng = parseFloat(lngS || '')
  return {
    enabled: enabled === 'true',
    lat: isNaN(lat) ? null : lat,
    lng: isNaN(lng) ? null : lng,
    radiusMeters: Math.max(20, Math.min(100000, radius || 200)),
  }
}

/** Haversine distance in meters */
export function distanceMeters(a: GeoPoint, b: GeoPoint): number {
  const R = 6371000
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const lat1 = (a.lat * Math.PI) / 180
  const lat2 = (b.lat * Math.PI) / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

export type GeoCheckResult =
  | { allowed: true; distance: number | null }
  | { allowed: false; code: 'GEO_REQUIRED' | 'GEO_OUTSIDE' | 'GEO_NOT_CONFIGURED'; distance?: number; message: string }

/**
 * Validate a customer's coordinates against the configured fence.
 * Pass undefined coords when the client couldn't provide them.
 */
export async function checkGeoFence(coords?: { lat?: number; lng?: number }): Promise<GeoCheckResult> {
  const cfg = await getGeoFenceConfig()
  if (!cfg.enabled) return { allowed: true, distance: null }
  if (cfg.lat === null || cfg.lng === null) return { allowed: true, distance: null }

  const lat = typeof coords?.lat === 'number' ? coords.lat : NaN
  const lng = typeof coords?.lng === 'number' ? coords.lng : NaN

  if (isNaN(lat) || isNaN(lng) || (lat === 0 && lng === 0)) {
    return {
      allowed: false,
      code: 'GEO_REQUIRED',
      message: '📍 অনুগ্রহ করে আপনার লোকেশন শেয়ার করুন — রেস্টুরেন্টের এলাকার ভেতরে বসে অর্ডার করা যাবে।',
    }
  }

  const distance = Math.round(distanceMeters({ lat, lng }, { lat: cfg.lat, lng: cfg.lng }))
  if (distance > cfg.radiusMeters) {
    return {
      allowed: false,
      code: 'GEO_OUTSIDE',
      distance,
      message: `🚫 আপনি রেস্টুরেন্টের এলাকার বাইরে আছেন (প্রায় ${Math.round(distance / 10) * 10} মিটার দূরে)। এলাকার ভেতরে বসে টেবিল স্ক্যান বা অর্ডার করুন।`,
    }
  }
  return { allowed: true, distance }
}
