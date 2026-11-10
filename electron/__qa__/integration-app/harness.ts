// Shared harness for the app <-> API <-> cloud MySQL <-> POS desktop integration suite (`npm run test:integration-app`).
//
// Everything is LOCAL and disposable:
//   - a fresh, uniquely named tenant is seeded in local MySQL (backend/scripts/seed-app-test-company.ts, SEED_FRESH=1) and
//     deleted again afterwards;
//   - the cloud API is the local Next dev server (default http://localhost:3000, must be running);
//   - the "POS desktop" is the real SyncService + better-sqlite3 in a temp folder, pointed at that tenant's POS api key.
//
// Each test file must declare the electron / electron-store mocks itself (vi.mock is hoisted per file) - copy the preamble
// from `smoke.integration.test.ts`. Then:
//   const seed = startTenant();                 // beforeAll
//   const pos = await createPos(state, seed);   // beforeAll, after the mocks
//   const ev = new Evidence('auth')             // one per file
//   ... ev.add({...}) ...; ev.save()            // afterAll
//   stopTenant(seed)                            // afterAll
import { spawnSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { createRequire } from 'module'

const ROOT = path.resolve(__dirname, '..', '..', '..')
const BACKEND = path.join(ROOT, 'backend')
export const EVIDENCE_DIR = path.join(ROOT, 'docs', 'mobile-app', 'integration-evidence')
export const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000'

export interface Seed {
  base_url: string; company_id: string; db_schema: string; pos_api_key: string; app_key: string; password: string
  branches: { main: string; kandy: string }; product_ids: string[]; scheme_id: string; agent_id: string
  logins: {
    customer_smartbuy: { identifier: string; member_no: string; user_id: string; customer_id: string }
    other_customer: { identifier: string; member_no: string; user_id: string; customer_id: string }
    agent: { identifier: string; phone: string; user_id: string }
    first_login_invite: { identifier: string; temp_password: string | null; user_id: string | null }
  }
  delivery_order_id: string; delivery_order_number: string
  file: string
}

/** Seeds a fresh isolated tenant. Throws with a clear message when the dev server / MySQL is not available. */
export function startTenant(): Seed {
  const file = path.join(os.tmpdir(), `np-int-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.json`)
  const r = spawnSync('node', ['--env-file=.env', 'scripts/run-ts.cjs', 'scripts/seed-app-test-company.ts'], {
    cwd: BACKEND, encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '', SEED_FRESH: '1', SEED_OUTPUT: file, SEED_BASE_URL: BASE_URL },
  })
  if (r.status !== 0 || !fs.existsSync(file)) throw new Error(`Seeding the fresh test tenant failed (is the dev server on ${BASE_URL} and local MySQL up?)\n${r.stdout}\n${r.stderr}`)
  return { ...JSON.parse(fs.readFileSync(file, 'utf8')), file }
}

export function stopTenant(seed: Seed | undefined): void {
  if (!seed || !fs.existsSync(seed.file)) return
  spawnSync('node', ['--env-file=.env', 'scripts/run-ts.cjs', 'scripts/seed-app-test-company.ts', '--cleanup'], {
    cwd: BACKEND, encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '', SEED_OUTPUT: seed.file },
  })
}

