import { ipcMain as realIpcMain } from 'electron'
import type { IpcMain } from 'electron'
import { getDb } from '../database'
import crypto, { randomUUID } from 'crypto'
import Store from 'electron-store'
import { enqueuSync } from '../services/syncQueue'
import { logAudit } from '../services/auditLog'
import { safeHandle } from './ipcHandler'

const store = new Store()

// Treat balances below half a cent as fully used (float-safe)
const USED_UP_EPSILON = 0.005

function currentUser() {
  return store.get('auth_user') as Record<string, unknown> | undefined
}

function currentPermissions() {
  const caller = currentUser()
  const role = caller?.role as Record<string, unknown> | undefined
  return ((role?.permissions as Record<string, unknown>) ||
    (caller?.permissions as Record<string, unknown>) ||
    {}) as Record<string, unknown>
}

function audit(db: ReturnType<typeof getDb>, action: string, recordId: string, values: Record<string, unknown>) {
  try {
    const user = currentUser()
    logAudit(db, {
      userId: (user?.id as string) || null, branchId: (user?.branch_id as string) || null,
      action, tableName: 'coupons', recordId, newValues: values,
    })
  } catch { /* audit failure must not break the operation */ }
}

// ─── Code generation ─────────────────────────────────────────────────────────
// CPN-<BRANCHCODE>-<XXXX>-<XXXX> using Crockford base32 (no I/L/O/U) so codes
// are unambiguous when read from a printed card. Random from crypto, UNIQUE
// constraint + retry makes this collision-safe even offline across branches.
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

function randomBlock(length: number): string {
  const bytes = crypto.randomBytes(length)
  let out = ''
  for (let i = 0; i < length; i++) out += CROCKFORD[bytes[i] % 32]
  return out
}

function generateCouponCode(db: ReturnType<typeof getDb>, branchId: string | null): string {
  const branch = branchId
    ? db.prepare('SELECT code, name FROM branches WHERE id = ?').get(branchId) as { code?: string; name?: string } | undefined
    : undefined
  const branchCode = String(branch?.code || branch?.name?.slice(0, 4) || 'MAIN')
    .toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || 'MAIN'

  for (let attempt = 0; attempt < 20; attempt++) {
    const code = `CPN-${branchCode}-${randomBlock(4)}-${randomBlock(4)}`
    const exists = db.prepare('SELECT id FROM coupons WHERE code = ?').get(code)
    if (!exists) return code
  }
  throw new Error('Could not generate a unique coupon code — try again')
}

// ─── Lazy expiry ─────────────────────────────────────────────────────────────
// No cron: any read path flips overdue active coupons to 'expired'. Guarded so
// it is idempotent and never touches used_up/void coupons.
function lazyExpire(db: ReturnType<typeof getDb>, couponId?: string): string[] {
  const rows = couponId
    ? db.prepare(`
        SELECT id FROM coupons
        WHERE id = ? AND status = 'active' AND valid_until IS NOT NULL AND datetime(valid_until) < datetime('now')
      `).all(couponId) as { id: string }[]
    : db.prepare(`
        SELECT id FROM coupons
        WHERE status = 'active' AND valid_until IS NOT NULL AND datetime(valid_until) < datetime('now')
      `).all() as { id: string }[]
  const expired: string[] = []
  for (const row of rows) {
    const changed = db.prepare(`
      UPDATE coupons SET status = 'expired', updated_at = datetime('now')
      WHERE id = ? AND status = 'active' AND valid_until IS NOT NULL AND datetime(valid_until) < datetime('now')
    `).run(row.id)
    if (changed.changes) {
      expired.push(row.id)
      audit(db, 'EXPIRE_COUPON', row.id, { reason: 'validity period ended' })
    }
  }
  return expired
}

// Shared filter builder for Voucher Management (coupons:list / coupons:reports
// / coupons:smartbuyDashboard) — Voucher Type / Agent / Scheme / lifecycle
// filters (spec §18, §21-26). `couponAlias` is the SQL alias for the coupons
// table in the calling query (always 'cp' today, kept generic to match the
// file's existing addSourceTypeFilter/addDateRange helper pattern).
function addSmartBuyFilters(couponAlias: string, filters: Record<string, unknown>, conditions: string[], params: unknown[]): void {
  const voucherType = String(filters.voucherType || 'all')
  if (voucherType === 'smartbuy') conditions.push(`${couponAlias}.source_type = 'smartbuy_redemption'`)
  else if (voucherType === 'normal') conditions.push(`(${couponAlias}.source_type IS NULL OR ${couponAlias}.source_type != 'smartbuy_redemption')`)

  if (filters.agentId) { conditions.push(`${couponAlias}.agent_id = ?`); params.push(filters.agentId) }
  if (filters.schemeId) { conditions.push(`${couponAlias}.smartbuy_scheme_id = ?`); params.push(filters.schemeId) }

  const lifecycle = String(filters.lifecycle || '')
  if (lifecycle === 'running') conditions.push(`${couponAlias}.status = 'active' AND ${couponAlias}.balance > 0`)
  else if (lifecycle === 'unclaimed') conditions.push(`${couponAlias}.source_type = 'smartbuy_redemption' AND ${couponAlias}.balance = ${couponAlias}.initial_value AND ${couponAlias}.status = 'active'`)
  else if (lifecycle === 'fully_claimed') conditions.push(`${couponAlias}.status = 'used_up'`)
  else if (lifecycle === 'outstanding') conditions.push(`${couponAlias}.source_type = 'smartbuy_redemption' AND ${couponAlias}.balance > 0 AND ${couponAlias}.status != 'void'`)
}

