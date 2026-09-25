// POST /api/admin/messenger-menu — চ্যাটবক্সের নিচের ফিক্সড পার্সিস্টেন্ট মেনু
// Meta পেজে সেট করে (POST /me/messenger_profile)। কাস্টমার যেকোনো সময় ☰
// আইকনে চেপে মেনু/অফার/লোকেশন/হেল্পলাইন পায় — এক ক্লিকে, টাইপ না করেই।
// বাটনগুলো postback পেলোড পাঠায় যা webhook-এর Rich-UI অ্যাকশন সামলায় (bot-ui.ts)।
// বাটন-তালিকা admin-সম্পাদনযোগ্য (messenger-menu-config) — এই রুট সেটাই Meta-তে সিঙ্ক করে।
//
// Meta নিয়ম: persistent_menu-র পূর্বশর্ত Get Started বাটন — তাই এই রুট একসাথে
// get_started (+ নতুন কথোপকথনের গ্রিটিং) ও সেট করে। "শুরু করুন" চাপলে __MENU__
// postback যায় → কাস্টমার সরাসরি ছবি-সহ মেনু ক্যারোসেল পায়।
import { ok } from '@/lib/api'
import { requirePerm } from '@/lib/staff-auth'
import { setPersistentMenu } from '@/lib/messenger'
import { BOT_ACTIONS, botPersistentMenuEntries } from '@/lib/bot-ui'

const GREETING =
  'আসসালামু আলাইকুম! 👋 Tea and Treat-এ স্বাগতম — মেনু, অফার বা লোকেশন জানতে নিচের বাটনে চাপুন বা লিখুন।'

export async function POST() {
  const denied = await requirePerm('settings')
  if (denied) return denied

  const entries = await botPersistentMenuEntries()
  const r = await setPersistentMenu(entries, {
    getStartedPayload: BOT_ACTIONS.MENU,
    greeting: GREETING,
  })
  if (!r.ok) return ok({ ok: false, error: r.error || 'Meta প্রোফাইল আপডেট ব্যর্থ' })
  return ok({ ok: true })
}
