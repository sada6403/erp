import { appRoute } from '@/lib/app/context'
import { fail, intParam, likeEscape } from '@/lib/app/http'
import { VISIBLE_SQL } from '@/lib/app/catalogLib'
import { queryProducts } from '@/lib/app/catalogQuery'
import type { SearchResponse } from '@/lib/app/contracts/catalog'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = appRoute({ auth: 'none' }, async ({ req, company, origin }): Promise<SearchResponse> => {
  const sp = req.nextUrl.searchParams
  const q = (sp.get('q') || '').trim()
  if (q.length < 1 || q.length > 80) fail(400, 'VALIDATION', 'q must be 1-80 characters')
  const limit = intParam(sp.get('limit'), 30, 1, 100)
  const r = await queryProducts(company, { q, sort: 'relevance', limit, branchId: sp.get('branch_id'), inStock: sp.get('in_stock') === '1' }, origin)
  const like = '%' + likeEscape(q) + '%'
  const c = await company.tp.query<{ n: string }>(
    `SELECT COUNT(*) AS n FROM products p WHERE ${VISIBLE_SQL} AND (p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ? OR p.brand LIKE ?)`, [like, like, like, like])
  return { items: r.items, total: Number(c.rows[0]?.n) || 0 }
})
