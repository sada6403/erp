// POS review of mobile app requests: Smart Buy join requests (NIC photos) and bank-transfer slips.
// The records live in the cloud (cloud-only tables); this process only calls the admin endpoints with the POS key.
import type { IpcMain } from 'electron'
import { getDb } from '../database'
import { createCompanyStore } from '../services/companyWorkspace'
import { CloudApi } from '../services/cloudApi'
import { logAudit } from '../services/auditLog'
import { safeHandle } from './ipcHandler'
import { decryptSecret } from './settings'

const store = createCompanyStore()
type Json = Record<string, unknown>

function authUser(): Json {
  return (store.get('auth_user') as Json | undefined) || {}
}
function currentPerms(caller: Json = authUser()): Json {
  return ((caller.role as Json)?.permissions as Json) || (caller.permissions as Json) || {}
}
function requireAdmin(): Json {
  const caller = authUser()
  if (!caller.id || !currentPerms(caller).all) throw new Error('Only Super Admin can review mobile app requests')
  return caller
}
function getCloud(): CloudApi {
  const s = (store.get('app_settings') as Json) || {}
  const baseUrl = String(s.cloud_api_url || '').trim()
  const apiKey = decryptSecret(s.cloud_api_key).trim()
  if (!baseUrl || !apiKey) throw new Error('This device is not connected to the cloud (Settings > Cloud Sync)')
  return new CloudApi({ baseUrl, apiKey, deviceId: (store.get('device_id') as string | undefined) ?? null })
}
const actor = (c: Json) => String(c.name || c.email || '') || undefined
const dataUrl = (img: { contentType: string; bytes: Buffer }) => `data:${img.contentType};base64,${img.bytes.toString('base64')}`

/**
 * Cloud customers have no NIC column (privacy decision), and the cloud wipes the NIC 30 days after the decision.
 * So at approval time the POS remembers {customer_id: nic} (persisted) and writes it into the local customer as soon as that
 * row has synced down. Idempotent: only fills an empty NIC; the entry is dropped once applied.
 */
const PENDING_KEY = 'pending_member_nic'
function applyPendingNic(extra: Json[] = []): void {
  const pending = { ...((store.get(PENDING_KEY) as Record<string, string> | undefined) || {}) }
  for (const r of extra) if (r.status === 'approved' && r.customer_id && r.nic_number) pending[String(r.customer_id)] = String(r.nic_number)
  const db = getDb()
  let changed = false
  for (const [customerId, nic] of Object.entries(pending)) {
    const row = db.prepare(`SELECT id FROM customers WHERE id = ?`).get(customerId)
    if (!row) continue
    db.prepare(`UPDATE customers SET nic = ? WHERE id = ? AND (nic IS NULL OR nic = '')`).run(nic, customerId)
    delete pending[customerId]
    changed = true
  }
  if (changed || extra.length) store.set(PENDING_KEY, pending)
}
function rememberNic(customerId: string, nic: string): void {
  const pending = { ...((store.get(PENDING_KEY) as Record<string, string> | undefined) || {}) }
  pending[customerId] = nic
  store.set(PENDING_KEY, pending)
  // the customer row arrives with the next sync pull (30 s cycle); also applied whenever the screen is opened
  for (const ms of [35_000, 70_000, 130_000]) setTimeout(() => { try { applyPendingNic() } catch { /* retried on next list */ } }, ms)
}

export function registerAppRequestHandlers(ipcMain: IpcMain) {
  safeHandle(ipcMain, 'joinRequests:list', async (_e, filters: Json = {}) => {
    requireAdmin()
    const res = await getCloud().joinRequestsList(filters.status ? String(filters.status) : undefined)
    applyPendingNic(res.items)
    return { success: true, data: res.items }
  })
  safeHandle(ipcMain, 'joinRequests:photo', async (_e, id: string, side: string) => {
    requireAdmin()
    return { success: true, data: dataUrl(await getCloud().joinRequestPhoto(String(id), side === 'back' ? 'back' : 'front')) }
  })
  safeHandle(ipcMain, 'joinRequests:decide', async (_e, id: string, decision: string, reason?: string) => {
    const caller = requireAdmin()
    if (decision !== 'approve' && decision !== 'reject') throw new Error('Invalid decision')
    // read the NIC while the request is still pending (it is wiped from the cloud 30 days after the decision)
    const nic = decision === 'approve'
      ? String(((await getCloud().joinRequestsList('pending')).items.find(r => r.id === id) || {}).nic_number || '')
      : ''
    const res = await getCloud().joinRequestDecide(String(id), { decision, reason: reason ? String(reason).slice(0, 300) : undefined, decided_by: actor(caller) })
    if (decision === 'approve' && nic && typeof res.customer_id === 'string') rememberNic(res.customer_id, nic)
    logAudit(getDb(), {
      userId: (caller.id as string) || null, branchId: (caller.branch_id as string) || null,
      action: decision === 'approve' ? 'APP_JOIN_APPROVED' : 'APP_JOIN_REJECTED', tableName: 'smartbuy_join_requests', recordId: String(id),
      newValues: { decision, member_id: res.member_id ?? null },
    })
    return { success: true, data: res }
  })

  safeHandle(ipcMain, 'paymentSlips:list', async (_e, filters: Json = {}) => {
    requireAdmin()
    const res = await getCloud().paymentSlipsList(filters.status ? String(filters.status) : undefined)
    return { success: true, data: res.items }
  })
  safeHandle(ipcMain, 'paymentSlips:image', async (_e, id: string) => {
    requireAdmin()
    return { success: true, data: dataUrl(await getCloud().paymentSlipImage(String(id))) }
  })
  safeHandle(ipcMain, 'paymentSlips:decide', async (_e, id: string, decision: string, reason?: string) => {
    const caller = requireAdmin()
    if (decision !== 'verify' && decision !== 'reject') throw new Error('Invalid decision')
    const res = await getCloud().paymentSlipDecide(String(id), { decision, reason: reason ? String(reason).slice(0, 300) : undefined, reviewed_by: actor(caller) })
    logAudit(getDb(), {
      userId: (caller.id as string) || null, branchId: (caller.branch_id as string) || null,
      action: decision === 'verify' ? 'APP_SLIP_VERIFIED' : 'APP_SLIP_REJECTED', tableName: 'order_payment_slips', recordId: String(id),
      newValues: { decision },
    })
    return { success: true, data: res }
  })
}
