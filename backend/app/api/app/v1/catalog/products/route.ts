import { appRoute } from '@/lib/app/context'
import { fail, intParam, toIso } from '@/lib/app/http'
import { queryProducts, removedProductIds } from '@/lib/app/catalogQuery'
import type { ProductsResponse } from '@/lib/app/contracts/catalog'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = appRoute({ auth: 'none' }, async ({ req, company, origin }): Promise<ProductsResponse> => {
  const sp = req.nextUrl.searchParams
  const since = sp.get('updated_since')
  if (since && !toIso(since)) fail(400, 'VALIDATION', 'updated_since must be an ISO date')
  const sort = sp.get('sort')
  if (sort && !['newest', 'price_asc', 'price_desc', 'name'].includes(sort)) fail(400, 'VALIDATION', 'Invalid sort')
  const num = (k: string) => { const v = sp.get(k); return v !== null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null }
  const cursor = sp.get('cursor')
  const r = await queryProducts(company, {
    updatedSince: since, categoryId: sp.get('category_id'), q: (sp.get('q') || '').trim().slice(0, 80) || null,
    sort: sort as 'newest' | 'price_asc' | 'price_desc' | 'name' | null, inStock: sp.get('in_stock') === '1',
    minPrice: num('min_price'), maxPrice: num('max_price'), branchId: sp.get('branch_id'),
    cursor, limit: intParam(sp.get('limit'), 100, 1, 500),
  }, origin)
  const removed = since && !cursor ? await removedProductIds(company, since) : []
  return { items: r.items, removed_ids: removed, next_cursor: r.nextCursor, server_time: new Date().toISOString() }
})
