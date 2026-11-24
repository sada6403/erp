// Unit tests for transactional email: allow-list policy, templates, idempotency, suppression, retry/backoff.
// No database, no network:  node --experimental-strip-types --test tests/email.test.mjs   (or `npm run test:email`)
import test from 'node:test'
import assert from 'node:assert/strict'
import { decideDelivery, resolveEmailMode, parseAllowlist } from '../lib/app/emailPolicy.ts'
import { renderEmail, EMAIL_TYPES, BRAND_COLOR } from '../lib/app/emailTemplates.ts'
import { enqueueEmail, processJob, backoffAfter, sanitizeError, emailDedupeKey, hashEmail, MAX_EMAIL_ATTEMPTS } from '../lib/app/emailQueue.ts'

const COMPANY = { name: 'Acme Plantation', logo_url: 'https://example.com/logo.png', address: '12 Palm Road, Colombo', phone: '0112223344', email: 'help@acme.test' }
const DATA = {
  name: 'Kamal', order: 'ORD-1001', reason: 'Blurry image', code: '482913', scheme: 'Gold Saver', receipt: 'R-0007', amount: 2500,
  items: [{ name: 'Coconut oil 1L', qty: 2, total: 1800 }, { name: 'Tea 500g', qty: 1, total: 950.5 }], delivery_fee: 250, total: 3000.5,
}

// ── allow-list policy ────────────────────────────────────────────────
test('non-production suppresses addresses that are not on the allow-list', () => {
  const env = { EMAIL_MODE: 'staging', EMAIL_ALLOWLIST: 'a@x.com, b@x.com' }
  const d = decideDelivery('customer@real.com', env)
  assert.equal(d.action, 'suppress'); assert.equal(d.reason, 'not_allow_listed')
})
test('non-production sends to allow-listed addresses (trimmed, case-insensitive)', () => {
  const env = { EMAIL_MODE: 'staging', EMAIL_ALLOWLIST: ' a@x.com , Moni@Example.com ' }
  assert.equal(decideDelivery('moni@example.com', env).action, 'send')
  assert.equal(decideDelivery('A@X.COM', env).action, 'send')
})
test('production sends to everyone and ignores the allow-list', () => {
  assert.equal(decideDelivery('anyone@real.com', { EMAIL_MODE: 'production', EMAIL_ALLOWLIST: 'a@x.com' }).action, 'send')
  assert.equal(decideDelivery('anyone@real.com', { EMAIL_MODE: ' Production ' }).action, 'send')
})
test('unknown or missing mode is treated as non-production (suppresses)', () => {
  for (const mode of [undefined, '', 'prod', 'live', 'true', '1']) {
    assert.equal(resolveEmailMode({ EMAIL_MODE: mode }), 'restricted')
    assert.equal(decideDelivery('anyone@real.com', { EMAIL_MODE: mode }).action, 'suppress')
  }
})
test('empty allow-list in non-production suppresses everything', () => {
  assert.equal(decideDelivery('a@x.com', { EMAIL_MODE: 'staging', EMAIL_ALLOWLIST: '' }).action, 'suppress')
  assert.equal(parseAllowlist(undefined).size, 0)
})

// ── templates ────────────────────────────────────────────────────────
for (const lang of ['en', 'ta', 'si']) {
  for (const type of EMAIL_TYPES) {
    test(`template ${type} / ${lang}: non-empty, company name, no raw placeholders`, () => {
      const r = renderEmail(type, lang, COMPANY, DATA)
      for (const part of ['subject', 'html', 'text']) {
        assert.ok(r[part].trim().length > 10, `${part} empty`)
        assert.ok(!/\{\{|\}\}/.test(r[part]), `${part} has raw placeholder`)
        assert.ok(!r[part].includes('undefined'), `${part} contains "undefined"`)
      }
      assert.ok(r.html.includes(COMPANY.name) && r.text.includes(COMPANY.name), 'company name missing')
      assert.ok(r.html.includes(COMPANY.address) && r.html.includes(BRAND_COLOR))
      assert.ok(r.html.includes('viewport'))
    })
  }
}
test('templates: type-specific content', () => {
  const placed = renderEmail('order_placed', 'en', COMPANY, DATA)
  assert.ok(placed.html.includes('Coconut oil 1L') && placed.text.includes('Rs 3,000.50'))
  assert.ok(renderEmail('verify_email', 'si', COMPANY, DATA).html.includes('482913'))
  assert.ok(renderEmail('slip_rejected', 'ta', COMPANY, DATA).text.includes('Blurry image'))
  assert.ok(renderEmail('join_approved', 'en', COMPANY, DATA).text.includes('Smart Buy'))
  assert.ok(renderEmail('cash_receipt', 'en', COMPANY, DATA).text.includes('Rs 2,500.00'))
  assert.ok(renderEmail('welcome', 'xx', COMPANY, DATA).subject.startsWith('Welcome'), 'unknown language falls back to en')
})
test('templates: user supplied text is HTML-escaped, bad logo urls ignored', () => {
  const r = renderEmail('slip_rejected', 'en', { ...COMPANY, logo_url: 'javascript:alert(1)' }, { ...DATA, reason: '<script>x</script>' })
  assert.ok(!r.html.includes('<script>x') && r.html.includes('&lt;script&gt;'))
  assert.ok(!r.html.includes('javascript:'))
})

// ── fake db for the queue ────────────────────────────────────────────
function fakeDb(users) {
  const jobs = new Map()
  const log = []
  return {
    jobs, log,
    async query(sql, v = []) {
      log.push(JSON.stringify([sql, v]))
      if (/FROM app_users/.test(sql)) return { rows: users[v[0]] ? [users[v[0]]] : [] }
      if (/INSERT IGNORE INTO email_jobs/.test(sql)) {
        const key = v[4]
        if (jobs.has(key)) return { rows: { affectedRows: 0 } }
        jobs.set(key, { id: v[0], user_id: v[1], event_type: v[2], entity_id: v[3], lang: v[5], payload: v[6] })
        return { rows: { affectedRows: 1 } }
      }
      return { rows: [] }
    },
  }
}