const randomIp = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${1 + Math.floor(Math.random() * 250)}`

export interface ApiResult<T = any> { status: number; json: T; ms: number }

/** Mobile-app API client (`/api/app/v1`). Every call uses its own client IP so rate limits never interfere. */
export function appApi(seed: Seed) {
  const call = async <T = any>(method: string, p: string, opts: { token?: string | null; body?: unknown; headers?: Record<string, string>; key?: string | null } = {}): Promise<ApiResult<T>> => {
    const h: Record<string, string> = { 'x-forwarded-for': randomIp(), ...(opts.headers ?? {}) }
    const key = opts.key === undefined ? seed.app_key : opts.key
    if (key) h['x-app-key'] = key
    if (opts.token) h.authorization = `Bearer ${opts.token}`
    if (opts.body !== undefined) h['content-type'] = 'application/json'
    const t0 = Date.now()
    const res = await fetch(`${BASE_URL}/api/app/v1${p}`, { method, headers: h, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) })
    let json: any = null
    try { json = await res.json() } catch { /* not json */ }
    return { status: res.status, json, ms: Date.now() - t0 }
  }
  return {
    get: <T = any>(p: string, o?: Parameters<typeof call>[2]) => call<T>('GET', p, o),
    post: <T = any>(p: string, body?: unknown, o: Parameters<typeof call>[2] = {}) => call<T>('POST', p, { ...o, body: body ?? {} }),
    put: <T = any>(p: string, body?: unknown, o: Parameters<typeof call>[2] = {}) => call<T>('PUT', p, { ...o, body: body ?? {} }),
    patch: <T = any>(p: string, body?: unknown, o: Parameters<typeof call>[2] = {}) => call<T>('PATCH', p, { ...o, body: body ?? {} }),
    del: <T = any>(p: string, o?: Parameters<typeof call>[2]) => call<T>('DELETE', p, o),
    call,
    /** Logs in and returns the access token. */
    async login(identifier: string, password: string): Promise<string> {
      const r = await call('POST', '/auth/login', { body: { identifier, password } })
      if (r.status !== 200) throw new Error(`login ${identifier} -> ${r.status} ${JSON.stringify(r.json)}`)
      return r.json.tokens.access_token
    },
  }
}

/** What the POS App Access / Join Requests screens call: `/api/app/v1/admin/*` with the POS api key (x-api-key), not the app key. */
export function posAdmin(seed: Seed) {
  const call = async <T = any>(method: string, p: string, body?: unknown): Promise<ApiResult<T>> => {
    const t0 = Date.now()
    const res = await fetch(`${BASE_URL}/api/app/v1/admin${p}`, { method, headers: { 'x-api-key': seed.pos_api_key, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
    let json: any = null
    try { json = await res.json() } catch { /* not json */ }
    return { status: res.status, json, ms: Date.now() - t0 }
  }
  return { get: <T = any>(p: string) => call<T>('GET', p), post: <T = any>(p: string, b: unknown = {}) => call<T>('POST', p, b), put: <T = any>(p: string, b: unknown = {}) => call<T>('PUT', p, b), call }
}

/** Direct read access to the tenant's MySQL schema (UTC strings as stored). Use it for the "exact cloud rows" evidence. */
export async function cloudDb(seed: Seed) {
  const mysql = createRequire(path.join(BACKEND, 'package.json'))('mysql2/promise')
  const env = Object.fromEntries(fs.readFileSync(path.join(BACKEND, '.env'), 'utf8').split(/\r?\n/)
    .filter(l => l && !l.startsWith('#') && l.includes('='))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')] }))
  const conn = await mysql.createConnection({
    host: env.MYSQL_HOST, port: Number(env.MYSQL_PORT || 3306), user: env.MYSQL_USER, password: env.MYSQL_PASSWORD,
    database: seed.db_schema, timezone: '+00:00', dateStrings: true,
  })
  await conn.query(`SET time_zone = '+00:00'`)
  return {
    query: async <T = any>(sql: string, params: unknown[] = []): Promise<T[]> => (await conn.query(sql, params))[0] as T[],
    one: async <T = any>(sql: string, params: unknown[] = []): Promise<T | undefined> => ((await conn.query(sql, params))[0] as T[])[0],
    /** Direct write used to simulate what the POS pushes / a branch does (only where the real POS path is unavailable). */
    exec: async (sql: string, params: unknown[] = []) => { await conn.query(sql, params) },
    close: () => conn.end(),
  }
}
export type CloudDb = Awaited<ReturnType<typeof cloudDb>>

/**
 * A POS desktop: real SQLite + the real SyncService against the local API with the tenant's POS key.
 * `state` is the hoisted object behind the electron-store / electron mocks of the calling test file.
 */
export async function createPos(state: { data: Record<string, any>; directory: string }, seed: Seed) {
  state.directory = fs.mkdtempSync(path.join(os.tmpdir(), 'np-pos-'))
  state.data = { app_settings: { cloud_api_url: BASE_URL, cloud_api_key: seed.pos_api_key }, device_id: `int-test-${Date.now()}`, device_branch_id: seed.branches.main }
  const database = await import('../../database')
  await database.initDatabase()
  const db = database.getDb()
  const { SyncService, getSyncService } = await import('../../services/syncService')
  const svc = new SyncService()
  // never let the background timer run during a test
  try { (getSyncService() as any).runSoon = () => {} } catch { /* ignore */ }
  return {
    db,
    state,
    /** One full sync cycle (push queue, pull everything). Returns ms. Throws when the cycle fails. */
    async sync(): Promise<number> {
      const t0 = Date.now()
      const ok = await svc.runOnce()
      if (!ok) throw new Error(`POS sync cycle failed: ${state.data.sync_cycle_error ?? 'unknown'}`)
      return Date.now() - t0
    },
    /** Syncs until `check()` is true (max `tries` cycles). Returns total ms. */
    async syncUntil(check: () => boolean, tries = 3): Promise<number> {
      const t0 = Date.now()
      for (let i = 0; i < tries; i++) { await this.sync(); if (check()) return Date.now() - t0 }
      throw new Error('POS data did not arrive after sync')
    },
    get: <T = any>(sql: string, ...p: unknown[]) => db.prepare(sql).get(...p) as T | undefined,
    all: <T = any>(sql: string, ...p: unknown[]) => db.prepare(sql).all(...p) as T[],
  }
}
export type Pos = Awaited<ReturnType<typeof createPos>>

export interface EvidenceRow {
  /** Stable id, e.g. "AUTH-01" */
  id: string
  action: string
  /** Request line + status, e.g. "POST /auth/register -> 201" */
  api: string
  /** Exact cloud MySQL rows (values, tenant schema, agent_id, UTC timestamps) */
  cloud: string
  /** Where it shows up in the POS: screen + the local rows */
  pos: string
  /** Reverse direction (POS change -> app) or "n/a" */
  reverse: string
  /** Time for the end-to-end propagation in ms (api call -> visible in POS) */
  ms?: number
  result: 'PASS' | 'FAIL' | 'SKIP'
  notes?: string
}

/** Collects report rows for one test file; written to docs/mobile-app/integration-evidence/<name>.json. */
export class Evidence {
  rows: EvidenceRow[] = []
  constructor(private name: string) {}
  add(row: EvidenceRow) { this.rows.push(row) }
  save() {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true })
    fs.writeFileSync(path.join(EVIDENCE_DIR, `${this.name}.json`), JSON.stringify({ file: this.name, generated_at: new Date().toISOString(), rows: this.rows }, null, 2))
  }
}

/** Compact JSON for evidence cells. */
export const j = (v: unknown): string => JSON.stringify(v)
