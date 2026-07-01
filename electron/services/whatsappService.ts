import Store from 'electron-store'
import { net } from 'electron'

const store = new Store<Record<string, unknown>>()

export interface WhatsAppPayload {
  to: string
  message: string
  templateName?: string
  templateParams?: string[]
}

function getConfig() {
  return {
    enabled:     Boolean(store.get('whatsapp_enabled', false)),
    provider:    String(store.get('whatsapp_provider', 'meta')), // 'meta' | 'twilio'
    phoneNumberId: String(store.get('whatsapp_phone_number_id', '')),
    accessToken: String(store.get('whatsapp_access_token', '')),
    // Twilio
    accountSid:  String(store.get('whatsapp_twilio_sid', '')),
    authToken:   String(store.get('whatsapp_twilio_token', '')),
    fromNumber:  String(store.get('whatsapp_from_number', '')),
  }
}

async function httpPost(url: string, headers: Record<string, string>, body: unknown): Promise<{ ok: boolean; status: number; text: string }> {
  return new Promise((resolve) => {
    const req = net.request({ method: 'POST', url })
    Object.entries(headers).forEach(([k, v]) => req.setHeader(k, v))
    let resp = ''
    req.on('response', (r) => {
      r.on('data', (c) => { resp += c.toString() })
      r.on('end', () => resolve({ ok: r.statusCode >= 200 && r.statusCode < 300, status: r.statusCode, text: resp }))
    })
    req.on('error', () => resolve({ ok: false, status: 0, text: 'Network error' }))
    req.write(JSON.stringify(body))
    req.end()
  })
}

async function sendViaMeta(cfg: ReturnType<typeof getConfig>, to: string, message: string): Promise<{ success: boolean; error?: string }> {
  if (!cfg.phoneNumberId || !cfg.accessToken) return { success: false, error: 'WhatsApp phone number ID or access token not configured' }

  const phone = to.replace(/[^0-9]/g, '')
  const url = `https://graph.facebook.com/v19.0/${cfg.phoneNumberId}/messages`

  const res = await httpPost(url, {
    'Authorization': `Bearer ${cfg.accessToken}`,
    'Content-Type': 'application/json',
  }, {
    messaging_product: 'whatsapp',
    to: phone,
    type: 'text',
    text: { preview_url: false, body: message },
  })

  if (!res.ok) return { success: false, error: `Meta API error: ${res.status} — ${res.text.slice(0, 200)}` }
  return { success: true }
}

async function sendViaTwilio(cfg: ReturnType<typeof getConfig>, to: string, message: string): Promise<{ success: boolean; error?: string }> {
  if (!cfg.accountSid || !cfg.authToken || !cfg.fromNumber) return { success: false, error: 'Twilio credentials not configured' }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${cfg.accountSid}/Messages.json`
  const auth = Buffer.from(`${cfg.accountSid}:${cfg.authToken}`).toString('base64')
  const phone = to.startsWith('+') ? to : `+${to}`

  const body = new URLSearchParams({
    From: `whatsapp:${cfg.fromNumber}`,
    To: `whatsapp:${phone}`,
    Body: message,
  }).toString()

  return new Promise((resolve) => {
    const req = net.request({ method: 'POST', url })
    req.setHeader('Authorization', `Basic ${auth}`)
    req.setHeader('Content-Type', 'application/x-www-form-urlencoded')
    let resp = ''
    req.on('response', (r) => {
      r.on('data', (c) => { resp += c.toString() })
      r.on('end', () => {
        if (r.statusCode >= 200 && r.statusCode < 300) resolve({ success: true })
        else resolve({ success: false, error: `Twilio error: ${r.statusCode} — ${resp.slice(0, 200)}` })
      })
    })
    req.on('error', () => resolve({ success: false, error: 'Network error' }))
    req.write(body)
    req.end()
  })
}

export async function sendWhatsApp(payload: WhatsAppPayload): Promise<{ success: boolean; error?: string }> {
  const cfg = getConfig()
  if (!cfg.enabled) return { success: false, error: 'WhatsApp is not enabled in settings' }

  if (cfg.provider === 'twilio') return sendViaTwilio(cfg, payload.to, payload.message)
  return sendViaMeta(cfg, payload.to, payload.message)
}

export async function testWhatsApp(testTo: string): Promise<{ success: boolean; error?: string }> {
  return sendWhatsApp({ to: testTo, message: '✅ POS System — WhatsApp test message. Your configuration is working correctly!' })
}
