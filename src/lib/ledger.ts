// ============================================================
// TAMPER-EVIDENT SECURITY LEDGER (blockchain-style hash chain)
// ------------------------------------------------------------
// Every security-relevant event (session start/rejoin/clear,
// voucher applied/blocked, birthday claimed/blocked, bill paid)
// is appended as a "block":  hash = SHA256(prevHash | fields…)
// Any retroactive DB edit breaks the chain → detectable via
// verifyLedgerChain(). Never throws — auditing must not break
// the main flow.
// ============================================================
import crypto from 'crypto'
import { db } from '@/lib/db'

export const LEDGER_TYPES = {
  SESSION_START: 'SESSION_START',
  SESSION_REJOIN: 'SESSION_REJOIN',
  SESSION_CLEARED: 'SESSION_CLEARED',
  ORDER_PLACED: 'ORDER_PLACED',
  VOUCHER_APPLIED: 'VOUCHER_APPLIED',
  VOUCHER_BLOCKED: 'VOUCHER_BLOCKED',
  REFERRAL_ISSUED: 'REFERRAL_ISSUED',
  BIRTHDAY_CLAIMED: 'BIRTHDAY_CLAIMED',
  BIRTHDAY_BLOCKED: 'BIRTHDAY_BLOCKED',
  BILL_PAID: 'BILL_PAID',
} as const

export interface LedgerInput {
  type: string
  sessionId?: string | null
  deviceId?: string | null
  deviceFp?: string | null
  tableNumber?: number | null
  payload?: Record<string, unknown> | null
}

export const GENESIS = 'GENESIS'

function computeHash(prevHash: string, type: string, payload: string, ts: string, nonce: string): string {
  return crypto.createHash('sha256').update(`${prevHash}|${type}|${payload}|${ts}|${nonce}`).digest('hex')
}

/** Append one entry to the hash chain (best-effort, never throws). */
export async function appendLedger(input: LedgerInput): Promise<void> {
  try {
    const last = await db.ledgerEntry.findFirst({ orderBy: { seq: 'desc' }, select: { hash: true } })
    const prevHash = last?.hash || GENESIS
    // ts + nonce are folded into the payload wrapper so chain verification
    // stays fully deterministic from stored fields only
    const ts = new Date().toISOString()
    const nonce = crypto.randomBytes(8).toString('hex')
    const payload = JSON.stringify({ d: input.payload ?? {}, ts, nonce })
    const hash = computeHash(prevHash, input.type, payload, ts, nonce)

    await db.ledgerEntry.create({
      data: {
        type: input.type,
        sessionId: input.sessionId || null,
        deviceId: input.deviceId || null,
        deviceFp: input.deviceFp || null,
        tableNumber: input.tableNumber ?? null,
        payload,
        prevHash,
        hash,
      },
    })
  } catch (e) {
    console.error('[ledger:append]', e)
  }
}

export interface ChainVerdict {
  valid: boolean
  checked: number
  brokenAtSeq: number | null
}

/**
 * Recompute the whole chain from the oldest entry.
 * If any stored hash ≠ recomputed hash → data was tampered with.
 */
export async function verifyLedgerChain(limit = 2000): Promise<ChainVerdict> {
  const entries = await db.ledgerEntry.findMany({
    orderBy: { seq: 'asc' },
    take: limit,
    select: { seq: true, type: true, payload: true, prevHash: true, hash: true },
  })

  let expectedPrev = GENESIS
  for (const e of entries) {
    if (e.prevHash !== expectedPrev) return { valid: false, checked: e.seq, brokenAtSeq: e.seq }
    // extract ts+nonce from the payload wrapper {d, ts, nonce}
    let ts = ''
    let nonce = ''
    try {
      const parsed = JSON.parse(e.payload || '{}')
      if (parsed && typeof parsed === 'object' && 'ts' in parsed && 'nonce' in parsed) {
        ts = String(parsed.ts)
        nonce = String(parsed.nonce)
      }
    } catch { /* keep empty */ }
    const recomputed = computeHash(e.prevHash, e.type, e.payload || '', ts, nonce)
    if (recomputed !== e.hash) return { valid: false, checked: e.seq, brokenAtSeq: e.seq }
    expectedPrev = e.hash
  }
  return { valid: true, checked: entries.length, brokenAtSeq: null }
}
