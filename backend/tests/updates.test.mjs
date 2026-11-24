// In-app update tests. Part 1 (comparator, allow-list) is pure. Part 2 is black-box against a LOCAL dev server + seeded tenant
// (same harness as app-api.test.mjs; run through `npm test`). Part 2 is skipped when no seed file exists.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { compareVersions, isValidVersion, allowedUpdateHosts, safeUpdateUrl, evaluate, parseNotes } from '../lib/app/versionCore.ts'

// ── comparator ──────────────────────────────────────────────────────────
test('compareVersions: test prerelease numbers compare numerically, release beats prerelease', () => {
  const asc = ['1.0.0-test.1', '1.0.0-test.5', '1.0.0-test.6', '1.0.0-test.9', '1.0.0-test.10', '1.0.0', '1.0.1-test.1', '1.0.1', '1.2.0', '2.0.0']
  for (let i = 0; i < asc.length - 1; i++) {
    assert.equal(compareVersions(asc[i], asc[i + 1]), -1, `${asc[i]} < ${asc[i + 1]}`)
    assert.equal(compareVersions(asc[i + 1], asc[i]), 1)
  }
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0)
  assert.equal(compareVersions('1.0.0-test.5', '1.0.0-test.5'), 0)
  assert.equal(compareVersions('1.10.0', '1.9.9'), 1)
})
test('isValidVersion rejects junk', () => {
  for (const ok of ['1.0.0', '1.0.0-test.5', '0.0.1']) assert.equal(isValidVersion(ok), true, ok)
  for (const bad of ['1.0', 'v1.0.0', '1.0.0-', '1.0.0-test..5', '', 'abc', '1.0.0; drop', null, 5]) assert.equal(isValidVersion(bad), false, String(bad))
  assert.throws(() => compareVersions('x', '1.0.0'))
})
test('evaluate: below min = required, below latest = available', () => {
  const p = { latest_version: '1.0.0-test.6', min_version: '1.0.0-test.5' }
  assert.deepEqual(evaluate('1.0.0-test.4', p), { update_required: true, update_available: true })
  assert.deepEqual(evaluate('1.0.0-test.5', p), { update_required: false, update_available: true })
  assert.deepEqual(evaluate('1.0.0-test.6', p), { update_required: false, update_available: false })
  assert.deepEqual(evaluate('1.0.0', p), { update_required: false, update_available: false })
})

// ── allow-list ──────────────────────────────────────────────────────────
test('allowedUpdateHosts: PUBLIC_BASE_URL host + APP_UPDATE_HOSTS', () => {
  assert.deepEqual(allowedUpdateHosts({ PUBLIC_BASE_URL: 'https://api.example.com/' }), ['api.example.com'])
  assert.deepEqual(allowedUpdateHosts({ PUBLIC_BASE_URL: 'https://a.test', APP_UPDATE_HOSTS: ' B.test , ,c.test:8443' }).sort(), ['a.test', 'b.test', 'c.test:8443'])
  assert.deepEqual(allowedUpdateHosts({}), [])
})
test('safeUpdateUrl: https + allow-listed host only', () => {
  const hosts = ['api.example.com']
  assert.ok(safeUpdateUrl('https://api.example.com/apk/app.apk', hosts))
  assert.equal(safeUpdateUrl('http://api.example.com/apk/app.apk', hosts), null)
  assert.equal(safeUpdateUrl('https://evil.example.org/app.apk', hosts), null)
  assert.equal(safeUpdateUrl('https://api.example.com.evil.org/app.apk', hosts), null)
  assert.equal(safeUpdateUrl('https://user:pw@api.example.com/app.apk', hosts), null)
  assert.equal(safeUpdateUrl('https://api.example.com@evil.org/app.apk', hosts), null)
  assert.equal(safeUpdateUrl('javascript:alert(1)', hosts), null)
  assert.equal(safeUpdateUrl('', hosts), null)
  assert.equal(safeUpdateUrl(undefined, hosts), null)
})
test('parseNotes tolerates junk', () => {
  assert.deepEqual(parseNotes('not json'), { en: '', ta: '', si: '' })
  assert.deepEqual(parseNotes('{"en":"x","ta":5}'), { en: 'x', ta: '', si: '' })
})

