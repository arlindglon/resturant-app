// GET/POST /api/admin/whatsapp-report — ডেইলি অটো রিপোর্ট (WhatsApp) কনফিগ + প্রিভিউ + এখনই-পাঠান
import { NextRequest } from 'next/server'
import { ok, fail } from '@/lib/api'
import { requirePerm } from '@/lib/staff-auth'
import { getSetting, setSettings } from '@/lib/settings'
import { SETTING_KEYS } from '@/lib/constants'
import { buildDailyReport, parseWaRecipients, runDailyReport, dhakaToday } from '@/lib/whatsapp'

export async function GET() {
  const denied = await requirePerm('settings')
  if (denied) return denied
  const raw = await getSetting(SETTING_KEYS.WA_REPORT_RECIPIENTS)
  const recipients = parseWaRecipients(raw)
  return ok({
    enabled: (await getSetting(SETTING_KEYS.WA_REPORT_ENABLED)).trim() !== 'false',
    time: (await getSetting(SETTING_KEYS.WA_REPORT_TIME)) || '22:00',
    // apiKey কখনো প্লেইন-টেক্সটে ফেরত যায় না — সেট-আছে মার্কারই যথেষ্ট
    recipients: recipients.map((r) => ({ label: r.label, phone: r.phone, keySet: true })),
    rawRecipients: raw, // UI এডিটরে আবার সাজানোর জন্য (apiKey সহ — admin-only রুট)
    today: dhakaToday(),
    lastDate: await getSetting(SETTING_KEYS.WA_REPORT_LAST_DATE),
    lastResult: await getSetting(SETTING_KEYS.WA_REPORT_LAST_RESULT),
    preview: await buildDailyReport(),
  })
}

export async function POST(req: NextRequest) {
  const denied = await requirePerm('settings')
  if (denied) return denied
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const action = String(body.action || '')

  if (action === 'save') {
    const updates: Record<string, string> = {}
    if (typeof body.enabled === 'boolean') updates[SETTING_KEYS.WA_REPORT_ENABLED] = body.enabled ? 'true' : 'false'
    if (typeof body.time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(body.time)) updates[SETTING_KEYS.WA_REPORT_TIME] = body.time
    if (Array.isArray(body.recipients)) {
      // ভ্যালিডেশন parseWaRecipients-ই করে — এখানে এন্ট্রি সংখ্যা সীমা ছাড়া সেভ করা হয়
      const cleaned: unknown[] = []
      for (const it of body.recipients.slice(0, 10)) {
        if (!it || typeof it !== 'object') continue
        const o = it as Record<string, unknown>
        const label = String(o.label ?? '').trim().slice(0, 30)
        const phone = String(o.phone ?? '').replace(/[^0-9]/g, '')
        const apiKey = String(o.apiKey ?? '').trim().slice(0, 64)
        if (!phone || !apiKey) continue
        cleaned.push({ label, phone, apiKey })
      }
      if (!cleaned.length && body.enabled === true) return fail('অন্তত একজন প্রাপক (নম্বর + API key) যোগ করুন')
      updates[SETTING_KEYS.WA_REPORT_RECIPIENTS] = JSON.stringify(cleaned)
    }
    if (!Object.keys(updates).length) return fail('বদলানোর কিছু নেই')
    await setSettings(updates)
    return ok({ saved: Object.keys(updates) })
  }

  if (action === 'send-now') {
    const result = await runDailyReport({ force: true })
    return ok(result)
  }

  return fail('অজানা action')
}
