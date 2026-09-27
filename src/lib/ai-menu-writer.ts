// ============================================================
// ✍️ AI মেনু-লেখক — মালিকের এলোমেলো নোট → সম্পূর্ণ মেনু-আইটেম ড্রাফট
//
// মালিক বক্সে যা-মন চায় লেখে ("চিকেন বিরিয়ানি ২৮০ টাকা বেসনের জালি সহ…") —
// AI সেখান থেকে এক বা একাধিক আইটেমের নাম / ক্যাটাগরি / মুখরোচক বাংলা বিবরণ /
// দাম / ঝাল-মাত্রা / সেট-মেনু সনাক্ত করে দাম-পরামর্শসহ JSON বানায়।
// প্রতিটি আইটেম PENDING ড্রাফট হিসেবে জমা হয় → admin চেক করে অ্যাপ্রুভ দিলে
// আসল menu_items-এ ঢুকে যায় (নতুন ক্যাটাগরি হলে নিজেই তৈরি হয়)।
//
// ai_menu_drafts টেবিল না থাকলে নিরাপদে নিজেই বানিয়ে নেয় (লেজি self-migration —
// ensurePushTable-এর সেইম প্যাটার্ন, TiDB/MySQL উভয়ে চলে)।
// ============================================================
import { db } from '@/lib/db'
import { adminStructuredGenerate } from '@/lib/gemini'

let draftTableReady: Promise<void> | null = null

