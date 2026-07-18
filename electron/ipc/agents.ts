import type { IpcMain } from 'electron'
import { dialog } from 'electron'
import { getDb } from '../database'
import crypto from 'crypto'
import { enqueuSync } from '../services/syncQueue'
import Store from 'electron-store'
import * as XLSX from 'xlsx'
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

function codeTaken(db: ReturnType<typeof getDb>, code: string, excludeId?: string): boolean {
  const row = excludeId
    ? db.prepare('SELECT id FROM agents WHERE UPPER(TRIM(code)) = UPPER(TRIM(?)) AND id <> ?').get(code, excludeId)
    : db.prepare('SELECT id FROM agents WHERE UPPER(TRIM(code)) = UPPER(TRIM(?))').get(code)
  return Boolean(row)
}

export function registerAgentHandlers(ipcMain: IpcMain) {
  safeHandle(ipcMain, 'agents:list', (_e, filters: Record<string, unknown> = {}) => {
    {
      const db = getDb()
      const caller = authUser()
      const perms = currentPerms(caller)
      const isGlobal = Boolean(perms.all || perms.employees)
      const branchId = (filters.branch_id as string | undefined)
        || (!isGlobal ? caller.branch_id as string | undefined : undefined)

      const conditions: string[] = []
      const params: unknown[] = []
      if (branchId) { conditions.push('branch_id = ?'); params.push(branchId) }
      if (filters.status) { conditions.push('status = ?'); params.push(filters.status) }
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

      const rows = db.prepare(`SELECT * FROM agents ${where} ORDER BY name`).all(...params)
      return { success: true, data: rows }
    }
  })

  safeHandle(ipcMain, 'agents:get', (_e, id: string) => {
    {
      const db = getDb()
      return { success: true, data: db.prepare('SELECT * FROM agents WHERE id = ?').get(id) }
    }
  })

  safeHandle(ipcMain, 'agents:create', async (_e, payload: Record<string, unknown>) => {
    {
      const perms = currentPerms()
      if (!perms.all && !perms.employees) return { success: false, error: 'Employee management access required' }

      const db = getDb()
      const code = String(payload.code || '').trim().toUpperCase()
      const name = String(payload.name || '').trim()
      if (!code) return { success: false, error: 'Agent code is required' }
      if (!name) return { success: false, error: 'Agent name is required' }
      if (codeTaken(db, code)) return { success: false, error: `Agent code "${code}" is already in use` }

      const caller = authUser()
      const id = crypto.randomUUID()
      const safe = {
        id,
        code,
        name,
        phone: payload.phone || null,
        email: payload.email || null,
        nic: payload.nic || null,
        branch_id: payload.branch_id || caller.branch_id || null,
        default_commission_pct: Number(payload.default_commission_pct) || 0,
        monthly_target: Number(payload.monthly_target) || 0,
        status: payload.status || 'active',
        notes: payload.notes || null,
        created_by: caller.id || null,
      }
      db.prepare(`
        INSERT INTO agents (id, code, name, phone, email, nic, branch_id, default_commission_pct, monthly_target, status, notes, created_by)
        VALUES (@id, @code, @name, @phone, @email, @nic, @branch_id, @default_commission_pct, @monthly_target, @status, @notes, @created_by)
      `).run(safe)
      await enqueuSync('agents', id, 'INSERT', safe)
      return { success: true, data: { id } }
    }
  })

  safeHandle(ipcMain, 'agents:update', async (_e, id: string, payload: Record<string, unknown>) => {
    {
      const perms = currentPerms()
      if (!perms.all && !perms.employees) return { success: false, error: 'Employee management access required' }

      const db = getDb()
      const existing = db.prepare('SELECT id FROM agents WHERE id = ?').get(id)
      if (!existing) return { success: false, error: 'Agent not found' }

      const update: Record<string, unknown> = { ...payload }
      if (update.code !== undefined) {
        const code = String(update.code || '').trim().toUpperCase()
        if (!code) return { success: false, error: 'Agent code is required' }
        if (codeTaken(db, code, id)) return { success: false, error: `Agent code "${code}" is already in use` }
        update.code = code
      }
      if (update.name !== undefined) update.name = String(update.name || '').trim()
      if (update.default_commission_pct !== undefined) update.default_commission_pct = Number(update.default_commission_pct) || 0
      if (update.monthly_target !== undefined) update.monthly_target = Number(update.monthly_target) || 0

      const fields = Object.keys(update).map(k => `${k} = @${k}`).join(', ')
      if (fields) db.prepare(`UPDATE agents SET ${fields}, updated_at = datetime('now') WHERE id = @id`).run({ ...update, id })
      await enqueuSync('agents', id, 'UPDATE', { id, ...update })
      return { success: true }
    }
  })

  safeHandle(ipcMain, 'agents:downloadTemplate', async () => {
    {
      const perms = currentPerms()
      if (!perms.all && !perms.employees) return { success: false, error: 'Employee management access required' }

      const saveResult = await dialog.showSaveDialog({
        title: 'Save Agent Import Template',
        defaultPath: 'agent-import-template.xlsx',
        filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }],
      })
      if (saveResult.canceled || !saveResult.filePath) return { success: false, cancelled: true }

      const wb = XLSX.utils.book_new()
      const sample = [
        { 'Code': 'AG-100', 'Name': 'Ravi Kumar', 'Phone': '0771234567', 'Email': '', 'NIC': '', 'Default Commission %': 5, 'Monthly Target': 50000, 'Notes': '' },
        { 'Code': '', 'Name': '', 'Phone': '', 'Email': '', 'NIC': '', 'Default Commission %': '', 'Monthly Target': '', 'Notes': '' },
      ]
      const ws = XLSX.utils.json_to_sheet(sample)
      ws['!cols'] = [{ wch: 12 }, { wch: 22 }, { wch: 16 }, { wch: 26 }, { wch: 16 }, { wch: 18 }, { wch: 14 }, { wch: 24 }]
      XLSX.utils.book_append_sheet(wb, ws, 'Agents')

      const instructions = XLSX.utils.aoa_to_sheet([
        ['Column', 'Required', 'Rules'],
        ['Code', 'Yes', 'Short unique code, e.g. AG-101. Must not already exist.'],
        ['Name', 'Yes', 'Agent full name'],
        ['Phone', 'No', 'Free text'],
        ['Email', 'No', 'Free text'],
        ['NIC', 'No', 'Free text'],
        ['Default Commission %', 'No', 'Number 0-100, defaults to 0. Auto-fills at POS checkout but stays editable.'],
        ['Monthly Target', 'No', 'Number (Rs.), defaults to 0. Resets every calendar month.'],
        ['Notes', 'No', 'Free text'],
        [],
        ['Upload this file from Agent Management → Bulk Import. You can also open it in Google Sheets (File > Import > Upload) and re-export as .xlsx before uploading here.'],
      ])
      instructions['!cols'] = [{ wch: 22 }, { wch: 10 }, { wch: 70 }]
      XLSX.utils.book_append_sheet(wb, instructions, 'Instructions')

      XLSX.writeFile(wb, saveResult.filePath)
      return { success: true, filePath: saveResult.filePath }
    }
  })

  safeHandle(ipcMain, 'agents:importExcel', async () => {
    {
      const perms = currentPerms()
      if (!perms.all && !perms.employees) return { success: false, error: 'Employee management access required' }

      const { filePaths } = await dialog.showOpenDialog({
        title: 'Select Agent Import File',
        filters: [{ name: 'Excel / CSV', extensions: ['xlsx', 'xls', 'csv'] }],
        properties: ['openFile'],
      })
      if (!filePaths || filePaths.length === 0) return { success: false, cancelled: true }

      const db = getDb()
      const caller = authUser()
      const workbook = XLSX.readFile(filePaths[0])
      const sheetName = workbook.SheetNames.find(n => n.toLowerCase() === 'agents') || workbook.SheetNames[0]
      const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' }) as Record<string, unknown>[]

      let imported = 0
      let skipped = 0
      const errors: string[] = []

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i]
        const rowNum = i + 2
        const code = importCell(row, 'Code').toUpperCase()
        const name = importCell(row, 'Name')
        const phone = importCell(row, 'Phone')
        const email = importCell(row, 'Email')
        const nic = importCell(row, 'NIC')
        const pctRaw = importCell(row, 'Default Commission %', 'Commission %')
        const targetRaw = importCell(row, 'Monthly Target', 'Target')
        const notes = importCell(row, 'Notes')

        if (!code && !name) continue // fully blank row

        if (!code) { errors.push(`Row ${rowNum}: code is required`); skipped++; continue }
        if (!name) { errors.push(`Row ${rowNum}: name is required`); skipped++; continue }
        if (codeTaken(db, code)) { errors.push(`Row ${rowNum}: code "${code}" already in use`); skipped++; continue }

        try {
          const id = crypto.randomUUID()
          const safe = {
            id, code, name,
            phone: phone || null,
            email: email || null,
            nic: nic || null,
            branch_id: caller.branch_id || null,
            default_commission_pct: Number(pctRaw) || 0,
            monthly_target: Number(targetRaw) || 0,
            status: 'active',
            notes: notes || null,
            created_by: caller.id || null,
          }
          db.prepare(`
            INSERT INTO agents (id, code, name, phone, email, nic, branch_id, default_commission_pct, monthly_target, status, notes, created_by)
            VALUES (@id, @code, @name, @phone, @email, @nic, @branch_id, @default_commission_pct, @monthly_target, @status, @notes, @created_by)
          `).run(safe)
          await enqueuSync('agents', id, 'INSERT', safe)
          imported++
        } catch (err: unknown) {
          errors.push(`Row ${rowNum}: ${(err as Error).message}`)
          skipped++
        }
      }

      return { success: true, imported, skipped, errors: errors.slice(0, 50) }
    }
  })

  // Per-agent sales/commission report: header stats, current-month target
  // progress, per-product breakdown (commission allocated proportionally by
  // line value — there is no true per-line commission column today), and a
  // flat invoice list for the downloadable detail section. Matches agents to
  // invoices by agent_code text (case/whitespace-insensitive), never by the
  // agent_id FK alone, so historical invoices predating the agents table
  // still surface correctly.
  safeHandle(ipcMain, 'agents:report', (_e, filters: { agentId: string; dateFrom?: string; dateTo?: string; branchId?: string }) => {
    {
      const db = getDb()
      const caller = authUser()
      const perms = currentPerms(caller)
      const isGlobal = Boolean(perms.all || perms.employees)

      const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(filters.agentId) as Record<string, unknown> | undefined
      if (!agent) return { success: false, error: 'Agent not found' }

      const branchId = filters.branchId || (!isGlobal ? caller.branch_id as string | undefined : undefined)
      const conditions = [`UPPER(TRIM(i.agent_code)) = UPPER(TRIM(?))`, `i.status = 'completed'`]
      const params: unknown[] = [agent.code]
      if (branchId) { conditions.push('i.branch_id = ?'); params.push(branchId) }
      if (filters.dateFrom) { conditions.push('date(i.created_at) >= date(?)'); params.push(filters.dateFrom) }
      if (filters.dateTo) { conditions.push('date(i.created_at) <= date(?)'); params.push(filters.dateTo) }
      const where = `WHERE ${conditions.join(' AND ')}`

      const stats = db.prepare(`
        SELECT COUNT(*) as invoice_count,
          COALESCE(SUM(i.total_amount), 0) as sales_total,
          COALESCE(SUM(i.agent_commission_amount), 0) as commission_total
        FROM invoices i
        ${where}
      `).get(...params) as { invoice_count: number; sales_total: number; commission_total: number }

      const monthConditions = [`UPPER(TRIM(i.agent_code)) = UPPER(TRIM(?))`, `i.status = 'completed'`, `strftime('%Y-%m', i.created_at) = strftime('%Y-%m', 'now')`]
      const monthParams: unknown[] = [agent.code]
      if (branchId) { monthConditions.push('i.branch_id = ?'); monthParams.push(branchId) }
      const monthSales = db.prepare(`
        SELECT COALESCE(SUM(i.total_amount), 0) as sales_total
        FROM invoices i
        WHERE ${monthConditions.join(' AND ')}
      `).get(...monthParams) as { sales_total: number }

      const target = Number(agent.monthly_target) || 0
      const achieved = Number(monthSales.sales_total) || 0
      const targetProgress = {
        target,
        achieved,
        pct: target > 0 ? Math.min(999, Math.round((achieved / target) * 1000) / 10) : 0,
      }

      const products = db.prepare(`
        SELECT p.id as product_id, p.name as product_name, p.sku,
          COALESCE(SUM(ii.quantity), 0) as qty_sold,
          COALESCE(SUM(ii.line_total), 0) as line_sales_total,
          COALESCE(SUM(CASE WHEN i.total_amount > 0
            THEN ii.line_total / i.total_amount * i.agent_commission_amount
            ELSE 0 END), 0) as commission_allocated
        FROM invoices i
        JOIN invoice_items ii ON ii.invoice_id = i.id
        LEFT JOIN products p ON p.id = ii.product_id
        ${where}
        GROUP BY ii.product_id
        ORDER BY commission_allocated DESC
      `).all(...params)

      const invoices = db.prepare(`
        SELECT i.invoice_number, i.created_at, b.name as branch_name,
          c.name as customer_name, i.total_amount, i.agent_commission_pct, i.agent_commission_amount
        FROM invoices i
        LEFT JOIN branches b ON b.id = i.branch_id
        LEFT JOIN customers c ON c.id = i.customer_id
        ${where}
        ORDER BY i.created_at DESC
        LIMIT 1000
      `).all(...params)

      return { success: true, data: { agent, stats, targetProgress, products, invoices } }
    }
  })

  // One row per agent for the list page — LEFT JOINed from agents so agents
  // with zero sales in the range still appear.
  safeHandle(ipcMain, 'agents:reportAllSummary', (_e, filters: { dateFrom?: string; dateTo?: string; branchId?: string } = {}) => {
    {
      const db = getDb()
      const caller = authUser()
      const perms = currentPerms(caller)
      const isGlobal = Boolean(perms.all || perms.employees)
      const branchId = filters.branchId || (!isGlobal ? caller.branch_id as string | undefined : undefined)

      const invoiceConditions = [`UPPER(TRIM(i.agent_code)) = UPPER(TRIM(a.code))`, `i.status = 'completed'`]
      const params: unknown[] = []
      if (filters.dateFrom) { invoiceConditions.push('date(i.created_at) >= date(?)'); params.push(filters.dateFrom) }
      if (filters.dateTo) { invoiceConditions.push('date(i.created_at) <= date(?)'); params.push(filters.dateTo) }

      const agentConditions: string[] = []
      const agentParams: unknown[] = []
      if (branchId) { agentConditions.push('a.branch_id = ?'); agentParams.push(branchId) }
      const agentWhere = agentConditions.length ? `WHERE ${agentConditions.join(' AND ')}` : ''

      const rows = db.prepare(`
        SELECT a.id, a.code, a.name, a.branch_id, a.monthly_target, a.status,
          COALESCE(SUM(i.total_amount), 0) as sales_total,
          COALESCE(SUM(i.agent_commission_amount), 0) as commission_total,
          COUNT(i.id) as invoice_count
        FROM agents a
        LEFT JOIN invoices i ON ${invoiceConditions.join(' AND ')}
        ${agentWhere}
        GROUP BY a.id
        ORDER BY sales_total DESC
      `).all(...params, ...agentParams)

      return { success: true, data: rows }
    }
  })
}
