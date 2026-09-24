// Bot message packs — the ONE source of every customer-facing static text the
// Messenger bot sends (offer ask/verify/receipt, anti-fraud blocks, birthday
// wish, RN broadcast…). The admin picks the bot language in the admin panel
// (settings → 🌐 বটের ভাষা) and EVERY message — old & new customers, offers,
// receipts — is sent in that language.
//
// Precedence:
//   1. per-customer language (admin marks it on the CRM card / AI learned it)
//   2. the global bot_language setting
//   3. Bengali (bn) — the site's default language
//
// "auto" (empty setting) keeps the original behaviour: static texts in Bengali,
// while the AI freely chats in whatever language the customer writes.
import { getSetting } from '@/lib/settings'
import { SETTING_KEYS } from '@/lib/constants'

export type BotLang = 'bn' | 'banglish' | 'en' | 'hi'

/** languages the static packs exist for (AI additionally understands any language) */
export const BOT_LANG_CODES: BotLang[] = ['bn', 'banglish', 'en', 'hi']

type Pack = Record<string, string>

/* ───────────────────────────── Bengali (default) ───────────────────────────── */
const bn: Pack = {
  greet: 'স্বাগতম{name}! 🎉',
  followNudge: '\n\n💙 আমাদের Facebook পেজ Follow করে রাখুন — নতুন অফার সবার আগে পাবেন!\n{url}',
  askDate: 'যাচাইয়ের জন্য তারিখটি লিখে পাঠান (যেমন: 15/03/1995 বা 15 মার্চ 1995)।',
  askPhone: 'যাচাইয়ের জন্য আপনার ফোন নম্বরটি পাঠান।',
  askText: 'যাচাইয়ের জন্য নিচে আপনার তথ্যটি লিখে পাঠান।',
  retryDate: '😔 এটি সঠিক তারিখ মনে হচ্ছে না। এভাবে লিখে পাঠান: 15/03/1995 অথবা 15 মার্চ 1995।',
  retryPhone: '😔 এটি সঠিক ফোন নম্বর মনে হচ্ছে না। ১১ ডিজিটের নম্বর লিখে পাঠান (যেমন: 01712345678)।',
  retryText: '😔 বুঝতে পারা যায়নি — একটু পরিষ্কার করে আবার লিখে পাঠান।',
  askOfferHead: '{emoji} {offer} — ৳{discount} ছাড় অফার!\n\n{greet} দারুণ পছন্দ! 😊\n\nশুধু ছোট্ট একটা যাচাই দরকার — {ask}',
  askTail: '\n\nযেভাবে সুবিধা হয় লিখতে পারেন (বাংলা/English)।\n✅ তথ্যটি মিলে গেলেই ছাড়টি আপনার বিলে (টেবিল {table}) যোগ হয়ে যাবে।',
  generalFallback:
    'আমাদের বিশেষ অফার নিতে রেস্তোরাঁর বিল পেজ থেকে "🎉 Claim on Messenger" চাপুন — সেখান থেকে যাচাই করে ছাড় নিতে পারবেন।',
  cancelPivot: 'কোনো সমস্যা নেই! 😊 আমাদের আরও দারুণ অফার আছে — রেস্তোরাঁয় এসে উপভোগ করুন!',
  softWait: '😊 ঠিক আছে! সুবিধামতো সময়ে তথ্যটি পাঠিয়ে দিলেই অফারটি আপনার বিলে যোগ হয়ে যাবে।',
  softWaitMore: '😊 ঠিক আছে! সুবিধামতো সময়ে তথ্যটি পাঠিয়ে দিলেই অফারটি আপনার বিলে যোগ হয়ে যাবে। আর কিছু জানতে চাইলে বলুন!',
  verifySuccess: '✅ যাচাই সফল{name}, আপনার অফারটি বিলে যোগ হয়েছে! 🎉',
  receiptTitle: '🧾 ডিজিটাল রিসিট — টেবিল {table}',
  receiptOrderNo: 'অর্ডার #{no}:',
  receiptCoupon: '  কুপন ছাড়: -৳{amt}',
  receiptHappy: '  হ্যাপি আওয়ার ছাড়: -৳{amt}',
  receiptOffer: '  🎁 অফারের ছাড়: -৳{amt}',
  receiptTotal: '\nমোট প্রদেয়: ৳{amt}',
  receiptThanks: '\nধন্যবাদ{name}! 🙏 আবার আসবেন — বিল আপডেট ও অফার পেতে এই চ্যাটটি রেখে দিন।',
  blockOnePerBill:
    'এই বিলে ইতোমধ্যে একটি অফার ব্যবহার করা হয়েছে — প্রতি বিলে একটি অফারই প্রযোজ্য। বিল পরিশোধ করে আবার স্ক্যান করলেই নতুন অফার নিতে পারবেন! 😊',
  blockOfferUsed: 'এই অফারটি আগেই দাবি করা হয়েছে — একবারই প্রযোজ্য।',
  blockBirthdayUsed: 'জন্মদিনের ছাড়টি ইতোমধ্যে দাবি করা হয়েছে।',
  blockPhoneUsed: 'এই ফোন নম্বর ইতোমধ্যে ছাড় নিয়েছে।',
  blockDeviceUsed: 'জন্মদিনের ছাড়টি আগেই দাবি করা হয়েছে — একবারই প্রযোজ্য।',
  blockBillUsed: 'এই বিলে ইতোমধ্যে ছাড় প্রয়োগ করা হয়েছে।',
  blockMinBill: 'ন্যূনতম বিল ৳{min} হলে ছাড় প্রযোজ্য।',
  errOfferInactive: 'নির্বাচিত অফারটি এখন সক্রিয় নয়',
  errNoSession: 'সেশন পাওয়া যায়নি',
  errNoOrder: 'কোনো অর্ডার পাওয়া যায়নি',
  errFraudFallback: 'অ্যান্টি-ফ্রড চেক ব্যর্থ',
  applySuccess: '৳{amt} ছাড় প্রয়োগ হয়েছে!',
  birthdayWish:
    '🎂 শুভ জন্মদিন{name}!\n\nআপনার বিশেষ দিনে আমাদের পক্ষ থেকে ছোট্ট উপহার — কুপন "{coupon}" ব্যবহার করে আজকের অর্ডারে ১৫% ছাড় নিন! 🎉\nআমরা অপেক্ষায় আছি।',
  rnBroadcastDefault:
    '🎁 আসসালামু আলাইকুম{name}! এই সপ্তাহের স্পেশাল অফার এসে গেছে — সাথে জন্মদিনের সারপ্রাইজও অপেক্ষা করছে! 🍔🎉{base}',
  rnOrderLink: '\n\nঅর্ডার দিতে: {url}',
  rnTitleDefault: 'সাপ্তাহিক অফার ও জন্মদিনের সারপ্রাইজ',
}

