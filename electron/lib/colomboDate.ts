/** Business dates (YYYY-MM-DD) are Sri Lanka calendar days (Asia/Colombo, UTC+05:30, no DST), not UTC days or PC-local days. */
export const COLOMBO_OFFSET_MIN = 330

export function colomboToday(now: number = Date.now()): string {
  return new Date(now + COLOMBO_OFFSET_MIN * 60_000).toISOString().slice(0, 10)
}

/** SQLite: today's Colombo date. Use instead of date('now') when writing a business date. */
export const SQL_COLOMBO_TODAY = "date('now','+330 minutes')"
