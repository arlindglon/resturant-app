// ============================================================
// 🖼️ AI খাবারের ছবি — Gemini image generation + ImgBB hosting
//
// ছবি-হীন মেনু = মৃত মেনু। AI মেনু-লেখকের ড্রাফটে চাইলে এই ইঞ্জিন
// খাবারের প্রফেশনাল ফুড-ফটো বানিয়ে ImgBB-তে আপলোড করে URL দেয়।
//
// কি-রোটেশন: admin-দের জমানো Gemini keyগুলোই (getGeminiConfig) — একটা কোটা
// শেষ/মরা হলে পরের কি। মডেল-ফলব্যাক: gemini-2.5-flash-image (Nano Banana) →
// gemini-2.0-flash-preview-image-generation। ছবি বানানো best-effort —
// ব্যর্থ হলেও ড্রাফট/মেনু-ফ্লো কখনো আটকায় না (admin পরে ছবি দিতে পারেন)।
// ============================================================
import { getGeminiConfig } from '@/lib/gemini'
import { uploadImage } from '@/lib/imgbb'

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

const IMAGE_MODELS: { id: string; modalities: string[] }[] = [
  { id: 'gemini-2.5-flash-image', modalities: ['IMAGE'] },
  { id: 'gemini-2.0-flash-preview-image-generation', modalities: ['TEXT', 'IMAGE'] },
]

export interface FoodPhotoResult {
  ok: boolean
  url?: string
  error?: string
}

/** base64 ছবি → ImgBB (মাল্টি-কি, অটো-ফেইলওভার) */
async function hostImage(base64: string, mimeType: string): Promise<{ ok: boolean; url?: string; error?: string }> {
  try {
    const buf = Buffer.from(base64, 'base64')
    const file = new File([buf], 'ai-food.png', { type: mimeType || 'image/png' })
    const up = await uploadImage(file)
    if (!up.ok || !up.url) return { ok: false, error: up.error || 'ImgBB আপলোড ব্যর্থ' }
    return { ok: true, url: up.url }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'ImgBB আপলোড ব্যর্থ' }
  }
}

/**
 * খাবারের নাম/বিবরণ থেকে প্রফেশনাল ফুড-ফটো বানায় → ImgBB URL।
 * সব কি/মডেল ব্যর্থ হলে ok:false (কলার নিরাপদে এগিয়ে যাবে)।
 */
export async function generateFoodPhoto(name: string, description?: string): Promise<FoodPhotoResult> {
  const cfg = await getGeminiConfig()
  if (!cfg.enabled || cfg.keys.length === 0) {
    return { ok: false, error: 'AI চালু নেই — ছবি বানাতে Gemini key লাগবে' }
  }
  const prompt = [
    `Professional appetizing food photography of: ${name}.`,
    description ? `Dish details: ${description}` : '',
    'Plated beautifully on a clean wooden table, warm natural window light, gentle steam, fresh garnish, shallow depth of field, vibrant colors, mouth-watering, high quality, no text, no watermark, no people.',
  ]
    .filter(Boolean)
    .join(' ')

  for (const model of IMAGE_MODELS) {
    for (const key of cfg.keys) {
      try {
        const res = await fetch(`${API_BASE}/${encodeURIComponent(model.id)}:generateContent?key=${encodeURIComponent(key)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { responseModalities: model.modalities },
          }),
          signal: AbortSignal.timeout(120_000),
        })
        const j = (await res.json().catch(() => null)) as
          | { candidates?: { content?: { parts?: { inlineData?: { mimeType?: string; data?: string } }[] } }[]; error?: { message?: string } }
          | null
        const part = j?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)
        if (part?.inlineData?.data) {
          const hosted = await hostImage(part.inlineData.data, part.inlineData.mimeType || 'image/png')
          if (hosted.ok && hosted.url) return hosted
        }
        // কি মরা/অঞ্চল-ব্লক হলে এই কি আর চেষ্টা নয়
        const msg = j?.error?.message || `HTTP ${res.status}`
        if (/API key not valid|PERMISSION_DENIED|FAILED_PRECONDITION/i.test(msg)) break
      } catch {
        /* নেটওয়ার্ক/টাইমআউট → পরের কি */
      }
    }
  }
  return { ok: false, error: 'ছবি বানানো যায়নি — পরে আবার চেষ্টা করুন বা হাতে ছবি দিন' }
}
