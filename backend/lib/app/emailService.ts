// Email service: DB + SMTP glue around emailQueue.ts. Mail goes out through the company's own SMTP settings
// (sendCompanyEmail, the same connection the app already uses for verification codes).
// Recipients are filtered by emailPolicy.ts (EMAIL_MODE / EMAIL_ALLOWLIST) before anything is sent.
import { pool, tenantPool } from '../db'
import { ensureTenantCompatibility } from '../auth'
import { sendCompanyEmail } from '../email'
import { loadCompanyProfile } from '../companyProfile'
import { decideDelivery } from './emailPolicy'
import { renderEmail, type EmailData, type EmailCompany, type EmailType } from './emailTemplates'
import { enqueueEmail, processJob, sanitizeError, type EmailJob, type EnqueueInput, type QDb } from './emailQueue'
import { parseJson } from './http'

type TP = ReturnType<typeof tenantPool>

export async function emailCompanyInfo(companyId: string): Promise<EmailCompany> {
  const base = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '')
  const p = await loadCompanyProfile(companyId, base)
  const logo = p?.logo_url ?? null
  return {
    name: p?.name || 'Natural Plantation',
    logo_url: logo && logo.startsWith('/') && base ? `${base}${logo}` : logo,
    address: p?.address ?? null, phone: p?.support_phone ?? p?.phone ?? null, email: p?.support_email ?? p?.email ?? null, website: p?.website ?? null,
  }
}

/** Builds the template data for a queued job. Order details are read at send time so they are always current. */
export async function emailDataFor(tp: QDb, job: Pick<EmailJob, 'event_type' | 'entity_id' | 'payload'>, userName: string | null): Promise<EmailData> {
  const p = parseJson<Record<string, unknown>>(job.payload, {})
  const data: EmailData = {
    name: userName ?? undefined,
    order: p.order ? String(p.order) : undefined, reason: p.reason ? String(p.reason) : undefined,
    code: p.code ? String(p.code) : undefined, scheme: p.scheme ? String(p.scheme) : undefined,
    receipt: p.receipt ? String(p.receipt) : undefined, amount: p.amount != null ? Number(p.amount) : undefined,
  }
  // Test / preview jobs may carry their own order summary; real jobs read the order at send time.
  if (Array.isArray(p.items)) {
    data.items = (p.items as Array<Record<string, unknown>>).map(r => ({ name: String(r.name), qty: Number(r.qty) || 0, total: Number(r.total) || 0 }))
    data.total = p.total != null ? Number(p.total) : undefined
    data.delivery_fee = p.delivery_fee != null ? Number(p.delivery_fee) : undefined
  } else if (job.event_type.startsWith('order_')) {
    const o = (await tp.query(`SELECT order_number, total_amount, delivery_fee FROM customer_orders WHERE id = ? LIMIT 1`, [job.entity_id])).rows[0] as Record<string, unknown> | undefined
    if (o) {
      data.order = String(o.order_number)
      data.total = Number(o.total_amount) || 0
      data.delivery_fee = Number(o.delivery_fee) || 0
      if (job.event_type === 'order_placed') {
        const it = await tp.query(
          `SELECT COALESCE(i.product_name, p.name, 'Item') AS name, i.quantity, i.line_total
             FROM customer_order_items i LEFT JOIN products p ON p.id = i.product_id WHERE i.order_id = ? ORDER BY i.created_at LIMIT 60`, [job.entity_id])
        data.items = (it.rows as Array<Record<string, unknown>>).map(r => ({ name: String(r.name), qty: Number(r.quantity) || 0, total: Number(r.line_total) || 0 }))
      }
    }
  }
  return data
}

let schemaReady = new Set<string>()

