// PATCH /api/admin/access-keys/[id] — edit name / permissions / expiry / active
// DELETE /api/admin/access-keys/[id] — remove key
// MAIN ADMIN ONLY.
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, fail } from '@/lib/api'
import { SUB_ADMIN_PERM_IDS, ACCESS_KEY_ROLES } from '@/lib/constants'
import { requireMainAdmin, parsePerms } from '@/lib/staff-auth'

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

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireMainAdmin()
  if (denied) return denied
  const { id } = await params
  const body = await req.json().catch(() => ({}))

  const existing = await db.accessKey.findUnique({ where: { id } })
  if (!existing) return fail('কী পাওয়া যায়নি', 404)

  const data: {
    name?: string
    permissions?: string
    lifetime?: boolean
    expiresAt?: Date | null
    active?: boolean
  } = {}

  if (body.name !== undefined) {
    const name = (body.name || '').toString().trim()
    if (!name) return fail('কী-এর নাম দিন', 400)
    data.name = name
  }

  if (body.active !== undefined) data.active = Boolean(body.active)

  // permissions change (admin-controller keys only)
  if (body.permissions !== undefined && existing.role === ACCESS_KEY_ROLES.ADMIN_CONTROLLER) {
    if (!Array.isArray(body.permissions)) return fail('অনুমতি তালিকা ভুল', 400)
    const perms = body.permissions.filter(
      (p: unknown) => typeof p === 'string' && (SUB_ADMIN_PERM_IDS as readonly string[]).includes(p)
    )
    if (perms.length === 0) return fail('অন্তত একটি অনুমতি রাখুন', 400)
    data.permissions = JSON.stringify(perms)
  }

  // expiry change: lifetime toggle OR new expire-days (counted from now)
  if (body.lifetime !== undefined) data.lifetime = Boolean(body.lifetime)
  if (body.expireDays !== undefined) {
    const days = parseInt(body.expireDays, 10)
    if (isNaN(days) || days < 1) return fail('দিন সংখ্যা ১ বা তার বেশি দিন', 400)
    data.expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000)
    if (data.lifetime === undefined && existing.lifetime) data.lifetime = false
  }
  if (data.lifetime === true) data.expiresAt = null
  if (data.lifetime === false && data.expiresAt === undefined && !existing.expiresAt) {
    return fail('মেয়াদ দিন — দিন সংখ্যা অথবা লাইফটাইম', 400)
  }

  const key = await db.accessKey.update({ where: { id }, data })
  return ok({ key: serialize(key) })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireMainAdmin()
  if (denied) return denied
  const { id } = await params
  const existing = await db.accessKey.findUnique({ where: { id } })
  if (!existing) return fail('কী পাওয়া যায়নি', 404)
  await db.accessKey.delete({ where: { id } })
  return ok({ deleted: true })
}
