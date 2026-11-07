import { usesSupermarketStock } from '../services/supermarketModule'
import type { IpcMain } from 'electron'
import { ensureLegacyOpeningLayer } from '../services/batchInventory'
import { getDb } from '../database'
import { createCompanyStore } from '../services/companyWorkspace'
import { safeHandle } from './ipcHandler'

const store = createCompanyStore()

function isSuperAdmin(user: Record<string, unknown>): boolean {
  const perms = ((user?.role as Record<string, unknown>)?.permissions as Record<string, unknown>)
    || user?.permissions as Record<string, unknown> || {}
  return Boolean(perms.all)
}

export function registerAnalyticsHandlers(ipcMain: IpcMain) {
  safeHandle(ipcMain, 'analytics:supermarketOverview', () => {
    if (!usesSupermarketStock(store.get('app_settings') as Record<string, unknown>)) throw new Error('Supermarket module required')
    const user = store.get('auth_user') as Record<string, unknown>
    const perms = ((user?.role as Record<string, unknown>)?.permissions || user?.permissions || {}) as Record<string, unknown>
    if (!perms.all && !perms.reports) throw new Error('Reports access required')
    const db = getDb()
    const branch = !isSuperAdmin(user) ? String(user?.branch_id || '') : null
    const args = branch === null ? [] : [branch]
    db.transaction(() => {
      const stocks = db.prepare(`SELECT product_id,branch_id FROM stocks WHERE warehouse_id IS NULL ${branch === null ? '' : 'AND branch_id=?'}`).all(...args) as { product_id: string; branch_id: string }[]
      for (const stock of stocks) ensureLegacyOpeningLayer(db, stock.product_id, stock.branch_id)
    })()
    const inventory = db.prepare(`SELECT
      COALESCE(SUM(CASE WHEN b.historical_cost_known=1 THEN b.quantity*b.cost_price ELSE 0 END),0) stock_cost,
      COALESCE(SUM(b.quantity*COALESCE(b.selling_price,p.selling_price)),0) expected_sales,
      COALESCE(SUM(CASE WHEN b.historical_cost_known=1 THEN b.quantity*(COALESCE(b.selling_price,p.selling_price)-b.cost_price) ELSE 0 END),0) expected_profit,
      COALESCE(SUM(CASE WHEN b.historical_cost_known=0 THEN b.quantity ELSE 0 END),0) unknown_stock_qty
      FROM product_batches b JOIN products p ON p.id=b.product_id
      WHERE b.quantity>0 ${branch === null ? '' : 'AND b.branch_id=?'}`).get(...args) as Record<string, number>
    const earned = db.prepare(`SELECT COALESCE(SUM(CASE WHEN a.cost_known=1 THEN
      (a.quantity-a.returned_quantity)*(a.unit_selling_price-a.unit_cost) ELSE 0 END),0) actual_profit,
      COALESCE(SUM(CASE WHEN a.cost_known=0 THEN a.quantity-a.returned_quantity ELSE 0 END),0) unknown_sold_qty
      FROM sale_batch_allocations a JOIN invoices i ON i.id=a.invoice_id
      WHERE i.status='completed' ${branch === null ? '' : 'AND a.branch_id=?'}`).get(...args) as Record<string, number>
    const legacySales = db.prepare(`SELECT COALESCE(SUM(ii.quantity),0) quantity FROM invoice_items ii
      JOIN invoices i ON i.id=ii.invoice_id WHERE i.status='completed'
      AND NOT EXISTS (SELECT 1 FROM sale_batch_allocations a WHERE a.invoice_item_id=ii.id)
      ${branch === null ? '' : 'AND i.branch_id=?'}`).get(...args) as { quantity: number }
    earned.unknown_sold_qty += Number(legacySales.quantity || 0)
    const capital = db.prepare(`SELECT COALESCE(SUM(amount),0) investment FROM capital_transactions
      WHERE transaction_type='investment' ${branch === null ? '' : 'AND branch_id=?'}`).get(...args) as Record<string, number>
    return { success: true, data: { ...inventory, ...earned, ...capital } }
  })

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
                   ROUND(SUM(tax_amount), 2) as total_tax,
                   ROUND(SUM(delivery_fee), 2) as total_delivery_income
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
                   ROUND(SUM(tax_amount), 2) as total_tax,
                   ROUND(SUM(delivery_fee), 2) as total_delivery_income
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
        WITH allocation_costs AS (
          SELECT invoice_item_id,
            SUM((quantity-returned_quantity) * unit_cost) cogs,
            SUM(CASE WHEN cost_known=0 THEN quantity-returned_quantity ELSE 0 END) unknown_cost_qty
          FROM sale_batch_allocations GROUP BY invoice_item_id
        )
        SELECT COALESCE(SUM(${usesSupermarketStock(store.get('app_settings') as Record<string, unknown>) ? 'ac.cogs' : 'ii.quantity * COALESCE(p.cost_price,0)'}), 0) as cogs,
          COALESCE(SUM(ac.unknown_cost_qty), 0) as unknown_cost_qty
        FROM invoice_items ii
        JOIN invoices i ON i.id = ii.invoice_id
        LEFT JOIN allocation_costs ac ON ac.invoice_item_id = ii.id
        LEFT JOIN products p ON p.id=ii.product_id
        ${invoiceWhere}
      `).get(...invoiceArgs) as { cogs: number; unknown_cost_qty: number }

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
          unknown_cost_qty: cogsRow.unknown_cost_qty,
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
