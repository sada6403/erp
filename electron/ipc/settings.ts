import type { IpcMain } from 'electron'
import { BrowserWindow } from 'electron'
import Store from 'electron-store'
import { app, safeStorage } from 'electron'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { getDb } from '../database'
import { CloudApi } from '../services/cloudApi'
import { logAudit } from '../services/auditLog'

const store = new Store()

// Company-wide branding keys — synced through the cloud so every activated
// device of the company shows the same logo/branding.
export const CLOUD_BRANDING_KEYS = [
  'company_name', 'company_logo_url', 'login_logo_url', 'pos_bill_logo_url',
  'invoice_logo_url', 'favicon_url', 'brand_color', 'footer_text',
] as const
const MASKED_SECRET = '********'
const FALLBACK_KEY = crypto.createHash('sha256').update('pos-erp-local-settings-key').digest()

const SECRET_KEYS = new Set([
  'smtp_password',
  'sms_api_key',
  'sms_api_secret',
  'sms_api_token',
  'db_password',
  'cloud_api_key',
  'api_secret',
  'api_token',
  'support_passcode',
  's3_secret_key',
  'whatsapp_access_token',
  'whatsapp_twilio_token',
])

const DEFAULTS = {
  // Company
  company_name: 'Nature Plantation',
  company_address: '',
  company_phone: '',
  company_email: '',
  company_website: '',
  company_tin: '',
  invoice_note: 'Goods once sold will not be taken back or exchanged.',
  // Branch
  branch_id: 'b1111111-1111-4111-8111-111111111111',
  branch_name: 'Main Branch',
  // Currency & Tax
  currency: 'LKR',
  currency_symbol: 'Rs.',
  tax_label: 'VAT',
  // Receipt
  receipt_header: 'Nature Plantation',
  receipt_footer: 'Thank you for shopping with us!',
  low_stock_threshold: 5,
  // Sync
  cloud_api_url: '',
  cloud_api_key: '',
  theme: 'dark',
  // Support unlock — gates the hidden Cloud API URL panel (activation page +
  // admin settings). DB-backed (encrypted at rest via SECRET_KEYS) so it can
  // be changed per-install from Settings instead of being baked into source.
  support_passcode: 'NF@2026',

  // SMTP
  email_enabled: false,
  smtp_host: '',
  smtp_port: 587,
  smtp_encryption: 'TLS',
  smtp_username: '',
  smtp_password: '',
  smtp_from_email: '',
  smtp_from_name: '',
  smtp_reply_to: '',

  // SMS / OTP
  sms_enabled: false,
  sms_provider_name: '',
  sms_api_base_url: '',
  sms_api_key: '',
  sms_api_secret: '',
  sms_sender_id: '',
  sms_http_method: 'POST',
  sms_content_type: 'application/json',
  sms_custom_headers: '',
  sms_body_template: '{"mobile":"{phone}","message":"{message}","otp":"{otp}"}',

  // Branding
  company_logo_url: '',
  login_logo_url: '',
  pos_bill_logo_url: '',
  invoice_logo_url: '',
  favicon_url: '',
  footer_text: '',

  // Cloud database/API/security
  db_type: 'PostgreSQL',
  db_host: '',
  db_port: 5432,
  db_name: '',
  db_username: '',
  db_password: '',
  db_ssl_enabled: true,
  db_region: '',
  session_timeout_minutes: 30,
  password_min_length: 8,
  password_require_uppercase: true,
  password_require_number: true,
  password_require_symbol: false,
  two_factor_enabled: false,
  ip_restrictions: '',
  offline_sync_enabled: true,
  sync_interval_minutes: 5,
  failed_sync_retry_minutes: 10,
  backup_schedule: 'daily',
  backup_destination: 'local',
  backup_retention: 10,

  // AWS S3 / S3-compatible Storage
  s3_enabled: false,
  s3_bucket: '',
  s3_region: 'us-east-1',
  s3_access_key: '',
  s3_secret_key: '',
  s3_endpoint: '',    // leave blank for AWS, set for MinIO/Wasabi/B2
  s3_cdn_url: '',     // optional CDN prefix
}

function encryptSecret(value: string): string {
  if (!value) return ''
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return `safe:${safeStorage.encryptString(value).toString('base64')}`
    }
  } catch {
    // Fall through to deterministic local fallback.
  }
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', FALLBACK_KEY, iv)
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `aes:${Buffer.concat([iv, tag, encrypted]).toString('base64')}`
}

