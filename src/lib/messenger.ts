// Meta Messenger Graph API helpers (CRM)
import { getSetting, setSettings } from '@/lib/settings'
import { SETTING_KEYS } from '@/lib/constants'

const GRAPH = 'https://graph.facebook.com/v21.0'

// ── send-error diagnostics ─────────────────────────────────────────────────
// আগে প্রতিটা পাঠানো ব্যর্থতা নিঃশব্দে false রিটার্ন করত — মালিক শুধু দেখতেন
// "মেসেজ যায়নি" কিন্তু কেন যায়নি জানতেন না। এখন প্রতিটা Graph-রিজেকশনের
// হুবহু error মেসেজ এই সেটিং-এ জমা হয় — admin সেটিংস/টেস্ট প্যানেলে দেখা যায়।
export const KEY_LAST_SEND_ERROR = 'messenger_last_send_error'
let lastSendErrWrite = 0
let lastSendErrText = ''
function recordSendError(msg: string, psid?: string) {
  const text = `${new Date().toISOString()} — ${msg}${psid ? ` (psid: ${psid})` : ''}`.slice(0, 500)
  if (text === lastSendErrText && Date.now() - lastSendErrWrite < 30_000) return
  lastSendErrWrite = Date.now()
  lastSendErrText = text
  setSettings({ [KEY_LAST_SEND_ERROR]: text }).catch(() => {})
}

/** রিপ্লাই/টেস্টে ব্যবহারের জন্য হুবহু Graph error → মানব-পাঠযোগ্য বাংলা ইঙ্গিত */
export function sendErrorHint(msg: string): string {
  const m = (msg || '').toLowerCase()
  if (/not admins, developers or testers|not authorized to.*message|cannot message users/.test(m))
    return 'Meta App এখন Development Mode-এ আছে — শুধু app admin/developer/tester-রা মেসেজ পান। Meta App Dashboard → App Settings → অ্যাপটি Live করুন (Privacy Policy URL দিতে হয়)।'
  if (/pages_messaging|does not have permission|requires.*permission|permission.*required/.test(m))
    return 'টোকেনে pages_messaging পারমিশন নেই — Meta Dashboard → App Review → Permissions-এ pages_messaging (Advanced Access) চান, অথবা টোকেন আবার Generate করুন।'
  if (/outside.*window|24.?hour|window.*expired|messaging window/.test(m))
    return '২৪ ঘণ্টার মেসেজিং-উইন্ডো শেষ — কাস্টমার শেষ মেসেজ করার ২৪ ঘণ্টার ভেতরেই খোলা টেক্সট যায়। এর বাইরে পাঠাতে হলে কাস্টমারকে 🔔 RN অপট-ইন করান (ব্রডকাস্ট ট্যাব)।'
  if (/recipient|no matching user|invalid.*recipient/.test(m))
    return 'এই PSID-এ কেউ নেই — কাস্টমার অন্য পেজে কথা বলছিল বা PSID ভুল।'
  if (/token|session|expired|invalid oauth/i.test(m))
    return 'পেজ টোকেন মেয়াদোত্তীর্ণ/অবৈধ — Meta Dashboard-এ নতুন Page Access Token বানিয়ে Vercel env-এ META_PAGE_TOKEN আপডেট করুন।'
  return ''
}

/**
 * লাইভ পাঠানো-প্রোব: বাস্তবে একটা ছোট মেসেজ পাঠিয়ে হুবহু Graph error ধরা —
 * admin messenger-test প্যানেল এটা দেখায়; নইলে "যায়নি" ছাড়া কারণ জানা যেত না।
 */
