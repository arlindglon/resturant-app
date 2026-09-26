# 📖 Messenger সম্পূর্ণ সেটআপ গাইড (Tea & Treat)

> নতুন Meta App বানিয়ে রেস্টুরেন্টের Messenger বট চালু করার **ধাপে ধাপে পূর্ণ গাইড**।
> শেষ পর্যন্ত মানলে **কোনো এরর ছাড়াই ১০০% কাজ করবে**। সব সেটিং admin প্যানেল থেকেই
> হয় — Vercel env ছোঁয়া বা রিডিপ্লয় লাগে না।

**সাইট:** https://teantreat.vercel.app (admin: `/admin`)
**GitHub:** https://github.com/arlindglon/resturant-app (main branch → Vercel অটো-ডিপ্লয়)

---

## 🎯 যা যা লাগবে (১ মিনিট চেকলিস্ট)

| লাগবে | কোথায় পাবেন |
|---|---|
| Facebook অ্যাকাউন্ট (পেজের মালিক) | — |
| Facebook **Page** (যেটার মেসেঞ্জারে বট কথা বলবে) | facebook.com-এ আপনার পেজ |
| Meta ডেভেলপার অ্যাকাউন্ট | https://developers.facebook.com |
| আপনার সাইটের যেকোনো পাবলিক লিংক (Privacy Policy URL হিসেবে) | যেমন `https://teantreat.vercel.app/` |
| Admin প্যানেলে ঢোকার পাসওয়ার্ড | মালিকের কাছে আছে |

---

## ধাপ ১ — Meta App তৈরি (২ মিনিট)

1. https://developers.facebook.com → ডান-উপরে প্রোফাইলে **লগইন** করুন (যে অ্যাকাউন্ট পেজের Admin, সেটাই হতে হবে)।
2. **My Apps → Create App** চাপুন।
3. Use case/প্রকার জিজ্ঞেস করলে **Business** সিলেক্ট করুন → Next।
4. App name দিন (যেমন: `Tea and Treat Bot`) → App contact email দিন → **Create App**।
   - পাসওয়ার্ড চাইলে দিন। এখন আপনি এই অ্যাপের **Admin** (এটাই জরুরি — Development Mode-এও ঠিক এই অ্যাকাউন্টের সাথে বট কথা বলতে পারবে)।

## ধাপ ২ — Messenger প্রোডাক্ট যোগ (৩০ সেকেন্ড)

1. App ড্যাশবোর্ডের বাম মেনুতে **Messenger** খুঁজে **Set up** চাপুন।
2. Messenger-এর ঘরে **API Setup** (নতুন ভার্সনে *Messenger API Settings*) খুলুন।

## ধাপ ৩ — Page Access Token জেনারেট ⭐ সবচেয়ে জরুরি

