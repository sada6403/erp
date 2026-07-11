import { ipcMain, dialog, BrowserWindow } from 'electron'
import fs from 'fs'
import path from 'path'
import * as XLSX from 'xlsx'
import { getDb } from '../database'
import Store from 'electron-store'

const store = new Store()

interface TxFilters {
  dateFrom?: string
  dateTo?: string
  branchId?: string
  cashierId?: string
  paymentMethod?: string
  status?: string
  agentCode?: string
  search?: string
  billType?: string
  limit?: number
  offset?: number
}

interface ReportFilters extends TxFilters {
  groupBy?: 'daily' | 'weekly' | 'monthly' | 'yearly'
}

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

function scopedInvoiceWhere(filters: ReportFilters = {}, alias = 'i') {
  const caller = currentUser()
  const perms = currentPermissions()
  const isGlobal = Boolean(perms.all || perms.reports)
  const callerBranchId = caller?.branch_id as string | undefined
  const conditions: string[] = []
  const params: unknown[] = []

  if (!isGlobal && callerBranchId) {
    conditions.push(`${alias}.branch_id = ?`)
    params.push(callerBranchId)
  } else if (filters.branchId) {
    conditions.push(`${alias}.branch_id = ?`)
    params.push(filters.branchId)
  }

  if (filters.dateFrom) { conditions.push(`date(${alias}.created_at) >= date(?)`); params.push(filters.dateFrom) }
  if (filters.dateTo)   { conditions.push(`date(${alias}.created_at) <= date(?)`); params.push(filters.dateTo) }
  if (filters.cashierId){ conditions.push(`${alias}.cashier_id = ?`); params.push(filters.cashierId) }
  if (filters.status)   { conditions.push(`${alias}.status = ?`); params.push(filters.status) }
  if (filters.billType) { conditions.push(`COALESCE(${alias}.bill_type,'RETAIL') = ?`); params.push(filters.billType) }
  if (filters.agentCode){ conditions.push(`(${alias}.agent_code = ? OR ${alias}.agent_name LIKE ?)`); params.push(filters.agentCode, `%${filters.agentCode}%`) }
  if (filters.paymentMethod) {
    conditions.push(`EXISTS (SELECT 1 FROM payments p_filter WHERE p_filter.invoice_id = ${alias}.id AND UPPER(p_filter.method) = UPPER(?))`)
    params.push(filters.paymentMethod)
  }

  return {
    where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '',
    conditions,
    params,
  }
}

function pickScopedConditions(
  scope: ReturnType<typeof scopedInvoiceWhere>,
  predicate: (condition: string) => boolean,
  mapCondition: (condition: string) => string = condition => condition,
) {
  const conditions: string[] = []
  const params: unknown[] = []
  let paramIndex = 0

  for (const condition of scope.conditions) {
    const paramCount = condition.split('?').length - 1
    const conditionParams = scope.params.slice(paramIndex, paramIndex + paramCount)
    if (predicate(condition)) {
      conditions.push(mapCondition(condition))
      params.push(...conditionParams)
    }
    paramIndex += paramCount
  }

  return {
    where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '',
    conditions,
    params,
  }
}

function tableExists(db: ReturnType<typeof getDb>, table: string) {
  const row = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(table)
  return Boolean(row)
}

function safeAll<T = Record<string, unknown>>(db: ReturnType<typeof getDb>, sql: string, params: unknown[] = []): T[] {
  try { return db.prepare(sql).all(params) as T[] } catch { return [] }
}

function safeGet<T = Record<string, unknown>>(db: ReturnType<typeof getDb>, sql: string, params: unknown[] = [], fallback: T): T {
  try { return (db.prepare(sql).get(params) as T) || fallback } catch { return fallback }
}