export async function probeSend(psid: string, text = '✅ মেসেঞ্জার সংযোগ পরীক্ষা — সিস্টেম ঠিকঠাক কাজ করছে।'): Promise<{ ok: boolean; error: string | null; hint: string | null }> {
  const token = await pageToken()
  if (!token) return { ok: false, error: 'META_PAGE_TOKEN সেট করা নেই (Vercel env)', hint: null }
  try {
    const res = await fetch(`${GRAPH}/me/messages?access_token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient: { id: psid }, message: { text } }),
      signal: AbortSignal.timeout(10_000),
    })
    const j = (await res.json().catch(() => ({}))) as { error?: { message?: string; code?: number } }
    if (!res.ok || j.error) {
      const msg = j.error?.message || `Graph API HTTP ${res.status}`
      recordSendError(msg, psid)
      return { ok: false, error: msg, hint: sendErrorHint(msg) || null }
    }
    return { ok: true, error: null, hint: null }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'সংযোগ ব্যর্থ', hint: null }
  }
}

/**
 * Page Access Token রেজোলিউশন (প্রতিটা Graph কলে ব্যবহৃত):
 *  ১) admin সেটিং `messenger_page_token` — সেটিংস পেজ থেকে সেভ করা। মেয়াদ শেষ
 *     হলে (টোকেন রিজেনারেট) Vercel env ছোঁয়া/রিডিপ্লয় ছাড়াই এখান থেকে সঙ্গে
 *     সঙ্গে নতুন টোকেন কার্যকর হয় (৩০ সেকেন্ড ক্যাশ; সেভ করলেই ক্যাশ রিফ্রেশ)।
 *  ২) না থাকলে Vercel env META_PAGE_TOKEN (পুরনো পথ — backward compatible)।
 * DB-blip হলেও env-এ ফেরা — বট কখনো টোকেন-শূন্য হয়ে চুপ করে থাকে না।
 */
async function pageToken(): Promise<string> {
  try {
    const adminTok = (await getSetting(SETTING_KEYS.MESSENGER_PAGE_TOKEN)).trim()
    if (adminTok) return adminTok
  } catch {
    /* DB blip → env fallback */
  }
  return process.env.META_PAGE_TOKEN || ''
}

/** admin প্যানেলের টোকেন-সোর্স ডায়াগনস্টিকস — টোকেন কখনোই পুরো ফেরায় না (শেষ ৬ অক্ষর) */
export async function pageTokenInfo(): Promise<{ source: 'admin' | 'env' | 'none'; tail: string }> {
  let adminTok = ''
  try {
    adminTok = (await getSetting(SETTING_KEYS.MESSENGER_PAGE_TOKEN)).trim()
  } catch {
    /* ignore */
  }
  if (adminTok) return { source: 'admin', tail: adminTok.slice(-6) }
  const envTok = (process.env.META_PAGE_TOKEN || '').trim()
  if (envTok) return { source: 'env', tail: envTok.slice(-6) }
  return { source: 'none', tail: '' }
}

export async function messengerConfigured(): Promise<boolean> {
  // Only the Page Token is functionally required: Graph /me/messages resolves
  // the page from the token itself. META_PAGE_ID is optional (informational).
  return Boolean(await pageToken())
}

export interface PageTokenTest {
  ok: boolean
  pageName: string | null
  pageId: string | null
  pageUsername: string | null
  error: string | null
}

/** Live-check the configured META_PAGE_TOKEN against Graph /me — tells WHICH page it belongs to */
export async function testPageToken(): Promise<PageTokenTest> {
  const token = await pageToken()
  if (!token)
    return { ok: false, pageName: null, pageId: null, pageUsername: null, error: 'META_PAGE_TOKEN সেট করা নেই (Vercel env)' }
  try {
    const res = await fetch(`${GRAPH}/me?fields=name,id,username&access_token=${encodeURIComponent(token)}`, {
      signal: AbortSignal.timeout(10_000),
    })
    const j = (await res.json()) as {
      name?: string
      id?: string
      username?: string
      error?: { message?: string; type?: string }
    }
    if (!res.ok || j.error) {
      const msg = j.error?.message || `Graph API HTTP ${res.status}`
      return { ok: false, pageName: null, pageId: null, pageUsername: null, error: msg }
    }
    return { ok: true, pageName: j.name || null, pageId: j.id || null, pageUsername: j.username || null, error: null }
  } catch (e) {
    return {
      ok: false,
      pageName: null,
      pageId: null,
      pageUsername: null,
      error: e instanceof Error ? e.message : 'সংযোগ ব্যর্থ',
    }
  }
}

/** throttled error log — never floods the logs when 40 customers fail at once */
let lastProfileLogAt = 0
let lastProfileLogMsg = ''
function logProfileError(psid: string, msg: string) {
  const now = Date.now()
  if (msg === lastProfileLogMsg && now - lastProfileLogAt < 30_000) return
  lastProfileLogAt = now
  lastProfileLogMsg = msg
  console.error('[messenger:profile]', psid, msg)
}

export interface MessengerProfile {
  firstName: string
  lastName: string
  profilePic: string | null
  ok: boolean
  error: string | null
}

/**
 * Fetch the customer's Facebook profile (first/last name + profile photo)
 * via the Page token. On failure returns ok:false with the exact Graph error
 * (also logged) — callers fall back gracefully (no fake "Customer" name).
 */
export async function fetchMessengerProfile(psid: string): Promise<MessengerProfile> {
  const token = await pageToken()
  if (!token) {
    return { firstName: '', lastName: '', profilePic: null, ok: false, error: 'META_PAGE_TOKEN সেট করা নেই' }
  }
  try {
    const res = await fetch(
      `${GRAPH}/${psid}?fields=first_name,last_name,profile_pic&access_token=${encodeURIComponent(token)}`,
      { signal: AbortSignal.timeout(10_000) }
    )
    const j = (await res.json()) as {
      first_name?: string
      last_name?: string
      profile_pic?: string
      error?: { message?: string }
    }
    if (!res.ok || j.error) {
      const msg = j.error?.message || `Graph API HTTP ${res.status}`
      logProfileError(psid, msg)
      return { firstName: '', lastName: '', profilePic: null, ok: false, error: msg }
    }
    return {
      firstName: j.first_name || '',
      lastName: j.last_name || '',
      profilePic: j.profile_pic || null,
      ok: true,
      error: null,
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'সংযোগ ব্যর্থ'
    logProfileError(psid, msg)
    return { firstName: '', lastName: '', profilePic: null, ok: false, error: msg }
  }
}

/** Legacy helper — first/last name, empty strings when the profile is unavailable */
export async function fetchProfileName(psid: string): Promise<{ firstName: string; lastName: string }> {
  const p = await fetchMessengerProfile(psid)
  return { firstName: p.firstName, lastName: p.lastName }
}

// profile-photo cache (admin CRM list — avoids a Graph call per row per load)
const photoCache = new Map<string, { pic: string | null; at: number; ok: boolean }>()
const PHOTO_TTL_OK = 10 * 60 * 1000
const PHOTO_TTL_FAIL = 60 * 1000

/** Profile photo URL for a PSID (10-min cache; null when unavailable) */
export async function fetchProfilePhoto(psid: string): Promise<string | null> {
  const hit = photoCache.get(psid)
  if (hit) {
    const ttl = hit.ok ? PHOTO_TTL_OK : PHOTO_TTL_FAIL
    if (Date.now() - hit.at < ttl) return hit.pic
  }
  const p = await fetchMessengerProfile(psid)
  photoCache.set(psid, { pic: p.profilePic, at: Date.now(), ok: p.ok })
  return p.profilePic
}

/**
 * "typing…" indicator — AI চিন্তা করার পুরো সময়টায় কাস্টমার যেন বুঝতে পারে
 * পেজ লিখছে (নইলে ৬০-৯০ সেকেন্ড নীরবতায় কাস্টমার ভাবে বট মরে গেছে)।
 * Meta-র নিয়ম: এক কলে ইন্ডিকেটর সর্বোচ্চ ~২০ সেকেন্ড থাকে — কলার ১২ সেকেন্ড
 * পরপর আবার পাঠায়; মেসেজ গেলে নিজে থেকেই মুছে যায়।
 */
export async function sendTypingOn(psid: string): Promise<boolean> {
  const token = await pageToken()
  if (!token) return false
  try {
    const res = await fetch(`${GRAPH}/me/messages?access_token=${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient: { id: psid }, sender_action: 'typing_on' }),
      signal: AbortSignal.timeout(5_000),
    })
    if (!res.ok) return false
    const j = (await res.json().catch(() => ({}))) as { error?: unknown }
    return !j.error
  } catch {
    return false
  }
}

