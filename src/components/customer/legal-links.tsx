'use client'

// Legal page links (terms / privacy / data-deletion) shown in customer footers.
// Visibility per link is controlled from the admin panel (settings tab) —
// turning a link OFF only hides it; the page itself stays publicly reachable.

import Link from 'next/link'

import { useSiteConfig } from '@/components/customer/site-config'

export function LegalLinks({ className }: { className?: string }) {
  const cfg = useSiteConfig()
  // config not loaded yet (SSR / first paint) → render nothing (no flash of
  // links that the admin may have turned off); matches DeveloperCredit pattern
  if (!cfg) return null
  const ll = cfg.legalLinks

  const items = [
    ll?.terms !== false && { href: '/terms-and-condition', label: 'শর্তাবলী' },
    ll?.privacy !== false && { href: '/privacy-policy', label: 'গোপনীয়তা নীতি' },
    ll?.dataDel !== false && { href: '/datadel-page', label: 'ডেটা ডিলিট' },
  ].filter(Boolean) as { href: string; label: string }[]

  if (items.length === 0) return null

  return (
    <div
      className={
        className ??
        'flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[11px] font-medium'
      }
    >
      {items.map((item, i) => (
        <span key={item.href} className="flex items-center gap-x-2">
          {i > 0 && (
            <span aria-hidden className="text-stone-300">
              •
            </span>
          )}
          <Link
            href={item.href}
            className="text-stone-400 underline decoration-stone-200 underline-offset-2 transition hover:text-amber-600 hover:decoration-amber-300"
          >
            {item.label}
          </Link>
        </span>
      ))}
    </div>
  )
}
