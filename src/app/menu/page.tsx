'use client'

// Customer Menu — the core ordering page.
// Session gate → sticky brand bar (logo + name + table + countdown + glowing
// "আমার অর্ডার") → happy-hour banner → sticky category chips (emoji + counts,
// ALL chip) + live search → responsive item grid (1/2/3 cols) → item dialog
// (big X, rich descriptions, conditional special note) → upsell drawer →
// waiter popover → floating "অর্ডার প্লেস করুন" bar → live "my orders" sheet
// with animated stepper + status sounds.
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import Link from 'next/link'
import {
  Check,
  Clock,
  ConciergeBell,
  Flame,
  Loader2,
  Minus,
  Plus,
  ReceiptText,
  Search,
  ShoppingCart,
  UtensilsCrossed,
  WifiOff,
  X,
} from 'lucide-react'
import { toast } from 'sonner'

import { api } from '@/lib/client'
import { armAudio, playStatusSound } from '@/lib/customer-sound'
import { toBn } from '@/lib/bn'
import { taka } from '@/lib/constants'
import { cn } from '@/lib/utils'
import { useCart, unitPrice, type CartItem } from '@/store/cart'
import { useRealtime } from '@/hooks/use-realtime'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Separator } from '@/components/ui/separator'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { SessionExpiredScreen } from '@/components/customer/session-expired'
import { ItemThumb } from '@/components/customer/item-thumb'
import { descriptionPreview, ItemDescription } from '@/components/customer/item-description'
import { DeveloperCredit } from '@/components/customer/developer-credit'
import { useSiteConfig } from '@/components/customer/site-config'

/* ─────────────────────────── types ─────────────────────────── */

interface MenuAddon {
  name: string
  price: number
}

interface MenuItemData {
  id: string
  name: string
  description: string | null
  basePrice: number
  price: number
  imageUrl: string | null
  isAvailable: boolean
  isSetMenu: boolean
  spiceLevels: string[]
  addons: MenuAddon[]
  upsellIds: string[]
  happyHour: { active: boolean; percent: number; name: string } | null
}

interface MenuCategory {
  id: string
  name: string
  imageUrl: string | null
  items: MenuItemData[]
}

interface MenuData {
  categories: MenuCategory[]
  happyHourBanner: string | null
}

interface SessionInfo {
  valid: boolean
  tableNumber: number | null
  expiresAt: string | null
  minutesLeft: number
}

interface LiveOrderItem {
  itemName: string
  quantity: number
  spiceLevel: string | null
  addons: MenuAddon[]
  specialNote: string | null
  lineTotal: number
}

interface LiveOrder {
  id: string
  orderNo: number
  status: string
  subtotal: number
  total: number
  placedAt: string
  items: LiveOrderItem[]
}

const STATUS_STEPS = [
  { key: 'PLACED', label: 'প্লেসড', emoji: '🧾' },
  { key: 'COOKING', label: 'রান্নায়', emoji: '🔥' },
  { key: 'READY', label: 'রেডি', emoji: '✅' },
  { key: 'SERVED', label: 'সার্ভড', emoji: '🍽️' },
] as const

const WAITER_OPTIONS = [
  { type: 'WAITER' as const, label: '👷 ওয়েটার ডাকুন' },
  { type: 'WATER' as const, label: '💧 পানি দরকার' },
  { type: 'CLEAN' as const, label: '🧹 টেবিল পরিষ্কার' },
]

// warm category accent palette (no indigo/blue)
const ACCENTS = [
  'bg-amber-100/95 text-amber-800',
  'bg-orange-100/95 text-orange-800',
  'bg-emerald-100/95 text-emerald-800',
  'bg-rose-100/95 text-rose-800',
  'bg-teal-100/95 text-teal-800',
  'bg-lime-100/95 text-lime-800',
]

const ALL_CAT = '__all__'

// hydration-safe flag: false during SSR + first client render, true after hydration
const emptySubscribe = () => () => {}

/* ─────────────────────── small components ─────────────────────── */

function BrandLogo({ logoUrl, name }: { logoUrl: string | null; name: string }) {
  const [err, setErr] = useState(false)
  if (logoUrl && !err) {
    return (
      <img
        src={logoUrl}
        alt={`${name} লোগো`}
        onError={() => setErr(true)}
        className="size-8 shrink-0 rounded-full object-cover ring-1 ring-amber-200"
      />
    )
  }
  return <UtensilsCrossed className="size-5 shrink-0 text-amber-600" />
}

function StatusStepper({ status }: { status: string }) {
  if (status === 'CANCELLED') {
    return (
      <div className="flex items-center justify-center">
        <Badge className="border-red-200 bg-red-50 text-red-700">বাতিল হয়েছে</Badge>
      </div>
    )
  }

  const rawIdx = STATUS_STEPS.findIndex((s) => s.key === status)
  const currentIdx = status === 'COMPLETED' ? STATUS_STEPS.length : rawIdx

  return (
    <div className="flex items-start">
      {STATUS_STEPS.map((step, i) => {
        const done = i < currentIdx
        const current = i === currentIdx
        return (
          <Fragment key={step.key}>
            {i > 0 && (
              <div className="mt-[14px] h-1 flex-1 overflow-hidden rounded-full bg-stone-200">
                {i <= currentIdx && (
                  <div
                    className={cn(
                      'h-full w-full rounded-full bg-gradient-to-r',
                      current ? 'animate-pulse from-emerald-400 to-amber-400' : 'from-emerald-400 to-emerald-500'
                    )}
                  />
                )}
              </div>
            )}
            <div className="flex w-14 flex-col items-center gap-1.5">
              <div className="relative flex size-8 items-center justify-center">
                {current && (
                  <span
                    aria-hidden
                    className="absolute inline-flex size-full animate-ping rounded-full bg-amber-400 opacity-40"
                  />
                )}
                <span
                  className={cn(
                    'relative flex size-8 items-center justify-center rounded-full transition-all duration-300',
                    done && 'bg-emerald-500 text-white shadow-sm shadow-emerald-200',
                    current &&
                      'scale-110 bg-amber-500 text-white shadow-md shadow-amber-300/70 ring-4 ring-amber-100',
                    !done && !current && 'border-2 border-stone-200 bg-white text-stone-300'
                  )}
                >
                  {done ? (
                    <Check className="size-4" strokeWidth={3} />
                  ) : current ? (
                    <span className="animate-bounce text-base leading-none">{step.emoji}</span>
                  ) : (
                    <span className="text-[10px] font-bold">{i + 1}</span>
                  )}
                </span>
              </div>
              <span
                className={cn(
                  'text-center text-[10px] font-semibold leading-none',
                  done ? 'text-emerald-700' : current ? 'text-amber-700' : 'text-stone-400'
                )}
              >
                {step.label}
              </span>
            </div>
          </Fragment>
        )
      })}
    </div>
  )
}

