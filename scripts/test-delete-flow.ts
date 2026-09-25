/**
 * Test: Task 5-b — customer DELETE (fresh re-setup) flow, DB-free unit tests.
 * Run: bun scripts/test-delete-flow.ts
 *
 * Covers:
 *  1. sanitizeExtractedName (src/lib/gemini.ts) — quote/junk hygiene.
 *  2. isPlaceholderName (mirrored verbatim from webhook route.ts L491-494) +
 *     the saveAiCrmData fill decision (route.ts L454-465) with a tiny
 *     in-memory "customer" — placeholder names get filled, real names don't.
 *  3. nextCustomerCode scan logic (mirrored from customer-code.ts L25-30,
 *     formatter imported from the real module) — proves max-scan behavior
 *     after a deletion (gap preserved vs max-code reuse).
 *  4. DELETE-handler wipe order (mirrored from route.ts L67-73) against an
 *     in-memory mock shaped like prisma/schema.prisma — proves no related row
 *     type referencing Customer / psid survives, and a fresh re-message
 *     recreates a brand-new row (placeholder + code).
 * No real database is touched (PrismaClient is instantiated on import but
 * never queried — same pattern as the existing scripts/test-*.ts suites).
 */
import { sanitizeExtractedName } from '../src/lib/gemini'
import { formatCustomerCode, CUSTOMER_CODE_PREFIX, CUSTOMER_CODE_WIDTH } from '../src/lib/customer-code'