/* ───────────────────────── Banglish (Latin-script Bangla) ───────────────────────── */
const banglish: Pack = {
  greet: 'Shagotom{name}! 🎉',
  followNudge: '\n\n💙 Amader Facebook page Follow kore rakhun — notun offer sobar age paben!\n{url}',
  askDate: 'Verification er jonno tarikh ta likhe pathan (jemon: 15/03/1995 othoba 15 March 1995).',
  askPhone: 'Verification er jonno apnar phone number ta pathan.',
  askText: 'Verification er jonno nichhe apnar tothyo ta likhe pathan.',
  retryDate: '😔 Eta thik tarikh mone hocche na. Evabe likhe pathan: 15/03/1995 othoba 15 March 1995.',
  retryPhone: '😔 Eta thik phone number mone hocche na. 11 digit er number likhe pathan (jemon: 01712345678).',
  retryText: '😔 Bujhte para jayni — ektu porishkar kore abar likhe pathan.',
  askOfferHead: '{emoji} {offer} — ৳{discount} discount offer!\n\n{greet} Darun pochondo! 😊\n\nShudhu choto ekta verification dorkar — {ask}',
  askTail: '\n\nJe bhabe subidha hoy likhte paren (Bangla/English).\n✅ Tothyo ta mile gele discount ta apnar bille (table {table}) jog hoye jabe.',
  generalFallback:
    'Amader special offer nite restaurant er bill page theke "🎉 Claim on Messenger" chapun — shekhane theke verify kore discount nite parben.',
  cancelPivot: 'Kono somossa nai! 😊 Amader aro darun offer ache — restaurant e eshe upobhog korun!',
  softWait: '😊 Thik ache! Subidhamoto shomoye tothyo ta pathiye dile offer ta apnar bille jog hoye jabe.',
  softWaitMore: '😊 Thik ache! Subidhamoto shomoye tothyo ta pathiye dile offer ta apnar bille jog hoye jabe. Ar kichhu jante chaile bolun!',
  verifySuccess: '✅ Verification successful{name}, apnar offer ta bille jog hoyeche! 🎉',
  receiptTitle: '🧾 Digital receipt — table {table}',
  receiptOrderNo: 'Order #{no}:',
  receiptCoupon: '  Coupon discount: -৳{amt}',
  receiptHappy: '  Happy Hour discount: -৳{amt}',
  receiptOffer: '  🎁 Offer discount: -৳{amt}',
  receiptTotal: '\nTotal payable: ৳{amt}',
  receiptThanks: '\nDhonnobad{name}! 🙏 Abar ashen — bill update o offer pete ei chat ta rekhe din.',
  blockOnePerBill:
    'Ei bille itomoddhe ekta offer use kora hoyeche — proti bille ekta offer-i prosongo. Bill porishodh kore abar scan korlei notun offer nite parben! 😊',
  blockOfferUsed: 'Ei offer ta agei claim kora hoyeche — ekbar-i prosongo.',
  blockBirthdayUsed: 'Jonmodiner discount ta itomoddhe claim kora hoyeche.',
  blockPhoneUsed: 'Ei phone number ta itomoddhe discount niyeche.',
  blockDeviceUsed: 'Jonmodiner discount ta agei claim kora hoyeche — ekbar-i prosongo.',
  blockBillUsed: 'Ei bille itomoddhe discount apply kora hoyeche.',
  blockMinBill: 'Minimum bill ৳{min} hole discount prosongo.',
  errOfferInactive: 'Nirbachito offer ta ekhon active nai',
  errNoSession: 'Session paoa jayni',
  errNoOrder: 'Kono order paoa jayni',
  errFraudFallback: 'Anti-fraud check fail koreche',
  applySuccess: '৳{amt} discount apply hoyeche!',
  birthdayWish:
    '🎂 Shubho jonmodin{name}!\n\nApnar special diner amader pokkhe theke chotto upohar — coupon "{coupon}" use kore ajker order e 15% discount nin! 🎉\nAmra opekkhay ache.',
  rnBroadcastDefault:
    '🎁 Assalamu alaikum{name}! Ei shoptaher special offer eshe geche — shathe jonmodiner surprise-o opekkha korche! 🍔🎉{base}',
  rnOrderLink: '\n\nOrder dite: {url}',
  rnTitleDefault: 'Shoptahik offer o jonmodiner surprise',
}

