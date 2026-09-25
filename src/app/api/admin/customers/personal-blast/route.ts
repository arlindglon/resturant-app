// POST /api/admin/customers/personal-blast — AI-personalized one-by-one message
// মালিক কাঁচা তথ্য লেখেন (আবহাওয়া/ছুটি/খবর/ইভেন্ট — যা কিছু), AI প্রতিটা কাস্টমারের
// জন্য আলাদা প্রফেশনাল এনগেজিং মেসেজ লিখে Messenger-এ পাঠায় (একবারে একজন —
// ফ্রন্টএন্ড লুপ করে; Vercel timeout + Gemini rate-limit নিরাপদ থাকে)।
// কাস্টমার আগে যেসব ভাউচার ব্যবহার করেছে সেগুলো নলেজ বেস থেকে বাদ — AI আর
// ব্যবহৃত অফার প্রস্তাব করে না।
// মালিকের নির্দেশ: কোনো টাইমআউট নয় — AI যত সময় লাগে লিখবে; retry-সহ মোট
// সময় Vercel সীমার ভেতর রাখতে প্রতি compose-এ ১২০s বাজেট (২×১২০+overhead < ৩০০s)।
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, fail } from '@/lib/api'
import { requirePerm } from '@/lib/staff-auth'
import { sendText, sendRnToToken, markdownEnabled } from '@/lib/messenger'
import { getGeminiConfig, composePersonalBlast, loadChatHistory, saveChatTurn } from '@/lib/gemini'
import { buildKnowledgeBase } from '@/lib/knowledge'
import { aiLanguageFor } from '@/lib/bot-text'
import { usedVoucherIdsForPsid } from '@/lib/vouchers'

export const maxDuration = 300
const COMPOSE_BUDGET_MS = 120_000

export async function POST(req: NextRequest) {
  const denied = await requirePerm('tables')
  if (denied) return denied

  const body = await req.json().catch(() => ({}))
  const info = (body.info || '').toString().trim().slice(0, 1500)
  const customerId = (body.customerId || '').toString()
  if (!info) return fail('আগে তথ্যটি লিখুন', 400)
  if (!customerId) return fail('কাস্টমার নির্বাচন করুন', 400)

  const cfg = await getGeminiConfig()
  if (!cfg.enabled || !cfg.keys.length) {
    return fail('Gemini AI চালু নেই — সেটিংসে API কি যোগ করুন।', 400, 'AI_DISABLED')
  }

  const customer = await db.customer.findUnique({
    where: { id: customerId },
    include: { notes: { orderBy: { createdAt: 'desc' as const }, take: 10, select: { kind: true, text: true } } },
  })
  if (!customer) return fail('কাস্টমার পাওয়া যায়নি', 404)
  if (customer.psid.startsWith('direct:')) {
    return fail('এই কাস্টমার Messenger-এ চ্যাট করেননি — মেসেজ যাবে না।', 400, 'NO_MESSENGER')
  }

  const [kb, history, notes] = await Promise.all([
    buildKnowledgeBase({ excludeVoucherIds: await usedVoucherIdsForPsid(customer.psid) }),
    loadChatHistory(customer.psid, 6),
    Promise.resolve(customer.notes?.length ? customer.notes.map((n) => `- ${n.text}`).join('\n') : undefined),
  ])
  const lastBot = [...history].reverse().find((h) => h.role === 'model')?.text || null
  const customerLanguage = await aiLanguageFor(customer.language)
  const clean = (s: string) => (s || '').trim()
  const nm = [clean(customer.firstName), clean(customer.lastName || '')]
    .filter((s) => s && s !== 'নাম যাচাই বাকি' && !/^customer$/i.test(s))
    .join(' ')

  const blastOpts = {
    knowledgeBase: kb.text,
    adminInfo: info,
    customerName: nm,
    customerNotes: notes,
    customerLanguage,
    lastBotMessage: lastBot,
    recentHistory: history.slice(-4),
    extraPersona: cfg.persona,
    formatting: await markdownEnabled(),
    cfg,
  }
  // একটা retry — Gemini মাঝে মাঝে rate-limit/খালি উত্তর দেয় (কোনো টাইমআউট নয় —
  // AI যত সময় লাগে লিখবে, প্রতি চেষ্টায় ১২০s বাজেট)
  let ai = await composePersonalBlast({ ...blastOpts, cfg: { ...cfg, budgetMs: COMPOSE_BUDGET_MS } })
  if (!ai.ok) {
    await new Promise((r) => setTimeout(r, 1200))
    ai = await composePersonalBlast({ ...blastOpts, cfg: { ...cfg, budgetMs: COMPOSE_BUDGET_MS } })
  }
  if (!ai.ok || !ai.text) return fail(ai.error || 'মেসেজ লেখা যায়নি', 502, 'AI_FAIL')

  const text = ai.text.slice(0, 1900)
  let via: 'messenger' | 'rn' | null = null
  if (await sendText(customer.psid, text)) via = 'messenger'
  else if (customer.rnToken && (await sendRnToToken(customer.rnToken, text)).ok) via = 'rn'
  if (!via) {
    return fail(
      customer.rnToken
        ? 'পাঠানো যায়নি — Messenger ও RN টোকেন দুটোই রিজেক্ট করেছে।'
        : 'পাঠানো যায়নি — ২৪ ঘণ্টার নিয়মের বাইরে (কাস্টমার RN আপডেট চালু করেননি)।',
      502,
      'SEND_FAILED'
    )
  }

  // পাঠানো মেসেজ চ্যাট মেমোরিতেও রাখি — পরের AI কথোপকথন এটা জেনে চলে
  await saveChatTurn(customer.psid, 'bot', text)
  return ok({ sent: true, via, text })
}
