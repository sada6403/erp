// App Control: home banners (targeting, link validation, Colombo window) and home layout.
import type { AppCompany, AppUserCtx } from './context'
import type { BannerAudience, BannerLang, BannerLinkDto, BannerLinkType, HomeSectionDto, HomeSectionKey } from './contracts/catalog'

export const BANNER_LINK_TYPES: readonly BannerLinkType[] = ['product', 'category', 'flash', 'smartbuy', 'url']
export const BANNER_LANGS: readonly BannerLang[] = ['en', 'ta', 'si']
export const HOME_SECTION_KEYS: readonly HomeSectionKey[] = ['banners', 'categories', 'flash_deals', 'smartbuy_promo', 'new_arrivals', 'featured']
export const MAX_BANNERS = 10

const COLOMBO_OFFSET_MS = 330 * 60 * 1000 // Asia/Colombo is UTC+05:30 with no DST

/** Asia/Colombo wall clock as 'YYYY-MM-DD HH:MM:SS' (compare with starts_at / ends_at, which are Colombo wall time). */
export function colomboNow(now: Date = new Date()): string {
  return new Date(now.getTime() + COLOMBO_OFFSET_MS).toISOString().slice(0, 19).replace('T', ' ')
}
/** Asia/Colombo calendar day 'YYYY-MM-DD'. */
export function colomboDay(now: Date = new Date()): string {
  return colomboNow(now).slice(0, 10)
}

/** Only absolute https URLs; anything else (http, javascript:, data:, intent:, custom schemes) is rejected. */
export function safeHttpsUrl(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  if (!s || s.length > 500) return null
  try {
    const u = new URL(s)
    return u.protocol === 'https:' && u.hostname ? u.toString() : null
  } catch { return null }
}

/** Effective link of a banner row. Old rows only have link_url: an https link_url reads as type 'url'. Invalid -> null. */
export function bannerLink(row: Record<string, unknown>): BannerLinkDto | null {
  let type = String(row.link_type ?? 'none')
  let target = row.link_target == null || row.link_target === '' ? null : String(row.link_target)
  if ((type === 'none' || !type) && row.link_url) { type = 'url'; target = String(row.link_url) }
  if (!(BANNER_LINK_TYPES as readonly string[]).includes(type)) return null
  if (type === 'url') {
    const url = safeHttpsUrl(target)
    return url ? { type: 'url', target: url } : null
  }
  if (type === 'flash' || type === 'smartbuy') return { type, target: null }
  if (!target) return null
  return { type: type as BannerLinkType, target }
}

export type AudienceClass = 'guest' | 'customer' | 'member'

/** guest = no/invalid token; member = signed-in with an active Smart Buy membership; customer = any other signed-in user. */
export async function audienceClass(company: AppCompany, user: AppUserCtx | null): Promise<AudienceClass> {
  if (!user) return 'guest'
  if (user.customerId) {
    try {
      const { rows } = await company.tp.query(
        `SELECT 1 FROM chit_members WHERE customer_id = ? AND status <> 'withdrawn' LIMIT 1`, [user.customerId])
      if (rows.length) return 'member'
    } catch { /* tenant without Smart Buy tables */ }
  }
  return 'customer'
}

export function audienceMatches(audience: unknown, cls: AudienceClass): boolean {
  const a = String(audience ?? 'all') as BannerAudience
  if (a === 'guests') return cls === 'guest'
  if (a === 'customers') return cls === 'customer'
  if (a === 'members') return cls === 'member'
  return true
}

export function langOf(raw: string | null, fallback: BannerLang): BannerLang {
  return (BANNER_LANGS as readonly string[]).includes(raw ?? '') ? (raw as BannerLang) : fallback
}

/** Stored value (JSON text) -> ordered sections. Unknown keys dropped, duplicates ignored, missing keys appended enabled. */
export function parseHomeLayout(raw: unknown): HomeSectionDto[] {
  let parsed: unknown = null
  if (typeof raw === 'string' && raw.trim()) { try { parsed = JSON.parse(raw) } catch { parsed = null } }
  const list = Array.isArray(parsed) ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { sections?: unknown }).sections) ? (parsed as { sections: unknown[] }).sections : []
  const seen = new Set<string>()
  const out: HomeSectionDto[] = []
  for (const it of list) {
    const key = it && typeof it === 'object' ? String((it as { key?: unknown }).key) : ''
    if (!(HOME_SECTION_KEYS as readonly string[]).includes(key) || seen.has(key)) continue
    seen.add(key)
    const en = (it as { enabled?: unknown }).enabled
    out.push({ key: key as HomeSectionKey, enabled: !(en === false || en === 0 || en === '0') })
  }
  for (const key of HOME_SECTION_KEYS) if (!seen.has(key)) out.push({ key, enabled: true })
  return out
}
