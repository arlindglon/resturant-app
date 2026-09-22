// /receipt/[id] — printable digital receipt / invoice (print + save as PDF).
// Admin opens it from the admin panel; customers get it after bill payment.
'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { Printer, ArrowLeft, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/client'

interface ReceiptData {
  receiptNo: number
  tableNumber: number
  ordersCount: number
  subtotal: number
  discountTotal: number
  total: number
  paymentMethod: string
  paidAt: string
  items: {
    orderNo: number
    items: { name: string; qty: number; returnedQty?: number; unitPrice: number; lineTotal: number; spiceLevel?: string | null; addons?: string | { name: string; price: number }[] | null; specialNote?: string | null }[]
    subtotal: number
    returnedAmount?: number
    happyHourDiscount: number
    voucherDiscount: number
    voucherVoided?: boolean
    birthdayDiscount: number
    voucherCode?: string | null
    total: number
  }[]
}

/** addons may arrive as a JSON string or an already-parsed array — render both safely */
function addonsText(addons: string | { name: string; price: number }[] | null | undefined): string {
  if (!addons) return ''
  try {
    const list = typeof addons === 'string' ? (JSON.parse(addons) as { name: string }[]) : addons
    if (!Array.isArray(list) || list.length === 0) return ''
    return list.map((a) => a?.name || '').filter(Boolean).join(', ')
  } catch {
    return ''
  }
}

const METHOD_LABEL: Record<string, string> = {
  CASH: 'ক্যাশ',
  CARD: 'কার্ড',
  BKASH: 'বিকাশ',
  NAGAD: 'নগদ',
  ONLINE: 'অনলাইন',
}

const money = (n: number) => `৳${n.toFixed(n % 1 === 0 ? 0 : 2)}`

