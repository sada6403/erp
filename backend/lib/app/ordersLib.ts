// Quote, order creation (idempotent, stock re-check + reservations), mapping, tracking, cancel.
import { randomUUID } from 'crypto'
import type { AppCompany, AppUserCtx } from './context'
import type {
  CartLineInput, OrderDto, OrderItemDto, OrderStatus, OrderSummaryDto, QuoteLineDto, QuoteResponse,
  TrackingResponse, TrackingStep,
} from './contracts/orders'
import type { PaymentMethod } from './contracts/common'
import { fail, parseJson, round2, toIso, reqStr, optStr, reqNum, optNum, only } from './http'
import {
  VISIBLE_SQL, imageVariantUrl, lineMoney, loadStock, loadVariants, managesStock, netPriceOf, priceOf, taxRateOf, variantBase, variantPrice, withTax,
  type DbLike, type ProductRow,
} from './catalogLib'
import { getSettings, flag } from './settings'
import { deliveryOtp, deliveryOtpHash, sha256 } from './security'
import { enqueueNotification } from './notify'

export const CANCELLABLE: OrderStatus[] = ['pending', 'confirmed', 'processing', 'preparing', 'ready_for_delivery']
const RELEASE_RESERVATION_ON: OrderStatus[] = ['dispatched', 'in_transit', 'delivered', 'cancelled', 'returned']

export function stageOf(status: string): OrderSummaryDto['stage'] {
  switch (status) {
    case 'confirmed': return 'confirmed'
    case 'processing': case 'preparing': case 'ready_for_delivery': return 'packed'
    case 'dispatched': case 'in_transit': return 'out_for_delivery'
    case 'delivered': return 'delivered'
    case 'cancelled': case 'returned': return 'cancelled'
    default: return 'placed'
  }
}

export function parseCart(raw: unknown): CartLineInput[] {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 50) fail(400, 'VALIDATION', 'items must contain 1-50 lines')
  const merged = new Map<string, CartLineInput>()
  for (const it of raw) {
    if (!it || typeof it !== 'object') fail(400, 'VALIDATION', 'Invalid item')
    const o = it as Record<string, unknown>
    only(o, ['product_id', 'variant_id', 'quantity'])
    const product_id = reqStr(o.product_id, 'product_id', 1, 191)
    const variant_id = optStr(o.variant_id, 'variant_id', 191)
    const quantity = reqNum(o.quantity, 'quantity', 0.01, 9999)
    const key = product_id + '|' + (variant_id ?? '')
    const prev = merged.get(key)
    if (prev) prev.quantity = round2(prev.quantity + quantity)
    else merged.set(key, { product_id, variant_id, quantity: round2(quantity) })
  }
  return [...merged.values()]
}

export async function resolveBranch(db: DbLike, requested: string | null | undefined, settings: Record<string, string>): Promise<string> {
  if (requested) {
    const { rows } = await db.query(`SELECT id FROM branches WHERE id = ? AND is_active = 1`, [requested])
    if (!rows[0]) fail(400, 'VALIDATION', 'Unknown branch')
    return requested
  }
  if (settings.default_branch_id) {
    const { rows } = await db.query(`SELECT id FROM branches WHERE id = ? AND is_active = 1`, [settings.default_branch_id])
    if (rows[0]) return settings.default_branch_id
  }
  const { rows } = await db.query<{ id: string }>(`SELECT id FROM branches WHERE is_active = 1 ORDER BY created_at, id LIMIT 1`)
  if (!rows[0]) fail(400, 'VALIDATION', 'No branch is available')
  return rows[0].id
}

export function deliveryFeeFor(subtotal: number, settings: Record<string, string>): number {
  const flat = Number(settings.delivery_flat_fee) || 0
  const freeOver = settings.delivery_free_over !== '' ? Number(settings.delivery_free_over) : NaN
  if (Number.isFinite(freeOver) && freeOver > 0 && subtotal >= freeOver) return 0
  return round2(flat)
}

type Priced = { line: QuoteLineDto; product: ProductRow | null; variant: Record<string, unknown> | null; net?: number; taxRate?: number; tax?: number }

