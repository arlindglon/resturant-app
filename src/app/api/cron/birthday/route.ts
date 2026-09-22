// Cron: GET|POST /api/cron/birthday — daily birthday automation
// Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}`
import { NextRequest } from 'next/server'
import { ok, fail } from '@/lib/api'
import { runBirthdayCron } from '@/lib/birthday'

async function run(req: NextRequest) {
  const auth = req.headers.get('authorization')
  const secret = process.env.CRON_SECRET
  if (secret && auth !== `Bearer ${secret}`) {
    return fail('Unauthorized', 401)
  }
  const result = await runBirthdayCron()
  if (result.skipped) return ok({ skipped: true, message: 'META_PAGE_TOKEN কনফিগার করা হয়নি — মেসেজ পাঠানো হয়নি।' })
  return ok({ sent: result.sent })
}

export async function GET(req: NextRequest) {
  return run(req)
}
export async function POST(req: NextRequest) {
  return run(req)
}
