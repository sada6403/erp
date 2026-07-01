import Store from 'electron-store'
import { net } from 'electron'

const store = new Store()
const LICENSE_KEY = 'license_data'
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000 // 6 hours

export type LicenseData = {
  sub_status:   string   // 'active' | 'grace' | 'expired'
  is_locked:    boolean  // true when company is suspended
  max_users:    number
  max_branches: number
  modules:      string[] // e.g. ['pos', 'inventory', 'customers', ...]
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

export async function fetchAndCacheLicense(): Promise<LicenseData | null> {
  const settings = (store.get('app_settings') as Record<string, unknown>) ?? {}
  const apiUrl = String(settings.cloud_api_url ?? '').trim()
  const apiKey = String(settings.cloud_api_key ?? '').trim()

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
      checked_at:   Date.now(),
    }

    store.set(LICENSE_KEY, license)
    console.log(`[License] Cached: status=${license.sub_status}, locked=${license.is_locked}, modules=${license.modules.length}`)
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
