// STAGING ONLY: Sales force v1.0 server tests. Scope at EVERY level (own / descendant OK; sibling, other branch, ancestor, peer denied),
// no token, wrong App Key, wrong role, audit rows, target history + roll-up, the achievement rules and idempotent visits.
// It creates temporary staff in the staging copy of the "test" company and removes them again (also on failure).
// Run: STAGING_SEED=<seed json> TEST_BASE_URL=https://staging-api.72-61-115-222.sslip.io INT_MYSQL_HOST=127.0.0.1 INT_MYSQL_PORT=3307 INT_MYSQL_USER=.. INT_MYSQL_PASSWORD=.. \
//      ELECTRON_RUN_AS_NODE=1 electron vitest run --project=integration electron/__qa__/integration-app/sales-force.integration.test.ts
import fs from 'node:fs'
import crypto from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { appApi, BASE_URL, cloudDb, posAdmin, type CloudDb, type Seed } from './harness'

const ENABLED = !!process.env.STAGING_SEED
const d = describe.skipIf(!ENABLED)
const run = crypto.randomBytes(3).toString('hex')
const period = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 7)

let seed: Seed, api: ReturnType<typeof appApi>, admin: ReturnType<typeof posAdmin>, db: CloudDb, startedAt: string
const S: Record<string, { id: string; code: string; phone: string; token: string; user: string }> = {}
// name -> [level, boss]
const TREE: Record<string, [string, string | null]> = {
  D: ['director', null], M: ['manager', 'D'], Z: ['zonal_manager', 'M'], R1: ['regional_manager', 'Z'], R2: ['regional_manager', 'Z'],
  B1: ['branch_manager', 'R1'], B2: ['branch_manager', 'R2'], F1: ['field_officer', 'B1'], F3: ['field_officer', 'B1'], F2: ['field_officer', 'B2'],
}
const names = Object.keys(TREE)
const children = (n: string) => names.filter(x => TREE[x][1] === n)
const desc = (n: string): string[] => children(n).flatMap(c => [c, ...desc(c)])
const ids = (list: string[]) => list.map(n => S[n].id)

beforeAll(async () => {
  if (!ENABLED) return
  if (!/staging-api\.|localhost|127\.0\.0\.1/.test(BASE_URL)) throw new Error(`Refusing: ${BASE_URL} is not staging/localhost`)
  const raw = JSON.parse(fs.readFileSync(String(process.env.STAGING_SEED), 'utf8'))
  if (!String(raw.db_schema).startsWith('pos_erp_app_test_company_')) throw new Error(`Refusing schema ${raw.db_schema}`)
  seed = { ...raw, base_url: BASE_URL, branches: { main: raw.branch_id, kandy: raw.branch_id }, file: String(process.env.STAGING_SEED) } as Seed
  api = appApi(seed); admin = posAdmin(seed); db = await cloudDb(seed)
  startedAt = (await db.one<{ n: string }>(`SELECT DATE_FORMAT(NOW(), '%Y-%m-%d %H:%i:%s') n`))!.n
  const hash = (await db.one<{ h: string }>(`SELECT password_hash h FROM app_users WHERE agent_id = ? LIMIT 1`, [raw.agent_id]))!.h
  let i = 0
  const base = String(1000 + Math.floor(Math.random() * 8999))
  for (const n of [...names, 'P']) {
    i++
    const id = crypto.randomUUID(), user = crypto.randomUUID(), code = `SF${run}${n}`.toUpperCase(), phone = `0788${base}${String(i).padStart(2, '0')}`
    await db.exec(`INSERT INTO agents (id, code, name, phone, branch_id, status) VALUES (?,?,?,?,?,'active')`, [id, code, `SF ${n} ${run}`, phone, raw.branch_id])
    await db.exec(`INSERT INTO app_users (id, phone, name, password_hash, must_change_password, agent_id, roles, status, created_by_source) VALUES (?,?,?,?,0,?,?, 'active', 'seed')`, [user, phone, `SF ${n} ${run}`, hash, id, JSON.stringify(['agent'])])
    S[n] = { id, code, phone, user, token: '' }
  }
  for (const n of names) { // parents first: TREE is declared top-down
    const [level, boss] = TREE[n]
    const r = await admin.post('/staff/assignments', { staff_id: S[n].id, level_key: level, ...(boss ? { reports_to_staff_id: S[boss].id } : {}) })
    if (r.status !== 200) throw new Error(`assign ${n}: ${r.status} ${JSON.stringify(r.json)}`)
  }
  await Promise.all([...names, 'P'].map(async n => { S[n].token = await api.login(S[n].phone, raw.password) }))
}, 300_000)