function enqueueCoupon(db: ReturnType<typeof getDb>, couponId: string): void {
  const row = db.prepare('SELECT * FROM coupons WHERE id = ?').get(couponId) as Record<string, unknown> | undefined
  if (!row) return
  delete row.synced_at
  void enqueuSync('coupons', couponId, 'UPDATE', row)
}

// ─── Transaction helpers (used inside invoices:create / invoices:cancel) ─────

export interface CouponRedemptionResult {
  couponId: string
  redemptionId: string
  couponRow: Record<string, unknown>
  redemptionRow: Record<string, unknown>
}

// Runs INSIDE the invoice DB transaction: any throw rolls the whole sale back,
// so a failed sale can never spend coupon balance (and vice versa). Also
// inserts the payments row (method='coupon') so the redemption shows up in the
// main Transaction Report / day-end totals with zero report changes.
export function redeemCouponInTransaction(
  db: ReturnType<typeof getDb>,
  input: {
    code: string
    amount: number
    invoiceId: string
    customerId?: string | null
    branchId?: string | null
    userId?: string | null
  }
): CouponRedemptionResult {
  const code = String(input.code || '').trim().toUpperCase()
  const amount = Number(Number(input.amount || 0).toFixed(2))
  if (!code) throw new Error('Coupon code is required')
  if (!(amount > 0)) throw new Error('Coupon amount must be greater than zero')

  const coupon = db.prepare('SELECT * FROM coupons WHERE UPPER(code) = ?').get(code) as Record<string, unknown> | undefined
  if (!coupon) throw new Error(`Coupon ${code} not found`)

  lazyExpire(db, String(coupon.id))
  const fresh = db.prepare('SELECT * FROM coupons WHERE id = ?').get(String(coupon.id)) as Record<string, unknown>

  if (fresh.status === 'expired') throw new Error('This coupon has expired')
  if (fresh.status === 'void') throw new Error('This coupon has been voided')
  if (fresh.status === 'used_up') throw new Error('This coupon balance is fully used')
  if (fresh.status !== 'active') throw new Error(`Coupon is not active (${fresh.status})`)
  if (fresh.valid_from && new Date(String(fresh.valid_from)) > new Date()) {
    throw new Error(`Coupon is not valid until ${String(fresh.valid_from).slice(0, 10)}`)
  }
  const balance = Number(fresh.balance || 0)
  if (amount > balance + USED_UP_EPSILON) {
    throw new Error(`Coupon balance is ${balance.toFixed(2)} — cannot redeem ${amount.toFixed(2)}`)
  }

  // Conditional decrement: guards against double-spend from a concurrent write.
  const newBalance = Number(Math.max(0, balance - amount).toFixed(2))
  const newStatus = newBalance <= USED_UP_EPSILON ? 'used_up' : 'active'
  const changed = db.prepare(`
    UPDATE coupons SET balance = ?, status = ?, updated_at = datetime('now')
    WHERE id = ? AND status = 'active' AND balance >= ?
  `).run(newBalance, newStatus, String(fresh.id), amount - USED_UP_EPSILON)
  if (!changed.changes) throw new Error('Coupon balance changed — please re-check and try again')

  const redemptionId = randomUUID()
  db.prepare(`
    INSERT INTO coupon_redemptions (id, coupon_id, invoice_id, customer_id, branch_id, amount, balance_after, type, redeemed_by)
    VALUES (?,?,?,?,?,?,?,'redeem',?)
  `).run(
    redemptionId, String(fresh.id), input.invoiceId,
    input.customerId || (fresh.customer_id as string | null) || null,
    input.branchId || null, amount, newBalance, input.userId || null
  )

  // Payment row — main-process only; renderer 'coupon' payment lines are rejected upstream.
  db.prepare(`
    INSERT INTO payments (id, invoice_id, method, amount, reference, received_by)
    VALUES (?,?,?,?,?,?)
  `).run(randomUUID(), input.invoiceId, 'coupon', amount, code, input.userId || null)

  audit(db, 'REDEEM_COUPON', String(fresh.id), { code, amount, balance_after: newBalance, invoice_id: input.invoiceId })

  const couponRow = db.prepare('SELECT * FROM coupons WHERE id = ?').get(String(fresh.id)) as Record<string, unknown>
  const redemptionRow = db.prepare('SELECT * FROM coupon_redemptions WHERE id = ?').get(redemptionId) as Record<string, unknown>
  delete couponRow.synced_at
  delete redemptionRow.synced_at
  return { couponId: String(fresh.id), redemptionId, couponRow, redemptionRow }
}

