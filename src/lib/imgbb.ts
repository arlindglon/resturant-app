// ============================================================
// ImgBB Multi-Key Manager — Load Balancing + Auto-Failover
// Picks the active key with the LOWEST usage; on failure
// transparently retries with the next key. Never crashes.
// ============================================================
import { db } from '@/lib/db'

export interface UploadResult {
  ok: boolean
  url?: string
  deleteUrl?: string
  error?: string
}

async function uploadWithKey(key: string, file: File): Promise<{ url: string; deleteUrl: string }> {
  const buf = Buffer.from(await file.arrayBuffer())
  const form = new FormData()
  form.append('image', buf.toString('base64'))

  const res = await fetch(`https://api.imgbb.com/1/upload?key=${encodeURIComponent(key)}`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) throw new Error(`ImgBB HTTP ${res.status}`)
  const json = await res.json()
  if (!json?.success || !json?.data?.url) throw new Error(json?.error?.message || 'ImgBB upload failed')
  return { url: json.data.display || json.data.url, deleteUrl: json.data.delete_url || '' }
}

export async function uploadImage(file: File): Promise<UploadResult> {
  // seed keys from env on first use (so fresh deploys work out of the box)
  await seedEnvKeys()

  const keys = await db.imgbbKey.findMany({
    where: { active: true },
    orderBy: [{ usageCount: 'asc' }, { failCount: 'asc' }],
  })

  if (keys.length === 0) return { ok: false, error: 'কোনো সক্রিয় ImgBB API Key নেই। Admin panel থেকে যোগ করুন।' }

  const errors: string[] = []
  for (const k of keys) {
    try {
      const r = await uploadWithKey(k.key, file)
      await db.imgbbKey.update({
        where: { id: k.id },
        data: { usageCount: { increment: 1 }, lastUsedAt: new Date(), lastError: null },
      })
      return { ok: true, url: r.url, deleteUrl: r.deleteUrl }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'unknown error'
      errors.push(`${k.label || k.key.slice(0, 6)}: ${msg}`)
      await db.imgbbKey.update({
        where: { id: k.id },
        data: { failCount: { increment: 1 }, lastError: msg },
      })
      // auto-failover → next key
    }
  }
  return { ok: false, error: `সব API Key দিয়ে আপলোড ব্যর্থ: ${errors.join(' | ')}` }
}

/** One-time import of IMGBB_KEYS env var into the DB */
export async function seedEnvKeys() {
  const envKeys = (process.env.IMGBB_KEYS || '').split(',').map((s) => s.trim()).filter(Boolean)
  if (envKeys.length === 0) return
  const existing = await db.imgbbKey.findMany({ select: { key: true } })
  const have = new Set(existing.map((e) => e.key))
  const toAdd = envKeys.filter((k) => !have.has(k))
  if (toAdd.length > 0) {
    await db.imgbbKey.createMany({
      data: toAdd.map((k, i) => ({ key: k, label: `Env Key ${i + 1}`, active: true })),
    })
  }
}
