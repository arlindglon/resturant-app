'use client'

// Cart + Voucher Slider + Order placement.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft,
  BadgeCheck,
  ChevronLeft,
  ChevronRight,
  Info,
  Loader2,
  Minus,
  Plus,
  ShoppingBag,
  ShoppingCart,
  Ticket,
  Trash2,
  X,
} from 'lucide-react'
import { toast } from 'sonner'

import { api, getDeviceId, getDeviceFp } from '@/lib/client'
import { playStatusSound } from '@/lib/customer-sound'
import { taka } from '@/lib/constants'
import { cn } from '@/lib/utils'
import { useCart, unitPrice } from '@/store/cart'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { SessionExpiredScreen } from '@/components/customer/session-expired'
import { ItemThumb } from '@/components/customer/item-thumb'
import { LegalLinks } from '@/components/customer/legal-links'
import { DeveloperCredit } from '@/components/customer/developer-credit'
import { getScanGeo, useSiteConfig } from '@/components/customer/site-config'

/* ─────────────────────────── types ─────────────────────────── */

interface SliderVoucher {
  id: string
  code: string
  title: string
  description: string | null
  discountType: 'PERCENT' | 'FIXED'
  discountValue: number
  maxDiscount: number | null
  minOrderAmount: number
  ruleType: string
  startTime: string | null
  endTime: string | null
  minQuantity: number | null
  setMenuIds: string[]
  badge: string
}

interface ValidateResponse {
  discount: number
  voucher: { code: string; title: string } | null
  subtotal: number
}

interface PlaceOrderResponse {
  order: { orderNo: number }
}

type SessionPhase = 'loading' | 'ok' | 'invalid'

// hydration-safe external store: no-op subscribe (value never changes)
const emptySubscribe = () => () => {}

/* ─────────────────────────── page ─────────────────────────── */