/* ───────────────────────────────── English ───────────────────────────────── */
const en: Pack = {
  greet: 'Welcome{name}! 🎉',
  followNudge: '\n\n💙 Follow our Facebook page — get new offers before anyone else!\n{url}',
  askDate: 'To verify, please send the date (e.g. 15/03/1995 or 15 March 1995).',
  askPhone: 'To verify, please send your phone number.',
  askText: 'To verify, please type your answer below.',
  retryDate: "😔 That doesn't look like a valid date. Please send it like: 15/03/1995 or 15 March 1995.",
  retryPhone: "😔 That doesn't look like a valid phone number. Please send an 11-digit number (e.g. 01712345678).",
  retryText: "😔 We couldn't understand that — please write it again a bit more clearly.",
  askOfferHead: '{emoji} {offer} — ৳{discount} discount offer!\n\n{greet} Great choice! 😊\n\nJust a quick verification is needed — {ask}',
  askTail: "\n\nWrite it however is easiest (Bangla/English).\n✅ Once it matches, the discount is added to your bill (table {table}).",
  generalFallback:
    'To grab our special offer, tap "🎉 Claim on Messenger" on the restaurant\'s bill page — you can verify there and get your discount.',
  cancelPivot: 'No problem at all! 😊 We have more great offers — come visit the restaurant and enjoy!',
  softWait: "😊 All good! Whenever you send the details, the offer will be added to your bill.",
  softWaitMore:
    "😊 All good! Whenever you send the details, the offer will be added to your bill. Anything else you'd like to know, just ask!",
  verifySuccess: '✅ Verified{name}, your offer has been added to your bill! 🎉',
  receiptTitle: '🧾 Digital receipt — table {table}',
  receiptOrderNo: 'Order #{no}:',
  receiptCoupon: '  Coupon discount: -৳{amt}',
  receiptHappy: '  Happy Hour discount: -৳{amt}',
  receiptOffer: '  🎁 Offer discount: -৳{amt}',
  receiptTotal: '\nTotal payable: ৳{amt}',
  receiptThanks: '\nThank you{name}! 🙏 Come again — keep this chat to get bill updates and offers.',
  blockOnePerBill:
    'This bill has already used an offer — one offer per bill. Pay the bill and scan again to grab a new one! 😊',
  blockOfferUsed: 'This offer has already been claimed — it works only once.',
  blockBirthdayUsed: 'The birthday discount has already been claimed.',
  blockPhoneUsed: 'This phone number has already used the discount.',
  blockDeviceUsed: 'The birthday discount has already been claimed — it works only once.',
  blockBillUsed: 'A discount has already been applied to this bill.',
  blockMinBill: 'The discount applies to bills of ৳{min} or more.',
  errOfferInactive: 'The selected offer is not active right now',
  errNoSession: 'Session not found',
  errNoOrder: 'No order found',
  errFraudFallback: 'Anti-fraud check failed',
  applySuccess: '৳{amt} discount applied!',
  birthdayWish:
    '🎂 Happy Birthday{name}!\n\nA little gift from us on your special day — use coupon "{coupon}" for 15% off today\'s order! 🎉\nWe\'re waiting for you.',
  rnBroadcastDefault:
    "🎁 Hello{name}! This week's special offer is here — plus a birthday surprise is waiting! 🍔🎉{base}",
  rnOrderLink: '\n\nTo order: {url}',
  rnTitleDefault: 'Weekly offers & birthday surprises',
}

