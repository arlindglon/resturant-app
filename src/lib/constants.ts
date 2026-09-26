// Central constants — statuses are plain strings (portable across MySQL/SQLite)

export const ORDER_STATUS = {
  PLACED: 'PLACED',
  COOKING: 'COOKING',
  READY: 'READY',
  SERVED: 'SERVED',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const

export const TABLE_STATUS = {
  FREE: 'FREE',
  OCCUPIED: 'OCCUPIED',
} as const

export const WAITER_TYPES = {
  WAITER: 'WAITER',
  WATER: 'WATER',
  CLEAN: 'CLEAN',
  BILL: 'BILL',
} as const

export const DISCOUNT_TYPES = {
  PERCENT: 'PERCENT',
  FIXED: 'FIXED',
} as const

export const VOUCHER_RULES = {
  GENERAL: 'GENERAL',
  HOT_TIME: 'HOT_TIME',
  SPECIAL_DAY: 'SPECIAL_DAY',
  SET_MENU_QTY: 'SET_MENU_QTY',
} as const

export const SPICE_LEVELS = ['Mild', 'Medium', 'Hot'] as const

export const SESSION_COOKIE = 'qr_session'
export const ADMIN_COOKIE = 'admin_token'
export const STAFF_COOKIE = 'staff_key'
export const KDS_COOKIE = 'kds_token'

// Access key roles
export const ACCESS_KEY_ROLES = {
  KDS: 'KDS',
  ADMIN_CONTROLLER: 'ADMIN_CONTROLLER',
} as const

// Sub-admin (admin controller) permission catalog — main admin marks what
// each sub-admin can access inside the admin panel.
// Key management itself is ALWAYS main-admin-only (not grantable).
export const SUB_ADMIN_PERMISSIONS: { id: string; label: string; desc: string }[] = [
  { id: 'overview', label: 'ওভারভিউ', desc: 'লাইভ স্ট্যাটস ও বিক্রি দেখা' },
  { id: 'tables', label: 'টেবিল ও QR', desc: 'লাইভ অর্ডার, টেবিল ক্লিয়ার, ওয়েটার কল, বিল পেমেন্ট' },
  { id: 'menu', label: 'মেনু', desc: 'আইটেম/ক্যাটাগরি যোগ, এডিট, ডিলিট' },
  { id: 'happy', label: 'হ্যাপি আওয়ার', desc: 'হ্যাপি আওয়ার রুল ম্যানেজমেন্ট' },
  { id: 'vouchers', label: 'ভাউচার', desc: 'কুপন/ভাউচার ক্যাম্পেইন ম্যানেজমেন্ট' },
  { id: 'ledger', label: 'সিকিউরিটি লেজার', desc: 'হ্যাশ চেইন ঘটনা দেখা' },
  { id: 'imgbb', label: 'ImgBB কি', desc: 'ইমেজ আপলোড API কি ম্যানেজমেন্ট' },
  { id: 'settings', label: 'সেটিংস', desc: 'রেস্টুরেন্ট সেটিংস বদলানো' },
]

export const SUB_ADMIN_PERM_IDS = SUB_ADMIN_PERMISSIONS.map((p) => p.id)

// Settings keys
export const SETTING_KEYS = {
  SESSION_DURATION_MINUTES: 'session_duration_minutes',
  KITCHEN_DELAY_ALERT_MINUTES: 'kitchen_delay_alert_minutes',
  BIRTHDAY_DISCOUNT_AMOUNT: 'birthday_discount_amount',
  BIRTHDAY_MIN_BILL: 'birthday_min_bill',
  RESTAURANT_NAME: 'restaurant_name',
  RESTAURANT_LOGO_URL: 'restaurant_logo_url',
  MESSENGER_PAGE_USERNAME: 'messenger_page_username',
  BIRTHDAY_TIMEZONE: 'birthday_timezone',
  CURRENCY: 'currency',
  PUBLIC_BASE_URL: 'public_base_url',
  STAFF_LINKS_ENABLED: 'staff_links_enabled',
  HOME_LINKS_ENABLED: 'home_links_enabled',
  TITLE_SUFFIX: 'title_suffix',
  RECEIPT_SUBTITLE: 'receipt_subtitle',
  RECEIPT_THANKS: 'receipt_thanks_message',
  RECEIPT_FOOTER_NOTE: 'receipt_footer_note',
  POWERED_BY: 'powered_by_text',
  DEVELOPER_NOTE_ENABLED: 'developer_note_enabled',
  DEVELOPER_NOTE_TEXT: 'developer_note_text',
  DEVELOPER_NOTE_LINK: 'developer_note_link',
  ITEM_SPECIAL_NOTE_ENABLED: 'item_special_note_enabled',
  MESSENGER_AUTO_REPLY_ENABLED: 'messenger_auto_reply_enabled',
  MESSENGER_MARKDOWN: 'messenger_markdown', // AI-প্রম্পটে মার্কডাউন-স্টাইল নিয়ম যাবে কি না — ওয়্যারে Graph v21 text_format রিজেক্ট করে বলে মার্কার পাঠানোর আগেই পরিষ্কার হয় (stripMdMarkers)
  MESSENGER_PAGE_TOKEN: 'messenger_page_token', // Page Access Token (admin সেটিং-ওভাররাইড) — মেয়াদ শেষ হলে Vercel env ছোঁয়া ছাড়াই এখান থেকে নতুন টোকেন; ফাঁকা = env META_PAGE_TOKEN
  META_VERIFY_TOKEN: 'meta_verify_token', // Webhook Verify Token (admin সেটিং-ওভাররাইড) — Meta অ্যাপ ড্যাশবোর্ডে webhook সেভ করার সময় যে টোকেন দেওয়া হয়; ফাঁকা = env META_VERIFY_TOKEN
  MESSENGER_MENU_JSON: 'messenger_menu_json', // পার্সিস্টেন্ট-মেনু বাটন (admin-সম্পাদনযোগ্য) — JSON [{title,payload}]; ফাঁকা = ডিফল্ট
  BOT_LANGUAGE: 'bot_language', // বটের গ্লোবাল ভাষা — ফাঁকা = অটো (AI কাস্টমারের ভাষা শিখে নেয়); bn/banglish/en/hi = সব মেসেজ ওই ভাষায়
  META_RN_TITLE: 'meta_rn_title', // opt-in কার্ডের টাইটেল — ২৪ঘ-উইন্ডো-বহির্ভূত notification messages (ফাঁকা = ডিফল্ট)
  GEMINI_ENABLED: 'gemini_enabled',
  GEMINI_API_KEYS: 'gemini_api_keys',
  GEMINI_MODEL: 'gemini_model',
  GEMINI_PERSONA: 'gemini_persona',
  AI_DELIVERY_RULES: 'ai_delivery_rules',
  AI_EXTRA_INFO: 'ai_extra_info',
  OFFER_MASTER_ENABLED: 'offer_master_enabled',
  OFFER_SPECIAL_NOTE_ENABLED: 'offer_special_note_enabled',
  OFFER_SPECIAL_NOTE: 'offer_special_note',
  TERMS_LINK_ENABLED: 'terms_link_enabled',
  PRIVACY_LINK_ENABLED: 'privacy_link_enabled',
  DATADEL_LINK_ENABLED: 'datadel_link_enabled',
  GEO_FENCE_ENABLED: 'geo_fence_enabled',
  GEO_LAT: 'geo_lat',
  GEO_LNG: 'geo_lng',
  GEO_RADIUS_METERS: 'geo_radius_meters',
} as const

export const SETTING_DEFAULTS: Record<string, string> = {
  [SETTING_KEYS.SESSION_DURATION_MINUTES]: '90',
  [SETTING_KEYS.KITCHEN_DELAY_ALERT_MINUTES]: '15',
  [SETTING_KEYS.BIRTHDAY_DISCOUNT_AMOUNT]: '50',
  [SETTING_KEYS.BIRTHDAY_MIN_BILL]: '500',
  [SETTING_KEYS.RESTAURANT_NAME]: 'Smart QR Restaurant',
  [SETTING_KEYS.RESTAURANT_LOGO_URL]: '',
  [SETTING_KEYS.MESSENGER_PAGE_USERNAME]: 'SpiceGardenBD',
  [SETTING_KEYS.BIRTHDAY_TIMEZONE]: 'Asia/Dhaka',
  [SETTING_KEYS.CURRENCY]: '৳',
  [SETTING_KEYS.PUBLIC_BASE_URL]: '',
  [SETTING_KEYS.STAFF_LINKS_ENABLED]: 'true',
  [SETTING_KEYS.HOME_LINKS_ENABLED]: 'true',
  [SETTING_KEYS.TITLE_SUFFIX]: 'Smart Restaurant System',
  [SETTING_KEYS.RECEIPT_SUBTITLE]: 'ডিজিটাল রসিদ',
  [SETTING_KEYS.RECEIPT_THANKS]: 'ধন্যবাদ! আবার আসবেন 🙏',
  [SETTING_KEYS.RECEIPT_FOOTER_NOTE]: '',
  [SETTING_KEYS.POWERED_BY]: 'Powered by Smart QR',
  [SETTING_KEYS.DEVELOPER_NOTE_ENABLED]: 'true',
  [SETTING_KEYS.DEVELOPER_NOTE_TEXT]: 'Devloped By- Md. Rakib Sarker  01847485265',
  [SETTING_KEYS.DEVELOPER_NOTE_LINK]: 'https://github.com/',
  [SETTING_KEYS.ITEM_SPECIAL_NOTE_ENABLED]: 'true',
  [SETTING_KEYS.MESSENGER_AUTO_REPLY_ENABLED]: 'true',
  [SETTING_KEYS.MESSENGER_MARKDOWN]: 'true',
  [SETTING_KEYS.MESSENGER_MENU_JSON]: '',
  [SETTING_KEYS.META_VERIFY_TOKEN]: '',
  [SETTING_KEYS.BOT_LANGUAGE]: '',
  [SETTING_KEYS.META_RN_TITLE]: '',
  [SETTING_KEYS.GEMINI_ENABLED]: 'false',
  [SETTING_KEYS.GEMINI_API_KEYS]: '',
  [SETTING_KEYS.GEMINI_MODEL]: 'gemma-4-26b-a4b-it',
  [SETTING_KEYS.GEMINI_PERSONA]: '',
  [SETTING_KEYS.AI_DELIVERY_RULES]: '',
  [SETTING_KEYS.AI_EXTRA_INFO]: '',
  [SETTING_KEYS.OFFER_MASTER_ENABLED]: 'true',
  [SETTING_KEYS.OFFER_SPECIAL_NOTE_ENABLED]: 'false',
  [SETTING_KEYS.OFFER_SPECIAL_NOTE]: '',
  [SETTING_KEYS.TERMS_LINK_ENABLED]: 'true',
  [SETTING_KEYS.PRIVACY_LINK_ENABLED]: 'true',
  [SETTING_KEYS.DATADEL_LINK_ENABLED]: 'true',
  [SETTING_KEYS.GEO_FENCE_ENABLED]: 'false',
  [SETTING_KEYS.GEO_LAT]: '',
  [SETTING_KEYS.GEO_LNG]: '',
  [SETTING_KEYS.GEO_RADIUS_METERS]: '200',
}

export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export const REALTIME_EVENTS = {
  ORDER_NEW: 'order:new',
  ORDER_STATUS: 'order:status',
  WAITER_NEW: 'waiter:new',
  WAITER_RESOLVED: 'waiter:resolved',
  TABLE_CLEARED: 'table:cleared',
} as const

export const taka = (n: number) => `৳${n.toFixed(n % 1 === 0 ? 0 : 2)}`

/** chat-language codes the AI detects / the admin can mark per customer —
 *  the bot then always replies in the marked language */
export const LANGUAGE_LABELS: Record<string, string> = {
  bn: 'বাংলা',
  banglish: 'বাংলিশ',
  en: 'English',
  hi: 'হিন্দি',
  other: 'অন্যান্য',
}
export const LANGUAGE_CODES = Object.keys(LANGUAGE_LABELS)
