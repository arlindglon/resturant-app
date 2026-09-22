'use client'

// Lightweight rich-text renderer for menu descriptions.
// Admins write plain text with simple rules:
//   • / - / *  at line start  → bullet point
//   1. / ১. at line start     → numbered point (rendered as bullet)
//   **text**                  → bold
//   blank line                → paragraph spacing
// No raw HTML is executed — fully safe rendering.

import { Fragment } from 'react'
import { cn } from '@/lib/utils'

const BULLET_RE = /^\s*(?:[•●◦▪*~-]|\d+[.)]|[০-৯]+[.)])\s+/
const BOLD_RE = /\*\*([^*]+)\*\*/g

/** Strip markdown-ish markers — used for small one-line previews (menu cards) */
export function plainText(text: string): string {
  return text
    .split('\n')
    .map((l) => l.replace(BULLET_RE, '').replace(/\*\*/g, '').trim())
    .filter(Boolean)
    .join(' · ')
}

/** Inline **bold** renderer */
function InlineBold({ text }: { text: string }) {
  const parts = text.split(BOLD_RE)
  // split with a capture group → odd indexes are the bold contents
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <strong key={i} className="font-extrabold text-stone-900">
            {part}
          </strong>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        )
      )}
    </>
  )
}

export function RichText({ text, className }: { text: string; className?: string }) {
  const lines = (text || '').split('\n')
  const blocks: { type: 'p' | 'li'; text: string }[] = []

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) {
      blocks.push({ type: 'p', text: '' }) // spacing marker
      continue
    }
    if (BULLET_RE.test(line)) {
      blocks.push({ type: 'li', text: line.replace(BULLET_RE, '') })
    } else {
      blocks.push({ type: 'p', text: line })
    }
  }

  // group consecutive <li> into one list for tighter spacing
  const groups: { type: 'p' | 'gap' | 'list'; items: string[] }[] = []
  for (const b of blocks) {
    const last = groups[groups.length - 1]
    if (b.type === 'li') {
      if (last?.type === 'list') last.items.push(b.text)
      else groups.push({ type: 'list', items: [b.text] })
    } else if (b.text === '') {
      groups.push({ type: 'gap', items: [] })
    } else {
      groups.push({ type: 'p', items: [b.text] })
    }
  }

  if (groups.length === 0) return null

  const hasList = groups.some((g) => g.type === 'list')

  return (
    <div className={cn('space-y-1.5', className)}>
      {groups.map((g, gi) => {
        if (g.type === 'gap') return <div key={gi} className="h-1.5" />
        if (g.type === 'p')
          return (
            <p key={gi} className="text-sm leading-relaxed text-stone-600">
              <InlineBold text={g.items[0]} />
            </p>
          )
        // list — warm amber dots, eye-catching
        return (
          <ul key={gi} className="space-y-1.5">
            {g.items.map((it, ii) => (
              <li key={ii} className="flex items-start gap-2 text-sm leading-relaxed text-stone-700">
                <span
                  aria-hidden
                  className={cn(
                    'mt-[7px] size-1.5 shrink-0 rounded-full',
                    hasList ? 'bg-amber-500' : 'bg-stone-300'
                  )}
                />
                <span>
                  <InlineBold text={it} />
                </span>
              </li>
            ))}
          </ul>
        )
      })}
    </div>
  )
}