afterAll(async () => {
  if (!db) return
  const all = Object.values(S).map(x => x.id)
  if (all.length) {
    const inList = all.map(() => '?').join(',')
    const users = Object.values(S).map(x => x.user)
    await db.exec(`DELETE FROM payments WHERE invoice_id IN (SELECT id FROM invoices WHERE invoice_number LIKE ?)`, [`SFT-${run}-%`]).catch(() => {})
    await db.exec(`DELETE FROM returns WHERE reason = ?`, [`sft-${run}`]).catch(() => {})
    await db.exec(`DELETE FROM invoices WHERE invoice_number LIKE ?`, [`SFT-${run}-%`]).catch(() => {})
    for (const t of ['field_visits', 'staff_targets', 'staff_assignments']) await db.exec(`DELETE FROM ${t} WHERE staff_id IN (${inList})`, all).catch(() => {})
    await db.exec(`DELETE FROM app_refresh_tokens WHERE user_id IN (${users.map(() => '?').join(',')})`, users).catch(() => {})
    await db.exec(`DELETE FROM app_users WHERE id IN (${users.map(() => '?').join(',')})`, users).catch(() => {})
    await db.exec(`DELETE FROM agents WHERE id IN (${inList})`, all).catch(() => {})
    await db.exec(`DELETE FROM audit_logs WHERE action IN ('staff_target_set','staff_assignment_set','staff_assignment_closed') AND created_at >= ?`, [startedAt]).catch(() => {})
  }
  await db.close()
})

d('hierarchy admin (POS, company key)', () => {
  it('SF-ADM-01 invalid hierarchy changes are refused; no key is 401', async () => {
    expect((await admin.post('/staff/assignments', { staff_id: S.D.id, level_key: 'director', reports_to_staff_id: S.F1.id })).status).toBe(400) // director reports to nobody
    expect((await admin.post('/staff/assignments', { staff_id: S.F1.id, level_key: 'field_officer', reports_to_staff_id: S.F3.id })).status).toBe(400) // same level
    expect((await admin.post('/staff/assignments', { staff_id: S.M.id, level_key: 'manager', reports_to_staff_id: S.F1.id })).status).toBe(400) // upward link / loop
    expect((await admin.post('/staff/assignments', { staff_id: S.P.id, level_key: 'field_officer' })).status).toBe(400) // needs a boss
    expect((await admin.post('/staff/assignments', { staff_id: S.P.id, level_key: 'nonsense', reports_to_staff_id: S.B1.id })).status).toBe(400)
    const del = await admin.call('DELETE', `/staff/assignments?staff_id=${S.B1.id}`)
    expect(del.status, 'a manager with a team cannot be removed').toBe(409)
    const res = await fetch(`${BASE_URL}/api/app/v1/admin/staff/assignments`)
    expect(res.status).toBe(401)
    const list = await admin.get('/staff/assignments')
    expect(list.status).toBe(200)
    expect(list.json.items.filter((x: any) => ids(names).includes(x.staff_id)).length).toBe(names.length)
  })
})

