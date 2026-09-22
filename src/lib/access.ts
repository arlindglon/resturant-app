// ============================================================
// Access-key auth — Sub-Admin (Admin Controller) + Kitchen Display.
//
// Main admin:     cookie admin_token = "admin.<ts>.<hmac>"      (full power)
// Sub-admin key:  cookie admin_token = "subadmin.<id>.<ts>.<hmac>" (permission list)
// KDS key:        cookie kds_token    = "kds.<id>.<ts>.<hmac>"
//
// Every authed request re-checks the key in the DB, so disabling a key or
// changing its permissions / expiry takes effect immediately.
// ============================================================
import crypto from 'crypto'
import { cookies } from 'next/headers'
import { db } from '@/lib/db'
import { ADMIN_COOKIE, KDS_COOKIE } from '@/lib/constants'

export type KeyRole = 'ADMIN_CONTROLLER' | 'KDS'

export interface AccessKeyRecord {
  id: string
  name: string
  role: string
  keyCode: string
  permissions: string[] // empty for KDS / main admin
  active: boolean
  expiresAt: Date | null
  lastUsedAt: Date | null
}

function secret(): string {
  return process.env.SESSION_SECRET || 'dev-only-insecure-secret'
}

function hmac(payload: string): string {
  return crypto.createHmac('sha256', secret()).update(payload).digest('hex')
}

export function makeAdminToken(): string {
  const payload = `admin.${Date.now()}`
  return `${payload}.${hmac(payload)}`
}

function makeKeyToken(role: 'subadmin' | 'kds', keyId: string): string {
  const payload = `${role}.${keyId}.${Date.now()}`
  return `${payload}.${hmac(payload)}`
}

