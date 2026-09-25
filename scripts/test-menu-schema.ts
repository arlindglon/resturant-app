// Verify setPersistentMenu's outgoing JSON against Meta's NEW persistent-menu schema:
// flat call_to_actions (≤20), postback/web_url only, NO "nested" type.
import { setPersistentMenu, deletePersistentMenu } from '../src/lib/messenger'

const origFetch = globalThis.fetch
const captured: { url: string; method: string; body?: unknown }[] = []

// @ts-expect-error — test stub
globalThis.fetch = async (url: string | URL, init?: RequestInit) => {
  const u = String(url)
  if (u.includes('graph.facebook.com')) {
    captured.push({ url: u.split('?')[0], method: init?.method || 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined })
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  return origFetch(url as never, init)
}

process.env.META_PAGE_TOKEN = 'TEST_TOKEN'

const entries = [
  { title: '🍕 মেনু', payload: '__MENU__' },
  { title: '🔥 অফার', payload: '__OFFERS__' },
  { title: '📍 লোকেশন', payload: '__LOCATION__' },
  { title: '☎️ হেল্পলাইন', payload: '__HELPLINE__' },
  { title: '📄 টেক্সট মেনু', payload: '__TEXTMENU__' },
  { title: '🎁 প্রোমো', payload: '__ACT__:abc123' },
  { title: '🍱 সেট মেনু', payload: '__CAT__:cat9' },
  { title: '  bad\ncontrol\uFE0F ', payload: '__MENU__' }, // hygiene test
]

const r = await setPersistentMenu(entries, { getStartedPayload: '__MENU__', greeting: 'আসসালামু আলাইকুম!' })

let ok = true
function check(name: string, cond: boolean) {
  console.log(cond ? `✅ ${name}` : `❌ ${name}`)
  if (!cond) ok = false
}

check('sync ok', r.ok)
check('button count = 8', r.buttons === 8)

const menuCall = captured.find((c) => c.body && typeof c.body === 'object' && 'persistent_menu' in (c.body as object))
check('persistent_menu call happened', !!menuCall)
const menu = (menuCall?.body as { persistent_menu: { locale: string; composer_input_disabled: boolean; call_to_actions: { type: string; title: string; payload: string }[] }[] })?.persistent_menu?.[0]
check('locale default', menu?.locale === 'default')
check('composer enabled', menu?.composer_input_disabled === false)
check('flat 8 buttons sent', menu?.call_to_actions?.length === 8)
check('NO nested type anywhere', menu?.call_to_actions?.every((b) => b.type !== 'nested'))
check('all postback', menu?.call_to_actions?.every((b) => b.type === 'postback'))
check('all titles non-empty ≤20', menu?.call_to_actions?.every((b) => b.title.length > 0 && b.title.length <= 20))
check('all payloads non-empty ≤1000', menu?.call_to_actions?.every((b) => b.payload.length > 0 && b.payload.length <= 1000))
const hyg = menu?.call_to_actions?.[7]?.title
check(`title hygiene ("${hyg}")`, hyg === 'bad control')

const pre = captured.find((c) => c.body && typeof c.body === 'object' && 'get_started' in (c.body as object))
check('get_started sent BEFORE menu', !!pre && captured.indexOf(pre) < captured.indexOf(menuCall!))

// 3-entry config — flat 3 (the old failing case is now a flat list, no nested)
captured.length = 0
const r3 = await setPersistentMenu([
  { title: '🍕 মেনু', payload: '__MENU__' },
  { title: '🔥 অফার', payload: '__OFFERS__' },
  { title: '📍 লোকেশন', payload: '__LOCATION__' },
])
const m3 = (captured.find((c) => c.body && 'persistent_menu' in (c.body as object))?.body as { persistent_menu: { call_to_actions: unknown[] }[] })?.persistent_menu?.[0]
check('3-entry sync ok', r3.ok && r3.buttons === 3)
check('3-entry flat, no nested', m3?.call_to_actions?.length === 3 && JSON.stringify(m3).includes('nested') === false)

// empty/invalid entries → clean error, no Graph call
captured.length = 0
const r0 = await setPersistentMenu([{ title: '', payload: '' }])
check('empty entries rejected locally', !r0.ok && !!r0.error)
check('no Graph call for empty', captured.length === 0)

console.log('--- sample outgoing persistent_menu (5 entries) ---')
const m5 = await setPersistentMenu(entries.slice(0, 5))
const mb = captured.filter((c) => c.body && 'persistent_menu' in (c.body as object)).at(-1)?.body
console.log(JSON.stringify(mb, null, 2).slice(0, 900))
void m5
void deletePersistentMenu
console.log(ok ? '\n🎉 ALL CHECKS PASSED' : '\n💥 CHECKS FAILED')
process.exit(ok ? 0 : 1)