/**
 * Send a plain text message to a PSID — returns REAL success (Graph errors count as failure).
 * opts.quickReplies দিলে মেসেজের নিচে মেনু-বাটন যুক্ত হয় (মালিকের নিয়ম: বটের প্রতিটা
 * উত্তরের নিচে বাটন সবসময় থাকবে)। চিপসহ রিজেক্ট হলে চিপ ছাড়া আরেকবার —
 * মেসেজ কখনো হারায় না।
 */
export async function sendText(
  psid: string,
  text: string,
  opts?: { markdown?: boolean; quickReplies?: QuickReply[] }
): Promise<boolean> {
  const token = await pageToken()
  if (!token) return false

  const chips = opts?.quickReplies?.length
    ? opts.quickReplies
        .slice(0, 11)
        .map((r) => ({ content_type: 'text', title: r.title.slice(0, 20), payload: r.payload.slice(0, 1000) }))
    : null

  const post = async (body: Record<string, unknown>): Promise<boolean> => {
    try {
      const res = await fetch(`${GRAPH}/me/messages?access_token=${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      })
      const j = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
      if (j.error?.message) recordSendError(j.error.message, psid)
      if (!res.ok) {
        if (!j.error?.message) recordSendError(`Graph API HTTP ${res.status}`, psid)
        return false
      }
      return !j.error
    } catch (e) {
      recordSendError(e instanceof Error ? e.message : 'সংযোগ ব্যর্থ', psid)
      return false
    }
  }

  // Messenger markdown (*bold*, _italic_, ~strike~, `code`): admin বন্ধ না করলে
  // text_format:markdown দিয়ে যায় — Graph কোনো কারণে রিজেক্ট করলে (নতুন ফিল্ড
  // না-মানা / ২৪ঘ উইন্ডো / যা-ই হোক) প্লেইন টেক্সট দিয়ে আরেকবার — মেসেজ কখনো হারায় না।
  const wantMd = opts?.markdown !== false && (await markdownEnabled())
  if (wantMd && (await post({ recipient: { id: psid }, message: { text, text_format: 'markdown', ...(chips ? { quick_replies: chips } : {}) } }))) {
    return true
  }
  if (await post({ recipient: { id: psid }, message: { text, ...(chips ? { quick_replies: chips } : {}) } })) {
    return true
  }
  // চিপসহ রিজেক্ট হলে চিপ ছাড়া শেষ চেষ্টা (quick_replies ফিল্ডই কোনো কারণে অগ্রাহ্য হলে)
  return chips ? post({ recipient: { id: psid }, message: { text } }) : false
}

/** Messenger markdown চালু আছে কি না (admin সেটিং; ৩০ সেকেন্ড ক্যাশ) */
export async function markdownEnabled(): Promise<boolean> {
  try {
    return (await getSetting(SETTING_KEYS.MESSENGER_MARKDOWN)) !== 'false'
  } catch {
    return true
  }
}

/** 1-tap phone number quick reply (Messenger shows SIM number above keyboard) */
export async function askPhoneQuickReply(psid: string, text: string): Promise<boolean> {
  const token = await pageToken()
  if (!token) return false
  try {
    const res = await fetch(`${GRAPH}/me/messages?access_token=${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: { id: psid },
        message: {
          text,
          quick_reply: {
            content_type: 'user_phone_number',
            title: '📱 নম্বর শেয়ার করুন',
            payload: 'SHARE_PHONE',
          },
        },
      }),
      signal: AbortSignal.timeout(10_000),
    })
    const j = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
    if (j.error?.message) recordSendError(j.error.message, psid)
    if (!res.ok) {
      if (!j.error?.message) recordSendError(`Graph API HTTP ${res.status}`, psid)
      return false
    }
    return !j.error
  } catch (e) {
    recordSendError(e instanceof Error ? e.message : 'সংযোগ ব্যর্থ', psid)
    return false
  }
}

