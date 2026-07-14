import type { IpcMain } from 'electron'
import { getDb } from '../database'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import Store from 'electron-store'
import crypto from 'crypto'
import nodemailer from 'nodemailer'
import { generateSecret, verifyTOTP, generateQrDataUrl } from '../services/totpService'
import { decryptSecret } from './settings'
import { enqueueUserRow } from '../services/syncQueue'
import { logAudit } from '../services/auditLog'
import { getCachedLicense, getEnabledModules, getMaxBranches, getMaxUsers } from '../services/licenseService'

const store = new Store()

// In-memory OTP store — intentionally cleared on app restart
const otpStore = new Map<string, { otp: string; expires: number; userId: string }>()

function getJwtSecret(): string {
  let secret = store.get('jwt_secret') as string | undefined
  if (!secret) {
    secret = crypto.randomBytes(64).toString('hex')
    store.set('jwt_secret', secret)
  }
  return secret
}
const JWT_SECRET = getJwtSecret()

type AuthScope = {
  level: 'owner' | 'branch' | 'subBranch'
  branchId: string | null
  subBranchId: string | null
}

function readPermissions(user: Record<string, unknown>): Record<string, boolean> {
  try {
    const roleObj = user.role as Record<string, unknown> | undefined
    const raw = user.role_permissions ?? user.permissions ?? roleObj?.permissions ?? {}
    return typeof raw === 'string' ? JSON.parse(raw) as Record<string, boolean> : (raw as Record<string, boolean>)
  } catch {
    return {}
  }
}

function resolveSessionScope(user: Record<string, unknown>): { portal: 'admin' | 'pos'; scope: AuthScope } {
  const roleObj = user.role as Record<string, unknown> | undefined
  const roleName = String(user.role_name || roleObj?.name || '').trim().toLowerCase()
  const branchId = user.branch_id ? String(user.branch_id) : null
  const isOwner = roleName === 'company admin' || roleName === 'owner' || roleName === 'super admin'
    || Boolean((readPermissions(user)).all)
  const isBranchManager = roleName === 'branch manager'
  const isCashier = roleName === 'cashier'

  if (isOwner) {
    return { portal: 'admin', scope: { level: 'owner', branchId: null, subBranchId: null } }
  }

  if (isBranchManager) {
    if (!branchId) throw new Error('Branch Manager account must be assigned to a branch before login')
    return { portal: 'admin', scope: { level: 'branch', branchId, subBranchId: null } }
  }

  if (isCashier) {
    if (!branchId) throw new Error('Cashier account must be assigned to a branch before login')
    return { portal: 'pos', scope: { level: 'subBranch', branchId, subBranchId: branchId } }
  }

  if (!branchId) {
    throw new Error('Account must be assigned to a branch before login')
  }

  return { portal: 'pos', scope: { level: 'subBranch', branchId, subBranchId: branchId } }
}

function resolveSessionMeta(user: Record<string, unknown>) {
  const roleObj = user.role as Record<string, unknown> | undefined
  const permissions = readPermissions(user)
  const enabledFeatures = Object.entries(permissions)
    .filter(([, value]) => Boolean(value))
    .map(([key]) => key)
  const cachedLicense = getCachedLicense()
  return {
    enabledModules: getEnabledModules() ?? cachedLicense?.modules ?? [],
    enabledFeatures,
    limits: {
      maxUsers: getMaxUsers(),
      maxBranches: getMaxBranches(),
    },
    licenseId: (store.get('device_license_key') as string | undefined)
      ?? (store.get('device_company_key') as string | undefined)
      ?? null,
    deviceId: (store.get('device_id') as string | undefined) ?? null,
    permissions,
  }
}

