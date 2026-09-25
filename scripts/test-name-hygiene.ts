/**
 * Test: sanitizeExtractedName (AI-learned name hygiene — the Ridoy" bug)
 * Run: bun scripts/test-name-hygiene.ts
 * Uses only pure functions from gemini.ts (no network / db).
 */
import { sanitizeExtractedName } from '../src/lib/gemini'

let pass = 0
let fail = 0
function check(name: string, got: unknown, want: unknown) {
  const ok = got === want
  if (ok) pass++
  else fail++
  console.log(`${ok ? '✅' : '❌'} ${name}${ok ? '' : ` — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`)
}

// ── the live-production bug: stray quotes ──
check('Ridoy" → Ridoy', sanitizeExtractedName('Ridoy"'), 'Ridoy')
check('"Ridoy" → Ridoy', sanitizeExtractedName('"Ridoy"'), 'Ridoy')
check("'Rakib' → Rakib", sanitizeExtractedName("'Rakib'"), 'Rakib')
check('`Ridoy` → Ridoy', sanitizeExtractedName('`Ridoy`'), 'Ridoy')
check('*Ridoy* → Ridoy (bold)', sanitizeExtractedName('*Ridoy*'), 'Ridoy')
check('“রাকিব” → রাকিব (curly quotes)', sanitizeExtractedName('“রাকিব”'), 'রাকিব')
check('Ridoy. → Ridoy (trailing dot)', sanitizeExtractedName('Ridoy.'), 'Ridoy')
check('Rakib! → Rakib (trailing bang)', sanitizeExtractedName('Rakib!'), 'Rakib')
check('ami Ridoy" → unchanged (inner text kept)', sanitizeExtractedName('ami Ridoy"'), 'ami Ridoy')

// ── legit names must survive ──
check('Ridoy plain', sanitizeExtractedName('Ridoy'), 'Ridoy')
check('রাকিব ইসলাম', sanitizeExtractedName('রাকিব ইসলাম'), 'রাকিব ইসলাম')
check("O'Brien keeps inner apostrophe", sanitizeExtractedName("O'Brien"), "O'Brien")
check('Md. Rakib keeps inner dot', sanitizeExtractedName('Md. Rakib'), 'Md. Rakib')
check('Ridoy Hasan', sanitizeExtractedName('Ridoy Hasan'), 'Ridoy Hasan')

// ── narration / meta junk must be rejected ──
check('null for empty', sanitizeExtractedName(''), null)
check('null for whitespace', sanitizeExtractedName('   '), null)
check('null for wait', sanitizeExtractedName('Wait'), null)
check('null for hmm', sanitizeExtractedName('hmm'), null)
check('null for customer', sanitizeExtractedName('customer'), null)
check('null for the user', sanitizeExtractedName('the user'), null)
check('null for drafting', sanitizeExtractedName('Drafting'), null)
check('null for name=… echo', sanitizeExtractedName('নাম=Ridoy'), null)
check('null for INFO: line', sanitizeExtractedName('INFO: name'), null)
check('null for JSON brace', sanitizeExtractedName('{name}'), null)
check('null for a', sanitizeExtractedName('a'), null) // <2 letters
check('null for 123', sanitizeExtractedName('123'), null)
check('null for 60+ char chunk', sanitizeExtractedName('a'.repeat(61)), null)

// ── null/undefined input ──
check('null for null', sanitizeExtractedName(null), null)
check('null for undefined', sanitizeExtractedName(undefined), null)

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
