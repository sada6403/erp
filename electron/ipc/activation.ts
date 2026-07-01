import { ipcMain } from 'electron'
import Store from 'electron-store'
import os from 'os'
import { randomUUID, createHash } from 'crypto'

const store = new Store()

function getOrCreateDeviceId(): string {
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
  ipcMain.handle('app:isActivated', () => {
    return Boolean(store.get('device_activated'))
  })

  ipcMain.handle('app:getDeviceInfo', () => ({
    device_id:   getOrCreateDeviceId(),
    device_name: os.hostname(),
    os_info:     `${os.type()} ${os.release()}`,
  }))

  ipcMain.handle('app:activate', async (_event, payload: {
    company_key?: string
    license_key?: string
    cloud_api_url: string
    branch_id?: string | null
    device_name?: string
  }) => {
    try {
      const { company_key, license_key, cloud_api_url, branch_id } = payload
      if (!company_key?.trim() && !license_key?.trim()) {
        return { success: false, error: 'Company key or license key is required' }
      }

      const apiUrl    = (cloud_api_url ?? '').trim() || 'http://localhost:3000'
      const device_id   = getOrCreateDeviceId()
      const device_name = payload.device_name?.trim() || os.hostname()
      const os_info     = `${os.type()} ${os.release()}`

      const device_fingerprint = getDeviceFingerprint()
      store.set('device_fingerprint', device_fingerprint)

      const body: Record<string, unknown> = { device_id, device_name, os_info, app_version: '1.0.0', device_fingerprint }
      if (company_key?.trim()) body.company_key = company_key.trim()
      else body.license_key = license_key!.trim()
      if (branch_id) body.branch_id = branch_id

      const res = await fetch(`${apiUrl}/api/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      const data = await res.json() as Record<string, string>
      if (!res.ok) return { success: false, error: data.error ?? 'Activation failed' }

      // Persist activation state
      store.set('device_activated', true)
      store.set('device_license_key', license_key)
      store.set('device_id', device_id)
      store.set('activation_company_name', data.company_name)

      // Auto-save api_key + branding into app_settings
      const current = (store.get('app_settings') as Record<string, unknown>) ?? {}
      store.set('app_settings', {
        ...current,
        cloud_api_url,
        cloud_api_key:   data.api_key,
        brand_color:     data.brand_color    ?? null,
        brand_logo_url:  data.brand_logo_url ?? null,
      })

      return {
        success:        true,
        company_name:   data.company_name,
        device_name,
        branch_id:      data.branch_id      ?? null,
        brand_color:    data.brand_color    ?? null,
        brand_logo_url: data.brand_logo_url ?? null,
      }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('app:deactivate', () => {
    store.delete('device_activated')
    store.delete('device_license_key')
    store.delete('activation_company_name')
  })

  ipcMain.handle('app:getActivationInfo', () => ({
    activated:          Boolean(store.get('device_activated')),
    company_name:       store.get('activation_company_name') ?? '',
    device_id:          getOrCreateDeviceId(),
    device_name:        os.hostname(),
    device_fingerprint: store.get('device_fingerprint') ?? getDeviceFingerprint(),
  }))
}
