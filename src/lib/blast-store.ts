'use client'

// AI ব্রডকাস্ট — ব্যাকগ্রাউন্ড ইঞ্জিন (module-level zustand store)
//
// মালিক "সবাইকে পাঠান" চাপলেই লুপটা এখানে চলে — ডায়ালগ বন্ধ করলেও,
// অন্য ট্যাবে গেলেও পাঠানো চলতে থাকে। ভাসমান পিল (BlastProgressPill)
// সব ট্যাবে লাইভ প্রগ্রেস দেখায়; চাইলে মাঝপথে থামানো যায়।
//
// ইচ্ছাকৃতভাবে ব্রাউজার-লুপ: প্রতি কাস্টমারের জন্য আলাদা API কল — Vercel
// timeout + Gemini rate-limit দুটোই নিরাপদ থাকে, কোনো সার্ভার জবও লাগে না।
import { create } from 'zustand'
import { toast } from 'sonner'

import { api, type ApiResponse } from '@/lib/client'

export interface BlastTarget {
  id: string
  name: string
}

export interface BlastResult {
  name: string
  status: 'ok' | 'fail'
  via?: string
  error?: string
}

interface BlastState {
  running: boolean
  stopRequested: boolean
  info: string
  targets: BlastTarget[]
  results: BlastResult[]
  /** পাঠানো শুরু করো — সাথে সাথেই রিটার্ন করে (লুপ ব্যাকগ্রাউন্ডে চলে) */
  start: (targets: BlastTarget[], info: string, opts: { onAuthRequired: () => void }) => boolean
  /** মাঝপথে থামাও — চলমান কাস্টমারটা শেষ হলে লুপ থামবে */
  stop: () => void
  /** ফলাফল তালিকা মুছে ফেলো */
  clear: () => void
}

/** 401-জাতীয় এরর = লগইন শেষ */
function authFailed(res: ApiResponse<unknown>): boolean {
  return !res.ok && (/admin login/i.test(res.error || '') || res.code === 'KDS_KEY_REQUIRED' || /লগইন প্রয়োজন/.test(res.error || ''))
}

export const useBlastStore = create<BlastState>()((set, get) => ({
  running: false,
  stopRequested: false,
  info: '',
  targets: [],
  results: [],

  start: (targets, info, opts) => {
    if (get().running) {
      toast.error('একটা ব্রডকাস্ট ইতিমধ্যে চলছে — আগে সেটা শেষ/থামান')
      return false
    }
    if (!targets.length || !info.trim()) return false
    set({ running: true, stopRequested: false, targets, info: info.trim(), results: [] })

    // ── ব্যাকগ্রাউন্ড লুপ (store-এর বাইরে, UI আনব্লকড) ──
    void (async () => {
      const rows: BlastResult[] = []
      for (const c of targets) {
        if (get().stopRequested) break
        const res = await api.post<{ sent: boolean; via: string }>('/api/admin/customers/personal-blast', {
          customerId: c.id,
          info: get().info,
        })
        if (authFailed(res)) {
          rows.push({ name: c.name, status: 'fail', error: 'লগইন শেষ — আবার ঢুকুন' })
          set({ results: [...rows] })
          toast.error('লগইন শেষ হয়ে গেছে — ব্রডকাস্ট থামানো হলো, আবার লগইন করে বাকিদের পাঠান')
          opts.onAuthRequired()
          break
        }
        rows.push({
          name: c.name,
          status: res.ok ? 'ok' : 'fail',
          via: res.ok ? res.data?.via : undefined,
          error: res.ok ? undefined : res.error,
        })
        set({ results: [...rows] })
        // Gemini/Messenger rate limit — প্রতি পাঠানোর মাঝে ছোট বিরতি
        await new Promise((r) => setTimeout(r, 900))
      }
      const stopped = get().stopRequested
      set({ running: false })
      const okN = rows.filter((r) => r.status === 'ok').length
      if (stopped) {
        toast.info(`থামানো হলো — এতক্ষণে ${okN} জনকে ইউনিক মেসেজ গেছে`)
      } else {
        toast.success(`সম্পন্ন — ${okN}/${rows.length} জনকে ইউনিক মেসেজ গেছে`)
      }
    })()

    return true
  },

  stop: () => {
    if (get().running) set({ stopRequested: true })
  },

  clear: () => {
    if (!get().running) set({ results: [], targets: [], info: '' })
  },
}))
