// Product listing query shared by /catalog/products, /catalog/search, wishlist.
import type { AppCompany } from './context'
import type { ProductListItemDto } from './contracts/catalog'
import { VISIBLE_SQL, listItems, type ProductRow } from './catalogLib'
import { likeEscape, toIso } from './http'

// Effective change time: product row, stock rows or variant rows (so availability changes reach the delta).
const EFF = `GREATEST(p.updated_at,
  COALESCE((SELECT MAX(s.updated_at) FROM stocks s WHERE s.product_id = p.id), p.updated_at),
  COALESCE((SELECT MAX(v.updated_at) FROM product_variants v WHERE v.product_id = p.id), p.updated_at),
  COALESCE((SELECT MAX(vs.updated_at) FROM product_variant_stocks vs WHERE vs.product_id = p.id), p.updated_at))`

export type ProductQuery = {
  updatedSince?: string | null
  categoryId?: string | null
  q?: string | null
  sort?: 'newest' | 'price_asc' | 'price_desc' | 'name' | 'relevance' | null
  inStock?: boolean
  minPrice?: number | null
  maxPrice?: number | null
  branchId?: string | null
  cursor?: string | null
  limit: number
  ids?: string[]
}

const sqlTime = (iso: string) => new Date(iso).toISOString().slice(0, 19).replace('T', ' ')

function encode(o: unknown) { return Buffer.from(JSON.stringify(o)).toString('base64url') }
function decode<T>(c: string | null | undefined): T | null {
  if (!c) return null
  try { return JSON.parse(Buffer.from(c, 'base64url').toString('utf8')) as T } catch { return null }
}

export async function queryProducts(company: AppCompany, o: ProductQuery, origin: string): Promise<{ items: ProductListItemDto[]; nextCursor: string | null; total?: number }> {
  const where: string[] = [VISIBLE_SQL]
  const vals: unknown[] = []
  if (o.ids) { where.push('p.id IN (?)'); vals.push(o.ids.length ? o.ids : ['']) }
  if (o.categoryId) { where.push('(p.category_id = ? OR p.category_id IN (SELECT id FROM categories WHERE parent_id = ?))'); vals.push(o.categoryId, o.categoryId) }
  if (o.q) {
    const like = '%' + likeEscape(o.q) + '%'
    where.push('(p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ? OR p.brand LIKE ?)')
    vals.push(like, like, like, like)
  }
  if (o.minPrice != null) { where.push('p.selling_price >= ?'); vals.push(o.minPrice) }
  if (o.maxPrice != null) { where.push('p.selling_price <= ?'); vals.push(o.maxPrice) }
  if (o.inStock) {
    where.push(`(p.is_manage_stock = 0 OR p.track_stock = 0
      OR EXISTS (SELECT 1 FROM stocks s WHERE s.product_id = p.id AND s.quantity - s.damaged_qty > 0)
      OR EXISTS (SELECT 1 FROM product_variant_stocks vs WHERE vs.product_id = p.id AND vs.quantity - vs.damaged_qty > 0))`)
  }
  const inner = `SELECT p.*, c.name AS category_name, ${EFF} AS eff FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE ${where.join(' AND ')}`

  const syncMode = !o.sort
  const outer: string[] = []
  const ov: unknown[] = []
  if (o.updatedSince) { outer.push('t.eff > ?'); ov.push(sqlTime(o.updatedSince)) }

  let order: string
  let nextFrom: (rows: ProductRow[]) => string | null = () => null
  if (syncMode) {
    const cur = decode<{ t: string; id: string }>(o.cursor)
    if (cur) { outer.push('(t.eff > ? OR (t.eff = ? AND t.id > ?))'); ov.push(cur.t, cur.t, cur.id) }
    order = 't.eff ASC, t.id ASC'
    nextFrom = rows => {
      const last = rows[rows.length - 1]
      return last ? encode({ t: sqlTime(toIso(last.eff) as string), id: String(last.id) }) : null
    }
  } else {
    const off = decode<{ o: number }>(o.cursor)?.o ?? 0
    order = ({
      newest: 't.eff DESC, t.id', price_asc: 't.selling_price ASC, t.id', price_desc: 't.selling_price DESC, t.id',
      name: 't.name ASC, t.id', relevance: `(t.name LIKE ?) DESC, t.name ASC, t.id`,
    } as Record<string, string>)[o.sort!] ?? 't.name ASC, t.id'
    if (o.sort === 'relevance') ov.push(likeEscape(o.q ?? '') + '%')
    return runOffset(company, inner, vals, outer, ov, order, off, o, origin)
  }

  const sql = `SELECT t.* FROM (${inner}) t ${outer.length ? 'WHERE ' + outer.join(' AND ') : ''} ORDER BY ${order} LIMIT ${o.limit + 1}`
  const { rows } = await company.tp.query<ProductRow>(sql, [...vals, ...ov])
  const page = rows.slice(0, o.limit)
  const next = rows.length > o.limit ? nextFrom(page) : null
  for (const r of page) r.updated_at = r.eff
  return { items: await listItems(company, page, origin, o.branchId), nextCursor: next }
}

async function runOffset(
  company: AppCompany, inner: string, vals: unknown[], outer: string[], ov: unknown[], order: string, off: number, o: ProductQuery, origin: string
) {
  const sql = `SELECT t.* FROM (${inner}) t ${outer.length ? 'WHERE ' + outer.join(' AND ') : ''} ORDER BY ${order} LIMIT ${o.limit + 1} OFFSET ${off}`
  // relevance param (if any) is first in ov after outer params; outer params precede it
  const { rows } = await company.tp.query<ProductRow>(sql, [...vals, ...ov])
  const page = rows.slice(0, o.limit)
  for (const r of page) r.updated_at = r.eff
  const next = rows.length > o.limit ? encode({ o: off + o.limit }) : null
  return { items: await listItems(company, page, origin, o.branchId), nextCursor: next }
}

export async function removedProductIds(company: AppCompany, since: string): Promise<string[]> {
  const t = sqlTime(since)
  const hidden = await company.tp.query<{ id: string }>(
    `SELECT p.id FROM products p WHERE p.updated_at > ? AND NOT (${VISIBLE_SQL})`, [t])
  const del = await company.tp.query<{ record_id: string }>(
    `SELECT record_id FROM sync_deletions WHERE table_name = 'products' AND deleted_at > ?`, [t])
  return [...new Set([...hidden.rows.map(r => r.id), ...del.rows.map(r => r.record_id)])]
}