/* ═══════════ Rich UI: Quick Replies / Carousel / Persistent Menu ═══════════ */

export interface QuickReply {
  title: string // ≤20 chars, shown as a tappable chip
  payload: string // our deterministic action key (bot-ui.ts)
}

/**
 * টেক্সট + নিচে ট্যাপযোগ্য কুইক-রিপ্লাই বাটন (সর্বোচ্চ ১১টা; Meta নিয়ম ≤20 অক্ষর টাইটেল)।
 * কাস্টমার টাইপ না করেই এক ট্যাপে মেনু/অফার/লোকেশন পায় — বট পেলোড দেখে
 * ডিটারমিনিস্টিক উত্তর দেয় (AI লেটেন্সি নেই)।
 */
export async function sendQuickReplies(psid: string, text: string, replies: QuickReply[]): Promise<boolean> {
  const token = await pageToken()
  if (!token) return false
  const chips = replies
    .slice(0, 11)
    .map((r) => ({ content_type: 'text', title: r.title.slice(0, 20), payload: r.payload.slice(0, 1000) }))
  try {
    const res = await fetch(`${GRAPH}/me/messages?access_token=${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: { id: psid },
        message: { text, quick_replies: chips },
      }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) {
      // quick_replies ফিল্ড কোনো কারণে রিজেক্ট হলে খালি টেক্সট দিয়ে আরেকবার —
      // মেসেজ কখনো হারায় না
      return sendText(psid, text)
    }
    const j = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
    if (j.error?.message) {
      recordSendError(j.error.message, psid)
      return sendText(psid, text)
    }
    return true
  } catch {
    return sendText(psid, text)
  }
}

export interface CarouselCard {
  title: string // ≤80 chars
  subtitle?: string // ≤80 chars
  imageUrl?: string | null
  buttonTitle?: string // ≤20 chars
  buttonUrl?: string // web_url button (when a public site URL is known)
  buttonPayload?: string // postback fallback (no URL configured)
}

/**
 * সোয়াইপ-করা যায় এমন খাবারের কার্ড-গ্যালারি (generic template) — ছবি + নাম +
 * দাম + [অর্ডার করুন] বাটন। ছবি-শেষ টেমপ্লেটে কুইক-রিপ্লাইও জুড়ে দেওয়া যায়।
 */
export async function sendGenericCarousel(psid: string, cards: CarouselCard[], replies: QuickReply[] = []): Promise<boolean> {
  const token = await pageToken()
  if (!token) return false
  const elements = cards.slice(0, 10).map((c) => {
    const buttons = [
      c.buttonUrl
        ? { type: 'web_url', url: c.buttonUrl, title: (c.buttonTitle || 'অর্ডার করুন').slice(0, 20) }
        : { type: 'postback', payload: (c.buttonPayload || '__ORDER__').slice(0, 1000), title: (c.buttonTitle || 'অর্ডার করুন').slice(0, 20) },
    ]
    const el: Record<string, unknown> = {
      title: c.title.slice(0, 80),
      buttons,
    }
    if (c.subtitle) el.subtitle = c.subtitle.slice(0, 80)
    if (c.imageUrl && /^https?:\/\//i.test(c.imageUrl)) el.image_url = c.imageUrl
    return el
  })
  const message: Record<string, unknown> = {
    attachment: {
      type: 'template',
      payload: { template_type: 'generic', elements },
    },
  }
  if (replies.length) {
    message.quick_replies = replies
      .slice(0, 11)
      .map((r) => ({ content_type: 'text', title: r.title.slice(0, 20), payload: r.payload.slice(0, 1000) }))
  }
  try {
    const res = await fetch(`${GRAPH}/me/messages?access_token=${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient: { id: psid }, message }),
      signal: AbortSignal.timeout(10_000),
    })
    const j = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
    if (j.error?.message) recordSendError(j.error.message, psid)
    if (!res.ok) {
      if (!j.error?.message) recordSendError(`Graph API HTTP ${res.status} (carousel)`, psid)
      return false
    }
    return !j.error
  } catch (e) {
    recordSendError(e instanceof Error ? e.message : 'সংযোগ ব্যর্থ (carousel)', psid)
    return false
  }
}

