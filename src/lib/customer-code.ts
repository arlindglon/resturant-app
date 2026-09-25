// Short unique customer codes for the CRM — "C-0001", "C-0002", …
// Admin searches by code to find a customer instantly (phone hangs up, code
// written on the receipt, etc). Codes are assigned at creation + backfilled
// for older rows by scripts/backfill-customer-codes.ts (oldest → C-0001).
import { db } from '@/lib/db'

export const CUSTOMER_CODE_PREFIX = 'C'
export const CUSTOMER_CODE_WIDTH = 4

export function formatCustomerCode(n: number): string {
  return `${CUSTOMER_CODE_PREFIX}-${String(n).padStart(CUSTOMER_CODE_WIDTH, '0')}`
}

/** numeric part of a code ("C-0007" → 7); 0 when unparseable */
function codeNumber(code: string): number {
  const n = parseInt(code.replace(/\D+/g, ''), 10)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/**
 * next free code (max existing + 1). Customer count is restaurant-scale so a
 * full scan is fine; the unique index catches the rare simultaneous-create
 * race and callers simply retry.
 */
export async function nextCustomerCode(): Promise<string> {
  const rows = await db.customer.findMany({ where: { code: { not: null } }, select: { code: true } })
  let max = 0
  for (const r of rows) max = Math.max(max, codeNumber(r.code || ''))
  return formatCustomerCode(max + 1)
}