test('idempotency: same (event type, entity id) is enqueued once', async () => {
  const db = fakeDb({ u1: { email: 'kamal@real.com', language: 'ta' } })
  assert.equal(await enqueueEmail(db, { userId: 'u1', type: 'order_confirmed', entityId: 'o1' }), 'queued')
  assert.equal(await enqueueEmail(db, { userId: 'u1', type: 'order_confirmed', entityId: 'o1' }), 'duplicate')
  assert.equal(await enqueueEmail(db, { userId: 'u1', type: 'order_dispatched', entityId: 'o1' }), 'queued')
  assert.equal(await enqueueEmail(db, { userId: 'u1', type: 'order_confirmed', entityId: 'o2' }), 'queued')
  assert.equal(db.jobs.size, 3)
  assert.equal(db.jobs.get('order_confirmed:o1').lang, 'ta')
  assert.equal(emailDedupeKey('order_confirmed', 'o1'), 'order_confirmed:o1')
})
test('no email address: nothing is queued', async () => {
  const db = fakeDb({ u1: { email: null }, u2: { email: '' } })
  assert.equal(await enqueueEmail(db, { userId: 'u1', type: 'welcome', entityId: 'u1' }), 'no_email')
  assert.equal(await enqueueEmail(db, { userId: 'u2', type: 'welcome', entityId: 'u2' }), 'no_email')
  assert.equal(await enqueueEmail(db, { userId: 'gone', type: 'welcome', entityId: 'x' }), 'no_email')
  assert.equal(db.jobs.size, 0)
})
test('privacy: the queue never writes the email address', async () => {
  const db = fakeDb({ u1: { email: 'secret.person@real.com', language: 'en' } })
  await enqueueEmail(db, { userId: 'u1', type: 'welcome', entityId: 'u1' })
  assert.ok(!db.log.some(l => l.includes('secret.person@real.com') && /INSERT/.test(l)))
})

// ── processing: suppression, send, retry/backoff ─────────────────────
const job = (attempts = 0) => ({ id: 'j1', user_id: 'u1', event_type: 'welcome', entity_id: 'u1', lang: 'en', payload: '{}', attempts })
function deps({ email = 'moni@example.com', env, sendResult = { ok: true } } = {}) {
  const sent = []
  return {
    sent,
    d: {
      env: env ?? { EMAIL_MODE: 'staging', EMAIL_ALLOWLIST: 'moni@example.com' },
      decide: decideDelivery,
      getUser: async () => (email === undefined ? null : { email, language: 'en', name: 'Kamal' }),
      build: async () => ({ subject: 's', html: '<p>h</p>', text: 't' }),
      send: async (m) => { sent.push(m.to); return sendResult },
    },
  }
}

test('suppression: non-listed address is never sent, status suppressed, only a hash is kept', async () => {
  const { d, sent } = deps({ email: 'customer@real.com' })
  const o = await processJob(job(), d)
  assert.equal(o.status, 'suppressed'); assert.equal(sent.length, 0)
  assert.equal(o.toHash, hashEmail('customer@real.com')); assert.match(o.toHash, /^[0-9a-f]{64}$/)
  assert.ok(!JSON.stringify(o).includes('customer@real.com'))
})
test('allow-listed address is sent in non-production', async () => {
  const { d, sent } = deps()
  const o = await processJob(job(), d)
  assert.equal(o.status, 'sent'); assert.deepEqual(sent, ['moni@example.com'])
})
test('production sends to any address', async () => {
  const { d, sent } = deps({ email: 'customer@real.com', env: { EMAIL_MODE: 'production' } })
  assert.equal((await processJob(job(), d)).status, 'sent'); assert.equal(sent.length, 1)
})
test('user without email is skipped', async () => {
  const { d, sent } = deps({ email: null })
  assert.equal((await processJob(job(), d)).status, 'skipped'); assert.equal(sent.length, 0)
})
test('retry: failure schedules a backoff, then fails for good after the last attempt', async () => {
  const { d } = deps({ sendResult: { ok: false, error: 'connect ETIMEDOUT' } })
  let attempts = 0, waits = []
  for (let i = 0; i < MAX_EMAIL_ATTEMPTS; i++) {
    const o = await processJob(job(attempts), d)
    attempts = o.attempts
    if (o.status === 'retry') waits.push(o.backoffMin)
    else { assert.equal(o.status, 'failed'); assert.equal(i, MAX_EMAIL_ATTEMPTS - 1) }
  }
  assert.deepEqual(waits, [1, 5, 15, 60])
  assert.equal(attempts, MAX_EMAIL_ATTEMPTS)
})
test('retry: a later success after a failure is reported sent', async () => {
  const { d } = deps()
  assert.equal((await processJob(job(2), d)).status, 'sent')
})
test('a throwing renderer/transport is a retryable failure, not a crash', async () => {
  const { d } = deps()
  d.build = async () => { throw new Error('boom') }
  assert.equal((await processJob(job(), d)).status, 'retry')
})
test('backoff table and error sanitising', () => {
  assert.equal(backoffAfter(1), 1); assert.equal(backoffAfter(4), 60); assert.equal(backoffAfter(5), null)
  const clean = sanitizeError(new Error('550 Recipient <kamal@real.com> rejected for bob+x@mail.co.uk'))
  assert.ok(!/@real|@mail/.test(clean) && clean.includes('[email]'))
})