d('scope at every level', () => {
  it('SF-SCOPE-01 /staff/me/dashboard and /staff/team show exactly the caller + strict descendants', async () => {
    for (const n of names) {
      const dash = await api.get('/staff/me/dashboard', { token: S[n].token })
      expect(dash.status, `${n} dashboard`).toBe(200)
      expect(dash.json.level).toBe(TREE[n][0])
      expect(dash.json.team_size).toBe(desc(n).length)
      const team = await api.get('/staff/team', { token: S[n].token })
      expect(team.status).toBe(200)
      expect(new Set(team.json.items.map((x: any) => x.staff_id)), `${n} team`).toEqual(new Set(ids([n, ...desc(n)])))
    }
  }, 300_000)

  it('SF-SCOPE-02 performance + targets: own/descendant 200, sibling / other branch / ancestor / peer 404; POST target only on strict descendants', async () => {
    await Promise.all(names.map(async n => {
      const inside = new Set([n, ...desc(n)])
      for (const x of names) {
        const perf = await api.get(`/staff/${S[x].id}/performance?period=${period}`, { token: S[n].token })
        const th = await api.get(`/staff/${S[x].id}/targets`, { token: S[n].token })
        expect(perf.status, `${n} -> performance of ${x}`).toBe(inside.has(x) ? 200 : 404)
        expect(th.status, `${n} -> targets of ${x}`).toBe(inside.has(x) ? 200 : 404)
        if (!inside.has(x)) { expect(perf.json.error.code).toBe('NOT_FOUND') }
        // setting a target: strict descendants only (never self, never a peer, never a boss)
        if (!desc(n).includes(x)) {
          const post = await api.post(`/staff/${S[x].id}/targets`, { period, amount: 999 }, { token: S[n].token })
          expect(post.status, `${n} must not set the target of ${x}`).toBe(404)
        }
      }
    }))
    const stray = await db.query(`SELECT staff_id FROM staff_targets WHERE amount = 999 AND staff_id IN (${ids(names).map(() => '?').join(',')})`, ids(names))
    expect(stray.length, 'refused calls must not leave rows behind').toBe(0)
  }, 600_000)

  it('SF-SCOPE-03 no token 401, wrong App Key 401, customer token 403, plain agent (no assignment) 403 on every manager route', async () => {
    const customer = await api.login(JSON.parse(fs.readFileSync(String(process.env.STAGING_SEED), 'utf8')).logins.customer, seed.password)
    const routes: Array<[string, string, unknown?]> = [['get', '/staff/me/dashboard'], ['get', '/staff/team'], ['get', `/staff/${S.F1.id}/performance`], ['get', `/staff/${S.F1.id}/targets`],
      ['post', `/staff/${S.F1.id}/targets`, { period, amount: 1 }], ['get', '/visits/report'], ['get', '/visits/today'], ['post', '/visits', {}]]
    for (const [m, p, b] of routes) {
      const call = (o: any) => (m === 'get' ? api.get(p, o) : api.post(p, b, o))
      expect((await call({})).status, `${m} ${p} no token`).toBe(401)
      expect((await call({ token: S.D.token, key: 'wrong-key' })).status, `${m} ${p} wrong key`).toBe(401)
      expect((await call({ token: customer })).status, `${m} ${p} customer`).toBe(403)
      if (p.startsWith('/staff') || p === '/visits/report') expect((await call({ token: S.P.token })).status, `${m} ${p} plain agent`).toBe(403)
    }
  })

  it('SF-SCOPE-04 responses carry no salary / commission data', async () => {
    for (const n of ['D', 'B1', 'F1']) {
      const t = JSON.stringify([(await api.get('/staff/team', { token: S[n].token })).json, (await api.get(`/staff/${S[n].id}/performance`, { token: S[n].token })).json])
      expect(t).not.toMatch(/salary|commission|basic/i)
    }
  })
})

