'use client'

// 🔔 অটো-পুশ ইঞ্জিন — কাস্টমার আর কোনো বাটন খুঁজে চাপবে না।
//
// যেভাবে চলে:
//   ১. মেনু পেজ খুললেই ~২.৫ সেকেন্ড পর ব্রাউজারের নিজস্ব "Allow" বাবল নিজে থেকেই
//      ভেসে ওঠে (Android Chrome — জেসচার ছাড়াই প্রম্পট দেখায়)।
//   ২. যেসব ব্রাউজার জেসচার ছাড়া প্রম্পট দেখায় না (iOS PWA, Firefox) — কাস্টমারের
//      প্রথম যেকোনো ট্যাপেই (যেমন ক্যাটাগরি/আইটেমে চাপ) সাথে সাথে প্রম্পট ওঠে।
//   ৩. একবার Allow → সাবস্ক্রিপশন DB-তে সাইলেন্টলি সেভ; পরের সব ভিজিটে কিছুই
//      জিজ্ঞেস করা হয় না (granted হলে সরাসরি সাইলেন্ট সাবস্ক্রাইব)।
//   ৪. Block → আর কখনো বিরক্ত করবে না; বাবল বন্ধ (dismiss) → ২০ ঘণ্টা পর আবার একবার।
//
// ব্রাউজারের কঠোর নিয়ম: "Allow" চাপটা কোনো ওয়েবসাইটই বাদ দিতে পারে না
// (Chrome/Safari সিকিউরিটি — Facebook-ও পারে না)। এই এক ট্যাপই ওয়েবের সর্বনিম্ন।
// UI-তে কোনো ঘণ্টা-বাটন আর রেন্ডার হয় না — এই কম্পোনেন্ট শুধু ইঞ্জিন চালায়।
import { useEffect, useRef } from 'react'
import { toast } from 'sonner'

import { api, getDeviceId } from '@/lib/client'

const SW_PATH = '/sw.js'
const SUB_FLAG = 'push_subscribed'
const ASK_FLAG = 'push_last_ask'
const RE_ASK_MS = 20 * 60 * 60 * 1000 // বাবল বন্ধ করলে ২০ ঘণ্টা পর আবার একবার

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const output = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i)
  return output
}

function lastAskAt(): number {
  try {
    return Number(localStorage.getItem(ASK_FLAG) || 0)
  } catch {
    return 0
  }
}

function markAsked(): void {
  try {
    localStorage.setItem(ASK_FLAG, String(Date.now()))
  } catch {
    /* প্রাইভেট মোড — থাক */
  }
}

export function PushBell({ tableNumber }: { tableNumber: number | null }) {
  const askedRef = useRef(false) // এই পেজ-লোডে প্রম্পট একবারই — ডাবল-প্রম্পট নেই

  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    let gestureCleanup: (() => void) | null = null

    // পারমিশন granted হলে (অটো/জেসচার যে-পথেই হোক) সাইলেন্ট সাবস্ক্রাইব
    const subscribeSilently = async () => {
      try {
        const reg = await navigator.serviceWorker.register(SW_PATH)
        await navigator.serviceWorker.ready
        let sub = await reg.pushManager.getSubscription()
        if (!sub) {
          const keyRes = await api.get<{ enabled: boolean; publicKey: string | null }>('/api/push/key')
          if (!keyRes.ok || !keyRes.data?.enabled || !keyRes.data.publicKey) return
          sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(keyRes.data.publicKey),
          })
        }
        const json = sub.toJSON()
        if (localStorage.getItem(SUB_FLAG) !== '1') {
          const res = await api.post<{ saved: boolean }>('/api/push/subscribe', {
            endpoint: json.endpoint,
            keys: json.keys,
            deviceId: getDeviceId(),
            tableNumber,
          })
          if (res.ok && res.data?.saved) {
            localStorage.setItem(SUB_FLAG, '1')
            toast.success('🔔 নোটিফিকেশন চালু — অর্ডার রেডি হলেই এখানেই জানাবো')
          }
        }
      } catch {
        /* নিরীহ — পরের ভিজিটে আবার চেষ্টা হবে */
      }
    }

    const askNow = async () => {
      if (askedRef.current || !alive) return
      askedRef.current = true
      markAsked() // প্রম্পট দেখানোর সিদ্ধান্ত নেওয়ার সাথে সাথেই মার্ক — রিলোড-স্প্যাম নেই
      try {
        const perm = await Notification.requestPermission()
        if (!alive) return
        if (perm === 'granted') void subscribeSilently()
        // 'denied' → আর কখনো জিজ্ঞেস না; 'default' (বন্ধ করল) → ASK_FLAG-এর ২০ ঘণ্টা গার্ড
      } catch {
        /* জেসচার-গেটেড ব্রাউজার — ফলব্যাক লিসেনার সামলাবে */
        askedRef.current = false
      }
    }

    const start = async () => {
      try {
        if (!('serviceWorker' in navigator) || !('PushManager' in window) || typeof Notification === 'undefined') return
        const keyRes = await api.get<{ enabled: boolean }>('/api/push/key')
        if (!alive || !keyRes.ok || !keyRes.data?.enabled) return

        if (Notification.permission === 'granted') {
          void subscribeSilently() // আগে অনুমতি আছে → একদম জিরো ক্লিক
          return
        }
        if (Notification.permission === 'denied') return // ব্লক করেছে → আর কখনো বিরক্ত না

        // বাবল বন্ধ করেছিল → ২০ ঘণ্টা কুলডাউন
        if (Date.now() - lastAskAt() < RE_ASK_MS) return

        // ফলব্যাক: যেসব ব্রাউজার জেসচার ছাড়া প্রম্পট দেখায় না — প্রথম ট্যাপেই ওঠে
        const gesture = () => {
          if (gestureCleanup) gestureCleanup()
          void askNow()
        }
        document.addEventListener('pointerdown', gesture, true)
        gestureCleanup = () => document.removeEventListener('pointerdown', gesture, true)

        // প্রাইমারি: Android Chrome জেসচার ছাড়াই প্রম্পট দেখায় — মেনু আঁকা শেষ হলে ওঠে
        timer = setTimeout(() => {
          if (gestureCleanup) gestureCleanup()
          void askNow()
        }, 2500)
      } catch {
        /* নিরীহ */
      }
    }

    void start()
    return () => {
      alive = false
      if (timer) clearTimeout(timer)
      if (gestureCleanup) gestureCleanup()
    }
  }, [tableNumber])

  return null // UI-তে আর কিছু দেখায় না — ইঞ্জিন-only
}