// ── black-box ───────────────────────────────────────────────────────────
const seedFile = process.env.SEED_FILE || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.seed-output.json')
const HAVE_SEED = existsSync(seedFile)
const seed = HAVE_SEED ? JSON.parse(readFileSync(seedFile, 'utf8')) : null
const V1 = `${process.env.TEST_BASE_URL || seed?.base_url}/api/app/v1`
const ip = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${1 + Math.floor(Math.random() * 250)}`
async function status(qs = '', key = seed?.app_key) {
  const res = await fetch(`${V1}/status${qs}`, { headers: { 'x-forwarded-for': ip(), ...(key ? { 'x-app-key': key } : {}) } })
  return { status: res.status, json: await res.json().catch(() => null) }
}
async function admin(method, p, body, key = seed?.pos_api_key) {
  const res = await fetch(`${V1}/admin/app-versions${p}`, {
    method, headers: { 'x-forwarded-for': ip(), 'content-type': 'application/json', ...(key ? { 'x-api-key': key } : {}) }, body: body ? JSON.stringify(body) : undefined,
  })
  return { status: res.status, json: await res.json().catch(() => null) }
}
const it = HAVE_SEED ? test : test.skip

it('status: legacy fields still answer with no row; new fields have safe defaults', async () => {
  const r = await status()
  assert.equal(r.status, 200)
  for (const k of ['min_app_version', 'latest_version', 'latest_version_critical', 'apk_url']) assert.ok(k in r.json, k)
  assert.equal(r.json.channel, 'production')
  assert.equal(r.json.update_url, null)
  assert.deepEqual(r.json.release_notes, { en: '', ta: '', si: '' })
  assert.equal('update_required' in r.json, false)
})
it('status: wrong app key 401, bad channel/version 400', async () => {
  assert.equal((await status('', 'npk_wrong')).status, 401)
  assert.equal((await status('?channel=beta')).status, 400)
  assert.equal((await status('?platform=windows')).status, 400)
  assert.equal((await status('?version=banana')).status, 400)
})
it('admin app-versions: 401 without / with wrong api key; the app key is not accepted', async () => {
  assert.equal((await admin('GET', '', undefined, null)).status, 401)
  assert.equal((await admin('GET', '', undefined, 'wrong')).status, 401)
  assert.equal((await admin('GET', '', undefined, seed.app_key)).status, 401)
  assert.equal((await admin('PUT', '', { channel: 'test', latest_version: '1.0.0', min_version: '1.0.0' }, null)).status, 401)
  assert.equal((await admin('POST', '/hash-apk', { channel: 'test' }, null)).status, 401)
})
it('admin app-versions: validation errors', async () => {
  const base = { channel: 'test', latest_version: '1.0.0-test.6', min_version: '1.0.0-test.5' }
  const bad = async (patch) => (await admin('PUT', '', { ...base, ...patch })).status
  assert.equal(await bad({ latest_version: 'six' }), 400)
  assert.equal(await bad({ min_version: '1.0' }), 400)
  assert.equal(await bad({ min_version: '1.0.0', latest_version: '1.0.0-test.9' }), 400, 'min > latest')
  assert.equal(await bad({ channel: 'beta' }), 400)
  assert.equal(await bad({ update_url: 'http://insecure.example.com/a.apk' }), 400)
  assert.equal(await bad({ update_url: 'https://evil.invalid/a.apk' }), 400, 'host not on allow-list')
  assert.equal(await bad({ apk_sha256: 'abc' }), 400)
  assert.equal(await bad({ surprise: 1 }), 400)
  assert.equal(await bad({ channel: 'production', update_url: 'https://x.example/a.apk' }), 400, 'production ignores update_url')
})
it('admin + status: test row served with notes/url/sha; production keeps legacy and never serves update_url', async () => {
  const list = await admin('GET', '')
  assert.equal(list.status, 200)
  assert.equal(list.json.items.length, 2)
  const host = list.json.allowed_hosts[0]
  assert.ok(host, 'server has an allowed update host (PUBLIC_BASE_URL or APP_UPDATE_HOSTS)')
  const sha = 'a'.repeat(64)
  const url = `https://${host}/apk/test.apk`
  const put = await admin('PUT', '', {
    channel: 'test', latest_version: '1.0.0-test.6', min_version: '1.0.0-test.5', release_notes: { en: 'Fixes', ta: 'திருத்தங்கள்', si: 'නිවැරදි කිරීම්' },
    update_url: url, apk_sha256: sha.toUpperCase(), apk_size_bytes: 12345, updated_by: 'tester',
  })
  assert.equal(put.status, 200, JSON.stringify(put.json))
  assert.equal(put.json.apk_sha256, sha, 'normalised to lower case')

  const t = await status('?platform=android&channel=test&version=1.0.0-test.4')
  assert.equal(t.json.latest_version, '1.0.0-test.6')
  assert.equal(t.json.min_app_version, '1.0.0-test.5')
  assert.equal(t.json.update_url, url)
  assert.equal(t.json.apk_url, url)
  assert.equal(t.json.apk_sha256, sha)
  assert.equal(t.json.apk_size_bytes, 12345)
  assert.equal(t.json.release_notes.si, 'නිවැරදි කිරීම්')
  assert.equal(t.json.update_required, true)
  assert.equal(t.json.update_available, true)
  const ok = await status('?channel=test&version=1.0.0-test.5')
  assert.equal(ok.json.update_required, false)
  assert.equal(ok.json.update_available, true)
  const cur = await status('?channel=test&version=1.0.0')
  assert.equal(cur.json.update_available, false)

  // production channel is independent of the test row and never carries update_url / sha
  const p = await status('?channel=production&version=1.0.0-test.4')
  assert.equal(p.json.update_url, null)
  assert.equal(p.json.apk_sha256, null)
  assert.notEqual(p.json.latest_version, '1.0.0-test.6')
  // default channel (old apps) = production
  assert.equal((await status()).json.channel, 'production')

  // changing the URL clears the stored hash; keeping it keeps the hash
  const keep = await admin('PUT', '', { channel: 'test', latest_version: '1.0.0-test.6', min_version: '1.0.0-test.5' })
  assert.equal(keep.json.apk_sha256, sha)
  const moved = await admin('PUT', '', { channel: 'test', latest_version: '1.0.0-test.6', min_version: '1.0.0-test.5', update_url: `https://${host}/apk/other.apk` })
  assert.equal(moved.json.apk_sha256, null)

  // a production row can be set (no update_url) and then answers /status
  const prod = await admin('PUT', '', { channel: 'production', latest_version: '1.2.0', min_version: '1.1.0', critical: true })
  assert.equal(prod.status, 200)
  const ps = await status('?channel=production&version=1.0.0')
  assert.equal(ps.json.min_app_version, '1.1.0')
  assert.equal(ps.json.update_required, true)
  assert.equal(ps.json.latest_version_critical, true)
  assert.equal(ps.json.update_url, null)
})
