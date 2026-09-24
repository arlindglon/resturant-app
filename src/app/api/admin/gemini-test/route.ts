// POST /api/admin/gemini-test — live-test every configured Gemini API key
// (tiny ping per key) + a real sample chat reply built from the knowledge
// base + a verification-flow sample (a customer who says the occasion
// doesn't apply), so the admin sees exactly what their customers will experience.
import { ok } from '@/lib/api'
import { requirePerm } from '@/lib/staff-auth'
import { buildKnowledgeBase } from '@/lib/knowledge'
import { getGeminiConfig, chatWithCustomer, verificationChat, testGeminiKey } from '@/lib/gemini'

export async function POST() {
  const denied = await requirePerm('settings')
  if (denied) return denied

  const cfg = await getGeminiConfig()

  if (!cfg.keys.length) {
    return ok({
      enabled: cfg.enabled,
      model: cfg.model,
      keys: [],
      sample: { ok: false, reply: null, error: 'কোনো API কি যোগ করা হয়নি' },
      verifySample: null,
    })
  }

  // 1) ping every key in parallel
  const keys = await Promise.all(cfg.keys.map((k) => testGeminiKey(k)))

  // 2) sample chat with the first working key path (uses rotation internally)
  const anyKeyOk = keys.some((k) => k.ok) // প্রাইমারি পিং ফল হলেও ফলব্যাক চেইন উত্তর দিতে পারে
  void anyKeyOk
  let sample: { ok: boolean; reply: string | null; error: string | null } = {
    ok: false,
    reply: null,
    error: 'সব কি ব্যর্থ',
  }
  let verifySample: { ok: boolean; reply: string | null; action: string; error: string | null } | null = null
  // স্যাম্পল সবসময় চলে — প্রাইমারি মডেলের পিং ব্যর্থ হলেও ফলব্যাক চেইন (৩.১ লাইট →
  // gemma) উত্তর দিতে পারে; চেইনের আসল অবস্থা এখানেই দেখা যায়
  {
    const kb = await buildKnowledgeBase()
    const ai = await chatWithCustomer({
      knowledgeBase: kb.text,
      history: [],
      customerMessage: 'তোমাদের জনপ্রিয় খাবার কোনটা? দাম কত? আর কোনো অফার আছে?',
      customerName: '',
      extraPersona: cfg.persona,
      cfg,
    })
    sample = { ok: ai.ok, reply: ai.reply, error: ai.error }

    // verification-flow sample: an UNMARRIED customer on the anniversary offer —
    // the bot must cancel gracefully and pivot to something that fits them
    const vi = await verificationChat({
      fieldType: 'DATE',
      offerName: 'বিবাহবার্ষিকী স্পেশাল',
      askText: 'আপনার বিবাহের তারিখ বলুন (যেমন: 15/03/1995)',
      lastAskSent: 'আপনার বিবাহের তারিখ বলুন (যেমন: 15/03/1995)',
      askCount: 0,
      knowledgeBase: kb.text,
      history: [
        { role: 'user', text: 'heo bhai' },
        { role: 'model', text: 'আপনার বিবাহের তারিখ বলুন (যেমন: 15/03/1995)' },
      ],
      customerMessage: 'ami biye korini bhai, amr nam rakib',
      cfg,
    })
    verifySample = { ok: vi.ok, reply: vi.reply, action: vi.action, error: vi.error }
  }

  return ok({
    enabled: cfg.enabled,
    model: cfg.model,
    keys,
    kbStats: (await buildKnowledgeBase().catch(() => null))?.stats ?? null,
    sample,
    verifySample,
  })
}
