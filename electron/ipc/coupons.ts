import { ipcMain } from 'electron'
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

// ─── IPC handlers ────────────────────────────────────────────────────────────

export function registerCouponHandlers() {

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
      conditions.push(`(cp.code LIKE ? OR cp.name LIKE ? OR cu.name LIKE ? OR cu.phone LIKE ?)`)
      params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`)
    }
    if (filters.status)      { conditions.push(`cp.status = ?`); params.push(filters.status) }
    if (filters.customerId)  { conditions.push(`cp.customer_id = ?`); params.push(filters.customerId) }
    if (filters.dateFrom)    { conditions.push(`date(cp.created_at) >= date(?)`); params.push(filters.dateFrom) }
    if (filters.dateTo)      { conditions.push(`date(cp.created_at) <= date(?)`); params.push(filters.dateTo) }

    const rows = db.prepare(`
      SELECT cp.*, cu.name as customer_name, cu.phone as customer_phone,
             b.name as branch_name, u.name as issued_by_name,
             (SELECT COUNT(*) FROM coupon_redemptions cr WHERE cr.coupon_id = cp.id AND cr.type = 'redeem') as redemption_count
      FROM coupons cp
      LEFT JOIN customers cu ON cu.id = cp.customer_id
      LEFT JOIN branches b ON b.id = cp.branch_id
      LEFT JOIN users u ON u.id = cp.issued_by
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
             b.name as branch_name, u.name as issued_by_name
      FROM coupons cp
      LEFT JOIN customers cu ON cu.id = cp.customer_id
      LEFT JOIN branches b ON b.id = cp.branch_id
      LEFT JOIN users u ON u.id = cp.issued_by
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
      SELECT cp.*, cu.name as customer_name, cu.phone as customer_phone
      FROM coupons cp
      LEFT JOIN customers cu ON cu.id = cp.customer_id
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

    let rows: Record<string, unknown>[] = []
    let summary: Record<string, unknown> = {}

    if (type === 'redeemed') {
      if (scopeBranch) { conditions.push(`cr.branch_id = ?`); params.push(scopeBranch) }
      addDateRange('cr.created_at')
      if (search) { conditions.push(`(cp.code LIKE ? OR cp.name LIKE ? OR cu.name LIKE ? OR i.invoice_number LIKE ?)`); params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`) }
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
      rows = db.prepare(`
        SELECT cp.created_at, cp.code, cp.name, cu.name as customer_name,
               cp.initial_value, cp.balance, (cp.initial_value - cp.balance) as used_amount,
               cp.status, cp.valid_from, cp.valid_until, b.name as branch_name, u.name as issued_by_name
        FROM coupons cp
        LEFT JOIN customers cu ON cu.id = cp.customer_id
        LEFT JOIN branches b ON b.id = cp.branch_id
        LEFT JOIN users u ON u.id = cp.issued_by
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
}