/* ───────────────────────────────── Hindi ───────────────────────────────── */
const hi: Pack = {
  greet: 'स्वागत है{name}! 🎉',
  followNudge: '\n\n💙 हमारा Facebook पेज फॉलो करें — नए ऑफ़र सबसे पहले पाएं!\n{url}',
  askDate: 'सत्यापन के लिए तारीख भेजें (जैसे: 15/03/1995 या 15 मार्च 1995)।',
  askPhone: 'सत्यापन के लिए अपना फ़ोन नंबर भेजें।',
  askText: 'सत्यापन के लिए नीचे अपनी जानकारी लिखकर भेजें।',
  retryDate: '😔 यह सही तारीख नहीं लग रही। ऐसे भेजें: 15/03/1995 या 15 मार्च 1995।',
  retryPhone: '😔 यह सही फ़ोन नंबर नहीं लग रहा। 11 अंकों का नंबर भेजें (जैसे: 01712345678)।',
  retryText: '😔 समझ नहीं आया — कृपया थोड़ा स्पष्ट होकर दोबारा लिखें।',
  askOfferHead: '{emoji} {offer} — ৳{discount} छूट ऑफ़र!\n\n{greet} शानदार पसंद! 😊\n\nबस एक छोटा सत्यापन चाहिए — {ask}',
  askTail: '\n\nजो तरीका आसान हो, लिख दें (बांग्ला/English)।\n✅ जानकारी मैच होते ही छूट आपके बिल (टेबल {table}) में जुड़ जाएगी।',
  generalFallback:
    'हमारा स्पेशल ऑफ़र पाने के लिए रेस्टोरेंट के बिल पेज पर "🎉 Claim on Messenger" दबाएं — वहीं से सत्यापन करके छूट पा सकते हैं।',
  cancelPivot: 'कोई बात नहीं! 😊 हमारे पास और भी शानदार ऑफ़र हैं — रेस्टोरेंट आकर आनंद लें!',
  softWait: '😊 ठीक है! जब आप सुविधानुसार जानकारी भेज देंगे, ऑफ़र आपके बिल में जुड़ जाएगा।',
  softWaitMore: '😊 ठीक है! जब आप सुविधानुसार जानकारी भेज देंगे, ऑफ़र आपके बिल में जुड़ जाएगा। और कुछ जानना हो तो पूछिए!',
  verifySuccess: '✅ सत्यापन सफल{name}, आपका ऑफ़र बिल में जुड़ गया! 🎉',
  receiptTitle: '🧾 डिजिटल रसीद — टेबल {table}',
  receiptOrderNo: 'ऑर्डर #{no}:',
  receiptCoupon: '  कूपन छूट: -৳{amt}',
  receiptHappy: '  हैपी आवर छूट: -৳{amt}',
  receiptOffer: '  🎁 ऑफ़र छूट: -৳{amt}',
  receiptTotal: '\nकुल देय: ৳{amt}',
  receiptThanks: '\nधन्यवाद{name}! 🙏 फिर आएं — बिल अपडेट और ऑफ़र पाने के लिए यह चैट रखें।',
  blockOnePerBill:
    'इस बिल में पहले ही एक ऑफ़र इस्तेमाल हो चुका है — हर बिल में एक ही ऑफ़र लागू होता है। बिल चुकाकर दोबारा स्कैन करें और नया ऑफ़र लें! 😊',
  blockOfferUsed: 'यह ऑफ़र पहले ही क्लेम किया जा चुका है — केवल एक बार लागू।',
  blockBirthdayUsed: 'बर्थडे छूट पहले ही क्लेम की जा चुकी है।',
  blockPhoneUsed: 'इस फ़ोन नंबर पर छूट पहले ही ले ली गई है।',
  blockDeviceUsed: 'बर्थडे छूट पहले ही क्लेम हो चुकी है — केवल एक बार लागू।',
  blockBillUsed: 'इस बिल में पहले ही छूट लागू की जा चुकी है।',
  blockMinBill: 'छूट के लिए न्यूनतम बिल ৳{min} होना चाहिए।',
  errOfferInactive: 'चयनित ऑफ़र अभी सक्रिय नहीं है',
  errNoSession: 'सेशन नहीं मिला',
  errNoOrder: 'कोई ऑर्डर नहीं मिला',
  errFraudFallback: 'एंटी-फ्रॉड चेक विफल',
  applySuccess: '৳{amt} छूट लागू हो गई!',
  birthdayWish:
    '🎂 जन्मदिन मुबारक{name}!\n\nआपके खास दिन पर हमारी ओर से एक छोटा उपहार — कूपन "{coupon}" इस्तेमाल करके आज के ऑर्डर पर 15% छूट पाएं! 🎉\nहम इंतज़ार में हैं।',
  rnBroadcastDefault:
    '🎁 नमस्ते{name}! इस हफ़्ते का स्पेशल ऑफ़र आ गया है — साथ में बर्थडे सरप्राइज़ भी इंतज़ार कर रहा है! 🍔🎉{base}',
  rnOrderLink: '\n\nऑर्डर देने के लिए: {url}',
  rnTitleDefault: 'साप्ताहिक ऑफ़र और बर्थडे सरप्राइज़',
}

