// Meta Messenger Graph API helpers (CRM)
import { getSetting } from '@/lib/settings'
import { SETTING_KEYS } from '@/lib/constants'

const GRAPH = 'https://graph.facebook.com/v21.0'

function pageToken(): string {
  return process.env.META_PAGE_TOKEN || ''
}

export function messengerConfigured(): boolean {
  // Only the Page Token is functionally required: Graph /me/messages resolves
  // the page from the token itself. META_PAGE_ID is optional (informational).
  return Boolean(process.env.META_PAGE_TOKEN)
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
  const token = pageToken()
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
  const token = pageToken()
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
  const token = pageToken()
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

/** Send a plain text message to a PSID — returns REAL success (Graph errors count as failure) */
export async function sendText(psid: string, text: string, opts?: { markdown?: boolean }): Promise<boolean> {
  const token = pageToken()
  if (!token) return false

  const post = async (body: Record<string, unknown>): Promise<boolean> => {
    try {
      const res = await fetch(`${GRAPH}/me/messages?access_token=${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      })
      if (!res.ok) return false
      const j = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
      return !j.error
    } catch {
      return false
    }
  }

  // Messenger markdown (*bold*, _italic_, ~strike~, `code`): admin বন্ধ না করলে
  // text_format:markdown দিয়ে যায় — Graph কোনো কারণে রিজেক্ট করলে (নতুন ফিল্ড
  // না-মানা / ২৪ঘ উইন্ডো / যা-ই হোক) প্লেইন টেক্সট দিয়ে আরেকবার — মেসেজ কখনো হারায় না।
  const wantMd = opts?.markdown !== false && (await markdownEnabled())
  if (wantMd && (await post({ recipient: { id: psid }, message: { text, text_format: 'markdown' } }))) {
    return true
  }
  return post({ recipient: { id: psid }, message: { text } })
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
  const token = pageToken()
  if (!token) return false
  try {
    await fetch(`${GRAPH}/me/messages?access_token=${token}`, {
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
    return true
  } catch {
    return false
  }
}

/** Digital receipt message */
export async function sendReceipt(
  psid: string,
  lines: { text: string }[]
): Promise<boolean> {
  const text = lines.map((l) => l.text).join('\n')
  return sendText(psid, text)
}

/** Birthday greeting + voucher (কুপন কোড বক্সে + ছাড় মোটা) */
export async function sendBirthdayGreeting(psid: string, name: string, voucherCode: string, percent: number) {
  return sendText(
    psid,
    `🎂 শুভ জন্মদিন *${name}*!\n\nআপনার জন্য বিশেষ উপহার — কুপন \`${voucherCode}\` : *${percent}% ছাড়*!\nআজই ভিজিট করুন এবং উপভোগ করুন। 🎉`
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
  const token = pageToken()
  if (!token) return { ok: false, error: 'META_PAGE_TOKEN সেট করা নেই (Vercel env)' }
  try {
    const res = await fetch(`${GRAPH}${path}?access_token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    })
    const j = (await res.json()) as T & { error?: { message?: string } }
    if (!res.ok || j.error) return { ok: false, error: j.error?.message || `Graph API HTTP ${res.status}` }
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
