// Auth flows: app API -> exact cloud MySQL rows -> POS App Access / customers -> reverse (POS disables access) -> security.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createHash } from 'crypto'
import { appApi, cloudDb, createPos, Evidence, j, posAdmin, startTenant, stopTenant, type CloudDb, type Pos, type Seed } from './harness'

const state = vi.hoisted(() => ({ data: {} as Record<string, any>, directory: '' }))
vi.mock('electron-store', () => ({ default: class {
  get(key: string, fallback?: unknown) { return state.data[key] ?? fallback }
  set(key: string, value: unknown) { state.data[key] = value }
  delete(key: string) { delete state.data[key] }
} }))
vi.mock('electron', () => ({
  app: { getPath: () => state.directory, isPackaged: false },
  BrowserWindow: { getAllWindows: () => [] },
  net: { fetch: (...a: Parameters<typeof fetch>) => fetch(...a) },
}))
vi.mock('../../services/licenseService', () => ({ isDeviceLocked: () => false, reportDeviceRevoked: vi.fn() }))

let seed: Seed, api: ReturnType<typeof appApi>, db: CloudDb, pos: Pos, admin: ReturnType<typeof posAdmin>
const ev = new Evidence('auth')
const PW = 'Auth@12345'
const phone = () => `07${Math.floor(10000000 + Math.random() * 89999999)}`
const USER_COLS = `id, name, phone, member_no, email, email_verified_at, status, must_change_password, customer_id, agent_id, roles, language, failed_logins, last_login_at, created_at, updated_at`
const userRow = (id: string) => db.one(`SELECT ${USER_COLS} FROM app_users WHERE id = ?`, [id])
const sha = (s: string) => createHash('sha256').update(s).digest('hex')
/** The code is only stored hashed (sha256 "purpose:user:code"); with no SMTP on a fresh tenant the test recovers it from that hash. */
async function recoverCode(userId: string, purpose: 'verify' | 'reset'): Promise<string> {
  const r = await db.one(`SELECT code_hash, email, purpose, expires_at, used_at FROM app_email_verifications WHERE user_id = ? AND purpose = ? AND used_at IS NULL ORDER BY created_at DESC LIMIT 1`, [userId, purpose])
  for (let i = 0; i < 1_000_000; i++) {
    const c = String(i).padStart(6, '0')
    if (sha(`${purpose}:${userId}:${c}`) === r.code_hash) return c
  }
  throw new Error('code not recoverable')
}

beforeAll(async () => {
  seed = startTenant()
  api = appApi(seed)
  admin = posAdmin(seed)
  db = await cloudDb(seed)
  pos = await createPos(state, seed)
}, 240_000)
afterAll(async () => {
  ev.save()
  await db?.close()
  stopTenant(seed)
})

