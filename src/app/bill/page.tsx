'use client'

// Bill page — request staff + bill summary + Birthday/occasion CRM offer + receipt.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import Link from 'next/link'
import {
  ArrowLeft,
  BadgeCheck,
  CalendarHeart,
  Check,
  Copy,
  Loader2,
  MessageCircle,
  PartyPopper,
  ReceiptText,
  Send,
  WifiOff,
} from 'lucide-react'
import { toast } from 'sonner'

import { api, getDeviceId, getDeviceFp } from '@/lib/client'
import { taka } from '@/lib/constants'
import { cn } from '@/lib/utils'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { SessionExpiredScreen } from '@/components/customer/session-expired'
import { LegalLinks } from '@/components/customer/legal-links'
import { DeveloperCredit } from '@/components/customer/developer-credit'
import { useSiteConfig } from '@/components/customer/site-config'

/* ─────────────────────────── types ─────────────────────────── */

interface BillItem {
  itemName: string
  quantity: number
  returnedQty?: number
  unitPrice: number
  spiceLevel: string | null
  addons: { name: string; price: number }[]
  specialNote: string | null
  lineTotal: number
}

interface BillOrder {
  id: string
  orderNo: number
  status: string
  subtotal: number
  voucherDiscount: number
  happyHourDiscount: number
  birthdayDiscount: number
  total: number
  placedAt: string
  items: BillItem[]
}

interface BillData {
  tableNumber: number
  sessionHasOffer?: boolean
  orders: BillOrder[]
  summary: {
    subtotal: number
    happyHourDiscount: number
    voucherDiscount: number
    birthdayDiscount: number
    payable: number
  }
  payment: {
    billPaid: boolean
    paymentMethod: string | null
    paidAt: string | null
    receiptId: string | null
    receiptNo: number | null
  }
  birthdayOffer: {
    enabled: boolean
    eligible: boolean
    amount: number
    minBill: number
    alreadyClaimed: boolean
    deviceAlreadyClaimed: boolean
  }
  occasions: {
    id: string
    name: string
    emoji: string
    dateLabel: string
    description: string
    discount: number
    minBill: number
    eligible: boolean
    alreadyClaimed: boolean
  }[]
}

interface ReferralResponse {
  link: string
  linkMobile?: string
  linkDesktop?: string
  token: string
}

/** true on phones/tablets → m.me deep-link opens the Messenger app; desktop → facebook.com chat */
function isMobileDevice(): boolean {
  if (typeof navigator === 'undefined') return true
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(navigator.userAgent)
}
const subscribeNoop = () => () => {}

const STATUS_BADGES: Record<string, { label: string; cls: string }> = {
  PLACED: { label: 'প্লেসড', cls: 'border-amber-200 bg-amber-50 text-amber-800' },
  COOKING: { label: 'রান্নায়', cls: 'border-orange-200 bg-orange-50 text-orange-800' },
  READY: { label: 'রেডি', cls: 'border-green-200 bg-green-50 text-green-800' },
  SERVED: { label: 'সার্ভড', cls: 'border-stone-200 bg-stone-100 text-stone-700' },
  COMPLETED: { label: 'সম্পন্ন', cls: 'border-stone-200 bg-stone-100 text-stone-700' },
  CANCELLED: { label: 'বাতিল', cls: 'border-red-200 bg-red-50 text-red-700' },
}

type Phase = 'loading' | 'ok' | 'invalid' | 'error'

/* ─────────────────────────── page ─────────────────────────── */

