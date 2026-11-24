// STAGING smoke test for transactional email. Sends ONE of each email type through the real queue + SMTP path to
// the address in SMOKE_TO (must be on EMAIL_ALLOWLIST), plus one email to a dummy address that is NOT allow-listed
// to prove it is suppressed. Prints statuses only (never an email address or a secret).
//   node --env-file=.env scripts/run-ts.cjs scripts/email-smoke.ts <db_schema>      (SMOKE_TO=<address> in the environment)
// Refuses to run when EMAIL_MODE=production.
import { randomUUID } from 'crypto'
import { tenantPool } from '../lib/db'
import { ensureTenantCompatibility } from '../lib/auth'
import { enqueueEmail } from '../lib/app/emailQueue'
import { runEmailWorker } from '../lib/app/emailService'
import { EMAIL_TYPES, type EmailType } from '../lib/app/emailTemplates'

async function main() {
  const schema = process.argv[2]
  const to = process.env.SMOKE_TO || ''
  if (!schema || !to.includes('@')) throw new Error('usage: <db_schema> with SMOKE_TO set')
  if ((process.env.EMAIL_MODE || '').toLowerCase() === 'production') throw new Error('refusing to run the smoke test in production mode')
  if (!(process.env.EMAIL_ALLOWLIST || '').toLowerCase().split(',').map(s => s.trim()).includes(to.toLowerCase())) throw new Error('SMOKE_TO is not on EMAIL_ALLOWLIST')
  await ensureTenantCompatibility(schema)
  const tp = tenantPool(schema)
  const run = Date.now().toString(36)
  const mk = async (tag: string, email: string, lang: string) => {
    const id = randomUUID()
    await tp.query(
      `INSERT INTO app_users (id, phone, name, password_hash, must_change_password, email, phone_verified, roles, status, language, created_by_source)
       VALUES (?, ?, ?, 'x', 0, ?, 0, '["customer"]', 'active', ?, 'self')`,
      [id, `99${Math.floor(Math.random() * 1e8).toString().padStart(8, '0')}`, `Email Test ${tag}`, email, lang])
    return id
  }
  const users: string[] = []
  const langs = ['en', 'ta', 'si']
  const data: Record<string, Record<string, unknown>> = {
    welcome: {}, verify_email: { code: '482913' }, password_reset: { code: '716204' },
    order_placed: { order: 'TEST-1042', total: 3000.5, delivery_fee: 250, items: [{ name: 'Virgin coconut oil 1L', qty: 2, total: 1800 }, { name: 'Ceylon tea 500g', qty: 1, total: 950.5 }] },
    order_confirmed: { order: 'TEST-1042' }, order_dispatched: { order: 'TEST-1042' }, order_delivered: { order: 'TEST-1042' }, order_cancelled: { order: 'TEST-1042' },
    slip_verified: { order: 'TEST-1042' }, slip_rejected: { order: 'TEST-1042', reason: 'The slip image is not readable' },
    join_received: { scheme: 'Gold Saver 12' }, join_approved: { scheme: 'Gold Saver 12' }, join_rejected: { scheme: 'Gold Saver 12', reason: 'Incomplete details' },
    cash_receipt: { scheme: 'Gold Saver 12', amount: 2500, receipt: 'R-0007' },
  }
  const keys: string[] = []
  try {
    for (let i = 0; i < EMAIL_TYPES.length; i++) {
      const type = EMAIL_TYPES[i] as EmailType
      const uid = await mk(type, to, langs[i % 3]); users.push(uid)
      const entityId = `smoke-${run}-${type}`
      const r = await enqueueEmail(tp, { userId: uid, type, entityId, data: data[type] })
      keys.push(`${type}:${entityId}`)
      console.log(`enqueue ${type} (${langs[i % 3]}): ${r}`)
    }
    // idempotency proof: the same event again must be a duplicate
    console.log('re-enqueue welcome:', await enqueueEmail(tp, { userId: users[0], type: 'welcome', entityId: `smoke-${run}-welcome` }))
    // dummy, NOT allow-listed
    const dummy = await mk('dummy', `not-on-allowlist-${run}@example.invalid`, 'en'); users.push(dummy)
    await enqueueEmail(tp, { userId: dummy, type: 'welcome', entityId: `smoke-${run}-dummy` }); keys.push(`welcome:smoke-${run}-dummy`)
    console.log('worker:', JSON.stringify(await runEmailWorker(schema)))
    const { rows } = await tp.query<{ dedupe_key: string; status: string; attempts: number; last_error: string | null }>(
      `SELECT dedupe_key, status, attempts, last_error FROM email_jobs WHERE dedupe_key IN (${keys.map(() => '?').join(',')}) ORDER BY created_at`, keys)
    for (const r of rows) console.log(`status ${r.dedupe_key.replace(`smoke-${run}-`, '')}: ${r.status} attempts=${r.attempts}${r.last_error ? ` note=${String(r.last_error).slice(0, 80)}` : ''}`)
  } finally {
    // The temporary users go away; the email_jobs status rows (user id + hash, no address) stay as the log.
    if (users.length) await tp.query(`DELETE FROM app_users WHERE id IN (${users.map(() => '?').join(',')})`, users)
  }
}
main().then(() => process.exit(0)).catch(e => { console.error('SMOKE FAILED:', e instanceof Error ? e.message.replace(/[\w.+-]+@[\w.-]+/g, '[email]') : 'error'); process.exit(1) })
