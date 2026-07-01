import Store from 'electron-store'
import { net } from 'electron'

const store = new Store<Record<string, unknown>>()

export interface SmsPayload {
  to: string | string[]
  message: string
}

function getConfig() {
  return {
    enabled:     Boolean(store.get('sms_enabled', false)),
    provider:    String(store.get('sms_provider_name', '')),
    baseUrl:     String(store.get('sms_api_base_url', '')),
    apiKey:      String(store.get('sms_api_key', '')),
    apiSecret:   String(store.get('sms_api_secret', '')),
    senderId:    String(store.get('sms_sender_id', '')),
    method:      String(store.get('sms_http_method', 'POST')),
    contentType: String(store.get('sms_content_type', 'application/json')),
    headers:     String(store.get('sms_custom_headers', '')),
    bodyTemplate:String(store.get('sms_body_template', '{"mobile":"{phone}","message":"{message}"}')),
  }
}

function buildBody(template: string, phone: string, message: string): string {
  return template
    .replace(/\{phone\}/g, phone)
    .replace(/\{mobile\}/g, phone)
    .replace(/\{message\}/g, message.replace(/"/g, '\\"'))
    .replace(/\{sender_id\}/g, getConfig().senderId)
    .replace(/\{api_key\}/g, getConfig().apiKey)
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

  for (const phone of phones) {
    try {
      let url = cfg.baseUrl
      let body: string | undefined

      if (cfg.method === 'GET') {
        const params = buildBody(cfg.bodyTemplate, phone, payload.message)
        url = url.includes('?') ? `${url}&${params}` : `${url}?${params}`
      } else {
        body = buildBody(cfg.bodyTemplate, phone, payload.message)
      }

      const res = await httpRequest(url, { method: cfg.method, headers, body })
      if (!res.ok) errors.push(`${phone}: HTTP ${res.status} — ${res.text.slice(0, 100)}`)
    } catch (err) {
      errors.push(`${phone}: ${String(err)}`)
    }
  }

  if (errors.length) return { success: false, error: errors.join('; ') }
  return { success: true }
}

export async function testSms(testTo: string): Promise<{ success: boolean; error?: string }> {
  return sendSms({ to: testTo, message: 'POS System — SMS test message. Configuration is working correctly.' })
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
