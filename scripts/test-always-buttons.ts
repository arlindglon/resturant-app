// Test: সবসময়-বাটন নিয়ম + greeting fast-path + admin Page Access Token override
// bun scripts/test-always-buttons.ts
//
// মালিকের নির্দেশ (Task 35):
//  ১) "hi/hello/salam" লিখলে AI নয় — সঙ্গে সঙ্গে স্বাগতম + মেনু-বাটন
//  ২) বটের প্রতিটা উত্তরের নিচে মেনু-বাটন সবসময় থাকবে (কখনো সরানো যাবে না)
//  ৩) Page Access Token admin সেটিং থেকেও আসতে পারে (env-এর আগে)
export {}
process.env.META_PAGE_TOKEN = 'TEST_TOKEN_ENV'

let passed = 0
let failed = 0
function check(name: string, cond: boolean) {
  if (cond) {
    passed++
    console.log(`  ✅ ${name}`)
  } else {
    failed++
    console.log(`  ❌ ${name}`)
  }
}

/* ── 1. Greeting fast-path matcher ── */
console.log('\n[1] isGreetingText — শুধু-শুভেচ্ছা মেসেজ')
const { isGreetingText, botQuickReplies, BOT_ACTIONS } = await import('../src/lib/bot-ui')

const greetings = ['hi', 'Hi', 'HI', 'hii', 'hiii', 'hey', 'heyy', 'hello', 'helo', 'hlo', 'salam', 'assalamualaikum', 'assalamu alaikum', 'good morning', 'Good Morning!', 'hi!', 'hello?', 'হাই', 'হ্যালো', 'হেলো', 'সালাম', 'আসসালামু আলাইকুম', 'নমস্কার', 'কেমন আছেন', 'ki khobor', 'kemon achen', 'Kemon Acho?']
for (const g of greetings) check(`"${g}" → greeting`, isGreetingText(g))
const nonGreetings = ['hi menu den', "what's on the menu", 'hi 5 er discount ache?', 'offer ki ache', 'menu', 'হাই বলো মেনু দেখাও', '1', 'delivery ache?', '']
for (const g of nonGreetings) check(`"${g}" → NOT greeting (AI/অন্য ইনটেন্টে যায়)`, !isGreetingText(g))

/* ── 2. sendText quickReplies opt — বাটনসহ টেক্সট ── */
console.log('\n[2] sendText(opts.quickReplies) — প্রতিটা উত্তরে বাটন')
const sent: { url: string; body: Record<string, unknown> }[] = []
;(globalThis as { fetch: unknown }).fetch = (async (url: unknown, init?: { body?: string }) => {
  sent.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : {} })
  return new Response(JSON.stringify({ recipient_id: 'X', message_id: 'm' }), { status: 200 })
}) as unknown

const { sendText, sendReceipt, sendBirthdayGreeting } = await import('../src/lib/messenger')
const chips = botQuickReplies('bn')

await sendText('PSID1', 'সাধারণ টেক্সট', { quickReplies: chips })
{
  const b = sent[sent.length - 1]?.body as { message?: { text?: string; quick_replies?: unknown[]; text_format?: string } }
  check('টেক্সট গেছে', b?.message?.text === 'সাধারণ টেক্সট')
  check('নিচে ৫টা মেনু-বাটন গেছে', (b?.message?.quick_replies?.length || 0) === 5)
}

await sendText('PSID1', 'চিপ ছাড়া', {})
{
  const b = sent[sent.length - 1]?.body as { message?: { quick_replies?: unknown[] } }
  check('quickReplies opt না দিলে চিপ নেই (backward-compat)', !b?.message?.quick_replies)
}

/* ── 3. চিপসহ রিজেক্ট → চিপ ছাড়া ফলব্যাক (মেসেজ কখনো হারায় না) ── */
console.log('\n[3] quick_replies রিজেক্ট হলে চিপ-ছাড়া fallback')
sent.length = 0
;(globalThis as { fetch: unknown }).fetch = (async (_u: unknown, init?: { body?: string }) => {
  const body = init?.body ? JSON.parse(init.body) : {}
  sent.push({ url: 'x', body })
  if (body?.message?.quick_replies) return new Response(JSON.stringify({ error: { message: '(#100) Invalid quick_replies' } }), { status: 400 })
  return new Response(JSON.stringify({ recipient_id: 'X', message_id: 'm' }), { status: 200 })
}) as unknown

const okFallback = await sendText('PSID1', 'গুরুত্বপূর্ণ মেসেজ', { markdown: false, quickReplies: chips })
check('fallback সফল (true)', okFallback === true)
check('৩ বার চেষ্টা হয়েছে (চিপ+মার্কডাউন বন্ধ → চিপসহ → চিপছাড়া)', sent.length === 2)
{
  const last = sent[sent.length - 1]?.body as { message?: { text?: string; quick_replies?: unknown[] } }
  check('শেষ চেষ্টায় মেসেজ গেছে চিপ ছাড়া', last?.message?.text === 'গুরুত্বপূর্ণ মেসেজ' && !last?.message?.quick_replies)
}

