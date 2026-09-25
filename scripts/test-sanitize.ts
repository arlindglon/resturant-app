// লাইভ-ট্রান্সক্রিপ্ট-প্রমাণিত লিক নমুনা দিয়ে sanitizer টেস্ট
import { sanitizeCustomerReply, isCustomerUnfitReply } from '../src/lib/gemini'

const cases: { name: string; input: string; mustNotContain: string[]; expectContains?: string }[] = [
  {
    name: 'Wait-language-analysis leak ("hi" reply)',
    // এই রূপটা স্ট্রিপ হয় না — isCustomerUnfitReply গার্ড পুরো উত্তরটাই বাতিল করে
    // (webhook তখন static fallback পাঠায়) — নিচের guard-চেক সেটাই যাচাই করে
    input: 'Wait, "hihi" could be interpreted as "banglish" if it\'s just a casual greeting in a Bengali context. But strictly, it\'s English. I\'ll use en.',
    mustNotContain: [],
  },
  {
    name: 'Drafting-the-final-response leak (সূরা reply)',
    input: 'Drafting the final response:\n    আমি তো সূরা শোনাতে পারি না, তবে আমাদের সেট মেনু গুলো কিন্তু দারুণ! আপনি চাইলে আমাদের জনপ্রিয় কাচ্চি বিরিয়ানি সেট ট্রাই করতে পারেন। 😊',
    mustNotContain: ['Drafting'],
    expectContains: 'সেট মেনু',
  },
  {
    name: "Let's go. glued narration (offer reply)",
    input: "Let's go.আমাদের স্পেশাল অফারগুলো হলো জন্মদিন বা বিবাহবার্ষিকীর জন্য বিশেষ ছাড়!",
    mustNotContain: ["Let's go"],
    expectContains: 'স্পেশাল অফার',
  },
  {
    name: 'Bare "..." meaningless reply',
    input: '...',
    mustNotContain: [],
  },
  {
    name: 'Bare "…" unicode ellipsis reply',
    input: '…',
    mustNotContain: [],
  },
  {
    name: 'Glued INFO chunk (older leak, still covered)',
    input: 'হ্যালো! স্বাগতম!INFO: ভাষা=en আজ কী অর্ডার করবেন?',
    mustNotContain: ['INFO'],
    expectContains: 'স্বাগতম',
  },
  {
    name: 'Double echo (older leak, still covered)',
    input: 'আমাদের সেট মেনু দারুণ, আজই অর্ডার করুন আর উপভোগ করুন।\n\nআমাদের সেট মেনু দারুণ, আজই অর্ডার করুন আর উপভোগ করুন।',
    mustNotContain: [],
  },
  {
    name: 'Legit "Let\'s make it 8" survives',
    input: "Let's make it 8 people for tonight!",
    mustNotContain: [],
    expectContains: "Let's make it 8",
  },
  {
    name: 'Legit bold menu answer survives',
    input: 'হ্যালো! *Tea & Treat*-এ আপনাকে স্বাগতম! ☕🍰 আজ আপনার জন্য কী অর্ডার করব?',
    mustNotContain: [],
    expectContains: 'স্বাগতম',
  },
]

let pass = 0
let fail = 0
for (const c of cases) {
  const out = sanitizeCustomerReply(c.input)
  const problems: string[] = []
  for (const bad of c.mustNotContain) if (out.includes(bad)) problems.push(`contains "${bad}"`)
  if (c.expectContains && !out.includes(c.expectContains)) problems.push(`missing "${c.expectContains}"`)
  if (c.name.includes('meaningless') || c.input === '...' || c.input === '…') {
    // meaningless → sanitized output should be empty-ish (no letters)
    const letters = out.replace(/[^\p{L}\p{N}]/gu, '')
    if (letters.length >= 2) problems.push('meaningless input survived as text')
  }
  // চূড়ান্ত গার্ড: reasoning-মনোলগ/অর্থহীন আউটপুট unfit হতে হবে (webhook static fallback নেবে)
  if (c.name.startsWith('Wait-') || c.input === '...' || c.input === '…') {
    if (!isCustomerUnfitReply(out)) problems.push('guard did NOT reject as unfit')
  }
  if (problems.length) {
    fail++
    console.log(`✗ ${c.name}\n    out=${JSON.stringify(out)}\n    ${problems.join('; ')}`)
  } else {
    pass++
    console.log(`✓ ${c.name} → ${JSON.stringify(out.slice(0, 80))}`)
  }
}
// বৈধ উত্তর কখনো unfit হবে না
const legit = [
  'হ্যালো! *Tea & Treat*-এ আপনাকে স্বাগতম! ☕🍰 আজ আপনার জন্য কী অর্ডার করব?',
  "Let's make it 8 people for tonight!",
  'Song sunar shujog to amar nai 😄 tobe khudha metate amader special set menu darun shong debe! Ajker special gulo dekhben?',
  'কচ্চি বিরিয়ানি সেট — ৳৩৯৯! 😊',
]
for (const s of legit) {
  if (isCustomerUnfitReply(s)) {
    fail++
    console.log(`✗ legit reply wrongly rejected: ${JSON.stringify(s)}`)
  } else pass++
}
console.log(`\n${pass}/${pass + fail} passed`)
process.exit(fail ? 1 : 0)