export default function ReceiptPrintPage() {
  const params = useParams<{ id: string }>()
  const [data, setData] = useState<ReceiptData | null>(null)
  const [cfg, setCfg] = useState({ name: '', subtitle: '', thanks: '', footer: '', logo: '', poweredBy: 'Powered by Smart QR' })
  const [developer, setDeveloper] = useState<{ enabled: boolean; text: string; link: string }>({
    enabled: false,
    text: '',
    link: '',
  })
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    ;(async () => {
      try {
        const [res, cRes] = await Promise.all([
          api.get<{ receipt: ReceiptData }>(`/api/receipt/${params.id}`),
          api.get<{
            restaurantName: string
            logoUrl: string
            receiptSubtitle: string
            receiptThanks: string
            poweredBy?: string
            developerNote?: { enabled: boolean; text: string; link: string }
          }>('/api/site-config'),
        ])
        if (!res.ok || !res.data) throw new Error(res.error || 'রসিদ লোড করা যায়নি')
        setData(res.data.receipt)
        const c = cRes.data
        setCfg({
          name: c?.restaurantName || '',
          subtitle: c?.receiptSubtitle || 'ডিজিটাল রসিদ',
          thanks: c?.receiptThanks || 'ধন্যবাদ! আবার আসবেন 🙏',
          footer: '',
          logo: c?.logoUrl || '',
          poweredBy: c?.poweredBy ?? 'Powered by Smart QR',
        })
        setDeveloper({
          enabled: c?.developerNote?.enabled ?? false,
          text: c?.developerNote?.text || '',
          link: c?.developerNote?.link || '',
        })
      } catch (e) {
        setError(e instanceof Error ? e.message : 'রসিদ লোড করা যায়নি')
      } finally {
        setLoaded(true)
      }
    })()
  }, [params.id])

  if (!loaded) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-stone-100">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-stone-300 border-t-stone-700" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-stone-100 p-6 text-center">
        <p className="text-lg font-semibold text-red-600">{error || 'রসিদ পাওয়া যায়নি'}</p>
        <Button variant="outline" onClick={() => window.close()}>
          <ArrowLeft className="h-4 w-4" /> ফিরে যান
        </Button>
      </div>
    )
  }

  const paidAt = new Date(data.paidAt)
  const paidAtText = paidAt.toLocaleString('bn-BD', { dateStyle: 'medium', timeStyle: 'short' })

  return (
    <div className="min-h-screen bg-stone-200 py-6 print:bg-white print:py-0">
      <style>{`@media print { .no-print { display: none !important } .receipt-paper { box-shadow: none !important; border-radius: 0 !important; max-width: 100% !important } body { background: white } }`}</style>

      <div className="no-print mx-auto mb-4 flex max-w-md items-center justify-between px-4">
        <Button variant="outline" size="sm" onClick={() => window.close()}>
          <ArrowLeft className="h-4 w-4" /> ফিরে যান
        </Button>
        <Button size="sm" onClick={() => window.print()} className="bg-stone-900 text-white hover:bg-stone-800">
          <Printer className="h-4 w-4" /> প্রিন্ট / PDF সেভ
        </Button>
      </div>

      <div className="receipt-paper mx-auto max-w-md rounded-xl bg-white p-6 shadow-lg sm:p-8">
        {/* header */}
        <div className="border-b-2 border-dashed border-stone-300 pb-4 text-center">
          {cfg.logo ? (
            <img src={cfg.logo} alt={cfg.name} className="mx-auto mb-2 h-14 w-14 rounded-lg object-cover" />
          ) : null}
          <h1 className="text-xl font-extrabold text-stone-900">{cfg.name}</h1>
          <p className="text-xs text-stone-500">{cfg.subtitle}</p>
        </div>

        {/* meta */}
        <div className="flex items-center justify-between border-b-2 border-dashed border-stone-300 py-3 text-[13px] text-stone-600">
          <div>
            <p>রসিদ নং: <span className="font-bold text-stone-900">#{data.receiptNo}</span></p>
            <p>টেবিল: <span className="font-bold text-stone-900">{data.tableNumber}</span></p>
          </div>
          <div className="text-right">
            <p>{paidAtText}</p>
            <p className="inline-flex items-center gap-1 font-bold text-emerald-700">
              <CheckCircle2 className="h-3.5 w-3.5" /> পরিশোধিত ({METHOD_LABEL[data.paymentMethod] || data.paymentMethod})
            </p>
          </div>
        </div>

        {/* items */}
        <div className="py-3">
          {data.items.map((o) => (
            <div key={o.orderNo} className="mb-3">
              <p className="mb-1 text-[13px] font-bold text-stone-800">অর্ডার #{o.orderNo}</p>
              <table className="w-full text-[13px]">
                <tbody>
                  {o.items.map((it, ix) => (
                    <tr key={ix} className="align-top">
                      <td className="py-0.5 pr-2 text-stone-700">
                        {it.name} <span className="text-stone-500">×{it.qty}</span>
                        {(it.returnedQty ?? 0) > 0 && (
                          <span className="ml-1 text-[11px] font-bold text-red-600">↩ {it.returnedQty}টি রিটার্ন</span>
                        )}
                        {it.spiceLevel ? <span className="ml-1 text-[11px] text-orange-600">[{it.spiceLevel}]</span> : null}
                        {(() => { const at = addonsText(it.addons); return at ? (
                          <span className="block text-[11px] text-stone-500">+ {at}</span>
                        ) : null })()}
                        {it.specialNote ? <span className="block text-[11px] italic text-stone-500">📝 {it.specialNote}</span> : null}
                      </td>
                      <td className="whitespace-nowrap py-0.5 text-right font-medium text-stone-800">{money(it.lineTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {(o.voucherDiscount > 0 || o.happyHourDiscount > 0 || o.birthdayDiscount > 0) && (
                <div className="mt-1 space-y-0.5 text-[12px] text-emerald-700">
                  {o.happyHourDiscount > 0 && <p>হ্যাপি আওয়ার ছাড়: −{money(o.happyHourDiscount)}</p>}
                  {o.voucherDiscount > 0 && <p>কুপন {o.voucherCode ? `(${o.voucherCode})` : ''} ছাড়: −{money(o.voucherDiscount)}</p>}
                  {o.birthdayDiscount > 0 && <p>অকেশন ছাড়: −{money(o.birthdayDiscount)}</p>}
                </div>
              )}
              {(o.voucherVoided ?? false) && (
                <p className="mt-1 text-[12px] font-bold text-red-600">
                  🎟️ কুপন {o.voucherCode ? `(${o.voucherCode}) ` : ''}ছাড় রিটার্নের কারণে বাতিল হয়েছে
                </p>
              )}
              {(o.returnedAmount ?? 0) > 0 && (
                <p className="mt-1 text-[12px] font-bold text-red-600">
                  ↩ রিটার্ন মোট: −{money(o.returnedAmount ?? 0)}
                </p>
              )}
            </div>
          ))}
        </div>

        {/* totals */}
        <div className="space-y-1 border-t-2 border-dashed border-stone-300 pt-3 text-[13px]">
          <div className="flex justify-between text-stone-600">
            <span>সাবটোটাল</span>
            <span>{money(data.subtotal)}</span>
          </div>
          {data.discountTotal > 0 && (
            <div className="flex justify-between text-emerald-700">
              <span>মোট ছাড়</span>
              <span>−{money(data.discountTotal)}</span>
            </div>
          )}
          <div className="flex justify-between border-t border-stone-300 pt-2 text-base font-extrabold text-stone-900">
            <span>মোট প্রদেয়</span>
            <span>{money(data.total)}</span>
          </div>
        </div>

        {/* footer */}
        <div className="mt-5 border-t-2 border-dashed border-stone-300 pt-3 text-center">
          <p className="text-sm font-semibold text-stone-800">{cfg.thanks}</p>
          <p className="mt-1 text-[11px] text-stone-400">
            {cfg.name}
            {cfg.poweredBy.trim() ? ` • ${cfg.poweredBy.trim()}` : ''}
          </p>
          {developer.enabled && developer.text.trim() && (
            <p className="mt-1.5 text-[10px] text-stone-400 print:text-stone-500">
              <span aria-hidden>👨‍💻 </span>
              {developer.link ? (
                <a
                  href={developer.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline decoration-stone-300 underline-offset-2"
                >
                  {developer.text}
                </a>
              ) : (
                <span>{developer.text}</span>
              )}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
