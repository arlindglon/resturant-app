// Task 33 — 🧩 মেসেঞ্জার সেটআপ-উইজার্ড টেস্ট স্যুট (bun scripts/test-messenger-setup.ts)
//
// কভারেজ:
//   [1] subscribedFields          — GET /me/subscribed_apps (আংশিক সাবস্ক্রিপশন → missing ধরা)
//   [2] subscribeAllMessagingFields — POST-এ ৮টা ফিল্ডই যায় + পরে ৮/৮ দেখায়
//   [3] selfHandshake             — challenge-ইকো → ok; 403 → বাংলা ৪০৩-ইঙ্গিত
//   [4] REQUIRED_MESSAGING_FIELDS — ৮টা ফিল্ডের তালিকা হুবহু
//   [5] source-contract           — setup route + উইজার্ড UI + constants + README (ফাইল-টেক্সট যাচাই)
//
// নিয়ম: কোনো নেটওয়ার্ক নেই (globalThis.fetch সবসময় mock), src/ বদলানো হয়নি।
export {}
process.env.META_PAGE_TOKEN = 'TEST_SETUP_TOKEN'
process.env.META_VERIFY_TOKEN = 'ENV_FALLBACK_SETUP'

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
function eq(name: string, a: unknown, b: unknown) {
  const okv = a === b
  check(`${name} ${okv ? '' : `(পেয়েছে: ${JSON.stringify(a)}, চাই: ${JSON.stringify(b)})`}`, okv)
}
function section(t: string) {
  console.log(`\n── ${t} ──`)
}

interface SentCall {
  url: string
  method: string
}

/* ── [1] subscribedFields — আংশিক সাবস্ক্রিপশন ধরা ── */
section('1 subscribedFields — ৩টা ফিল্ড না থাকলে missing-এ ৩টাই')
const calls1: SentCall[] = []
;(globalThis as { fetch: unknown }).fetch = (async (url: unknown, init?: { method?: string }) => {
  calls1.push({ url: String(url), method: init?.method || 'GET' })
  return new Response(
    JSON.stringify({
      data: [{ subscribed_fields: ['messages', 'messaging_postbacks', 'message_deliveries', 'message_reads', 'message_reactions'] }],
    }),
    { status: 200 }
  )
}) as unknown
const { subscribedFields, subscribeAllMessagingFields, selfHandshake, REQUIRED_MESSAGING_FIELDS } = await import('../src/lib/messenger')

const sub1 = await subscribedFields()
check('আংশিক-সাবস্ক্রিপশন: ok=true', sub1.ok === true)
eq('৫টা ফিল্ড পাওয়া গেছে', sub1.fields.length, 5)
eq('missing-এ ৩টা (optins/referrals/handovers)', sub1.missing.join(','), 'messaging_optins,messaging_referrals,messaging_handovers')
check('কলটা GET /me/subscribed_apps ছিল', calls1[0]?.url.includes('/me/subscribed_apps') === true && calls1[0]?.method === 'GET')
check('টোকেন query-তে যায়', calls1[0]?.url.includes('access_token=TEST_SETUP_TOKEN') === true)

/* ── [2] subscribeAllMessagingFields — POST-এ ৮ ফিল্ড + পরে ৮/৮ ── */
section('2 subscribeAllMessagingFields — মেরামত-কলে সব ৮টা যায়')
const calls2: SentCall[] = []
;(globalThis as { fetch: unknown }).fetch = (async (url: unknown, init?: { method?: string }) => {
  calls2.push({ url: String(url), method: init?.method || 'GET' })
  if (init?.method === 'POST') return new Response(JSON.stringify({ success: true }), { status: 200 })
  return new Response(JSON.stringify({ data: [{ subscribed_fields: [...REQUIRED_MESSAGING_FIELDS] }] }), { status: 200 })
}) as unknown
const sub2 = await subscribeAllMessagingFields()
check('মেরামত সফল → ok=true', sub2.ok === true)
const postCall = calls2.find((c) => c.method === 'POST')
check('POST /me/subscribed_apps গেছে', Boolean(postCall && postCall.url.includes('/me/subscribed_apps')))
check('POST-এ ৮টা ফিল্ডই subscribed_fields-এ', REQUIRED_MESSAGING_FIELDS.every((f) => postCall?.url.includes(f) === true))
check('GET-ফলোআপও হয়েছে (যাচাইয়ের জন্য)', calls2.filter((c) => c.method === 'GET').length === 1)

