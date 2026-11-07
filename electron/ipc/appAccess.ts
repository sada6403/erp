import type { IpcMain } from 'electron'
import { shell } from 'electron'
import { getDb } from '../database'
import { createCompanyStore } from '../services/companyWorkspace'
import { CloudApi } from '../services/cloudApi'
import { logAudit } from '../services/auditLog'
import { safeHandle } from './ipcHandler'
import { decryptSecret } from './settings'
import {
  isSafeWhatsAppUrl, matchAppUser, normalizePhone, PendingChatStore,
  type AppAccessKind, type AppUserRow,
} from '../services/appAccessUtil'

const store = createCompanyStore()
const pending = new PendingChatStore()
const INVITE_CHUNK = 50

type Json = Record<string, unknown>

function authUser(): Json {
  return (store.get('auth_user') as Json | undefined) || {}
}
function currentPerms(caller: Json = authUser()): Json {
  return ((caller.role as Json)?.permissions as Json) || (caller.permissions as Json) || {}
}
function requireAdmin(): Json {
  const caller = authUser()
  if (!caller.id || !currentPerms(caller).all) throw new Error('Only Super Admin can manage mobile app access')
  return caller
}
function getCloud(): CloudApi {
  const s = (store.get('app_settings') as Json) || {}
  const baseUrl = String(s.cloud_api_url || '').trim()
  const apiKey = decryptSecret(s.cloud_api_key).trim()
  if (!baseUrl || !apiKey) throw new Error('This device is not connected to the cloud (Settings > Cloud Sync)')
  return new CloudApi({ baseUrl, apiKey, deviceId: (store.get('device_id') as string | undefined) ?? null })
}
function downloadLink(): string | undefined {
  const row = getDb().prepare(`SELECT value FROM app_settings WHERE setting_key='download_link'`).get() as { value: string | null } | undefined
  const v = String(row?.value || '').trim()
  return /^https?:\/\//i.test(v) ? v : undefined
}

interface Candidate {
  key: string
  kind: AppAccessKind
  customer_id?: string
  agent_id?: string
  name: string
  phone: string | null
  code: string | null
  branch_id: string | null
  branch_name: string | null
}

function localCandidates(): Candidate[] {
  const db = getDb()
  const customers = db.prepare(`
    SELECT c.id, c.name, c.phone, c.branch_id, b.name AS branch_name,
           EXISTS(SELECT 1 FROM chit_members m WHERE m.customer_id = c.id) AS is_member
      FROM customers c LEFT JOIN branches b ON b.id = c.branch_id
     ORDER BY c.name LIMIT 5000`).all() as Json[]
  const agents = db.prepare(`
    SELECT a.id, a.code, a.name, a.phone, a.branch_id, b.name AS branch_name
      FROM agents a LEFT JOIN branches b ON b.id = a.branch_id
     WHERE a.status = 'active' ORDER BY a.name`).all() as Json[]
  return [
    ...agents.map((a): Candidate => ({
      key: `agent:${a.id}`, kind: 'agent', agent_id: String(a.id), name: String(a.name),
      phone: a.phone ? String(a.phone) : null, code: String(a.code),
      branch_id: (a.branch_id as string) || null, branch_name: (a.branch_name as string) || null,
    })),
    ...customers.map((c): Candidate => ({
      key: `customer:${c.id}`, kind: Number(c.is_member) ? 'smartbuy' : 'customer', customer_id: String(c.id), name: String(c.name),
      phone: c.phone ? String(c.phone) : null, code: null,
      branch_id: (c.branch_id as string) || null, branch_name: (c.branch_name as string) || null,
    })),
  ]
}

async function fetchAppUsers(): Promise<AppUserRow[]> {
  const res = await getCloud().appAccessList()
  return (res.items || []) as unknown as AppUserRow[]
}

