// 🔔 কাস্টমার ওয়েব পুশ — VAPID (Meta রিভিউ / ডকুমেন্ট কিছুই লাগে না, ব্রাউজারের নিজস্ব পুশ)
// - VAPID কি-জোড়া প্রথম ব্যবহারে অটো-জেনারেট হয়ে settings-এ জমা হয় (PUSH_VAPID_*)
// - push_subscriptions টেবিল না থাকলে নিরাপদে নিজেই বানিয়ে নেয় (লেজি self-migration)
// - পাঠানোর সময় 404/410 (গোন) সাবস্ক্রিপশন নিজে থেকেই ডিলিট হয়
import webpush from 'web-push'
import { db } from '@/lib/db'
import { getSetting, setSettings } from '@/lib/settings'
import { SETTING_KEYS } from '@/lib/constants'

export interface PushPayload {
  title: string
  body: string
  tag?: string
  url?: string
}

let pushTableReady: Promise<void> | null = null

/** push_subscriptions টেবিল নিশ্চিত করা — প্রথম কলে একবারই DDL চলে (idempotent) */
export function ensurePushTable(): Promise<void> {
  if (!pushTableReady) {
    pushTableReady = (async () => {
      await db.$executeRawUnsafe(
        `CREATE TABLE IF NOT EXISTS \`push_subscriptions\` (
          \`id\` VARCHAR(191) NOT NULL,
          \`endpoint\` VARCHAR(500) NOT NULL,
          \`p256dh\` TEXT NOT NULL,
          \`auth\` TEXT NOT NULL,
          \`deviceId\` VARCHAR(191) NULL,
          \`tableNumber\` INTEGER NULL,
          \`userAgent\` TEXT NULL,
          \`lastError\` TEXT NULL,
          \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
          UNIQUE KEY \`push_subscriptions_endpoint_key\` (\`endpoint\`),
          PRIMARY KEY (\`id\`)
        ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
      )
      for (const ddl of [
        'CREATE INDEX IF NOT EXISTS `push_subscriptions_deviceId_idx` ON `push_subscriptions`(`deviceId`)',
        'CREATE INDEX IF NOT EXISTS `push_subscriptions_tableNumber_idx` ON `push_subscriptions`(`tableNumber`)',
      ]) {
        try {
          await db.$executeRawUnsafe(ddl)
        } catch {
          /* ইনডেক্স আগেই থাকলে নিরীহ */
        }
      }
    })().catch((e) => {
      pushTableReady = null // পরের কলে আবার চেষ্টা
      throw e
    })
  }
  return pushTableReady
}

/** VAPID কি-জোড়া (না থাকলে জেনারেট করে settings-এ সেভ) */
export async function getVapid(): Promise<{ publicKey: string; privateKey: string; subject: string }> {
  let pub = (await getSetting(SETTING_KEYS.PUSH_VAPID_PUBLIC))?.trim() || ''
  let priv = (await getSetting(SETTING_KEYS.PUSH_VAPID_PRIVATE))?.trim() || ''
  if (!pub || !priv) {
    const keys = webpush.generateVAPIDKeys()
    pub = keys.publicKey
    priv = keys.privateKey
    await setSettings({ [SETTING_KEYS.PUSH_VAPID_PUBLIC]: pub, [SETTING_KEYS.PUSH_VAPID_PRIVATE]: priv })
  }
  const subject = (await getSetting(SETTING_KEYS.PUSH_SUBJECT))?.trim() || 'mailto:teatreat@example.com'
  return { publicKey: pub, privateKey: priv, subject }
}

export async function pushEnabled(): Promise<boolean> {
  return (await getSetting(SETTING_KEYS.PUSH_ENABLED)).trim() !== 'false'
}

export interface PushSendResult {
  total: number
  sent: number
  failed: number
  cleaned: number
  errors: string[]
}

/** এক বা একাধিক সাবস্ক্রিপশনে পুশ পাঠানো — গোন (404/410) সাবস্ক্রিপশন অটো-ডিলিট */
export async function sendWebPush(subs: { id: string; endpoint: string; p256dh: string; auth: string }[], payload: PushPayload): Promise<PushSendResult> {
  const result: PushSendResult = { total: subs.length, sent: 0, failed: 0, cleaned: 0, errors: [] }
  if (!subs.length) return result
  const { publicKey, privateKey, subject } = await getVapid()
  webpush.setVapidDetails(subject, publicKey, privateKey)
  const data = JSON.stringify(payload)
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, data, { TTL: 3600 })
        result.sent++
        if (s && 'id' in s) {
          await db.pushSubscription.updateMany({ where: { id: s.id }, data: { lastError: null } }).catch(() => {})
        }
      } catch (err) {
        const e = err as { statusCode?: number; message?: string }
        const code = e.statusCode || 0
        result.failed++
        const msg = e.message || `HTTP ${code}`
        if (result.errors.length < 5) result.errors.push(msg.slice(0, 120))
        if (code === 404 || code === 410) {
          result.cleaned++
          await db.pushSubscription.deleteMany({ where: { id: s.id } }).catch(() => {})
        } else {
          await db.pushSubscription.updateMany({ where: { id: s.id }, data: { lastError: msg.slice(0, 300) } }).catch(() => {})
        }
      }
    })
  )
  await setSettings({ [SETTING_KEYS.PUSH_LAST_RESULT]: `${new Date().toISOString()} — পাঠানো ${result.sent}/${result.total} (গোন ${result.cleaned})` }).catch(() => {})
  return result
}

/** সব সক্রিয় সাবস্ক্রিপশন (broadcast / test) */
export async function allSubs() {
  await ensurePushTable()
  return db.pushSubscription.findMany({ orderBy: { createdAt: 'desc' }, take: 500 })
}

/** একটা টেবিল-সেশনের সব ডিভাইসে পুশ — অর্ডার রেডি হলে */
export async function notifySessionDevices(sessionId: string, tableNumber: number | null, payload: PushPayload): Promise<PushSendResult> {
  if (!(await pushEnabled())) return { total: 0, sent: 0, failed: 0, cleaned: 0, errors: [] }
  await ensurePushTable()
  const devices = await db.sessionDevice.findMany({ where: { sessionId }, select: { deviceId: true } })
  const ids = [...new Set(devices.map((d) => d.deviceId).filter(Boolean))] as string[]
  const subs = ids.length
    ? await db.pushSubscription.findMany({ where: { OR: [{ deviceId: { in: ids } }, ...(tableNumber != null ? [{ tableNumber }] : [])] } })
    : tableNumber != null
      ? await db.pushSubscription.findMany({ where: { tableNumber } })
      : []
  // একই endpoint দুবার এলে একবারই পাঠাই
  const uniq = new Map<string, (typeof subs)[number]>()
  for (const s of subs) if (!uniq.has(s.endpoint)) uniq.set(s.endpoint, s)
  return sendWebPush([...uniq.values()], payload)
}
