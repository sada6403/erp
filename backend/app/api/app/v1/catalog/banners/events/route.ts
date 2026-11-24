import { appRoute } from '@/lib/app/context'
import { fail, only, oneOf, reqStr } from '@/lib/app/http'
import { colomboDay } from '@/lib/app/bannerLib'
import type { BannerEventResponse } from '@/lib/app/contracts/catalog'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Anonymous counters only: (banner_id, Colombo day) -> impressions / taps. No user, device or IP data is stored.
export const POST = appRoute({ auth: 'none', limiter: 'events' }, async ({ company, body }): Promise<BannerEventResponse> => {
  const b = await body()
  only(b, ['events'])
  if (!Array.isArray(b.events) || b.events.length < 1 || b.events.length > 50) fail(400, 'VALIDATION', 'events must have 1-50 items')
  const counts = new Map<string, { i: number; t: number }>()
  for (const raw of b.events) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail(400, 'VALIDATION', 'Invalid event')
    const e = raw as Record<string, unknown>
    only(e, ['banner_id', 'type'])
    const id = reqStr(e.banner_id, 'banner_id', 1, 191)
    const type = oneOf(e.type, 'type', ['impression', 'tap'] as const)
    const c = counts.get(id) ?? { i: 0, t: 0 }
    if (type === 'impression') c.i++; else c.t++
    counts.set(id, c)
  }
  // Only count real banners (no junk rows from guessed ids)
  const { rows } = await company.tp.query<{ id: string }>(`SELECT id FROM app_banners WHERE id IN (?)`, [[...counts.keys()]])
  const known = new Set(rows.map(r => String(r.id)))
  const day = colomboDay()
  let accepted = 0
  for (const [id, c] of counts) {
    if (!known.has(id)) continue
    await company.tp.query(
      `INSERT INTO app_banner_stats (banner_id, day, impressions, taps) VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE impressions = impressions + VALUES(impressions), taps = taps + VALUES(taps)`,
      [id, day, c.i, c.t])
    accepted += c.i + c.t
  }
  return { ok: true, accepted }
})
