// Pure rules for App Control banners / home layout (no DB, no electron). Mirrors backend/lib/app/bannerLib.ts.

export const BANNER_LINK_TYPES = ['none', 'product', 'category', 'flash', 'smartbuy', 'url'] as const
export const BANNER_AUDIENCES = ['all', 'guests', 'customers', 'members'] as const
export const HOME_SECTION_KEYS = ['banners', 'categories', 'flash_deals', 'smartbuy_promo', 'new_arrivals', 'featured'] as const
export type BannerLinkType = typeof BANNER_LINK_TYPES[number]
export type BannerAudience = typeof BANNER_AUDIENCES[number]
export type HomeSectionKey = typeof HOME_SECTION_KEYS[number]
export interface HomeSection { key: HomeSectionKey; enabled: boolean }

/** Recommended banner artwork (2:1). Shown in the POS and used for the crop preview. */
export const BANNER_ASPECT = { width: 2, height: 1, recommended: '1200 x 600 px', minimum: '800 x 400 px' } as const

/** Only absolute https URLs are allowed as banner links. Returns the cleaned URL or throws. */
export function requireHttpsUrl(v: unknown): string {
  const s = String(v ?? '').trim()
  let u: URL
  try { u = new URL(s) } catch { throw new Error('Link must be a full web address starting with https://') }
  if (u.protocol !== 'https:' || !u.hostname || s.length > 500) throw new Error('Only https:// links are allowed')
  return u.toString()
}

/**
 * Banner times are Asia/Colombo wall time stored as 'YYYY-MM-DD HH:MM:SS' (no zone, no Z).
 * Accepts '', 'YYYY-MM-DD', 'YYYY-MM-DDTHH:mm', 'YYYY-MM-DD HH:mm:ss' and ISO strings synced back from the cloud (digits are kept as-is).
 * A date without a time becomes 00:00:00 (start) or 23:59:59 (end).
 */
export function normalizeWallTime(v: unknown, edge: 'start' | 'end'): string | null {
  const s = String(v ?? '').trim()
  if (!s) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(s)
  if (!m) throw new Error('Invalid date')
  const [, y, mo, d, hh, mm, ss] = m
  const time = hh !== undefined ? `${hh}:${mm}:${ss ?? '00'}` : edge === 'start' ? '00:00:00' : '23:59:59'
  const out = `${y}-${mo}-${d} ${time}`
  const probe = new Date(`${y}-${mo}-${d}T${time}Z`)
  if (Number.isNaN(probe.getTime()) || probe.toISOString().slice(0, 10) !== `${y}-${mo}-${d}`) throw new Error('Invalid date')
  return out
}

export function parseHomeLayout(raw: unknown): HomeSection[] {
  let parsed: unknown = null
  if (typeof raw === 'string' && raw.trim()) { try { parsed = JSON.parse(raw) } catch { parsed = null } }
  const list = Array.isArray(parsed) ? parsed : parsed && typeof parsed === 'object' && Array.isArray((parsed as { sections?: unknown }).sections) ? (parsed as { sections: unknown[] }).sections : []
  const seen = new Set<string>()
  const out: HomeSection[] = []
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

/** Validates an incoming layout: exactly the six known keys, each once. */
export function validateHomeLayout(input: unknown): HomeSection[] {
  if (!Array.isArray(input) || input.length !== HOME_SECTION_KEYS.length) throw new Error('Home layout must list all 6 sections')
  const seen = new Set<string>()
  const out: HomeSection[] = []
  for (const it of input) {
    const key = String((it as { key?: unknown } | null)?.key)
    if (!(HOME_SECTION_KEYS as readonly string[]).includes(key) || seen.has(key)) throw new Error('Unknown or repeated home section')
    seen.add(key)
    out.push({ key: key as HomeSectionKey, enabled: (it as { enabled?: unknown }).enabled === true })
  }
  return out
}

export interface BannerInput {
  title?: unknown; subtitle?: unknown; image_url?: unknown; image_en?: unknown; image_ta?: unknown; image_si?: unknown
  link_type?: unknown; link_target?: unknown; audience?: unknown; starts_at?: unknown; ends_at?: unknown
  sort_order?: unknown; is_active?: unknown
}

const clip = (v: unknown, max: number): string | null => { const s = String(v ?? '').trim(); return s ? s.slice(0, max) : null }

export interface BannerRow {
  title: string; subtitle: string | null; image_url: string; image_en: string | null; image_ta: string | null; image_si: string | null
  link_type: BannerLinkType; link_target: string | null; link_url: string | null; audience: BannerAudience
  starts_at: string | null; ends_at: string | null; sort_order: number; is_active: 0 | 1
}

/**
 * Validates and normalises a banner from the form. `exists(table, id)` checks that product / category targets are real.
 * link_url is kept in step with link_type 'url' so older readers still see the link.
 */
export function buildBannerRow(p: BannerInput, exists: (kind: 'product' | 'category', id: string) => boolean): BannerRow {
  const image_url = clip(p.image_url, 500)
  if (!image_url) throw new Error('Choose a banner image')
  const link_type = String(p.link_type ?? 'none') as BannerLinkType
  if (!(BANNER_LINK_TYPES as readonly string[]).includes(link_type)) throw new Error('Unknown link type')
  const audience = String(p.audience ?? 'all') as BannerAudience
  if (!(BANNER_AUDIENCES as readonly string[]).includes(audience)) throw new Error('Unknown audience')
  let link_target: string | null = null
  if (link_type === 'url') link_target = requireHttpsUrl(p.link_target)
  else if (link_type === 'product' || link_type === 'category') {
    link_target = clip(p.link_target, 191)
    if (!link_target) throw new Error(`Pick a ${link_type} for the link`)
    if (!exists(link_type, link_target)) throw new Error(`The selected ${link_type} no longer exists`)
  }
  const starts_at = normalizeWallTime(p.starts_at, 'start')
  const ends_at = normalizeWallTime(p.ends_at, 'end')
  if (starts_at && ends_at && ends_at <= starts_at) throw new Error('End must be after the start')
  return {
    title: clip(p.title, 120) ?? '', subtitle: clip(p.subtitle, 200), image_url,
    image_en: clip(p.image_en, 500), image_ta: clip(p.image_ta, 500), image_si: clip(p.image_si, 500),
    link_type, link_target, link_url: link_type === 'url' ? link_target : null, audience,
    starts_at, ends_at, sort_order: Math.trunc(Number(p.sort_order) || 0), is_active: p.is_active === false || p.is_active === 0 || p.is_active === '0' ? 0 : 1,
  }
}
