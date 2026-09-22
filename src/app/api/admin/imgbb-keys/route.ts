// ImgBB API keys management
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, fail, isAdmin } from '@/lib/api'
import { seedEnvKeys } from '@/lib/imgbb'
import { requirePerm } from '@/lib/staff-auth'

export async function GET() {
  const denied = await requirePerm('imgbb')
  if (denied) return denied
  await seedEnvKeys()
  const keys = await db.imgbbKey.findMany({ orderBy: [{ active: 'desc' }, { usageCount: 'asc' }] })
  return ok({
    keys: keys.map((k) => ({ ...k, key: k.key.slice(0, 6) + '••••••••' + k.key.slice(-4), fullKeyLength: k.key.length })),
  })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const key = (body.key || '').toString().trim()
  if (!key) return fail('API Key প্রয়োজন', 400)

  const exists = await db.imgbbKey.findUnique({ where: { key } })
  if (exists) return fail('এই Key আগে থেকেই আছে', 400)

  const created = await db.imgbbKey.create({
    data: { key, label: body.label || null, active: true },
  })
  return ok({ key: { ...created, key: key.slice(0, 6) + '••••••••' + key.slice(-4) } })
}
