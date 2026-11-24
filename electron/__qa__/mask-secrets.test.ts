import { describe, it, expect } from 'vitest'
// @ts-ignore plain ESM helper without type declarations
import { maskSecrets, MASK } from '../../scripts/mask-secrets.mjs'

// All values below are obviously fake test strings, never real secrets.
const FAKE = 'Zx9fakeValue'
const LONG_HEX = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678'
const LONG_B64 = 'Qk9HVVNfVE9LRU5fRk9SX1RFU1RfT05MWV8xMjM0NTY3ODk'

function expectMasked(input: string, keep: string[] = [], secrets: string[] = [FAKE]) {
  const out = maskSecrets(input)
  for (const s of secrets) expect(out).not.toContain(s)
  expect(out).toContain(MASK)
  for (const k of keep) expect(out).toContain(k)
  return out
}

describe('mask-secrets', () => {
  it('KEY=value keeps the key', () => {
    const out = expectMasked(`JWT_SECRET=${FAKE}\nPORT=4001`, ['JWT_SECRET='])
    expect(out).toContain('PORT=4001')
  })
  it('quoted and export forms', () => {
    expectMasked(`export MYSQL_PASSWORD="${FAKE}"`, ['MYSQL_PASSWORD'])
    expectMasked(`SMTP_PASS='${FAKE}'`, ['SMTP_PASS'])
  })
  it('KEY: value (yaml / env listing)', () => {
    expectMasked(`  api_key: ${FAKE}`, ['api_key'])
    expectMasked(`PASSWORD: ${FAKE}`, ['PASSWORD'])
  })
  it('--flag value and --flag=value', () => {
    expectMasked(`node run.js --password ${FAKE} --port 3000`, ['--password', '--port 3000'])
    expectMasked(`node run.js --api-key=${FAKE}`, ['--api-key'])
  })
  it('header with a secret-ish name: x-cron-secret (the 13 Nov crontab leak)', () => {
    const line = `0 2 * * * curl -s -X POST -H "x-cron-secret: ${FAKE}" http://127.0.0.1:4001/api/superadmin/cron/run-scheduled-backups >> /var/log/pos-scheduled-backups.log 2>&1`
    const out = expectMasked(line, ['x-cron-secret', '/api/superadmin/cron/run-scheduled-backups', '/var/log/pos-scheduled-backups.log'])
    expect(out).toContain(`"x-cron-secret: ${MASK}"`)
  })
  it('header with single quotes and curl --header', () => {
    expectMasked(`curl -H 'X-Api-Key: ${FAKE}' https://example.test`, ['X-Api-Key'])
    expectMasked(`curl --header "x-admin-token: ${FAKE}" https://example.test`, ['x-admin-token'])
  })
  it('Authorization: Bearer', () => {
    const out = expectMasked(`curl -H "Authorization: Bearer ${FAKE}" https://example.test`, ['Authorization: Bearer'])
    expect(out).toContain(`Bearer ${MASK}`)
  })
  it('URL userinfo user:pass@host', () => {
    const out = expectMasked(`mysql://appuser:${FAKE}@127.0.0.1:3306/db`, ['appuser', '@127.0.0.1:3306/db'])
    expect(out).not.toContain(`:${FAKE}`)
  })
  it('DATABASE_URL is masked as a whole', () => {
    expectMasked(`DATABASE_URL=postgres://u:${FAKE}@db.example.test/x`, ['DATABASE_URL='], [FAKE])
  })
  it('JSON "key":"value" (pm2 jlist, docker inspect)', () => {
    const out = expectMasked(`{"name":"pos-backend","JWT_SECRET":"${FAKE}","api_token": "${FAKE}x"}`, ['"JWT_SECRET"', '"api_token"'], [FAKE])
    expect(out).toContain('"name":"pos-backend"')
  })
  it('systemd Environment= and docker -e', () => {
    expectMasked(`Environment="CRON_SECRET=${FAKE}"`, ['CRON_SECRET'])
    expectMasked(`docker run -e DB_PASSWORD=${FAKE} img`, ['DB_PASSWORD'])
  })
  it('cookie headers mask the whole line value', () => {
    expectMasked(`Cookie: sid=${FAKE}; other=${FAKE}`, ['Cookie'])
  })
  it('long hex and base64 tokens in any context', () => {
    const a = expectMasked(`random line with ${LONG_HEX} inside`, ['random line with'], [LONG_HEX])
    expect(a).toContain('inside')
    expectMasked(`value ${LONG_B64} here`, ['here'], [LONG_B64])
  })
  it('does not mask ordinary text, short ids, uuids or paths', () => {
    const t = 'pm2 list: pos-backend online 3 restarts /var/www/pos-staging-private/files 4a3aa43a-5942-49bf-9578-181e9e0d3d13'
    expect(maskSecrets(t)).toBe(t)
  })
  it('is idempotent', () => {
    const once = maskSecrets(`JWT_SECRET=${FAKE}\nx-cron-secret: ${FAKE}`)
    expect(maskSecrets(once)).toBe(once)
  })
})
