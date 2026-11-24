import { appRoute } from '@/lib/app/context'
import { fail } from '@/lib/app/http'
import type { BranchesResponse } from '@/lib/app/contracts/catalog'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function km(a: number, b: number, c: number, d: number) {
  const r = (x: number) => (x * Math.PI) / 180
  const h = Math.sin(r(c - a) / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(r(d - b) / 2) ** 2
  return 6371 * 2 * Math.asin(Math.sqrt(h))
}

export const GET = appRoute({ auth: 'none' }, async ({ req, company }): Promise<BranchesResponse> => {
  const lat = Number(req.nextUrl.searchParams.get('lat')), lng = Number(req.nextUrl.searchParams.get('lng'))
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) fail(400, 'VALIDATION', 'lat and lng are required')
  const { rows } = await company.tp.query<Record<string, unknown>>(
    `SELECT id, name, code, address, phone, latitude, longitude FROM branches WHERE is_active = 1`)
  const items = rows.map(b => {
    const bl = b.latitude != null ? Number(b.latitude) : null, bg = b.longitude != null ? Number(b.longitude) : null
    return {
      id: String(b.id), name: String(b.name), code: String(b.code), address: b.address ? String(b.address) : null,
      phone: b.phone ? String(b.phone) : null, latitude: bl, longitude: bg,
      distance_km: bl != null && bg != null ? Math.round(km(lat, lng, bl, bg) * 10) / 10 : null,
    }
  }).sort((a, b) => (a.distance_km ?? 1e9) - (b.distance_km ?? 1e9))
  return { items }
})
