// POS reports group by the Sri Lanka calendar day (UTC+05:30), not the UTC day of the stored timestamp.
import { beforeAll, describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'colombo-day-'))
const hoisted = vi.hoisted(() => ({ registry: new Map<string, (...args: unknown[]) => unknown>() }))
vi.mock('electron', () => ({
  app: { getPath: () => tmpDir, isPackaged: false, whenReady: () => Promise.resolve(), on: () => {} },
  ipcMain: { handle: (c: string, fn: (...a: unknown[]) => unknown) => { hoisted.registry.set(c, fn) }, on: () => {} },
  dialog: {}, net: {}, shell: {}, BrowserWindow: class {}, protocol: {}, Menu: {},
  safeStorage: { isEncryptionAvailable: () => false },
}))
const shared: Record<string, unknown> = {}
vi.mock('electron-store', () => ({ default: class {
  get(k: string, d?: unknown) { return k in shared ? shared[k] : d }
  set(k: string, v: unknown) { shared[k] = v }
  delete(k: string) { delete shared[k] }
} }))
const fakeIpc = { handle: (c: string, fn: (...a: unknown[]) => unknown) => { hoisted.registry.set(c, fn) }, on: () => {} } as unknown as import('electron').IpcMain
const call = (ch: string, ...a: unknown[]) => (hoisted.registry.get(ch) as any)({}, ...a)

let db: import('better-sqlite3').Database
const BR = 'cd-branch'

beforeAll(async () => {
  const { initDatabase, getDb } = await import('../database')
  await initDatabase()
  db = getDb()
  const { registerAnalyticsHandlers } = await import('../ipc/analytics')
  registerAnalyticsHandlers(fakeIpc)
  db.pragma('foreign_keys = OFF')
  db.prepare(`INSERT OR IGNORE INTO branches (id,name,code,address,phone,is_active) VALUES (?,?,?,?,?,1)`).run(BR, 'CD', 'CDB', 'a', '0')
  const ins = (id: string, at: string, total: number) => db.prepare(
    `INSERT INTO invoices (id,invoice_number,branch_id,cashier_id,status,subtotal,total_amount,discount_amount,tax_amount,delivery_fee,created_at) VALUES (?,?,?,'cd-u','completed',?,?,0,0,0,?)`)
    .run(id, `INV-${id}`, BR, total, total, at)
  ins('late-utc', '2026-11-10 19:00:00', 100)   // 00:30 on 11 Nov in Colombo
  ins('early-utc', '2026-11-10 17:00:00', 40)   // 22:30 on 10 Nov in Colombo
  shared.auth_user = { id: 'u', branch_id: BR, role: { permissions: { all: true } } }
})

describe('report day grouping uses the Colombo calendar day', () => {
  it('salesSummary: a sale at 19:00Z lands on 11 Nov, one at 17:00Z on 10 Nov', async () => {
    const r = await call('analytics:salesSummary', { date_from: '2026-11-10', date_to: '2026-11-11', branch_id: BR })
    const byDate = Object.fromEntries(r.data.map((x: any) => [x.date, x.total_revenue]))
    expect(byDate).toEqual({ '2026-11-11': 100, '2026-11-10': 40 })
  })
  it('dailyReport: filters by the Colombo day', async () => {
    const a = await call('analytics:dailyReport', '2026-11-11')
    const b = await call('analytics:dailyReport', '2026-11-10')
    expect(a.data.summary.revenue).toBe(100)
    expect(b.data.summary.revenue).toBe(40)
  })
})