const PACKS: Record<BotLang, Pack> = { bn, banglish, en, hi }

/** translate: t('en', 'askPhone') / t(lang, 'blockMinBill', { min: 500 }) */
export function t(lang: BotLang, key: string, vars?: Record<string, string | number>): string {
  const pack = PACKS[lang] ?? bn
  let s = pack[key] ?? bn[key] ?? key
  if (vars) {
    for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v))
  }
  return s
}

/** raw admin setting ('' = auto, invalid values ignored) */
export async function getBotLanguageSetting(): Promise<string> {
  const v = await getSetting(SETTING_KEYS.BOT_LANGUAGE)
  return BOT_LANG_CODES.includes((v || '').trim() as BotLang) ? v.trim() : ''
}

/** global pack language for STATIC texts (auto/bn default → Bengali) */
export async function globalBotLang(): Promise<BotLang> {
  return ((await getBotLanguageSetting()) || 'bn') as BotLang
}

/** per-customer pack language: the admin's per-customer mark wins, else global */
export function pickBotLang(customerLang: string | null | undefined, globalLang: BotLang): BotLang {
  return customerLang && BOT_LANG_CODES.includes(customerLang as BotLang) ? (customerLang as BotLang) : globalLang
}

/**
 * language instruction for the AI (null = no instruction → AI mirrors whatever
 * language the customer writes). Per-customer mark wins, then the global setting.
 */
export async function aiLanguageFor(customerLang: string | null | undefined): Promise<string | null> {
  if (customerLang && BOT_LANG_CODES.includes(customerLang as BotLang)) return customerLang
  return (await getBotLanguageSetting()) || null
}

/** formatted name var: ' রাকিব' or '' — never a placeholder word in greetings */
export function nameVar(name: string): string {
  const n = (name || '').trim()
  if (!n || /^customer$/i.test(n) || n === 'নাম যাচাই বাকি') return ''
  return ` ${n}`
}
