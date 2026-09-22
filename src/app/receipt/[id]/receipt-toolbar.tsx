'use client'

// Toolbar above the printable receipt — hidden in print output (@media print).
// "PDF সেভ" opens the same print dialog where the user picks "Save as PDF".
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Download, Printer } from 'lucide-react'

export function ReceiptToolbar() {
  const [autoPrint, setAutoPrint] = useState(false)

  // ?print=1 → pop the print dialog automatically (used by the admin
  // বিল-নিন dialog: one tap = receipt ready to print / save as PDF)
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('print') !== '1') return
    const t = setTimeout(() => {
      setAutoPrint(true)
      window.print()
      setAutoPrint(false)
    }, 800)
    return () => clearTimeout(t)
  }, [])

  return (
    <div className="no-print mx-auto mb-5 w-full max-w-md rounded-2xl border border-stone-200 bg-white p-4 shadow-lg">
      <p className="text-center text-sm font-black text-stone-800">
        🧾 রসিদ প্রস্তুত{autoPrint ? ' — প্রিন্ট উইন্ডো খুলছে…' : ''}
      </p>
      <p className="mt-1 text-center text-xs text-stone-500">
        প্রিন্ট ডায়ালগে <span className="font-bold">“Save as PDF”</span> সিলেক্ট করলে PDF
        ডাউনলোড হবে — কাগজে বা ফোনে কাস্টমারকে দিতে পারবেন
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          onClick={() => window.print()}
          className="flex h-11 items-center justify-center gap-2 rounded-xl bg-stone-900 text-sm font-black text-white transition hover:bg-stone-800 active:scale-95"
        >
          <Printer className="size-4" />
          প্রিন্ট করুন
        </button>
        <button
          onClick={() => window.print()}
          className="flex h-11 items-center justify-center gap-2 rounded-xl bg-amber-500 text-sm font-black text-white shadow-md shadow-amber-200 transition hover:bg-amber-600 active:scale-95"
        >
          <Download className="size-4" />
          PDF সেভ
        </button>
      </div>
      <Link
        href="/admin"
        className="mt-3 flex items-center justify-center gap-1 text-xs font-bold text-stone-400 transition hover:text-stone-600"
      >
        <ArrowLeft className="size-3" />
        অ্যাডমিন প্যানেলে ফিরুন
      </Link>
    </div>
  )
}
