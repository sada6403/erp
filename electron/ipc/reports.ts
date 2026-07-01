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
  search?: string
  billType?: string
  limit?: number
  offset?: number
}

export function registerReportHandlers() {

  // ── Transaction Report ────────────────────────────────────────────────────
  ipcMain.handle('reports:transactions', (_e, filters: TxFilters = {}) => {
    try {
      const db = getDb()
      const caller = store.get('auth_user') as Record<string, unknown> | undefined
      const perms = (caller?.permissions as Record<string, unknown>) || {}
      const isGlobal = Boolean(perms.all || perms.reports)
      const callerBranchId = caller?.branch_id as string | undefined

      const conditions: string[] = []
      const params: unknown[] = []

      // Branch scoping
      if (!isGlobal && callerBranchId) {
        conditions.push('i.branch_id = ?')
        params.push(callerBranchId)
      } else if (filters.branchId) {
        conditions.push('i.branch_id = ?')
        params.push(filters.branchId)
      }

      if (filters.dateFrom) { conditions.push(`date(i.created_at) >= date(?)`); params.push(filters.dateFrom) }
      if (filters.dateTo)   { conditions.push(`date(i.created_at) <= date(?)`); params.push(filters.dateTo) }
      if (filters.cashierId){ conditions.push('i.cashier_id = ?'); params.push(filters.cashierId) }
      if (filters.status)   { conditions.push('i.status = ?'); params.push(filters.status) }
      if (filters.billType) { conditions.push('COALESCE(i.bill_type,\'RETAIL\') = ?'); params.push(filters.billType) }
      if (filters.search) {
        conditions.push('(i.invoice_number LIKE ? OR c.name LIKE ? OR c.phone LIKE ?)')
        params.push(`%${filters.search}%`, `%${filters.search}%`, `%${filters.search}%`)
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

  // ── Transaction Detail (single invoice with items) ────────────────────────
  ipcMain.handle('reports:transactionDetail', (_e, invoiceId: string) => {
    try {
      const db = getDb()
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
      const conditions: string[] = []
      const params: unknown[] = []
      if (filters.dateFrom) { conditions.push(`date(i.created_at) >= date(?)`); params.push(filters.dateFrom) }
      if (filters.dateTo)   { conditions.push(`date(i.created_at) <= date(?)`); params.push(filters.dateTo) }
      if (filters.branchId) { conditions.push('i.branch_id = ?'); params.push(filters.branchId) }
      if (filters.cashierId){ conditions.push('i.cashier_id = ?'); params.push(filters.cashierId) }
      if (filters.status)   { conditions.push('i.status = ?'); params.push(filters.status) }
      if (filters.search)   { conditions.push('i.invoice_number LIKE ?'); params.push(`%${filters.search}%`) }

      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
      const rows = db.prepare(`
        SELECT i.invoice_number, i.status, COALESCE(i.bill_type,'RETAIL') as bill_type,
               i.created_at as date_time, b.name as branch, u.name as cashier,
               c.name as customer, c.phone as customer_phone,
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

      const headers = ['Bill No','Status','Type','Date & Time','Branch','Cashier','Customer','Phone','Subtotal','Discount','Tax','Total','Paid','Balance']
      const keys = ['invoice_number','status','bill_type','date_time','branch','cashier','customer','customer_phone','subtotal','discount_amount','tax_amount','total_amount','paid_amount','due_amount']
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
      return { success: true, filePath: result.filePath }
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
