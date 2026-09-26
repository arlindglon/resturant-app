// Cron: GET|POST /api/cron/daily-report — দিনে একবার WhatsApp রিপোর্ট (admin/owner/partner)
// Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}`; বাইরের cron-সার্ভিস (cron-job.org)
// হলে ?secret=CRON_SECRET কুয়েরি-প্যারামও চলে। রিপোর্ট দিনে একবারই যায় (idempotent)।
import { NextRequest } from 'next/server'
import { ok, fail } from '@/lib/api'
import { runDailyReport } from '@/lib/whatsapp'
import { setSettings } from '@/lib/settings'
import { SETTING_KEYS } from '@/lib/constants'

async function run(req: NextRequest) {
  const auth = req.headers.get('authorization')
  const qSecret = req.nextUrl.searchParams.get('secret')
  const secret = process.env.CRON_SECRET
  if (secret && auth !== `Bearer ${secret}` && qSecret !== secret) {
    return fail('Unauthorized', 401)
  }
  try {
    const result = await runDailyReport()
    return ok(result)
  } catch (err) {
    // ডাটাবেস/অপ্রত্যাশিত ব্যর্থতা — ফলাফল-সেটিং-এ জমা রাখি (admin দেখতে পাবে) এবং 200 ফেরত
    // দিই যাতে cron-চেইন লাল না দেখায়; পরের দিন আবার চেষ্টা হবে।
    const msg = (err as Error)?.message?.slice(0, 200) || 'অজানা ত্রুটি'
    await setSettings({ [SETTING_KEYS.WA_REPORT_LAST_RESULT]: `${new Date().toISOString()} — ব্যর্থ: ${msg}` }).catch(() => {})
    return ok({ skipped: true, error: msg })
  }
}

export async function GET(req: NextRequest) {
  return run(req)
}
export async function POST(req: NextRequest) {
  return run(req)
}