/** ai_menu_drafts টেবিল নিশ্চিত করা — প্রথম কলে একবারই DDL চলে (idempotent) */
export function ensureDraftTable(): Promise<void> {
  if (!draftTableReady) {
    draftTableReady = (async () => {
      await db.$executeRawUnsafe(
        `CREATE TABLE IF NOT EXISTS \`ai_menu_drafts\` (
          \`id\` VARCHAR(191) NOT NULL,
          \`rawText\` TEXT NOT NULL,
          \`name\` VARCHAR(191) NOT NULL,
          \`category\` VARCHAR(191) NOT NULL,
          \`description\` TEXT NULL,
          \`price\` DOUBLE NULL,
          \`imageUrl\` TEXT NULL,
          \`tags\` TEXT NULL,
          \`isSetMenu\` BOOLEAN NOT NULL DEFAULT false,
          \`spiceLevels\` TEXT NULL,
          \`status\` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
          \`note\` TEXT NULL,
          \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
          \`decidedAt\` DATETIME(3) NULL,
          PRIMARY KEY (\`id\`)
        ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
      )
      for (const ddl of [
        'CREATE INDEX IF NOT EXISTS `ai_menu_drafts_status_createdAt_idx` ON `ai_menu_drafts`(`status`, `createdAt`)',
      ]) {
        try {
          await db.$executeRawUnsafe(ddl)
        } catch {
          /* ইনডেক্স আগেই থাকলে নিরীহ */
        }
      }
    })().catch((e) => {
      draftTableReady = null // পরের কলে আবার চেষ্টা
      throw e
    })
  }
  return draftTableReady
}

/* ───────────────────────────── প্রম্পট ───────────────────────────── */

const SYSTEM_PROMPT = `[FLOW:MENU_WRITER] তুমি একটি রেস্টুরেন্টের মেনু-বিশেষজ্ঞ ও বিজ্ঞাপন-কপিরাইটার। রেস্টুরেন্টের মালিক এলোমেলো/অসম্পূর্ণ নোট লিখবে — আইটেমের নাম, দাম, উপকরণ, স্টাইল, যা-যা মনে আসে তাই-ই। তুমি প্রতিটি খাবার থেকে সম্পূর্ণ, মেনুতে দেওয়ার মতো প্রফেশনাল আইটেম বানাবে।

কঠোর নিয়ম:
- মালিকের নোটে এক বা একাধিক খাবারের কথা থাকতে পারে — প্রতিটি আলাদা আইটেম করো। খাবার না-ও থাকতে পারে (যেমন শুধু চা-কফি/ডেজার্ট) — সেগুলোও আইটেম।
- NAME: পরিষ্কার আকর্ষণীয় বাংলা নাম। মালিক নাম দিয়ে থাকলে হুবহু সেটাই রাখো (শুধু বানান পরিষ্কার করো)।
- CATEGORY: খাবারটির সঠিক ক্যাটাগরি — দেওয়া ক্যাটাগরি-তালিকার কোনো একটির হুবহু নাম ব্যবহার করো যদি মানানসই হয়; না হলে স্বাভাবিক ছোট বাংলা ক্যাটাগরি (যেমন: ভাত, বিরিয়ানি, বার্গার, স্ন্যাকস, নাস্তা, চা-কফি, ডেজার্ট, ড্রিংকস, সেট মেনু)।
- DESC: ১-২ বাক্যের মুখে-জল-আনা বাংলা বিবরণ — গন্ধ, টেক্সচার, উপকরণ, কবে খেতে সবচেয়ে ভালো। যেমন: "গরম গরম নরম লুচি, সাথে ঘন আলুর দম ঝোল — সকালের নাস্তায় অতুলনীয়।" মিথ্যা অতিরঞ্জন নয়; মালিকের নোটে যা আছে বা স্বাভাবিক-সাধারণ জিনিস তার ভেতরেই থাকবে।
- PRICE: মালিক দাম লিখে থাকলে ঠিক সেটাই। লিখে না থাকলে ঢাকা-শহরের মাঝারি রেস্টুরেন্ট ধরে যুক্তিসঙ্গত দাম প্রস্তাব করো। শুধু সংখ্যা (টাকা)।
- SET: একসাথে বেশ কিছু জিনিস এক প্লেট/প্যাকেজে হলে yes, নাহলে no।
- SPICE: ঝাল-মাত্রা বাছার অপশন মানানসই হলে Mild/Medium/Hot (একাধিক হলে কমা দিয়ে); মিষ্টি/ড্রিংকস/চা-কফি হলে none।
- ADVICE: মালিকের জন্য ১ লাইনের ব্যবসা-পরামর্শ — দাম কেমন রাখা ভালো, কী সাথে বিক্রি হবে, লাভ-মার্জিন বা জনপ্রিয়তার টিপস।
- নোটের ভাষা যেটাতেই লেখা (বাংলা/বাংলিশ/English) — বুঝে নেবে; বিবরণ ও পরামর্শ সবসময় সহজ বাংলায়।

আউটপুট-ফরম্যাট (সবচেয়ে গুরুত্বপূর্ণ): কোনো ভূমিকা, বিশ্লেষণ, বুলেট, ব্যাখ্যা বা নমুনা কখনো লিখবে না — প্রতিটি আইটেমের জন্য ঠিক নিচের ব্লকটাই লিখবে। একাধিক আইটেম হলে ব্লকগুলো একের পর এক, খালি লাইন ছাড়াছাড়া:
ITEM:
NAME: <আইটেমের নাম>
CATEGORY: <ক্যাটাগরি>
PRICE: <শুধু সংখ্যা>
DESC: <১-২ বাক্য মুখরোচক বাংলা, এক লাইনে>
SET: <yes/no>
SPICE: <Mild/Medium/Hot কমা দিয়ে, নাহলে none>
ADVICE: <১ লাইন পরামর্শ>

তোমার উত্তরের প্রথম লাইনটাই অবশ্যই "ITEM:" হবে।`

export interface GeneratedDraft {
  name: string
  category: string
  description: string
  price: number | null
  isSetMenu: boolean
  spiceLevels: string[]
  advice: string
}

const BN_DIGITS: Record<string, string> = { '০': '0', '১': '1', '২': '2', '৩': '3', '৪': '4', '৫': '5', '৬': '6', '৭': '7', '৮': '8', '৯': '9' }

/** টেমপ্লেট-মান ফিল্টার: উদ্ধৃতি-চিহ্ন খোলা + "..."/"…"-জাতীয় ফাঁকা প্লেসহোল্ডার → '' */
function cleanField(v: string): string {
  const t = v.trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim()
  return /[\p{L}\p{N}]/u.test(t.replace(/[.।…·\s-]+/g, '')) ? t : ''
}

function parsePrice(raw: string): number | null {
  const norm = raw.replace(/[০-৯]/g, (d) => BN_DIGITS[d] || d)
  const m = norm.replace(/,/g, '').match(/\d+(?:\.\d+)?/)
  if (!m) return null
  const n = parseFloat(m[0])
  return isFinite(n) && n > 0 ? Math.round(n) : null
}

export function parseDraftItems(raw: string): GeneratedDraft[] | null {
  // ১) প্রাধান্য: লাইন-ব্লক ফরম্যাট (ITEM:/NAME:/…) — Gemma-র analysis-flood সহজে সহ্য করে
  const blocks = parseDraftBlocks(raw)
  if (blocks) return blocks
  // ২) ব্যাকআপ: মডেল তবু JSON লিখলে ({"items":[…]}) balanced স্ক্যানে খোঁজা
  const j = findDraftJson(raw)
  const items = j?.items
  if (!Array.isArray(items) || items.length === 0) return null
  const out: GeneratedDraft[] = []
  for (const it of items) {
    const o = (it ?? {}) as Record<string, unknown>
    const name = cleanField(typeof o.name === 'string' ? o.name : '')
    const category = cleanField(typeof o.category === 'string' ? o.category : '')
    if (!name || !category) continue
    out.push({
      name: name.slice(0, 80),
      category: category.slice(0, 40),
      description: cleanField(typeof o.description === 'string' ? o.description : '').slice(0, 500),
      price: typeof o.price === 'number' && isFinite(o.price) && o.price > 0 ? Math.round(o.price) : null,
      isSetMenu: o.isSetMenu === true,
      spiceLevels: Array.isArray(o.spiceLevels) ? o.spiceLevels.filter((s): s is string => typeof s === 'string').slice(0, 4) : [],
      advice: cleanField(typeof o.advice === 'string' ? o.advice : '').slice(0, 300),
    })
  }
  return out.length > 0 ? out.slice(0, 10) : null
}

/**
 * লাইন-ব্লক পার্সার: ITEM:/NAME:/CATEGORY:/PRICE:/DESC:/SET:/SPICE:/ADVICE: মার্কার
 * যেকোনো জায়গায় থাকলে ধরে নেয় — মডেল আগে বিশ্লেষণ লিখলেও আসল ব্লকগুলো পড়া যায়।
 * DESC/ADVICE একাধিক লাইনে গেলে পরের মার্কার পর্যন্ত জুড়ে নেয়।
 */
function parseDraftBlocks(raw: string): GeneratedDraft[] | null {
  const lines = raw.split(/\r?\n/)
  const fieldRe = /^(NAME|CATEGORY|PRICE|DESC|SET|SPICE|ADVICE)\s*[:：]\s*(.*)$/i
  const items: GeneratedDraft[] = []
  let cur: { name?: string; category?: string; description?: string; price?: number | null; isSetMenu?: boolean; spiceLevels?: string[]; advice?: string } | null = null
  let lastKey = ''
  let started = false
  for (const rawLine of lines) {
    // markdown সাজসজ্জা (**ITEM:** ইত্যাদি) খুলে ফেলা
    const line = rawLine.replace(/^[\s*`_>-]+/, '').replace(/[\s*`_]+$/, '').trim()
    if (/^ITEM\b\s*[:：]?\s*(\d+)?\s*$/i.test(line)) {
      if (cur) pushBlock(cur, items)
      cur = {}
      lastKey = ''
      started = true
      continue
    }
    if (!cur) continue
    const m = line.match(fieldRe)
    if (m) {
      const key = m[1].toUpperCase()
      const val = m[2].trim()
      if (key === 'NAME') cur.name = val
      else if (key === 'CATEGORY') cur.category = val
      else if (key === 'PRICE') cur.price = parsePrice(val)
      else if (key === 'DESC') cur.description = val
      else if (key === 'SET') cur.isSetMenu = /yes|true|হ্যাঁ|সেট/i.test(val)
      else if (key === 'SPICE') cur.spiceLevels = /none|না|nil/i.test(val) ? [] : val.split(/[,\/]/).map((s) => s.trim()).filter(Boolean).slice(0, 4)
      else if (key === 'ADVICE') cur.advice = val
      lastKey = key
      continue
    }
    // মার্কার-হীন লাইন: DESC/ADVICE-এর ধারাবাহিকতা হতে পারে (অন্য সব বিশ্লেষণ ফেলে দাও)
    if (!line) continue
    if (lastKey === 'DESC' && cur.description) cur.description = (cur.description + ' ' + line).slice(0, 500)
    else if (lastKey === 'ADVICE' && cur.advice) cur.advice = (cur.advice + ' ' + line).slice(0, 300)
  }
  if (cur) pushBlock(cur, items)
  if (!started || items.length === 0) return null
  return items.slice(0, 10)
}

function pushBlock(cur: { name?: string; category?: string; description?: string; price?: number | null; isSetMenu?: boolean; spiceLevels?: string[]; advice?: string }, out: GeneratedDraft[]) {
  const name = cleanField(cur.name || '')
  const category = cleanField(cur.category || '')
  if (!name || !category) return
  if (out.some((o) => o.name === name)) return // একই নাম দুবার এলে একটাই
  out.push({
    name: name.slice(0, 80),
    category: category.slice(0, 40),
    description: cleanField(cur.description || '').slice(0, 500),
    price: cur.price ?? null,
    isSetMenu: cur.isSetMenu === true,
    spiceLevels: (cur.spiceLevels || []).slice(0, 4),
    advice: cleanField(cur.advice || '').slice(0, 300),
  })
}

/**
 * Gemma-জাতীয় মডেল অনেক সময় আগে বিশ্লেষণ/ফরম্যাট-নমুনা লিখে JSON-টা শেষে দেয়
 * (analysis-flood)। স্ট্রিং-সচেতন balanced-brace স্ক্যানে পুরো টেক্সটের সব সম্পূর্ণ
 * JSON অবজেক্ট বের করে, যেগুলোতে অসামান্য name/category-সহ items অ্যারে আছে
 * সেগুলোর মধ্যে সবচেয়ে ভালো প্রার্থী বাছে — ফরম্যাট-টেমপ্লেট ইকো ({"items":[{"name":""…})
 * তখন আপনা-আপনি বাদ পড়ে।
 */
function findDraftJson(text: string): Record<string, unknown> | null {
  // দ্রুত-পথ: পুরো টেক্সটই একটা JSON
  try {
    const direct = JSON.parse(text)
    if (direct && typeof direct === 'object') return direct as Record<string, unknown>
  } catch {
    /* analysis-সহ আউটপুট → নিচের balanced স্ক্যান */
  }
  const objects: Record<string, unknown>[] = []
  let depth = 0
  let start = -1
  let inStr = false
  let esc = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') {
      inStr = true
      continue
    }
    if (ch === '{') {
      if (depth === 0) start = i
      depth++
    } else if (ch === '}') {
      if (depth > 0) {
        depth--
        if (depth === 0 && start >= 0) {
          try {
            const o = JSON.parse(text.slice(start, i + 1))
            if (o && typeof o === 'object') objects.push(o as Record<string, unknown>)
          } catch {
            /* ভাঙা টুকরো — নিরীহ */
          }
          start = -1
        }
      }
    }
  }
  let best: { items: unknown[]; score: number } | null = null
  for (const o of objects) {
    const items = o.items
    if (!Array.isArray(items) || items.length === 0) continue
    const score = items.filter((it) => {
      const x = (it ?? {}) as Record<string, unknown>
      return typeof x.name === 'string' && x.name.trim() && typeof x.category === 'string' && x.category.trim()
    }).length
    if (score > 0 && (!best || score >= best.score)) best = { items, score }
  }
  return best ? ({ items: best.items } as Record<string, unknown>) : null
}

/**
 * মালিকের নোট → ড্রাফট-আইটেম তালিকা। ব্যর্থ হলে ok:false + বাংলা error।
 */
export async function generateMenuDrafts(rawText: string, existingCategories: string[]): Promise<{ ok: boolean; items: GeneratedDraft[]; error: string | null }> {
  const catList = existingCategories.filter(Boolean).slice(0, 30)
  const user = [
    `রেস্টুরেন্টের বর্তমান ক্যাটাগরিগুলো: ${catList.length ? catList.join(', ') : '(এখনো কোনো ক্যাটাগরি নেই)'}`,
    `মালিকের নোট:\n"""${rawText.slice(0, 3000)}"""`,
    'এই নোট থেকে সব খাবার বের করে উপরের ব্যবস্থার ফরম্যাটে (প্রতিটি আইটেম = একটা ITEM: ব্লক) দাও — ব্লকের আগে/পরে কিছুই লিখবে না।',
  ].join('\n\n')
  const res = await adminStructuredGenerate({
    system: SYSTEM_PROMPT,
    user,
    temperature: 0.75,
    validate: (t) => !!parseDraftItems(t),
  })
  if (!res.ok || !res.text) return { ok: false, items: [], error: res.error || 'AI উত্তর দেয়নি' }
  const items = parseDraftItems(res.text)
  if (!items) return { ok: false, items: [], error: 'AI-এর উত্তর পড়া যায়নি — আবার চেষ্টা করুন' }
  return { ok: true, items, error: null }
}
