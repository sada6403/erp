import { appRoute } from '@/lib/app/context'
import { fail } from '@/lib/app/http'
import { VISIBLE_SQL, loadDealEnds, loadStock, loadVariants, mapProductDetail } from '@/lib/app/catalogLib'
import type { ProductDetailDto } from '@/lib/app/contracts/catalog'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = appRoute({ auth: 'none' }, async ({ req, company, params, origin }): Promise<ProductDetailDto> => {
  const id = params.id
  const { rows } = await company.tp.query<Record<string, unknown>>(
    `SELECT p.*, c.name AS category_name FROM products p LEFT JOIN categories c ON c.id = p.category_id
      WHERE (p.id = ? OR p.slug = ?) AND ${VISIBLE_SQL} LIMIT 1`, [id, id])
  const p = rows[0]
  if (!p) fail(404, 'NOT_FOUND', 'Product not found')
  const branch = req.nextUrl.searchParams.get('branch_id')
  const [stock, variants, deals] = await Promise.all([loadStock(company, [String(p.id)], branch), loadVariants(company, [String(p.id)]), loadDealEnds(company, [String(p.id)])])
  return mapProductDetail(p, stock, variants.get(String(p.id)) ?? [], origin, deals)
})
