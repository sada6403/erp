import { randomUUID } from 'crypto'
import { NextResponse } from 'next/server'
import { appRoute, need } from '@/lib/app/context'
import { fail, only, reqStr } from '@/lib/app/http'
import { VISIBLE_SQL } from '@/lib/app/catalogLib'
import { queryProducts } from '@/lib/app/catalogQuery'
import type { WishlistResponse } from '@/lib/app/contracts/wishlist'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = appRoute({ auth: 'user', roles: ['customer'] }, async (c): Promise<WishlistResponse> => {
  const { company, user, origin } = need(c)
  const { rows } = await company.tp.query<{ product_id: string }>(`SELECT product_id FROM wishlists WHERE user_id = ? ORDER BY created_at DESC LIMIT 200`, [user.userId])
  const ids = rows.map(r => r.product_id)
  if (!ids.length) return { items: [] }
  const r = await queryProducts(company, { ids, sort: 'name', limit: 200 }, origin)
  return { items: r.items }
})

export const POST = appRoute({ auth: 'user', roles: ['customer'] }, async (c) => {
  const { company, user, body } = need(c)
  const b = await body()
  only(b, ['product_id'])
  const pid = reqStr(b.product_id, 'product_id', 1, 191)
  const p = await company.tp.query(`SELECT p.id FROM products p WHERE p.id = ? AND ${VISIBLE_SQL}`, [pid])
  if (!p.rows[0]) fail(404, 'NOT_FOUND', 'Product not found')
  await company.tp.query(`INSERT IGNORE INTO wishlists (id, user_id, product_id) VALUES (?, ?, ?)`, [randomUUID(), user.userId, pid])
  return NextResponse.json({ ok: true }, { status: 201 })
})