let pass = 0
let fail = 0
function check(name: string, got: unknown, want: unknown) {
  const ok = got === want
  if (ok) pass++
  else fail++
  console.log(`${ok ? '✅' : '❌'} ${name}${ok ? '' : ` — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`)
}

/* ─────────── 1. sanitizeExtractedName (gemini.ts L517-535) ─────────── */
console.log('\n— 1. sanitizeExtractedName —')
check('Ridoy" → Ridoy', sanitizeExtractedName('Ridoy"'), 'Ridoy')
check('  "রাকিব"  → রাকিব', sanitizeExtractedName('  "রাকিব" '), 'রাকিব')
check('Rakib. → Rakib', sanitizeExtractedName('Rakib.'), 'Rakib')
check('narration Wait → null', sanitizeExtractedName('Wait'), null)
check('narration hmm → null', sanitizeExtractedName('hmm'), null)
check('narration drafting → null', sanitizeExtractedName('drafting'), null)
check('null for empty string', sanitizeExtractedName(''), null)

/* ─────── 2. placeholder detection + fill decision (webhook route) ───────
 * Mirrored VERBATIM from src/app/api/webhook/messenger/route.ts:
 *   isPlaceholderName (L491-494): !n || n === 'Customer' || n === 'নাম যাচাই বাকি'
 *   fill decision (L448, L457, L465):
 *     cleanName = sanitizeExtractedName(extracted.name || '')
 *     fillsName = !!cleanName && isPlaceholderName(current?.firstName)
 *     → firstName: cleanName.slice(0, 60), lastName: ''
 */
function isPlaceholderName(name?: string | null): boolean {
  const n = (name || '').trim()
  return !n || n === 'Customer' || n === 'নাম যাচাই বাকি'
}
interface MockCustomer {
  firstName: string
  lastName: string | null
}
/** route.ts L448+L457+L465 — returns the post-save firstName (or null = untouched) */
function aiLearnsName(current: MockCustomer | undefined, extractedName: string): string | null {
  const cleanName = sanitizeExtractedName(extractedName || '')
  const fillsName = !!cleanName && isPlaceholderName(current?.firstName)
  if (fillsName) return cleanName!.slice(0, 60)
  return null
}

console.log('\n— 2. placeholder detection + AI name fill —')
check('placeholder: নাম যাচাই বাকি', isPlaceholderName('নাম যাচাই বাকি'), true)
check('placeholder: Customer', isPlaceholderName('Customer'), true)
check('placeholder: empty string', isPlaceholderName(''), true)
check('placeholder: null', isPlaceholderName(null), true)
check('NOT placeholder: রাকিব', isPlaceholderName('রাকিব'), false)

const fresh = { firstName: 'নাম যাচাই বাকি', lastName: '' } // upsertCustomer L300 default
check('fresh row + extracted Ridoy" → fills Ridoy', aiLearnsName(fresh, 'Ridoy"'), 'Ridoy')
check('real name রাকিব + extracted Ridoy → NOT overwritten', aiLearnsName({ firstName: 'রাকিব', lastName: '' }, 'Ridoy'), null)
check('deleted row (no current) + Rakib. → fills Rakib', aiLearnsName(undefined, 'Rakib.'), 'Rakib')
check('placeholder + narration Wait → no fill', aiLearnsName(fresh, 'Wait'), null)
check('placeholder + রাকিব ইসলাম → fills full name', aiLearnsName(fresh, 'রাকিব ইসলাম'), 'রাকিব ইসলাম')

/* ─────── 3. nextCustomerCode scan logic (customer-code.ts) ───────
 * Real formatter imported; the scan loop mirrored from customer-code.ts
 * L25-30 (findMany code-not-null → max numeric + 1 — a MAX scan, NOT a count).
 */
console.log('\n— 3. nextCustomerCode after deletion (max-scan, not count) —')
function codeNumber(code: string): number {
  const n = parseInt(code.replace(/\D+/g, ''), 10)
  return Number.isFinite(n) && n > 0 ? n : 0
}
/** mirror of nextCustomerCode() DB scan (pure part) */
function nextCode(existingCodes: (string | null)[]): string {
  let max = 0
  for (const code of existingCodes) {
    if (code === null) continue // where: { code: { not: null } }
    max = Math.max(max, codeNumber(code))
  }
  return formatCustomerCode(max + 1)
}
check('formatter C-7 → C-0007', formatCustomerCode(7), 'C-0007')
check('formatter prefix/width intact', `${CUSTOMER_CODE_PREFIX}-${'0'.repeat(CUSTOMER_CODE_WIDTH - 1)}1`, 'C-0001')

const fiveCustomers = ['C-0001', 'C-0002', 'C-0003', 'C-0004', 'C-0005']
// delete a MIDDLE customer (C-0002): its code is NOT reused — gap stays
const afterMiddleDelete = fiveCustomers.filter((c) => c !== 'C-0002')
check('delete mid C-0002 → next is C-0006 (gap, no reuse)', nextCode(afterMiddleDelete), 'C-0006')
// delete the MAX customer (C-0005): next create REUSES C-0005 for a different person
const afterMaxDelete = fiveCustomers.filter((c) => c !== 'C-0005')
check('delete max C-0005 → next REUSES C-0005', nextCode(afterMaxDelete), 'C-0005')
check('all deleted → restarts at C-0001', nextCode([]), 'C-0001')

/* ─────── 4. DELETE-handler wipe order against an in-memory schema mock ───────
 * Mock shaped like prisma/schema.prisma: ChatMessage{psid}, ReferralToken{psid},
 * BirthdayClaim{psid, customerId?}, CustomerNote{customerId, onDelete: Cascade},
 * Customer{id, psid, code?, phone?}. Handler order mirrored from route.ts
 * L67-73: chat→referral→claim deleteMany(psid), claim updateMany(customerId→null),
 * customer.delete (cascades notes, frees code + phone uniques).
 */
console.log('\n— 4. wipe order simulation (mock DB, schema-shaped) —')
interface Row {
  id: string
  [k: string]: unknown
}
function makeMockDb() {
  return {
    chatMessage: [] as Row[],
    referralToken: [] as Row[],
    birthdayClaim: [] as Row[],
    customerNote: [] as Row[],
    customer: [] as Row[],
  }
}
/** exact route.ts L67-73 sequence against the mock */
async function deleteCustomerHandler(m: ReturnType<typeof makeMockDb>, id: string) {
  const customer = m.customer.find((c) => c.id === id)
  if (!customer) return 404
  m.chatMessage = m.chatMessage.filter((r) => r.psid !== customer.psid) // L67
  m.referralToken = m.referralToken.filter((r) => r.psid !== customer.psid) // L68
  m.birthdayClaim = m.birthdayClaim.filter((r) => r.psid !== customer.psid) // L69
  m.birthdayClaim.forEach((r) => {
    // L71 — legacy customerId-linked rows must not block the FK
    if (r.customerId === id) r.customerId = null
  })
  m.customerNote = m.customerNote.filter((r) => r.customerId !== id) // L73 cascade
  m.customer = m.customer.filter((c) => c.id !== id) // L73
  return 200
}
/** upsertCustomer create-branch (route.ts L297-303) + nextCode mirror */
async function upsertCustomerNew(m: ReturnType<typeof makeMockDb>, psid: string) {
  const existing = m.customer.find((c) => c.psid === psid)
  if (existing) return existing
  const row: Row & { code: string; firstName: string } = {
    id: `cuid-${m.customer.length + 1}`,
    psid,
    code: nextCode(m.customer.map((c) => (c.code as string) || null)),
    firstName: 'নাম যাচাই বাকি', // L300 — profile fetch failed
    lastName: '',
  }
  m.customer.push(row)
  return row
}

const m = makeMockDb()
m.customer.push({ id: 'cust-2', psid: 'PSID_RIDOY', code: 'C-0002', phone: '01711111111', firstName: 'Ridoy' })
m.customer.push({ id: 'cust-5', psid: 'PSID_OTHER', code: 'C-0005', firstName: 'Someone' })
m.chatMessage.push({ id: 'cm1', psid: 'PSID_RIDOY' }, { id: 'cm2', psid: 'PSID_RIDOY' }, { id: 'cm3', psid: 'PSID_OTHER' })
m.referralToken.push({ id: 'rt1', psid: 'PSID_RIDOY', status: 'PENDING' }, { id: 'rt2', psid: 'PSID_OTHER' })
m.birthdayClaim.push({ id: 'bc1', psid: 'PSID_RIDOY', customerId: 'cust-2' }, { id: 'bc2', psid: 'PSID_OTHER', customerId: null })
m.birthdayClaim.push({ id: 'bc3', psid: 'PSID_LEGACY_DEVICE', customerId: 'cust-2' }) // legacy FK-only link
m.customerNote.push({ id: 'cn1', customerId: 'cust-2' }, { id: 'cn2', customerId: 'cust-2' }, { id: 'cn3', customerId: 'cust-5' })

const status = await deleteCustomerHandler(m, 'cust-2')
check('handler returns 200 for existing customer', status, 200)
check('chat messages of psid wiped (other psid kept)', m.chatMessage.length === 1 && m.chatMessage[0].id === 'cm3', true)
check('referral tokens of psid wiped (other kept)', m.referralToken.length === 1 && m.referralToken[0].id === 'rt2', true)
check('claims with matching psid deleted', !m.birthdayClaim.some((r) => r.id === 'bc1'), true)
check('legacy customerId-only claim detached (customerId null)', m.birthdayClaim.find((r) => r.id === 'bc3')?.customerId === null, true)
check('claims of other customers untouched', m.birthdayClaim.some((r) => r.id === 'bc2'), true)
check('notes cascade-deleted (other customer notes kept)', m.customerNote.length === 1 && m.customerNote[0].id === 'cn3', true)
check('customer row gone', !m.customer.some((c) => c.id === 'cust-2'), true)

// fresh re-setup: same person (same PSID) messages again
const again = await upsertCustomerNew(m, 'PSID_RIDOY')
check('re-message creates NEW row (new id)', again.id !== 'cust-2', true)
check('new row has fresh code C-0006 (max-scan; C-0002 gap stays free)', again.code, 'C-0006')
check('new row starts with placeholder name', again.firstName, 'নাম যাচাই বাকি')
check('phone freed → old number no longer blocking unique', !m.customer.some((c) => c.phone === '01711111111'), true)

// 404 path
check('delete of unknown id → 404', await deleteCustomerHandler(m, 'nope'), 404)

console.log(`\n${fail === 0 ? '🎉' : '💥'} ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
