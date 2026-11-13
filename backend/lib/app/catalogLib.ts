// Catalog rules shared by catalog, wishlist, quote and order endpoints.
import path from 'path'
import type { AppCompany } from './context'
import type { ProductListItemDto, VariantDto, ProductDetailDto } from './contracts/catalog'
import { parseJson, round2, toIso } from './http'
import { loadRatings, ratingOf, type RatingInfo } from './reviewsLib'

export const VISIBLE_SQL = `p.is_active = 1 AND p.not_for_sale = 0 AND p.is_online = 1`

export type ProductRow = Record<string, unknown>
export type DbLike = Pick<AppCompany['tp'], 'query'>

// ── Images ────────────────────────────────────────────────────────────────
export function localImageName(url: unknown): string | null {
  if (typeof url !== 'string' || !url) return null
  const m = /\/api\/files\/([^/?#]+)/.exec(url)
  if (m) return path.basename(decodeURIComponent(m[1]))
  if (/^https?:\/\//i.test(url)) return null
  const base = path.basename(url.split('?')[0])
  return /\.(jpe?g|png|webp|gif)$/i.test(base) ? base : null
}
export function imageVariantUrl(origin: string, url: unknown, width: 300 | 800): string | null {
  if (typeof url !== 'string' || !url) return null
  const name = localImageName(url)
  if (name) return `${origin}/api/app/v1/media/img/${encodeURIComponent(name)}?w=${width}`
  return /^https?:\/\//i.test(url) ? url : null
}

// ── Availability ──────────────────────────────────────────────────────────
export type StockInfo = {
  /** product_id -> available (stock - damaged - reserved), only for products without variants */
  product: Map<string, number>
  /** variant_id -> available */
  variant: Map<string, number>
}

export async function loadStock(company: DbLike | { tp: DbLike }, productIds: string[], branchId?: string | null): Promise<StockInfo> {
  const info: StockInfo = { product: new Map(), variant: new Map() }
  const db: DbLike = 'tp' in company ? company.tp : company
  if (!productIds.length) return info
  const branchSql = branchId ? ' AND branch_id = ?' : ''
  const bv = branchId ? [branchId] : []
  const s = await db.query<{ product_id: string; q: string }>(
    `SELECT product_id, SUM(quantity - damaged_qty) AS q FROM stocks WHERE product_id IN (?)${branchSql} GROUP BY product_id`,
    [productIds, ...bv]
  )
  for (const r of s.rows) info.product.set(r.product_id, Number(r.q))
  const v = await db.query<{ variant_id: string; q: string }>(
    `SELECT variant_id, SUM(quantity - damaged_qty) AS q FROM product_variant_stocks WHERE product_id IN (?)${branchSql} GROUP BY variant_id`,
    [productIds, ...bv]
  )
  for (const r of v.rows) info.variant.set(r.variant_id, Number(r.q))
  const res = await db.query<{ product_id: string; variant_id: string | null; q: string }>(
    `SELECT product_id, variant_id, SUM(quantity) AS q FROM stock_reservations
      WHERE product_id IN (?)${branchSql} AND (status = 'committed' OR (status = 'active' AND expires_at > NOW()))
      GROUP BY product_id, variant_id`,
    [productIds, ...bv]
  )
  for (const r of res.rows) {
    if (r.variant_id) info.variant.set(r.variant_id, (info.variant.get(r.variant_id) ?? 0) - Number(r.q))
    else info.product.set(r.product_id, (info.product.get(r.product_id) ?? 0) - Number(r.q))
  }
  return info
}

export function managesStock(p: ProductRow): boolean {
  return Number(p.is_manage_stock ?? 1) === 1 && Number(p.track_stock ?? 1) === 1
}

// ── Pricing ───────────────────────────────────────────────────────────────
/** Tax is added on top of the net price exactly like a POS counter sale (rate in percent, 0 = untaxed). */
export function withTax(net: number, ratePct: number): number {
  return ratePct > 0 ? round2(net * (1 + ratePct / 100)) : round2(net)
}

export function taxRateOf(p: Record<string, unknown>): number {
  const r = Number(p.tax_rate)
  return Number.isFinite(r) && r > 0 && r <= 100 ? r : 0
}

/** Net (pre-tax) unit price after the product discount. */
export function netPriceOf(base: number, discountPct: number): number {
  const pct = Math.min(100, Math.max(0, discountPct || 0))
  return pct <= 0 ? round2(base) : round2(base * (1 - pct / 100))
}

/** Same rounding as POS invoice lines: taxable = money(net*qty), tax = money(taxable*rate/100), line = taxable + tax. */
export function lineMoney(netUnit: number, qty: number, ratePct: number): { taxable: number; tax: number; line_total: number } {
  const taxable = round2(netUnit * qty)
  const tax = ratePct > 0 ? round2(taxable * ratePct / 100) : 0
  return { taxable, tax, line_total: round2(taxable + tax) }
}

/** Displayed (final) price = net price with tax on top, i.e. what the counter charges. */
export function priceOf(base: number, discountPct: number, ratePct = 0): { price: number; original: number | null } {
  const pct = Math.min(100, Math.max(0, discountPct || 0))
  if (pct <= 0) return { price: withTax(base, ratePct), original: null }
  return { price: withTax(netPriceOf(base, pct), ratePct), original: withTax(base, ratePct) }
}

export function variantBase(p: ProductRow, v: Record<string, unknown>): number {
  return Number(v.selling_price) > 0 ? Number(v.selling_price) : Number(p.selling_price)
}

export function variantPrice(p: ProductRow, v: Record<string, unknown>): { price: number; original: number | null } {
  return priceOf(variantBase(p, v), Number(p.discount_pct) || 0, taxRateOf(p))
}

export async function loadVariants(company: AppCompany, productIds: string[]): Promise<Map<string, Record<string, unknown>[]>> {
  const m = new Map<string, Record<string, unknown>[]>()
  if (!productIds.length) return m
  const { rows } = await company.tp.query<Record<string, unknown>>(
    `SELECT * FROM product_variants WHERE product_id IN (?) AND is_active = 1 ORDER BY sort_order, variant_name`,
    [productIds]
  )
  for (const r of rows) {
    const k = String(r.product_id)
    if (!m.has(k)) m.set(k, [])
    m.get(k)!.push(r)
  }
  return m
}

export function mapVariant(
  p: ProductRow, v: Record<string, unknown>, stock: StockInfo, origin: string
): VariantDto {
  const manage = managesStock(p)
  const avail = stock.variant.has(String(v.id)) ? Math.max(0, stock.variant.get(String(v.id))!) : 0
  const { price, original } = variantPrice(p, v)
  const attrs = parseJson<Record<string, unknown>>(v.attributes_json, {})
  const attributes: Record<string, string> = {}
  for (const [k, val] of Object.entries(attrs)) attributes[k] = String(val)
  return {
    id: String(v.id), name: String(v.variant_name), sku: String(v.sku), price, original_price: original,
    attributes, image_url: imageVariantUrl(origin, v.image_url, 300),
    in_stock: manage ? avail > 0 : true, available_qty: manage ? avail : null,
  }
}

export function mapProduct(
  p: ProductRow, stock: StockInfo, variants: Record<string, unknown>[], origin: string, dealEnds?: Map<string, string>, ratings?: Map<string, RatingInfo>
): ProductListItemDto {
  const manage = managesStock(p)
  const weight = String(p.sale_by) === 'weight'
  let price: number, original: number | null
  let inStock: boolean, availableQty: number | null
  if (variants.length) {
    const prices = variants.map(v => variantPrice(p, v))
    const min = prices.reduce((a, b) => (b.price < a.price ? b : a))
    price = min.price; original = min.original
    const avails = variants.map(v => Math.max(0, stock.variant.get(String(v.id)) ?? 0))
    const total = avails.reduce((a, b) => a + b, 0)
    inStock = manage ? total > 0 : true
    availableQty = manage ? total : null
  } else {
    const pr = priceOf(Number(p.selling_price), Number(p.discount_pct) || 0, taxRateOf(p))
    price = pr.price; original = pr.original
    const avail = Math.max(0, stock.product.get(String(p.id)) ?? 0)
    inStock = manage ? avail > 0 : true
    availableQty = manage ? avail : null
  }
  const desc = typeof p.short_description === 'string' && p.short_description ? p.short_description : null
  return {
    id: String(p.id),
    slug: p.slug ? String(p.slug) : null,
    sku: String(p.sku),
    name: String(p.name),
    category_id: p.category_id ? String(p.category_id) : null,
    category_name: p.category_name ? String(p.category_name) : null,
    brand: p.brand ? String(p.brand) : null,
    short_description: desc,
    unit: p.unit ? String(p.unit) : weight ? 'kg' : 'pcs',
    sale_by: weight ? 'weight' : 'normal',
    qty_step: weight ? 0.25 : 1,
    min_qty: weight ? 0.25 : 1,
    price, original_price: original,
    discount_pct: Number(p.discount_pct) || 0,
    // a flash deal = a discounted product with an active, dated POS discount; the app counts down to this real end date
    deal_ends_at: (Number(p.discount_pct) || 0) > 0 ? (dealEnds?.get(String(p.id)) ?? null) : null,
    thumbnail_url: imageVariantUrl(origin, p.image_url, 300),
    in_stock: inStock, available_qty: availableQty,
    has_variants: variants.length > 0,
    rating_avg: ratingOf(ratings, String(p.id)).avg,
    rating_count: ratingOf(ratings, String(p.id)).count,
    emi_available: Number(p.enable_emi) === 1,
    updated_at: toIso(p.updated_at) as string,
  }
}

export function mapProductDetail(
  p: ProductRow, stock: StockInfo, variants: Record<string, unknown>[], origin: string, dealEnds?: Map<string, string>, ratings?: Map<string, RatingInfo>
): ProductDetailDto {
  const base = mapProduct(p, stock, variants, origin, dealEnds, ratings)
  const extra = parseJson<unknown[]>(p.gallery, [])
  const urls: unknown[] = [p.image_url, ...(Array.isArray(extra) ? extra : [])].filter(Boolean)
  const gallery = urls
    .map(u => ({ thumb: imageVariantUrl(origin, u, 300), medium: imageVariantUrl(origin, u, 800) }))
    .filter((g): g is { thumb: string; medium: string } => !!g.thumb && !!g.medium)
  return {
    ...base,
    description: p.description ? String(p.description) : null,
    gallery,
    variants: variants.map(v => mapVariant(p, v, stock, origin)),
    price_note: null,
  }
}

/** Fetch visible products by id with category names. */
export async function loadVisibleProducts(company: AppCompany, ids: string[]): Promise<ProductRow[]> {
  if (!ids.length) return []
  const { rows } = await company.tp.query<ProductRow>(
    `SELECT p.*, c.name AS category_name FROM products p LEFT JOIN categories c ON c.id = p.category_id
      WHERE p.id IN (?) AND ${VISIBLE_SQL}`,
    [ids]
  )
  return rows
}

/** Earliest end of each product's currently active, dated POS discount (ISO UTC). Products without one are absent. */
export async function loadDealEnds(company: { tp: DbLike }, productIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (!productIds.length) return out
  try {
    const { rows } = await company.tp.query<{ product_id: string; ends: Date | string }>(
      `SELECT product_id, MIN(valid_until) AS ends FROM discounts
        WHERE scope = 'product' AND is_active = 1 AND product_id IN (?) AND valid_until IS NOT NULL AND valid_until > NOW()
          AND (valid_from IS NULL OR valid_from <= NOW()) GROUP BY product_id`, [productIds])
    for (const r of rows) { const iso = toIso(r.ends); if (iso) out.set(String(r.product_id), iso) }
  } catch { /* tenant without a discounts table: no deals */ }
  return out
}

export async function listItems(company: AppCompany, rows: ProductRow[], origin: string, branchId?: string | null): Promise<ProductListItemDto[]> {
  const ids = rows.map(r => String(r.id))
  const [stock, variants, deals, ratings] = await Promise.all([loadStock(company, ids, branchId), loadVariants(company, ids), loadDealEnds(company, ids), loadRatings(company, ids)])
  return rows.map(r => mapProduct(r, stock, variants.get(String(r.id)) ?? [], origin, deals, ratings))
}
