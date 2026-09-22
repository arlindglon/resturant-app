// Admin CRUD for staff access keys (KDS + admin-controller).
// MAIN ADMIN ONLY — guarded by requireMainAdmin().
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, fail } from '@/lib/api'
import { ACCESS_KEY_ROLES, SUB_ADMIN_PERM_IDS } from '@/lib/constants'
import { requireMainAdmin, generateKeyCode, parsePerms } from '@/lib/staff-auth'

function serialize(k: {
  id: string
  keyCode: string
  name: string
  role: string
  permissions: string
  lifetime: boolean
  expiresAt: Date | null
  active: boolean
  lastUsedAt: Date | null
  createdAt: Date
}) {
  return { ...k, permissions: parsePerms(k.permissions) }
}

export async function GET() {
  const denied = await requireMainAdmin()
  if (denied) return denied
  const keys = await db.accessKey.findMany({ orderBy: { createdAt: 'desc' } })
  return ok({ keys: keys.map(serialize) })
}

export async function POST(req: NextRequest) {
  const denied = await requireMainAdmin()
  if (denied) return denied
  const body = await req.json().catch(() => ({}))

  const name = (body.name || '').toString().trim()
  const role = body.role === ACCESS_KEY_ROLES.ADMIN_CONTROLLER ? ACCESS_KEY_ROLES.ADMIN_CONTROLLER : ACCESS_KEY_ROLES.KDS
  const lifetime = Boolean(body.lifetime)
  const expireDays = parseInt(body.expireDays, 10)

  if (!name) return fail('কী-এর নাম দিন', 400)
  if (!lifetime && (isNaN(expireDays) || expireDays < 1)) {
    return fail('মেয়াদ দিন — দিন সংখ্যা (১ বা তার বেশি) অথবা লাইফটাইম চালু করুন', 400)
  }
  if (lifetime && (isNaN(expireDays) || expireDays < 1)) {
    // lifetime keys ignore expireDays — fine
  }

  let permissions: string[] = []
  if (role === ACCESS_KEY_ROLES.ADMIN_CONTROLLER) {
    if (!Array.isArray(body.permissions)) return fail('অনুমতি নির্বাচন করুন', 400)
    permissions = body.permissions.filter((p: unknown) =>
      typeof p === 'string' && (SUB_ADMIN_PERM_IDS as readonly string[]).includes(p)
    )
    if (permissions.length === 0) return fail('অন্তত একটি অনুমতি মার্ক করুন', 400)
  }

  const expiresAt = lifetime ? null : new Date(Date.now() + expireDays * 24 * 60 * 60 * 1000)

  // unique key code with retry
  let keyCode = ''
  for (let i = 0; i < 6; i++) {
    const candidate = generateKeyCode(role === ACCESS_KEY_ROLES.KDS ? 'KDS' : 'SA')
    const clash = await db.accessKey.findUnique({ where: { keyCode: candidate } })
    if (!clash) {
      keyCode = candidate
      break
    }
  }
  if (!keyCode) return fail('কী তৈরি করা যায়নি — আবার চেষ্টা করুন', 500)

  const key = await db.accessKey.create({
    data: {
      keyCode,
      name,
      role,
      permissions: JSON.stringify(permissions),
      lifetime,
      expiresAt,
      active: true,
    },
  })
  return ok({ key: serialize(key) })
}
