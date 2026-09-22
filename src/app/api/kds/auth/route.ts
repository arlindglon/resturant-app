// Kitchen Display access — key-based, like the admin panel.
// POST   /api/kds/auth — { key } → validate a KDS access key, set cookie
// GET    /api/kds/auth — session check for the KDS screen
// DELETE /api/kds/auth — logout
import { NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { db } from '@/lib/db'
import { ok, fail } from '@/lib/api'
import { KDS_COOKIE } from '@/lib/constants'
import { findKeyByCode, issueKdsCookie, getKdsAuth } from '@/lib/access'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const code = (body.key || '').toString()
  if (!code.trim()) return fail('কি কোড দিন', 400)

  const key = await findKeyByCode(code, 'KDS')
  if (!key) return fail('ভুল কি কোড, নিষ্ক্রিয়, বা মেয়াদ শেষ', 401)

  await issueKdsCookie(key.id, key.expiresAt)
  await db.accessKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } })
  return ok({ authed: true, name: key.name })
}

export async function GET() {
  const auth = await getKdsAuth()
  if (!auth) return ok({ authed: false })
  return ok({ authed: true, name: 'admin' in auth ? 'Main Admin' : auth.name })
}

export async function DELETE() {
  const store = await cookies()
  store.delete(KDS_COOKIE)
  return ok({ authed: false })
}