function MenuCard({
  item,
  categoryName,
  accentIdx,
  onOpen,
}: {
  item: MenuItemData
  categoryName: string
  accentIdx: number
  onOpen: () => void
}) {
  const unavailable = !item.isAvailable
  const preview = useMemo(() => descriptionPreview(item.description), [item.description])

  return (
    <Card
      className={cn(
        'group gap-0 overflow-hidden rounded-2xl border-stone-200/80 p-0 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-amber-100/70',
        unavailable && 'opacity-75 grayscale'
      )}
    >
      <button
        onClick={onOpen}
        disabled={unavailable}
        className="block w-full text-left disabled:cursor-not-allowed"
      >
        <div className="relative aspect-square w-full overflow-hidden sm:aspect-[4/3]">
          <ItemThumb
            src={item.imageUrl}
            alt={item.name}
            className="size-full transition-transform duration-500 group-hover:scale-[1.03]"
          />
          {/* bottom scrim so chips stay legible on light photos */}
          <div aria-hidden className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-black/40 to-transparent" />

          {item.happyHour && !unavailable && (
            <span className="absolute left-2.5 top-2.5 flex items-center gap-1 rounded-full bg-gradient-to-r from-amber-500 to-orange-600 px-2.5 py-1 text-[11px] font-extrabold text-white shadow-md shadow-orange-500/40">
              🔥 -{item.happyHour.percent}%
            </span>
          )}
          {item.isSetMenu && !unavailable && (
            <span className="absolute right-2.5 top-2.5 rounded-full bg-white/95 px-2.5 py-1 text-[10px] font-bold text-stone-800 shadow ring-1 ring-stone-200 backdrop-blur">
              🍱 সেট মেনু
            </span>
          )}
          <span
            className={cn(
              'absolute bottom-2 left-2.5 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold backdrop-blur',
              ACCENTS[accentIdx % ACCENTS.length]
            )}
          >
            <span aria-hidden className="size-1.5 rounded-full bg-current opacity-70" />
            {categoryName}
          </span>

          {unavailable && (
            <span className="absolute inset-0 flex items-center justify-center bg-stone-950/45">
              <span className="rounded-full bg-white/95 px-3.5 py-1.5 text-xs font-extrabold tracking-wide text-stone-800 shadow">
                স্টক শেষ
              </span>
            </span>
          )}
        </div>

        <CardContent className="space-y-1 p-2.5 sm:space-y-1.5 sm:p-3.5">
          <h3 className="line-clamp-1 text-sm font-bold text-stone-900 sm:text-base">{item.name}</h3>
          <p className="line-clamp-2 hidden min-h-8 text-xs leading-relaxed text-stone-500 sm:block">
            {preview || ' '}
          </p>
          <div className="flex items-center justify-between gap-1.5 pt-0.5">
            <div className="flex min-w-0 items-baseline gap-1.5">
              {item.happyHour && (
                <span className="truncate text-[11px] text-stone-400 line-through sm:text-xs">{taka(item.basePrice)}</span>
              )}
              <span
                className={cn(
                  'truncate text-base font-extrabold sm:text-lg',
                  item.happyHour ? 'text-amber-600' : 'text-stone-900'
                )}
              >
                {taka(item.price)}
              </span>
            </div>
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-amber-500/10 text-amber-700 transition group-hover:bg-amber-500 group-hover:text-white sm:size-8">
              <Plus className="size-4" />
            </span>
          </div>
        </CardContent>
      </button>
    </Card>
  )
}

