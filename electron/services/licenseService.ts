import Store from 'electron-store'
import { net } from 'electron'
import { decryptSecret } from '../ipc/settings'

const store = new Store()
const LICENSE_KEY = 'license_data'
// Was 6h — too slow for module/feature toggles (main-process IPC guards read
// this cache) to take effect in any reasonable time. 5 min keeps enforcement
// close to what the 30s renderer-side /api/brand poll already achieves for
// nav-hiding, without hammering the API.
const CHECK_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes

// Phase 1 device-authorization work — how long a device may keep operating
// offline (sales, etc.) after its last successful check-in with the server
// before it must lock and require online re-validation. Chosen deliberately
// (not hardcoded arbitrarily): long enough to survive a weekend or a real
// outage, short enough that a revoked-but-offline device can't run
// indefinitely. Exported so activation.ts can set the initial lease on
// (re-)activation using the same constant.
export const OFFLINE_LEASE_MS = 72 * 60 * 60 * 1000 // 72 hours

export type LicenseData = {
  sub_status:   string   // 'active' | 'grace' | 'expired'
  is_locked:    boolean  // true when company is suspended
  max_users:    number
  max_branches: number
  modules:      string[] // e.g. ['pos', 'inventory', 'customers', ...]
  features:     string[] // fine-grained feature keys, e.g. ['reports.sales.export', ...]
  checked_at:   number   // epoch ms
}

export function getCachedLicense(): LicenseData | null {
  return (store.get(LICENSE_KEY) as LicenseData) ?? null
}

export function getMaxUsers(): number {
  return getCachedLicense()?.max_users ?? 999
}

export function getMaxBranches(): number {
  return getCachedLicense()?.max_branches ?? 999
}

export function getEnabledModules(): string[] | null {
  return getCachedLicense()?.modules ?? null
}

export function isAppLocked(): boolean {
  return getCachedLicense()?.is_locked ?? false
}

// Fail-open when no license has been cached yet (e.g. first launch, offline) —
// same default already used by getMaxUsers/getMaxBranches/getEnabledModules
// above, so a network hiccup doesn't lock the business out of its own POS.
export function hasModule(moduleKey: string): boolean {
  const modules = getCachedLicense()?.modules
  return modules ? modules.includes(moduleKey) : true
}

// ─── Device authorization / revocation (Phase 1) ──────────────────────────────
// A device only ever became subject to a revocation check at activation time
// previously — nothing re-validated an already-running device again. This
// piggybacks on the existing /api/brand poll (already running every 5 min)
// as the "phone home" path while online, and a bounded offline lease so a
// revoked device can't keep operating indefinitely if it's never online
// again to be told so.
export function isDeviceLocked(): boolean {
  return Boolean(store.get('device_locked'))
}

export function getDeviceLockReason(): string | null {
  return (store.get('device_lock_reason') as string | undefined) ?? null
}

// Exported so any code path that gets a DeviceRevokedError directly from a
// CloudApi call (not just the /api/brand poll — e.g. a sync push/pull) can
// lock immediately instead of waiting for the next license check.
export function reportDeviceRevoked(reason: string): void {
  lockDevice(reason)
}

function lockDevice(reason: string): void {
  const wasLocked = isDeviceLocked()
  store.set('device_locked', true)
  store.set('device_lock_reason', reason)
  if (!wasLocked) console.warn(`[License] Device locked: ${reason}`)
}

function unlockDevice(): void {
  if (isDeviceLocked()) console.log('[License] Device unlocked — authorization restored.')
  store.delete('device_locked')
  store.delete('device_lock_reason')
}

// Called when a /api/brand check can't reach the server at all — the local
// clock is the only thing available to decide whether the offline grace
// period has run out. Never called on an already-locked device (nothing to
// re-derive), and never itself unlocks anything (only a real server
// check-in can do that).
function checkOfflineLeaseExpiry(): void {
  if (isDeviceLocked()) return
  const expiresAt = store.get('offline_authorization_expires_at') as number | undefined
  if (expiresAt && Date.now() > expiresAt) {
    lockDevice('This device could not reach the server to renew its authorization, and the offline grace period has expired. Connect to the internet and re-activate.')
  }
}

export async function fetchAndCacheLicense(): Promise<LicenseData | null> {
  const settings = (store.get('app_settings') as Record<string, unknown>) ?? {}
  const apiUrl = String(settings.cloud_api_url ?? '').trim()
  const apiKey = decryptSecret(settings.cloud_api_key).trim()
  const deviceId = (store.get('device_id') as string | undefined) ?? null

  if (!apiUrl || !apiKey) return null

  const { status, body } = await fetchBrand(apiUrl, apiKey, deviceId)

  if (status === 0) {
    checkOfflineLeaseExpiry()
    return getCachedLicense() // network error — keep cached
  }

  if (status === 403 && body?.code === 'DEVICE_REVOKED') {
    lockDevice(String(body.error || 'This device has been deactivated by your administrator.'))
    return getCachedLicense()
  }

  if (status !== 200 || !body) return getCachedLicense()
  const data = body

  const license: LicenseData = {
    sub_status:   String(data.sub_status   ?? 'active'),
    is_locked:    Boolean(data.is_locked),
    max_users:    Number(data.max_users    ?? 999),
    max_branches: Number(data.max_branches ?? 999),
    modules:      Array.isArray(data.modules) ? (data.modules as string[]) : [],
    features:     Array.isArray(data.features) ? (data.features as string[]) : [],
    checked_at:   Date.now(),
  }

  store.set(LICENSE_KEY, license)
  console.log(`[License] Cached: status=${license.sub_status}, locked=${license.is_locked}, modules=${license.modules.length}, features=${license.features.length}`)

  // A 200 response with a resolvable device_status can only mean 'active' —
  // resolveDeviceAuthorization() on the backend throws before this point is
  // ever reached for a deactivated device. Renew the lease and clear any
  // prior lock (covers the case where this device was locked, then
  // reactivated server-side, and this is the first check-in since).
  if (data.device_status != null) {
    unlockDevice()
    store.set('device_authorization_version', Number(data.device_authorization_version ?? 1))
    store.set('offline_authorization_expires_at', Date.now() + OFFLINE_LEASE_MS)
  }

  return license
}

function fetchBrand(apiUrl: string, apiKey: string, deviceId: string | null): Promise<{ status: number; body: Record<string, unknown> | null }> {
  return new Promise((resolve) => {
    try {
      const req = net.request({ url: `${apiUrl}/api/brand`, method: 'GET' })
      req.setHeader('x-api-key', apiKey)
      if (deviceId) req.setHeader('x-device-id', deviceId)
      let body = ''
      req.on('response', (res) => {
        res.on('data', (chunk) => { body += chunk.toString() })
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(body) as Record<string, unknown> })
          } catch { resolve({ status: res.statusCode, body: null }) }
        })
      })
      req.on('error', () => resolve({ status: 0, body: null }))
      req.end()
    } catch { resolve({ status: 0, body: null }) }
  })
}

let licenseTimer: ReturnType<typeof setInterval> | null = null

export function startLicenseChecks() {
  // First check 15s after launch (let app settle)
  setTimeout(() => { fetchAndCacheLicense() }, 15_000)
  // Periodic check every 6 hours
  licenseTimer = setInterval(() => { fetchAndCacheLicense() }, CHECK_INTERVAL_MS)
}

export function stopLicenseChecks() {
  if (licenseTimer) { clearInterval(licenseTimer); licenseTimer = null }
}
