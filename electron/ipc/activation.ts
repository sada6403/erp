import { app, ipcMain, net } from 'electron'
import {
  activateCompanyWorkspace,
  createCompanyStore,
  createWorkspaceStore,
  getActiveWorkspaceId,
  planCompanyWorkspace,
} from '../services/companyWorkspace'
import os from 'os'
import { randomUUID, createHash, timingSafeEqual } from 'crypto'
import { getCachedLicense, getEnabledModules, getMaxBranches, getMaxUsers, OFFLINE_LEASE_MS, isDeviceLocked, getDeviceLockReason } from '../services/licenseService'
import { decryptSecret } from './settings'
import { safeHandle } from './ipcHandler'
import { getDb } from '../database'
import { reconcileLocalMainBranch } from '../services/branchReconcile'
import { reconcileLocalDefaultRoles } from '../services/roleReconcile'
import { wipeLocalTransactionalData } from './admin'
import { CloudApi } from '../services/cloudApi'

const store = createCompanyStore()

type CompanySwitchRequest = {
  requestId: string
  requestSecret: string
  expiresAt: number
}

type CompanySwitchGrant = {
  companyId: string
  deviceId: string
  expiresAt: number
}

// Deliberately process-memory only. Restarting the app discards both the
// opaque request secret and any verified grant, so approval cannot become a
// durable bypass stored in electron-store or renderer localStorage.
let companySwitchRequest: CompanySwitchRequest | null = null
let companySwitchGrant: CompanySwitchGrant | null = null
let supportUnlockedUntil = 0

export function isSupportUnlocked(): boolean {
  return supportUnlockedUntil > Date.now()
}

function currentCloud(): CloudApi {
  const settings = (store.get('app_settings') as Record<string, unknown>) || {}
  const baseUrl = normalizeApiUrl(String(settings.cloud_api_url || ''))
  const apiKey = decryptSecret(settings.cloud_api_key).trim()
  const deviceId = String(store.get('device_id') || getOrCreateDeviceId()).trim()
  if (!apiKey) throw new Error('This device is not connected to the cloud')
  return new CloudApi({ baseUrl, apiKey, deviceId })
}

function hasValidCompanySwitchGrant(): boolean {
  if (isSupportUnlocked()) return true
  if (!companySwitchGrant || companySwitchGrant.expiresAt <= Date.now()) {
    companySwitchGrant = null
    return false
  }
  const companyId = String(store.get('activation_company_id') || '')
  const deviceId = String(store.get('device_id') || getOrCreateDeviceId())
  return companySwitchGrant.companyId === companyId && companySwitchGrant.deviceId === deviceId
}

// Support passcode — unlocks the hidden Cloud API URL settings (activation
// page + admin settings). DB-backed via app_settings.support_passcode
// (encrypted at rest, seeded to 'NF@2026' by settings.ts's DEFAULTS, changeable
// from Settings without a rebuild) rather than hardcoded in source.
export function verifySupportPasscode(input: string): boolean {
  const settings = store.get('app_settings') as Record<string, unknown> | undefined
  const expected = Buffer.from(decryptSecret(settings?.support_passcode) || 'NF@2026')
  const received = Buffer.from(String(input ?? ''))
  return expected.length === received.length && timingSafeEqual(expected, received)
}

function normalizeApiUrl(url: string): string {
  return url.trim().replace(/\/+$/, '') ||
    process.env.VITE_CLOUD_API_URL?.trim().replace(/\/+$/, '') ||
    process.env.CLOUD_API_URL?.trim().replace(/\/+$/, '') ||
    'http://72.61.115.222:4001'
}

function htmlSummary(text: string): string {
  const title = text.match(/<title[^>]*>(.*?)<\/title>/is)?.[1]
  return (title ?? text)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160)
}

function parseJson(text: string): Record<string, unknown> | null {
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    return null
  }
}

function activationSessionShape(extra: Record<string, unknown> = {}, targetStore = store) {
  const cached = getCachedLicense()
  return {
    portal: 'admin' as const,
    scope: { level: 'owner' as const, branchId: null, subBranchId: null },
    branch_id: null,
    sub_branch_id: null,
    device_id: getOrCreateDeviceId(targetStore),
    licenseId: (targetStore.get('device_license_key') as string | undefined) ?? null,
    enabledModules: getEnabledModules() ?? cached?.modules ?? [],
    enabledFeatures: [],
    limits: {
      maxUsers: getMaxUsers(),
      maxBranches: getMaxBranches(),
    },
    ...extra,
  }
}

