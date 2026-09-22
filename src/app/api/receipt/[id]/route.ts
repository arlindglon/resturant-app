// GET /api/receipt/[id] — single receipt detail.
// Accessible to: main/sub admin, OR the customer device that owns the session
// (qr_session cookie must match the receipt's sessionId).
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, fail, parseJSON, isAdmin } from '@/lib/api'
import { getValidSession } from '@/lib/session'
import type { ReceiptOrder } from '@/app/api/admin/receipts/route'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const receipt = await db.receipt.findUnique({ where: { id } })
  if (!receipt) return fail('রসিদ পাওয়া যায়নি', 404)

  const admin = await isAdmin()
  if (!admin) {
    const session = await getValidSession()
    if (!session || session.sessionId !== receipt.sessionId) {
      return fail('এই রসিদ দেখার অনুমতি নেই', 403)
    }
  }

  return ok({
    receipt: {
      id: receipt.id,
      receiptNo: receipt.receiptNo,
      tableNumber: receipt.tableNumber,
      ordersCount: receipt.ordersCount,
      subtotal: receipt.subtotal,
      discountTotal: receipt.discountTotal,
      total: receipt.total,
      paymentMethod: receipt.paymentMethod,
      paidAt: receipt.paidAt,
      items: parseJSON<ReceiptOrder[]>(receipt.itemsJson, []),
    },
  })
}
