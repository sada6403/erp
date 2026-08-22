import Store from 'electron-store'
import { net } from 'electron'
import { randomUUID } from 'crypto'
import { getDb } from '../database'

const store = new Store<Record<string, unknown>>()

export interface SmsPayload {
  to: string | string[]
  message: string
  event?: string
}

// Sri Lankan mobile numbers, normalized to the 94-prefixed format gateways
// expect (e.g. Mobitel Enterprise SMS's `r` param). Accepts 07XXXXXXXX,
// 7XXXXXXXX, or an already-normalized 94XXXXXXXXX; anything else is passed
// through digits-only so the gateway's own error code (not a silent mangle)
// surfaces the problem.
export function normalizeSriLankanMobile(input: string): string {
  const digits = String(input || '').replace(/\D/g, '')
  if (digits.length === 10 && digits.startsWith('0')) return `94${digits.slice(1)}`
  if (digits.length === 11 && digits.startsWith('94')) return digits
  if (digits.length === 9 && digits.startsWith('7')) return `94${digits}`
  return digits
}

function logSmsAttempt(recipient: string, message: string, event: string | undefined, status: 'sent' | 'failed', response?: string, error?: string) {
  try {
    getDb().prepare(`
      INSERT INTO sms_logs (id, recipient, message, event, status, response, error)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(randomUUID(), recipient, message, event || null, status, response || null, error || null)
  } catch {
    // Logging must never break SMS sending.
  }
}

// Env vars override the Settings-UI-configured values when present — same
// precedence and rationale as emailService.ts's getConfig().
function getConfig() {
  // Settings are persisted as one nested blob under 'app_settings' (see
  // electron/ipc/settings.ts's settings:update) — a flat store.get('sms_api_key')
  // reads a key that's never written and always falls back to its default.
  const s = (store.get('app_settings') as Record<string, unknown>) || {}
  return {
    enabled:     process.env.SMS_ENABLED !== undefined ? process.env.SMS_ENABLED === 'true' : Boolean(s.sms_enabled ?? false),
    provider:    process.env.SMS_PROVIDER_NAME || String(s.sms_provider_name ?? ''),
    baseUrl:     process.env.SMS_API_BASE_URL  || String(s.sms_api_base_url ?? ''),
    apiKey:      process.env.SMS_API_KEY       || String(s.sms_api_key ?? ''),
    apiSecret:   process.env.SMS_API_SECRET    || String(s.sms_api_secret ?? ''),
    senderId:    process.env.SMS_SENDER_ID     || String(s.sms_sender_id ?? ''),
    method:      process.env.SMS_HTTP_METHOD   || String(s.sms_http_method ?? 'POST'),
    contentType: process.env.SMS_CONTENT_TYPE  || String(s.sms_content_type ?? 'application/json'),
    headers:     process.env.SMS_CUSTOM_HEADERS|| String(s.sms_custom_headers ?? ''),
    bodyTemplate:process.env.SMS_BODY_TEMPLATE || String(s.sms_body_template ?? '{"mobile":"{phone}","message":"{message}"}'),
  }
}

function buildBody(template: string, phone: string, message: string, urlEncode = false): string {
  const enc = (v: string) => urlEncode ? encodeURIComponent(v) : v
  const cfg = getConfig()
  return template
    .replace(/\{phone\}/g, enc(phone))
    .replace(/\{mobile\}/g, enc(phone))
    .replace(/\{message\}/g, urlEncode ? encodeURIComponent(message) : message.replace(/"/g, '\\"'))
    .replace(/\{sender_id\}/g, enc(cfg.senderId))
    .replace(/\{api_key\}/g, enc(cfg.apiKey))
}

async function httpRequest(url: string, options: { method: string; headers: Record<string,string>; body?: string }): Promise<{ ok: boolean; status: number; text: string }> {
  return new Promise((resolve) => {
    const req = net.request({ method: options.method, url })
    Object.entries(options.headers).forEach(([k, v]) => req.setHeader(k, v))
    let body = ''
    req.on('response', (resp) => {
      resp.on('data', (chunk) => { body += chunk.toString() })
      resp.on('end', () => resolve({ ok: resp.statusCode >= 200 && resp.statusCode < 300, status: resp.statusCode, text: body }))
    })
    req.on('error', () => resolve({ ok: false, status: 0, text: 'Network error' }))
    if (options.body) req.write(options.body)
    req.end()
  })
}

function parseCustomHeaders(raw: string): Record<string, string> {
  const headers: Record<string, string> = {}
  if (!raw) return headers
  raw.split('\n').forEach(line => {
    const [k, ...v] = line.split(':')
    if (k?.trim()) headers[k.trim()] = v.join(':').trim()
  })
  return headers
}

export async function sendSms(payload: SmsPayload): Promise<{ success: boolean; error?: string; response?: string }> {
  const cfg = getConfig()
  if (!cfg.enabled)  return { success: false, error: 'SMS is not enabled in settings' }
  if (!cfg.baseUrl)  return { success: false, error: 'SMS API URL not configured' }

  const phones = Array.isArray(payload.to) ? payload.to : [payload.to]
  const errors: string[] = []

  const customHeaders = parseCustomHeaders(cfg.headers)
  const headers: Record<string, string> = {
    'Content-Type': cfg.contentType,
    ...customHeaders,
  }
  if (cfg.apiKey && !customHeaders['Authorization']) {
    headers['Authorization'] = `Bearer ${cfg.apiKey}`
  }

  for (const rawPhone of phones) {
    const phone = normalizeSriLankanMobile(rawPhone)
    try {
      let url = cfg.baseUrl
      let body: string | undefined
      const isGet = cfg.method === 'GET'

      if (isGet) {
        const params = buildBody(cfg.bodyTemplate, phone, payload.message, true)
        url = url.includes('?') ? `${url}&${params}` : `${url}?${params}`
      } else {
        body = buildBody(cfg.bodyTemplate, phone, payload.message, false)
      }

      const res = await httpRequest(url, { method: cfg.method, headers, body })
      const bareCode = res.text.trim().match(/^\d{1,3}$/) ? res.text.trim() : null

      if (!res.ok) {
        const err = `HTTP ${res.status} — ${res.text.slice(0, 100)}`
        errors.push(`${phone}: ${err}`)
        logSmsAttempt(phone, payload.message, payload.event, 'failed', res.text.slice(0, 500), err)
      } else if (bareCode && bareCode !== '200') {
        const err = `Gateway error code ${bareCode}`
        errors.push(`${phone}: ${err}`)
        logSmsAttempt(phone, payload.message, payload.event, 'failed', res.text.slice(0, 500), err)
      } else {
        logSmsAttempt(phone, payload.message, payload.event, 'sent', res.text.slice(0, 500))
      }
    } catch (err) {
      const errMsg = String(err)
      errors.push(`${phone}: ${errMsg}`)
      logSmsAttempt(phone, payload.message, payload.event, 'failed', undefined, errMsg)
    }
  }

  if (errors.length) return { success: false, error: errors.join('; ') }
  return { success: true }
}

export async function testSms(testTo: string): Promise<{ success: boolean; error?: string }> {
  return sendSms({ to: testTo, message: 'POS System — SMS test message. Configuration is working correctly.', event: 'manual_test' })
}

// Common SMS message templates
export function installmentDueMessage(customerName: string, amount: string, currency: string, dueDate: string, companyName: string) {
  return `${companyName}: Dear ${customerName}, your installment of ${currency} ${amount} is due on ${dueDate}. Please pay on time to avoid penalties.`
}

export function installmentOverdueMessage(customerName: string, amount: string, currency: string, dueDate: string, companyName: string) {
  return `${companyName}: Dear ${customerName}, your installment of ${currency} ${amount} due on ${dueDate} is OVERDUE. Please pay immediately to avoid further charges.`
}

export function lowStockMessage(itemCount: number, companyName: string) {
  return `${companyName}: Low stock alert — ${itemCount} item${itemCount > 1 ? 's' : ''} need restocking. Please check your inventory.`
}
