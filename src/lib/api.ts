import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { cookies } from 'next/headers'
import { ADMIN_COOKIE } from '@/lib/constants'

export function ok<T>(data: T, init?: number, headers?: Record<string, string>) {
  return NextResponse.json({ ok: true, data }, { status: init || 200, headers })
}

export function fail(error: string, status = 400, code?: string) {
  return NextResponse.json({ ok: false, error, ...(code ? { code } : {}) }, { status })
}

/** Admin auth: HMAC-signed passcode cookie */
function adminSecret(): string {
  return process.env.SESSION_SECRET || 'dev-only-insecure-secret'
}

export function makeAdminToken(): string {
  const payload = `admin.${Date.now()}`
  const mac = crypto.createHmac('sha256', adminSecret()).update(payload).digest('hex')
  return `${payload}.${mac}`
}

export function verifyAdminToken(raw: string | undefined): boolean {
  if (!raw) return false
  const parts = raw.split('.')
  if (parts.length !== 3) return false
  const payload = `${parts[0]}.${parts[1]}`
  const expected = crypto.createHmac('sha256', adminSecret()).update(payload).digest('hex')
  const a = Buffer.from(parts[2])
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false
  // 7-day validity
  const issued = parseInt(parts[1], 10)
  return !isNaN(issued) && Date.now() - issued < 7 * 24 * 60 * 60 * 1000
}

export async function isAdmin(): Promise<boolean> {
  const store = await cookies()
  return verifyAdminToken(store.get(ADMIN_COOKIE)?.value)
}

export function parseJSON<T>(s: string | null | undefined, fallback: T): T {
  try { return JSON.parse(s || '') ?? fallback } catch { return fallback }
}
