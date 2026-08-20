// Per-company SMS (Issue 24b) — the same generic HTTP-gateway shape as the
// local POS app's electron/services/smsService.ts (configurable base URL,
// method, headers, body template, API key), just read from
// companies.branding_json.sms instead of electron-store, and sent via
// fetch() instead of Electron's net.request. Storage only for now, not
// wired into the local app's own send path.
import { pool } from './db'
import { decryptSecret } from './secretCrypto'

interface CompanySmsConfig {
  baseUrl: string
  method: string
  contentType: string
  headers: string
  bodyTemplate: string
  apiKey: string
  senderId: string
}

async function getCompanySmsSettings(companyId: string): Promise<CompanySmsConfig | null> {
  const { rows } = await pool.query(`SELECT branding_json FROM companies WHERE id = ?`, [companyId])
  if (!rows.length) return null
  const raw = (rows[0] as Record<string, unknown>).branding_json
  if (!raw) return null
  try {
    const branding = JSON.parse(String(raw)) as Record<string, unknown>
    const sms = branding.sms as Record<string, unknown> | undefined
    if (!sms?.base_url) return null
    return {
      baseUrl:      String(sms.base_url),
      method:       String(sms.method || 'POST'),
      contentType:  String(sms.content_type || 'application/json'),
      headers:      String(sms.headers || ''),
      bodyTemplate: String(sms.body_template || '{"mobile":"{phone}","message":"{message}"}'),
      apiKey:       decryptSecret(String(sms.api_key || '')),
      senderId:     String(sms.sender_id || ''),
    }
  } catch {
    return null
  }
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

function buildBody(template: string, phone: string, message: string, senderId: string, apiKey: string): string {
  return template
    .replace(/\{phone\}/g, phone)
    .replace(/\{mobile\}/g, phone)
    .replace(/\{message\}/g, message.replace(/"/g, '\\"'))
    .replace(/\{sender_id\}/g, senderId)
    .replace(/\{api_key\}/g, apiKey)
}

export async function sendCompanySms(companyId: string, to: string, message: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const cfg = await getCompanySmsSettings(companyId)
    if (!cfg) return { ok: false, error: 'SMS is not configured for this company' }

    const customHeaders = parseCustomHeaders(cfg.headers)
    const headers: Record<string, string> = { 'Content-Type': cfg.contentType, ...customHeaders }
    if (cfg.apiKey && !customHeaders['Authorization']) headers['Authorization'] = `Bearer ${cfg.apiKey}`

    let url = cfg.baseUrl
    let body: string | undefined
    if (cfg.method === 'GET') {
      const params = buildBody(cfg.bodyTemplate, to, message, cfg.senderId, cfg.apiKey)
      url = url.includes('?') ? `${url}&${params}` : `${url}?${params}`
    } else {
      body = buildBody(cfg.bodyTemplate, to, message, cfg.senderId, cfg.apiKey)
    }

    const res = await fetch(url, { method: cfg.method, headers, body })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return { ok: false, error: `HTTP ${res.status} — ${text.slice(0, 200)}` }
    }
    return { ok: true }
  } catch (err) {
    console.error('[sms] company send failed:', err)
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}
