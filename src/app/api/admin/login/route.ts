// POST /api/admin/login — passcode (main) OR admin-controller key (sub) → cookie
// GET  /api/admin/login — session check: kind + permissions for tab trimming
// DELETE /api/admin/login — logout
import { NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { ok, fail, makeAdminToken, isAdmin } from '@/lib/api'
import { db } from '@/lib/db'
import { ADMIN_COOKIE, STAFF_COOKIE, ACCESS_KEY_ROLES } from '@/lib/constants'
import {
  makeStaffToken,
  isKeyUsable,
  parsePerms,
  getStaffCtx,
  verifyStaffToken,
} from '@/lib/staff-auth'

const ADMIN_COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: 7 * 24 * 60 * 60,
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const input = (body.passcode || body.key || '').toString().trim()
  if (!input) return fail('পাসকোড বা কী দিন', 400)

  const store = await cookies()

  // 1) main admin passcode
  const expected = process.env.ADMIN_PASSCODE || 'admin123'
  if (input === expected) {
    store.set(ADMIN_COOKIE, makeAdminToken(), ADMIN_COOKIE_OPTS)
    return ok({ loggedIn: true, kind: 'main' })
  }

  // 2) sub-admin (admin controller) access key
  const key = await db.accessKey.findUnique({ where: { keyCode: input.toUpperCase() } })
  if (key && key.role === ACCESS_KEY_ROLES.ADMIN_CONTROLLER) {
    if (!key.active) return fail('এই কীটি নিষ্ক্রিয় করা হয়েছে', 403)
    if (!isKeyUsable(key)) return fail('এই কীটির মেয়াদ শেষ হয়ে গেছে', 403)
    store.set(STAFF_COOKIE, makeStaffToken(key.id), ADMIN_COOKIE_OPTS)
    await db.accessKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } })
    return ok({ loggedIn: true, kind: 'sub', name: key.name, permissions: parsePerms(key.permissions) })
  }

  return fail('ভুল পাসকোড বা কী', 401)
}

export async function GET() {
  if (await isAdmin()) return ok({ loggedIn: true, kind: 'main', permissions: ['*'] })

  // sub-admin session?
  const store = await cookies()
  const tok = verifyStaffToken(store.get(STAFF_COOKIE)?.value)
  if (tok && tok.keyId !== 'main') {
    const ctx = await getStaffCtx()
    if (ctx && ctx.role === 'ADMIN_CONTROLLER') {
      return ok({ loggedIn: true, kind: 'sub', name: ctx.name, permissions: ctx.permissions })
    }
  }
  return ok({ loggedIn: false })
}

export async function DELETE() {
  const store = await cookies()
  store.delete(ADMIN_COOKIE)
  store.delete(STAFF_COOKIE)
  return ok({ loggedIn: false })
}
