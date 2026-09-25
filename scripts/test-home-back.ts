// Test: ⬅️ পেছনে (BACK_CHIP) → __HOME__ হোম-মেনু ফ্লো — bun scripts/test-home-back.ts
// Meta-র নতুন flat persistent-menu স্কিমাও আবার যাচাই হয় (Task 30 রিগ্রেশন-গার্ড)।
export {}
process.env.META_PAGE_TOKEN = 'TEST_TOKEN'

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

/* ── 1. BOT_ACTIONS / BACK_CHIP / payload routing ── */
console.log('\n[1] HOME action & BACK_CHIP')
const { BOT_ACTIONS, BACK_CHIP, botActionFromPayload, botActionFromText, handleBotUiAction, isValidMenuPayload } = await import('../src/lib/bot-ui')

check('BOT_ACTIONS.HOME === __HOME__', BOT_ACTIONS.HOME === '__HOME__')
check('BACK_CHIP payload === __HOME__ (আগে ছিল __MENU__)', BACK_CHIP.payload === BOT_ACTIONS.HOME)
check('BACK_CHIP title ⬅️ পেছনে', BACK_CHIP.title.includes('পেছনে'))
check('botActionFromPayload(__HOME__) → HOME', botActionFromPayload('__HOME__') === BOT_ACTIONS.HOME)
check('isValidMenuPayload(__HOME__) → true (admin persistent-menu বাটন হিসেবেও বৈধ)', isValidMenuPayload('__HOME__'))
check('isValidMenuPayload(__MENU__) still true', isValidMenuPayload('__MENU__'))

/* ── 2. text intents — পেছনে/home লিখলেও হোম ── */
console.log('\n[2] Text intent: পেছনে/home/back')
check('"পেছনে" → HOME', botActionFromText('পেছনে') === BOT_ACTIONS.HOME)
check('"home" → HOME', botActionFromText('home') === BOT_ACTIONS.HOME)
check('"back" → HOME', botActionFromText('back') === BOT_ACTIONS.HOME)
check('"shuru" → HOME', botActionFromText('shuru') === BOT_ACTIONS.HOME)
check('"হোম" → HOME', botActionFromText('হোম') === BOT_ACTIONS.HOME)
check('"মেনু দেখাও" → MENU (INTENT_TAIL lookahead বাংলাতেও কাজ করে)', botActionFromText('মেনু দেখাও') === BOT_ACTIONS.MENU)
check('"মেনু" একা → MENU (আগে \\b-তে ভেঙে যেত — প্রি-একজিস্টিং বাগ ফিক্স)', botActionFromText('মেনু') === BOT_ACTIONS.MENU)
check('"menu" → MENU', botActionFromText('menu') === BOT_ACTIONS.MENU)
check('"offer" → OFFERS', botActionFromText('offer') === BOT_ACTIONS.OFFERS)
check('"লোকেশন" → LOCATION', botActionFromText('লোকেশন') === BOT_ACTIONS.LOCATION)
check('"হেল্পলাইন" → HELPLINE', botActionFromText('হেল্পলাইন') === BOT_ACTIONS.HELPLINE)
check('"homepage" → null (কড়া boundary — প্রিফিক্স মিস-ম্যাচ নেই)', botActionFromText('homepage') === null)
check('"menus" → null (কড়া boundary)', botActionFromText('menus') === null)

/* ── 3. handleBotUiAction(HOME) — pageToken সেট কিন্তু fetch mock ছাড়া কল যাবে না;
      sendQuickReplies token পেয়ে fetch করবে — global fetch mock করি ── */