export function decryptSecret(value: unknown): string {
  const text = String(value || '')
  if (!text) return ''
  try {
    if (text.startsWith('safe:')) {
      return safeStorage.decryptString(Buffer.from(text.slice(5), 'base64'))
    }
    if (text.startsWith('aes:')) {
      const raw = Buffer.from(text.slice(4), 'base64')
      const iv = raw.subarray(0, 12)
      const tag = raw.subarray(12, 28)
      const encrypted = raw.subarray(28)
      const decipher = crypto.createDecipheriv('aes-256-gcm', FALLBACK_KEY, iv)
      decipher.setAuthTag(tag)
      return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
    }
  } catch {
    return ''
  }
  return text
}

function normalizeForStorage(payload: Record<string, unknown>, current: Record<string, unknown>) {
  const next = { ...payload }
  for (const key of SECRET_KEYS) {
    if (!(key in next)) continue
    const value = String(next[key] || '')
    if (!value || value === MASKED_SECRET) {
      delete next[key]
    } else {
      next[key] = encryptSecret(value)
    }
  }
  return { ...current, ...next }
}

function normalizeForFrontend(settings: Record<string, unknown>) {
  const result = { ...settings }
  for (const key of SECRET_KEYS) {
    if (result[key]) result[key] = MASKED_SECRET
  }
  return result
}

function auditSettingsUpdate(keys: string[]) {
  try {
    const db = getDb()
    const user = store.get('auth_user') as Record<string, unknown> | undefined
    logAudit(db, {
      userId: (user?.id as string) || null, branchId: (user?.branch_id as string) || null,
      action: 'SETTINGS_UPDATE', tableName: 'app_settings', recordId: 'global',
      newValues: { keys },
    })
  } catch {
    // Settings must still save if audit logging is unavailable.
  }
}

function getCloudApiFromSettings(): CloudApi | null {
  const settings = store.get('app_settings') as Record<string, unknown> | undefined
  const baseUrl = String(settings?.cloud_api_url || '').trim()
  const apiKey = decryptSecret(settings?.cloud_api_key).trim()
  if (!baseUrl || !apiKey) return null
  return new CloudApi({ baseUrl, apiKey })
}

function broadcastSettingsUpdated(reason: string, extra: Record<string, unknown> = {}) {
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      win.webContents.send('settings:updated', { reason, ...extra })
    } catch {
      // ignore
    }
  }
}

// Upload a local app-img:// logo so other devices can load it, then return
// the public URL (or null when the upload isn't possible right now).
async function publishLocalImage(cloud: CloudApi, localUrl: string): Promise<string | null> {
  try {
    const fileName = localUrl.replace('app-img://', '')
    const filePath = path.join(app.getPath('userData'), 'uploads', fileName)
    if (!fs.existsSync(filePath)) return null
    const contentTypes: Record<string, string> = {
      '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
      '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
    }
    const contentType = contentTypes[path.extname(filePath).toLowerCase()]
    if (!contentType) return null
    return await cloud.uploadImage(filePath, fileName, contentType)
  } catch (err) {
    console.error('[Settings] Branding image upload failed:', err)
    return null
  }
}

// Push the company branding to the cloud. Retried by the sync service while
// `branding_push_pending` stays set (e.g. saved while offline).
export async function pushBrandingToCloud(): Promise<boolean> {
  const cloud = getCloudApiFromSettings()
  if (!cloud) return false
  const settings = (store.get('app_settings') as Record<string, unknown>) || {}

  const branding: Record<string, unknown> = {}
  let localChanged = false
  for (const key of CLOUD_BRANDING_KEYS) {
    let value = settings[key]
    if (typeof value === 'string' && value.startsWith('app-img://')) {
      const publicUrl = await publishLocalImage(cloud, value)
      if (!publicUrl) return false // retry later — image not uploadable right now
      settings[key] = publicUrl
      value = publicUrl
      localChanged = true
    }
    branding[key] = value ?? null
  }
  if (localChanged) store.set('app_settings', settings)

  try {
    await cloud.putBranding(branding)
    store.set('company_branding_synced', JSON.stringify(branding))
    store.delete('branding_push_pending')
    broadcastSettingsUpdated('branding-pushed', { branding })
    return true
  } catch (err) {
    console.error('[Settings] Branding push failed:', err)
    return false
  }
}

