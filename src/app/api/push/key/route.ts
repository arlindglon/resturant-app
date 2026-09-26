// GET /api/push/key — পাবলিক VAPID key (কাস্টমার মেনু-পেজ সাবস্ক্রাইবের জন্য) + চালু/বন্ধ
import { ok } from '@/lib/api'
import { getVapid, pushEnabled } from '@/lib/webpush-server'

export async function GET() {
  const enabled = await pushEnabled()
  if (!enabled) return ok({ enabled: false, publicKey: null })
  const { publicKey } = await getVapid()
  return ok({ enabled: true, publicKey })
}
