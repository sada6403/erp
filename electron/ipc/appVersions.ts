import type { IpcMain } from 'electron'
import { getDb } from '../database'
import { createCompanyStore } from '../services/companyWorkspace'
import { CloudApi } from '../services/cloudApi'
import { logAudit } from '../services/auditLog'
import { safeHandle } from './ipcHandler'
import { decryptSecret } from './settings'

// In-app update policy (latest / minimum version, notes, test APK URL + sha256). Cloud-only: nothing is synced to the POS DB.
const store = createCompanyStore()
type Json = Record<string, unknown>
const VERSION_RE = /^\d{1,4}\.\d{1,4}\.\d{1,4}(?:-[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?$/

function requireAdmin(): Json {
  const caller = (store.get('auth_user') as Json | undefined) || {}
  const perms = ((caller.role as Json)?.permissions as Json) || (caller.permissions as Json) || {}
  if (!caller.id || !perms.all) throw new Error('Only Super Admin can manage app versions')
  return caller
}
function getCloud(): CloudApi {
  const s = (store.get('app_settings') as Json) || {}
  const baseUrl = String(s.cloud_api_url || '').trim()
  const apiKey = decryptSecret(s.cloud_api_key).trim()
  if (!baseUrl || !apiKey) throw new Error('This device is not connected to the cloud (Settings > Cloud Sync)')
  return new CloudApi({ baseUrl, apiKey, deviceId: (store.get('device_id') as string | undefined) ?? null })
}
const actorName = (c: Json) => String(c.name || c.email || '') || undefined

export function registerAppVersionsHandlers(ipcMain: IpcMain) {
  safeHandle(ipcMain, 'appVersions:list', async () => {
    requireAdmin()
    return { success: true, data: await getCloud().appVersionsList() }
  })

  safeHandle(ipcMain, 'appVersions:save', async (_e, p: Json) => {
    const caller = requireAdmin()
    const channel = p.channel === 'test' ? 'test' : p.channel === 'production' ? 'production' : null
    if (!channel) throw new Error('Choose Test or Production')
    const latest = String(p.latest_version ?? '').trim()
    const min = String(p.min_version ?? '').trim()
    if (!VERSION_RE.test(latest)) throw new Error('Latest version must look like 1.2.3 or 1.2.3-test.4')
    if (!VERSION_RE.test(min)) throw new Error('Minimum version must look like 1.2.3 or 1.2.3-test.4')
    const notes = (p.release_notes as Json) || {}
    const body: Json = {
      platform: 'android', channel, latest_version: latest, min_version: min, critical: Boolean(p.critical),
      release_notes: { en: String(notes.en ?? ''), ta: String(notes.ta ?? ''), si: String(notes.si ?? '') },
      updated_by: actorName(caller),
    }
    if (channel === 'test') {
      const url = String(p.update_url ?? '').trim()
      if (url && !/^https:\/\//i.test(url)) throw new Error('APK URL must start with https://')
      body.update_url = url || null
      const sha = String(p.apk_sha256 ?? '').trim()
      if (sha) {
        body.apk_sha256 = sha
        if (p.apk_size_bytes != null && p.apk_size_bytes !== '') body.apk_size_bytes = Number(p.apk_size_bytes)
      }
    }
    const data = await getCloud().appVersionSave(body)
    logAudit(getDb(), {
      userId: caller.id as string, branchId: (caller.branch_id as string) || null, action: 'APP_VERSION_SAVED', tableName: 'app_versions',
      recordId: `android:${channel}`,
      newValues: { channel, latest_version: latest, min_version: min, critical: body.critical, update_url: body.update_url ?? null },
    })
    return { success: true, data }
  })

  safeHandle(ipcMain, 'appVersions:hashApk', async (_e, channel: string) => {
    const caller = requireAdmin()
    if (channel !== 'test') throw new Error('Only the test channel has an APK')
    const data = await getCloud().appVersionHashApk({ channel: 'test', platform: 'android', updated_by: actorName(caller) })
    logAudit(getDb(), {
      userId: caller.id as string, branchId: (caller.branch_id as string) || null, action: 'APP_VERSION_APK_HASHED', tableName: 'app_versions',
      recordId: 'android:test', newValues: { apk_size_bytes: data.apk_size_bytes ?? null },
    })
    return { success: true, data }
  })
}