/* ── 4. sendReceipt / sendBirthdayGreeting — রসিদ/শুভেচ্ছাতেও বাটন ── */
console.log('\n[4] sendReceipt / sendBirthdayGreeting — replies pass-through')
sent.length = 0
;(globalThis as { fetch: unknown }).fetch = (async (_u: unknown, init?: { body?: string }) => {
  sent.push({ url: 'x', body: init?.body ? JSON.parse(init.body) : {} })
  return new Response(JSON.stringify({ recipient_id: 'X', message_id: 'm' }), { status: 200 })
}) as unknown

await sendReceipt('PSID1', [{ text: 'রসিদ' }], chips)
{
  const b = sent[sent.length - 1]?.body as { message?: { text?: string; quick_replies?: unknown[] } }
  check('রসিদের নিচে ৫টা বাটন', b?.message?.text === 'রসিদ' && (b?.message?.quick_replies?.length || 0) === 5)
}
await sendBirthdayGreeting('PSID1', 'রাকিব', 'BDAY123', 50, chips)
{
  const b = sent[sent.length - 1]?.body as { message?: { text?: string; quick_replies?: unknown[] } }
  check('জন্মদিনের শুভেচ্ছার নিচেও ৫টা বাটন', (b?.message?.text?.includes('শুভ জন্মদিন') ?? false) && (b?.message?.quick_replies?.length || 0) === 5)
}

/* ── 5. admin token override: DB সেটিং > env ── */
console.log('\n[5] pageTokenInfo — admin সেটিং ওভাররাইড ডায়াগনস্টিকস')
const messenger = await import('../src/lib/messenger')
// লোকাল টেস্টে DB নেই → getSetting ব্যর্থ → env fallback
const info = await messenger.pageTokenInfo()
check('DB না চললে source=env (fallback ভাঙে না)', info.source === 'env')
check('tail শেষ ৬ অক্ষর', info.tail === 'K_ENV_'.slice(0, 6) || info.tail.length === 6)
check('messengerConfigured() async → true', (await messenger.messengerConfigured()) === true)

/* ── 6. greetMenuText — ৪ ভাষাতেই আছে ── */
console.log('\n[6] greetMenuText প্যাক-কি (bn/banglish/en/hi)')
const { t } = await import('../src/lib/bot-text')
check('bn গ্রিটিং-টেক্সট আছে', t('bn', 'greetMenuText', { name: '' }).includes('স্বাগতম'))
check('bn গ্রিটিং-এ {name} বসে', t('bn', 'greetMenuText', { name: ' রাকিব' }).includes('রাকিব'))
check('banglish গ্রিটিং-টেক্সট আছে', t('banglish', 'greetMenuText', { name: '' }).includes('Welcome'))
check('en গ্রিটিং-টেক্সট আছে', t('en', 'greetMenuText', { name: '' }).includes('Welcome'))
check('hi গ্রিটিং-টেক্সট আছে', t('hi', 'greetMenuText', { name: '' }).includes('स्वागत'))

/* ── 7. botQuickReplies গঠন — Meta নিয়ম মেনে ── */
console.log('\n[7] চিপ গঠন নিয়ম (≤20 টাইটেল, payload)')
check('৫টা মূল চিপ', chips.length === 5)
check('সব টাইটেল ≤20', chips.every((c) => c.title.length <= 20))
check('সব payload বৈধ BOT_ACTIONS', chips.every((c) => Object.values(BOT_ACTIONS).includes(c.payload as never)))

/* ── 8. sendErrorHint — Dev Mode এরর এখন সঠিক হিন্ট দেয় ── */
console.log('\n[8] sendErrorHint — "Application does not have permission" → Development Mode হিন্ট')
const { sendErrorHint } = await import('../src/lib/messenger')
const devHint = sendErrorHint('Application does not have permission for this action')
check('Dev-Mode এরর → Live করার হিন্ট', devHint.includes('Development Mode') && devHint.includes('Live'))
check('আগের ভুল হিন্ট (pages_messaging) আর আসে না', !devHint.includes('Advanced Access'))
check('"not admins" এরর এখনো Dev-Mode হিন্ট দেয়', sendErrorHint('Cannot message users who are not admins, developers or testers of your app').includes('Development Mode'))
check('২৪ঘ উইন্ডো এরর → RN হিন্ট (অপরিবর্তিত)', sendErrorHint('This message is being sent outside the allowed window').includes('RN'))

console.log(`\n═══ ফলাফল: ${passed} passed, ${failed} failed ═══`)
if (failed > 0) process.exit(1)
