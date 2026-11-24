import { appRoute } from '@/lib/app/context'
import { fail, toIso } from '@/lib/app/http'
import { VISIBLE_SQL, imageVariantUrl } from '@/lib/app/catalogLib'
import type { CategoriesResponse } from '@/lib/app/contracts/catalog'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = appRoute({ auth: 'none' }, async ({ req, company, origin }): Promise<CategoriesResponse> => {
  const since = req.nextUrl.searchParams.get('updated_since')
  if (since && !toIso(since)) fail(400, 'VALIDATION', 'updated_since must be an ISO date')
  const t = since ? new Date(since).toISOString().slice(0, 19).replace('T', ' ') : null
  const { rows } = await company.tp.query<Record<string, unknown>>(
    `SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id AND ${VISIBLE_SQL}) AS product_count
       FROM categories c WHERE c.is_active = 1 ${t ? 'AND c.updated_at > ?' : ''} ORDER BY c.sort_order, c.name`, t ? [t] : [])
  let removed: string[] = []
  if (t) {
    const a = await company.tp.query<{ id: string }>(`SELECT id FROM categories WHERE is_active = 0 AND updated_at > ?`, [t])
    const d = await company.tp.query<{ record_id: string }>(`SELECT record_id FROM sync_deletions WHERE table_name = 'categories' AND deleted_at > ?`, [t])
    removed = [...a.rows.map(r => r.id), ...d.rows.map(r => r.record_id)]
  }
  return {
    items: rows.map(c => ({
      id: String(c.id), name: String(c.name), parent_id: c.parent_id ? String(c.parent_id) : null,
      image_url: imageVariantUrl(origin, c.image_url, 300), sort_order: Number(c.sort_order) || 0,
      product_count: Number(c.product_count) || 0, updated_at: toIso(c.updated_at) as string,
    })),
    removed_ids: removed, server_time: new Date().toISOString(),
  }
})
