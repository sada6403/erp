import type { IpcMain } from 'electron'
import { dialog } from 'electron'
import { getDb } from '../database'
import crypto from 'crypto'
import { enqueuSync } from '../services/syncQueue'
import { logAudit } from '../services/auditLog'
import Store from 'electron-store'
import * as XLSX from 'xlsx'

const store = new Store()

const PHONE_RE = /^\+?\d{9,12}$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const NIC_RE = /^(\d{9}[vVxX]|\d{12})$/

function authUser(): Record<string, unknown> {
  return (store.get('auth_user') as Record<string, unknown> | undefined) || {}
}

function currentPerms(caller: Record<string, unknown> = authUser()): Record<string, unknown> {
  return ((caller.role as Record<string, unknown>)?.permissions as Record<string, unknown>)
    || (caller.permissions as Record<string, unknown>)
    || {}
}

function defaultBranchId() {
  return 'b1111111-1111-4111-8111-111111111111'
}

function money(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100
}

function addMonths(date: string, months: number): string {
  const d = new Date(`${date}T00:00:00`)
  d.setMonth(d.getMonth() + months)
  return d.toISOString().slice(0, 10)
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

function canManage(perms: Record<string, unknown>): boolean {
  return Boolean(perms.all || perms.customers)
}

function nextChitNumber(db: ReturnType<typeof getDb>, branchId: string) {
  const year = new Date().getFullYear()
  const branch = db.prepare('SELECT code, name FROM branches WHERE id=?').get(branchId) as { code?: string; name?: string } | undefined
  const code = String(branch?.code || branch?.name?.slice(0, 4) || 'MAIN').toUpperCase().replace(/\s+/g, '')
  const count = db.prepare(`
    SELECT COUNT(*) AS count FROM chit_schemes
    WHERE branch_id = ? AND substr(created_at, 1, 4) = ?
  `).get(branchId, String(year)) as { count: number }
  return `${code}-CHIT-${year}-${String(Number(count?.count || 0) + 1).padStart(4, '0')}`
}

// Generates the post-delivery repayment schedule for a member who has just
// received their product (via draw win, final-cycle batch release, or early
// redemption) and still owes a remaining balance. Reuses the exact loop
// shape from admin:installments:createSale so the existing recordPayment/
// verifyPayment engine handles collection with no new payment UI needed.
function generateChitRepaymentSchedule(
  db: ReturnType<typeof getDb>,
  scheme: Record<string, unknown>,
  member: Record<string, unknown>,
  principalRemaining: number,
  label: string
): { installmentId: string; enqueue: Array<{ table: string; id: string; row: Record<string, unknown> }> } | null {
  if (principalRemaining <= 0.01) return null

  const months = Math.max(1, Number(scheme.repayment_months) || 12)
  const monthlyAmount = money(principalRemaining / months)
  const installmentId = crypto.randomUUID()
  const startDate = new Date().toISOString().slice(0, 10)
  const nextDue = addMonths(startDate, 1)
  const contractNumber = `${label}-RPY`
  const enqueue: Array<{ table: string; id: string; row: Record<string, unknown> }> = []

  const installmentRow = {
    id: installmentId, contract_number: contractNumber, invoice_id: null,
    customer_id: member.customer_id, branch_id: scheme.branch_id,
    cash_price: scheme.chit_value, down_payment: 0, financed_amount: principalRemaining,
    interest_type: 'flat', interest_rate: 0, interest_amount: 0,
    total_amount: principalRemaining, paid_amount: 0, due_amount: principalRemaining,
    monthly_amount: monthlyAmount, installment_count: months, remaining_installments: months,
    frequency: 'monthly', start_date: startDate, next_due_date: nextDue, status: 'active',
    grace_period_days: 0, late_fee: 0, notes: `Chit repayment — ${label}`,
  }
  db.prepare(`
    INSERT INTO installments
      (id, contract_number, invoice_id, customer_id, branch_id, cash_price, down_payment,
       financed_amount, interest_type, interest_rate, interest_amount, total_amount, paid_amount,
       due_amount, monthly_amount, installment_count, remaining_installments, frequency, start_date,
       next_due_date, status, grace_period_days, late_fee, notes)
    VALUES (@id,@contract_number,@invoice_id,@customer_id,@branch_id,@cash_price,@down_payment,
       @financed_amount,@interest_type,@interest_rate,@interest_amount,@total_amount,@paid_amount,
       @due_amount,@monthly_amount,@installment_count,@remaining_installments,@frequency,@start_date,
       @next_due_date,@status,@grace_period_days,@late_fee,@notes)
  `).run(installmentRow)
  enqueue.push({ table: 'installments', id: installmentId, row: installmentRow })

  for (let i = 1; i <= months; i++) {
    const dueDate = addMonths(startDate, i)
    const scheduleId = crypto.randomUUID()
    const scheduleRow = {
      id: scheduleId, installment_id: installmentId, installment_no: i, due_date: dueDate,
      principal: monthlyAmount, interest: 0, total_due: monthlyAmount,
    }
    db.prepare(`
      INSERT INTO installment_schedule
        (id, installment_id, installment_no, due_date, principal, interest, total_due)
      VALUES (@id,@installment_id,@installment_no,@due_date,@principal,@interest,@total_due)
    `).run(scheduleRow)
    enqueue.push({ table: 'installment_schedule', id: scheduleId, row: scheduleRow })

    for (const offset of [7, 3, 0]) {
      const scheduled = new Date(`${dueDate}T00:00:00`)
      scheduled.setDate(scheduled.getDate() - offset)
      const reminderId = crypto.randomUUID()
      const reminderRow = {
        id: reminderId, installment_id: installmentId,
        channel: 'sms', reminder_type: offset === 0 ? 'due_today' : `${offset}_days_before`,
        message: `Chit repayment ${contractNumber}: Rs.${monthlyAmount} due on ${dueDate}`,
        scheduled_at: scheduled.toISOString().slice(0, 10),
      }
      db.prepare(`
        INSERT INTO installment_reminders
          (id, installment_id, channel, reminder_type, message, scheduled_at)
        VALUES (@id,@installment_id,@channel,@reminder_type,@message,@scheduled_at)
      `).run(reminderRow)
      enqueue.push({ table: 'installment_reminders', id: reminderId, row: reminderRow })
    }
  }

  return { installmentId, enqueue }
}

export function registerChitHandlers(ipcMain: IpcMain) {
  ipcMain.handle('chits:list', (_e, filters: Record<string, unknown> = {}) => {
    try {
      const db = getDb()
      const caller = authUser()
      const perms = currentPerms(caller)
      const isGlobal = Boolean(perms.all || perms.customers)
      const branchId = (filters.branch_id as string | undefined)
        || (!isGlobal ? caller.branch_id as string | undefined : undefined)

      const conditions: string[] = []
      const params: unknown[] = []
      if (branchId) { conditions.push('cs.branch_id = ?'); params.push(branchId) }
      if (filters.status) { conditions.push('cs.status = ?'); params.push(filters.status) }
      if (filters.search) {
        conditions.push('(cs.name LIKE ? OR cs.scheme_number LIKE ?)')
        params.push(`%${filters.search}%`, `%${filters.search}%`)
      }
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

      const rows = db.prepare(`
        SELECT cs.*, b.name as branch_name, a.name as agent_name, a.code as agent_code,
          p.name as product_name,
          (SELECT COUNT(*) FROM chit_members m WHERE m.scheme_id = cs.id AND m.status != 'withdrawn') as members_enrolled,
          (SELECT COUNT(*) FROM chit_draws d WHERE d.scheme_id = cs.id) as cycles_completed,
          (SELECT COALESCE(SUM(amount),0) FROM chit_contributions c WHERE c.scheme_id = cs.id AND c.status = 'approved') as contributions_collected
        FROM chit_schemes cs
        LEFT JOIN branches b ON b.id = cs.branch_id
        LEFT JOIN agents a ON a.id = cs.agent_id
        LEFT JOIN products p ON p.id = cs.product_id
        ${where}
        ORDER BY cs.created_at DESC
      `).all(...params)
      return { success: true, data: rows }
    } catch (err: unknown) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle('chits:get', (_e, id: string) => {
    try {
      const db = getDb()
      const scheme = db.prepare(`
        SELECT cs.*, b.name as branch_name, a.name as agent_name, a.code as agent_code, p.name as product_name
        FROM chit_schemes cs
        LEFT JOIN branches b ON b.id = cs.branch_id
        LEFT JOIN agents a ON a.id = cs.agent_id
        LEFT JOIN products p ON p.id = cs.product_id
        WHERE cs.id = ?
      `).get(id)
      if (!scheme) return { success: false, error: 'Chit scheme not found' }

      const members = db.prepare(`
        SELECT m.*, c.name as customer_name, c.phone as customer_phone,
          i.status as repayment_status, i.due_amount as repayment_due
        FROM chit_members m
        LEFT JOIN customers c ON c.id = m.customer_id
        LEFT JOIN installments i ON i.id = m.installment_id
        WHERE m.scheme_id = ?
        ORDER BY m.join_order
      `).all(id)

      const draws = db.prepare(`
        SELECT d.*, c.name as winner_name
        FROM chit_draws d
        LEFT JOIN chit_members m ON m.id = d.winner_member_id
        LEFT JOIN customers c ON c.id = m.customer_id
        WHERE d.scheme_id = ?
        ORDER BY d.cycle_no
      `).all(id)

      const contributionSummary = db.prepare(`
        SELECT COALESCE(SUM(amount),0) as total_collected,
          COALESCE(SUM(commission_amount),0) as total_commission,
          COUNT(*) as contribution_count
        FROM chit_contributions WHERE scheme_id = ? AND status = 'approved'
      `).get(id)

      return { success: true, data: { scheme, members, draws, contributionSummary } }
    } catch (err: unknown) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle('chits:create', async (_e, payload: Record<string, unknown>) => {
    try {
      const perms = currentPerms()
      if (!canManage(perms)) return { success: false, error: 'Customer management access required' }

      const db = getDb()
      const caller = authUser()
      const branchId = String(payload.branch_id || caller.branch_id || defaultBranchId())
      const name = String(payload.name || '').trim()
      const memberCount = Number(payload.member_count) || 0
      const cycleCount = Number(payload.cycle_count) || memberCount
      if (!name) return { success: false, error: 'Scheme name is required' }
      if (memberCount <= 0) return { success: false, error: 'Member count must be greater than 0' }
      if (cycleCount <= 0) return { success: false, error: 'Cycle count must be greater than 0' }

      const id = crypto.randomUUID()
      const schemeNumber = nextChitNumber(db, branchId)
      const row = {
        id, scheme_number: schemeNumber, name, branch_id: branchId,
        product_id: payload.product_id || null, agent_id: payload.agent_id || null,
        member_count: memberCount, cycle_count: cycleCount,
        frequency: payload.frequency || 'monthly',
        contribution_amount: money(Number(payload.contribution_amount) || 0),
        chit_value: money(Number(payload.chit_value) || 0),
        early_redemption_count: Number(payload.early_redemption_count) || 0,
        early_redemption_amount: money(Number(payload.early_redemption_amount) || 0),
        repayment_months: Number(payload.repayment_months) || 12,
        agent_commission_pct: Number(payload.agent_commission_pct) || 0,
        start_date: payload.start_date || new Date().toISOString().slice(0, 10),
        next_draw_date: payload.next_draw_date || null,
        status: 'active', notes: payload.notes || null, created_by: caller.id || null,
      }
      db.prepare(`
        INSERT INTO chit_schemes
          (id, scheme_number, name, branch_id, product_id, agent_id, member_count, cycle_count,
           frequency, contribution_amount, chit_value, early_redemption_count, early_redemption_amount,
           repayment_months, agent_commission_pct, start_date, next_draw_date, status, notes, created_by)
        VALUES (@id,@scheme_number,@name,@branch_id,@product_id,@agent_id,@member_count,@cycle_count,
           @frequency,@contribution_amount,@chit_value,@early_redemption_count,@early_redemption_amount,
           @repayment_months,@agent_commission_pct,@start_date,@next_draw_date,@status,@notes,@created_by)
      `).run(row)
      await enqueuSync('chit_schemes', id, 'INSERT', row)
      return { success: true, data: { id, scheme_number: schemeNumber } }
    } catch (err: unknown) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle('chits:update', async (_e, id: string, payload: Record<string, unknown>) => {
    try {
      const perms = currentPerms()
      if (!canManage(perms)) return { success: false, error: 'Customer management access required' }

      const db = getDb()
      const existing = db.prepare('SELECT id FROM chit_schemes WHERE id = ?').get(id)
      if (!existing) return { success: false, error: 'Chit scheme not found' }

      const update: Record<string, unknown> = { ...payload }
      delete update.id
      delete update.scheme_number
      const numericKeys = ['member_count', 'cycle_count', 'contribution_amount', 'chit_value',
        'early_redemption_count', 'early_redemption_amount', 'repayment_months', 'agent_commission_pct']
      for (const k of numericKeys) if (update[k] !== undefined) update[k] = Number(update[k]) || 0

      const fields = Object.keys(update).map(k => `${k} = @${k}`).join(', ')
      if (fields) db.prepare(`UPDATE chit_schemes SET ${fields}, updated_at = datetime('now') WHERE id = @id`).run({ ...update, id })
      await enqueuSync('chit_schemes', id, 'UPDATE', { id, ...update })
      return { success: true }
    } catch (err: unknown) { return { success: false, error: (err as Error).message } }
  })

  // ── Members: individual add ─────────────────────────────────────────────
  ipcMain.handle('chits:members:add', async (_e, schemeId: string, payload: Record<string, unknown>) => {
    try {
      const perms = currentPerms()
      if (!canManage(perms)) return { success: false, error: 'Customer management access required' }

      const db = getDb()
      const scheme = db.prepare('SELECT * FROM chit_schemes WHERE id=?').get(schemeId) as Record<string, unknown> | undefined
      if (!scheme) return { success: false, error: 'Chit scheme not found' }

      const enrolled = db.prepare(`SELECT COUNT(*) as c FROM chit_members WHERE scheme_id=? AND status != 'withdrawn'`).get(schemeId) as { c: number }
      if (enrolled.c >= Number(scheme.member_count)) return { success: false, error: 'This chit scheme is already full' }

      let customerId = String(payload.customer_id || '')
      const enqueue: Array<{ table: string; id: string; row: Record<string, unknown> }> = []

      const memberId = crypto.randomUUID()
      const nextOrder = (db.prepare('SELECT COALESCE(MAX(join_order),0) as m FROM chit_members WHERE scheme_id=?').get(schemeId) as { m: number }).m + 1

      db.transaction(() => {
        if (!customerId) {
          customerId = crypto.randomUUID()
          const customerRow = {
            id: customerId, branch_id: scheme.branch_id,
            name: payload.customer_name || 'Chit Member', phone: payload.customer_phone || null,
            email: payload.customer_email || null, address: payload.customer_address || null,
            nic: payload.customer_nic || null, notes: 'Created from Chit Fund enrollment',
          }
          db.prepare(`
            INSERT INTO customers (id, branch_id, name, phone, email, address, nic, notes)
            VALUES (@id,@branch_id,@name,@phone,@email,@address,@nic,@notes)
          `).run(customerRow)
          enqueue.push({ table: 'customers', id: customerId, row: customerRow })
        }

        const isEarly = nextOrder <= Number(scheme.early_redemption_count)
        const memberRow = {
          id: memberId, scheme_id: schemeId, customer_id: customerId, join_order: nextOrder,
          is_early_redemption: isEarly ? 1 : 0, redemption_type: null, won_cycle_no: null,
          product_received_at: null, contributions_paid: 0, installment_id: null,
          status: 'active', eligibility_note: null,
        }
        db.prepare(`
          INSERT INTO chit_members
            (id, scheme_id, customer_id, join_order, is_early_redemption, redemption_type,
             won_cycle_no, product_received_at, contributions_paid, installment_id, status, eligibility_note)
          VALUES (@id,@scheme_id,@customer_id,@join_order,@is_early_redemption,@redemption_type,
             @won_cycle_no,@product_received_at,@contributions_paid,@installment_id,@status,@eligibility_note)
        `).run(memberRow)
        enqueue.push({ table: 'chit_members', id: memberId, row: memberRow })
      })()

      for (const item of enqueue) await enqueuSync(item.table, item.id, 'INSERT', item.row)
      return { success: true, data: { id: memberId, join_order: nextOrder } }
    } catch (err: unknown) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle('chits:members:remove', async (_e, memberId: string) => {
    try {
      const perms = currentPerms()
      if (!canManage(perms)) return { success: false, error: 'Customer management access required' }

      const db = getDb()
      const member = db.prepare('SELECT id, status FROM chit_members WHERE id=?').get(memberId) as { id: string; status: string } | undefined
      if (!member) return { success: false, error: 'Member not found' }
      if (member.status === 'redeemed') return { success: false, error: 'Cannot withdraw a member who has already received their product' }

      db.prepare(`UPDATE chit_members SET status='withdrawn', updated_at=datetime('now') WHERE id=?`).run(memberId)
      await enqueuSync('chit_members', memberId, 'UPDATE', { id: memberId, status: 'withdrawn' })
      return { success: true }
    } catch (err: unknown) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle('chits:members:list', (_e, schemeId: string) => {
    try {
      const db = getDb()
      const rows = db.prepare(`
        SELECT m.*, c.name as customer_name, c.phone as customer_phone
        FROM chit_members m
        LEFT JOIN customers c ON c.id = m.customer_id
        WHERE m.scheme_id = ?
        ORDER BY m.join_order
      `).all(schemeId)
      return { success: true, data: rows }
    } catch (err: unknown) { return { success: false, error: (err as Error).message } }
  })

  // ── Members: bulk upload (Excel/CSV), same shape as agents:downloadTemplate/importExcel ──
  ipcMain.handle('chits:members:downloadTemplate', async () => {
    try {
      const perms = currentPerms()
      if (!canManage(perms)) return { success: false, error: 'Customer management access required' }

      const saveResult = await dialog.showSaveDialog({
        title: 'Save Chit Member Import Template',
        defaultPath: 'chit-member-import-template.xlsx',
        filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }],
      })
      if (saveResult.canceled || !saveResult.filePath) return { success: false, cancelled: true }

      const wb = XLSX.utils.book_new()
      const sample = [
        { 'Customer Name': 'Kamala Perera', 'Phone': '0771234567', 'Email': '', 'NIC': '', 'Address': '' },
        { 'Customer Name': '', 'Phone': '', 'Email': '', 'NIC': '', 'Address': '' },
      ]
      const ws = XLSX.utils.json_to_sheet(sample)
      ws['!cols'] = [{ wch: 22 }, { wch: 16 }, { wch: 26 }, { wch: 16 }, { wch: 30 }]
      XLSX.utils.book_append_sheet(wb, ws, 'Members')

      const instructions = XLSX.utils.aoa_to_sheet([
        ['Column', 'Required', 'Rules'],
        ['Customer Name', 'Yes', 'Full name of the member'],
        ['Phone', 'Yes', '9-12 digits, optional leading +'],
        ['Email', 'No', 'Must be a valid email if provided'],
        ['NIC', 'No', 'Sri Lankan NIC format if provided'],
        ['Address', 'No', 'Free text'],
        [],
        ['Members are enrolled in the order rows appear in this file. Join order determines early-redemption eligibility.'],
        ['Upload this file from the Chit Fund scheme page → Bulk Import Members.'],
      ])
      instructions['!cols'] = [{ wch: 18 }, { wch: 10 }, { wch: 70 }]
      XLSX.utils.book_append_sheet(wb, instructions, 'Instructions')

      XLSX.writeFile(wb, saveResult.filePath)
      return { success: true, filePath: saveResult.filePath }
    } catch (err: unknown) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle('chits:members:importExcel', async (_e, schemeId: string) => {
    try {
      const perms = currentPerms()
      if (!canManage(perms)) return { success: false, error: 'Customer management access required' }

      const db = getDb()
      const scheme = db.prepare('SELECT * FROM chit_schemes WHERE id=?').get(schemeId) as Record<string, unknown> | undefined
      if (!scheme) return { success: false, error: 'Chit scheme not found' }

      const { filePaths } = await dialog.showOpenDialog({
        title: 'Select Chit Member Import File',
        filters: [{ name: 'Excel / CSV', extensions: ['xlsx', 'xls', 'csv'] }],
        properties: ['openFile'],
      })
      if (!filePaths || filePaths.length === 0) return { success: false, cancelled: true }

      const workbook = XLSX.readFile(filePaths[0])
      const sheetName = workbook.SheetNames.find(n => n.toLowerCase() === 'members') || workbook.SheetNames[0]
      const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' }) as Record<string, unknown>[]

      let imported = 0
      let skipped = 0
      const errors: string[] = []
      let nextOrder = (db.prepare('SELECT COALESCE(MAX(join_order),0) as m FROM chit_members WHERE scheme_id=?').get(schemeId) as { m: number }).m
      const capacity = Number(scheme.member_count) - (db.prepare(`SELECT COUNT(*) as c FROM chit_members WHERE scheme_id=? AND status != 'withdrawn'`).get(schemeId) as { c: number }).c

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i]
        const rowNum = i + 2
        const name = importCell(row, 'Customer Name', 'Name')
        const phone = importCell(row, 'Phone')
        const email = importCell(row, 'Email')
        const nic = importCell(row, 'NIC')
        const address = importCell(row, 'Address')

        if (!name && !phone) continue // fully blank row
        if (imported >= capacity) { errors.push(`Row ${rowNum}: skipped — chit scheme is full`); skipped++; continue }
        if (!name) { errors.push(`Row ${rowNum}: customer name is required`); skipped++; continue }
        if (!phone) { errors.push(`Row ${rowNum}: phone is required`); skipped++; continue }
        if (!PHONE_RE.test(phone)) { errors.push(`Row ${rowNum}: invalid phone "${phone}"`); skipped++; continue }
        if (email && !EMAIL_RE.test(email)) { errors.push(`Row ${rowNum}: invalid email "${email}"`); skipped++; continue }
        if (nic && !NIC_RE.test(nic)) { errors.push(`Row ${rowNum}: invalid NIC "${nic}"`); skipped++; continue }

        try {
          const customerId = crypto.randomUUID()
          const customerRow = {
            id: customerId, branch_id: scheme.branch_id, name, phone,
            email: email || null, address: address || null, nic: nic || null,
            notes: 'Created from Chit Fund bulk import',
          }
          db.prepare(`
            INSERT INTO customers (id, branch_id, name, phone, email, address, nic, notes)
            VALUES (@id,@branch_id,@name,@phone,@email,@address,@nic,@notes)
          `).run(customerRow)
          await enqueuSync('customers', customerId, 'INSERT', customerRow)

          nextOrder += 1
          const memberId = crypto.randomUUID()
          const isEarly = nextOrder <= Number(scheme.early_redemption_count)
          const memberRow = {
            id: memberId, scheme_id: schemeId, customer_id: customerId, join_order: nextOrder,
            is_early_redemption: isEarly ? 1 : 0, redemption_type: null, won_cycle_no: null,
            product_received_at: null, contributions_paid: 0, installment_id: null,
            status: 'active', eligibility_note: null,
          }
          db.prepare(`
            INSERT INTO chit_members
              (id, scheme_id, customer_id, join_order, is_early_redemption, redemption_type,
               won_cycle_no, product_received_at, contributions_paid, installment_id, status, eligibility_note)
            VALUES (@id,@scheme_id,@customer_id,@join_order,@is_early_redemption,@redemption_type,
               @won_cycle_no,@product_received_at,@contributions_paid,@installment_id,@status,@eligibility_note)
          `).run(memberRow)
          await enqueuSync('chit_members', memberId, 'INSERT', memberRow)
          imported++
        } catch (err: unknown) {
          errors.push(`Row ${rowNum}: ${(err as Error).message}`)
          skipped++
        }
      }

      return { success: true, imported, skipped, errors: errors.slice(0, 50) }
    } catch (err: unknown) { return { success: false, error: (err as Error).message } }
  })

  // ── Draws ────────────────────────────────────────────────────────────────
  ipcMain.handle('chits:draws:eligible', (_e, schemeId: string, cycleNo: number) => {
    try {
      const db = getDb()
      // A member is eligible if active, not yet redeemed, and has no unpaid
      // contribution for any prior cycle (standard chit practice — missed a
      // payment, sit out the draw until caught up).
      const rows = db.prepare(`
        SELECT m.*, c.name as customer_name, c.phone as customer_phone
        FROM chit_members m
        LEFT JOIN customers c ON c.id = m.customer_id
        WHERE m.scheme_id = ? AND m.status = 'active' AND m.redemption_type IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM chit_contributions cc
            WHERE cc.member_id = m.id AND cc.contribution_type = 'cycle'
              AND cc.cycle_no < ? AND cc.status = 'rejected'
          )
        ORDER BY m.join_order
      `).all(schemeId, cycleNo)
      return { success: true, data: rows }
    } catch (err: unknown) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle('chits:draws:conduct', async (_e, schemeId: string, cycleNo: number, options: { method?: 'random' | 'manual_pick'; winnerMemberId?: string } = {}) => {
    try {
      const perms = currentPerms()
      if (!canManage(perms)) return { success: false, error: 'Customer management access required' }

      const db = getDb()
      const caller = authUser()
      const scheme = db.prepare('SELECT * FROM chit_schemes WHERE id=?').get(schemeId) as Record<string, unknown> | undefined
      if (!scheme) return { success: false, error: 'Chit scheme not found' }

      const existingDraw = db.prepare('SELECT id FROM chit_draws WHERE scheme_id=? AND cycle_no=?').get(schemeId, cycleNo)
      if (existingDraw) return { success: false, error: `Cycle ${cycleNo} has already been drawn` }

      const eligible = db.prepare(`
        SELECT m.* FROM chit_members m
        WHERE m.scheme_id = ? AND m.status = 'active' AND m.redemption_type IS NULL
      `).all(schemeId) as Record<string, unknown>[]
      if (eligible.length === 0) return { success: false, error: 'No eligible members remain for this scheme' }

      const isFinalCycle = cycleNo >= Number(scheme.cycle_count)
      const enqueue: Array<{ table: string; id: string; row: Record<string, unknown>; op: 'INSERT' | 'UPDATE' }> = []
      const drawId = crypto.randomUUID()

      db.transaction(() => {
        let winners: Record<string, unknown>[]
        let method: string

        if (isFinalCycle) {
          // Final cycle: every remaining member receives their product together.
          winners = eligible
          method = 'final_batch'
        } else {
          method = options.method || 'random'
          let winner: Record<string, unknown> | undefined
          if (method === 'manual_pick') {
            winner = eligible.find(m => m.id === options.winnerMemberId)
            if (!winner) throw new Error('Selected member is not eligible for this draw')
          } else {
            winner = eligible[crypto.randomInt(eligible.length)]
          }
          winners = [winner]
        }

        const drawRow = {
          id: drawId, scheme_id: schemeId, cycle_no: cycleNo,
          draw_date: new Date().toISOString().slice(0, 10),
          winner_member_id: winners.length === 1 ? winners[0].id : null,
          settled_count: winners.length, eligible_count: eligible.length,
          method, conducted_by: caller.id || null, notes: null,
        }
        db.prepare(`
          INSERT INTO chit_draws
            (id, scheme_id, cycle_no, draw_date, winner_member_id, settled_count, eligible_count, method, conducted_by, notes)
          VALUES (@id,@scheme_id,@cycle_no,@draw_date,@winner_member_id,@settled_count,@eligible_count,@method,@conducted_by,@notes)
        `).run(drawRow)
        enqueue.push({ table: 'chit_draws', id: drawId, row: drawRow, op: 'INSERT' })

        for (const winner of winners) {
          const principalRemaining = money(Number(scheme.chit_value) - Number(winner.contributions_paid || 0))
          const repayment = generateChitRepaymentSchedule(
            db, scheme, winner, principalRemaining,
            `${scheme.scheme_number}-M${winner.join_order}`
          )
          for (const item of repayment?.enqueue || []) enqueue.push({ ...item, op: 'INSERT' })

          db.prepare(`
            UPDATE chit_members
            SET redemption_type=?, won_cycle_no=?, product_received_at=date('now'),
                installment_id=?, status='redeemed', updated_at=datetime('now')
            WHERE id=?
          `).run(isFinalCycle ? 'final_batch' : 'draw', cycleNo, repayment?.installmentId || null, winner.id)
          enqueue.push({
            table: 'chit_members', id: String(winner.id), op: 'UPDATE',
            row: {
              id: winner.id, redemption_type: isFinalCycle ? 'final_batch' : 'draw',
              won_cycle_no: cycleNo, product_received_at: new Date().toISOString().slice(0, 10),
              installment_id: repayment?.installmentId || null, status: 'redeemed',
            },
          })
        }

        logAudit(db, {
          userId: (caller.id as string) || null, branchId: (scheme.branch_id as string) || null,
          action: isFinalCycle ? 'CHIT_FINAL_SETTLEMENT' : 'CHIT_DRAW_CONDUCTED',
          tableName: 'chit_draws', recordId: drawId,
          newValues: { cycleNo, winnerCount: winners.length, method },
        })
      })()

      for (const item of enqueue) await enqueuSync(item.table, item.id, item.op, item.row)
      return { success: true, data: { drawId, isFinalCycle, settledCount: isFinalCycle ? eligible.length : 1 } }
    } catch (err: unknown) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle('chits:draws:list', (_e, schemeId: string) => {
    try {
      const db = getDb()
      const rows = db.prepare(`
        SELECT d.*, c.name as winner_name
        FROM chit_draws d
        LEFT JOIN chit_members m ON m.id = d.winner_member_id
        LEFT JOIN customers c ON c.id = m.customer_id
        WHERE d.scheme_id = ?
        ORDER BY d.cycle_no
      `).all(schemeId)
      return { success: true, data: rows }
    } catch (err: unknown) { return { success: false, error: (err as Error).message } }
  })

  // ── Early redemption ────────────────────────────────────────────────────
  ipcMain.handle('chits:members:earlyRedeem', async (_e, memberId: string, payload: Record<string, unknown>) => {
    try {
      const perms = currentPerms()
      if (!canManage(perms)) return { success: false, error: 'Customer management access required' }

      const db = getDb()
      const caller = authUser()
      const member = db.prepare('SELECT * FROM chit_members WHERE id=?').get(memberId) as Record<string, unknown> | undefined
      if (!member) return { success: false, error: 'Member not found' }
      if (!member.is_early_redemption) return { success: false, error: 'This member is not eligible for early redemption' }
      if (member.redemption_type) return { success: false, error: 'This member has already received their product' }

      const scheme = db.prepare('SELECT * FROM chit_schemes WHERE id=?').get(member.scheme_id) as Record<string, unknown>
      const amount = money(Number(payload.amount) || 0)
      if (amount < Number(scheme.early_redemption_amount)) {
        return { success: false, error: `Early redemption requires at least Rs.${scheme.early_redemption_amount}` }
      }

      const contributionId = crypto.randomUUID()
      const enqueue: Array<{ table: string; id: string; row: Record<string, unknown>; op: 'INSERT' | 'UPDATE' }> = []

      db.transaction(() => {
        const commission = money(amount * Number(scheme.agent_commission_pct) / 100)
        const contributionRow = {
          id: contributionId, scheme_id: member.scheme_id, member_id: memberId, cycle_no: null,
          contribution_type: 'early_redemption', amount, method: payload.method || 'cash',
          receipt_number: payload.receipt_number || null, reference: payload.reference || null,
          status: 'approved', received_by: caller.id || null, branch_id: scheme.branch_id,
          commission_amount: commission, notes: payload.notes || null,
        }
        db.prepare(`
          INSERT INTO chit_contributions
            (id, scheme_id, member_id, cycle_no, contribution_type, amount, method, receipt_number,
             reference, status, received_by, branch_id, commission_amount, notes)
          VALUES (@id,@scheme_id,@member_id,@cycle_no,@contribution_type,@amount,@method,@receipt_number,
             @reference,@status,@received_by,@branch_id,@commission_amount,@notes)
        `).run(contributionRow)
        enqueue.push({ table: 'chit_contributions', id: contributionId, row: contributionRow, op: 'INSERT' })

        const principalRemaining = money(Number(scheme.chit_value) - amount)
        const repayment = generateChitRepaymentSchedule(
          db, scheme, member, principalRemaining,
          `${scheme.scheme_number}-M${member.join_order}`
        )
        for (const item of repayment?.enqueue || []) enqueue.push({ ...item, op: 'INSERT' })

        db.prepare(`
          UPDATE chit_members
          SET redemption_type='early', product_received_at=date('now'), installment_id=?,
              contributions_paid=contributions_paid+?, status='redeemed', updated_at=datetime('now')
          WHERE id=?
        `).run(repayment?.installmentId || null, amount, memberId)
        enqueue.push({
          table: 'chit_members', id: memberId, op: 'UPDATE',
          row: {
            id: memberId, redemption_type: 'early', product_received_at: new Date().toISOString().slice(0, 10),
            installment_id: repayment?.installmentId || null,
            contributions_paid: money(Number(member.contributions_paid || 0) + amount), status: 'redeemed',
          },
        })

        logAudit(db, {
          userId: (caller.id as string) || null, branchId: (scheme.branch_id as string) || null,
          action: 'CHIT_EARLY_REDEMPTION', tableName: 'chit_members', recordId: memberId,
          newValues: { amount },
        })
      })()

      for (const item of enqueue) await enqueuSync(item.table, item.id, item.op, item.row)
      return { success: true, data: { contributionId } }
    } catch (err: unknown) { return { success: false, error: (err as Error).message } }
  })

  // ── Contributions (pre-delivery waiting-period payments) ────────────────
  ipcMain.handle('chits:contributions:record', async (_e, memberId: string, payload: Record<string, unknown>) => {
    try {
      const db = getDb()
      const caller = authUser()
      const member = db.prepare('SELECT * FROM chit_members WHERE id=?').get(memberId) as Record<string, unknown> | undefined
      if (!member) return { success: false, error: 'Member not found' }
      const scheme = db.prepare('SELECT * FROM chit_schemes WHERE id=?').get(member.scheme_id) as Record<string, unknown>

      const amount = money(Number(payload.amount) || 0)
      if (amount <= 0) return { success: false, error: 'Enter a valid amount' }
      const method = String(payload.method || 'cash')
      const status = method === 'bank_transfer' ? 'pending_verification' : 'approved'
      const commission = money(amount * Number(scheme.agent_commission_pct) / 100)
      const contributionId = crypto.randomUUID()

      const row = {
        id: contributionId, scheme_id: member.scheme_id, member_id: memberId,
        cycle_no: payload.cycle_no || null, contribution_type: 'cycle', amount, method,
        receipt_number: payload.receipt_number || null, reference: payload.reference || null,
        status, received_by: caller.id || null, branch_id: scheme.branch_id,
        commission_amount: status === 'approved' ? commission : 0, notes: payload.notes || null,
      }
      db.transaction(() => {
        db.prepare(`
          INSERT INTO chit_contributions
            (id, scheme_id, member_id, cycle_no, contribution_type, amount, method, receipt_number,
             reference, status, received_by, branch_id, commission_amount, notes)
          VALUES (@id,@scheme_id,@member_id,@cycle_no,@contribution_type,@amount,@method,@receipt_number,
             @reference,@status,@received_by,@branch_id,@commission_amount,@notes)
        `).run(row)
        if (status === 'approved') {
          db.prepare(`UPDATE chit_members SET contributions_paid=contributions_paid+?, updated_at=datetime('now') WHERE id=?`).run(amount, memberId)
        }
        logAudit(db, {
          userId: (caller.id as string) || null, branchId: (scheme.branch_id as string) || null,
          action: 'CHIT_CONTRIBUTION', tableName: 'chit_contributions', recordId: contributionId,
          newValues: { amount, method },
        })
      })()

      await enqueuSync('chit_contributions', contributionId, 'INSERT', row)
      if (status === 'approved') {
        await enqueuSync('chit_members', memberId, 'UPDATE', { id: memberId, contributions_paid: money(Number(member.contributions_paid || 0) + amount) })
      }
      return { success: true, data: { id: contributionId, status } }
    } catch (err: unknown) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle('chits:contributions:verify', async (_e, contributionId: string, action: 'approve' | 'reject', notes?: string) => {
    try {
      const db = getDb()
      const caller = authUser()
      const contribution = db.prepare('SELECT * FROM chit_contributions WHERE id=?').get(contributionId) as Record<string, unknown> | undefined
      if (!contribution) return { success: false, error: 'Contribution not found' }

      if (action === 'reject') {
        db.prepare(`UPDATE chit_contributions SET status='rejected', verified_by=?, verified_at=datetime('now'), rejected_reason=?, updated_at=datetime('now') WHERE id=?`)
          .run(caller.id || null, notes || null, contributionId)
      } else {
        const scheme = db.prepare('SELECT * FROM chit_schemes WHERE id=?').get(contribution.scheme_id) as Record<string, unknown>
        const commission = money(Number(contribution.amount) * Number(scheme.agent_commission_pct) / 100)
        db.transaction(() => {
          db.prepare(`UPDATE chit_contributions SET status='approved', verified_by=?, verified_at=datetime('now'), commission_amount=?, updated_at=datetime('now') WHERE id=?`)
            .run(caller.id || null, commission, contributionId)
          db.prepare(`UPDATE chit_members SET contributions_paid=contributions_paid+?, updated_at=datetime('now') WHERE id=?`)
            .run(Number(contribution.amount), contribution.member_id)
        })()
      }

      logAudit(db, {
        userId: (caller.id as string) || null, branchId: (contribution.branch_id as string) || null,
        action: action === 'approve' ? 'CHIT_CONTRIBUTION_APPROVED' : 'CHIT_CONTRIBUTION_REJECTED',
        tableName: 'chit_contributions', recordId: contributionId, newValues: { notes },
      })
      await enqueuSync('chit_contributions', contributionId, 'UPDATE', {
        id: contributionId, status: action === 'approve' ? 'approved' : 'rejected',
        verified_by: caller.id || null, rejected_reason: notes || null,
      })
      if (action === 'approve') {
        await enqueuSync('chit_members', String(contribution.member_id), 'UPDATE', { id: contribution.member_id })
      }
      return { success: true }
    } catch (err: unknown) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle('chits:contributions:pendingTransfers', (_e, filters: Record<string, unknown> = {}) => {
    try {
      const db = getDb()
      const conditions = [`cc.status = 'pending_verification'`]
      const params: unknown[] = []
      if (filters.scheme_id) { conditions.push('cc.scheme_id = ?'); params.push(filters.scheme_id) }
      const rows = db.prepare(`
        SELECT cc.*, cs.name as scheme_name, c.name as customer_name
        FROM chit_contributions cc
        LEFT JOIN chit_schemes cs ON cs.id = cc.scheme_id
        LEFT JOIN chit_members m ON m.id = cc.member_id
        LEFT JOIN customers c ON c.id = m.customer_id
        WHERE ${conditions.join(' AND ')}
        ORDER BY cc.paid_at DESC
      `).all(...params)
      return { success: true, data: rows }
    } catch (err: unknown) { return { success: false, error: (err as Error).message } }
  })

  // ── Reports ──────────────────────────────────────────────────────────────
  ipcMain.handle('chits:reports', (_e, filters: { schemeId?: string; branchId?: string; dateFrom?: string; dateTo?: string } = {}) => {
    try {
      const db = getDb()
      const conditions: string[] = []
      const params: unknown[] = []
      if (filters.schemeId) { conditions.push('cs.id = ?'); params.push(filters.schemeId) }
      if (filters.branchId) { conditions.push('cs.branch_id = ?'); params.push(filters.branchId) }
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

      const rows = db.prepare(`
        SELECT cs.id, cs.scheme_number, cs.name, cs.member_count, cs.cycle_count, cs.chit_value, cs.status,
          (SELECT COUNT(*) FROM chit_members m WHERE m.scheme_id = cs.id AND m.status != 'withdrawn') as members_enrolled,
          (SELECT COUNT(*) FROM chit_members m WHERE m.scheme_id = cs.id AND m.status = 'redeemed') as members_redeemed,
          (SELECT COUNT(*) FROM chit_draws d WHERE d.scheme_id = cs.id) as cycles_completed,
          (SELECT COALESCE(SUM(amount),0) FROM chit_contributions c WHERE c.scheme_id = cs.id AND c.status = 'approved') as contributions_collected,
          (SELECT COALESCE(SUM(commission_amount),0) FROM chit_contributions c WHERE c.scheme_id = cs.id AND c.status = 'approved') as commission_accrued,
          cs.next_draw_date
        FROM chit_schemes cs
        ${where}
        ORDER BY cs.created_at DESC
      `).all(...params)
      return { success: true, data: rows }
    } catch (err: unknown) { return { success: false, error: (err as Error).message } }
  })
}