// Runs INSIDE the invoice cancel transaction: restores balance for every
// un-reversed redemption of the invoice via negative reversal ledger rows.
export function reverseCouponForInvoice(
  db: ReturnType<typeof getDb>,
  invoiceId: string,
  userId?: string | null
): CouponRedemptionResult[] {
  const redemptions = db.prepare(`
    SELECT coupon_id, SUM(amount) as net_amount
    FROM coupon_redemptions
    WHERE invoice_id = ?
    GROUP BY coupon_id
    HAVING SUM(amount) > 0
  `).all(invoiceId) as { coupon_id: string; net_amount: number }[]

  const results: CouponRedemptionResult[] = []
  for (const r of redemptions) {
    const amount = Number(Number(r.net_amount).toFixed(2))
    const coupon = db.prepare('SELECT * FROM coupons WHERE id = ?').get(r.coupon_id) as Record<string, unknown> | undefined
    if (!coupon) continue

    const newBalance = Number((Number(coupon.balance || 0) + amount).toFixed(2))
    db.prepare(`
      UPDATE coupons SET balance = ?, status = CASE WHEN status = 'used_up' THEN 'active' ELSE status END,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(newBalance, r.coupon_id)

    const redemptionId = randomUUID()
    db.prepare(`
      INSERT INTO coupon_redemptions (id, coupon_id, invoice_id, customer_id, branch_id, amount, balance_after, type, redeemed_by)
      VALUES (?,?,?,?,?,?,?,'reversal',?)
    `).run(
      redemptionId, r.coupon_id, invoiceId,
      (coupon.customer_id as string | null) || null,
      (coupon.branch_id as string | null) || null,
      -amount, newBalance, userId || null
    )

    audit(db, 'REVERSE_COUPON', r.coupon_id, { amount, balance_after: newBalance, invoice_id: invoiceId })

    const couponRow = db.prepare('SELECT * FROM coupons WHERE id = ?').get(r.coupon_id) as Record<string, unknown>
    const redemptionRow = db.prepare('SELECT * FROM coupon_redemptions WHERE id = ?').get(redemptionId) as Record<string, unknown>
    delete couponRow.synced_at
    delete redemptionRow.synced_at
    results.push({ couponId: r.coupon_id, redemptionId, couponRow, redemptionRow })
  }
  return results
}

// ─── SmartBuy voucher issuance (used inside chits:members:recordRedemption /
// reverseRedemption) ──────────────────────────────────────────────────────────
// A SmartBuy winner who picks a product cheaper than their frozen entitlement
// must not lose the difference — it's auto-issued as a real coupon (the same
// voucher/store-credit system used everywhere else in this app, not a
// separate ledger) so it carries a real voucher number and is immediately
// spendable at POS via the existing coupon payment method.

export interface SmartBuyVoucherResult {
  couponId: string
  code: string
  balance: number
  couponRow: Record<string, unknown>
}

// Runs INSIDE the caller's own db.transaction() (chits:members:recordRedemption)
// — throws to roll back the whole redemption rather than returning a
// { success: false }, matching redeemCouponInTransaction's contract. Does NOT
// call enqueuSync itself; the caller pushes couponRow into its own enqueue
// array alongside every other write from that same transaction.
export function issueSmartBuyVoucher(
  db: ReturnType<typeof getDb>,
  input: {
    customerId: string
    branchId: string | null
    amount: number
    schemeId: string
    memberId: string
    cycleNo: number | null
    entitlementValue: number
    productValue: number
    issuedBy: string | null
    notes?: string
    agentId?: string | null
    agentCode?: string | null
    agentName?: string | null
  }
): SmartBuyVoucherResult {
  const amount = Number(Number(input.amount || 0).toFixed(2))
  if (!input.customerId) throw new Error('A customer is required to issue a SmartBuy voucher')
  if (!(amount > 0)) throw new Error('Voucher amount must be greater than zero')

  const id = randomUUID()
  const code = generateCouponCode(db, input.branchId)
  const validFrom = new Date().toISOString().slice(0, 10)
  const row = {
    id, code, name: 'SmartBuy Remaining Entitlement Voucher',
    customer_id: input.customerId, branch_id: input.branchId,
    initial_value: amount, balance: amount, status: 'active',
    valid_from: validFrom, valid_until: null,
    issued_by: input.issuedBy, notes: input.notes || null,
    source_type: 'smartbuy_redemption', source_id: input.memberId,
    smartbuy_scheme_id: input.schemeId, smartbuy_member_id: input.memberId,
    smartbuy_cycle_no: input.cycleNo, smartbuy_entitlement_value: input.entitlementValue,
    smartbuy_product_value: input.productValue,
    // Snapshot of the member's registered Agent at issuance time — see the
    // migration comment in database.ts. Never re-derived from a live join
    // after this; only coupons:changeAgent may update these 3 columns.
    agent_id: input.agentId || null, agent_code: input.agentCode || null, agent_name: input.agentName || null,
  }
  db.prepare(`
    INSERT INTO coupons (id, code, name, customer_id, branch_id, initial_value, balance,
      status, valid_from, valid_until, issued_by, notes,
      source_type, source_id, smartbuy_scheme_id, smartbuy_member_id, smartbuy_cycle_no,
      smartbuy_entitlement_value, smartbuy_product_value, agent_id, agent_code, agent_name)
    VALUES (@id,@code,@name,@customer_id,@branch_id,@initial_value,@balance,
      @status,@valid_from,@valid_until,@issued_by,@notes,
      @source_type,@source_id,@smartbuy_scheme_id,@smartbuy_member_id,@smartbuy_cycle_no,
      @smartbuy_entitlement_value,@smartbuy_product_value,@agent_id,@agent_code,@agent_name)
  `).run(row)

  audit(db, 'ISSUE_COUPON', id, {
    code, amount, source: 'smartbuy_redemption',
    schemeId: input.schemeId, memberId: input.memberId, cycleNo: input.cycleNo,
    agentId: input.agentId || null, agentCode: input.agentCode || null,
  })

  return { couponId: id, code, balance: amount, couponRow: row }
}

// In-transaction equivalent of coupons:void's body — used instead of calling
// the coupons:void IPC handler because that handler gates on the CALLING
// user's own coupon permissions (wrong check for a Super-Admin-only chit
// redemption reversal) and isn't transactional with reverseRedemption's own
// db.transaction(). Whatever balance remains (spent or not — a SmartBuy
// voucher is a single dedicated instance, never shared) is forfeited, exactly
// like a normal coupon void.
export function voidSmartBuyVoucher(
  db: ReturnType<typeof getDb>,
  couponId: string,
  input: { reason: string; userId: string | null }
): void {
  const coupon = db.prepare('SELECT id, code, balance, status FROM coupons WHERE id = ?').get(couponId) as
    { id: string; code: string; balance: number; status: string } | undefined
  if (!coupon || coupon.status === 'void') return
  db.prepare(`UPDATE coupons SET status = 'void', updated_at = datetime('now') WHERE id = ?`).run(couponId)
  audit(db, 'VOID_COUPON', couponId, { code: coupon.code, forfeited_balance: coupon.balance, reason: input.reason })
}

// ─── IPC handlers ────────────────────────────────────────────────────────────

// Optional injectable ipcMain (mirrors registerChitHandlers/etc.'s pattern)
// so the QA integration harness can register these against its own fake
// registry — defaults to the real electron ipcMain for the actual app
// (electron/main.ts's call site is unaffected, same as calling it with no args).
export function registerCouponHandlers(customIpcMain: IpcMain = realIpcMain) {
  const ipcMain = customIpcMain

  // Create/issue — Company Admin or roles with coupons_create (Branch Manager)
  safeHandle(ipcMain, 'coupons:create', async (_e, payload: Record<string, unknown>) => {
    const perms = currentPermissions()
    if (!perms.all && !perms.coupons_create) {
      return { success: false, error: 'You do not have permission to issue coupons' }
    }
    const db = getDb()
    const user = currentUser()

    const name = String(payload.name || '').trim()
    const initialValue = Number(Number(payload.initial_value || 0).toFixed(2))
    if (!name) return { success: false, error: 'Coupon name is required' }
    if (!(initialValue > 0)) return { success: false, error: 'Coupon value must be greater than zero' }

    const validFrom = String(payload.valid_from || '').trim() || new Date().toISOString().slice(0, 10)
    let validUntil = String(payload.valid_until || '').trim() || null
    const durationDays = Number(payload.duration_days || 0)
    if (!validUntil && durationDays > 0) {
      const d = new Date(`${validFrom}T00:00:00`)
      d.setDate(d.getDate() + durationDays)
      validUntil = d.toISOString().slice(0, 10)
    }
    if (validUntil && new Date(validUntil) < new Date(validFrom)) {
      return { success: false, error: 'Valid-until date must be after the valid-from date' }
    }

    const branchId = (payload.branch_id as string) || (user?.branch_id as string) || null
    const id = randomUUID()
    const code = generateCouponCode(db, branchId)

    db.prepare(`
      INSERT INTO coupons (id, code, name, customer_id, branch_id, initial_value, balance,
        status, valid_from, valid_until, issued_by, notes)
      VALUES (?,?,?,?,?,?,?,'active',?,?,?,?)
    `).run(
      id, code, name,
      (payload.customer_id as string) || null, branchId,
      initialValue, initialValue,
      validFrom, validUntil,
      (user?.id as string) || null,
      String(payload.notes || '').trim() || null
    )

    audit(db, 'ISSUE_COUPON', id, { code, name, initial_value: initialValue, valid_until: validUntil })
    const row = db.prepare('SELECT * FROM coupons WHERE id = ?').get(id) as Record<string, unknown>
    delete row.synced_at
    await enqueuSync('coupons', id, 'INSERT', row)

    return { success: true, data: row }
  })

  // List with filters — visible to admins/managers with coupons access
  safeHandle(ipcMain, 'coupons:list', (_e, filters: Record<string, unknown> = {}) => {
    const perms = currentPermissions()
    if (!perms.all && !perms.coupons) {
      return { success: false, error: 'You do not have permission to view coupons' }
    }
    const db = getDb()
    lazyExpire(db)

    const conditions: string[] = []
    const params: unknown[] = []
    const search = String(filters.search || '').trim()
    if (search) {
      // Voucher Management search (spec §27) — Code / Name / Customer Name /
      // Phone / NIC / SmartBuy Member ID, so staff can look a voucher up the
      // same way they'd look up the member or customer directly.
      conditions.push(`(cp.code LIKE ? OR cp.name LIKE ? OR cu.name LIKE ? OR cu.phone LIKE ? OR cu.nic LIKE ? OR cp.smartbuy_member_id LIKE ?)`)
      params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`)
    }
    if (filters.status)      { conditions.push(`cp.status = ?`); params.push(filters.status) }
    if (filters.customerId)  { conditions.push(`cp.customer_id = ?`); params.push(filters.customerId) }
    if (filters.dateFrom)    { conditions.push(`date(cp.created_at) >= date(?)`); params.push(filters.dateFrom) }
    if (filters.dateTo)      { conditions.push(`date(cp.created_at) <= date(?)`); params.push(filters.dateTo) }
    addSmartBuyFilters('cp', filters, conditions, params)

    const rows = db.prepare(`
      SELECT cp.*, cu.name as customer_name, cu.phone as customer_phone,
             b.name as branch_name, u.name as issued_by_name,
             cs.name as smartbuy_scheme_name, cs.scheme_number as smartbuy_scheme_number,
             (SELECT COUNT(*) FROM coupon_redemptions cr WHERE cr.coupon_id = cp.id AND cr.type = 'redeem') as redemption_count
      FROM coupons cp
      LEFT JOIN customers cu ON cu.id = cp.customer_id
      LEFT JOIN branches b ON b.id = cp.branch_id
      LEFT JOIN users u ON u.id = cp.issued_by
      LEFT JOIN chit_schemes cs ON cs.id = cp.smartbuy_scheme_id
      ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
      ORDER BY cp.created_at DESC
      LIMIT 500
    `).all(...params)

    return { success: true, data: rows }
  })

  // Full detail by id or code — powers the lookup screen (issued-to, products
  // bought on each redemption, remaining balance, expiry)
  safeHandle(ipcMain, 'coupons:get', (_e, idOrCode: string) => {
    const perms = currentPermissions()
    if (!perms.all && !perms.coupons) {
      return { success: false, error: 'You do not have permission to view coupons' }
    }
    const db = getDb()
    const key = String(idOrCode || '').trim()
    const coupon = db.prepare(`
      SELECT cp.*, cu.name as customer_name, cu.phone as customer_phone,
             b.name as branch_name, u.name as issued_by_name,
             cs.name as smartbuy_scheme_name, cs.scheme_number as smartbuy_scheme_number,
             cm.redemption_type as smartbuy_winner_type
      FROM coupons cp
      LEFT JOIN customers cu ON cu.id = cp.customer_id
      LEFT JOIN branches b ON b.id = cp.branch_id
      LEFT JOIN users u ON u.id = cp.issued_by
      LEFT JOIN chit_schemes cs ON cs.id = cp.smartbuy_scheme_id
      LEFT JOIN chit_members cm ON cm.id = cp.smartbuy_member_id
      WHERE cp.id = ? OR UPPER(cp.code) = UPPER(?)
      LIMIT 1
    `).get(key, key) as Record<string, unknown> | undefined
    if (!coupon) return { success: false, error: 'Coupon not found' }

    lazyExpire(db, String(coupon.id))
    coupon.status = (db.prepare('SELECT status FROM coupons WHERE id = ?').get(String(coupon.id)) as { status: string }).status

    const redemptions = db.prepare(`
      SELECT cr.*, i.invoice_number, i.total_amount as invoice_total, b.name as branch_name, u.name as redeemed_by_name
      FROM coupon_redemptions cr
      LEFT JOIN invoices i ON i.id = cr.invoice_id
      LEFT JOIN branches b ON b.id = cr.branch_id
      LEFT JOIN users u ON u.id = cr.redeemed_by
      WHERE cr.coupon_id = ?
      ORDER BY cr.created_at DESC
    `).all(String(coupon.id)) as Record<string, unknown>[]

    // Products bought on each redemption invoice
    const invoiceIds = [...new Set(redemptions.map(r => String(r.invoice_id || '')).filter(Boolean))]
    const itemsByInvoice: Record<string, unknown[]> = {}
    for (const invId of invoiceIds) {
      itemsByInvoice[invId] = db.prepare(`
        SELECT ii.quantity, ii.unit_price, ii.line_total, p.name as product_name, p.sku
        FROM invoice_items ii
        LEFT JOIN products p ON p.id = ii.product_id
        WHERE ii.invoice_id = ?
      `).all(invId)
    }
    for (const r of redemptions) {
      r.items = itemsByInvoice[String(r.invoice_id || '')] || []
    }

    return { success: true, data: { ...coupon, redemptions } }
  })

  // Validate by code — any authenticated user (cashier at POS)
  safeHandle(ipcMain, 'coupons:validate', (_e, code: string) => {
    const db = getDb()
    const key = String(code || '').trim()
    if (!key) return { success: true, data: { valid: false, reason: 'Enter a coupon code' } }

    const coupon = db.prepare(`
      SELECT cp.*, cu.name as customer_name, cu.phone as customer_phone,
             cs.name as smartbuy_scheme_name, cs.scheme_number as smartbuy_scheme_number,
             cm.won_cycle_no as smartbuy_member_cycle, cm.redemption_type as smartbuy_winner_type
      FROM coupons cp
      LEFT JOIN customers cu ON cu.id = cp.customer_id
      LEFT JOIN chit_schemes cs ON cs.id = cp.smartbuy_scheme_id
      LEFT JOIN chit_members cm ON cm.id = cp.smartbuy_member_id
      WHERE UPPER(cp.code) = UPPER(?)
      LIMIT 1
    `).get(key) as Record<string, unknown> | undefined
    if (!coupon) return { success: true, data: { valid: false, reason: 'Coupon not found' } }

    lazyExpire(db, String(coupon.id))
    const fresh = db.prepare('SELECT status, balance FROM coupons WHERE id = ?').get(String(coupon.id)) as { status: string; balance: number }
    coupon.status = fresh.status
    coupon.balance = fresh.balance

    let reason: string | null = null
    if (fresh.status === 'expired') reason = 'Coupon has expired'
    else if (fresh.status === 'void') reason = 'Coupon has been voided'
    else if (fresh.status === 'used_up') reason = 'Coupon balance is fully used'
    else if (coupon.valid_from && new Date(String(coupon.valid_from)) > new Date()) {
      reason = `Coupon is valid from ${String(coupon.valid_from).slice(0, 10)}`
    } else if (Number(fresh.balance) <= USED_UP_EPSILON) reason = 'Coupon has no remaining balance'

    const isSmartBuy = coupon.source_type === 'smartbuy_redemption'

    return {
      success: true,
      data: {
        valid: !reason,
        reason,
        coupon: {
          id: coupon.id, code: coupon.code, name: coupon.name,
          customer_id: coupon.customer_id, customer_name: coupon.customer_name,
          customer_phone: coupon.customer_phone,
          balance: Number(fresh.balance || 0), initial_value: coupon.initial_value,
          status: fresh.status, valid_from: coupon.valid_from, valid_until: coupon.valid_until,
          // SmartBuy / Chit Fund voucher metadata — present only when this
          // coupon was issued via issueSmartBuyVoucher(). The POS payment
          // screen uses this (not the unrelated free-text POS sales-agent
          // field) to render a read-only "Agent: <name> (<code>)" panel —
          // the cashier never types an Agent Code for these vouchers.
          is_smartbuy: isSmartBuy,
          smartbuy_scheme_id: isSmartBuy ? coupon.smartbuy_scheme_id : undefined,
          smartbuy_scheme_name: isSmartBuy ? coupon.smartbuy_scheme_name : undefined,
          smartbuy_scheme_number: isSmartBuy ? coupon.smartbuy_scheme_number : undefined,
          smartbuy_member_id: isSmartBuy ? coupon.smartbuy_member_id : undefined,
          smartbuy_cycle_no: isSmartBuy ? coupon.smartbuy_cycle_no : undefined,
          smartbuy_winner_type: isSmartBuy ? coupon.smartbuy_winner_type : undefined,
          smartbuy_entitlement_value: isSmartBuy ? coupon.smartbuy_entitlement_value : undefined,
          agent_id: isSmartBuy ? coupon.agent_id : undefined,
          agent_code: isSmartBuy ? coupon.agent_code : undefined,
          agent_name: isSmartBuy ? coupon.agent_name : undefined,
        },
      },
    }
  })

  // Void — kills the remaining balance (audited)
  safeHandle(ipcMain, 'coupons:void', async (_e, id: string, reason?: string) => {
    const perms = currentPermissions()
    if (!perms.all && !perms.coupons_void && !perms.coupons_create) {
      return { success: false, error: 'You do not have permission to void coupons' }
    }
    const db = getDb()
    const coupon = db.prepare('SELECT * FROM coupons WHERE id = ?').get(id) as Record<string, unknown> | undefined
    if (!coupon) return { success: false, error: 'Coupon not found' }
    if (coupon.status === 'void') return { success: false, error: 'Coupon is already voided' }

    db.prepare(`UPDATE coupons SET status = 'void', updated_at = datetime('now') WHERE id = ?`).run(id)
    audit(db, 'VOID_COUPON', id, { code: coupon.code, forfeited_balance: coupon.balance, reason: reason || 'No reason provided' })
    enqueueCoupon(db, id)
    return { success: true }
  })

  // Reports — Issued / Redeemed / Completed / Expired / Customer summary
  safeHandle(ipcMain, 'coupons:reports', (_e, filters: Record<string, unknown> = {}) => {
    const perms = currentPermissions()
    if (!perms.all && !perms.coupons_reports && !perms.coupons) {
      return { success: false, error: 'You do not have permission to view coupon reports' }
    }
    const db = getDb()
    lazyExpire(db)

    const caller = currentUser()
    const isGlobal = Boolean(perms.all || perms.reports)
    const type = String(filters.type || 'issued')

    const conditions: string[] = []
    const params: unknown[] = []
    const scopeBranch = !isGlobal && caller?.branch_id ? String(caller.branch_id) : (filters.branchId ? String(filters.branchId) : null)
    const search = String(filters.search || '').trim()

    const addDateRange = (column: string) => {
      if (filters.dateFrom) { conditions.push(`date(${column}) >= date(?)`); params.push(filters.dateFrom) }
      if (filters.dateTo)   { conditions.push(`date(${column}) <= date(?)`); params.push(filters.dateTo) }
    }
    // Voucher Source filter — All / POS / SmartBuy (§24). Every SmartBuy-
    // issued coupon (full win-time voucher or a downgrade leftover) is
    // written with source_type='smartbuy_redemption' by issueSmartBuyVoucher;
    // everything else (source_type NULL or anything else) is a plain POS
    // coupon. No separate SmartBuy report — same coupons table, one filter.
    const sourceType = String(filters.sourceType || 'all')
    const addSourceTypeFilter = (couponAlias: string) => {
      if (sourceType === 'smartbuy') { conditions.push(`${couponAlias}.source_type = 'smartbuy_redemption'`) }
      else if (sourceType === 'pos') { conditions.push(`(${couponAlias}.source_type IS NULL OR ${couponAlias}.source_type != 'smartbuy_redemption')`) }
    }

    let rows: Record<string, unknown>[] = []
    let summary: Record<string, unknown> = {}

    if (type === 'redeemed') {
      if (scopeBranch) { conditions.push(`cr.branch_id = ?`); params.push(scopeBranch) }
      addDateRange('cr.created_at')
      if (search) { conditions.push(`(cp.code LIKE ? OR cp.name LIKE ? OR cu.name LIKE ? OR i.invoice_number LIKE ?)`); params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`) }
      addSourceTypeFilter('cp')
      addSmartBuyFilters('cp', filters, conditions, params)
      conditions.push(`cr.type = 'redeem'`)
      rows = db.prepare(`
        SELECT cr.created_at, cp.code, cp.name as coupon_name, cu.name as customer_name,
               i.invoice_number, cr.amount, cr.balance_after, b.name as branch_name, u.name as redeemed_by_name
        FROM coupon_redemptions cr
        LEFT JOIN coupons cp ON cp.id = cr.coupon_id
        LEFT JOIN customers cu ON cu.id = cr.customer_id
        LEFT JOIN invoices i ON i.id = cr.invoice_id
        LEFT JOIN branches b ON b.id = cr.branch_id
        LEFT JOIN users u ON u.id = cr.redeemed_by
        WHERE ${conditions.join(' AND ')}
        ORDER BY cr.created_at DESC
        LIMIT 1000
      `).all(...params) as Record<string, unknown>[]
      summary = {
        count: rows.length,
        total_redeemed: Number(rows.reduce((s, r) => s + Number(r.amount || 0), 0).toFixed(2)),
      }
    } else if (type === 'customerSummary') {
      if (scopeBranch) { conditions.push(`cp.branch_id = ?`); params.push(scopeBranch) }
      addDateRange('cp.created_at')
      if (search) { conditions.push(`(cu.name LIKE ? OR cu.phone LIKE ?)`); params.push(`%${search}%`, `%${search}%`) }
      addSourceTypeFilter('cp')
      addSmartBuyFilters('cp', filters, conditions, params)
      rows = db.prepare(`
        SELECT cu.name as customer_name, cu.phone as customer_phone,
               COUNT(cp.id) as coupons_issued,
               SUM(cp.initial_value) as total_value,
               SUM(cp.initial_value - cp.balance) as total_used,
               SUM(cp.balance) as total_remaining
        FROM coupons cp
        JOIN customers cu ON cu.id = cp.customer_id
        ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
        GROUP BY cp.customer_id
        ORDER BY total_value DESC
        LIMIT 1000
      `).all(...params) as Record<string, unknown>[]
      summary = {
        customers: rows.length,
        total_value: Number(rows.reduce((s, r) => s + Number(r.total_value || 0), 0).toFixed(2)),
        total_used: Number(rows.reduce((s, r) => s + Number(r.total_used || 0), 0).toFixed(2)),
      }
    } else {
      // issued / completed / expired — coupon-row based reports
      if (type === 'completed') conditions.push(`cp.status = 'used_up'`)
      if (type === 'expired')   conditions.push(`cp.status = 'expired'`)
      if (scopeBranch) { conditions.push(`cp.branch_id = ?`); params.push(scopeBranch) }
      addDateRange('cp.created_at')
      if (search) { conditions.push(`(cp.code LIKE ? OR cp.name LIKE ? OR cu.name LIKE ?)`); params.push(`%${search}%`, `%${search}%`, `%${search}%`) }
      addSourceTypeFilter('cp')
      addSmartBuyFilters('cp', filters, conditions, params)
      rows = db.prepare(`
        SELECT cp.created_at, cp.code, cp.name, cu.name as customer_name,
               cp.initial_value, cp.balance, (cp.initial_value - cp.balance) as used_amount,
               cp.status, cp.valid_from, cp.valid_until, b.name as branch_name, u.name as issued_by_name,
               cp.source_type, cs2.name as smartbuy_scheme_name, cs2.scheme_number as smartbuy_scheme_number,
               cp.smartbuy_cycle_no, cp.agent_id, cp.agent_code, cp.agent_name
        FROM coupons cp
        LEFT JOIN customers cu ON cu.id = cp.customer_id
        LEFT JOIN branches b ON b.id = cp.branch_id
        LEFT JOIN users u ON u.id = cp.issued_by
        LEFT JOIN chit_schemes cs2 ON cs2.id = cp.smartbuy_scheme_id
        ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
        ORDER BY cp.created_at DESC
        LIMIT 1000
      `).all(...params) as Record<string, unknown>[]
      summary = {
        count: rows.length,
        total_value: Number(rows.reduce((s, r) => s + Number(r.initial_value || 0), 0).toFixed(2)),
        total_used: Number(rows.reduce((s, r) => s + Number(r.used_amount || 0), 0).toFixed(2)),
        total_remaining: Number(rows.reduce((s, r) => s + Number(r.balance || 0), 0).toFixed(2)),
      }
      if (type === 'expired') {
        summary.forfeited_balance = summary.total_remaining
      }
    }

    audit(getDb(), `REPORT_COUPONS_${type.toUpperCase()}`, 'report', { filters })
    return { success: true, data: { rows, summary } }
  })

  // SmartBuy Voucher Dashboard (spec §20/§26/§29) — totals across every
  // voucher issued via issueSmartBuyVoucher(), optionally scoped to one
  // scheme or agent. Same permission gate as coupons:reports (view-level,
  // not the stricter coupons_agent_change).
  safeHandle(ipcMain, 'coupons:smartbuyDashboard', (_e, filters: Record<string, unknown> = {}) => {
    const perms = currentPermissions()
    if (!perms.all && !perms.coupons_reports && !perms.coupons) {
      return { success: false, error: 'You do not have permission to view coupon reports' }
    }
    const db = getDb()
    lazyExpire(db)

    const conditions: string[] = [`cp.source_type = 'smartbuy_redemption'`]
    const params: unknown[] = []
    if (filters.schemeId) { conditions.push(`cp.smartbuy_scheme_id = ?`); params.push(filters.schemeId) }
    if (filters.agentId)  { conditions.push(`cp.agent_id = ?`); params.push(filters.agentId) }
    const where = `WHERE ${conditions.join(' AND ')}`

    const totals = db.prepare(`
      SELECT
        COUNT(*) as total_vouchers,
        COALESCE(SUM(cp.initial_value), 0) as total_issued_value,
        COALESCE(SUM(cp.initial_value - cp.balance), 0) as total_redeemed_value,
        COALESCE(SUM(CASE WHEN cp.status != 'void' THEN cp.balance ELSE 0 END), 0) as outstanding_value,
        COALESCE(SUM(CASE WHEN cp.status = 'active' AND cp.balance = cp.initial_value THEN 1 ELSE 0 END), 0) as available_count,
        COALESCE(SUM(CASE WHEN cp.status = 'active' AND cp.balance > 0 AND cp.balance < cp.initial_value THEN 1 ELSE 0 END), 0) as partially_used_count,
        COALESCE(SUM(CASE WHEN cp.status = 'used_up' THEN 1 ELSE 0 END), 0) as fully_claimed_count,
        COALESCE(SUM(CASE WHEN cp.status = 'void' THEN 1 ELSE 0 END), 0) as cancelled_count,
        COALESCE(SUM(CASE WHEN cp.status = 'expired' THEN 1 ELSE 0 END), 0) as expired_count
      FROM coupons cp
      ${where}
    `).get(...params) as Record<string, unknown>

    return { success: true, data: totals }
  })

  // Agent Change (spec §12) — the ONLY path allowed to mutate a SmartBuy
  // voucher's agent_id/agent_code/agent_name after issuance. Requires a
  // dedicated permission (deliberately NOT satisfied by plain 'coupons'
  // view/manage access), re-validates the target agent independently against
  // the agents table (never trusts a client-supplied code/name), and is
  // always audited with the reason, old/new Agent, old/new branch, user,
  // timestamp (the last two are first-class audit_logs columns, populated
  // by logAudit() itself) — a malicious/compromised client cannot reassign
  // a voucher's Agent by sending a different id, since this handler is the
  // only writer.
  //
  // Business rule (confirmed):
  //  - Branch-scoped caller (no perms.all): new Agent must be in the SAME
  //    branch as the caller — cross-branch reassignment is a hard REJECT,
  //    no override, matching chits:members:add's own branch guard.
  //  - perms.all (Super Admin): MAY reassign cross-branch, but only as an
  //    explicit, confirmed administrative override — the first call (no
  //    confirmCrossBranch flag) for a genuinely cross-branch reassignment
  //    returns requiresConfirmation:true and performs NO write; the caller
  //    must re-submit with confirmCrossBranch:true to actually apply it.
  //    A same-branch reassignment by perms.all never needs this extra step.
  safeHandle(ipcMain, 'coupons:changeAgent', (_e, couponId: string, newAgentId: string, reason?: string, confirmCrossBranch?: boolean) => {
    const perms = currentPermissions()
    if (!perms.all && !perms.coupons_agent_change) {
      return { success: false, error: 'You do not have permission to change a voucher\'s Agent' }
    }
    const reasonText = String(reason || '').trim()
    if (!reasonText) return { success: false, error: 'A reason is required to change the Agent' }

    const db = getDb()
    const coupon = db.prepare('SELECT * FROM coupons WHERE id = ?').get(couponId) as Record<string, unknown> | undefined
    if (!coupon) return { success: false, error: 'Voucher not found' }
    if (coupon.source_type !== 'smartbuy_redemption') return { success: false, error: 'Only SmartBuy vouchers have an Agent to change' }

    const newAgent = db.prepare(`SELECT id, code, name, status, branch_id FROM agents WHERE id = ?`).get(newAgentId) as
      { id: string; code: string; name: string; status: string; branch_id: string | null } | undefined
    if (!newAgent) return { success: false, error: 'Selected agent not found' }
    if (newAgent.status !== 'active') return { success: false, error: 'Selected agent is not active' }

    // The Agent currently on the voucher — comparing its branch against the
    // new Agent's branch is what actually defines "cross-branch" here (not
    // the caller's own branch), so the confirmation/audit trail reflects the
    // real before/after of the voucher itself.
    const oldAgentRow = coupon.agent_id
      ? db.prepare(`SELECT id, code, name, branch_id FROM agents WHERE id = ?`).get(coupon.agent_id) as
          { id: string; code: string; name: string; branch_id: string | null } | undefined
      : undefined
    const oldBranchId = oldAgentRow?.branch_id || null
    const newBranchId = newAgent.branch_id || null
    const isCrossBranch = Boolean(oldBranchId && newBranchId && String(oldBranchId) !== String(newBranchId))

    // Same cross-branch guard chits:members:add already applies when linking
    // an Agent to a member (chits.ts, "Selected agent does not belong to
    // this branch") — a branch-scoped caller (no perms.all) must not be able
    // to attribute a voucher's commission to another branch's Agent. No
    // override for a branch-scoped caller, regardless of confirmCrossBranch.
    if (!perms.all) {
      const caller = currentUser()
      if (newAgent.branch_id && String(newAgent.branch_id) !== String(caller?.branch_id || '')) {
        return { success: false, error: 'Selected agent does not belong to your branch' }
      }
    } else if (isCrossBranch && !confirmCrossBranch) {
      // perms.all crossing branches, but hasn't explicitly confirmed yet —
      // report what's about to happen and stop; no row is touched.
      const branchName = (id: string | null) => id
        ? ((db.prepare('SELECT name FROM branches WHERE id = ?').get(id) as { name: string } | undefined)?.name || id)
        : 'Unknown branch'
      return {
        success: false,
        requiresConfirmation: true,
        oldBranchId, newBranchId,
        oldBranchName: branchName(oldBranchId), newBranchName: branchName(newBranchId),
        error: `This reassigns the voucher's Agent from ${branchName(oldBranchId)} to ${branchName(newBranchId)} — a cross-branch administrative override. Confirm to proceed.`,
      }
    }

    const oldAgentId = coupon.agent_id
    const oldAgentCode = coupon.agent_code
    const oldAgentName = coupon.agent_name

    db.prepare(`
      UPDATE coupons SET agent_id = ?, agent_code = ?, agent_name = ?, updated_at = datetime('now') WHERE id = ?
    `).run(newAgent.id, newAgent.code, newAgent.name, couponId)

    audit(db, 'VOUCHER_AGENT_CHANGED', couponId, {
      code: coupon.code, reason: reasonText, crossBranchOverride: isCrossBranch,
      oldAgentId, oldAgentCode, oldAgentName, oldBranchId,
      newAgentId: newAgent.id, newAgentCode: newAgent.code, newAgentName: newAgent.name, newBranchId,
    })
    enqueueCoupon(db, couponId)
    return { success: true }
  })
}
