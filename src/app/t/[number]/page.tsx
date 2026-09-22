'use client'

// QR scan target route — printed QR codes point here (e.g. /t/3).
// Fetches site-config; if the geo-fence is ON, asks for browser geolocation
// first (8s timeout) and sends lat/lng with POST /api/scan.
// 403 GEO_REQUIRED → friendly "share location" screen; GEO_OUTSIDE → 🚫 screen.
import { use, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  CheckCircle2,
  Loader2,
  MapPin,
  QrCode,
  ShieldBan,
  TriangleAlert,
  UtensilsCrossed,
} from 'lucide-react'

import { api, getDeviceId, getDeviceFp } from '@/lib/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  fetchSiteConfig,
  requestGeo,
  saveScanGeo,
  useSiteConfig,
} from '@/components/customer/site-config'

type Phase =
  | 'loading'
  | 'geolocating'
  | 'success'
  | 'error'
  | 'geo_required'
  | 'geo_outside'

interface ScanResult {
  tableNumber: number
  message: string
  reused: boolean
  guestCount: number
}

export default function ScanTargetPage({
  params,
}: {
  params: Promise<{ number: string }>
}) {
  const { number } = use(params)
  const router = useRouter()
  const cfg = useSiteConfig()
  const [phase, setPhase] = useState<Phase>('loading')
  const [errorMsg, setErrorMsg] = useState('')
  const [outsideMsg, setOutsideMsg] = useState('')
  const [welcome, setWelcome] = useState('')
  const started = useRef(false)

  async function runScan() {
    const tableNumber = Number.parseInt(number, 10)
    if (!tableNumber || Number.isNaN(tableNumber)) {
      setErrorMsg('এই লিংকে সঠিক টেবিল নম্বর নেই।')
      setPhase('error')
      return
    }

    setPhase('loading')
    const config = await fetchSiteConfig()

    // geo-fence ON → ask for browser location first (8s timeout)
    let coords: { lat: number; lng: number } | null = null
    if (config?.geoFence?.enabled) {
      setPhase('geolocating')
      try {
        coords = await requestGeo(8000)
        saveScanGeo(coords.lat, coords.lng) // reused for order-time fence checks
      } catch {
        // denied / unsupported / timed out → server would answer GEO_REQUIRED anyway
        setPhase('geo_required')
        return
      }
    }

    setPhase('loading')
    const res = await api.post<ScanResult>('/api/scan', {
      tableNumber,
      deviceId: getDeviceId(),
      deviceFp: getDeviceFp(),
      ...(coords ? { lat: coords.lat, lng: coords.lng } : {}),
    })

    if (res.ok && res.data) {
      setWelcome(res.data.message)
      setPhase('success')
      // brief success animation, then enter the menu
      setTimeout(() => router.replace('/menu'), 1200)
    } else if (res.code === 'GEO_REQUIRED') {
      setPhase('geo_required')
    } else if (res.code === 'GEO_OUTSIDE') {
      setOutsideMsg(res.error || 'আপনি রেস্টুরেন্টের নির্ধারিত এলাকার বাইরে আছেন।')
      setPhase('geo_outside')
    } else {
      setErrorMsg(res.error || 'কিছু একটা সমস্যা হয়েছে। আবার চেষ্টা করুন।')
      setPhase('error')
    }
  }

  useEffect(() => {
    if (started.current) return
    started.current = true
    // deferred one tick so the effect body itself never sets state synchronously
    const t = setTimeout(() => void runScan(), 0)
    return () => clearTimeout(t)
  }, [number])

  const restaurantName = cfg?.restaurantName || 'রেস্টুরেন্ট'

  return (
    <div className="flex min-h-screen flex-col bg-stone-50">
      <div className="flex flex-1 items-center justify-center p-4">
        {phase === 'loading' && (
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="flex size-20 items-center justify-center rounded-full bg-amber-100">
              <Loader2 className="size-9 animate-spin text-amber-600" />
            </div>
            <p className="text-base font-semibold text-stone-700">সেশন তৈরি হচ্ছে…</p>
            <p className="text-sm text-stone-400">অল্প ক্ষণক্ষেত্রের জন্য অপেক্ষা করুন</p>
          </div>
        )}

        {phase === 'geolocating' && (
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="relative flex size-20 items-center justify-center rounded-full bg-amber-100">
              <span
                aria-hidden
                className="absolute inline-flex size-full animate-ping rounded-full bg-amber-200 opacity-60"
              />
              <MapPin className="relative size-9 animate-bounce text-amber-600" />
            </div>
            <p className="text-base font-semibold text-stone-700">লোকেশন নেওয়া হচ্ছে…</p>
            <p className="max-w-xs text-sm leading-relaxed text-stone-500">
              টেবিল নিশ্চিত করতে ব্রাউজার লোকেশন চাইতে পারে — <b>Allow</b> দিন
            </p>
          </div>
        )}

        {phase === 'success' && (
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="flex size-24 animate-in zoom-in-75 items-center justify-center rounded-full bg-green-100 duration-500">
              <CheckCircle2 className="size-14 animate-pulse text-green-600" />
            </div>
            <div>
              <p className="text-xl font-extrabold text-stone-900">স্বাগতম! 🎉</p>
              <p className="mt-1 text-sm leading-relaxed text-stone-500">
                {welcome || `টেবিল ${number} সফলভাবে সংযুক্ত হয়েছে`}
              </p>
            </div>
          </div>
        )}

        {phase === 'geo_required' && (
          <Card className="w-full max-w-sm border-amber-200 shadow-lg shadow-amber-100/50">
            <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
              <div className="relative flex size-16 items-center justify-center rounded-full bg-amber-100">
                <span
                  aria-hidden
                  className="absolute inline-flex size-full animate-ping rounded-full bg-amber-200 opacity-60"
                />
                <MapPin className="relative size-8 text-amber-600" />
              </div>
              <div className="space-y-1.5">
                <h1 className="text-lg font-bold text-stone-900">📍 লোকেশন দরকার</h1>
                <p className="text-sm leading-relaxed text-stone-500">
                  {restaurantName} নিশ্চিত করতে চায় যে আপনি টেবিলেই আছেন। <br />
                  ব্রাউজারে <b>লোকেশন পারমিশন</b> দিয়ে আবার চেষ্টা করুন।
                </p>
              </div>
              <Button
                onClick={() => void runScan()}
                className="h-12 w-full bg-gradient-to-r from-amber-500 to-orange-600 text-base font-bold text-white shadow-md shadow-amber-200 hover:from-amber-600 hover:to-orange-700"
              >
                <MapPin className="size-4" />
                লোকেশন শেয়ার করুন
              </Button>
              <Link href="/" className="text-xs font-medium text-stone-400 hover:text-stone-600">
                হোমপেজে ফিরুন
              </Link>
            </CardContent>
          </Card>
        )}

        {phase === 'geo_outside' && (
          <Card className="w-full max-w-sm border-red-200 shadow-lg">
            <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
              <div className="flex size-16 items-center justify-center rounded-full bg-red-50">
                <ShieldBan className="size-8 text-red-500" />
              </div>
              <div className="space-y-1.5">
                <h1 className="text-lg font-bold text-stone-900">🚫 রেস্টুরেন্টের বাইরে</h1>
                <p className="text-sm leading-relaxed text-stone-500">{outsideMsg}</p>
              </div>
              <Button
                onClick={() => void runScan()}
                className="h-12 w-full bg-amber-500 text-base font-bold text-white hover:bg-amber-600"
              >
                <MapPin className="size-4" />
                আবার চেষ্টা করুন
              </Button>
              <Link href="/" className="text-xs font-medium text-stone-400 hover:text-stone-600">
                হোমপেজে ফিরুন
              </Link>
            </CardContent>
          </Card>
        )}

        {phase === 'error' && (
          <Card className="w-full max-w-sm border-red-100 shadow-lg">
            <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
              <div className="flex size-16 items-center justify-center rounded-full bg-red-50">
                <TriangleAlert className="size-8 text-red-500" />
              </div>
              <div className="space-y-1.5">
                <h1 className="text-lg font-bold text-stone-900">সমস্যা হয়েছে</h1>
                <p className="text-sm leading-relaxed text-stone-500">{errorMsg}</p>
              </div>
              <Button
                onClick={() => void runScan()}
                className="h-11 w-full bg-amber-500 text-base font-bold text-white hover:bg-amber-600"
              >
                <UtensilsCrossed className="size-4" />
                আবার চেষ্টা করুন
              </Button>
              <Button asChild variant="outline" className="h-10 w-full border-stone-200">
                <Link href="/">
                  <QrCode className="size-4" />
                  হোমপেজে ফিরুন
                </Link>
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
