import type { IpcMain } from 'electron'
import { getDb } from '../database'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import Store from 'electron-store'
import crypto from 'crypto'

const store = new Store()
const JWT_SECRET = 'pos-erp-secret-change-in-production'

export function registerAuthHandlers(ipcMain: IpcMain) {
  ipcMain.handle('auth:login', async (_e, { email, password }) => {
    try {
      const db = getDb()
      const user = db.prepare(`
        SELECT u.*, r.name as role_name, r.permissions as role_permissions,
               b.name as branch_name
        FROM users u
        LEFT JOIN roles r ON r.id = u.role_id
        LEFT JOIN branches b ON b.id = u.branch_id
        WHERE u.email = ? AND u.is_active = 1
      `).get(email) as Record<string, unknown> | undefined

      if (!user) return { success: false, error: 'Invalid credentials' }

      const valid = await bcrypt.compare(password, user.password_hash as string)
      if (!valid) return { success: false, error: 'Invalid credentials' }

      // Update last login
      db.prepare(`UPDATE users SET last_login_at = datetime('now') WHERE id = ?`).run(user.id)

      // Audit log
      db.prepare(`INSERT INTO audit_logs (id, user_id, branch_id, action) VALUES (?,?,?,?)`)
        .run(crypto.randomUUID(), user.id, user.branch_id, 'LOGIN')

      const perms = JSON.parse(user.role_permissions as string || '{}')
      const payload = {
        id: user.id,
        name: user.name,
        email: user.email,
        // Nested role object — matches AuthUser type used in frontend
        role: { id: user.role_id, name: user.role_name, permissions: perms },
        branch: user.branch_id ? { id: user.branch_id, name: user.branch_name } : null,
        // Flat fields kept for IPC handler compatibility
        branch_id: user.branch_id,
        permissions: perms,
      }

      const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '12h' })
      store.set('auth_token', token)
      store.set('auth_user', payload)

      return { success: true, data: { user: payload, token } }
    } catch (err: unknown) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('auth:pinLogin', async (_e, { pin, branch_id }) => {
    try {
      const db = getDb()
      // If a terminal branch is set, restrict PIN login to that branch's users
      // First try: branch-filtered lookup (if terminal branch is set)
      // Super admin users (permissions.all) bypass branch filter — they can login anywhere
      let user: Record<string, unknown> | undefined
      if (branch_id) {
        user = db.prepare(`
          SELECT u.*, r.name as role_name, r.permissions as role_permissions,
                 b.name as branch_name
          FROM users u
          LEFT JOIN roles r ON r.id = u.role_id
          LEFT JOIN branches b ON b.id = u.branch_id
          WHERE u.pin = ? AND u.is_active = 1 AND u.branch_id = ?
          LIMIT 1
        `).get(pin, branch_id) as Record<string, unknown> | undefined

        // If not found in branch, check if it's a super admin PIN (no branch restriction)
        if (!user) {
          user = db.prepare(`
            SELECT u.*, r.name as role_name, r.permissions as role_permissions,
                   b.name as branch_name
            FROM users u
            LEFT JOIN roles r ON r.id = u.role_id
            LEFT JOIN branches b ON b.id = u.branch_id
            WHERE u.pin = ? AND u.is_active = 1
              AND r.permissions LIKE '%"all":true%'
            LIMIT 1
          `).get(pin) as Record<string, unknown> | undefined
        }
      } else {
        user = db.prepare(`
          SELECT u.*, r.name as role_name, r.permissions as role_permissions,
                 b.name as branch_name
          FROM users u
          LEFT JOIN roles r ON r.id = u.role_id
          LEFT JOIN branches b ON b.id = u.branch_id
          WHERE u.pin = ? AND u.is_active = 1
          LIMIT 1
        `).get(pin) as Record<string, unknown> | undefined
      }

      if (!user) {
        if (branch_id) {
          const anyUser = db.prepare(
            `SELECT id FROM users WHERE pin = ? AND is_active = 1 LIMIT 1`
          ).get(pin)
          if (anyUser) return { success: false, error: 'This PIN belongs to a different branch' }
        }
        return { success: false, error: 'Invalid PIN' }
      }

      const perms = JSON.parse(user.role_permissions as string || '{}')
      const payload = {
        id: user.id,
        name: user.name,
        email: user.email,
        role: { id: user.role_id, name: user.role_name, permissions: perms },
        branch: user.branch_id ? { id: user.branch_id, name: user.branch_name } : null,
        branch_id: user.branch_id,
        permissions: perms,
      }

      const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '12h' })
      store.set('auth_token', token)
      store.set('auth_user', payload)

      return { success: true, data: { user: payload, token } }
    } catch (err: unknown) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('auth:whoami', async () => {
    const user = store.get('auth_user') as Record<string, unknown> | undefined
    const token = store.get('auth_token') as string | undefined
    if (!token || !user) return { success: true, data: null }

    try {
      jwt.verify(token, JWT_SECRET)
      // Migrate old sessions where role was stored as a plain string
      if (typeof user.role === 'string') {
        store.delete('auth_token')
        store.delete('auth_user')
        return { success: true, data: null } // force re-login
      }
      return { success: true, data: user }
    } catch {
      store.delete('auth_token')
      store.delete('auth_user')
      return { success: true, data: null }
    }
  })

  ipcMain.handle('auth:logout', async () => {
    store.delete('auth_token')
    store.delete('auth_user')
    return { success: true }
  })
}
