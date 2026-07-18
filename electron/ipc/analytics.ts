import type { IpcMain } from 'electron'
import { getDb } from '../database'
import Store from 'electron-store'
import { safeHandle } from './ipcHandler'

const store = new Store()

function isSuperAdmin(user: Record<string, unknown>): boolean {
  const perms = ((user?.role as Record<string, unknown>)?.permissions as Record<string, unknown>)
    || user?.permissions as Record<string, unknown> || {}
  return Boolean(perms.all)
}

export function registerAnalyticsHandlers(ipcMain: IpcMain) {
  safeHandle(ipcMain, 'analytics:salesSummary', (_e, filters: Record<string, unknown> = {}) => {
      const db = getDb()
      const user = store.get('auth_user') as Record<string, unknown>
      const superAdmin = isSuperAdmin(user)
      const dateFrom = filters.date_from || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)
      const dateTo = filters.date_to || new Date().toISOString().slice(0, 10)
      const branchFilter = filters.branch_id as string | undefined
        || (!superAdmin ? user?.branch_id as string : undefined)

      const rows = branchFilter
        ? db.prepare(`
            SELECT date(created_at) as date,
                   COUNT(*) as total_invoices,
                   ROUND(SUM(total_amount), 2) as total_revenue,
                   ROUND(SUM(discount_amount), 2) as total_discount,
                   ROUND(SUM(tax_amount), 2) as total_tax
            FROM invoices
            WHERE branch_id = ? AND status = 'completed'
              AND date(created_at) BETWEEN ? AND ?
            GROUP BY date(created_at)
            ORDER BY date DESC
          `).all(branchFilter, dateFrom, dateTo)
        : db.prepare(`
            SELECT date(created_at) as date,
                   COUNT(*) as total_invoices,
                   ROUND(SUM(total_amount), 2) as total_revenue,
                   ROUND(SUM(discount_amount), 2) as total_discount,
                   ROUND(SUM(tax_amount), 2) as total_tax
            FROM invoices
            WHERE status = 'completed'
              AND date(created_at) BETWEEN ? AND ?
            GROUP BY date(created_at)
            ORDER BY date DESC
          `).all(dateFrom, dateTo)

      return { success: true, data: rows }
  })

  safeHandle(ipcMain, 'analytics:revenue', (_e, filters: Record<string, unknown> = {}) => {
      const db = getDb()
      const user = store.get('auth_user') as Record<string, unknown>
      const superAdmin = isSuperAdmin(user)
      const branchFilter = filters.branch_id as string | undefined
        || (!superAdmin ? user?.branch_id as string : undefined)

      const branchWhere = branchFilter ? 'WHERE branch_id = ? AND' : 'WHERE'
      const args = (extra: unknown[]) => branchFilter ? [branchFilter, ...extra] : extra

      const today = db.prepare(`
        SELECT ROUND(SUM(total_amount),2) as revenue, COUNT(*) as invoices
        FROM invoices ${branchWhere} status='completed' AND date(created_at) = date('now')
      `).get(...args([]))

      const month = db.prepare(`
        SELECT ROUND(SUM(total_amount),2) as revenue, COUNT(*) as invoices
        FROM invoices ${branchWhere} status='completed'
        AND strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')
      `).get(...args([]))

      const outstanding = branchFilter
        ? db.prepare(`SELECT ROUND(SUM(outstanding_due),2) as total FROM customers WHERE branch_id = ?`).get(branchFilter)
        : db.prepare(`SELECT ROUND(SUM(outstanding_due),2) as total FROM customers`).get()

      return { success: true, data: { today, month, outstanding } }
  })

  // Net profit (sell price − buy price, i.e. sales − COGS) and installment
  // totals for the selected date range, so Analytics can show profit rather
  // than just raw sales revenue.
  safeHandle(ipcMain, 'analytics:profitSummary', (_e, filters: Record<string, unknown> = {}) => {
      const db = getDb()
      const user = store.get('auth_user') as Record<string, unknown>
      const superAdmin = isSuperAdmin(user)
      const dateFrom = (filters.date_from as string) || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)
      const dateTo = (filters.date_to as string) || new Date().toISOString().slice(0, 10)
      const branchFilter = filters.branch_id as string | undefined
        || (!superAdmin ? user?.branch_id as string : undefined)

      const invoiceWhere = branchFilter
        ? `WHERE i.branch_id = ? AND i.status = 'completed' AND date(i.created_at) BETWEEN ? AND ?`
        : `WHERE i.status = 'completed' AND date(i.created_at) BETWEEN ? AND ?`
      const invoiceArgs = branchFilter ? [branchFilter, dateFrom, dateTo] : [dateFrom, dateTo]

      const sales = db.prepare(`
        SELECT COALESCE(SUM(i.total_amount), 0) as sales_total, COUNT(*) as invoice_count
        FROM invoices i
        ${invoiceWhere}
      `).get(...invoiceArgs) as { sales_total: number; invoice_count: number }

      const cogsRow = db.prepare(`
        SELECT COALESCE(SUM(ii.quantity * COALESCE(p.cost_price, 0)), 0) as cogs
        FROM invoice_items ii
        JOIN invoices i ON i.id = ii.invoice_id
        LEFT JOIN products p ON p.id = ii.product_id
        ${invoiceWhere}
      `).get(...invoiceArgs) as { cogs: number }

      const netProfit = Number(sales.sales_total || 0) - Number(cogsRow.cogs || 0)

      const installmentWhere = branchFilter
        ? `WHERE ins.branch_id = ? AND date(ins.created_at) BETWEEN ? AND ?`
        : `WHERE date(ins.created_at) BETWEEN ? AND ?`
      const installmentArgs = branchFilter ? [branchFilter, dateFrom, dateTo] : [dateFrom, dateTo]

      const installmentGiven = db.prepare(`
        SELECT COALESCE(SUM(ins.total_amount), 0) as given_total, COUNT(*) as contract_count
        FROM installments ins
        ${installmentWhere}
      `).get(...installmentArgs) as { given_total: number; contract_count: number }

      const pendingWhere = branchFilter ? 'WHERE ins.branch_id = ? AND' : 'WHERE'
      const pendingArgs = branchFilter ? [branchFilter] : []
      const installmentPending = db.prepare(`
        SELECT COALESCE(SUM(ins.due_amount), 0) as pending_total
        FROM installments ins
        ${pendingWhere} ins.status IN ('active','overdue')
      `).get(...pendingArgs) as { pending_total: number }

      return {
        success: true,
        data: {
          sales_total: sales.sales_total,
          invoice_count: sales.invoice_count,
          cogs: cogsRow.cogs,
          net_profit: netProfit,
          installment_given: installmentGiven.given_total,
          installment_contracts: installmentGiven.contract_count,
          installment_pending: installmentPending.pending_total,
        },
      }
  })

  safeHandle(ipcMain, 'analytics:topProducts', (_e, filters: Record<string, unknown> = {}) => {
      const db = getDb()
      const user = store.get('auth_user') as Record<string, unknown>
      const superAdmin = isSuperAdmin(user)
      const branchFilter = filters.branch_id as string | undefined
        || (!superAdmin ? user?.branch_id as string : undefined)
      const limit = (filters.limit || 10) as number

      const rows = branchFilter
        ? db.prepare(`
            SELECT ii.product_id, p.name, p.sku,
                   SUM(ii.quantity) as total_qty,
                   ROUND(SUM(ii.line_total), 2) as total_revenue
            FROM invoice_items ii
            JOIN invoices i ON i.id = ii.invoice_id
            JOIN products p ON p.id = ii.product_id
            WHERE i.branch_id = ? AND i.status = 'completed'
            GROUP BY ii.product_id
            ORDER BY total_revenue DESC LIMIT ?
          `).all(branchFilter, limit)
        : db.prepare(`
            SELECT ii.product_id, p.name, p.sku,
                   SUM(ii.quantity) as total_qty,
                   ROUND(SUM(ii.line_total), 2) as total_revenue
            FROM invoice_items ii
            JOIN invoices i ON i.id = ii.invoice_id
            JOIN products p ON p.id = ii.product_id
            WHERE i.status = 'completed'
            GROUP BY ii.product_id
            ORDER BY total_revenue DESC LIMIT ?
          `).all(limit)

      return { success: true, data: rows }
  })

  safeHandle(ipcMain, 'analytics:branchPerformance', (_e, filters: Record<string, unknown> = {}) => {
      const db = getDb()
      const user = store.get('auth_user') as Record<string, unknown>
      const superAdmin = isSuperAdmin(user)
      const branchFilter = filters.branch_id as string | undefined
        || (!superAdmin ? user?.branch_id as string : undefined)

      const rows = branchFilter
        ? db.prepare(`
            SELECT b.id as branch_id, b.name as branch_name,
                   COUNT(i.id) as total_invoices,
                   ROUND(SUM(i.total_amount), 2) as total_revenue,
                   ROUND(AVG(i.total_amount), 2) as avg_invoice_value
            FROM branches b
            LEFT JOIN invoices i ON i.branch_id = b.id AND i.status = 'completed'
            WHERE b.id = ?
            GROUP BY b.id
            ORDER BY total_revenue DESC
          `).all(branchFilter)
        : db.prepare(`
            SELECT b.id as branch_id, b.name as branch_name,
                   COUNT(i.id) as total_invoices,
                   ROUND(SUM(i.total_amount), 2) as total_revenue,
                   ROUND(AVG(i.total_amount), 2) as avg_invoice_value
            FROM branches b
            LEFT JOIN invoices i ON i.branch_id = b.id AND i.status = 'completed'
            GROUP BY b.id
            ORDER BY total_revenue DESC
          `).all()
      return { success: true, data: rows }
  })

  safeHandle(ipcMain, 'analytics:dailyReport', (_e, date: string) => {
      const db = getDb()
      const user = store.get('auth_user') as Record<string, unknown>
      const branchId = user?.branch_id || 'b1111111-1111-4111-8111-111111111111'

      const summary = db.prepare(`
        SELECT COUNT(*) as invoices, ROUND(SUM(total_amount),2) as revenue,
               ROUND(SUM(discount_amount),2) as discounts, ROUND(SUM(tax_amount),2) as taxes
        FROM invoices WHERE branch_id = ? AND status='completed' AND date(created_at) = ?
      `).get(branchId, date)

      const byMethod = db.prepare(`
        SELECT p.method, ROUND(SUM(p.amount),2) as total, COUNT(*) as count
        FROM payments p
        JOIN invoices i ON i.id = p.invoice_id
        WHERE i.branch_id = ? AND i.status='completed' AND date(i.created_at) = ?
        GROUP BY p.method
      `).all(branchId, date)

      return { success: true, data: { summary, byMethod } }
  })
}
