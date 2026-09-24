// Google Gemini AI chatbot engine (free-tier friendly, multi-key rotation).
//
// Admin pastes ONE OR MANY free Gemini API keys (aistudio.google.com/apikey).
// Every call starts from the next key (round-robin) and on failure — quota
// exhausted (429), overloaded (503), bad key — automatically falls through to
// the next key. That is the "unlimited setup": N keys ≈ N× free quota, and a
// busy key never blocks the customer.
//
// Two call shapes:
//  • chatWithCustomer() — general conversation with knowledge base + history,
//    returns the reply AND any customer data the AI naturally picked up
//    (name / phone / address / special day) for the CRM.
//  • extractVerificationData() — offer-claim flow helper: pulls the required
//    verification datum (date / phone / free text) out of ANY language.
//
// SECURITY NOTE: extracted data is ALWAYS re-validated with the deterministic
// parsers in src/lib/verify.ts by the callers — the AI can never invent a
// discount, only understand the customer's language.
import { db } from '@/lib/db'
import { getSetting } from '@/lib/settings'
import { SETTING_KEYS, LANGUAGE_LABELS } from '@/lib/constants'

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

// শুধু এখন চালু থাকা মডেল (Google পুরনোগুলো — 1.5/2.0 — বন্ধ করে দিয়েছে):
// কি বৈধ কিন্তু মডেল মরা হলে API দেয় 404 NOT_FOUND — তখন পালানোর মডেল বদলাতে হয়
export const GEMINI_MODELS = [
  { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash (সুপারিশকৃত — দ্রুত ও স্মার্ট)' },
  { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash' },
  { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite (হালকা)' },
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash (পুরনো কিন্তু স্থিতিশীল)' },
]

export interface GeminiConfig {
  enabled: boolean
  keys: string[]
  model: string
  persona: string
}

/** masked key for logs / admin display: AIzaSy…abcd → AIza…abcd */
export function maskKey(key: string): string {
  const k = key.trim()
  if (k.length <= 12) return k.slice(0, 4) + '…'
  return `${k.slice(0, 7)}…${k.slice(-4)}`
}

/** parse + validate the admin-entered key list (one per line, deduped) */
function parseKeys(raw: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const line of (raw || '').split(/[\n,;]+/)) {
    const k = line.trim()
    if (k.length >= 20 && !seen.has(k)) {
      seen.add(k)
      out.push(k)
    }
  }
  return out
}

export async function getGeminiConfig(): Promise<GeminiConfig> {
  const [enabledRaw, keysRaw, model, persona] = await Promise.all([
    getSetting(SETTING_KEYS.GEMINI_ENABLED),
    getSetting(SETTING_KEYS.GEMINI_API_KEYS),
    getSetting(SETTING_KEYS.GEMINI_MODEL),
    getSetting(SETTING_KEYS.GEMINI_PERSONA),
  ])
  const keys = parseKeys(keysRaw)
  // env fallback: GEMINI_API_KEY works even without the admin panel
  if (process.env.GEMINI_API_KEY) {
    for (const k of parseKeys(process.env.GEMINI_API_KEY)) {
      if (!keys.includes(k)) keys.push(k)
    }
  }
  return {
    enabled: enabledRaw === 'true',
    keys,
    model: model || 'gemini-3.6-flash',
    persona: (persona || '').trim(),
  }
}

/** short config check used by the webhook to decide AI vs static replies */
export async function aiChatEnabled(): Promise<boolean> {
  try {
    const cfg = await getGeminiConfig()
    return cfg.enabled && cfg.keys.length > 0
  } catch {
    return false
  }
}

/* ───────────────────── key health (skip known-bad keys for 10 min) ───────────────────── */
interface KeyHealth {
  badUntil: number
  lastError: string
}
const keyHealth = new Map<string, KeyHealth>()
const BAD_KEY_COOLDOWN_MS = 10 * 60 * 1000

function isKeyBad(key: string): boolean {
  const h = keyHealth.get(key)
  return !!h && Date.now() < h.badUntil
}
function markKeyBad(key: string, error: string) {
  keyHealth.set(key, { badUntil: Date.now() + BAD_KEY_COOLDOWN_MS, lastError: error })
}
function markKeyGood(key: string) {
  keyHealth.delete(key)
}

/* ───────────────────────────── low-level API call ───────────────────────────── */

interface GeminiPart {
  text?: string
}
interface GeminiResponse {
  candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[]
  error?: { code?: number; message?: string; status?: string }
}

/** single-key generateContent; throws typed errors so rotation can decide */
async function generateWithKey(
  key: string,
  model: string,
  body: Record<string, unknown>,
): Promise<string> {
  const res = await fetch(`${API_BASE}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(25_000),
  })
  const j = (await res.json().catch(() => ({}))) as GeminiResponse
  if (!res.ok || j.error) {
    const status = j.error?.status || `HTTP_${res.status}`
    const msg = j.error?.message || `Gemini HTTP ${res.status}`
    const err = new Error(msg) as Error & { geminiStatus?: string; httpStatus?: number }
    err.geminiStatus = status
    err.httpStatus = res.status
    throw err
  }
  const text = (j.candidates?.[0]?.content?.parts || [])
    .map((p) => p.text || '')
    .join('')
    .trim()
  if (!text) {
    // নতুন Gemini 3.x মডেলগুলো thinking করে — ছোট maxOutputTokens হলে পুরো
    // বাজেট thinking-এই শেষ হয়ে দৃশ্যমান উত্তরই থাকে না (finishReason MAX_TOKENS)
    const reason = j.candidates?.[0]?.finishReason || j.error?.status || 'UNKNOWN'
    throw new Error(`Gemini খালি উত্তর দিয়েছে (finishReason: ${reason})`)
  }
  return text
}

/** is this failure worth trying the next key? (rate limit / server / network) */
function isRetryable(e: unknown): boolean {
  const err = e as { geminiStatus?: string; httpStatus?: number; code?: string }
  if (err?.httpStatus === 429 || err?.httpStatus === 500 || err?.httpStatus === 503) return true
  if (err?.geminiStatus === 'RESOURCE_EXHAUSTED' || err?.geminiStatus === 'UNAVAILABLE' || err?.geminiStatus === 'INTERNAL') return true
  return !(err instanceof Error && /API key not valid|API_KEY_INVALID/i.test(err.message))
}

/**
 * Round-robin Gemini call across ALL configured keys.
 * Returns null reply when every key failed (caller falls back to static text).
 */
async function generateRotating(
  cfg: GeminiConfig,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; text: string | null; error: string | null }> {
  let lastError = 'কোনো API কি নেই'
  const usable = cfg.keys.filter((k) => !isKeyBad(k))
  const list = usable.length ? usable : cfg.keys // all cooling down → try anyway once
  for (let i = 0; i < list.length; i++) {
    const key = list[(rotationCursor + i) % list.length]
    try {
      const text = await generateWithKey(key, cfg.model, body)
      markKeyGood(key)
      rotationCursor = (rotationCursor + i + 1) % Math.max(list.length, 1)
      return { ok: true, text, error: null }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      lastError = msg
      if (e instanceof Error && /API key not valid|API_KEY_INVALID|PERMISSION_DENIED/i.test(msg)) {
        markKeyBad(key, msg) // dead key — skip it for 10 min
        continue
      }
      if (isRetryable(e)) continue // busy/quota → next key
      return { ok: false, text: null, error: msg } // non-retryable (bad request etc.)
    }
  }
  return { ok: false, text: null, error: lastError }
}
let rotationCursor = 0

/* ─────────────────────────── conversation history ─────────────────────────── */

/** store one chat turn (best-effort — history must never break the chat) */
export async function saveChatTurn(psid: string, role: 'customer' | 'bot', text: string): Promise<void> {
  if (!text.trim()) return
  try {
    await db.chatMessage.create({ data: { psid, role, text: text.slice(0, 3000) } })
  } catch {
    /* table may not be migrated yet — chat still works without memory */
  }
}

/** recent turns (oldest → newest) as Gemini contents (best-effort) */
export async function loadChatHistory(psid: string, limit = 10): Promise<{ role: 'user' | 'model'; text: string }[]> {
  try {
    const rows = await db.chatMessage.findMany({
      where: { psid },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })
    return rows
      .reverse()
      .map((r) => ({ role: r.role === 'bot' ? ('model' as const) : ('user' as const), text: r.text }))
  } catch {
    return []
  }
}

/* ───────────────────────────── JSON output helpers ───────────────────────────── */

const CHAT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    reply: { type: 'STRING' },
    customerName: { type: 'STRING' },
    phone: { type: 'STRING' },
    address: { type: 'STRING' },
    specialDay: { type: 'STRING' },
    specialDayLabel: { type: 'STRING' },
    note: { type: 'STRING' },
    language: { type: 'STRING', enum: ['bn', 'banglish', 'en', 'hi', 'other'] },
  },
  required: ['reply'],
} as const

const BLAST_SCHEMA = {
  type: 'OBJECT',
  properties: {
    text: { type: 'STRING' },
  },
  required: ['text'],
} as const

/**
 * AI-ব্রডকাস্ট: মালিকের দেওয়া কাঁচা তথ্য (আবহাওয়া / ছুটি / খবর / ইভেন্ট যা কিছু)
 * থেকে এই এক কাস্টমারের জন্য আলাদা, প্রফেশনাল, এনগেজিং মেসেজ লেখে —
 * প্রতিটা কাস্টমার ইউনিক মেসেজ পায়, কপি-পেস্ট ব্রডকাস্ট নয়।
 */
export async function composePersonalBlast(opts: {
  knowledgeBase: string
  adminInfo: string
  customerName: string
  customerNotes?: string
  customerLanguage?: string | null
  lastBotMessage?: string | null
  recentHistory?: { role: 'user' | 'model'; text: string }[]
  extraPersona?: string
  cfg: GeminiConfig
}): Promise<{ ok: boolean; text: string | null; error: string | null }> {
  const system = [
    `তুমি একটি রেস্তোরাঁর সিনিয়র মার্কেটিং + কাস্টমার রিলেশন প্রো। মালিক তোমাকে একটা তথ্য/খবর দিয়েছে — তোমার কাজ: একজন নির্দিষ্ট কাস্টমারের জন্য সেটা নিজের ভাষায় সাজিয়ে একটা ছোট, উষ্ণ, প্রফেশনাল মেসেজ লেখা যাতে সে রেস্তোরাঁয় আসতে আগ্রহী হয় (কিন্তু বিরক্ত না হয়)।

লেখার নিয়ম:
- ২-৪ বাক্য, ১-২টা মানানসই emoji, স্বাভাবিক মানুষের মতো — বিজ্ঞাপনের স্ক্রিপ্টের মতো নয়।
- মালিকের তথ্য (আবহাওয়া/ছুটি/ঘটনা/খবর) মেসেজের মূল সুর হবে — সেটাকে খাবার/আমন্ত্রণের সাথে স্বাভাবিকভাবে জুড়ে দাও।
- কাস্টমারকে নাম ধরে ডাকো (নাম থাকলে)। তার নোট/আগের কথাবার্তা মনে রেখে ব্যক্তিগত ছোঁয়া দাও।
- চাইলে KNOWLEDGE BASE-এর মেনু/চলমান কুপন থেকে ১টা মানানসই জিনিস উল্লেখ করতে পারো — কিন্তু তালিকার বাইরে কিছু বানিয়ে বলবে না, আর ১টার বেশি কুপন কোড লিখবে না।
- আগের শেষ বট-মেসেজের সাথে মিল থাকতে পারবে না — একেক জনের মেসেজ একেক রকম।
- মেসেজের শেষে চাপ দিয়ে কিছু চাইবে না — হালকা আমন্ত্রণ যথেষ্ট।
- ভাষা: মালিকের নির্দেশ থাকলে সেই ভাষায়; নাহলে বাংলায়।
- শুধু মেসেজটাই লিখো — কোনো ভূমিকা/ব্যাখ্যা নয়।`,
    opts.extraPersona ? `রেস্টুরেন্ট মালিকের বাড়তি নির্দেশনা:\n${opts.extraPersona}` : '',
    opts.customerLanguage
      ? `এই কাস্টমারকে অবশ্যই ${LANGUAGE_LABELS[opts.customerLanguage] || opts.customerLanguage} ভাষায় লিখতে হবে।`
      : '',
    `KNOWLEDGE BASE:\n${opts.knowledgeBase}`,
    opts.customerNotes ? `কাস্টমার সম্পর্কে জমানো নোট/ট্যাগ:\n${opts.customerNotes}` : '',
    opts.customerName ? `কাস্টমারের নাম: ${opts.customerName}` : '',
    opts.lastBotMessage ? `শেষ পাঠানো মেসেজ (এর সাথে মিল থাকতে পারবে না):\n${opts.lastBotMessage}` : '',
    opts.recentHistory?.length
      ? `সাম্প্রতিক কথোপকথন:\n${opts.recentHistory.map((h) => `${h.role === 'user' ? 'কাস্টমার' : 'বট'}: ${h.text}`).join('\n')}`
      : '',
    `মালিকের দেওয়া তথ্য (এটাই মূল বিষয়):\n${opts.adminInfo}`,
    `আউটপুট JSON: {"text": "মেসেজ"}`,
  ]
    .filter(Boolean)
    .join('\n\n')

  const res = await generateRotating(opts.cfg, {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: 'এই কাস্টমারের জন্য মেসেজটা লিখো।' }] }],
    generationConfig: {
      temperature: 1.0,
      maxOutputTokens: 1024,
      responseMimeType: 'application/json',
      responseSchema: BLAST_SCHEMA,
    },
  })
  if (!res.ok || !res.text) return { ok: false, text: null, error: res.error }
  const j = extractJson(res.text)
  const text = str(j?.text) || (res.text.trimStart().startsWith('{') ? '' : res.text.trim())
  if (!text) return { ok: false, text: null, error: 'খালি উত্তর (thinking বাজেট শেষ?)' }
  return { ok: true, text, error: null }
}

function extractJson(text: string): Record<string, unknown> | null {
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    // model may wrap JSON in ``` fences despite the mime type
    const m = text.match(/\{[\s\S]*\}/)
    if (m) {
      try {
        return JSON.parse(m[0]) as Record<string, unknown>
      } catch {
        return null
      }
    }
    return null
  }
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/* ─────────────────────────── general customer chat ─────────────────────────── */

export interface AiChatResult {
  ok: boolean
  reply: string | null
  extracted: {
    name: string | null
    phone: string | null
    address: string | null
    specialDay: string | null // raw date text found in the conversation
    specialDayLabel: string | null // জন্মদিন / বিবাহবার্ষিকী / custom
    note: string | null // notable customer fact worth remembering in the CRM
    language: string | null // detected customer language (bn/banglish/en/hi/other)
  }
  error: string | null
}

const BASE_PERSONA = `তুমি একটি রেস্টুরেন্টের অভিজ্ঞ হোস্ট + সেলস/মার্কেটিং প্রো — একজন আন্তরিক মানুষের মতো কথা বলো, কখনো রোবট বা কল-সেন্টার স্ক্রিপ্টের মতো নয়।

ভাষার নিয়ম:
- কাস্টমার যে ভাষায়/স্টাইলে লিখবে, ঠিক সেভাবেই উত্তর দাও — বাংলা হলে বাংলায়, বাংলিশ হলে বাংলিশে, English হলে English-এ, Hindi হলে Hindi-তে।
- ছোট, উষ্ণ, কথোপকথনের মতো উত্তর (২-৫ বাক্য)। মাঝে মাঝে মানানসই emoji।
- কাস্টমার আগের মেসেজে কিছু জিজ্ঞেস/বলেছিল হলে সেটার স্বাভাবিক উত্তর দাও (খোঁজখবর, জোক, আসার কথা — সব আগে মেনে নাও, তারপর ব্যবসা)।
- একই বাক্য/একই কথা দুবার কখনো বলবে না — প্রতি উত্তর একেক রকম, টাটকা।

বিক্রয় ও আতিথেয়তার নিয়ম (pro):
- মেনু, দাম, অফার, ডেলিভারি রুলস — সব উত্তর শুধু নিচের KNOWLEDGE BASE থেকে দাও; বাইরের কিছু বানিয়ে বলবে না।
- সুযোগ বুঝে হালকাভাবে আগ্রহ তৈরি করো: জনপ্রিয় আইটেম, চলমান অফার/কুপন উল্লেখ করো — তবে জোর-জবরদস্তি নয়, বন্ধুর মতো রিকমেন্ড।
- কেউ আসার কথা বললে উষ্ণ স্বাগতম জানাও; প্রযোজ্য হলে কাছাকাছি সময়/কী খেতে চান জানতে চাও।
- কেউ অর্ডার করতে চাইলে বলো: QR স্ক্যান করে টেবিল থেকেই অর্ডার হয়, অথবা রেস্তোরাঁয় আসতে বলো।
- অফার (জন্মদিন/বার্ষিকী ছাড়) নিয়ে জিজ্ঞেস করলে KNOWLEDGE BASE-এর অফার লিস্ট থেকে বলো: বিল পেজে "Claim on Messenger" বাটনে চাপলে যাচাই করে ছাড় পাওয়া যায়।

কাস্টমারের তথ্য সংগ্রহ (স্বাভাবিকভাবে, জোর করে নয়):
- কথার মধ্যে নাম, ফোন, ঠিকানা, বিশেষ দিন (জন্মদিন/বিবাহবার্ষিকী) বললে ফিল্ডে পূরণ করো; না থাকলে ফাঁকা।
- কাস্টমার এই মেসেজে যে ভাষায় লিখছে সেটা language ফিল্ডে ছোট কোডে লিখো: bn (শুদ্ধ বাংলা), banglish (বাংলা কথা english অক্ষরে), en (english), hi (হিন্দি), other — বোঝা না গেলে ফাঁকা।
- কাস্টমার সম্পর্কে ভবিষ্যতে কাজে লাগার মতো উল্লেখযোগ্য তথ্য (যেমন: আজ রাতে ৬ জনের দল নিয়ে আসবে, ঝাল খেতে ভালোবাসে, বাচ্চা সহ আসবে, ক্যাটারিং জানতে চায়) থাকলে note ফিল্ডে ১ লাইনে লিখো — না থাকলে ফাঁকা।
- reply সবসময় কাস্টমারের ভাষায় পরিষ্কার উত্তর — ইংরেজি টেকনিক্যাল বক্তব্য নয়।`

export async function chatWithCustomer(opts: {
  knowledgeBase: string
  history: { role: 'user' | 'model'; text: string }[]
  customerMessage: string
  customerName: string
  customerNotes?: string
  /** admin-marked language (bn/banglish/en/hi/other) — when set, ALWAYS reply in it */
  customerLanguage?: string | null
  extraPersona?: string
  cfg: GeminiConfig
}): Promise<AiChatResult> {
  const empty = { name: null, phone: null, address: null, specialDay: null, specialDayLabel: null, note: null, language: null }
  const system = [
    BASE_PERSONA,
    opts.extraPersona ? `রেস্টুরেন্ট মালিকের বাড়তি নির্দেশনা:\n${opts.extraPersona}` : '',
    opts.customerLanguage
      ? `মালিকের বিশেষ নির্দেশ: এই কাস্টমারকে সবসময় ${LANGUAGE_LABELS[opts.customerLanguage] || opts.customerLanguage} ভাষায় উত্তর দাও — কাস্টমার অন্য ভাষায় লিখলেও এই ভাষাতেই উত্তর দিতে হবে।`
      : '',
    `KNOWLEDGE BASE (একমাত্র সত্যের উৎস):\n${opts.knowledgeBase}`,
    opts.customerNotes ? `এই কাস্টমার সম্পর্কে আগে জমানো নোট/ট্যাগ (ব্যক্তিগত মনে রেখে কথা বলো, খুশি করো):\n${opts.customerNotes}` : '',
    opts.customerName
      ? `কাস্টমারের Facebook প্রোফাইল নাম: ${opts.customerName} (তাকে নাম ধরে ডাকতে পারো)`
      : '',
    `আউটপুট অবশ্যই এই JSON ফরম্যাটে: {"reply": "...", "customerName": "", "phone": "", "address": "", "specialDay": "", "specialDayLabel": "", "note": "", "language": "bn|banglish|en|hi|other"} — যে তথ্য নেই সেটি ফাঁকা স্ট্রিং ""।`,
  ]
    .filter(Boolean)
    .join('\n\n')

  const contents = [
    ...opts.history.slice(-10).map((h) => ({ role: h.role, parts: [{ text: h.text }] })),
    { role: 'user' as const, parts: [{ text: opts.customerMessage }] },
  ]

  const res = await generateRotating(opts.cfg, {
    systemInstruction: { parts: [{ text: system }] },
    contents,
    generationConfig: {
      temperature: 0.8,
      // Gemini 3.x thinking মডেল: thinking token-ও এই বাজেট থেকেই কাটে —
      // তাই 800 নয়, ঢিলেঢালা বাজেট রাখতে হয়
      maxOutputTokens: 2048,
      responseMimeType: 'application/json',
      responseSchema: CHAT_SCHEMA,
    },
  })

  if (!res.ok || !res.text) return { ok: false, reply: null, extracted: empty, error: res.error }

  const j = extractJson(res.text)
  // truncated-JSON (thinking-এ বাজেট শেষ) কাস্টমারকে কখনো raw আকারে যাবে না —
  // '{' দিয়ে শুরু হলে সেটা ভাঙা JSON, বরং ব্যর্থ ধরে static fallback-এ যাও
  if (!j && res.text.trimStart().startsWith('{')) {
    return { ok: false, reply: null, extracted: empty, error: 'JSON ট্রানকেটেড (thinking বাজেট শেষ)' }
  }
  const reply = str(j?.reply) || res.text // JSON parse fail → send raw text as reply
  const lang = str(j?.language)
  return {
    ok: true,
    reply,
    extracted: {
      name: str(j?.customerName) || null,
      phone: str(j?.phone) || null,
      address: str(j?.address) || null,
      specialDay: str(j?.specialDay) || null,
      specialDayLabel: str(j?.specialDayLabel) || null,
      note: str(j?.note) || null,
      language: ['bn', 'banglish', 'en', 'hi', 'other'].includes(lang) ? lang : null,
    },
    error: null,
  }
}

/* ───────────── offer-verification conversation (human, sales-pro, never nagging) ───────────── */

export interface AiVerifyResult {
  ok: boolean
  /** normalized candidate datum (still re-validated by deterministic parsers) */
  extracted: string | null
  /** warm reply in the customer's own language (answer first, then a soft nudge) */
  reply: string | null
  /**
   * ASK     → still guiding the customer toward the datum
   * CANCEL  → the customer clearly said the occasion doesn't apply to them
   *           (not married / not my birthday / someone else's) — close the claim
   *           gracefully and pivot to what DOES fit them (other offers from the KB)
   */
  action: 'ASK' | 'CANCEL'
  error: string | null
}

const VERIFY_SCHEMA = {
  type: 'OBJECT',
  properties: {
    extractedData: { type: 'STRING' },
    reply: { type: 'STRING' },
    action: { type: 'STRING', enum: ['ASK', 'CANCEL'] },
  },
  required: ['extractedData', 'reply', 'action'],
} as const

export async function verificationChat(opts: {
  fieldType: 'DATE' | 'PHONE' | 'TEXT'
  offerName: string
  askText: string
  /** the exact text the bot last sent asking for the datum — the AI must never repeat it */
  lastAskSent: string | null
  /** how many times the bot already asked (0 = first re-ask) */
  askCount: number
  /** live knowledge base — used to pivot to other offers when cancelling */
  knowledgeBase: string
  history: { role: 'user' | 'model'; text: string }[]
  customerMessage: string
  /** admin-marked language (bn/banglish/en/hi/other) — when set, ALWAYS reply in it */
  customerLanguage?: string | null
  cfg: GeminiConfig
}): Promise<AiVerifyResult> {
  const typeHint =
    opts.fieldType === 'PHONE'
      ? 'দরকারি তথ্য: ১১ ডিজিটের ফোন নম্বর (যেমন 01712345678)। উত্তরে নম্বরটি থাকলে সেটিই extractedData (শুধু ডিজিট)।'
      : opts.fieldType === 'DATE'
        ? 'দরকারি তথ্য: একটি তারিখ। উত্তরে তারিখ থাকলে DD/MM/YYYY ফরম্যাটে extractedData-তে লিখো (যেমন 15/03/1995)। তারিখ বাংলা বানানে, কথায় বা বছর-মাস আলাদা হলেও বুঝবে।'
        : 'দরকারি তথ্য: একটি উত্তর/বর্ণনা। কাস্টমার সেটি দিলে যথাসম্ভব পরিষ্কার করে extractedData-তে লিখো।'

  const askPressure =
    opts.askCount <= 0
      ? 'এই প্রথমবার হালকাভাবে মনে করিয়ে দিচ্ছ — বন্ধুর মতো।'
      : 'তুমি ইতিমধ্যে ২ বার জেনে নেওয়ার চেষ্টা করেছ — এখন আর চাওয়া যাবে না। কাস্টমারের কথার উত্তর দিয়ে স্বাভাবিক বন্ধুত্বপূর্ণ কথায় ফিরে যাও (চাইলে অন্য অফার/খাবারের কথা বলো) — তারিখ/তথ্যের কথা টুকুও নয়।'

  const system = `তুমি একটি রেস্টুরেন্টের অভিজ্ঞ হোস্ট + সেলস প্রো — উষ্ণ, পেশাদার, মানুষের মতো। কাস্টমার "${opts.offerName}" অফার নিতে চেয়েছিল; যাচাইয়ে বট চেয়েছে: "${opts.askText}"

চরিত্রের নিয়ম:
- কাস্টমার যে ভাষায়/স্টাইলে লিখবে ঠিক সেভাবেই উত্তর (বাংলা/বাংলিশ/English/Hindi)।${opts.customerLanguage ? ` তবে মালিকের বিশেষ নির্দেশ: এই কাস্টমারকে সবসময় ${LANGUAGE_LABELS[opts.customerLanguage] || opts.customerLanguage} ভাষায় উত্তর দাও।` : ''}
- আগে কাস্টমারের কথাটার স্বাভাবিক উত্তর দাও (খোঁজখবর, জোক, আসার কথা, নাম বলা — সব মেনে নাও), তারপর প্রয়োজনে ব্যবসা।
- ১-৩ বাক্যে উত্তর; একই বাক্য দুবার কখনো নয় — বিশেষ করে এই মেসেজটা আগেই পাঠানো হয়েছে, হুবহু আর লিখবে না: "${(opts.lastAskSent || '').slice(0, 200)}"
- জোর-জবরদস্তি বা একঘেয়ে দাবি কখনো নয় — বন্ধুর মতো মনে করিয়ে দেওয়া মাত্র।

${typeHint}

সিদ্ধান্ত (action):
1. কাস্টমারের মেসেজে দরকারি তারিখ/নম্বর/তথ্য থাকলে → extractedData পূরণ, reply ফাঁকা "", action "ASK"।
2. কাস্টমার স্পষ্ট বললে অফারটি তার প্রযোজ্য নয় (বিবাহ করেনি / জন্মদিন এখন না / অন্যের অকেশন / ভুল বুঝ) → action "CANCEL"; reply-তে ২-৩ বাক্যে: একেবারে স্বাভাবিকভাবে "কোনো সমস্যা নেই" + KNOWLEDGE BASE থেকে তার জন্য প্রযোজ্য ১-২টা অফার/জনপ্রিয় খাবার উল্লেখ করে আগ্রহ তৈরি + রেস্তোরাঁয় আসার উষ্ণ আমন্ত্রণ। extractedData ফাঁকা।
3. অন্য কথা (খোঁজখবর, জোক, আসবে বলা, প্রশ্ন) → action "ASK" ${askPressure}
   reply-তে তার কথার উত্তর দিয়ে হালকাভাবে এগোও; extractedData ফাঁকা।

KNOWLEDGE BASE:
${opts.knowledgeBase.slice(0, 4000)}

JSON ফরম্যাট: {"extractedData":"","reply":"","action":"ASK"}`

  const contents = [
    ...opts.history.slice(-6).map((h) => ({ role: h.role, parts: [{ text: h.text }] })),
    { role: 'user' as const, parts: [{ text: opts.customerMessage }] },
  ]

  const res = await generateRotating(opts.cfg, {
    systemInstruction: { parts: [{ text: system }] },
    contents,
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 1024,
      responseMimeType: 'application/json',
      responseSchema: VERIFY_SCHEMA,
    },
  })

  if (!res.ok || !res.text) return { ok: false, extracted: null, reply: null, action: 'ASK', error: res.error }
  const j = extractJson(res.text)
  const action = str(j?.action) === 'CANCEL' ? 'CANCEL' : 'ASK'
  return {
    ok: true,
    extracted: str(j?.extractedData) || null,
    reply: str(j?.reply) || null,
    action,
    error: null,
  }
}

/* ───────────────────────────── admin key test ───────────────────────────── */

export interface KeyTestResult {
  masked: string
  ok: boolean
  ms: number
  error: string | null
}

/** tiny ping to one key (admin "test keys" button) */
export async function testGeminiKey(key: string): Promise<KeyTestResult> {
  const t0 = Date.now()
  try {
    const text = await generateWithKey(
      key,
      'gemini-3.6-flash', // fixed current model for the ping — works for all keys
      {
        contents: [{ role: 'user', parts: [{ text: 'Reply with exactly: OK' }] }],
        // Gemini 3.x thinking মডেল — ছোট বাজেট দিলে thinking-এই শেষ, উত্তরই আসে না
        generationConfig: { maxOutputTokens: 1024, temperature: 0 },
      },
    )
    return { masked: maskKey(key), ok: !!text, ms: Date.now() - t0, error: null }
  } catch (e) {
    return { masked: maskKey(key), ok: false, ms: Date.now() - t0, error: e instanceof Error ? e.message : String(e) }
  }
}