function verifyMac(payload: string, mac: string): boolean {
  const a = Buffer.from(mac)
  const b = Buffer.from(hmac(payload))
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

/** main admin only — 3-part "admin.<ts>.<mac>" token */
export function verifyAdminToken(raw: string | undefined): boolean {
  if (!raw) return false
  const parts = raw.split('.')
  if (parts.length !== 3 || parts[0] !== 'admin') return false
  if (!verifyMac(`${parts[0]}.${parts[1]}`, parts[2])) return false
  const issued = parseInt(parts[1], 10)
  return !isNaN(issued) && Date.now() - issued < 7 * 24 * 60 * 60 * 1000
}

type TokenRole = 'admin' | 'subadmin' | 'kds'

function parseToken(raw: string | undefined): { role: TokenRole; keyId: string | null } | null {
  if (!raw) return null
  const parts = raw.split('.')
  // main admin → "admin.<ts>.<mac>"
  if (parts.length === 3 && parts[0] === 'admin') {
    if (!verifyAdminToken(raw)) return null
    return { role: 'admin', keyId: null }
  }
  // key → "subadmin|kds.<id>.<ts>.<mac>"
  if (parts.length === 4 && (parts[0] === 'subadmin' || parts[0] === 'kds')) {
    if (!verifyMac(`${parts[0]}.${parts[1]}.${parts[2]}`, parts[3])) return null
    const issued = parseInt(parts[2], 10)
    if (isNaN(issued) || Date.now() - issued > 30 * 24 * 60 * 60 * 1000) return null
    return { role: parts[0] as 'subadmin' | 'kds', keyId: parts[1] }
  }
  return null
}

/** Load + validate the key row for a signed token. Returns null if dead/expired. */
async function loadKey(keyId: string, role: KeyRole): Promise<AccessKeyRecord | null> {
  const k = await db.accessKey.findUnique({ where: { id: keyId } })
  if (!k || k.role !== role) return null
  if (!k.active) return null
  if (k.expiresAt && k.expiresAt.getTime() < Date.now()) return null
  return {
    id: k.id,
    name: k.name,
    role: k.role,
    keyCode: k.keyCode,
    permissions: parseJSONSafe(k.permissions),
    active: k.active,
    expiresAt: k.expiresAt,
    lastUsedAt: k.lastUsedAt,
  }
}

function parseJSONSafe(s: string | null): string[] {
  try {
    const v = JSON.parse(s || '[]')
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}

// ---------------- Cookie/session readers ----------------

/** main admin only (unchanged behavior for existing routes) */
export async function isAdmin(): Promise<boolean> {
  const store = await cookies()
  return parseToken(store.get(ADMIN_COOKIE)?.value)?.role === 'admin'
}

export type AdminAuth =
  | { level: 'admin' }
  | { level: 'subadmin'; key: AccessKeyRecord }
  | null

/** main admin OR sub-admin key — the unified admin-panel auth */
export async function getAdminAuth(): Promise<AdminAuth> {
  const store = await cookies()
  const t = parseToken(store.get(ADMIN_COOKIE)?.value)
  if (!t) return null
  if (t.role === 'admin') return { level: 'admin' }
  if (t.role === 'subadmin' && t.keyId) {
    const key = await loadKey(t.keyId, 'ADMIN_CONTROLLER')
    return key ? { level: 'subadmin', key } : null
  }
  return null
}

/** admin OR sub-admin with the given permission */
export async function adminCan(permission: string): Promise<boolean> {
  const auth = await getAdminAuth()
  if (!auth) return false
  if (auth.level === 'admin') return true
  return auth.key.permissions.includes(permission)
}

/** KDS screen auth: a valid KDS key or the main admin (convenience) */
export async function getKdsAuth(): Promise<AccessKeyRecord | { admin: true } | null> {
  const store = await cookies()
  const kdsT = parseToken(store.get(KDS_COOKIE)?.value)
  if (kdsT?.role === 'kds' && kdsT.keyId) {
    const key = await loadKey(kdsT.keyId, 'KDS')
    if (key) return key
  }
  if (await isAdmin()) return { admin: true }
  return null
}

// ---------------- Login-side setters ----------------

export async function issueAdminKeyCookie(keyId: string, expiresAt: Date | null) {
  const store = await cookies()
  const sevenDays = 7 * 24 * 60 * 60
  const maxAge = expiresAt
    ? Math.max(60, Math.min(sevenDays, Math.floor((expiresAt.getTime() - Date.now()) / 1000)))
    : sevenDays
  store.set(ADMIN_COOKIE, makeKeyToken('subadmin', keyId), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge,
  })
}

export async function issueKdsCookie(keyId: string, expiresAt: Date | null) {
  const store = await cookies()
  const sevenDays = 7 * 24 * 60 * 60
  const maxAge = expiresAt
    ? Math.max(60, Math.min(sevenDays, Math.floor((expiresAt.getTime() - Date.now()) / 1000)))
    : sevenDays
  store.set(KDS_COOKIE, makeKeyToken('kds', keyId), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge,
  })
}

/** validate a raw key code for login — returns the key row or null */
export async function findKeyByCode(code: string, role: KeyRole): Promise<AccessKeyRecord | null> {
  const normalized = code.trim().toUpperCase()
  if (!normalized) return null
  const k = await db.accessKey.findUnique({ where: { keyCode: normalized } })
  if (!k || k.role !== role || !k.active) return null
  if (k.expiresAt && k.expiresAt.getTime() < Date.now()) return null
  return {
    id: k.id,
    name: k.name,
    role: k.role,
    keyCode: k.keyCode,
    permissions: parseJSONSafe(k.permissions),
    active: k.active,
    expiresAt: k.expiresAt,
    lastUsedAt: k.lastUsedAt,
  }
}

/** readable random key code, e.g. "KDS-7F3K-9QMD" / "SA-8KD2-PX7F" */
export function generateKeyCode(prefix: string): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no I/1, O/0 confusion
  const block = (n: number) =>
    Array.from({ length: n }, () => alphabet[crypto.randomInt(alphabet.length)]).join('')
  return `${prefix}-${block(4)}-${block(4)}`
}