d('targets and achievement', () => {
  it('SF-TGT-01 set by the boss, history kept, roll-up for managers, own override wins; audited', async () => {
    expect((await api.post(`/staff/${S.F1.id}/targets`, { period, amount: 1000, registrations_target: 5 }, { token: S.B1.token })).status).toBe(200)
    expect((await api.post(`/staff/${S.F1.id}/targets`, { period, amount: 2000 }, { token: S.B1.token })).status).toBe(200) // raises: old row closed
    expect((await api.post(`/staff/${S.F2.id}/targets`, { period, amount: 3000 }, { token: S.R2.token })).status).toBe(200) // a manager above the boss may set it too
    const hist = (await api.get(`/staff/${S.F1.id}/targets`, { token: S.B1.token })).json.items.filter((x: any) => x.period === period)
    expect(hist.length).toBe(2); expect(hist.filter((x: any) => x.active).length).toBe(1); expect(hist.find((x: any) => x.active).amount).toBe(2000)
    const m = (await api.get(`/staff/${S.M.id}/performance?period=${period}`, { token: S.M.token })).json
    expect(m.target).toBe(5000); expect(m.target_source).toBe('rollup')
    expect((await api.post(`/staff/${S.M.id}/targets`, { period, amount: 9000 }, { token: S.D.token })).status).toBe(200) // director overrides
    const m2 = (await api.get(`/staff/${S.M.id}/performance?period=${period}`, { token: S.M.token })).json
    expect(m2.target).toBe(9000); expect(m2.target_source).toBe('own')
    expect((await api.post(`/staff/${S.F1.id}/targets`, { period: '2026-13', amount: 1 }, { token: S.B1.token })).status).toBe(400)
    expect((await api.post(`/staff/${S.F1.id}/targets`, { period, amount: -5 }, { token: S.B1.token })).status).toBe(400)
    expect((await api.post(`/staff/${S.F1.id}/targets`, { period, amount: 1, staff_id: S.F2.id }, { token: S.B1.token })).status, 'unknown field refused').toBe(400)
    const audit = await db.query(`SELECT action, old_values FROM audit_logs WHERE action = 'staff_target_set' AND created_at >= ?`, [startedAt])
    expect(audit.length).toBeGreaterThanOrEqual(4)
    expect(audit.some((a: any) => a.old_values)).toBe(true)
  }, 300_000)

  it('SF-ACH-01 achieved = invoices net of returns/cancellations/wallet part, credit by the officer on the invoice, old rows by agent code', async () => {
    const mk = async (n: number, p: { total: number; agent?: string | null; code?: string | null; status?: string; at?: string; wallet?: number }) => {
      const id = crypto.randomUUID()
      await db.exec(`INSERT INTO invoices (id, invoice_number, branch_id, cashier_id, status, total_amount, agent_id, agent_code, created_at) VALUES (?,?,?,?,?,?,?,?,COALESCE(?, UTC_TIMESTAMP()))`,
        [id, `SFT-${run}-${n}`, seed.branches.main, 'sft', p.status ?? 'completed', p.total, p.agent ?? null, p.code ?? null, p.at ?? null])
      if (p.wallet) await db.exec(`INSERT INTO payments (id, invoice_id, method, amount) VALUES (?,?,?,?)`, [crypto.randomUUID(), id, 'smartbuy_wallet', p.wallet])
      return id
    }
    const a = await mk(1, { total: 1000, agent: S.F1.id })
    await mk(2, { total: 500, agent: S.F1.id, wallet: 200 })           // 200 was already counted as a Smart Buy contribution
    await mk(3, { total: 800, agent: S.F1.id, status: 'cancelled' })    // cancelled: never counts
    await mk(4, { total: 50, agent: null, code: S.F1.code })            // older invoice (no agent_id): credited by code
    await mk(5, { total: 700, agent: S.F2.id })                         // another officer's sale never counts for F1
    await mk(6, { total: 600, agent: S.F1.id, at: new Date(Date.now() - 45 * 86400e3).toISOString().slice(0, 19).replace('T', ' ') }) // a past month
    await db.exec(`INSERT INTO returns (id, invoice_id, return_date, total_refund, status, reason) VALUES (?,?,UTC_TIMESTAMP(),100,'completed',?)`, [crypto.randomUUID(), a, `sft-${run}`])
    const f1 = (await api.get(`/staff/${S.F1.id}/performance?period=${period}`, { token: S.F1.token })).json
    expect(f1.sales_net).toBe(1000 + 500 - 200 + 50 - 100)
    expect(f1.achieved).toBe(f1.sales_net)
    expect(f1.target).toBe(2000)
    expect(f1.achievement_pct).toBeCloseTo((f1.achieved / 2000) * 100, 2)
    const b1 = (await api.get(`/staff/${S.B1.id}/performance?period=${period}`, { token: S.B1.token })).json
    expect(b1.achieved, 'a manager sees the team total').toBe(f1.achieved)
    const f2 = (await api.get(`/staff/${S.F2.id}/performance?period=${period}`, { token: S.F2.token })).json
    expect(f2.sales_net).toBe(700)
    expect((await api.get(`/staff/${S.F1.id}/performance?period=${period}`, { token: S.F2.token })).status, 'a peer from another branch cannot read it').toBe(404)
  }, 300_000)
})

