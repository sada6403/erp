import type { IpcMain } from 'electron'
import { dialog } from 'electron'
import { getDb } from '../database'
import crypto from 'crypto'
import { enqueuSync } from '../services/syncQueue'
import { logAudit } from '../services/auditLog'
import Store from 'electron-store'
import * as XLSX from 'xlsx'
import { safeHandle } from './ipcHandler'
import { createNotification } from './notifications'

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

// Non-null only for a caller logged in as an Agent (session_scope='agent')
// — their own agent id. Mirrors chits.ts's resolveScopedAgentId.
function resolveScopedAgentId(caller: Record<string, unknown>): string | null {
  const scope = caller.scope as { level?: string; agentId?: string | null } | undefined
  return scope?.level === 'agent' ? (scope.agentId || null) : null
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
      // Only 'all' (Company Admin) is global (cross-branch) access. 'employees'
      // is deliberately excluded from every isGlobal/isGlobalManage check in
      // this file even though the handler-entry gates below accept it as "can
      // touch agents at all" — the seeded Branch Manager role carries
      // employees:true for the ordinary Employee Management module, and
      // treating that as global previously gave every Branch Manager
      // cross-branch visibility/write access over every OTHER branch's
      // agents (list/get/create/update/linkUser/report all affected). Mirrors
      // the same class of bug already fixed for 'customers' in
      // chits.ts's isGlobalChitAccess.
      const isGlobal = Boolean(perms.all)
      const branchId = (filters.branch_id as string | undefined)
        || (!isGlobal ? caller.branch_id as string | undefined : undefined)
      const scopedAgentId = resolveScopedAgentId(caller)

      const conditions: string[] = []
      const params: unknown[] = []
      if (branchId) { conditions.push('branch_id = ?'); params.push(branchId) }
      if (filters.status) { conditions.push('status = ?'); params.push(filters.status) }
      // An Agent session only ever sees their own record in this list.
      if (scopedAgentId) { conditions.push('id = ?'); params.push(scopedAgentId) }
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

      const rows = db.prepare(`SELECT * FROM agents ${where} ORDER BY name`).all(...params)
      return { success: true, data: rows }
    }
  })

  safeHandle(ipcMain, 'agents:get', (_e, id: string) => {
    {
      const db = getDb()
      const caller = authUser()
      const perms = currentPerms(caller)
      const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as Record<string, unknown> | undefined
      if (!agent) return { success: false, error: 'Agent not found' }
      const isGlobal = Boolean(perms.all)
      if (!isGlobal && String(agent.branch_id || '') !== String(caller.branch_id || '')) {
        return { success: false, error: 'You do not have access to this agent' }
      }
      const scopedAgentId = resolveScopedAgentId(caller)
      if (scopedAgentId && scopedAgentId !== id) {
        return { success: false, error: 'You do not have access to this agent' }
      }
      return { success: true, data: agent }
    }
  })

  safeHandle(ipcMain, 'agents:create', async (_e, payload: Record<string, unknown>) => {
    {
      const perms = currentPerms()
      if (!perms.all && !perms.employees && !perms.chits) return { success: false, error: 'Employee management access required' }
      if (resolveScopedAgentId(authUser())) {
        return { success: false, error: 'Agents cannot create other agent profiles' }
      }

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
        // A caller without 'all' is branch-scoped (this includes an
        // 'employees'-only Branch Manager, see the isGlobal comment above) —
        // never let them plant an agent in a different branch via payload.
        branch_id: perms.all ? (payload.branch_id || caller.branch_id || null) : (caller.branch_id || null),
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
      logAudit(db, {
        userId: (caller.id as string) || null, branchId: (safe.branch_id as string) || null,
        action: 'AGENT_CREATED', tableName: 'agents', recordId: id, newValues: { code, name },
      })
      if (safe.branch_id) {
        createNotification('agent_registered', 'New Agent Registered',
          `${name} (${code}) was added to your branch.`,
          { agentId: id, branchId: safe.branch_id },
          { roleScope: 'smartBuy', branchId: safe.branch_id as string })
      }
      return { success: true, data: { id } }
    }
  })

  safeHandle(ipcMain, 'agents:update', async (_e, id: string, payload: Record<string, unknown>) => {
    {
      const perms = currentPerms()
      if (!perms.all && !perms.employees && !perms.chits) return { success: false, error: 'Employee management access required' }

      const db = getDb()
      const caller = authUser()
      // Spec: agents "cannot modify commission rules" or their own profile —
      // an Agent session has no write access to any agent record, including
      // their own, via this handler.
      if (resolveScopedAgentId(caller)) {
        return { success: false, error: 'Agents cannot edit agent profiles' }
      }
      const existing = db.prepare('SELECT id, branch_id FROM agents WHERE id = ?').get(id) as { id: string; branch_id: unknown } | undefined
      if (!existing) return { success: false, error: 'Agent not found' }
      const isGlobalManage = Boolean(perms.all)
      if (!isGlobalManage && String(existing.branch_id || '') !== String(caller.branch_id || '')) {
        return { success: false, error: 'You do not have access to this agent' }
      }

      const update: Record<string, unknown> = { ...payload }
      // A branch-scoped caller (Smart Buy Manager) can't move an agent to a different branch.
      if (!isGlobalManage) delete update.branch_id
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
      if (fields) {
        logAudit(db, {
          userId: (caller.id as string) || null, branchId: (existing.branch_id as string) || null,
          action: 'AGENT_UPDATED', tableName: 'agents', recordId: id, newValues: update,
        })
      }
      return { success: true }
    }
  })

  // Flips a 'pending' agent to 'active'. Ordinary agent creation still
  // defaults straight to 'active' (unchanged) — this only matters for an
  // agent explicitly left pending (e.g. a manager choosing "Save as
  // Pending" instead of activating immediately), giving Managers a real,
  // separate "Approve" action distinct from Create/Activate/Deactivate.
  safeHandle(ipcMain, 'agents:approve', async (_e, id: string) => {
    const perms = currentPerms()
    if (!perms.all && !perms.employees && !perms.chits) return { success: false, error: 'Employee management access required' }

    const db = getDb()
    const caller = authUser()
    if (resolveScopedAgentId(caller)) {
      return { success: false, error: 'Agents cannot approve agent profiles' }
    }
    const existing = db.prepare('SELECT id, name, branch_id, status, user_id FROM agents WHERE id = ?').get(id) as { id: string; name: string; branch_id: unknown; status: string; user_id: string | null } | undefined
    if (!existing) return { success: false, error: 'Agent not found' }
    const isGlobalManage = Boolean(perms.all)
    if (!isGlobalManage && String(existing.branch_id || '') !== String(caller.branch_id || '')) {
      return { success: false, error: 'You do not have access to this agent' }
    }
    if (existing.status !== 'pending') return { success: false, error: `This agent is already ${existing.status} — nothing to approve` }

    db.prepare(`UPDATE agents SET status='active', updated_at=datetime('now') WHERE id=?`).run(id)
    await enqueuSync('agents', id, 'UPDATE', { id, status: 'active' })
    logAudit(db, {
      userId: (caller.id as string) || null, branchId: (existing.branch_id as string) || null,
      action: 'AGENT_APPROVED', tableName: 'agents', recordId: id,
    })
    if (existing.user_id) {
      createNotification('agent_approved', 'Agent Approval Completed',
        `${existing.name}, your agent profile has been approved and is now active.`,
        { agentId: id }, { userId: existing.user_id })
    }
    return { success: true }
  })

  // Hard-delete only when nothing references this agent anywhere in the
  // system (matches products:permanentDelete's pattern) — otherwise block
  // and point the caller at the Active/Inactive toggle instead, since an
  // agent tied to real invoices/schemes/commission history must stay for
  // audit purposes.
  safeHandle(ipcMain, 'agents:delete', async (_e, id: string) => {
    const perms = currentPerms()
    if (!perms.all && !perms.employees && !perms.chits) return { success: false, error: 'Employee management access required' }

    const db = getDb()
    const caller = authUser()
    const existing = db.prepare('SELECT id, branch_id, name FROM agents WHERE id = ?').get(id) as { id: string; branch_id: unknown; name: string } | undefined
    if (!existing) return { success: false, error: 'Agent not found' }
    const isGlobalManage = Boolean(perms.all)
    if (!isGlobalManage && String(existing.branch_id || '') !== String(caller.branch_id || '')) {
      return { success: false, error: 'You do not have access to this agent' }
    }

    const refs: Array<{ label: string; cnt: number }> = [
      { label: 'invoice(s)', cnt: (db.prepare('SELECT COUNT(*) as c FROM invoices WHERE agent_id=?').get(id) as { c: number }).c },
      { label: 'Smart Buy scheme(s)', cnt: (db.prepare('SELECT COUNT(*) as c FROM chit_schemes WHERE agent_id=?').get(id) as { c: number }).c },
      { label: 'Smart Buy member(s)', cnt: (db.prepare('SELECT COUNT(*) as c FROM chit_members WHERE agent_id=?').get(id) as { c: number }).c },
      { label: 'contribution(s) collected', cnt: (db.prepare('SELECT COUNT(*) as c FROM chit_contributions WHERE collected_by_agent_id=?').get(id) as { c: number }).c },
      { label: 'commission ledger entry/entries', cnt: (db.prepare('SELECT COUNT(*) as c FROM commission_ledger WHERE registration_agent_id=? OR sales_agent_id=?').get(id, id) as { c: number }).c },
      { label: 'remittance(s)', cnt: (db.prepare('SELECT COUNT(*) as c FROM agent_remittances WHERE agent_id=?').get(id) as { c: number }).c },
    ]
    const blocking = refs.find(r => r.cnt > 0)
    if (blocking) {
      return { success: false, error: `Cannot delete — referenced by ${blocking.cnt} ${blocking.label}. Mark the agent Inactive instead.` }
    }

    db.prepare('DELETE FROM agents WHERE id=?').run(id)
    await enqueuSync('agents', id, 'DELETE', { id })
    logAudit(db, {
      userId: (caller.id as string) || null, branchId: (existing.branch_id as string) || null,
      action: 'AGENT_DELETED', tableName: 'agents', recordId: id, oldValues: { name: existing.name },
    })
    return { success: true }
  })

  // Links (or unlinks, when userId is null) an agent record to a users row
  // so the agent can sign in and see only their own Smart Buy data. Kept as
  // a dedicated handler rather than folded into agents:update, which has no
  // field allow-list — user_id is deliberately not reachable through it.
  safeHandle(ipcMain, 'agents:linkUser', async (_e, agentId: string, userId: string | null) => {
    {
      const perms = currentPerms()
      if (!perms.all && !perms.employees) return { success: false, error: 'Employee management access required' }

      const db = getDb()
      const caller = authUser()
      const agent = db.prepare('SELECT id, branch_id FROM agents WHERE id = ?').get(agentId) as { id: string; branch_id: unknown } | undefined
      if (!agent) return { success: false, error: 'Agent not found' }
      const isGlobalManage = Boolean(perms.all)
      if (!isGlobalManage && String(agent.branch_id || '') !== String(caller.branch_id || '')) {
        return { success: false, error: 'You do not have access to this agent' }
      }

      if (userId) {
        const user = db.prepare('SELECT id FROM users WHERE id = ?').get(userId)
        if (!user) return { success: false, error: 'User not found' }
        const alreadyLinked = db.prepare('SELECT id FROM agents WHERE user_id = ? AND id <> ?').get(userId, agentId)
        if (alreadyLinked) return { success: false, error: 'This user account is already linked to another agent' }
      }

      db.prepare(`UPDATE agents SET user_id = ?, updated_at = datetime('now') WHERE id = ?`).run(userId || null, agentId)
      await enqueuSync('agents', agentId, 'UPDATE', { id: agentId, user_id: userId || null })
      logAudit(db, {
        userId: (caller.id as string) || null, branchId: (agent.branch_id as string) || null,
        action: userId ? 'AGENT_LOGIN_LINKED' : 'AGENT_LOGIN_UNLINKED', tableName: 'agents', recordId: agentId,
        newValues: { linkedUserId: userId || null },
      })
      return { success: true }
    }
  })

  safeHandle(ipcMain, 'agents:downloadTemplate', async () => {
    {
      const perms = currentPerms()
      if (!perms.all && !perms.employees && !perms.chits) return { success: false, error: 'Employee management access required' }

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
      if (!perms.all && !perms.employees && !perms.chits) return { success: false, error: 'Employee management access required' }

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

      if (imported > 0) {
        logAudit(db, {
          userId: (caller.id as string) || null, branchId: (caller.branch_id as string) || null,
          action: 'AGENTS_BULK_IMPORTED', tableName: 'agents', recordId: null,
          newValues: { imported, skipped },
        })
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
      // Same access gate as every other agent-management handler in this
      // file (create/update/list) — this was missing entirely, which let
      // ANY authenticated session (including an unrelated Agent-portal
      // login) read any agent's commission/invoice report.
      if (!perms.all && !perms.employees && !perms.chits) return { success: false, error: 'Employee management access required' }
      const isGlobal = Boolean(perms.all)

      const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(filters.agentId) as Record<string, unknown> | undefined
      if (!agent) return { success: false, error: 'Agent not found' }
      if (!isGlobal && String(agent.branch_id || '') !== String(caller.branch_id || '')) {
        return { success: false, error: 'You do not have access to this agent' }
      }
      // An Agent-portal session may only ever pull their own report —
      // mirrors agents:get's identical guard.
      const scopedAgentId = resolveScopedAgentId(caller)
      if (scopedAgentId && scopedAgentId !== filters.agentId) {
        return { success: false, error: 'You do not have access to this agent' }
      }

      // Non-global callers can't widen the branch filter past their own
      // branch via a client-supplied override (mirrors chits.ts's
      // resolveScopedBranchId pattern).
      const branchId = isGlobal ? filters.branchId : (caller.branch_id as string | undefined)
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
      // Same missing gate as agents:report — this lists EVERY agent's
      // commission/sales totals, so it needed a permission check even more.
      if (!perms.all && !perms.employees && !perms.chits) return { success: false, error: 'Employee management access required' }
      const isGlobal = Boolean(perms.all)
      const branchId = isGlobal ? filters.branchId : (caller.branch_id as string | undefined)

      const invoiceConditions = [`UPPER(TRIM(i.agent_code)) = UPPER(TRIM(a.code))`, `i.status = 'completed'`]
      const params: unknown[] = []
      if (filters.dateFrom) { invoiceConditions.push('date(i.created_at) >= date(?)'); params.push(filters.dateFrom) }
      if (filters.dateTo) { invoiceConditions.push('date(i.created_at) <= date(?)'); params.push(filters.dateTo) }

      const agentConditions: string[] = []
      const agentParams: unknown[] = []
      if (branchId) { agentConditions.push('a.branch_id = ?'); agentParams.push(branchId) }
      // An Agent-portal session only ever sees their own row in this list.
      const scopedAgentId = resolveScopedAgentId(caller)
      if (scopedAgentId) { agentConditions.push('a.id = ?'); agentParams.push(scopedAgentId) }
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