export interface MenuEntry {
  title: string // ≤20 chars (Meta এখন ৩০ পর্যন্ত দেয় — আমরা ২০-তেই ধরে রাখি)
  payload: string
}

/**
 * টাইটেল হাইজিন — control chars / variation selectors (☎️-এর U+FE0F) /
 * zero-width অক্ষর বাদ দিয়ে ≤২০ অক্ষর। Meta-র validator এসব অদৃশ্য অক্ষরে
 * কখনো কখনো অযৌক্তিকভাবে আটকে দেয়। (status route-ও DB vs Meta টাইটেল
 * তুলনায় একই ফাংশন ব্যবহার করে — নইলে ☎️-জাতীয় টাইটেলে মিল ভেঙে যায়)
 */
export function sanitizeMenuTitle(raw: string): string {
  return (raw || '')
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ') // control/newline → স্পেস (শব্দ জোড়া না লেগে যায়)
    .replace(/[\uFE0E\uFE0F\u200B-\u200D\u2060\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 20)
}

/** persistent_menu মুছে ফেলা (আটকে-থাকা পুরনো মেনু থেকে মুক্তি — retry-র আগে) */
export async function deletePersistentMenu(): Promise<boolean> {
  const token = await pageToken()
  if (!token) return false
  try {
    const res = await fetch(
      `${GRAPH}/me/messenger_profile?params=${encodeURIComponent('["persistent_menu"]')}&access_token=${encodeURIComponent(token)}`,
      { method: 'DELETE', signal: AbortSignal.timeout(10_000) }
    )
    return res.ok
  } catch {
    return false
  }
}

/**
 * Persistent Menu — চ্যাটবক্সের নিচে সবসময় থাকা ফিক্সড হ্যামবার্গার মেনু।
 *
 * ⚠️ Meta-র নতুন স্কিমা (২০২৫): `call_to_actions` এখন **সমতল (flat) অ্যারে —
 * সর্বোচ্চ ২০টা বাটন**, টাইপ শুধু `postback` / `web_url`। পুরনো "৩ টপ-লেভেল +
 * nested" নিয়ম বাতিল — `type:"nested"` পাঠালেই Graph রিজেক্ট করে
 * "(#100) Invalid button type"। তাই সব বাটন সরাসরি flat লিস্টে যায়।
 *
 * ⚠️ Meta বাধ্যতামূলক নিয়ম (এখনো বলবৎ): persistent_menu সেট করতে হলে আগে
 * Get Started বাটন (get_started) পেজ প্রোফাইলে থাকতেই হবে — নইলে Graph (#100)
 * "You must set a Get started button..." দেয়। তাই আগে get_started (+ greeting)
 * সেট হয় (idempotent), তারপর মেনু। গ্রাফ কোনো কারণে মেনু রিজেক্ট করলে
 * পুরনো মেনু DELETE করে একবার আরও চেষ্টা করা হয় — এবং প্রতিটা ব্যর্থতা
 * request-body সহ log-এ যায় (Vercel logs-এ দেখা যাবে)।
 * নতুন কাস্টমার "শুরু করুন" চাপলে getStartedPayload postback যায় → webhook
 * সেটাকে Rich-UI অ্যাকশন হিসেবে সামলায় (bot-ui.ts handleBotUiAction)।
 */
export async function setPersistentMenu(
  entries: MenuEntry[],
  opts?: { getStartedPayload?: string; greeting?: string }
): Promise<GraphSendResult & { buttons?: number }> {
  // ধাপ ১: Get Started বাটন (+ স্বাগতম গ্রিটিং) — মেনুর পূর্বশর্ত
  const pre: Record<string, unknown> = {}
  if (opts?.getStartedPayload) pre.get_started = { payload: opts.getStartedPayload.slice(0, 1000) }
  if (opts?.greeting) pre.greeting = [{ locale: 'default', text: opts.greeting.slice(0, 160) }]
  if (Object.keys(pre).length) {
    const preRes = await graphPost('/me/messenger_profile', pre)
    // get_started ছাড়া মেনু যাই হোক না কেন (#100)-এ আটকাবে — তাই এখানেই থামি
    if (!preRes.ok && opts?.getStartedPayload) return { ok: false, error: preRes.error }
  }

  // ধাপ ২: সব বাটন flat লিস্টে (Meta নতুন নিয়ম — nested টাইপ আর নেই)
  const buttons = entries
    .map((e) => ({
      type: 'postback',
      title: sanitizeMenuTitle(e.title),
      payload: (e.payload || '').trim().slice(0, 1000),
    }))
    .filter((e) => e.title && e.payload)
    .slice(0, 20)
  if (!buttons.length) return { ok: false, error: 'মেনু-বাটন কোনোটাই বৈধ নয় (নাম/অ্যাকশন ফাঁকা)' }

  const menuBody: Record<string, unknown> = {
    persistent_menu: [
      {
        locale: 'default',
        composer_input_disabled: false, // কাস্টমার এখনো স্বাধীনে টাইপ করতে পারে
        call_to_actions: buttons,
      },
    ],
  }
  let r = await graphPost('/me/messenger_profile', menuBody)
  if (!r.ok) {
    // রিজেক্ট হলে: পুরনো/আটকে-থাকা মেনু মুছে আবার — বেশিরভাগ stale-state কেস এতেই ভাঙে
    console.error('[messenger:menu] persistent_menu rejected:', r.error, 'body=', JSON.stringify(menuBody))
    await deletePersistentMenu()
    r = await graphPost('/me/messenger_profile', menuBody)
    if (!r.ok) console.error('[messenger:menu] retry after delete also rejected:', r.error)
  }
  if (!r.ok) return { ok: false, error: r.error }
  return { ok: true, buttons: buttons.length }
}

/**
 * Meta পেজে এই মুহূর্তে যে persistent menu + get_started আছে সেটা লাইভ পড়া।
 * admin-এর "Meta-তে এখন যা আছে" প্যানেল — sync সত্যিই হয়েছে কি না এক নজরে।
 * পুরনো nested-মেনু থাকলে ভেতরের বাটনগুলো সমতল করে দেখাই।
 */
export interface PersistentMenuStatus {
  ok: boolean
  error: string | null
  buttons: { title: string; type: string }[]
  hasGetStarted: boolean
}

export async function fetchPersistentMenuStatus(): Promise<PersistentMenuStatus> {
  const token = await pageToken()
  if (!token)
    return { ok: false, error: 'META_PAGE_TOKEN সেট করা নেই (Vercel env)', buttons: [], hasGetStarted: false }
  try {
    const res = await fetch(
      `${GRAPH}/me/messenger_profile?fields=persistent_menu,get_started&access_token=${encodeURIComponent(token)}`,
      { signal: AbortSignal.timeout(10_000) }
    )
    const j = (await res.json()) as {
      data?: {
        persistent_menu?: { locale?: string; call_to_actions?: { type?: string; title?: string; call_to_actions?: { type?: string; title?: string }[] }[] }[]
        get_started?: { payload?: string } | null
      }[]
      error?: { message?: string }
    }
    if (!res.ok || j.error) {
      const msg = j.error?.message || `Graph API HTTP ${res.status}`
      return { ok: false, error: msg, buttons: [], hasGetStarted: false }
    }
    const row = j.data?.[0]
    const menus = row?.persistent_menu || []
    const flat: { title: string; type: string }[] = []
    for (const m of menus) {
      for (const a of m.call_to_actions || []) {
        if (a.type === 'nested') {
          for (const c of a.call_to_actions || []) flat.push({ title: c.title || '', type: 'nested' })
        } else {
          flat.push({ title: a.title || '', type: a.type || '' })
        }
      }
    }
    return { ok: true, error: null, buttons: flat, hasGetStarted: Boolean(row?.get_started?.payload) }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'সংযোগ ব্যর্থ', buttons: [], hasGetStarted: false }
  }
}

