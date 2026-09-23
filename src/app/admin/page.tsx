'use client'

// ============================================================
// ADMIN PANEL — single page, tabs:
// ওভারভিউ | টেবিল ও QR | রসিদ হিস্ট্রি | মেনু | হ্যাপি আওয়ার | ভাউচার |
// অকেশন অফার | কাস্টমার | সিকিউরিটি লেজার | ImgBB কি | সেটিংস | অ্যাক্সেস কী
// Passcode auth via /api/admin/login (cookie admin_token).
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type ApiResponse } from '@/lib/client'
import { SETTING_KEYS, SUB_ADMIN_PERMISSIONS } from '@/lib/constants'
import { bnDateTime, bnDateOnly, bnDays, bnTaka, parseJsonSafe, toBn } from '@/lib/bn'
import {
  armStaffSound,
  disarmStaffSound,
  setStaffVolume,
  staffChime,
  staffConfirmBeep,
  unlockStaffAudioFallback,
  type StaffVolume,
} from '@/lib/staff-sound'
import { requestWakeLock, releaseWakeLock, wakeLockSupported } from '@/lib/wakelock'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import {
  AlertTriangle,
  Armchair,
  Banknote,
  Bell,
  BellOff,
  Cake,
  CheckCircle2,
  Clock,
  Flame,
  ImagePlus,
  Info,
  KeyRound,
  Lightbulb,
  LightbulbOff,
  Loader2,
  LogOut,
  Minus,
  Pencil,
  Plus,
  QrCode,
  Receipt,
  RefreshCw,
  Send,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Ticket,
  Timer,
  Trash2,
  Undo2,
  Users,
  UtensilsCrossed,
  Webhook,
  X,
  XCircle,
} from 'lucide-react'

const SCROLL_CSS =
  '.thin-scroll::-webkit-scrollbar{width:8px;height:8px}.thin-scroll::-webkit-scrollbar-track{background:transparent}.thin-scroll::-webkit-scrollbar-thumb{background:#d6d3d1;border-radius:8px}.thin-scroll::-webkit-scrollbar-thumb:hover{background:#a8a29e}'

// ---------------- Types ----------------
interface AnalyticsData {
  todayRevenue: number
  todayOrders: number
  allTimeRevenue: number
  allTimeOrders: number
  totalDiscounts: { happyHour: number; voucher: number; birthday: number }
  avgCookingMinutes: number
  popularItems: { name: string; count: number }[]
  tables: { id: string; number: number; status: string; seats: number }[]
  totalCustomers: number
  totalVouchersUsed: number
  authRequired?: boolean
}

interface AdminTable {
  id: string
  number: number
  seats: number
  status: string
  totalOrders: number
  activeSession: { id: string; scannedAt: string; expiresAt: string } | null
}

// ---------------- Security ledger types ----------------
interface LedgerEntryRow {
  seq: number
  type: string
  tableNumber: number | null
  sessionId: string | null
  deviceId: string | null
  deviceFp: string | null
  detail: unknown
  prevHash: string
  hash: string
  createdAt: string
}

interface LedgerData {
  total: number
  integrity: { valid: boolean; checked: number; brokenAtSeq: number | null }
  entries: LedgerEntryRow[]
}

const LEDGER_TYPE_BN: Record<string, { label: string; cls: string }> = {
  SESSION_START: { label: '📷 সেশন শুরু', cls: 'bg-sky-100 text-sky-800' },
  SESSION_REJOIN: { label: '👥 নতুন গেস্ট যুক্ত', cls: 'bg-cyan-100 text-cyan-800' },
  SESSION_CLEARED: { label: '🧹 সেশন ক্লিয়ার', cls: 'bg-stone-200 text-stone-700' },
  ORDER_PLACED: { label: '🍽️ অর্ডার', cls: 'bg-amber-100 text-amber-800' },
  VOUCHER_APPLIED: { label: '🎟️ কুপন প্রয়োগ', cls: 'bg-violet-100 text-violet-800' },
  VOUCHER_BLOCKED: { label: '🚫 কুপন ব্লক', cls: 'bg-red-100 text-red-700' },
  REFERRAL_ISSUED: { label: '🔗 রেফারেল লিংক', cls: 'bg-fuchsia-100 text-fuchsia-800' },
  BIRTHDAY_CLAIMED: { label: '🎂 জন্মদিন ছাড়', cls: 'bg-emerald-100 text-emerald-800' },
  BIRTHDAY_BLOCKED: { label: '🚫 জন্মদিন ব্লক', cls: 'bg-red-100 text-red-700' },
  BILL_PAID: { label: '✅ বিল পরিশোধ', cls: 'bg-green-100 text-green-800' },
  TRANSACTION_EDITED: { label: '✏️ লেনদেন এডিট', cls: 'bg-amber-100 text-amber-800' },
  TRANSACTION_DELETED: { label: '🗑️ লেনদেন ডিলিট', cls: 'bg-red-100 text-red-800' },
}

interface Category {
  id: string
  name: string
  _count: { items: number }
}

interface MenuItemRow {
  id: string
  name: string
  description: string | null
  price: number
  imageUrl: string | null
  isAvailable: boolean
  isSetMenu: boolean
  spiceLevels: string | null
  addons: string | null
  upsellIds: string | null
  categoryId: string
  category: { id: string; name: string }
}

interface HappyHourRow {
  id: string
  name: string
  discountPercent: number
  daysOfWeek: string
  startTime: string
  endTime: string
  startDate: string | null
  endDate: string | null
  itemIds: string | null
  active: boolean
}

interface VoucherRow {
  id: string
  code: string
  title: string
  description: string | null
  discountType: string
  discountValue: number
  maxDiscount: number | null
  minOrderAmount: number
  ruleType: string
  startTime: string | null
  endTime: string | null
  daysOfWeek: string | null
  specificDate: string | null
  setMenuIds: string | null
  minQuantity: number | null
  usageLimit: number | null
  usedCount: number
  singleUse: boolean
  active: boolean
}

interface ImgbbKeyRow {
  id: string
  key: string
  label: string | null
  active: boolean
  usageCount: number
  failCount: number
  lastError: string | null
}

interface SettingsMeta {
  sessionDurationHint: string
  messengerConfigured: boolean
  metaEnv: { pageToken: boolean; pageId: boolean; verifyToken: boolean; appSecret: boolean }
  webhookUrl: string
  lastWebhookAt: string
  lastWebhookInfo: string
  lastVerifyAt: string
}

interface MessengerTestResult {
  tokenTest: {
    ok: boolean
    pageName: string | null
    pageId: string | null
    pageUsername: string | null
    error: string | null
  }
  env: { pageToken: boolean; pageId: boolean; verifyToken: boolean; appSecret: boolean }
  lastWebhookAt: string
  lastWebhookInfo: string
  lastVerifyAt: string
}

/** Bengali relative time for webhook diagnostics */
function bnAgo(iso: string | null | undefined): string {
  if (!iso) return ''
  const ms = Date.now() - new Date(iso).getTime()
  if (isNaN(ms) || ms < 0) return ''
  const min = Math.floor(ms / 60_000)
  if (min < 1) return 'এইমাত্র'
  if (min < 60) return `${toBn(String(min))} মিনিট আগে`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${toBn(String(hr))} ঘণ্টা আগে`
  return `${toBn(String(Math.floor(hr / 24)))} দিন আগে`
}

/** One checklist row of the Messenger diagnostics card */
function MetaCheckRow({ label, code, ok: okFlag, note }: { label: string; code: string; ok: boolean; note?: string }) {
  return (
    <div className="flex items-start gap-2.5">
      <span
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
          okFlag ? 'bg-emerald-100 text-emerald-600' : 'bg-red-100 text-red-500'
        }`}
      >
        {okFlag ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold leading-snug text-stone-800">
          {label} <span className="font-mono text-[11px] font-normal text-stone-400">{code}</span>
        </p>
        {note && <p className="text-xs leading-snug text-stone-500">{note}</p>}
      </div>
    </div>
  )
}

interface TabProps {
  onAuthRequired: () => void
}

const RULE_LABELS: Record<string, string> = {
  GENERAL: 'সাধারণ',
  HOT_TIME: 'হট টাইম',
  SPECIAL_DAY: 'স্পেশাল ডে',
  SET_MENU_QTY: 'সেট মেনু কোয়ান্টিটি',
}

/** bounce to passcode screen when a 401 admin guard fires */
function isAuthError(res: ApiResponse<unknown>): boolean {
  return !res.ok && (/admin login/i.test(res.error || '') || res.code === 'KDS_KEY_REQUIRED' || /লগইন প্রয়োজন/.test(res.error || ''))
}

// ---------------- Tiny shared UI ----------------
function Loading({ label = 'লোড হচ্ছে…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-stone-500">
      <Loader2 className="h-5 w-5 animate-spin text-amber-500" /> {label}
    </div>
  )
}

function LoadError({ msg, onRetry }: { msg: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center">
      <AlertTriangle className="h-8 w-8 text-red-500" />
      <p className="text-sm text-stone-600">{msg}</p>
      <Button size="sm" variant="outline" onClick={onRetry}>
        আবার চেষ্টা করুন
      </Button>
    </div>
  )
}

function ConfirmAction({
  children,
  title,
  description,
  confirmLabel = 'নিশ্চিত করুন',
  onConfirm,
}: {
  children: React.ReactNode // trigger element (button) — wrapped by AlertDialogTrigger
  title: string
  description: string
  confirmLabel?: string
  onConfirm: () => void | Promise<void>
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{children}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>বাতিল</AlertDialogCancel>
          <AlertDialogAction
            className="bg-red-600 text-white hover:bg-red-700"
            onClick={() => {
              void onConfirm()
            }}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <Label className="text-xs font-bold text-stone-600">{children}</Label>
}

function DayChips({ value, onChange }: { value: number[]; onChange: (d: number[]) => void }) {
  const DAYS = ['রবি', 'সোম', 'মঙ্গল', 'বুধ', 'বৃহঃ', 'শুক্র', 'শনি']
  const toggle = (i: number) => onChange(value.includes(i) ? value.filter((d) => d !== i) : [...value, i])
  return (
    <div className="flex flex-wrap gap-1.5">
      {DAYS.map((d, i) => (
        <button
          key={i}
          type="button"
          onClick={() => toggle(i)}
          className={`rounded-full border px-3 py-1 text-xs font-bold transition ${
            value.includes(i)
              ? 'border-amber-500 bg-amber-500 text-white'
              : 'border-stone-300 bg-white text-stone-500 hover:border-amber-400'
          }`}
        >
          {d}
        </button>
      ))}
    </div>
  )
}

/** ISO date → "YYYY-MM-DDTHH:mm" for <input type="datetime-local"> */
function toLocalInputValue(iso: string | Date): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * Shrink big phone photos in the browser BEFORE uploading.
 * Vercel serverless rejects request bodies over ~4.5MB (413) — a 8-12MP
 * photo easily crosses that. Canvas-resize to ≤1800px / JPEG q85 keeps
 * every upload well under the limit (and ImgBB-quick). Never throws.
 */
async function compressImage(file: File, maxSide = 1800, quality = 0.85): Promise<File> {
  if (file.type === 'image/gif') return file // animated gif must stay intact
  if (file.size <= 1_200_000) return file // already small → fast path
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(bitmap, 0, 0, w, h)
    bitmap.close()
    const isPng = file.type === 'image/png'
    const mime = isPng ? 'image/png' : 'image/jpeg'
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mime, quality))
    if (!blob || blob.size >= file.size) return file // compression didn't help
    const name = file.name.replace(/\.[^.]+$/, '') + (isPng ? '.png' : '.jpg')
    return new File([blob], name, { type: mime })
  } catch {
    return file // decode failed (e.g. HEIC) → let the server try the original
  }
}

/** upload one image file to /api/upload → returns url */
async function uploadImageFile(file: File): Promise<string> {
  const up = await compressImage(file)
  const fd = new FormData()
  fd.append('file', up)
  const res = await fetch('/api/upload', { method: 'POST', body: fd })
  if (res.status === 413) {
    throw new Error('ছবিটি খুব বড় — ছোট ছবি দিন (সর্বোচ্চ ~৪MB)')
  }
  const json = (await res.json().catch(() => null)) as ApiResponse<{ url: string }> | null
  if (!json?.ok || !json.data?.url) throw new Error(json?.error || 'আপলোড ব্যর্থ')
  return json.data.url
}