export default function BillPage() {
  const cfg = useSiteConfig()
  const restaurantName = cfg?.restaurantName || 'Smart QR Restaurant'

  const [phase, setPhase] = useState<Phase>('loading')
  const [bill, setBill] = useState<BillData | null>(null)

  // occasion offer selection (default: first eligible occasion)
  const [selectedOccasionId, setSelectedOccasionId] = useState('')

  // claiming state (no name/date form — the bot collects verification data in Messenger)
  const [claiming, setClaiming] = useState(false)
  const [refLinks, setRefLinks] = useState<{ mobile: string; desktop: string } | null>(null)
  const [referralOccasionId, setReferralOccasionId] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // mobile/desktop detection (m.me deep-link vs facebook.com chat):
  // server snapshot = true (m.me safe default) → client refines after hydration
  const isMobile = useSyncExternalStore(subscribeNoop, isMobileDevice, () => true)

  // staff call
  const [staffBusy, setStaffBusy] = useState(false)

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  function stopPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }

  useEffect(() => () => stopPolling(), [])

  // keep bill + occasion selection coherent (defaults to first eligible)
  function applyBill(data: BillData) {
    setBill(data)
    setSelectedOccasionId((prev) => {
      const occ = data.occasions ?? []
      if (prev && occ.some((o) => o.id === prev && !o.alreadyClaimed)) return prev
      return occ.find((o) => o.eligible)?.id ?? occ[0]?.id ?? ''
    })
  }

  // retry helper (event-handler only — never called synchronously in an effect)
  const fetchBill = useCallback(async () => {
    setPhase('loading')
    const res = await api.get<BillData>('/api/bill')
    if (res.ok && res.data) {
      applyBill(res.data)
      setPhase('ok')
    } else if (res.code === 'SESSION_INVALID') {
      setPhase('invalid')
    } else {
      setPhase('error')
    }
  }, [])

  // initial load
  useEffect(() => {
    ;(async () => {
      const res = await api.get<BillData>('/api/bill')
      if (res.ok && res.data) {
        applyBill(res.data)
        setPhase('ok')
      } else if (res.code === 'SESSION_INVALID') {
        setPhase('invalid')
      } else {
        setPhase('error')
      }
    })()
  }, [])

  // live refresh (payment marked from admin panel / discount applied) every 6s
  useEffect(() => {
    if (phase !== 'ok') return
    const t = setInterval(async () => {
      const res = await api.get<BillData>('/api/bill')
      if (res.ok && res.data) applyBill(res.data)
    }, 6000)
    return () => clearInterval(t)
  }, [phase])

  // the occasion a messenger link was created for got claimed → the link is
  // treated as invalid (derived during render below) so the form comes back
  // and the customer can claim another offer with a fresh link

  // poll until the discount shows up in the bill (applied via claim)
  function startAppliedPoll() {
    stopPolling()
    const baseline = bill?.summary.birthdayDiscount ?? 0
    pollRef.current = setInterval(async () => {
      const b = await api.get<BillData>('/api/bill')
      if (b.ok && b.data && b.data.summary.birthdayDiscount > baseline) {
        stopPolling()
        setBill(b.data)
        toast.success('🎉 ছাড় প্রয়োগ হয়েছে!')
      }
    }, 5000)
  }

  async function callStaff() {
    setStaffBusy(true)
    const res = await api.post('/api/waiter', { type: 'BILL' })
    setStaffBusy(false)
    if (res.ok) {
      toast.success('স্টাফ আসছেন!')
    } else if (res.code === 'SESSION_INVALID') {
      setPhase('invalid')
    } else {
      toast.error(res.error || 'সিগন্যাল পাঠানো যায়নি')
    }
  }

  async function claimOffer() {
    if (!canClaim) {
      toast.error('প্রযোজ্য অফার নেই — ন্যূনতম বিল পূরণ হলে আনলক হবে')
      return
    }

    const payload = {
      ...(selectedOccasionId ? { occasionId: selectedOccasionId } : {}),
      deviceId: getDeviceId(),
      deviceFp: getDeviceFp(),
    }

    // ── messenger OFF → instant direct claim (discount applied right away) ──
    if (!offer.enabled) {
      setClaiming(true)
      const res = await api.post<{ applied: boolean; message: string }>('/api/birthday/direct-claim', payload)
      setClaiming(false)

      if (res.ok && res.data) {
        toast.success(res.data.message || '🎉 ছাড় প্রয়োগ হয়েছে!')
        // refresh immediately (the 5s poll below is just a safety net)
        const b = await api.get<BillData>('/api/bill')
        if (b.ok && b.data) setBill(b.data)
        startAppliedPoll()
      } else if (res.code === 'SESSION_INVALID') {
        setPhase('invalid')
      } else {
        toast.error(res.error || 'অফার দাবি করা যায়নি')
      }
      return
    }

    // ── messenger ON → referral link flow (claim via Messenger chat) ──
    // NOTE: open a blank tab SYNCHRONOUSLY while we still have the user gesture —
    // window.open() after the await gets blocked by mobile/desktop popup blockers.
    const pre = typeof window !== 'undefined' ? window.open('', '_blank') : null
    setClaiming(true)
    const res = await api.post<ReferralResponse>('/api/birthday/referral', payload)
    setClaiming(false)

    if (res.ok && res.data) {
      const links = {
        mobile: res.data.linkMobile || res.data.link,
        desktop: res.data.linkDesktop || res.data.linkMobile || res.data.link,
      }
      setRefLinks(links)
      setReferralOccasionId(selectedOccasionId || null)
      if (pre) {
        // auto-detect: desktop customers get facebook.com/messages/t/<page>,
        // mobile customers get m.me (opens the Messenger app directly)
        pre.location.href = isMobile ? links.mobile : links.desktop
      } else {
        // popup was blocked — the big “Messenger খুলুন” button below is the fallback
        toast.info('নিচের "Messenger খুলুন" বাটনে চাপ দিন')
      }
      toast.success('মেসেঞ্জার লিংক তৈরি হয়েছে!')

      // poll the bill every 5s — once the webhook applies the discount we celebrate
      startAppliedPoll()
    } else {
      pre?.close()
      if (res.code === 'SESSION_INVALID') {
        setPhase('invalid')
      } else {
        toast.error(res.error || 'অফার দাবি করা যায়নি')
      }
    }
  }

  async function copyLink() {
    if (!activeMessengerLink) return
    try {
      await navigator.clipboard.writeText(activeMessengerLink)
      setCopied(true)
      toast.success('লিংক কপি হয়েছে!')
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('কপি করা যায়নি — ম্যানুয়ালি কপি করুন')
    }
  }

  /* ---- render gates ---- */

  if (phase === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-stone-50">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="size-9 animate-spin text-amber-500" />
          <p className="text-sm font-medium text-stone-500">বিল লোড হচ্ছে…</p>
        </div>
      </div>
    )
  }

  if (phase === 'invalid') return <SessionExpiredScreen />

  if (phase === 'error' || !bill) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-stone-50 p-4">
        <Card className="w-full max-w-sm border-amber-200 text-center shadow-lg">
          <CardContent className="flex flex-col items-center gap-4 py-10">
            <WifiOff className="size-10 text-amber-500" />
            <p className="font-bold text-stone-800">বিল লোড করা যায়নি</p>
            <p className="text-sm text-stone-500">ইন্টারনেট চেক করে আবার চেষ্টা করুন</p>
            <Button
              onClick={() => fetchBill()}
              className="bg-amber-500 font-bold text-white hover:bg-amber-600"
            >
              আবার চেষ্টা করুন
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const s = bill.summary
  const offer = bill.birthdayOffer
  const paid = bill.payment.billPaid
  const occasions = bill.occasions ?? []
  const selectedOccasion = occasions.find((o) => o.id === selectedOccasionId) ?? null
  const canClaim = selectedOccasion
    ? selectedOccasion.eligible && !selectedOccasion.alreadyClaimed
    : offer.eligible && !offer.deviceAlreadyClaimed
  // card visibility: with occasion offers ALWAYS show the card (claimed ones
  // render dimmed with "নেওয়া হয়েছে ✓" — the customer sees every offer and its
  // status instead of a mysteriously empty page); legacy (no occasions) card
  // follows the old global-claim rules
  const showOfferCard = occasions.length > 0
    ? true
    : !offer.alreadyClaimed && !offer.deviceAlreadyClaimed && offer.eligible
  // messenger link stays visible only while its offer is still unclaimed —
  // once the webhook applies it, the form returns for the next offer
  const refOcc = referralOccasionId ? occasions.find((o) => o.id === referralOccasionId) : null
  const referralValid = referralOccasionId
    ? Boolean(refOcc && !refOcc.alreadyClaimed)
    : !offer.alreadyClaimed
  // platform-aware link: mobile → m.me (Messenger app), desktop → facebook.com chat
  const activeMessengerLink =
    refLinks && referralValid ? (isMobile ? refLinks.mobile : refLinks.desktop) : null

  /* ---- main render ---- */

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
            <h1 className="flex items-center gap-1.5 text-base font-bold text-stone-900">
              <ReceiptText className="size-4 text-amber-600" />
              বিল
            </h1>
            <p className="truncate text-xs text-stone-400">{restaurantName} • টেবিল {bill.tableNumber}</p>
          </div>
          <Badge className="ml-auto shrink-0 border border-amber-200 bg-amber-50 text-amber-800">
            {bill.orders.length}টি অর্ডার
          </Badge>
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 space-y-4 px-3 py-4 sm:px-4">
        {/* ── payment confirmed banner ── */}
        {paid && (
          <div className="flex items-center gap-3 rounded-xl border border-green-300 bg-gradient-to-r from-green-50 to-emerald-50 p-4 shadow-sm">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-green-100">
              <BadgeCheck className="size-5 text-green-600" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-extrabold text-green-800">✅ পেমেন্ট গৃহীত হয়েছে — ধন্যবাদ!</p>
              <p className="text-xs text-green-700">
                {bill.payment.paymentMethod ? `পেমেন্ট মাধ্যম: ${bill.payment.paymentMethod}` : 'স্টাফ আপনার বিল নিশ্চিত করেছেন'}
                {bill.payment.paidAt && ` • ${new Date(bill.payment.paidAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
                {bill.payment.receiptNo != null && ` • রসিদ নং #${bill.payment.receiptNo}`}
              </p>
            </div>
          </div>
        )}

        {/* ── receipt — view / print after payment ── */}
        {paid && bill.payment.receiptId && (
          <Button
            asChild
            className="h-13 w-full rounded-xl bg-gradient-to-r from-stone-800 to-stone-900 py-3.5 text-base font-extrabold text-white shadow-lg shadow-stone-300 hover:from-stone-900 hover:to-black"
          >
            <a href={`/receipt/${bill.payment.receiptId}`} target="_blank" rel="noopener noreferrer">
              <ReceiptText className="size-5" />
              🧾 রসিদ দেখুন / প্রিন্ট করুন
            </a>
          </Button>
        )}
        {/* ── orders with items ── */}
        {bill.orders.length === 0 ? (
          <p className="rounded-xl border border-dashed border-stone-200 bg-white p-8 text-center text-sm text-stone-400">
            এই সেশনে এখনো কোনো অর্ডার নেই
          </p>
        ) : (
          bill.orders.map((o) => {
            const badge = STATUS_BADGES[o.status] ?? STATUS_BADGES.PLACED
            return (
              <div key={o.id} className="space-y-3 rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-bold text-stone-800">অর্ডার #{o.orderNo}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-stone-400">
                      {new Date(o.placedAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                    <Badge variant="outline" className={badge.cls}>
                      {badge.label}
                    </Badge>
                  </div>
                </div>

                <Separator />

                <div className="space-y-2">
                  {o.items.map((it, idx) => (
                    <div key={idx} className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm text-stone-700">
                          <span className="font-bold text-stone-900">{it.quantity}×</span>{' '}
                          {it.itemName}
                          {(it.returnedQty ?? 0) > 0 && (
                            <span className="ml-1.5 rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-bold text-red-600">
                              ↩ {it.returnedQty}টি রিটার্ন
                            </span>
                          )}
                        </p>
                        <p className="mt-0.5 flex flex-wrap gap-1.5 text-[10px] text-stone-400">
                          {it.spiceLevel && <span>🌶️ {it.spiceLevel}</span>}
                          {it.addons.map((a) => (
                            <span key={a.name}>+ {a.name}</span>
                          ))}
                          {it.specialNote && <span>📝 {it.specialNote}</span>}
                        </p>
                      </div>
                      <span className="shrink-0 text-sm font-semibold text-stone-700">
                        {taka(it.lineTotal)}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="flex items-center justify-between border-t border-dashed border-stone-200 pt-2">
                  <span className="text-xs font-medium text-stone-500">অর্ডার মোট</span>
                  <span className="text-sm font-extrabold text-amber-600">{taka(o.total)}</span>
                </div>
              </div>
            )
          })
        )}

        {/* ── summary ── */}
        <Card className="border-amber-200 shadow-md shadow-amber-100/40">
          <CardContent className="space-y-2 px-4 py-4">
            <h2 className="pb-1 text-sm font-bold text-stone-700">বিল সারসংক্ষেপ</h2>
            <div className="flex justify-between text-sm">
              <span className="text-stone-500">সাবটোটাল</span>
              <span className="font-semibold text-stone-800">{taka(s.subtotal)}</span>
            </div>
            {s.happyHourDiscount > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-stone-500">🔥 হ্যাপি আওয়ার সেভিংস</span>
                <span className="font-semibold text-green-600">−{taka(s.happyHourDiscount)}</span>
              </div>
            )}
            {s.voucherDiscount > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-stone-500">🎟️ কুপন ছাড়</span>
                <span className="font-semibold text-green-600">−{taka(s.voucherDiscount)}</span>
              </div>
            )}
            {s.birthdayDiscount > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-stone-500">🎁 অফারের ছাড়</span>
                <span className="font-semibold text-green-600">−{taka(s.birthdayDiscount)}</span>
              </div>
            )}
            <Separator className="my-2" />
            <div className="flex items-baseline justify-between">
              <span className="font-bold text-stone-800">মোট প্রদেয়</span>
              <span className="text-2xl font-extrabold text-amber-600">{taka(s.payable)}</span>
            </div>
          </CardContent>
        </Card>

        {/* ── call staff (hidden once paid) ── */}
        {!paid && (
          <Button
            onClick={callStaff}
            disabled={staffBusy}
            variant="outline"
            className="h-12 w-full rounded-xl border-amber-300 bg-white text-base font-bold text-amber-700 hover:bg-amber-50"
          >
            {staffBusy && <Loader2 className="size-4 animate-spin" />}
            👨‍💼 বিলের জন্য স্টাফ ডাকুন
          </Button>
        )}

        {/* ── occasion / birthday CRM offer — ONE offer per bill; the same offer
            stays locked per customer/device on later bills ── */}
        {offer.alreadyClaimed && (
          <div className="flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 p-3.5">
            <BadgeCheck className="size-5 shrink-0 text-green-600" />
            <p className="text-sm font-semibold text-green-800">
              🎉 অফারের ছাড় এই বিলে প্রয়োগ করা হয়েছে
            </p>
          </div>
        )}

        {showOfferCard && (
          <div className="overflow-hidden rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 p-5 shadow-lg shadow-amber-200/60">
            <div className="flex items-start gap-3">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-white/20 ring-1 ring-white/30">
                <CalendarHeart className="size-6 text-white" />
              </span>
              <div className="min-w-0 flex-1">
                {occasions.length > 0 ? (
                  <>
                    <h2 className="text-lg font-extrabold text-white">🎉 আপনার জন্য বিশেষ অফার!</h2>
                    <p className="mt-1 text-sm leading-relaxed text-amber-50">
                      নিচ থেকে অফার বেছে নিন —{' '}
                      <span className="font-extrabold text-white">ছাড় এই বিলে যোগ হবে!</span>
                    </p>
                  </>
                ) : (
                  <>
                    <h2 className="text-lg font-extrabold text-white">🎂 জন্মদিনের বিশেষ অফার!</h2>
                    <p className="mt-1 text-sm leading-relaxed text-amber-50">
                      আপনার বা পরিবারের জন্মদিন যোগ করলেই এই বিলে এখনই{' '}
                      <span className="font-extrabold text-white">{taka(offer.amount)} ইনস্ট্যান্ট ছাড়!</span>
                    </p>
                    <p className="mt-0.5 text-xs font-medium text-amber-100">
                      (ন্যূনতম বিল {taka(offer.minBill)})
                    </p>
                  </>
                )}
              </div>
            </div>

            {/* ── occasion picker — pick one offer reason (default: first eligible) ── */}
            {occasions.length > 0 && !activeMessengerLink && (
              <div className="mt-4 space-y-2">
                <p className="flex items-center gap-1.5 text-sm font-extrabold text-white">
                  <PartyPopper className="size-4" />
                  অনুষ্ঠান বেছে নিন — এক বিলে একটি অফারই প্রযোজ্য
                </p>
                <div className="space-y-2">
                  {occasions.map((o) => {
                    const active = selectedOccasionId === o.id
                    return (
                      <button
                        key={o.id}
                        type="button"
                        disabled={!o.eligible}
                        onClick={() => setSelectedOccasionId(o.id)}
                        aria-pressed={active}
                        className={cn(
                          'flex w-full items-center gap-3 rounded-xl border-2 p-3 text-left transition',
                          !o.eligible && 'cursor-not-allowed opacity-60',
                          active
                            ? 'border-white bg-white/95 shadow-md'
                            : o.eligible
                              ? 'border-white/40 bg-white/10 hover:bg-white/20'
                              : 'border-white/20 bg-white/5'
                        )}
                      >
                        <span className="text-2xl" aria-hidden>
                          {o.emoji || '🎉'}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span
                            className={cn(
                              'block text-sm font-extrabold',
                              active ? 'text-stone-900' : 'text-white'
                            )}
                          >
                            {o.name}
                          </span>
                          <span
                            className={cn(
                              'block truncate text-[11px] font-medium',
                              active ? 'text-stone-500' : 'text-amber-100'
                            )}
                          >
                            {o.dateLabel}
                            {o.description ? ` • ${o.description}` : ''}
                          </span>
                        </span>
                        <span className="shrink-0 text-right">
                          <span
                            className={cn(
                              'block text-sm font-extrabold',
                              active ? 'text-emerald-600' : 'text-white'
                            )}
                          >
                            −{taka(o.discount)}
                          </span>
                          <span
                            className={cn(
                              'block whitespace-nowrap text-[10px] font-semibold',
                              active ? 'text-stone-400' : 'text-amber-100'
                            )}
                          >
                            {o.alreadyClaimed
                              ? 'নেওয়া হয়েছে ✓'
                              : o.eligible
                                ? 'প্রযোজ্য ✓'
                                : `ন্যূনতম বিল ${taka(o.minBill)}`}
                          </span>
                        </span>
                      </button>
                    )
                  })}
                </div>
                {selectedOccasion && !selectedOccasion.eligible && (
                  <p className="rounded-lg bg-white/15 px-3 py-2 text-[11px] font-semibold text-amber-50">
                    এই অফারের ন্যূনতম বিল {taka(selectedOccasion.minBill)} — বিল পূরণ হলেই আনলক হবে!
                  </p>
                )}
              </div>
            )}

            {!activeMessengerLink ? (
              <div className="mt-4 space-y-2.5 rounded-xl bg-white/95 p-3.5 shadow-inner">
                <Button
                  onClick={claimOffer}
                  disabled={claiming || !canClaim}
                  className="h-11 w-full bg-amber-500 text-base font-bold text-white hover:bg-amber-600 disabled:cursor-not-allowed"
                >
                  {claiming && <Loader2 className="size-4 animate-spin" />}
                  {offer.enabled ? '🎉 Claim on Messenger' : '🎉 এখনই ছাড় নিন'}
                </Button>
                {offer.deviceAlreadyClaimed && occasions.length === 0 ? (
                  <p className="text-center text-[11px] font-semibold text-stone-500">
                    এই অফারটি আগেই নেওয়া হয়েছে — একবারই প্রযোজ্য।
                  </p>
                ) : (
                  !canClaim &&
                  occasions.length > 0 && (
                    <p className="text-center text-[11px] font-medium text-stone-500">
                      {selectedOccasion?.alreadyClaimed
                        ? occasions.some((o) => !o.alreadyClaimed)
                          ? 'এই অফারটি আর নেওয়া যাবে না — চাইলে অন্য অফার বেছে নিন।'
                          : bill.sessionHasOffer
                            ? 'এই বিলে ইতোমধ্যে একটি অফার ব্যবহার করা হয়েছে — বিল পরিশোধ করে আবার স্ক্যান করলে নতুন অফার নিতে পারবেন।'
                            : 'এই অফারগুলো আপনি আগেই নিয়েছেন — প্রতিটি অফার একবারই প্রযোজ্য।'
                        : 'উপরে থেকে প্রযোজ্য অফার বেছে নিলে বাটন চালু হবে'}
                    </p>
                  )
                )}
              </div>
            ) : (
              <div className="mt-4 space-y-2.5 rounded-xl bg-white/95 p-3.5 shadow-inner">
                <div className="flex items-start gap-2.5">
                  <MessageCircle className="mt-0.5 size-5 shrink-0 text-amber-600" />
                  <p className="text-sm font-medium leading-relaxed text-stone-700">
                    মেসেঞ্জারে বট অফারের প্রয়োজনীয় তথ্য চাইবে — <span className="font-bold">সঠিক তথ্য পাঠালেই যাচাই হয়ে ছাড়</span> সাথে সাথে এই বিলে যোগ হবে!
                  </p>
                </div>
                <a
                  href={activeMessengerLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-amber-500 text-base font-extrabold text-white shadow-md transition hover:bg-amber-600"
                >
                  <Send className="size-5" />
                  📲 Messenger খুলুন
                </a>
                <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                  <span className="min-w-0 flex-1 truncate font-mono text-xs text-stone-600">
                    {activeMessengerLink}
                  </span>
                  <button
                    onClick={copyLink}
                    aria-label="লিংক কপি করুন"
                    className="shrink-0 rounded-md bg-amber-500 p-1.5 text-white transition hover:bg-amber-600"
                  >
                    {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                  </button>
                </div>
                <p className="flex items-center justify-center gap-1.5 text-[11px] text-stone-400">
                  <Loader2 className="size-3 animate-spin" />
                  ছাড় প্রয়োগ হলে অটো-আপডেট হবে…
                </p>
              </div>
            )}
          </div>
        )}
      </main>

      <footer
        className={cn(
          'mt-auto space-y-1 py-5',
          activeMessengerLink && 'pb-24'
        )}
      >
        <p className="text-center text-xs text-stone-400">
          {restaurantName} • স্ক্যান করুন, অর্ডার করুন, উপভোগ করুন
        </p>
        <LegalLinks />
        <DeveloperCredit />
      </footer>
    </div>
  )
}
