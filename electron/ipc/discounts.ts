import { ipcMain } from 'electron'
import { getDb } from '../database'
import type Database from 'better-sqlite3'
import { randomUUID } from 'crypto'
import Store from 'electron-store'
import { enqueuSync } from '../services/syncQueue'
import { logAudit } from '../services/auditLog'
import { safeHandle } from './ipcHandler'

const store = new Store()

function authUser(): Record<string, unknown> {
  return (store.get('auth_user') as Record<string, unknown> | undefined) || {}
}

function currentPerms(caller: Record<string, unknown> = authUser()): Record<string, unknown> {
  return ((caller.role as Record<string, unknown>)?.permissions as Record<string, unknown>)
    || (caller.permissions as Record<string, unknown>)
    || {}
}

function requireAdmin(): { ok: true } | { ok: false; error: string } {
  if (!currentPerms().all) return { ok: false, error: 'Company Admin access required for discount management' }
  return { ok: true }
}

function audit(db: ReturnType<typeof getDb>, action: string, recordId: string, values: Record<string, unknown>) {
  try {
    const user = authUser()
    logAudit(db, {
      userId: (user?.id as string) || null, branchId: (user?.branch_id as string) || null,
      action, tableName: 'discounts', recordId, newValues: values,
    })
  } catch { /* audit failure must not break the operation */ }
}

interface DiscountRow {
  id: string
  name: string
  type: 'percentage' | 'flat'
  value: number
  max_discount_amount: number | null
  scope: 'all' | 'product'
  product_id: string | null
  branch_id: string | null
  is_active: number
  valid_from: string | null
  valid_until: string | null
}

export interface ResolvedDiscount {
  id: string
  name: string
  pct: number
}

// How specific a matched rule is for a given product/branch — the most
// specific rule wins (product+branch > product+global > all-products+branch
// > all-products+global). No stacking of multiple rules on one item.
function specificity(row: DiscountRow, branchId: string | null): number {
  const productMatch = row.scope === 'product'
  const branchMatch = branchId != null && row.branch_id === branchId
  if (productMatch && branchMatch) return 4
  if (productMatch && row.branch_id == null) return 3
  if (!productMatch && branchMatch) return 2
  return 1
}

// Converts a rule (percentage or flat Rs) into an equivalent percentage of
// this specific product's current unit price, clamped by max_discount_amount.
function effectivePct(row: DiscountRow, unitPrice: number): number {
  if (unitPrice <= 0) return 0
  let pct = row.type === 'percentage' ? row.value : (row.value / unitPrice) * 100
  pct = Math.max(0, Math.min(100, pct))
  if (row.max_discount_amount != null) {
    const capPct = Math.max(0, (row.max_discount_amount / unitPrice) * 100)
    pct = Math.min(pct, capPct)
  }
  return pct
}

// Shared resolver — used both for POS auto-apply (client asks) and server-side
// re-validation in invoices:create, so the two can never disagree.
export function resolveApplicableDiscount(
  db: Database.Database, productId: string, unitPrice: number, branchId: string | null
): ResolvedDiscount | null {
  const rows = db.prepare(`
    SELECT * FROM discounts
    WHERE is_active = 1
      AND (branch_id = ? OR branch_id IS NULL)
      AND (scope = 'all' OR (scope = 'product' AND product_id = ?))
      AND (valid_from IS NULL OR date(valid_from) <= date('now'))
      AND (valid_until IS NULL OR date(valid_until) >= date('now'))
  `).all(branchId, productId) as DiscountRow[]
  if (!rows.length) return null

  let best: DiscountRow | null = null
  let bestSpec = -1
  let bestPct = 0
  for (const row of rows) {
    const spec = specificity(row, branchId)
    const pct = effectivePct(row, unitPrice)
    if (spec > bestSpec || (spec === bestSpec && pct > bestPct)) {
      best = row; bestSpec = spec; bestPct = pct
    }
  }
  if (!best || bestPct <= 0) return null
  return { id: best.id, name: best.name, pct: bestPct }
}