// ============================================================
// TAB 1: ওভারভিউ
// ============================================================
function OverviewTab({ onAuthRequired }: TabProps) {
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    const res = await api.get<AnalyticsData>('/api/admin/analytics')
    if (isAuthError(res)) return onAuthRequired()
    if (!res.ok || !res.data) {
      setErr(res.error || 'ডেটা আনা যায়নি')
      return
    }
    if (res.data.authRequired) return onAuthRequired()
    setErr('')
    setData(res.data)
  }, [onAuthRequired])

  useEffect(() => {
    const t = setTimeout(load, 0)
    const iv = setInterval(load, 15000) // overview stats stay fresh automatically
    return () => {
      clearTimeout(t)
      clearInterval(iv)
    }
  }, [load])

  if (err) return <LoadError msg={err} onRetry={load} />
  if (!data) return <Loading />

  const occupied = data.tables.filter((t) => t.status === 'OCCUPIED').length
  const kpis = [
    { label: 'আজকের বিক্রি', value: bnTaka(data.todayRevenue), Icon: Banknote, cls: 'bg-amber-100 text-amber-700' },
    { label: 'আজকের অর্ডার', value: toBn(data.todayOrders), Icon: ShoppingBag, cls: 'bg-orange-100 text-orange-700' },
    {
      label: 'গড় রান্নার সময়',
      value: `${toBn(data.avgCookingMinutes)} মিনিট`,
      Icon: Timer,
      cls: 'bg-teal-100 text-teal-700',
    },
    {
      label: 'সক্রিয় টেবিল',
      value: `${toBn(occupied)}/${toBn(data.tables.length)}`,
      Icon: Armchair,
      cls: 'bg-red-100 text-red-700',
    },
    { label: 'মোট কাস্টমার', value: toBn(data.totalCustomers), Icon: Users, cls: 'bg-emerald-100 text-emerald-700' },
    { label: 'ভাউচার ব্যবহার', value: toBn(data.totalVouchersUsed), Icon: Ticket, cls: 'bg-stone-200 text-stone-700' },
  ]

  return (
    <div className="space-y-4">
      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {kpis.map(({ label, value, Icon, cls }) => (
          <Card key={label} className="border-stone-200 shadow-sm">
            <CardContent className="p-4">
              <div className={`mb-2 inline-flex rounded-lg p-2 ${cls}`}>
                <Icon className="h-5 w-5" />
              </div>
              <p className="text-lg font-black text-stone-900">{value}</p>
              <p className="text-xs font-bold text-stone-500">{label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Popular items */}
        <Card className="border-stone-200">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Flame className="h-5 w-5 text-orange-600" /> জনপ্রিয় আইটেম
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.popularItems.length === 0 && <p className="text-sm text-stone-400">এখনো কোনো অর্ডার হয়নি</p>}
            {data.popularItems.map((p, i) => (
              <div key={p.name} className="flex items-center gap-2 rounded-lg border border-stone-100 bg-stone-50 px-3 py-2">
                <span className="text-xs font-black text-amber-600">#{toBn(i + 1)}</span>
                <Flame className="h-4 w-4 text-orange-500" />
                <span className="flex-1 truncate text-sm font-bold text-stone-800">{p.name}</span>
                <Badge className="bg-orange-600 hover:bg-orange-600">{toBn(p.count)} টি</Badge>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Discounts summary */}
        <Card className="border-stone-200">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Receipt className="h-5 w-5 text-amber-600" /> ডিসকাউন্ট সারসংক্ষেপ (সর্বমোট)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-center justify-between rounded-lg border border-orange-100 bg-orange-50 px-3 py-2">
              <span className="text-sm font-bold text-stone-700">🍹 হ্যাপি আওয়ার</span>
              <span className="font-black text-orange-700">{bnTaka(data.totalDiscounts.happyHour)}</span>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-amber-100 bg-amber-50 px-3 py-2">
              <span className="text-sm font-bold text-stone-700">🎟️ ভাউচার</span>
              <span className="font-black text-amber-700">{bnTaka(data.totalDiscounts.voucher)}</span>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-pink-100 bg-pink-50 px-3 py-2">
              <span className="text-sm font-bold text-stone-700">🎂 জন্মদিন</span>
              <span className="font-black text-pink-700">{bnTaka(data.totalDiscounts.birthday)}</span>
            </div>
            <div className="mt-2 flex items-center justify-between border-t border-dashed border-stone-200 px-3 pt-3">
              <span className="text-sm font-black text-stone-800">সর্বমোট বিক্রি (সব সময়)</span>
              <span className="font-black text-stone-900">{bnTaka(data.allTimeRevenue)}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tables mini-grid */}
      <Card className="border-stone-200">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Armchair className="h-5 w-5 text-stone-600" /> টেবিল স্ট্যাটাস
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.tables.length === 0 && <p className="text-sm text-stone-400">কোনো টেবিল যোগ করা হয়নি</p>}
          <div className="flex flex-wrap gap-2">
            {data.tables.map((t) => (
              <span
                key={t.id}
                className={`rounded-lg px-3 py-1.5 text-xs font-black ${
                  t.status === 'OCCUPIED' ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'
                }`}
              >
                টেবিল {toBn(t.number)} · {t.status === 'OCCUPIED' ? 'ব্যস্ত' : 'ফাঁকা'}
              </span>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// ============================================================
// TAB 2: টেবিল ও QR
// ============================================================
// ---------------- Live table tracking types ----------------
interface LiveOrder {
  id: string
  orderNo: number
  status: string
  subtotal: number
  voucherDiscount: number
  happyHourDiscount: number
  birthdayDiscount: number
  returnedAmount: number
  total: number
  billPaid: boolean
  paymentMethod: string | null
  voucherCode: string | null
  placedAt: string
  itemCount: number
  items: { id: string; itemName: string; quantity: number; returnedQty: number; unitPrice: number; lineTotal: number; spiceLevel: string | null; addons: { name: string; price: number }[]; specialNote: string | null }[]
}

interface LiveTable {
  id: string
  number: number
  seats: number
  status: string
  pendingCalls: { id: string; type: string; createdAt: string }[]
  session: {
    id: string
    scannedAt: string
    expiresAt: string
    birthdayGranted: boolean
    guests: { id: string; deviceId: string; firstSeen: string }[]
    orders: LiveOrder[]
    bill: { subtotal: number; payable: number; paidTotal: number; allPaid: boolean }
  } | null
}

/** per-order status badge: emoji label + colors + dot indicator (user request: কোন অর্ডার কোন অবস্থায় স্পষ্ট দেখা যাক) */
const ORDER_BADGE: Record<string, { label: string; cls: string; dot: string }> = {
  PLACED: { label: '🆕 প্লেসড', cls: 'bg-amber-100 text-amber-800 hover:bg-amber-100', dot: 'bg-amber-500' },
  COOKING: { label: '🔥 রান্নায়', cls: 'bg-orange-100 text-orange-800 hover:bg-orange-100', dot: 'bg-orange-500' },
  READY: { label: '✅ রেডি', cls: 'bg-emerald-100 text-emerald-800 hover:bg-emerald-100', dot: 'bg-emerald-500' },
  SERVED: { label: '🍽️ সার্ভড', cls: 'bg-stone-200 text-stone-700 hover:bg-stone-200', dot: 'bg-stone-500' },
  COMPLETED: { label: '✔️ সম্পন্ন', cls: 'bg-green-100 text-green-800 hover:bg-green-100', dot: 'bg-green-600' },
  CANCELLED: { label: '❌ বাতিল', cls: 'bg-red-100 text-red-700 hover:bg-red-100', dot: 'bg-red-500' },
}

const ORDER_BN: Record<string, string> = {
  PLACED: 'প্লেসড',
  COOKING: 'রান্নায়',
  READY: 'রেডি',
  SERVED: 'সার্ভড',
  COMPLETED: 'সম্পন্ন',
  CANCELLED: 'বাতিল',
}

const CALL_BN: Record<string, string> = {
  WAITER: '👨‍💼 ওয়েটার ডাকছে',
  WATER: '💧 পানি চাই',
  CLEAN: '🧹 টেবিল পরিষ্কার',
  BILL: '🧾 বিল চাই',
}

function TablesTab({ onAuthRequired }: TabProps) {
  const [tables, setTables] = useState<LiveTable[] | null>(null)
  const [err, setErr] = useState('')
  const [newNumber, setNewNumber] = useState('')
  const [newSeats, setNewSeats] = useState('4')
  const [adding, setAdding] = useState(false)
  const [payTarget, setPayTarget] = useState<LiveTable | null>(null)
  const [payMethod, setPayMethod] = useState('CASH')
  const [paying, setPaying] = useState(false)
  // bill-time returns: orderItemId → how many pieces the customer returned
  const [returns, setReturns] = useState<Record<string, number>>({})
  // payment success → show receipt no + print button inside the dialog
  const [payResult, setPayResult] = useState<{ receiptId: string; receiptNo: number; payable: number; returnTotal: number; voucherVoidedTotal: number } | null>(null)

  // sound tracking: new orders / new waiter calls → chime + toast
  const knownOrderIdsRef = useRef<Set<string>>(new Set())
  const knownCallIdsRef = useRef<Set<string>>(new Set())
  const knownStatusRef = useRef<Map<string, string>>(new Map())
  const hadDataRef = useRef(false)

  const load = useCallback(async () => {
    const res = await api.get<{ tables: LiveTable[] }>('/api/admin/tables/live')
    if (isAuthError(res)) return onAuthRequired()
    if (!res.ok || !res.data) {
      setErr(res.error || 'টেবিল আনা যায়নি')
      return
    }
    setErr('')
    setTables(res.data.tables)

    // ---- detect NEW orders, STATUS CHANGES + NEW pending waiter calls → chime + toast ----
    const freshOrders: { orderNo: number; tableNumber: number }[] = []
    const freshCalls: { type: string; tableNumber: number }[] = []
    const statusChanges: { orderNo: number; tableNumber: number; to: string }[] = []
    for (const t of res.data.tables) {
      for (const o of t.session?.orders ?? []) {
        if (hadDataRef.current && !knownOrderIdsRef.current.has(o.id)) {
          freshOrders.push({ orderNo: o.orderNo, tableNumber: t.number })
        }
        const prev = knownStatusRef.current.get(o.id)
        // known order whose status moved (PLACED→COOKING→READY→SERVED…) —
        // e.g. changed by another admin/sub-admin device or the KDS screen
        if (hadDataRef.current && prev && prev !== o.status) {
          statusChanges.push({ orderNo: o.orderNo, tableNumber: t.number, to: o.status })
        }
        knownStatusRef.current.set(o.id, o.status)
        knownOrderIdsRef.current.add(o.id)
      }
      for (const c of t.pendingCalls) {
        if (hadDataRef.current && !knownCallIdsRef.current.has(c.id)) {
          freshCalls.push({ type: c.type, tableNumber: t.number })
        }
        knownCallIdsRef.current.add(c.id)
      }
    }
    hadDataRef.current = true
    if (freshOrders.length > 0) {
      staffChime('order')
      toast.success(`🔔 নতুন অর্ডার! #${toBn(String(freshOrders[0].orderNo))} — টেবিল ${toBn(freshOrders[0].tableNumber)}`)
    }
    if (freshCalls.length > 0) {
      staffChime('waiter')
      toast.warning(`🔔 ${CALL_BN[freshCalls[0].type] || 'কল'} — টেবিল ${toBn(freshCalls[0].tableNumber)}`)
    }
    // ---- live status changes: DISTINCT chime per stage so staff hears
    //      exactly WHAT happened without looking at the screen ----
    if (statusChanges.length > 0) {
      const tos = statusChanges.map((c) => c.to)
      // one chime only — the most important stage wins (no sound spam)
      if (tos.includes('READY')) staffChime('ready')
      else if (tos.includes('COOKING')) staffChime('cooking')
      else if (tos.includes('SERVED')) staffChime('served')
      for (const c of statusChanges.slice(0, 3)) {
        const no = toBn(String(c.orderNo))
        const tbl = toBn(c.tableNumber)
        if (c.to === 'READY') toast.success(`✅ অর্ডার #${no} রেডি! পরিবেশন করুন — টেবিল ${tbl}`)
        else if (c.to === 'COOKING') toast.info(`🔥 অর্ডার #${no} রান্না শুরু — টেবিল ${tbl}`)
        else if (c.to === 'SERVED') toast.info(`🍽️ অর্ডার #${no} পরিবেশিত — টেবিল ${tbl}`)
        else if (c.to === 'CANCELLED') toast.warning(`❌ অর্ডার #${no} বাতিল হয়েছে — টেবিল ${tbl}`)
        else if (c.to === 'COMPLETED') toast.success(`✔️ অর্ডার #${no} সম্পন্ন — টেবিল ${tbl}`)
      }
    }
  }, [onAuthRequired])

  useEffect(() => {
    const t = setTimeout(load, 0)
    const iv = setInterval(load, 5000) // live tracking (was 10s — faster feedback)
    return () => {
      clearTimeout(t)
      clearInterval(iv)
    }
  }, [load])

  // parent shell requests an instant refresh (tab visible again after being
  // backgrounded) so missed status changes chime immediately
  useEffect(() => {
    const h = () => void load()
    window.addEventListener('admin:tables:refresh', h)
    return () => window.removeEventListener('admin:tables:refresh', h)
  }, [load])

  const addTable = async () => {
    if (!newNumber.trim()) return toast.error('টেবিল নম্বর দিন')
    setAdding(true)
    const res = await api.post('/api/admin/tables', { number: newNumber, seats: newSeats })
    setAdding(false)
    if (!res.ok) return toast.error(res.error || 'যোগ করা যায়নি')
    toast.success(`টেবিল ${toBn(newNumber)} যোগ হয়েছে`)
    setNewNumber('')
    setNewSeats('4')
    load()
  }

  const clearTable = async (t: LiveTable) => {
    const res = await api.post(`/api/admin/tables/${t.id}/clear`)
    if (!res.ok) {
      toast.error(res.error || 'ক্লিয়ার ব্যর্থ')
      return
    }
    toast.success('সেশন ধ্বংস হয়েছে')
    load()
  }

  const deleteTable = async (t: LiveTable) => {
    const res = await api.del(`/api/admin/tables/${t.id}`)
    if (!res.ok) {
      toast.error(res.error || 'ডিলিট ব্যর্থ')
      return
    }
    toast.success(`টেবিল ${toBn(t.number)} ডিলিট হয়েছে`)
    load()
  }

  const payBill = async () => {
    if (!payTarget?.session) return
    setPaying(true)
    // only items with an actual return are sent
    const returnsPayload = (payTarget.session.orders ?? [])
      .flatMap((o) =>
        o.items
          .filter((it) => (returns[it.id] ?? 0) > 0)
          .map((it) => ({ orderId: o.id, itemId: it.id, returnedQty: returns[it.id] }))
      )
    const res = await api.post<{
      sessionId: string
      tableNumber: number
      method: string
      payable: number
      returnTotal: number
      voucherVoidedTotal: number
      receiptId: string
      receiptNo: number
      ordersPaid: number
    }>('/api/admin/bills/pay', {
      sessionId: payTarget.session.id,
      method: payMethod,
      returns: returnsPayload,
    })
    setPaying(false)
    if (!res.ok) return toast.error(res.error || 'পেমেন্ট নিশ্চিত ব্যর্থ')
    const receiptNo = res.data?.receiptNo ?? 0
    const receiptId = res.data?.receiptId ?? ''
    const returnTotal = res.data?.returnTotal ?? 0
    const voucherVoidedTotal = res.data?.voucherVoidedTotal ?? 0
    toast.success(
      returnTotal > 0
        ? `বিল পরিশোধ হয়েছে (${payMethod}) — রিটার্ন −৳${returnTotal}${voucherVoidedTotal > 0 ? ' + কুপন ছাড় বাতিল' : ''}, রসিদ #${toBn(String(receiptNo))}`
        : `বিল পরিশোধ হয়েছে (${payMethod}) — রসিদ #${toBn(String(receiptNo))}`,
      {
        action: receiptId
          ? { label: '🧾 রসিদ দেখুন', onClick: () => window.open(`/receipt/${receiptId}`, '_blank') }
          : undefined,
      }
    )
    setPayResult({ receiptId, receiptNo, payable: res.data?.payable ?? 0, returnTotal, voucherVoidedTotal })
    setReturns({})
    load()
  }

  if (err) return <LoadError msg={err} onRetry={load} />
  if (!tables) return <Loading />

  return (
    <div className="space-y-4">
      {/* important note */}
      <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
        <p className="font-bold">
          একই টেবিলে যত জন QR স্ক্যান করুক সবাই <u>একই সেশন ও একই বিলে</u> থাকবে। বিল পরিশোধের পর টেবিল ক্লিয়ার করুন — পুরনো QR লিঙ্ক আর কাজ করবে না।
        </p>
      </div>

      {/* add table */}
      <Card className="border-stone-200">
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <div className="space-y-1">
            <FieldLabel>টেবিল নম্বর</FieldLabel>
            <Input
              inputMode="numeric"
              placeholder="যেমন ৫"
              value={newNumber}
              onChange={(e) => setNewNumber(e.target.value)}
              className="w-28"
            />
          </div>
          <div className="space-y-1">
            <FieldLabel>সিট সংখ্যা</FieldLabel>
            <Input
              inputMode="numeric"
              value={newSeats}
              onChange={(e) => setNewSeats(e.target.value)}
              className="w-24"
            />
          </div>
          <Button onClick={addTable} disabled={adding} className="bg-amber-500 font-black text-white hover:bg-amber-600">
            {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} যোগ করুন
          </Button>
          <Button onClick={load} variant="outline" className="ml-auto border-stone-300 font-bold">
            <RefreshCw className="h-4 w-4" /> রিফ্রেশ
          </Button>
        </CardContent>
      </Card>

      {/* table cards */}
      {tables.length === 0 ? (
        <p className="py-10 text-center text-sm text-stone-400">কোনো টেবিল নেই — উপরে থেকে যোগ করুন</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
          {tables.map((t) => {
            const s = t.session
            const expired = s ? new Date(s.expiresAt).getTime() < Date.now() : false
            // bill-readiness: all orders served/completed & unpaid → ready to bill
            const activeOrders = (s?.orders ?? []).filter((o) => o.status !== 'CANCELLED')
            const billReady = activeOrders.length > 0 && activeOrders.every((o) => o.status === 'SERVED' || o.status === 'COMPLETED')
            const stillEating = activeOrders.some((o) => o.status === 'PLACED' || o.status === 'COOKING')
            return (
              <Card key={t.id} className={cn('border-stone-200', s && 'border-amber-200 ring-1 ring-amber-100')}>
                <CardContent className="space-y-3 p-4">
                  {/* header */}
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-lg font-black text-stone-900">টেবিল {toBn(t.number)}</p>
                      <p className="text-xs font-bold text-stone-500">{toBn(t.seats)} সিট</p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Badge
                        className={
                          t.status === 'OCCUPIED'
                            ? 'bg-red-100 text-red-700 hover:bg-red-100'
                            : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-100'
                        }
                      >
                        {t.status === 'OCCUPIED' ? 'ব্যস্ত' : 'ফাঁকা'}
                      </Badge>
                      {s && (
                        <Badge variant="outline" className="border-stone-200 text-[10px] text-stone-500">
                          👥 {toBn(s.guests.length)} ডিভাইস
                        </Badge>
                      )}
                    </div>
                  </div>

                  {/* pending calls */}
                  {t.pendingCalls.map((c) => (
                    <div key={c.id} className="animate-pulse rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-extrabold text-red-700">
                      🔔 {CALL_BN[c.type] || c.type}
                    </div>
                  ))}

                  {/* session info */}
                  <div className="rounded-lg bg-stone-50 p-2.5 text-xs text-stone-600">
                    {s ? (
                      <div className="space-y-0.5">
                        <p>📷 স্ক্যান: {bnDateTime(s.scannedAt)}</p>
                        <p className={expired ? 'font-bold text-red-600' : ''}>
                          ⏳ মেয়াদ শেষ: {bnDateTime(s.expiresAt)}
                          {expired && ' (শেষ হয়েছে)'}
                        </p>
                        {s.birthdayGranted && <p>🎂 জন্মদিনের ছাড় এই সেশনে প্রয়োগ হয়েছে</p>}
                      </div>
                    ) : (
                      <p className="text-stone-400">কোনো সক্রিয় সেশন নেই</p>
                    )}
                  </div>

                  {/* live orders */}
                  {s && s.orders.length > 0 && (
                    <div className="thin-scroll max-h-56 space-y-2 overflow-y-auto rounded-lg border border-stone-100 p-2">
                      {s.orders.map((o) => {
                        const badge = ORDER_BADGE[o.status] ?? {
                          label: ORDER_BN[o.status] || o.status,
                          cls: 'bg-stone-100 text-stone-600 hover:bg-stone-100',
                          dot: 'bg-stone-400',
                        }
                        return (
                          <div key={o.id} className="rounded-md bg-white p-2 text-xs shadow-sm">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-bold text-stone-800">অর্ডার #{toBn(String(o.orderNo))}</span>
                              <div className="flex items-center gap-1.5">
                                {o.billPaid && (
                                  <Badge className="bg-emerald-100 text-[10px] text-emerald-700 hover:bg-emerald-100">পরিশোধিত</Badge>
                                )}
                                <Badge className={cn('gap-1 text-[10px]', badge.cls)}>
                                  <span className={cn('h-1.5 w-1.5 rounded-full', badge.dot)} />
                                  {badge.label}
                                </Badge>
                              </div>
                            </div>
                            <p className="mt-1 truncate text-stone-500">
                              {o.items.map((i) => `${i.itemName}×${i.quantity}`).join(', ')}
                            </p>
                            <div className="mt-1 flex items-center justify-between text-stone-600">
                              <span className="text-[10px] text-stone-400">
                                {o.voucherCode && `🎟️ ${o.voucherCode}`}
                                {o.happyHourDiscount > 0 && ` • 🔥 -৳${o.happyHourDiscount}`}
                                {o.birthdayDiscount > 0 && ` • 🎂 -৳${o.birthdayDiscount}`}
                              </span>
                              <span className="font-extrabold text-amber-600">৳{o.total}</span>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}

                  {/* bill-readiness hint */}
                  {s && s.orders.length > 0 && !s.bill.allPaid && billReady && (
                    <div className="animate-pulse rounded-lg border border-amber-400 bg-amber-100 px-3 py-2 text-xs font-extrabold text-amber-900">
                      ✅ খাওয়া-দাওয়া সম্পন্ন — এখন বিল নেওয়া যাবে
                    </div>
                  )}
                  {s && s.orders.length > 0 && !s.bill.allPaid && !billReady && stillEating && (
                    <div className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-xs font-bold text-stone-500">
                      ⏳ খাওয়া চলছে…
                    </div>
                  )}

                  {/* bill summary */}
                  {s && s.orders.length > 0 && (
                    <div
                      className={cn(
                        'flex items-center justify-between rounded-lg px-3 py-2',
                        s.bill.allPaid ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-900'
                      )}
                    >
                      <div className="text-xs font-bold">
                        মোট বিল: <span className="text-base font-black">৳{s.bill.payable}</span>
                        <span className="ml-2 font-normal text-stone-500">({toBn(s.orders.length)} অর্ডার)</span>
                      </div>
                      {s.bill.allPaid ? (
                        <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">✅ পরিশোধিত</Badge>
                      ) : (
                        <Button
                          size="sm"
                          onClick={() => {
                            setPayTarget(t)
                            setPayMethod('CASH')
                            setPayResult(null)
                            setReturns({})
                          }}
                          className="h-8 bg-emerald-600 font-black text-white hover:bg-emerald-700"
                        >
                          <Banknote className="h-4 w-4" /> বিল নিন
                        </Button>
                      )}
                    </div>
                  )}

                  {/* actions */}
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => window.open(`/api/admin/qrcode?tableNumber=${t.number}`, '_blank')}
                      className="border-stone-300 font-bold"
                    >
                      <QrCode className="h-4 w-4" /> QR ডাউনলোড
                    </Button>
                    {s && (
                      <ConfirmAction
                        title={`টেবিল ${toBn(t.number)} ক্লিয়ার?`}
                        description="সক্রিয় সেশন স্থায়ীভাবে ধ্বংস হবে — পুরনো QR লিঙ্ক আর কাজ করবে না।"
                        confirmLabel="🧹 ক্লিয়ার করুন"
                        onConfirm={() => clearTable(t)}
                      >
                        <Button size="sm" variant="outline" className="border-amber-300 font-bold text-amber-700 hover:bg-amber-50">
                          <Sparkles className="h-4 w-4" /> টেবিল ক্লিয়ার
                        </Button>
                      </ConfirmAction>
                    )}
                    <ConfirmAction
                      title={`টেবিল ${toBn(t.number)} ডিলিট?`}
                      description="টেবিলটি স্থায়ীভাবে মুছে যাবে।"
                      confirmLabel="ডিলিট"
                      onConfirm={() => deleteTable(t)}
                    >
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-red-500 hover:bg-red-50 hover:text-red-600"
                        title="টেবিল ডিলিট"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </ConfirmAction>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* payment dialog — with bill-time item returns + anti-scam coupon void */}
      <Dialog
        open={Boolean(payTarget)}
        onOpenChange={(v) => {
          if (!v) {
            setPayTarget(null)
            setPayResult(null)
            setReturns({})
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          {payResult ? (
            <>
              <DialogHeader>
                <DialogTitle>✅ পেমেন্ট সম্পন্ন — টেবিল {payTarget ? toBn(payTarget.number) : ''}</DialogTitle>
                <DialogDescription>
                  মোট {bnTaka(payResult.payable)} পরিশোধ হয়েছে ({payMethod}) — রসিদ নম্বর{' '}
                  <span className="font-black text-stone-900">#{toBn(String(payResult.receiptNo))}</span>
                  {payResult.returnTotal > 0 && (
                    <span className="mt-2 block text-red-600">
                      ↩ রিটার্ন: −৳{payResult.returnTotal}
                      {payResult.voucherVoidedTotal > 0 && ' • কুপন ছাড় বাতিল হয়েছে (রিটার্ন নিয়ম)'}
                    </span>
                  )}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="gap-2 sm:gap-0">
                <Button
                  variant="outline"
                  onClick={() => {
                    setPayTarget(null)
                    setPayResult(null)
                    setReturns({})
                  }}
                >
                  বন্ধ করুন
                </Button>
                <Button
                  onClick={() => window.open(`/receipt/${payResult.receiptId}`, '_blank')}
                  disabled={!payResult.receiptId}
                  className="bg-amber-500 font-black text-white hover:bg-amber-600"
                >
                  🧾 রসিদ প্রিন্ট করুন
                </Button>
              </DialogFooter>
            </>
          ) : (() => {
            const billOrders = payTarget?.session?.orders ?? []
            // live math — same rules the server enforces:
            // any return → ALL coupon discounts of the session are voided
            const hasReturn = Object.values(returns).some((n) => n > 0)
            const returnTotal =
              billOrders.reduce(
                (s, o) => s + o.items.reduce((ss, it) => ss + (returns[it.id] ?? 0) * it.unitPrice, 0),
                0
              )
            // voiding the coupon means its old discount is charged again (+)
            const voucherVoid = hasReturn ? billOrders.reduce((s, o) => s + o.voucherDiscount, 0) : 0
            const grossPayable = payTarget?.session?.bill.payable ?? 0
            const finalPayable = Math.max(0, grossPayable - returnTotal + voucherVoid)
            const hasVoucher = billOrders.some((o) => o.voucherDiscount > 0)
            return (
              <>
                <DialogHeader>
                  <DialogTitle>টেবিল {payTarget ? toBn(payTarget.number) : ''} — বিল পরিশোধ</DialogTitle>
                  <DialogDescription>
                    খাবারের হিসাব মিলিয়ে নিন। কিছু ফেরত (রিটার্ন) থাকলে <Undo2 className="inline h-3.5 w-3.5" /> বোতামে সেট করুন —
                    রিটার্ন হলে কুপন ছাড় স্বয়ংক্রিয়ভাবে বাতিল হবে।
                  </DialogDescription>
                </DialogHeader>

                {/* itemized list with return steppers */}
                <div className="thin-scroll max-h-56 space-y-2 overflow-y-auto rounded-lg border border-stone-200 bg-stone-50 p-2">
                  {billOrders.length === 0 && <p className="p-3 text-center text-xs text-stone-400">কোনো অর্ডার নেই</p>}
                  {billOrders.map((o) => (
                    <div key={o.id} className="rounded-md bg-white p-2">
                      <p className="mb-1 text-[11px] font-black text-stone-500">
                        অর্ডার #{toBn(String(o.orderNo))}
                        {o.voucherCode && (
                          <span className={cn('ml-2', hasReturn ? 'text-red-500 line-through' : 'text-emerald-600')}>🎟️ {o.voucherCode}</span>
                        )}
                      </p>
                      <div className="space-y-1.5">
                        {o.items.map((it) => {
                          const rq = returns[it.id] ?? 0
                          return (
                            <div key={it.id} className="flex items-center justify-between gap-2">
                              <div className="min-w-0">
                                <p className="truncate text-xs font-bold text-stone-800">
                                  {it.itemName} <span className="text-stone-500">×{toBn(String(it.quantity))}</span>
                                  {it.addons.length > 0 && (
                                    <span className="ml-1 text-[10px] font-normal text-stone-400">+ {it.addons.map((a) => a.name).join(', ')}</span>
                                  )}
                                </p>
                                {rq > 0 ? (
                                  <p className="text-[10px] font-bold text-red-600">
                                    ↩ {toBn(String(rq))}টি রিটার্ন — ৳{(it.lineTotal - rq * it.unitPrice).toFixed(0)}
                                  </p>
                                ) : (
                                  <p className="text-[10px] text-stone-400">৳{it.lineTotal}</p>
                                )}
                              </div>
                              <div className="flex shrink-0 items-center gap-1">
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  disabled={rq === 0}
                                  aria-label={`${it.itemName} রিটার্ন কমান`}
                                  onClick={() => setReturns((p) => ({ ...p, [it.id]: Math.max(0, (p[it.id] ?? 0) - 1) }))}
                                  className="h-7 w-7 p-0"
                                >
                                  <Minus className="h-3 w-3" />
                                </Button>
                                <span
                                  className={cn(
                                    'w-6 text-center text-xs font-black',
                                    rq > 0 ? 'text-red-600' : 'text-stone-300'
                                  )}
                                >
                                  {toBn(String(rq))}
                                </span>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  disabled={rq >= it.quantity}
                                  aria-label={`${it.itemName} রিটার্ন যোগ করুন`}
                                  onClick={() => setReturns((p) => ({ ...p, [it.id]: Math.min(it.quantity, (p[it.id] ?? 0) + 1) }))}
                                  className="h-7 w-7 p-0 border-red-200 text-red-500 hover:bg-red-50 hover:text-red-600"
                                >
                                  <Undo2 className="h-3 w-3" />
                                </Button>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>

                {/* live totals */}
                <div className="space-y-1 rounded-lg bg-stone-50 p-3 text-sm">
                  <div className="flex justify-between text-stone-500">
                    <span>মোট বিল</span>
                    <span>৳{grossPayable.toFixed(grossPayable % 1 === 0 ? 0 : 2)}</span>
                  </div>
                  {returnTotal > 0 && (
                    <div className="flex justify-between font-bold text-red-600">
                      <span>↩ রিটার্ন বাদ</span>
                      <span>−৳{returnTotal.toFixed(returnTotal % 1 === 0 ? 0 : 2)}</span>
                    </div>
                  )}
                  {voucherVoid > 0 && (
                    <div className="flex justify-between font-bold text-red-600">
                      <span>🎟️ কুপন ছাড় বাতিল (আগের ছাড় যোগ হবে)</span>
                      <span>+৳{voucherVoid.toFixed(voucherVoid % 1 === 0 ? 0 : 2)}</span>
                    </div>
                  )}
                  <div className="flex items-baseline justify-between border-t border-stone-200 pt-1.5">
                    <span className="font-bold text-stone-800">মোট প্রদেয়</span>
                    <span className="text-xl font-black text-amber-600">৳{finalPayable.toFixed(finalPayable % 1 === 0 ? 0 : 2)}</span>
                  </div>
                </div>

                {hasReturn && hasVoucher && (
                  <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs font-bold text-red-700">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <p>
                      রিটার্ন থাকায় এই বিলের কুপন/প্রোমো ছাড় স্বয়ংক্রিয়ভাবে বাতিল হচ্ছে (স্ক্যাম-প্রতিরোধ নিয়ম) — কাস্টমার পুরো টাকা মোট থেকে পরিশোধ করবে।
                    </p>
                  </div>
                )}

                <Select value={payMethod} onValueChange={setPayMethod}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CASH">💵 ক্যাশ</SelectItem>
                    <SelectItem value="CARD">💳 কার্ড</SelectItem>
                    <SelectItem value="BKASH">📱 বিকাশ</SelectItem>
                    <SelectItem value="NAGAD">📱 নগদ</SelectItem>
                    <SelectItem value="ONLINE">🌐 অনলাইন</SelectItem>
                  </SelectContent>
                </Select>
                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setPayTarget(null)
                      setPayResult(null)
                      setReturns({})
                    }}
                  >
                    বাতিল
                  </Button>
                  <Button onClick={payBill} disabled={paying} className="bg-emerald-600 font-black text-white hover:bg-emerald-700">
                    {paying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Banknote className="h-4 w-4" />}
                    পরিশোধ নিশ্চিত করুন
                  </Button>
                </DialogFooter>
              </>
            )
          })()}
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ============================================================
// TAB 3: মেনু
// ============================================================
interface AddonRow {
  name: string
  price: string
}

function ItemDialog({
  open,
  onOpenChange,
  categories,
  items,
  editing,
  onSaved,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  categories: Category[]
  items: MenuItemRow[]
  editing: MenuItemRow | null
  onSaved: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        {/* form mounts fresh on each open — Radix unmounts dialog content when closed */}
        <ItemForm categories={categories} items={items} editing={editing} onOpenChange={onOpenChange} onSaved={onSaved} />
      </DialogContent>
    </Dialog>
  )
}

function ItemForm({
  categories,
  items,
  editing,
  onOpenChange,
  onSaved,
}: {
  categories: Category[]
  items: MenuItemRow[]
  editing: MenuItemRow | null
  onOpenChange: (v: boolean) => void
  onSaved: () => void
}) {
  const [name, setName] = useState(editing?.name ?? '')
  const [description, setDescription] = useState(editing?.description ?? '')
  const [price, setPrice] = useState(editing ? String(editing.price) : '')
  const [categoryId, setCategoryId] = useState(editing?.categoryId ?? categories[0]?.id ?? '')
  const [imageUrl, setImageUrl] = useState(editing?.imageUrl ?? '')
  const [isSetMenu, setIsSetMenu] = useState(editing?.isSetMenu ?? false)
  const [spiceLevels, setSpiceLevels] = useState<string[]>(() => parseJsonSafe<string[]>(editing?.spiceLevels, []))
  const [addonRows, setAddonRows] = useState<AddonRow[]>(() =>
    parseJsonSafe<{ name: string; price: number }[]>(editing?.addons, []).map((a) => ({ name: a.name, price: String(a.price) }))
  )
  const [upsellIds, setUpsellIds] = useState<string[]>(() => parseJsonSafe<string[]>(editing?.upsellIds, []))
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const toggleSpice = (s: string, on: boolean) => setSpiceLevels((prev) => (on ? [...prev, s] : prev.filter((x) => x !== s)))
  const toggleUpsell = (id: string, on: boolean) => setUpsellIds((prev) => (on ? [...prev, id] : prev.filter((x) => x !== id)))

  const doUpload = async (file: File) => {
    setUploading(true)
    try {
      const url = await uploadImageFile(file)
      setImageUrl(url)
      toast.success('ছবি আপলোড হয়েছে')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'আপলোড ব্যর্থ')
    } finally {
      setUploading(false)
    }
  }

  const save = async () => {
    if (!name.trim()) return toast.error('নাম দিন')
    if (!categoryId) return toast.error('ক্যাটাগরি নির্বাচন করুন')
    const p = parseFloat(price)
    if (isNaN(p) || p < 0) return toast.error('সঠিক দাম দিন')

    setSaving(true)
    const payload = {
      name: name.trim(),
      description: description.trim() || null,
      price: p,
      categoryId,
      imageUrl: imageUrl.trim() || null,
      isSetMenu,
      spiceLevels,
      addons: addonRows.filter((r) => r.name.trim()).map((r) => ({ name: r.name.trim(), price: parseFloat(r.price) || 0 })),
      upsellIds,
    }
    const res = editing
      ? await api.patch(`/api/admin/menu-items/${editing.id}`, payload)
      : await api.post('/api/admin/menu-items', payload)
    setSaving(false)
    if (!res.ok) return toast.error(res.error || 'সেভ ব্যর্থ')
    toast.success(editing ? 'আইটেম আপডেট হয়েছে' : 'আইটেম যোগ হয়েছে')
    onOpenChange(false)
    onSaved()
  }

  const upsellCandidates = items.filter((i) => i.id !== editing?.id)

  return (
    <>
      <DialogHeader>
        <DialogTitle>{editing ? 'আইটেম এডিট করুন' : 'নতুন আইটেম যোগ করুন'}</DialogTitle>
        <DialogDescription>মেনুতে দেখানোর সব তথ্য দিন।</DialogDescription>
      </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1">
            <FieldLabel>নাম *</FieldLabel>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="যেমন কাচ্চি বিরিয়ানি" />
          </div>

          <div className="space-y-1">
            <FieldLabel>বর্ণনা</FieldLabel>
            <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="স্বাদের বর্ণনা…" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <FieldLabel>দাম (৳) *</FieldLabel>
              <Input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="250" />
            </div>
            <div className="space-y-1">
              <FieldLabel>ক্যাটাগরি *</FieldLabel>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger>
                  <SelectValue placeholder="বেছে নিন" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* image: upload or paste URL */}
          <div className="space-y-2">
            <FieldLabel>ছবি</FieldLabel>
            {imageUrl && (
               
              <img src={imageUrl} alt="preview" className="h-28 w-28 rounded-lg border border-stone-200 object-cover" />
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) doUpload(f)
                e.target.value = ''
              }}
            />
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="outline" disabled={uploading} onClick={() => fileRef.current?.click()} className="border-stone-300">
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />} আপলোড
              </Button>
              <Input
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                placeholder="অথবা ছবির লিঙ্ক পেস্ট করুন"
                className="flex-1 text-xs"
              />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-stone-200 p-3">
            <Label className="text-sm font-bold text-stone-700">সেট মেনু?</Label>
            <Switch checked={isSetMenu} onCheckedChange={setIsSetMenu} />
          </div>

          {/* spice levels */}
          <div className="space-y-2">
            <FieldLabel>ঝালের লেভেল (যেগুলো দেখানো হবে)</FieldLabel>
            <div className="flex flex-wrap gap-4">
              {(['Mild', 'Medium', 'Hot'] as const).map((s) => (
                <label key={s} className="flex items-center gap-2 text-sm font-bold text-stone-700">
                  <Checkbox
                    checked={spiceLevels.includes(s)}
                    onCheckedChange={(v) => toggleSpice(s, v === true)}
                    className={s === 'Mild' ? 'data-[state=checked]:bg-emerald-600' : s === 'Hot' ? 'data-[state=checked]:bg-red-600' : 'data-[state=checked]:bg-amber-600'}
                  />
                  <span className={s === 'Mild' ? 'text-emerald-700' : s === 'Hot' ? 'text-red-700' : 'text-amber-700'}>
                    {s === 'Mild' ? '🌿 Mild' : s === 'Medium' ? '🌶️ Medium' : '🌶️🌶️ Hot'}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* addons builder */}
          <div className="space-y-2">
            <FieldLabel>অ্যাড-অন (অতিরিক্ত সামগ্রী)</FieldLabel>
            <div className="thin-scroll max-h-44 space-y-2 overflow-y-auto rounded-lg border border-stone-200 p-2">
              {addonRows.length === 0 && <p className="p-2 text-xs text-stone-400">কোনো অ্যাড-অন নেই</p>}
              {addonRows.map((row, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <Input
                    value={row.name}
                    onChange={(e) => setAddonRows((prev) => prev.map((r, i) => (i === idx ? { ...r, name: e.target.value } : r)))}
                    placeholder="নাম (যেমন এক্সট্রা চিজ)"
                    className="flex-1"
                  />
                  <Input
                    inputMode="decimal"
                    value={row.price}
                    onChange={(e) => setAddonRows((prev) => prev.map((r, i) => (i === idx ? { ...r, price: e.target.value } : r)))}
                    placeholder="৳ দাম"
                    className="w-24"
                  />
                  <button
                    type="button"
                    onClick={() => setAddonRows((prev) => prev.filter((_, i) => i !== idx))}
                    className="rounded p-1 text-red-500 hover:bg-red-50"
                    title="মুছুন"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
            <Button type="button" size="sm" variant="outline" onClick={() => setAddonRows((prev) => [...prev, { name: '', price: '' }])} className="border-stone-300">
              <Plus className="h-4 w-4" /> অ্যাড-অন যোগ করুন
            </Button>
          </div>

          {/* upsell picker */}
          <div className="space-y-2">
            <FieldLabel>এই খাবারের সাথে আপসেল করা হবে</FieldLabel>
            <div className="thin-scroll max-h-44 space-y-1.5 overflow-y-auto rounded-lg border border-stone-200 p-2">
              {upsellCandidates.length === 0 && <p className="p-2 text-xs text-stone-400">আর কোনো আইটেম নেই</p>}
              {upsellCandidates.map((i) => (
                <label key={i.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-stone-50">
                  <Checkbox checked={upsellIds.includes(i.id)} onCheckedChange={(v) => toggleUpsell(i.id, v === true)} />
                  <span className="truncate text-stone-700">{i.name}</span>
                  <span className="ml-auto text-xs text-stone-400">{bnTaka(i.price)}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            বাতিল
          </Button>
          <Button onClick={save} disabled={saving} className="bg-amber-500 font-black text-white hover:bg-amber-600">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} সেভ করুন
          </Button>
        </DialogFooter>
    </>
  )
}

function MenuTab({ onAuthRequired }: TabProps) {
  const [categories, setCategories] = useState<Category[]>([])
  const [items, setItems] = useState<MenuItemRow[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  // category form state
  const [newCat, setNewCat] = useState('')
  const [addingCat, setAddingCat] = useState(false)
  const [editingCatId, setEditingCatId] = useState<string | null>(null)
  const [editingCatName, setEditingCatName] = useState('')

  // item dialog state
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<MenuItemRow | null>(null)

  const load = useCallback(async () => {
    const [catRes, itemRes] = await Promise.all([
      api.get<{ categories: Category[] }>('/api/admin/categories'),
      api.get<{ items: MenuItemRow[] }>('/api/admin/menu-items'),
    ])
    if (isAuthError(catRes) || isAuthError(itemRes)) return onAuthRequired()
    if (!catRes.ok || !catRes.data || !itemRes.ok || !itemRes.data) {
      setErr(catRes.error || itemRes.error || 'মেনু আনা যায়নি')
      setLoading(false)
      return
    }
    setErr('')
    setCategories(catRes.data.categories)
    setItems(itemRes.data.items)
    setLoading(false)
  }, [onAuthRequired])

  useEffect(() => {
    const t = setTimeout(load, 0)
    return () => clearTimeout(t)
  }, [load])

  const addCategory = async () => {
    if (!newCat.trim()) return toast.error('ক্যাটাগরির নাম দিন')
    setAddingCat(true)
    const res = await api.post('/api/admin/categories', { name: newCat })
    setAddingCat(false)
    if (!res.ok) return toast.error(res.error || 'যোগ করা যায়নি')
    toast.success('ক্যাটাগরি যোগ হয়েছে')
    setNewCat('')
    load()
  }

  const renameCategory = async (id: string) => {
    if (!editingCatName.trim()) return toast.error('নাম দিন')
    const res = await api.patch(`/api/admin/categories/${id}`, { name: editingCatName })
    if (!res.ok) return toast.error(res.error || 'রিনেম ব্যর্থ')
    toast.success('ক্যাটাগরি আপডেট হয়েছে')
    setEditingCatId(null)
    load()
  }

  const deleteCategory = async (c: Category) => {
    const res = await api.del(`/api/admin/categories/${c.id}`)
    if (!res.ok) {
      toast.error(res.error || 'ডিলিট ব্যর্থ')
      return
    }
    toast.success('ক্যাটাগরি ডিলিট হয়েছে')
    load()
  }

  const toggleAvailable = async (item: MenuItemRow, on: boolean) => {
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, isAvailable: on } : i)))
    const res = await api.patch(`/api/admin/menu-items/${item.id}`, { isAvailable: on })
    if (!res.ok) {
      toast.error(res.error || 'আপডেট ব্যর্থ')
      load()
      return
    }
    toast.success(on ? `${item.name} — In Stock` : `${item.name} — Out of Stock`)
  }

  const deleteItem = async (item: MenuItemRow) => {
    const res = await api.del(`/api/admin/menu-items/${item.id}`)
    if (!res.ok) {
      toast.error(res.error || 'ডিলিট ব্যর্থ')
      return
    }
    toast.success('আইটেম ডিলিট হয়েছে')
    load()
  }

  if (loading) return <Loading />
  if (err)
    return (
      <LoadError
        msg={err}
        onRetry={() => {
          setErr('')
          setLoading(true)
          load()
        }}
      />
    )

  return (
    <div className="space-y-4">
      {/* ---- categories ---- */}
      <Card className="border-stone-200">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">🗂️ ক্যাটাগরি ম্যানেজমেন্ট</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="নতুন ক্যাটাগরির নাম" className="max-w-xs" />
            <Button onClick={addCategory} disabled={addingCat} className="bg-amber-500 font-black text-white hover:bg-amber-600">
              {addingCat ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} যোগ করুন
            </Button>
          </div>
          <div className="thin-scroll max-h-48 space-y-1.5 overflow-y-auto">
            {categories.length === 0 && <p className="text-sm text-stone-400">কোনো ক্যাটাগরি নেই</p>}
            {categories.map((c) => (
              <div key={c.id} className="flex items-center gap-2 rounded-lg border border-stone-100 bg-stone-50 px-3 py-2">
                {editingCatId === c.id ? (
                  <>
                    <Input value={editingCatName} onChange={(e) => setEditingCatName(e.target.value)} className="h-8 max-w-xs" />
                    <Button size="sm" onClick={() => renameCategory(c.id)} className="h-8 bg-emerald-600 text-white hover:bg-emerald-500">
                      সেভ
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditingCatId(null)} className="h-8">
                      বাতিল
                    </Button>
                  </>
                ) : (
                  <>
                    <UtensilsCrossed className="h-4 w-4 text-amber-600" />
                    <span className="flex-1 text-sm font-bold text-stone-800">{c.name}</span>
                    <Badge variant="outline" className="border-stone-300 text-xs text-stone-500">
                      {toBn(c._count.items)} আইটেম
                    </Badge>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 text-stone-500 hover:text-amber-600"
                      onClick={() => {
                        setEditingCatId(c.id)
                        setEditingCatName(c.name)
                      }}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <ConfirmAction
                      title={`"${c.name}" ডিলিট?`}
                      description="এই ক্যাটাগরি ও এর সব আইটেম মুছে যাবে।"
                      confirmLabel="ডিলিট"
                      onConfirm={() => deleteCategory(c)}
                    >
                      <Button size="sm" variant="ghost" className="h-8 text-red-500 hover:bg-red-50">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </ConfirmAction>
                  </>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ---- items grouped by category ---- */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-black uppercase tracking-wide text-stone-500">খাবারের আইটেম</h3>
        <Button
          size="sm"
          onClick={() => {
            setEditingItem(null)
            setDialogOpen(true)
          }}
          disabled={categories.length === 0}
          className="bg-amber-500 font-black text-white hover:bg-amber-600"
        >
          <Plus className="h-4 w-4" /> নতুন আইটেম
        </Button>
      </div>
      {categories.length === 0 && <p className="text-sm text-stone-500">আইটেম যোগ করার আগে একটি ক্যাটাগরি বানান।</p>}

      {categories.map((cat) => {
        const catItems = items.filter((i) => i.categoryId === cat.id)
        return (
          <Card key={cat.id} className="border-stone-200">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-black text-stone-700">
                {cat.name}
                <Badge variant="outline" className="border-stone-300 text-xs font-bold text-stone-500">
                  {toBn(catItems.length)}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {catItems.length === 0 && <p className="text-sm text-stone-400">এই ক্যাটাগরিতে আইটেম নেই</p>}
              {catItems.map((item) => (
                <div key={item.id} className="flex items-center gap-3 rounded-lg border border-stone-100 bg-white p-2.5">
                  {item.imageUrl ? (
                     
                    <img src={item.imageUrl} alt={item.name} className="h-12 w-12 shrink-0 rounded-lg object-cover" />
                  ) : (
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-stone-100">
                      <UtensilsCrossed className="h-5 w-5 text-stone-400" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 truncate text-sm font-bold text-stone-900">
                      {item.name}
                      {item.isSetMenu && (
                        <Badge className="bg-amber-100 text-[10px] text-amber-700 hover:bg-amber-100">সেট</Badge>
                      )}
                    </p>
                    <p className="truncate text-xs text-stone-500">{item.description || '—'}</p>
                  </div>
                  <span className="shrink-0 text-sm font-black text-amber-700">{bnTaka(item.price)}</span>

                  {/* availability switch */}
                  <div className="flex shrink-0 items-center gap-2">
                    <Switch
                      checked={item.isAvailable}
                      onCheckedChange={(v) => toggleAvailable(item, v)}
                      className="data-[state=checked]:bg-emerald-600 data-[state=unchecked]:bg-red-400"
                    />
                    <span className={`w-20 text-[11px] font-black ${item.isAvailable ? 'text-emerald-700' : 'text-red-600'}`}>
                      {item.isAvailable ? 'In Stock' : 'Out of Stock'}
                    </span>
                  </div>

                  <Button
                    size="sm"
                    variant="ghost"
                    className="shrink-0 text-stone-500 hover:text-amber-600"
                    onClick={() => {
                      setEditingItem(item)
                      setDialogOpen(true)
                    }}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <ConfirmAction
                    title={`"${item.name}" ডিলিট?`}
                    description="আইটেমটি মেনু থেকে স্থায়ীভাবে মুছে যাবে।"
                    confirmLabel="ডিলিট"
                    onConfirm={() => deleteItem(item)}
                  >
                    <Button size="sm" variant="ghost" className="shrink-0 text-red-500 hover:bg-red-50">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </ConfirmAction>
                </div>
              ))}
            </CardContent>
          </Card>
        )
      })}

      <ItemDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        categories={categories}
        items={items}
        editing={editingItem}
        onSaved={load}
      />
    </div>
  )
}

// ============================================================
// TAB 4: হ্যাপি আওয়ার
// ============================================================
function HappyHourDialog({
  open,
  onOpenChange,
  items,
  editing,
  onSaved,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  items: MenuItemRow[]
  editing: HappyHourRow | null
  onSaved: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <HappyHourForm items={items} editing={editing} onOpenChange={onOpenChange} onSaved={onSaved} />
      </DialogContent>
    </Dialog>
  )
}

function HappyHourForm({
  items,
  editing,
  onOpenChange,
  onSaved,
}: {
  items: MenuItemRow[]
  editing: HappyHourRow | null
  onOpenChange: (v: boolean) => void
  onSaved: () => void
}) {
  const [name, setName] = useState(editing?.name ?? '')
  const [percent, setPercent] = useState(editing ? String(editing.discountPercent) : '')
  const [startTime, setStartTime] = useState(editing?.startTime ?? '15:00')
  const [endTime, setEndTime] = useState(editing?.endTime ?? '18:00')
  const [days, setDays] = useState<number[]>(() => parseJsonSafe<number[]>(editing?.daysOfWeek, []))
  // schedule mode: 'days' = weekly day chips, 'range' = custom date-to-date
  const [scheduleMode, setScheduleMode] = useState<'days' | 'range'>(
    editing?.startDate && editing?.endDate ? 'range' : 'days'
  )
  const isoDay = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : '')
  const [startDate, setStartDate] = useState(() => isoDay(editing?.startDate))
  const [endDate, setEndDate] = useState(() => isoDay(editing?.endDate))
  const [itemIds, setItemIds] = useState<string[]>(() => parseJsonSafe<string[]>(editing?.itemIds, []))
  const [active, setActive] = useState(editing?.active ?? true)
  const [saving, setSaving] = useState(false)

  const toggleItem = (id: string, on: boolean) => setItemIds((prev) => (on ? [...prev, id] : prev.filter((x) => x !== id)))

  const save = async () => {
    const p = parseFloat(percent)
    if (!name.trim()) return toast.error('নাম দিন')
    if (isNaN(p) || p <= 0 || p > 90) return toast.error('১-৯০% এর মধ্যে ছাড় দিন')
    if (scheduleMode === 'range') {
      if (!startDate || !endDate) return toast.error('শুরু ও শেষ — দুটো তারিখই দিন')
      if (endDate < startDate) return toast.error('শেষ তারিখ শুরুর আগে হতে পারে না')
    }
    setSaving(true)
    const payload = {
      name: name.trim(),
      discountPercent: p,
      startTime,
      endTime,
      daysOfWeek: scheduleMode === 'days' ? days : [],
      startDate: scheduleMode === 'range' ? startDate : null,
      endDate: scheduleMode === 'range' ? endDate : null,
      itemIds,
      active,
    }
    const res = editing
      ? await api.patch(`/api/admin/happy-hours/${editing.id}`, payload)
      : await api.post('/api/admin/happy-hours', payload)
    setSaving(false)
    if (!res.ok) return toast.error(res.error || 'সেভ ব্যর্থ')
    toast.success(editing ? 'হ্যাপি আওয়ার আপডেট হয়েছে' : 'হ্যাপি আওয়ার যোগ হয়েছে')
    onOpenChange(false)
    onSaved()
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{editing ? 'হ্যাপি আওয়ার এডিট' : 'নতুন হ্যাপি আওয়ার'}</DialogTitle>
        <DialogDescription>নির্দিষ্ট সময়ে সব বা নির্বাচিত আইটেমে পার্সেন্টেজ ছাড়।</DialogDescription>
      </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <FieldLabel>নাম *</FieldLabel>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="যেমন আফটারনুন স্ন্যাকস অফার" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <FieldLabel>ছাড় (%) *</FieldLabel>
              <Input inputMode="decimal" value={percent} onChange={(e) => setPercent(e.target.value)} placeholder="20" />
            </div>
            <div className="space-y-1">
              <FieldLabel>শুরু</FieldLabel>
              <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            </div>
            <div className="space-y-1">
              <FieldLabel>শেষ</FieldLabel>
              <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <FieldLabel>কোন দিনে চলবে?</FieldLabel>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setScheduleMode('days')}
                className={cn(
                  'rounded-lg border px-3 py-2 text-xs font-bold transition',
                  scheduleMode === 'days'
                    ? 'border-amber-500 bg-amber-50 text-amber-700'
                    : 'border-stone-200 bg-white text-stone-500 hover:border-amber-300'
                )}
              >
                📆 সাপ্তাহিক বার
              </button>
              <button
                type="button"
                onClick={() => setScheduleMode('range')}
                className={cn(
                  'rounded-lg border px-3 py-2 text-xs font-bold transition',
                  scheduleMode === 'range'
                    ? 'border-amber-500 bg-amber-50 text-amber-700'
                    : 'border-stone-200 bg-white text-stone-500 hover:border-amber-300'
                )}
              >
                🗓️ কাস্টম তারিখ (Date to Date)
              </button>
            </div>
            {scheduleMode === 'days' ? (
              <div className="pt-1">
                <p className="mb-1.5 text-[11px] text-stone-400">কিছু নির্বাচন না করলে প্রতিদিন চলবে</p>
                <DayChips value={days} onChange={setDays} />
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2 pt-1">
                <div className="space-y-1">
                  <FieldLabel>শুরুর তারিখ *</FieldLabel>
                  <Input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="border-stone-200"
                  />
                </div>
                <div className="space-y-1">
                  <FieldLabel>শেষ তারিখ *</FieldLabel>
                  <Input
                    type="date"
                    value={endDate}
                    min={startDate || undefined}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="border-stone-200"
                  />
                </div>
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            <FieldLabel>আইটেম (কিছু নির্বাচন না করলে সব আইটেম)</FieldLabel>
            <div className="thin-scroll max-h-44 space-y-1.5 overflow-y-auto rounded-lg border border-stone-200 p-2">
              {items.map((i) => (
                <label key={i.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-stone-50">
                  <Checkbox checked={itemIds.includes(i.id)} onCheckedChange={(v) => toggleItem(i.id, v === true)} />
                  <span className="truncate text-stone-700">{i.name}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-stone-200 p-3">
            <Label className="text-sm font-bold text-stone-700">সক্রিয়?</Label>
            <Switch checked={active} onCheckedChange={setActive} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            বাতিল
          </Button>
          <Button onClick={save} disabled={saving} className="bg-amber-500 font-black text-white hover:bg-amber-600">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} সেভ করুন
          </Button>
        </DialogFooter>
    </>
  )
}

function HappyHourTab({ onAuthRequired }: TabProps) {
  const [rules, setRules] = useState<HappyHourRow[] | null>(null)
  const [items, setItems] = useState<MenuItemRow[]>([])
  const [err, setErr] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<HappyHourRow | null>(null)

  const load = useCallback(async () => {
    const [hhRes, itemRes] = await Promise.all([
      api.get<{ happyHours: HappyHourRow[] }>('/api/admin/happy-hours'),
      api.get<{ items: MenuItemRow[] }>('/api/admin/menu-items'),
    ])
    if (isAuthError(hhRes)) return onAuthRequired()
    if (!hhRes.ok || !hhRes.data) {
      setErr(hhRes.error || 'হ্যাপি আওয়ার আনা যায়নি')
      return
    }
    setErr('')
    setRules(hhRes.data.happyHours)
    if (itemRes.ok && itemRes.data) setItems(itemRes.data.items)
  }, [onAuthRequired])

  useEffect(() => {
    const t = setTimeout(load, 0)
    return () => clearTimeout(t)
  }, [load])

  const toggleActive = async (rule: HappyHourRow, on: boolean) => {
    setRules((prev) => (prev ? prev.map((r) => (r.id === rule.id ? { ...r, active: on } : r)) : prev))
    const res = await api.patch(`/api/admin/happy-hours/${rule.id}`, { active: on })
    if (!res.ok) {
      toast.error(res.error || 'আপডেট ব্যর্থ')
      load()
    }
  }

  const deleteRule = async (rule: HappyHourRow) => {
    const res = await api.del(`/api/admin/happy-hours/${rule.id}`)
    if (!res.ok) {
      toast.error(res.error || 'ডিলিট ব্যর্থ')
      return
    }
    toast.success('হ্যাপি আওয়ার ডিলিট হয়েছে')
    load()
  }

  if (err) return <LoadError msg={err} onRetry={load} />
  if (!rules) return <Loading />

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-black uppercase tracking-wide text-stone-500">হ্যাপি আওয়ার রুল</h3>
        <Button
          size="sm"
          onClick={() => {
            setEditing(null)
            setDialogOpen(true)
          }}
          className="bg-amber-500 font-black text-white hover:bg-amber-600"
        >
          <Plus className="h-4 w-4" /> নতুন হ্যাপি আওয়ার
        </Button>
      </div>

      {rules.length === 0 && <p className="py-10 text-center text-sm text-stone-400">কোনো হ্যাপি আওয়ার নেই</p>}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {rules.map((rule) => {
          const days = parseJsonSafe<number[]>(rule.daysOfWeek, [])
          const itemIds = parseJsonSafe<string[]>(rule.itemIds, [])
          const isRange = Boolean(rule.startDate && rule.endDate)
          return (
            <Card key={rule.id} className="border-stone-200">
              <CardContent className="space-y-2.5 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-black text-stone-900">{rule.name}</p>
                    <p className="mt-0.5 flex items-center gap-1 text-xs font-bold text-stone-500">
                      <Clock className="h-3.5 w-3.5" /> {rule.startTime} - {rule.endTime}
                    </p>
                  </div>
                  <Badge className="bg-orange-600 hover:bg-orange-600">{toBn(rule.discountPercent)}% ছাড়</Badge>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  {isRange ? (
                    <Badge variant="outline" className="border-purple-200 bg-purple-50 text-purple-700">
                      🗓️ {bnDateOnly(rule.startDate)} → {bnDateOnly(rule.endDate)}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="border-stone-300 text-stone-600">
                      📅 {bnDays(days)}
                    </Badge>
                  )}
                  <Badge variant="outline" className="border-stone-300 text-stone-600">
                    🍽️ {itemIds.length === 0 ? 'সব আইটেম' : `${toBn(itemIds.length)} আইটেম`}
                  </Badge>
                </div>
                <div className="flex items-center justify-between border-t border-dashed border-stone-200 pt-2.5">
                  <div className="flex items-center gap-2">
                    <Switch checked={rule.active} onCheckedChange={(v) => toggleActive(rule, v)} />
                    <span className={`text-xs font-black ${rule.active ? 'text-emerald-700' : 'text-stone-400'}`}>
                      {rule.active ? 'সক্রিয়' : 'বন্ধ'}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-stone-500 hover:text-amber-600"
                      onClick={() => {
                        setEditing(rule)
                        setDialogOpen(true)
                      }}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <ConfirmAction
                      title={`"${rule.name}" ডিলিট?`}
                      description="হ্যাপি আওয়ার রুলটি স্থায়ীভাবে মুছে যাবে।"
                      confirmLabel="ডিলিট"
                      onConfirm={() => deleteRule(rule)}
                    >
                      <Button size="sm" variant="ghost" className="text-red-500 hover:bg-red-50">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </ConfirmAction>
                  </div>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      <HappyHourDialog open={dialogOpen} onOpenChange={setDialogOpen} items={items} editing={editing} onSaved={load} />
    </div>
  )
}

// ============================================================
// TAB 5: ভাউচার (rule builder)
// ============================================================
function VoucherDialog({
  open,
  onOpenChange,
  setMenuItems,
  editing,
  onSaved,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  setMenuItems: MenuItemRow[]
  editing: VoucherRow | null
  onSaved: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <VoucherForm setMenuItems={setMenuItems} editing={editing} onOpenChange={onOpenChange} onSaved={onSaved} />
      </DialogContent>
    </Dialog>
  )
}

function VoucherForm({
  setMenuItems,
  editing,
  onOpenChange,
  onSaved,
}: {
  setMenuItems: MenuItemRow[]
  editing: VoucherRow | null
  onOpenChange: (v: boolean) => void
  onSaved: () => void
}) {
  const [code, setCode] = useState(editing?.code ?? '')
  const [title, setTitle] = useState(editing?.title ?? '')
  const [description, setDescription] = useState(editing?.description ?? '')
  const [discountType, setDiscountType] = useState(editing?.discountType ?? 'PERCENT')
  const [discountValue, setDiscountValue] = useState(editing ? String(editing.discountValue) : '')
  const [maxDiscount, setMaxDiscount] = useState(editing?.maxDiscount != null ? String(editing.maxDiscount) : '')
  const [minOrderAmount, setMinOrderAmount] = useState(String(editing?.minOrderAmount ?? 0))
  const [ruleType, setRuleType] = useState(editing?.ruleType ?? 'GENERAL')
  const [startTime, setStartTime] = useState(editing?.startTime ?? '12:00')
  const [endTime, setEndTime] = useState(editing?.endTime ?? '15:00')
  const [days, setDays] = useState<number[]>(() => parseJsonSafe<number[]>(editing?.daysOfWeek, []))
  const [specificDate, setSpecificDate] = useState(
    editing?.specificDate ? new Date(editing.specificDate).toISOString().slice(0, 10) : ''
  )
  const [setMenuIds, setSetMenuIds] = useState<string[]>(() => parseJsonSafe<string[]>(editing?.setMenuIds, []))
  const [minQuantity, setMinQuantity] = useState(editing?.minQuantity != null ? String(editing.minQuantity) : '2')
  const [usageLimit, setUsageLimit] = useState(editing?.usageLimit != null ? String(editing.usageLimit) : '')
  const [singleUse, setSingleUse] = useState(editing?.singleUse ?? false)
  const [active, setActive] = useState(editing?.active ?? true)
  const [saving, setSaving] = useState(false)

  const toggleSetMenu = (id: string, on: boolean) => setSetMenuIds((prev) => (on ? [...prev, id] : prev.filter((x) => x !== id)))

  const save = async () => {
    const dv = parseFloat(discountValue)
    if (!title.trim()) return toast.error('শিরোনাম দিন')
    if (isNaN(dv) || dv <= 0) return toast.error('সঠিক ছাড়ের পরিমাণ দিন')

    setSaving(true)
    const common = {
      title: title.trim(),
      description: description.trim() || null,
      discountValue: dv,
      maxDiscount: discountType === 'PERCENT' && maxDiscount ? parseFloat(maxDiscount) : null,
      minOrderAmount: parseFloat(minOrderAmount) || 0,
      startTime: ruleType === 'HOT_TIME' ? startTime : null,
      endTime: ruleType === 'HOT_TIME' ? endTime : null,
      daysOfWeek: ruleType === 'SET_MENU_QTY' ? [] : days,
      specificDate: ruleType === 'SPECIAL_DAY' && specificDate ? specificDate : null,
      setMenuIds: ruleType === 'SET_MENU_QTY' ? setMenuIds : [],
      minQuantity: ruleType === 'SET_MENU_QTY' ? parseInt(minQuantity, 10) || null : null,
      usageLimit: usageLimit ? parseInt(usageLimit, 10) : null,
      singleUse,
      active,
    }
    const res = editing
      ? await api.patch(`/api/admin/vouchers/${editing.id}`, common)
      : await api.post('/api/admin/vouchers', {
          ...common,
          code: code.trim().toUpperCase(),
          discountType,
          ruleType,
        })
    setSaving(false)
    if (!res.ok) return toast.error(res.error || 'সেভ ব্যর্থ')
    toast.success(editing ? 'ভাউচার আপডেট হয়েছে' : 'ভাউচার তৈরি হয়েছে')
    onOpenChange(false)
    onSaved()
  }

  const ruleInfo: Record<string, string> = {
    GENERAL: 'সব অর্ডারে প্রযোজ্য (সর্বদা)',
    HOT_TIME: 'নির্দিষ্ট সময় ও বারে প্রযোজ্য',
    SPECIAL_DAY: 'নির্দিষ্ট তারিখ বা বারে প্রযোজ্য',
    SET_MENU_QTY: 'নির্দিষ্ট সংখ্যক সেট মেনু অর্ডার হলে প্রযোজ্য',
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{editing ? 'ভাউচার এডিট' : 'নতুন ভাউচার (রুল বিল্ডার)'}</DialogTitle>
        <DialogDescription>
          {editing ? 'কোড/টাইপ পরিবর্তনযোগ্য নয় — বাকি সব আপডেট করা যাবে।' : 'শর্তসাপেক্ষ ডিসকাউন্ট ক্যাম্পেইন বানান।'}
        </DialogDescription>
      </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <FieldLabel>কুপন কোড *</FieldLabel>
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="EID25"
                disabled={!!editing}
                className="font-mono uppercase"
              />
            </div>
            <div className="space-y-1">
              <FieldLabel>ডিসকাউন্ট টাইপ *</FieldLabel>
              <Select value={discountType} onValueChange={setDiscountType} disabled={!!editing}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PERCENT">পার্সেন্ট (%)</SelectItem>
                  <SelectItem value="FIXED">নির্দিষ্ট (৳)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1">
            <FieldLabel>শিরোনাম *</FieldLabel>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="যেমন ঈদ ধামাকা অফার" />
          </div>
          <div className="space-y-1">
            <FieldLabel>বর্ণনা</FieldLabel>
            <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <FieldLabel>{discountType === 'PERCENT' ? 'ছাড় (%) *' : 'ছাড় (৳) *'}</FieldLabel>
              <Input inputMode="decimal" value={discountValue} onChange={(e) => setDiscountValue(e.target.value)} />
            </div>
            <div className="space-y-1">
              <FieldLabel>সর্বনিম্ন অর্ডার (৳)</FieldLabel>
              <Input inputMode="decimal" value={minOrderAmount} onChange={(e) => setMinOrderAmount(e.target.value)} />
            </div>
          </div>
          {discountType === 'PERCENT' && (
            <div className="space-y-1">
              <FieldLabel>সর্বোচ্চ ছাড় সীমা (৳, ঐচ্ছিক)</FieldLabel>
              <Input inputMode="decimal" value={maxDiscount} onChange={(e) => setMaxDiscount(e.target.value)} placeholder="200" />
            </div>
          )}

          <div className="space-y-1">
            <FieldLabel>রুল টাইপ</FieldLabel>
            <Select value={ruleType} onValueChange={setRuleType} disabled={!!editing}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(RULE_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-stone-400">{ruleInfo[ruleType]}</p>
          </div>

          {/* conditional rule fields */}
          {ruleType === 'HOT_TIME' && (
            <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50/50 p-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <FieldLabel>শুরু সময়</FieldLabel>
                  <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <FieldLabel>শেষ সময়</FieldLabel>
                  <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
                </div>
              </div>
              <div className="space-y-1.5">
                <FieldLabel>বার (খালি = প্রতিদিন)</FieldLabel>
                <DayChips value={days} onChange={setDays} />
              </div>
            </div>
          )}

          {ruleType === 'SPECIAL_DAY' && (
            <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50/50 p-3">
              <div className="space-y-1">
                <FieldLabel>স্পেশাল তারিখ</FieldLabel>
                <Input type="date" value={specificDate} onChange={(e) => setSpecificDate(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <FieldLabel>অথবা নির্দিষ্ট বার (ঐচ্ছিক)</FieldLabel>
                <DayChips value={days} onChange={setDays} />
              </div>
            </div>
          )}

          {ruleType === 'SET_MENU_QTY' && (
            <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50/50 p-3">
              <div className="space-y-1">
                <FieldLabel>সর্বনিম্ন সেট মেনু সংখ্যা *</FieldLabel>
                <Input inputMode="numeric" value={minQuantity} onChange={(e) => setMinQuantity(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <FieldLabel>কোন সেট মেনুগুলো গণনা হবে</FieldLabel>
                <div className="thin-scroll max-h-36 space-y-1.5 overflow-y-auto rounded-lg border border-stone-200 bg-white p-2">
                  {setMenuItems.length === 0 && (
                    <p className="p-2 text-xs text-stone-400">কোনো সেট মেনু আইটেম নেই — মেনু ট্যাব থেকে &quot;সেট মেনু&quot; চালু করুন</p>
                  )}
                  {setMenuItems.map((i) => (
                    <label key={i.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-stone-50">
                      <Checkbox checked={setMenuIds.includes(i.id)} onCheckedChange={(v) => toggleSetMenu(i.id, v === true)} />
                      <span className="truncate text-stone-700">{i.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* limits */}
          <div className="space-y-3 rounded-lg border border-stone-200 p-3">
            <p className="text-xs font-black uppercase tracking-wide text-stone-500">সীমা</p>
            <div className="space-y-1">
              <FieldLabel>ক্যাম্পেইন লিমিট (মোট ব্যবহার, খালি = আনলিমিটেড)</FieldLabel>
              <Input inputMode="numeric" value={usageLimit} onChange={(e) => setUsageLimit(e.target.value)} placeholder="100" />
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-sm font-bold text-stone-700">একবারই ব্যবহারযোগ্য (প্রতি ডিভাইস)</Label>
              <Switch checked={singleUse} onCheckedChange={setSingleUse} />
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-sm font-bold text-stone-700">সক্রিয়?</Label>
              <Switch checked={active} onCheckedChange={setActive} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            বাতিল
          </Button>
          <Button onClick={save} disabled={saving} className="bg-amber-500 font-black text-white hover:bg-amber-600">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} সেভ করুন
          </Button>
        </DialogFooter>
    </>
  )
}

function VouchersTab({ onAuthRequired }: TabProps) {
  const [vouchers, setVouchers] = useState<VoucherRow[] | null>(null)
  const [items, setItems] = useState<MenuItemRow[]>([])
  const [err, setErr] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<VoucherRow | null>(null)

  const load = useCallback(async () => {
    const [vRes, iRes] = await Promise.all([
      api.get<{ vouchers: VoucherRow[] }>('/api/admin/vouchers'),
      api.get<{ items: MenuItemRow[] }>('/api/admin/menu-items'),
    ])
    if (isAuthError(vRes)) return onAuthRequired()
    if (!vRes.ok || !vRes.data) {
      setErr(vRes.error || 'ভাউচার আনা যায়নি')
      return
    }
    setErr('')
    setVouchers(vRes.data.vouchers)
    if (iRes.ok && iRes.data) setItems(iRes.data.items)
  }, [onAuthRequired])

  useEffect(() => {
    const t = setTimeout(load, 0)
    return () => clearTimeout(t)
  }, [load])

  const toggleActive = async (v: VoucherRow, on: boolean) => {
    setVouchers((prev) => (prev ? prev.map((x) => (x.id === v.id ? { ...x, active: on } : x)) : prev))
    const res = await api.patch(`/api/admin/vouchers/${v.id}`, { active: on })
    if (!res.ok) {
      toast.error(res.error || 'আপডেট ব্যর্থ')
      load()
    }
  }

  const deleteVoucher = async (v: VoucherRow) => {
    const res = await api.del(`/api/admin/vouchers/${v.id}`)
    if (!res.ok) {
      toast.error(res.error || 'ডিলিট ব্যর্থ')
      return
    }
    toast.success('ভাউচার ডিলিট হয়েছে')
    load()
  }

  if (err) return <LoadError msg={err} onRetry={load} />
  if (!vouchers) return <Loading />

  const setMenuItems = items.filter((i) => i.isSetMenu)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-black uppercase tracking-wide text-stone-500">ভাউচার ক্যাম্পেইন</h3>
        <Button
          size="sm"
          onClick={() => {
            setEditing(null)
            setDialogOpen(true)
          }}
          className="bg-amber-500 font-black text-white hover:bg-amber-600"
        >
          <Plus className="h-4 w-4" /> নতুন ভাউচার
        </Button>
      </div>

      {vouchers.length === 0 && <p className="py-10 text-center text-sm text-stone-400">কোনো ভাউচার নেই</p>}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {vouchers.map((v) => {
          const days = parseJsonSafe<number[]>(v.daysOfWeek, [])
          return (
            <Card key={v.id} className="border-stone-200">
              <CardContent className="space-y-2.5 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge className="bg-stone-900 font-mono text-amber-300 hover:bg-stone-900">{v.code}</Badge>
                      <Badge variant="outline" className="border-amber-300 bg-amber-50 text-xs text-amber-800">
                        {RULE_LABELS[v.ruleType] ?? v.ruleType}
                      </Badge>
                      {v.singleUse && (
                        <Badge className="bg-pink-100 text-xs text-pink-700 hover:bg-pink-100">১-টাইম</Badge>
                      )}
                    </div>
                    <p className="mt-1.5 truncate font-black text-stone-900">{v.title}</p>
                    {v.description && <p className="truncate text-xs text-stone-500">{v.description}</p>}
                  </div>
                  <span className="shrink-0 text-lg font-black text-orange-600">
                    {v.discountType === 'PERCENT' ? `${toBn(v.discountValue)}%` : bnTaka(v.discountValue)}
                    {v.discountType === 'PERCENT' && v.maxDiscount != null && (
                      <span className="block text-[10px] font-bold text-stone-400">সর্বোচ্চ {bnTaka(v.maxDiscount)}</span>
                    )}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                  <Badge variant="outline" className="border-stone-300 font-bold text-stone-600">
                    ব্যবহার: {toBn(v.usedCount)}
                    {v.usageLimit != null ? ` / ${toBn(v.usageLimit)}` : ' (আনলিমিটেড)'}
                  </Badge>
                  {v.minOrderAmount > 0 && (
                    <Badge variant="outline" className="border-stone-300 text-stone-600">
                      ন্যূনতম বিল {bnTaka(v.minOrderAmount)}
                    </Badge>
                  )}
                  {v.ruleType === 'HOT_TIME' && v.startTime && v.endTime && (
                    <Badge variant="outline" className="border-stone-300 text-stone-600">
                      ⏰ {v.startTime}-{v.endTime} · {bnDays(days)}
                    </Badge>
                  )}
                  {v.ruleType === 'SPECIAL_DAY' && v.specificDate && (
                    <Badge variant="outline" className="border-stone-300 text-stone-600">
                      📅 {bnDateTime(v.specificDate)}
                    </Badge>
                  )}
                  {v.ruleType === 'SET_MENU_QTY' && v.minQuantity != null && (
                    <Badge variant="outline" className="border-stone-300 text-stone-600">
                      🍱 {toBn(v.minQuantity)} সেট মেনু
                    </Badge>
                  )}
                </div>

                <div className="flex items-center justify-between border-t border-dashed border-stone-200 pt-2.5">
                  <div className="flex items-center gap-2">
                    <Switch checked={v.active} onCheckedChange={(on) => toggleActive(v, on)} />
                    <span className={`text-xs font-black ${v.active ? 'text-emerald-700' : 'text-stone-400'}`}>
                      {v.active ? 'সক্রিয়' : 'বন্ধ'}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-stone-500 hover:text-amber-600"
                      onClick={() => {
                        setEditing(v)
                        setDialogOpen(true)
                      }}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <ConfirmAction
                      title={`"${v.code}" ডিলিট?`}
                      description="ভাউচারটি স্থায়ীভাবে মুছে যাবে।"
                      confirmLabel="ডিলিট"
                      onConfirm={() => deleteVoucher(v)}
                    >
                      <Button size="sm" variant="ghost" className="text-red-500 hover:bg-red-50">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </ConfirmAction>
                  </div>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      <VoucherDialog open={dialogOpen} onOpenChange={setDialogOpen} setMenuItems={setMenuItems} editing={editing} onSaved={load} />
    </div>
  )
}

// ============================================================
// TAB: 🎁 অকেশন অফার (birthday/anniversary/custom occasion offers)
// perm: 'settings' — same gating as settings tab
// ============================================================
interface OccasionRow {
  id: string
  name: string
  emoji: string
  dateLabel: string
  description: string | null
  discount: number
  minBill: number
  askText: string | null
  fieldType: string // DATE | PHONE | TEXT
  active: boolean
  sortOrder: number
  createdAt: string
}

const FIELD_TYPE_BN: Record<string, string> = {
  DATE: 'তারিখ',
  PHONE: 'ফোন নম্বর',
  TEXT: 'সাধারণ তথ্য',
}

function OccasionDialog({
  open,
  onOpenChange,
  editing,
  nextSort,
  onSaved,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  editing: OccasionRow | null
  nextSort: number
  onSaved: () => void
}) {
  const [name, setName] = useState(editing?.name ?? '')
  const [emoji, setEmoji] = useState(editing?.emoji ?? '')
  const [dateLabel, setDateLabel] = useState(editing?.dateLabel ?? '')
  const [description, setDescription] = useState(editing?.description ?? '')
  const [discount, setDiscount] = useState(editing ? String(editing.discount) : '')
  const [minBill, setMinBill] = useState(editing ? String(editing.minBill) : '')
  const [askText, setAskText] = useState(editing?.askText ?? '')
  const [fieldType, setFieldType] = useState(editing?.fieldType ?? 'DATE')
  const [active, setActive] = useState(editing?.active ?? true)
  const [saving, setSaving] = useState(false)

  const save = async () => {
    if (!name.trim()) return toast.error('অকেশনের নাম দিন')
    const d = parseFloat(discount)
    if (isNaN(d) || d <= 0) return toast.error('ছাড়ের পরিমাণ (৳) দিন')
    const mb = parseFloat(minBill)
    if (isNaN(mb) || mb < 0) return toast.error('ন্যূনতম বিল (৳) দিন')

    setSaving(true)
    const payload = {
      name: name.trim(),
      emoji: emoji.trim() || '🎉',
      dateLabel: dateLabel.trim(),
      description: description.trim() || null,
      discount: d,
      minBill: mb,
      askText: askText.trim() || null,
      fieldType,
      active,
      sortOrder: editing?.sortOrder ?? nextSort,
    }
    const res = editing
      ? await api.patch(`/api/admin/occasions/${editing.id}`, payload)
      : await api.post('/api/admin/occasions', payload)
    setSaving(false)
    if (!res.ok) return toast.error(res.error || 'সেভ ব্যর্থ')
    toast.success(editing ? 'অকেশন আপডেট হয়েছে' : 'অকেশন যোগ হয়েছে')
    onOpenChange(false)
    onSaved()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? 'অকেশন এডিট করুন' : 'নতুন অকেশন অফার'}</DialogTitle>
          <DialogDescription>
            যেকোনো বিষয়ের অফার বানান — জন্মদিন, বিয়ের বার্ষিকী বা যা খুশি। যত খুশি অফার যোগ/ডিলিট করতে পারবেন।
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <FieldLabel>ইমোজি</FieldLabel>
              <Input value={emoji} onChange={(e) => setEmoji(e.target.value)} placeholder="🎂" className="text-center text-lg" />
            </div>
            <div className="col-span-2 space-y-1">
              <FieldLabel>নাম *</FieldLabel>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="যেমন জন্মদিন" />
            </div>
          </div>
          <div className="space-y-1">
            <FieldLabel>তারিখ লেবেল</FieldLabel>
            <Input value={dateLabel} onChange={(e) => setDateLabel(e.target.value)} placeholder="যেমন: ১১ ডিসেম্বর / আপনার জন্মদিন" />
          </div>
          <div className="space-y-1">
            <FieldLabel>বর্ণনা (ঐচ্ছিক)</FieldLabel>
            <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="কাস্টমার বিল পেজে যা দেখবে…" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <FieldLabel>ছাড় (৳) *</FieldLabel>
              <Input inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="50" />
            </div>
            <div className="space-y-1">
              <FieldLabel>ন্যূনতম বিল (৳) *</FieldLabel>
              <Input inputMode="decimal" value={minBill} onChange={(e) => setMinBill(e.target.value)} placeholder="500" />
            </div>
          </div>

          {/* messenger verification */}
          <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50/60 p-3">
            <div>
              <FieldLabel>মেসেঞ্জারে কী তথ্য চাইবেন?</FieldLabel>
              <p className="mb-2 text-[11px] leading-snug text-stone-500">
                কাস্টমার "Claim on Messenger" চাপলে বট এই তথ্যটি চাইবে — সঠিক তথ্য পাঠালেই ছাড় বিলে যোগ হবে (অটো-যাচাই)। ভুল/মিথ্যা তথ্য দিলে ছাড় পাবে না।
              </p>
              <Textarea
                rows={2}
                value={askText}
                onChange={(e) => setAskText(e.target.value)}
                placeholder={
                  fieldType === 'DATE'
                    ? 'যেমন: জন্মদিনের তারিখ লিখুন'
                    : fieldType === 'PHONE'
                      ? 'যেমন: আপনার ফোন নম্বর পাঠান'
                      : 'যেমন: আপনার নাম ও ঠিকানা লিখুন'
                }
              />
              <p className="mt-1 text-[10px] text-stone-400">ফাঁকা রাখলে টাইপ অনুযায়ী ডিফল্ট প্রশ্ন যাবে।</p>
            </div>
            <div className="space-y-1">
              <FieldLabel>তথ্যের ধরন</FieldLabel>
              <Select value={fieldType} onValueChange={setFieldType}>
                <SelectTrigger className="bg-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="DATE">📅 তারিখ — সঠিক তারিখ না দিলে ছাড় হবে না</SelectItem>
                  <SelectItem value="PHONE">📱 ফোন নম্বর — নম্বর না দিলে ছাড় হবে না</SelectItem>
                  <SelectItem value="TEXT">📝 সাধারণ তথ্য — যেকোনো লেখা গ্রহণ করা হবে</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-stone-200 p-3">
            <Label className="text-sm font-bold text-stone-700">সক্রিয়?</Label>
            <Switch checked={active} onCheckedChange={setActive} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            বাতিল
          </Button>
          <Button onClick={save} disabled={saving} className="bg-amber-500 font-black text-white hover:bg-amber-600">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} সেভ করুন
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function OccasionsTab({ onAuthRequired }: TabProps) {
  const [occasions, setOccasions] = useState<OccasionRow[] | null>(null)
  const [err, setErr] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<OccasionRow | null>(null)

  const load = useCallback(async () => {
    const res = await api.get<{ occasions: OccasionRow[] }>('/api/admin/occasions')
    if (isAuthError(res)) return onAuthRequired()
    if (!res.ok || !res.data) {
      setErr(res.error || 'অকেশন আনা যায়নি')
      return
    }
    setErr('')
    setOccasions(res.data.occasions)
  }, [onAuthRequired])

  useEffect(() => {
    const t = setTimeout(load, 0)
    return () => clearTimeout(t)
  }, [load])

  const toggleActive = async (o: OccasionRow, on: boolean) => {
    setOccasions((prev) => (prev ? prev.map((x) => (x.id === o.id ? { ...x, active: on } : x)) : prev))
    const res = await api.patch(`/api/admin/occasions/${o.id}`, { active: on })
    if (!res.ok) {
      toast.error(res.error || 'আপডেট ব্যর্থ')
      load()
    }
  }

  const deleteOccasion = async (o: OccasionRow) => {
    const res = await api.del(`/api/admin/occasions/${o.id}`)
    if (!res.ok) {
      toast.error(res.error || 'ডিলিট ব্যর্থ')
      return
    }
    toast.success('অকেশন ডিলিট হয়েছে')
    load()
  }

  if (err) return <LoadError msg={err} onRetry={load} />
  if (!occasions) return <Loading />

  return (
    <div className="space-y-4">
      {/* info banner */}
      <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
        <p className="font-bold">
          যত খুশি অফার যোগ/ডিলিট করুন — যেকোনো বিষয়ের অফার দেওয়া যায়। সক্রিয় অফারগুলো বিল পেজে দেখা যাবে। “মেসেঞ্জার অফার” চালু থাকলে বট প্রতিটি অফারের নির্ধারিত তথ্য মেসেঞ্জারে চেয়ে যাচাই করবে; বন্ধ থাকলে বিল পেজেই সরাসরি ছাড় যোগ হবে। এক বিলে একটি অফারই ব্যবহার করা যায়।
        </p>
      </div>

      <div className="flex items-center justify-between">
        <h3 className="text-sm font-black uppercase tracking-wide text-stone-500">অকেশন অফার তালিকা</h3>
        <Button
          size="sm"
          onClick={() => {
            setEditing(null)
            setDialogOpen(true)
          }}
          className="bg-amber-500 font-black text-white hover:bg-amber-600"
        >
          <Plus className="h-4 w-4" /> নতুন অকেশন
        </Button>
      </div>

      {occasions.length === 0 && (
        <p className="py-10 text-center text-sm text-stone-400">কোনো অকেশন অফার নেই — উপরে থেকে যোগ করুন</p>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {occasions.map((o) => (
          <Card key={o.id} className="border-stone-200">
            <CardContent className="space-y-2.5 p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 font-black text-stone-900">
                    <span className="text-xl">{o.emoji || '🎉'}</span>
                    {o.name}
                  </p>
                  {o.dateLabel && <p className="mt-0.5 text-xs font-bold text-stone-500">📅 {o.dateLabel}</p>}
                  {o.description && <p className="mt-1 line-clamp-2 text-xs text-stone-500">{o.description}</p>}
                  <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] text-stone-500">
                    <Badge variant="outline" className="border-amber-200 bg-amber-50 text-[10px] text-amber-700">
                      🤖 যাচাই: {FIELD_TYPE_BN[o.fieldType] || o.fieldType}
                    </Badge>
                    {o.askText && <span className="line-clamp-1 max-w-[220px] text-stone-400">“{o.askText}”</span>}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <Badge className="bg-pink-600 hover:bg-pink-600">ছাড় {bnTaka(o.discount)}</Badge>
                  <p className="mt-1 text-[10px] font-bold text-stone-400">বিল ≥ {bnTaka(o.minBill)}</p>
                </div>
              </div>
              <div className="flex items-center justify-between border-t border-dashed border-stone-200 pt-2.5">
                <div className="flex items-center gap-2">
                  <Switch checked={o.active} onCheckedChange={(v) => toggleActive(o, v)} />
                  <span className={`text-xs font-black ${o.active ? 'text-emerald-700' : 'text-stone-400'}`}>
                    {o.active ? 'সক্রিয়' : 'বন্ধ'}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-stone-500 hover:text-amber-600"
                    onClick={() => {
                      setEditing(o)
                      setDialogOpen(true)
                    }}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <ConfirmAction
                    title={`"${o.name}" ডিলিট?`}
                    description="অকেশন অফারটি স্থায়ীভাবে মুছে যাবে।"
                    confirmLabel="ডিলিট"
                    onConfirm={() => deleteOccasion(o)}
                  >
                    <Button size="sm" variant="ghost" className="text-red-500 hover:bg-red-50">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </ConfirmAction>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <OccasionDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
        nextSort={occasions.length}
        onSaved={load}
      />
    </div>
  )
}

// ============================================================
// TAB: 👥 কাস্টমার (CRM — messenger customers, collected data,
// upcoming events + send offers via Messenger)
// perm: 'tables' (same as receipts)
// ============================================================
interface CustomerRow {
  id: string
  psid: string
  messenger: boolean
  firstName: string
  lastName: string | null
  phone: string | null
  birthday: string | null
  eventLabel: string | null
  dataText: string | null
  discountClaimed: boolean
  claims: number
  lastClaimAt: string | null
  lastSeenAt: string | null
  createdAt: string
  daysUntilEvent: number | null
}

function CustomersTab({ onAuthRequired }: TabProps) {
  const [data, setData] = useState<{ customers: CustomerRow[]; upcoming: CustomerRow[] } | null>(null)
  const [err, setErr] = useState('')
  const [editing, setEditing] = useState<CustomerRow | null>(null)
  const [msgTarget, setMsgTarget] = useState<CustomerRow | null>(null)

  const load = useCallback(async () => {
    const res = await api.get<{ customers: CustomerRow[]; upcoming: CustomerRow[] }>('/api/admin/customers')
    if (isAuthError(res)) return onAuthRequired()
    if (!res.ok || !res.data) {
      setErr(res.error || 'কাস্টমার আনা যায়নি')
      return
    }
    setErr('')
    setData(res.data)
  }, [onAuthRequired])

  useEffect(() => {
    const t = setTimeout(load, 0)
    return () => clearTimeout(t)
  }, [load])

  if (err) return <LoadError msg={err} onRetry={load} />
  if (!data) return <Loading />

  const customers = data.customers

  return (
    <div className="space-y-4">
      {/* info banner */}
      <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
        <p className="font-bold">
          মেসেঞ্জারে অফার দাবি করা প্রতিটি কাস্টমারের নাম (Facebook থেকে), ফোন, ইভেন্টের তারিখ ও যাচাইয়ের তথ্য এখানে জমা থাকে। আসন্ন ইভেন্ট থেকে সরাসরি মেসেঞ্জারে অফার পাঠাতে পারবেন।
        </p>
      </div>

      {/* upcoming events */}
      <Card className="border-pink-200">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Cake className="h-5 w-5 text-pink-600" /> আসন্ন ইভেন্ট (আগামী {toBn('30')} দিন)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.upcoming.length === 0 ? (
            <p className="py-4 text-center text-sm text-stone-400">
              আসন্ন কোনো ইভেন্ট নেই — কাস্টমারের ইভেন্টের তারিখ দিলে এখানে দেখা যাবে
            </p>
          ) : (
            <div className="thin-scroll max-h-72 space-y-2 overflow-y-auto pr-1">
              {data.upcoming.map((c) => (
                <div key={c.id} className="flex items-center gap-3 rounded-lg border border-stone-200 bg-white p-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-pink-100 text-lg">
                    {c.daysUntilEvent === 0 ? '🎂' : '🎉'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-black text-stone-900">
                      {c.firstName} {c.lastName || ''}
                    </p>
                    <p className="truncate text-[11px] font-semibold text-stone-500">
                      {c.eventLabel || 'জন্মদিন'} • {bnDateOnly(c.birthday)}
                      {c.phone ? ` • 📱 ${c.phone}` : ''}
                    </p>
                  </div>
                  <Badge
                    className={
                      c.daysUntilEvent === 0
                        ? 'bg-pink-600 hover:bg-pink-600'
                        : 'border-pink-200 bg-pink-50 text-pink-700 hover:bg-pink-50'
                    }
                  >
                    {c.daysUntilEvent === 0 ? 'আজ!' : `${toBn(String(c.daysUntilEvent))} দিন বাকি`}
                  </Badge>
                  {c.messenger && (
                    <Button
                      size="sm"
                      onClick={() => setMsgTarget(c)}
                      className="bg-amber-500 font-black text-white hover:bg-amber-600"
                    >
                      📩 অফার পাঠান
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* all customers */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-black uppercase tracking-wide text-stone-500">
          সব কাস্টমার ({toBn(String(customers.length))})
        </h3>
        <Button size="sm" variant="outline" onClick={load} className="border-stone-300 font-bold">
          <RefreshCw className="h-4 w-4" /> রিফ্রেশ
        </Button>
      </div>

      {customers.length === 0 ? (
        <p className="py-10 text-center text-sm text-stone-400">
          এখনো কোনো কাস্টমার নেই — কেউ অফার দাবি করলে বা মেসেঞ্জারে চ্যাট করলে এখানে তালিকা ভরবে
        </p>
      ) : (
        <div className="thin-scroll max-h-[60vh] space-y-2 overflow-y-auto rounded-xl border border-stone-200 bg-white p-3">
          {customers.map((c) => (
            <div key={c.id} className="rounded-lg border border-stone-100 bg-stone-50/60 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-amber-100 font-black text-amber-700">
                  {(c.firstName || '?').slice(0, 1).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-black text-stone-900">
                    {c.firstName} {c.lastName || ''}
                  </p>
                  <p className="truncate text-[11px] text-stone-500">
                    {c.eventLabel ? `${c.eventLabel}: ${bnDateOnly(c.birthday)}` : bnDateOnly(c.birthday)}
                    {c.phone ? ` • 📱 ${c.phone}` : ''}
                    {` • 🎁 ${toBn(String(c.claims))}টি ছাড়`}
                  </p>
                </div>
                <Badge
                  variant="outline"
                  className={
                    c.messenger
                      ? 'border-emerald-200 bg-emerald-50 text-[10px] text-emerald-700'
                      : 'border-stone-200 bg-stone-100 text-[10px] text-stone-500'
                  }
                >
                  {c.messenger ? '💬 মেসেঞ্জার' : 'বিল পেজ'}
                </Badge>
                {c.messenger && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-amber-600 hover:bg-amber-50"
                    onClick={() => setMsgTarget(c)}
                    title="মেসেজ পাঠান"
                  >
                    📩
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-stone-500 hover:text-amber-600"
                  onClick={() => setEditing(c)}
                  title="তথ্য এডিট"
                >
                  <Pencil className="h-4 w-4" />
                </Button>
              </div>
              {c.dataText && (
                <p className="mt-2 truncate rounded bg-white px-2 py-1.5 text-[11px] text-stone-600">
                  📝 যাচাইয়ের তথ্য: <span className="font-semibold">{c.dataText}</span>
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* edit dialog — key remounts it so the fields fill from the edited row */}
      <EditCustomerDialog key={editing?.id || 'none'} customer={editing} onOpenChange={() => setEditing(null)} onSaved={load} />

      {/* send message dialog */}
      <SendMessageDialog key={msgTarget?.id || 'none'} customer={msgTarget} onOpenChange={() => setMsgTarget(null)} />
    </div>
  )
}

/** edit event label / phone / event date of a CRM customer */
function EditCustomerDialog({
  customer,
  onOpenChange,
  onSaved,
}: {
  customer: CustomerRow | null
  onOpenChange: () => void
  onSaved: () => void
}) {
  const [eventLabel, setEventLabel] = useState(customer?.eventLabel ?? '')
  const [phone, setPhone] = useState(customer?.phone ?? '')
  const [birthday, setBirthday] = useState(customer?.birthday ? customer.birthday.slice(0, 10) : '')
  const [saving, setSaving] = useState(false)

  const save = async () => {
    if (!customer) return
    setSaving(true)
    const res = await api.patch(`/api/admin/customers/${customer.id}`, {
      eventLabel,
      phone,
      birthday: birthday || null,
    })
    setSaving(false)
    if (isAuthError(res)) return onOpenChange()
    if (!res.ok) return toast.error(res.error || 'সেভ ব্যর্থ')
    toast.success('কাস্টমারের তথ্য আপডেট হয়েছে')
    onOpenChange()
    onSaved()
  }

  return (
    <Dialog open={!!customer} onOpenChange={(v) => !v && onOpenChange()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>কাস্টমারের তথ্য এডিট</DialogTitle>
          <DialogDescription>
            {customer ? `${customer.firstName} ${customer.lastName || ''}` : ''}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <FieldLabel>ইভেন্টের নাম</FieldLabel>
            <Input value={eventLabel} onChange={(e) => setEventLabel(e.target.value)} placeholder="জন্মদিন / বিয়ের বার্ষিকী / অন্য কিছু" />
          </div>
          <div className="space-y-1">
            <FieldLabel>ইভেন্টের তারিখ</FieldLabel>
            <Input type="date" value={birthday} onChange={(e) => setBirthday(e.target.value)} />
            <p className="text-[10px] text-stone-400">তারিখ দিলে কাস্টমারটি “আসন্ন ইভেন্ট” তালিকায় দেখা যাবে।</p>
          </div>
          <div className="space-y-1">
            <FieldLabel>ফোন নম্বর</FieldLabel>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="017…" inputMode="tel" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onOpenChange}>
            বাতিল
          </Button>
          <Button onClick={save} disabled={saving} className="bg-amber-500 font-black text-white hover:bg-amber-600">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} সেভ করুন
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** admin → customer Messenger send box */
function SendMessageDialog({
  customer,
  onOpenChange,
}: {
  customer: CustomerRow | null
  onOpenChange: () => void
}) {
  const [text, setText] = useState(
    customer
      ? `🎉 শুভেচ্ছা ${customer.firstName}!\n\nআপনার জন্য বিশেষ অফার — আগামী ভিজিটে বিলে বিশেষ ছাড়!\nরেস্তোরাঁয় আসার আগে এই মেসেজটি দেখান বা বিল পেজ থেকে অফারটি দাবি করুন। 🙏`
      : ''
  )
  const [sending, setSending] = useState(false)

  const send = async () => {
    if (!customer) return
    if (!text.trim()) return toast.error('মেসেজ লিখুন')
    setSending(true)
    const res = await api.post(`/api/admin/customers/${customer.id}/message`, { text })
    setSending(false)
    if (isAuthError(res)) return onOpenChange()
    if (!res.ok) return toast.error(res.error || 'পাঠানো যায়নি')
    toast.success('✅ মেসেঞ্জারে পাঠানো হয়েছে!')
    onOpenChange()
  }

  return (
    <Dialog open={!!customer} onOpenChange={(v) => !v && onOpenChange()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>📩 মেসেঞ্জারে পাঠান</DialogTitle>
          <DialogDescription>
            {customer ? `${customer.firstName} ${customer.lastName || ''} — কাস্টমার এই পেজের মেসেঞ্জারে চ্যাট করেছেন, তাই সরাসরি মেসেজ যাবে।` : ''}
          </DialogDescription>
        </DialogHeader>
        <Textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder="মেসেজ লিখুন…" />
        <DialogFooter>
          <Button variant="outline" onClick={onOpenChange}>
            বাতিল
          </Button>
          <Button onClick={send} disabled={sending} className="bg-amber-500 font-black text-white hover:bg-amber-600">
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} পাঠান
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ============================================================
// TAB: 🧾 রসিদ হিস্ট্রি (paid receipts / transaction history)
// perm: 'tables'
// ============================================================
interface ReceiptLine {
  name: string
  quantity?: number // legacy rows (bills/pay)
  qty?: number // newer rows (bills/pay)
  returnedQty?: number // bill-time return count
  unitPrice: number
  lineTotal: number
  spiceLevel: string | null
  addons: { name: string; price: number }[] | string | null // legacy rows store a JSON string
  specialNote: string | null
}

const lineQty = (it: ReceiptLine) => Number(it.quantity ?? it.qty ?? 0)

/** receipts itemsJson may hold addons as a JSON string OR array — normalize */
function receiptAddons(addons: ReceiptLine['addons']): { name: string; price: number }[] {
  if (Array.isArray(addons)) return addons
  return parseJsonSafe<{ name: string; price: number }[]>(addons, [])
}

interface ReceiptOrder {
  orderNo: number
  placedAt?: string
  voucherCode: string | null
  voucherDiscount: number
  voucherVoided?: boolean
  returnedAmount?: number
  happyHourDiscount?: number
  birthdayDiscount: number
  items: ReceiptLine[]
  subtotal?: number
  total?: number
}

interface ReceiptRow {
  id: string
  receiptNo: number
  tableNumber: number
  ordersCount: number
  subtotal: number
  discountTotal: number
  total: number
  paymentMethod: string
  paidAt: string
  items: ReceiptOrder[]
}

interface ReceiptsData {
  receipts: ReceiptRow[]
  summary: { count: number; total: number; discounts: number }
  period: string
}

const RECEIPT_PERIODS: { id: string; label: string }[] = [
  { id: 'today', label: 'আজ' },
  { id: 'yesterday', label: 'গতকাল' },
  { id: 'weekly', label: 'এই সপ্তাহ' },
  { id: 'monthly', label: 'এই মাস' },
  { id: 'yearly', label: 'এই বছর' },
  { id: 'all', label: 'সব' },
]

const PAY_METHOD_BN: Record<string, string> = {
  CASH: '💵 ক্যাশ',
  CARD: '💳 কার্ড',
  BKASH: '📱 বিকাশ',
  NAGAD: '📱 নগদ',
  ONLINE: '🌐 অনলাইন',
}

function ReceiptsTab({ onAuthRequired }: TabProps) {
  const [data, setData] = useState<ReceiptsData | null>(null)
  const [err, setErr] = useState('')
  const [period, setPeriod] = useState('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  // edit / delete transaction history
  const [editTarget, setEditTarget] = useState<ReceiptRow | null>(null)
  const [editMethod, setEditMethod] = useState('CASH')
  const [editPaidAt, setEditPaidAt] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const openEdit = (r: ReceiptRow) => {
    setEditTarget(r)
    setEditMethod(r.paymentMethod)
    setEditPaidAt(toLocalInputValue(r.paidAt))
  }

  const saveEdit = async () => {
    if (!editTarget) return
    setSavingEdit(true)
    const res = await api.put(`/api/admin/receipts/${editTarget.id}`, {
      paymentMethod: editMethod,
      paidAt: editPaidAt ? new Date(editPaidAt).toISOString() : undefined,
    })
    setSavingEdit(false)
    if (isAuthError(res)) return onAuthRequired()
    if (!res.ok) return toast.error(res.error || 'এডিট ব্যর্থ হয়েছে')
    toast.success('রসিদ আপডেট হয়েছে ✅')
    setEditTarget(null)
    load()
  }

  const doDelete = async (r: ReceiptRow) => {
    setDeletingId(r.id)
    const res = await api.del(`/api/admin/receipts/${r.id}`)
    setDeletingId(null)
    if (isAuthError(res)) return onAuthRequired()
    if (!res.ok) return toast.error(res.error || 'ডিলিট ব্যর্থ হয়েছে')
    toast.success(`রসিদ #${r.receiptNo} পুরো লেনদেন মুছে ফেলা হয়েছে`)
    load()
  }

  const load = useCallback(async () => {
    setLoading(true)
    const qs =
      period === 'custom'
        ? `?period=custom&from=${from}&to=${to}`
        : `?period=${period}`
    const res = await api.get<ReceiptsData>(`/api/admin/receipts${qs}`)
    setLoading(false)
    if (isAuthError(res)) return onAuthRequired()
    if (!res.ok || !res.data) {
      setErr(res.error || 'রসিদ আনা যায়নি')
      return
    }
    setErr('')
    setData(res.data)
  }, [onAuthRequired, period, from, to])

  useEffect(() => {
    const t = setTimeout(load, 0)
    return () => clearTimeout(t)
  }, [load])

  const applyCustom = () => {
    if (!from || !to) return toast.error('শুরু ও শেষ দুটো তারিখই দিন')
    if (to < from) return toast.error('শেষ তারিখ শুরুর আগে হতে পারে না')
    setPeriod('custom')
  }

  if (err) return <LoadError msg={err} onRetry={load} />
  if (!data) return <Loading />

  return (
    <div className="space-y-4">
      {/* period filter bar */}
      <Card className="border-stone-200">
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            {RECEIPT_PERIODS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPeriod(p.id)}
                className={`rounded-full border px-3.5 py-1.5 text-xs font-black transition ${
                  period === p.id
                    ? 'border-amber-500 bg-amber-500 text-white'
                    : 'border-stone-300 bg-white text-stone-500 hover:border-amber-400'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <FieldLabel>কাস্টম: শুরু</FieldLabel>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40 border-stone-200" />
            </div>
            <div className="space-y-1">
              <FieldLabel>শেষ</FieldLabel>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40 border-stone-200" />
            </div>
            <Button
              size="sm"
              onClick={applyCustom}
              className="bg-amber-500 font-black text-white hover:bg-amber-600"
            >
              ফিল্টার
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* summary cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card className="border-stone-200">
          <CardContent className="p-4">
            <p className="text-xs font-bold text-stone-500">🧾 মোট রসিদ</p>
            <p className="text-2xl font-black text-stone-900">{toBn(String(data.summary.count))}</p>
          </CardContent>
        </Card>
        <Card className="border-stone-200">
          <CardContent className="p-4">
            <p className="text-xs font-bold text-stone-500">💰 মোট আদায়</p>
            <p className="text-2xl font-black text-emerald-700">{bnTaka(data.summary.total)}</p>
          </CardContent>
        </Card>
        <Card className="border-stone-200">
          <CardContent className="p-4">
            <p className="text-xs font-bold text-stone-500">🎟️ মোট ছাড়</p>
            <p className="text-2xl font-black text-orange-700">{bnTaka(data.summary.discounts)}</p>
          </CardContent>
        </Card>
      </div>

      {/* receipts list */}
      {data.receipts.length === 0 ? (
        <p className="py-10 text-center text-sm text-stone-400">এই সময়ে কোনো রসিদ নেই</p>
      ) : (
        <div className="thin-scroll max-h-[62vh] space-y-2 overflow-y-auto pr-1">
          {data.receipts.map((r) => {
            const open = expandedId === r.id
            return (
              <div key={r.id} className="rounded-xl border border-stone-200 bg-white shadow-sm">
                <button
                  type="button"
                  onClick={() => setExpandedId(open ? null : r.id)}
                  className="flex w-full flex-wrap items-center gap-2 p-3 text-left hover:bg-stone-50"
                >
                  <Badge className="bg-stone-900 font-mono text-amber-300 hover:bg-stone-900">
                    #{toBn(String(r.receiptNo))}
                  </Badge>
                  <Badge variant="outline" className="border-stone-300 text-xs text-stone-600">
                    টেবিল {toBn(r.tableNumber)}
                  </Badge>
                  <Badge variant="outline" className="border-stone-300 text-xs text-stone-600">
                    {PAY_METHOD_BN[r.paymentMethod] || r.paymentMethod}
                  </Badge>
                  <span className="text-xs text-stone-400">{bnDateTime(r.paidAt)}</span>
                  <span className="ml-auto flex items-center gap-2">
                    <span className="text-[11px] font-bold text-stone-400">{toBn(r.ordersCount)} অর্ডার</span>
                    <span className="text-lg font-black text-emerald-700">{bnTaka(r.total)}</span>
                  </span>
                </button>

                {open && (
                  <div className="space-y-3 border-t border-stone-100 p-3">
                    {r.discountTotal > 0 && (
                      <p className="rounded-lg bg-orange-50 px-3 py-1.5 text-xs font-bold text-orange-700">
                        সাবটোটাল {bnTaka(r.subtotal)} − ছাড় {bnTaka(r.discountTotal)} = মোট {bnTaka(r.total)}
                      </p>
                    )}
                    {r.items.map((ord) => (
                      <div key={ord.orderNo} className="rounded-lg border border-stone-100 bg-stone-50/60 p-3">
                        <p className="mb-2 text-xs font-black text-stone-700">
                          অর্ডার #{toBn(String(ord.orderNo))}
                          {ord.voucherCode && (
                            <Badge
                              className={cn(
                                'ml-2 text-[10px] hover:bg-amber-100',
                                (ord.voucherVoided ?? false) || ord.voucherDiscount === 0
                                  ? 'bg-red-100 text-red-700 line-through hover:bg-red-100'
                                  : 'bg-amber-100 text-amber-800'
                              )}
                            >
                              🎟️ {ord.voucherCode}{(ord.voucherVoided ?? false) ? ' (বাতিল)' : ''}
                            </Badge>
                          )}
                        </p>
                        <div className="space-y-1.5">
                          {ord.items.map((it, idx) => (
                            <div key={idx} className="rounded-md bg-white p-2 text-xs">
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-bold text-stone-800">
                                  <span className="text-amber-600">{toBn(lineQty(it))}×</span> {it.name}
                                  {(it.returnedQty ?? 0) > 0 && (
                                    <span className="ml-1.5 rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-black text-red-600">
                                      ↩ {toBn(String(it.returnedQty))}টি রিটার্ন
                                    </span>
                                  )}
                                </span>
                                <span className="font-extrabold text-stone-700">{bnTaka(it.lineTotal)}</span>
                              </div>
                              <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-stone-500">
                                <span>{bnTaka(it.unitPrice)} × {toBn(lineQty(it))}</span>
                                {it.spiceLevel && <span>• 🌶️ {it.spiceLevel}</span>}
                                {receiptAddons(it.addons).map((a, ai) => (
                                  <span key={ai} className="rounded-full bg-stone-100 px-1.5">
                                    + {a.name} ({bnTaka(a.price)})
                                  </span>
                                ))}
                              </div>
                              {it.specialNote && (
                                <p className="mt-1 rounded bg-amber-50 px-2 py-1 text-[10px] italic text-amber-800">
                                  📌 {it.specialNote}
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                        <div className="mt-2 flex flex-wrap items-center justify-end gap-2 text-[10px] font-bold text-stone-500">
                          {typeof ord.happyHourDiscount === 'number' && ord.happyHourDiscount > 0 && (
                            <span>🔥 হ্যাপি আওয়ার −{bnTaka(ord.happyHourDiscount)}</span>
                          )}
                          {ord.voucherDiscount > 0 && <span>🎟️ ভাউচার −{bnTaka(ord.voucherDiscount)}</span>}
                          {(ord.voucherVoided ?? false) && (
                            <span className="text-red-600">🎟️ কুপন ছাড় রিটার্নের কারণে বাতিল</span>
                          )}
                          {(ord.returnedAmount ?? 0) > 0 && (
                            <span className="text-red-600">↩ রিটার্ন −{bnTaka(ord.returnedAmount ?? 0)}</span>
                          )}
                          {ord.birthdayDiscount > 0 && <span>🎂 জন্মদিন −{bnTaka(ord.birthdayDiscount)}</span>}
                          {typeof ord.total === 'number' && (
                            <span className="text-sm font-black text-amber-700">অর্ডার মোট {bnTaka(ord.total)}</span>
                          )}
                        </div>
                      </div>
                    ))}
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openEdit(r)}
                        className="border-stone-300 font-black text-stone-700 hover:bg-stone-100"
                      >
                        ✏️ এডিট
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={deletingId === r.id}
                            className="border-red-200 font-black text-red-600 hover:bg-red-50"
                          >
                            {deletingId === r.id ? 'মুছছে…' : '🗑️ ডিলিট'}
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>রসিদ #{toBn(String(r.receiptNo))} ডিলিট করবেন?</AlertDialogTitle>
                            <AlertDialogDescription>
                              এই লেনদেনের {bnTaka(r.total)}, সব অর্ডার ও আইটেম — হিস্ট্রি, ওভারভিউ ও অ্যানালিটিক্সসহ পুরো সিস্টেম থেকে মুছে যাবে। এটা আর ফেরানো যাবে না!
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>বাতিল</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => doDelete(r)}
                              className="bg-red-600 font-black text-white hover:bg-red-700"
                            >
                              হ্যাঁ, ডিলিট করুন
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => window.open(`/receipt/${r.id}`, '_blank')}
                        className="border-amber-300 font-black text-amber-700 hover:bg-amber-50"
                      >
                        🖨️ প্রিন্ট / PDF
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {loading && <p className="text-center text-xs text-stone-400">লোড হচ্ছে…</p>}

      {/* edit transaction dialog */}
      <Dialog open={!!editTarget} onOpenChange={(o) => !o && setEditTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>রসিদ #{editTarget ? toBn(String(editTarget.receiptNo)) : ''} এডিট</DialogTitle>
            <DialogDescription>
              পেমেন্ট মেথড ও সময় ঠিক করুন — এই রসিদের সব অর্ডারেও একসাথে আপডেট হবে।
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>পেমেন্ট মেথড</Label>
              <Select value={editMethod} onValueChange={setEditMethod}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(PAY_METHOD_BN).map(([k, v]) => (
                    <SelectItem key={k} value={k}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>পরিশোধের সময়</Label>
              <Input type="datetime-local" value={editPaidAt} onChange={(e) => setEditPaidAt(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)}>
              বাতিল
            </Button>
            <Button
              onClick={saveEdit}
              disabled={savingEdit}
              className="bg-amber-500 font-black text-white hover:bg-amber-600"
            >
              {savingEdit ? 'সেভ হচ্ছে…' : 'সেভ করুন'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ============================================================
// TAB 6: ImgBB কি
// ============================================================
function ImgbbTab({ onAuthRequired }: TabProps) {
  const [keys, setKeys] = useState<ImgbbKeyRow[] | null>(null)
  const [err, setErr] = useState('')
  const [newKey, setNewKey] = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [adding, setAdding] = useState(false)

  const load = useCallback(async () => {
    const res = await api.get<{ keys: ImgbbKeyRow[] }>('/api/admin/imgbb-keys')
    if (isAuthError(res)) return onAuthRequired()
    if (!res.ok || !res.data) {
      setErr(res.error || 'কি আনা যায়নি')
      return
    }
    setErr('')
    setKeys(res.data.keys)
  }, [onAuthRequired])

  useEffect(() => {
    const t = setTimeout(load, 0)
    return () => clearTimeout(t)
  }, [load])

  const addKey = async () => {
    if (!newKey.trim()) return toast.error('API Key দিন')
    setAdding(true)
    const res = await api.post('/api/admin/imgbb-keys', { key: newKey.trim(), label: newLabel.trim() || null })
    setAdding(false)
    if (!res.ok) return toast.error(res.error || 'যোগ করা যায়নি')
    toast.success('ImgBB কি যোগ হয়েছে')
    setNewKey('')
    setNewLabel('')
    load()
  }

  const toggleActive = async (k: ImgbbKeyRow, on: boolean) => {
    setKeys((prev) => (prev ? prev.map((x) => (x.id === k.id ? { ...x, active: on } : x)) : prev))
    const res = await api.patch(`/api/admin/imgbb-keys/${k.id}`, { active: on })
    if (!res.ok) {
      toast.error(res.error || 'আপডেট ব্যর্থ')
      load()
    }
  }

  const deleteKey = async (k: ImgbbKeyRow) => {
    const res = await api.del(`/api/admin/imgbb-keys/${k.id}`)
    if (!res.ok) {
      toast.error(res.error || 'ডিলিট ব্যর্থ')
      return
    }
    toast.success('কি ডিলিট হয়েছে')
    load()
  }

  if (err) return <LoadError msg={err} onRetry={load} />
  if (!keys) return <Loading />

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 rounded-xl border border-teal-200 bg-teal-50 p-3 text-sm text-teal-900">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-teal-600" />
        <p className="font-bold">
          আপলোডের সময় সবচেয়ে কম ব্যবহৃত সক্রিয় কি বেছে নেওয়া হয়; ব্যর্থ হলে স্বয়ংক্রিয়ভাবে পরের কি দিয়ে চেষ্টা হয় (Auto-Failover)
        </p>
      </div>

      <Card className="border-stone-200">
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <div className="min-w-48 flex-1 space-y-1">
            <FieldLabel>ImgBB API Key</FieldLabel>
            <Input value={newKey} onChange={(e) => setNewKey(e.target.value)} placeholder="imgbb api key" className="font-mono" />
          </div>
          <div className="space-y-1">
            <FieldLabel>লেবেল</FieldLabel>
            <Input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="যেমন একাউন্ট-১" className="w-40" />
          </div>
          <Button onClick={addKey} disabled={adding} className="bg-amber-500 font-black text-white hover:bg-amber-600">
            {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />} যোগ করুন
          </Button>
        </CardContent>
      </Card>

      {keys.length === 0 ? (
        <p className="py-10 text-center text-sm text-stone-400">কোনো কি নেই — ছবি আপলোডের জন্য অন্তত একটি যোগ করুন</p>
      ) : (
        <div className="space-y-2">
          {keys.map((k) => (
            <Card key={k.id} className="border-stone-200">
              <CardContent className="flex flex-wrap items-center gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-sm font-bold text-stone-800">{k.key}</p>
                  <p className="text-xs text-stone-500">{k.label || 'লেবেল নেই'}</p>
                  {k.lastError && (
                    <p className="mt-1 max-w-md truncate rounded bg-red-50 px-2 py-1 text-xs text-red-600" title={k.lastError}>
                      ⚠️ {k.lastError.length > 90 ? `${k.lastError.slice(0, 90)}…` : k.lastError}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 text-xs font-bold">
                  <Badge variant="outline" className="border-emerald-300 text-emerald-700">
                    ✅ {toBn(k.usageCount)} আপলোড
                  </Badge>
                  <Badge variant="outline" className="border-red-300 text-red-600">
                    ❌ {toBn(k.failCount)} ব্যর্থ
                  </Badge>
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={k.active} onCheckedChange={(on) => toggleActive(k, on)} />
                  <span className={`text-xs font-black ${k.active ? 'text-emerald-700' : 'text-stone-400'}`}>
                    {k.active ? 'সক্রিয়' : 'বন্ধ'}
                  </span>
                </div>
                <ConfirmAction
                  title="কি ডিলিট?"
                  description={`${k.key} স্থায়ীভাবে মুছে যাবে।`}
                  confirmLabel="ডিলিট"
                  onConfirm={() => deleteKey(k)}
                >
                  <Button size="sm" variant="ghost" className="text-red-500 hover:bg-red-50">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </ConfirmAction>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

// ============================================================
// TAB 7: সেটিংস (incl. session duration, receipt, toggles, geofence)
// ============================================================

// ---------------- Leaflet (CDN) minimal typing + loader ----------------
interface LeafletLatLng {
  lat: number
  lng: number
}
interface LeafletMap {
  remove(): void
  invalidateSize(): void
  setView(center: [number, number], zoom?: number): void
  on(ev: string, fn: (e: { latlng: LeafletLatLng }) => void): void
}
interface LeafletMarker {
  addTo(m: LeafletMap): LeafletMarker
  remove(): void
  setLatLng(ll: [number, number]): void
  getLatLng(): LeafletLatLng
  on(ev: string, fn: () => void): void
}
interface LeafletCircle {
  addTo(m: LeafletMap): LeafletCircle
  remove(): void
  setLatLng(ll: [number, number]): void
  setRadius(r: number): void
}
interface LeafletNS {
  map(el: HTMLElement, opts?: Record<string, unknown>): LeafletMap
  marker(ll: [number, number], opts?: Record<string, unknown>): LeafletMarker
  circle(ll: [number, number], opts?: Record<string, unknown>): LeafletCircle
  tileLayer(url: string, opts?: Record<string, unknown>): { addTo(m: LeafletMap): void }
}

declare global {
  interface Window {
    L?: LeafletNS
  }
}

let leafletPromise: Promise<LeafletNS> | null = null

/** Load Leaflet 1.9.4 from CDN once (SSR-safe: browser only). */
function loadLeaflet(): Promise<LeafletNS> {
  if (typeof window === 'undefined') return Promise.reject(new Error('browser only'))
  if (window.L) return Promise.resolve(window.L)
  if (leafletPromise) return leafletPromise
  leafletPromise = new Promise<LeafletNS>((resolve, reject) => {
    try {
      if (!document.querySelector('link[data-leaflet]')) {
        const link = document.createElement('link')
        link.rel = 'stylesheet'
        link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
        link.setAttribute('data-leaflet', '1')
        document.head.appendChild(link)
      }
      const done = () => {
        if (window.L) resolve(window.L)
        else reject(new Error('Leaflet লোড হয়নি'))
      }
      const existing = document.querySelector('script[data-leaflet]') as HTMLScriptElement | null
      if (existing) {
        existing.addEventListener('load', done)
        existing.addEventListener('error', () => reject(new Error('Leaflet স্ক্রিপ্ট লোড ব্যর্থ')))
        return
      }
      const s = document.createElement('script')
      s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
      s.async = true
      s.setAttribute('data-leaflet', '1')
      s.onload = done
      s.onerror = () => reject(new Error('Leaflet স্ক্রিপ্ট লোড ব্যর্থ'))
      document.head.appendChild(s)
    } catch (e) {
      reject(e instanceof Error ? e : new Error('Leaflet লোড ব্যর্থ'))
    }
  })
  return leafletPromise
}

/** Interactive geofence map: draggable pin + click-to-move + radius circle. */
function GeoMap({
  lat,
  lng,
  radius,
  onPin,
}: {
  lat: number
  lng: number
  radius: number
  onPin: (lat: number, lng: number) => void
}) {
  const divRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<LeafletMap | null>(null)
  const markerRef = useRef<LeafletMarker | null>(null)
  const circleRef = useRef<LeafletCircle | null>(null)
  const onPinRef = useRef(onPin)
  const [err, setErr] = useState('')
  useEffect(() => {
    onPinRef.current = onPin
  }, [onPin])

  useEffect(() => {
    let cancelled = false
    loadLeaflet()
      .then((L) => {
        if (cancelled || !divRef.current || mapRef.current) return
        try {
          const m = L.map(divRef.current, { center: [lat, lng], zoom: 15 })
          L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '&copy; OpenStreetMap',
          }).addTo(m)
          const marker = L.marker([lat, lng], { draggable: true })
          marker.on('dragend', () => {
            const p = marker.getLatLng()
            onPinRef.current(p.lat, p.lng)
          })
          marker.addTo(m)
          const circle = L.circle([lat, lng], {
            radius,
            color: '#d97706',
            weight: 2,
            fillColor: '#f59e0b',
            fillOpacity: 0.15,
          })
          circle.addTo(m)
          m.on('click', (e) => {
            onPinRef.current(e.latlng.lat, e.latlng.lng)
          })
          mapRef.current = m
          markerRef.current = marker
          circleRef.current = circle
          // container may still be sizing → keep re-measuring
          setTimeout(() => m.invalidateSize(), 120)
          setTimeout(() => m.invalidateSize(), 450)
          setTimeout(() => m.invalidateSize(), 1000)
        } catch {
          setErr('ম্যাপ দেখানো যায়নি')
        }
      })
      .catch(() => setErr('ম্যাপ লাইব্রেরি লোড করা যায়নি (CDN) — ইন্টারনেট সংযোগ দেখুন'))
    return () => {
      cancelled = true
      try {
        mapRef.current?.remove()
      } catch {
        /* ignore */
      }
      mapRef.current = null
      markerRef.current = null
      circleRef.current = null
    }
  }, [])

  // sync pin + circle when lat/lng/radius change from outside (slider / geolocate)
  useEffect(() => {
    try {
      markerRef.current?.setLatLng([lat, lng])
      circleRef.current?.setLatLng([lat, lng])
      circleRef.current?.setRadius(radius)
    } catch {
      /* ignore */
    }
  }, [lat, lng, radius])

  return (
    <div className="relative">
      <div ref={divRef} className="z-0 h-72 w-full rounded-lg border border-stone-300" />
      {err && (
        <div className="absolute inset-0 z-[1] flex items-center justify-center rounded-lg border border-stone-200 bg-stone-100 text-sm font-bold text-stone-500">
          🗺️ {err}
        </div>
      )}
    </div>
  )
}

function SettingsTab({ onAuthRequired }: TabProps) {
  const [form, setForm] = useState<Record<string, string> | null>(null)
  const [meta, setMeta] = useState<SettingsMeta | null>(null)
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [runningCron, setRunningCron] = useState(false)
  const [testingMeta, setTestingMeta] = useState(false)
  const [metaTest, setMetaTest] = useState<MessengerTestResult | null>(null)
  const logoFileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    const res = await api.get<{ settings: Record<string, string>; meta: SettingsMeta }>('/api/admin/settings')
    if (isAuthError(res)) return onAuthRequired()
    if (!res.ok || !res.data) {
      setErr(res.error || 'সেটিংস আনা যায়নি')
      return
    }
    setErr('')
    setForm(res.data.settings)
    setMeta(res.data.meta)
  }, [onAuthRequired])

  useEffect(() => {
    const t = setTimeout(load, 0)
    return () => clearTimeout(t)
  }, [load])

  const set = (key: string, value: string) => setForm((prev) => (prev ? { ...prev, [key]: value } : prev))

  // geofence numbers derived from the string-keyed form
  const geoLat = parseFloat(form?.[SETTING_KEYS.GEO_LAT] ?? '') || 23.810332
  const geoLng = parseFloat(form?.[SETTING_KEYS.GEO_LNG] ?? '') || 90.412518
  const geoRadius = Math.min(5000, Math.max(20, parseInt(form?.[SETTING_KEYS.GEO_RADIUS_METERS] ?? '200', 10) || 200))
  // log-ish slider mapping 20→5000 m
  const radiusToSlider = (r: number) => Math.round((Math.log(r / 20) / Math.log(5000 / 20)) * 100)
  const sliderToRadius = (t: number) => Math.round(20 * Math.pow(5000 / 20, t / 100))

  // m.me link preview (client-side sanitize mirrors the referral API)
  const pageUserClean = (form?.[SETTING_KEYS.MESSENGER_PAGE_USERNAME] ?? '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^(www\.)?(m\.me|facebook\.com|fb\.com|fb\.me)\//i, '')
    .replace(/^@/, '')
    .replace(/[/?#].*$/, '')
    .trim()

  const pinGeo = (lat: number, lng: number) => {
    set(SETTING_KEYS.GEO_LAT, lat.toFixed(6))
    set(SETTING_KEYS.GEO_LNG, lng.toFixed(6))
  }

  const useMyLocation = () => {
    if (!navigator.geolocation) return toast.error('এই ব্রাউজারে জিওলোকেশন সাপোর্ট নেই')
    toast.info('আপনার লোকেশন নেওয়া হচ্ছে…')
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        pinGeo(pos.coords.latitude, pos.coords.longitude)
        toast.success('বর্তমান লোকেশন পিন করা হয়েছে — সেভ করতে ভুলবেন না')
      },
      () => toast.error('লোকেশন পাওয়া যায়নি — পারমিশন দিয়ে আবার চেষ্টা করুন'),
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }

  const save = async () => {
    if (!form) return
    setSaving(true)
    const res = await api.put<{ settings: Record<string, string> }>('/api/admin/settings', {
      [SETTING_KEYS.RESTAURANT_NAME]: form[SETTING_KEYS.RESTAURANT_NAME] ?? '',
      [SETTING_KEYS.RESTAURANT_LOGO_URL]: form[SETTING_KEYS.RESTAURANT_LOGO_URL] ?? '',
      [SETTING_KEYS.SESSION_DURATION_MINUTES]: form[SETTING_KEYS.SESSION_DURATION_MINUTES] ?? '90',
      [SETTING_KEYS.KITCHEN_DELAY_ALERT_MINUTES]: form[SETTING_KEYS.KITCHEN_DELAY_ALERT_MINUTES] ?? '15',
      [SETTING_KEYS.BIRTHDAY_DISCOUNT_AMOUNT]: form[SETTING_KEYS.BIRTHDAY_DISCOUNT_AMOUNT] ?? '50',
      [SETTING_KEYS.BIRTHDAY_MIN_BILL]: form[SETTING_KEYS.BIRTHDAY_MIN_BILL] ?? '500',
      [SETTING_KEYS.MESSENGER_PAGE_USERNAME]: form[SETTING_KEYS.MESSENGER_PAGE_USERNAME] ?? '',
      [SETTING_KEYS.BIRTHDAY_TIMEZONE]: form[SETTING_KEYS.BIRTHDAY_TIMEZONE] ?? 'Asia/Dhaka',
      [SETTING_KEYS.PUBLIC_BASE_URL]: form[SETTING_KEYS.PUBLIC_BASE_URL] ?? '',
      [SETTING_KEYS.STAFF_LINKS_ENABLED]: form[SETTING_KEYS.STAFF_LINKS_ENABLED] ?? 'true',
      [SETTING_KEYS.HOME_LINKS_ENABLED]: form[SETTING_KEYS.HOME_LINKS_ENABLED] ?? 'true',
      [SETTING_KEYS.CURRENCY]: form[SETTING_KEYS.CURRENCY] ?? '৳',
      [SETTING_KEYS.TITLE_SUFFIX]: form[SETTING_KEYS.TITLE_SUFFIX] ?? '',
      [SETTING_KEYS.RECEIPT_SUBTITLE]: form[SETTING_KEYS.RECEIPT_SUBTITLE] ?? '',
      [SETTING_KEYS.RECEIPT_THANKS]: form[SETTING_KEYS.RECEIPT_THANKS] ?? '',
      [SETTING_KEYS.RECEIPT_FOOTER_NOTE]: form[SETTING_KEYS.RECEIPT_FOOTER_NOTE] ?? '',
      [SETTING_KEYS.POWERED_BY]: form[SETTING_KEYS.POWERED_BY] ?? '',
      [SETTING_KEYS.DEVELOPER_NOTE_ENABLED]: form[SETTING_KEYS.DEVELOPER_NOTE_ENABLED] ?? 'true',
      [SETTING_KEYS.DEVELOPER_NOTE_TEXT]: form[SETTING_KEYS.DEVELOPER_NOTE_TEXT] ?? '',
      [SETTING_KEYS.DEVELOPER_NOTE_LINK]: form[SETTING_KEYS.DEVELOPER_NOTE_LINK] ?? '',
      [SETTING_KEYS.ITEM_SPECIAL_NOTE_ENABLED]: form[SETTING_KEYS.ITEM_SPECIAL_NOTE_ENABLED] ?? 'true',
      [SETTING_KEYS.MESSENGER_AUTO_REPLY_ENABLED]: form[SETTING_KEYS.MESSENGER_AUTO_REPLY_ENABLED] ?? 'true',
      [SETTING_KEYS.TERMS_LINK_ENABLED]: form[SETTING_KEYS.TERMS_LINK_ENABLED] ?? 'true',
      [SETTING_KEYS.PRIVACY_LINK_ENABLED]: form[SETTING_KEYS.PRIVACY_LINK_ENABLED] ?? 'true',
      [SETTING_KEYS.DATADEL_LINK_ENABLED]: form[SETTING_KEYS.DATADEL_LINK_ENABLED] ?? 'true',
      [SETTING_KEYS.GEO_FENCE_ENABLED]: form[SETTING_KEYS.GEO_FENCE_ENABLED] ?? 'false',
      [SETTING_KEYS.GEO_LAT]: form[SETTING_KEYS.GEO_LAT] ?? '',
      [SETTING_KEYS.GEO_LNG]: form[SETTING_KEYS.GEO_LNG] ?? '',
      [SETTING_KEYS.GEO_RADIUS_METERS]: form[SETTING_KEYS.GEO_RADIUS_METERS] ?? '200',
    })
    setSaving(false)
    if (!res.ok) return toast.error(res.error || 'সেভ ব্যর্থ')
    toast.success('সেটিংস সেভ হয়েছে!')
    if (res.data?.settings) setForm(res.data.settings)
  }

  const uploadLogo = async (file: File) => {
    setUploadingLogo(true)
    try {
      const url = await uploadImageFile(file)
      set(SETTING_KEYS.RESTAURANT_LOGO_URL, url)
      toast.success('লোগো আপলোড হয়েছে — সেভ করতে ভুলবেন না')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'আপলোড ব্যর্থ')
    } finally {
      setUploadingLogo(false)
    }
  }

  const runBirthdayJob = async () => {
    setRunningCron(true)
    const res = await api.post<{ skipped?: boolean; sent?: number; message: string }>('/api/admin/birthday-run')
    setRunningCron(false)
    if (!res.ok) return toast.error(res.error || 'জব চালানো যায়নি')
    if (res.data?.skipped) toast.warning(res.data.message)
    else toast.success(res.data?.message || 'জব সম্পন্ন')
  }

  const runMessengerTest = async () => {
    setTestingMeta(true)
    const res = await api.post<MessengerTestResult>('/api/admin/messenger-test')
    setTestingMeta(false)
    if (!res.ok || !res.data) return toast.error(res.error || 'টেস্ট চালানো যায়নি')
    setMetaTest(res.data)
    setMeta((prev) =>
      prev
        ? {
            ...prev,
            metaEnv: res.data!.env,
            lastWebhookAt: res.data!.lastWebhookAt,
            lastWebhookInfo: res.data!.lastWebhookInfo,
            lastVerifyAt: res.data!.lastVerifyAt,
          }
        : prev
    )
    if (res.data.tokenTest.ok) toast.success(`টোকেন ঠিক আছে — পেজ: ${res.data.tokenTest.pageName}`)
    else toast.error('টোকেন কাজ করছে না — নিচে বিস্তারিত দেখুন')
  }

  if (err) return <LoadError msg={err} onRetry={load} />
  if (!form || !meta) return <Loading />

  return (
    <div className="space-y-4">
      {/* ---- session duration: prominent ---- */}
      <Card className="border-2 border-amber-400 bg-gradient-to-br from-amber-50 to-white">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Clock className="h-5 w-5 text-amber-600" /> QR সেশনের মেয়াদ (মিনিট)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Input
            inputMode="numeric"
            value={form[SETTING_KEYS.SESSION_DURATION_MINUTES] ?? '90'}
            onChange={(e) => set(SETTING_KEYS.SESSION_DURATION_MINUTES, e.target.value)}
            className="max-w-40 text-lg font-black"
          />
          <p className="text-xs text-stone-600">{meta.sessionDurationHint}</p>
          <p className="rounded-lg bg-amber-100 px-3 py-2 text-xs font-bold text-amber-900">
            ⚠️ এই মেয়াদের পরে বা টেবিল ক্লিয়ার করলে পুরনো লিঙ্ক দিয়ে অর্ডার করা যাবে না (HTTP 403)
          </p>
        </CardContent>
      </Card>

      {/* ---- restaurant identity ---- */}
      <Card className="border-stone-200">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">🍽️ রেস্টুরেন্ট পরিচিতি</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <FieldLabel>রেস্টুরেন্টের নাম</FieldLabel>
            <Input
              value={form[SETTING_KEYS.RESTAURANT_NAME] ?? ''}
              onChange={(e) => set(SETTING_KEYS.RESTAURANT_NAME, e.target.value)}
              className="max-w-md"
            />
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="space-y-1 md:col-span-2">
              <FieldLabel>টাইটেল সাফিক্স</FieldLabel>
              <Input
                value={form[SETTING_KEYS.TITLE_SUFFIX] ?? ''}
                onChange={(e) => set(SETTING_KEYS.TITLE_SUFFIX, e.target.value)}
                placeholder="Smart Restaurant System"
              />
              <p className="text-[11px] text-stone-500">
                ব্রাউজার ট্যাবের নাম: &lt;রেস্টুরেন্টের নাম&gt; - &lt;সাফিক্স&gt;
              </p>
            </div>
            <div className="space-y-1">
              <FieldLabel>মুদ্রা প্রতীক</FieldLabel>
              <Input
                value={form[SETTING_KEYS.CURRENCY] ?? '৳'}
                onChange={(e) => set(SETTING_KEYS.CURRENCY, e.target.value)}
                className="max-w-24"
              />
            </div>
          </div>
          <div className="space-y-1">
            <FieldLabel>লোগো URL</FieldLabel>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={form[SETTING_KEYS.RESTAURANT_LOGO_URL] ?? ''}
                onChange={(e) => set(SETTING_KEYS.RESTAURANT_LOGO_URL, e.target.value)}
                placeholder="https://i.ibb.co/…"
                className="max-w-md flex-1"
              />
              <input
                ref={logoFileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) uploadLogo(f)
                  e.target.value = ''
                }}
              />
              <Button size="sm" variant="outline" disabled={uploadingLogo} onClick={() => logoFileRef.current?.click()} className="border-stone-300">
                {uploadingLogo ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />} আপলোড
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <FieldLabel>কিচেন ডিলে অ্যালার্ট (মিনিট)</FieldLabel>
              <Input
                inputMode="numeric"
                value={form[SETTING_KEYS.KITCHEN_DELAY_ALERT_MINUTES] ?? '15'}
                onChange={(e) => set(SETTING_KEYS.KITCHEN_DELAY_ALERT_MINUTES, e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <FieldLabel>টাইমজোন</FieldLabel>
              <Input
                value={form[SETTING_KEYS.BIRTHDAY_TIMEZONE] ?? 'Asia/Dhaka'}
                onChange={(e) => set(SETTING_KEYS.BIRTHDAY_TIMEZONE, e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1">
            <FieldLabel>পাবলিক সাইট URL (QR কোডে ব্যবহৃত — খালি রাখলে অটো-ডিটেক্ট)</FieldLabel>
            <Input
              value={form[SETTING_KEYS.PUBLIC_BASE_URL] ?? ''}
              onChange={(e) => set(SETTING_KEYS.PUBLIC_BASE_URL, e.target.value)}
              placeholder="https://your-shop.vercel.app — খালি = বর্তমান সাইটের ঠিকানা অটো"
              className="max-w-md"
            />
            <p className="text-[11px] text-stone-500">
              প্রিন্টের QR কোডে যে ঠিকানা এমবেড হবে। ডিফল্টে সিস্টেম নিজেই বর্তমান ডোমেইন ধরে নেয় (localhost/preview/Vercel — যেখানেই চলুক)।
            </p>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-stone-200 bg-stone-50 p-3">
            <div className="min-w-0 pr-3">
              <p className="text-sm font-black text-stone-800">🏠 মেইন পেজে স্টাফ লিংক</p>
              <p className="text-xs leading-snug text-stone-500">
                অফ করলে কাস্টমার সামনে "কিচেন ডিসপ্লে • অ্যাডমিন প্যানেল" লিংক দেখাবে না (সরাসরি /kds ও /admin ঠিকানা এখনো কাজ করবে)।
              </p>
            </div>
            <Switch
              checked={form[SETTING_KEYS.STAFF_LINKS_ENABLED] !== 'false'}
              onCheckedChange={(v) => set(SETTING_KEYS.STAFF_LINKS_ENABLED, v ? 'true' : 'false')}
            />
          </div>
        </CardContent>
      </Card>

      {/* ---- legal page links (terms / privacy / data-deletion) ---- */}
      <Card className="border-stone-200">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">📄 লিগ্যাল পেজ লিংক</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="rounded-lg bg-stone-100 px-3 py-2 text-xs leading-snug text-stone-600">
            পেজগুলো সবসময় পাবলিকলি খোলা থাকে। টগল অফ করলে শুধু কাস্টমার পেজের ফুটার থেকে লিঙ্কটি
            লুকানো যাবে — সরাসরি ঠিকানা লিখে সবসময়ই খোলা যাবে।
          </p>
          {[
            {
              key: SETTING_KEYS.TERMS_LINK_ENABLED,
              title: '📜 শর্তাবলী (Terms & Condition)',
              path: '/terms-and-condition',
            },
            {
              key: SETTING_KEYS.PRIVACY_LINK_ENABLED,
              title: '🔒 গোপনীয়তা নীতি (Privacy Policy)',
              path: '/privacy-policy',
            },
            {
              key: SETTING_KEYS.DATADEL_LINK_ENABLED,
              title: '🗑️ ডেটা ডিলিট পেজ',
              path: '/datadel-page',
            },
          ].map((it) => (
            <div
              key={it.key}
              className="flex items-center justify-between rounded-lg border border-stone-200 bg-stone-50 p-3"
            >
              <div className="min-w-0 pr-3">
                <p className="text-sm font-black text-stone-800">{it.title}</p>
                <p className="mt-0.5 truncate font-mono text-[11px] text-amber-700">{it.path}</p>
              </div>
              <Switch
                checked={form[it.key] !== 'false'}
                onCheckedChange={(v) => set(it.key, v ? 'true' : 'false')}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      {/* ---- birthday ---- */}
      <Card className="border-stone-200">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">🎂 জন্মদিন অফার</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="space-y-1">
            <FieldLabel>জন্মদিনের ছাড় (৳)</FieldLabel>
            <Input
              inputMode="decimal"
              value={form[SETTING_KEYS.BIRTHDAY_DISCOUNT_AMOUNT] ?? '50'}
              onChange={(e) => set(SETTING_KEYS.BIRTHDAY_DISCOUNT_AMOUNT, e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <FieldLabel>ছাড়ের জন্য ন্যূনতম বিল (৳)</FieldLabel>
            <Input
              inputMode="decimal"
              value={form[SETTING_KEYS.BIRTHDAY_MIN_BILL] ?? '500'}
              onChange={(e) => set(SETTING_KEYS.BIRTHDAY_MIN_BILL, e.target.value)}
            />
          </div>
          <div className="space-y-1 md:col-span-2">
            <FieldLabel>m.me/ পেজ ইউজারনেম</FieldLabel>
            <Input
              value={form[SETTING_KEYS.MESSENGER_PAGE_USERNAME] ?? ''}
              onChange={(e) => set(SETTING_KEYS.MESSENGER_PAGE_USERNAME, e.target.value)}
              className="max-w-md"
              placeholder="যেমন: MyTeaPage"
            />
            <p className="max-w-md text-xs leading-snug text-stone-500">
              আপনার ফেসবুক <span className="font-bold">পেজের ইউজারনেম</span> (m.me/ এর পরের অংশ) অথবা{' '}
              <span className="font-bold">পেজ ID</span> দিন — ব্যক্তিগত প্রোফাইলের নাম নয়। যেমন: পেজের লিংক
              facebook.com/<span className="font-bold">MyTeaPage</span> হলে শুধু <span className="font-bold">MyTeaPage</span> লিখুন।
              পেজ সেটিংস → Page Setup/Page Info → Username এ পাবেন। ভুল হলে কাস্টমারের মেসেঞ্জার লিংক কাজ করবে না।
            </p>
            {pageUserClean && (
              <p className="max-w-md text-xs leading-snug text-stone-500">
                কাস্টমারের খোলা লিঙ্ক হবে:{' '}
                <a
                  className="font-bold text-amber-700 underline"
                  href={`https://m.me/${pageUserClean}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  https://m.me/{pageUserClean}
                </a>{' '}
                — লিঙ্কটি নিজে খুলে যাচাই করুন, পেজটি ঠিকঠাক আসে কিনা।
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ---- receipt customization ---- */}
      <Card className="border-stone-200">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">🧾 রসিদ কাস্টমাইজ</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <FieldLabel>রসিদের সাব-টাইটেল</FieldLabel>
            <Input
              value={form[SETTING_KEYS.RECEIPT_SUBTITLE] ?? ''}
              onChange={(e) => set(SETTING_KEYS.RECEIPT_SUBTITLE, e.target.value)}
              placeholder="ডিজিটাল রসিদ"
              className="max-w-md"
            />
          </div>
          <div className="space-y-1">
            <FieldLabel>ধন্যবাদ বার্তা</FieldLabel>
            <Input
              value={form[SETTING_KEYS.RECEIPT_THANKS] ?? ''}
              onChange={(e) => set(SETTING_KEYS.RECEIPT_THANKS, e.target.value)}
              placeholder="ধন্যবাদ! আবার আসবেন 🙏"
              className="max-w-md"
            />
          </div>
          <div className="space-y-1">
            <FieldLabel>ফুটার নোট</FieldLabel>
            <Textarea
              rows={2}
              value={form[SETTING_KEYS.RECEIPT_FOOTER_NOTE] ?? ''}
              onChange={(e) => set(SETTING_KEYS.RECEIPT_FOOTER_NOTE, e.target.value)}
              placeholder="রসিদের একদম নিচে ছোট করে দেখাবে (যেমন: VAT অন্তর্ভুক্ত)"
              className="max-w-lg"
            />
          </div>
          <div className="space-y-1">
            <FieldLabel>"Powered by" লাইন</FieldLabel>
            <Input
              value={form[SETTING_KEYS.POWERED_BY] ?? ''}
              onChange={(e) => set(SETTING_KEYS.POWERED_BY, e.target.value)}
              placeholder="Powered by Smart QR — ফাঁকা রাখলে এই লাইনটাই দেখাবে না"
              className="max-w-md"
            />
          </div>
        </CardContent>
      </Card>

      {/* ---- feature toggles ---- */}
      <Card className="border-stone-200">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">🔔 ফিচার টগল</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between rounded-lg border border-stone-200 bg-stone-50 p-3">
            <div className="min-w-0 pr-3">
              <p className="text-sm font-black text-stone-800">📝 স্পেশাল নোট</p>
              <p className="text-xs leading-snug text-stone-500">কাস্টমার অর্ডারে স্পেশাল নোট লিখতে পারবে কিনা</p>
            </div>
            <Switch
              checked={form[SETTING_KEYS.ITEM_SPECIAL_NOTE_ENABLED] !== 'false'}
              onCheckedChange={(v) => set(SETTING_KEYS.ITEM_SPECIAL_NOTE_ENABLED, v ? 'true' : 'false')}
            />
          </div>
          <div className="flex items-center justify-between rounded-lg border border-stone-200 bg-stone-50 p-3">
            <div className="min-w-0 pr-3">
              <p className="text-sm font-black text-stone-800">💌 মেসেঞ্জার অফার</p>
              <p className="text-xs leading-snug text-stone-500">
                চালু = বট মেসেঞ্জারে অফারের তথ্য চেয়ে যাচাই করে ছাড় দেবে; বন্ধ = বিল পেজেই সরাসরি ছাড় (অকেশন অফার দুই অবস্থাতেই দেখাবে)
              </p>
            </div>
            <Switch
              checked={form[SETTING_KEYS.MESSENGER_AUTO_REPLY_ENABLED] !== 'false'}
              onCheckedChange={(v) => set(SETTING_KEYS.MESSENGER_AUTO_REPLY_ENABLED, v ? 'true' : 'false')}
            />
          </div>
          {form[SETTING_KEYS.MESSENGER_AUTO_REPLY_ENABLED] !== 'false' &&
            (!meta.metaEnv?.pageToken || !meta.lastWebhookAt) && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                <p className="text-xs font-black leading-snug text-red-700">
                  ⚠️ মেসেঞ্জার অফার চালু আছে, কিন্তু Meta সংযোগ এখনো সম্পূর্ণ হয়নি
                </p>
                <p className="mt-1 text-xs leading-snug text-red-600">
                  {!meta.metaEnv?.pageToken
                    ? 'Vercel env-এ META_PAGE_TOKEN নেই — কাস্টমার চ্যাট করলেও কোনো উত্তর বা ছাড় পাবে না।'
                    : 'Facebook থেকে এখনো কোনো ওয়েবহুক ইভেন্ট আসেনি — Meta অ্যাপে webhook + টোকেন সেটআপ বাকি। সেটআপ শেষ না হওয়া পর্যন্ত কাস্টমার চ্যাট করলেও ছাড় বসবে না। নিচের “মেসেঞ্জার ইন্টিগ্রেশন” কার্ডে ধাপে ধাপে গাইড আছে।'}
                </p>
                <p className="mt-1 text-xs leading-snug text-red-600">
                  💡 সহজ সমাধান: সুইচটি বন্ধ করে দিন — তাহলে কাস্টমার মেসেঞ্জার ছাড়াই বিল পেজে সরাসরি ছাড় দাবি করতে পারবে (সাথে সাথেই কাজ করে)।
                </p>
              </div>
            )}
          <div className="rounded-lg border border-stone-200 bg-stone-50 p-3">
            <div className="flex items-center justify-between">
              <div className="min-w-0 pr-3">
                <p className="text-sm font-black text-stone-800">👨‍💻 ডেভেলপার নোট</p>
                <p className="text-xs leading-snug text-stone-500">
                  সব কাস্টমার পেজের নিচে ডেভেলপার ক্রেডিট/যোগাযোগ লিংক
                </p>
              </div>
              <Switch
                checked={form[SETTING_KEYS.DEVELOPER_NOTE_ENABLED] !== 'false'}
                onCheckedChange={(v) => set(SETTING_KEYS.DEVELOPER_NOTE_ENABLED, v ? 'true' : 'false')}
              />
            </div>
            {form[SETTING_KEYS.DEVELOPER_NOTE_ENABLED] !== 'false' && (
              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="space-y-1">
                  <FieldLabel>ডেভেলপার টেক্সট</FieldLabel>
                  <Input
                    value={form[SETTING_KEYS.DEVELOPER_NOTE_TEXT] ?? ''}
                    onChange={(e) => set(SETTING_KEYS.DEVELOPER_NOTE_TEXT, e.target.value)}
                    placeholder="Devloped By- Md. Rakib Sarker 01847485265"
                  />
                </div>
                <div className="space-y-1">
                  <FieldLabel>লিঙ্ক (ঐচ্ছিক)</FieldLabel>
                  <Input
                    value={form[SETTING_KEYS.DEVELOPER_NOTE_LINK] ?? ''}
                    onChange={(e) => set(SETTING_KEYS.DEVELOPER_NOTE_LINK, e.target.value)}
                    placeholder="https://github.com/username"
                  />
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ---- location & geofence ---- */}
      <Card className="border-stone-200">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">📍 লোকেশন ও জিওফেন্স</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border border-stone-200 bg-stone-50 p-3">
            <div className="min-w-0 pr-3">
              <p className="text-sm font-black text-stone-800">🛡️ জিওফেন্স চালু</p>
              <p className="text-xs leading-snug text-stone-500">
                পিন করা সার্কেলের বাইরে থেকে কেউ টেবিল স্ক্যান বা অর্ডার করতে পারবে না।
              </p>
            </div>
            <Switch
              checked={form[SETTING_KEYS.GEO_FENCE_ENABLED] === 'true'}
              onCheckedChange={(v) => set(SETTING_KEYS.GEO_FENCE_ENABLED, v ? 'true' : 'false')}
            />
          </div>

          <GeoMap lat={geoLat} lng={geoLng} radius={geoRadius} onPin={pinGeo} />

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <FieldLabel>কভারেজ ব্যাসার্ধ</FieldLabel>
              <span className="text-xs font-black text-amber-700">
                আনুমানিক এলাকা: ~{toBn(String(geoRadius))} মিটার ব্যাসার্ধ
              </span>
            </div>
            <Slider
              min={0}
              max={100}
              step={1}
              value={[radiusToSlider(geoRadius)]}
              onValueChange={(v) => set(SETTING_KEYS.GEO_RADIUS_METERS, String(sliderToRadius(v[0] ?? 0)))}
            />
            <div className="flex justify-between text-[10px] font-bold text-stone-400">
              <span>২০ মি</span>
              <span>৫০০০ মি</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={useMyLocation}
              className="border-amber-300 font-black text-amber-700 hover:bg-amber-50"
            >
              📍 আমার বর্তমান লোকেশন পিন করুন
            </Button>
            <span className="text-xs font-mono text-stone-500">
              পিন: {geoLat.toFixed(6)}, {geoLng.toFixed(6)}
            </span>
          </div>
        </CardContent>
      </Card>

      <Button onClick={save} disabled={saving} size="lg" className="w-full bg-amber-500 font-black text-white hover:bg-amber-600 sm:w-auto">
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null} সেটিংস সেভ করুন
      </Button>

      {/* ---- messenger + cron ---- */}
      <Card className="border-stone-200">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Webhook className="h-5 w-5 text-stone-600" /> মেসেঞ্জার ইন্টিগ্রেশন
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            className={`flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-bold ${
              meta.messengerConfigured && meta.lastWebhookAt
                ? 'bg-emerald-50 text-emerald-700'
                : 'bg-amber-50 text-amber-800'
            }`}
          >
            <span
              className={`h-2.5 w-2.5 rounded-full ${
                meta.messengerConfigured && meta.lastWebhookAt ? 'bg-emerald-500' : 'animate-pulse bg-amber-500'
              }`}
            />
            {meta.messengerConfigured && meta.lastWebhookAt
              ? 'Meta সংযোগ সম্পূর্ণ — চ্যাটে ছাড় কাজ করছে ✅'
              : meta.messengerConfigured
                ? 'টোকেন আছে, কিন্তু Facebook অ্যাপে webhook সেটআপ বাকি'
                : 'META_PAGE_TOKEN সেট করা হয়নি (Vercel env)'}
          </div>

          {/* checklist: what is configured vs missing */}
          <div className="space-y-3 rounded-lg border border-stone-200 p-3">
            <p className="text-[11px] font-black uppercase tracking-wide text-stone-400">কনফিগারেশন চেকলিস্ট</p>
            <MetaCheckRow
              label="পেজ টোকেন"
              code="META_PAGE_TOKEN (Vercel env)"
              ok={!!meta.metaEnv?.pageToken}
              note="চ্যাটে রিপ্লাই, ফোন-শেয়ার ও ডিজিটাল রসিদ পাঠাতে এটি আবশ্যক।"
            />
            <MetaCheckRow
              label="ভেরিফাই টোকেন"
              code="META_VERIFY_TOKEN (Vercel env)"
              ok={!!meta.metaEnv?.verifyToken}
              note="এটি ছাড়া Meta অ্যাপ ড্যাশবোর্ডে webhook সেভ/ভেরিফাই করা যাবে না।"
            />
            <MetaCheckRow
              label="অ্যাপ সিক্রেট (ঐচ্ছিক)"
              code="META_APP_SECRET (Vercel env)"
              ok={!!meta.metaEnv?.appSecret}
              note="নিরাপত্তার জন্য — থাকলে ভুয়া/জাল ওয়েবহুক ইভেন্টে ছাড় দেওয়া অসম্ভব হয়।"
            />
            <MetaCheckRow
              label="ওয়েবহুক ইভেন্ট"
              code="Meta → আমাদের সার্ভার"
              ok={!!meta.lastWebhookAt}
              note={
                meta.lastWebhookAt
                  ? `শেষ ইভেন্ট: ${bnAgo(meta.lastWebhookAt)} (${meta.lastWebhookInfo || 'unknown'})`
                  : 'Facebook থেকে এখনো একটি ইভেন্টও আসেনি — অর্থাৎ Meta অ্যাপে webhook কনফিগার হয়নি বা সাবস্ক্রিপশন নেই।'
              }
            />
          </div>

          {/* live test */}
          <div className="space-y-2">
            <Button
              onClick={runMessengerTest}
              disabled={testingMeta}
              variant="outline"
              className="border-amber-300 font-black text-amber-700 hover:bg-amber-50"
            >
              {testingMeta ? <Loader2 className="h-4 w-4 animate-spin" /> : '🔍'} টোকেন ও সংযোগ টেস্ট করুন
            </Button>
            {metaTest && (
              <div
                className={`rounded-lg border p-3 text-xs leading-snug ${
                  metaTest.tokenTest.ok
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                    : 'border-red-200 bg-red-50 text-red-700'
                }`}
              >
                {metaTest.tokenTest.ok ? (
                  <>
                  <p className="font-bold">
                    ✅ টোকেন সঠিক — এটি এই পেজের: <span className="underline">{metaTest.tokenTest.pageName}</span>
                    {metaTest.tokenTest.pageId ? ` (Page ID: ${metaTest.tokenTest.pageId})` : ''}
                  </p>
                  {metaTest.tokenTest.pageUsername ? (
                    pageUserClean.toLowerCase() === metaTest.tokenTest.pageUsername.toLowerCase() ? (
                      <p className="mt-1">পেজ username মিলে গেছে ✅ (m.me/{metaTest.tokenTest.pageUsername})</p>
                    ) : (
                      <p className="mt-1 font-bold">
                        ⚠️ কিন্তু টোকেন যে পেজের, তার username:{' '}
                        <span className="underline">m.me/{metaTest.tokenTest.pageUsername}</span> — সেটিংসে লেখা আছে “
                        {pageUserClean || 'ফাঁকা'}”। মিলছে না! উপরের ইউজারনেম ফিল্ডে{' '}
                        <span className="font-mono">{metaTest.tokenTest.pageUsername}</span> লিখুন, নাহলে কাস্টমারের
                        Messenger-এ পেজটি পাবে না।
                      </p>
                    )
                  ) : (
                    <p className="mt-1">
                      টোকেনের পেজে কোনো username সেট নেই — m.me/username লিঙ্ক কাজ করবে না। পেজ সেটিংসে username বানান,
                      অথবা ইউজারনেম ফিল্ডে পেজ ID ({metaTest.tokenTest.pageId}) লিখুন।
                    </p>
                  )}
                  </>
                ) : (
                  <p className="font-bold">❌ টোকেন কাজ করছে না: {metaTest.tokenTest.error}</p>
                )}
                <p className="mt-1">
                  ওয়েবহুক ইভেন্ট:{' '}
                  {metaTest.lastWebhookAt
                    ? `${bnAgo(metaTest.lastWebhookAt)} (${metaTest.lastWebhookInfo})`
                    : 'এখনো কোনো ইভেন্ট আসেনি ❌'}
                </p>
                {metaTest.lastVerifyAt && <p>Meta webhook ভেরিফিকেশন: {bnAgo(metaTest.lastVerifyAt)} সফল হয়েছিল ✅</p>}
              </div>
            )}
          </div>

          {/* step-by-step setup guide */}
          <details className="rounded-lg border border-stone-200 bg-stone-50 p-3">
            <summary className="cursor-pointer text-sm font-black text-stone-800">
              📖 মেসেঞ্জার চালু করতে ধাপে ধাপে সেটআপ গাইড (Meta + Vercel)
            </summary>
            <ol className="mt-3 list-decimal space-y-2.5 pl-4 text-xs leading-relaxed text-stone-700">
              <li>
                <b>Facebook অ্যাপ তৈরি:</b> developers.facebook.com → My Apps → Create App → টাইপ <b>Business</b> → Create।
              </li>
              <li>
                <b>Messenger যোগ:</b> অ্যাপ ড্যাশবোর্ডে Add Product → <b>Messenger</b> → Set up।
              </li>
              <li>
                <b>পেজ টোকেন:</b> Messenger Settings → Access Tokens → আপনার পেজ সিলেক্ট → Generate Token → টোকেন কপি করে
                Vercel → Settings → Environment Variables-এ <b>META_PAGE_TOKEN</b> নামে যোগ করুন (Production + Preview দুটোতেই)।
              </li>
              <li>
                <b>ভেরিফাই টোকেন:</b> নিজের পছন্দের একটি গোপন শব্দ বানান (যেমন: <span className="font-mono">teaTreatVerify2026</span>) →
                Vercel-এ <b>META_VERIFY_TOKEN</b> নামে যোগ করুন। (ঐচ্ছিক) App Settings → Basic → App Secret কপি করে{' '}
                <b>META_APP_SECRET</b> নামে যোগ করুন।
              </li>
              <li>
                <b>Webhook সংযোগ:</b> Messenger Settings → Webhooks → Configure Webhooks — Callback URL:{' '}
                <span className="font-mono font-bold">{meta.webhookUrl}</span>, Verify Token: ধাপ ৪-এর একই শব্দ →{' '}
                <b>Verify and Save</b>। সফল হলে উপরের চেকলিস্ট আপডেট হবে।
              </li>
              <li>
                <b>ফিল্ড সাবস্ক্রাইব:</b> একই Webhooks পেজে আপনার <b>পেজ</b> সিলেক্ট করে Subscribe করুন:{' '}
                <span className="font-mono">messages</span>, <span className="font-mono">messaging_postbacks</span>,{' '}
                <span className="font-mono">referral</span> — এগুলো ছাড়া চ্যাটের ইভেন্ট আসবেই না।
              </li>
              <li>
                <b>Redeploy:</b> Vercel → Deployments → সর্বশেষ ডিপ্লয়ের ⋯ মেনু → <b>Redeploy</b> (নতুন env ভেরিয়েবল কার্যকর হবে)।
              </li>
              <li>
                <b>টেস্ট:</b> বিল পেজে গিয়ে “Claim on Messenger” → বট চ্যাটে অফারের তথ্য চাইবে → সঠিক তথ্য পাঠান → যাচাই হলেই ছাড় বিলে যোগ হবে। ১ মিনিটের মধ্যে
                এই পেজে এসে “🔍 টোকেন ও সংযোগ টেস্ট করুন” চাপুন — ওয়েবহুক ইভেন্ট সবুজ হলে সব ঠিক!
              </li>
            </ol>
            <p className="mt-3 rounded-lg bg-white p-2.5 text-xs leading-snug text-stone-600">
              ⚠️ মনে রাখুন: সেটিংসের <b>“m.me/ পেজ ইউজারনেম”</b> আপনার পেজের আসল username হতে হবে (পেজ সেটিংস → Page
              Setup/Page Info → Username)। ভুল হলে কাস্টমারের Messenger-এ পেজটিই খুঁজে পাবে না।
              <br />
              💡 Meta সেটআপ করতে না চাইলে “💌 মেসেঞ্জার অফার” সুইচ বন্ধ রাখুন — কাস্টমার বিল পেজেই সরাসরি ছাড় দাবি করতে পারবে,
              কোনো সেটআপ ছাড়াই।
            </p>
          </details>

          <div className="rounded-lg border border-pink-200 bg-pink-50/60 p-4">
            <p className="mb-2 flex items-center gap-2 text-sm font-black text-stone-800">
              <Cake className="h-5 w-5 text-pink-600" /> জন্মদিন জব (ক্রন)
            </p>
            <p className="mb-3 text-xs text-stone-500">
              আজ জন্মদিন এমন কাস্টমারদের ({form[SETTING_KEYS.BIRTHDAY_TIMEZONE] || 'Asia/Dhaka'} টাইমজোনে) মেসেঞ্জারে শুভেচ্ছা ও ছাড়ের লিঙ্ক যায়।
            </p>
            <Button onClick={runBirthdayJob} disabled={runningCron} variant="outline" className="border-pink-300 font-black text-pink-700 hover:bg-pink-100">
              {runningCron ? <Loader2 className="h-4 w-4 animate-spin" /> : '🎂'} জন্মদিন জব এখন চালান
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// ============================================================
// TAB: 🔒 সিকিউরিটি লেজার (tamper-evident hash chain)
// ============================================================
function LedgerTab({ onAuthRequired }: TabProps) {
  const [data, setData] = useState<LedgerData | null>(null)
  const [err, setErr] = useState('')
  const [typeFilter, setTypeFilter] = useState('ALL')

  const load = useCallback(async () => {
    const qs = typeFilter === 'ALL' ? '?limit=100' : `?limit=100&type=${typeFilter}`
    const res = await api.get<LedgerData>(`/api/admin/ledger${qs}`)
    if (isAuthError(res)) return onAuthRequired()
    if (!res.ok || !res.data) {
      setErr(res.error || 'লেজার আনা যায়নি')
      return
    }
    setErr('')
    setData(res.data)
  }, [onAuthRequired, typeFilter])

  useEffect(() => {
    const t = setTimeout(load, 0)
    const iv = setInterval(load, 15000)
    return () => {
      clearTimeout(t)
      clearInterval(iv)
    }
  }, [load])

  if (err) return <LoadError msg={err} onRetry={load} />
  if (!data) return <Loading />

  return (
    <div className="space-y-4">
      {/* explanation */}
      <div className="flex items-start gap-2 rounded-xl border border-stone-300 bg-white p-3 text-sm text-stone-700">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
        <p className="text-xs leading-relaxed">
          প্রতিটি নিরাপত্তা ঘটনা (সেশন, কুপন, জন্মদিনের ছাড়, বিল) একটি <b>ব্লকচেইন-স্টাইল SHA-256 হ্যাশ চেইনে</b> সংরক্ষিত —
          একটি ব্লকের হ্যাশ পরবর্তী ব্লকের সাথে যুক্ত। ডাটাবেজে কেউ গোপনে কিছু বদলালে চেইন ভেঙে যাবে এবং সাথে সাথে ধরা পড়বে।
        </p>
      </div>

      {/* integrity banner */}
      {data.integrity.valid ? (
        <div className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-emerald-600" />
            <p className="text-sm font-extrabold text-emerald-800">
              ✅ হ্যাশ চেইন যাচাই সম্পন্ন — {toBn(String(data.integrity.checked))} ব্লক, কোনো হেরফের নেই
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={load} className="border-emerald-300 font-bold text-emerald-700">
            <RefreshCw className="h-4 w-4" /> আবার যাচাই
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-xl border border-red-300 bg-red-50 p-4">
          <AlertTriangle className="h-5 w-5 text-red-600" />
          <p className="text-sm font-extrabold text-red-800">
            ⚠️ চেইন ভাঙা! ব্লক #{toBn(String(data.integrity.brokenAtSeq))} থেকে ডাটা টেম্পার করা হয়েছে — তদন্ত করুন!
          </p>
        </div>
      )}

      {/* filter */}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-64">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">সব ঘটনা ({toBn(String(data.total))})</SelectItem>
            {Object.entries(LEDGER_TYPE_BN).map(([k, v]) => (
              <SelectItem key={k} value={k}>
                {v.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" variant="outline" onClick={load} className="border-stone-300 font-bold">
          <RefreshCw className="h-4 w-4" /> রিফ্রেশ
        </Button>
      </div>

      {/* entries */}
      {data.entries.length === 0 ? (
        <p className="py-10 text-center text-sm text-stone-400">এখনো কোনো ঘটনা নেই</p>
      ) : (
        <div className="thin-scroll max-h-[62vh] space-y-2 overflow-y-auto rounded-xl border border-stone-200 bg-white p-3">
          {data.entries.map((e) => {
            const meta = LEDGER_TYPE_BN[e.type] || { label: e.type, cls: 'bg-stone-100 text-stone-700' }
            return (
              <div key={e.seq} className="rounded-lg border border-stone-100 bg-stone-50/60 p-3 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[10px] font-bold text-stone-400">#{toBn(String(e.seq))}</span>
                  <Badge className={cn('text-[10px] hover:bg-inherit', meta.cls)}>{meta.label}</Badge>
                  {e.tableNumber !== null && (
                    <Badge variant="outline" className="border-stone-200 text-[10px] text-stone-500">
                      টেবিল {toBn(String(e.tableNumber))}
                    </Badge>
                  )}
                  <span className="ml-auto text-[10px] text-stone-400">{bnDateTime(e.createdAt)}</span>
                </div>
                <p className="mt-1 break-all font-mono text-[10px] leading-relaxed text-stone-500">
                  {typeof e.detail === 'object' && e.detail !== null
                    ? Object.entries(e.detail as Record<string, unknown>)
                        .slice(0, 6)
                        .map(([k, v]) => `${k}: ${String(v).slice(0, 40)}`)
                        .join('  •  ')
                    : String(e.detail ?? '')}
                </p>
                <p className="mt-1 font-mono text-[9px] text-stone-300">
                  ← {e.prevHash} ⛓ {e.hash}
                  {e.deviceId && ` · 📱 ${e.deviceId}`}
                </p>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ============================================================
// TAB: 🔑 অ্যাক্সেস কী (KDS + sub-admin keys) — MAIN ADMIN ONLY
// ============================================================
interface AccessKeyRow {
  id: string
  keyCode: string
  name: string
  role: string // KDS | ADMIN_CONTROLLER
  permissions: string[]
  lifetime: boolean
  expiresAt: string | null
  active: boolean
  lastUsedAt: string | null
  createdAt: string
}

const ROLE_BADGE: Record<string, { label: string; cls: string }> = {
  KDS: { label: '👨‍🍳 কিচেন ডিসপ্লে কী', cls: 'bg-amber-100 text-amber-800 border-amber-200' },
  ADMIN_CONTROLLER: { label: '🛡️ সাব-অ্যাডমিন কী', cls: 'bg-violet-100 text-violet-800 border-violet-200' },
}

function permLabel(id: string): string {
  return SUB_ADMIN_PERMISSIONS.find((p) => p.id === id)?.label ?? id
}

/** days left until expiry (ceil), or null for lifetime */
function daysLeft(expiresAt: string | null): number | null {
  if (!expiresAt) return null
  const ms = new Date(expiresAt).getTime() - Date.now()
  return Math.max(0, Math.ceil(ms / 86_400_000))
}

function KeyPerms({
  perms,
  onToggle,
}: {
  perms: string[]
  onToggle: (id: string) => void
}) {
  return (
    <div className="grid grid-cols-1 gap-2 rounded-xl border border-stone-200 bg-white p-3 sm:grid-cols-2">
      {SUB_ADMIN_PERMISSIONS.map((p) => {
        const checked = perms.includes(p.id)
        return (
          <label
            key={p.id}
            className={cn(
              'flex cursor-pointer items-start gap-2 rounded-lg border p-2.5 transition',
              checked ? 'border-amber-400 bg-amber-50' : 'border-stone-200 bg-stone-50 hover:border-stone-300'
            )}
          >
            <Checkbox checked={checked} onCheckedChange={() => onToggle(p.id)} className="mt-0.5" />
            <span className="min-w-0">
              <span className="block text-xs font-black text-stone-800">{p.label}</span>
              <span className="block text-[10px] leading-snug text-stone-500">{p.desc}</span>
            </span>
          </label>
        )
      })}
    </div>
  )
}

function AccessKeysTab({ onAuthRequired }: TabProps) {
  const [keys, setKeys] = useState<AccessKeyRow[] | null>(null)
  const [err, setErr] = useState('')

  // create form
  const [fName, setFName] = useState('')
  const [fRole, setFRole] = useState<'KDS' | 'ADMIN_CONTROLLER'>('KDS')
  const [fLifetime, setFLifetime] = useState(true)
  const [fDays, setFDays] = useState('30')
  const [fPerms, setFPerms] = useState<string[]>(['overview', 'tables'])
  const [busyCreate, setBusyCreate] = useState(false)

  // edit dialog
  const [editing, setEditing] = useState<AccessKeyRow | null>(null)
  const [eName, setEName] = useState('')
  const [ePerms, setEPerms] = useState<string[]>([])
  const [eLifetime, setELifetime] = useState(false)
  const [eDays, setEDays] = useState('30')
  const [busyEdit, setBusyEdit] = useState(false)

  const load = useCallback(async () => {
    const res = await api.get<{ keys: AccessKeyRow[] }>('/api/admin/access-keys')
    if (!res.ok || !res.data) {
      setErr(res.error || 'কী তালিকা আনা যায়নি')
      if (res.error?.includes('401')) onAuthRequired()
      return
    }
    setErr('')
    setKeys(res.data.keys)
  }, [onAuthRequired])

  useEffect(() => {
    const t = setTimeout(load, 0)
    return () => clearTimeout(t)
  }, [load])

  const create = async () => {
    if (!fName.trim()) return toast.error('কী-এর নাম দিন')
    if (fRole === 'ADMIN_CONTROLLER' && fPerms.length === 0) return toast.error('অন্তত একটি অনুমতি মার্ক করুন')
    setBusyCreate(true)
    const res = await api.post<{ key: AccessKeyRow }>('/api/admin/access-keys', {
      name: fName.trim(),
      role: fRole,
      lifetime: fLifetime,
      expireDays: fLifetime ? undefined : parseInt(fDays, 10),
      permissions: fRole === 'ADMIN_CONTROLLER' ? fPerms : undefined,
    })
    setBusyCreate(false)
    if (!res.ok || !res.data) return toast.error(res.error || 'তৈরি করা যায়নি')
    toast.success(`কী তৈরি হয়েছে — ${res.data.key.keyCode}`, { duration: 8000 })
    setFName('')
    setFPerms(['overview', 'tables'])
    load()
  }

  const toggleActive = async (k: AccessKeyRow) => {
    const res = await api.patch(`/api/admin/access-keys/${k.id}`, { active: !k.active })
    if (!res.ok) return toast.error(res.error || 'বদলানো যায়নি')
    toast.success(k.active ? `${k.keyCode} নিষ্ক্রিয় করা হয়েছে` : `${k.keyCode} আবার সক্রিয়`)
    load()
  }

  const del = async (k: AccessKeyRow) => {
    const res = await api.del(`/api/admin/access-keys/${k.id}`)
    if (!res.ok) {
      toast.error(res.error || 'ডিলিট করা যায়নি')
      return
    }
    toast.success(`${k.keyCode} ডিলিট হয়েছে`)
    load()
  }

  const openEdit = (k: AccessKeyRow) => {
    setEditing(k)
    setEName(k.name)
    setEPerms(k.permissions)
    setELifetime(k.lifetime)
    setEDays('30')
  }

  const saveEdit = async () => {
    if (!editing) return
    if (!eName.trim()) return toast.error('কী-এর নাম দিন')
    if (editing.role === 'ADMIN_CONTROLLER' && ePerms.length === 0) return toast.error('অন্তত একটি অনুমতি রাখুন')
    setBusyEdit(true)
    const payload: Record<string, unknown> = { name: eName.trim() }
    if (editing.role === 'ADMIN_CONTROLLER') payload.permissions = ePerms
    if (eLifetime) {
      payload.lifetime = true
    } else {
      payload.lifetime = false
      payload.expireDays = parseInt(eDays, 10)
    }
    const res = await api.patch(`/api/admin/access-keys/${editing.id}`, payload)
    setBusyEdit(false)
    if (!res.ok) return toast.error(res.error || 'সেভ করা যায়নি')
    toast.success('কী আপডেট হয়েছে')
    setEditing(null)
    load()
  }

  const copyKey = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code)
      toast.success('কী কপি হয়েছে')
    } catch {
      toast.error('কপি করা যায়নি')
    }
  }

  if (err) return <LoadError msg={err} onRetry={load} />
  if (!keys) return <Loading />

  return (
    <div className="space-y-4">
      {/* explainer */}
      <div className="rounded-xl border border-amber-300 bg-gradient-to-br from-amber-50 to-white p-4">
        <p className="flex items-center gap-2 text-sm font-black text-stone-800">
          <KeyRound className="h-4 w-4 text-amber-600" /> 🔑 অ্যাক্সেস কী ম্যানেজমেন্ট
        </p>
        <p className="mt-1 text-xs leading-relaxed text-stone-600">
          দুই ধরনের কী: <b>👨‍🍳 কিচেন ডিসপ্লে কী</b> — /kds পেজ আনলক করতে। <b>🛡️ সাব-অ্যাডমিন কী</b> —
          অ্যাডমিন কন্ট্রোলার; মেইন পাসকোডের বদলে অ্যাডমিন প্যানেলে লগইন করতে, আর কোন কোন অংশ
          ব্যবহার করতে পারবে সেটা আপনি নিচের চেকবক্সে মার্ক করে দেবেন। মেয়াদ: নির্দিষ্ট দিন অথবা
          লাইফটাইম। কী ম্যানেজমেন্ট শুধু মেইন অ্যাডমিনের।
        </p>
      </div>

      {/* create */}
      <Card className="border-stone-200">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Plus className="h-4 w-4 text-emerald-600" /> নতুন কী তৈরি করুন
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <FieldLabel>কী-এর নাম (কার/কোথায় ব্যবহৃত)</FieldLabel>
              <Input
                value={fName}
                onChange={(e) => setFName(e.target.value)}
                placeholder="যেমন: কিচেন কাউন্টার / ম্যানেজার রহিম"
              />
            </div>
            <div className="space-y-1">
              <FieldLabel>ধরন</FieldLabel>
              <Select value={fRole} onValueChange={(v) => setFRole(v as 'KDS' | 'ADMIN_CONTROLLER')}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="KDS">👨‍🍳 কিচেন ডিসপ্লে কী</SelectItem>
                  <SelectItem value="ADMIN_CONTROLLER">🛡️ সাব-অ্যাডমিন (অ্যাডমিন কন্ট্রোলার)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-2">
            <div className="flex items-center justify-between rounded-lg border border-stone-200 bg-stone-50 px-3 py-2.5">
              <div>
                <p className="text-sm font-black text-stone-800">♾️ লাইফটাইম</p>
                <p className="text-[11px] text-stone-500">কখনো মেয়াদ শেষ হবে না</p>
              </div>
              <Switch checked={fLifetime} onCheckedChange={setFLifetime} />
            </div>
            {!fLifetime && (
              <div className="space-y-1">
                <FieldLabel>মেয়াদ (দিন)</FieldLabel>
                <Input
                  inputMode="numeric"
                  value={fDays}
                  onChange={(e) => setFDays(e.target.value)}
                  placeholder="30"
                />
              </div>
            )}
          </div>

          {fRole === 'ADMIN_CONTROLLER' && (
            <div className="space-y-2">
              <FieldLabel>🛡️ সাব-অ্যাডমিন কী দিয়ে কী কী করতে পারবে (মার্ক করুন)</FieldLabel>
              <KeyPerms perms={fPerms} onToggle={(id) =>
                setFPerms((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
              } />
              <p className="text-[11px] text-stone-500">
                🔑 অ্যাক্সেস কী ম্যানেজমেন্ট সবসময় মেইন অ্যাডমিনের — সাব-অ্যাডমিনকে দেওয়া যায় না।
              </p>
            </div>
          )}

          <Button onClick={create} disabled={busyCreate} className="w-full bg-amber-500 font-black text-white hover:bg-amber-600 sm:w-auto">
            {busyCreate ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />} কী তৈরি করুন
          </Button>
        </CardContent>
      </Card>

      {/* list */}
      <div className="flex items-center justify-between">
        <p className="text-sm font-black text-stone-700">বর্তমান কী ({toBn(String(keys.length))}টি)</p>
        <Button size="sm" variant="outline" onClick={load} className="border-stone-300 font-bold">
          <RefreshCw className="h-4 w-4" /> রিফ্রেশ
        </Button>
      </div>

      {keys.length === 0 ? (
        <p className="rounded-xl border border-dashed border-stone-300 py-10 text-center text-sm text-stone-400">
          এখনো কোনো কী নেই — উপরের ফর্ম থেকে তৈরি করুন
        </p>
      ) : (
        <div className="thin-scroll max-h-[60vh] space-y-2 overflow-y-auto pr-1">
          {keys.map((k) => {
            const badge = ROLE_BADGE[k.role] ?? ROLE_BADGE.KDS
            const left = daysLeft(k.expiresAt)
            const expired = !k.lifetime && left !== null && left <= 0
            const usable = k.active && !expired
            return (
              <div
                key={k.id}
                className={cn(
                  'rounded-xl border bg-white p-3 shadow-sm',
                  usable ? 'border-stone-200' : 'border-red-200 bg-red-50/40'
                )}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className={cn('border text-[11px] hover:bg-inherit', badge.cls)}>{badge.label}</Badge>
                  <p className="text-sm font-black text-stone-900">{k.name}</p>
                  {!k.active ? (
                    <Badge className="bg-stone-200 text-[10px] text-stone-600 hover:bg-stone-200">নিষ্ক্রিয়</Badge>
                  ) : expired ? (
                    <Badge className="bg-red-100 text-[10px] text-red-700 hover:bg-red-100">মেয়াদ শেষ</Badge>
                  ) : (
                    <Badge className="bg-emerald-100 text-[10px] text-emerald-700 hover:bg-emerald-100">সক্রিয়</Badge>
                  )}
                  <span className="ml-auto text-[10px] text-stone-400">তৈরি: {bnDateTime(k.createdAt)}</span>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <code className="rounded-lg bg-stone-100 px-2.5 py-1 font-mono text-sm font-bold tracking-wider text-stone-800">
                    {k.keyCode}
                  </code>
                  <Button size="sm" variant="outline" className="h-7 border-stone-300 text-xs" onClick={() => copyKey(k.keyCode)}>
                    📋 কপি
                  </Button>
                  <span className="text-[11px] font-bold text-stone-600">
                    {k.lifetime ? '♾️ লাইফটাইম' : expired ? '❌ মেয়াদোত্তীর্ণ' : `⏳ ${toBn(String(left))} দিন বাকি`}
                  </span>
                  <span className="text-[11px] text-stone-400">
                    শেষ ব্যবহার: {k.lastUsedAt ? bnDateTime(k.lastUsedAt) : 'এখনো হয়নি'}
                  </span>
                </div>

                {k.role === 'ADMIN_CONTROLLER' && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {k.permissions.map((p) => (
                      <Badge key={p} variant="outline" className="border-stone-200 bg-stone-50 text-[10px] text-stone-600">
                        ✓ {permLabel(p)}
                      </Badge>
                    ))}
                  </div>
                )}

                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" className="h-8 border-stone-300 text-xs font-bold" onClick={() => openEdit(k)}>
                    <Pencil className="h-3.5 w-3.5" /> এডিট
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className={cn('h-8 border-stone-300 text-xs font-bold', k.active && 'text-red-600 hover:bg-red-50')}
                    onClick={() => toggleActive(k)}
                  >
                    {k.active ? '🚫 নিষ্ক্রিয় করুন' : '✅ সক্রিয় করুন'}
                  </Button>
                  <ConfirmAction
                    title="কী ডিলিট করবেন?"
                    description={`${k.keyCode} (${k.name}) স্থায়ীভাবে মুছে যাবে — এই কী দিয়ে আর কেউ ঢুকতে পারবে না।`}
                    onConfirm={() => del(k)}
                  >
                    <Button size="sm" variant="outline" className="h-8 border-red-200 text-xs font-bold text-red-600 hover:bg-red-50">
                      <Trash2 className="h-3.5 w-3.5" /> ডিলিট
                    </Button>
                  </ConfirmAction>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* edit dialog */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>কী এডিট — {editing?.keyCode}</DialogTitle>
            <DialogDescription>
              নাম, অনুমতি ও মেয়াদ বদলান। মেয়াদ নতুন করে দিলে আজ থেকে গণনা হবে।
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <FieldLabel>নাম</FieldLabel>
              <Input value={eName} onChange={(e) => setEName(e.target.value)} />
            </div>
            {editing?.role === 'ADMIN_CONTROLLER' && (
              <div className="space-y-2">
                <FieldLabel>অনুমতিসমূহ</FieldLabel>
                <KeyPerms perms={ePerms} onToggle={(id) =>
                  setEPerms((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
                } />
              </div>
            )}
            <div className="flex items-center justify-between rounded-lg border border-stone-200 bg-stone-50 px-3 py-2.5">
              <div>
                <p className="text-sm font-black text-stone-800">♾️ লাইফটাইম</p>
                <p className="text-[11px] text-stone-500">কখনো মেয়াদ শেষ হবে না</p>
              </div>
              <Switch checked={eLifetime} onCheckedChange={setELifetime} />
            </div>
            {!eLifetime && (
              <div className="space-y-1">
                <FieldLabel>নতুন মেয়াদ (আজ থেকে দিন)</FieldLabel>
                <Input inputMode="numeric" value={eDays} onChange={(e) => setEDays(e.target.value)} />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)} className="border-stone-300">
              বাতিল
            </Button>
            <Button onClick={saveEdit} disabled={busyEdit} className="bg-amber-500 font-black text-white hover:bg-amber-600">
              {busyEdit ? <Loader2 className="h-4 w-4 animate-spin" /> : 'সেভ করুন'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ============================================================
// Main page — auth gate + shell (+ staff sound header controls)
// ============================================================
const LS_ADMIN_SOUND = 'admin_sound'
const LS_ADMIN_VOLUME = 'admin_volume'
const LS_ADMIN_WAKE = 'admin_wakelock'

export default function AdminPage() {
  const [auth, setAuth] = useState<'checking' | 'login' | 'ready'>('checking')
  const [passcode, setPasscode] = useState('')
  const [loggingIn, setLoggingIn] = useState(false)
  // session info: main admin OR sub-admin (admin controller key)
  const [session, setSession] = useState<{
    kind: 'main' | 'sub'
    name?: string
    permissions: string[]
  } | null>(null)

  // ---- staff sound (chime on new orders / waiter calls in TablesTab) ----
  const [soundOn, setSoundOn] = useState(true)
  const [volume, setVolumeState] = useState<StaffVolume>('boost')
  // drives the "tap to enable sound" banner — mobile browsers only allow
  // audio after a real tap, and scroll-only usage never taps
  const [audioArmed, setAudioArmed] = useState(false)
  const [wakeOn, setWakeOn] = useState(false) // keep screen awake → polling + chimes keep working
  const soundOnRef = useRef(true)
  const volumeRef = useRef<StaffVolume>('boost')
  const armedOnceRef = useRef(false)
  const wakeOnRef = useRef(false)

  useEffect(() => {
    // deferred so the hydration render stays deterministic (no setState-in-effect)
    const t = setTimeout(() => {
      try {
        const v = localStorage.getItem(LS_ADMIN_VOLUME) === 'normal' ? 'normal' : 'boost'
        volumeRef.current = v
        setVolumeState(v)
        const on = localStorage.getItem(LS_ADMIN_SOUND) !== 'off'
        soundOnRef.current = on
        setSoundOn(on)
        const wake = localStorage.getItem(LS_ADMIN_WAKE) === 'on'
        wakeOnRef.current = wake
        setWakeOn(wake)
        if (wake) void requestWakeLock() // no gesture yet — may fail, retried later
      } catch {
        /* private mode — defaults are fine */
      }
    }, 0)
    return () => clearTimeout(t)
  }, [])

  // arm the audio engine on EVERY user gesture — cheap + idempotent, and
  // revives the context after mobile interruptions (call, app switch).
  // Also primes the <audio> WAV fallback for webviews that never unlock WebAudio.
  useEffect(() => {
    const onPointer = () => {
      if (wakeOnRef.current) void requestWakeLock()
      if (!soundOnRef.current) return
      if (armStaffSound(volumeRef.current)) {
        unlockStaffAudioFallback()
        if (!armedOnceRef.current) {
          armedOnceRef.current = true
          setAudioArmed(true)
          staffConfirmBeep()
        }
      }
    }
    window.addEventListener('pointerdown', onPointer, { passive: true })
    return () => window.removeEventListener('pointerdown', onPointer)
  }, [])

  // tab visible again → revive audio + wake lock + INSTANT catch-up poll
  // (background tabs throttle timers; missed status changes should chime
  // right away instead of waiting for the next 5s tick)
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      if (soundOnRef.current) void armStaffSound(volumeRef.current)
      if (wakeOnRef.current) void requestWakeLock()
      window.dispatchEvent(new Event('admin:tables:refresh'))
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  /** Full-volume test chime + fallback unlock (used by banner + toggle). */
  const enableAudioNow = () => {
    if (armStaffSound(volumeRef.current)) {
      armedOnceRef.current = true
      setAudioArmed(true)
      unlockStaffAudioFallback()
      staffChime('order') // loud ding-ding — instant proof that mobile audio works
      if (/Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
        toast.info('টেস্ট সাউন্ড শুনতে পেলেন? না শুনলে ফোনের মিডিয়া ভলিউম বাড়ান; iPhone হলে সাইলেন্ট সুইচ বন্ধ করুন')
      }
    } else {
      toast.error('এই ব্রাউজারে অডিও চালু করা যাচ্ছে না — ভলিউম ও সাইলেন্ট মোড চেক করুন')
    }
  }

  const toggleSound = () => {
    const next = !soundOnRef.current
    soundOnRef.current = next
    setSoundOn(next)
    try {
      localStorage.setItem(LS_ADMIN_SOUND, next ? 'on' : 'off')
    } catch {
      /* ignore */
    }
    if (next) {
      // toggle IS a user gesture → arm + unlock + play the real test chime
      if (armStaffSound(volumeRef.current)) {
        armedOnceRef.current = true
        setAudioArmed(true)
        unlockStaffAudioFallback()
        staffChime('order')
      }
    } else {
      disarmStaffSound()
    }
  }

  const toggleVolume = () => {
    const next: StaffVolume = volumeRef.current === 'boost' ? 'normal' : 'boost'
    volumeRef.current = next
    setVolumeState(next)
    setStaffVolume(next)
    try {
      localStorage.setItem(LS_ADMIN_VOLUME, next)
    } catch {
      /* ignore */
    }
    if (soundOnRef.current && armStaffSound(next)) {
      armedOnceRef.current = true
      setAudioArmed(true)
      unlockStaffAudioFallback()
      staffConfirmBeep()
    }
  }

  /** Keep the screen awake so background throttling never kills the chimes. */
  const toggleWake = () => {
    const next = !wakeOnRef.current
    wakeOnRef.current = next
    setWakeOn(next)
    try {
      localStorage.setItem(LS_ADMIN_WAKE, next ? 'on' : 'off')
    } catch {
      /* ignore */
    }
    if (next) {
      void requestWakeLock().then((ok) => {
        if (ok) toast.success('স্ক্রিন জাগিয়ে রাখা চালু — মোবাইলেও সাউন্ড নিশ্চিত (চার্জারে রাখুন)')
        else toast.error('এই ব্রাউজারে স্ক্রিন লক সাপোর্ট নেই')
      })
    } else {
      void releaseWakeLock()
      toast.info('স্ক্রিন জাগিয়ে রাখা বন্ধ করা হলো')
    }
  }

  useEffect(() => {
    api
      .get<{ loggedIn: boolean; kind?: 'main' | 'sub'; name?: string; permissions?: string[] }>('/api/admin/login')
      .then((res) => {
        if (res.ok && res.data?.loggedIn) {
          setSession({
            kind: res.data.kind === 'sub' ? 'sub' : 'main',
            name: res.data.name,
            permissions: res.data.permissions ?? ['*'],
          })
          setAuth('ready')
        } else {
          setAuth('login')
        }
      })
      .catch(() => setAuth('login'))
  }, [])

  const login = async () => {
    if (!passcode.trim()) return toast.error('পাসকোড বা কী দিন')
    setLoggingIn(true)
    const res = await api.post<{ kind: 'main' | 'sub'; name?: string; permissions?: string[] }>('/api/admin/login', { passcode })
    setLoggingIn(false)
    if (!res.ok || !res.data) return toast.error(res.error || 'লগইন ব্যর্থ')
    toast.success(
      res.data.kind === 'sub'
        ? `লগইন সফল — সাব-অ্যাডমিন${res.data.name ? ` (${res.data.name})` : ''}`
        : 'লগইন সফল!'
    )
    setSession({
      kind: res.data.kind === 'sub' ? 'sub' : 'main',
      name: res.data.name,
      permissions: res.data.permissions ?? ['*'],
    })
    setPasscode('')
    setAuth('ready')
  }

  const logout = async () => {
    await api.del('/api/admin/login')
    toast.success('লগআউট হয়েছে')
    setSession(null)
    setAuth('login')
  }

  const onAuthRequired = useCallback(() => {
    setAuth('login')
    setSession(null)
    toast.error('সেশন শেষ — আবার লগইন করুন')
  }, [])

  // ---- passcode screen ----
  if (auth !== 'ready') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-stone-100 p-4">
        {auth === 'checking' ? (
          <Loader2 className="h-8 w-8 animate-spin text-amber-500" />
        ) : (
          <Card className="w-full max-w-sm border-stone-200 shadow-xl">
            <CardContent className="space-y-5 p-8">
              <div className="text-center">
                <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 shadow-lg">
                  <KeyRound className="h-8 w-8 text-white" />
                </div>
                <h1 className="text-xl font-black text-stone-900">অ্যাডমিন প্যানেল</h1>
                <p className="mt-1 text-xs text-stone-500">মেইন পাসকোড অথবা সাব-অ্যাডমিন কী দিন</p>
              </div>
              <Input
                type="password"
                value={passcode}
                onChange={(e) => setPasscode(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && login()}
                placeholder="পাসকোড / কী (SA-…)"
                className="h-11 text-center tracking-widest"
                autoComplete="off"
              />
              <Button
                onClick={login}
                disabled={loggingIn}
                className="h-11 w-full bg-amber-500 font-black text-white hover:bg-amber-600"
              >
                {loggingIn ? <Loader2 className="h-5 w-5 animate-spin" /> : 'লগইন'}
              </Button>
              <p className="text-center text-[11px] leading-relaxed text-stone-400">
                সাব-অ্যাডমিন কী (SA-XXXX-XXXX) মেইন অ্যাডমিন অ্যাক্সেস কী ট্যাবে তৈরি করে।
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    )
  }

  // ---- panel ----
  const isMain = session?.kind === 'main'
  const subPerms = session?.permissions ?? []
  const canSee = (tabId: string) => isMain || subPerms.includes(tabId)
  // receipts uses the 'tables' perm; occasions uses the 'settings' perm
  const tabAllowed = (id: string) => {
    if (id === 'keys') return isMain
    if (id === 'receipts' || id === 'customers') return canSee('tables')
    if (id === 'occasions') return canSee('settings')
    return canSee(id)
  }
  const orderedTabs: [string, string][] = [
    ['overview', 'ওভারভিউ'],
    ['tables', 'টেবিল ও QR'],
    ['receipts', '🧾 রসিদ হিস্ট্রি'],
    ['customers', '👥 কাস্টমার'],
    ['menu', 'মেনু'],
    ['happy', 'হ্যাপি আওয়ার'],
    ['vouchers', 'ভাউচার'],
    ['occasions', '🎁 অকেশন অফার'],
    ['ledger', '🔒 সিকিউরিটি লেজার'],
    ['imgbb', 'ImgBB কি'],
    ['settings', 'সেটিংস'],
    ['keys', '🔑 অ্যাক্সেস কী'],
  ]
  const firstAllowed = orderedTabs.find(([id]) => tabAllowed(id))?.[0] ?? 'none'

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900">
      <style dangerouslySetInnerHTML={{ __html: SCROLL_CSS }} />

      <header className="sticky top-0 z-40 border-b border-stone-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3">
          <h1 className="text-lg font-black text-stone-900">⚙️ অ্যাডমিন প্যানেল</h1>
          <span className="hidden text-xs font-bold text-stone-400 sm:inline">Smart QR Restaurant</span>
          {session?.kind === 'sub' ? (
            <Badge className="bg-violet-100 text-[10px] text-violet-800 hover:bg-violet-100">
              🛡️ সাব-অ্যাডমিন{session.name ? ` — ${session.name}` : ''}
            </Badge>
          ) : (
            <Badge className="bg-amber-100 text-[10px] text-amber-800 hover:bg-amber-100">👑 মেইন অ্যাডমিন</Badge>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={toggleVolume}
            className="border-stone-300 font-bold"
            title={volume === 'boost' ? 'ভলিউম: বুস্ট (জোরে) — ট্যাপ করে নরমাল করুন' : 'ভলিউম: নরমাল — ট্যাপ করে বুস্ট করুন'}
          >
            {volume === 'boost' ? '🔊' : '🔉'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={toggleSound}
            className="border-stone-300 font-bold"
            title={soundOn ? 'সাউন্ড বন্ধ করুন (নতুন অর্ডার/কলে চিম)' : 'সাউন্ড চালু করুন'}
          >
            {soundOn ? <Bell className="h-4 w-4 text-amber-500" /> : <BellOff className="h-4 w-4 text-stone-400" />}
          </Button>
          {wakeLockSupported() && (
            <Button
              size="sm"
              variant="outline"
              onClick={toggleWake}
              className="border-stone-300 font-bold"
              title={
                wakeOn
                  ? 'স্ক্রিন জাগিয়ে রাখা চালু — বন্ধ করতে ট্যাপ করুন'
                  : 'স্ক্রিন জাগিয়ে রাখুন — স্ক্রিন বন্ধ থাকলে মোবাইলে সাউন্ড/আপডেট আসে না'
              }
            >
              {wakeOn ? <Lightbulb className="h-4 w-4 text-amber-500" /> : <LightbulbOff className="h-4 w-4 text-stone-400" />}
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={logout}
            className="ml-auto border-stone-300 font-bold text-stone-600 hover:bg-red-50 hover:text-red-600"
          >
            <LogOut className="h-4 w-4" /> লগআউট
          </Button>
        </div>
      </header>

      {/* mobile audio needs ONE real tap to unlock — scroll-only usage never
          taps, so this banner forces it; tap plays a loud test chime */}
      {soundOn && !audioArmed && (
        <button
          onClick={enableAudioNow}
          className="flex w-full items-center justify-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-sm font-bold text-amber-900 transition-colors hover:bg-amber-100"
        >
          <Bell className="h-4 w-4 shrink-0 text-amber-600" />
          নতুন অর্ডার / স্ট্যাটাসের 🔊 সাউন্ড চালু করতে এখানে ট্যাপ করুন
        </button>
      )}

      <main className="mx-auto max-w-7xl px-4 pb-16 pt-4">
        {firstAllowed === 'none' ? (
          <Card className="mt-10 border-stone-200">
            <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
              <AlertTriangle className="h-10 w-10 text-amber-500" />
              <p className="text-sm font-bold text-stone-700">আপনার কীতে কোনো অনুমতি মার্ক করা নেই</p>
              <p className="max-w-sm text-xs leading-relaxed text-stone-500">
                মেইন অ্যাডমিনের সাথে যোগাযোগ করুন — তিনি 🔑 অ্যাক্সেস কী ট্যাব থেকে আপনার কীতে অনুমতি যোগ করে দিতে পারবেন।
              </p>
              <Button variant="outline" onClick={logout} className="border-stone-300 font-bold">
                <LogOut className="h-4 w-4" /> লগআউট
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Tabs defaultValue={firstAllowed}>
            <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto rounded-none border-b border-stone-200 bg-transparent p-0">
              {orderedTabs
                .filter(([id]) => tabAllowed(id))
                .map(([value, label]) => (
                  <TabsTrigger
                    key={value}
                    value={value}
                    className="shrink-0 whitespace-nowrap rounded-none border-b-2 border-transparent px-4 py-2.5 font-bold text-stone-500 data-[state=active]:border-amber-500 data-[state=active]:bg-transparent data-[state=active]:text-amber-700 data-[state=active]:shadow-none"
                  >
                    {label}
                  </TabsTrigger>
                ))}
            </TabsList>

            <TabsContent value="overview" className="mt-4">
              <OverviewTab onAuthRequired={onAuthRequired} />
            </TabsContent>
            <TabsContent value="tables" className="mt-4">
              <TablesTab onAuthRequired={onAuthRequired} />
            </TabsContent>
            <TabsContent value="receipts" className="mt-4">
              <ReceiptsTab onAuthRequired={onAuthRequired} />
            </TabsContent>
            <TabsContent value="customers" className="mt-4">
              <CustomersTab onAuthRequired={onAuthRequired} />
            </TabsContent>
            <TabsContent value="menu" className="mt-4">
              <MenuTab onAuthRequired={onAuthRequired} />
            </TabsContent>
            <TabsContent value="happy" className="mt-4">
              <HappyHourTab onAuthRequired={onAuthRequired} />
            </TabsContent>
            <TabsContent value="vouchers" className="mt-4">
              <VouchersTab onAuthRequired={onAuthRequired} />
            </TabsContent>
            <TabsContent value="occasions" className="mt-4">
              <OccasionsTab onAuthRequired={onAuthRequired} />
            </TabsContent>
            <TabsContent value="ledger" className="mt-4">
              <LedgerTab onAuthRequired={onAuthRequired} />
            </TabsContent>
            <TabsContent value="imgbb" className="mt-4">
              <ImgbbTab onAuthRequired={onAuthRequired} />
            </TabsContent>
            <TabsContent value="settings" className="mt-4">
              <SettingsTab onAuthRequired={onAuthRequired} />
            </TabsContent>
            {isMain && (
              <TabsContent value="keys" className="mt-4">
                <AccessKeysTab onAuthRequired={onAuthRequired} />
              </TabsContent>
            )}
          </Tabs>
        )}
      </main>
    </div>
  )
}
