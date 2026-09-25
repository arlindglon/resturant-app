// POST /api/admin/messenger-menu — চ্যাটবক্সের নিচের ফিক্সড পার্সিস্টেন্ট মেনু
// Meta পেজে সেট করে (POST /me/messenger_profile)। কাস্টমার যেকোনো সময় ☰
// আইকনে চেপে মেনু/অফার/লোকেশন/হেল্পলাইন পায় — এক ক্লিকে, টাইপ না করেই।
// বাটনগুলো postback পেলোড পাঠায় যা webhook-এর Rich-UI অ্যাকশন সামলায় (bot-ui.ts)।
import { ok } from '@/lib/api'
import { requirePerm } from '@/lib/staff-auth'
import { setPersistentMenu } from '@/lib/messenger'
import { botPersistentMenuEntries } from '@/lib/bot-ui'

export async function POST() {
  const denied = await requirePerm('settings')
  if (denied) return denied

  const r = await setPersistentMenu(botPersistentMenuEntries())
  if (!r.ok) return ok({ ok: false, error: r.error || 'Meta প্রোফাইল আপডেট ব্যর্থ' })
  return ok({ ok: true })
}
