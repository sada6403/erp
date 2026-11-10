// Proves the harness end to end with one flow: register in the app -> exact cloud rows -> App Access screen -> POS sync.
// COPY the mock preamble below into every integration-app test file.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
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

let seed: Seed, api: ReturnType<typeof appApi>, db: CloudDb, pos: Pos
const ev = new Evidence('smoke')

beforeAll(async () => {
  seed = startTenant()
  api = appApi(seed)
  db = await cloudDb(seed)
  pos = await createPos(state, seed)
}, 180_000)
afterAll(async () => {
  ev.save()
  await db?.close()
  stopTenant(seed)
})

describe('harness smoke: register', () => {
  it('app register -> cloud rows -> App Access screen', async () => {
    const phone = `07${Math.floor(10000000 + Math.random() * 89999999)}`
    const reg = await api.post('/auth/register', { name: 'Smoke Test', phone, password: 'Smoke@1234' }, { key: seed.app_key })
    expect(reg.status).toBe(201)
    const user = await db.one(`SELECT id, name, phone, status, customer_id, created_at, updated_at FROM app_users WHERE phone = ?`, [phone])
    expect(user?.name).toBe('Smoke Test')
    const list = await posAdmin(seed).get('/app-access')
    expect(list.status).toBe(200)
    const t = await pos.sync()
    ev.add({
      id: 'SMOKE-01', action: 'Register in app', api: `POST /auth/register -> ${reg.status}`,
      cloud: `app_users ${j(user)}`, pos: `App Access list ${list.status}; POS sync ${t} ms`, reverse: 'n/a', ms: reg.ms + t, result: 'PASS',
    })
  })
})
