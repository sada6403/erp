// Product reviews + branch delivery time (read by the catalog, written by the reviews endpoint).
import type { AppCompany } from './context'
import type { EstimatedDeliveryDto } from './contracts/catalog'
import { fail } from './http'

type Db = Pick<AppCompany['tp'], 'query'>
export type RatingInfo = { avg: number | null; count: number }

/** Average (one decimal) and count of VISIBLE reviews for the given products. One grouped query. */
export async function loadRatings(company: { tp: Db }, productIds: string[]): Promise<Map<string, RatingInfo>> {
  const out = new Map<string, RatingInfo>()
  if (!productIds.length) return out
  try {
    const { rows } = await company.tp.query<{ product_id: string; avg_r: string | number; cnt: string | number }>(
      `SELECT product_id, AVG(rating) AS avg_r, COUNT(*) AS cnt FROM product_reviews
        WHERE is_hidden = 0 AND product_id IN (?) GROUP BY product_id`, [productIds])
    for (const r of rows) out.set(String(r.product_id), { avg: roundAvg(Number(r.avg_r)), count: Number(r.cnt) })
  } catch { /* tenant not migrated yet: no ratings */ }
  return out
}

export const roundAvg = (n: number): number => Math.round(n * 10) / 10
export const ratingOf = (m: Map<string, RatingInfo> | undefined, id: string): RatingInfo => m?.get(id) ?? { avg: null, count: 0 }

/** Average of visible ratings (used by tests and as the reference for the SQL). */
export function averageOf(rows: Array<{ rating: number; is_hidden?: number | boolean }>): number | null {
  const v = rows.filter(r => !r.is_hidden)
  return v.length ? roundAvg(v.reduce((a, r) => a + r.rating, 0) / v.length) : null
}

/** "Asha K." from a full name; never more than first name + one initial. */
export function authorName(full: string | null | undefined): string {
  const parts = String(full ?? '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return 'Customer'
  const first = parts[0].slice(0, 30)
  const last = parts.length > 1 ? parts[parts.length - 1] : ''
  return last ? `${first} ${Array.from(last)[0].toUpperCase()}.` : first
}

/** Strip tags/control characters, collapse whitespace, cap at 500 characters. Empty => null. */
export function sanitizeComment(v: unknown): string | null {
  if (v === undefined || v === null) return null
  if (typeof v !== 'string') fail(400, 'VALIDATION', 'comment must be text')
  const s = v.replace(/<[^>]*>/g, ' ').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
  if (Array.from(s).length > 500) fail(400, 'VALIDATION', 'comment must be at most 500 characters')
  return s || null
}

export function parseRating(v: unknown): number {
  const n = typeof v === 'number' ? v : NaN
  if (!Number.isInteger(n) || n < 1 || n > 5) fail(400, 'VALIDATION', 'rating must be a whole number from 1 to 5')
  return n
}

export type EtaRow = { delivery_eta_min_days?: unknown; delivery_eta_max_days?: unknown; delivery_eta_text?: unknown }
/** null when the branch has no delivery time. A text alone or a min/max pair counts as set. */
export function etaOf(b: EtaRow | undefined | null): EstimatedDeliveryDto | null {
  if (!b) return null
  const num = (x: unknown) => { const n = Number(x); return x !== null && x !== undefined && x !== '' && Number.isFinite(n) && n >= 0 ? Math.trunc(n) : null }
  const min = num(b.delivery_eta_min_days), max = num(b.delivery_eta_max_days)
  const text = typeof b.delivery_eta_text === 'string' && b.delivery_eta_text.trim() ? b.delivery_eta_text.trim() : null
  if (min === null && max === null && !text) return null
  const lo = min ?? max ?? 0, hi = max ?? min ?? 0
  return { min_days: Math.min(lo, hi), max_days: Math.max(lo, hi), text }
}

/** Delivery time of the given branch, or of the company's main branch (first active, same order as /branches). */
export async function loadDeliveryEta(company: { tp: Db }, branchId?: string | null): Promise<EstimatedDeliveryDto | null> {
  try {
    const { rows } = branchId
      ? await company.tp.query<EtaRow>(`SELECT delivery_eta_min_days, delivery_eta_max_days, delivery_eta_text FROM branches WHERE id = ? LIMIT 1`, [branchId])
      : await company.tp.query<EtaRow>(`SELECT delivery_eta_min_days, delivery_eta_max_days, delivery_eta_text FROM branches WHERE is_active = 1 ORDER BY name LIMIT 1`)
    return etaOf(rows[0])
  } catch { return null }
}
