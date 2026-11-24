import { NextRequest, NextResponse } from 'next/server'
import { resolveAdminCompany } from '@/lib/app/adminLib'
import { fail, handleError } from '@/lib/app/http'
import { colomboDay } from '@/lib/app/bannerLib'
import type { BannerStatsResponse } from '@/lib/app/contracts/catalog'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

// POS desktop (x-api-key). Defaults to the last 30 Colombo days.
export async function GET(req: NextRequest) {
  try {
    const company = await resolveAdminCompany(req)
    const sp = req.nextUrl.searchParams
    const to = sp.get('to') || colomboDay()
    const from = sp.get('from') || colomboDay(new Date(Date.now() - 29 * 86400000))
    if (!DAY_RE.test(from) || !DAY_RE.test(to) || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) fail(400, 'VALIDATION', 'from/to must be YYYY-MM-DD')
    if (from > to) fail(400, 'VALIDATION', 'from must not be after to')
    if ((Date.parse(to) - Date.parse(from)) / 86400000 > 366) fail(400, 'VALIDATION', 'Range is limited to 366 days')
    const { rows } = await company.tp.query<{ banner_id: string; day: string; impressions: number; taps: number }>(
      `SELECT banner_id, DATE_FORMAT(day, '%Y-%m-%d') AS day, impressions, taps FROM app_banner_stats WHERE day BETWEEN ? AND ? ORDER BY day, banner_id LIMIT 20000`, [from, to])
    const totals = new Map<string, { impressions: number; taps: number }>()
    const days = rows.map(r => ({ day: String(r.day), banner_id: String(r.banner_id), impressions: Number(r.impressions) || 0, taps: Number(r.taps) || 0 }))
    for (const d of days) {
      const t = totals.get(d.banner_id) ?? { impressions: 0, taps: 0 }
      t.impressions += d.impressions; t.taps += d.taps
      totals.set(d.banner_id, t)
    }
    const out: BannerStatsResponse = { items: [...totals].map(([banner_id, t]) => ({ banner_id, ...t })), days }
    return NextResponse.json(out, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    return handleError(err)
  }
}