function auditReport(action: string, payload: Record<string, unknown>) {
  try {
    const db = getDb()
    const user = currentUser()
    const id = `audit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    db.prepare(`
      INSERT INTO audit_logs (id, user_id, branch_id, action, table_name, new_values)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      id,
      user?.id ?? null,
      user?.branch_id ?? null,
      action,
      'reports',
      JSON.stringify(payload),
    )
  } catch { /* reports must not fail because audit insert failed */ }
}

export function registerReportHandlers() {

  // ── Transaction Report ────────────────────────────────────────────────────
  ipcMain.handle('reports:transactions', (_e, filters: TxFilters = {}) => {
    try {
      const db = getDb()
      const scope = scopedInvoiceWhere(filters)
      const conditions = [...scope.conditions]
      const params = [...scope.params]
      if (filters.search) {
        conditions.push('(i.invoice_number LIKE ? OR c.name LIKE ? OR c.phone LIKE ? OR i.agent_code LIKE ? OR i.agent_name LIKE ?)')
        params.push(`%${filters.search}%`, `%${filters.search}%`, `%${filters.search}%`, `%${filters.search}%`, `%${filters.search}%`)
      }

      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
      const limit = filters.limit ?? 500
      const offset = filters.offset ?? 0

      const rows = db.prepare(`
        SELECT
          i.id, i.invoice_number, i.status,
          COALESCE(i.bill_type,'RETAIL') as bill_type,
          i.subtotal, i.discount_amount, i.tax_amount,
          i.total_amount, i.paid_amount, i.due_amount,
          i.agent_code, i.agent_name, i.agent_commission_pct, i.agent_commission_amount,
          i.notes, i.created_at, i.updated_at,
          b.name as branch_name,
          c.name as customer_name, c.phone as customer_phone,
          u.name as cashier_name,
          GROUP_CONCAT(DISTINCT p2.method || ':' || p2.amount, '|') as payments_raw
        FROM invoices i
        LEFT JOIN branches b ON b.id = i.branch_id
        LEFT JOIN customers c ON c.id = i.customer_id
        LEFT JOIN users u ON u.id = i.cashier_id
        LEFT JOIN payments p2 ON p2.invoice_id = i.id
        ${where}
        GROUP BY i.id
        ORDER BY i.created_at DESC
        LIMIT ? OFFSET ?
      `).all([...params, limit, offset]) as Record<string, unknown>[]

      // Count total for pagination
      const total = (db.prepare(`
        SELECT COUNT(DISTINCT i.id) as cnt
        FROM invoices i
        LEFT JOIN customers c ON c.id = i.customer_id
        ${where}
      `).get([...params]) as { cnt: number }).cnt

      // Enrich with payment methods
      const data = rows.map(row => {
        const paymentsRaw = (row.payments_raw as string) || ''
        const paymentMethods: string[] = []
        let totalPaid = 0
        if (paymentsRaw) {
          paymentsRaw.split('|').forEach(p => {
            const [method, amt] = p.split(':')
            if (method) paymentMethods.push(method)
            if (amt) totalPaid += parseFloat(amt) || 0
          })
        }
        return {
          ...row,
          payment_methods: [...new Set(paymentMethods)].join(', '),
          payments_raw: undefined,
        }
      })

      return { success: true, data, total }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('reports:advancedSummary', (_e, filters: ReportFilters = {}) => {
    try {
      const db = getDb()
      const scope = scopedInvoiceWhere(filters)
      const where = scope.where
      const params = scope.params
      const groupExpr = filters.groupBy === 'yearly'
        ? "strftime('%Y', i.created_at)"
        : filters.groupBy === 'monthly'
          ? "strftime('%Y-%m', i.created_at)"
          : filters.groupBy === 'weekly'
            ? "strftime('%Y-W%W', i.created_at)"
            : "date(i.created_at)"
      const branchDateScope = pickScopedConditions(scope, c => c.includes('branch_id') || c.includes('created_at'))
      const expenseScope = pickScopedConditions(
        scope,
        c => c.includes('branch_id') || c.includes('created_at'),
        c => c.replace(/i\./g, 'e.'),
      )
      const installmentScope = pickScopedConditions(
        scope,
        c => c.includes('branch_id') || c.includes('created_at'),
        c => c.replace(/i\./g, 'ins.'),
      )

      const summary = safeGet(db, `
        SELECT
          COUNT(DISTINCT i.id) as invoice_count,
          COALESCE(SUM(i.subtotal), 0) as subtotal,
          COALESCE(SUM(i.discount_amount), 0) as discount,
          COALESCE(SUM(i.tax_amount), 0) as tax,
          COALESCE(SUM(i.total_amount), 0) as sales_total,
          COALESCE(SUM(i.paid_amount), 0) as paid_total,
          COALESCE(SUM(i.due_amount), 0) as balance_total,
          COALESCE(SUM(CASE WHEN i.status IN ('cancelled','returned') THEN i.total_amount ELSE 0 END), 0) as refund_cancel_total
        FROM invoices i
        ${where}
      `, params, {
        invoice_count: 0, subtotal: 0, discount: 0, tax: 0, sales_total: 0,
        paid_total: 0, balance_total: 0, refund_cancel_total: 0,
      })

      const cogs = safeGet(db, `
        SELECT COALESCE(SUM(ii.quantity * COALESCE(p.cost_price, 0)), 0) as cogs
        FROM invoice_items ii
        JOIN invoices i ON i.id = ii.invoice_id
        LEFT JOIN products p ON p.id = ii.product_id
        ${where}
      `, params, { cogs: 0 })

      const expenses = tableExists(db, 'expenses')
        ? safeGet(db, `
            SELECT COALESCE(SUM(amount), 0) as expense_total, COALESCE(SUM(paid_amount), 0) as expense_paid
            FROM expenses e
            ${expenseScope.where}
          `, expenseScope.params, { expense_total: 0, expense_paid: 0 })
        : { expense_total: 0, expense_paid: 0 }

      const profit = Number((summary as Record<string, number>).sales_total || 0)
        - Number((cogs as Record<string, number>).cogs || 0)
        - Number((expenses as Record<string, number>).expense_total || 0)

      const periodSales = safeAll(db, `
        SELECT ${groupExpr} as period,
          COUNT(DISTINCT i.id) as invoice_count,
          COALESCE(SUM(i.total_amount), 0) as sales_total,
          COALESCE(SUM(i.paid_amount), 0) as paid_total,
          COALESCE(SUM(i.due_amount), 0) as balance_total
        FROM invoices i
        ${where}
        GROUP BY period
        ORDER BY period DESC
        LIMIT 366
      `, params)

      const productSales = safeAll(db, `
        SELECT p.name as product_name, p.sku, SUM(ii.quantity) as quantity,
          COALESCE(SUM(ii.line_total), 0) as sales_total,
          COALESCE(SUM(ii.discount_amount), 0) as discount_total,
          COALESCE(SUM(ii.tax_amount), 0) as tax_total,
          COALESCE(SUM(ii.quantity * COALESCE(p.cost_price, 0)), 0) as cost_total,
          COALESCE(SUM(ii.line_total - (ii.quantity * COALESCE(p.cost_price, 0))), 0) as gross_profit
        FROM invoice_items ii
        JOIN invoices i ON i.id = ii.invoice_id
        LEFT JOIN products p ON p.id = ii.product_id
        ${where}
        GROUP BY ii.product_id
        ORDER BY sales_total DESC
        LIMIT 100
      `, params)

      const customerSales = safeAll(db, `
        SELECT COALESCE(c.name, 'Walk-in Customer') as customer_name, c.phone as customer_phone,
          COUNT(DISTINCT i.id) as invoice_count,
          COALESCE(SUM(i.total_amount), 0) as sales_total,
          COALESCE(SUM(i.paid_amount), 0) as paid_total,
          COALESCE(SUM(i.due_amount), 0) as balance_total,
          MAX(i.created_at) as last_purchase_at
        FROM invoices i
        LEFT JOIN customers c ON c.id = i.customer_id
        ${where}
        GROUP BY i.customer_id
        ORDER BY sales_total DESC
        LIMIT 100
      `, params)

      const cashierSales = safeAll(db, `
        SELECT u.name as cashier_name, COUNT(DISTINCT i.id) as invoice_count,
          COALESCE(SUM(i.total_amount), 0) as sales_total,
          COALESCE(SUM(i.paid_amount), 0) as paid_total,
          COALESCE(SUM(i.due_amount), 0) as balance_total
        FROM invoices i
        LEFT JOIN users u ON u.id = i.cashier_id
        ${where}
        GROUP BY i.cashier_id
        ORDER BY sales_total DESC
      `, params)

      const branchSales = safeAll(db, `
        SELECT b.name as branch_name, COUNT(DISTINCT i.id) as invoice_count,
          COALESCE(SUM(i.total_amount), 0) as sales_total,
          COALESCE(SUM(i.paid_amount), 0) as paid_total,
          COALESCE(SUM(i.due_amount), 0) as balance_total
        FROM invoices i
        LEFT JOIN branches b ON b.id = i.branch_id
        ${where}
        GROUP BY i.branch_id
        ORDER BY sales_total DESC
      `, params)

      const paymentMethods = safeAll(db, `
        SELECT LOWER(p.method) as payment_method,
          COUNT(p.id) as payment_count,
          COALESCE(SUM(p.amount), 0) as amount_total
        FROM payments p
        JOIN invoices i ON i.id = p.invoice_id
        ${where}
        GROUP BY LOWER(p.method)
        ORDER BY amount_total DESC
      `, params)

      const refundCancelled = safeAll(db, `
        SELECT i.invoice_number, i.status, i.created_at, b.name as branch_name,
          u.name as cashier_name, c.name as customer_name, i.total_amount, i.paid_amount, i.due_amount
        FROM invoices i
        LEFT JOIN branches b ON b.id = i.branch_id
        LEFT JOIN users u ON u.id = i.cashier_id
        LEFT JOIN customers c ON c.id = i.customer_id
        ${where ? `${where} AND` : 'WHERE'} i.status IN ('cancelled','returned')
        ORDER BY i.created_at DESC
        LIMIT 500
      `, params)

      const stockMovementWhere = [
        ...(filters.dateFrom ? ['date(sm.created_at) >= date(?)'] : []),
        ...(filters.dateTo ? ['date(sm.created_at) <= date(?)'] : []),
      ]
      const stockMovementParams = [
        ...(filters.dateFrom ? [filters.dateFrom] : []),
        ...(filters.dateTo ? [filters.dateTo] : []),
      ]
      const stockMovements = safeAll(db, `
        SELECT sm.movement_type, p.name as product_name, p.sku,
          SUM(sm.quantity) as quantity, COUNT(sm.id) as movement_count,
          MIN(sm.created_at) as first_movement_at, MAX(sm.created_at) as last_movement_at
        FROM stock_movements sm
        LEFT JOIN products p ON p.id = sm.product_id
        ${stockMovementWhere.length ? `WHERE ${stockMovementWhere.join(' AND ')}` : ''}
        GROUP BY sm.movement_type, sm.product_id
        ORDER BY last_movement_at DESC
        LIMIT 100
      `, stockMovementParams)

      const lowStock = safeAll(db, `
        SELECT p.name as product_name, p.sku, b.name as branch_name,
          COALESCE(s.quantity, 0) as quantity, p.min_stock_level
        FROM products p
        LEFT JOIN stocks s ON s.product_id = p.id
        LEFT JOIN branches b ON b.id = s.branch_id
        WHERE p.is_active = 1 AND COALESCE(s.quantity, 0) <= COALESCE(p.min_stock_level, 0)
        ORDER BY quantity ASC, p.name ASC
        LIMIT 100
      `)

      const expenseRows = tableExists(db, 'expenses') ? safeAll(db, `
        SELECT COALESCE(ec.name, 'Uncategorised') as category_name,
          COUNT(e.id) as expense_count,
          COALESCE(SUM(e.amount), 0) as amount_total,
          COALESCE(SUM(e.paid_amount), 0) as paid_total
        FROM expenses e
        LEFT JOIN expense_categories ec ON ec.id = e.category_id
        ${expenseScope.where}
        GROUP BY e.category_id
        ORDER BY amount_total DESC
      `, expenseScope.params) : []

      const installmentSummary = safeGet(db, `
        SELECT COUNT(i.id) as contract_count,
          COALESCE(SUM(i.total_amount), 0) as installment_sales_total,
          COALESCE(SUM(i.down_payment), 0) as down_payment_total,
          COALESCE(SUM(i.interest_amount), 0) as interest_total,
          COALESCE(SUM(i.paid_amount), 0) as paid_total,
          COALESCE(SUM(i.due_amount), 0) as balance_total,
          COALESCE(SUM(CASE WHEN i.status='overdue' OR date(i.next_due_date) < date('now') THEN 1 ELSE 0 END), 0) as overdue_count
        FROM installments i
        ${branchDateScope.where}
      `, branchDateScope.params, {
        contract_count: 0, installment_sales_total: 0, down_payment_total: 0,
        interest_total: 0, paid_total: 0, balance_total: 0, overdue_count: 0,
      })

      const installmentCustomers = safeAll(db, `
        SELECT ins.contract_number, c.name as customer_name, COALESCE(c.phone, ins.customer_phone) as customer_phone,
          inv.invoice_number, ins.total_amount, ins.down_payment, ins.interest_rate, ins.interest_amount,
          ins.monthly_amount, ins.installment_count, ins.remaining_installments,
          (ins.installment_count - ins.remaining_installments) as paid_installment_count,
          ins.paid_amount, ins.due_amount, ins.next_due_date,
          CASE WHEN ins.status='overdue' OR date(ins.next_due_date) < date('now') THEN 'overdue' ELSE ins.status END as payment_status,
          MAX(ip.paid_at) as last_payment_at,
          MAX(ip.receipt_number) as last_receipt_number
        FROM installments ins
        LEFT JOIN customers c ON c.id = ins.customer_id
        LEFT JOIN invoices inv ON inv.id = ins.invoice_id
        LEFT JOIN installment_payments ip ON ip.installment_id = ins.id AND ip.status='approved'
        ${installmentScope.where}
        GROUP BY ins.id
        ORDER BY date(ins.next_due_date) ASC
        LIMIT 500
      `, installmentScope.params)

      const paidInstallmentHistory = safeAll(db, `
        SELECT ip.receipt_number, ip.paid_at, ip.amount, ip.method, ip.reference, ip.receipt_image_url,
          ip.status, u.name as received_by_name, c.name as customer_name, c.phone as customer_phone,
          ins.contract_number, inv.invoice_number
        FROM installment_payments ip
        JOIN installments ins ON ins.id = ip.installment_id
        LEFT JOIN invoices inv ON inv.id = ins.invoice_id
        LEFT JOIN customers c ON c.id = ins.customer_id
        LEFT JOIN users u ON u.id = ip.received_by
        ${filters.dateFrom || filters.dateTo
          ? `WHERE ${[
              ...(filters.dateFrom ? ['date(ip.paid_at) >= date(?)'] : []),
              ...(filters.dateTo ? ['date(ip.paid_at) <= date(?)'] : []),
            ].join(' AND ')}`
          : ''}
        ORDER BY ip.paid_at DESC
        LIMIT 500
      `, [
        ...(filters.dateFrom ? [filters.dateFrom] : []),
        ...(filters.dateTo ? [filters.dateTo] : []),
      ])

      const transferHistory = safeAll(db, `
        SELECT
          st.transfer_number,
          st.status,
          st.quantity,
          st.initiated_at,
          st.dispatch_at,
          st.actual_delivery_at,
          st.expected_delivery_at,
          p.name as product_name,
          p.sku,
          fb.name as from_branch_name,
          tb.name as to_branch_name,
          iu.name as initiated_by_name,
          au.name as approved_by_name,
          ru.name as received_by_name
        FROM stock_transfers st
        LEFT JOIN products p ON p.id = st.product_id
        LEFT JOIN branches fb ON fb.id = st.from_branch_id
        LEFT JOIN branches tb ON tb.id = st.to_branch_id
        LEFT JOIN users iu ON iu.id = st.initiated_by
        LEFT JOIN users au ON au.id = st.approved_by
        LEFT JOIN users ru ON ru.id = st.received_by
        ${filters.dateFrom || filters.dateTo
          ? `WHERE ${[
              ...(filters.dateFrom ? ['date(st.initiated_at) >= date(?)'] : []),
              ...(filters.dateTo ? ['date(st.initiated_at) <= date(?)'] : []),
            ].join(' AND ')}`
          : ''}
        ORDER BY st.initiated_at DESC
        LIMIT 500
      `, [
        ...(filters.dateFrom ? [filters.dateFrom] : []),
        ...(filters.dateTo ? [filters.dateTo] : []),
      ])

      auditReport('REPORT_VIEW_ADVANCED', { filters, generated_at: new Date().toISOString() })
      return {
        success: true,
        data: {
          summary: { ...summary, cogs: (cogs as Record<string, number>).cogs, expenses: (expenses as Record<string, number>).expense_total, profit },
          periodSales,
          productSales,
          customerSales,
          cashierSales,
          branchSales,
          paymentMethods,
          refundCancelled,
          stockMovements,
          lowStock,
          expenses: expenseRows,
          transferHistory,
          installmentSummary,
          installmentCustomers,
          paidInstallmentHistory,
          generatedAt: new Date().toISOString(),
        },
      }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  // Agent commission summary for manager review / printing
  ipcMain.handle('reports:agentCommissions', (_e, filters: TxFilters = {}) => {
    try {
      const db = getDb()
      const scope = scopedInvoiceWhere(filters)
      const conditions = ["COALESCE(i.agent_code, '') <> ''", ...scope.conditions]
      const params: unknown[] = [...scope.params]

      const where = `WHERE ${conditions.join(' AND ')}`
      const rows = db.prepare(`
        SELECT
          i.agent_code,
          COALESCE(i.agent_name, '') as agent_name,
          COUNT(i.id) as invoice_count,
          COALESCE(SUM(i.total_amount), 0) as sales_total,
          COALESCE(AVG(i.agent_commission_pct), 0) as avg_commission_pct,
          COALESCE(SUM(i.agent_commission_amount), 0) as commission_total,
          MIN(i.created_at) as first_sale_at,
          MAX(i.created_at) as last_sale_at
        FROM invoices i
        ${where}
        GROUP BY i.agent_code, i.agent_name
        ORDER BY commission_total DESC, sales_total DESC
      `).all(params)

      const detail = db.prepare(`
        SELECT
          i.invoice_number, i.created_at, b.name as branch_name,
          c.name as customer_name, i.agent_code, i.agent_name,
          i.total_amount, i.agent_commission_pct, i.agent_commission_amount
        FROM invoices i
        LEFT JOIN branches b ON b.id = i.branch_id
        LEFT JOIN customers c ON c.id = i.customer_id
        ${where}
        ORDER BY i.created_at DESC
        LIMIT 5000
      `).all(params)

      return { success: true, data: rows, detail }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  // ── Transaction Detail (single invoice with items) ────────────────────────
  ipcMain.handle('reports:transactionDetail', (_e, invoiceId: string) => {
    try {
      const db = getDb()
      const caller = currentUser()
      const perms = currentPermissions()
      const isGlobal = Boolean(perms.all || perms.reports)
      const callerBranchId = caller?.branch_id as string | undefined
      const invoice = db.prepare(`
        SELECT i.*, b.name as branch_name, c.name as customer_name, c.phone as customer_phone,
               u.name as cashier_name
        FROM invoices i
        LEFT JOIN branches b ON b.id = i.branch_id
        LEFT JOIN customers c ON c.id = i.customer_id
        LEFT JOIN users u ON u.id = i.cashier_id
        WHERE i.id = ?
      `).get(invoiceId) as Record<string, unknown> | undefined
      if (!invoice) return { success: false, error: 'Invoice not found' }
      if (!isGlobal && callerBranchId && invoice.branch_id !== callerBranchId) {
        return { success: false, error: 'Invoice not found' }
      }

      const items = db.prepare(`
        SELECT ii.*, p.name as product_name, p.sku, p.barcode, p.unit
        FROM invoice_items ii
        LEFT JOIN products p ON p.id = ii.product_id
        WHERE ii.invoice_id = ?
        ORDER BY ii.id
      `).all(invoiceId)

      const payments = db.prepare(`
        SELECT * FROM payments WHERE invoice_id = ? ORDER BY paid_at
      `).all(invoiceId)

      return { success: true, data: { ...invoice, items, payments } }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  // ── Export Transactions to CSV ────────────────────────────────────────────
  ipcMain.handle('reports:exportTransactionsCsv', async (_e, filters: TxFilters = {}) => {
    try {
      const win = BrowserWindow.getFocusedWindow()
      const saveResult = await dialog.showSaveDialog(win!, {
        title: 'Export Transactions CSV',
        defaultPath: `transactions-${new Date().toISOString().slice(0,10)}.csv`,
        filters: [{ name: 'CSV', extensions: ['csv'] }],
      })
      if (saveResult.canceled || !saveResult.filePath) return { success: false, cancelled: true }

      const db = getDb()
      const scope = scopedInvoiceWhere(filters)
      const conditions = [...scope.conditions]
      const params = [...scope.params]
      if (filters.search) {
        conditions.push('(i.invoice_number LIKE ? OR c.name LIKE ? OR c.phone LIKE ? OR i.agent_code LIKE ? OR i.agent_name LIKE ?)')
        params.push(`%${filters.search}%`, `%${filters.search}%`, `%${filters.search}%`, `%${filters.search}%`, `%${filters.search}%`)
      }

      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
      const rows = db.prepare(`
        SELECT i.invoice_number, i.status, COALESCE(i.bill_type,'RETAIL') as bill_type,
               i.created_at as date_time, b.name as branch, u.name as cashier,
               c.name as customer, c.phone as customer_phone,
               i.agent_code, i.agent_name, i.agent_commission_pct, i.agent_commission_amount,
               i.subtotal, i.discount_amount, i.tax_amount,
               i.total_amount, i.paid_amount, i.due_amount
        FROM invoices i
        LEFT JOIN branches b ON b.id = i.branch_id
        LEFT JOIN customers c ON c.id = i.customer_id
        LEFT JOIN users u ON u.id = i.cashier_id
        ${where}
        ORDER BY i.created_at DESC
        LIMIT 50000
      `).all(params) as Record<string, unknown>[]

      const headers = ['Bill No','Status','Type','Date & Time','Branch','Cashier','Customer','Phone','Agent Code','Agent Name','Commission %','Commission Amount','Subtotal','Discount','Tax','Total','Paid','Balance']
      const keys = ['invoice_number','status','bill_type','date_time','branch','cashier','customer','customer_phone','agent_code','agent_name','agent_commission_pct','agent_commission_amount','subtotal','discount_amount','tax_amount','total_amount','paid_amount','due_amount']
      const csv = [
        headers.join(','),
        ...rows.map(r => keys.map(k => {
          const v = r[k] ?? ''
          return typeof v === 'string' && (v.includes(',') || v.includes('"'))
            ? `"${String(v).replace(/"/g, '""')}"` : String(v)
        }).join(','))
      ].join('\r\n')

      fs.writeFileSync(saveResult.filePath, csv, 'utf8')
      return { success: true, filePath: saveResult.filePath, exported: rows.length }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })


  // Export data to Excel (.xlsx) with native save dialog
  ipcMain.handle('reports:exportExcel', async (_e, payload: {
    filename: string
    sheets: Array<{ name: string; rows: Record<string, unknown>[] }>
  }) => {
    try {
      const win = BrowserWindow.getFocusedWindow()
      const result = await dialog.showSaveDialog(win!, {
        title: 'Save Excel Report',
        defaultPath: payload.filename.endsWith('.xlsx') ? payload.filename : `${payload.filename}.xlsx`,
        filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }],
      })
      if (result.canceled || !result.filePath) return { success: false, cancelled: true }

      const wb = XLSX.utils.book_new()
      for (const sheet of payload.sheets) {
        const ws = XLSX.utils.json_to_sheet(sheet.rows)
        XLSX.utils.book_append_sheet(wb, ws, sheet.name.slice(0, 31))
      }
      XLSX.writeFile(wb, result.filePath)
      auditReport('REPORT_EXPORT_EXCEL', { filename: payload.filename, sheets: payload.sheets.map(s => ({ name: s.name, rows: s.rows.length })) })
      return { success: true, filePath: result.filePath }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('reports:exportCsvRows', async (_e, payload: {
    filename: string
    rows: Record<string, unknown>[]
    metadata?: Record<string, unknown>
  }) => {
    try {
      const win = BrowserWindow.getFocusedWindow()
      const result = await dialog.showSaveDialog(win!, {
        title: 'Save CSV Report',
        defaultPath: payload.filename.endsWith('.csv') ? payload.filename : `${payload.filename}.csv`,
        filters: [{ name: 'CSV', extensions: ['csv'] }],
      })
      if (result.canceled || !result.filePath) return { success: false, cancelled: true }

      const rows = payload.rows || []
      const headers = rows.length ? Object.keys(rows[0]) : ['Report']
      const quote = (value: unknown) => {
        const text = value == null ? '' : String(value)
        return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
      }
      const metaRows = payload.metadata
        ? Object.entries(payload.metadata).map(([k, v]) => `${quote(k)},${quote(v)}`)
        : []
      const csv = [
        ...metaRows,
        ...(metaRows.length ? [''] : []),
        headers.map(quote).join(','),
        ...rows.map(row => headers.map(h => quote(row[h])).join(',')),
      ].join('\r\n')

      fs.writeFileSync(result.filePath, csv, 'utf8')
      auditReport('REPORT_EXPORT_CSV', { filename: payload.filename, rows: rows.length, metadata: payload.metadata })
      return { success: true, filePath: result.filePath, exported: rows.length }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  // Export current view to PDF using Electron printToPDF
  ipcMain.handle('reports:exportPdf', async (_e, payload: { filename: string }) => {
    try {
      const win = BrowserWindow.getFocusedWindow()
      if (!win) return { success: false, error: 'No window' }

      const saveResult = await dialog.showSaveDialog(win, {
        title: 'Save PDF Report',
        defaultPath: payload.filename.endsWith('.pdf') ? payload.filename : `${payload.filename}.pdf`,
        filters: [{ name: 'PDF Document', extensions: ['pdf'] }],
      })
      if (saveResult.canceled || !saveResult.filePath) return { success: false, cancelled: true }

      const pdfBuffer = await win.webContents.printToPDF({
        printBackground: true,
        pageSize: 'A4',
        landscape: true,
        margins: { top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 },
      })
      fs.writeFileSync(saveResult.filePath, pdfBuffer)
      return { success: true, filePath: saveResult.filePath }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  // Open file in system viewer after export
  ipcMain.handle('reports:openFile', async (_e, filePath: string) => {
    try {
      const { shell } = await import('electron')
      await shell.openPath(filePath)
      return { success: true }
    } catch { return { success: false } }
  })
}
