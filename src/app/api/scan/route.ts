// POST /api/scan — QR scan gateway: creates OR joins the shared HMAC-signed
// table session, occupies table. Same table = same session = same bill.
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, fail } from '@/lib/api'
import { createSessionForTable } from '@/lib/session'
import { TABLE_STATUS } from '@/lib/constants'
import { emitEvent } from '@/lib/emit'
import { checkGeoFence } from '@/lib/geo'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const tableNumber = parseInt(body.tableNumber, 10)
    const deviceId = typeof body.deviceId === 'string' ? body.deviceId.slice(0, 80) : undefined
    const deviceFp = typeof body.deviceFp === 'string' ? body.deviceFp.slice(0, 40) : undefined

    if (!tableNumber || isNaN(tableNumber)) return fail('টেবিল নম্বর প্রয়োজন', 400)

    const table = await db.restaurantTable.findUnique({ where: { number: tableNumber } })
    if (!table) return fail('এই নম্বরের কোনো টেবিল খুঁজে পাওয়া যায়নি', 404)

    // GEOFENCE: block scans from outside the pinned restaurant area
    const geo = await checkGeoFence({ lat: Number(body.lat), lng: Number(body.lng) })
    if (!geo.allowed) {
      return fail(geo.message, 403, geo.code)
    }

    // create (or join) session + push signed cookie (duration from admin settings)
    const { session, expiresAt, durationMinutes, reused } = await createSessionForTable(table.id, deviceId, deviceFp)

    // occupy table (idempotent)
    if (table.status !== TABLE_STATUS.OCCUPIED) {
      await db.restaurantTable.update({
        where: { id: table.id },
        data: { status: TABLE_STATUS.OCCUPIED },
      })
      emitEvent('table:occupied', { tableNumber: table.number })
    }

    // how many devices are in this shared session?
    const guestCount = await db.sessionDevice.count({ where: { sessionId: session.id } })

    return ok({
      tableNumber: table.number,
      expiresAt: expiresAt.toISOString(),
      durationMinutes,
      reused,
      guestCount,
      redirect: '/menu',
      geoDistance: geo.distance,
      message: reused
        ? `টেবিল ${table.number}-এ স্বাগতম! এই টেবিলের সবাই একসাথে একই বিলে অর্ডার করছেন (সেশন বাকি ${durationMinutes} মিনিট)।`
        : `টেবিল ${table.number} — স্বাগতম! সেশন ${durationMinutes} মিনিটের জন্য সক্রিয়।`,
    })
  } catch (e) {
    console.error('[scan]', e)
    return fail('স্ক্যান ব্যর্থ হয়েছে', 500)
  }
}