function buildAuthUserPayload(user: Record<string, unknown>, company?: { id: string; name: string; slug?: string }) {
  const { portal, scope } = resolveSessionScope(user)
  const meta = resolveSessionMeta(user)
  const roleObj = user.role as Record<string, unknown> | undefined

  return {
    id: String(user.id),
    name: String(user.name || ''),
    email: String(user.email || ''),
    company_id: company?.id ?? null,
    portal,
    role_id: user.role_id ? String(user.role_id) : undefined,
    role: {
      id: String(user.role_id || ''),
      name: String(user.role_name || (roleObj?.name as string | undefined) || 'User'),
      permissions: meta.permissions,
      created_at: '',
    },
    branch: user.branch_id ? { id: String(user.branch_id), name: String(user.branch_name || ''), is_active: true, created_at: '', updated_at: '' } : undefined,
    branch_id: user.branch_id ? String(user.branch_id) : null,
    sub_branch_id: null,
    permissions: meta.permissions,
    enabledModules: meta.enabledModules,
    enabledFeatures: meta.enabledFeatures,
    limits: meta.limits,
    licenseId: meta.licenseId,
    deviceId: meta.deviceId,
    scope,
    company: company ? { id: company.id, name: company.name, slug: company.slug } : undefined,
  }
}

function loadCurrentAuthUser(userId: string): Record<string, unknown> | undefined {
  const db = getDb()
  return db.prepare(`
      SELECT u.*, r.name as role_name, r.permissions as role_permissions,
             b.name as branch_name
      FROM users u
      LEFT JOIN roles r ON r.id = u.role_id
      LEFT JOIN branches b ON b.id = u.branch_id
      WHERE u.id = ?
      LIMIT 1
    `).get(userId) as Record<string, unknown> | undefined
}

