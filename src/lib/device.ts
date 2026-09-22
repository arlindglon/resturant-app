// Server-side device identity resolution for anti-fraud.
// The client keeps a persistent `qr_device` cookie (value: `<uuid>.<fp>`).
// APIs can also accept explicit deviceId/deviceFp in the body — body wins.
import type { NextRequest } from 'next/server'
import { DeviceIdentity } from '@/lib/vouchers'

export function deviceIdentity(req: NextRequest, body?: Record<string, unknown>): DeviceIdentity {
  let id: string | null = null
  let fp: string | null = null

  const cookieVal = req.cookies.get('qr_device')?.value || null
  if (cookieVal) {
    const dot = cookieVal.lastIndexOf('.')
    if (dot > 0 && cookieVal.length - dot - 1 >= 8) {
      id = cookieVal.slice(0, dot)
      fp = cookieVal.slice(dot + 1)
    } else {
      id = cookieVal
    }
  }

  if (body) {
    if (typeof body.deviceId === 'string' && body.deviceId.trim()) id = body.deviceId.trim().slice(0, 80)
    if (typeof body.deviceFp === 'string' && body.deviceFp.trim()) fp = body.deviceFp.trim().slice(0, 40)
  }

  return { id, fp }
}

/** WHERE clause fragment matching either device id or fingerprint */
export function deviceMatch(d: DeviceIdentity): Record<string, string>[] {
  const or: Record<string, string>[] = []
  if (d.id) or.push({ deviceId: d.id })
  if (d.fp) or.push({ deviceFp: d.fp })
  return or
}
