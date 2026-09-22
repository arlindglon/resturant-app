'use client'

// Tasteful developer credit footer line (menu + homepage + customer pages).
// Rendered only when the site-config developer note is enabled.

import { useSiteConfig } from '@/components/customer/site-config'

export function DeveloperCredit({ className }: { className?: string }) {
  const cfg = useSiteConfig()
  if (!cfg?.developerNote?.enabled) return null
  const text = cfg.developerNote.text?.trim()
  if (!text) return null

  return (
    <p className={className ?? 'text-center text-[11px] text-stone-400'}>
      <span aria-hidden>👨‍💻 </span>
      {cfg.developerNote.link ? (
        <a
          href={cfg.developerNote.link}
          target="_blank"
          rel="noopener noreferrer"
          className="underline decoration-stone-300 underline-offset-2 transition hover:text-stone-600"
        >
          {text}
        </a>
      ) : (
        <span>{text}</span>
      )}
    </p>
  )
}