/** Server-side pricing + stock check for a cart. Works with the txn client when passed. */
export async function priceCart(
  db: DbLike, items: CartLineInput[], branchId: string
): Promise<{ priced: Priced[]; subtotal: number; canOrder: boolean }> {
  const ids = [...new Set(items.map(i => i.product_id))]
  const { rows: prods } = await db.query<ProductRow>(
    `SELECT p.*, (${VISIBLE_SQL}) AS visible FROM products p WHERE p.id IN (?)`, [ids])
  const byId = new Map(prods.map(p => [String(p.id), p]))
  const variantsByProduct = await loadVariants({ tp: db } as unknown as AppCompany, ids)
  const stock = await loadStock(db, ids, branchId)
  const priced: Priced[] = []
  let subtotal = 0
  let canOrder = true
  for (const it of items) {
    const p = byId.get(it.product_id) ?? null
    const base: QuoteLineDto = {
      product_id: it.product_id, variant_id: it.variant_id ?? null, name: p ? String(p.name) : '', variant_name: null,
      unit: 'pcs', quantity: it.quantity, unit_price: 0, line_total: 0, available: false, available_qty: null, issue: null,
    }
    if (!p) { base.issue = 'NOT_FOUND'; priced.push({ line: base, product: null, variant: null }); canOrder = false; continue }
    const weight = String(p.sale_by) === 'weight'
    base.unit = p.unit ? String(p.unit) : weight ? 'kg' : 'pcs'
    if (Number(p.visible) !== 1) { base.issue = 'NOT_FOR_SALE'; priced.push({ line: base, product: p, variant: null }); canOrder = false; continue }
    const q = it.quantity
    const validQty = weight ? q >= 0.05 && Math.abs(q * 100 - Math.round(q * 100)) < 1e-6 : Number.isInteger(q) && q >= 1
    if (!validQty) { base.issue = 'INVALID_QUANTITY'; priced.push({ line: base, product: p, variant: null }); canOrder = false; continue }

    const variants = variantsByProduct.get(String(p.id)) ?? []
    let variant: Record<string, unknown> | null = null
    if (variants.length) {
      variant = variants.find(v => String(v.id) === it.variant_id) ?? null
      if (!variant) { base.issue = 'NOT_FOUND'; priced.push({ line: base, product: p, variant: null }); canOrder = false; continue }
      base.variant_name = String(variant.variant_name)
    } else if (it.variant_id) {
      base.issue = 'NOT_FOUND'; priced.push({ line: base, product: p, variant: null }); canOrder = false; continue
    }
    const rate = taxRateOf(p)
    const net = netPriceOf(variant ? variantBase(p, variant) : Number(p.selling_price), Number(p.discount_pct) || 0)
    const lm = lineMoney(net, q, rate)
    base.unit_price = withTax(net, rate)
    base.line_total = lm.line_total
    if (managesStock(p)) {
      const avail = Math.max(0, (variant ? stock.variant.get(String(variant.id)) : stock.product.get(String(p.id))) ?? 0)
      base.available_qty = avail
      if (avail <= 0) base.issue = 'OUT_OF_STOCK'
      else if (avail + 1e-9 < q) base.issue = 'INSUFFICIENT_STOCK'
      base.available = base.issue === null
    } else {
      base.available = true
    }
    if (base.issue) canOrder = false
    subtotal += base.line_total
    priced.push({ line: base, product: p, variant, net, taxRate: rate, tax: lm.tax })
  }
  return { priced, subtotal: round2(subtotal), canOrder }
}

export async function buildQuote(company: AppCompany, items: CartLineInput[], branchIdIn?: string | null): Promise<QuoteResponse> {
  const settings = await getSettings(company)
  const branchId = await resolveBranch(company.tp, branchIdIn, settings)
  const { priced, subtotal, canOrder } = await priceCart(company.tp, items, branchId)
  const fee = priced.length ? deliveryFeeFor(subtotal, settings) : 0
  const ordering = flag(settings.ordering_enabled)
  const days = Number(settings.estimated_delivery_days) || 2
  return {
    branch_id: branchId,
    lines: priced.map(p => p.line),
    subtotal, delivery_fee: fee, total: round2(subtotal + fee), currency: 'LKR',
    can_order: canOrder && ordering,
    ordering_enabled: ordering,
    payment_methods: flag(settings.bank_transfer_enabled) ? ['cod', 'bank_transfer'] : ['cod'],
    wallet: { eligible: false },
    estimated_delivery_date: new Date(Date.now() + days * 86400000).toISOString(),
  }
}

