import type { IpcMain } from 'electron'
import Store from 'electron-store'
import { safeStorage } from 'electron'
import crypto from 'crypto'
import { getDb } from '../database'

const store = new Store()
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
    db.prepare(`
      INSERT INTO audit_logs (id, user_id, branch_id, action, table_name, record_id, new_values)
      VALUES (?,?,?,?,?,?,?)
    `).run(
      crypto.randomUUID(),
      user?.id || null,
      user?.branch_id || null,
      'SETTINGS_UPDATE',
      'app_settings',
      'global',
      JSON.stringify({ keys })
    )
  } catch {
    // Settings must still save if audit logging is unavailable.
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
      const current = store.get('app_settings') as Record<string, unknown> || {}
      const next = normalizeForStorage(payload as Record<string, unknown>, current)
      store.set('app_settings', next)
      auditSettingsUpdate(Object.keys(payload as Record<string, unknown>))
      return { success: true }
    } catch (err: unknown) { return { success: false, error: (err as Error).message } }
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
