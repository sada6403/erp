/**
 * Pull cursor safety for the UTC session switch (see docs/mobile-app/PRODUCTION_RUNBOOK.md, "Timezone rollout").
 *
 * Sync pulls `updated_at > since`. If the MySQL server's own time zone is not UTC (Sri Lanka: +05:30), rows written
 * before the switch carry local-time stamps (read as UTC, so 5h30 "ahead"), and devices hold cursors derived from
 * them. Rows written after the switch are true UTC and sort 5h30 *behind* those cursors, so a device would miss them
 * until the clock catches up. SYNC_PULL_OVERLAP_MINUTES widens every pull window backwards. Re-sent rows are harmless
 * (upsert, last-write-wins by id). Default 0 = off; set 330 for 7 days after the switch, then remove.
 */
export function pullOverlapMinutes(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.SYNC_PULL_OVERLAP_MINUTES ?? 0)
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 24 * 60) : 0
}

/** The `since` cursor as a MySQL DATETIME(3) string, moved back by the overlap window. */
export function pullSinceSql(since: string, overlapMinutes: number = pullOverlapMinutes()): string {
  const ms = new Date(since).getTime() - overlapMinutes * 60_000
  return new Date(ms).toISOString().slice(0, 23).replace('T', ' ')
}
