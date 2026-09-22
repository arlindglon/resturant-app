'use client'

// useBranding() — restaurant name + logo + developer note + home links toggle.
// External store (module singleton) + useSyncExternalStore:
// - SSR/hydration renders the default → no mismatch
// - client revalidates /api/branding on every mount (throttled) so an
//   admin rename/logo upload propagates everywhere on the next navigation
import { useSyncExternalStore } from 'react'

export interface DeveloperNote {
  enabled: boolean
  text: string
  link: string
}

export interface Branding {
  name: string
  logoUrl: string
  devNote: DeveloperNote
  homeLinks: boolean // ল্যান্ডিং পেজে "কিচেন ডিসপ্লে • অ্যাডমিন প্যানেল" লিঙ্ক দেখাবে কি না
}

export const DEFAULT_BRANDING: Branding = {
  name: 'Smart QR Restaurant',
  logoUrl: '',
  devNote: { enabled: true, text: '', link: '' },
  homeLinks: true,
}

const LS_KEY = 'qr_branding_v4' // v4: drops stale "Spice Garden" caches from older visits
const REVALIDATE_MS = 5_000 // max one network hit per 5s across all pages

let snapshot: Branding = DEFAULT_BRANDING
const listeners = new Set<() => void>()
let lastFetch = 0

function normalize(d: {
  name?: string
  logoUrl?: string
  devNote?: Partial<DeveloperNote>
  homeLinks?: boolean
}): Branding {
  return {
    name: d.name || DEFAULT_BRANDING.name,
    logoUrl: d.logoUrl || '',
    devNote: {
      enabled: d.devNote?.enabled !== false,
      text: d.devNote?.text || '',
      link: d.devNote?.link || '',
    },
    homeLinks: d.homeLinks !== false,
  }
}

function readLocalStorage(): Branding | null {
  try {
    const raw = window.localStorage.getItem(LS_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<Branding>
    if (parsed && typeof parsed.name === 'string') {
      return normalize(parsed)
    }
  } catch {
    /* corrupted/blocked storage — ignore */
  }
  return null
}

function commit(next: Branding) {
  snapshot = next
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(next))
  } catch {
    /* storage full/blocked — memory value still works */
  }
  for (const l of listeners) l()
}

function sameBrand(a: Branding, b: Branding): boolean {
  return (
    a.name === b.name &&
    a.logoUrl === b.logoUrl &&
    a.homeLinks === b.homeLinks &&
    a.devNote.enabled === b.devNote.enabled &&
    a.devNote.text === b.devNote.text &&
    a.devNote.link === b.devNote.link
  )
}

function revalidate() {
  // hydrate instantly from a previous visit's cache on first use
  if (snapshot === DEFAULT_BRANDING) {
    const cached = readLocalStorage()
    if (cached && cached.name !== DEFAULT_BRANDING.name) snapshot = cached
  }
  if (Date.now() - lastFetch < REVALIDATE_MS) return
  lastFetch = Date.now()
  fetch('/api/branding')
    .then((r) => r.json())
    .then(
      (
        j: {
          ok?: boolean
          data?: {
            name?: string
            logoUrl?: string
            devNote?: Partial<DeveloperNote>
            homeLinks?: boolean
          }
        }
      ) => {
        if (!j?.ok || !j.data) return
        const next = normalize(j.data)
        if (!sameBrand(next, snapshot)) commit(next)
      }
    )
    .catch(() => {
      /* offline / hiccup — keep current value */
    })
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  revalidate()
  return () => {
    listeners.delete(cb)
  }
}

function getSnapshot(): Branding {
  return snapshot
}

function getServerSnapshot(): Branding {
  return DEFAULT_BRANDING
}

export function useBranding(): Branding {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
