import { ipcMain } from 'electron'
import Store from 'electron-store'
import os from 'os'
import { randomUUID, createHash, timingSafeEqual } from 'crypto'
import { getCachedLicense, getEnabledModules, getMaxBranches, getMaxUsers } from '../services/licenseService'
import { decryptSecret } from './settings'
import { safeHandle } from './ipcHandler'
import { getDb } from '../database'
import { reconcileLocalMainBranch } from '../services/branchReconcile'
import { reconcileLocalDefaultRoles } from '../services/roleReconcile'
import { wipeLocalTransactionalData } from './admin'
import { CloudApi } from '../services/cloudApi'

const store = new Store()

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

function activationSessionShape(extra: Record<string, unknown> = {}) {
  const cached = getCachedLicense()
  return {
    portal: 'admin' as const,
    scope: { level: 'owner' as const, branchId: null, subBranchId: null },
    branch_id: null,
    sub_branch_id: null,
    device_id: getOrCreateDeviceId(),
    licenseId: (store.get('device_license_key') as string | undefined) ?? null,
    enabledModules: getEnabledModules() ?? cached?.modules ?? [],
    enabledFeatures: [],
    limits: {
      maxUsers: getMaxUsers(),
      maxBranches: getMaxBranches(),
    },
    ...extra,
  }
}

export function getOrCreateDeviceId(): string {
  let id = store.get('device_uuid') as string | undefined
  if (!id) {
    id = randomUUID()
    store.set('device_uuid', id)
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
    const cloud = new CloudApi({ baseUrl: apiUrl, apiKey })
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
    try {
      const { getSyncService } = await import('../services/syncService')
      getSyncService().runSoon()
    } catch { /* best-effort trigger, same as the activation flow's own call */ }

    store.set('last_acknowledged_clear_event_id', pending)
    return { success: true }
  })

  // Gate for the hidden server-settings panels (activation page + settings)
  safeHandle(ipcMain, 'app:verifySupportPasscode', (_event, passcode: string) => {
    return { success: verifySupportPasscode(passcode) }
  })

  safeHandle(ipcMain, 'app:getDeviceInfo', () => ({
    device_id:   getOrCreateDeviceId(),
    device_name: os.hostname(),
    os_info:     `${os.type()} ${os.release()}`,
  }))

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
    const res = await fetch(verifyUrl)
    const responseText = await res.text()
    const data = parseJson(responseText)

    if (!data) {
      const detail = htmlSummary(responseText)
      return {
        success: false,
        error: `Activation server returned HTML instead of JSON (${res.status} ${res.statusText}). Check Cloud API URL: ${verifyUrl}${detail ? ` - ${detail}` : ''}`,
      }
    }

    if (!res.ok) {
      return { success: false, error: String(data.error ?? 'Verification failed') }
    }

    return { success: true, ...activationSessionShape(), ...data }
  })

  safeHandle(ipcMain, 'app:activate', async (_event, payload: {
    company_key?: string
    license_key?: string
    cloud_api_url: string
    branch_id?: string | null
    device_name?: string
  }) => {
    const { company_key, license_key, cloud_api_url, branch_id } = payload
    if (!company_key?.trim() && !license_key?.trim()) {
      return { success: false, error: 'Company key or license key is required' }
    }

    const apiUrl    = normalizeApiUrl(cloud_api_url ?? '')
    const device_id   = getOrCreateDeviceId()
    const device_name = payload.device_name?.trim() || os.hostname()
    const os_info     = `${os.type()} ${os.release()}`

    const device_fingerprint = getDeviceFingerprint()
    store.set('device_fingerprint', device_fingerprint)

    const body: Record<string, unknown> = { device_id, device_name, os_info, app_version: '1.0.0', device_fingerprint }
    if (company_key?.trim()) body.company_key = company_key.trim()
    else body.license_key = license_key!.trim()
    if (branch_id) body.branch_id = branch_id

    const activateUrl = `${apiUrl}/api/activate`
    const res = await fetch(activateUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    const responseText = await res.text()
    const data = parseJson(responseText)

    if (!data) {
      const detail = htmlSummary(responseText)
      return {
        success: false,
        error: `Activation server returned HTML instead of JSON (${res.status} ${res.statusText}). Check Cloud API URL: ${activateUrl}${detail ? ` - ${detail}` : ''}`,
      }
    }

    if (!res.ok) return { success: false, error: String(data.error ?? 'Activation failed') }

    // Persist activation state
    store.set('device_activated', true)
    if (license_key?.trim()) store.set('device_license_key', license_key.trim())
    else store.delete('device_license_key')
    if (company_key?.trim()) store.set('device_company_key', company_key.trim())
    store.set('device_id', device_id)
    store.set('activation_company_name', data.company_name ?? '')

    // Auto-save api_key + branding into app_settings
    const current = (store.get('app_settings') as Record<string, unknown>) ?? {}
    store.set('app_settings', {
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
    if (branch_id) {
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
    try {
      const cloud = new CloudApi({ baseUrl: apiUrl, apiKey: String(data.api_key || '') })
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

    // Kick off an immediate full sync so the device shows the company's
    // existing data (users, branches, products, sales, branding) right away.
    try {
      const { getSyncService } = await import('../services/syncService')
      getSyncService().runSoon()
    } catch (err) {
      console.warn('[Activation] Could not trigger initial sync:', err)
    }

    return {
      success:        true,
      company_name:   data.company_name,
      device_name,
      brand_color:    data.brand_color    ?? null,
      brand_logo_url: data.brand_logo_url ?? null,
      ...activationSessionShape({
        company_id: data.company_id ?? null,
        licenseId: data.api_key ?? null,
        branch_id: data.branch_id ?? null,
      }),
    }
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
  }))
}