export function registerAuthHandlers(ipcMain: IpcMain) {
  ipcMain.handle('auth:loginOptions', async (_e, payload?: { branch_id?: string }) => {
    try {
      const db = getDb()
      const branchId = String(payload?.branch_id || '').trim()
      const users = branchId
        ? db.prepare(`
            SELECT u.id, u.name, u.email, u.pin, u.pin_hash, u.branch_id, r.name as role_name
            FROM users u
            LEFT JOIN roles r ON r.id = u.role_id
            WHERE u.is_active = 1 AND (u.branch_id = ? OR u.branch_id IS NULL)
          `).all(branchId) as Record<string, unknown>[]
        : db.prepare(`
            SELECT u.id, u.name, u.email, u.pin, u.pin_hash, u.branch_id, r.name as role_name
            FROM users u
            LEFT JOIN roles r ON r.id = u.role_id
            WHERE u.is_active = 1
          `).all() as Record<string, unknown>[]

      const pinUsers = users.filter(user => 
        String(user.pin || '').trim().length > 0 ||
        String(user.pin_hash || '').trim().length > 0
      )
      const admin = users.find(user => {
        const roleName = String(user.role_name || '').toLowerCase()
        const email = String(user.email || '').toLowerCase()
        return roleName.includes('admin') || email.includes('admin')
      }) || users[0]

      return {
        success: true,
        data: {
          users: users.length,
          pin_users: pinUsers.length,
          admin_email: admin?.email ? String(admin.email) : '',
        },
      }
    } catch (err: unknown) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('auth:login', async (_e, { email, password }) => {
    try {
      const db = getDb()
      const normalizedEmail = String(email || '').trim().toLowerCase()
      const user = db.prepare(`
        SELECT u.*, r.name as role_name, r.permissions as role_permissions,
               b.name as branch_name
        FROM users u
        LEFT JOIN roles r ON r.id = u.role_id
        LEFT JOIN branches b ON b.id = u.branch_id
        WHERE LOWER(u.email) = ?
      `).get(normalizedEmail) as Record<string, unknown> | undefined

      if (!user) {
        logAudit(db, { action: 'LOGIN_FAILED', newValues: { email: normalizedEmail, reason: 'User not found' } })
        return { success: false, error: 'Invalid credentials' }
      }

      // Check account active
      if (!user.is_active) return { success: false, error: 'Account is disabled. Contact your administrator.' }

      // Check account lockout
      if (user.locked_until) {
        const lockedUntil = new Date(user.locked_until as string)
        if (lockedUntil > new Date()) {
          const mins = Math.ceil((lockedUntil.getTime() - Date.now()) / 60000)
          return { success: false, error: `Account locked. Try again in ${mins} minute(s).` }
        }
        // Lock expired — reset
        db.prepare(`UPDATE users SET login_attempts=0, locked_until=NULL WHERE id=?`).run(user.id)
      }

      if (!user.password_hash) {
        return { success: false, error: 'Password is not set for this account. Ask admin to set a password or PIN.' }
      }

      const valid = await bcrypt.compare(String(password || ''), user.password_hash as string)
      if (!valid) {
        const attempts = (Number(user.login_attempts) || 0) + 1
        const locked = attempts >= 5
        db.prepare(`UPDATE users SET login_attempts=?, locked_until=? WHERE id=?`)
          .run(attempts, locked ? new Date(Date.now() + 15 * 60000).toISOString() : null, user.id)
        logAudit(db, {
          userId: user.id as string, branchId: user.branch_id as string,
          action: 'LOGIN_FAILED', newValues: { attempts, locked },
        })
        if (locked) return { success: false, error: 'Too many failed attempts. Account locked for 15 minutes.' }
        return { success: false, error: `Invalid credentials. ${5 - attempts} attempt(s) remaining.` }
      }

      // Reset failed attempts on success
      db.prepare(`UPDATE users SET login_attempts=0, locked_until=NULL WHERE id=?`).run(user.id)

      // Check 2FA
      if (user.two_factor_enabled && user.two_factor_secret) {
        const tempToken = jwt.sign(
          { userId: user.id, type: '2fa_pending' },
          JWT_SECRET,
          { expiresIn: '5m' }
        )
        return { success: true, requiresTwoFactor: true, tempToken }
      }

      // Check force password change
      if (user.force_password_change) {
        const tempToken = jwt.sign(
          { userId: user.id, type: 'force_pw_change' },
          JWT_SECRET,
          { expiresIn: '15m' }
        )
        return { success: true, requiresPasswordChange: true, tempToken, userName: user.name }
      }

      // Update last login
      db.prepare(`UPDATE users SET last_login_at = datetime('now') WHERE id = ?`).run(user.id)

      // Audit log
      logAudit(db, { userId: user.id as string, branchId: user.branch_id as string, action: 'LOGIN' })

      const payload = buildAuthUserPayload(user as Record<string, unknown>)

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
      let users: Record<string, unknown>[] = []

      if (branch_id) {
        // Strict branch isolation — only active users assigned to this branch can login
        users = db.prepare(`
          SELECT u.*, r.name as role_name, r.permissions as role_permissions,
                 b.name as branch_name
          FROM users u
          LEFT JOIN roles r ON r.id = u.role_id
          LEFT JOIN branches b ON b.id = u.branch_id
          WHERE u.is_active = 1 AND u.branch_id = ?
        `).all(branch_id) as Record<string, unknown>[]
      } else {
        users = db.prepare(`
          SELECT u.*, r.name as role_name, r.permissions as role_permissions,
                 b.name as branch_name
          FROM users u
          LEFT JOIN roles r ON r.id = u.role_id
          LEFT JOIN branches b ON b.id = u.branch_id
          WHERE u.is_active = 1
        `).all() as Record<string, unknown>[]
      }

      let matchedUser: Record<string, unknown> | undefined
      for (const u of users) {
        if (u.pin_hash) {
          const match = await bcrypt.compare(String(pin), String(u.pin_hash))
          if (match) {
            matchedUser = u
            break
          }
        } else if (u.pin && String(u.pin).trim() === String(pin).trim()) {
          // Legacy plaintext PIN — accept once, then upgrade to a hash and
          // sync it so the PIN starts working on the company's other devices.
          const upgraded = await bcrypt.hash(String(pin).trim(), 10)
          db.prepare(`UPDATE users SET pin_hash=?, pin=NULL, updated_at=datetime('now') WHERE id=?`)
            .run(upgraded, u.id)
          await enqueueUserRow(String(u.id))
          u.pin_hash = upgraded
          matchedUser = u
          break
        }
      }

      if (!matchedUser) {
        return { success: false, error: 'Invalid PIN' }
      }

      const user = matchedUser

      const payload = buildAuthUserPayload(user as Record<string, unknown>)

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
      const decoded = jwt.verify(token, JWT_SECRET) as { id?: string }
      // Migrate old sessions where role was stored as a plain string
      if (typeof user.role === 'string') {
        store.delete('auth_token')
        store.delete('auth_user')
        return { success: true, data: null } // force re-login
      }
      const fresh = decoded?.id ? loadCurrentAuthUser(decoded.id) : undefined
      if (!fresh || !fresh.is_active) {
        store.delete('auth_token')
        store.delete('auth_user')
        return { success: true, data: null }
      }
      const payload = buildAuthUserPayload(fresh as Record<string, unknown>)
      store.set('auth_user', payload)
      return { success: true, data: payload }
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

  // ── 2FA: verify OTP after password login ─────────────────────────────────
  ipcMain.handle('auth:2fa:verify', async (_e, { tempToken, otp }: { tempToken: string; otp: string }) => {
    try {
      const decoded = jwt.verify(tempToken, JWT_SECRET) as { userId: string; type: string }
      if (decoded.type !== '2fa_pending') return { success: false, error: 'Invalid token' }

      const db = getDb()
      const user = db.prepare(`
        SELECT u.*, r.name as role_name, r.permissions as role_permissions, b.name as branch_name
        FROM users u
        LEFT JOIN roles r ON r.id = u.role_id
        LEFT JOIN branches b ON b.id = u.branch_id
        WHERE u.id = ? AND u.is_active = 1
      `).get(decoded.userId) as Record<string, unknown> | undefined

      if (!user) return { success: false, error: 'User not found' }
      if (!verifyTOTP(user.two_factor_secret as string, otp)) {
        return { success: false, error: 'Invalid authentication code' }
      }

      db.prepare(`UPDATE users SET last_login_at = datetime('now') WHERE id = ?`).run(user.id)
      logAudit(db, { userId: user.id as string, branchId: user.branch_id as string, action: 'LOGIN_2FA' })

      const payload = buildAuthUserPayload(user as Record<string, unknown>)
      const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '12h' })
      store.set('auth_token', token)
      store.set('auth_user', payload)
      return { success: true, data: { user: payload, token } }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  // ── 2FA: setup — generate secret + QR code ───────────────────────────────
  ipcMain.handle('auth:2fa:setup', async (_e, { userId }: { userId: string }) => {
    try {
      const db = getDb()
      const user = db.prepare(`SELECT email FROM users WHERE id = ?`).get(userId) as { email: string } | undefined
      if (!user) return { success: false, error: 'User not found' }
      const secret = generateSecret()
      const qrDataUrl = await generateQrDataUrl(secret, user.email)
      // Store temp secret but do NOT enable yet (user must confirm)
      db.prepare(`UPDATE users SET two_factor_secret = ? WHERE id = ?`).run(secret, userId)
      return { success: true, data: { secret, qrDataUrl } }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  // ── 2FA: confirm — verify OTP to activate 2FA ────────────────────────────
  ipcMain.handle('auth:2fa:confirm', async (_e, { userId, otp }: { userId: string; otp: string }) => {
    try {
      const db = getDb()
      const user = db.prepare(`SELECT two_factor_secret FROM users WHERE id = ?`).get(userId) as { two_factor_secret: string } | undefined
      if (!user?.two_factor_secret) return { success: false, error: 'Setup not started — call auth:2fa:setup first' }
      if (!verifyTOTP(user.two_factor_secret, otp)) {
        return { success: false, error: 'Invalid code — please try again' }
      }
      db.prepare(`UPDATE users SET two_factor_enabled = 1 WHERE id = ?`).run(userId)
      logAudit(db, { userId, action: '2FA_ENABLED' })
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  // ── 2FA: disable ─────────────────────────────────────────────────────────
  ipcMain.handle('auth:2fa:disable', async (_e, { userId, otp }: { userId: string; otp: string }) => {
    try {
      const db = getDb()
      const user = db.prepare(`SELECT two_factor_secret, two_factor_enabled FROM users WHERE id = ?`).get(userId) as Record<string, unknown> | undefined
      if (!user) return { success: false, error: 'User not found' }
      if (!user.two_factor_enabled) return { success: false, error: '2FA is not enabled' }
      if (!verifyTOTP(user.two_factor_secret as string, otp)) {
        return { success: false, error: 'Invalid code' }
      }
      db.prepare(`UPDATE users SET two_factor_enabled = 0, two_factor_secret = NULL WHERE id = ?`).run(userId)
      logAudit(db, { userId, action: '2FA_DISABLED' })
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  // ── 2FA: status ──────────────────────────────────────────────────────────
  ipcMain.handle('auth:2fa:status', async (_e, { userId }: { userId: string }) => {
    try {
      const db = getDb()
      const user = db.prepare(`SELECT two_factor_enabled FROM users WHERE id = ?`).get(userId) as { two_factor_enabled: number } | undefined
      return { success: true, data: { enabled: Boolean(user?.two_factor_enabled) } }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  // ── Forgot password: generate OTP and send via email if SMTP configured ───
  ipcMain.handle('auth:forgotPassword', async (_e, { email }: { email: string }) => {
    try {
      const db = getDb()
      const user = db.prepare(
        `SELECT id, name, email FROM users WHERE LOWER(email) = ? AND is_active = 1`
      ).get(email.toLowerCase().trim()) as Record<string, unknown> | undefined

      if (!user) {
        // Don't reveal whether email exists — return generic success
        return { success: true, sent: false, noSmtp: true }
      }

      const otp = String(Math.floor(100000 + Math.random() * 900000))
      otpStore.set(email.toLowerCase().trim(), {
        otp,
        expires: Date.now() + 10 * 60 * 1000,
        userId: user.id as string,
      })

      // Try to send via SMTP — read from app_settings (where settings are stored)
      const settings = (store.get('app_settings') as Record<string, unknown>) || {}
      const smtpEnabled = Boolean(settings.email_enabled)
      const smtpHost = String(settings.smtp_host || '')

      if (smtpEnabled && smtpHost) {
        try {
          const smtpPort = Number(settings.smtp_port || 587)
          const encryption = String(settings.smtp_encryption || 'TLS')
          const smtpUser = String(settings.smtp_username || '')
          const fromEmail = String(settings.smtp_from_email || smtpUser)
          const fromName = String(settings.smtp_from_name || 'POS System')

          const smtpPass = settings.smtp_password
            ? decryptSecret(settings.smtp_password)
            : ''

          const transport = nodemailer.createTransport({
            host: smtpHost,
            port: smtpPort,
            secure: encryption === 'SSL',
            requireTLS: encryption === 'TLS',
            auth: smtpUser ? { user: smtpUser, pass: smtpPass } : undefined,
          })

          await transport.sendMail({
            from: `"${fromName}" <${fromEmail}>`,
            to: email,
            subject: 'Password Reset Code — Enterprise POS',
            html: `
              <div style="font-family:sans-serif;max-width:480px;margin:auto">
                <h2 style="color:#4f46e5">Password Reset Request</h2>
                <p>Hello <strong>${user.name}</strong>,</p>
                <p>Your password reset code is:</p>
                <div style="font-size:36px;font-weight:bold;letter-spacing:10px;padding:20px;background:#f1f5f9;border-radius:8px;text-align:center;color:#1e293b">
                  ${otp}
                </div>
                <p style="color:#64748b;font-size:13px">This code expires in 10 minutes. If you did not request this, contact your administrator.</p>
              </div>`,
            text: `Your Enterprise POS password reset code is: ${otp}\nExpires in 10 minutes.`,
          })

          logAudit(db, { userId: user.id as string, action: 'PASSWORD_RESET_OTP_SENT', newValues: { email } })

          return { success: true, sent: true }
        } catch (emailErr) {
          // SMTP failed — fall through to no-SMTP response
          console.error('[ForgotPassword] SMTP error:', emailErr)
        }
      }

      // No SMTP or send failed — OTP is still stored, just not emailed
      return { success: true, sent: false, noSmtp: !smtpEnabled || !smtpHost }
    } catch (err: unknown) {
      return { success: false, error: (err as Error).message }
    }
  })

  // ── Reset password using OTP ──────────────────────────────────────────────
  ipcMain.handle('auth:resetWithOtp', async (_e, { email, otp, newPassword }: { email: string; otp: string; newPassword: string }) => {
    try {
      const key = email.toLowerCase().trim()
      const entry = otpStore.get(key)

      if (!entry) return { success: false, error: 'No reset request found. Please request a new code.' }
      if (Date.now() > entry.expires) {
        otpStore.delete(key)
        return { success: false, error: 'Code has expired. Please request a new one.' }
      }
      if (entry.otp !== otp.trim()) return { success: false, error: 'Invalid code. Please try again.' }
      if (!newPassword || newPassword.length < 8) return { success: false, error: 'Password must be at least 8 characters.' }

      const db = getDb()
      const hash = await bcrypt.hash(newPassword, 10)
      db.prepare(`
        UPDATE users SET password_hash=?, force_password_change=0,
          login_attempts=0, locked_until=NULL, updated_at=datetime('now')
        WHERE id=?
      `).run(hash, entry.userId)
      logAudit(db, { userId: entry.userId, action: 'PASSWORD_RESET_OTP' })
      await enqueueUserRow(entry.userId)

      otpStore.delete(key)
      return { success: true }
    } catch (err: unknown) {
      return { success: false, error: (err as Error).message }
    }
  })

  // ── Change own password (requires current password) ───────────────────────
  ipcMain.handle('auth:changePassword', async (_e, { userId, currentPassword, newPassword }: { userId: string; currentPassword: string; newPassword: string }) => {
    try {
      const db = getDb()
      const user = db.prepare(`SELECT id, password_hash, branch_id FROM users WHERE id = ? AND is_active = 1`).get(userId) as Record<string, unknown> | undefined
      if (!user) return { success: false, error: 'User not found' }

      const valid = await bcrypt.compare(currentPassword, user.password_hash as string)
      if (!valid) return { success: false, error: 'Current password is incorrect' }

      if (newPassword.length < 8) return { success: false, error: 'Password must be at least 8 characters' }

      const hash = await bcrypt.hash(newPassword, 10)
      db.prepare(`UPDATE users SET password_hash=?, force_password_change=0, updated_at=datetime('now') WHERE id=?`).run(hash, userId)
      logAudit(db, { userId, branchId: user.branch_id as string, action: 'PASSWORD_CHANGED' })
      await enqueueUserRow(userId)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  // ── Complete forced password change (uses tempToken from login) ───────────
  ipcMain.handle('auth:completeForcePasswordChange', async (_e, { tempToken, newPassword }: { tempToken: string; newPassword: string }) => {
    try {
      const decoded = jwt.verify(tempToken, JWT_SECRET) as { userId: string; type: string }
      if (decoded.type !== 'force_pw_change') return { success: false, error: 'Invalid token' }

      if (newPassword.length < 8) return { success: false, error: 'Password must be at least 8 characters' }

      const db = getDb()
      const user = db.prepare(`
        SELECT u.*, r.name as role_name, r.permissions as role_permissions, b.name as branch_name
        FROM users u LEFT JOIN roles r ON r.id=u.role_id LEFT JOIN branches b ON b.id=u.branch_id
        WHERE u.id = ? AND u.is_active = 1
      `).get(decoded.userId) as Record<string, unknown> | undefined
      if (!user) return { success: false, error: 'User not found' }

      const hash = await bcrypt.hash(newPassword, 10)
      db.prepare(`UPDATE users SET password_hash=?, force_password_change=0, last_login_at=datetime('now'), updated_at=datetime('now') WHERE id=?`).run(hash, decoded.userId)
      logAudit(db, { userId: decoded.userId, branchId: user.branch_id as string, action: 'PASSWORD_CHANGED' })
      await enqueueUserRow(decoded.userId)

      const payload = buildAuthUserPayload(user as Record<string, unknown>)
      const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '12h' })
      store.set('auth_token', token)
      store.set('auth_user', payload)
      return { success: true, data: { user: payload, token } }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })
}
