// Notification queue: inbox row (always) + notification_jobs row (push) + Expo Push sender.
import { randomUUID } from 'crypto'
import { pool, tenantPool } from '../db'
import { ensureTenantCompatibility } from '../auth'
import type { NotificationChannel, NotificationType } from './contracts/notifications'
import { parseJson, toIso } from './http'

type Q = { query: (sql: string, values?: unknown[]) => Promise<{ rows: unknown[] }> }

export type NotifyInput = {
  userId: string
  type: NotificationType
  channel: NotificationChannel
  title: string
  body: string
  /** Deep link, e.g. lankahome://orders/<id> */
  url?: string | null
  /** Same key => enqueued once */
  dedupeKey?: string
}

/** Never put passwords / OTPs / NIC / phone numbers in title or body. */
export async function enqueueNotification(db: Q, n: NotifyInput): Promise<void> {
  const data = JSON.stringify({ url: n.url ?? null })
  if (n.dedupeKey) {
    const ins = await db.query(
      `INSERT IGNORE INTO notification_jobs (id, user_id, type, channel, title, body, data, dedupe_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [randomUUID(), n.userId, n.type, n.channel, n.title, n.body, data, n.dedupeKey]
    )
    // INSERT IGNORE on a duplicate affects 0 rows: skip the inbox row too.
    if (Number((ins.rows as unknown as { affectedRows?: number }).affectedRows ?? 1) === 0) return
  } else {
    await db.query(
      `INSERT INTO notification_jobs (id, user_id, type, channel, title, body, data) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [randomUUID(), n.userId, n.type, n.channel, n.title, n.body, data]
    )
  }
  await db.query(
    `INSERT INTO app_notifications (id, user_id, type, channel, title, body, data) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [randomUUID(), n.userId, n.type, n.channel, n.title, n.body, data]
  )
}

const EXPO_URL = 'https://exp.host/--/api/v2/push/send'
const EXPO_RECEIPTS = 'https://exp.host/--/api/v2/push/getReceipts'
const MAX_ATTEMPTS = 5

function pushEnabled(): boolean {
  return process.env.APP_PUSH_ENABLED === '1'
}

function inQuietHours(settings: Record<string, unknown>): boolean {
  const s = settings.quiet_hours_start, e = settings.quiet_hours_end
  if (typeof s !== 'string' || typeof e !== 'string') return false
  const now = new Date()
  const cur = now.getUTCHours() * 60 + now.getUTCMinutes() + 330 // Sri Lanka UTC+5:30
  const m = (t: string) => { const [h, mm] = t.split(':').map(Number); return (h * 60 + mm) % 1440 }
  const c = cur % 1440, a = m(s), b = m(e)
  return a <= b ? c >= a && c < b : c >= a || c < b
}

type JobRow = { id: string; user_id: string; type: string; channel: string; title: string; body: string; data: unknown; attempts: number }

/** Process one tenant's queue. Dry-run (log only) unless APP_PUSH_ENABLED=1. */
export async function runNotificationWorker(dbSchema: string): Promise<{ processed: number; sent: number; failed: number; dryRun: boolean }> {
  await ensureTenantCompatibility(dbSchema)
  const tp = tenantPool(dbSchema)
  const dryRun = !pushEnabled()
  const { rows } = await tp.query<JobRow>(
    `SELECT id, user_id, type, channel, title, body, data, attempts FROM notification_jobs
      WHERE status = 'pending' AND next_attempt_at <= NOW() ORDER BY created_at LIMIT 100`
  )
  let sent = 0, failed = 0
  const messages: Array<{ job: JobRow; msg: Record<string, unknown> }> = []

  for (const job of rows) {
    const { rows: users } = await tp.query(`SELECT notification_settings FROM app_users WHERE id = ? AND deleted_at IS NULL`, [job.user_id])
    if (!users[0]) { await tp.query(`UPDATE notification_jobs SET status='skipped', last_error='user gone' WHERE id=?`, [job.id]); continue }
    const settings = parseJson<Record<string, unknown>>((users[0] as Record<string, unknown>).notification_settings, {})
    if (settings[job.channel] === false) { await tp.query(`UPDATE notification_jobs SET status='skipped', last_error='disabled by user' WHERE id=?`, [job.id]); continue }
    if (job.channel === 'offers' && inQuietHours(settings)) {
      await tp.query(`UPDATE notification_jobs SET next_attempt_at = DATE_ADD(NOW(), INTERVAL 1 HOUR) WHERE id=?`, [job.id]); continue
    }
    const { rows: devs } = await tp.query(`SELECT expo_push_token FROM app_devices WHERE user_id = ?`, [job.user_id])
    if (!devs.length) { await tp.query(`UPDATE notification_jobs SET status='skipped', last_error='no device' WHERE id=?`, [job.id]); continue }
    const data = parseJson<Record<string, unknown>>(job.data, {})
    for (const d of devs as Array<{ expo_push_token: string }>) {
      messages.push({
        job,
        msg: { to: d.expo_push_token, title: job.title, body: job.body, data: { ...data, type: job.type }, channelId: job.channel, sound: 'default', priority: 'high' },
      })
    }
  }

  if (dryRun) {
    for (const { job, msg } of messages) console.log('[push dry-run]', JSON.stringify({ to: String(msg.to).slice(0, 24) + '...', title: job.title, channel: job.channel }))
    const ids = [...new Set(messages.map(m => m.job.id))]
    for (const id of ids) { await tp.query(`UPDATE notification_jobs SET status='sent', sent_at=NOW(), last_error='dry-run' WHERE id=?`, [id]); sent++ }
    return { processed: rows.length, sent, failed, dryRun }
  }

  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100)
    let tickets: Array<{ status: string; id?: string; message?: string; details?: { error?: string } }> = []
    let httpFailed = false
    try {
      const res = await fetch(EXPO_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json', ...(process.env.EXPO_ACCESS_TOKEN ? { authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` } : {}) },
        body: JSON.stringify(chunk.map(c => c.msg)),
      })
      const j = await res.json() as { data?: typeof tickets }
      tickets = j.data ?? []
      httpFailed = !res.ok
    } catch { httpFailed = true }
    for (let k = 0; k < chunk.length; k++) {
      const { job, msg } = chunk[k]
      const t = tickets[k]
      if (httpFailed || !t) { await retryJob(tp, job, 'expo request failed'); failed++; continue }
      if (t.status === 'ok') {
        await tp.query(`UPDATE notification_jobs SET status='sent', sent_at=NOW(), last_error=? WHERE id=?`, [`ticket:${t.id ?? ''}`, job.id]); sent++
      } else if (t.details?.error === 'DeviceNotRegistered') {
        await tp.query(`DELETE FROM app_devices WHERE expo_push_token = ?`, [msg.to])
        await tp.query(`UPDATE notification_jobs SET status='sent', last_error='token removed' WHERE id=?`, [job.id])
      } else { await retryJob(tp, job, t.message || t.details?.error || 'push error'); failed++ }
    }
  }
  await checkReceipts(tp)
  return { processed: rows.length, sent, failed, dryRun }
}

