// GET /api/admin/messenger-menu-status — "Meta-তে এখন যা আছে" লাইভ-চেক
// admin পার্সিস্টেন্ট-মেনু ম্যানেজারের স্ট্যাটাস প্যানেল: Meta পেজে এই মুহূর্তে
// কোন কোন বাটন আছে + "শুরু করুন" সেট কি না + admin-এর সেভ-করা তালিকার সাথে মিল।
// না মিললেই বোঝা যায় সিঙ্ক ব্যর্থ হয়েছে (রিসিপি: আবার সেভ/সিঙ্ক চাপুন)।
// মিললে কিন্তু Messenger-এ পুরনো দেখালে → Messenger অ্যাপের ক্যাশ — চ্যাট
// বন্ধ করে আবার খুললেই নতুন মেনু আসে।
import { ok } from '@/lib/api'
import { requirePerm } from '@/lib/staff-auth'
import { fetchPersistentMenuStatus, sanitizeMenuTitle } from '@/lib/messenger'
import { botPersistentMenuEntries } from '@/lib/bot-ui'

export async function GET() {
  const denied = await requirePerm('settings')
  if (denied) return denied

  const [meta, dbEntries] = await Promise.all([fetchPersistentMenuStatus(), botPersistentMenuEntries()])

  // টাইটেল-তুলনা: দুই পাশেই একই স্যানিটাইজার (variation-selector ইত্যাদি বাদ)
  const dbTitles = dbEntries.map((e) => sanitizeMenuTitle(e.title))
  const metaTitles = meta.buttons.map((b) => sanitizeMenuTitle(b.title))
  const inSync =
    meta.ok && dbTitles.length === metaTitles.length && dbTitles.every((t, i) => t === metaTitles[i])

  return ok({
    dbEntries,
    meta,
    inSync,
    hint: !meta.ok
      ? 'Graph error দেখুন — টোকেন/পারমিশন সমস্যা হলে Meta App Settings-এ Pages-এর permission যোগ করতে হবে'
      : inSync
        ? 'Meta আপডেট আছে — Messenger-এ দেখতে চ্যাট বন্ধ করে আবার খুলুন'
        : 'Meta-তে পুরনো মেনু আছে — সেভ/সিঙ্ক বাটন আবার চাপুন',
  })
}