/** Runs the backend invite for the given targets; keeps click-to-chat URLs in memory only. */
async function runInvite(targets: Array<{ customer_id?: string; agent_id?: string }>) {
  const caller = authUser()
  const cloud = getCloud()
  const sentBy = String(caller.name || caller.email || '') || undefined
  const dl = downloadLink()
  const out: Array<{ target: Json; ok: boolean; name?: string; phone?: string; roles?: unknown; skipped_reason?: string; dispatch_id?: string }> = []
  for (let i = 0; i < targets.length; i += INVITE_CHUNK) {
    const res = await cloud.appAccessInvite({ targets: targets.slice(i, i + INVITE_CHUNK), download_link: dl, sent_by: sentBy })
    for (const r of res.results || []) {
      const url = typeof r.whatsapp_url === 'string' ? r.whatsapp_url : ''
      const dispatchId = typeof r.dispatch_id === 'string' ? r.dispatch_id : ''
      if (r.ok && dispatchId && isSafeWhatsAppUrl(url)) pending.put(dispatchId, url)
      out.push({
        target: (r.target as Json) || {}, ok: Boolean(r.ok) && Boolean(dispatchId) && isSafeWhatsAppUrl(url),
        name: r.name as string | undefined, phone: r.phone as string | undefined, roles: r.roles,
        skipped_reason: (r.skipped_reason as string | undefined) || (r.ok && !isSafeWhatsAppUrl(url) ? 'INVALID_LINK' : undefined),
        dispatch_id: dispatchId || undefined,
      })
    }
  }
  // Audit WITHOUT message/password.
  logAudit(getDb(), {
    userId: (caller.id as string) || null, branchId: (caller.branch_id as string) || null,
    action: 'APP_ACCESS_INVITE_PREPARED', tableName: 'app_users', recordId: null,
    newValues: { requested: targets.length, prepared: out.filter(o => o.ok).length },
  })
  return out
}