d('field visits', () => {
  const ev = () => `evt-${crypto.randomUUID()}`
  it('SF-VIS-01 create is idempotent, GPS-missing is flagged, validation, follow-ups clear when revisited', async () => {
    const e1 = ev()
    const v1 = await api.post('/visits', { client_event_id: e1, prospect_name: 'Kamal Stores', lat: 7.2906, lng: 80.6337, outcome: 'purchased', notes: 'bought 2 bags' }, { token: S.F1.token })
    expect(v1.status, JSON.stringify(v1.json)).toBe(201)
    expect(v1.json.visit.gps_missing).toBe(false)
    const again = await api.post('/visits', { client_event_id: e1, prospect_name: 'Kamal Stores', lat: 7.2906, lng: 80.6337, outcome: 'purchased' }, { token: S.F1.token })
    expect(again.status).toBe(200); expect(again.json.duplicate).toBe(true); expect(again.json.visit.id).toBe(v1.json.visit.id)
    const noGps = await api.post('/visits', { client_event_id: ev(), prospect_name: 'Nimal Mart', outcome: 'not_at_home' }, { token: S.F1.token })
    expect(noGps.status).toBe(201); expect(noGps.json.visit.gps_missing).toBe(true)
    const past = new Date(Date.now() - 3 * 86400e3).toISOString()
    const cb = await api.post('/visits', { client_event_id: ev(), prospect_name: 'Sunil Shop', outcome: 'come_back', follow_up_at: new Date(Date.now() - 3600e3).toISOString(), visited_at: past, lat: 1, lng: 1 }, { token: S.F1.token })
    expect(cb.status).toBe(201)
    let today = (await api.get('/visits/today', { token: S.F1.token })).json
    expect(today.visits.length).toBeGreaterThanOrEqual(2)
    expect(today.follow_ups.some((x: any) => x.prospect_name === 'Sunil Shop'), 'overdue follow-up listed').toBe(true)
    await api.post('/visits', { client_event_id: ev(), prospect_name: 'Sunil Shop', outcome: 'purchased', lat: 1, lng: 1 }, { token: S.F1.token })
    today = (await api.get('/visits/today', { token: S.F1.token })).json
    expect(today.follow_ups.some((x: any) => x.prospect_name === 'Sunil Shop'), 'cleared by the revisit').toBe(false)
    for (const bad of [{ outcome: 'not_interested', prospect_name: 'X' }, { outcome: 'come_back', prospect_name: 'X' }, { outcome: 'nonsense', prospect_name: 'X' }, { outcome: 'purchased' },
      { outcome: 'purchased', prospect_name: 'X', visited_at: new Date(Date.now() + 86400e3).toISOString() }, { outcome: 'purchased', prospect_name: 'X', hack: 1 }, { outcome: 'purchased', prospect_name: 'X', customer_id: 'nope' }]) {
      expect((await api.post('/visits', { client_event_id: ev(), ...bad }, { token: S.F1.token })).status, JSON.stringify(bad)).toBe(400)
    }
    expect((await api.post('/visits', { prospect_name: 'X', outcome: 'purchased' }, { token: S.F1.token })).status, 'client_event_id required').toBe(400)
    // the plain agent (no assignment) can log visits too, and only sees their own
    expect((await api.post('/visits', { client_event_id: ev(), prospect_name: 'Own', outcome: 'not_at_home' }, { token: S.P.token })).status).toBe(201)
  }, 300_000)

  it('SF-VIS-02 report is scoped: manager sees the subtree, officer only self, peers / ancestors / other branches are 404', async () => {
    const b1 = await api.get(`/visits/report?period=${period}`, { token: S.B1.token })
    expect(b1.status).toBe(200)
    expect(new Set(b1.json.items.map((x: any) => x.staff_id))).toEqual(new Set(ids(['B1', 'F1', 'F3'])))
    const f1Row = b1.json.items.find((x: any) => x.staff_id === S.F1.id)
    expect(f1Row.total).toBeGreaterThanOrEqual(4); expect(f1Row.gps_missing).toBeGreaterThanOrEqual(1); expect(f1Row.follow_ups_due).toBeGreaterThanOrEqual(1); expect(f1Row.follow_ups_done).toBeGreaterThanOrEqual(1)
    expect((await api.get(`/visits/report?period=${period}`, { token: S.F1.token })).json.items.map((x: any) => x.staff_id)).toEqual([S.F1.id])
    for (const [who, target] of [['B2', 'F1'], ['F3', 'F1'], ['F1', 'B1'], ['F1', 'D'], ['R1', 'F2']] as const) {
      expect((await api.get(`/visits/report?staff_id=${S[target].id}&period=${period}`, { token: S[who].token })).status, `${who} -> ${target}`).toBe(404)
    }
    expect((await api.get(`/visits/report?staff_id=${S.F1.id}&period=${period}`, { token: S.D.token })).status).toBe(200)
  }, 300_000)
})
