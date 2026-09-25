// Test: fetchPersistentMenuStatus (Meta লাইভ-চেক) — bun scripts/test-menu-status.ts
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

const { fetchPersistentMenuStatus, sanitizeMenuTitle } = await import('../src/lib/messenger')

/* ── 1. flat নতুন মেনু (Meta নতুন স্কিমা) ── */
console.log('\n[1] Flat menu parse')
;(globalThis as { fetch: unknown }).fetch = (async () =>
  new Response(
    JSON.stringify({
      data: [
        {
          persistent_menu: [
            {
              locale: 'default',
              call_to_actions: [
                { type: 'postback', title: '🍕 মেনু', payload: '__MENU__' },
                { type: 'postback', title: '🏠 হোম', payload: '__HOME__' },
              ],
            },
          ],
          get_started: { payload: '__MENU__' },
        },
      ],
    }),
    { status: 200 }
  )) as unknown
let s = await fetchPersistentMenuStatus()
check('ok=true', s.ok)
check('2 buttons', s.buttons.length === 2)
check('hasGetStarted=true', s.hasGetStarted)
check('title মেলে', s.buttons[0]?.title === '🍕 মেনু')

/* ── 2. পুরনো nested মেনু — ভেতরের বাটনও দেখানো হয় ── */
console.log('\n[2] Nested (old) menu flatten')
;(globalThis as { fetch: unknown }).fetch = (async () =>
  new Response(
    JSON.stringify({
      data: [
        {
          persistent_menu: [
            {
              locale: 'default',
              call_to_actions: [
                { type: 'postback', title: 'শুরু', payload: 'S' },
                {
                  type: 'nested',
                  title: 'আরও',
                  call_to_actions: [
                    { type: 'postback', title: 'অফার', payload: 'O' },
                    { type: 'web_url', title: 'সাইট', url: 'https://x.y' },
                  ],
                },
              ],
            },
          ],
        },
      ],
    }),
    { status: 200 }
  )) as unknown
s = await fetchPersistentMenuStatus()
check('ok=true', s.ok)
check('nested ভেতরসহ 3 buttons (শুরু + অফার + সাইট)', s.buttons.length === 3)
check('nested টাইপ মার্ক হয়', s.buttons.some((b) => b.type === 'nested'))
check('hasGetStarted=false (get_started নেই)', !s.hasGetStarted)

/* ── 3. Graph error ── */
console.log('\n[3] Graph error')
;(globalThis as { fetch: unknown }).fetch = (async () =>
  new Response(JSON.stringify({ error: { message: '(#190) Invalid access token' } }), { status: 401 })) as unknown
s = await fetchPersistentMenuStatus()
check('ok=false', !s.ok)
check('error টেক্সট ধরা পড়েছে', (s.error || '').includes('#190'))

/* ── 4. টাইটেল-তুলনা: ☎️-এর variation selector থাকলেও মিলবে ── */
console.log('\n[4] Title comparison hygiene')
const dbTitle = sanitizeMenuTitle('☎️ হেল্পলাইন') // U+FE0F সহ
const metaTitle = sanitizeMenuTitle('☎ হেল্পলাইন') // Meta কাটা ভার্সন
check('দুই পাশে একই স্যানিটাইজ → মিল', dbTitle === metaTitle)
check('control char স্যানিটাইজ', sanitizeMenuTitle('🍕\nমেনু') === '🍕 মেনু')

console.log(`\n═══ ${passed} passed, ${failed} failed ═══`)
process.exit(failed ? 1 : 0)