type AddrInput = {
  recipient_name: string; phone: string; line1: string; line2: string | null; city: string
  district: string | null; postal_code: string | null
}
function addressText(a: AddrInput): string {
  return [a.line1, a.line2, a.city, a.district, a.postal_code].filter(Boolean).join(', ')
}

async function resolveAddress(company: AppCompany, user: AppUserCtx, body: Record<string, unknown>): Promise<AddrInput> {
  if (body.address_id) {
    const { rows } = await company.tp.query<Record<string, unknown>>(
      `SELECT * FROM app_addresses WHERE id = ? AND user_id = ?`, [String(body.address_id), user.userId])
    const a = rows[0]
    if (!a) fail(404, 'NOT_FOUND', 'Address not found')
    return {
      recipient_name: String(a.recipient_name), phone: String(a.phone), line1: String(a.line1),
      line2: a.line2 ? String(a.line2) : null, city: String(a.city),
      district: a.district ? String(a.district) : null, postal_code: a.postal_code ? String(a.postal_code) : null,
    }
  }
  const a = body.address
  if (!a || typeof a !== 'object') fail(400, 'VALIDATION', 'address_id or address is required')
  return parseAddressInput(a as Record<string, unknown>)
}

export function parseAddressInput(o: Record<string, unknown>): AddrInput & {
  label: string; latitude: number | null; longitude: number | null; is_default: boolean
} {
  only(o, ['label', 'recipient_name', 'phone', 'line1', 'line2', 'city', 'district', 'postal_code', 'latitude', 'longitude', 'is_default'])
  return {
    label: optStr(o.label, 'label', 64) ?? 'Home',
    recipient_name: reqStr(o.recipient_name, 'recipient_name', 2, 120),
    phone: reqStr(o.phone, 'phone', 7, 20),
    line1: reqStr(o.line1, 'line1', 3, 200),
    line2: optStr(o.line2, 'line2', 200),
    city: reqStr(o.city, 'city', 2, 100),
    district: optStr(o.district, 'district', 100),
    postal_code: optStr(o.postal_code, 'postal_code', 12),
    latitude: optNum(o.latitude, 'latitude', -90, 90),
    longitude: optNum(o.longitude, 'longitude', -180, 180),
    is_default: o.is_default === true,
  }
}

function isDup(e: unknown): boolean {
  return /ER_DUP_ENTRY|Duplicate entry/i.test(String((e as Error)?.message ?? e))
}

