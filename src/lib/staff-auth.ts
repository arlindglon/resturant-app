// ============================================================
// STAFF ACCESS KEY AUTH — kitchen display (KDS) + sub-admin
// (admin controller) sessions, HMAC-signed cookie tokens.
// ============================================================
import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { cookies } from 'next/headers'
import { db } from '@/lib/db'
import { isAdmin } from '@/lib/api'
import { STAFF_COOKIE, ACCESS_KEY_ROLES } from '@/lib/constants'

function staffSecret(): string {
  return (process.env.SESSION_SECRET || 'dev-only-insecure-secret') + ':staff'
}

/** Signed token: `staff.<keyId|main>.<issuedAt>.<hmac>` */
export function makeStaffToken(keyId: string): string {
  const payload = `staff.${keyId}.${Date.now()}`
  const mac = crypto.createHmac('sha256', staffSecret()).update(payload).digest('hex')
  return `${payload}.${mac}`
}

export function verifyStaffToken(raw: string | undefined): { keyId: string } | null {
  if (!raw) return null
  const parts = raw.split('.')
  if (parts.length !== 4) return null
  const payload = `${parts[0]}.${parts[1]}.${parts[2]}`
  const expected = crypto.createHmac('sha256', staffSecret()).update(payload).digest('hex')
  const a = Buffer.from(parts[3])
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
  const issued = parseInt(parts[2], 10)
  if (isNaN(issued) || Date.now() - issued > 7 * 24 * 60 * 60 * 1000) return null
  return { keyId: parts[1] }
}

export interface AccessKeyRow {
  id: string
  keyCode: string
  name: string
  role: string
  permissions: string
  lifetime: boolean
  expiresAt: Date | null
  active: boolean
  lastUsedAt: Date | null
}

/** Is a key row currently usable (active + within validity window)? */
export function isKeyUsable(k: {
  active: boolean
  lifetime: boolean
  expiresAt: Date | null
}): boolean {
  if (!k.active) return false
  if (k.lifetime) return true
  return !!k.expiresAt && k.expiresAt.getTime() > Date.now()
}

export function parsePerms(json: string | null | undefined): string[] {
  try {
    const arr = JSON.parse(json || '[]')
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}

export interface StaffCtx {
  kind: 'main' | 'key'
  keyId: string
  role: 'KDS' | 'ADMIN_CONTROLLER' | 'MAIN'
  name: string
  permissions: string[] // ['*'] for main admin
}

/**
 * Resolve the current staff session:
 *  1. main-admin passcode cookie  → kind=main (full access)
 *  2. staff key cookie            → kind=key, DB key must still be usable
 */
export async function getStaffCtx(): Promise<StaffCtx | null> {
  if (await isAdmin()) {
    return { kind: 'main', keyId: 'main', role: 'MAIN', name: 'মেইন অ্যাডমিন', permissions: ['*'] }
  }
  const store = await cookies()
  const tok = verifyStaffToken(store.get(STAFF_COOKIE)?.value)
  if (!tok) return null
  if (tok.keyId === 'main') {
    // kitchen session opened with the main admin passcode
    return { kind: 'main', keyId: 'main', role: 'MAIN', name: 'মেইন অ্যাডমিন', permissions: ['*'] }
  }
  const key = (await db.accessKey.findUnique({ where: { id: tok.keyId } })) as AccessKeyRow | null
  if (!key || !isKeyUsable(key)) return null
  return {
    kind: 'key',
    keyId: key.id,
    role: key.role === ACCESS_KEY_ROLES.ADMIN_CONTROLLER ? 'ADMIN_CONTROLLER' : 'KDS',
    name: key.name,
    permissions: parsePerms(key.permissions),
  }
}

/** Sub-admin permission check: main admin passes everything. */
export function ctxCan(ctx: StaffCtx | null, perm: string): boolean {
  if (!ctx) return false
  if (ctx.permissions.includes('*')) return true
  return ctx.permissions.includes(perm)
}

/**
 * Guard for admin-panel APIs grouped by tab permission.
 * Returns a NextResponse to send when access is denied, else null.
 */
export async function requirePerm(perm: string): Promise<NextResponse | null> {
  const ctx = await getStaffCtx()
  if (ctxCan(ctx, perm)) return null
  if (!ctx) return NextResponse.json({ ok: false, error: 'লগইন প্রয়োজন' }, { status: 401 })
  return NextResponse.json({ ok: false, error: 'এই অংশে আপনার অনুমতি নেই' }, { status: 403 })
}

/** Guard for key-management APIs — main admin only. */
export async function requireMainAdmin(): Promise<NextResponse | null> {
  const ctx = await getStaffCtx()
  if (ctx && ctx.kind === 'main') return null
  if (!ctx) return NextResponse.json({ ok: false, error: 'লগইন প্রয়োজন' }, { status: 401 })
  return NextResponse.json({ ok: false, error: 'শুধু মেইন অ্যাডমিন কী ম্যানেজ করতে পারে' }, { status: 403 })
}

/**
 * Guard for the kitchen display APIs: main admin OR a usable KDS key.
 * Returns fail response when denied.
 */
export async function kdsGuard(): Promise<NextResponse | null> {
  const ctx = await getStaffCtx()
  if (ctx) return null
  return NextResponse.json({ ok: false, error: 'কিচেন কী প্রয়োজন', code: 'KDS_KEY_REQUIRED' }, { status: 401 })
}

/** Human-friendly unambiguous key code: PREFIX-XXXX-XXXX (no 0/O/1/I) */
export function generateKeyCode(prefix: 'KDS' | 'SA'): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const pick = (n: number) =>
    Array.from({ length: n }, () => alphabet[crypto.randomInt(0, alphabet.length)]).join('')
  return `${prefix}-${pick(4)}-${pick(4)}`
}
