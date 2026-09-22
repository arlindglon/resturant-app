import { db } from '@/lib/db'
import { SETTING_DEFAULTS } from '@/lib/constants'

// In-memory cache (per server instance) to avoid hammering DB on hot paths
const cache = new Map<string, { value: string; ts: number }>()
const CACHE_TTL_MS = 30_000

export async function getSetting(key: string): Promise<string> {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return hit.value
  try {
    const row = await db.setting.findUnique({ where: { key } })
    const value = row?.value ?? SETTING_DEFAULTS[key] ?? ''
    cache.set(key, { value, ts: Date.now() })
    return value
  } catch {
    return SETTING_DEFAULTS[key] ?? ''
  }
}

export async function getSettingNumber(key: string, fallback = 0): Promise<number> {
  const v = await getSetting(key)
  const n = parseFloat(v)
  return isNaN(n) ? fallback : n
}

/** FRESH read (no cache) — admin toggles/pins must take effect immediately. */
export async function getSettingFresh(key: string): Promise<string> {
  try {
    const row = await db.setting.findUnique({ where: { key } })
    return row?.value ?? SETTING_DEFAULTS[key] ?? ''
  } catch {
    return SETTING_DEFAULTS[key] ?? ''
  }
}

export async function getAllSettings(): Promise<Record<string, string>> {
  const rows = await db.setting.findMany()
  const out: Record<string, string> = { ...SETTING_DEFAULTS }
  for (const r of rows) out[r.key] = r.value
  return out
}

export async function setSettings(entries: Record<string, string>): Promise<void> {
  const ops = Object.entries(entries).map(([key, value]) =>
    db.setting.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    })
  )
  await db.$transaction(ops)
  for (const [key, value] of Object.entries(entries)) {
    cache.set(key, { value, ts: Date.now() })
  }
}

// invalidate cache after external changes
export function invalidateSettingsCache() {
  cache.clear()
}
