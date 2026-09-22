// Staff access-key login — used by the Kitchen Display gate.
// POST { key }   → KDS key (or main-admin passcode) → signed staff cookie
// GET            → current session info
// DELETE         → logout
import { NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { ok, fail } from '@/lib/api'
import { db } from '@/lib/db'
import { STAFF_COOKIE, ACCESS_KEY_ROLES } from '@/lib/constants'
import { makeStaffToken, isKeyUsable, getStaffCtx } from '@/lib/staff-auth'

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: 7 * 24 * 60 * 60,
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const input = (body.key || '').toString().trim()
  if (!input) return fail('কী দিন', 400)

  // main-admin passcode also unlocks the kitchen display
  const adminPasscode = process.env.ADMIN_PASSCODE || 'admin123'
  if (input === adminPasscode) {
    const store = await cookies()
    store.set(STAFF_COOKIE, makeStaffToken('main'), COOKIE_OPTS)
    return ok({ loggedIn: true, kind: 'main', name: 'মেইন অ্যাডমিন' })
  }

  const key = await db.accessKey.findUnique({
    where: { keyCode: input.toUpperCase() },
  })
  if (!key || key.role !== ACCESS_KEY_ROLES.KDS) return fail('ভুল কী', 401)
  if (!key.active) return fail('এই কীটি নিষ্ক্রিয় করা হয়েছে', 403)
  if (!isKeyUsable(key)) return fail('এই কীটির মেয়াদ শেষ হয়ে গেছে', 403)

  const store = await cookies()
  store.set(STAFF_COOKIE, makeStaffToken(key.id), COOKIE_OPTS)
  await db.accessKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } })
  return ok({ loggedIn: true, kind: 'key', name: key.name })
}

export async function GET() {
  const ctx = await getStaffCtx()
  if (!ctx) return ok({ authed: false })
  return ok({
    authed: true,
    kind: ctx.kind,
    role: ctx.role,
    name: ctx.name,
    permissions: ctx.permissions,
  })
}

export async function DELETE() {
  const store = await cookies()
  store.delete(STAFF_COOKIE)
  return ok({ loggedOut: true })
}
