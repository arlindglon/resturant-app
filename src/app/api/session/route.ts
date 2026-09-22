// GET /api/session — validate current table session
import { ok } from '@/lib/api'
import { getValidSession } from '@/lib/session'

export async function GET() {
  const s = await getValidSession()
  if (!s) return ok({ valid: false, tableNumber: null, expiresAt: null, minutesLeft: 0 })
  const minutesLeft = Math.max(0, Math.round((s.expiresAt.getTime() - Date.now()) / 60000))
  return ok({
    valid: true,
    tableNumber: s.tableNumber,
    expiresAt: s.expiresAt.toISOString(),
    minutesLeft,
    deviceId: s.deviceId,
  })
}