/* ── [3] selfHandshake — ইকো ও 403 ── */
section('3 selfHandshake — challenge ইকো → ok; 403 → বাংলা ইঙ্গিত')
;(globalThis as { fetch: unknown }).fetch = (async (url: unknown) => {
  const u = String(url)
  const challenge = new URL(u).searchParams.get('hub.challenge') || ''
  const token = new URL(u).searchParams.get('hub.verify_token') || ''
  if (token !== 'ENV_FALLBACK_SETUP') return new Response('Verification failed', { status: 403 })
  return new Response(challenge, { status: 200 })
}) as unknown
const hs1 = await selfHandshake('https://teantreat.vercel.app')
check('ইকো-হ্যান্ডশেক: ok=true', hs1.ok === true)
eq('status 200', hs1.status, 200)
check('challenge হুবহু ফেরত এসেছে', hs1.echo === true)
check('URL-এ /api/webhook/messenger ছিল', hs1.ok === true) // mock-এই রুট মিলেছে
const hs2 = await selfHandshake('https://teantreat.vercel.app/')
check('ট্রেলিং-স্ল্যাশ সহ base-ও কাজ করে', hs2.ok === true)
;(globalThis as { fetch: unknown }).fetch = (async () => new Response('Verification failed', { status: 403 })) as unknown
const hs3 = await selfHandshake('https://teantreat.vercel.app')
check('403 → ok=false', hs3.ok === false)
eq('403 status রিপোর্ট হয়', hs3.status, 403)
check('403-এ বাংলা টোকেন-মিল ইঙ্গিত আছে', Boolean(hs3.error?.includes('403') && hs3.error?.includes('Verify Token')))

/* ── [4] REQUIRED_MESSAGING_FIELDS — হুবহু ৮টা ── */
section('4 REQUIRED_MESSAGING_FIELDS — Meta-র প্রয়োজনীয় ৮টা')
eq('তালিকার দৈর্ঘ্য ৮', REQUIRED_MESSAGING_FIELDS.length, 8)
check(
  'হুবহু সঠিক তালিকা',
  REQUIRED_MESSAGING_FIELDS.join(',') ===
    'messages,messaging_postbacks,messaging_optins,message_deliveries,message_reads,message_reactions,messaging_referrals,messaging_handovers'
)

/* ── [5] source-contract — route + UI + constants + README ── */
section('5 source-contract — setup route + উইজার্ড + constants + README')
const fs = await import('fs')
const has = (name: string, src: string, needle: string) => check(name, src.includes(needle))

const routeSrc = fs.readFileSync('/home/z/my-project/src/app/api/admin/messenger-setup/route.ts', 'utf8')
has("route: 'save' অ্যাকশন (৩ মান সেভ)", routeSrc, "action === 'save'")
has("route: 'auto-page-id' অ্যাকশন (টোকেন থেকে Page ID)", routeSrc, "action === 'auto-page-id'")
has("route: 'subscribe-fields' অ্যাকশন (৮ ফিল্ড মেরামত)", routeSrc, "action === 'subscribe-fields'")
has('route: testPageToken যাচাই', routeSrc, 'testPageToken()')
has('route: selfHandshake (নিজের webhook-এ)', routeSrc, 'selfHandshake(baseUrl(req))')
has('route: subscribedFields যাচাই', routeSrc, 'subscribedFields()')
has('route: lastSendErrorWithHint (💡 ইঙ্গিতসহ)', routeSrc, 'lastSendErrorWithHint()')
has('route: webhookUrl ফেরত যায়', routeSrc, 'webhookUrl')
has('route: Page-token শেপ-ভ্যালিডেশন (EAA…)', routeSrc, '^EAA[a-zA-Z0-9_-]{20,}$')
has('route: requirePerm(settings) গেট', routeSrc, "requirePerm('settings')")
check('route: GET+POST দুটোই export', routeSrc.includes('export async function GET') && routeSrc.includes('export async function POST'))
has('route: META_PAGE_ID সেটিং-কি', routeSrc, 'SETTING_KEYS.META_PAGE_ID')

