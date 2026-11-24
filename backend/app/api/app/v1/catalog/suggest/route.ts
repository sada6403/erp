import { appRoute } from '@/lib/app/context'
import { fail, likeEscape } from '@/lib/app/http'
import { VISIBLE_SQL, imageVariantUrl, priceOf, taxRateOf } from '@/lib/app/catalogLib'
import type { SuggestResponse } from '@/lib/app/contracts/catalog'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = appRoute({ auth: 'none' }, async ({ req, company, origin }): Promise<SuggestResponse> => {
  const q = (req.nextUrl.searchParams.get('q') || '').trim()
  if (q.length < 1 || q.length > 60) fail(400, 'VALIDATION', 'q must be 1-60 characters')
  const { rows } = await company.tp.query<Record<string, unknown>>(
    `SELECT p.id, p.name, p.image_url, p.selling_price, p.discount_pct, p.tax_rate FROM products p
      WHERE ${VISIBLE_SQL} AND p.name LIKE ? ORDER BY (p.name LIKE ?) DESC, p.name LIMIT 8`,
    ['%' + likeEscape(q) + '%', likeEscape(q) + '%'])
  return {
    suggestions: [...new Set(rows.map(r => String(r.name)))],
    products: rows.slice(0, 5).map(r => ({
      id: String(r.id), name: String(r.name), thumbnail_url: imageVariantUrl(origin, r.image_url, 300),
      price: priceOf(Number(r.selling_price), Number(r.discount_pct) || 0, taxRateOf(r)).price,
    })),
  }
})
