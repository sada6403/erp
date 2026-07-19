import type { IpcMain } from 'electron'
import { app, dialog } from 'electron'
import { getDb } from '../database'
import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import fs from 'fs'
import path from 'path'
import { enqueuSync, enqueueUserRow } from '../services/syncQueue'
import { logAudit } from '../services/auditLog'
import Store from 'electron-store'
import { categoryCodeFromName, titleCase } from '../lib/catalog'
import * as XLSX from 'xlsx'
import { safeHandle, safeHandleModule } from './ipcHandler'

const store = new Store()

function authUser(): Record<string, unknown> {
  return (store.get('auth_user') as Record<string, unknown> | undefined) || {}
}

const EMAIL_RE_ADMIN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function currentPerms(caller: Record<string, unknown> = authUser()): Record<string, unknown> {
  return ((caller.role as Record<string, unknown>)?.permissions as Record<string, unknown>)
    || (caller.permissions as Record<string, unknown>)
    || {}
}

function defaultBranchId() {
  return 'b1111111-1111-4111-8111-111111111111'
}

function addMonths(date: string, months: number): string {
  const d = new Date(`${date}T00:00:00`)
  d.setMonth(d.getMonth() + months)
  return d.toISOString().slice(0, 10)
}

function money(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100
}

function calculateInstallment(input: Record<string, unknown>) {
  const cashPrice = Number(input.cash_price || input.product_cash_price || 0)
  const downPayment = Number(input.down_payment || 0)
  const months = Number(input.months || input.installment_count || 12)
  const interestType = String(input.interest_type || 'flat')
  const interestRate = Number(input.interest_rate || 0)
  const financedAmount = Math.max(0, cashPrice - downPayment)
  let interestAmount = 0
  let monthlyAmount = months > 0 ? financedAmount / months : financedAmount

  if (interestType === 'no_interest' || interestRate <= 0) {
    interestAmount = 0
    monthlyAmount = months > 0 ? financedAmount / months : financedAmount
  } else if (interestType === 'reducing') {
    const r = interestRate / 100 / 12
    monthlyAmount = r > 0
      ? financedAmount * r * Math.pow(1 + r, months) / (Math.pow(1 + r, months) - 1)
      : financedAmount / months
    interestAmount = (monthlyAmount * months) - financedAmount
  } else {
    interestAmount = financedAmount * interestRate / 100
    monthlyAmount = (financedAmount + interestAmount) / months
  }

  const totalPayable = financedAmount + interestAmount
  return {
    cash_price: money(cashPrice),
    down_payment: money(downPayment),
    financed_amount: money(financedAmount),
    interest_type: interestType,
    interest_rate: interestRate,
    interest_amount: money(interestAmount),
    total_payable: money(totalPayable),
    monthly_amount: money(monthlyAmount),
    months,
  }
}

// Branch PINs are stored as bcrypt hashes (synced to the cloud). Legacy
// plaintext values (pre-hash installs) are still matched by direct equality.
async function findBranchByPin(
  pinValue: string,
  excludeId?: string
): Promise<Record<string, unknown> | undefined> {
  if (!pinValue) return undefined
  const db = getDb()
  const rows = db.prepare(
    `SELECT * FROM branches WHERE branch_pin IS NOT NULL AND branch_pin != '' AND is_active = 1`
  ).all() as Record<string, unknown>[]
  for (const row of rows) {
    if (excludeId && String(row.id) === excludeId) continue
    const stored = String(row.branch_pin)
    if (stored.startsWith('$2')) {
      if (await bcrypt.compare(pinValue, stored)) return row
    } else if (stored === pinValue) {
      return row
    }
  }
  return undefined
}

function nextInstallmentNumber(branchId: string) {
  const db = getDb()
  const year = new Date().getFullYear()
  const branch = db.prepare('SELECT code, name FROM branches WHERE id=?').get(branchId) as { code?: string; name?: string } | undefined
  const code = String(branch?.code || branch?.name?.slice(0, 4) || 'MAIN').toUpperCase().replace(/\s+/g, '')
  const count = db.prepare(`
    SELECT COUNT(*) AS count FROM installments
    WHERE branch_id = ? AND substr(created_at, 1, 4) = ?
  `).get(branchId, String(year)) as { count: number }
  return `${code}-INS-${year}-${String(Number(count?.count || 0) + 1).padStart(4, '0')}`
}

