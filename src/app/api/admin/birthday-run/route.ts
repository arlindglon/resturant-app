// POST /api/admin/birthday-run — trigger birthday cron manually
import { ok, fail, isAdmin } from '@/lib/api'
import { runBirthdayCron } from '@/lib/birthday'
import { requirePerm } from '@/lib/staff-auth'

export async function POST() {
  const denied = await requirePerm('settings')
  if (denied) return denied
  const result = await runBirthdayCron()
  if (result.skipped) {
    return ok({ skipped: true, message: 'META_PAGE_TOKEN সেট করা নেই — Vercel env-এ যোগ করুন।' })
  }
  return ok({ sent: result.sent, message: `${result.sent} জনকে জন্মদিনের শুভেচ্ছা পাঠানো হয়েছে।` })
}
