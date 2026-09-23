// GET /api/admin/qrcode?tableNumber=N — print-ready QR PNG (logo + table number)
// QR URL auto-matches the current deployment (proxy-aware): NO hardcoded localhost.
import { NextRequest } from 'next/server'
import QRCode from 'qrcode'
import { fail, isAdmin } from '@/lib/api'
import { db } from '@/lib/db'
import { getSetting } from '@/lib/settings'
import { SETTING_KEYS } from '@/lib/constants'
import { getPublicOrigin } from '@/lib/origin'
import { requirePerm } from '@/lib/staff-auth'

export async function GET(req: NextRequest) {
  const denied = await requirePerm('settings')
  if (denied) return denied

  const tableNumber = parseInt(req.nextUrl.searchParams.get('tableNumber') || '0', 10)
  if (!tableNumber) return fail('tableNumber প্রয়োজন', 400)

  const table = await db.restaurantTable.findUnique({ where: { number: tableNumber } })
  if (!table) return fail('টেবিল পাওয়া যায়নি', 404)

  const origin = await getPublicOrigin(req)
  const scanUrl = `${origin}/t/${tableNumber}`
  const restaurantName = await getSetting(SETTING_KEYS.RESTAURANT_NAME)
  const logoUrl = await getSetting(SETTING_KEYS.RESTAURANT_LOGO_URL)

  // 720×1080 card: header + big QR + footer
  const W = 720, H = 1080
  const qrSize = 520

  const qrDataUrl = await QRCode.toDataURL(scanUrl, {
    width: qrSize,
    margin: 1,
    errorCorrectionLevel: 'H',
    color: { dark: '#1a1a2e', light: '#ffffff' },
  })

  let logoImg = ''
  if (logoUrl) {
    try {
      const res = await fetch(logoUrl, { signal: AbortSignal.timeout(5000) })
      const buf = Buffer.from(await res.arrayBuffer())
      logoImg = `data:${res.headers.get('content-type') || 'image/png'};base64,${buf.toString('base64')}`
    } catch { /* skip logo on failure */ }
  }

  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <rect width="${W}" height="${H}" fill="#ffffff" rx="24"/>
  <rect x="8" y="8" width="${W - 16}" height="${H - 16}" fill="none" stroke="#c2410c" stroke-width="6" rx="20"/>
  <text x="${W / 2}" y="100" text-anchor="middle" font-family="Georgia, serif" font-size="44" font-weight="bold" fill="#1a1a2e">${esc(restaurantName)}</text>
  <line x1="80" y1="130" x2="${W - 80}" y2="130" stroke="#e7e5e4" stroke-width="3"/>
  ${
    logoImg
      ? `<image x="${W / 2 - 60}" y="160" width="120" height="120" href="${logoImg}" preserveAspectRatio="xMidYMid meet"/>`
      : ''
  }
  <image x="${W / 2 - qrSize / 2}" y="${logoImg ? 310 : 210}" width="${qrSize}" height="${qrSize}" href="${qrDataUrl}"/>
  <circle cx="${W / 2}" cy="${logoImg ? 310 : 210}" r="0"/>
  <text x="${W / 2}" y="${(logoImg ? 310 : 210) + qrSize + 70}" text-anchor="middle" font-family="Arial" font-size="52" font-weight="bold" fill="#c2410c">টেবিল ${tableNumber}</text>
  <text x="${W / 2}" y="${(logoImg ? 310 : 210) + qrSize + 120}" text-anchor="middle" font-family="Arial" font-size="26" fill="#57534e">মেনু দেখতে ও অর্ডার দিতে ক্যামেরা দিয়ে স্ক্যান করুন</text>
</svg>`

  // rasterize svg → png via qrcode's svg? We built custom svg; convert with sharp
  const sharp = (await import('sharp')).default
  const png = await sharp(Buffer.from(svg)).png().toBuffer()

  return new Response(new Uint8Array(png), {
    headers: {
      'Content-Type': 'image/png',
      'Content-Disposition': `attachment; filename="table-${tableNumber}-qr.png"`,
    },
  })
}
