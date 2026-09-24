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
import { SETTING_KEYS } from '@/lib/constants'

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

export const GEMINI_MODELS = [
  { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash (সুপারিশকৃত — দ্রুত ও স্মার্ট)' },
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash (নতুন প্রজন্ম)' },
  { id: 'gemini-2.0-flash-lite', label: 'Gemini 2.0 Flash-Lite (সবচেয়ে হালকা)' },
  { id: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash (পুরনো কিন্তু স্থিতিশীল)' },
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
    model: model || 'gemini-2.0-flash',
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
  if (!text) throw new Error('Gemini খালি উত্তর দিয়েছে')
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
  },
  required: ['reply'],
} as const

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
  }
  error: string | null
}

const BASE_PERSONA = `তুমি একটি রেস্টুরেন্টের প্রাণবন্ত, বন্ধুত্বপূর্ণ Messenger সহকারী। একজন আন্তরিক মানুষের মতো কথা বলো — রোবট বা কল-সেন্টার নও।

ভাষার নিয়ম:
- কাস্টমার যে ভাষায়/স্টাইলে লিখবে, ঠিক সেভাবেই উত্তর দাও — বাংলা হলে বাংলায়, বাংলিশ (Banglish) হলে বাংলিশে, English হলে English-এ, Hindi হলে Hindi-তে।
- ছোট, উষ্ণ, কথোপকথনের মতো উত্তর দাও (২-৫ বাক্য)। দীর্ঘ প্র্যাচার নয়। মাঝে মাঝে উপযুক্ত emoji ব্যবহার করো।

তথ্যের নিয়ম:
- মেনু, দাম, অফার, ডেলিভারি রুলস — সব উত্তর শুধু নিচের KNOWLEDGE BASE থেকে দাও।
- যা KNOWLEDGE BASE-এ নেই সে দাম/অফার/ওয়াডা বানিয়ে বলবে না — বলবে সঠিক তথ্য জানতে ফোন করতে বা রেস্তোরাঁয় আসতে।
- কেউ অর্ডার করতে চাইলে বলো: QR স্ক্যান করে টেবিল থেকেই অর্ডার করতে হয়, অথবা রেস্তোরাঁয় আসতে বলো।
- অফার (জন্মদিন/বার্ষিকী ছাড়) নিয়ে জিজ্ঞেস করলে KNOWLEDGE BASE-এর অফার লিস্ট থেকে বলো: বিল পেজে "Claim on Messenger" বাটনে চাপলে যাচাই করে ছাড় পাওয়া যায়।

কাস্টমারের তথ্য সংগ্রহ (স্বাভাবিকভাবে, জোর করে নয়):
- কথার মধ্যে কাস্টমার তার নাম, ফোন নম্বর, ঠিকানা, বা বিশেষ দিন (জন্মদিন / বিবাহবার্ষিকী) বললে সেগুলো ধরে রাখো এবং ফিল্ডে পূরণ করো।
- এক মেসেজে কিছু না থাকলে সেই ফিল্ড ফাঁকা রাখো; জোর করে জিজ্ঞেস করবে না।
- reply কখনো ইংরেজি টেকনিক্যাল বক্তব্যে ভরবে না — সবসময় কাস্টমারের ভাষায় পরিষ্কার উত্তর।`

export async function chatWithCustomer(opts: {
  knowledgeBase: string
  history: { role: 'user' | 'model'; text: string }[]
  customerMessage: string
  customerName: string
  extraPersona?: string
  cfg: GeminiConfig
}): Promise<AiChatResult> {
  const empty = { name: null, phone: null, address: null, specialDay: null, specialDayLabel: null }
  const system = [
    BASE_PERSONA,
    opts.extraPersona ? `রেস্টুরেন্ট মালিকের বাড়তি নির্দেশনা:\n${opts.extraPersona}` : '',
    `KNOWLEDGE BASE (একমাত্র সত্যের উৎস):\n${opts.knowledgeBase}`,
    opts.customerName
      ? `কাস্টমারের Facebook প্রোফাইল নাম: ${opts.customerName} (তাকে নাম ধরে ডাকতে পারো)`
      : '',
    `আউটপুট অবশ্যই এই JSON ফরম্যাটে: {"reply": "...", "customerName": "", "phone": "", "address": "", "specialDay": "", "specialDayLabel": ""} — যে তথ্য নেই সেটি ফাঁকা স্ট্রিং ""।`,
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
      maxOutputTokens: 800,
      responseMimeType: 'application/json',
      responseSchema: CHAT_SCHEMA,
    },
  })

  if (!res.ok || !res.text) return { ok: false, reply: null, extracted: empty, error: res.error }

  const j = extractJson(res.text)
  const reply = str(j?.reply) || res.text // JSON parse fail → send raw text as reply
  return {
    ok: true,
    reply,
    extracted: {
      name: str(j?.customerName) || null,
      phone: str(j?.phone) || null,
      address: str(j?.address) || null,
      specialDay: str(j?.specialDay) || null,
      specialDayLabel: str(j?.specialDayLabel) || null,
    },
    error: null,
  }
}

