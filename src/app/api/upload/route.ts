// POST /api/upload — multipart image → ImgBB (multi-key load balancing + auto-failover)
// Used by: menu item photos (menu perm), restaurant logo (settings perm).
import { NextRequest } from 'next/server'
import { fail, ok } from '@/lib/api'
import { adminCan } from '@/lib/access'
import { uploadImage } from '@/lib/imgbb'

const MAX_MB = 10

export async function POST(req: NextRequest) {
  const menuOk = await adminCan('menu')
  const settingsOk = menuOk ? true : await adminCan('settings')
  if (!menuOk && !settingsOk) return fail('অনুমতি নেই', 403)

  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!file || typeof file === 'string' || !(file instanceof File)) {
    return fail('ছবির ফাইল পাঠান (form field: file)', 400)
  }
  if (!file.type.startsWith('image/')) return fail('শুধুমাত্র ছবি ফাইল (JPG/PNG/WebP) আপলোড করা যাবে', 400)
  if (file.size > MAX_MB * 1024 * 1024) return fail(`ছবির সাইজ সর্বোচ্চ ${MAX_MB}MB হতে হবে`, 400)

  const r = await uploadImage(file)
  if (!r.ok || !r.url) return fail(r.error || 'আপলোড ব্যর্থ', 502)
  return ok({ url: r.url, deleteUrl: r.deleteUrl || null })
}
