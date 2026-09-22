// GET /api/admin/ledger — tamper-evident security ledger viewer.
// Returns recent blocks + full chain integrity verdict
// (any retroactive DB edit breaks the SHA-256 hash chain).
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, fail, isAdmin } from '@/lib/api'
import { verifyLedgerChain } from '@/lib/ledger'
import { requirePerm } from '@/lib/staff-auth'

export async function GET(req: NextRequest) {
  const denied = await requirePerm('ledger')
  if (denied) return denied

  const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') || '80', 10) || 80, 200)
  const type = req.nextUrl.searchParams.get('type') || ''

  const [entries, total, integrity] = await Promise.all([
    db.ledgerEntry.findMany({
      where: type ? { type } : undefined,
      orderBy: { seq: 'desc' },
      take: limit,
    }),
    type ? db.ledgerEntry.count({ where: { type } }) : db.ledgerEntry.count(),
    verifyLedgerChain(2000),
  ])

  return ok({
    total,
    integrity,
    entries: entries.map((e) => {
      let detail: unknown = null
      try {
        const parsed = JSON.parse(e.payload || '{}')
        detail = parsed.d ?? parsed
      } catch {
        detail = e.payload
      }
      return {
        seq: e.seq,
        type: e.type,
        tableNumber: e.tableNumber,
        sessionId: e.sessionId,
        deviceId: e.deviceId ? e.deviceId.slice(0, 13) : null,
        deviceFp: e.deviceFp ? e.deviceFp.slice(0, 12) : null,
        detail,
        prevHash: e.prevHash.slice(0, 12),
        hash: e.hash.slice(0, 12),
        createdAt: e.createdAt,
      }
    }),
  })
}