export function registerAdminHandlers(ipcMain: IpcMain) {
  // Runtime migration — add branch_pin column if missing (handles cases where Electron wasn't restarted)
  try {
    const _db = getDb()
    const cols = _db.prepare('PRAGMA table_info(branches)').all() as { name: string }[]
    if (!cols.some(c => c.name === 'branch_pin')) {
      _db.exec('ALTER TABLE branches ADD COLUMN branch_pin TEXT')
      console.log('[DB] Runtime migration: added branches.branch_pin')
    }
  } catch { /* db not ready yet — main initDatabase() will handle it */ }

  // Branches
  safeHandle(ipcMain, 'admin:branches:list', () => {
    return { success: true, data: getDb().prepare('SELECT * FROM branches ORDER BY name').all() }
  })
  safeHandle(ipcMain, 'admin:branches:findByCode', async (_e, code: string) => {
    const db = getDb()
    const val = code.trim()
    // Prioritise exact code match; fall back to PIN match (PINs are bcrypt-hashed)
    let row = db.prepare(
      `SELECT * FROM branches WHERE UPPER(code) = UPPER(?) AND is_active = 1 LIMIT 1`
    ).get(val) as Record<string, unknown> | undefined
    if (!row) row = await findBranchByPin(val)
    return { success: true, data: row || null }
  })
  safeHandle(ipcMain, 'admin:branches:create', async (_e, p) => {
    const caller = authUser()
    if (!currentPerms(caller).all) return { success: false, error: 'Company Admin access required to create branches' }

    const db = getDb()
    const id = crypto.randomUUID()
    const rawPin = p.branch_pin ? String(p.branch_pin) : ''
    if (rawPin) {
      const dup = await findBranchByPin(rawPin)
      if (dup) return { success: false, error: 'Another branch already uses this PIN. Choose a different PIN.' }
    }
    // Store + sync only the bcrypt hash of the branch PIN
    const pinHash = rawPin ? await bcrypt.hash(rawPin, 10) : null
    db.prepare(`INSERT INTO branches (id,name,address,phone,email,code,branch_pin) VALUES (?,?,?,?,?,?,?)`)
      .run(id, p.name, p.address||null, p.phone||null, p.email||null, p.code||null, pinHash)
    await enqueuSync('branches', id, 'INSERT', { ...p, id, branch_pin: pinHash })

    // Auto-create Branch Manager for this branch if a branch_pin was provided
    if (rawPin) {
      const BRANCH_MANAGER_ROLE_ID = '4b7c9d0e-2f3a-5b4c-9d0e-2f3a4b7c9d0e'
      const codeSlug = String(p.code || p.name).toUpperCase().replace(/\s+/g, '').slice(0, 10)
      const managerEmail = `manager.${codeSlug.toLowerCase()}@pos.local`
      const existingManager = db.prepare('SELECT id FROM users WHERE email = ?').get(managerEmail)
      if (!existingManager) {
        const userId = crypto.randomUUID()
        const passwordHash = await bcrypt.hash(rawPin, 10)
        const managerPinHash = await bcrypt.hash(rawPin, 10)
        db.prepare(`
          INSERT INTO users (id, branch_id, role_id, name, email, password_hash, pin_hash, is_active)
          VALUES (?, ?, ?, ?, ?, ?, ?, 1)
        `).run(userId, id, BRANCH_MANAGER_ROLE_ID, `${p.name} Manager`, managerEmail, passwordHash, managerPinHash)
        await enqueueUserRow(userId)
      }
    }

    return { success: true, data: { id } }
  })
  safeHandle(ipcMain, 'admin:branches:update', async (_e, id: string, p) => {
    const caller = authUser()
    if (!currentPerms(caller).all) return { success: false, error: 'Company Admin access required to update branches' }

    const db = getDb()
    const payload = { ...(p as Record<string, unknown>) }
    const rawPin = payload.branch_pin ? String(payload.branch_pin) : ''
    if (rawPin) {
      const dup = await findBranchByPin(rawPin, id)
      if (dup) return { success: false, error: 'Another branch already uses this PIN. Choose a different PIN.' }
      payload.branch_pin = await bcrypt.hash(rawPin, 10)
    }
    const existingCols = new Set(
      (db.prepare('PRAGMA table_info(branches)').all() as { name: string }[]).map(c => c.name)
    )
    const safe = Object.fromEntries(Object.entries(payload).filter(([k]) => existingCols.has(k)))
    const fields = Object.keys(safe).map(k => `${k}=@${k}`).join(',')
    if (fields) db.prepare(`UPDATE branches SET ${fields}, updated_at=datetime('now') WHERE id=@id`).run({...safe, id})
    await enqueuSync('branches', id, 'UPDATE', { ...payload, id })

    // If a branch_pin was set and no manager user exists yet, auto-create one
    if (rawPin) {
      const BRANCH_MANAGER_ROLE_ID = '4b7c9d0e-2f3a-5b4c-9d0e-2f3a4b7c9d0e'
      const branch = db.prepare('SELECT name, code FROM branches WHERE id=?').get(id) as { name: string; code: string } | undefined
      if (branch) {
        const existingManager = db.prepare(
          'SELECT id FROM users WHERE branch_id=? AND role_id=?'
        ).get(id, BRANCH_MANAGER_ROLE_ID) as { id: string } | undefined
        if (!existingManager) {
          const userId = crypto.randomUUID()
          const codeSlug = String(branch.code || branch.name).toUpperCase().replace(/\s+/g, '').slice(0, 10).toLowerCase()
          const managerEmail = `manager.${codeSlug}@pos.local`
          const safeEmail = db.prepare('SELECT id FROM users WHERE email=?').get(managerEmail)
            ? `manager.${codeSlug}.${userId.slice(0,4)}@pos.local`
            : managerEmail
          const passwordHash = await bcrypt.hash(rawPin, 10)
          const managerPinHash = await bcrypt.hash(rawPin, 10)
          db.prepare(`
            INSERT INTO users (id, branch_id, role_id, name, email, password_hash, pin_hash, is_active)
            VALUES (?, ?, ?, ?, ?, ?, ?, 1)
          `).run(userId, id, BRANCH_MANAGER_ROLE_ID, `${branch.name} Manager`, safeEmail, passwordHash, managerPinHash)
          await enqueueUserRow(userId)
        } else {
          // Manager exists — update their PIN to match the new branch PIN
          const managerPinHash = await bcrypt.hash(rawPin, 10)
          db.prepare(`UPDATE users SET pin_hash=?, pin=NULL, updated_at=datetime('now') WHERE branch_id=? AND role_id=?`)
            .run(managerPinHash, id, BRANCH_MANAGER_ROLE_ID)
          await enqueueUserRow(existingManager.id)
        }
      }
    }

    return { success: true }
  })
  safeHandle(ipcMain, 'admin:branches:delete', async (_e, id: string) => {
    const caller = authUser()
    const perms = ((caller.role as Record<string,unknown>)?.permissions as Record<string,unknown>) || caller.permissions as Record<string,unknown> || {}
    if (!perms.all) return { success: false, error: 'Company Admin access required to delete branches' }

    const db = getDb()
    const branch = db.prepare('SELECT id, name, code FROM branches WHERE id=?').get(id) as Record<string,unknown> | undefined
    if (!branch) return { success: false, error: 'Branch not found' }
    if (String(branch.id) === 'b1111111-1111-4111-8111-111111111111') return { success: false, error: 'The Main Branch cannot be deleted' }

    // Block if real business data exists (all users — not just active — have NOT NULL branch_id)
    const { cnt: userCnt } = db.prepare('SELECT COUNT(*) as cnt FROM users WHERE branch_id=?').get(id) as { cnt: number }
    if (userCnt > 0) return { success: false, error: `Cannot delete: ${userCnt} user(s) still assigned to this branch. Reassign or delete them first.` }

    const { cnt: invCnt } = db.prepare('SELECT COUNT(*) as cnt FROM invoices WHERE branch_id=?').get(id) as { cnt: number }
    if (invCnt > 0) return { success: false, error: `Cannot delete: ${invCnt} invoice(s) exist for this branch. Deactivate it instead.` }

    const { cnt: installCnt } = db.prepare('SELECT COUNT(*) as cnt FROM installments WHERE branch_id=?').get(id) as { cnt: number }
    if (installCnt > 0) return { success: false, error: `Cannot delete: ${installCnt} installment(s) exist for this branch.` }

    const { cnt: orderCnt } = db.prepare('SELECT COUNT(*) as cnt FROM customer_orders WHERE branch_id=?').get(id) as { cnt: number }
    if (orderCnt > 0) return { success: false, error: `Cannot delete: ${orderCnt} customer order(s) exist for this branch.` }

    const { cnt: poCnt } = db.prepare('SELECT COUNT(*) as cnt FROM purchase_orders WHERE branch_id=?').get(id) as { cnt: number }
    if (poCnt > 0) return { success: false, error: `Cannot delete: ${poCnt} purchase order(s) exist for this branch.` }

    // Disable FK checks for the duration of the cleanup (re-enabled in finally)
    db.pragma('foreign_keys = OFF')
    try {
      db.transaction(() => {
        // NULL out nullable branch_id refs (preserve history, just unlink)
        db.prepare('UPDATE customers            SET branch_id=NULL WHERE branch_id=?').run(id)
        db.prepare('UPDATE audit_logs           SET branch_id=NULL WHERE branch_id=?').run(id)
        db.prepare('UPDATE installment_payments SET branch_id=NULL WHERE branch_id=?').run(id)
        db.prepare('UPDATE expenses             SET branch_id=NULL WHERE branch_id=?').run(id)
        db.prepare('UPDATE product_batches      SET branch_id=NULL WHERE branch_id=?').run(id)
        db.prepare('UPDATE stock_movements      SET from_branch_id=NULL WHERE from_branch_id=?').run(id)
        db.prepare('UPDATE stock_movements      SET to_branch_id=NULL   WHERE to_branch_id=?').run(id)
        db.prepare('UPDATE stock_transfers      SET from_branch_id=NULL WHERE from_branch_id=?').run(id)
        db.prepare('UPDATE stock_transfers      SET to_branch_id=NULL   WHERE to_branch_id=?').run(id)

        // Delete operational records (no standalone business value)
        db.prepare('DELETE FROM credit_ledger        WHERE branch_id=?').run(id)
        db.prepare('DELETE FROM deliveries           WHERE branch_id=?').run(id)
        db.prepare('DELETE FROM stock_count_sessions WHERE branch_id=?').run(id)
        db.prepare('DELETE FROM stocks               WHERE branch_id=?').run(id)
        db.prepare('DELETE FROM warehouses           WHERE branch_id=?').run(id)
        db.prepare('DELETE FROM cash_sessions        WHERE branch_id=?').run(id)
        db.prepare('DELETE FROM bill_sequences       WHERE branch_id=?').run(id)

        db.prepare('DELETE FROM branches WHERE id=?').run(id)
      })()
    } finally {
      db.pragma('foreign_keys = ON')
    }

    await enqueuSync('branches', id, 'DELETE', { id })
    return { success: true }
  })

  // Users
  safeHandle(ipcMain, 'admin:users:list', () => {
    const caller = authUser()
    const perms  = (caller.permissions as Record<string, unknown>) || {}
    const isGlobal = Boolean(perms.all)
    const branchId = caller.branch_id as string | undefined

    // Super Admin / Company Admin → all users
    // Branch Manager (or anyone without global access) → own branch only
    // PINs are hashed — expose only whether one is set, never the value
    const rows = isGlobal
      ? getDb().prepare(`
          SELECT u.id, u.name, u.email, u.is_active, u.last_login_at,
                 u.role_id, u.branch_id,
                 CASE WHEN u.pin_hash IS NOT NULL OR u.pin IS NOT NULL THEN 1 ELSE 0 END as has_pin,
                 r.name as role_name, b.name as branch_name
          FROM users u
          LEFT JOIN roles r ON r.id = u.role_id
          LEFT JOIN branches b ON b.id = u.branch_id
          ORDER BY u.name
        `).all()
      : getDb().prepare(`
          SELECT u.id, u.name, u.email, u.is_active, u.last_login_at,
                 u.role_id, u.branch_id,
                 CASE WHEN u.pin_hash IS NOT NULL OR u.pin IS NOT NULL THEN 1 ELSE 0 END as has_pin,
                 r.name as role_name, b.name as branch_name
          FROM users u
          LEFT JOIN roles r ON r.id = u.role_id
          LEFT JOIN branches b ON b.id = u.branch_id
          WHERE u.branch_id = ?
          ORDER BY u.name
        `).all(branchId || '')

    return { success: true, data: rows }
  })
  safeHandle(ipcMain, 'admin:users:create', async (_e, p) => {
    const { getMaxUsers } = await import('../services/licenseService')
    const db = getDb()
    const maxUsers = getMaxUsers()
    const { cnt } = db.prepare('SELECT COUNT(*) as cnt FROM users').get() as { cnt: number }
    if (cnt >= maxUsers) {
      return { success: false, error: `User limit reached (${cnt}/${maxUsers}). Please upgrade your plan.` }
    }

    const caller = authUser()
    const perms  = currentPerms(caller)
    if (!perms.all && !perms.employees) {
      return { success: false, error: 'Employee management access required' }
    }
    // Non-global callers can only create users in their own branch, and
    // can never assign a role that itself carries admin-level permissions
    // (would otherwise let a Branch Manager mint a new Company Admin).
    if (!perms.all) {
      if (caller.branch_id) p.branch_id = caller.branch_id
      if (p.role_id) {
        const targetRole = db.prepare('SELECT permissions FROM roles WHERE id=?').get(p.role_id) as { permissions: string } | undefined
        const targetPerms = targetRole ? JSON.parse(targetRole.permissions || '{}') : {}
        if (targetPerms.all) return { success: false, error: 'Cannot assign Company Admin role' }
      }
    }

    const id = crypto.randomUUID()
    const hash = await bcrypt.hash(p.password, 10)
    const pinHash = p.pin ? await bcrypt.hash(String(p.pin), 10) : null
    db.prepare(`INSERT INTO users (id,branch_id,role_id,name,email,password_hash,pin_hash)
      VALUES (?,?,?,?,?,?,?)`)
      .run(id, p.branch_id||null, p.role_id, p.name, p.email, hash, pinHash)
    await enqueueUserRow(id)
    return { success: true, data: { id } }
  })
  safeHandle(ipcMain, 'admin:users:update', async (_e, id: string, p) => {
    const db = getDb()

    // Branch scope: non-global callers (e.g. Branch Manager) can only update
    // users of their own branch (including themselves).
    const caller = authUser()
    const perms  = currentPerms(caller)
    if (!perms.all) {
      const target = db.prepare('SELECT branch_id FROM users WHERE id=?').get(id) as { branch_id: string | null } | undefined
      if (!target) return { success: false, error: 'User not found' }
      if (!caller.branch_id || target.branch_id !== caller.branch_id) {
        return { success: false, error: 'Cannot update users from another branch' }
      }
      if (id !== caller.id && !perms.employees) {
        return { success: false, error: 'Employee management access required' }
      }
      // Branch-scoped callers must NEVER move users to another branch or
      // escalate roles — role_id was previously left untouched here, which
      // let any authenticated user self-promote by passing a Company Admin
      // role_id. Strip both regardless of who the target is.
      delete p.branch_id
      delete p.role_id
    }

    if (p.password) {
      p.password_hash = await bcrypt.hash(p.password, 10)
      delete p.password
    }
    // PINs are stored hashed only
    if (p.pin === '') delete p.pin
    if (p.pin) {
      p.pin_hash = await bcrypt.hash(String(p.pin), 10)
      delete p.pin
    }
    // Never clear branch_id or role_id with blank string — keep existing value
    if (p.branch_id === '') p.branch_id = null
    if (!p.role_id) delete p.role_id
    const fields = Object.keys(p).filter(k => k !== 'is_active' || p[k] !== undefined)
      .map(k=>`${k}=@${k}`).join(',')
    if (fields) db.prepare(`UPDATE users SET ${fields}, updated_at=datetime('now') WHERE id=@id`).run({...p,id})
    await enqueueUserRow(id)
    return { success: true }
  })

  safeHandle(ipcMain, 'admin:users:delete', (_e, id: string) => {
    const SUPER_ADMIN_ID = 'u9999999-9999-4999-8999-999999999999'
    if (id === SUPER_ADMIN_ID) return { success: false, error: 'Cannot delete super admin account' }
    const db = getDb()
    const user = db.prepare('SELECT id, name, branch_id FROM users WHERE id=?').get(id) as { id: string; name: string; branch_id: string | null } | undefined
    if (!user) return { success: false, error: 'User not found' }

    const caller = authUser()
    const perms  = currentPerms(caller)
    if (!perms.all && !perms.employees) {
      return { success: false, error: 'Employee management access required' }
    }
    if (!perms.all && caller.branch_id && user.branch_id !== caller.branch_id) {
      return { success: false, error: 'Cannot delete users from another branch' }
    }

    // Soft delete — just deactivate, preserve audit trail
    db.prepare(`UPDATE users SET is_active=0, updated_at=datetime('now') WHERE id=?`).run(id)
    logAudit(db, { userId: caller.id as string, branchId: caller.branch_id as string, action: 'USER_DEACTIVATED', tableName: 'users', recordId: id })
    void enqueueUserRow(id)
    return { success: true }
  })

  safeHandle(ipcMain, 'admin:users:hardDelete', (_e, id: string) => {
    const SUPER_ADMIN_ID = 'u9999999-9999-4999-8999-999999999999'
    if (id === SUPER_ADMIN_ID) return { success: false, error: 'Cannot permanently delete super admin account' }
    const db = getDb()
    const user = db.prepare('SELECT id, name FROM users WHERE id=?').get(id) as { id: string; name: string } | undefined
    if (!user) return { success: false, error: 'User not found' }

    const caller = authUser()
    if (id === String(caller.id)) return { success: false, error: 'Cannot delete your own account' }
    const perms = ((caller.role as Record<string,unknown>)?.permissions as Record<string,unknown>) || caller.permissions as Record<string,unknown> || {}
    if (!perms.all) return { success: false, error: 'Company Admin access required' }

    db.pragma('foreign_keys = OFF')
    try {
      db.transaction(() => {
        // NULL out all nullable refs to this user in other tables
        db.prepare('UPDATE audit_logs       SET user_id=NULL    WHERE user_id=?').run(id)
        db.prepare('UPDATE stock_movements  SET created_by=NULL WHERE created_by=?').run(id)
        db.prepare('UPDATE stock_transfers  SET approved_by=NULL, released_by=NULL, initiated_by=NULL, received_by=NULL WHERE approved_by=? OR released_by=? OR initiated_by=? OR received_by=?').run(id, id, id, id)
        db.prepare('UPDATE customer_orders  SET sales_staff_id=NULL WHERE sales_staff_id=?').run(id)
        db.prepare('UPDATE customer_orders  SET approved_by=NULL    WHERE approved_by=?').run(id)
        db.prepare('UPDATE customer_orders  SET released_by=NULL    WHERE released_by=?').run(id)
        db.prepare('UPDATE customer_orders  SET delivery_confirmed_by=NULL WHERE delivery_confirmed_by=?').run(id)
        db.prepare('UPDATE cash_sessions    SET opened_by=NULL  WHERE opened_by=?').run(id)
        db.prepare('UPDATE deliveries       SET assigned_to=NULL WHERE assigned_to=?').run(id)
        db.prepare('UPDATE installment_payments SET received_by=NULL, verified_by=NULL WHERE received_by=? OR verified_by=?').run(id, id)
        db.prepare('UPDATE stock_count_sessions SET created_by=NULL WHERE created_by=?').run(id)
        try { db.prepare('UPDATE stock_count_sessions SET completed_by=NULL WHERE completed_by=?').run(id) } catch { /* column may not exist on older DB */ }
        db.prepare('UPDATE expenses         SET created_by=NULL WHERE created_by=?').run(id)
        db.prepare('DELETE FROM users WHERE id=?').run(id)
      })()
    } finally {
      db.pragma('foreign_keys = ON')
    }

    return { success: true }
  })

  safeHandle(ipcMain, 'admin:users:toggleActive', (_e, id: string, active: boolean) => {
    const db = getDb()
    const caller = authUser()
    db.prepare(`UPDATE users SET is_active=?, updated_at=datetime('now') WHERE id=?`).run(active ? 1 : 0, id)
    logAudit(db, {
      userId: caller.id as string, branchId: caller.branch_id as string,
      action: active ? 'USER_ENABLED' : 'USER_DISABLED', tableName: 'users', recordId: id,
      newValues: { is_active: active },
    })
    void enqueueUserRow(id)
    return { success: true }
  })

  safeHandle(ipcMain, 'admin:users:resetPassword', async (_e, id: string, newPassword: string) => {
    if (!newPassword || newPassword.length < 8) return { success: false, error: 'Password must be at least 8 characters' }
    const db = getDb()
    const caller = authUser()
    const hash = await bcrypt.hash(newPassword, 10)
    db.prepare(`UPDATE users SET password_hash=?, force_password_change=1, updated_at=datetime('now') WHERE id=?`).run(hash, id)
    logAudit(db, { userId: caller.id as string, branchId: caller.branch_id as string, action: 'PASSWORD_RESET_BY_ADMIN', tableName: 'users', recordId: id })
    await enqueueUserRow(id)
    return { success: true }
  })

  safeHandle(ipcMain, 'admin:users:forcePasswordChange', (_e, id: string, force: boolean) => {
    const db = getDb()
    const caller = authUser()
    db.prepare(`UPDATE users SET force_password_change=?, updated_at=datetime('now') WHERE id=?`).run(force ? 1 : 0, id)
    logAudit(db, { userId: caller.id as string, branchId: caller.branch_id as string, action: 'FORCE_PASSWORD_CHANGE_SET', tableName: 'users', recordId: id })
    return { success: true }
  })

  safeHandle(ipcMain, 'admin:users:downloadTemplate', async () => {
    const perms = currentPerms()
    if (!perms.all && !perms.employees) return { success: false, error: 'Employee management access required' }

    const db = getDb()
    const roles = db.prepare('SELECT name FROM roles ORDER BY name').all() as { name: string }[]
    const branches = db.prepare('SELECT name FROM branches WHERE is_active = 1 ORDER BY name').all() as { name: string }[]

    const saveResult = await dialog.showSaveDialog({
      title: 'Save Employee Import Template',
      defaultPath: 'employee-import-template.xlsx',
      filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }],
    })
    if (saveResult.canceled || !saveResult.filePath) return { success: false, cancelled: true }

    const wb = XLSX.utils.book_new()
    const sample = [
      { 'Name': 'Nimal Perera', 'Role': roles.find(r => r.name !== 'Company Admin')?.name || 'Cashier', 'Branch': branches[0]?.name || 'Main Branch', 'Email': '', 'Password': '', 'PIN': '1234' },
      { 'Name': '', 'Role': '', 'Branch': '', 'Email': '', 'Password': '', 'PIN': '' },
    ]
    const ws = XLSX.utils.json_to_sheet(sample)
    ws['!cols'] = [{ wch: 22 }, { wch: 18 }, { wch: 18 }, { wch: 26 }, { wch: 16 }, { wch: 8 }]
    XLSX.utils.book_append_sheet(wb, ws, 'Employees')

    const instructions = XLSX.utils.aoa_to_sheet([
      ['Column', 'Required', 'Rules'],
      ['Name', 'Yes', 'Full employee name'],
      ['Role', 'Yes', 'Must exactly match a role name from the "Roles" sheet'],
      ['Branch', 'Yes (unless you only manage one branch)', 'Must exactly match a branch name from the "Branches" sheet'],
      ['Email', 'Admin-level roles only', 'Required + must be unique for Company Admin / Branch Manager / roles with Reports, Employees, or Settings access'],
      ['Password', 'Admin-level roles only', 'Minimum 8 characters. Not needed for PIN-only staff roles (auto-generated)'],
      ['PIN', 'Staff roles only', '4-6 digits. Not needed for admin-level roles'],
      [],
      ['A role counts as "admin-level" if it has Reports, Employees, Settings, Branches, or Full Access permission — everything else (e.g. Cashier, Warehouse Staff, Delivery Staff) is PIN-only.'],
      ['You cannot bulk-import a Company Admin account unless you yourself are a Company Admin.'],
      ['Upload this file from Employee Management → Bulk Import. You can also open it in Google Sheets (File > Import > Upload) and re-export as .xlsx before uploading here.'],
    ])
    instructions['!cols'] = [{ wch: 16 }, { wch: 28 }, { wch: 70 }]
    XLSX.utils.book_append_sheet(wb, instructions, 'Instructions')

    const rolesSheet = XLSX.utils.json_to_sheet(roles)
    XLSX.utils.book_append_sheet(wb, rolesSheet, 'Roles')
    const branchesSheet = XLSX.utils.json_to_sheet(branches)
    XLSX.utils.book_append_sheet(wb, branchesSheet, 'Branches')

    XLSX.writeFile(wb, saveResult.filePath)
    return { success: true, filePath: saveResult.filePath }
  })

  safeHandle(ipcMain, 'admin:users:importExcel', async () => {
    const caller = authUser()
    const perms = currentPerms(caller)
    if (!perms.all && !perms.employees) return { success: false, error: 'Employee management access required' }

    const { filePaths } = await dialog.showOpenDialog({
      title: 'Select Employee Import File',
      filters: [{ name: 'Excel / CSV', extensions: ['xlsx', 'xls', 'csv'] }],
      properties: ['openFile'],
    })
    if (!filePaths || filePaths.length === 0) return { success: false, cancelled: true }

    const { getMaxUsers } = await import('../services/licenseService')
    const db = getDb()
    const workbook = XLSX.readFile(filePaths[0])
    const sheetName = workbook.SheetNames.find(n => n.toLowerCase() === 'employees') || workbook.SheetNames[0]
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' }) as Record<string, unknown>[]

    const allRoles = db.prepare('SELECT id, name, permissions FROM roles').all() as { id: string; name: string; permissions: string }[]
    const roleByName = new Map(allRoles.map(r => [r.name.trim().toLowerCase(), r]))
    const allBranches = db.prepare('SELECT id, name FROM branches WHERE is_active = 1').all() as { id: string; name: string }[]
    const branchByName = new Map(allBranches.map(b => [b.name.trim().toLowerCase(), b.id]))

    const cell = (row: Record<string, unknown>, ...names: string[]): string => {
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

    let imported = 0
    let skipped = 0
    const errors: string[] = []

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      const rowNum = i + 2
      const name = cell(row, 'Name', 'Full Name')
      const roleName = cell(row, 'Role')
      const branchName = cell(row, 'Branch')
      let email = cell(row, 'Email')
      let password = cell(row, 'Password')
      const pin = cell(row, 'PIN', 'Pin')

      if (!name && !roleName) continue // fully blank row

      const { cnt } = db.prepare('SELECT COUNT(*) as cnt FROM users').get() as { cnt: number }
      if (cnt >= getMaxUsers()) { errors.push(`Row ${rowNum}: user limit reached, stopped importing`); skipped += (rows.length - i); break }

      if (!name) { errors.push(`Row ${rowNum}: name is required`); skipped++; continue }
      if (!roleName) { errors.push(`Row ${rowNum}: role is required`); skipped++; continue }
      const role = roleByName.get(roleName.toLowerCase())
      if (!role) { errors.push(`Row ${rowNum}: role "${roleName}" not found`); skipped++; continue }

      const rolePerms = JSON.parse(role.permissions || '{}') as Record<string, unknown>
      const isAdminRole = Boolean(rolePerms.all || rolePerms.reports || rolePerms.employees || rolePerms.settings || rolePerms.branches)
      if (!perms.all && rolePerms.all) { errors.push(`Row ${rowNum}: cannot assign Company Admin role`); skipped++; continue }

      let branchId: string | null = null
      if (!perms.all && caller.branch_id) {
        branchId = caller.branch_id as string
      } else if (branchName) {
        const found = branchByName.get(branchName.toLowerCase())
        if (!found) { errors.push(`Row ${rowNum}: branch "${branchName}" not found`); skipped++; continue }
        branchId = found
      } else if (!isAdminRole) {
        errors.push(`Row ${rowNum}: branch is required`); skipped++; continue
      }

      if (isAdminRole) {
        if (!email) { errors.push(`Row ${rowNum}: email is required for role "${role.name}"`); skipped++; continue }
        if (!EMAIL_RE_ADMIN.test(email)) { errors.push(`Row ${rowNum}: invalid email "${email}"`); skipped++; continue }
        if (!password) { errors.push(`Row ${rowNum}: password is required for role "${role.name}"`); skipped++; continue }
        if (password.length < 8) { errors.push(`Row ${rowNum}: password must be at least 8 characters`); skipped++; continue }
      } else {
        if (!pin || !/^\d{4,6}$/.test(pin)) { errors.push(`Row ${rowNum}: a 4-6 digit PIN is required for role "${role.name}"`); skipped++; continue }
        const slug = name.toLowerCase().replace(/\s+/g, '.').replace(/[^a-z0-9.]/g, '')
        email = `${slug}.${Date.now()}${i}@staff.local`
        password = crypto.randomUUID()
      }

      const existingEmail = db.prepare('SELECT id FROM users WHERE email = ?').get(email) as { id: string } | undefined
      if (existingEmail) { errors.push(`Row ${rowNum}: email "${email}" already in use`); skipped++; continue }

      try {
        const id = crypto.randomUUID()
        const hash = await bcrypt.hash(password, 10)
        const pinHash = !isAdminRole ? await bcrypt.hash(String(pin), 10) : null
        db.prepare(`INSERT INTO users (id,branch_id,role_id,name,email,password_hash,pin_hash)
          VALUES (?,?,?,?,?,?,?)`)
          .run(id, branchId, role.id, name, email, hash, pinHash)
        await enqueueUserRow(id)
        imported++
      } catch (err: unknown) {
        errors.push(`Row ${rowNum}: ${(err as Error).message}`)
        skipped++
      }
    }

    return { success: true, imported, skipped, errors: errors.slice(0, 50) }
  })

  // Roles
  safeHandle(ipcMain, 'admin:roles:list', () => {
    return { success: true, data: getDb().prepare('SELECT * FROM roles ORDER BY name').all() }
  })
  safeHandle(ipcMain, 'admin:roles:create', async (_e, p: Record<string, unknown>) => {
    if (!currentPerms().all) return { success: false, error: 'Company Admin access required to create roles' }
    const id = crypto.randomUUID()
    const permissions = typeof p.permissions === 'string' ? p.permissions : JSON.stringify(p.permissions || {})
    getDb().prepare(`INSERT INTO roles (id,name,permissions) VALUES (?,?,?)`)
      .run(id, p.name, permissions)
    await enqueuSync('roles', id, 'INSERT', { id, name: p.name, permissions })
    return { success: true, data: { id } }
  })
  safeHandle(ipcMain, 'admin:roles:update', async (_e, id: string, p: Record<string, unknown>) => {
    if (!currentPerms().all) return { success: false, error: 'Company Admin access required to edit roles' }
    const permissions = typeof p.permissions === 'string' ? p.permissions : JSON.stringify(p.permissions || {})
    getDb().prepare(`UPDATE roles SET name=?, permissions=?, updated_at=datetime('now') WHERE id=?`)
      .run(p.name, permissions, id)
    await enqueuSync('roles', id, 'UPDATE', { id, name: p.name, permissions })
    return { success: true }
  })
  safeHandle(ipcMain, 'admin:roles:delete', async (_e, id: string) => {
    if (!currentPerms().all) return { success: false, error: 'Company Admin access required to delete roles' }
    const db = getDb()
    const role = db.prepare('SELECT name FROM roles WHERE id=?').get(id) as { name: string } | undefined
    if (!role) return { success: false, error: 'Role not found' }
    if (role.name === 'Company Admin') return { success: false, error: 'Cannot delete Company Admin role' }
    const used = db.prepare('SELECT COUNT(*) as count FROM users WHERE role_id=?').get(id) as { count: number }
    if (used.count > 0) return { success: false, error: 'Cannot delete role assigned to users' }
    db.prepare('DELETE FROM roles WHERE id=?').run(id)
    await enqueuSync('roles', id, 'DELETE', { id })
    return { success: true }
  })

  // Suppliers
  safeHandle(ipcMain, 'admin:suppliers:list', () => {
    return { success: true, data: getDb().prepare('SELECT * FROM suppliers ORDER BY name').all() }
  })
  safeHandle(ipcMain, 'admin:suppliers:create', async (_e, p) => {
    const perms = currentPerms()
    if (!perms.all && !perms.inventory) return { success: false, error: 'Inventory management access required' }
    const id = crypto.randomUUID()
    getDb().prepare(`INSERT INTO suppliers (id,name,contact,phone,email,address,tax_number)
      VALUES (@id,@name,@contact,@phone,@email,@address,@tax_number)`)
      .run({ id, name:p.name, contact:p.contact||null, phone:p.phone||null,
             email:p.email||null, address:p.address||null, tax_number:p.tax_number||null })
    await enqueuSync('suppliers', id, 'INSERT', { id, ...p })
    return { success: true, data: { id } }
  })
  safeHandle(ipcMain, 'admin:suppliers:update', async (_e, id: string, p) => {
    const perms = currentPerms()
    if (!perms.all && !perms.inventory) return { success: false, error: 'Inventory management access required' }
    const fields = Object.keys(p).map(k=>`${k}=@${k}`).join(',')
    getDb().prepare(`UPDATE suppliers SET ${fields}, updated_at=datetime('now') WHERE id=@id`).run({...p,id})
    await enqueuSync('suppliers', id, 'UPDATE', { id, ...p })
    return { success: true }
  })

  // Categories
  safeHandle(ipcMain, 'admin:categories:list', () => {
    return { success: true, data: getDb().prepare('SELECT * FROM categories ORDER BY sort_order, name').all() }
  })
  // Branch Managers must submit an edit request and have it approved by a
  // Company Admin before they can create or update a category; the approval
  // is re-validated and consumed inside the same transaction as the write.
  // Admins write directly, as before.
  safeHandle(ipcMain, 'admin:categories:create', async (_e, p) => {
    const caller = authUser()
    const isAdmin = Boolean(currentPerms(caller).all)
    const { edit_request_id, ...rest } = (p || {}) as Record<string, unknown> & { edit_request_id?: string }
    if (!isAdmin && !edit_request_id) {
      return { success: false, error: 'No approved edit request found — please request approval first' }
    }

    const db = getDb()
    const id = crypto.randomUUID()
    const name = titleCase(rest.name)
    const shortCode = String(rest.short_code || '').trim() || categoryCodeFromName(name)

    db.transaction(() => {
      if (!isAdmin) {
        const request = db.prepare(`
          SELECT id FROM edit_requests
          WHERE id=? AND status='approved' AND approved_expires_at > datetime('now')
            AND requested_by=? AND target_table='categories' AND target_record_id='new'
        `).get(edit_request_id, caller?.id) as { id: string } | undefined
        if (!request) throw new Error('Edit request no longer valid — please request approval again')
        db.prepare(`UPDATE edit_requests SET status='consumed', consumed_at=datetime('now'), updated_at=datetime('now') WHERE id=?`)
          .run(request.id)
      }
      db.prepare(`INSERT INTO categories (id,parent_id,name,description,sort_order,short_code)
        VALUES (?,?,?,?,?,?)`)
        .run(id, rest.parent_id||null, name, rest.description||null, rest.sort_order||0, shortCode)
    })()

    await enqueuSync('categories', id, 'INSERT', { id, ...rest })
    if (!isAdmin && edit_request_id) {
      await enqueuSync('edit_requests', edit_request_id, 'UPDATE', { id: edit_request_id, status: 'consumed' })
    }
    return { success: true, data: { id } }
  })
  safeHandle(ipcMain, 'admin:categories:update', async (_e, id: string, p) => {
    const caller = authUser()
    const isAdmin = Boolean(currentPerms(caller).all)
    const { edit_request_id, ...rest } = (p || {}) as Record<string, unknown> & { edit_request_id?: string }
    if (!isAdmin && !edit_request_id) {
      return { success: false, error: 'No approved edit request found — please request approval first' }
    }

    const payload = { ...rest }
    if (payload.name !== undefined) payload.name = titleCase(payload.name)
    if (payload.short_code !== undefined) {
      payload.short_code = String(payload.short_code || '').trim() || categoryCodeFromName(payload.name || '')
    }
    if (payload.parent_id === '') payload.parent_id = null

    const db = getDb()
    const fields = Object.keys(payload).map(k=>`${k}=@${k}`).join(',')
    db.transaction(() => {
      if (!isAdmin) {
        const request = db.prepare(`
          SELECT id FROM edit_requests
          WHERE id=? AND status='approved' AND approved_expires_at > datetime('now')
            AND requested_by=? AND target_table='categories' AND target_record_id=?
        `).get(edit_request_id, caller?.id, id) as { id: string } | undefined
        if (!request) throw new Error('Edit request no longer valid — please request approval again')
        db.prepare(`UPDATE edit_requests SET status='consumed', consumed_at=datetime('now'), updated_at=datetime('now') WHERE id=?`)
          .run(request.id)
      }
      if (fields) db.prepare(`UPDATE categories SET ${fields}, updated_at=datetime('now') WHERE id=@id`).run({...payload,id})
    })()

    await enqueuSync('categories', id, 'UPDATE', { id, ...payload })
    if (!isAdmin && edit_request_id) {
      await enqueuSync('edit_requests', edit_request_id, 'UPDATE', { id: edit_request_id, status: 'consumed' })
    }
    return { success: true }
  })
  safeHandle(ipcMain, 'admin:categories:delete', async (_e, id: string) => {
    const perms = currentPerms()
    if (!perms.all && !perms.inventory) return { success: false, error: 'Inventory management access required' }
    getDb().prepare(`UPDATE categories SET is_active=0, updated_at=datetime('now') WHERE id=?`).run(id)
    await enqueuSync('categories', id, 'UPDATE', { id, is_active: 0 })
    return { success: true }
  })

  // Audit Logs
  safeHandle(ipcMain, 'admin:auditLogs:list', (_e, filters: Record<string,unknown> = {}) => {
    const db = getDb()
    let sql = `SELECT al.*, u.name as user_name FROM audit_logs al
               LEFT JOIN users u ON u.id = al.user_id WHERE 1=1`
    const params: unknown[] = []
    if (filters.branch_id) { sql += ' AND al.branch_id=?'; params.push(filters.branch_id) }
    if (filters.action) { sql += ' AND al.action LIKE ?'; params.push(`%${filters.action}%`) }
    sql += ' ORDER BY al.created_at DESC LIMIT 500'
    return { success: true, data: db.prepare(sql).all(...params) }
  })

  // Deliveries
  safeHandleModule(ipcMain, 'admin:deliveries:list', 'deliveries', (_e, filters: Record<string,unknown> = {}) => {
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
  })
  safeHandleModule(ipcMain, 'admin:deliveries:update', 'deliveries', async (_e, id: string, p) => {
    const fields = Object.keys(p).map(k=>`${k}=@${k}`).join(',')
    getDb().prepare(`UPDATE deliveries SET ${fields}, updated_at=datetime('now') WHERE id=@id`).run({...p,id})
    await enqueuSync('deliveries', id, 'UPDATE', { id, ...p })
    return { success: true }
  })

  // Installments
  safeHandleModule(ipcMain, 'admin:installments:calculate', 'installments', (_e, p: Record<string, unknown>) => {
    return { success: true, data: calculateInstallment(p) }
  })

  safeHandleModule(ipcMain, 'admin:installments:plans', 'installments', () => {
    return { success: true, data: getDb().prepare(`
      SELECT * FROM installment_plans WHERE is_active=1 ORDER BY months
    `).all() }
  })

  safeHandleModule(ipcMain, 'admin:installments:savePlan', 'installments', async (_e, p: Record<string, unknown>) => {
    const db = getDb()
    const id = String(p.id || crypto.randomUUID())
    const row = {
      id,
      name: p.name || `${p.months} Months`,
      months: Number(p.months || 12),
      interest_type: p.interest_type || 'flat',
      interest_rate: Number(p.interest_rate || 0),
      min_down_payment_pct: Number(p.min_down_payment_pct || 0),
      late_fee: Number(p.late_fee || 0),
      grace_period_days: Number(p.grace_period_days || 0),
      is_promotion: p.interest_type === 'no_interest' ? 1 : Number(p.is_promotion || 0),
      is_active: p.is_active === false ? 0 : 1,
    }
    db.prepare(`
      INSERT INTO installment_plans
        (id,name,months,interest_type,interest_rate,min_down_payment_pct,late_fee,grace_period_days,is_promotion,is_active)
      VALUES (@id,@name,@months,@interest_type,@interest_rate,@min_down_payment_pct,@late_fee,@grace_period_days,@is_promotion,@is_active)
      ON CONFLICT(id) DO UPDATE SET
        name=excluded.name, months=excluded.months, interest_type=excluded.interest_type,
        interest_rate=excluded.interest_rate, min_down_payment_pct=excluded.min_down_payment_pct,
        late_fee=excluded.late_fee, grace_period_days=excluded.grace_period_days,
        is_promotion=excluded.is_promotion, is_active=excluded.is_active, updated_at=datetime('now')
    `).run(row)
    await enqueuSync('installment_plans', id, 'UPDATE', row)
    return { success: true, data: { id } }
  })

  safeHandleModule(ipcMain, 'admin:installments:createSale', 'installments', async (_e, p: Record<string, unknown>) => {
    const db = getDb()
    const user = authUser()
    const branchId = String(p.branch_id || user.branch_id || defaultBranchId())
    let customerId = String(p.customer_id || '')
    const items = Array.isArray(p.items) ? p.items as Record<string, unknown>[] : []
    if (!items.length) return { success: false, error: 'Select at least one product' }

    const calc = calculateInstallment(p)
    const accountId = crypto.randomUUID()
    const invoiceId = crypto.randomUUID()
    const contractNumber = nextInstallmentNumber(branchId)
    const invoiceNumber = contractNumber.replace('-INS-', '-INV-')
    const startDate = String(p.start_date || new Date().toISOString().slice(0, 10))
    const nextDue = addMonths(startDate, 1)
    const downPayment = Number(calc.down_payment)
    const itemRecords: Record<string, unknown>[] = []
    const scheduleRecords: Record<string, unknown>[] = []
    const reminderRecords: Record<string, unknown>[] = []
    let downPaymentRow: Record<string, unknown> | null = null

    db.transaction(() => {
      if (!customerId) {
        customerId = crypto.randomUUID()
        db.prepare(`
          INSERT INTO customers (id, branch_id, name, phone, email, address, nic, notes)
          VALUES (?,?,?,?,?,?,?,?)
        `).run(
          customerId, branchId, p.customer_name || 'Installment Customer',
          p.customer_phone || null, p.customer_email || null, p.customer_address || null,
          p.customer_nic || null, 'Created from installment sale'
        )
      }

      db.prepare(`
        INSERT INTO invoices (id, invoice_number, branch_id, customer_id, cashier_id, bill_type, status,
          subtotal, discount_amount, tax_amount, total_amount, paid_amount, due_amount, notes)
        VALUES (?,?,?,?,?,'RETAIL','completed',?,?,?,?,?,?,?)
      `).run(
        invoiceId, invoiceNumber, branchId, customerId, user.id || null,
        calc.cash_price, 0, 0, calc.cash_price, downPayment, calc.total_payable,
        `Installment sale ${contractNumber}`
      )

      for (const item of items) {
        const qty = Number(item.quantity || 1)
        const productId = String(item.product_id)
        const unitPrice = Number(item.unit_price || 0)
        const itemId = crypto.randomUUID()
        db.prepare(`
          INSERT INTO invoice_items (id, invoice_id, product_id, quantity, unit_price,
            discount_pct, discount_amount, tax_rate, tax_amount, line_total)
          VALUES (?,?,?,?,?,0,0,0,0,?)
        `).run(itemId, invoiceId, productId, qty, unitPrice, money(qty * unitPrice))
        itemRecords.push({
          id: itemId, invoice_id: invoiceId, product_id: productId, quantity: qty, unit_price: unitPrice,
          discount_pct: 0, discount_amount: 0, tax_rate: 0, tax_amount: 0, line_total: money(qty * unitPrice),
        })
        const changed = db.prepare(`
          UPDATE stocks SET quantity = quantity - ?, updated_at=datetime('now')
          WHERE product_id=? AND branch_id=? AND quantity >= ?
        `).run(qty, productId, branchId, qty)
        if (!changed.changes) throw new Error(`Insufficient branch stock for product ${productId}`)
      }

      db.prepare(`
        INSERT INTO installments
          (id, contract_number, invoice_id, customer_id, branch_id, customer_phone, cash_price, down_payment,
           financed_amount, interest_type, interest_rate, interest_amount, total_amount, paid_amount,
           due_amount, monthly_amount, installment_count, remaining_installments, frequency, start_date,
           next_due_date, status, grace_period_days, late_fee, notes)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        accountId, contractNumber, invoiceId, customerId, branchId, p.customer_phone || null,
        calc.cash_price, calc.down_payment, calc.financed_amount, calc.interest_type, calc.interest_rate,
        calc.interest_amount, calc.total_payable, 0, calc.total_payable, calc.monthly_amount,
        calc.months, calc.months, 'monthly', startDate, nextDue, 'active',
        Number(p.grace_period_days || 0), Number(p.late_fee || 0), p.notes || null
      )

      for (let i = 1; i <= calc.months; i++) {
        const dueDate = addMonths(startDate, i)
        const scheduleId = crypto.randomUUID()
        const scheduleRow = {
          id: scheduleId, installment_id: accountId, installment_no: i, due_date: dueDate,
          principal: money(calc.financed_amount / calc.months),
          interest: money(calc.interest_amount / calc.months),
          total_due: calc.monthly_amount,
        }
        db.prepare(`
          INSERT INTO installment_schedule
            (id, installment_id, installment_no, due_date, principal, interest, total_due)
          VALUES (@id,@installment_id,@installment_no,@due_date,@principal,@interest,@total_due)
        `).run(scheduleRow)
        scheduleRecords.push(scheduleRow)

        for (const offset of [7, 3, 0]) {
          const scheduled = new Date(`${dueDate}T00:00:00`)
          scheduled.setDate(scheduled.getDate() - offset)
          const reminderId = crypto.randomUUID()
          const reminderRow = {
            id: reminderId, installment_id: accountId,
            channel: 'sms', reminder_type: offset === 0 ? 'due_today' : `${offset}_days_before`,
            message: `Installment ${contractNumber}: Rs.${calc.monthly_amount} due on ${dueDate}`,
            scheduled_at: scheduled.toISOString().slice(0, 10),
          }
          db.prepare(`
            INSERT INTO installment_reminders
              (id, installment_id, channel, reminder_type, message, scheduled_at)
            VALUES (@id,@installment_id,@channel,@reminder_type,@message,@scheduled_at)
          `).run(reminderRow)
          reminderRecords.push(reminderRow)
        }
      }

      if (downPayment > 0) {
        const payId = crypto.randomUUID()
        downPaymentRow = {
          id: payId, installment_id: accountId, amount: downPayment,
          method: p.down_payment_method || 'cash', receipt_number: `${contractNumber}-DP`,
          reference: p.down_payment_reference || null, status: 'approved',
          received_by: user.id || null, branch_id: branchId, notes: 'Down payment',
        }
        db.prepare(`
          INSERT INTO installment_payments
            (id, installment_id, amount, method, receipt_number, reference, status, received_by, branch_id, notes)
          VALUES (@id,@installment_id,@amount,@method,@receipt_number,@reference,@status,@received_by,@branch_id,@notes)
        `).run(downPaymentRow)
      }

      logAudit(db, {
        userId: (user.id as string) || null, branchId,
        action: 'INSTALLMENT_CREATED', tableName: 'installments', recordId: accountId,
        newValues: { contractNumber, calc },
      })
    })()

    await enqueuSync('invoices', invoiceId, 'INSERT', { id: invoiceId, invoice_number: invoiceNumber, branch_id: branchId, customer_id: customerId })
    await enqueuSync('installments', accountId, 'INSERT', { id: accountId, contract_number: contractNumber, invoice_id: invoiceId, customer_id: customerId, branch_id: branchId, ...calc })
    for (const itemRow of itemRecords) {
      await enqueuSync('invoice_items', String(itemRow.id), 'INSERT', itemRow)
    }
    for (const scheduleRow of scheduleRecords) {
      await enqueuSync('installment_schedule', String(scheduleRow.id), 'INSERT', scheduleRow)
    }
    for (const reminderRow of reminderRecords) {
      await enqueuSync('installment_reminders', String(reminderRow.id), 'INSERT', reminderRow)
    }
    if (downPaymentRow) {
      await enqueuSync('installment_payments', String((downPaymentRow as Record<string, unknown>).id), 'INSERT', downPaymentRow)
    }
    return { success: true, data: { id: accountId, contract_number: contractNumber, invoice_id: invoiceId } }
  })

  safeHandleModule(ipcMain, 'admin:installments:list', 'installments', (_e, filters: Record<string,unknown> = {}) => {
    const db = getDb()
    db.prepare(`
      UPDATE installments SET status='overdue', updated_at=datetime('now')
      WHERE status='active' AND next_due_date < date('now') AND due_amount > 0
    `).run()
    let sql = `
      SELECT inst.*, c.name AS customer_name, c.phone AS customer_phone, b.name AS branch_name,
        i.invoice_number,
        inst.monthly_amount AS computed_monthly,
        (SELECT COUNT(*) FROM installment_schedule s WHERE s.installment_id=inst.id AND s.status='paid') AS payments_made,
        CAST(julianday(date('now')) - julianday(inst.next_due_date) AS INTEGER) AS overdue_days
      FROM installments inst
      LEFT JOIN customers c ON c.id = inst.customer_id
      LEFT JOIN branches b ON b.id = inst.branch_id
      LEFT JOIN invoices  i ON i.id = inst.invoice_id
      WHERE 1=1`
    const params: unknown[] = []
    if (filters.status) { sql += ' AND inst.status=?'; params.push(filters.status) }
    if (filters.branch_id) { sql += ' AND inst.branch_id=?'; params.push(filters.branch_id) }
    if (filters.search) {
      sql += ' AND (inst.contract_number LIKE ? OR c.name LIKE ? OR c.phone LIKE ?)'
      const q = `%${filters.search}%`; params.push(q, q, q)
    }
    sql += ' ORDER BY inst.status DESC, inst.next_due_date ASC LIMIT 500'
    return { success: true, data: db.prepare(sql).all(...params) }
  })

  safeHandleModule(ipcMain, 'admin:installments:get', 'installments', (_e, id: string) => {
    const db = getDb()
    const inst = db.prepare(`
      SELECT inst.*, c.name AS customer_name, c.phone AS customer_phone, c.email AS customer_email,
        b.name AS branch_name, i.invoice_number, i.created_at AS invoice_date
      FROM installments inst
      LEFT JOIN customers c ON c.id = inst.customer_id
      LEFT JOIN branches b ON b.id = inst.branch_id
      LEFT JOIN invoices  i ON i.id = inst.invoice_id
      WHERE inst.id = ?
    `).get(id) as Record<string,unknown> | undefined
    if (!inst) return { success: false, error: 'Not found' }
    const schedule = db.prepare(`
      SELECT * FROM installment_schedule WHERE installment_id=? ORDER BY installment_no
    `).all(id)
    const payments = db.prepare(`
      SELECT ip.*, u.name AS received_by_name, v.name AS verified_by_name
      FROM installment_payments ip
      LEFT JOIN users u ON u.id = ip.received_by
      LEFT JOIN users v ON v.id = ip.verified_by
      WHERE ip.installment_id = ?
      ORDER BY ip.paid_at DESC
    `).all(id)
    const overdue = db.prepare(`
      SELECT COALESCE(SUM(total_due + penalty - paid_amount),0) AS amount
      FROM installment_schedule
      WHERE installment_id=? AND status IN ('pending','partial','overdue') AND due_date < date('now')
    `).get(id) as { amount: number }
    return { success: true, data: { ...inst, schedule, payments, computed_monthly: inst.monthly_amount, overdue_amount: overdue.amount } }
  })

  safeHandleModule(ipcMain, 'admin:installments:recordPayment', 'installments', async (_e, id: string, p: Record<string,unknown>) => {
    const db = getDb()
    const user = authUser()
    const inst = db.prepare('SELECT * FROM installments WHERE id=?').get(id) as Record<string, unknown> | undefined
    if (!inst) return { success: false, error: 'Installment account not found' }
    const branchId = String(p.branch_id || inst.branch_id || user.branch_id || defaultBranchId())
    const amount = money(Number(p.amount || 0))
    if (amount <= 0) return { success: false, error: 'Enter a valid amount' }
    const method = String(p.method || 'cash')
    const status = method === 'bank_transfer' ? 'pending_verification' : 'approved'
    const paymentId = crypto.randomUUID()
    const receiptNumber = String(p.receipt_number || `${inst.contract_number || 'INS'}-RCPT-${Date.now().toString().slice(-6)}`)

    db.transaction(() => {
      db.prepare(`
        INSERT INTO installment_payments
          (id, installment_id, amount, method, receipt_number, reference, receipt_image_url,
           status, received_by, branch_id, notes)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)
      `).run(paymentId, id, amount, method, receiptNumber, p.reference || null, p.receipt_image_url || null, status, user.id || null, branchId, p.notes || null)

      if (status === 'approved') {
        let remaining = amount
        const rows = db.prepare(`
          SELECT * FROM installment_schedule
          WHERE installment_id=? AND status IN ('pending','partial','overdue')
          ORDER BY due_date, installment_no
        `).all(id) as Record<string, unknown>[]
        for (const row of rows) {
          if (remaining <= 0) break
          const due = Number(row.total_due || 0) + Number(row.penalty || 0) - Number(row.paid_amount || 0)
          const apply = Math.min(remaining, due)
          const newPaid = money(Number(row.paid_amount || 0) + apply)
          const nextStatus = newPaid + 0.01 >= Number(row.total_due || 0) + Number(row.penalty || 0) ? 'paid' : 'partial'
          db.prepare(`
            UPDATE installment_schedule
            SET paid_amount=?, status=?, paid_at=CASE WHEN ?='paid' THEN datetime('now') ELSE paid_at END, updated_at=datetime('now')
            WHERE id=?
          `).run(newPaid, nextStatus, nextStatus, row.id)
          remaining = money(remaining - apply)
        }
        const paidRows = db.prepare(`SELECT COUNT(*) AS count FROM installment_schedule WHERE installment_id=? AND status='paid'`).get(id) as { count: number }
        const dueAmount = money(Number(inst.due_amount || 0) - amount)
        const next = db.prepare(`
          SELECT due_date FROM installment_schedule
          WHERE installment_id=? AND status IN ('pending','partial','overdue')
          ORDER BY due_date LIMIT 1
        `).get(id) as { due_date?: string } | undefined
        db.prepare(`
          UPDATE installments
          SET paid_amount=paid_amount+?, due_amount=?, remaining_installments=?,
              last_paid_date=date('now'), next_due_date=?, status=?, updated_at=datetime('now')
          WHERE id=?
        `).run(amount, Math.max(0, dueAmount), Math.max(0, Number(inst.installment_count || 0) - Number(paidRows.count || 0)), next?.due_date || null, dueAmount <= 0.01 ? 'completed' : 'active', id)
      }

      logAudit(db, {
        userId: (user.id as string) || null, branchId,
        action: status === 'approved' ? 'INSTALLMENT_PAYMENT' : 'INSTALLMENT_PAYMENT_PENDING',
        tableName: 'installment_payments', recordId: paymentId,
        newValues: { amount, method, receiptNumber },
      })
    })()
    await enqueuSync('installment_payments', paymentId, 'INSERT', { id: paymentId, installment_id: id, amount, method, receipt_number: receiptNumber, status, branch_id: branchId, ...p })
    return { success: true, data: { id: paymentId, receipt_number: receiptNumber, status } }
  })

  safeHandleModule(ipcMain, 'admin:installments:verifyPayment', 'installments', async (_e, paymentId: string, action: 'approve' | 'reject', notes?: string) => {
    const db = getDb()
    const user = authUser()
    const payment = db.prepare('SELECT * FROM installment_payments WHERE id=?').get(paymentId) as Record<string, unknown> | undefined
    if (!payment) return { success: false, error: 'Payment not found' }
    if (action === 'reject') {
      db.prepare(`
        UPDATE installment_payments SET status='rejected', verified_by=?, verified_at=datetime('now'),
          rejected_reason=?, updated_at=datetime('now') WHERE id=?
      `).run(user.id || null, notes || null, paymentId)
    } else {
      db.prepare(`
        UPDATE installment_payments SET status='approved', verified_by=?, verified_at=datetime('now'),
          updated_at=datetime('now') WHERE id=?
      `).run(user.id || null, paymentId)
      const inst = db.prepare('SELECT * FROM installments WHERE id=?').get(payment.installment_id) as Record<string, unknown>
      let remaining = Number(payment.amount || 0)
      const rows = db.prepare(`
        SELECT * FROM installment_schedule
        WHERE installment_id=? AND status IN ('pending','partial','overdue')
        ORDER BY due_date, installment_no
      `).all(payment.installment_id) as Record<string, unknown>[]
      for (const row of rows) {
        if (remaining <= 0) break
        const due = Number(row.total_due || 0) + Number(row.penalty || 0) - Number(row.paid_amount || 0)
        const apply = Math.min(remaining, due)
        const newPaid = money(Number(row.paid_amount || 0) + apply)
        const nextStatus = newPaid + 0.01 >= Number(row.total_due || 0) + Number(row.penalty || 0) ? 'paid' : 'partial'
        db.prepare(`
          UPDATE installment_schedule
          SET paid_amount=?, status=?, paid_at=CASE WHEN ?='paid' THEN datetime('now') ELSE paid_at END, updated_at=datetime('now')
          WHERE id=?
        `).run(newPaid, nextStatus, nextStatus, row.id)
        remaining = money(remaining - apply)
      }
      const paidRows = db.prepare('SELECT COUNT(*) AS count FROM installment_schedule WHERE installment_id=? AND status="paid"').get(payment.installment_id) as { count: number }
      const dueAmount = money(Number(inst.due_amount || 0) - Number(payment.amount || 0))
      const next = db.prepare(`
        SELECT due_date FROM installment_schedule
        WHERE installment_id=? AND status IN ('pending','partial','overdue')
        ORDER BY due_date LIMIT 1
      `).get(payment.installment_id) as { due_date?: string } | undefined
      db.prepare(`
        UPDATE installments
        SET paid_amount=paid_amount+?, due_amount=?, remaining_installments=?,
            last_paid_date=date('now'), next_due_date=?, status=?, updated_at=datetime('now')
        WHERE id=?
      `).run(Number(payment.amount || 0), Math.max(0, dueAmount), Math.max(0, Number(inst.installment_count || 0) - Number(paidRows.count || 0)), next?.due_date || null, dueAmount <= 0.01 ? 'completed' : 'active', payment.installment_id)
    }
    logAudit(db, {
      userId: (user.id as string) || null, branchId: (payment.branch_id as string) || null,
      action: action === 'approve' ? 'BANK_TRANSFER_APPROVED' : 'BANK_TRANSFER_REJECTED',
      tableName: 'installment_payments', recordId: paymentId, newValues: { notes },
    })
    await enqueuSync('installment_payments', paymentId, 'UPDATE', { id: paymentId, status: action === 'approve' ? 'approved' : 'rejected', verified_by: user.id || null, rejected_reason: notes || null })
    return { success: true }
  })

  safeHandleModule(ipcMain, 'admin:installments:pendingTransfers', 'installments', (_e, filters: Record<string, unknown> = {}) => {
    const db = getDb()
    let sql = `
      SELECT ip.*, inst.contract_number, c.name AS customer_name, c.phone AS customer_phone,
             b.name AS branch_name, u.name AS received_by_name
      FROM installment_payments ip
      JOIN installments inst ON inst.id = ip.installment_id
      LEFT JOIN customers c ON c.id = inst.customer_id
      LEFT JOIN branches b ON b.id = ip.branch_id
      LEFT JOIN users u ON u.id = ip.received_by
      WHERE ip.status = 'pending_verification'`
    const params: unknown[] = []
    if (filters.branch_id) { sql += ' AND ip.branch_id=?'; params.push(filters.branch_id) }
    sql += ' ORDER BY ip.paid_at DESC LIMIT 200'
    return { success: true, data: db.prepare(sql).all(...params) }
  })

  safeHandleModule(ipcMain, 'admin:installments:applyPenalties', 'installments', () => {
    const db = getDb()
    let count = 0
    db.transaction(() => {
      const rows = db.prepare(`
        SELECT s.id, s.installment_id, inst.late_fee, inst.grace_period_days
        FROM installment_schedule s
        JOIN installments inst ON inst.id = s.installment_id
        WHERE s.status IN ('pending','partial')
          AND date('now') > date(s.due_date, '+' || CAST(inst.grace_period_days AS TEXT) || ' days')
          AND s.penalty = 0
          AND inst.late_fee > 0
          AND inst.status IN ('active','overdue')
      `).all() as Record<string, unknown>[]
      for (const row of rows) {
        const penalty = money(Number(row.late_fee))
        db.prepare(`
          UPDATE installment_schedule SET penalty=?, total_due=total_due+?, status='overdue',
            updated_at=datetime('now') WHERE id=?
        `).run(penalty, penalty, row.id)
        db.prepare(`
          UPDATE installments SET penalty_amount=penalty_amount+?, due_amount=due_amount+?,
            updated_at=datetime('now') WHERE id=?
        `).run(penalty, penalty, row.installment_id)
        count++
      }
    })()
    return { success: true, data: { applied: count } }
  })

  safeHandleModule(ipcMain, 'admin:installments:reports', 'installments', (_e, filters: Record<string, unknown> = {}) => {
    const caller = authUser()
    const perms = currentPerms(caller)
    const isGlobal = Boolean(perms.all || perms.reports)
    if (!isGlobal) return { success: false, error: 'Reports access required' }

    const db = getDb()
    const params: unknown[] = []
    let branchWhere = ''
    // Company-Admin / Reports-permission callers may cross branches (same
    // scoping convention as reports:advancedSummary); everyone else is
    // forced to their own branch regardless of what filters ask for.
    const scopedBranchId = isGlobal ? (filters.branch_id as string | undefined) : (caller.branch_id as string | undefined)
    if (scopedBranchId) { branchWhere = ' AND inst.branch_id=?'; params.push(scopedBranchId) }
    const active = db.prepare(`SELECT COUNT(*) AS count FROM installments inst WHERE status IN ('active','overdue')${branchWhere}`).get(...params) as { count: number }
    const overdue = db.prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(due_amount),0) AS amount FROM installments inst WHERE status='overdue'${branchWhere}`).get(...params) as { count: number; amount: number }
    const outstanding = db.prepare(`SELECT COALESCE(SUM(due_amount),0) AS amount FROM installments inst WHERE status IN ('active','overdue')${branchWhere}`).get(...params) as { amount: number }
    const pendingVerification = db.prepare(`
      SELECT COUNT(*) AS count
      FROM installment_payments ip
      JOIN installments inst ON inst.id = ip.installment_id
      WHERE ip.status='pending_verification'${branchWhere.replace(/inst\./g, 'inst.')}
    `).get(...params) as { count: number }
    const agingBuckets = db.prepare(`
      SELECT
        SUM(CASE WHEN CAST(julianday(date('now')) - julianday(inst.next_due_date) AS INTEGER) BETWEEN 1 AND 7 THEN 1 ELSE 0 END) AS days_1_7,
        SUM(CASE WHEN CAST(julianday(date('now')) - julianday(inst.next_due_date) AS INTEGER) BETWEEN 8 AND 15 THEN 1 ELSE 0 END) AS days_8_15,
        SUM(CASE WHEN CAST(julianday(date('now')) - julianday(inst.next_due_date) AS INTEGER) > 15 THEN 1 ELSE 0 END) AS days_15_plus,
        COALESCE(SUM(CASE WHEN CAST(julianday(date('now')) - julianday(inst.next_due_date) AS INTEGER) BETWEEN 1 AND 7 THEN inst.due_amount ELSE 0 END), 0) AS amt_1_7,
        COALESCE(SUM(CASE WHEN CAST(julianday(date('now')) - julianday(inst.next_due_date) AS INTEGER) BETWEEN 8 AND 15 THEN inst.due_amount ELSE 0 END), 0) AS amt_8_15,
        COALESCE(SUM(CASE WHEN CAST(julianday(date('now')) - julianday(inst.next_due_date) AS INTEGER) > 15 THEN inst.due_amount ELSE 0 END), 0) AS amt_15_plus
      FROM installments inst
      WHERE inst.status = 'overdue'${branchWhere}
    `).get(...params) as {
      days_1_7: number
      days_8_15: number
      days_15_plus: number
      amt_1_7: number
      amt_8_15: number
      amt_15_plus: number
    }
    const collections = db.prepare(`
      SELECT substr(ip.paid_at,1,7) AS month, COALESCE(SUM(ip.amount),0) AS amount, COUNT(*) AS count
      FROM installment_payments ip
      JOIN installments inst ON inst.id=ip.installment_id
      WHERE ip.status='approved'${branchWhere}
      GROUP BY substr(ip.paid_at,1,7) ORDER BY month DESC LIMIT 12
    `).all(...params)
    const performance = db.prepare(`
      SELECT b.name AS branch_name, u.name AS cashier_name, COALESCE(SUM(ip.amount),0) AS collected, COUNT(*) AS payments
      FROM installment_payments ip
      JOIN installments inst ON inst.id=ip.installment_id
      LEFT JOIN branches b ON b.id=inst.branch_id
      LEFT JOIN users u ON u.id=ip.received_by
      WHERE ip.status='approved'${branchWhere}
      GROUP BY b.name, u.name ORDER BY collected DESC LIMIT 20
    `).all(...params)
    return {
      success: true,
      data: {
        active: active.count,
        overdue,
        outstanding: outstanding.amount,
        pendingVerification: pendingVerification.count,
        agingBuckets,
        collections,
        performance,
      },
    }
  })

  // Product UOM (Units of Measure)
  safeHandle(ipcMain, 'admin:productUom:list', (_e, productId: string) => {
    return { success: true, data: getDb().prepare(
      'SELECT * FROM product_uom WHERE product_id=? ORDER BY sort_order, is_base DESC'
    ).all(productId) }
  })
  safeHandle(ipcMain, 'admin:productUom:save', async (_e, productId: string, uoms: Record<string,unknown>[]) => {
    const db = getDb()
    const oldIds = (db.prepare('SELECT id FROM product_uom WHERE product_id=?').all(productId) as { id: string }[]).map(r => r.id)
    const newRows: Record<string, unknown>[] = []
    db.transaction(() => {
      db.prepare('DELETE FROM product_uom WHERE product_id=?').run(productId)
      for (let i = 0; i < uoms.length; i++) {
        const u = uoms[i]
        const row = {
          id: crypto.randomUUID(), product_id: productId, uom_name: u.uom_name,
          conversion_factor: u.conversion_factor ?? 1, is_base: u.is_base ? 1 : 0,
          wastage: u.wastage ?? 0, sort_order: i,
        }
        db.prepare(`INSERT INTO product_uom (id,product_id,uom_name,conversion_factor,is_base,wastage,sort_order)
          VALUES (@id,@product_id,@uom_name,@conversion_factor,@is_base,@wastage,@sort_order)`)
          .run(row)
        newRows.push(row)
      }
    })()
    for (const oldId of oldIds) await enqueuSync('product_uom', oldId, 'DELETE', { id: oldId })
    for (const row of newRows) await enqueuSync('product_uom', String(row.id), 'INSERT', row)
    return { success: true }
  })

  // Expense Categories
  safeHandleModule(ipcMain, 'admin:expenseCategories:list', 'expenses', () => {
    return { success: true, data: getDb().prepare('SELECT * FROM expense_categories WHERE is_active=1 ORDER BY name').all() }
  })
  safeHandleModule(ipcMain, 'admin:expenseCategories:create', 'expenses', async (_e, p: Record<string,unknown>) => {
    const id = crypto.randomUUID()
    getDb().prepare('INSERT INTO expense_categories (id,name) VALUES (?,?)').run(id, p.name)
    await enqueuSync('expense_categories', id, 'INSERT', { id, name: p.name })
    return { success: true, data: { id } }
  })

  // Expenses
  safeHandleModule(ipcMain, 'admin:expenses:list', 'expenses', (_e, filters: Record<string,unknown> = {}) => {
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
  })
  safeHandleModule(ipcMain, 'admin:expenses:create', 'expenses', async (_e, p: Record<string,unknown>) => {
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
  })
  safeHandleModule(ipcMain, 'admin:expenses:update', 'expenses', async (_e, id: string, p: Record<string,unknown>) => {
    const fields = Object.keys(p).map(k=>`${k}=@${k}`).join(',')
    getDb().prepare(`UPDATE expenses SET ${fields}, updated_at=datetime('now') WHERE id=@id`).run({...p,id})
    await enqueuSync('expenses', id, 'UPDATE', { id, ...p })
    return { success: true }
  })

  // ── Clear All Data (wipe all transactional/test data, keep config) ────────
  safeHandle(ipcMain, 'admin:clearAllData', (_e) => {
    const db = getDb()
    const caller = authUser()
    const rolePerms = (caller?.role as Record<string,unknown>)?.permissions as Record<string,unknown> || {}
    const directPerms = (caller?.permissions as Record<string,unknown>) || {}
    const perms = Object.keys(rolePerms).length ? rolePerms : directPerms
    if (!perms.all) return { success: false, error: 'Only Company Admin can clear all data' }

    // Delete in FK-safe order
    const tables = [
      'sync_queue',
      'audit_logs',
      'loyalty_transactions',
      'return_items',
      'returns',
      'installment_payments',
      'installment_schedules',
      'installments',
      'order_items',
      'orders',
      'invoice_items',
      'payments',
      'invoices',
      'stock_count_items',
      'stock_counts',
      'stock_transfer_items',
      'stock_transfers',
      'stock_movements',
      'batches',
      'stocks',
      'purchase_order_items',
      'purchase_orders',
      'expenses',
      'customers',
      'products',
      'notifications',
      'categories',
      'suppliers',
    ]

    // Disable FK constraints so we can delete in any order
    db.pragma('foreign_keys = OFF')
    db.transaction(() => {
      for (const table of tables) {
        try { db.prepare(`DELETE FROM ${table}`).run() } catch { /* table may not exist */ }
      }
      try { db.prepare(`DELETE FROM users`).run() } catch { /* ok */ }
      try { db.prepare(`DELETE FROM branches`).run() } catch { /* ok */ }
      try { db.prepare(`DELETE FROM roles`).run() } catch { /* ok */ }
    })()
    db.pragma('foreign_keys = ON')

    // Delete all uploaded images (product photos, logos etc.)
    const uploadsDir = path.join(app.getPath('userData'), 'uploads')
    if (fs.existsSync(uploadsDir)) {
      fs.rmSync(uploadsDir, { recursive: true, force: true })
    }

    // Mark first-time setup required and clear session
    store.set('setup_required', true)
    store.delete('auth_user')
    store.delete('auth_token')
    store.delete('last_pull_timestamp')

    return { success: true }
  })

  // ── Force Reset (called when cloud detects company was deleted by SuperAdmin) ─
  // No permission check — this is triggered by the cloud, not the logged-in user.
  safeHandle(ipcMain, 'admin:forceReset', async () => {
    const db = getDb()

    // Safety net: this wipes every local table with no undo. Keep a hot
    // backup first in case the trigger turns out to be a false positive
    // (e.g. a transient API-key mismatch) rather than a real deletion.
    try {
      const backupsDir = path.join(app.getPath('userData'), 'backups')
      fs.mkdirSync(backupsDir, { recursive: true })
      await db.backup(path.join(backupsDir, `pre-reset-${Date.now()}.db`))
    } catch { /* best-effort — don't block the reset on backup failure */ }

    const tables = [
      'sync_queue', 'audit_logs', 'loyalty_transactions',
      'return_items', 'returns', 'installment_payments', 'installment_schedules', 'installments',
      'order_items', 'orders', 'invoice_items', 'payments', 'invoices',
      'stock_count_items', 'stock_counts', 'stock_transfer_items', 'stock_transfers',
      'stock_movements', 'batches', 'stocks', 'purchase_order_items', 'purchase_orders',
      'expenses', 'customers', 'products', 'notifications', 'categories', 'suppliers',
    ]
    db.transaction(() => {
      try { db.prepare(`UPDATE users SET branch_id = NULL, role_id = NULL`).run() } catch { /* ok */ }
      for (const t of tables) { try { db.prepare(`DELETE FROM ${t}`).run() } catch { /* skip */ } }
      try { db.prepare(`DELETE FROM branches`).run() } catch { /* ok */ }
      try { db.prepare(`DELETE FROM users`).run() } catch { /* ok */ }
      try { db.prepare(`DELETE FROM roles`).run() } catch { /* ok */ }
    })()

    // Delete all uploaded images (product photos, logos etc.)
    const uploadsDir = path.join(app.getPath('userData'), 'uploads')
    if (fs.existsSync(uploadsDir)) {
      fs.rmSync(uploadsDir, { recursive: true, force: true })
    }

    // Clear cloud API settings so brand check doesn't re-trigger on next launch
    const settings = (store.get('app_settings') as Record<string, unknown>) || {}
    settings.cloud_api_key = ''
    settings.cloud_api_url = ''
    store.set('app_settings', settings)

    // Also clear activation state — otherwise app:isActivated() still
    // reports true (it only checks device_activated) and the device skips
    // straight past the Activation screen into Setup, leaving it looking
    // "reset" while actually just running disconnected from the cloud forever.
    store.delete('device_activated')
    store.delete('device_license_key')
    store.delete('device_company_key')
    store.delete('activation_company_name')
    store.delete('license_data')

    store.set('setup_required', true)
    store.delete('auth_user')
    store.delete('auth_token')
    store.delete('last_pull_timestamp')
    return { success: true }
  })

  // ── Check if first-time setup is required: true when no active users exist ─
  // NOTE: not converted to safeHandle — the catch block returns a bare boolean
  // (`true`) instead of the standard { success, error } shape, which is a
  // deliberate non-generic fallback that safeHandle's wrapper would not preserve.
  ipcMain.handle('admin:isSetupRequired', () => {
    try {
      const db = getDb()
      const { cnt } = db.prepare('SELECT COUNT(*) as cnt FROM users WHERE is_active=1').get() as { cnt: number }
      return cnt === 0
    } catch {
      return true
    }
  })

  // ── Seed local defaults (used after Clear All Data to restore without cloud) ─
  safeHandle(ipcMain, 'admin:seedLocalDefaults', async () => {
    const db = getDb()
    const branchId = 'b1111111-1111-4111-8111-111111111111'
    const adminUserId = 'u9999999-9999-4999-8999-999999999999'
    const companyAdminRoleId = '3a6b8c9d-1e2f-4a3b-8c9d-1e2f3a6b8c9d'

    // Seed roles
    db.prepare(`INSERT OR IGNORE INTO roles (id, name, permissions) VALUES
      ('3a6b8c9d-1e2f-4a3b-8c9d-1e2f3a6b8c9d', 'Company Admin',   '{"all":true}'),
      ('4b7c9d0e-2f3a-5b4c-9d0e-2f3a4b7c9d0e', 'Branch Manager',  '{"pos":true,"inventory":true,"reports":true,"customers":true,"employees":true,"coupons":true,"coupons_create":true,"coupons_reports":true}'),
      ('5c8d0e1f-3a4b-6c5d-0e1f-3a4b5c8d0e1f', 'Cashier',         '{"pos":true,"customers":true}'),
      ('6d9e1f2a-4b5c-7d6e-1f2a-4b5c6d9e1f2a', 'Warehouse Staff', '{"inventory":true,"transfers":true}'),
      ('7e0f2a3b-5c6d-8e7f-2a3b-5c6d7e0f2a3b', 'Delivery Staff',  '{"deliveries":true}')
    `).run()

    // Seed main branch
    db.prepare(`
      INSERT OR IGNORE INTO branches (id, name, code, address, phone)
      VALUES (?, 'Main Branch', 'MAIN', 'Head Office', '+94 11 000 0000')
    `).run(branchId)

    // Seed default admin user
    const hash = await bcrypt.hash('admin123', 10)
    const pinHash = await bcrypt.hash('1234', 10)
    db.prepare(`
      INSERT OR IGNORE INTO users (id, branch_id, role_id, name, email, password_hash, pin_hash, is_active)
      VALUES (?, ?, ?, 'System Admin', 'admin@pos.local', ?, ?, 1)
    `).run(adminUserId, branchId, companyAdminRoleId, hash, pinHash)

    // Clear the setup_required flag
    store.delete('setup_required')

    return { success: true }
  })
}
