'use client'

// 🔔 কাস্টমার ওয়েব-পুশ ঘণ্টা — মেনু পেজে ভাসমান ছোট বাটন।
// ট্যাপ → পারমিশন → সাবস্ক্রাইব → ওয়েলকাম পুশ। অর্ডার রেডি হলে কাস্টমার
// ব্রাউজারেই নোটিফিকেশন পায় (Meta রিভিউ/ডকুমেন্ট কিছুই লাগে না)।
import { useCallback, useEffect, useState } from 'react'
import { Bell, BellRing, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { api, getDeviceId } from '@/lib/client'

const SW_PATH = '/sw.js'
const SUB_FLAG = 'push_subscribed'

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const output = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i)
  return output
}

export function PushBell({ tableNumber }: { tableNumber: number | null }) {
  const [state, setState] = useState<'hidden' | 'idle' | 'busy' | 'done'>('hidden')

  const subscribe = useCallback(async () => {
    setState('busy')
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || typeof Notification === 'undefined') {
        toast.error('এই ব্রাউজারে নোটিফিকেশন সাপোর্ট নেই')
        setState('hidden')
        return
      }
      const perm = await Notification.requestPermission()
      if (perm !== 'granted') {
        toast.error('পারমিশন দেওয়া হয়নি — ব্রাউজার সেটিংস → Site settings → Notifications থেকে চালু করতে পারবেন')
        setState('idle')
        return
      }
      const keyRes = await api.get<{ enabled: boolean; publicKey: string | null }>('/api/push/key')
      if (!keyRes.ok || !keyRes.data?.enabled || !keyRes.data.publicKey) {
        toast.error('নোটিফিকেশন এখন বন্ধ আছে')
        setState('hidden')
        return
      }
      const reg = await navigator.serviceWorker.register(SW_PATH)
      await navigator.serviceWorker.ready
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(keyRes.data.publicKey),
      })
      const json = sub.toJSON()
      const res = await api.post<{ saved: boolean }>('/api/push/subscribe', {
        endpoint: json.endpoint,
        keys: json.keys,
        deviceId: getDeviceId(),
        tableNumber,
      })
      if (!res.ok || !res.data?.saved) throw new Error(res.error || 'সেভ হয়নি')
      localStorage.setItem(SUB_FLAG, '1')
      setState('done')
      toast.success('🔔 চালু হয়েছে! অর্ডার রেডি হলেই জানাবো')
    } catch (err) {
      if ((err as Error)?.name === 'NotAllowedError') {
        toast.error('নোটিফিকেশন ব্লকড — ব্রাউজার সেটিংস থেকে অনুমতি দিন')
      } else {
        toast.error('নোটিফিকেশন চালু করা যায়নি — আবার চেষ্টা করুন')
      }
      setState('idle')
    }
  }, [tableNumber])

  useEffect(() => {
    let alive = true
    const check = async () => {
      try {
        if (localStorage.getItem(SUB_FLAG) === '1') {
          if (alive) setState('done')
          return
        }
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && 'serviceWorker' in navigator) {
          const reg = await navigator.serviceWorker.getRegistration(SW_PATH)
          const existing = reg ? await reg.pushManager.getSubscription() : null
          if (existing) {
            localStorage.setItem(SUB_FLAG, '1')
            if (alive) setState('done')
            return
          }
        }
        const keyRes = await api.get<{ enabled: boolean }>('/api/push/key')
        if (alive) setState(keyRes.ok && keyRes.data?.enabled ? 'idle' : 'hidden')
      } catch {
        /* নিরীহ — বাটন লুকানো থাকবে */
      }
    }
    const t = setTimeout(check, 1500)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [])

  if (state === 'hidden' || state === 'done') return null

  return (
    <button
      type="button"
      onClick={subscribe}
      aria-label="নোটিফিকেশন চালু করুন — অর্ডার রেডি হলে জানাবো"
      className="fixed bottom-4 right-3 z-40 flex h-12 w-12 items-center justify-center rounded-full border border-stone-200 bg-white text-stone-700 shadow-lg transition active:scale-95"
    >
      {state === 'busy' ? <Loader2 className="h-5 w-5 animate-spin" /> : state === 'done' ? <BellRing className="h-5 w-5 text-emerald-600" /> : <Bell className="h-5 w-5" />}
      <span className="absolute -top-1 -right-1 flex h-3.5 w-3.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
        <span className="relative inline-flex h-3.5 w-3.5 rounded-full bg-amber-500" />
      </span>
    </button>
  )
}
