import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { createRequire } from 'module'

const state = vi.hoisted(() => ({
  data: {} as Record<string, any>,
  directory: '',
  rendererEvents: [] as Array<{ channel: string; payload: unknown }>,
}))
vi.mock('electron-store', () => ({ default: class {
  get(key: string, fallback?: unknown) { return state.data[key] ?? fallback }
  set(key: string, value: unknown) { state.data[key] = value }
  delete(key: string) { delete state.data[key] }
} }))
vi.mock('electron', () => ({
  app: { getPath: () => state.directory, isPackaged: false },
  BrowserWindow: { getAllWindows: () => [{
    isDestroyed: () => false,
    webContents: { send: (channel: string, payload: unknown) => state.rendererEvents.push({ channel, payload }) },
  }] },
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
    state.rendererEvents = []
    db.prepare('DELETE FROM sync_queue').run()
    db.prepare('DELETE FROM sync_pull_quarantine').run()
  })

  it('persists and immediately notifies the renderer about a company-wide clear event', async () => {
    const eventId = 'clear-event-company-wide'
    const cloud = { changes: vi.fn().mockResolvedValue([{
      id: eventId,
      cleared_by: 'Company Admin',
      cleared_at: date,
      created_at: date,
      updated_at: date,
    }]) }

    await service.pullTables(cloud, ['data_clear_events'])

    expect(state.data.pending_clear_event_id).toBe(eventId)
    expect(state.rendererEvents).toContainEqual({
      channel: 'app:dataClearEvent',
      payload: { eventId },
    })
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

  it('advances empty tables using the server batch checkpoint', async () => {
    const checkpoint = '2026-09-27T09:00:00.000Z'
    const cloud = {
      batchChanges: vi.fn().mockResolvedValue({ customers: { data: [], checkpoint, truncated: false } }),
      changes: vi.fn().mockRejectedValue(new Error('per-table fallback should not run')),
    }
    await service.pullTables(cloud, ['customers'])
    expect(cloud.batchChanges).toHaveBeenCalledWith([
      { table: 'customers', since: '1970-01-01T00:00:00.000Z' },
    ])
    expect(cloud.changes).not.toHaveBeenCalled()
    expect(state.data.sync_table_cursors_v2.customers).toBe(checkpoint)
  })

  it('quarantines a failed row while applying unrelated valid rows and advancing the cursor', async () => {
    const cloud = { changes: vi.fn().mockResolvedValue([
      { id: 'bad-parent', name: 'Deferred', branch_id: 'branch-not-present', updated_at: date },
      { id: 'valid-customer', name: 'Valid', updated_at: date },
    ]) }
    await service.pullTables(cloud, ['customers'])
    expect(db.prepare("SELECT id FROM customers WHERE id='valid-customer'").get()).toBeTruthy()
    expect(state.data.sync_table_cursors_v2?.customers).toBeTruthy()
    expect(db.prepare("SELECT status FROM sync_pull_quarantine WHERE table_name='customers' AND record_id='bad-parent'").get().status).toBe('pending')
    db.prepare("INSERT INTO branches(id,name) VALUES ('branch-not-present','Recovered branch')").run()
    await service.pullTables(cloud, ['customers'])
    expect(db.prepare("SELECT id FROM customers WHERE id='bad-parent'").get()).toBeTruthy()
    expect(db.prepare("SELECT status FROM sync_pull_quarantine WHERE table_name='customers' AND record_id='bad-parent'").get().status).toBe('resolved')
  })

  it('repairs an exact missing parent without rewinding its whole table cursor', async () => {
    const categoryId = 'category-exact-repair'
    const productId = 'product-exact-repair'
    const cloud = {
      changes: vi.fn().mockResolvedValue([{
        id: productId,
        sku: 'EXACT-REPAIR',
        name: 'Exact repair product',
        selling_price: 10,
        category_id: categoryId,
        updated_at: date,
      }]),
      related: vi.fn().mockResolvedValue([{
        id: categoryId,
        name: 'Recovered category',
        updated_at: '2025-01-01T00:00:00.000Z',
      }]),
    }

    state.data.sync_table_cursors_v2 = { categories: '2026-09-27T00:00:00.000Z' }
    await service.pullTables(cloud, ['products'])

    expect(cloud.related).toHaveBeenCalledTimes(1)
    expect(cloud.related).toHaveBeenCalledWith('categories', 'id', [categoryId])
    expect(db.prepare('SELECT name FROM categories WHERE id=?').get(categoryId).name).toBe('Recovered category')
    expect(db.prepare('SELECT category_id FROM products WHERE id=?').get(productId).category_id).toBe(categoryId)
    expect(state.data.sync_table_cursors_v2.categories).toBe('2026-09-27T00:00:00.000Z')
  })

  it('protects failed local uploads without blocking the table checkpoint', async () => {
    db.prepare("INSERT INTO customers(id,name) VALUES ('local-edit','Local')").run()
    await enqueue('customers', 'local-edit', 'UPDATE', { name: 'Local' })
    db.prepare("UPDATE sync_queue SET status='failed'").run()
    await service.pullTables({ changes: async () => [{ id: 'local-edit', name: 'Cloud', updated_at: date }] }, ['customers'])
    expect(db.prepare("SELECT name FROM customers WHERE id='local-edit'").get().name).toBe('Local')
    expect(state.data.sync_table_cursors_v2?.customers).toBeTruthy()
  })

  it('stages cloud deactivation using real schema column names', async () => {
    db.prepare("INSERT INTO products(id,sku,name,selling_price) VALUES ('deactivate','DEACT','Item',1)").run()
    await service.pullTables({ changes: async () => [{ id: 'deactivate', is_active: 0, updated_at: date }] }, ['products'])
    expect(db.prepare("SELECT record_name FROM pending_sync_deletions WHERE record_id='deactivate'").get().record_name).toBe('Item')
    expect(db.prepare("SELECT is_active FROM products WHERE id='deactivate'").get().is_active).toBe(1)
  })

  it('isolates ambiguous duplicate balances without blocking unrelated sync', async () => {
    const rows = [1, 2].map((quantity, i) => ({ id: `dupe-${i}`, product_id: 'deactivate', branch_id: 'branch-not-present', quantity, updated_at: date }))
    await service.pullTables({ changes: async () => rows }, ['stocks'])
    expect(state.data.sync_pull_errors).toEqual({})
    expect(db.prepare("SELECT COUNT(*) AS n FROM stocks WHERE id LIKE 'dupe-%'").get().n).toBe(0)
    expect(db.prepare("SELECT COUNT(*) AS n FROM sync_pull_quarantine WHERE table_name='stocks' AND status='pending'").get().n).toBe(2)
  })

  it('isolates a blocked deletion, advances its cursor, and repairs it later', async () => {
    db.prepare("INSERT INTO branches(id,name) VALUES ('delete-parent','Delete parent')").run()
    db.prepare("INSERT INTO customers(id,name,branch_id) VALUES ('delete-child','Delete child','delete-parent')").run()
    db.prepare(`INSERT INTO sync_pull_quarantine
      (id,table_name,record_id,operation,payload,attempts,last_error,status)
      VALUES ('UPSERT:branches:delete-parent','branches','delete-parent','UPSERT','{}',3,'FOREIGN KEY constraint failed','pending')`).run()
    const deletedAt = '2026-09-27T10:00:00.000Z'
    const cloud = { deletions: vi.fn()
      .mockResolvedValueOnce([{ table_name: 'branches', record_id: 'delete-parent', deleted_at: deletedAt }])
      .mockResolvedValueOnce([]) }

    await service.pullDeletions(cloud, db)
    expect(db.prepare("SELECT id FROM branches WHERE id='delete-parent'").get()).toBeTruthy()
    expect(db.prepare("SELECT status FROM sync_pull_quarantine WHERE record_id='delete-parent' AND operation='DELETE'").get().status).toBe('pending')
    expect(state.data.last_deletion_pull_timestamp).toBeTruthy()

    db.prepare("DELETE FROM customers WHERE id='delete-child'").run()
    db.prepare("UPDATE sync_pull_quarantine SET next_attempt_at=datetime('now','-1 second') WHERE record_id='delete-parent'").run()
    await service.pullDeletions(cloud, db)
    expect(db.prepare("SELECT id FROM branches WHERE id='delete-parent'").get()).toBeUndefined()
    expect(db.prepare("SELECT status FROM sync_pull_quarantine WHERE record_id='delete-parent' AND operation='DELETE'").get().status).toBe('resolved')
    expect(db.prepare("SELECT status FROM sync_pull_quarantine WHERE record_id='delete-parent' AND operation='UPSERT'").get().status).toBe('resolved')
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

  it('completes a healthy cycle while failed uploads remain isolated for retry', async () => {
    db.prepare(`INSERT INTO sync_queue
      (id,table_name,record_id,operation,payload,attempts,status)
      VALUES ('failed-outbox','customers','failed-record','INSERT','{}',5,'failed')`).run()
    const cycleService = new (service.constructor as any)()
    vi.spyOn(cycleService, 'getCloudApi').mockReturnValue({})
    vi.spyOn(cycleService, 'checkOnline').mockResolvedValue(true)
    vi.spyOn(cycleService, 'processBatch').mockResolvedValue(undefined)
    vi.spyOn(cycleService, 'pullChanges').mockResolvedValue(undefined)
    vi.spyOn(cycleService, 'syncBranding').mockResolvedValue(undefined)
    vi.spyOn(cycleService, 'reconcileSupportSession').mockResolvedValue(undefined)
    vi.spyOn(cycleService, 'reconcileDefaultRolesFromCloud').mockResolvedValue(undefined)
    vi.spyOn(cycleService, 'reconcileUserRolesFromCloud').mockResolvedValue(undefined)
    vi.spyOn(cycleService, 'needsBootstrapPull').mockReturnValue(false)

    expect(await cycleService.runOnce()).toBe(true)
    expect(state.data.sync_cycle_error).toBeUndefined()
    expect(state.data.last_successful_sync_v2_at).toBeTruthy()
    expect(state.data.sync_cycle_warning).toContain('upload(s) queued for background retry')
    cycleService.stop()
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

  it('repairs a missing Smart Buy member chain before retrying its contribution', async () => {
    db.prepare("INSERT INTO customers(id,name) VALUES ('sync-customer-parent','Sync Customer')").run()
    db.prepare(`INSERT INTO chit_schemes
      (id,name,member_count,cycle_count,contribution_amount,chit_value,start_date)
      VALUES ('sync-scheme-parent','Sync Scheme',1,1,1000,1000,'2026-09-01')`).run()
    db.prepare(`INSERT INTO chit_members(id,scheme_id,customer_id,join_order)
      VALUES ('sync-member-parent','sync-scheme-parent','sync-customer-parent',1)`).run()
    db.prepare(`INSERT INTO chit_contributions(id,scheme_id,member_id,cycle_no,amount)
      VALUES ('sync-contribution-child','sync-scheme-parent','sync-member-parent',1,1000)`).run()
    await enqueue('chit_contributions', 'sync-contribution-child', 'INSERT', {
      id: 'sync-contribution-child', scheme_id: 'sync-scheme-parent', member_id: 'sync-member-parent', cycle_no: 1, amount: 1000,
    })
    const item = db.prepare('SELECT * FROM sync_queue').get()
    const cloud = { push: vi.fn(async (request: any) => {
      if (request.table === 'chit_contributions' && cloud.push.mock.calls.filter((call: any[]) => call[0].table === 'chit_contributions').length === 1) {
        throw new Error('Cannot add or update a child row: FOREIGN KEY (`member_id`) REFERENCES `chit_members` (`id`)')
      }
      if (request.table === 'chit_members' && cloud.push.mock.calls.filter((call: any[]) => call[0].table === 'chit_members').length === 1) {
        throw new Error('Cannot add or update a child row: FOREIGN KEY (`scheme_id`) REFERENCES `chit_schemes` (`id`)')
      }
    }) }

    await service.syncItem(cloud, item, db)

    expect(cloud.push.mock.calls.map((call: any[]) => call[0].table)).toEqual([
      'chit_contributions', 'chit_members', 'chit_schemes', 'chit_members', 'chit_contributions',
    ])
    expect(db.prepare('SELECT status FROM sync_queue WHERE id=?').get(item.id).status).toBe('synced')
  })

  it('repairs a Smart Buy parent referenced only by the full local row during a partial update', async () => {
    db.prepare(`INSERT INTO chit_scheme_templates
      (id,scheme_name,monthly_contribution_amount,duration_months,minimum_members,product_value)
      VALUES ('sync-template-parent','Template',1000,12,10,12000)`).run()
    db.prepare(`INSERT INTO chit_schemes
      (id,name,template_id,member_count,cycle_count,contribution_amount,chit_value,start_date,status)
      VALUES ('sync-scheme-partial','Scheme','sync-template-parent',10,12,1000,12000,'2026-09-01','active')`).run()
    await enqueue('chit_schemes', 'sync-scheme-partial', 'UPDATE', { id: 'sync-scheme-partial', status: 'cancelled' })
    const item = db.prepare('SELECT * FROM sync_queue').get()
    const cloud = { push: vi.fn(async (request: any) => {
      if (request.table === 'chit_schemes' && cloud.push.mock.calls.filter((call: any[]) => call[0].table === 'chit_schemes').length === 1) {
        throw new Error('Cannot add or update a child row: FOREIGN KEY (`template_id`) REFERENCES `chit_scheme_templates` (`id`) is missing')
      }
    }) }

    await service.syncItem(cloud, item, db)

    expect(cloud.push.mock.calls.map((call: any[]) => call[0].table)).toEqual([
      'chit_schemes', 'chit_scheme_templates', 'chit_schemes',
    ])
    expect(cloud.push.mock.calls[1][0]).toMatchObject({
      operation: 'INSERT', recordId: 'sync-template-parent', record: { scheme_name: 'Template' },
    })
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

  it('backs off permanent upload failures and wakes immediately for a new edit', async () => {
    await enqueue('products', 'backoff-record', 'INSERT', { id: 'backoff-record', name: 'Backoff' })
    db.prepare("UPDATE sync_queue SET attempts=4, failure_cycles=1 WHERE record_id='backoff-record'").run()
    const item = db.prepare("SELECT * FROM sync_queue WHERE record_id='backoff-record'").get()
    await service.syncItem({ push: vi.fn().mockRejectedValue(new Error('permanent validation failure')) }, item, db)

    const failed = db.prepare("SELECT status,failure_cycles,next_retry_at FROM sync_queue WHERE record_id='backoff-record'").get()
    expect(failed.status).toBe('failed')
    expect(failed.failure_cycles).toBe(2)
    expect(failed.next_retry_at).toBeTruthy()
    service.resetFailedForAutoRetry()
    expect(db.prepare("SELECT status FROM sync_queue WHERE record_id='backoff-record'").get().status).toBe('failed')

    await enqueue('products', 'backoff-record', 'UPDATE', { name: 'Corrected' })
    const corrected = db.prepare("SELECT status,failure_cycles,next_retry_at FROM sync_queue WHERE record_id='backoff-record'").get()
    expect(corrected).toMatchObject({ status: 'pending', failure_cycles: 0, next_retry_at: null })
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
