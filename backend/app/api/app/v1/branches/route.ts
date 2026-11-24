import { appRoute } from '@/lib/app/context'
import type { BranchesResponse } from '@/lib/app/contracts/catalog'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = appRoute({ auth: 'none' }, async ({ company }): Promise<BranchesResponse> => {
  const { rows } = await company.tp.query<Record<string, unknown>>(
    `SELECT id, name, code, address, phone, latitude, longitude FROM branches WHERE is_active = 1 ORDER BY name`)
  return { items: rows.map(b => ({
    id: String(b.id), name: String(b.name), code: String(b.code), address: b.address ? String(b.address) : null,
    phone: b.phone ? String(b.phone) : null,
    latitude: b.latitude != null ? Number(b.latitude) : null, longitude: b.longitude != null ? Number(b.longitude) : null,
  })) }
})