export function getOrCreateDeviceId(targetStore = store): string {
  let id = targetStore.get('device_uuid') as string | undefined
  if (!id) {
    id = randomUUID()
    targetStore.set('device_uuid', id)
  }
  return id
}

export function getDeviceFingerprint(): string {
  // Combine stable hardware traits into a reproducible fingerprint
  const cpuModel = os.cpus()[0]?.model ?? 'unknown-cpu'
  const totalMem = String(os.totalmem())
  const hostname = os.hostname()
  const platform = os.platform()
  // Primary non-loopback MAC address
  const nets = os.networkInterfaces()
  const mac  = Object.values(nets)
    .flat()
    .find(n => n && !n.internal && n.mac !== '00:00:00:00:00:00')
    ?.mac ?? 'no-mac'

  const raw = [hostname, platform, cpuModel, totalMem, mac].join('|')
  return createHash('sha256').update(raw).digest('hex')
}

export function registerActivationHandlers() {
  safeHandle(ipcMain, 'app:isActivated', () => {
    return Boolean(store.get('device_activated'))
  })

  // Multi-device forced lock screen (Issue 30). Checked at boot, before any
  // normal UI — purely local, no network needed, so the lock persists even
  // if this device later goes offline after already detecting the event.
  safeHandle(ipcMain, 'app:getPendingClearEvent', () => {
    const pending = store.get('pending_clear_event_id') as string | null | undefined
    const acknowledged = store.get('last_acknowledged_clear_event_id') as string | null | undefined
    const locked = Boolean(pending) && pending !== acknowledged
    return { locked, eventId: locked ? pending : null }
  })

  // Phase 1 device-authorization work — checked at boot (before the normal
  // login screen) and re-polled periodically by the renderer, purely from
  // local electron-store state set by licenseService.ts's /api/brand poll
  // and syncService.ts's DeviceRevokedError handling. No network call here
  // itself — this just reads whatever the main process already knows.
  safeHandle(ipcMain, 'app:getDeviceLockStatus', () => ({
    locked: isDeviceLocked(),
    reason: getDeviceLockReason(),
    deviceId: (store.get('device_id') as string | undefined) ?? null,
  }))

  // The lock screen's one button. Deliberately unauthenticated — this fires
  // before any login screen even renders, same as admin:forceReset firing
  // with no logged-in user. Reuses the exact same deletion routine as the
  // password-gated Clear All Data (Issue 29), never a second implementation.
  safeHandle(ipcMain, 'app:refreshAfterClear', async () => {
    const pending = store.get('pending_clear_event_id') as string | null | undefined
    if (!pending) return { success: true }

    const appSettings = (store.get('app_settings') as Record<string, unknown>) || {}
    const apiUrl = String(appSettings.cloud_api_url || '').trim()
    const apiKey = decryptSecret(appSettings.cloud_api_key).trim()
    if (!apiUrl || !apiKey) {
      return { success: false, error: 'Cannot refresh — this device is not connected to the cloud' }
    }
    const cloud = new CloudApi({ baseUrl: apiUrl, apiKey, deviceId: (store.get('device_id') as string | undefined) ?? null })
    try {
      await cloud.health()
    } catch {
      return { success: false, error: 'Unable to reach the cloud — check your internet connection and try again' }
    }

    try {
      wipeLocalTransactionalData(getDb())
    } catch (err) {
      return { success: false, error: 'Failed to reset local data: ' + ((err as Error).message || '') }
    }

    // Force a full re-pull — the same "first sync" mechanism a newly
    // activated device already uses (see this file's own activation success
    // handler below), rather than a delta from a cursor that no longer
    // matches reality after a wipe.
    store.set('last_pull_timestamp', '1970-01-01T00:00:00.000Z')
    store.delete('sync_table_cursors_v2')
    store.delete('sync_pull_errors')
    store.delete('last_successful_sync_v2_at')
    store.delete('sync_cycle_error')
    store.delete('last_seen_watermark')
    try {
      const { getSyncService } = await import('../services/syncService')
      getSyncService().runSoon()
    } catch { /* best-effort trigger, same as the activation flow's own call */ }

    store.set('last_acknowledged_clear_event_id', pending)
    return { success: true }
  })

  // Gate for the hidden server-settings panels (activation page + settings)
  safeHandle(ipcMain, 'app:verifySupportPasscode', (_event, passcode: string) => {
    const ok = verifySupportPasscode(passcode)
    if (ok) {
      supportUnlockedUntil = Date.now() + 30 * 60 * 1000 // 30 minutes grant
    }
    return { success: ok }
  })

  safeHandle(ipcMain, 'app:getDeviceInfo', () => ({
    device_id:   getOrCreateDeviceId(),
    device_name: os.hostname(),
    os_info:     `${os.type()} ${os.release()}`,
  }))

  safeHandle(ipcMain, 'app:requestCompanySwitchAccess', async () => {
    if (!store.get('device_activated')) {
      return { success: false, error: 'This device is not activated yet' }
    }
    try {
      const result = await currentCloud().requestProductKeyAccess(os.hostname())
      companySwitchGrant = null
      companySwitchRequest = {
        requestId: result.request_id,
        requestSecret: result.request_secret,
        expiresAt: new Date(result.expires_at).getTime(),
      }
      return { success: true, status: result.status, expires_at: result.expires_at }
    } catch (error) {
      return { success: false, error: (error as Error).message || 'Unable to send approval request' }
    }
  })

  safeHandle(ipcMain, 'app:getCompanySwitchAccessStatus', async () => {
    if (!companySwitchRequest) return { success: false, status: 'none' }
    if (companySwitchRequest.expiresAt <= Date.now()) {
      companySwitchRequest = null
      return { success: true, status: 'expired' }
    }
    try {
      const result = await currentCloud().getProductKeyAccessStatus(
        companySwitchRequest.requestId,
        companySwitchRequest.requestSecret
      )
      return { success: true, ...result }
    } catch (error) {
      return { success: false, error: (error as Error).message || 'Unable to check approval status' }
    }
  })

  safeHandle(ipcMain, 'app:verifyCompanySwitchCode', async (_event, code: string) => {
    const normalized = String(code || '').trim()
    if (!/^\d{4}$/.test(normalized)) {
      return { success: false, error: 'Enter the 4-digit approval code' }
    }
    if (!companySwitchRequest) {
      return { success: false, error: 'Send a new access request first' }
    }
    try {
      const result = await currentCloud().verifyProductKeyAccess(
        companySwitchRequest.requestId,
        companySwitchRequest.requestSecret,
        normalized
      )
      if (!result.success) return { success: false, error: 'Approval code was not accepted' }
      companySwitchGrant = {
        companyId: String(store.get('activation_company_id') || ''),
        deviceId: String(store.get('device_id') || getOrCreateDeviceId()),
        expiresAt: Date.now() + Math.min(Number(result.grant_expires_in_seconds || 300), 300) * 1000,
      }
      companySwitchRequest = null
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message || 'Unable to verify approval code' }
    }
  })

  safeHandle(ipcMain, 'app:cancelCompanySwitchAccess', () => {
    companySwitchRequest = null
    companySwitchGrant = null
    return { success: true }
  })