export function registerDiscountHandlers() {
  safeHandle(ipcMain, 'discounts:list', (_e, filters: { branchId?: string; productId?: string; activeOnly?: boolean; search?: string } = {}) => {
    const db = getDb()
    const wheres: string[] = ['1=1']
    const params: unknown[] = []
    if (filters.branchId)  { wheres.push('d.branch_id = ?');  params.push(filters.branchId) }
    if (filters.productId) { wheres.push('d.product_id = ?'); params.push(filters.productId) }
    if (filters.activeOnly) { wheres.push('d.is_active = 1') }
    if (filters.search) { wheres.push('d.name LIKE ?'); params.push(`%${filters.search}%`) }
    const rows = db.prepare(`
      SELECT d.*, p.name as product_name, p.sku as product_sku, b.name as branch_name
      FROM discounts d
      LEFT JOIN products p ON p.id = d.product_id
      LEFT JOIN branches b ON b.id = d.branch_id
      WHERE ${wheres.join(' AND ')}
      ORDER BY d.created_at DESC
    `).all(...params)
    return { success: true, data: rows }
  })

  // POS-facing: every active, date-valid rule visible to this branch (own +
  // global), resolved client-side per product via the same precedence logic.
  safeHandle(ipcMain, 'discounts:activeMap', (_e, branchId?: string) => {
    const db = getDb()
    const caller = authUser()
    const scopeBranch = branchId || (caller.branch_id as string) || null
    const rows = db.prepare(`
      SELECT * FROM discounts
      WHERE is_active = 1
        AND (branch_id = ? OR branch_id IS NULL)
        AND (valid_from IS NULL OR date(valid_from) <= date('now'))
        AND (valid_until IS NULL OR date(valid_until) >= date('now'))
    `).all(scopeBranch)
    return { success: true, data: rows }
  })

  safeHandle(ipcMain, 'discounts:create', async (_e, p: Record<string, unknown>) => {
    const gate = requireAdmin()
    if (!gate.ok) return { success: false, error: gate.error }
    const db = getDb()
    const id = randomUUID()
    const row = {
      id,
      name: String(p.name || '').trim(),
      type: p.type === 'flat' ? 'flat' : 'percentage',
      value: Number(p.value || 0),
      max_discount_amount: p.max_discount_amount != null && p.max_discount_amount !== '' ? Number(p.max_discount_amount) : null,
      scope: p.scope === 'product' ? 'product' : 'all',
      product_id: p.scope === 'product' ? String(p.product_id || '') || null : null,
      branch_id: p.branch_id ? String(p.branch_id) : null,
      is_active: p.is_active === false ? 0 : 1,
      valid_from: p.valid_from ? String(p.valid_from) : null,
      valid_until: p.valid_until ? String(p.valid_until) : null,
      created_by: (authUser().id as string) || null,
    }
    if (!row.name) return { success: false, error: 'Discount name is required' }
    if (row.scope === 'product' && !row.product_id) return { success: false, error: 'Select a product for a product-specific discount' }
    if (row.value <= 0) return { success: false, error: 'Discount value must be greater than 0' }

    db.prepare(`
      INSERT INTO discounts (id, name, type, value, max_discount_amount, scope, product_id, branch_id,
        is_active, valid_from, valid_until, created_by)
      VALUES (@id, @name, @type, @value, @max_discount_amount, @scope, @product_id, @branch_id,
        @is_active, @valid_from, @valid_until, @created_by)
    `).run(row)
    audit(db, 'CREATE_DISCOUNT', id, row)
    await enqueuSync('discounts', id, 'INSERT', row)
    return { success: true, data: { id } }
  })

  safeHandle(ipcMain, 'discounts:update', async (_e, id: string, p: Record<string, unknown>) => {
    const gate = requireAdmin()
    if (!gate.ok) return { success: false, error: gate.error }
    const db = getDb()
    const existing = db.prepare('SELECT * FROM discounts WHERE id=?').get(id) as DiscountRow | undefined
    if (!existing) return { success: false, error: 'Discount not found' }

    const row = {
      id,
      name: String(p.name ?? existing.name).trim(),
      type: p.type === 'flat' || p.type === 'percentage' ? p.type : existing.type,
      value: p.value != null ? Number(p.value) : existing.value,
      max_discount_amount: p.max_discount_amount != null && p.max_discount_amount !== '' ? Number(p.max_discount_amount) : null,
      scope: p.scope === 'product' || p.scope === 'all' ? p.scope : existing.scope,
      product_id: (p.scope ?? existing.scope) === 'product' ? String(p.product_id ?? existing.product_id ?? '') || null : null,
      branch_id: p.branch_id !== undefined ? (p.branch_id ? String(p.branch_id) : null) : existing.branch_id,
      is_active: p.is_active !== undefined ? (p.is_active ? 1 : 0) : existing.is_active,
      valid_from: p.valid_from !== undefined ? (p.valid_from ? String(p.valid_from) : null) : existing.valid_from,
      valid_until: p.valid_until !== undefined ? (p.valid_until ? String(p.valid_until) : null) : existing.valid_until,
    }
    if (!row.name) return { success: false, error: 'Discount name is required' }
    if (row.scope === 'product' && !row.product_id) return { success: false, error: 'Select a product for a product-specific discount' }

    db.prepare(`
      UPDATE discounts SET name=@name, type=@type, value=@value, max_discount_amount=@max_discount_amount,
        scope=@scope, product_id=@product_id, branch_id=@branch_id, is_active=@is_active,
        valid_from=@valid_from, valid_until=@valid_until, updated_at=datetime('now')
      WHERE id=@id
    `).run(row)
    audit(db, 'UPDATE_DISCOUNT', id, row)
    await enqueuSync('discounts', id, 'UPDATE', row)
    return { success: true }
  })

  safeHandle(ipcMain, 'discounts:toggleActive', async (_e, id: string, active: boolean) => {
    const gate = requireAdmin()
    if (!gate.ok) return { success: false, error: gate.error }
    const db = getDb()
    db.prepare(`UPDATE discounts SET is_active=?, updated_at=datetime('now') WHERE id=?`).run(active ? 1 : 0, id)
    audit(db, active ? 'ACTIVATE_DISCOUNT' : 'DEACTIVATE_DISCOUNT', id, { is_active: active })
    await enqueuSync('discounts', id, 'UPDATE', { id, is_active: active })
    return { success: true }
  })

  safeHandle(ipcMain, 'discounts:delete', async (_e, id: string) => {
    const gate = requireAdmin()
    if (!gate.ok) return { success: false, error: gate.error }
    const db = getDb()
    db.prepare('DELETE FROM discounts WHERE id=?').run(id)
    audit(db, 'DELETE_DISCOUNT', id, {})
    await enqueuSync('discounts', id, 'DELETE', { id })
    return { success: true }
  })
}
