import { beforeAll, afterAll, beforeEach, describe, it, expect, vi } from 'vitest'
import Database from 'better-sqlite3'

const state = vi.hoisted(() => ({ user: { id: 'cashier' } as Record<string, unknown> | undefined }))
const db = new Database(':memory:')
vi.mock('electron', () => ({ ipcMain: { handle() {} } }))
vi.mock('../database', () => ({ getDb: () => db }))
vi.mock('../services/companyWorkspace', () => ({ createCompanyStore: () => ({ get: () => state.user }) }))
vi.mock('../services/syncQueue', () => ({ enqueuSync: vi.fn() }))
vi.mock('../services/auditLog', () => ({ logAudit: vi.fn() }))
const handlers = new Map<string, (...args: any[]) => any>()
async function suggest(query: string, customer?: string) { return handlers.get('coupons:suggest')!({}, query, customer) }
beforeAll(async () => {
  db.exec(`CREATE TABLE coupons (code TEXT PRIMARY KEY, name TEXT, balance REAL,
    status TEXT, valid_from TEXT, valid_until TEXT, customer_id TEXT)`)
  const { registerCouponHandlers } = await import('../ipc/coupons')
  registerCouponHandlers({ handle: (channel: string, handler: any) => handlers.set(channel, handler) } as any)
})
beforeEach(() => {
  state.user = { id: 'cashier' }; db.exec('DELETE FROM coupons')
  const insert = db.prepare('INSERT INTO coupons VALUES (?, ?, ?, ?, ?, ?, ?)')
  insert.run('CPN-BEARER', 'Gift', 100, 'active', null, null, null)
  insert.run('CPN-OWN', 'Own', 50, 'active', null, null, 'customer-1')
  insert.run('CPN-OTHER', 'Other', 50, 'active', null, null, 'customer-2')
  insert.run('CPN-EXPIRED', 'Old', 50, 'active', null, '2000-01-01', null)
  insert.run('CPN-FUTURE', 'Future', 50, 'active', '2999-01-01', null, null)
  insert.run('CPN-VOID', 'Void', 50, 'void', null, null, null)
  insert.run('CPN-EMPTY', 'Empty', 0, 'active', null, null, null)
})
afterAll(() => db.close())
describe('checkout coupon suggestions', () => {
  it('requires a signed-in cashier', async () => { state.user = undefined; expect((await suggest('CPN')).success).toBe(false) })
  it('returns bearer and the selected customer coupons only', async () => {
    expect((await suggest('cpn', 'customer-1')).data.map((row: any) => row.code)).toEqual(['CPN-BEARER', 'CPN-OWN'])
    expect((await suggest('CPN')).data.map((row: any) => row.code)).toEqual(['CPN-BEARER'])
  })
  it('requires a prefix and treats SQL wildcard characters as literal input', async () => {
    expect((await suggest('')).data).toEqual([]); expect((await suggest('C')).data).toEqual([])
    expect((await suggest('CP%')).data).toEqual([]); expect((await suggest("CP' OR 1=1 --")).data).toEqual([])
  })
  it('limits responses to eight codes and exposes no customer details', async () => {
    for (let n=0;n<20;n++) db.prepare('INSERT INTO coupons VALUES (?, ?, 10, ?, NULL, NULL, NULL)').run(`CPN-${n}`, 'Gift', 'active')
    const result = await suggest('CPN'); expect(result.data).toHaveLength(8)
    expect(Object.keys(result.data[0]).sort()).toEqual(['balance', 'code', 'name'])
  })
})
