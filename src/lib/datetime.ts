/**
 * Timestamps are stored as UTC (SQLite datetime('now') -> "YYYY-MM-DD HH:MM:SS", cloud -> ISO with Z).
 * Everything the user reads is Sri Lanka time (Asia/Colombo), whatever the PC's own timezone is.
 */
export const APP_TIMEZONE = 'Asia/Colombo'

/** Parses a stored timestamp as UTC. A bare "YYYY-MM-DD HH:MM:SS" would otherwise be read as the PC's local time. */
export function parseUtc(value: unknown): Date {
  if (value instanceof Date) return value
  const s = String(value ?? '').trim()
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s)) return new Date(s.replace(' ', 'T') + 'Z')
  return new Date(s)
}

/** Makes Date#toLocale(Date|Time)String default to Asia/Colombo unless a caller passes its own timeZone. */
export function installColomboDefault(): void {
  const proto = Date.prototype as unknown as Record<string, (...a: unknown[]) => string>
  for (const name of ['toLocaleString', 'toLocaleDateString', 'toLocaleTimeString'] as const) {
    const orig = proto[name]
    if ((orig as unknown as { __colombo?: boolean }).__colombo) continue
    const wrapped = function (this: Date, locales?: unknown, options?: Record<string, unknown>) {
      return orig.call(this, locales, { timeZone: APP_TIMEZONE, ...(options ?? {}) })
    }
    ;(wrapped as unknown as { __colombo: boolean }).__colombo = true
    proto[name] = wrapped as never
  }
}
