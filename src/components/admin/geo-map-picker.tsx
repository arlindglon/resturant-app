'use client'

// NOTE: top-level CSS import is SSR-safe (style is extracted by the bundler),
// but the leaflet RUNTIME must never be imported statically — it touches
// `window` at module scope and would crash Next.js prerendering. It is loaded
// dynamically inside the init effect below.

import 'leaflet/dist/leaflet.css'

import type { Circle, LeafletMouseEvent, Map as LeafletMap, Marker } from 'leaflet'
import { useEffect, useRef, useState } from 'react'

export interface GeoMapPickerProps {
  /** restaurant pin latitude (null = not pinned yet) */
  lat: number | null
  /** restaurant pin longitude (null = not pinned yet) */
  lng: number | null
  /** allowed circle radius in meters (live-updates) */
  radiusM: number
  /** fires on map click + marker dragend */
  onPinChange?: (lat: number, lng: number) => void
  className?: string
}

type LeafletModule = typeof import('leaflet')

const DHAKA_DEFAULT: [number, number] = [23.8103, 90.4125]

// Custom teardrop pin (amber #d97706 + white inner dot). The default Leaflet
// marker icon is NOT used — its image assets 404 inside bundlers.
const PIN_SVG = `<svg width="30" height="42" viewBox="0 0 30 42" xmlns="http://www.w3.org/2000/svg" style="filter:drop-shadow(0 3px 3px rgba(0,0,0,0.35));"><path d="M15 0C6.716 0 0 6.716 0 15c0 10.828 12.211 23.872 13.615 25.332a2 2 0 0 0 2.77 0C17.789 38.872 30 25.828 30 15 30 6.716 23.284 0 15 0z" fill="#d97706"/><circle cx="15" cy="15" r="6.5" fill="#ffffff"/></svg>`

