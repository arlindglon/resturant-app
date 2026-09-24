// Meta Messenger Graph API helpers (CRM)
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

/** Send a plain text message to a PSID */
export async function sendText(psid: string, text: string): Promise<boolean> {
  const token = pageToken()
  if (!token) return false
  try {
    await fetch(`${GRAPH}/me/messages?access_token=${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient: { id: psid }, message: { text } }),
      signal: AbortSignal.timeout(10_000),
    })
    return true
  } catch {
    return false
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

/** Birthday greeting + voucher */
export async function sendBirthdayGreeting(psid: string, name: string, voucherCode: string, percent: number) {
  return sendText(
    psid,
    `🎂 শুভ জন্মদিন ${name}!\n\nআপনার জন্য বিশেষ উপহার: কুপন "${voucherCode}" — পরবর্তী অর্ডারে ${percent}% ছাড়!\nআজই ভিজিট করুন এবং উপভোগ করুন। 🎉`
  )
}

/* ═══════════ Meta Recurring Notifications (marketing_message_*) ═══════════
 * Meta-র নিয়ম: কাস্টমারের শেষ মেসেজের ২৪ ঘণ্টা পার হলে সাধারণ টেক্সট পাঠানো
 * যায় না। Recurring Notifications (ফ্রি) হলো একমাত্র লিগ্যাল চ্যানেল —
 * কাস্টমার RN টেমপ্লেটের [Opt-in] বাটনে ক্লিক করলে webhook messaging_optins
 * ইভেন্টে একটি notification token আসে; সেই টোকেন দিয়ে যেকোনো সময় (টপিকের
 * ফ্রিকোয়েন্সি অনুযায়ী) মেসেজ পাঠানো যায় — জন্মদিন, উৎসব, সাপ্তাহিক অফার। */

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

/** create the recurring-notification creative (template wrapped for the Send API) */
async function createRnCreative(templateId: string): Promise<{ ok: boolean; creativeId?: string; error?: string }> {
  const r = await graphPost<{ message_creative_id?: string }>('/me/message_creatives', {
    message: {
      template: {
        type: 'recurring_notification',
        payload: { template_id: templateId },
      },
    },
  })
  if (!r.ok || !r.data?.message_creative_id) return { ok: false, error: r.error || 'message_creative তৈরি হয়নি' }
  return { ok: true, creativeId: r.data.message_creative_id }
}

/**
 * Send the RN template to a PSID — this renders the card with the [Opt-in]
 * button. When the customer taps it, Meta fires the messaging_optins webhook
 * and we store the token on the CRM customer (rnToken).
 */
export async function sendRnOptInTemplate(psid: string, templateId: string): Promise<GraphSendResult> {
  const creative = await createRnCreative(templateId)
  if (!creative.ok || !creative.creativeId) return { ok: false, error: creative.error }
  const r = await graphPost('/me/messages', {
    recipient: { id: psid },
    message: { message_creative_id: creative.creativeId },
  })
  return { ok: r.ok, error: r.error }
}

/**
 * Deliver the RN template to an OPTED-IN customer via their notification
 * token — works even 24h+ after their last message. The documented recipient
 * key is notification_message_token; some Graph versions expect
 * notification_messages_token → we try both before giving up.
 */
export async function sendRnToToken(templateId: string, token: string): Promise<GraphSendResult> {
  const creative = await createRnCreative(templateId)
  if (!creative.ok || !creative.creativeId) return { ok: false, error: creative.error }
  let lastError = 'notification token rejected by Graph'
  for (const key of ['notification_message_token', 'notification_messages_token']) {
    const r = await graphPost('/me/messages', {
      recipient: { [key]: token },
      message: { message_creative_id: creative.creativeId },
    })
    if (r.ok) return { ok: true }
    lastError = r.error || lastError
    if (!/token/i.test(lastError)) return { ok: false, error: lastError } // not a token-key problem → stop
  }
  return { ok: false, error: lastError }
}