/* ───────────────────── offer-verification data extraction ───────────────────── */

export interface AiExtractResult {
  ok: boolean
  /** normalized candidate datum (still re-validated by deterministic parsers) */
  extracted: string | null
  /** friendly re-ask written in the customer's own language (when nothing found) */
  reply: string | null
  error: string | null
}

const EXTRACT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    extractedData: { type: 'STRING' },
    reply: { type: 'STRING' },
  },
  required: ['extractedData', 'reply'],
} as const

export async function extractVerificationData(opts: {
  fieldType: 'DATE' | 'PHONE' | 'TEXT'
  offerName: string
  askText: string
  customerMessage: string
  cfg: GeminiConfig
}): Promise<AiExtractResult> {
  const typeHint =
    opts.fieldType === 'PHONE'
      ? 'উত্তরে যে ১১ ডিজিটের ফোন নম্বর আছে সেটি বের করো (যেমন 01712345678)।'
      : opts.fieldType === 'DATE'
        ? 'উত্তরে যে তারিখ আছে সেটি বের করো এবং DD/MM/YYYY ফরম্যাটে লিখো (যেমন 15/03/1995)। তারিখ বাংলা বানানে বা কথায় দেওয়া থাকলেও বুঝবে।'
        : 'উত্তরে যে তথ্যটি চাওয়া হচ্ছে সেটি যথাসম্ভব পরিষ্কার করে বের করো।'
  const system = `তুমি একটি রেস্টুরেন্টের অফার-যাচাই সহকারী। কাস্টমার "${opts.offerName}" অফারটি নিতে চায়। বট চেয়েছে: "${opts.askText}"

কাস্টমারের মেসেজ যেকোনো ভাষায়/স্টাইলে আসতে পারে (বাংলা, বাংলিশ, English, Hindi)। ${typeHint}

JSON ফরম্যাট: {"extractedData": "...", "reply": "..."}
- তারিখ/নম্বর/তথ্য পাওয়া গেলে: extractedData-তে শুধু সেটি (extra কথা ছাড়া), reply ফাঁকা ""।
- পাওয়া না গেলে: extractedData "", reply-তে ১-২ বাক্যে কাস্টমারের ভাষায় বন্ধুত্বপূর্ণভাবে আবার চেয়ে নাও (কী লিখতে হবে উদাহরণসহ)। কাস্টমার অন্য কিছু জিজ্ঞেস করলে তার উত্তর দিয়ে আবার তথ্যটি চাও।`

  const res = await generateRotating(opts.cfg, {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: opts.customerMessage }] }],
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 400,
      responseMimeType: 'application/json',
      responseSchema: EXTRACT_SCHEMA,
    },
  })

  if (!res.ok || !res.text) return { ok: false, extracted: null, reply: null, error: res.error }
  const j = extractJson(res.text)
  return {
    ok: true,
    extracted: str(j?.extractedData) || null,
    reply: str(j?.reply) || null,
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
      'gemini-2.0-flash', // fixed light model for the ping — works for all keys
      {
        contents: [{ role: 'user', parts: [{ text: 'Reply with exactly: OK' }] }],
        generationConfig: { maxOutputTokens: 10, temperature: 0 },
      },
    )
    return { masked: maskKey(key), ok: !!text, ms: Date.now() - t0, error: null }
  } catch (e) {
    return { masked: maskKey(key), ok: false, ms: Date.now() - t0, error: e instanceof Error ? e.message : String(e) }
  }
}
