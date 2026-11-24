// With SYNC_PULL_OVERLAP_MINUTES the cloud re-sends rows the desktop already has (and may have edited since).
// The desktop pull must never overwrite a local row that still has an unsent sync_queue item.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

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

// Tables with their own pull rules (business-key matching, deactivation prompts, clear events) are covered elsewhere.
const SPECIAL = new Set(['stocks', 'roles', 'branches', 'products', 'users', 'data_clear_events', 'sync_queue', 'sync_pull_quarantine'])
const STATUSES = ['pending', 'processing', 'failed'] as const

let db: any
let service: any
const OLD = '2026-11-10T08:00:00.000Z'

function candidateTables(): { table: string; textCol: string }[] {
  const out: { table: string; textCol: string }[] = []
  const names = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`).all() as { name: string }[]
  for (const { name } of names) {
    if (SPECIAL.has(name)) continue
    const cols = db.prepare(`PRAGMA table_info(${name})`).all() as { name: string; type: string; pk: number }[]
    const hasId = cols.some(c => c.name === 'id' && c.pk === 1)
    const hasUpdated = cols.some(c => c.name === 'updated_at')
    const text = cols.find(c => /TEXT|CHAR/i.test(c.type) && !['id', 'updated_at', 'created_at', 'synced_at'].includes(c.name) && !c.name.endsWith('_id'))
    if (hasId && hasUpdated && text) out.push({ table: name, textCol: text.name })
  }
  return out
}

function insertLocal(table: string, id: string, textCol: string, value: string, updatedAt: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string; type: string; notnull: number; dflt_value: unknown }[]
  const row: Record<string, unknown> = {}
  for (const c of cols) {
    if (c.name === 'id') row.id = id
    else if (c.name === textCol) row[c.name] = value
    else if (c.name === 'updated_at') row[c.name] = updatedAt
    else if (c.notnull && c.dflt_value == null) row[c.name] = /INT|REAL|NUM|DEC/i.test(c.type) ? 1 : 'x'
  }
  const keys = Object.keys(row)
  db.prepare(`INSERT OR REPLACE INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map(k => row[k]))
  return row
}

describe('desktop pull vs unsent local edits (overlap safety)', () => {
  beforeAll(async () => {
    state.directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-overlap-'))
    const database = await import('../database')
    await database.initDatabase()
    db = database.getDb()
    const module = await import('../services/syncService')
    vi.spyOn(module.getSyncService(), 'runSoon').mockImplementation(() => {})
    service = new module.SyncService()
    db.pragma('foreign_keys = OFF')
  })
  afterAll(() => { db.pragma('foreign_keys = ON') })
  beforeEach(() => {
    state.data = {}
    db.prepare('DELETE FROM sync_queue').run()
    db.prepare('DELETE FROM sync_pull_quarantine').run()
  })

  const tables = () => candidateTables()

  it('covers a meaningful set of synced tables', () => {
    expect(tables().length).toBeGreaterThan(25)
  })

  it.each(STATUSES)('never overwrites a local row whose queue item is %s (all tables)', async (status) => {
    const failures: string[] = []
    let covered = 0
    for (const { table, textCol } of tables()) {
      const id = `ov-${table}`
      // Local edit made after the cloud copy (newer updated_at) and not pushed yet.
      // Tables with CHECK constraints a generic row cannot satisfy are skipped (counted below).
      try { insertLocal(table, id, textCol, 'LOCAL-EDIT', '2026-11-10 13:00:00') } catch { continue }
      covered++
      db.prepare(`INSERT INTO sync_queue (id, table_name, record_id, operation, payload, status) VALUES (?,?,?,?,?,?)`)
        .run(`q-${table}`, table, id, 'UPDATE', JSON.stringify({ id }), status)
      // The overlap window makes the cloud re-send an OLDER version of the same row.
      const cloudRow = { id, [textCol]: 'CLOUD-OLD', updated_at: OLD }
      const cloud = { changes: vi.fn().mockResolvedValue([cloudRow]), batchChanges: vi.fn().mockRejectedValue(new Error('no batch')) }
      await service.pullTables(cloud, [table]).catch(() => undefined)
      const after = db.prepare(`SELECT ${textCol} AS v FROM ${table} WHERE id=?`).get(id) as { v: string } | undefined
      if (after?.v !== 'LOCAL-EDIT') failures.push(`${table}: ${after?.v}`)
      const queued = db.prepare(`SELECT status FROM sync_queue WHERE id=?`).get(`q-${table}`) as { status: string } | undefined
      if (queued?.status !== status) failures.push(`${table}: queue item changed to ${queued?.status}`)
      db.prepare('DELETE FROM sync_queue').run()
      db.prepare(`DELETE FROM ${table} WHERE id=?`).run(id)
    }
    expect(failures).toEqual([])
    expect(covered).toBeGreaterThan(20)
  })

  it('control: a row with no pending item IS refreshed from the cloud (pull still works)', async () => {
    for (const table of ['customers', 'suppliers', 'categories', 'expense_categories']) {
      const spec = tables().find(t => t.table === table)
      if (!spec) continue
      const id = `ov-ctl-${table}`
      insertLocal(table, id, spec.textCol, 'LOCAL-SYNCED', '2026-11-10 07:00:00')
      const cloud = { changes: vi.fn().mockResolvedValue([{ id, [spec.textCol]: 'CLOUD-NEW', updated_at: '2026-11-10T09:00:00.000Z' }]), batchChanges: vi.fn().mockRejectedValue(new Error('no batch')) }
      await service.pullTables(cloud, [table])
      expect((db.prepare(`SELECT ${spec.textCol} AS v FROM ${table} WHERE id=?`).get(id) as { v: string }).v).toBe('CLOUD-NEW')
    }
  })
})
