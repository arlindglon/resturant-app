// Shared shell for public legal pages (terms / privacy / data deletion).
// Server component — reads restaurant name + messenger from settings so the
// pages always follow the admin panel branding. Content itself is static.

import Link from 'next/link'
import type { ReactNode } from 'react'

import { SETTING_KEYS } from '@/lib/constants'
import { getSetting } from '@/lib/settings'
import { LegalLinks } from '@/components/customer/legal-links'

export const LEGAL_UPDATED_BN = 'সেপ্টেম্বর ২০২৬'

/** One titled section inside the legal card. */
export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-base font-black text-stone-800">{title}</h2>
      <div className="mt-1.5 space-y-2 text-sm leading-relaxed text-stone-600">{children}</div>
    </section>
  )
}

export function LegalList({ items }: { items: string[] }) {
  return (
    <ul className="space-y-1.5">
      {items.map((it, i) => (
        <li key={i} className="flex gap-2">
          <span aria-hidden className="mt-[7px] size-1.5 shrink-0 rounded-full bg-amber-400" />
          <span>{it}</span>
        </li>
      ))}
    </ul>
  )
}

export async function LegalShell({
  title,
  intro,
  children,
}: {
  title: string
  intro: string
  children: ReactNode
}) {
  const [name, messenger] = await Promise.all([
    getSetting(SETTING_KEYS.RESTAURANT_NAME),
    getSetting(SETTING_KEYS.MESSENGER_PAGE_USERNAME),
  ])
  const restaurantName = (name || 'Smart QR Restaurant').trim()
  const messengerLink = messenger.trim() ? `https://m.me/${messenger.trim()}` : ''

  return (
    <div className="flex min-h-screen flex-col bg-stone-50">
      {/* top bar */}
      <header className="sticky top-0 z-20 border-b border-amber-100 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4">
          <Link
            href="/"
            className="flex min-h-9 items-center gap-1.5 rounded-full bg-amber-50 px-3 text-sm font-bold text-amber-700 transition hover:bg-amber-100"
          >
            <span aria-hidden>←</span> হোম
          </Link>
          <p className="truncate text-sm font-black text-stone-800">🍽️ {restaurantName}</p>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-10 pt-5">
        {/* hero */}
        <div className="rounded-3xl bg-gradient-to-br from-amber-500 to-orange-600 p-6 text-white shadow-lg shadow-amber-500/20">
          <h1 className="text-2xl font-black">{title}</h1>
          <p className="mt-1.5 text-sm leading-relaxed text-amber-50">{intro}</p>
          <p className="mt-3 text-[11px] font-semibold text-amber-100/90">
            সর্বশেষ হালনাগাদ: {LEGAL_UPDATED_BN}
          </p>
        </div>

        {/* content card */}
        <article className="mt-4 space-y-5 rounded-3xl border border-stone-200 bg-white p-5 shadow-sm sm:p-6">
          {children}
          {messengerLink && (
            <section>
              <h2 className="text-base font-black text-stone-800">📞 যোগাযোগ</h2>
              <p className="mt-1.5 text-sm leading-relaxed text-stone-600">
                যেকোনো প্রশ্ন বা অনুরোধের জন্য রেস্টুরেন্টে সরাসরি যোগাযোগ করুন, অথবা{' '}
                <a
                  href={messengerLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-bold text-amber-700 underline decoration-amber-300 underline-offset-2 hover:text-amber-800"
                >
                  মেসেঞ্জারে মেসেজ দিন
                </a>
                ।
              </p>
            </section>
          )}
        </article>

        {/* cross links to the other legal pages (respect admin toggles) */}
        <div className="mt-4 rounded-2xl border border-amber-100 bg-amber-50/60 px-4 py-3">
          <LegalLinks className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs font-bold" />
        </div>
      </main>

      {/* footer — sticks to bottom on short screens */}
      <footer className="mt-auto space-y-1 border-t border-amber-100 bg-white/70 py-4">
        <p className="text-center text-[11px] text-stone-400">
          © {new Date().getFullYear()} {restaurantName} — স্বাগতম!
        </p>
      </footer>
    </div>
  )
}
