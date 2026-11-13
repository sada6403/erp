// POS admin side of the sales force: hierarchy, targets and performance. The records live in the cloud (cloud-only tables);
// this process only calls the admin endpoints with the POS key. Super Admin only; every change is also written to the local audit log.
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
function requireAdmin(): Json {
  const caller = authUser()
  const perms = ((caller.role as Json)?.permissions as Json) || (caller.permissions as Json) || {}
  if (!caller.id || !perms.all) throw new Error('Only Super Admin can manage the sales team')
  return caller
}
function getCloud(): CloudApi {
  const s = (store.get('app_settings') as Json) || {}
  const baseUrl = String(s.cloud_api_url || '').trim()
  const apiKey = decryptSecret(s.cloud_api_key).trim()
  if (!baseUrl || !apiKey) throw new Error('This device is not connected to the cloud (Settings > Cloud Sync)')
  return new CloudApi({ baseUrl, apiKey, deviceId: (store.get('device_id') as string | undefined) ?? null })
}
const audit = (caller: Json, action: string, table: string, recordId: string, newValues: Json) =>
  logAudit(getDb(), { userId: (caller.id as string) || null, branchId: (caller.branch_id as string) || null, action, tableName: table, recordId, newValues })

export function registerSalesTeamHandlers(ipcMain: IpcMain) {
  safeHandle(ipcMain, 'salesTeam:assignments', async () => {
    requireAdmin()
    return { success: true, data: await getCloud().staffAssignments() }
  })
  safeHandle(ipcMain, 'salesTeam:assign', async (_e, input: Json) => {
    const caller = requireAdmin()
    const body = {
      staff_id: String(input?.staff_id || ''), level_key: String(input?.level_key || ''),
      ...(input?.reports_to_staff_id ? { reports_to_staff_id: String(input.reports_to_staff_id) } : {}),
    }
    const res = await getCloud().staffAssign(body)
    audit(caller, 'SALES_TEAM_ASSIGN', 'staff_assignments', String(res.id ?? body.staff_id), body)
    return { success: true, data: res }
  })
  safeHandle(ipcMain, 'salesTeam:unassign', async (_e, staffId: string) => {
    const caller = requireAdmin()
    const res = await getCloud().staffUnassign(String(staffId))
    audit(caller, 'SALES_TEAM_UNASSIGN', 'staff_assignments', String(staffId), { staff_id: String(staffId) })
    return { success: true, data: res }
  })
  safeHandle(ipcMain, 'salesTeam:overview', async (_e, period?: string) => {
    requireAdmin()
    return { success: true, data: await getCloud().staffOverview(period ? String(period) : undefined) }
  })
  safeHandle(ipcMain, 'salesTeam:targets', async (_e, staffId: string) => {
    requireAdmin()
    return { success: true, data: (await getCloud().staffTargets(String(staffId))).items }
  })
  safeHandle(ipcMain, 'salesTeam:setTarget', async (_e, input: Json) => {
    const caller = requireAdmin()
    const body = {
      staff_id: String(input?.staff_id || ''), period: String(input?.period || ''), amount: Number(input?.amount),
      ...(input?.registrations_target !== undefined && input?.registrations_target !== '' && input?.registrations_target !== null ? { registrations_target: Number(input.registrations_target) } : {}),
    }
    const res = await getCloud().staffTargetSet(body)
    audit(caller, 'SALES_TEAM_TARGET_SET', 'staff_targets', String(res.id ?? body.staff_id), body)
    return { success: true, data: res }
  })
}
