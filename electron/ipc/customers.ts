import type { IpcMain } from 'electron'
import { getDb } from '../database'
import crypto from 'crypto'
import { enqueuSync } from '../services/syncQueue'
import Store from 'electron-store'

const store = new Store()

export function registerCustomerHandlers(ipcMain: IpcMain) {
  ipcMain.handle('customers:list', (_e, filters: Record<string, unknown> = {}) => {
    try {
      const db = getDb()
      let sql = 'SELECT * FROM customers WHERE 1=1'
      const params: unknown[] = []
      if (filters.branch_id) { sql += ' AND branch_id = ?'; params.push(filters.branch_id) }
      sql += ' ORDER BY name LIMIT 500'
      return { success: true, data: db.prepare(sql).all(...params) }
    } catch (err: unknown) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle('customers:search', (_e, query: string) => {
    try {
      const db = getDb()
      const q = `%${query}%`
      const rows = db.prepare(`
        SELECT * FROM customers
        WHERE name LIKE ? OR phone LIKE ? OR email LIKE ? OR nic LIKE ?
        ORDER BY name LIMIT 30
      `).all(q, q, q, q)
      return { success: true, data: rows }
    } catch (err: unknown) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle('customers:get', (_e, id: string) => {
    try {
      const db = getDb()
      return { success: true, data: db.prepare('SELECT * FROM customers WHERE id = ?').get(id) }
    } catch (err: unknown) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle('customers:create', async (_e, payload) => {
    try {
      const db = getDb()
      const authUser = store.get('auth_user') as Record<string, unknown> | undefined
      const id = crypto.randomUUID()
      const safe = {
        id,
        branch_id: payload.branch_id || authUser?.branch_id || null,
        name: payload.name || '',
        phone: payload.phone || null,
        email: payload.email || null,
        address: payload.address || null,
        nic: payload.nic || null,
        notes: payload.notes || null,
      }
      db.prepare(`
        INSERT INTO customers (id, branch_id, name, phone, email, address, nic, notes)
        VALUES (@id, @branch_id, @name, @phone, @email, @address, @nic, @notes)
      `).run(safe)
      await enqueuSync('customers', id, 'INSERT', safe)
      return { success: true, data: { id } }
    } catch (err: unknown) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle('customers:update', async (_e, id: string, payload) => {
    try {
      const db = getDb()
      const fields = Object.keys(payload).map(k => `${k} = @${k}`).join(', ')
      db.prepare(`UPDATE customers SET ${fields}, updated_at = datetime('now') WHERE id = @id`)
        .run({ ...payload, id })
      await enqueuSync('customers', id, 'UPDATE', { id, ...payload })
      return { success: true }
    } catch (err: unknown) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle('customers:history', (_e, id: string) => {
    try {
      const db = getDb()
      const invoices = db.prepare(`
        SELECT i.*, COUNT(ii.id) as item_count
        FROM invoices i
        LEFT JOIN invoice_items ii ON ii.invoice_id = i.id
        WHERE i.customer_id = ? AND i.status = 'completed'
        GROUP BY i.id ORDER BY i.created_at DESC LIMIT 50
      `).all(id)
      return { success: true, data: invoices }
    } catch (err: unknown) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle('customers:installments', (_e, id: string) => {
    try {
      const db = getDb()
      const rows = db.prepare(`
        SELECT inst.*, i.invoice_number
        FROM installments inst
        LEFT JOIN invoices i ON i.id = inst.invoice_id
        WHERE inst.customer_id = ?
        ORDER BY inst.created_at DESC
      `).all(id)
      return { success: true, data: rows }
    } catch (err: unknown) { return { success: false, error: (err as Error).message } }
  })
}