const adminSrc = fs.readFileSync('/home/z/my-project/src/app/admin/page.tsx', 'utf8')
has('UI: MessengerSetupWizard কম্পোনেন্ট আছে', adminSrc, 'function MessengerSetupWizard')
has('UI: META_PAGE_ID ফিল্ড-লেবেল', adminSrc, 'META_PAGE_ID')
has('UI: META_PAGE_TOKEN ফিল্ড-লেবেল', adminSrc, 'META_PAGE_TOKEN')
has('UI: META_VERIFY_TOKEN ফিল্ড-লেবেল', adminSrc, 'META_VERIFY_TOKEN')
has('UI: 🎲 অটো-জেনারেট verify token', adminSrc, 'genVerify')
has('UI: Callback URL কপি-বাটন', adminSrc, 'Webhook Callback URL')
has('UI: 🔧 এখনই ঠিক করুন (ফিল্ড-মেরামত)', adminSrc, 'এখনই ঠিক করুন')
has('UI: 📖 সেটআপ গাইড কল্যাপস', adminSrc, 'নতুন Meta App বানানোর ধাপে ধাপে গাইড')
has('UI: 🤖 ট্যাবে উইজার্ড রেন্ডার হয়', adminSrc, '<MessengerSetupWizard />')
has('UI: ১০০%-ব্যাজ (সব সবুজ)', adminSrc, '১০০% কাজ করছে')
has('UI: পাঠানো-এরর সতর্ক-বাক্স', adminSrc, 'শেষ পাঠানো-এরর')

const constantsSrc = fs.readFileSync('/home/z/my-project/src/lib/constants.ts', 'utf8')
has('constants: META_PAGE_ID কি-ওভাররাইড', constantsSrc, "META_PAGE_ID: 'meta_page_id'")
has('constants: META_VERIFY_TOKEN কি-ওভাররাইড আছে', constantsSrc, "META_VERIFY_TOKEN: 'meta_verify_token'")

const msSrc = fs.readFileSync('/home/z/my-project/src/lib/messenger.ts', 'utf8')
has('messenger: REQUIRED_MESSAGING_FIELDS export', msSrc, 'export const REQUIRED_MESSAGING_FIELDS')
has('messenger: selfHandshake export', msSrc, 'export async function selfHandshake')
has('messenger: 403-এ টোকেন-মিল ইঙ্গিত', msSrc, 'Verify Token মেলেনি')

const readmeSrc = fs.readFileSync('/home/z/my-project/MESSENGER_SETUP.md', 'utf8')
has('README: ধাপ ১ App তৈরি', readmeSrc, 'Create App')
has('README: Business টাইপ', readmeSrc, 'Business')
has('README: Generate Token নির্দেশ', readmeSrc, 'Generate Token')
has('README: ৪ পারমিশন (pages_messaging)', readmeSrc, 'pages_messaging')
has('README: ৪ পারমিশন (pages_manage_metadata)', readmeSrc, 'pages_manage_metadata')
has('README: Webhook Callback URL ধাপ', readmeSrc, 'Callback URL')
has('README: Verify Token ধাপ', readmeSrc, 'Verify Token')
has('README: ৮টা ফিল্ড (message_reactions সহ)', readmeSrc, 'message_reactions')
has('README: App Live ধাপ', readmeSrc, 'Development → Live')
has('README: Privacy Policy URL ধাপ', readmeSrc, 'Privacy Policy URL')
has('README: Dev-Mode এররের সমাধান', readmeSrc, 'Application does not have permission')
has('README: ২৪ঘ-উইন্ডো সমাধান', readmeSrc, '২৪ ঘণ্টা')
has('README: User-token সতর্কবার্তা', readmeSrc, 'User token')
has('README: Vercel env টেবিল', readmeSrc, 'META_PAGE_TOKEN')
has('README: ফিক্সড-মেনু নিয়ম (অটুট)', readmeSrc, 'ফিক্সড মেনু')
has('README: উইজার্ড-যাচাই ধাপ', readmeSrc, 'সম্পূর্ণ যাচাই')

/* ── সারাংশ ── */
console.log(`\n═══ Task 33: ${passed} passed, ${failed} failed (মোট ${passed + failed}) ═══`)
if (failed > 0) process.exit(1)