export default function CartPage() {
  const router = useRouter()
  const cfg = useSiteConfig()
  const restaurantName = cfg?.restaurantName || 'Smart QR Restaurant'

  const items = useCart((s) => s.items)
  const appliedVoucher = useCart((s) => s.appliedVoucher)
  const setVoucher = useCart((s) => s.setVoucher)
  const updateQuantity = useCart((s) => s.updateQuantity)
  const removeItem = useCart((s) => s.removeItem)
  const clear = useCart((s) => s.clear)

  const [sessionPhase, setSessionPhase] = useState<SessionPhase>('loading')
  const [tableNumber, setTableNumber] = useState<number | null>(null)
  // hydration-safe flag: false during SSR + first client render, true after hydration
  const mounted = useSyncExternalStore(emptySubscribe, () => true, () => false)

  const [codeInput, setCodeInput] = useState('')
  const [applyingCode, setApplyingCode] = useState(false)
  const [applyingSliderCode, setApplyingSliderCode] = useState<string | null>(null)
  const [shortfallMsg, setShortfallMsg] = useState<string | null>(null)

  const [vouchers, setVouchers] = useState<SliderVoucher[] | null>(null)
  const [placing, setPlacing] = useState(false)

  /* ---- voucher slider: mouse drag-to-scroll + arrows ---- */
  const sliderRef = useRef<HTMLDivElement | null>(null)
  const drag = useRef({ down: false, startX: 0, startScroll: 0, moved: false })

  function onSliderPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.pointerType !== 'mouse') return // touch → native scroll
    const el = sliderRef.current
    if (!el) return
    // start a fresh gesture — clear any stale 'moved' flag from a previous drag.
    // IMPORTANT: do NOT setPointerCapture here — capturing before any movement
    // retargets the eventual `click` to the container, so card buttons would
    // never receive real mouse clicks. Capture only once we know it's a drag.
    drag.current = { down: true, startX: e.clientX, startScroll: el.scrollLeft, moved: false }
  }
  function onSliderPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const el = sliderRef.current
    if (!el || !drag.current.down) return
    const dx = e.clientX - drag.current.startX
    if (!drag.current.moved) {
      if (Math.abs(dx) <= 6) return // still a click, not a drag
      drag.current.moved = true
      try {
        el.setPointerCapture(e.pointerId) // safe now: this gesture IS a drag
      } catch {
        /* pointer already gone */
      }
    }
    el.scrollLeft = drag.current.startScroll - dx
  }
  function onSliderPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    drag.current.down = false
    try {
      sliderRef.current?.releasePointerCapture(e.pointerId)
    } catch {
      /* pointer already released */
    }
  }
  // swallow accidental click on "প্রয়োগ করুন" right after a drag
  function onSliderClickCapture(e: React.MouseEvent) {
    if (drag.current.moved) {
      e.preventDefault()
      e.stopPropagation()
      drag.current.moved = false
    }
  }
  function nudgeSlider(dir: -1 | 1) {
    sliderRef.current?.scrollBy({ left: dir * 290, behavior: 'smooth' })
  }

  /* ---- session + voucher slider ---- */

  useEffect(() => {
    ;(async () => {
      const res = await api.get<{ valid: boolean; tableNumber: number | null }>('/api/session')
      if (res.ok && res.data?.valid) {
        setTableNumber(res.data.tableNumber)
        setSessionPhase('ok')
      } else {
        setSessionPhase('invalid')
      }
    })()
  }, [])

  useEffect(() => {
    if (sessionPhase !== 'ok') return
    ;(async () => {
      const res = await api.get<{ vouchers: SliderVoucher[] }>('/api/vouchers/available')
      if (res.ok && res.data) setVouchers(res.data.vouchers)
      else setVouchers([])
    })()
  }, [sessionPhase])

  /* ---- derived ---- */

  const subtotal = useMemo(
    () => Math.round(items.reduce((s, i) => s + unitPrice(i) * i.quantity, 0) * 100) / 100,
    [items]
  )
  const happySavings = useMemo(
    () =>
      Math.round(
        items.reduce((s, i) => s + Math.max(0, i.basePrice - i.price) * i.quantity, 0) * 100
      ) / 100,
    [items]
  )
  const voucherDiscount = appliedVoucher?.discount ?? 0
  const total = Math.max(0, Math.round((subtotal - voucherDiscount) * 100) / 100)

  /* ---- actions ---- */

  async function applyVoucher(code: string) {
    const trimmed = code.trim()
    if (!trimmed) {
      toast.error('কুপন কোড লিখুন')
      return
    }
    setShortfallMsg(null)
    const res = await api.post<ValidateResponse>('/api/vouchers/validate', {
      code: trimmed,
      deviceId: getDeviceId(),
      deviceFp: getDeviceFp(),
      items: items.map((i) => ({ itemId: i.itemId, quantity: i.quantity, addons: i.addons.map((a) => a.name) })),
    })

    if (res.ok && res.data) {
      setVoucher({
        code: res.data.voucher?.code || trimmed,
        discount: res.data.discount,
        title: res.data.voucher?.title || trimmed,
      })
      setCodeInput('')
      toast.success(`কুপন প্রয়োগ হয়েছে — ${taka(res.data.discount)} সেভ!`)
    } else {
      toast.error(res.error || 'কুপন প্রযোজ্য নয়')
      if (res.code === 'SET_MENU_SHORTFALL') setShortfallMsg(res.error || null)
    }
  }

  async function placeOrder() {
    if (placing || items.length === 0) return
    setPlacing(true)
    const geo = getScanGeo() // coordinates captured at scan time (geo-fence at order time)
    const res = await api.post<PlaceOrderResponse>('/api/orders', {
      deviceId: getDeviceId(),
      deviceFp: getDeviceFp(),
      ...(geo ? { lat: geo.lat, lng: geo.lng } : {}),
      items: items.map(({ itemId, quantity, spiceLevel, addons, specialNote }) => ({
        itemId,
        quantity,
        spiceLevel,
        addons: addons.map((a) => a.name),
        specialNote,
      })),
      voucherCode: appliedVoucher?.code,
    })
    setPlacing(false)

    if (res.ok && res.data) {
      clear()
      playStatusSound('PLACED') // soft double-ding confirmation
      toast.success(`অর্ডার #${res.data.order.orderNo} প্লেস হয়েছে!`)
      router.push('/menu')
    } else if (res.code === 'SESSION_INVALID') {
      setSessionPhase('invalid')
    } else {
      toast.error(res.error || 'অর্ডার নেওয়া যায়নি — আবার চেষ্টা করুন')
    }
  }

  function handleClearAll() {
    clear()
    setShortfallMsg(null)
    toast('কার্ট খালি করা হয়েছে')
  }

  /* ---- render gates ---- */

  if (sessionPhase === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-stone-50">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="size-9 animate-spin text-amber-500" />
          <p className="text-sm font-medium text-stone-500">লোড হচ্ছে…</p>
        </div>
      </div>
    )
  }

  if (sessionPhase === 'invalid') return <SessionExpiredScreen />

  if (!mounted) {
    return (
      <div className="min-h-screen bg-stone-50">
        <div className="mx-auto max-w-2xl space-y-4 p-4">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      </div>
    )
  }

  /* ---- empty cart ---- */

  if (items.length === 0) {
    return (
      <div className="flex min-h-screen flex-col bg-stone-50">
        <div className="flex flex-1 items-center justify-center p-4">
          <Card className="w-full max-w-sm border-amber-100 shadow-lg shadow-amber-100/40">
            <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
              <div className="flex size-20 items-center justify-center rounded-full bg-amber-100">
                <ShoppingBag className="size-10 text-amber-500" />
              </div>
              <div className="space-y-1.5">
                <h1 className="text-xl font-bold text-stone-900">কার্ট খালি</h1>
                <p className="text-sm text-stone-500">
                  মেনু থেকে পছন্দের খাবার বেছে নিন — <br /> মজার অফারগুলোও দেখে নিন!
                </p>
              </div>
              <Button
                asChild
                className="h-11 w-full bg-amber-500 text-base font-bold text-white hover:bg-amber-600"
              >
                <Link href="/menu">
                  <ShoppingCart className="size-4" />
                  মেনু দেখুন
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>
        <footer className="mt-auto space-y-1 py-5">
          <p className="text-center text-xs text-stone-400">
            {restaurantName} • স্ক্যান করুন, অর্ডার করুন, উপভোগ করুন
          </p>
          <LegalLinks />
          <DeveloperCredit />
        </footer>
      </div>
    )
  }

  /* ---- cart ---- */

  return (
    <div className="flex min-h-screen flex-col bg-stone-50">
      {/* header */}
      <header className="sticky top-0 z-30 border-b border-amber-100 bg-white/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-2xl items-center gap-3 px-3 py-3 sm:px-4">
          <Link
            href="/menu"
            aria-label="মেনুতে ফিরুন"
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-full border border-stone-200 text-stone-600 transition hover:border-amber-300 hover:bg-amber-50 hover:text-amber-700"
          >
            <ArrowLeft className="size-4" />
          </Link>
          <div className="min-w-0">
            <h1 className="text-base font-bold text-stone-900">আপনার কার্ট</h1>
            <p className="truncate text-xs text-stone-400">
              {restaurantName}
              {tableNumber != null ? ` • টেবিল ${tableNumber}` : ''}
            </p>
          </div>
          <Badge className="ml-auto shrink-0 border border-amber-200 bg-amber-50 text-amber-800">
            {items.reduce((n, i) => n + i.quantity, 0)} আইটেম
          </Badge>
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 space-y-4 px-3 py-4 sm:px-4">
        {/* ── items ── */}
        <div className="space-y-3">
          {items.map((i) => (
            <div
              key={i.cartId}
              className="flex gap-3 rounded-xl border border-stone-200 bg-white p-3 shadow-sm"
            >
              <ItemThumb
                src={i.imageUrl}
                alt={i.name}
                className="size-16 shrink-0 rounded-lg"
                iconClassName="size-6"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-sm font-bold text-stone-800">{i.name}</h3>
                  <button
                    onClick={() => removeItem(i.cartId)}
                    aria-label={`${i.name} মুছুন`}
                    className="shrink-0 rounded p-1 text-stone-300 transition hover:bg-red-50 hover:text-red-500"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>

                {/* customization summary */}
                {(i.spiceLevel || i.addons.length > 0 || i.specialNote) && (
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {i.spiceLevel && (
                      <span className="rounded bg-stone-100 px-1.5 py-0.5 text-[10px] font-medium text-stone-500">
                        🌶️ {i.spiceLevel}
                      </span>
                    )}
                    {i.addons.map((a) => (
                      <span
                        key={a.name}
                        className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700"
                      >
                        + {a.name}
                      </span>
                    ))}
                    {i.specialNote && (
                      <span className="max-w-full truncate rounded bg-stone-100 px-1.5 py-0.5 text-[10px] font-medium text-stone-500">
                        📝 {i.specialNote}
                      </span>
                    )}
                  </div>
                )}

                <div className="mt-2 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="icon"
                      className="size-7 border-stone-200"
                      onClick={() => updateQuantity(i.cartId, -1)}
                      aria-label="কমান"
                    >
                      <Minus className="size-3" />
                    </Button>
                    <span className="w-5 text-center text-sm font-bold text-stone-800">
                      {i.quantity}
                    </span>
                    <Button
                      variant="outline"
                      size="icon"
                      className="size-7 border-stone-200"
                      onClick={() => updateQuantity(i.cartId, 1)}
                      aria-label="বাড়ান"
                    >
                      <Plus className="size-3" />
                    </Button>
                  </div>
                  <div className="text-right">
                    <span className="block text-[10px] text-stone-400">
                      {taka(unitPrice(i))} × {i.quantity}
                    </span>
                    <span className="text-sm font-extrabold text-stone-800">
                      {taka(unitPrice(i) * i.quantity)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ))}

          <div className="text-right">
            <button
              onClick={handleClearAll}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-red-500 transition hover:text-red-600"
            >
              <Trash2 className="size-3.5" />
              সব মুছুন
            </button>
          </div>
        </div>

        {/* ── coupon ── */}
        <Card className="border-stone-200 py-4 shadow-sm">
          <CardContent className="space-y-3 px-4">
            <Label className="flex items-center gap-1.5 text-sm font-bold text-stone-700">
              <Ticket className="size-4 text-amber-500" />
              কুপন কোড
            </Label>

            {appliedVoucher ? (
              <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2.5">
                <BadgeCheck className="size-4 shrink-0 text-green-600" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-green-800">
                    {appliedVoucher.title}{' '}
                    <span className="font-mono text-xs font-medium text-green-600">
                      ({appliedVoucher.code})
                    </span>
                  </p>
                  <p className="text-xs font-medium text-green-700">
                    −{taka(appliedVoucher.discount)} ছাড় প্রয়োগ হয়েছে
                  </p>
                </div>
                <button
                  onClick={() => setVoucher(null)}
                  aria-label="কুপন সরান"
                  className="shrink-0 rounded p-1 text-green-500 transition hover:bg-green-100 hover:text-green-700"
                >
                  <X className="size-4" />
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <Input
                  value={codeInput}
                  onChange={(e) => setCodeInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && applyVoucher(codeInput)}
                  placeholder="যেমন: EID20"
                  className="h-10 flex-1 border-stone-200 uppercase focus-visible:ring-amber-200"
                />
                <Button
                  onClick={async () => {
                    setApplyingCode(true)
                    await applyVoucher(codeInput)
                    setApplyingCode(false)
                  }}
                  disabled={applyingCode}
                  className="h-10 bg-amber-500 font-bold text-white hover:bg-amber-600"
                >
                  {applyingCode && <Loader2 className="size-4 animate-spin" />}
                  প্রয়োগ করুন
                </Button>
              </div>
            )}

            {shortfallMsg && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3">
                <Info className="mt-0.5 size-4 shrink-0 text-amber-600" />
                <p className="text-sm font-medium leading-relaxed text-amber-800">{shortfallMsg}</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── VOUCHER SLIDER ── */}
        <div>
          <div className="mb-2 flex items-center gap-1.5">
            <Ticket className="size-4 text-amber-500" />
            <h2 className="text-sm font-bold text-stone-700">চলমান অফারসমূহ</h2>
            {vouchers !== null && vouchers.length > 1 && (
              <div className="ml-auto flex items-center gap-1">
                <button
                  type="button"
                  aria-label="আগের অফার"
                  onClick={() => nudgeSlider(-1)}
                  className="flex size-7 items-center justify-center rounded-full border border-stone-200 bg-white text-stone-500 transition hover:border-amber-300 hover:bg-amber-50 hover:text-amber-700"
                >
                  <ChevronLeft className="size-4" />
                </button>
                <button
                  type="button"
                  aria-label="পরের অফার"
                  onClick={() => nudgeSlider(1)}
                  className="flex size-7 items-center justify-center rounded-full border border-stone-200 bg-white text-stone-500 transition hover:border-amber-300 hover:bg-amber-50 hover:text-amber-700"
                >
                  <ChevronRight className="size-4" />
                </button>
              </div>
            )}
          </div>

          {vouchers === null ? (
            <div className="flex gap-3 overflow-hidden">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-40 min-w-[260px]" />
              ))}
            </div>
          ) : vouchers.length === 0 ? (
            <p className="rounded-xl border border-dashed border-stone-200 bg-white p-4 text-center text-xs text-stone-400">
              এই মুহূর্তে কোনো চলমান অফার নেই
            </p>
          ) : (
            <div
              ref={sliderRef}
              onPointerDown={onSliderPointerDown}
              onPointerMove={onSliderPointerMove}
              onPointerUp={onSliderPointerUp}
              onPointerCancel={onSliderPointerUp}
              onClickCapture={onSliderClickCapture}
              className="thin-scroll flex snap-x cursor-grab touch-pan-x gap-3 overflow-x-auto pb-2 select-none active:cursor-grabbing [scrollbar-width:thin]"
            >
              {vouchers.map((v) => {
                const discountText =
                  v.discountType === 'PERCENT'
                    ? `${v.discountValue}% ছাড়${v.maxDiscount ? ` (সর্বোচ্চ ${taka(v.maxDiscount)})` : ''}`
                    : `${taka(v.discountValue)} ছাড়`
                const minNote =
                  v.ruleType === 'SET_MENU_QTY'
                    ? `ন্যূনতম ${v.minQuantity ?? 1}টি সেট মেনু অর্ডার করলেই`
                    : v.minOrderAmount > 0
                      ? `ন্যূনতম অর্ডার ${taka(v.minOrderAmount)}`
                      : 'কোনো ন্যূনতম অর্ডার শর্ত নেই'
                return (
                  <div
                    key={v.id}
                    className="flex min-w-[260px] max-w-[260px] snap-start flex-col gap-1.5 rounded-xl border border-amber-200 bg-gradient-to-br from-amber-50 to-orange-100 p-3.5 shadow-sm"
                  >
                    <span className="w-fit rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-bold text-amber-800">
                      {v.badge}
                    </span>
                    <p className="text-sm font-bold leading-snug text-stone-800">{v.title}</p>
                    {v.description && (
                      <p className="line-clamp-2 text-[11px] leading-snug text-stone-500">
                        {v.description}
                      </p>
                    )}
                    <p className="text-base font-extrabold text-amber-700">{discountText}</p>
                    <p className="text-[11px] font-medium text-stone-500">{minNote}</p>
                    <p className="font-mono text-[11px] font-semibold tracking-wide text-stone-400">
                      কোড: {v.code}
                    </p>
                    <Button
                      size="sm"
                      disabled={applyingSliderCode !== null}
                      onClick={async () => {
                        setApplyingSliderCode(v.code)
                        await applyVoucher(v.code)
                        setApplyingSliderCode(null)
                      }}
                      className="mt-auto h-8 w-full bg-amber-500 text-xs font-bold text-white hover:bg-amber-600"
                    >
                      {applyingSliderCode === v.code && <Loader2 className="size-3 animate-spin" />}
                      প্রয়োগ করুন
                    </Button>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* ── bill summary ── */}
        <Card className="border-amber-200 shadow-sm">
          <CardContent className="space-y-2 px-4 py-4">
            <h2 className="pb-1 text-sm font-bold text-stone-700">বিল সারসংক্ষেপ</h2>
            <div className="flex justify-between text-sm">
              <span className="text-stone-500">সাবটোটাল</span>
              <span className="font-semibold text-stone-800">{taka(subtotal)}</span>
            </div>
            {happySavings > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-stone-500">🔥 হ্যাপি আওয়ার সেভিংস</span>
                <span className="font-semibold text-green-600">−{taka(happySavings)}</span>
              </div>
            )}
            {voucherDiscount > 0 && appliedVoucher && (
              <div className="flex justify-between text-sm">
                <span className="text-stone-500">🎟️ কুপন ছাড় ({appliedVoucher.code})</span>
                <span className="font-semibold text-green-600">−{taka(voucherDiscount)}</span>
              </div>
            )}
            <Separator className="my-2" />
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-bold text-stone-700">মোট</span>
              <span className="text-2xl font-extrabold text-amber-600">{taka(total)}</span>
            </div>
            <p className="text-[11px] text-stone-400">
              হ্যাপি আওয়ার দাম ইতোমধ্যে আইটেমের মূল্যে প্রয়োগ করা হয়েছে
            </p>
          </CardContent>
        </Card>

        {/* ── place order ── */}
        <Button
          onClick={placeOrder}
          disabled={placing}
          className="h-13 w-full rounded-xl bg-amber-500 py-3.5 text-base font-extrabold text-white shadow-lg shadow-amber-200 hover:bg-amber-600"
        >
          {placing ? <Loader2 className="size-5 animate-spin" /> : <ShoppingCart className="size-5" />}
          {placing ? 'অর্ডার হচ্ছে…' : 'অর্ডার কনফার্ম করুন'}
        </Button>
        <p className={cn('pb-2 text-center text-xs text-stone-400')}>
          অর্ডার কনফার্ম করলে কিচেনে সরাসরি চলে যাবে 🍳
        </p>
      </main>

      <footer className="mt-auto space-y-1 py-5">
        <p className="text-center text-xs text-stone-400">
          {restaurantName} • স্ক্যান করুন, অর্ডার করুন, উপভোগ করুন
        </p>
        <LegalLinks />
        <DeveloperCredit />
      </footer>
    </div>
  )
}