export function GeoMapPicker({
  lat,
  lng,
  radiusM,
  onPinChange,
  className = 'h-72 w-full sm:h-80',
}: GeoMapPickerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const leafletRef = useRef<LeafletModule | null>(null)
  const mapRef = useRef<LeafletMap | null>(null)
  const markerRef = useRef<Marker | null>(null)
  const circleRef = useRef<Circle | null>(null)
  // last coordinate THIS component emitted (click/drag) — lets us tell
  // internal updates apart from external ones (parent setLat/Lng button)
  const lastEmittedRef = useRef<{ lat: number; lng: number } | null>(null)

  // latest-callback ref: handlers stay stable and always invoke the freshest
  // onPinChange without needing to re-bind leaflet listeners
  const onPinChangeRef = useRef(onPinChange)
  onPinChangeRef.current = onPinChange

  const [ready, setReady] = useState(false)

  // ── init once ────────────────────────────────────────────────────────────
  // SSR-safe (dynamic import + window guard) and strict-mode safe: cleanup
  // nulls every ref so a re-mount re-initializes cleanly.
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (mapRef.current) return

    let cancelled = false
    let sizeTimer: ReturnType<typeof setTimeout> | undefined

    const init = async () => {
      const mod = await import('leaflet')
      // bundler CJS interop puts the L namespace on `.default`; fall back for ESM builds
      const L: LeafletModule = (mod as { default?: LeafletModule }).default ?? mod
      if (cancelled || !containerRef.current || mapRef.current) return
      leafletRef.current = L

      const map = L.map(containerRef.current, {
        center: lat != null && lng != null ? [lat, lng] : DHAKA_DEFAULT,
        zoom: lat != null && lng != null ? 16 : 12,
      })
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19,
      }).addTo(map)

      map.on('click', (e: LeafletMouseEvent) => {
        lastEmittedRef.current = { lat: e.latlng.lat, lng: e.latlng.lng }
        onPinChangeRef.current?.(e.latlng.lat, e.latlng.lng)
      })

      mapRef.current = map
      setReady(true)

      // container may size late (tabs / layout shift) — recalc shortly after init
      sizeTimer = setTimeout(() => map.invalidateSize(), 200)
    }
    void init()

    return () => {
      cancelled = true
      if (sizeTimer !== undefined) clearTimeout(sizeTimer)
      mapRef.current?.remove()
      mapRef.current = null
      leafletRef.current = null
      markerRef.current = null
      circleRef.current = null
    }
    // init-once: only the INITIAL pin is read here; later pin changes are
    // synced by the effects below
  }, [])

  // ── keep marker + circle in sync with the lat/lng prop ──────────────────
  useEffect(() => {
    if (!ready) return
    const L = leafletRef.current
    const map = mapRef.current
    if (!L || !map) return

    if (lat == null || lng == null) {
      markerRef.current?.remove()
      circleRef.current?.remove()
      markerRef.current = null
      circleRef.current = null
      lastEmittedRef.current = null
      return
    }

    const pos: [number, number] = [lat, lng]

    if (!markerRef.current) {
      const marker = L.marker(pos, {
        draggable: true,
        icon: L.divIcon({
          className: 'geo-map-pin',
          html: PIN_SVG,
          iconSize: [30, 42],
          iconAnchor: [15, 42],
        }),
      }).addTo(map)
      marker.on('dragend', () => {
        const p = marker.getLatLng()
        lastEmittedRef.current = { lat: p.lat, lng: p.lng }
        onPinChangeRef.current?.(p.lat, p.lng)
      })
      markerRef.current = marker
    } else {
      markerRef.current.setLatLng(pos)
    }

    if (!circleRef.current) {
      circleRef.current = L.circle(pos, {
        radius: radiusM,
        color: '#b45309',
        weight: 2,
        fillColor: '#f59e0b',
        fillOpacity: 0.15,
      }).addTo(map)
    } else {
      circleRef.current.setLatLng(pos)
    }

    // coords changed EXTERNALLY (e.g. parent's "pin my current location"
    // button) → pan the map over to the new pin; internal echo → no pan
    const last = lastEmittedRef.current
    const internal =
      last != null && Math.abs(last.lat - lat) < 1e-6 && Math.abs(last.lng - lng) < 1e-6
    if (!internal) map.panTo(pos)
  }, [lat, lng, radiusM, ready])

  // ── live radius updates (circle is created lazily once the pin appears) ─
  useEffect(() => {
    if (!ready) return
    circleRef.current?.setRadius(radiusM)
  }, [radiusM, ready])

  const hasPin = lat != null && lng != null
  const areaKm2 = ((Math.PI * radiusM * radiusM) / 1e6).toFixed(2)

  return (
    <div className={`relative overflow-hidden rounded-xl border border-stone-200 ${className}`}>
      {/* leaflet target (sized by the absolutely-positioned inset) */}
      <div ref={containerRef} className="absolute inset-0" />

      <style
        dangerouslySetInnerHTML={{
          __html: '.leaflet-container{background:#e7e5e4;font-family:inherit;}',
        }}
      />

      {!ready ? (
        <div className="absolute inset-0 z-[1100] flex flex-col items-center justify-center gap-2 bg-stone-200">
          <div className="h-7 w-7 animate-spin rounded-full border-2 border-stone-300 border-t-stone-600" />
          <span className="text-sm font-bold text-stone-600">ম্যাপ লোড হচ্ছে…</span>
        </div>
      ) : null}

      {ready && !hasPin ? (
        <div className="pointer-events-none absolute inset-0 z-[1100] flex items-center justify-center p-4">
          <span className="rounded-full bg-white/90 px-4 py-2 text-xs font-bold text-stone-800 shadow-md backdrop-blur-sm">
            🗺️ ম্যাপে ক্লিক করে রেস্টুরেন্টের লোকেশন পিন করুন
          </span>
        </div>
      ) : null}

      {ready && hasPin ? (
        <span className="pointer-events-none absolute bottom-3 left-3 z-[1100] rounded-full bg-white/95 px-3 py-1 text-[11px] font-bold text-stone-700 shadow ring-1 ring-stone-200">
          📐 {radiusM} মিটার রেডিয়াস • এলাকা ≈ {areaKm2} কিমি²
        </span>
      ) : null}
    </div>
  )
}