/** Digital receipt message — replies দিলে রসিদের নিচেও মেনু-বাটন যায় (সবসময়-বাটন নিয়ম) */
export async function sendReceipt(
  psid: string,
  lines: { text: string }[],
  replies?: QuickReply[]
): Promise<boolean> {
  const text = lines.map((l) => l.text).join('\n')
  return sendText(psid, text, replies?.length ? { quickReplies: replies } : undefined)
}

/** Birthday greeting + voucher (কুপন কোড বক্সে + ছাড় মোটা) — replies দিলে নিচে মেনু-বাটনও */
export async function sendBirthdayGreeting(psid: string, name: string, voucherCode: string, percent: number, replies?: QuickReply[]) {
  return sendText(
    psid,
    `🎂 শুভ জন্মদিন *${name}*!\n\nআপনার জন্য বিশেষ উপহার — কুপন \`${voucherCode}\` : *${percent}% ছাড়*!\nআজই ভিজিট করুন এবং উপভোগ করুন। 🎉`,
    replies?.length ? { quickReplies: replies } : undefined
  )
}

/* ═══════════ Meta Recurring Notifications (marketing_message_*) ═══════════
 * Meta-র নিয়ম: কাস্টমারের শেষ মেসেজের ২৪ ঘণ্টা পার হলে সাধারণ টেক্সট পাঠানো
 * যায় না। Recurring Notifications (ফ্রি) হলো একমাত্র লিগ্যাল চ্যানেল —
 * কাস্টমার RN টেমপ্লেটের [Opt-in] বাটনে ক্লিক করলে webhook messaging_optins
 * ইভেন্টে একটি notification token আসে; সেই টোকেন দিয়ে যেকোনো সময় (টপিকের
 * ফ্রিকোয়েন্সি অনুযায়ী) মেসেজ পাঠানো যায় — জন্মদিন, উৎসব, সাপ্তাহিক অফার। */

