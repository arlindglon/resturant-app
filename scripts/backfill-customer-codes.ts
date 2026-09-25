// One-time backfill: assign unique CRM codes (C-0001…) to every customer that
// has none — oldest customer gets the lowest number. Safe to re-run (only
// touches rows with code = null; collisions just skip).
// Run:  DATABASE_URL="mysql://…" bunx tsx scripts/backfill-customer-codes.ts
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

async function main() {
  const missing = await db.customer.findMany({
    where: { code: null },
    orderBy: { createdAt: 'asc' },
    select: { id: true, firstName: true },
  })
  if (missing.length === 0) {
    console.log('All customers already have codes.')
    return
  }

  // start after the highest existing code number
  const existing = await db.customer.findMany({ where: { code: { not: null } }, select: { code: true } })
  let max = 0
  for (const r of existing) {
    const n = parseInt((r.code || '').replace(/\D+/g, ''), 10)
    if (Number.isFinite(n) && n > max) max = n
  }

  let assigned = 0
  for (const c of missing) {
    max += 1
    const code = `C-${String(max).padStart(4, '0')}`
    try {
      await db.customer.update({ where: { id: c.id }, data: { code } })
      assigned += 1
      console.log(`${code} → ${c.firstName}`)
    } catch (e) {
      max -= 1 // code collision (unique) — try the next number for this row
      console.error(`skip ${c.id}: ${(e as Error).message}`)
    }
  }
  console.log(`Done — assigned ${assigned}/${missing.length} codes.`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