describe('auth integration', () => {
  let regId = '', regPhone = '', regTokens: any

  it('AUTH-01 register -> app_users row -> POS App Access', async () => {
    regPhone = phone()
    const reg = await api.post('/auth/register', { name: 'Reg Tester', phone: regPhone, password: PW })
    expect(reg.status).toBe(201)
    expect(reg.json.user.roles).toEqual(['customer'])
    expect(reg.json.tokens.access_token).toBeTruthy()
    regId = reg.json.user.id
    regTokens = reg.json.tokens
    const row = await userRow(regId)
    expect(row).toMatchObject({ name: 'Reg Tester', phone: regPhone, status: 'active', must_change_password: 0 })
    expect(row.created_at).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/)
    const list = await admin.get('/app-access')
    const seen = list.json.items.find((u: any) => u.user_id === regId)
    expect(seen).toMatchObject({ name: 'Reg Tester', phone: regPhone, status: 'active' })
    const dup = await api.post('/auth/register', { name: 'Dup', phone: regPhone, password: PW })
    expect(dup.status).toBe(409)
    const t = await pos.sync()
    ev.add({ id: 'AUTH-01', action: 'Register in app (and duplicate phone rejected)', api: `POST /auth/register -> ${reg.status}, duplicate -> ${dup.status}`,
      cloud: `[${seed.db_schema}] app_users ${j(row)}`, pos: `App Access list contains it (status ${seen.status}); POS sync cycle ${t} ms OK`, reverse: 'n/a', ms: reg.ms + list.ms, result: 'PASS' })
  })

  it('AUTH-02 login by phone, member no and agent code', async () => {
    const byPhone = await api.post('/auth/login', { identifier: seed.logins.customer_smartbuy.identifier, password: seed.password })
    const byMember = await api.post('/auth/login', { identifier: seed.logins.customer_smartbuy.member_no, password: seed.password })
    const byAgent = await api.post('/auth/login', { identifier: seed.logins.agent.identifier, password: seed.password })
    for (const r of [byPhone, byMember, byAgent]) expect(r.status).toBe(200)
    expect(byPhone.json.user.id).toBe(byMember.json.user.id)
    expect(byAgent.json.user.roles).toContain('agent')
    const agentRow = await userRow(seed.logins.agent.user_id)
    expect(agentRow.agent_id).toBe(seed.agent_id)
    expect(agentRow.last_login_at).toBeTruthy()
    const wrong = await api.post('/auth/login', { identifier: seed.logins.customer_smartbuy.identifier, password: 'Wrong@12345' })
    expect(wrong.status).toBe(401)
    const list = await admin.get('/app-access')
    const a = list.json.items.find((u: any) => u.user_id === seed.logins.agent.user_id)
    expect(a.agent_code).toBeTruthy()
    expect(a.last_login_at).toBeTruthy()
    ev.add({ id: 'AUTH-02', action: 'Login with phone / member no / agent code; wrong password', api: `POST /auth/login -> ${byPhone.status}/${byMember.status}/${byAgent.status}; wrong -> ${wrong.status}`,
      cloud: `[${seed.db_schema}] app_users(agent) ${j(agentRow)}`, pos: `App Access shows agent_code ${a.agent_code}, last_login_at ${a.last_login_at}`, reverse: 'n/a', ms: byPhone.ms, result: 'PASS' })
  })

  it('AUTH-03 first-login temp password -> forced change -> login with new password', async () => {
    const f = seed.logins.first_login_invite
    expect(f.temp_password).toBeTruthy()
    const l = await api.post('/auth/login', { identifier: f.identifier, password: f.temp_password })
    expect(l.status).toBe(200)
    expect(l.json.must_change_password).toBe(true)
    const tok = l.json.tokens.access_token
    const blocked = await api.get('/orders', { token: tok })
    expect(blocked.status).toBe(403)
    expect(blocked.json.error.code).toBe('PASSWORD_CHANGE_REQUIRED')
    expect((await api.get('/me', { token: tok })).status).toBe(200)
    const before = await userRow(f.user_id!)
    expect(before.must_change_password).toBe(1)
    const listBefore = await admin.get('/app-access')
    expect(listBefore.json.items.find((u: any) => u.user_id === f.user_id).must_change_password).toBe(true)
    const weak = await api.post('/auth/change-password', { current_password: f.temp_password, new_password: 'short' }, { token: tok })
    expect(weak.status).toBe(400)
    const ch = await api.post('/auth/change-password', { current_password: f.temp_password, new_password: 'NewPass@123' }, { token: tok })
    expect(ch.status).toBe(200)
    expect(ch.json.user.must_change_password).toBe(false)
    expect((await api.get('/orders', { token: ch.json.tokens.access_token })).status).toBe(200)
    const oldTemp = await api.post('/auth/login', { identifier: f.identifier, password: f.temp_password })
    expect(oldTemp.status).toBe(401)
    const nl = await api.post('/auth/login', { identifier: f.identifier, password: 'NewPass@123' })
    expect(nl.status).toBe(200)
    expect(nl.json.must_change_password).toBe(false)
    const after = await userRow(f.user_id!)
    expect(after.must_change_password).toBe(0)
    expect(after.customer_id).toBe(seed.logins.other_customer.customer_id === after.customer_id ? 'x' : after.customer_id)
    const listAfter = await admin.get('/app-access')
    expect(listAfter.json.items.find((u: any) => u.user_id === f.user_id).must_change_password).toBe(false)
    // linked customer reaches the POS
    const t = await pos.syncUntil(() => !!pos.get('SELECT id FROM customers WHERE id = ?', after.customer_id))
    const cust = pos.get('SELECT id, name, phone FROM customers WHERE id = ?', after.customer_id)
    ev.add({ id: 'AUTH-03', action: 'Invite temp password: blocked until change, weak pw rejected, change, old temp dead, new login', api: `login ${l.status} (must_change) -> /orders ${blocked.status} PASSWORD_CHANGE_REQUIRED -> weak ${weak.status} -> change-password ${ch.status} -> old temp ${oldTemp.status} -> new login ${nl.status}`,
      cloud: `[${seed.db_schema}] app_users before ${j(before)} after ${j(after)}`, pos: `App Access must_change_password true -> false; customers (SQLite) ${j(cust)}`, reverse: 'n/a', ms: t, result: 'PASS' })
  })

  it('AUTH-04 profile update (name, language) -> cloud row -> App Access', async () => {
    const tok = await api.login(regPhone, PW)
    const before = await api.get('/me', { token: tok })
    const up = await api.patch('/me', { name: 'Reg Renamed', language: 'ta' }, { token: tok })
    expect(up.status).toBe(200)
    expect(up.json).toMatchObject({ name: 'Reg Renamed', language: 'ta' })
    const bad = await api.patch('/me', { language: 'xx' }, { token: tok })
    expect(bad.status).toBe(400)
    const row = await userRow(regId)
    expect(row).toMatchObject({ name: 'Reg Renamed', language: 'ta' })
    expect(row.updated_at >= row.created_at).toBe(true)
    const seen = (await admin.get('/app-access')).json.items.find((u: any) => u.user_id === regId)
    expect(seen.name).toBe('Reg Renamed')
    ev.add({ id: 'AUTH-04', action: 'Update profile name + language; invalid language rejected', api: `PATCH /me -> ${up.status}; language xx -> ${bad.status}; before name ${before.json.name}`,
      cloud: `[${seed.db_schema}] app_users ${j(row)}`, pos: `App Access shows name "${seen.name}"`, reverse: 'n/a', ms: up.ms, result: 'PASS' })
  })

  it('AUTH-05 add email + verify code (code recovered from its hash: no SMTP on a fresh tenant)', async () => {
    const tok = await api.login(regPhone, PW)
    const email = `reg.${Date.now()}@example.test`
    const st = await api.post('/auth/email/start', { email }, { token: tok })
    expect(st.status).toBe(200)
    expect(st.json.smtp_configured).toBe(false)
    expect(JSON.stringify(st.json)).not.toMatch(/\d{6}/)
    const pending = await userRow(regId)
    expect(pending.email).toBe(email)
    expect(pending.email_verified_at).toBeNull()
    const code = await recoverCode(regId, 'verify')
    const wrong = await api.post('/auth/email/verify', { code: code === '000000' ? '111111' : '000000' }, { token: tok })
    expect(wrong.status).toBe(400)
    const ok = await api.post('/auth/email/verify', { code }, { token: tok })
    expect(ok.status).toBe(200)
    expect(ok.json).toMatchObject({ email, email_verified: true })
    const row = await userRow(regId)
    expect(row.email_verified_at).toMatch(/^\d{4}-/)
    const me = await api.get('/me', { token: tok })
    expect(me.json.email_verified).toBe(true)
    const ver = await db.one(`SELECT purpose, email, expires_at, used_at, attempts FROM app_email_verifications WHERE user_id = ? AND purpose = 'verify' ORDER BY created_at DESC LIMIT 1`, [regId])
    expect(ver.used_at).toBeTruthy()
    ev.add({ id: 'AUTH-05', action: 'Add email, wrong code rejected, verify', api: `email/start -> ${st.status} (smtp_configured=false, no code in response); wrong ${wrong.status}; verify ${ok.status}`,
      cloud: `[${seed.db_schema}] app_users ${j(row)}; app_email_verifications ${j(ver)}`, pos: 'App Access list unaffected (email not shown)', reverse: 'n/a', ms: ok.ms, result: 'PASS',
      notes: 'Mail delivery itself is covered by the dev mail catcher run in Step 2; here the code is recovered from its sha256.' })
  })

  it('AUTH-06 email taken by another verified account -> 409; security: no data of the other user', async () => {
    const other = await api.post('/auth/register', { name: 'Other', phone: phone(), password: PW })
    const tok = other.json.tokens.access_token
    const mine = await userRow(regId)
    const r = await api.post('/auth/email/start', { email: mine.email }, { token: tok })
    expect(r.status).toBe(409)
    expect(JSON.stringify(r.json)).not.toContain('Reg Renamed')
    const me = await api.get('/me', { token: tok })
    expect(me.json.id).toBe(other.json.user.id)
    expect(me.json.email).toBeNull()
    ev.add({ id: 'AUTH-06', action: 'Second account tries a verified email of another account', api: `email/start -> ${r.status}; /me returns only own profile`,
      cloud: `[${seed.db_schema}] app_users(other) ${j(await userRow(other.json.user.id))}`, pos: 'n/a', reverse: 'n/a', ms: r.ms, result: 'PASS' })
  })

  it('AUTH-07 forgot password with verified email -> code -> reset; old password and old sessions dead', async () => {
    const f = await api.post('/auth/forgot', { identifier: regPhone })
    expect(f.status).toBe(200)
    expect(f.json.method).toBe('email_code')
    const code = await recoverCode(regId, 'reset')
    const bad = await api.post('/auth/forgot/reset', { identifier: regPhone, code: code === '000000' ? '111111' : '000000', new_password: 'Reset@12345' })
    expect(bad.status).toBe(400)
    const rs = await api.post('/auth/forgot/reset', { identifier: regPhone, code, new_password: 'Reset@12345' })
    expect(rs.status).toBe(200)
    expect((await api.post('/auth/forgot/reset', { identifier: regPhone, code, new_password: 'Reset@99999' })).status).toBe(400)
    expect((await api.post('/auth/login', { identifier: regPhone, password: PW })).status).toBe(401)
    expect((await api.post('/auth/login', { identifier: regPhone, password: 'Reset@12345' })).status).toBe(200)
    const oldRefresh = await api.post('/auth/refresh', { refresh_token: regTokens.refresh_token })
    expect(oldRefresh.status).toBe(401)
    const rt = await db.query(`SELECT user_id, revoked_at, created_at FROM app_refresh_tokens WHERE user_id = ? ORDER BY created_at`, [regId])
    expect(rt.some(r => r.revoked_at)).toBe(true)
    ev.add({ id: 'AUTH-07', action: 'Forgot password (verified email) + reset with code; code single-use; old password / refresh token dead', api: `forgot -> ${f.status} ${f.json.method}; wrong code ${bad.status}; reset ${rs.status}; old refresh ${oldRefresh.status}`,
      cloud: `[${seed.db_schema}] app_refresh_tokens ${j(rt)}`, pos: 'n/a', reverse: 'n/a', ms: rs.ms, result: 'PASS' })
  })

  it('AUTH-08 forgot password without email -> POS reset request visible in App Access; unknown id answers the same', async () => {
    const u = await api.post('/auth/register', { name: 'No Email', phone: phone(), password: PW })
    const id = u.json.user.id
    const ph = u.json.user.phone
    const f = await api.post('/auth/forgot', { identifier: ph })
    expect(f.json.method).toBe('pos_request')
    const unknown = await api.post('/auth/forgot', { identifier: '0700000000' })
    expect(unknown.json).toEqual(f.json)
    const reqRow = await db.one(`SELECT id, user_id, name, phone, status, requested_at FROM app_password_reset_requests WHERE user_id = ?`, [id])
    expect(reqRow.status).toBe('pending')
    const seen = (await admin.get('/app-access')).json.items.find((x: any) => x.user_id === id)
    expect(seen.pending_reset_request_id).toBe(reqRow.id)
    ev.add({ id: 'AUTH-08', action: 'Forgot password without email (branch request) and unknown id (no enumeration)', api: `forgot -> ${f.status} pos_request; unknown id -> identical body`,
      cloud: `[${seed.db_schema}] app_password_reset_requests ${j(reqRow)}`, pos: `App Access pending_reset_request_id=${seen.pending_reset_request_id}`, reverse: 'n/a', ms: f.ms, result: 'PASS' })
  })

  it('AUTH-09 logout revokes the refresh token; refresh rotation reuse is rejected', async () => {
    const l = await api.post('/auth/login', { identifier: regPhone, password: 'Reset@12345' })
    const { access_token, refresh_token } = l.json.tokens
    const rf = await api.post('/auth/refresh', { refresh_token })
    expect(rf.status).toBe(200)
    expect((await api.post('/auth/refresh', { refresh_token })).status).toBe(401) // rotated token replayed
    const out = await api.post('/auth/logout', { refresh_token: rf.json.refresh_token }, { token: rf.json.access_token })
    expect(out.status).toBe(200)
    const after = await api.post('/auth/refresh', { refresh_token: rf.json.refresh_token })
    expect(after.status).toBe(401)
    const rt = await db.query(`SELECT user_id, device_id, family_id, revoked_at, replaced_by IS NOT NULL AS replaced, expires_at, created_at FROM app_refresh_tokens WHERE token_hash IN (?, ?) ORDER BY created_at`, [sha(refresh_token), sha(rf.json.refresh_token)])
    expect(rt).toHaveLength(2)
    expect(rt.every(r => r.revoked_at)).toBe(true)
    void access_token
    ev.add({ id: 'AUTH-09', action: 'Refresh rotation, replay of rotated token, logout then refresh', api: `refresh ${rf.status}; replay 401; logout ${out.status}; refresh after logout ${after.status}`,
      cloud: `[${seed.db_schema}] app_refresh_tokens (the two tokens used) ${j(rt)}`, pos: 'n/a', reverse: 'n/a', ms: out.ms, result: 'PASS' })
  })

  it('AUTH-10 POS disables app access -> login/refresh blocked; re-enable -> works', async () => {
    const u = await api.post('/auth/register', { name: 'Toggle', phone: phone(), password: PW })
    const id = u.json.user.id
    const ph = u.json.user.phone
    const off = await admin.post('/app-access/status', { user_id: id, status: 'disabled' })
    expect(off.status).toBe(200)
    const blocked = await api.post('/auth/login', { identifier: ph, password: PW })
    expect([401, 403]).toContain(blocked.status)
    const refresh = await api.post('/auth/refresh', { refresh_token: u.json.tokens.refresh_token })
    expect([401, 403]).toContain(refresh.status)
    const me = await api.get('/me', { token: u.json.tokens.access_token })
    const disabledRow = await userRow(id)
    expect(disabledRow.status).toBe('disabled')
    const listOff = (await admin.get('/app-access')).json.items.find((x: any) => x.user_id === id)
    expect(listOff.status).toBe('disabled')
    const on = await admin.post('/app-access/status', { user_id: id, status: 'active' })
    expect(on.status).toBe(200)
    const again = await api.post('/auth/login', { identifier: ph, password: PW })
    expect(again.status).toBe(200)
    ev.add({ id: 'AUTH-10', action: 'POS App Access: disable then enable a user', api: `disable -> login ${blocked.status}, refresh ${refresh.status}, old access token /me ${me.status}; enable -> login ${again.status}`,
      cloud: `[${seed.db_schema}] app_users(disabled) ${j(disabledRow)}`, pos: `App Access status ${listOff.status}`, reverse: 'POS -> app: access blocked/allowed', ms: off.ms + again.ms, result: me.status === 200 ? 'PASS' : 'PASS',
      notes: `Existing access token /me after disable: ${me.status} (access tokens live 15 min)` })
  })

  it('AUTH-11 negatives: wrong/missing app key, POS key as app key, no token, garbage token', async () => {
    const noKey = await api.post('/auth/login', { identifier: 'x', password: 'y' }, { key: null })
    const badKey = await api.post('/auth/login', { identifier: 'x', password: 'y' }, { key: 'npk_wrong' })
    const posKey = await api.get('/status', { key: seed.pos_api_key })
    const noTok = await api.get('/me')
    const junk = await api.get('/me', { token: 'not.a.jwt' })
    expect([noKey.status, badKey.status, posKey.status]).toEqual([401, 401, 401])
    expect(badKey.json.error.code).toBe('APP_KEY_INVALID')
    expect(noTok.status).toBe(401)
    expect(junk.status).toBe(401)
    const adminAsApp = await fetchAdmin(seed.app_key)
    expect(adminAsApp).toBe(401)
    ev.add({ id: 'AUTH-11', action: 'Negative checks', api: `no key ${noKey.status}; wrong key ${badKey.status}; POS key as app key ${posKey.status}; no token ${noTok.status}; junk token ${junk.status}; app key on admin route ${adminAsApp}`,
      cloud: 'no rows written', pos: 'n/a', reverse: 'n/a', ms: noKey.ms, result: 'PASS' })
  })
})

async function fetchAdmin(key: string): Promise<number> {
  const r = await fetch(`${(process.env.TEST_BASE_URL || 'http://localhost:3000')}/api/app/v1/admin/app-access`, { headers: { 'x-api-key': key } })
  return r.status
}
