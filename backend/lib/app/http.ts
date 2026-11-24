// Error helper, request wrapper, input validation for the App API.
import { NextRequest, NextResponse } from 'next/server'
import type { AppErrorBody, AppErrorCode } from './contracts/common'

export class AppHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: AppErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
    public readonly headers?: Record<string, string>
  ) {
    super(message)
    this.name = 'AppHttpError'
  }
}

export function appError(
  status: number,
  code: AppErrorCode,
  message: string,
  details?: Record<string, unknown>,
  headers?: Record<string, string>
): NextResponse<AppErrorBody> {
  const body: AppErrorBody = { error: { code, message, ...(details ? { details } : {}) } }
  return NextResponse.json(body, { status, headers })
}

export function fail(status: number, code: AppErrorCode, message: string, details?: Record<string, unknown>): never {
  throw new AppHttpError(status, code, message, details)
}

export function handleError(err: unknown): NextResponse {
  if (err instanceof AppHttpError) return appError(err.status, err.code, err.message, err.details, err.headers)
  console.error('[app-api] unexpected error', err)
  return appError(500, 'INTERNAL', 'Something went wrong. Please try again.')
}

/** Caller-visible origin (used to build absolute image URLs). */
export function originOf(req: NextRequest): string {
  const base = process.env.PUBLIC_BASE_URL
  return (base || req.nextUrl.origin).replace(/\/+$/, '')
}

export function clientIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown'
}

// ── Input validation (no external library) ────────────────────────────────
export async function readJson(req: NextRequest, maxBytes = 256 * 1024): Promise<Record<string, unknown>> {
  const text = await req.text()
  if (text.length > maxBytes) fail(413, 'VALIDATION', 'Request body too large')
  if (!text.trim()) return {}
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch { fail(400, 'VALIDATION', 'Body must be valid JSON') }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) fail(400, 'VALIDATION', 'Body must be a JSON object')
  return parsed as Record<string, unknown>
}

/** Reject unknown fields. */
export function only(body: Record<string, unknown>, allowed: string[]): void {
  for (const k of Object.keys(body)) {
    if (!allowed.includes(k)) fail(400, 'VALIDATION', `Unknown field: ${k}`)
  }
}

export function reqStr(v: unknown, field: string, min = 1, max = 255): string {
  if (typeof v !== 'string') fail(400, 'VALIDATION', `${field} is required`)
  const s = v.trim()
  if (s.length < min || s.length > max) fail(400, 'VALIDATION', `${field} must be ${min}-${max} characters`)
  return s
}
export function optStr(v: unknown, field: string, max = 255): string | null {
  if (v === undefined || v === null || v === '') return null
  if (typeof v !== 'string') fail(400, 'VALIDATION', `${field} must be text`)
  const s = v.trim()
  if (s.length > max) fail(400, 'VALIDATION', `${field} is too long`)
  return s || null
}
export function reqNum(v: unknown, field: string, min: number, max: number): number {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v
  if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max) {
    fail(400, 'VALIDATION', `${field} must be a number between ${min} and ${max}`)
  }
  return n
}
export function optNum(v: unknown, field: string, min: number, max: number): number | null {
  if (v === undefined || v === null || v === '') return null
  return reqNum(v, field, min, max)
}
export function oneOf<T extends string>(v: unknown, field: string, values: readonly T[]): T {
  if (typeof v !== 'string' || !values.includes(v as T)) fail(400, 'VALIDATION', `${field} must be one of: ${values.join(', ')}`)
  return v as T
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export function intParam(v: string | null, def: number, min: number, max: number): number {
  if (v === null || v === '') return def
  const n = Number(v)
  if (!Number.isFinite(n)) return def
  return Math.min(max, Math.max(min, Math.floor(n)))
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

export function toIso(v: unknown): string | null {
  if (v === null || v === undefined) return null
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString()
  const d = new Date(String(v).includes('T') ? String(v) : String(v).replace(' ', 'T') + 'Z')
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

export function parseJson<T>(v: unknown, fallback: T): T {
  if (v === null || v === undefined) return fallback
  if (typeof v === 'object') return v as T
  try { return JSON.parse(String(v)) as T } catch { return fallback }
}

/** Escape LIKE wildcards. */
export function likeEscape(s: string): string {
  return s.replace(/[\\%_]/g, m => '\\' + m)
}
