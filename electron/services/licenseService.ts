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

export async function fetchAndCacheLicense(): Promise<LicenseData | null> {
  const settings = (store.get('app_settings') as Record<string, unknown>) ?? {}
  const apiUrl = String(settings.cloud_api_url ?? '').trim()
  const apiKey = decryptSecret(settings.cloud_api_key).trim()

  if (!apiUrl || !apiKey) return null

  try {
    const data = await fetchBrand(apiUrl, apiKey)
    if (!data) return getCachedLicense() // network error → keep cached

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
    return license
  } catch {
    return getCachedLicense()
  }
}

function fetchBrand(apiUrl: string, apiKey: string): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    try {
      const req = net.request({ url: `${apiUrl}/api/brand`, method: 'GET' })
      req.setHeader('x-api-key', apiKey)
      let body = ''
      req.on('response', (res) => {
        res.on('data', (chunk) => { body += chunk.toString() })
        res.on('end', () => {
          try {
            resolve(res.statusCode === 200 ? JSON.parse(body) as Record<string, unknown> : null)
          } catch { resolve(null) }
        })
      })
      req.on('error', () => resolve(null))
      req.end()
    } catch { resolve(null) }
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
