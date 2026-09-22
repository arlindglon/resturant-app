'use client'

// Landing / Scan Gateway — public entry. Simulates scanning a table QR.
// Hero shows the restaurant logo + name from /api/site-config.
// Footer staff links (কিচেন ডিসপ্লে • অ্যাডমিন প্যানেল) toggle via
// staff_links_enabled + developer credit line (developer note).
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Flame, Loader2, Monitor, QrCode, ShieldCheck, UtensilsCrossed } from 'lucide-react'
import { toast } from 'sonner'

import { api, getDeviceId, getDeviceFp } from '@/lib/client'
import { DeveloperCredit } from '@/components/customer/developer-credit'
import { useSiteConfig } from '@/components/customer/site-config'

const TABLES = [1, 2, 3, 4, 5, 6, 7, 8]

interface ScanResponse {
  tableNumber: number
  message: string
}

export default function LandingPage() {
  const router = useRouter()
  const cfg = useSiteConfig()
  const [scanning, setScanning] = useState<number | null>(null)
  const [logoError, setLogoError] = useState(false)
  const restaurantName = cfg?.restaurantName || 'Spice Garden'

  async function handleScan(tableNumber: number) {
    if (scanning !== null) return
    setScanning(tableNumber)
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
      setScanning(null)
      toast.error(res.error || 'স্ক্যান ব্যর্থ হয়েছে — আবার চেষ্টা করুন')
    }
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

      {/* ── Table grid ───────────────────────────────────────── */}
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-12 pt-6">
        <div className="mb-4 text-center">
          <h2 className="text-lg font-bold text-stone-800">টেবিল সিলেক্ট করুন</h2>
          <p className="mt-1 text-sm text-stone-500">
            টেবিলের QR কোড স্ক্যান করে অথবা নিচের টেবিলে ট্যাপ করে শুরু করুন
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
          {TABLES.map((n) => {
            const busy = scanning === n
            return (
              <button
                key={n}
                onClick={() => handleScan(n)}
                disabled={scanning !== null}
                className="group flex flex-col items-center gap-3 rounded-2xl border border-amber-100 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-amber-300 hover:shadow-md disabled:cursor-wait disabled:opacity-70"
              >
                <span className="flex size-12 items-center justify-center rounded-xl bg-amber-50 text-amber-600 transition group-hover:bg-amber-500 group-hover:text-white">
                  {busy ? (
                    <Loader2 className="size-6 animate-spin" />
                  ) : (
                    <QrCode className="size-6" />
                  )}
                </span>
                <span className="text-sm font-bold text-stone-700">টেবিল {n}</span>
                <span className="text-[11px] font-medium text-stone-400">
                  {busy ? 'স্ক্যান হচ্ছে…' : 'স্ক্যান করতে ট্যাপ করুন'}
                </span>
              </button>
            )
          })}
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
        <DeveloperCredit />
      </footer>
    </div>
  )
}