/** opt-in কার্ডের টাইটেল (≤৬৫ অক্ষর) — admin চাইলে meta_rn_title সেটিং দিয়ে বদলাতে পারবেন */
export const RN_DEFAULT_TITLE = 'সাপ্তাহিক অফার ও জন্মদিনের সারপ্রাইজ'
const RN_TIMEZONE = 'Asia/Dhaka'

interface GraphSendResult {
  ok: boolean
  error?: string
}

/** POST to the Graph API with the page token (shared by the RN helpers) */
async function graphPost<T>(path: string, body: unknown): Promise<{ ok: boolean; data?: T; error?: string }> {
  const token = await pageToken()
  if (!token) return { ok: false, error: 'META_PAGE_TOKEN সেট করা নেই (Vercel env)' }
  try {
    const res = await fetch(`${GRAPH}${path}?access_token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    })
    const j = (await res.json()) as T & { error?: { message?: string } }
    if (!res.ok || j.error) {
      const msg = j.error?.message || `Graph API HTTP ${res.status}`
      recordSendError(msg)
      return { ok: false, error: msg }
    }
    return { ok: true, data: j }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'সংযোগ ব্যর্থ' }
  }
}

/**
 * Opt-in request card → renders the [Get Updates] button in Messenger.
 * Must be sent within the customer's 24h window. কোনো টেমপ্লেট ID লাগে না —
 * টাইটেল + লোগো সরাসরি পে-লোডে যায় (docs: template_type notification_messages)।
 * কাস্টমার বাটনে ক্লিক করলে Meta messaging_optins webhook পাঠায় আমরা
 * টোকেনটা CRM কাস্টমারের rnToken-এ জমা রাখি।
 */
export async function sendRnOptInRequest(
  psid: string,
  opts?: { title?: string; imageUrl?: string | null }
): Promise<GraphSendResult> {
  const payload: Record<string, unknown> = {
    template_type: 'notification_messages',
    title: (opts?.title || RN_DEFAULT_TITLE).trim().slice(0, 65) || RN_DEFAULT_TITLE,
    notification_messages_cta_text: 'GET_UPDATES',
    notification_messages_timezone: RN_TIMEZONE,
    payload: 'teantreat_rn',
  }
  if (opts?.imageUrl) payload.image_url = opts.imageUrl
  const r = await graphPost('/me/messages', {
    recipient: { id: psid },
    message: { attachment: { type: 'template', payload } },
  })
  return { ok: r.ok, error: r.error }
}

/**
 * Deliver a message to an OPTED-IN customer via their notification token —
 * works even 24h+ after their last message (প্রতি টোকেনে ২৪ ঘণ্টা কুলডাউন;
 * followup-মেসেজে প্রযোজ্য নয়)। সরাসরি টেক্সট — কোনো creative লাগে না।
 * Docs key: notification_messages_token; পুরোনো কিছু Graph ভার্সন
 * notification_message_token চায় → দুটোই চেষ্টা করি।
 */
export async function sendRnToToken(token: string, text: string): Promise<GraphSendResult> {
  let lastError = 'notification token rejected by Graph'
  for (const key of ['notification_messages_token', 'notification_message_token']) {
    const r = await graphPost('/me/messages', {
      recipient: { [key]: token },
      message: { text },
    })
    if (r.ok) return { ok: true }
    lastError = r.error || lastError
    if (!/token/i.test(lastError)) return { ok: false, error: lastError } // not a token-key problem → stop
  }
  return { ok: false, error: lastError }
}
