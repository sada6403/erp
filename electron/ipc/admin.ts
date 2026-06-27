import type { IpcMain } from 'electron'
import { getDb } from '../database'
import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import { enqueuSync } from '../services/syncQueue'

export function registerAdminHandlers(ipcMain: IpcMain) {
  // Branches
  ipcMain.handle('admin:branches:list', () => {
    try { return { success: true, data: getDb().prepare('SELECT * FROM branches ORDER BY name').all() } }
    catch (err: unknown) { return { success: false, error: (err as Error).message } }
  })
  ipcMain.handle('admin:branches:findByCode', (_e, code: string) => {
    try {
      const row = getDb().prepare('SELECT * FROM branches WHERE UPPER(code) = UPPER(?) AND is_active = 1').get(code.trim())
      return { success: true, data: row || null }
    } catch (err: unknown) { return { success: false, error: (err as Error).message } }
  })
  ipcMain.handle('admin:branches:create', async (_e, p) => {
    try {
      const id = crypto.randomUUID()
      getDb().prepare(`INSERT INTO branches (id,name,address,phone,email,code) VALUES (?,?,?,?,?,?)`)
        .run(id, p.name, p.address||null, p.phone||null, p.email||null, p.code||null)
      await enqueuSync('branches', id, 'INSERT', { id, ...p })
      return { success: true, data: { id } }
    } catch (err: unknown) { return { success: false, error: (err as Error).message } }
  })
  ipcMain.handle('admin:branches:update', async (_e, id: string, p) => {
    try {
      const fields = Object.keys(p).map(k=>`${k}=@${k}`).join(',')
      getDb().prepare(`UPDATE branches SET ${fields}, updated_at=datetime('now') WHERE id=@id`).run({...p,id})
      await enqueuSync('branches', id, 'UPDATE', { id, ...p })
      return { success: true }
    } catch (err: unknown) { return { success: false, error: (err as Error).message } }
  })

  // Users
  ipcMain.handle('admin:users:list', () => {
    try {
      const rows = getDb().prepare(`
        SELECT u.id, u.name, u.email, u.pin, u.is_active, u.last_login_at,
               u.role_id, u.branch_id,
               r.name as role_name, b.name as branch_name
        FROM users u
        LEFT JOIN roles r ON r.id = u.role_id
        LEFT JOIN branches b ON b.id = u.branch_id
        ORDER BY u.name
      `).all()
      return { success: true, data: rows }
    } catch (err: unknown) { return { success: false, error: (err as Error).message } }
  })
  ipcMain.handle('admin:users:create', async (_e, p) => {
    try {
      const id = crypto.randomUUID()
      const hash = await bcrypt.hash(p.password, 10)
      getDb().prepare(`INSERT INTO users (id,branch_id,role_id,name,email,password_hash,pin)
        VALUES (?,?,?,?,?,?,?)`)
        .run(id, p.branch_id||null, p.role_id, p.name, p.email, hash, p.pin||null)
      await enqueuSync('users', id, 'INSERT', { id, ...p, password_hash: hash })
      return { success: true, data: { id } }
    } catch (err: unknown) { return { success: false, error: (err as Error).message } }
  })
  ipcMain.handle('admin:users:update', async (_e, id: string, p) => {
    try {
      const db = getDb()
      if (p.password) {
        p.password_hash = await bcrypt.hash(p.password, 10)
        delete p.password
      }
      // Never clear branch_id or role_id with blank string — keep existing value
      if (p.branch_id === '') p.branch_id = null
      if (!p.role_id) delete p.role_id
      // Never overwrite PIN with blank
      if (p.pin === '') delete p.pin
      const fields = Object.keys(p).filter(k => k !== 'is_active' || p[k] !== undefined)
        .map(k=>`${k}=@${k}`).join(',')
      db.prepare(`UPDATE users SET ${fields}, updated_at=datetime('now') WHERE id=@id`).run({...p,id})
      await enqueuSync('users', id, 'UPDATE', { id, ...p })
      return { success: true }
    } catch (err: unknown) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle('admin:users:delete', (_e, id: string) => {
    try {
      const SUPER_ADMIN_ID = 'u9999999-9999-4999-8999-999999999999'
      if (id === SUPER_ADMIN_ID) return { success: false, error: 'Cannot delete super admin account' }
      const db = getDb()
      const user = db.prepare('SELECT id, name FROM users WHERE id=?').get(id) as { id: string; name: string } | undefined
      if (!user) return { success: false, error: 'User not found' }
      db.prepare('DELETE FROM users WHERE id=?').run(id)
      return { success: true }
    } catch (err: unknown) { return { success: false, error: (err as Error).message } }
  })

  // Roles
  ipcMain.handle('admin:roles:list', () => {
    try { return { success: true, data: getDb().prepare('SELECT * FROM roles ORDER BY name').all() } }
    catch (err: unknown) { return { success: false, error: (err as Error).message } }
  })
  ipcMain.handle('admin:roles:create', async (_e, p: Record<string, unknown>) => {
    try {
      const id = crypto.randomUUID()
      const permissions = typeof p.permissions === 'string' ? p.permissions : JSON.stringify(p.permissions || {})
      getDb().prepare(`INSERT INTO roles (id,name,permissions) VALUES (?,?,?)`)
        .run(id, p.name, permissions)
      await enqueuSync('roles', id, 'INSERT', { id, name: p.name, permissions })
      return { success: true, data: { id } }
    } catch (err: unknown) { return { success: false, error: (err as Error).message } }
  })
  ipcMain.handle('admin:roles:update', async (_e, id: string, p: Record<string, unknown>) => {
    try {
      const permissions = typeof p.permissions === 'string' ? p.permissions : JSON.stringify(p.permissions || {})
      getDb().prepare(`UPDATE roles SET name=?, permissions=?, updated_at=datetime('now') WHERE id=?`)
        .run(p.name, permissions, id)
      await enqueuSync('roles', id, 'UPDATE', { id, name: p.name, permissions })
      return { success: true }
    } catch (err: unknown) { return { success: false, error: (err as Error).message } }
  })
  ipcMain.handle('admin:roles:delete', async (_e, id: string) => {
    try {
      const db = getDb()
      const role = db.prepare('SELECT name FROM roles WHERE id=?').get(id) as { name: string } | undefined
      if (!role) return { success: false, error: 'Role not found' }
      if (role.name === 'Super Admin') return { success: false, error: 'Cannot delete Super Admin role' }
      const used = db.prepare('SELECT COUNT(*) as count FROM users WHERE role_id=?').get(id) as { count: number }
      if (used.count > 0) return { success: false, error: 'Cannot delete role assigned to users' }
      db.prepare('DELETE FROM roles WHERE id=?').run(id)
      await enqueuSync('roles', id, 'DELETE', { id })
      return { success: true }
    } catch (err: unknown) { return { success: false, error: (err as Error).message } }
  })

  // Suppliers
  ipcMain.handle('admin:suppliers:list', () => {
    try { return { success: true, data: getDb().prepare('SELECT * FROM suppliers ORDER BY name').all() } }
    catch (err: unknown) { return { success: false, error: (err as Error).message } }
  })
  ipcMain.handle('admin:suppliers:create', async (_e, p) => {
    try {
      const id = crypto.randomUUID()
      getDb().prepare(`INSERT INTO suppliers (id,name,contact,phone,email,address,tax_number)
        VALUES (@id,@name,@contact,@phone,@email,@address,@tax_number)`)
        .run({ id, name:p.name, contact:p.contact||null, phone:p.phone||null,
               email:p.email||null, address:p.address||null, tax_number:p.tax_number||null })
      await enqueuSync('suppliers', id, 'INSERT', { id, ...p })
      return { success: true, data: { id } }
    } catch (err: unknown) { return { success: false, error: (err as Error).message } }
  })
  ipcMain.handle('admin:suppliers:update', async (_e, id: string, p) => {
    try {
      const fields = Object.keys(p).map(k=>`${k}=@${k}`).join(',')
      getDb().prepare(`UPDATE suppliers SET ${fields}, updated_at=datetime('now') WHERE id=@id`).run({...p,id})
      await enqueuSync('suppliers', id, 'UPDATE', { id, ...p })
      return { success: true }
    } catch (err: unknown) { return { success: false, error: (err as Error).message } }
  })

  // Categories
  ipcMain.handle('admin:categories:list', () => {
    try { return { success: true, data: getDb().prepare('SELECT * FROM categories ORDER BY sort_order, name').all() } }
    catch (err: unknown) { return { success: false, error: (err as Error).message } }
  })
  ipcMain.handle('admin:categories:create', async (_e, p) => {
    try {
      const id = crypto.randomUUID()
      getDb().prepare(`INSERT INTO categories (id,parent_id,name,description,sort_order)
        VALUES (?,?,?,?,?)`)
        .run(id, p.parent_id||null, p.name, p.description||null, p.sort_order||0)
      await enqueuSync('categories', id, 'INSERT', { id, ...p })
      return { success: true, data: { id } }
    } catch (err: unknown) { return { success: false, error: (err as Error).message } }
  })
  ipcMain.handle('admin:categories:update', async (_e, id: string, p) => {
    try {
      const fields = Object.keys(p).map(k=>`${k}=@${k}`).join(',')
      getDb().prepare(`UPDATE categories SET ${fields}, updated_at=datetime('now') WHERE id=@id`).run({...p,id})
      await enqueuSync('categories', id, 'UPDATE', { id, ...p })
      return { success: true }
    } catch (err: unknown) { return { success: false, error: (err as Error).message } }
  })
  ipcMain.handle('admin:categories:delete', async (_e, id: string) => {
    try {
      getDb().prepare(`UPDATE categories SET is_active=0, updated_at=datetime('now') WHERE id=?`).run(id)
      await enqueuSync('categories', id, 'UPDATE', { id, is_active: 0 })
      return { success: true }
    } catch (err: unknown) { return { success: false, error: (err as Error).message } }
  })

  // Audit Logs
  ipcMain.handle('admin:auditLogs:list', (_e, filters: Record<string,unknown> = {}) => {
    try {
      const db = getDb()
      let sql = `SELECT al.*, u.name as user_name FROM audit_logs al
                 LEFT JOIN users u ON u.id = al.user_id WHERE 1=1`
      const params: unknown[] = []
      if (filters.branch_id) { sql += ' AND al.branch_id=?'; params.push(filters.branch_id) }
      if (filters.action) { sql += ' AND al.action LIKE ?'; params.push(`%${filters.action}%`) }
      sql += ' ORDER BY al.created_at DESC LIMIT 500'
      return { success: true, data: db.prepare(sql).all(...params) }
    } catch (err: unknown) { return { success: false, error: (err as Error).message } }
  })

  // Deliveries
  ipcMain.handle('admin:deliveries:list', (_e, filters: Record<string,unknown> = {}) => {
    try {
      const db = getDb()
      let sql = `SELECT d.*, c.name as customer_name, i.invoice_number, u.name as assigned_name
                 FROM deliveries d
                 LEFT JOIN customers c ON c.id = d.customer_id
                 LEFT JOIN invoices i ON i.id = d.invoice_id
                 LEFT JOIN users u ON u.id = d.assigned_to WHERE 1=1`
      const params: unknown[] = []
      if (filters.status) { sql += ' AND d.status=?'; params.push(filters.status) }
      if (filters.branch_id) { sql += ' AND d.branch_id=?'; params.push(filters.branch_id) }
      sql += ' ORDER BY d.created_at DESC LIMIT 200'
      return { success: true, data: db.prepare(sql).all(...params) }
    } catch (err: unknown) { return { success: false, error: (err as Error).message } }
  })
  ipcMain.handle('admin:deliveries:update', async (_e, id: string, p) => {
    try {
      const fields = Object.keys(p).map(k=>`${k}=@${k}`).join(',')
      getDb().prepare(`UPDATE deliveries SET ${fields}, updated_at=datetime('now') WHERE id=@id`).run({...p,id})
      await enqueuSync('deliveries', id, 'UPDATE', { id, ...p })
      return { success: true }
    } catch (err: unknown) { return { success: false, error: (err as Error).message } }
  })

  // Installments
  ipcMain.handle('admin:installments:list', (_e, filters: Record<string,unknown> = {}) => {
    try {
      const db = getDb()
      let sql = `
        SELECT inst.*,
          c.name AS customer_name, c.phone AS customer_phone,
          i.invoice_number,
          COALESCE(inst.monthly_amount,
            ROUND((inst.total_amount - inst.down_payment) / NULLIF(inst.installment_count,0), 2)
          ) AS computed_monthly,
          (SELECT COUNT(*) FROM installment_payments ip WHERE ip.installment_id = inst.id) AS payments_made
        FROM installments inst
        LEFT JOIN customers c ON c.id = inst.customer_id
        LEFT JOIN invoices  i ON i.id = inst.invoice_id
        WHERE 1=1`
      const params: unknown[] = []
      if (filters.status) { sql += ' AND inst.status=?'; params.push(filters.status) }
      sql += ' ORDER BY inst.status ASC, inst.next_due_date ASC LIMIT 500'
      // Auto-mark overdue
      db.prepare(`
        UPDATE installments SET status='overdue', updated_at=datetime('now')
        WHERE status='active' AND next_due_date < date('now') AND due_amount > 0
      `).run()
      return { success: true, data: db.prepare(sql).all(...params) }
    } catch (err: unknown) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle('admin:installments:get', (_e, id: string) => {
    try {
      const db = getDb()
      const inst = db.prepare(`
        SELECT inst.*, c.name AS customer_name, c.phone AS customer_phone, c.email AS customer_email,
          i.invoice_number, i.bill_date, i.total_amount AS invoice_total
        FROM installments inst
        LEFT JOIN customers c ON c.id = inst.customer_id
        LEFT JOIN invoices  i ON i.id = inst.invoice_id
        WHERE inst.id = ?
      `).get(id) as Record<string,unknown> | undefined
      if (!inst) return { success: false, error: 'Not found' }

      const payments = db.prepare(`
        SELECT ip.*, u.name AS received_by_name
        FROM installment_payments ip
        LEFT JOIN users u ON u.id = ip.received_by
        WHERE ip.installment_id = ?
        ORDER BY ip.paid_at ASC
      `).all(id) as Record<string,unknown>[]

      // Build monthly schedule
      const monthly = Number(inst.monthly_amount) ||
        Math.round((Number(inst.total_amount) - Number(inst.down_payment)) / (Number(inst.installment_count) || 1) * 100) / 100
      const startDate = new Date(String(inst.start_date))
      const paymentsRemaining = [...payments]  // consumed greedily per slot
      const today = new Date()

      const schedule = Array.from({ length: Number(inst.installment_count) }, (_, idx) => {
        const due = new Date(startDate)
        if (inst.frequency === 'weekly') {
          due.setDate(due.getDate() + idx * 7)
        } else {
          due.setMonth(due.getMonth() + idx)
        }
        const dueStr = due.toISOString().slice(0, 10)
        // Greedily assign a payment to this slot
        const pmt = paymentsRemaining.shift()
        const status = pmt ? 'paid' : due < today ? 'overdue' : 'upcoming'
        return {
          month: idx + 1,
          due_date: dueStr,
          amount: monthly,
          status,
          paid_on:  pmt ? String(pmt.paid_at).slice(0, 10) : null,
          paid_amount: pmt ? Number(pmt.amount) : null,
          payment_id: pmt?.id ?? null,
        }
      })

      return { success: true, data: { ...inst, schedule, payments, computed_monthly: monthly } }
    } catch (err: unknown) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle('admin:installments:recordPayment', async (_e, id: string, p: Record<string,unknown>) => {
    try {
      const db = getDb()
      const paymentId = crypto.randomUUID()
      db.transaction(() => {
        db.prepare(`INSERT INTO installment_payments (id,installment_id,amount,notes)
          VALUES (?,?,?,?)`).run(paymentId, id, p.amount, p.notes||null)
        db.prepare(`
          UPDATE installments
          SET paid_amount  = paid_amount + ?,
              due_amount   = due_amount  - ?,
              last_paid_date = date('now'),
              updated_at   = datetime('now')
          WHERE id = ?
        `).run(p.amount, p.amount, id)
        // Advance next_due_date by one period
        const inst = db.prepare('SELECT * FROM installments WHERE id=?').get(id) as Record<string,unknown>
        const nextDue = inst.next_due_date
          ? (() => {
              const d = new Date(String(inst.next_due_date))
              if (inst.frequency === 'weekly') d.setDate(d.getDate() + 7)
              else d.setMonth(d.getMonth() + 1)
              return d.toISOString().slice(0, 10)
            })()
          : null
        if ((inst.due_amount as number) - Number(p.amount) <= 0.01) {
          db.prepare(`UPDATE installments SET status='completed', next_due_date=NULL WHERE id=?`).run(id)
        } else {
          db.prepare(`UPDATE installments SET status='active', next_due_date=? WHERE id=?`).run(nextDue, id)
        }
      })()
      await enqueuSync('installment_payments', paymentId, 'INSERT', { id: paymentId, installment_id: id, ...p })
      return { success: true }
    } catch (err: unknown) { return { success: false, error: (err as Error).message } }
  })

  // Product UOM (Units of Measure)
  ipcMain.handle('admin:productUom:list', (_e, productId: string) => {
    try {
      return { success: true, data: getDb().prepare(
        'SELECT * FROM product_uom WHERE product_id=? ORDER BY sort_order, is_base DESC'
      ).all(productId) }
    } catch (err: unknown) { return { success: false, error: (err as Error).message } }
  })
  ipcMain.handle('admin:productUom:save', async (_e, productId: string, uoms: Record<string,unknown>[]) => {
    try {
      const db = getDb()
      db.transaction(() => {
        db.prepare('DELETE FROM product_uom WHERE product_id=?').run(productId)
        for (let i = 0; i < uoms.length; i++) {
          const u = uoms[i]
          db.prepare(`INSERT INTO product_uom (id,product_id,uom_name,conversion_factor,is_base,wastage,sort_order)
            VALUES (?,?,?,?,?,?,?)`)
            .run(crypto.randomUUID(), productId, u.uom_name, u.conversion_factor ?? 1, u.is_base ? 1 : 0, u.wastage ?? 0, i)
        }
      })()
      return { success: true }
    } catch (err: unknown) { return { success: false, error: (err as Error).message } }
  })

  // Expense Categories
  ipcMain.handle('admin:expenseCategories:list', () => {
    try { return { success: true, data: getDb().prepare('SELECT * FROM expense_categories WHERE is_active=1 ORDER BY name').all() } }
    catch (err: unknown) { return { success: false, error: (err as Error).message } }
  })
  ipcMain.handle('admin:expenseCategories:create', async (_e, p: Record<string,unknown>) => {
    try {
      const id = crypto.randomUUID()
      getDb().prepare('INSERT INTO expense_categories (id,name) VALUES (?,?)').run(id, p.name)
      return { success: true, data: { id } }
    } catch (err: unknown) { return { success: false, error: (err as Error).message } }
  })

  // Expenses
  ipcMain.handle('admin:expenses:list', (_e, filters: Record<string,unknown> = {}) => {
    try {
      const db = getDb()
      let sql = `
        SELECT e.*, ec.name as category_name, s.name as supplier_name,
               u.name as paid_by_name, b.name as branch_name
        FROM expenses e
        LEFT JOIN expense_categories ec ON ec.id = e.category_id
        LEFT JOIN suppliers s ON s.id = e.supplier_id
        LEFT JOIN users u ON u.id = e.paid_by
        LEFT JOIN branches b ON b.id = e.branch_id
        WHERE 1=1`
      const params: unknown[] = []
      if (filters.branch_id)   { sql += ' AND e.branch_id=?';   params.push(filters.branch_id) }
      if (filters.category_id) { sql += ' AND e.category_id=?'; params.push(filters.category_id) }
      if (filters.from_date)   { sql += ' AND date(e.created_at)>=?'; params.push(filters.from_date) }
      if (filters.to_date)     { sql += ' AND date(e.created_at)<=?'; params.push(filters.to_date) }
      sql += ' ORDER BY e.created_at DESC LIMIT 500'
      return { success: true, data: db.prepare(sql).all(...params) }
    } catch (err: unknown) { return { success: false, error: (err as Error).message } }
  })
  ipcMain.handle('admin:expenses:create', async (_e, p: Record<string,unknown>) => {
    try {
      const db = getDb()
      const id = crypto.randomUUID()
      const paid = Number(p.paid_amount ?? p.amount)
      const status = paid >= Number(p.amount) ? 'paid' : paid > 0 ? 'partial' : 'unpaid'
      db.prepare(`INSERT INTO expenses
        (id,branch_id,category_id,supplier_id,amount,paid_amount,payment_status,
         payment_method,payment_date,payment_due,paid_by,description,notes,created_by)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(id, p.branch_id||null, p.category_id||null, p.supplier_id||null,
          Number(p.amount)||0, paid, status,
          p.payment_method||null, p.payment_date||null, p.payment_due||null,
          p.paid_by||null, p.description||null, p.notes||null, p.created_by||null)
      await enqueuSync('expenses', id, 'INSERT', { id, ...p })
      return { success: true, data: { id } }
    } catch (err: unknown) { return { success: false, error: (err as Error).message } }
  })
  ipcMain.handle('admin:expenses:update', async (_e, id: string, p: Record<string,unknown>) => {
    try {
      const fields = Object.keys(p).map(k=>`${k}=@${k}`).join(',')
      getDb().prepare(`UPDATE expenses SET ${fields}, updated_at=datetime('now') WHERE id=@id`).run({...p,id})
      await enqueuSync('expenses', id, 'UPDATE', { id, ...p })
      return { success: true }
    } catch (err: unknown) { return { success: false, error: (err as Error).message } }
  })
}
