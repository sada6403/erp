import { randomUUID } from 'crypto'
import { appRoute, need, type AppCompany } from '@/lib/app/context'
import { fail, intParam, only, reqStr, toIso } from '@/lib/app/http'
import { VISIBLE_SQL } from '@/lib/app/catalogLib'
import { authorName, parseRating, roundAvg, sanitizeComment } from '@/lib/app/reviewsLib'
import type { ReviewCreateBody, ReviewDto, ReviewsResponse } from '@/lib/app/contracts/catalog'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const sqlTime = (iso: string) => new Date(iso).toISOString().slice(0, 19).replace('T', ' ')
const encode = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
function decode(c: string | null): { t: string; id: string } | null {
  if (!c) return null
  try {
    const o = JSON.parse(Buffer.from(c, 'base64url').toString('utf8'))
    return typeof o?.t === 'string' && typeof o?.id === 'string' ? { t: o.t, id: o.id } : null
  } catch { return null }
}

async function productId(company: AppCompany, idOrSlug: string): Promise<string> {
  const { rows } = await company.tp.query<{ id: string }>(
    `SELECT p.id FROM products p WHERE (p.id = ? OR p.slug = ?) AND ${VISIBLE_SQL} LIMIT 1`, [idOrSlug, idOrSlug])
  if (!rows[0]) fail(404, 'NOT_FOUND', 'Product not found')
  return String(rows[0].id)
}

function toDto(r: Record<string, unknown>): ReviewDto {
  return {
    id: String(r.id), rating: Number(r.rating), comment: r.comment ? String(r.comment) : null,
    author_name: r.author_name ? String(r.author_name) : 'Customer', verified_purchase: true,
    created_at: toIso(r.created_at) as string,
  }
}

/** First delivered order item of this user for the product that has no review yet. */
async function eligibleItem(company: AppCompany, userId: string, customerId: string | null, pid: string): Promise<string | null> {
  const { rows } = await company.tp.query<{ id: string }>(
    `SELECT i.id FROM customer_order_items i JOIN customer_orders o ON o.id = i.order_id
      WHERE i.product_id = ? AND o.status = 'delivered' AND (o.app_user_id = ? OR (? IS NOT NULL AND o.customer_id = ?))
        AND NOT EXISTS (SELECT 1 FROM product_reviews r WHERE r.order_item_id = i.id)
      ORDER BY o.created_at DESC LIMIT 1`, [pid, userId, customerId, customerId])
  return rows[0] ? String(rows[0].id) : null
}

export const GET = appRoute({ auth: 'optional' }, async ({ req, company, params, user }): Promise<ReviewsResponse> => {
  const pid = await productId(company, params.id)
  const sp = req.nextUrl.searchParams
  const limit = intParam(sp.get('limit'), 20, 1, 50)
  const cur = decode(sp.get('cursor'))
  const agg = await company.tp.query<{ avg_r: string | number | null; cnt: string | number }>(
    `SELECT AVG(rating) AS avg_r, COUNT(*) AS cnt FROM product_reviews WHERE product_id = ? AND is_hidden = 0`, [pid])
  const count = Number(agg.rows[0]?.cnt ?? 0)
  const where = ['product_id = ?', 'is_hidden = 0']
  const vals: unknown[] = [pid]
  if (cur) { where.push('(created_at < ? OR (created_at = ? AND id < ?))'); vals.push(cur.t, cur.t, cur.id) }
  const { rows } = await company.tp.query<Record<string, unknown>>(
    `SELECT id, rating, comment, author_name, created_at FROM product_reviews WHERE ${where.join(' AND ')}
      ORDER BY created_at DESC, id DESC LIMIT ${limit + 1}`, vals)
  const page = rows.slice(0, limit)
  const last = page[page.length - 1]
  const next = rows.length > limit && last ? encode({ t: sqlTime(toIso(last.created_at) as string), id: String(last.id) }) : null
  let itemId: string | null = null
  if (user && user.roles.includes('customer')) itemId = await eligibleItem(company, user.userId, user.customerId, pid)
  return {
    items: page.map(toDto),
    average: count && agg.rows[0]?.avg_r != null ? roundAvg(Number(agg.rows[0].avg_r)) : null,
    count, next_cursor: next, can_review: { eligible: !!itemId, order_item_id: itemId },
  }
})

export const POST = appRoute({ auth: 'user', roles: ['customer'], limiter: 'order' }, async (c): Promise<Response> => {
  const { company, params, user } = need(c)
  const body = await c.body()
  only(body, ['order_item_id', 'rating', 'comment'])
  const input: ReviewCreateBody = {
    order_item_id: reqStr(body.order_item_id, 'order_item_id', 1, 191),
    rating: parseRating(body.rating),
    comment: sanitizeComment(body.comment) ?? undefined,
  }
  const pid = await productId(company, params.id)
  const { rows } = await company.tp.query<Record<string, unknown>>(
    `SELECT i.id, i.product_id, o.status, o.app_user_id, o.customer_id FROM customer_order_items i
       JOIN customer_orders o ON o.id = i.order_id WHERE i.id = ? LIMIT 1`, [input.order_item_id])
  const it = rows[0]
  const mine = it && (String(it.app_user_id ?? '') === user.userId || (!!user.customerId && String(it.customer_id ?? '') === user.customerId))
  if (!it || !mine || String(it.product_id) !== pid) fail(404, 'NOT_FOUND', 'Order item not found')
  if (String(it.status) !== 'delivered') fail(403, 'FORBIDDEN', 'You can review a product after it has been delivered')
  const dup = await company.tp.query(`SELECT 1 FROM product_reviews WHERE order_item_id = ? LIMIT 1`, [input.order_item_id])
  if (dup.rows.length) fail(409, 'CONFLICT', 'You already reviewed this item')
  const id = randomUUID()
  const name = authorName(user.name)
  try {
    await company.tp.query(
      `INSERT INTO product_reviews (id, product_id, customer_id, app_user_id, order_item_id, author_name, rating, comment)
       VALUES (?,?,?,?,?,?,?,?)`,
      [id, pid, user.customerId, user.userId, input.order_item_id, name, input.rating, input.comment ?? null])
  } catch (e) {
    if (/Duplicate entry|ER_DUP_ENTRY/i.test(e instanceof Error ? e.message : String(e))) fail(409, 'CONFLICT', 'You already reviewed this item')
    throw e
  }
  const dto: ReviewDto = { id, rating: input.rating, comment: input.comment ?? null, author_name: name, verified_purchase: true, created_at: new Date().toISOString() }
  return Response.json(dto, { status: 201 })
})
