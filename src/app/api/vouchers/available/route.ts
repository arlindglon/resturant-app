// GET /api/vouchers/available — public vouchers for the cart slider
import { ok } from '@/lib/api'
import { getSliderVouchers } from '@/lib/vouchers'

export async function GET() {
  const vouchers = await getSliderVouchers()
  return ok({ vouchers })
}
