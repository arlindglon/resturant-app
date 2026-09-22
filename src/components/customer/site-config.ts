'use client'

// Shared customer-side site-config hook with module-level cache.
// One fetch per browser session, shared across menu / scan / cart / bill / home.

import { useEffect, useState } from 'react'

import { api } from '@/lib/client'

export interface SiteConfig {
  staffLinksEnabled: boolean
  restaurantName: string
  logoUrl: string | null
  titleSuffix: string
  receiptSubtitle: string
  receiptThanks: string
  developerNote: { enabled: boolean; text: string; link: string }
  specialNoteEnabled: boolean
  geoFence: { enabled: boolean; lat: number; lng: number; radiusMeters: number }
}

let cached: SiteConfig | null = null
let inflight: Promise<SiteConfig | null> | null = null

export function fetchSiteConfig(): Promise<SiteConfig | null> {
  if (cached) return Promise.resolve(cached)
  if (!inflight) {
    inflight = api
      .get<SiteConfig>('/api/site-config')
      .then((res) => {
        if (res.ok && res.data) {
          cached = res.data
          return cached
        }
        inflight = null
        return null
      })
      .catch(() => {
        inflight = null
        return null
      })
  }
  return inflight
}

/** Returns the config (null until loaded); cached after the first fetch. */
export function useSiteConfig(): SiteConfig | null {
  const [cfg, setCfg] = useState<SiteConfig | null>(cached)

  useEffect(() => {
    let alive = true
    // resolves instantly from cache when available (same value → React bails out)
    fetchSiteConfig().then((c) => {
      if (alive && c) setCfg(c)
    })
    return () => {
      alive = false
    }
  }, [])

  return cfg
}

/* ───────────── geo coordinates carried from scan → order placement ───────────── */

const GEO_KEY = 'qr_scan_geo'

export interface ScanGeo {
  lat: number
  lng: number
  ts: number
}

export function saveScanGeo(lat: number, lng: number) {
  try {
    sessionStorage.setItem(GEO_KEY, JSON.stringify({ lat, lng, ts: Date.now() }))
  } catch {
    /* storage unavailable */
  }
}

/** Coordinates captured during the table scan (used to satisfy order-time geo fence). */
export function getScanGeo(): ScanGeo | null {
  try {
    const raw = sessionStorage.getItem(GEO_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as ScanGeo
    if (typeof parsed.lat !== 'number' || typeof parsed.lng !== 'number') return null
    return parsed
  } catch {
    return null
  }
}

/** Browser geolocation as a promise (8s timeout, high accuracy). */
export function requestGeo(timeoutMs = 8000): Promise<{ lat: number; lng: number }> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new Error('GEO_UNSUPPORTED'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => reject(new Error(err.code === 1 ? 'GEO_DENIED' : 'GEO_UNAVAILABLE')),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30000 }
    )
  })
}