1. একই API Setup পেজে **Access Token** সেকশনে আপনার **Facebook Page** সিলেক্ট করুন।
2. **Generate Token** চাপুন → পপ-আপে পারমিশন চাইলে **Continue as … → OK** দিন।
3. টোকেনটি কপি করুন — `EAA` **দিয়ে শুরু** হবে, অনেক লম্বা। ⚠️ পুরোটা কপি হয়েছে কি না দেখে নিন।
4. **টোকেনে এই ৪টা পারমিশন থাকা চাই** (API Setup পেজেই দেখা যায় / Generate করার সময় টিক-থাকে):
   - `pages_messaging` — কাস্টমারকে মেসেজ পাঠানো
   - `pages_manage_metadata` — webhook ফিল্ড সাবস্ক্রাইব + পার্সিস্টেন্ট মেনু সেট
   - `pages_read_engagement` — পেজ প্রোফাইল পড়া
   - `pages_show_list` — পেজ চেনা
   - কোনোটা না থাকলে: Graph API Explorer (https://developers.facebook.com/tools/explorer) → আপনার App সিলেক্ট → **User/Page Permissions**-এ উপরের ৪টা টিক দিন → **Generate Access Token** → ড্রপডাউন থেকে **Page token** কপি করুন (`/me/accounts` রেসপন্সে পেজের `access_token`)।

> ⚠️ **সাবধান:** `EAA…` দিয়ে শুরু হলেও **User token** কপি করা যায় (Graph API Explorer-এর ডিফল্ট)। User token-এ **কাস্টমারকে মেসেজ যায় না**। Admin প্যানেলের যাচাই এটা ধরে ফেলে ও বলে দেবে। Page token সবসময় Page সিলেক্ট করে Generate করতে হয়।

## ধাপ ৪ — Admin প্যানেলে ৩টা মান সেভ (১ মিনিট)

1. https://teantreat.vercel.app/admin → পাসওয়ার্ড দিন → উপরের ট্যাব থেকে **🤖 মেসেঞ্জার** খুলুন।
2. একদম উপরে **🧩 মেসেঞ্জার সেটআপ উইজার্ড** কার্ডে:
   - 🔑 **META_PAGE_TOKEN** — ধাপ ৩-এর টোকেন পেস্ট করুন।
   - 🔐 **META_VERIFY_TOKEN** — 🎲 চেপে নতুন টোকেন বানিয়ে নিন (বা নিজের ৬+ অক্ষরের কোনো গোপন শব্দ, যেমন `my_shop_verify_99`)। **এই শব্দটা মনে রাখুন/কপি রাখুন — ধাপ ৫-এ আবার লাগবে।**
   - 🆔 **META_PAGE_ID** — 🔍 **অটো** বাটন চাপুন (টোকেন থেকে নিজেই এসে বসবে)।
   - **💾 সেভ করুন** চাপুন।

> ✅ এখানে সেভ করলেই সব কার্যকর হয়ে যায় (৩০ সেকেন্ডের মধ্যে)। পুরনো টোকেনের মেয়াদ শেষ হলে আবার এখানেই নতুনটা পেস্ট করবেন — Vercel-এ ঢোকা লাগবে না।

## ধাপ ৫ — Meta-তে Webhook কনফিগার (২ মিনিট)

1. উইজার্ডের **🔗 Webhook Callback URL** লেখাটা **📋 কপি** করুন (হবে `https://teantreat.vercel.app/api/webhook/messenger`)।
2. Meta ড্যাশবোর্ড → Messenger → API Setup → **Webhooks** → **Configure** (বা Edit)।
3. **Callback URL** = কপি করা লিংক, **Verify Token** = ধাপ ৪-এর 🔐 টোকেনটা **হুবহু একই বানানে** → **Verify and Save**।
   - ✅ সফল হলে অ্যাপ নিজেই আপনার সার্ভারের সাথে হাত মেলায় (handshake)।
   - ❌ `Verification failed` এলে দুই জায়গার টোকেন মিলছে না — দুটোই একই করে নিন।
4. একই ঘরে **Subscribed fields** — **Add subscriptions** চেপে এই **৮টা** টিক দিন:
   `messages`, `messaging_postbacks`, `messaging_optins`, `message_deliveries`, `message_reads`, `message_reactions`, `messaging_referrals`, `messaging_handovers`
   > 💡 সংক্ষেপ: উইজার্ডের **✅ সম্পূর্ণ যাচাই** চাপলে কোন ফিল্ড বাকি সে দেখাবে আর **🔧 এখনই ঠিক করুন** বাটনে এক ক্লিকে সব সাবস্ক্রাইব হয়ে যাবে।
5. পেজ সাবস্ক্রিপশন: কিছু ভার্সনে **Page → Webhooks**-এ আলাদা সাবস্ক্রাইব চায় — উইজার্ডের যাচাই সবুজ থাকলে সেটাও ঠিক আছে।

## ধাপ ৬ — App Live করা ⭐ (নইলে বাইরের কাস্টমার মেসেজ পায় না!)

1. Meta ড্যাশবোর্ড → **App Settings → Basic**:
   - **Privacy Policy URL** দিন — আপনার সাইটের যেকোনো পাবলিক পেজ চলে (যেমন `https://teantreat.vercel.app/`)।
   - Category: `Business and pages` — দিলে ভালো।
   - **Save Changes**।
2. ড্যাশবোর্ডের উপরে App Mode সুইচ: **Development → Live** → কনফার্ম করুন।

> 🔑 **মনে রাখুন:** **Development Mode**-এ বট শুধু অ্যাপের **Admin / Developer / Tester** রোলধারীদের সাথে কথা বলতে পারে। সাধারণ কাস্টমার মেসেজ দিলে উত্তর যায় না এবং admin-এর পাঠানো মেসেজে *«Application does not have permission for this action»* এরর দেখায় — **এই এররের মানেই App Live হয়নি।**
>
> 📝 App Review: `pages_messaging` Live করার সময় Advanced Access চাইতে পারে — Messenger অ্যাপে এটা সাধারণত সঙ্গে সঙ্গে অনুমোদিত হয় (App Review → Permissions → pages_messaging → Request Advanced Access)। ব্যবসায়িক যাচাই চাইলে Meta-র নির্দেশ মেনে করুন।

## ধাপ ৭ — ১০০% যাচাই (৩০ সেকেন্ড)

Admin প্যানেল → 🤖 মেসেঞ্জার ট্যাব → উইজার্ডে **✅ সম্পূর্ণ যাচাই** চাপুন। **৫টা চেক:**

| চেক | সবুজ মানে |
|---|---|
| ✅ Page Access Token বৈধ | টোকেনটা আসল Page token + কোন পেজ সেটা দেখায় |
| ✅ Webhook handshake 200 | Meta-র সেভ-বাটন ঠিক এভাবেই সফল হবে (403 = টোকেন-মিল নেই) |
| ✅ Webhook ফিল্ড ৮/৮ | মেসেজ/বাটন/লাইক/ডেলিভারি — সব ইভেন্ট আসবে |
| ✅ শেষ Meta-ইভেন্ট | কাস্টমার মেসেজ দিলে এখানে সময় বসে — লাইভ প্রমাণ |
| ✅ পাঠানো-এরর নেই | শেষ মেসেজ সফলভাবে গেছে; এরর থাকলে 💡 সমাধানসহ দেখায় |

সব সবুজ = শেষ! Messenger-এ পেজে নিজে মেসেজ দিন — বট "শুরু করুন"/মেনু-বাটনসহ উত্তর দেবে।

---

## 🚑 সমস্যা → কারণ → সমাধান (প্রায় সব এরর এখানেই)

| এরর / লক্ষণ | কারণ | সমাধান |
|---|---|---|
| «Application does not have permission for this action» | App **Development Mode**-এ আছে (শুধু admin/developer/tester পায়) | ধাপ ৬: Privacy Policy URL দিয়ে App **Live** করুন |
| «(#200) … pages_messaging» / permission এরর | টোকেনে `pages_messaging` নেই | ধাপ ৩: ৪ পারমিশনসহ নতুন Page token বানিয়ে উইজার্ডে সেভ |
| «(#100) Invalid keys "text_format"» | পুরনো কোড মার্কডাউন-ফিল্ড পাঠাত | ✅ আর হয় না (কোডে ফিল্ডটা বাদ দেওয়া হয়েছে); দেখালে Vercel-এ সর্বশেষ deploy আছে কি না দেখুন |
| «(#551)/outside the allowed window / ২৪ ঘণ্টা» | কাস্টমার শেষ মেসেজ করার ২৪ ঘণ্টা পেরিয়েছে (Meta-র নিয়ম) | কাস্টমার মেসেজ দিলেই ২৪ ঘণ্টা খুলে যায়; উইন্ডো-বাইরে পাঠাতে হলে 🔔 RN অপট-ইন (ব্রডকাস্ট ট্যাব) |
| Webhook সেভ করতে «Verification failed» / handshake ❌ (403) | Meta-তে পেস্ট করা Verify Token ≠ প্যানেলে সেভ করা টোকেন | দুই জায়গায় **হুবহু একই** টোকেন দিন (উইজার্ডের 🔐 + 📋 কপি ব্যবহার করুন) |
| টোকেন সেভ করেও «Page Access Token নয় — User token» দেখায় | Graph API Explorer-এর User token পেস্ট হয়েছে | ধাপ ৩: Page সিলেক্ট করে Generate Token / `/me/accounts`-এর পেজ-টোকেন নিন |
| «(#100) No matching user» / PSID এরর | PSID অন্য অ্যাপের (পেজ-স্কোপড ID অ্যাপভেদে বদলায়) | নতুন অ্যাপে webhook লাগানোর পর কাস্টমার আবার মেসেজ দিলে নতুন PSID স্বয়ংক্রিয় ভাবে জমা হয় |
| মেনু/অফারের উত্তর আসে না, শুধু AI কথা বলে | `messaging_postbacks`/`message_reactions` ফিল্ড সাবস্ক্রাইব নেই | উইজার্ড → 🔧 এখনই ঠিক করুন (৮/৮ ফিল্ড) |
| «Cannot message users who are not admins…» | App Live হয়নি বা কাস্টমার রোলধারী নয় | ধাপ ৬: Live করুন; টেস্টের সময় নিজেকে Tester রোল দিতে পারেন (App Roles → Testers → Add) |
| টোকেন হঠাৎ কাজ করছে না (মেয়াদ শেষ) | টোকেন রিজেনারেট করা হয়েছে / পাসওয়ার্ড বদল | নতুন Page token বানিয়ে উইজার্ডে সেভ — ৩০ সেকেন্ডেই কার্যকর |
| «Invalid OAuth token» | টোকেন ভুল/কপি অসম্পূর্ণ | পুরো টোকেন আবার কপি করে সেভ (শুরু `EAA`, স্পেস ছাড়া) |

---

## 🔧 বিকল্প পথ — Vercel env (ঐচ্ছিক)

admin প্যানেলের সেটিং না থাকলে এই env-গুলো কাজ করে (প্যানেলের সেটিং **সবসময় অগ্রাধিকার পায়**):

| Vercel env | কী | কোথায় |
|---|---|---|
| `META_PAGE_TOKEN` | Page Access Token (`EAA…`) | Vercel → Settings → Environment Variables |
| `META_PAGE_ID` | Page ID (ডায়াগনস্টিকস) | 〃 (ঐচ্ছিক) |
| `META_VERIFY_TOKEN` | Webhook Verify Token | 〃 |
| `META_APP_SECRET` | App Secret (webhook-সিগনেচার যাচাই) | 〃 (ঐচ্ছিক, বাড়তি নিরাপত্তা) |

> বদলালে **Redeploy** লাগে — তাই সহজ পথ হলো admin প্যানেলের 🧩 উইজার্ড (সঙ্গে সঙ্গে কার্যকর)।

---

## 📌 মনে রাখার মতো নিয়ম (এই সিস্টেমের)

- ☰ **ফিক্সড মেনু** (🍕 মেনু · 🔥 অফার · 📍 লোকেশন · ☎ হেল্পলাইন) সবসময় Messenger-এর নিচে থাকে — কখনো হারায় না; এডিট করতে 🤖 ট্যাবের মেনু-ম্যানেজার।
- বটের **মেনু-বাটন/লাইক কখনো AI দিয়ে যায় না** — সঙ্গে সঙ্গে DB থেকে নিশ্চিত উত্তর যায়; AI শুধু খোলা প্রশ্নে।
- কাস্টমার যা-ই পাঠাক, উত্তরের আগে **"…" টাইপিং-ইন্ডিকেটর** দেখায় (admin লিখলেও)।
- প্রতিটা মেসেজের নিচে **মেনু-বাটন সবসময়** থাকে — বাটন রিজেক্ট হলে বাটন ছাড়া রিট্রাই (মেসেজ কখনো হারায় না)।

*সর্বশেষ হালনাগাদ: Graph API v21.0, text_format/markdown ফিল্ড অসমর্থিত — কোড থেকে বাদ দেওয়া।*