export async function createOrder(
  company: AppCompany, user: AppUserCtx, body: Record<string, unknown>, idemKey: string, origin: string
): Promise<{ status: number; body: OrderDto }> {
  only(body, ['items', 'branch_id', 'address_id', 'address', 'payment_method', 'notes', 'payment_reference', 'expected_total'])
  const settings = await getSettings(company)
  if (!flag(settings.ordering_enabled)) fail(403, 'ORDERING_DISABLED', settings.maintenance_message || 'Ordering is paused right now.')
  const pm = body.payment_method
  const methods: PaymentMethod[] = flag(settings.bank_transfer_enabled) ? ['cod', 'bank_transfer'] : ['cod']
  if (typeof pm !== 'string' || !methods.includes(pm as PaymentMethod)) fail(400, 'VALIDATION', `payment_method must be one of: ${methods.join(', ')}`)
  const items = parseCart(body.items)
  const notes = optStr(body.notes, 'notes', 500)
  const paymentRef = optStr(body.payment_reference, 'payment_reference', 200)
  const expectedTotal = optNum(body.expected_total, 'expected_total', 0, 1e9)
  const addr = await resolveAddress(company, user, body)
  const branchId = await resolveBranch(company.tp, optStr(body.branch_id, 'branch_id', 191), settings)

  const hash = sha256(JSON.stringify({ items, branchId, addr, pm, notes, paymentRef }))
  const receiptWhere = [user.userId, 'order', idemKey]
  const existing = await company.tp.query<Record<string, unknown>>(
    `SELECT request_hash, response_status, response_body FROM app_request_receipts WHERE user_id = ? AND scope = ? AND idempotency_key = ?`, receiptWhere)
  if (existing.rows[0]) return replay(existing.rows[0], hash)

  const conn = await company.tp.connect()
  let orderId = ''
  try {
    await conn.query('START TRANSACTION')
    // Serialise competing orders for the same stock rows.
    const pids = [...new Set(items.map(i => i.product_id))]
    await conn.query(`SELECT id FROM stocks WHERE product_id IN (?) AND branch_id = ? FOR UPDATE`, [pids, branchId])
    await conn.query(`SELECT id FROM product_variant_stocks WHERE product_id IN (?) AND branch_id = ? FOR UPDATE`, [pids, branchId])

    const { priced, subtotal, canOrder } = await priceCart(conn, items, branchId)
    if (!canOrder) {
      await conn.query('ROLLBACK')
      const bad = priced.find(p => p.line.issue)!
      const code = bad.line.issue === 'OUT_OF_STOCK' || bad.line.issue === 'INSUFFICIENT_STOCK' ? 'OUT_OF_STOCK' : 'VALIDATION'
      fail(code === 'OUT_OF_STOCK' ? 409 : 400, code, `${bad.line.name || 'An item'} cannot be ordered (${bad.line.issue})`,
        { lines: priced.map(p => p.line) })
    }
    const fee = deliveryFeeFor(subtotal, settings)
    const total = round2(subtotal + fee)
    if (expectedTotal !== null && Math.abs(expectedTotal - total) > 0.009) {
      await conn.query('ROLLBACK')
      fail(409, 'PRICE_CHANGED', 'Prices changed. Please review your cart.', { total, subtotal, delivery_fee: fee })
    }

    // Link / create the customer record (never auto-linked by phone: only trusted paths set customer_id).
    let customerId = user.customerId
    if (!customerId) {
      customerId = randomUUID()
      await conn.query(`INSERT INTO customers (id, name, email, phone, address) VALUES (?, ?, ?, ?, ?)`,
        [customerId, user.name, user.email, user.phone, addressText(addr)])
      await conn.query(`UPDATE app_users SET customer_id = ? WHERE id = ? AND customer_id IS NULL`, [customerId, user.userId])
    }

    const reviewer = await conn.query<{ r: number }>(`SELECT is_review_account AS r FROM app_users WHERE id = ?`, [user.userId])
    const orderNotes = Number(reviewer.rows[0]?.r) === 1 ? `[TEST ORDER - Play review] ${notes ?? ''}`.trim().slice(0, 500) : notes

    orderId = randomUUID()
    const now = new Date().toISOString()
    const days = Number(settings.estimated_delivery_days) || 2
    const eta = new Date(Date.now() + days * 86400000)
    const needsCall = !user.phoneVerified && pm === 'cod' ? 1 : 0
    let orderNumber = ''
    for (let attempt = 0; attempt < 6; attempt++) {
      const mx = await conn.query<{ m: string | null }>(
        `SELECT MAX(CAST(SUBSTRING(order_number, 5) AS UNSIGNED)) AS m FROM customer_orders WHERE order_number LIKE 'ONL-%'`)
      orderNumber = 'ONL-' + String((Number(mx.rows[0]?.m) || 1000) + 1 + attempt)
      try {
        await conn.query(
          `INSERT INTO customer_orders
            (id, order_number, branch_id, customer_id, customer_name, customer_phone, customer_address, status, payment_status,
             total_amount, paid_amount, notes, channel, app_user_id, delivery_fee, payment_method, delivery_otp_hash,
             needs_call_confirmation, estimated_delivery_date, status_history, payment_reference)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 'unpaid', ?, 0, ?, 'app', ?, ?, ?, ?, ?, ?, ?, ?)`,
          [orderId, orderNumber, branchId, customerId, addr.recipient_name, addr.phone, addressText(addr), total, orderNotes,
            user.userId, fee, pm, deliveryOtpHash(orderId), needsCall, eta, JSON.stringify([{ status: 'pending', at: now }]), paymentRef])
        break
      } catch (e) {
        if (!isDup(e) || attempt === 5) throw e
      }
    }
    for (const p of priced) {
      const l = p.line
      await conn.query(
        `INSERT INTO customer_order_items (id, order_id, product_id, quantity, unit_price, line_total, variant_id, variant_name, product_name,
           net_unit_price, tax_rate, tax_amount)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [randomUUID(), orderId, l.product_id, l.quantity, l.unit_price, l.line_total, l.variant_id, l.variant_name, l.name,
          p.net ?? null, p.taxRate ?? 0, p.tax ?? 0])
      if (managesStock(p.product!)) {
        await conn.query(
          `INSERT INTO stock_reservations (id, order_id, user_id, product_id, variant_id, branch_id, quantity, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'committed')`,
          [randomUUID(), orderId, user.userId, l.product_id, l.variant_id, branchId, l.quantity])
      }
    }
    await enqueueNotification(conn, {
      userId: user.userId, type: 'order_status', channel: 'orders', title: 'Order placed',
      body: `Your order ${orderNumber} has been received. We will confirm it shortly.`,
      url: `lankahome://orders/${orderId}`, dedupeKey: `order:${orderId}:pending`,
    })
    const dto = await getOrderDto(conn, company, orderId, origin, true)
    await conn.query(
      `INSERT INTO app_request_receipts (id, user_id, scope, idempotency_key, request_hash, response_status, response_body)
       VALUES (?, ?, 'order', ?, ?, 201, ?)`,
      [randomUUID(), user.userId, idemKey, hash, JSON.stringify(dto)])
    await conn.query('COMMIT')
    return { status: 201, body: dto }
  } catch (e) {
    try { await conn.query('ROLLBACK') } catch { /* already rolled back */ }
    if (isDup(e)) {
      // A concurrent request with the same Idempotency-Key won the race.
      const again = await company.tp.query<Record<string, unknown>>(
        `SELECT request_hash, response_status, response_body FROM app_request_receipts WHERE user_id = ? AND scope = ? AND idempotency_key = ?`, receiptWhere)
      if (again.rows[0]) return replay(again.rows[0], hash)
    }
    throw e
  } finally {
    conn.release()
  }
}