/** Process due email jobs for one tenant. Safe to run concurrently with another worker (jobs are claimed first). */
export async function runEmailWorker(dbSchema: string): Promise<{ processed: number; sent: number; suppressed: number; failed: number; pending: number }> {
  if (!schemaReady.has(dbSchema)) { await ensureTenantCompatibility(dbSchema); schemaReady.add(dbSchema) }
  const tp: TP = tenantPool(dbSchema)
  const c = await pool.query(`SELECT id FROM companies WHERE db_schema = ? LIMIT 1`, [dbSchema])
  const companyId = (c.rows[0] as { id?: string } | undefined)?.id
  const out = { processed: 0, sent: 0, suppressed: 0, failed: 0, pending: 0 }
  if (!companyId) return out
  const { rows } = await tp.query<EmailJob>(
    `SELECT id, user_id, event_type, entity_id, lang, payload, attempts FROM email_jobs
      WHERE (status = 'pending' AND next_attempt_at <= NOW())
         OR (status = 'sending' AND updated_at < DATE_SUB(NOW(), INTERVAL 10 MINUTE))
      ORDER BY created_at LIMIT 50`)
  let company: EmailCompany | null = null
  for (const job of rows) {
    const claim = await tp.query(`UPDATE email_jobs SET status = 'sending' WHERE id = ? AND (status = 'pending' OR status = 'sending')`, [job.id])
    if (Number((claim.rows as unknown as { affectedRows?: number }).affectedRows ?? 1) === 0) continue
    out.processed++
    const o = await processJob(job, {
      env: { EMAIL_MODE: process.env.EMAIL_MODE, EMAIL_ALLOWLIST: process.env.EMAIL_ALLOWLIST },
      decide: decideDelivery,
      getUser: async (id) => {
        const r = await tp.query(`SELECT email, language, name FROM app_users WHERE id = ? AND deleted_at IS NULL LIMIT 1`, [id])
        return (r.rows[0] as { email: string | null; language: string | null; name: string | null } | undefined) ?? null
      },
      build: async (j, user) => {
        company ??= await emailCompanyInfo(companyId)
        return renderEmail(j.event_type as EmailType, j.lang || user.language, company, await emailDataFor(tp, j, user.name ?? null))
      },
      send: (m) => sendCompanyEmail(companyId, { to: m.to, subject: m.subject, html: m.html, text: m.text }),
    })
    // Verification / reset codes are secrets: wipe the payload as soon as the job is final.
    const scrub = o.status === 'sent' || o.status === 'suppressed' || o.status === 'failed' || o.status === 'skipped' ? `, payload = '{}'` : ''
    const toHash = 'toHash' in o ? o.toHash : null
    if (o.status === 'sent') {
      out.sent++
      await tp.query(`UPDATE email_jobs SET status='sent', attempts=?, to_hash=?, last_error=NULL, sent_at=NOW()${scrub} WHERE id=?`, [o.attempts, toHash, job.id])
    } else if (o.status === 'suppressed') {
      out.suppressed++
      await tp.query(`UPDATE email_jobs SET status='suppressed', to_hash=?, last_error='not on allow-list (non-production mode)'${scrub} WHERE id=?`, [toHash, job.id])
    } else if (o.status === 'skipped') {
      await tp.query(`UPDATE email_jobs SET status='skipped', last_error=?${scrub} WHERE id=?`, [o.error, job.id])
    } else if (o.status === 'retry') {
      await tp.query(`UPDATE email_jobs SET status='pending', attempts=?, to_hash=?, last_error=?, next_attempt_at=DATE_ADD(NOW(), INTERVAL ? MINUTE) WHERE id=?`, [o.attempts, toHash, o.error, o.backoffMin, job.id])
    } else {
      out.failed++
      await tp.query(`UPDATE email_jobs SET status='failed', attempts=?, to_hash=?, last_error=?${scrub} WHERE id=?`, [o.attempts, toHash, o.error, job.id])
    }
  }
  const left = await tp.query(`SELECT COUNT(*) AS n FROM email_jobs WHERE status IN ('pending','sending')`)
  out.pending = Number((left.rows[0] as { n?: number } | undefined)?.n) || 0
  return out
}

/** All active app companies (what the cron route does). Returns how many jobs are still waiting. */
export async function runEmailWorkerAll(): Promise<number> {
  const { rows } = await pool.query(`SELECT db_schema FROM companies WHERE app_key IS NOT NULL AND status IN ('active','trial')`)
  let pending = 0
  for (const r of rows as Array<{ db_schema: string }>) {
    try { pending += (await runEmailWorker(r.db_schema)).pending } catch (e) { console.error('[email] worker failed', sanitizeError(e)) }
  }
  return pending
}

// No scheduler is needed for email: enqueueing arms a background drain (first pass ~3 s later, a second pass 30 s later to
// catch rows committed after the first, then every minute while jobs are waiting for a retry). The cron route also drains.
let drainTimer: ReturnType<typeof setTimeout> | null = null
export function scheduleEmailDrain(delayMs = 3000, pass = 0): void {
  if (drainTimer) return
  drainTimer = setTimeout(async () => {
    drainTimer = null
    let pending = 0
    try { pending = await runEmailWorkerAll() } catch (e) { console.error('[email] drain failed', sanitizeError(e)) }
    if (pass === 0) scheduleEmailDrain(30000, 1)
    else if (pending > 0) scheduleEmailDrain(60000, 1)
  }, delayMs)
  drainTimer.unref?.()
}

/** Fire-and-forget enqueue used by the notification hooks: an email problem must never break the user-facing flow. */
export async function queueEmail(db: QDb, i: EnqueueInput): Promise<void> {
  try { if ((await enqueueEmail(db, i)) === 'queued') scheduleEmailDrain() } catch (e) { console.error('[email] enqueue failed', i.type, sanitizeError(e)) }
}

/** Enqueue and deliver right away (verification / reset codes, welcome). Returns the final job status. */
export async function sendEmailNow(dbSchema: string, db: QDb, i: EnqueueInput): Promise<{ status: 'sent' | 'suppressed' | 'queued' | 'failed' | 'no_email'; smtpConfigured: boolean }> {
  try {
    const r = await enqueueEmail(db, i)
    if (r === 'no_email') return { status: 'no_email', smtpConfigured: true }
    await runEmailWorker(dbSchema)
    const s = await db.query(`SELECT status, last_error FROM email_jobs WHERE dedupe_key = ? LIMIT 1`, [`${i.type}:${i.entityId}`])
    const row = s.rows[0] as { status?: string; last_error?: string } | undefined
    const st = String(row?.status ?? 'queued')
    return { status: st === 'sent' || st === 'suppressed' || st === 'failed' ? st : 'queued', smtpConfigured: !/not configured/i.test(String(row?.last_error ?? '')) }
  } catch (e) {
    console.error('[email] send-now failed', i.type, sanitizeError(e))
    return { status: 'failed', smtpConfigured: true }
  }
}
