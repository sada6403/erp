import type { IpcMain } from 'electron'
import { dialog } from 'electron'
import { getDb } from '../database'
import crypto from 'crypto'
import { enqueuSync } from '../services/syncQueue'
import Store from 'electron-store'
import * as XLSX from 'xlsx'
import { safeHandle } from './ipcHandler'

const store = new Store()

const PHONE_RE = /^\+?\d{9,12}$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const NIC_RE = /^(\d{9}[vVxX]|\d{12})$/

function importCell(row: Record<string, unknown>, ...names: string[]): string {
  for (const name of names) {
    for (const key of Object.keys(row)) {
      if (key.trim().toLowerCase() === name.toLowerCase()) {
        const v = row[key]
        if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim()
      }
    }
  }
  return ''
}

export function registerCustomerHandlers(ipcMain: IpcMain) {
  safeHandle(ipcMain, 'customers:list', (_e, filters: Record<string, unknown> = {}) => {
    const db = getDb()
    let sql = 'SELECT * FROM customers WHERE 1=1'
    const params: unknown[] = []
    if (filters.branch_id) { sql += ' AND branch_id = ?'; params.push(filters.branch_id) }
    sql += ' ORDER BY name LIMIT 500'
    return { success: true, data: db.prepare(sql).all(...params) }
  })

  safeHandle(ipcMain, 'customers:search', (_e, query: string) => {
    const db = getDb()
    const q = `%${query}%`
    const rows = db.prepare(`
      SELECT * FROM customers
      WHERE name LIKE ? OR phone LIKE ? OR email LIKE ? OR nic LIKE ?
      ORDER BY name LIMIT 30
    `).all(q, q, q, q)
    return { success: true, data: rows }
  })

  safeHandle(ipcMain, 'customers:get', (_e, id: string) => {
    const db = getDb()
    return { success: true, data: db.prepare('SELECT * FROM customers WHERE id = ?').get(id) }
  })

  // Match an existing customer by phone OR NIC — used to avoid creating
  // duplicate customer records (e.g. when enrolling someone into a chit
  // scheme who is already a walk-in customer). Returns up to 5 matches;
  // if phone and NIC each match a different person, both are returned so
  // the caller can disambiguate rather than silently picking one.
  safeHandle(ipcMain, 'customers:findByPhoneOrNic', (_e, payload: { phone?: string; nic?: string }) => {
    const db = getDb()
    const phone = String(payload?.phone || '').trim()
    const nic = String(payload?.nic || '').trim()
    if (!phone && !nic) return { success: true, data: [] }
    const conditions: string[] = []
    const params: unknown[] = []
    if (phone) { conditions.push('phone = ?'); params.push(phone) }
    if (nic)   { conditions.push('nic = ?'); params.push(nic) }
    const rows = db.prepare(`
      SELECT * FROM customers WHERE ${conditions.join(' OR ')} ORDER BY name LIMIT 5
    `).all(...params)
    return { success: true, data: rows }
  })

  safeHandle(ipcMain, 'customers:create', async (_e, payload) => {
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
  })

  safeHandle(ipcMain, 'customers:update', async (_e, id: string, payload) => {
    const db = getDb()
      const fields = Object.keys(payload).map(k => `${k} = @${k}`).join(', ')
      db.prepare(`UPDATE customers SET ${fields}, updated_at = datetime('now') WHERE id = @id`)
        .run({ ...payload, id })
      await enqueuSync('customers', id, 'UPDATE', { id, ...payload })
      return { success: true }
  })

  safeHandle(ipcMain, 'customers:downloadTemplate', async () => {
    const saveResult = await dialog.showSaveDialog({
        title: 'Save Customer Import Template',
        defaultPath: 'customer-import-template.xlsx',
        filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }],
      })
      if (saveResult.canceled || !saveResult.filePath) return { success: false, cancelled: true }

      const wb = XLSX.utils.book_new()
      const sample = [
        { 'Name': 'Kumaran Silva', 'Phone': '0771234567', 'NIC': '199012345678', 'Email': 'kumaran@example.com', 'Address': '12 Galle Road, Colombo', 'Credit Limit': 0, 'Notes': '' },
        { 'Name': '', 'Phone': '', 'NIC': '', 'Email': '', 'Address': '', 'Credit Limit': '', 'Notes': '' },
      ]
      const ws = XLSX.utils.json_to_sheet(sample)
      ws['!cols'] = [{ wch: 22 }, { wch: 16 }, { wch: 16 }, { wch: 26 }, { wch: 30 }, { wch: 12 }, { wch: 24 }]
      XLSX.utils.book_append_sheet(wb, ws, 'Customers')

      const instructions = XLSX.utils.aoa_to_sheet([
        ['Column', 'Required', 'Rules'],
        ['Name', 'Yes', 'Full customer name'],
        ['Phone', 'Yes', '9-12 digits, optionally starting with +'],
        ['NIC', 'No', 'Sri Lankan NIC — 9 digits + V/X, or 12 digits'],
        ['Email', 'No', 'Must be a valid email if provided'],
        ['Address', 'Yes', 'Free text'],
        ['Credit Limit', 'No', 'Number, defaults to 0'],
        ['Notes', 'No', 'Free text'],
        [],
        ['Delete the sample row before uploading, or leave it — the importer skips fully blank rows.'],
        ['Upload this file from Customers → Bulk Import. You can also open it in Google Sheets (File > Import > Upload) and re-export as .xlsx before uploading here.'],
      ])
      instructions['!cols'] = [{ wch: 16 }, { wch: 10 }, { wch: 60 }]
      XLSX.utils.book_append_sheet(wb, instructions, 'Instructions')

      XLSX.writeFile(wb, saveResult.filePath)
      return { success: true, filePath: saveResult.filePath }
  })

  safeHandle(ipcMain, 'customers:importExcel', async () => {
    const { filePaths } = await dialog.showOpenDialog({
        title: 'Select Customer Import File',
        filters: [{ name: 'Excel / CSV', extensions: ['xlsx', 'xls', 'csv'] }],
        properties: ['openFile'],
      })
      if (!filePaths || filePaths.length === 0) return { success: false, cancelled: true }

      const db = getDb()
      const authUserRow = store.get('auth_user') as Record<string, unknown> | undefined
      const workbook = XLSX.readFile(filePaths[0])
      const sheet = workbook.Sheets[workbook.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' }) as Record<string, unknown>[]

      let imported = 0
      let skipped = 0
      const errors: string[] = []

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i]
        const rowNum = i + 2 // header is row 1
        const name = importCell(row, 'Name', 'Full Name')
        const phone = importCell(row, 'Phone', 'Mobile', 'Mobile Number').replace(/[\s-]/g, '')
        const nic = importCell(row, 'NIC')
        const email = importCell(row, 'Email')
        const address = importCell(row, 'Address')
        const creditLimitRaw = importCell(row, 'Credit Limit')
        const notes = importCell(row, 'Notes')

        if (!name && !phone && !address) continue // fully blank row

        if (!name) { errors.push(`Row ${rowNum}: name is required`); skipped++; continue }
        if (!phone) { errors.push(`Row ${rowNum}: phone is required`); skipped++; continue }
        if (!PHONE_RE.test(phone)) { errors.push(`Row ${rowNum}: invalid phone "${phone}"`); skipped++; continue }
        if (!address) { errors.push(`Row ${rowNum}: address is required`); skipped++; continue }
        if (email && !EMAIL_RE.test(email)) { errors.push(`Row ${rowNum}: invalid email "${email}"`); skipped++; continue }
        if (nic && !NIC_RE.test(nic)) { errors.push(`Row ${rowNum}: invalid NIC "${nic}"`); skipped++; continue }

        const id = crypto.randomUUID()
        const safe = {
          id,
          branch_id: authUserRow?.branch_id || null,
          name,
          phone,
          email: email || null,
          address,
          nic: nic || null,
          notes: notes || null,
        }
        try {
          db.prepare(`
            INSERT INTO customers (id, branch_id, name, phone, email, address, nic, notes)
            VALUES (@id, @branch_id, @name, @phone, @email, @address, @nic, @notes)
          `).run(safe)
          if (creditLimitRaw) {
            const creditLimit = Number(creditLimitRaw) || 0
            if (creditLimit) db.prepare('UPDATE customers SET credit_limit = ? WHERE id = ?').run(creditLimit, id)
          }
          await enqueuSync('customers', id, 'INSERT', safe)
          imported++
        } catch (err: unknown) {
          errors.push(`Row ${rowNum}: ${(err as Error).message}`)
          skipped++
        }
      }

      return { success: true, imported, skipped, errors: errors.slice(0, 50) }
  })

  safeHandle(ipcMain, 'customers:history', (_e, id: string) => {
    const db = getDb()
    const invoices = db.prepare(`
      SELECT i.*, COUNT(ii.id) as item_count
      FROM invoices i
      LEFT JOIN invoice_items ii ON ii.invoice_id = i.id
      WHERE i.customer_id = ? AND i.status = 'completed'
      GROUP BY i.id ORDER BY i.created_at DESC LIMIT 50
    `).all(id)
    return { success: true, data: invoices }
  })

  // Every Chit Fund scheme this customer belongs to, with enough context
  // (product, branch, agent) to answer "what is this person buying, where,
  // and through which agent" without leaving the customer's own record.
  safeHandle(ipcMain, 'customers:chitMemberships', (_e, id: string) => {
    const db = getDb()
    const rows = db.prepare(`
      SELECT m.id, m.scheme_id, m.join_order, m.status, m.contributions_paid,
        m.is_early_redemption, m.won_cycle_no,
        cs.scheme_number, cs.name as scheme_name, cs.chit_value, cs.contribution_amount,
        b.name as branch_name,
        p.name as product_name,
        COALESCE(ma.name, sa.name) as agent_name, COALESCE(ma.code, sa.code) as agent_code
      FROM chit_members m
      JOIN chit_schemes cs ON cs.id = m.scheme_id
      LEFT JOIN branches b ON b.id = cs.branch_id
      LEFT JOIN products p ON p.id = cs.product_id
      LEFT JOIN agents sa ON sa.id = cs.agent_id
      LEFT JOIN agents ma ON ma.id = m.agent_id
      WHERE m.customer_id = ?
      ORDER BY m.created_at DESC
    `).all(id)
    return { success: true, data: rows }
  })

  safeHandle(ipcMain, 'customers:installments', (_e, id: string) => {
    const db = getDb()
    const rows = db.prepare(`
      SELECT inst.*, i.invoice_number
      FROM installments inst
      LEFT JOIN invoices i ON i.id = inst.invoice_id
      WHERE inst.customer_id = ?
      ORDER BY inst.created_at DESC
    `).all(id)
    return { success: true, data: rows }
  })
}
