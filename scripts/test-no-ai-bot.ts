// Test: মালিকের নির্দেশ (Task 36) — Messenger-এ AI সম্পূর্ণ বাদ
// bun scripts/test-no-ai-bot.ts
//
// যাচাই হয়:
//  ১) 📍 লোকেশন / ☎️ হেল্পলাইন — AI ছাড়াই admin-এর লেখা তথ্য থেকে ইনস্ট্যান্ট উত্তর
//  ২) ফ্রি-টেক্সটের উত্তরও বিশুদ্ধ DB-নির্ভর (buildStaticReply — AI কলের সুযোগই নেই)
//  ৩) webhook-এ reaction (লাইক) এলেও মেনু-বাটন যায়
//  ৪) webhook সোর্সে আর কোনো AI ইম্পোর্ট/কল নেই (গঠনগত গার্ড)
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

/* ── 1. mock fetch ── */
const sent: { url: string; body: Record<string, unknown> }[] = []
;(globalThis as { fetch: unknown }).fetch = (async (url: unknown, init?: { body?: string }) => {
  sent.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : {} })
  return new Response(JSON.stringify({ recipient_id: 'X', message_id: 'm' }), { status: 200 })
}) as unknown

const { handleBotUiAction, botActionFromText, isGreetingText, BOT_ACTIONS } = await import('../src/lib/bot-ui')
const { buildStaticReply } = await import('../src/lib/bot-static')

/* ── 2. 📍/☎️ ইনফো-অ্যাকশন — AI ছাড়াই handled ── */
console.log('\n[2] LOCATION/HELPLINE — sendInfoAction (AI ছাড়া ইনস্ট্যান্ট DB-উত্তর)')
sent.length = 0
const loc = await handleBotUiAction('PSID_LOC', 'bn', BOT_ACTIONS.LOCATION)
check('LOCATION → handled:true (aiReply param ছাড়াই)', loc.handled === true)
check('LOCATION → উত্তর গেছে (send কল হয়েছে)', sent.length > 0)
{
  const b = sent[sent.length - 1]?.body as { message?: { text?: string; quick_replies?: unknown[] } }
  check('LOCATION উত্তরে 📍 আছে', !!b?.message?.text && b.message.text.includes('📍'))
  check('LOCATION উত্তরের নিচে মেনু-বাটন (সবসময়-বাটন নিয়ম)', (b?.message?.quick_replies?.length || 0) >= 5)
}
sent.length = 0
const hel = await handleBotUiAction('PSID_HEL', 'bn', BOT_ACTIONS.HELPLINE)
check('HELPLINE → handled:true', hel.handled === true)
{
  const b = sent[sent.length - 1]?.body as { message?: { text?: string } }
  check('HELPLINE উত্তরে ☎️ আছে', !!b?.message?.text && b.message.text.includes('☎️'))
}

/* ── 3. topic-মোড — admin তথ্য খালি হলেও মর্যাদার উত্তর ── */
console.log('\n[3] buildStaticReply topic-মোড')
const locText = await buildStaticReply({ lang: 'bn', message: '', topic: 'location' })
check('location → 📍 হেড আছে', locText.includes('📍'))
check('location → খালি তথ্যে staticInfoMissing fallback', locText.length > 10)
const helText = await buildStaticReply({ lang: 'en', message: '', topic: 'helpline' })
check('helpline (en) → ☎️ হেড আছে', helText.includes('☎️'))

/* ── 4. ফ্রি-টেক্সট উত্তরও DB-নির্ভর — AI কল অসম্ভব ── */
console.log('\n[4] buildStaticReply ফ্রি-টেক্সট — কখনো ফাঁকা নয়, কখনো "system problem" নয়')
for (const msg of ['amar khida legeche', 'tomar dam koto?', 'xyzabc123', 'ki khobor?']) {
  const r = await buildStaticReply({ lang: 'bn', message: msg })
  check(`"${msg}" → উত্তর আছে (${r.length} chars)`, !!r && r.length > 10 && !/system problem|পরে লিখুন/i.test(r))
}

/* ── 5. টেক্সট-ইনটেন্ট রিগ্রেশন ── */
console.log('\n[5] টেক্সট-ইনটেন্ট রিগ্রেশন')
check('"লোকেশন" → LOCATION', botActionFromText('লোকেশন') === BOT_ACTIONS.LOCATION)
check('"address" → LOCATION', botActionFromText('address') === BOT_ACTIONS.LOCATION)
check('"helpline" → HELPLINE', botActionFromText('helpline') === BOT_ACTIONS.HELPLINE)
check('"যোগাযোগ" → HELPLINE', botActionFromText('যোগাযোগ') === BOT_ACTIONS.HELPLINE)
check('"hi" → greeting (instant বাটন-পথ)', isGreetingText('hi'))
check('"kemon achen" → greeting', isGreetingText('kemon achen'))

/* ── 6. webhook গঠনগত গার্ড — AI সম্পূর্ণ বাদ + reaction handler আছে ── */
console.log('\n[6] webhook সোর্স গার্ড (AI নেই, reaction আছে)')
const fs = await import('fs')
const wh = fs.readFileSync('src/app/api/webhook/messenger/route.ts', 'utf-8')
check('webhook-এ chatWithCustomer নেই', !wh.includes('chatWithCustomer'))
check('webhook-এ verificationChat নেই', !wh.includes('verificationChat'))
check('webhook-এ aiChatEnabled নেই', !wh.includes('aiChatEnabled'))
check('webhook-এ getGeminiConfig নেই', !wh.includes('getGeminiConfig'))
check('webhook-এ startBotTyping/aiGeneralReply নেই', !wh.includes('startBotTyping') && !wh.includes('aiGeneralReply'))
check('webhook-এ message_reactions handler আছে', wh.includes('event.message_reactions?.length'))
check('webhook-এ buildStaticReply (instant DB উত্তর) আছে', wh.includes('buildStaticReply'))
check('webhook-এ isGreetingText fast-path আছে', wh.includes('isGreetingText'))
const botUi = fs.readFileSync('src/lib/bot-ui.ts', 'utf-8')
check('bot-ui-তে sendInfoAction আছে (sendAiActionReply বাদ)', botUi.includes('sendInfoAction') && !botUi.includes('sendAiActionReply'))

/* ── 7. নতুন টেক্সট-কি ৪ ভাষাতেই আছে ── */
console.log('\n[7] staticLocationHead / staticHelplineHead / staticInfoMissing — ৪ প্যাক')
const packs = await import('../src/lib/bot-text')
for (const lang of ['bn', 'banglish', 'en', 'hi'] as const) {
  for (const key of ['staticLocationHead', 'staticHelplineHead', 'staticInfoMissing']) {
    const v = packs.t(lang, key)
    check(`${lang}.${key} আছে`, v !== key && v.length > 5)
  }
}

console.log(`\n════════════════════════════════`)
console.log(`PASS: ${passed}  FAIL: ${failed}`)
console.log(`════════════════════════════════`)
if (failed > 0) process.exit(1)
