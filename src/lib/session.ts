// ============================================================
// SECURITY ENGINE — HMAC-SHA256 signed table session cookies
// ============================================================
// Cookie value format:  {sessionId}.{expiresAtEpochMs}.{hmacHex}
// hmac = HMAC_SHA256(`${sessionId}.${expiresAtEpochMs}`, SESSION_SECRET)
//
// Validation pipeline (every protected API call):
//   1. Cookie exists & parseable
//   2. Signature matches (forged cookies rejected)
//   3. Not expired (max validity configurable from admin panel)
//   4. Session row exists, active, not cleared (Clear Table kills it)
//   5. Parent table not cleared
// ============================================================

import crypto from 'crypto'
import { cookies } from 'next/headers'
import { db } from '@/lib/db'
import { SESSION_COOKIE } from '@/lib/constants'
import { getSettingNumber } from '@/lib/settings'
import { SETTING_KEYS } from '@/lib/constants'
import { appendLedger, LEDGER_TYPES } from '@/lib/ledger'

function secret(): string {
  return process.env.SESSION_SECRET || 'dev-only-insecure-secret'
}

function sign(payload: string): string {
  return crypto.createHmac('sha256', secret()).update(payload).digest('hex')
}

/** Build the signed cookie value for a session */
export function makeSessionCookieValue(sessionId: string, expiresAt: Date): string {
  const exp = expiresAt.getTime().toString()
  const payload = `${sessionId}.${exp}`
  return `${payload}.${sign(payload)}`
}

/** Verify signature + parse. Returns null if forged/garbage. */
export function parseSessionCookieValue(raw: string | undefined): { sessionId: string; expiresAtMs: number } | null {
  if (!raw) return null
  const parts = raw.split('.')
  if (parts.length !== 3) return null
  const [sessionId, expStr, mac] = parts
  const payload = `${sessionId}.${expStr}`
  const expected = sign(payload)
  // timing-safe compare
  const a = Buffer.from(mac)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
  const expiresAtMs = parseInt(expStr, 10)
  if (isNaN(expiresAtMs)) return null
  return { sessionId, expiresAtMs }
}

export interface ValidSession {
  sessionId: string
  tableId: string
  tableNumber: number
  deviceId: string | null
  expiresAt: Date
}

/**
 * Validate the current request's session cookie end-to-end.
 * Returns null when invalid/expired/cleared.
 */
export async function getValidSession(): Promise<ValidSession | null> {
  const store = await cookies()
  const parsed = parseSessionCookieValue(store.get(SESSION_COOKIE)?.value)
  if (!parsed) return null

  // cryptographic expiry (cookie-level)
  if (parsed.expiresAtMs <= Date.now()) return null

  const session = await db.tableSession.findUnique({
    where: { id: parsed.sessionId },
    include: { table: true },
  })
  if (!session) return null
  if (!session.active || session.clearedAt) return null
  if (session.expiresAt.getTime() <= Date.now()) return null
  if (session.table.status !== 'OCCUPIED') return null

  return {
    sessionId: session.id,
    tableId: session.tableId,
    tableNumber: session.table.number,
    deviceId: session.deviceId,
    expiresAt: session.expiresAt,
  }
}

/**
 * Create (or re-join) a scanned session for a table & push the signed cookie.
 *
 * SHARED TABLE SESSION: when 4 customers scan the same table QR, they ALL
 * land in ONE active session → one shared cart history, one bill.
 * - New table scan → create session + register host device
 * - Already-occupied table → REUSE the live session (cookie re-issued for
 *   the same session id) + register the joining device (deduped)
 */
export async function createSessionForTable(tableId: string, deviceId?: string, deviceFp?: string) {
  // configurable duration from admin panel (default 90 min)
  const durationMinutes = await getSettingNumber(SETTING_KEYS.SESSION_DURATION_MINUTES, 90)
  const safeDuration = Math.max(1, Math.min(durationMinutes || 90, 24 * 60))

  // 1) reuse a live session on this table (shared session / shared bill)
  let existing = await db.tableSession.findFirst({
    where: {
      tableId,
      active: true,
      clearedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { scannedAt: 'desc' },
    include: { table: { select: { number: true } } },
  })

  // AUTO-ROTATE: when every order of the live session is already PAID the meal
  // is over — re-scanning the QR starts a FRESH session (fresh bill, offers
  // available again for a new round; per-offer locks still apply).
  if (existing) {
    const bills = await db.order.findMany({
      where: { sessionId: existing.id },
      select: { billPaid: true },
    })
    if (bills.length > 0 && bills.every((o) => o.billPaid)) {
      await db.tableSession.update({
        where: { id: existing.id },
        data: { active: false, clearedAt: new Date() },
      })
      await appendLedger({
        type: LEDGER_TYPES.SESSION_CLEARED,
        sessionId: existing.id,
        deviceId,
        deviceFp,
        tableNumber: existing.table.number,
        payload: { tableNumber: existing.table.number, note: 'auto-rotate: bill fully paid → re-scan starts a fresh session' },
      })
      existing = null
    }
  }

  if (existing) {
    const remainingMs = existing.expiresAt.getTime() - Date.now()
    const remainingMinutes = Math.max(1, Math.ceil(remainingMs / 60000))

    // register joining device (unique per session+device)
    if (deviceId) {
      const created = await db.sessionDevice
        .createMany({
          data: [{ sessionId: existing.id, deviceId, deviceFp: deviceFp || null }],
          skipDuplicates: true,
        })
        .catch(() => ({ count: 0 }))
      if (created.count > 0 && deviceId !== existing.deviceId) {
        await appendLedger({
          type: LEDGER_TYPES.SESSION_REJOIN,
          sessionId: existing.id,
          deviceId,
          deviceFp,
          tableNumber: existing.table.number,
          payload: { tableNumber: existing.table.number, note: 'another customer joined the shared table session' },
        })
      }
    }

    const store = await cookies()
    store.set(SESSION_COOKIE, makeSessionCookieValue(existing.id, existing.expiresAt), {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: Math.max(1, Math.ceil(remainingMs / 1000)),
    })

    return {
      session: existing,
      expiresAt: existing.expiresAt,
      durationMinutes: remainingMinutes,
      reused: true as const,
    }
  }

  // 2) fresh session for this table
  const expiresAt = new Date(Date.now() + safeDuration * 60 * 1000)
  const session = await db.tableSession.create({
    data: {
      tableId,
      token: crypto.randomBytes(24).toString('hex'),
      deviceId: deviceId || null,
      expiresAt,
      devices: deviceId
        ? { create: { deviceId, deviceFp: deviceFp || null } }
        : undefined,
    },
  })

  const store = await cookies()
  store.set(SESSION_COOKIE, makeSessionCookieValue(session.id, expiresAt), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: safeDuration * 60,
  })

  await appendLedger({
    type: LEDGER_TYPES.SESSION_START,
    sessionId: session.id,
    deviceId,
    deviceFp,
    payload: { tableId, durationMinutes: safeDuration },
  })

  return { session, expiresAt, durationMinutes: safeDuration, reused: false as const }
}

/** Permanently destroy a session (admin "Clear Table") */
export async function destroySession(sessionId: string) {
  const session = await db.tableSession.update({
    where: { id: sessionId },
    data: { active: false, clearedAt: new Date() },
    include: { table: { select: { number: true } } },
  })
  await appendLedger({
    type: LEDGER_TYPES.SESSION_CLEARED,
    sessionId,
    tableNumber: session.table.number,
    payload: { tableNumber: session.table.number, clearedAt: new Date().toISOString() },
  })
}
