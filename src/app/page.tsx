'use client'

// Landing / Scan Gateway — public entry.
// Customers can NO LONGER pick any table from a list (anti-scam).
// They must scan the QR code placed on their table with the camera
// (back camera preferred, front camera switchable) to join that table.
// Hero shows the restaurant logo + name from /api/site-config.
// Footer staff links (কিচেন ডিসপ্লে • অ্যাডমিন প্যানেল) toggle via
// staff_links_enabled + developer credit line (developer note).
import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  CameraOff,
  Flame,
  Loader2,
  Monitor,
  RefreshCw,
  ScanLine,
  ShieldCheck,
  SwitchCamera,
  UtensilsCrossed,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { Html5Qrcode } from 'html5-qrcode'

import { api, getDeviceId, getDeviceFp } from '@/lib/client'
import { LegalLinks } from '@/components/customer/legal-links'
import { DeveloperCredit } from '@/components/customer/developer-credit'
import { useSiteConfig } from '@/components/customer/site-config'

const READER_ID = 'table-qr-reader'

type Facing = 'environment' | 'user'

interface ScanResponse {
  tableNumber: number
  message: string
}

/** Extract the table number from a decoded QR payload. */
function parseTableNumber(text: string): number | null {
  const t = text.trim()
  // our printed QRs encode <origin>/t/<number> — accept any host (geo-fence protects us)
  const viaUrl = t.match(/\/t\/(\d{1,4})/)
  if (viaUrl) return parseInt(viaUrl[1], 10)
  // bare table number (e.g. "18")
  if (/^\d{1,4}$/.test(t)) return parseInt(t, 10)
  return null
}

function mapCameraError(err: unknown): string {
  const name = err instanceof DOMException ? err.name : ''
  const msg = typeof (err as { message?: string })?.message === 'string' ? (err as { message: string }).message : ''
  if (name === 'NotAllowedError' || /permission|denied/i.test(msg))
    return 'ক্যামেরার অনুমতি দেওয়া হয়নি। ব্রাউজার সেটিংস থেকে ক্যামেরা পারমিশন চালু করে আবার চেষ্টা করুন।'
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || /no camera|not found/i.test(msg))
    return 'ফোনে কোনো ক্যামেরা পাওয়া যায়নি। টেবিলের QR কোডটি অন্য ফোনের ক্যামেরা দিয়ে স্ক্যান করুন।'
  if (name === 'NotReadableError' || /in use|not readable/i.test(msg))
    return 'ক্যামেরাটি অন্য অ্যাপ ব্যবহার করছে। বন্ধ করে আবার চেষ্টা করুন।'
  return 'ক্যামেরা চালু করা যায়নি — আবার চেষ্টা করুন।'
}