function replay(r: Record<string, unknown>, hash: string): { status: number; body: OrderDto } {
  if (r.request_hash && r.request_hash !== hash) fail(409, 'IDEMPOTENCY_CONFLICT', 'This Idempotency-Key was used with a different request.')
  return { status: 200, body: parseJson<OrderDto>(r.response_body, null as unknown as OrderDto) }
}

// ── Mapping ───────────────────────────────────────────────────────────────
export function summaryOf(o: Record<string, unknown>, itemCount: number): OrderSummaryDto {
  return {
    id: String(o.id), order_number: String(o.order_number), status: String(o.status) as OrderStatus,
    stage: stageOf(String(o.status)),
    payment_method: (o.payment_method as PaymentMethod | null) ?? null,
    payment_status: String(o.payment_status), total_amount: Number(o.total_amount), item_count: itemCount,
    created_at: toIso(o.created_at) as string, estimated_delivery_date: toIso(o.estimated_delivery_date),
  }
}

export async function loadAgent(db: DbLike, agentId: unknown) {
  if (!agentId) return null
  const { rows } = await db.query<Record<string, unknown>>(`SELECT name, phone, code FROM agents WHERE id = ?`, [agentId])
  const a = rows[0]
  return a ? { name: String(a.name), phone: a.phone ? String(a.phone) : null, code: String(a.code) } : null
}

export async function loadOrderItems(db: DbLike, orderId: string, origin: string): Promise<OrderItemDto[]> {
  const { rows } = await db.query<Record<string, unknown>>(
    `SELECT i.*, p.name AS pname, p.unit AS punit, p.sale_by, p.image_url FROM customer_order_items i
       LEFT JOIN products p ON p.id = i.product_id WHERE i.order_id = ? ORDER BY i.id`, [orderId])
  return rows.map(r => ({
    product_id: String(r.product_id), variant_id: r.variant_id ? String(r.variant_id) : null,
    name: String(r.product_name || r.pname || 'Item'), variant_name: r.variant_name ? String(r.variant_name) : null,
    unit: r.punit ? String(r.punit) : String(r.sale_by) === 'weight' ? 'kg' : 'pcs',
    quantity: Number(r.quantity), unit_price: Number(r.unit_price), line_total: Number(r.line_total),
    thumbnail_url: imageVariantUrl(origin, r.image_url, 300),
  }))
}