async function electronFetch(url: string, init?: RequestInit): Promise<Response> {
  const signal = init?.signal || AbortSignal.timeout(12_000)
  const fetchFn = (typeof net !== 'undefined' && typeof net.fetch === 'function') ? net.fetch : fetch
  return fetchFn(url, { ...init, signal })
}

  safeHandle(ipcMain, 'app:verifyCompanyKey', async (_event, payload: {
    company_key?: string
    cloud_api_url: string
  }) => {
    const companyKey = payload.company_key?.trim()
    if (!companyKey) {
      return { success: false, error: 'Company key is required' }
    }

    const apiUrl = normalizeApiUrl(payload.cloud_api_url ?? '')
    const verifyUrl = `${apiUrl}/api/activate/verify?company_key=${encodeURIComponent(companyKey)}`
    let res: Response
    let responseText: string
    try {
      res = await electronFetch(verifyUrl)
      responseText = await res.text()
    } catch {
      return {
        success: false,
        error: 'Unable to reach the activation server. Please check your internet connection.',
      }
    }

    const data = parseJson(responseText)

    if (!data) {
      const detail = htmlSummary(responseText)
      return {
        success: false,
        error: `Activation server returned invalid response (${res.status} ${res.statusText}).${detail ? ` - ${detail}` : ''}`,
      }
    }

    if (!res.ok) {
      return { success: false, error: String(data.error ?? 'Verification failed') }
    }

    const plan = planCompanyWorkspace({
      companyId: data.company_id ? String(data.company_id) : null,
      companyKey,
      companyName: data.company_name ? String(data.company_name) : '',
    })

    if (store.get('device_activated') && !isDeviceLocked() && plan.workspaceChanged && !hasValidCompanySwitchGrant()) {
      return { success: false, error: 'Super Admin approval is required before changing the company key' }
    }

    return {
      success: true,
      ...activationSessionShape(),
      ...data,
      local_workspace_exists: plan.workspaceExists,
      will_switch_company: plan.workspaceChanged,
    }
  })

  safeHandle(ipcMain, 'app:activate', async (_event, payload: {
    company_key?: string
    license_key?: string
    cloud_api_url: string
    branch_id?: string | null
    device_name?: string
  }) => {
    const wasAlreadyActivated = Boolean(store.get('device_activated'))
    const { company_key, license_key, cloud_api_url, branch_id } = payload
    if (!company_key?.trim() && !license_key?.trim()) {
      return { success: false, error: 'Company key or license key is required' }
    }

    const apiUrl = normalizeApiUrl(cloud_api_url ?? '')
    let verifiedCompany: Record<string, unknown> = {}
    if (company_key?.trim()) {
      const verifyUrl = `${apiUrl}/api/activate/verify?company_key=${encodeURIComponent(company_key.trim())}`
      let verifyRes: Response
      let verifyText: string
      try {
        verifyRes = await electronFetch(verifyUrl)
        verifyText = await verifyRes.text()
      } catch {
        return { success: false, error: 'Unable to reach the activation server. Please check your internet connection.' }
      }
      verifiedCompany = parseJson(verifyText) ?? {}
      if (!verifyRes.ok || !Object.keys(verifiedCompany).length) {
        return { success: false, error: String(verifiedCompany.error ?? 'Company key verification failed') }
      }
    }
    const workspacePlan = planCompanyWorkspace({
      companyId: verifiedCompany.company_id ? String(verifiedCompany.company_id) : null,
      companyKey: company_key?.trim() || license_key?.trim() || 'legacy-license',
      companyName: verifiedCompany.company_name ? String(verifiedCompany.company_name) : '',
    })
    if (store.get('device_activated') && !isDeviceLocked() && workspacePlan.workspaceChanged && !hasValidCompanySwitchGrant()) {
      return { success: false, error: 'Super Admin approval has expired. Return to login and request access again.' }
    }
    const targetStore = createWorkspaceStore(workspacePlan.workspaceId)
    const device_id   = getOrCreateDeviceId(targetStore)
    const device_name = payload.device_name?.trim() || os.hostname()
    const os_info     = `${os.type()} ${os.release()}`

    const device_fingerprint = getDeviceFingerprint()
    targetStore.set('device_fingerprint', device_fingerprint)

    const body: Record<string, unknown> = { device_id, device_name, os_info, app_version: app.getVersion(), device_fingerprint }
    if (company_key?.trim()) body.company_key = company_key.trim()
    else body.license_key = license_key!.trim()
    if (branch_id) body.branch_id = branch_id

    const activateUrl = `${apiUrl}/api/activate`
    let res: Response
    let responseText: string
    try {
      res = await electronFetch(activateUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      responseText = await res.text()
    } catch {
      return { success: false, error: 'Unable to reach the activation server. Please check your internet connection.' }
    }

    const data = parseJson(responseText)

    if (!data) {
      const detail = htmlSummary(responseText)
      return {
        success: false,
        error: `Activation server returned invalid response (${res.status} ${res.statusText}).${detail ? ` - ${detail}` : ''}`,
      }
    }

    if (!res.ok) return { success: false, error: String(data.error ?? 'Activation failed') }

    // Persist activation state
    targetStore.set('device_activated', true)
    if (license_key?.trim()) targetStore.set('device_license_key', license_key.trim())
    else targetStore.delete('device_license_key')
    if (company_key?.trim()) targetStore.set('device_company_key', company_key.trim())
    targetStore.set('device_id', device_id)
    targetStore.set('activation_company_id', data.company_id ?? verifiedCompany.company_id ?? '')
    targetStore.set('activation_company_name', data.company_name ?? verifiedCompany.company_name ?? '')
    // A company switch always returns to that company's login screen. Never
    // revive a cached user/session from the last time this workspace was open.
    targetStore.delete('auth_token')
    targetStore.delete('auth_user')
    targetStore.delete('support_session')
    const activatedBranchId = data.branch_id || branch_id
    if (activatedBranchId) targetStore.set('device_branch_id', String(activatedBranchId))
    else targetStore.delete('device_branch_id')

    // Phase 1 device-authorization work — a fresh activation (including a
    // RE-activation of a previously-locked/revoked device) always starts a
    // clean authorization state, never restores whatever was there before.
    targetStore.set('device_authorization_version', 1)
    targetStore.set('offline_authorization_expires_at', Date.now() + OFFLINE_LEASE_MS)
    targetStore.delete('device_locked')
    targetStore.delete('device_lock_reason')
    // Force a full bootstrap re-pull rather than trusting whatever local
    // data/cursor this device already had — matters most for the
    // re-activation case (a previously revoked device coming back).
    targetStore.delete('last_pull_timestamp')
    targetStore.delete('sync_table_cursors_v2')
    targetStore.delete('sync_pull_errors')
    targetStore.delete('last_successful_sync_v2_at')
    targetStore.delete('sync_cycle_error')
    targetStore.delete('last_seen_watermark')

    // Auto-save api_key + branding into app_settings
    const current = (targetStore.get('app_settings') as Record<string, unknown>) ?? {}
    targetStore.set('app_settings', {
      ...current,
      cloud_api_url:   apiUrl,
      cloud_api_key:   data.api_key,
      company_name:    data.company_name   || current.company_name || '',
      brand_color:     data.brand_color    ?? null,
      brand_logo_url:  data.brand_logo_url ?? null,
    })

    // Re-point the locally-seeded Main Branch (id b1111111-...) onto whichever
    // real cloud branch was picked during activation, so the local branch
    // BECOMES that branch instead of the next sync pulling the cloud's own
    // copy down as a second, duplicate row (see branchReconcile.ts). Keeps
    // all locally-recorded staff/sales/stock under the branch, just under its
    // real cloud id from here on.
    if (branch_id && !workspacePlan.workspaceChanged) {
      try {
        reconcileLocalMainBranch(getDb(), String(branch_id))
      } catch (err) {
        console.error('[Activation] Branch reconciliation failed:', err)
      }
    }

    // Same reconciliation for the 5 default roles (Issue 32a) — the local
    // install seeds them with fixed placeholder ids, but the cloud
    // generated its own random UUID() for this tenant's rows. Fetch this
    // tenant's actual role rows and re-point local references onto the
    // real cloud ids, so a later full re-pull never has to fall back to
    // guessing which role a user belongs to.
    if (!workspacePlan.workspaceChanged) {
      try {
        const cloud = new CloudApi({ baseUrl: apiUrl, apiKey: String(data.api_key || ''), deviceId: device_id })
        const cloudRoles = await cloud.changes('roles', '1970-01-01T00:00:00.000Z')
        const cloudRolesByName: Record<string, string> = {}
        for (const row of cloudRoles) {
          const name = String(row.name || '')
          const id = String(row.id || '')
          if (name && id) cloudRolesByName[name] = id
        }
        reconcileLocalDefaultRoles(getDb(), cloudRolesByName)
      } catch (err) {
        console.error('[Activation] Role reconciliation failed:', err)
      }
    }

    activateCompanyWorkspace({
      ...workspacePlan,
      companyId: data.company_id ? String(data.company_id) : workspacePlan.companyId,
      companyName: String(data.company_name || verifiedCompany.company_name || workspacePlan.companyName),
    })

    // A successful company change consumes the short-lived in-memory grant.
    // A failed activation keeps it available for a retry until its expiry.
    if (wasAlreadyActivated) companySwitchGrant = null

    // Kick off an immediate full sync so the device shows the company's
    // existing data (users, branches, products, sales, branding) right away.
    if (!workspacePlan.workspaceChanged) {
      try {
        const { getSyncService } = await import('../services/syncService')
        getSyncService().runSoon()
      } catch (err) {
        console.warn('[Activation] Could not trigger initial sync:', err)
      }
    }

    return {
      success:        true,
      company_name:   data.company_name,
      device_name,
      brand_color:    data.brand_color    ?? null,
      brand_logo_url: data.brand_logo_url ?? null,
      restart_required: workspacePlan.workspaceChanged,
      workspace_id: workspacePlan.workspaceId,
      ...activationSessionShape({
        company_id: data.company_id ?? null,
        licenseId: data.api_key ?? null,
        branch_id: data.branch_id ?? null,
      }, targetStore),
    }
  })

  safeHandle(ipcMain, 'app:restartForWorkspace', () => {
    setTimeout(() => {
      app.relaunch()
      app.exit(0)
    }, 250)
    return { success: true }
  })

  safeHandle(ipcMain, 'app:deactivate', () => {
    store.delete('device_activated')
    store.delete('device_license_key')
    store.delete('activation_company_name')
  })

  safeHandle(ipcMain, 'app:getActivationInfo', () => ({
    activated:          Boolean(store.get('device_activated')),
    company_name:       store.get('activation_company_name') ?? '',
    device_id:          getOrCreateDeviceId(),
    device_name:        os.hostname(),
    device_fingerprint: store.get('device_fingerprint') ?? getDeviceFingerprint(),
    company_id:         store.get('activation_company_id') ?? null,
    workspace_id:       getActiveWorkspaceId(),
  }))
}
