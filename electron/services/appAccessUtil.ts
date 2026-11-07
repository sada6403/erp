// Pure helpers for the App Access feature (no electron imports so they are unit-testable).

/** Mirrors backend/lib/app/security.ts normalizePhone: Sri Lankan mobile -> 07XXXXXXXX or null. */
export function normalizePhone(raw: unknown): string | null {
  let d = String(raw ?? '').replace(/[^\d+]/g, '')
  d = d.replace(/^\+/, '')
  if (d.startsWith('0094')) d = d.slice(4)
  else if (d.startsWith('94') && d.length === 11) d = d.slice(2)
  if (d.length === 9) d = '0' + d
  return /^07\d{8}$/.test(d) ? d : null
}

/** Only https://wa.me/<digits>?text=... may be handed to the OS shell. */
export function isSafeWhatsAppUrl(raw: unknown): boolean {
  try {
    const u = new URL(String(raw))
    return u.protocol === 'https:' && u.hostname === 'wa.me' && u.username === '' && u.password === '' && u.port === ''
      && /^\/\d{8,15}$/.test(u.pathname)
  } catch {
    return false
  }
}

export type AppAccessKind = 'customer' | 'smartbuy' | 'agent'

export interface AppUserRow {
  user_id: string
  name: string
  phone: string | null
  agent_code: string | null
  status: 'active' | 'locked' | 'disabled'
  [k: string]: unknown
}

/** Find the app account that belongs to a local candidate (agent by code, customer by phone). */
export function matchAppUser<T extends AppUserRow>(
  users: T[],
  cand: { kind: AppAccessKind; code?: string | null; phone?: string | null }
): T | null {
  if (cand.kind === 'agent') {
    const code = String(cand.code || '').trim().toUpperCase()
    if (!code) return null
    return users.find(u => u.agent_code && u.agent_code.toUpperCase() === code) || null
  }
  const phone = normalizePhone(cand.phone)
  if (!phone) return null
  return users.find(u => !u.agent_code && normalizePhone(u.phone) === phone)
    || users.find(u => normalizePhone(u.phone) === phone) || null
}

export const PENDING_TTL_MS = 30 * 60 * 1000

/**
 * Holds click-to-chat URLs (which embed a temporary password) in main-process memory only.
 * The renderer receives an opaque dispatch id, never the password or the URL.
 */
export class PendingChatStore {
  private map = new Map<string, { url: string; at: number }>()
  constructor(private now: () => number = Date.now) {}
  put(id: string, url: string): void {
    this.sweep()
    this.map.set(id, { url, at: this.now() })
  }
  /** One-shot: returns the URL and forgets it. */
  take(id: string): string | null {
    this.sweep()
    const v = this.map.get(id)
    if (!v) return null
    this.map.delete(id)
    return v.url
  }
  size(): number { this.sweep(); return this.map.size }
  private sweep(): void {
    const t = this.now()
    for (const [k, v] of this.map) if (t - v.at > PENDING_TTL_MS) this.map.delete(k)
  }
}