export async function getOrderDto(db: DbLike, company: AppCompany, orderId: string, origin: string, owner: boolean): Promise<OrderDto> {
  const { rows } = await db.query<Record<string, unknown>>(
    `SELECT o.*, b.name AS branch_name FROM customer_orders o LEFT JOIN branches b ON b.id = o.branch_id WHERE o.id = ?`, [orderId])
  const o = rows[0]
  if (!o) fail(404, 'NOT_FOUND', 'Order not found')
  return mapOrder(db, o, origin, owner)
}

export async function mapOrder(db: DbLike, o: Record<string, unknown>, origin: string, owner: boolean): Promise<OrderDto> {
  const items = await loadOrderItems(db, String(o.id), origin)
  const status = String(o.status) as OrderStatus
  const open = !['delivered', 'cancelled', 'returned'].includes(status)
  const subtotal = round2(items.reduce((a, i) => a + i.line_total, 0))
  return {
    ...summaryOf(o, items.length),
    branch_id: String(o.branch_id), branch_name: o.branch_name ? String(o.branch_name) : null,
    items, subtotal, delivery_fee: Number(o.delivery_fee) || 0,
    address: o.customer_address ? String(o.customer_address) : null,
    notes: o.notes ? String(o.notes) : null,
    needs_call_confirmation: Number(o.needs_call_confirmation) === 1,
    can_cancel: owner && CANCELLABLE.includes(status),
    delivery_otp: owner && open && String(o.channel) === 'app' ? deliveryOtp(String(o.id)) : null,
    agent: await loadAgent(db, o.assigned_agent_id),
  }
}

export async function buildTracking(db: DbLike, o: Record<string, unknown>, owner = true): Promise<TrackingResponse> {
  const status = String(o.status) as OrderStatus
  const history = parseJson<Array<{ status: string; at: string }>>(o.status_history, [])
  const at = (stage: OrderSummaryDto['stage'], fallback: unknown): string | null => {
    const h = history.find(x => stageOf(x.status) === stage)
    return h?.at ?? toIso(fallback)
  }
  const cur = stageOf(status)
  const order: TrackingStep['key'][] = ['placed', 'confirmed', 'packed', 'out_for_delivery', 'delivered']
  const idx = cur === 'cancelled' ? Math.max(0, ...history.map(h => order.indexOf(stageOf(h.status) as TrackingStep['key']))) : order.indexOf(cur as TrackingStep['key'])
  const labels: Record<string, string> = { placed: 'Order placed', confirmed: 'Confirmed', packed: 'Packed', out_for_delivery: 'Out for delivery', delivered: 'Delivered' }
  const fallbacks: Record<string, unknown> = { placed: o.created_at, out_for_delivery: o.dispatch_at, delivered: o.delivered_at }
  const steps: TrackingStep[] = order.map((k, i) => ({
    key: k, label: labels[k], done: i <= idx && cur !== 'cancelled' ? true : i <= idx, at: i <= idx ? at(k, fallbacks[k]) : null,
  }))
  const open = !['delivered', 'cancelled', 'returned'].includes(status)
  return {
    order_id: String(o.id), order_number: String(o.order_number), status, cancelled: cur === 'cancelled',
    steps, agent: await loadAgent(db, o.assigned_agent_id),
    estimated_delivery_date: toIso(o.estimated_delivery_date),
    delivery_otp: owner && open ? deliveryOtp(String(o.id)) : null,
  }
}

// ── Status changes ────────────────────────────────────────────────────────
const STATUS_TEXT: Record<string, { title: string; body: (n: string) => string }> = {
  confirmed: { title: 'Order confirmed', body: n => `Your order ${n} has been confirmed.` },
  processing: { title: 'Order being packed', body: n => `We are packing your order ${n}.` },
  preparing: { title: 'Order being packed', body: n => `We are packing your order ${n}.` },
  ready_for_delivery: { title: 'Order packed', body: n => `Your order ${n} is packed and ready.` },
  dispatched: { title: 'Out for delivery', body: n => `Your order ${n} is on its way.` },
  in_transit: { title: 'Out for delivery', body: n => `Your order ${n} is on its way.` },
  delivered: { title: 'Order delivered', body: n => `Your order ${n} was delivered. Thank you!` },
  cancelled: { title: 'Order cancelled', body: n => `Your order ${n} was cancelled.` },
  returned: { title: 'Order returned', body: n => `Your order ${n} was marked as returned.` },
}

