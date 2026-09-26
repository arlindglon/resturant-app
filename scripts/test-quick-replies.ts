// Test: DB-backed চ্যাট-বাটন (কুইক-রিপ্লাই) ম্যানেজার — bun scripts/test-quick-replies.ts
//
// যা যাচাই করে:
//   [1] parseQuickRepliesConfig — pure validation (ভাঙা/ফাঁকা/অবৈধ → null, ট্রিম/ক্যাপ/ডুপ্লিকেট)
//   [2] DEFAULT_QUICK_REPLIES — 📸 স্ক্রিনশট-ফরম্যাট ৫ বাটন অক্ষত
//   [3] botQuickReplies() async — ফাঁকা সেটিংয়ে ডিফল্ট ৫ বাটন
//   [4] সোর্স-কনট্র্যাক্ট — সব কল-সাইট await-এড, admin API/UI আছে, পুরনো
//       Meta-চেক/সিঙ্ক-এডিটর UI সম্পূর্ণ সরানো, ☰ মেনু রিপেয়ার-বাটন অক্ষত
let pass = 0
let fail = 0
function check(name: string, cond: boolean) {
  if (cond) {
    pass++
    console.log(`  ✅ ${name}`)
  } else {
    fail++
    console.log(`  ❌ ${name}`)
  }
}
function eq(name: string, got: unknown, want: unknown) {
  const okk = got === want
  if (okk) pass++
  else fail++
  console.log(`  ${okk ? '✅' : '❌'} ${name}${okk ? '' : ` — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`)
}
function section(name: string) {
  console.log(`\n[${name}]`)
}

const fs = await import('fs')
const ROOT = '/home/z/my-project'
const read = (p: string) => fs.readFileSync(`${ROOT}/${p}`, 'utf8')
const exists = (p: string) => fs.existsSync(`${ROOT}/${p}`)

/* ── 1. parseQuickRepliesConfig ── */
section('1 parseQuickRepliesConfig — pure validation')
const { parseQuickRepliesConfig, DEFAULT_QUICK_REPLIES, BOT_ACTIONS, isValidMenuPayload } = await import('../src/lib/bot-ui')

eq('ফাঁকা স্ট্রিং → null', parseQuickRepliesConfig(''), null)
eq('শুধু স্পেস → null', parseQuickRepliesConfig('   '), null)
eq('ভাঙা JSON → null', parseQuickRepliesConfig('{oops'), null)
eq('অ্যারে নয় (object) → null', parseQuickRepliesConfig('{"a":1}'), null)
eq('খালি অ্যারে → null', parseQuickRepliesConfig('[]'), null)
eq('সব-অবৈধ অ্যারে → null', parseQuickRepliesConfig('[{"title":"","payload":"__MENU__"},{"title":"x","payload":"junk"}]'), null)

const valid5 = JSON.stringify([
  { title: '🍕 মেনু দেখুন', payload: '__MENU__' },
  { title: '🔥 আজকের অফার', payload: '__OFFERS__' },
  { title: '📍 লোকেশন', payload: '__LOCATION__' },
  { title: '☎️ হেল্পলাইন', payload: '__HELPLINE__' },
  { title: '📄 টেক্সট মেনু', payload: '__TEXTMENU__' },
])
const parsed5 = parseQuickRepliesConfig(valid5)
check('৫-বাটন কনফিগ → ৫টাই ফেরে', Array.isArray(parsed5) && parsed5.length === 5)
eq('প্রথম বাটনের title অক্ষত', parsed5?.[0]?.title, '🍕 মেনু দেখুন')
eq('প্রথম বাটনের payload', parsed5?.[0]?.payload, '__MENU__')

const trimmed = parseQuickRepliesConfig('[{"title":"  🎁 প্রোমো কোড  ","payload":" __ACT__:abc "}]')
eq('title ট্রিম হয়', trimmed?.[0]?.title, '🎁 প্রোমো কোড')
eq('payload ট্রিম হয়', trimmed?.[0]?.payload, '__ACT__:abc')

const longTitle = parseQuickRepliesConfig('[{"title":"এই নামটা সত্যিই অনেক অনেক লম্বা হয়ে গেছে দেখুন","payload":"__MENU__"}]')
check('২০-অক্ষরের বেশি title কাটা হয় (≤20)', (longTitle?.[0]?.title?.length || 99) <= 20)

const mixed = parseQuickRepliesConfig(
  '[{"title":"ভাল","payload":"__MENU__"},{"title":"ভাঙা","payload":"NOT_ACTION"},{"title":"","payload":"__HOME__"},{"title":"হোম","payload":"__HOME__"}]'
)
check('অবৈধ payload/ফাঁকা title বাদ, বৈধ থাকে', Array.isArray(mixed) && mixed.length === 2)
eq('ডুপ্লিকেট payload একবারই', parseQuickRepliesConfig('[{"title":"A","payload":"__MENU__"},{"title":"B","payload":"__MENU__"}]')?.length, 1)

const many = parseQuickRepliesConfig(
  JSON.stringify(Array.from({ length: 15 }, (_, i) => ({ title: `বাটন ${i + 1}`, payload: i === 0 ? '__MENU__' : `__ACT__:id${i}` })))
)
eq('১৫টা দিলে ১০-এ ক্যাপ (Messenger নিয়ম)', many?.length, 10)

check('সোর্স-কনট্র্যাক্ট: isValidMenuPayload __CAT__ গ্রহণ করে (চ্যাট-বাটনেও ক্যাটাগরি চলবে)', isValidMenuPayload('__CAT__:abc') === true)

/* ── 2. DEFAULT_QUICK_REPLIES — 📸 স্ক্রিনশট-ফরম্যাট ── */
section('2 DEFAULT_QUICK_REPLIES — ৫-বাটন স্ক্রিনশট-ফরম্যাট অক্ষত')
eq('ঠিক ৫টা বাটন', DEFAULT_QUICK_REPLIES.length, 5)
eq('১ম: 🍕 মেনু দেখুন', DEFAULT_QUICK_REPLIES[0].title, '🍕 মেনু দেখুন')
eq('১ম payload __MENU__', DEFAULT_QUICK_REPLIES[0].payload, BOT_ACTIONS.MENU)
eq('২য়: 🔥 আজকের অফার', DEFAULT_QUICK_REPLIES[1].title, '🔥 আজকের অফার')
eq('২য় payload __OFFERS__', DEFAULT_QUICK_REPLIES[1].payload, BOT_ACTIONS.OFFERS)
eq('৩য়: 📍 লোকেশন', DEFAULT_QUICK_REPLIES[2].title, '📍 লোকেশন')
eq('৩য় payload __LOCATION__', DEFAULT_QUICK_REPLIES[2].payload, BOT_ACTIONS.LOCATION)
eq('৪র্থ: ☎️ হেল্পলাইন', DEFAULT_QUICK_REPLIES[3].title, '☎️ হেল্পলাইন')
eq('৪র্থ payload __HELPLINE__', DEFAULT_QUICK_REPLIES[3].payload, BOT_ACTIONS.HELPLINE)
eq('৫ম: 📄 টেক্সট মেনু', DEFAULT_QUICK_REPLIES[4].title, '📄 টেক্সট মেনু')
eq('৫ম payload __TEXTMENU__', DEFAULT_QUICK_REPLIES[4].payload, BOT_ACTIONS.TEXTMENU)
check('সব title ≤20 chars', DEFAULT_QUICK_REPLIES.every((q) => q.title.length > 0 && q.title.length <= 20))
check('payload ডুপ্লিকেট নেই', new Set(DEFAULT_QUICK_REPLIES.map((q) => q.payload)).size === 5)

/* ── 3. botQuickReplies() async — ফাঁকা সেটিং → ডিফল্ট ── */
section('3 botQuickReplies() — async, ফাঁকা সেটিংয়ে ডিফল্ট ৫ বাটন')
const { botQuickReplies } = await import('../src/lib/bot-ui')
const qr = await botQuickReplies('bn')
check('৫টা বাটন ফেরে (ডিফল্ট)', qr.length === 5)
eq('১ম বাটন স্ক্রিনশট-ফরম্যাটেই', qr[0].title, '🍕 মেনু দেখুন')
check('Promise রিটার্ন করে (async কনট্র্যাক্ট)', botQuickReplies('bn') instanceof Promise)

/* ── 4. সোর্স-কনট্র্যাক্ট ── */
section('4 সোর্স-কনট্র্যাক্ট — call-sites, API, UI, পুরনো UI সরানো')
const botUiSrc = read('src/lib/bot-ui.ts')
const webhookSrc = read('src/app/api/webhook/messenger/route.ts')
const pageSrc = read('src/app/admin/page.tsx')
const constantsSrc = read('src/lib/constants.ts')
const qrRoute = 'src/app/api/admin/quick-replies/route.ts'
const qrRouteSrc = read(qrRoute)

check('constants: MESSENGER_QUICK_REPLIES_JSON কি আছে', constantsSrc.includes("MESSENGER_QUICK_REPLIES_JSON: 'messenger_quick_replies_json'"))
check('bot-ui: export async function botQuickReplies', botUiSrc.includes('export async function botQuickReplies'))
check('bot-ui: DEFAULT_QUICK_REPLIES এক্সপোর্ট আছে', botUiSrc.includes('export const DEFAULT_QUICK_REPLIES'))
check('bot-ui: parseQuickRepliesConfig এক্সপোর্ট আছে', botUiSrc.includes('export function parseQuickRepliesConfig'))

// প্রতিটা কল-সাইট await-এড কি না (function-ডেফিনিশন লাইনটা একমাত্র ব্যতিক্রম)
const allCalls = [...botUiSrc.matchAll(/botQuickReplies\(/g)].length
const awaitedCalls = [...botUiSrc.matchAll(/await botQuickReplies\(/g)].length
eq('bot-ui-র ভেতরের সব কল await-এড (def লাইন বাদ)', allCalls - awaitedCalls, 1)
for (const [file, src] of [
  ['webhook', webhookSrc],
  ['admin-page', pageSrc],
] as [string, string][]) {
  const total = [...src.matchAll(/botQuickReplies\(/g)].length
  const awaited = [...src.matchAll(/await botQuickReplies\(/g)].length
  eq(`${file}: সব botQuickReplies কল await-এড`, total, awaited)
}
const birthdaySrc = read('src/lib/birthday.ts')
check('birthday.ts: quickReplies await-এড', /quickReplies:\s*await botQuickReplies\(/.test(birthdaySrc))
const blastSrc = read('src/app/api/admin/customers/personal-blast/route.ts')
check('personal-blast: blastChips await-এড', /const blastChips = await botQuickReplies\(/.test(blastSrc))
const msgSrc = read('src/app/api/admin/customers/[id]/message/route.ts')
check('message route: chips await-এড', /await botQuickReplies\(lang\)/.test(msgSrc))

check('admin API route আছে (GET+PUT)', /export async function GET\(/.test(qrRouteSrc) && /export async function PUT\(/.test(qrRouteSrc))
check('admin API: requirePerm("settings") GET ও PUT দুটোতেই', (qrRouteSrc.match(/requirePerm\('settings'\)/g) || []).length === 2)
check('admin API: MESSENGER_QUICK_REPLIES_JSON-এ সেভ হয়', qrRouteSrc.includes('SETTING_KEYS.MESSENGER_QUICK_REPLIES_JSON'))
check('admin API: সর্বোচ্চ ১০ বাটন ভ্যালিডেশন', qrRouteSrc.includes('> 10'))
check('admin API: isValidMenuPayload ভ্যালিডেশন', qrRouteSrc.includes('isValidMenuPayload'))
check('admin API: ডুপ্লিকেট অ্যাকশন রিজেক্ট', qrRouteSrc.includes('একই অ্যাকশন দুইবার'))

check('admin UI: QuickRepliesManager কম্পোনেন্ট আছে', pageSrc.includes('function QuickRepliesManager'))
check('admin UI: নতুন API কল করে', pageSrc.includes("'/api/admin/quick-replies'"))
check('admin UI: প্রিভিউ স্ট্রিপ আছে (কাস্টমার যেভাবে দেখবে)', pageSrc.includes('📱 কাস্টমার যেভাবে দেখবে'))
check('admin UI: সেভ = সঙ্গে সঙ্গে লাইভ লেখা আছে', pageSrc.includes('সেভ করুন — সঙ্গে সঙ্গে লাইভ'))
check('পুরনো MessengerMenuManager সম্পূর্ণ সরানো', !pageSrc.includes('MessengerMenuManager'))
check('পুরনো "Meta পেজে এখন যা আছে" চেকার সরানো', !pageSrc.includes('Meta পেজে এখন যা আছে'))
check('পুরনো "সেভ করুন ও Meta-তে সিঙ্ক করুন" বাটন সরানো', !pageSrc.includes('সেভ করুন ও Meta-তে সিঙ্ক করুন'))
check('পুরনো কনফিগ API রুট ফাইল নেই', !exists('src/app/api/admin/messenger-menu-config'))
check('পুরনো স্ট্যাটাস API রুট ফাইল নেই', !exists('src/app/api/admin/messenger-menu-status'))
check('messenger.ts-এ fetchPersistentMenuStatus সরানো', !read('src/lib/messenger.ts').includes('fetchPersistentMenuStatus'))

// ☰ ফিক্সড মেনু — আয়রন-রুল: রিপেয়ার-সিঙ্ক বাটন অক্ষত
check('☰ মেনু রিপেয়ার-বাটন অক্ষত (পার্সিস্টেন্ট মেনু সেট করুন)', pageSrc.includes('পার্সিস্টেন্ট মেনু সেট করুন'))
check('☰ মেনু সিঙ্ক API রুট অক্ষত', exists('src/app/api/admin/messenger-menu/route.ts'))
check('☰ মেনু সিঙ্ক API setPersistentMenu ব্যবহার করে', read('src/app/api/admin/messenger-menu/route.ts').includes('setPersistentMenu'))
check('bot-ui: botPersistentMenuEntries অক্ষত (☰ মেনু ডেটা-সোর্স)', botUiSrc.includes('export async function botPersistentMenuEntries'))

console.log(`\n════════════════════════════════`)
console.log(`QUICK-REPLIES: ${pass} pass, ${fail} fail`)
console.log(`════════════════════════════════`)
if (fail > 0) process.exit(1)
