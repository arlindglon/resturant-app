'use client'

// Menu item description utilities + renderer.
//
// Fixes the duplicated-description bug (e.g. "চিকেন ফ্রাই চিকেন ফ্রাই চিকেন ফ্রাই…
// + পলাও + সালাদ + ড্রিংক") by collapsing duplicated fragments at RENDER time
// (the admin HTML editor can store repeated fragments — data is never edited here).
// Also renders safe admin HTML (script/iframe/on* attributes stripped) and
// falls back to markdown-lite (**bold**, newlines) for plain text.

/* ─────────────── 1. duplicate-fragment / word-run collapsing ─────────────── */

function collapseRepeatedWordRuns(text: string): string {
  // token = word or whitespace chunk (whitespace preserved to keep line breaks)
  const tokens = text.split(/(\s+)/).filter((t) => t.length > 0)
  let words: string[] = []
  let wordIdx: number[] = []
  const rebuild = () => {
    words = []
    wordIdx = []
    tokens.forEach((t, i) => {
      if (!/^\s+$/.test(t)) {
        words.push(t.toLowerCase())
        wordIdx.push(i)
      }
    })
  }
  rebuild()

  // remove tokens[a..b] inclusive
  const removeRange = (a: number, b: number) => {
    tokens.splice(a, b - a + 1)
    rebuild()
  }

  const changed = { v: false }
  const collapsePass = (n: number, minRepeats: number) => {
    let loop = true
    while (loop) {
      loop = false
      outer: for (let i = 0; i + n * minRepeats <= words.length; i++) {
        // phrase P = words[i..i+n) must repeat minRepeats times back-to-back
        for (let r = 1; r < minRepeats; r++) {
          for (let k = 0; k < n; k++) {
            if (words[i + r * n + k] !== words[i + k]) continue outer
          }
        }
        const a = wordIdx[i + n]
        const b = wordIdx[i + n * minRepeats - 1]
        removeRange(a, b)
        changed.v = true
        loop = true
        break
      }
    }
  }

  // multi-word phrases: any immediate repeat (2×) is a duplication bug
  for (const n of [3, 2]) collapsePass(n, 2)
  // single words: only runs of 3+ identical words collapse (keep 1)
  collapsePass(1, 3)

  return tokens.join('')
}

function collapseDuplicateFragments(line: string): string {
  // split on " + " / "," separators — dedupe identical (trimmed) fragments
  if (!/\s*\+\s*|\s*,\s*/.test(line)) return line
  const parts = line.split(/\s*\+\s*|\s*,\s*/).map((p) => p.trim()).filter(Boolean)
  if (parts.length < 2) return line.trim()
  const seen = new Set<string>()
  const kept: string[] = []
  for (const p of parts) {
    const key = p.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    kept.push(p)
  }
  // single surviving fragment → return it without any separator
  if (kept.length === 1) return kept[0]
  // keep the document's own separator style
  const sep = /,/.test(line) ? ', ' : ' + '
  return kept.join(sep)
}

/** Collapses repeated comma/plus-separated fragments + repeated word runs. */
export function cleanDescription(raw: string): string {
  if (!raw) return ''
  return raw
    .split('\n')
    .map((line) => collapseDuplicateFragments(collapseRepeatedWordRuns(line)))
    .join('\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

/* ─────────────── 2. tiny regex HTML sanitizer (no deps) ─────────────── */

const BLOCKED_BLOCK_RE =
  /<(script|iframe|style|object|embed|form|input|button)\b[^>]*>[\s\S]*?<\/\1>/gi
const BLOCKED_TAG_RE = /<\/?(script|iframe|style|object|embed|form|input|button|link|meta)\b[^>]*>/gi
const ON_ATTR_RE = /\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi
const JS_URL_RE = /(href|src)\s*=\s*("|\')\s*javascript:[^"']*\2/gi

export function sanitizeHtml(html: string): string {
  return html
    .replace(BLOCKED_BLOCK_RE, '')
    .replace(BLOCKED_TAG_RE, '')
    .replace(ON_ATTR_RE, ' ')
    .replace(JS_URL_RE, '$1="#"')
    .trim()
}

export function stripHtml(html: string): string {
  return html
    .replace(/<(script|style|iframe|object|embed)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|li|div|h[1-6])>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
}

/* ─────────────── 3. render helpers ─────────────── */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const LOOKS_LIKE_HTML_RE = /<\/?[a-z][^>]*>/i

/** Full pipeline raw → safe HTML string (dedupe + sanitize/markdown-lite). */
export function descriptionToHtml(raw: string): string {
  if (!raw) return ''
  const cleaned = cleanDescription(raw)
  if (LOOKS_LIKE_HTML_RE.test(cleaned)) {
    return sanitizeHtml(cleaned)
  }
  // plain text: escape → **bold** → newlines
  return escapeHtml(cleaned)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/\n/g, '<br/>')
}

/** Plain one-line preview text for cards (deduped + tags stripped). */
export function descriptionPreview(raw: string | null): string {
  if (!raw) return ''
  const cleaned = cleanDescription(raw)
  const withBreaks = LOOKS_LIKE_HTML_RE.test(cleaned) ? stripHtml(cleaned) : cleaned
  return withBreaks.replace(/\n+/g, ' ').replace(/\s{2,}/g, ' ').trim()
}

/* ─────────────── 4. renderer component ─────────────── */

export function ItemDescription({
  description,
  className,
}: {
  description: string | null
  className?: string
}) {
  if (!description) return null
  const html = descriptionToHtml(description)
  if (!html) return null
  return (
    <div
      className={
        className ??
        'text-sm leading-relaxed text-stone-600 [&_b]:font-semibold [&_li]:my-0.5 [&_ul]:list-disc [&_ul]:pl-4'
      }
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
