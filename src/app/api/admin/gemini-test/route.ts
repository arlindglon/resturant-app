// POST /api/admin/gemini-test — live-test every configured Gemini API key
// (tiny ping per key) + a real sample chat reply built from the knowledge
// base, so the admin sees exactly what their customers will experience.
import { ok } from '@/lib/api'
import { requirePerm } from '@/lib/staff-auth'
import { buildKnowledgeBase } from '@/lib/knowledge'
import { getGeminiConfig, chatWithCustomer, testGeminiKey } from '@/lib/gemini'

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
    })
  }

  // 1) ping every key in parallel
  const keys = await Promise.all(cfg.keys.map((k) => testGeminiKey(k)))

  // 2) sample chat with the first working key path (uses rotation internally)
  const anyKeyOk = keys.some((k) => k.ok)
  let sample: { ok: boolean; reply: string | null; error: string | null } = {
    ok: false,
    reply: null,
    error: 'সব কি ব্যর্থ',
  }
  if (anyKeyOk) {
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
  }

  return ok({
    enabled: cfg.enabled,
    model: cfg.model,
    keys,
    kbStats: (await buildKnowledgeBase().catch(() => null))?.stats ?? null,
    sample,
  })
}
