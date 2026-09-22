// Resolve the PUBLIC origin of the app for QR codes / links.
// Priority:
//   1. admin setting `public_base_url` (explicit override, e.g. https://myshop.vercel.app)
//   2. x-forwarded-host + x-forwarded-proto (behind Vercel / Caddy / nginx proxies)
//   3. host header
//   4. request origin (direct local access)
import type { NextRequest } from 'next/server'
import { getSetting } from '@/lib/settings'
import { SETTING_KEYS } from '@/lib/constants'

export async function getPublicOrigin(req: NextRequest): Promise<string> {
  const override = (await getSetting(SETTING_KEYS.PUBLIC_BASE_URL))?.trim()
  if (override) return override.replace(/\/+$/, '')

  const h = req.headers
  const fwdHost = (h.get('x-forwarded-host') || '').split(',')[0].trim()
  const host = fwdHost || (h.get('host') || '').split(',')[0].trim()
  const proto = (h.get('x-forwarded-proto') || '').split(',')[0].trim()

  if (host) {
    const scheme = proto || (host.startsWith('localhost') || host.startsWith('127.') || host.startsWith('192.168.') ? 'http' : 'https')
    return `${scheme}://${host}`
  }

  return req.nextUrl.origin
}