async function retryJob(tp: ReturnType<typeof tenantPool>, job: JobRow, err: string) {
  const attempts = job.attempts + 1
  if (attempts >= MAX_ATTEMPTS) {
    await tp.query(`UPDATE notification_jobs SET status='failed', attempts=?, last_error=? WHERE id=?`, [attempts, err.slice(0, 500), job.id])
  } else {
    const mins = Math.pow(2, attempts) // 2,4,8,16 min
    await tp.query(
      `UPDATE notification_jobs SET attempts=?, last_error=?, next_attempt_at = DATE_ADD(NOW(), INTERVAL ? MINUTE) WHERE id=?`,
      [attempts, err.slice(0, 500), mins, job.id]
    )
  }
}

/** Receipts carry the final DeviceNotRegistered verdict; remove dead tokens. */
async function checkReceipts(tp: ReturnType<typeof tenantPool>) {
  const { rows } = await tp.query<{ id: string; last_error: string; user_id: string }>(
    `SELECT id, last_error, user_id FROM notification_jobs
      WHERE status='sent' AND last_error LIKE 'ticket:%' AND sent_at < DATE_SUB(NOW(), INTERVAL 2 MINUTE)
        AND sent_at > DATE_SUB(NOW(), INTERVAL 1 DAY) LIMIT 300`
  )
  if (!rows.length) return
  try {
    const ids = rows.map(r => r.last_error.slice(7)).filter(Boolean)
    const res = await fetch(EXPO_RECEIPTS, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids }) })
    const j = await res.json() as { data?: Record<string, { status: string; details?: { error?: string; expoPushToken?: string } }> }
    for (const r of rows) {
      const rec = j.data?.[r.last_error.slice(7)]
      if (!rec) continue
      if (rec.status === 'error' && rec.details?.error === 'DeviceNotRegistered' && rec.details.expoPushToken) {
        await tp.query(`DELETE FROM app_devices WHERE expo_push_token = ?`, [rec.details.expoPushToken])
      }
      await tp.query(`UPDATE notification_jobs SET last_error='receipt:${rec.status === 'ok' ? 'ok' : 'error'}' WHERE id=?`, [r.id])
    }
  } catch { /* try again next run */ }
}

export async function runNotificationWorkerAll() {
  const { rows } = await pool.query(
    `SELECT db_schema FROM companies WHERE app_key IS NOT NULL AND status IN ('active','trial')`
  )
  const out: Array<Record<string, unknown>> = []
  for (const r of rows as Array<{ db_schema: string }>) {
    try { out.push({ schema: r.db_schema, ...(await runNotificationWorker(r.db_schema)) }) }
    catch (e) { out.push({ schema: r.db_schema, error: e instanceof Error ? e.message : String(e) }) }
  }
  return out
}

export function notificationToDto(r: Record<string, unknown>) {
  const data = parseJson<{ url?: string | null }>(r.data, {})
  return {
    id: String(r.id), type: r.type, channel: r.channel, title: String(r.title), body: String(r.body),
    url: data.url ?? null, read: !!r.read_at, created_at: toIso(r.created_at) as string,
  }
}