export async function refreshBrandingFromCloud(): Promise<{ success: boolean; branding?: Record<string, unknown>; error?: string }> {
  const cloud = getCloudApiFromSettings()
  if (!cloud) return { success: false, error: 'Cloud branding is not configured' }

  try {
    const res = await cloud.getBranding()
    const branding = (res.branding || {}) as Record<string, unknown>
    const current = (store.get('app_settings') as Record<string, unknown>) || {}
    const next = { ...current }
    let changed = false

    for (const key of CLOUD_BRANDING_KEYS) {
      const value = branding[key]
      if (value !== undefined && next[key] !== value) {
        next[key] = value === null ? null : String(value)
        changed = true
      }
    }

    if (changed) {
      store.set('app_settings', next)
      store.set('company_branding_synced', JSON.stringify(branding))
      broadcastSettingsUpdated('branding-refreshed', { branding })
    }

    return { success: true, branding }
  } catch (err) {
    return { success: false, error: (err as Error).message }
  }
}

export function ensureSettingsDefaults() {
  const saved = store.get('app_settings') as Record<string, unknown> || {}
  const merged: Record<string, unknown> = { ...DEFAULTS }
  for (const [k, v] of Object.entries(saved)) {
    if (v !== '' && v !== null && v !== undefined) merged[k] = v
  }
  store.set('app_settings', merged)
}

export function registerSettingsHandlers(ipcMain: IpcMain) {
  ipcMain.handle('settings:get', () => {
    try {
      const saved = store.get('app_settings') as Record<string, unknown> || {}
      const merged = { ...DEFAULTS }
      for (const [k, v] of Object.entries(saved)) {
        if (v !== '' && v !== null && v !== undefined)
          (merged as Record<string, unknown>)[k] = v
      }
      return { success: true, data: normalizeForFrontend(merged) }
    } catch (err: unknown) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle('settings:update', (_e, payload) => {
    try {
      const user = store.get('auth_user') as Record<string, unknown> | undefined
      const callerPerms = ((user?.role as Record<string, unknown>)?.permissions as Record<string, unknown>)
        || user?.permissions as Record<string, unknown> || {}
      if (!callerPerms.all && !callerPerms.settings) {
        return { success: false, error: 'Settings access required' }
      }

      const current = store.get('app_settings') as Record<string, unknown> || {}
      const next = normalizeForStorage(payload as Record<string, unknown>, current)
      store.set('app_settings', next)
      auditSettingsUpdate(Object.keys(payload as Record<string, unknown>))

      // Company Admin branding edits are company-wide: push to the cloud so
      // every activated device picks them up on its next sync.
      const payloadKeys = Object.keys(payload as Record<string, unknown>)
      const touchesBranding = payloadKeys.some(k => (CLOUD_BRANDING_KEYS as readonly string[]).includes(k))
      if (touchesBranding) {
        const user = store.get('auth_user') as Record<string, unknown> | undefined
        const perms = ((user?.role as Record<string, unknown>)?.permissions as Record<string, unknown>)
          || user?.permissions as Record<string, unknown> || {}
        if (perms.all) {
          store.set('branding_push_pending', true)
          void pushBrandingToCloud()
        }
      }
      broadcastSettingsUpdated('settings-updated', { keys: payloadKeys })
      return { success: true }
    } catch (err: unknown) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle('settings:refreshBranding', async () => {
    try {
      const result = await refreshBrandingFromCloud()
      if (!result.success) return result
      return { success: true, data: normalizeForFrontend((store.get('app_settings') as Record<string, unknown>) || {}) }
    } catch (err: unknown) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('settings:revealSecret', (_e, key: string) => {
    try {
      if (!SECRET_KEYS.has(key)) return { success: false, error: 'Unsupported secret key' }
      const user = store.get('auth_user') as Record<string, unknown> | undefined
      const perms = ((user?.role as Record<string, unknown>)?.permissions as Record<string, unknown>)
        || user?.permissions as Record<string, unknown> || {}
      if (!perms.all) return { success: false, error: 'Company Admin access required' }
      const current = store.get('app_settings') as Record<string, unknown> || {}
      return { success: true, data: decryptSecret(current[key]) }
    } catch (err: unknown) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle('settings:s3Test', async () => {
    try {
      const { testConnection } = await import('../services/s3Service')
      const current = store.get('app_settings') as Record<string, unknown> || {}
      const config = {
        bucket:    String(current.s3_bucket || ''),
        region:    String(current.s3_region || 'us-east-1'),
        accessKey: String(current.s3_access_key || ''),
        secretKey: decryptSecret(current.s3_secret_key),
        endpoint:  String(current.s3_endpoint || '') || undefined,
        cdnUrl:    String(current.s3_cdn_url || '') || undefined,
      }
      if (!config.bucket || !config.accessKey || !config.secretKey) {
        return { success: false, error: 'Bucket, access key and secret key are required' }
      }
      return await testConnection(config)
    } catch (err: unknown) { return { success: false, error: String(err) } }
  })
}