/** Append history + notify + release reservations when an order's status moved (idempotent). */
export async function onOrderStatusChanged(db: DbLike, orderId: string): Promise<void> {
  const { rows } = await db.query<Record<string, unknown>>(`SELECT * FROM customer_orders WHERE id = ?`, [orderId])
  const o = rows[0]
  if (!o || String(o.channel) !== 'app') return
  const status = String(o.status) as OrderStatus
  const history = parseJson<Array<{ status: string; at: string }>>(o.status_history, [])
  if (history.length && history[history.length - 1].status === status) return
  history.push({ status, at: new Date().toISOString() })
  await db.query(`UPDATE customer_orders SET status_history = ? WHERE id = ?`, [JSON.stringify(history), orderId])
  if (RELEASE_RESERVATION_ON.includes(status)) {
    await db.query(`UPDATE stock_reservations SET status = 'released' WHERE order_id = ? AND status IN ('active','committed')`, [orderId])
  }
  const text = STATUS_TEXT[status]
  if (text && o.app_user_id) {
    await enqueueNotification(db, {
      userId: String(o.app_user_id), type: 'order_status', channel: 'orders', title: text.title,
      body: text.body(String(o.order_number)), url: `lankahome://orders/${orderId}`, dedupeKey: `order:${orderId}:${status}`,
    })
  }
}

/** POS assigned an agent to an app order: notify the agent once. */
export async function onOrderAssigned(db: DbLike, orderId: string): Promise<void> {
  const { rows } = await db.query<Record<string, unknown>>(`SELECT order_number, assigned_agent_id, channel FROM customer_orders WHERE id = ?`, [orderId])
  const o = rows[0]
  if (!o || !o.assigned_agent_id) return
  const u = await db.query<{ id: string }>(`SELECT id FROM app_users WHERE agent_id = ? AND deleted_at IS NULL LIMIT 1`, [o.assigned_agent_id])
  if (!u.rows[0]) return
  await enqueueNotification(db, {
    userId: u.rows[0].id, type: 'delivery_assigned', channel: 'deliveries', title: 'New delivery assigned',
    body: `Order ${String(o.order_number)} was assigned to you.`, url: `lankahome://deliveries/${orderId}`,
    dedupeKey: `delivery:${orderId}:${String(o.assigned_agent_id)}`,
  })
}

/** Order the caller owns, or 404 (another user's id never reveals existence). */
export async function loadOwnOrder(company: AppCompany, user: AppUserCtx, id: string): Promise<Record<string, unknown>> {
  const { rows } = await company.tp.query<Record<string, unknown>>(
    `SELECT o.*, b.name AS branch_name FROM customer_orders o LEFT JOIN branches b ON b.id = o.branch_id
      WHERE o.id = ? AND (o.app_user_id = ? OR (? IS NOT NULL AND o.customer_id = ?)) LIMIT 1`,
    [id, user.userId, user.customerId, user.customerId])
  if (!rows[0]) fail(404, 'NOT_FOUND', 'Order not found')
  return rows[0]
}

export async function cancelOrder(company: AppCompany, user: AppUserCtx, id: string): Promise<void> {
  const o = await loadOwnOrder(company, user, id)
  if (!CANCELLABLE.includes(String(o.status) as OrderStatus)) fail(409, 'ORDER_NOT_CANCELLABLE', 'This order can no longer be cancelled.')
  const placeholders = CANCELLABLE.map(() => '?').join(',')
  const r = await company.tp.query(
    `UPDATE customer_orders SET status = 'cancelled' WHERE id = ? AND status IN (${placeholders})`, [id, ...CANCELLABLE])
  if (Number((r.rows as unknown as { affectedRows?: number }).affectedRows) === 0) fail(409, 'ORDER_NOT_CANCELLABLE', 'This order can no longer be cancelled.')
  await onOrderStatusChanged(company.tp, id)
}
