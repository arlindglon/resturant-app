'use client'

// ============================================================
// KITCHEN DISPLAY SYSTEM (KDS) — fullscreen dark dashboard
// Live orders + waiter calls with realtime socket + polling
// fallback, WebAudio chimes and delay alerts.
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '@/lib/client'
import { useRealtime } from '@/hooks/use-realtime'
import { ORDER_STATUS } from '@/lib/constants'
import {
  armStaffSound,
  disarmStaffSound,
  setStaffVolume,
  staffChime,
  staffConfirmBeep,
  unlockStaffAudioFallback,
  type StaffVolume,
} from '@/lib/staff-sound'
import { requestWakeLock, releaseWakeLock } from '@/lib/wakelock'
import { bnClock, bnElapsed, toBn } from '@/lib/bn'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import {
  AlertTriangle,
  Bell,
  BellOff,
  CheckCheck,
  ChefHat,
  ChevronDown,
  Clock,
  Droplets,
  Flame,
  KeyRound,
  Loader2,
  Lock,
  Receipt,
  RefreshCw,
  Sparkles,
  UserRound,
} from 'lucide-react'

// ---------------- Types (per API contract) ----------------
interface KdsItem {
  itemName: string
  quantity: number
  spiceLevel: string | null
  addons: { name: string; price: number }[]
  specialNote: string | null
}

interface KdsOrder {
  id: string
  orderNo: number
  tableNumber: number
  status: string
  placedAt: string
  cookingAt: string | null
  readyAt: string | null
  items: KdsItem[]
}

interface WaiterCall {
  id: string
  tableNumber: number
  type: string
  createdAt: string
}

interface KdsData {
  delayMinutes: number
  orders: KdsOrder[]
  waiterCalls: WaiterCall[]
}

type SoundState = 'ask' | 'on' | 'off'

const LS_SOUND = 'kds_sound'
const LS_VOLUME = 'kds_volume'

function readStoredVolume(): StaffVolume {
  try {
    return localStorage.getItem(LS_VOLUME) === 'normal' ? 'normal' : 'boost'
  } catch {
    return 'boost'
  }
}

// ---------------- Small presentational helpers ----------------
const SPICE_STYLE: Record<string, string> = {
  Mild: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  Medium: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
  Hot: 'bg-red-500/20 text-red-300 border-red-500/40',
}

function spiceLabel(level: string): string {
  if (level === 'Mild') return '🌶️ ঝাল কম'
  if (level === 'Hot') return '🌶️🌶️🌶️ ঝাল বেশি'
  return '🌶️🌶️ মাঝারি ঝাল'
}

const WAITER_META: Record<string, { Icon: typeof UserRound; label: string; cls: string }> = {
  WAITER: { Icon: UserRound, label: 'ওয়েটার চাই', cls: 'border-amber-500/40' },
  WATER: { Icon: Droplets, label: 'পানি চাই', cls: 'border-sky-500/40' },
  CLEAN: { Icon: Sparkles, label: 'পরিষ্কার চাই', cls: 'border-emerald-500/40' },
  BILL: { Icon: Receipt, label: 'বিল চাই', cls: 'border-fuchsia-500/40' },
}

const WAITER_ICON_CLS: Record<string, string> = {
  WAITER: 'text-amber-300',
  WATER: 'text-sky-300',
  CLEAN: 'text-emerald-300',
  BILL: 'text-fuchsia-300',
}