console.log('\n[3] handleBotUiAction(HOME) sends home text + 5 main chips')
const sent: { body: unknown }[] = []
;(globalThis as { fetch: unknown }).fetch = (async (_url: unknown, init?: { body?: string }) => {
  sent.push({ body: init?.body ? JSON.parse(init.body) : null })
  return new Response(JSON.stringify({ recipient_id: 'X', message_id: 'm' }), { status: 200 })
}) as unknown
const homeTextBn = 'মূল মেনুতে ফিরে'
const r = await handleBotUiAction('PSID1', 'bn', BOT_ACTIONS.HOME)
check('handled=true', r.handled === true)
check('echo আছে', typeof r.echo === 'string' && r.echo.length > 0)
check('ঠিক ১টা মেসেজ গেছে', sent.length === 1)
const b1 = sent[0]?.body as { message?: { text?: string; quick_replies?: { title?: string; payload?: string }[] } } | null
check('হোম-টেক্সটে "মূল মেনুতে ফিরে" আছে', Boolean(b1?.message?.text?.includes(homeTextBn)))
const qr = b1?.message?.quick_replies || []
check('৫টা মূল বাটন (মেনু/অফার/লোকেশন/হেল্পলাইন/টেক্সট মেনু)', qr.length === 5)
check('চিপে __MENU__ আছে', qr.some((q) => q.payload === '__MENU__'))
check('চিপে __HOME__ নেই (হোমের ভেতরে back অর্থহীন)', !qr.some((q) => q.payload === '__HOME__'))

/* ── 4. Regress: __MENU__ অ্যাকশন আগের মতোই কার্ড/চিপ path নেয় ── */
console.log('\n[4] Regression: MENU action still works (DB fail → fallback text path)')
const sent2: { body: unknown }[] = []
;(globalThis as { fetch: unknown }).fetch = (async (_u: unknown, init?: { body?: string }) => {
  sent2.push({ body: init?.body ? JSON.parse(init.body) : null })
  return new Response(JSON.stringify({ recipient_id: 'X', message_id: 'm' }), { status: 200 })
}) as unknown
const r2 = await handleBotUiAction('PSID1', 'bn', BOT_ACTIONS.MENU)
check('MENU handled=true', r2.handled === true)
check('কমপক্ষে ১টা মেসেজ গেছে (DB না চললেও fallback টেক্সট)', sent2.length >= 1)
const b2 = sent2[0]?.body as { message?: { quick_replies?: { payload?: string }[] } } | null
const qr2 = b2?.message?.quick_replies || []
check('মেনু-চিপের শেষে ⬅️ পেছনে (__HOME__ payload)', qr2.some((q) => q.payload === '__HOME__'))

/* ── 5. Meta persistent-menu flat schema (Task 30 regression-guard) ── */
console.log('\n[5] setPersistentMenu — flat call_to_actions (no nested)')
const graphBodies: unknown[] = []
;(globalThis as { fetch: unknown }).fetch = (async (_u: unknown, init?: { body?: string }) => {
  graphBodies.push(init?.body ? JSON.parse(init.body) : null)
  return new Response('{}', { status: 200 })
}) as unknown
const { setPersistentMenu } = await import('../src/lib/messenger')
const res = await setPersistentMenu(
  [
    { title: '🍕 মেনু', payload: '__MENU__' },
    { title: '🏠 হোম', payload: '__HOME__' },
  ],
  { getStartedPayload: '__MENU__', greeting: 'স্বাগতম' }
)
check('sync ok', res.ok === true)
check('buttons=2', res.buttons === 2)
const menuBody = graphBodies.find((g) => (g as { persistent_menu?: unknown })?.persistent_menu) as
  | { persistent_menu?: { call_to_actions?: { type?: string; payload?: string }[] }[] }
  | undefined
const actions = menuBody?.persistent_menu?.[0]?.call_to_actions || []
check('2 buttons flat', actions.length === 2)
check('সব বাটন type=postback', actions.every((a) => a.type === 'postback'))
check('nested টাইপ নেই (Meta এখন বাতিল করেছে)', !JSON.stringify(actions).includes('nested'))
check('__HOME__ বাটন payload-এ আছে', actions.some((a) => a.payload === '__HOME__'))
check('get_started আগে গেছে (২ ধাপের প্রথম কল)', Boolean((graphBodies[0] as { get_started?: unknown })?.get_started))

console.log(`\n═══ ${passed} passed, ${failed} failed ═══`)
process.exit(failed ? 1 : 0)
