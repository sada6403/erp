import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { createRequire } from 'module'

const state = vi.hoisted(() => ({ data: {} as Record<string, any>, directory: '' }))
vi.mock('electron-store', () => ({ default: class {
  get(key: string, fallback?: unknown) { return state.data[key] ?? fallback }
  set(key: string, value: unknown) { state.data[key] = value }
  delete(key: string) { delete state.data[key] }
} }))
vi.mock('electron', () => ({
  app: { getPath: () => state.directory, isPackaged: false },
  BrowserWindow: { getAllWindows: () => [] },
}))
vi.mock('../ipc/settings', () => ({ decryptSecret: (v: unknown) => String(v || ''), CLOUD_BRANDING_KEYS: [], pushBrandingToCloud: vi.fn() }))
vi.mock('../services/licenseService', () => ({ isDeviceLocked: () => false, reportDeviceRevoked: vi.fn() }))

let db: any
let service: any
let enqueue: typeof import('../services/syncQueue').enqueuSync
const date = '2026-09-26T12:00:00.000Z'

describe('Sync recovery and durable outbox', () => {
  beforeAll(async () => {
    state.directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-reliability-'))
    const database = await import('../database')
    await database.initDatabase()
    db = database.getDb()
    const module = await import('../services/syncService')
    vi.spyOn(module.getSyncService(), 'runSoon').mockImplementation(() => {})
    service = new module.SyncService()
    enqueue = (await import('../services/syncQueue')).enqueuSync
  })
  beforeEach(() => {
    state.data = {}
    db.prepare('DELETE FROM sync_queue').run()
  })
  afterEach(() => service.stop())
  afterAll(() => { service.stop(); db.close(); fs.rmSync(state.directory, { recursive: true, force: true }) })

  it('preserves an offline create followed by a partial edit', async () => {
    await enqueue('products', 'offline-product', 'INSERT', { id: 'offline-product', name: 'Desk', sku: 'DESK', selling_price: 10 })
    await enqueue('products', 'offline-product', 'UPDATE', { selling_price: 20 })
    const rows = db.prepare('SELECT * FROM sync_queue').all()
    expect(rows).toHaveLength(1)
    expect(rows[0].operation).toBe('INSERT')
    expect(JSON.parse(rows[0].payload)).toMatchObject({ name: 'Desk', sku: 'DESK', selling_price: 20 })
  })

  it('does not acknowledge an edit made while an earlier payload is uploading', async () => {
    await enqueue('products', 'inflight', 'INSERT', { id: 'inflight', name: 'Old' })
    const item = db.prepare('SELECT * FROM sync_queue').get()
    db.prepare("UPDATE sync_queue SET status='processing' WHERE id=?").run(item.id)
    let resolve!: () => void
    const cloud = { push: vi.fn(() => new Promise<void>(done => { resolve = done })) }
    const upload = service.syncItem(cloud, item, db)
    await enqueue('products', 'inflight', 'UPDATE', { name: 'New' })
    resolve()
    await upload
    const rows = db.prepare('SELECT * FROM sync_queue').all()
    expect(rows).toHaveLength(2)
    expect(rows.find((r: any) => r.id === item.id).status).toBe('synced')
    expect(JSON.parse(rows.find((r: any) => r.status === 'pending').payload).name).toBe('New')
  })

  it('retries a failed table from epoch despite an old global success cursor', async () => {
    state.data.last_pull_timestamp = '2030-01-01T00:00:00.000Z'
    const cloud = { changes: vi.fn().mockRejectedValueOnce(new Error('schema unavailable')).mockResolvedValueOnce([
      { id: 'recover-customer', name: 'Recovered', updated_at: date },
    ]) }
    await expect(service.pullTables(cloud, ['customers'])).rejects.toThrow('incomplete')
    expect(state.data.sync_table_cursors_v2?.customers).toBeUndefined()
    await service.pullTables(cloud, ['customers'])
    expect(cloud.changes.mock.calls[1][1]).toBe('1970-01-01T00:00:00.000Z')
    expect(db.prepare("SELECT name FROM customers WHERE id='recover-customer'").get().name).toBe('Recovered')
    expect(state.data.sync_pull_errors).toEqual({})
  })

  it('keeps a failed row retryable while applying unrelated valid rows', async () => {
    const cloud = { changes: vi.fn().mockResolvedValue([
      { id: 'bad-parent', name: 'Deferred', branch_id: 'branch-not-present', updated_at: date },
      { id: 'valid-customer', name: 'Valid', updated_at: date },
    ]) }
    await expect(service.pullTables(cloud, ['customers'])).rejects.toThrow('incomplete')
    expect(db.prepare("SELECT id FROM customers WHERE id='valid-customer'").get()).toBeTruthy()
    expect(state.data.sync_table_cursors_v2?.customers).toBeUndefined()
    db.prepare("INSERT INTO branches(id,name) VALUES ('branch-not-present','Recovered branch')").run()
    await service.pullTables(cloud, ['customers'])
    expect(db.prepare("SELECT id FROM customers WHERE id='bad-parent'").get()).toBeTruthy()
  })

  it('protects failed local uploads and does not advance their table checkpoint', async () => {
    db.prepare("INSERT INTO customers(id,name) VALUES ('local-edit','Local')").run()
    await enqueue('customers', 'local-edit', 'UPDATE', { name: 'Local' })
    db.prepare("UPDATE sync_queue SET status='failed'").run()
    await expect(service.pullTables({ changes: async () => [{ id: 'local-edit', name: 'Cloud', updated_at: date }] }, ['customers']))
      .rejects.toThrow('incomplete')
    expect(db.prepare("SELECT name FROM customers WHERE id='local-edit'").get().name).toBe('Local')
    expect(state.data.sync_table_cursors_v2?.customers).toBeUndefined()
  })

  it('stages cloud deactivation using real schema column names', async () => {
    db.prepare("INSERT INTO products(id,sku,name,selling_price) VALUES ('deactivate','DEACT','Item',1)").run()
    await service.pullTables({ changes: async () => [{ id: 'deactivate', is_active: 0, updated_at: date }] }, ['products'])
    expect(db.prepare("SELECT record_name FROM pending_sync_deletions WHERE record_id='deactivate'").get().record_name).toBe('Item')
    expect(db.prepare("SELECT is_active FROM products WHERE id='deactivate'").get().is_active).toBe(1)
  })

  it('rejects ambiguous duplicate balances rather than selecting the last row', async () => {
    const rows = [1, 2].map((quantity, i) => ({ id: `dupe-${i}`, product_id: 'deactivate', branch_id: 'branch-not-present', quantity, updated_at: date }))
    await expect(service.pullTables({ changes: async () => rows }, ['stocks'])).rejects.toThrow('incomplete')
    expect(state.data.sync_pull_errors.stocks).toContain('Conflicting duplicate')
    expect(db.prepare("SELECT COUNT(*) AS n FROM stocks WHERE id LIKE 'dupe-%'").get().n).toBe(0)
  })

  it('does not replace a parent and cascade-delete its local children', () => {
    db.exec('CREATE TABLE sync_parent_test(id TEXT PRIMARY KEY, name TEXT); CREATE TABLE sync_child_test(id TEXT PRIMARY KEY,parent_id TEXT REFERENCES sync_parent_test(id) ON DELETE CASCADE)')
    db.exec("INSERT INTO sync_parent_test VALUES ('p','Old'); INSERT INTO sync_child_test VALUES ('c','p')")
    service.insertFiltered(db, 'sync_parent_test', { id: 'p', name: 'New' })
    expect(db.prepare('SELECT * FROM sync_child_test').all()).toHaveLength(1)
  })

  it('does not claim success when cloud configuration is absent', async () => {
    expect(await service.runOnce()).toBe(false)
    expect(state.data.last_successful_sync_v2_at).toBeUndefined()
    expect(state.data.sync_cycle_error).toContain('not configured')
  })

  it('repairs a legacy UPDATE-only event by uploading the full local record', async () => {
    db.prepare("INSERT INTO customers(id,name,phone) VALUES ('legacy-update','Full Name','123')").run()
    await enqueue('customers', 'legacy-update', 'UPDATE', { name: 'Edited' })
    const item = db.prepare('SELECT * FROM sync_queue').get()
    const cloud = { push: vi.fn().mockRejectedValueOnce(new Error('Sync target is missing; resend the complete record as INSERT')).mockResolvedValueOnce(undefined) }
    await service.syncItem(cloud, item, db)
    expect(cloud.push.mock.calls[1][0]).toMatchObject({ operation: 'INSERT', record: { id: 'legacy-update', name: 'Edited', phone: '123' } })
    expect(db.prepare('SELECT status FROM sync_queue WHERE id=?').get(item.id).status).toBe('synced')
  })

  it('does not send a later deletion while its earlier create is failing', async () => {
    await enqueue('products', 'ordered', 'INSERT', { id: 'ordered', name: 'New' })
    const first = db.prepare('SELECT * FROM sync_queue').get()
    db.prepare("UPDATE sync_queue SET status='processing'").run()
    await enqueue('products', 'ordered', 'DELETE', { id: 'ordered' })
    db.prepare("UPDATE sync_queue SET status='pending' WHERE id=?").run(first.id)
    const cloud = { push: vi.fn().mockRejectedValue(new Error('temporarily unavailable')) }
    await service.processBatch(cloud)
    expect(cloud.push).toHaveBeenCalledTimes(1)
    expect(cloud.push.mock.calls[0][0].operation).toBe('INSERT')
    expect(db.prepare("SELECT COUNT(*) AS n FROM sync_queue WHERE status='pending'").get().n).toBe(2)
  })

  it('commits maintenance changes and their outbox together', () => {
    const { beginMaintenance } = createRequire(path.resolve('package.json'))('./scripts/lib/maintenance-outbox.cjs')
    const finish = beginMaintenance(db, ['customers'])
    db.prepare("INSERT INTO customers(id,name) VALUES ('maintenance','Queued')").run()
    expect(finish()).toBe(1)
    expect(db.inTransaction).toBe(false)
    expect(db.prepare("SELECT operation FROM sync_queue WHERE record_id='maintenance'").get().operation).toBe('INSERT')
  })
})
