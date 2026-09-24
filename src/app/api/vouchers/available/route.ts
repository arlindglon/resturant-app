// GET /api/vouchers/available — public vouchers for the cart slider.
// ডিভাইস পরিচয় পাঠালে যেগুলো সে আগে ব্যবহার করেছে সেগুলো বাদ দিয়ে দেখানো হয় —
// তাই অর্ডারের সময় পুরোনো (already used) অফার আর চোখেই পড়বে না।
import { NextRequest } from 'next/server'
import { ok } from '@/lib/api'
import { getSliderVouchers, usedVoucherIds } from '@/lib/vouchers'

export async function GET(req: NextRequest) {
  const deviceId = req.nextUrl.searchParams.get('deviceId')
  const deviceFp = req.nextUrl.searchParams.get('deviceFp')
  const excludeIds = deviceId || deviceFp ? await usedVoucherIds({ id: deviceId, fp: deviceFp }) : []
  const vouchers = await getSliderVouchers(new Date(), excludeIds)
  return ok({ vouchers })
}
