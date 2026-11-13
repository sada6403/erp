// Email queue core: enqueue (idempotent per event type + entity id) and the per-job decision logic
// (no email / suppressed / sent / retry with backoff / failed). Only `crypto` is imported so it is unit-tested
// without a database. DB glue (company profile, SMTP send, SQL updates) lives in emailService.ts.
//
// PRIVACY: email addresses are never stored in email_jobs or logged. We keep the user id and a sha256 hash only.
import { createHash, randomUUID } from 'crypto'
import type { EmailType, RenderedEmail } from './emailTemplates'
import type { DeliveryDecision, EmailEnv } from './emailPolicy'

export type QDb = { query: (sql: string, values?: unknown[]) => Promise<{ rows: unknown[] }> }

export const MAX_EMAIL_ATTEMPTS = 5
/** Minutes to wait after failed attempt 1, 2, 3, 4. The 5th failure is final. */
export const BACKOFF_MINUTES = [1, 5, 15, 60]

export const emailDedupeKey = (type: EmailType, entityId: string) => `${type}:${entityId}`
export const hashEmail = (email: string) => createHash('sha256').update(`email:${email.trim().toLowerCase()}`).digest('hex')

/** Strips anything that looks like an email address from an error text before it is stored. */
export function sanitizeError(err: unknown): string {
  const s = err instanceof Error ? err.message : String(err ?? '')
  return s.replace(/[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]').slice(0, 300)
}

/** Minutes until the next try after `attempts` failures so far, or null when out of attempts. */
export function backoffAfter(attempts: number): number | null {
  if (attempts >= MAX_EMAIL_ATTEMPTS) return null
  return BACKOFF_MINUTES[Math.min(attempts, BACKOFF_MINUTES.length) - 1] ?? BACKOFF_MINUTES[BACKOFF_MINUTES.length - 1]
}

export type EnqueueInput = { userId: string; type: EmailType; entityId: string; data?: Record<string, unknown> }
export type EnqueueResult = 'queued' | 'duplicate' | 'no_email'

/** One email per (event type, entity id). Returns 'no_email' when the user has no address. Never throws into callers' flows: wrap at the call site. */
export async function enqueueEmail(db: QDb, i: EnqueueInput): Promise<EnqueueResult> {
  const u = await db.query(`SELECT email, language FROM app_users WHERE id = ? AND deleted_at IS NULL LIMIT 1`, [i.userId])
  const row = u.rows[0] as { email?: string | null; language?: string | null } | undefined
  if (!row || !row.email || !String(row.email).includes('@')) return 'no_email'
  const lang = row.language === 'ta' || row.language === 'si' ? row.language : 'en'
  const ins = await db.query(
    `INSERT IGNORE INTO email_jobs (id, user_id, event_type, entity_id, dedupe_key, lang, payload)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [randomUUID(), i.userId, i.type, i.entityId, emailDedupeKey(i.type, i.entityId), lang, JSON.stringify(i.data ?? {})])
  return Number((ins.rows as unknown as { affectedRows?: number }).affectedRows ?? 1) === 0 ? 'duplicate' : 'queued'
}

export type EmailJob = { id: string; user_id: string; event_type: EmailType; entity_id: string; lang: string; payload: unknown; attempts: number }
export type EmailUser = { email: string | null; language?: string | null; name?: string | null } | null
export type SendResult = { ok: boolean; error?: string }

export interface ProcessDeps {
  getUser(userId: string): Promise<EmailUser>
  build(job: EmailJob, user: NonNullable<EmailUser>): Promise<RenderedEmail>
  send(msg: { to: string } & RenderedEmail): Promise<SendResult>
  env: EmailEnv
  decide(email: string, env: EmailEnv): DeliveryDecision
}

export type Outcome =
  | { status: 'skipped'; error: string; attempts: number }
  | { status: 'suppressed'; toHash: string; attempts: number }
  | { status: 'sent'; toHash: string; attempts: number }
  | { status: 'retry'; toHash: string | null; error: string; attempts: number; backoffMin: number }
  | { status: 'failed'; toHash: string | null; error: string; attempts: number }

/** Decides what happens to one queued job. Pure apart from the injected deps. */
export async function processJob(job: EmailJob, deps: ProcessDeps): Promise<Outcome> {
  const user = await deps.getUser(job.user_id)
  if (!user || !user.email) return { status: 'skipped', error: 'no email address', attempts: job.attempts }
  const toHash = hashEmail(user.email)
  // Safety first: the recipient is checked BEFORE anything is rendered or handed to the mail transport.
  if (deps.decide(user.email, deps.env).action === 'suppress') return { status: 'suppressed', toHash, attempts: job.attempts }
  const attempts = job.attempts + 1
  let res: SendResult
  try {
    const msg = await deps.build(job, user)
    res = await deps.send({ to: user.email, ...msg })
  } catch (e) {
    res = { ok: false, error: sanitizeError(e) }
  }
  if (res.ok) return { status: 'sent', toHash, attempts }
  const error = sanitizeError(res.error ?? 'send failed')
  const wait = backoffAfter(attempts)
  return wait == null ? { status: 'failed', toHash, error, attempts } : { status: 'retry', toHash, error, attempts, backoffMin: wait }
}