export function registerAppAccessHandlers(ipcMain: IpcMain) {
  safeHandle(ipcMain, 'appAccess:list', async (_e, filters: Json = {}) => {
    requireAdmin()
    const users = await fetchAppUsers()
    const used = new Set<string>()
    let rows = localCandidates().map(c => {
      const u = matchAppUser(users, { kind: c.kind, code: c.code, phone: c.phone })
      if (u) used.add(u.user_id)
      return {
        ...c,
        valid_phone: Boolean(normalizePhone(c.phone)),
        app: u ? {
          user_id: u.user_id, status: u.status, must_change_password: Boolean(u.must_change_password),
          last_login_at: u.last_login_at ?? null, last_dispatch_status: u.last_dispatch_status ?? null,
          last_dispatch_at: u.last_dispatch_at ?? null, pending_reset_request_id: u.pending_reset_request_id ?? null,
          member_no: u.member_no ?? null,
        } : null,
      }
    })
    const role = String(filters.role || '')
    if (role) rows = rows.filter(r => r.kind === role)
    if (filters.branch_id) rows = rows.filter(r => r.branch_id === filters.branch_id)
    if (filters.notInvited) rows = rows.filter(r => !r.app)
    const q = String(filters.search || '').trim().toLowerCase()
    if (q) rows = rows.filter(r => r.name.toLowerCase().includes(q) || String(r.phone || '').includes(q) || String(r.code || '').toLowerCase().includes(q))
    const branches = getDb().prepare(`SELECT id, name FROM branches ORDER BY name`).all()
    return { success: true, data: { rows: rows.slice(0, 1000), total: rows.length, branches } }
  })

  safeHandle(ipcMain, 'appAccess:invite', async (_e, targets: Array<{ customer_id?: string; agent_id?: string }>) => {
    requireAdmin()
    if (!Array.isArray(targets) || targets.length === 0) throw new Error('Select at least one person')
    if (targets.length > 500) throw new Error('Select at most 500 people at a time')
    const clean = targets.map(t => t.agent_id ? { agent_id: String(t.agent_id) } : { customer_id: String(t.customer_id || '') })
      .filter(t => t.agent_id || t.customer_id)
    return { success: true, data: await runInvite(clean) }
  })

  // Opens the prepared click-to-chat link; staff press Send in WhatsApp. Nothing is ever sent automatically.
  safeHandle(ipcMain, 'appAccess:openChat', async (_e, dispatchId: string) => {
    const caller = requireAdmin()
    const url = pending.take(String(dispatchId || ''))
    if (!url) return { success: false, error: 'This message expired. Prepare the invite again.' }
    if (!isSafeWhatsAppUrl(url)) return { success: false, error: 'Blocked: not a WhatsApp link' }
    try {
      await shell.openExternal(url)
    } catch (err) {
      pending.put(String(dispatchId), url)
      return { success: false, error: 'Could not open WhatsApp: ' + (err as Error).message }
    }
    logAudit(getDb(), {
      userId: (caller.id as string) || null, branchId: (caller.branch_id as string) || null,
      action: 'APP_ACCESS_CHAT_OPENED', tableName: 'app_credential_dispatches', recordId: String(dispatchId),
    })
    return { success: true }
  })

  safeHandle(ipcMain, 'appAccess:discardChat', (_e, dispatchId: string) => {
    requireAdmin()
    pending.take(String(dispatchId || ''))
    return { success: true }
  })

  safeHandle(ipcMain, 'appAccess:setStatus', async (_e, userId: string, status: string) => {
    const caller = requireAdmin()
    if (status !== 'active' && status !== 'disabled') throw new Error('Invalid status')
    if (!userId) throw new Error('User is required')
    await getCloud().appAccessSetStatus(String(userId), status)
    logAudit(getDb(), {
      userId: (caller.id as string) || null, branchId: (caller.branch_id as string) || null,
      action: status === 'disabled' ? 'APP_ACCESS_DISABLED' : 'APP_ACCESS_ENABLED', tableName: 'app_users', recordId: String(userId),
    })
    return { success: true }
  })

  safeHandle(ipcMain, 'appAccess:resetRequests', (_e, filters: Json = {}) => {
    requireAdmin()
    const where = filters.all ? '' : `WHERE status='pending'`
    const rows = getDb().prepare(`SELECT id, user_id, name, phone, status, requested_at, resolved_at, resolved_by
      FROM app_password_reset_requests ${where} ORDER BY requested_at DESC LIMIT 200`).all()
    return { success: true, data: rows }
  })

  // Re-send temp password for a reset request: the invite endpoint issues a new temp password and
  // resolves the pending request; we return an opaque dispatch id for the click-to-chat step.
  safeHandle(ipcMain, 'appAccess:resendTempPassword', async (_e, requestId: string) => {
    requireAdmin()
    const req = getDb().prepare(`SELECT id, user_id, phone FROM app_password_reset_requests WHERE id=?`).get(String(requestId)) as
      { id: string; user_id: string; phone: string | null } | undefined
    if (!req) throw new Error('Reset request not found')
    const users = await fetchAppUsers()
    const user = users.find(u => u.user_id === req.user_id)
    if (!user) throw new Error('App account not found in the cloud')
    if (user.status === 'disabled') throw new Error('This account is disabled. Enable it first.')
    const cands = localCandidates()
    const cand = user.agent_code
      ? cands.find(c => c.kind === 'agent' && String(c.code).toUpperCase() === user.agent_code!.toUpperCase())
      : cands.find(c => c.kind !== 'agent' && normalizePhone(c.phone) && normalizePhone(c.phone) === normalizePhone(user.phone))
    if (!cand) throw new Error('No matching customer or agent found on this POS for that account')
    const [result] = await runInvite([cand.agent_id ? { agent_id: cand.agent_id } : { customer_id: cand.customer_id }])
    if (!result?.ok) return { success: false, error: 'Could not prepare the message (' + (result?.skipped_reason || 'unknown') + ')' }
    return { success: true, data: result }
  })
}
