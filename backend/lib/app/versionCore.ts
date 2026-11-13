// Pure helpers for in-app updates (no imports so node --test can load it directly).
// Version ordering is semver: 1.0.0-test.5 < 1.0.0-test.6 < 1.0.0-test.10 < 1.0.0 < 1.0.1-test.1 < 1.0.1.
// A prerelease tag always sorts BELOW the same x.y.z release; dot-separated numeric identifiers compare
// numerically (so test.10 > test.9) and numeric identifiers sort below alphanumeric ones.

export const VERSION_RE = /^(\d{1,4})\.(\d{1,4})\.(\d{1,4})(?:-([0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*))?$/
export const SHA256_RE = /^[0-9a-f]{64}$/
export const PLATFORMS = ['android', 'ios'] as const
export const CHANNELS = ['test', 'production'] as const
export type VPlatform = typeof PLATFORMS[number]
export type VChannel = typeof CHANNELS[number]

export interface ParsedVersion { major: number; minor: number; patch: number; pre: string[] }

export function parseVersion(v: unknown): ParsedVersion | null {
  if (typeof v !== 'string') return null
  const m = VERSION_RE.exec(v.trim())
  if (!m) return null
  return { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] ? m[4].split('.') : [] }
}
export const isValidVersion = (v: unknown): boolean => parseVersion(v) !== null

/** -1 | 0 | 1. Throws on an unparseable version (callers validate first). */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const x = parseVersion(a), y = parseVersion(b)
  if (!x || !y) throw new Error('Invalid version')
  for (const k of ['major', 'minor', 'patch'] as const) if (x[k] !== y[k]) return x[k] < y[k] ? -1 : 1
  if (!x.pre.length && !y.pre.length) return 0
  if (!x.pre.length) return 1
  if (!y.pre.length) return -1
  const n = Math.max(x.pre.length, y.pre.length)
  for (let i = 0; i < n; i++) {
    const p = x.pre[i], q = y.pre[i]
    if (p === undefined) return -1
    if (q === undefined) return 1
    const pn = /^\d+$/.test(p), qn = /^\d+$/.test(q)
    if (pn && qn) { if (+p !== +q) return +p < +q ? -1 : 1 } else if (pn !== qn) return pn ? -1 : 1
    else if (p !== q) return p < q ? -1 : 1
  }
  return 0
}

/** Hosts a served update URL may point at: APP_UPDATE_HOSTS (comma list) plus the PUBLIC_BASE_URL host. */
export function allowedUpdateHosts(env: Record<string, string | undefined>): string[] {
  const out = new Set<string>()
  for (const h of String(env.APP_UPDATE_HOSTS ?? '').split(',')) { const s = h.trim().toLowerCase(); if (s) out.add(s) }
  try { if (env.PUBLIC_BASE_URL) out.add(new URL(env.PUBLIC_BASE_URL).host.toLowerCase()) } catch { /* ignore */ }
  return [...out]
}

/** https only, no credentials, host (with port) on the allow-list. Returns the normalised URL or null. */
export function safeUpdateUrl(url: unknown, hosts: string[]): string | null {
  if (typeof url !== 'string' || !url.trim() || url.length > 500) return null
  let u: URL
  try { u = new URL(url.trim()) } catch { return null }
  if (u.protocol !== 'https:' || u.username || u.password) return null
  if (!hosts.includes(u.host.toLowerCase())) return null
  return u.toString()
}

export interface ReleaseNotes { en: string; ta: string; si: string }
export function parseNotes(raw: unknown): ReleaseNotes {
  let o: unknown = raw
  if (typeof raw === 'string') { try { o = JSON.parse(raw) } catch { o = {} } }
  const r = (o && typeof o === 'object' ? o : {}) as Record<string, unknown>
  const s = (k: string) => (typeof r[k] === 'string' ? (r[k] as string).slice(0, 2000) : '')
  return { en: s('en'), ta: s('ta'), si: s('si') }
}

export interface VersionPolicy {
  latest_version: string; min_version: string
}
/** Server-side verdict for a given installed version. */
export function evaluate(installed: string, p: VersionPolicy): { update_required: boolean; update_available: boolean } {
  return {
    update_required: compareVersions(installed, p.min_version) < 0,
    update_available: compareVersions(installed, p.latest_version) < 0,
  }
}