function statusBadge(status: string) {
  if (status === ORDER_STATUS.PLACED)
    return { label: '🆕 নতুন অর্ডার', cls: 'bg-amber-500/20 text-amber-300 border-amber-500/50' }
  if (status === ORDER_STATUS.COOKING)
    return { label: '🔥 রান্নায়', cls: 'bg-orange-600/20 text-orange-300 border-orange-500/50' }
  if (status === ORDER_STATUS.READY)
    return { label: '✅ রেডি টু সার্ভ', cls: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50' }
  return { label: status, cls: 'bg-slate-700/40 text-slate-300 border-slate-600' }
}

export default function KdsPage() {
  const [authState, setAuthState] = useState<'checking' | 'gate' | 'ready'>('checking')
  const [keyInput, setKeyInput] = useState('')
  const [keyBusy, setKeyBusy] = useState(false)
  const [data, setData] = useState<KdsData | null>(null)
  const [loadErr, setLoadErr] = useState('')
  const [clock, setClock] = useState<Date | null>(null)
  const [nowTs, setNowTs] = useState(() => Date.now())
  const [soundState, setSoundState] = useState<SoundState>('ask')
  const [volume, setVolumeState] = useState<StaffVolume>('boost')
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null)
  const [resolvingCallId, setResolvingCallId] = useState<string | null>(null)
  const [callsOpen, setCallsOpen] = useState(false)

  const soundStateRef = useRef<SoundState>('ask')
  const volumeRef = useRef<StaffVolume>('boost')
  const armedOnceRef = useRef(false)
  const knownOrdersRef = useRef<Set<number>>(new Set())
  const knownWaiterIdsRef = useRef<Set<string>>(new Set())
  const hadDataRef = useRef(false)

  // ---- key gate check on mount + session expiry handling ----
  useEffect(() => {
    api
      .get<{ authed: boolean }>('/api/staff/login')
      .then((res) => setAuthState(res.ok && res.data?.authed ? 'ready' : 'gate'))
      .catch(() => setAuthState('gate'))
  }, [])

  // ---- restore sound preferences (kds_sound / kds_volume), post-hydration ----
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        const v = readStoredVolume()
        volumeRef.current = v
        setVolumeState(v)
        const saved = localStorage.getItem(LS_SOUND)
        if (saved === 'on') {
          soundStateRef.current = 'on'
          setSoundState('on')
        } else if (saved === 'off') {
          soundStateRef.current = 'off'
          setSoundState('off')
        }
      } catch {
        /* private mode — defaults are fine */
      }
    }, 0)
    return () => clearTimeout(t)
  }, [])

  // ---- arm audio on EVERY user gesture (browser autoplay policy) —
  // cheap + idempotent; also revives the context after interruptions and
  // primes the <audio> WAV fallback for webviews that never unlock WebAudio
  useEffect(() => {
    const onPointer = () => {
      if (soundStateRef.current !== 'on') return
      if (armStaffSound(volumeRef.current)) {
        unlockStaffAudioFallback()
        if (!armedOnceRef.current) {
          armedOnceRef.current = true
          staffConfirmBeep()
        }
      }
    }
    window.addEventListener('pointerdown', onPointer, { passive: true })
    return () => window.removeEventListener('pointerdown', onPointer)
  }, [])

  const unlockKitchen = async () => {
    const key = keyInput.trim()
    if (!key) return toast.error('কিচেন কী দিন')
    setKeyBusy(true)
    const res = await api.post<{ loggedIn: boolean; name?: string }>('/api/staff/login', { key })
    setKeyBusy(false)
    if (!res.ok) return toast.error(res.error || 'ভুল কী')
    toast.success(`কিচেন আনলক হয়েছে${res.data?.name ? ` — ${res.data.name}` : ''}`)
    setKeyInput('')
    setAuthState('ready')
  }

  const lockKitchen = async () => {
    // clear BOTH staff + admin cookies so the device is truly locked
    await api.del('/api/staff/login')
    await api.del('/api/admin/login')
    setData(null)
    hadDataRef.current = false
    knownOrdersRef.current.clear()
    knownWaiterIdsRef.current.clear()
    setAuthState('gate')
  }

  // ---- chime (only when audio is enabled + armed by user gesture) ----
  const chime = useCallback((kind: 'order' | 'waiter') => {
    if (soundStateRef.current !== 'on') return
    try {
      staffChime(kind)
    } catch {
      /* audio failures must never break the KDS */
    }
  }, [])

  // ---- data fetch + new-order/new-call detection for chimes ----
  const refetch = useCallback(
    async (detectNew = true) => {
      const res = await api.get<KdsData>('/api/kds/orders')
      if (!res.ok || !res.data) {
        if (res.code === 'KDS_KEY_REQUIRED') setAuthState('gate')
        if (res.error) setLoadErr(res.error)
        return
      }
      const next = res.data
      if (detectNew && hadDataRef.current) {
        const freshOrder = next.orders.some((o) => !knownOrdersRef.current.has(o.orderNo))
        const freshCall = next.waiterCalls.some((c) => !knownWaiterIdsRef.current.has(c.id))
        if (freshOrder) chime('order')
        else if (freshCall) chime('waiter')
      }
      for (const o of next.orders) knownOrdersRef.current.add(o.orderNo)
      for (const c of next.waiterCalls) knownWaiterIdsRef.current.add(c.id)
      hadDataRef.current = true
      setLoadErr('')
      setData(next)
    },
    [chime]
  )

  useEffect(() => {
    if (authState !== 'ready') return
    const t = setTimeout(() => refetch(true), 0)
    return () => clearTimeout(t)
  }, [refetch, authState])

  // screen back on → revive audio + wake lock + instant refetch so missed
  // orders chime right away instead of waiting for the next poll tick
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      if (soundStateRef.current === 'on') void armStaffSound(volumeRef.current)
      void requestWakeLock()
      refetch(true)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [refetch])

  // live clock (1s) + elapsed-timer refresh (10s)
  useEffect(() => {
    const t0 = setTimeout(() => setClock(new Date()), 0)
    const t1 = setInterval(() => setClock(new Date()), 1000)
    const t2 = setInterval(() => setNowTs(Date.now()), 10_000)
    return () => {
      clearTimeout(t0)
      clearInterval(t1)
      clearInterval(t2)
    }
  }, [])

  // ---- realtime: socket with polling fallback built into the hook ----
  useRealtime(
    {
      'order:new': (payload) => {
        const no = (payload as { orderNo?: number } | null)?.orderNo
        if (typeof no === 'number') {
          if (!knownOrdersRef.current.has(no)) {
            knownOrdersRef.current.add(no)
            chime('order')
          }
        } else {
          chime('order')
        }
        refetch(false)
      },
      'order:status': () => refetch(false),
      'waiter:new': (payload) => {
        const id = (payload as { id?: string } | null)?.id
        if (typeof id === 'string') {
          if (!knownWaiterIdsRef.current.has(id)) {
            knownWaiterIdsRef.current.add(id)
            chime('waiter')
          }
        } else {
          chime('waiter')
        }
        refetch(false)
      },
      'waiter:resolved': () => refetch(false),
      'table:cleared': () => refetch(false),
    },
    5000,
    () => {
      refetch(true)
    }
  )

  // ---- audio unlock (must happen inside a user gesture) ----
  const enableSound = () => {
    if (armStaffSound(volumeRef.current)) {
      armedOnceRef.current = true
      soundStateRef.current = 'on'
      setSoundState('on')
      try {
        localStorage.setItem(LS_SOUND, 'on')
      } catch { /* ignore */ }
      unlockStaffAudioFallback()
      void requestWakeLock() // kitchen tablet: keep the screen alive so chimes never stop
      staffChime('order') // loud full test chime — instant proof the audio works
      if (/Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
        toast.info('টেস্ট সাউন্ড শুনতে পেলেন? না শুনলে মিডিয়া ভলিউম বাড়ান; iPhone হলে সাইলেন্ট সুইচ বন্ধ করুন')
      }
    } else {
      toast.error('এই ব্রাউজারে অডিও চালু করা যাচ্ছে না')
      soundStateRef.current = 'off'
      setSoundState('off')
    }
  }

  const disableSound = () => {
    disarmStaffSound()
    soundStateRef.current = 'off'
    setSoundState('off')
    void releaseWakeLock() // sound off → no need to keep the screen alive
    try {
      localStorage.setItem(LS_SOUND, 'off')
    } catch { /* ignore */ }
  }

  const reenableSound = () => enableSound()

  const toggleVolume = () => {
    const next: StaffVolume = volumeRef.current === 'boost' ? 'normal' : 'boost'
    volumeRef.current = next
    setVolumeState(next)
    setStaffVolume(next)
    try {
      localStorage.setItem(LS_VOLUME, next)
    } catch { /* ignore */ }
    if (soundStateRef.current === 'on') {
      // re-arm with the new gain when muted earlier, keep confirmation blip
      if (armStaffSound(next)) {
        armedOnceRef.current = true
        soundStateRef.current = 'on'
        setSoundState('on')
        unlockStaffAudioFallback()
        staffConfirmBeep()
      }
    }
  }

  // ---- chef actions ----
  const advanceStatus = async (order: KdsOrder) => {
    const nextStatus =
      order.status === ORDER_STATUS.PLACED
        ? ORDER_STATUS.COOKING
        : order.status === ORDER_STATUS.COOKING
          ? ORDER_STATUS.READY
          : ORDER_STATUS.SERVED
    setBusyOrderId(order.id)
    const res = await api.patch('/api/kds/orders', { id: order.id, status: nextStatus })
    setBusyOrderId(null)
    if (!res.ok) {
      toast.error(res.error || 'স্ট্যাটাস আপডেট ব্যর্থ')
      return
    }
    toast.success(`অর্ডার #${toBn(order.orderNo)} আপডেট হয়েছে`)
    refetch(false)
  }

  const resolveCall = async (call: WaiterCall) => {
    setResolvingCallId(call.id)
    const res = await api.patch('/api/waiter', { id: call.id, status: 'DONE' })
    setResolvingCallId(null)
    if (!res.ok) {
      toast.error(res.error || 'সম্পন্ন করা যায়নি')
      return
    }
    toast.success(`টেবিল ${toBn(call.tableNumber)} কল সম্পন্ন`)
    refetch(false)
  }

  const orders = authState === 'ready' ? data?.orders ?? [] : []
  const waiterCalls = authState === 'ready' ? data?.waiterCalls ?? [] : []
  const delayMinutes = data?.delayMinutes ?? 15
  const isLate = (o: KdsOrder) => {
    const mins = Math.floor((nowTs - new Date(o.placedAt).getTime()) / 60000)
    return (o.status === ORDER_STATUS.PLACED || o.status === ORDER_STATUS.COOKING) && mins > delayMinutes
  }

  const waiterList = (
    <div className="space-y-2">
      {waiterCalls.length === 0 && (
        <p className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-6 text-center text-sm text-slate-500">
          কোনো পেন্ডিং কল নেই ✨
        </p>
      )}
      {waiterCalls.map((call) => {
        const meta = WAITER_META[call.type] ?? WAITER_META.WAITER
        const Icon = meta.Icon
        return (
          <div
            key={call.id}
            className="flex items-center gap-2 rounded-xl border bg-slate-900/70 p-3"
          >
            <Icon className={`h-5 w-5 shrink-0 ${WAITER_ICON_CLS[call.type] ?? 'text-slate-300'}`} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-white">টেবিল {toBn(call.tableNumber)}</p>
              <p className="text-xs text-slate-400">
                {meta.label} · {bnElapsed(call.createdAt, nowTs)}
              </p>
            </div>
            <Button
              size="sm"
              disabled={resolvingCallId === call.id}
              onClick={() => resolveCall(call)}
              className="h-8 bg-emerald-600 text-white hover:bg-emerald-500"
            >
              {resolvingCallId === call.id ? <Loader2 className="h-4 w-4 animate-spin" /> : '✓ সম্পন্ন'}
            </Button>
          </div>
        )
      })}
    </div>
  )

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* thin scrollbar style */}
      <style
        dangerouslySetInnerHTML={{
          __html: '.thin-scroll::-webkit-scrollbar{width:8px;height:8px}.thin-scroll::-webkit-scrollbar-track{background:transparent}.thin-scroll::-webkit-scrollbar-thumb{background:#334155;border-radius:8px}.thin-scroll::-webkit-scrollbar-thumb:hover{background:#475569}',
        }}
      />

      {/* ── key gate: kitchen display needs an access key ── */}
      {authState !== 'ready' && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950 p-4">
          {authState === 'checking' ? (
            <Loader2 className="h-8 w-8 animate-spin text-amber-400" />
          ) : (
            <div className="w-full max-w-sm space-y-5 rounded-2xl border border-slate-800 bg-slate-900 p-8 shadow-2xl">
              <div className="text-center">
                <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 shadow-lg">
                  <KeyRound className="h-8 w-8 text-white" />
                </div>
                <h1 className="flex items-center justify-center gap-2 text-xl font-black text-white">
                  <ChefHat className="h-5 w-5 text-amber-400" /> কিচেন ডিসপ্লে
                </h1>
                <p className="mt-1 text-xs text-slate-400">আনলক করতে কিচেন কী দিন</p>
              </div>
              <Input
                autoFocus
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === 'Enter' && unlockKitchen()}
                placeholder="KDS-XXXX-XXXX"
                className="h-11 border-slate-700 bg-slate-950 text-center font-mono tracking-widest text-white placeholder:text-slate-600"
              />
              <Button
                onClick={unlockKitchen}
                disabled={keyBusy}
                className="h-11 w-full bg-amber-500 font-black text-slate-950 hover:bg-amber-400"
              >
                {keyBusy ? <Loader2 className="h-5 w-5 animate-spin" /> : 'আনলক করুন'}
              </Button>
              <p className="text-center text-[11px] leading-relaxed text-slate-500">
                কী তৈরি ও ম্যানেজ করা হয় অ্যাডমিন প্যানেলের 🔑 অ্যাক্সেস কী ট্যাবে
              </p>
            </div>
          )}
        </div>
      )}

      {/* one-time audio unlock overlay (browser autoplay policy) */}
      {soundState === 'ask' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm space-y-4 rounded-2xl border border-slate-700 bg-slate-900 p-8 text-center shadow-2xl">
            <div className="text-5xl">🔔</div>
            <h2 className="text-xl font-black text-white">সাউন্ড চালু করুন</h2>
            <p className="text-sm leading-relaxed text-slate-400">
              নতুন অর্ডার ও ওয়েটার কল এলে বিপ শোনার জন্য একবার অডিও অনুমতি দিন (ব্রাউজার নিয়ম)।
            </p>
            <Button
              onClick={enableSound}
              className="h-12 w-full bg-amber-500 text-lg font-black text-slate-950 hover:bg-amber-400"
            >
              🔔 সাউন্ড চালু করুন
            </Button>
            <button
              onClick={disableSound}
              className="w-full text-xs text-slate-500 underline hover:text-slate-300"
            >
              সাউন্ড ছাড়া চালিয়ে যান
            </button>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="sticky top-0 z-40 flex flex-wrap items-center gap-2 border-b border-slate-800 bg-slate-950/95 px-4 py-3 backdrop-blur">
        <h1 className="mr-2 flex items-center gap-2 text-xl font-black text-white">
          <ChefHat className="h-6 w-6 text-amber-400" />
          কিচেন ডিসপ্লে
        </h1>
        <Badge className="gap-1 bg-slate-800 font-mono text-sm text-amber-300 hover:bg-slate-800">
          <Clock className="h-4 w-4" /> {clock ? bnClock(clock) : '--:--:--'}
        </Badge>
        <Badge
          className={`gap-1 border text-sm font-bold ${
            waiterCalls.length > 0
              ? 'animate-pulse border-red-500/60 bg-red-500/15 text-red-300'
              : 'border-slate-700 bg-slate-900 text-slate-400'
          }`}
        >
          🔔 ওয়েটার কল: {toBn(waiterCalls.length)}
        </Badge>
        <Badge variant="outline" className="gap-1 border-slate-700 text-sm text-slate-300">
          ⚠️ ডিলে লিমিট: {toBn(delayMinutes)} মিনিট
        </Badge>
        <div className="ml-auto flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => refetch(true)}
            className="border-slate-700 text-slate-300 hover:bg-slate-800"
            title="এখনই রিফ্রেশ"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={toggleVolume}
            className="border-slate-700 text-slate-300 hover:bg-slate-800"
            title={volume === 'boost' ? 'ভলিউম: বুস্ট (জোরে) — ট্যাপ করে নরমাল করুন' : 'ভলিউম: নরমাল — ট্যাপ করে বুস্ট করুন'}
          >
            {volume === 'boost' ? <span className="text-sm">🔊</span> : <span className="text-sm">🔉</span>}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={soundState === 'on' ? disableSound : reenableSound}
            className="border-slate-700 text-slate-300 hover:bg-slate-800"
            title={soundState === 'on' ? 'সাউন্ড বন্ধ করুন' : 'সাউন্ড চালু করুন'}
          >
            {soundState === 'on' ? <Bell className="h-4 w-4 text-amber-400" /> : <BellOff className="h-4 w-4" />}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={lockKitchen}
            className="border-slate-700 text-slate-400 hover:bg-red-950 hover:text-red-300"
            title="কী দিয়ে লক করুন"
          >
            <Lock className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {/* Body */}
      <div className="flex">
        <main className="min-w-0 flex-1 p-4">
          {/* Waiter calls — collapsible panel on mobile */}
          <Collapsible open={callsOpen} onOpenChange={setCallsOpen} className="mb-4 lg:hidden">
            <CollapsibleTrigger asChild>
              <Button
                variant="outline"
                className={`flex w-full items-center justify-between border-slate-700 bg-slate-900 text-left ${
                  waiterCalls.length > 0 ? 'border-red-500/60 text-red-300' : 'text-slate-300'
                }`}
              >
                <span>
                  🔔 ওয়েটার কল ({toBn(waiterCalls.length)})
                  {waiterCalls.length > 0 && (
                    <span className="ml-2 inline-block h-2 w-2 animate-pulse rounded-full bg-red-500" />
                  )}
                </span>
                <ChevronDown className={`h-4 w-4 transition-transform ${callsOpen ? 'rotate-180' : ''}`} />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-3">{waiterList}</CollapsibleContent>
          </Collapsible>

          {loadErr && !data && (
            <div className="flex flex-col items-center gap-3 py-24 text-center">
              <AlertTriangle className="h-10 w-10 text-red-400" />
              <p className="text-slate-400">{loadErr}</p>
              <Button onClick={() => refetch(true)} variant="outline" className="border-slate-700">
                আবার চেষ্টা করুন
              </Button>
            </div>
          )}

          {!loadErr && !data && (
            <div className="flex items-center justify-center gap-3 py-24 text-slate-400">
              <Loader2 className="h-6 w-6 animate-spin text-amber-400" /> লোড হচ্ছে…
            </div>
          )}

          {data && (
            <>
              {orders.length === 0 ? (
                <div className="flex flex-col items-center gap-3 py-24 text-center text-slate-500">
                  <span className="text-5xl">🍽️</span>
                  <p className="text-lg font-bold text-slate-300">কোনো অর্ডার নেই</p>
                  <p className="text-sm">নতুন অর্ডার এলে এখানে দেখা যাবে (লাইভ)</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {orders.map((order) => {
                    const late = isLate(order)
                    const badge = statusBadge(order.status)
                    const elapsedMin = Math.floor((nowTs - new Date(order.placedAt).getTime()) / 60000)
                    return (
                      <div
                        key={order.id}
                        className={late ? 'animate-pulse rounded-2xl border-4 border-red-500' : ''}
                      >
                        <Card
                          className={`h-full rounded-2xl border bg-slate-900 ${
                            late ? 'border-transparent shadow-[0_0_25px_rgba(239,68,68,0.35)]' : 'border-slate-800'
                          }`}
                        >
                          <CardContent className="space-y-3 p-4">
                            {/* head */}
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <p className="text-2xl font-black text-white">
                                  টেবিল {toBn(order.tableNumber)}
                                </p>
                                <p className="text-xs font-bold text-slate-400">অর্ডার #{toBn(order.orderNo)}</p>
                              </div>
                              <Badge className={`${badge.cls} border text-xs`}>{badge.label}</Badge>
                            </div>

                            {/* timer + delay */}
                            <div className="flex items-center justify-between gap-2">
                              <span className="flex items-center gap-1.5 text-sm font-bold text-slate-300">
                                <Clock className="h-4 w-4 text-slate-500" />
                                {bnElapsed(order.placedAt, nowTs)}
                                <span className="text-xs font-normal text-slate-500">({toBn(elapsedMin)} মি.)</span>
                              </span>
                              {late && (
                                <Badge className="animate-pulse border-red-500/60 bg-red-500/20 text-xs font-black text-red-300">
                                  ⚠️ দেরি হচ্ছে!
                                </Badge>
                              )}
                            </div>

                            {/* items */}
                            <div className="thin-scroll max-h-64 space-y-2.5 overflow-y-auto rounded-xl bg-slate-950/70 p-3">
                              {order.items.map((item, idx) => (
                                <div key={idx} className="space-y-1.5">
                                  <p className="text-sm leading-snug text-slate-200">
                                    <span className="font-black text-amber-400">{toBn(item.quantity)}×</span>{' '}
                                    <span className="font-bold text-white">{item.itemName}</span>
                                  </p>
                                  {(item.spiceLevel || (item.addons && item.addons.length > 0)) && (
                                    <div className="flex flex-wrap items-center gap-1.5">
                                      {item.spiceLevel && (
                                        <span
                                          className={`rounded-full border px-2 py-0.5 text-[11px] font-bold ${
                                            SPICE_STYLE[item.spiceLevel] ?? SPICE_STYLE.Medium
                                          }`}
                                        >
                                          {spiceLabel(item.spiceLevel)}
                                        </span>
                                      )}
                                      {(item.addons ?? []).map((a, ai) => (
                                        <span
                                          key={ai}
                                          className="rounded-full border border-slate-700 bg-slate-800/80 px-2 py-0.5 text-[11px] text-slate-300"
                                        >
                                          + {a.name}
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                  {item.specialNote && (
                                    <p className="flex items-start gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-[12px] italic text-amber-300">
                                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                      📌 {item.specialNote}
                                    </p>
                                  )}
                                </div>
                              ))}
                            </div>

                            {/* action */}
                            <Button
                              disabled={busyOrderId === order.id}
                              onClick={() => advanceStatus(order)}
                              className={`h-12 w-full text-base font-black ${
                                order.status === ORDER_STATUS.PLACED
                                  ? 'bg-amber-500 text-slate-950 hover:bg-amber-400'
                                  : order.status === ORDER_STATUS.COOKING
                                    ? 'bg-emerald-600 text-white hover:bg-emerald-500'
                                    : 'bg-slate-200 text-slate-900 hover:bg-white'
                              }`}
                            >
                              {busyOrderId === order.id ? (
                                <Loader2 className="h-5 w-5 animate-spin" />
                              ) : order.status === ORDER_STATUS.PLACED ? (
                                '🔥 রান্না শুরু'
                              ) : order.status === ORDER_STATUS.COOKING ? (
                                '✅ রেডি টু সার্ভ'
                              ) : (
                                '🍽️ সার্ভ হয়েছে'
                              )}
                            </Button>
                          </CardContent>
                        </Card>
                      </div>
                    )
                  })}
                </div>
              )}
            </>
          )}
        </main>

        {/* Waiter calls — right sidebar on large screens */}
        <aside className="thin-scroll hidden w-80 shrink-0 overflow-y-auto border-l border-slate-800 bg-slate-950 p-4 lg:block">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-black uppercase tracking-wide text-slate-400">
            <Flame className="h-4 w-4 text-amber-500" />
            ওয়েটার কল ({toBn(waiterCalls.length)})
          </h2>
          {waiterList}
        </aside>
      </div>

      {/* footer strip */}
      <footer className="border-t border-slate-800 px-4 py-2 text-center text-[11px] text-slate-600">
        <CheckCheck className="mr-1 inline h-3 w-3" />
        লাইভ আপডেট চালু · প্রতি ৫ সেকেন্ডে অটো-রিফ্রেশ
      </footer>
    </div>
  )
}