function ItemDialog({
  item,
  open,
  onOpenChange,
  onAdd,
  specialNoteEnabled,
}: {
  item: MenuItemData | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onAdd: (payload: Omit<CartItem, 'cartId'>, source: MenuItemData) => void
  specialNoteEnabled: boolean
}) {
  return (
    <Dialog open={open && !!item} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="max-h-[92vh] gap-0 overflow-y-auto p-0 sm:max-w-lg"
      >
        {/* Radix unmounts the content when closed → ItemCustomizer remounts
            fresh on every open, so customization state self-resets. */}
        {open && item && (
          <ItemCustomizer
            key={item.id}
            item={item}
            onAdd={onAdd}
            onClose={() => onOpenChange(false)}
            specialNoteEnabled={specialNoteEnabled}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function ItemCustomizer({
  item,
  onAdd,
  onClose,
  specialNoteEnabled,
}: {
  item: MenuItemData
  onAdd: (payload: Omit<CartItem, 'cartId'>, source: MenuItemData) => void
  onClose: () => void
  specialNoteEnabled: boolean
}) {
  // fresh state on every mount (dialog open) — spice defaults to the first level
  const [spice, setSpice] = useState(item.spiceLevels[0] ?? '')
  const [chosenAddons, setChosenAddons] = useState<string[]>([])
  const [note, setNote] = useState('')
  const [qty, setQty] = useState(1)

  const addonSum = item.addons
    .filter((a) => chosenAddons.includes(a.name))
    .reduce((s, a) => s + a.price, 0)
  const total = (item.price + addonSum) * qty

  function toggleAddon(name: string, checked: boolean) {
    setChosenAddons((prev) => (checked ? [...prev, name] : prev.filter((n) => n !== name)))
  }

  function handleAdd() {
    onAdd(
      {
        itemId: item.id,
        name: item.name,
        basePrice: item.basePrice,
        price: item.price,
        imageUrl: item.imageUrl,
        quantity: qty,
        spiceLevel: spice || null,
        addons: item.addons
          .filter((a) => chosenAddons.includes(a.name))
          .map((a) => ({ name: a.name, price: a.price })),
        specialNote: note.trim(),
      },
      item
    )
  }

  return (
    <div className="flex flex-col">
      {/* BIG highlighted close button — sticky so it stays visible */}
      <div className="pointer-events-none sticky top-0 z-50 h-0">
        <div className="flex justify-end p-3">
          <button
            onClick={onClose}
            aria-label="বন্ধ করুন"
            className="pointer-events-auto flex size-9 items-center justify-center rounded-full bg-stone-900/80 text-white shadow-lg shadow-stone-900/30 backdrop-blur transition-all duration-200 hover:rotate-90 hover:bg-stone-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
          >
            <X className="size-5" strokeWidth={2.5} />
          </button>
        </div>
      </div>

      {/* Compact friendly header — small glowing thumb + name/price beside it.
          The photo no longer covers the whole dialog; options are instantly
          visible on both mobile and desktop. */}
      <div className="flex items-start gap-3.5 px-4 pt-3 sm:px-5 sm:pt-4">
        <div className="relative shrink-0">
          <div className="rounded-2xl bg-gradient-to-br from-amber-300 via-orange-200 to-amber-100 p-[3px] shadow-lg shadow-amber-200/60">
            <div className="size-24 overflow-hidden rounded-[13px] sm:size-28">
              <ItemThumb src={item.imageUrl} alt={item.name} className="size-full" />
            </div>
          </div>
          {item.happyHour && (
            <span className="absolute -left-1.5 -top-2 flex items-center gap-1 rounded-full bg-gradient-to-r from-amber-500 to-orange-600 px-2 py-0.5 text-[10px] font-extrabold text-white shadow-md shadow-orange-500/40">
              🔥 -{item.happyHour.percent}%
            </span>
          )}
          {item.isSetMenu && (
            <span className="absolute -bottom-2 left-1/2 whitespace-nowrap rounded-full bg-white/95 px-2 py-0.5 text-[9px] font-bold text-stone-800 shadow ring-1 ring-stone-200">
              🍱 সেট মেনু
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-1.5 pt-1">
          <DialogTitle className="text-lg font-bold leading-snug text-stone-900">
            {item.name}
          </DialogTitle>
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            {item.happyHour && (
              <span className="text-sm text-stone-400 line-through">{taka(item.basePrice)}</span>
            )}
            <span
              className={cn(
                'text-xl font-extrabold',
                item.happyHour ? 'text-amber-600' : 'text-stone-900'
              )}
            >
              {taka(item.price)}
            </span>
            {item.happyHour && (
              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700 ring-1 ring-amber-200">
                {item.happyHour.name}
              </span>
            )}
          </div>
          {item.happyHour && item.basePrice > item.price && (
            <p className="text-xs font-bold text-emerald-600">
              ✅ আপনি বাঁচাচ্ছেন {taka(item.basePrice - item.price)}
            </p>
          )}
        </div>
      </div>

      <div className="space-y-4 p-4 sm:p-5">
        {item.description && (
          <DialogDescription asChild>
            <div>
              <ItemDescription description={item.description} />
            </div>
          </DialogDescription>
        )}

        {item.spiceLevels.length > 0 && (
          <div className="space-y-2">
            <Label className="text-sm font-semibold text-stone-700">🌶️ মসলার পরিমাণ</Label>
            <RadioGroup value={spice} onValueChange={setSpice} className="flex flex-wrap gap-2">
              {item.spiceLevels.map((lvl) => (
                <Label
                  key={lvl}
                  htmlFor={`spice-${item.id}-${lvl}`}
                  className={cn(
                    'flex cursor-pointer items-center gap-2 rounded-full border px-3.5 py-2 text-sm font-medium transition',
                    spice === lvl
                      ? 'border-amber-500 bg-amber-50 text-amber-700'
                      : 'border-stone-200 bg-white text-stone-600 hover:border-amber-300'
                  )}
                >
                  <RadioGroupItem value={lvl} id={`spice-${item.id}-${lvl}`} className="size-3.5" />
                  {lvl}
                </Label>
              ))}
            </RadioGroup>
          </div>
        )}

        {item.addons.length > 0 && (
          <div className="space-y-2">
            <Label className="text-sm font-semibold text-stone-700">➕ অ্যাড-অন</Label>
            <div className="grid gap-2">
              {item.addons.map((a) => {
                const checked = chosenAddons.includes(a.name)
                return (
                  <Label
                    key={a.name}
                    htmlFor={`addon-${item.id}-${a.name}`}
                    className={cn(
                      'flex cursor-pointer items-center justify-between rounded-lg border px-3 py-2.5 text-sm transition',
                      checked ? 'border-amber-400 bg-amber-50' : 'border-stone-200 bg-white'
                    )}
                  >
                    <span className="flex items-center gap-2.5 font-medium text-stone-700">
                      <Checkbox
                        id={`addon-${item.id}-${a.name}`}
                        checked={checked}
                        onCheckedChange={(v) => toggleAddon(a.name, v === true)}
                        className="data-[state=checked]:border-amber-500 data-[state=checked]:bg-amber-500"
                      />
                      {a.name}
                    </span>
                    <span className="text-xs font-semibold text-amber-700">+{taka(a.price)}</span>
                  </Label>
                )
              })}
            </div>
          </div>
        )}

        {/* special note — only when the restaurant enables it */}
        {specialNoteEnabled && (
          <div className="space-y-2">
            <Label htmlFor="special-note" className="text-sm font-semibold text-stone-700">
              📝 স্পেশাল নোট
            </Label>
            <Textarea
              id="special-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="শেফের জন্য নোট (যেমন: পেঁয়াজ ছাড়া)"
              rows={2}
              maxLength={200}
              className="resize-none border-stone-200 focus-visible:ring-amber-200"
            />
          </div>
        )}

        <div className="space-y-3 border-t border-stone-100 pt-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-stone-600">পরিমাণ</span>
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                size="icon"
                className="size-8 border-stone-200"
                onClick={() => setQty((q) => Math.max(1, q - 1))}
                disabled={qty <= 1}
                aria-label="কমান"
              >
                <Minus className="size-3.5" />
              </Button>
              <span className="w-6 text-center text-base font-bold text-stone-800">{qty}</span>
              <Button
                variant="outline"
                size="icon"
                className="size-8 border-stone-200"
                onClick={() => setQty((q) => Math.min(50, q + 1))}
                aria-label="বাড়ান"
              >
                <Plus className="size-3.5" />
              </Button>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3">
            <div>
              <span className="text-[11px] text-stone-400">মোট মূল্য</span>
              <div className="text-xl font-extrabold text-amber-600">{taka(total)}</div>
            </div>
            <Button
              onClick={handleAdd}
              className="h-11 flex-1 bg-gradient-to-r from-amber-500 to-orange-600 text-base font-bold text-white shadow-md shadow-amber-200 transition hover:from-amber-600 hover:to-orange-700"
            >
              <ShoppingCart className="size-4" />
              কার্টে যোগ করুন
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ─────────────────────────── page ─────────────────────────── */

export default function MenuPage() {
  const cfg = useSiteConfig()
  const restaurantName = cfg?.restaurantName || 'Smart QR Restaurant'
  const specialNoteEnabled = cfg?.specialNoteEnabled === true

  // session
  const [phase, setPhase] = useState<'loading' | 'ready' | 'expired' | 'error'>('loading')
  const [tableNumber, setTableNumber] = useState<number | null>(null)
  const [expiresAt, setExpiresAt] = useState<string | null>(null)
  const [minutesLeft, setMinutesLeft] = useState(0)

  // menu
  const [menu, setMenu] = useState<MenuData | null>(null)
  const [menuLoading, setMenuLoading] = useState(true)
  const [menuError, setMenuError] = useState<string | null>(null)
  const [activeCatId, setActiveCatId] = useState<string>(ALL_CAT)
  const [search, setSearch] = useState('')

  // item dialog + upsell
  const [dialogItem, setDialogItem] = useState<MenuItemData | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [upsellSource, setUpsellSource] = useState<MenuItemData | null>(null)
  // per-item count of upsell adds in this drawer session — drives the "✓ যোগ হয়েছে" feedback
  const [addedUpsell, setAddedUpsell] = useState<Record<string, number>>({})

  // waiter
  const [waiterOpen, setWaiterOpen] = useState(false)
  const [waiterBusy, setWaiterBusy] = useState<string | null>(null)

  // orders sheet
  const [ordersOpen, setOrdersOpen] = useState(false)
  const [orders, setOrders] = useState<LiveOrder[] | null>(null)
  const [ordersLoading, setOrdersLoading] = useState(false)

  // cart
  const items = useCart((s) => s.items)
  const addItem = useCart((s) => s.addItem)
  const mounted = useSyncExternalStore(emptySubscribe, () => true, () => false)

  const cartCount = useMemo(() => items.reduce((n, i) => n + i.quantity, 0), [items])
  const cartSubtotal = useMemo(
    () => items.reduce((s, i) => s + unitPrice(i) * i.quantity, 0),
    [items]
  )

  // previous statuses for transition sound detection
  const prevStatusRef = useRef<Map<string, string> | null>(null)
  const chipRefs = useRef(new Map<string, HTMLButtonElement>())

  /* ---- data fetching ---- */

  const fetchSession = useCallback(async () => {
    const res = await api.get<SessionInfo>('/api/session')
    if (!res.ok || !res.data) {
      setPhase('error')
      return
    }
    if (res.data.valid && res.data.tableNumber != null) {
      setTableNumber(res.data.tableNumber)
      setExpiresAt(res.data.expiresAt)
      setMinutesLeft(res.data.minutesLeft)
      setPhase('ready')
    } else {
      setPhase('expired')
    }
  }, [])

  const fetchMenu = useCallback(async () => {
    setMenuLoading(true)
    setMenuError(null)
    const res = await api.get<MenuData>('/api/menu')
    if (res.ok && res.data) {
      setMenu(res.data)
    } else {
      setMenuError(res.error || 'মেনু লোড করা যায়নি')
    }
    setMenuLoading(false)
  }, [])

  const fetchOrders = useCallback(async () => {
    setOrdersLoading(true)
    const res = await api.get<{ orders: LiveOrder[] }>('/api/orders')
    setOrdersLoading(false)
    if (res.ok && res.data) {
      const next = res.data.orders
      const prev = prevStatusRef.current
      // status transition detected between polls → play the status sound
      if (prev) {
        for (const o of next) {
          const before = prev.get(o.id)
          if (before && before !== o.status) playStatusSound(o.status)
        }
      }
      prevStatusRef.current = new Map(next.map((o) => [o.id, o.status]))
      setOrders(next)
    } else if (res.code === 'SESSION_INVALID') {
      setPhase('expired')
    }
  }, [])

  // initial load — session + menu fetch run in PARALLEL, orders after session OK
  useEffect(() => {
    ;(async () => {
      // menu is public → fetch in PARALLEL with the session check
      // (one round-trip saved on every scan = noticeably faster first paint)
      fetchMenu()
      const res = await api.get<SessionInfo>('/api/session')
      if (!res.ok || !res.data) {
        setPhase('error')
        return
      }
      if (res.data.valid && res.data.tableNumber != null) {
        setTableNumber(res.data.tableNumber)
        setExpiresAt(res.data.expiresAt)
        setMinutesLeft(res.data.minutesLeft)
        setPhase('ready')
        fetchOrders()
      } else {
        setPhase('expired')
      }
    })()
  }, [fetchMenu, fetchOrders])

  // countdown — refresh every 30s; re-validate the session when it hits zero
  useEffect(() => {
    if (!expiresAt) return
    const t = setInterval(() => {
      const m = Math.max(0, Math.round((new Date(expiresAt).getTime() - Date.now()) / 60000))
      setMinutesLeft(m)
      if (m <= 0) fetchSession()
    }, 30000)
    return () => clearInterval(t)
  }, [expiresAt, fetchSession])

  // live orders — 5s while sheet open; 20s background poll keeps the
  // "আমার অর্ডার" glow + bill button fresh
  useEffect(() => {
    if (phase !== 'ready') return
    const t = setInterval(fetchOrders, ordersOpen ? 5000 : 20000)
    return () => clearInterval(t)
  }, [phase, ordersOpen, fetchOrders])

  // realtime — order status + table cleared
  useRealtime(
    {
      'order:status': () => {
        fetchOrders()
      },
      'table:cleared': () => {
        fetchSession()
      },
    },
    5000,
    () => {
      if (ordersOpen) fetchOrders()
    }
  )

  // keep the active chip visible while scrolling the chip bar
  useEffect(() => {
    const el = chipRefs.current.get(activeCatId)
    el?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
  }, [activeCatId])

  /* ---- derived ---- */

  const activeCategory = useMemo(
    () => menu?.categories.find((c) => c.id === activeCatId) ?? null,
    [menu, activeCatId]
  )

  const totalItems = useMemo(
    () => menu?.categories.reduce((n, c) => n + c.items.length, 0) ?? 0,
    [menu]
  )

  const query = search.trim().toLowerCase()
  const searchMode = query.length > 0
  const searchResults = useMemo(() => {
    if (!searchMode || !menu) return []
    return menu.categories.flatMap((c) =>
      c.items.filter(
        (i) =>
          i.name.toLowerCase().includes(query) ||
          descriptionPreview(i.description).toLowerCase().includes(query)
      )
    )
  }, [searchMode, query, menu])

  const menuMap = useMemo(() => {
    const map = new Map<string, MenuItemData>()
    menu?.categories.forEach((c) => c.items.forEach((i) => map.set(i.id, i)))
    return map
  }, [menu])

  const upsellItems = useMemo(() => {
    if (!upsellSource) return []
    return upsellSource.upsellIds
      .map((id) => menuMap.get(id))
      .filter((i): i is MenuItemData => Boolean(i) && i!.isAvailable)
  }, [upsellSource, menuMap])

  const activeCount = useMemo(
    () =>
      orders?.filter((o) => o.status !== 'COMPLETED' && o.status !== 'CANCELLED').length ?? 0,
    [orders]
  )
  const nonCancelledCount = useMemo(
    () => orders?.filter((o) => o.status !== 'CANCELLED').length ?? 0,
    [orders]
  )

  const catIndex = useMemo(() => {
    const m = new Map<string, number>()
    menu?.categories.forEach((c, i) => m.set(c.id, i))
    return m
  }, [menu])

  /* ---- actions ---- */

  function openItem(item: MenuItemData) {
    armAudio() // any tap may precede a status sound — keep audio unlocked
    setDialogItem(item)
    setDialogOpen(true)
  }

  function handleAddToCart(payload: Omit<CartItem, 'cartId'>, source: MenuItemData) {
    addItem(payload)
    toast.success('কার্টে যোগ হয়েছে')
    setDialogOpen(false)
    // UPSELL ENGINE — offer pairings right after adding
    if (source.upsellIds.length > 0) {
      setAddedUpsell({}) // fresh count for this drawer session
      setUpsellSource(source)
    }
  }

  function quickAddUpsell(u: MenuItemData) {
    addItem({
      itemId: u.id,
      name: u.name,
      basePrice: u.basePrice,
      price: u.price,
      imageUrl: u.imageUrl,
      quantity: 1,
      spiceLevel: u.spiceLevels[0] ?? null,
      addons: [],
      specialNote: '',
    })
    // CLEAR visual feedback — button turns green "✓ যোগ হয়েছে (n)" so the
    // customer immediately SEES the item was added (was only a toast before)
    setAddedUpsell((p) => ({ ...p, [u.id]: (p[u.id] || 0) + 1 }))
    toast.success(`"${u.name}" কার্টে যোগ হয়েছে`)
  }

  async function sendWaiterSignal(type: 'WAITER' | 'WATER' | 'CLEAN') {
    setWaiterBusy(type)
    const res = await api.post('/api/waiter', { type })
    setWaiterBusy(null)
    if (res.ok) {
      setWaiterOpen(false)
      toast.success('সিগন্যাল পাঠানো হয়েছে!')
    } else if (res.code === 'SESSION_INVALID') {
      setPhase('expired')
    } else {
      toast.error(res.error || 'সিগন্যাল পাঠানো যায়নি')
    }
  }

  /* ---- render gates ---- */

  if (phase === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-stone-50">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="size-9 animate-spin text-amber-500" />
          <p className="text-sm font-medium text-stone-500">লোড হচ্ছে…</p>
        </div>
      </div>
    )
  }

  if (phase === 'expired') return <SessionExpiredScreen />

  if (phase === 'error') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-stone-50 p-4">
        <Card className="w-full max-w-sm border-amber-200 text-center shadow-lg">
          <CardContent className="flex flex-col items-center gap-4 py-10">
            <WifiOff className="size-10 text-amber-500" />
            <p className="font-bold text-stone-800">সংযোগ করা যায়নি</p>
            <p className="text-sm text-stone-500">ইন্টারনেট চেক করে আবার চেষ্টা করুন</p>
            <Button
              onClick={() => {
                setPhase('loading')
                fetchSession().then(() => fetchMenu())
              }}
              className="bg-amber-500 font-bold text-white hover:bg-amber-600"
            >
              আবার চেষ্টা করুন
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  /* ---- main render ---- */

  return (
    <div className="flex min-h-screen flex-col bg-stone-50">
      {/* ── sticky brand bar ── */}
      <div className="sticky top-0 z-40 border-b border-amber-100 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-2 px-3 sm:px-4">
          <BrandLogo logoUrl={cfg?.logoUrl ?? null} name={restaurantName} />
          <span className="truncate font-bold text-stone-900">{restaurantName}</span>
          <Badge className="shrink-0 border border-amber-200 bg-amber-50 text-amber-800">
            টেবিল {tableNumber}
          </Badge>
          <span className="hidden min-[430px]:inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
            <Clock className="size-3" />
            {minutesLeft} মিনিট বাকি
          </span>

          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setOrdersOpen(true)}
              className={cn(
                'relative border-amber-200 bg-white text-amber-700 hover:bg-amber-50 hover:text-amber-800',
                mounted &&
                  activeCount > 0 &&
                  'border-emerald-300 bg-emerald-50/70 text-emerald-800 shadow-[0_0_14px_rgba(16,185,129,0.4)] hover:bg-emerald-50 hover:text-emerald-900'
              )}
            >
              <ReceiptText className="size-4" />
              <span className="hidden sm:inline">আমার অর্ডার</span>
              {mounted && activeCount > 0 && (
                <span className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center">
                  <span
                    aria-hidden
                    className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75"
                  />
                  <span className="relative flex size-5 items-center justify-center rounded-full bg-emerald-500 text-[10px] font-extrabold text-white shadow">
                    {activeCount}
                  </span>
                </span>
              )}
            </Button>
            <Link
              href="/cart"
              aria-label="কার্ট"
              className="relative inline-flex size-9 items-center justify-center rounded-md border border-amber-200 bg-white text-amber-700 transition hover:bg-amber-50"
            >
              <ShoppingCart className="size-4" />
              {mounted && cartCount > 0 && (
                <span className="absolute -right-1.5 -top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-white">
                  {cartCount}
                </span>
              )}
            </Link>
          </div>
        </div>
      </div>

      {/* ── happy hour banner ── */}
      {menu?.happyHourBanner && (
        <div className="relative overflow-hidden bg-gradient-to-r from-amber-500 via-orange-500 to-amber-500 py-2.5 text-center">
          <div aria-hidden className="absolute inset-0 animate-pulse bg-white/10" />
          <p className="relative flex items-center justify-center gap-2 px-3 text-sm font-extrabold text-white drop-shadow-sm">
            <Flame className="size-4 shrink-0 animate-bounce" />
            {menu.happyHourBanner}
          </p>
        </div>
      )}

      {/* ── sticky category chips + search ── */}
      <div className="sticky top-14 z-30 border-b border-amber-100 bg-stone-50/95 backdrop-blur">
        <div className="mx-auto w-full max-w-6xl px-3 sm:px-4">
          <div className="relative pt-2.5">
            <Search className="pointer-events-none absolute left-3 top-[calc(0.625rem+9px)] size-4 -translate-y-1/2 text-stone-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="খাবার খুঁজুন… (যেমন: বিরিয়ানি)"
              aria-label="মেনু খুঁজুন"
              className="h-9 border-stone-200 bg-white pl-9 pr-8 text-sm focus-visible:ring-amber-200"
            />
            {searchMode && (
              <button
                onClick={() => setSearch('')}
                aria-label="খোঁজা মুছুন"
                className="absolute right-2.5 top-[calc(0.625rem+9px)] flex size-5 -translate-y-1/2 items-center justify-center rounded-full bg-stone-200 text-stone-500 transition hover:bg-stone-300"
              >
                <X className="size-3" />
              </button>
            )}
          </div>
          <div className="flex gap-2 overflow-x-auto py-2.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {/* ALL chip — always first, every screen size */}
            <button
              ref={(el) => {
                if (el) chipRefs.current.set(ALL_CAT, el)
                else chipRefs.current.delete(ALL_CAT)
              }}
              onClick={() => setActiveCatId(ALL_CAT)}
              className={cn(
                'shrink-0 rounded-full px-4 py-1.5 text-sm font-medium transition',
                !searchMode && activeCatId === ALL_CAT
                  ? 'bg-stone-900 text-white shadow-sm'
                  : 'border border-stone-200 bg-white text-stone-600 hover:border-stone-400 hover:text-stone-900'
              )}
            >
              🍽️ সব {totalItems}
            </button>
            {menu?.categories.map((c) => (
              <button
                key={c.id}
                ref={(el) => {
                  if (el) chipRefs.current.set(c.id, el)
                  else chipRefs.current.delete(c.id)
                }}
                onClick={() => {
                  setSearch('')
                  setActiveCatId(c.id)
                }}
                className={cn(
                  'shrink-0 rounded-full px-4 py-1.5 text-sm font-medium transition',
                  !searchMode && activeCatId === c.id
                    ? 'bg-stone-900 text-white shadow-sm'
                    : 'border border-stone-200 bg-white text-stone-600 hover:border-stone-400 hover:text-stone-900'
                )}
              >
                {c.name} {c.items.length}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── items grid ── */}
      <main className="mx-auto w-full max-w-6xl flex-1 px-3 pb-36 pt-4 sm:px-4">
        {menuLoading ? (
          <div className="grid grid-cols-2 gap-2.5 sm:gap-4 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="space-y-2 rounded-xl border border-stone-200 bg-white p-0">
                <Skeleton className="aspect-square w-full rounded-b-none sm:aspect-[4/3]" />
                <div className="space-y-2 p-3.5">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-4/5" />
                  <Skeleton className="h-4 w-1/4" />
                </div>
              </div>
            ))}
          </div>
        ) : menuError ? (
          <Card className="mx-auto max-w-sm border-amber-200 text-center shadow">
            <CardContent className="flex flex-col items-center gap-3 py-8">
              <WifiOff className="size-8 text-amber-500" />
              <p className="font-bold text-stone-800">মেনু লোড করা যায়নি</p>
              <p className="text-sm text-stone-500">{menuError}</p>
              <Button
                onClick={fetchMenu}
                className="bg-amber-500 font-bold text-white hover:bg-amber-600"
              >
                আবার চেষ্টা করুন
              </Button>
            </CardContent>
          </Card>
        ) : searchMode ? (
          /* ── search results ── */
          <>
            <div className="mb-3 flex items-center gap-2">
              <Search className="size-4 text-amber-500" />
              <h2 className="text-lg font-bold text-stone-800">"{search.trim()}"</h2>
              <span className="text-xs text-stone-400">{searchResults.length}টি ফলাফল</span>
            </div>
            <div className="grid grid-cols-2 gap-2.5 sm:gap-4 lg:grid-cols-3">
              {searchResults.map((item) => (
                <MenuCard
                  key={item.id}
                  item={item}
                  categoryName={menu!.categories.find((c) => c.items.some((i) => i.id === item.id))?.name ?? ''}
                  accentIdx={catIndex.get(menu!.categories.find((c) => c.items.some((i) => i.id === item.id))?.id ?? '') ?? 0}
                  onOpen={() => openItem(item)}
                />
              ))}
            </div>
            {searchResults.length === 0 && (
              <div className="flex flex-col items-center gap-2 py-16 text-center">
                <span className="text-3xl">🔍</span>
                <p className="text-sm font-medium text-stone-500">কিছু পাওয়া যায়নি</p>
                <p className="text-xs text-stone-400">অন্য নাম দিয়ে খুঁজে দেখুন</p>
              </div>
            )}
          </>
        ) : activeCatId === ALL_CAT ? (
          /* ── ALL mode: sections per category ── */
          menu?.categories.map((c, ci) => (
            <section key={c.id} className="mb-7">
              <div className="mb-3 flex items-center gap-2">
                <span
                  className={cn(
                    'flex size-7 items-center justify-center rounded-lg text-sm',
                    ACCENTS[ci % ACCENTS.length]
                  )}
                >
                  🍽️
                </span>
                <h2 className="text-lg font-bold text-stone-800">{c.name}</h2>
                <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-semibold text-stone-500">
                  {c.items.length}টি
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2.5 sm:gap-4 lg:grid-cols-3">
                {c.items.map((item) => (
                  <MenuCard
                    key={item.id}
                    item={item}
                    categoryName={c.name}
                    accentIdx={ci}
                    onOpen={() => openItem(item)}
                  />
                ))}
              </div>
              {c.items.length === 0 && (
                <p className="rounded-xl border border-dashed border-stone-200 bg-white py-8 text-center text-sm text-stone-400">
                  এই ক্যাটাগরিতে এখনো কোনো আইটেম নেই
                </p>
              )}
            </section>
          ))
        ) : (
          /* ── single category mode ── */
          <>
            <div className="mb-3 flex items-center gap-2">
              <Flame className="size-4 text-amber-500" />
              <h2 className="text-lg font-bold text-stone-800">{activeCategory?.name}</h2>
              <span className="text-xs text-stone-400">
                {activeCategory?.items.length ?? 0}টি আইটেম
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2.5 sm:gap-4 lg:grid-cols-3">
              {activeCategory?.items.map((item) => (
                <MenuCard
                  key={item.id}
                  item={item}
                  categoryName={activeCategory.name}
                  accentIdx={catIndex.get(activeCategory.id) ?? 0}
                  onOpen={() => openItem(item)}
                />
              ))}
            </div>
            {activeCategory && activeCategory.items.length === 0 && (
              <p className="py-16 text-center text-sm text-stone-400">
                এই ক্যাটাগরিতে এখনো কোনো আইটেম নেই
              </p>
            )}
          </>
        )}
      </main>

      {/* ── floating waiter button (bottom-left) ── */}
      <Popover open={waiterOpen} onOpenChange={setWaiterOpen}>
        <PopoverTrigger asChild>
          <button
            aria-label="ওয়েটার কল"
            className="fixed bottom-4 left-4 z-40 flex size-14 items-center justify-center rounded-full bg-amber-500 text-white shadow-lg shadow-amber-300/60 transition hover:scale-105 hover:bg-amber-600"
          >
            <ConciergeBell className="size-6" />
          </button>
        </PopoverTrigger>
        <PopoverContent side="top" align="start" className="w-52 p-1.5">
          {WAITER_OPTIONS.map((o) => (
            <button
              key={o.type}
              onClick={() => sendWaiterSignal(o.type)}
              disabled={waiterBusy !== null}
              className="flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-left text-sm font-medium text-stone-700 transition hover:bg-amber-50 disabled:opacity-50"
            >
              {o.label}
              {waiterBusy === o.type && (
                <Loader2 className="ml-auto size-3.5 animate-spin text-amber-500" />
              )}
            </button>
          ))}
        </PopoverContent>
      </Popover>

      {/* ── floating cart bar ── */}
      {mounted && cartCount > 0 && (
        <div className="pointer-events-none fixed inset-x-0 bottom-20 z-40 flex justify-center px-4 sm:bottom-6">
          <Link
            href="/cart"
            className="pointer-events-auto flex items-center gap-3 rounded-full bg-stone-900/95 py-2 pl-5 pr-2 text-white shadow-xl backdrop-blur transition hover:scale-[1.02]"
          >
            <span className="text-sm font-semibold">
              {cartCount} আইটেম • {taka(cartSubtotal)}
            </span>
            <span className="flex items-center gap-1.5 rounded-full bg-gradient-to-r from-amber-500 to-orange-600 px-4 py-2 text-sm font-bold shadow-sm">
              অর্ডার প্লেস করুন
              <ShoppingCart className="size-3.5" />
            </span>
          </Link>
        </div>
      )}

      {/* ── item dialog ── */}
      <ItemDialog
        item={dialogItem}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onAdd={handleAddToCart}
        specialNoteEnabled={specialNoteEnabled}
      />

      {/* ── upsell drawer ── */}
      <Drawer open={!!upsellSource} onOpenChange={(o) => !o && setUpsellSource(null)}>
        <DrawerContent>
          <div className="mx-auto w-full max-w-md pb-2">
            <DrawerHeader className="pb-2">
              <DrawerTitle className="text-lg font-bold text-stone-900">
                🍔 সাথে কী নেবেন?
              </DrawerTitle>
              <DrawerDescription>
                অনেকেই এই আইটেমের সাথে নিচের জিনিসগুলো নিয়ে থাকেন
              </DrawerDescription>
            </DrawerHeader>
            <div className="space-y-2 px-4">
              {upsellItems.length === 0 ? (
                <p className="py-4 text-center text-sm text-stone-400">
                  কোনো আপসেল আইটেম পাওয়া যায়নি
                </p>
              ) : (
                upsellItems.map((u) => {
                  const added = addedUpsell[u.id] || 0
                  return (
                    <div
                      key={u.id}
                      className={`flex items-center gap-3 rounded-xl border p-2.5 transition-colors ${
                        added > 0 ? 'border-emerald-300 bg-emerald-50' : 'border-amber-100 bg-amber-50/50'
                      }`}
                    >
                      <ItemThumb
                        src={u.imageUrl}
                        alt={u.name}
                        className="size-12 shrink-0 rounded-lg"
                        iconClassName="size-5"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-stone-800">{u.name}</p>
                        <p className={`text-sm font-bold ${added > 0 ? 'text-emerald-600' : 'text-amber-600'}`}>
                          {taka(u.price)}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        onClick={() => quickAddUpsell(u)}
                        className={`font-bold text-white ${
                          added > 0 ? 'bg-emerald-500 hover:bg-emerald-600' : 'bg-amber-500 hover:bg-amber-600'
                        }`}
                      >
                        {added > 0 ? (
                          <>
                            <Check className="size-3.5" />
                            {added > 1 ? `যোগ হয়েছে ×${toBn(added)}` : 'যোগ হয়েছে ✓'}
                          </>
                        ) : (
                          <>
                            <Plus className="size-3.5" />
                            যোগ করুন
                          </>
                        )}
                      </Button>
                    </div>
                  )
                })
              )}
            </div>
            <div className="p-4 pt-2">
              {Object.values(addedUpsell).some((n) => n > 0) && (
                <Link
                  href="/cart"
                  onClick={() => setUpsellSource(null)}
                  className="mb-2 flex w-full items-center justify-center gap-1.5 rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-emerald-600"
                >
                  <Check className="size-4" />
                  {toBn(Object.values(addedUpsell).reduce((a, b) => a + b, 0))} টি কার্টে যোগ হয়েছে — কার্ট দেখুন
                </Link>
              )}
              <Button
                variant="outline"
                onClick={() => setUpsellSource(null)}
                className="w-full border-stone-200 text-stone-500 hover:text-stone-700"
              >
                না, থাক
              </Button>
            </div>
          </div>
        </DrawerContent>
      </Drawer>

      {/* ── my orders sheet (live tracker) ── */}
      <Sheet open={ordersOpen} onOpenChange={setOrdersOpen}>
        <SheetContent side="right" className="w-full gap-0 sm:max-w-md">
          <SheetHeader className="border-b border-stone-100 pb-3">
            <SheetTitle className="flex items-center gap-2 text-base font-bold text-stone-900">
              <ReceiptText className="size-4 text-amber-600" />
              আমার অর্ডার
            </SheetTitle>
            <SheetDescription>টেবিল {tableNumber} • লাইভ স্ট্যাটাস</SheetDescription>
          </SheetHeader>

          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {orders === null ? (
              Array.from({ length: 2 }).map((_, i) => (
                <div key={i} className="space-y-3 rounded-xl border border-stone-200 p-4">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-3 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              ))
            ) : orders.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-16 text-center">
                <ReceiptText className="size-10 text-stone-300" />
                <p className="text-sm font-medium text-stone-500">এখনো কোনো অর্ডার নেই</p>
                <p className="text-xs text-stone-400">মেনু থেকে পছন্দের খাবার অর্ডার করুন</p>
              </div>
            ) : (
              orders.map((o) => (
                <div
                  key={`${o.id}:${o.status}`}
                  className="animate-in fade-in slide-in-from-bottom-3 space-y-3 rounded-xl border border-stone-200 bg-white p-3.5 shadow-sm duration-500"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold text-stone-800">অর্ডার #{o.orderNo}</span>
                    <span className="text-[11px] text-stone-400">
                      {new Date(o.placedAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>

                  <StatusStepper status={o.status} />
                  <Separator />

                  <div className="space-y-1">
                    {o.items.map((it, idx) => (
                      <div
                        key={idx}
                        className="flex items-baseline justify-between gap-2 text-sm"
                      >
                        <span className="text-stone-600">
                          <span className="font-semibold text-stone-800">{it.quantity}×</span>{' '}
                          {it.itemName}
                        </span>
                        <span className="shrink-0 font-medium text-stone-700">
                          {taka(it.lineTotal)}
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center justify-between border-t border-dashed border-stone-200 pt-2">
                    <span className="text-xs font-medium text-stone-500">মোট</span>
                    <span className="text-base font-extrabold text-amber-600">{taka(o.total)}</span>
                  </div>
                </div>
              ))
            )}
            {orders !== null && orders.length > 0 && (
              <p className="flex items-center justify-center gap-1.5 pt-1 text-center text-[11px] text-stone-400">
                {ordersLoading && <Loader2 className="size-3 animate-spin" />}
                প্রতি ৫ সেকেন্ডে অটো-আপডেট হয়
              </p>
            )}
          </div>

          {/* sticky bill footer — ALWAYS visible when a non-cancelled order exists */}
          {nonCancelledCount > 0 && (
            <div className="border-t border-stone-100 bg-white p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              <Button
                asChild
                className="h-12 w-full bg-amber-500 text-base font-extrabold text-white shadow-lg shadow-amber-200 hover:bg-amber-600"
              >
                <Link href="/bill">
                  <ReceiptText className="size-5" />
                  বিল দেখুন / পেমেন্ট করুন
                </Link>
              </Button>
              <p className="mt-1.5 text-center text-[11px] text-stone-400">
                খাওয়া-দাওয়া শেষ? বিল রিকোয়েস্ট করুন — জন্মদিনের ৳৫০ ছাড়ও নিন!
              </p>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* ── developer credit ── */}
      <footer className="pb-24 pt-2 sm:pb-20">
        <p className="text-center text-[11px] text-stone-400">
          {restaurantName} • স্ক্যান করুন, অর্ডার করুন, উপভোগ করুন
        </p>
        <div className="mt-1">
          <DeveloperCredit />
        </div>
      </footer>
    </div>
  )
}
