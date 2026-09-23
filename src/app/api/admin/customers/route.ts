// GET /api/admin/customers — CRM list collected from the Messenger chats +
// bill-page claims: names, phone, event dates, verification data + the
// upcoming-events view (next 30 days) the admin can send offers to.
import { db } from '@/lib/db'
import { ok } from '@/lib/api'
import { requirePerm } from '@/lib/staff-auth'

/** days until the next occurrence of this month/day (0 = today) */
function daysUntilNext(date: Date, today: Date): number {
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const e = new Date(today.getFullYear(), date.getMonth(), date.getDate())
  if (e.getTime() < t.getTime()) e.setFullYear(e.getFullYear() + 1)
  return Math.round((e.getTime() - t.getTime()) / 86_400_000)
}

export async function GET() {
  const denied = await requirePerm('tables')
  if (denied) return denied

  const [customers, claims] = await Promise.all([
    db.customer.findMany({ orderBy: { createdAt: 'desc' } }),
    db.birthdayClaim.findMany({
      orderBy: { createdAt: 'desc' },
      select: { psid: true, amount: true, occasionId: true, createdAt: true, dataText: true },
    }),
  ])

  const occasionIds = [...new Set(claims.map((c) => c.occasionId).filter(Boolean))] as string[]
  const occasions = occasionIds.length
    ? await db.occasionOffer.findMany({ where: { id: { in: occasionIds } }, select: { id: true, name: true, emoji: true } })
    : []
  const occMap = new Map(occasions.map((o) => [o.id, o]))

  const claimCount = new Map<string, number>()
  const lastClaimAt = new Map<string, Date>()
  for (const c of claims) {
    claimCount.set(c.psid, (claimCount.get(c.psid) || 0) + 1)
    if (!lastClaimAt.has(c.psid) || (lastClaimAt.get(c.psid) || c.createdAt) < c.createdAt) {
      lastClaimAt.set(c.psid, c.createdAt)
    }
  }

  const today = new Date()
  const rows = customers.map((c) => {
    const daysLeft = c.birthday ? daysUntilNext(c.birthday, today) : null
    return {
      id: c.id,
      psid: c.psid,
      messenger: !c.psid.startsWith('direct:'),
      firstName: c.firstName,
      lastName: c.lastName,
      phone: c.phone,
      birthday: c.birthday,
      eventLabel: c.eventLabel,
      dataText: c.dataText,
      discountClaimed: c.discountClaimed,
      claims: claimCount.get(c.psid) || 0,
      lastClaimAt: lastClaimAt.get(c.psid) || null,
      lastSeenAt: c.lastSeenAt,
      createdAt: c.createdAt,
      daysUntilEvent: daysLeft,
    }
  })

  // upcoming events: has an event date, within the next 30 days (or today)
  const upcoming = rows
    .filter((r) => r.daysUntilEvent !== null && r.daysUntilEvent <= 30)
    .sort((a, b) => (a.daysUntilEvent ?? 999) - (b.daysUntilEvent ?? 999))
    .slice(0, 50)

  return ok({ customers: rows, upcoming })
}