export default function LandingPage() {
  const router = useRouter()
  const cfg = useSiteConfig()
  const [joining, setJoining] = useState<number | null>(null)
  const [logoError, setLogoError] = useState(false)
  const restaurantName = cfg?.restaurantName || 'Smart QR Restaurant'

  // scanner state
  const [scannerOpen, setScannerOpen] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [flipping, setFlipping] = useState(false)
  const scannerRef = useRef<Html5Qrcode | null>(null)
  const facingRef = useRef<Facing>('environment')
  const handledRef = useRef(false) // one decode → one join
  const invalidToastAtRef = useRef(0) // throttle invalid-QR toast (camera decodes every frame)

  /** Join (or create) the table session — same flow as scanning natively. */
  const joinTable = useCallback(
    async (tableNumber: number) => {
      setJoining(tableNumber)
      const res = await api.post<ScanResponse>('/api/scan', {
        tableNumber,
        deviceId: getDeviceId(),
        deviceFp: getDeviceFp(),
      })
      if (res.ok && res.data) {
        toast.success(res.data.message || `টেবিল ${tableNumber} — স্বাগতম!`)
        router.push('/menu')
      } else if (res.code === 'GEO_REQUIRED' || res.code === 'GEO_OUTSIDE') {
        // geo-fence needs the dedicated flow (browser geolocation + retry screens)
        router.push(`/t/${tableNumber}`)
      } else {
        setJoining(null)
        handledRef.current = false // allow retry
        toast.error(res.error || 'স্ক্যান ব্যর্থ হয়েছে — আবার চেষ্টা করুন')
      }
    },
    [router]
  )

  const stopScanner = useCallback(async () => {
    const s = scannerRef.current
    scannerRef.current = null
    if (!s) return
    try {
      await s.stop()
    } catch {
      /* already stopped */
    }
    try {
      s.clear()
    } catch {
      /* nothing to clear */
    }
  }, [])

  const onDecoded = useCallback(
    async (text: string) => {
      if (handledRef.current) return
      const n = parseTableNumber(text)
      if (n === null) {
        // scanner fires the callback on every frame — throttle the error toast
        const now = Date.now()
        if (now - invalidToastAtRef.current > 2500) {
          invalidToastAtRef.current = now
          toast.error('এটি আমাদের টেবিলের QR কোড নয়')
        }
        return
      }
      handledRef.current = true
      try {
        navigator.vibrate?.(120)
      } catch {
        /* vibration unsupported */
      }
      await stopScanner()
      setScannerOpen(false)
      void joinTable(n)
    },
    [joinTable, stopScanner]
  )

  const startScanner = useCallback(
    async (facing: Facing) => {
      setCameraError(null)
      try {
        const scanner = new Html5Qrcode(READER_ID, { verbose: false })
        scannerRef.current = scanner
        await scanner.start(
          { facingMode: facing },
          {
            fps: 10,
            qrbox: (vw: number, vh: number) => {
              const side = Math.max(180, Math.floor(Math.min(vw, vh) * 0.62))
              return { width: Math.min(side, 280), height: Math.min(side, 280) }
            },
          },
          (decodedText: string) => {
            void onDecoded(decodedText)
          },
          () => {
            /* per-frame decode miss — ignore */
          }
        )
      } catch (err) {
        scannerRef.current = null
        setCameraError(mapCameraError(err))
      }
    },
    [onDecoded]
  )

  // start camera once the overlay (and #READER_ID) is mounted
  useEffect(() => {
    if (!scannerOpen) return
    const t = window.setTimeout(() => void startScanner(facingRef.current), 150)
    return () => window.clearTimeout(t)
  }, [scannerOpen, startScanner])

  // release camera on unmount
  useEffect(() => {
    return () => {
      void stopScanner()
    }
  }, [stopScanner])

  function openScanner() {
    handledRef.current = false
    setCameraError(null)
    setScannerOpen(true)
  }

  async function closeScanner() {
    await stopScanner()
    setScannerOpen(false)
    setCameraError(null)
    handledRef.current = false
  }

  async function flipCamera() {
    if (flipping) return
    setFlipping(true)
    const next: Facing = facingRef.current === 'environment' ? 'user' : 'environment'
    facingRef.current = next
    await stopScanner()
    await startScanner(next)
    setFlipping(false)
  }

  async function retryCamera() {
    await stopScanner()
    await startScanner(facingRef.current)
  }

  return (
    <div className="flex min-h-screen flex-col bg-stone-50">
      {/* ── Hero ─────────────────────────────────────────────── */}
      <header className="relative overflow-hidden bg-gradient-to-br from-amber-500 via-orange-500 to-orange-600 pb-16 pt-12 text-white">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-20"
          style={{
            backgroundImage:
              'radial-gradient(circle at 20% 20%, rgba(255,255,255,0.5) 0, transparent 40%), radial-gradient(circle at 80% 60%, rgba(255,255,255,0.35) 0, transparent 45%)',
          }}
        />
        <div className="relative mx-auto flex max-w-3xl flex-col items-center gap-4 px-4 text-center">
          {cfg?.logoUrl && !logoError ? (
            <img
              src={cfg.logoUrl}
              alt={`${restaurantName} লোগো`}
              onError={() => setLogoError(true)}
              className="size-20 rounded-3xl object-cover shadow-lg ring-2 ring-white/40"
            />
          ) : (
            <div className="flex size-20 items-center justify-center rounded-3xl bg-white/20 shadow-inner ring-1 ring-white/30 backdrop-blur">
              <UtensilsCrossed className="size-10" />
            </div>
          )}
          <h1 className="text-3xl font-extrabold tracking-tight drop-shadow-sm sm:text-4xl">
            {restaurantName}
          </h1>
          <p className="text-base font-medium text-amber-50 sm:text-lg">
            স্ক্যান করুন, অর্ডার করুন, উপভোগ করুন!
          </p>
          <div className="mt-1 inline-flex items-center gap-2 rounded-full bg-white/15 px-4 py-1.5 text-xs font-semibold ring-1 ring-white/25">
            <Flame className="size-3.5 text-amber-100" />
            কোনো অপেক্ষা নেই — QR স্ক্যান করেই অর্ডার
          </div>
        </div>
        <div aria-hidden className="absolute inset-x-0 bottom-0 h-8 rounded-t-[2.5rem] bg-stone-50" />
      </header>

      {/* ── Scan gateway (no table list — anti-scam) ─────────── */}
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 pb-12 pt-6">
        <div className="mb-4 text-center">
          <h2 className="text-lg font-bold text-stone-800">টেবিলে বসে অর্ডার দিন</h2>
          <p className="mt-1 text-sm text-stone-500">
            আপনার টেবিলে লাগানো QR কোডটি স্ক্যান করুন — মেনু সাথে সাথে খুলে যাবে
          </p>
        </div>

        <div className="rounded-3xl border border-amber-100 bg-white p-6 shadow-sm sm:p-8">
          <div className="flex flex-col items-center gap-4 text-center">
            <span className="flex size-16 items-center justify-center rounded-2xl bg-amber-50 text-amber-600 ring-1 ring-amber-100">
              <ScanLine className="size-8" />
            </span>
            <div>
              <h3 className="text-base font-bold text-stone-800">টেবিলের QR কোড স্ক্যান করুন</h3>
              <p className="mt-1 text-sm text-stone-500">
                ক্যামেরা খুলবে — QR কোডটি ফ্রেমের ভেতরে ধরুন
              </p>
            </div>
            <button
              onClick={openScanner}
              disabled={joining !== null}
              className="mt-1 inline-flex min-h-11 items-center gap-2.5 rounded-2xl bg-gradient-to-r from-amber-500 to-orange-600 px-8 py-3.5 text-base font-black text-white shadow-lg shadow-amber-500/30 transition hover:brightness-105 active:scale-95 disabled:opacity-60"
            >
              <ScanLine className="size-5" />
              QR স্ক্যান করুন
            </button>
            <p className="text-xs font-medium text-stone-400">
              QR কোডটি টেবিলের গায়ে লাগানো থাকে — না পেলে ওয়েটারকে জিজ্ঞেস করুন
            </p>
          </div>
        </div>
      </main>

      {/* ── Footer ───────────────────────────────────────────── */}
      <footer className="mt-auto space-y-2 border-t border-amber-100 bg-white/70 py-4">
        {cfg?.staffLinksEnabled !== false && (
          <div className="mx-auto flex max-w-3xl items-center justify-center gap-6 text-xs font-medium">
            <Link
              href="/kds"
              className="flex items-center gap-1.5 text-stone-500 transition hover:text-amber-600"
            >
              <Monitor className="size-3.5" />
              কিচেন ডিসপ্লে
            </Link>
            <span aria-hidden className="text-stone-300">
              •
            </span>
            <Link
              href="/admin"
              className="flex items-center gap-1.5 text-stone-500 transition hover:text-amber-600"
            >
              <ShieldCheck className="size-3.5" />
              অ্যাডমিন প্যানেল
            </Link>
          </div>
        )}
        <p className="mx-auto max-w-3xl text-center text-[11px] text-stone-400">
          © {new Date().getFullYear()} {restaurantName} — স্বাগতম!
        </p>
        <LegalLinks />
        <DeveloperCredit />
      </footer>

      {/* ── Camera scanner overlay ───────────────────────────── */}
      {scannerOpen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-stone-950/95" role="dialog" aria-label="QR স্ক্যানার">
          <div className="flex items-center justify-between px-4 pb-2 pt-4 text-white">
            <button
              onClick={() => void closeScanner()}
              aria-label="স্ক্যানার বন্ধ করুন"
              className="flex size-10 items-center justify-center rounded-full bg-white/10 transition hover:bg-white/20"
            >
              <X className="size-5" />
            </button>
            <p className="text-sm font-bold">টেবিলের QR স্ক্যান করুন</p>
            <button
              onClick={() => void flipCamera()}
              disabled={flipping || Boolean(cameraError)}
              aria-label="ক্যামেরা ঘুরিয়ে দিন (ফ্রন্ট/ব্যাক)"
              className="flex size-10 items-center justify-center rounded-full bg-white/10 transition hover:bg-white/20 disabled:opacity-40"
            >
              {flipping ? <Loader2 className="size-5 animate-spin" /> : <SwitchCamera className="size-5" />}
            </button>
          </div>

          <div className="relative mx-auto w-full max-w-md flex-1 px-3">
            <div
              id={READER_ID}
              className="h-full w-full overflow-hidden rounded-2xl bg-black [&_video]:h-full [&_video]:w-full [&_video]:object-cover"
            />
            {cameraError && (
              <div className="absolute inset-3 flex flex-col items-center justify-center gap-4 rounded-2xl bg-stone-950/90 p-6 text-center">
                <span className="flex size-14 items-center justify-center rounded-full bg-red-500/15 text-red-400">
                  <CameraOff className="size-7" />
                </span>
                <p className="text-sm font-medium leading-relaxed text-stone-200">{cameraError}</p>
                <div className="flex flex-wrap items-center justify-center gap-3">
                  <button
                    onClick={() => void retryCamera()}
                    className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-amber-600"
                  >
                    <RefreshCw className="size-4" />
                    আবার চেষ্টা করুন
                  </button>
                  <button
                    onClick={() => void closeScanner()}
                    className="inline-flex min-h-11 items-center rounded-xl border border-white/20 px-5 py-2.5 text-sm font-bold text-stone-200 transition hover:bg-white/10"
                  >
                    বন্ধ করুন
                  </button>
                </div>
              </div>
            )}
          </div>

          <p className="pb-8 pt-3 text-center text-sm font-medium text-stone-300">
            QR কোডটি ফ্রেমের ভেতরে ধরুন — স্বয়ংক্রিয়ভাবে স্ক্যান হবে
          </p>
        </div>
      )}

      {/* ── Joining overlay ──────────────────────────────────── */}
      {joining !== null && (
        <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-4 bg-stone-950/90 text-white">
          <Loader2 className="size-10 animate-spin text-amber-400" />
          <p className="text-lg font-bold">টেবিল {joining} — যুক্ত হচ্ছে…</p>
          <p className="text-sm text-stone-300">এক সেকেন্ড, মেনু আনছি</p>
        </div>
      )}
    </div>
  )
}
