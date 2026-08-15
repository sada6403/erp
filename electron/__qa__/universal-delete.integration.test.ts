// Regression/acceptance tests for the Universal Local + Cloud Delete system.
//
// Investigation before this work found the cross-device delete mechanism
// already fully generic: any handler that calls enqueuSync(table, id,
// 'DELETE', payload) automatically gets tombstoned server-side
// (backend/lib/sync.ts's applySyncOperation DELETE branch writes into
// sync_deletions) and picked up by every other device's own
// pullDeletions()/last_deletion_pull_timestamp cursor
// (electron/services/syncService.ts). That mechanism is not re-tested here
// (it requires a live cloud) — these tests instead pin the LOCAL half of
// the contract that this task actually changed: new delete handlers for
// entities that had none (Suppliers, Expense Categories, Expenses), the
// audit-logging gaps closed on already-existing handlers (Branches, Roles,
// Categories), and that every new/changed handler still enforces
// permission + branch-scope + business-rule checks before touching the
// database or the sync queue.
//
// Same real-database + mocked-electron harness as
// security-fixes.integration.test.ts — see that file's header for the
// better-sqlite3 rebuild prerequisite (npm rebuild better-sqlite3 to run
// under vitest, npx electron-rebuild -f -w better-sqlite3 to restore
// Electron compatibility afterward).
import { beforeAll, describe, it, expect, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'delete-qa-'))

const hoisted = vi.hoisted(() => ({ registry: new Map<string, (...args: unknown[]) => unknown>() }))

vi.mock('electron', () => {
  return {
    app: { getPath: () => tmpDir, isPackaged: false, whenReady: () => Promise.resolve(), on: () => {} },
    ipcMain: {
      handle: (channel: string, fn: (...args: unknown[]) => unknown) => { hoisted.registry.set(channel, fn) },
      on: () => {},
    },
    dialog: {
      showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
      showSaveDialog: async () => ({ canceled: true, filePath: undefined }),
    },
    net: { request: () => ({ on: () => {}, write: () => {}, end: () => {}, setHeader: () => {} }) },
    safeStorage: { isEncryptionAvailable: () => false, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() },
    BrowserWindow: class {},
    shell: { openExternal: async () => {} },
    protocol: { registerFileProtocol: () => {}, handle: () => {} },
    Menu: { setApplicationMenu: () => {}, buildFromTemplate: () => ({}) },
  }
})

const sharedStoreData: Record<string, unknown> = {}
vi.mock('electron-store', () => {
  class FakeStore {
    get(key: string, def?: unknown) { return key in sharedStoreData ? sharedStoreData[key] : def }
    set(key: string, val: unknown) { sharedStoreData[key] = val }
    delete(key: string) { delete sharedStoreData[key] }
  }
  return { default: FakeStore }
})

const fakeIpcMain = {
  handle: (channel: string, fn: (...args: unknown[]) => unknown) => { hoisted.registry.set(channel, fn) },
  on: () => {},
} as unknown as import('electron').IpcMain

async function call(channel: string, ...args: unknown[]): Promise<any> {
  const fn = hoisted.registry.get(channel)
  if (!fn) throw new Error(`No handler registered for channel: ${channel}`)
  return fn({} as any, ...args)
}

function setSession(session: Record<string, unknown> | null) {
  sharedStoreData.auth_user = session
}

function makeSession(opts: { id: string; branchId?: string | null; permissions: Record<string, unknown> }) {
  return {
    id: opts.id, name: opts.id, branch_id: opts.branchId ?? null,
    role: { permissions: opts.permissions },
    permissions: opts.permissions,
    scope: { level: opts.permissions.all ? 'owner' : 'branch', branchId: opts.branchId ?? null, agentId: null },
  }
}

let db: import('better-sqlite3').Database

beforeAll(async () => {
  const { initDatabase, getDb } = await import('../database')
  await initDatabase()
  db = getDb()

  const { registerAdminHandlers } = await import('../ipc/admin')
  registerAdminHandlers(fakeIpcMain)
})

function seedBranch(id: string, name: string, code: string) {
  db.prepare(`INSERT OR IGNORE INTO branches (id, name, code, address, phone, is_active) VALUES (?,?,?,?,?,1)`)
    .run(id, name, code, 'addr', '0000000000')
}
// logAudit()'s audit_logs.user_id column has a REFERENCES users(id) FK and
// this harness runs with foreign_keys=ON (matching production), so every
// session id that will trigger an audited delete needs a real users row —
// mirrors security-fixes.integration.test.ts's identical helper.
function seedRole(id: string, name: string) {
  db.prepare(`INSERT OR IGNORE INTO roles (id, name) VALUES (?,?)`).run(id, name)
}
function seedUser(id: string, branchId: string | null) {
  seedRole('qa-del-role', 'QA Delete Role')
  db.prepare(`INSERT OR IGNORE INTO users (id, branch_id, role_id, name, email, password_hash) VALUES (?,?,?,?,?,'x')`)
    .run(id, branchId, 'qa-del-role', id, `${id}@qa.test`)
}

describe('Universal Delete — Suppliers (new soft-delete handler)', () => {
  const admin    = makeSession({ id: 'u-del-admin', permissions: { all: true } })
  const noPerm   = makeSession({ id: 'u-del-noperm', permissions: { pos: true } })
  let supplierId: string

  beforeAll(() => {
    seedUser('u-del-admin', null)
    seedUser('u-del-noperm', null)
  })

  it('admin:suppliers:create then admin:suppliers:delete soft-deactivates the supplier', async () => {
    setSession(admin)
    const create = await call('admin:suppliers:create', { name: 'QA Supplier 1' })
    expect(create.success).toBe(true)
    supplierId = create.data.id

    const del = await call('admin:suppliers:delete', supplierId)
    expect(del.success).toBe(true)

    const row = db.prepare('SELECT is_active FROM suppliers WHERE id=?').get(supplierId) as { is_active: number }
    expect(row.is_active).toBe(0)
  })

  it('closes the audit-logging gap: deleting a supplier writes an audit_logs row', async () => {
    const audit = db.prepare(`SELECT * FROM audit_logs WHERE action='SUPPLIER_DELETED' AND record_id=?`).get(supplierId)
    expect(audit).toBeTruthy()
  })

  it('enqueues the deletion for cloud sync (soft delete → UPDATE op carrying is_active:0, so the row itself is not tombstoned/lost)', async () => {
    const row = db.prepare(`SELECT operation, payload FROM sync_queue WHERE table_name='suppliers' AND record_id=? ORDER BY created_at DESC LIMIT 1`).get(supplierId) as { operation: string; payload: string }
    expect(row.operation).toBe('UPDATE')
    expect(JSON.parse(row.payload).is_active).toBe(0)
  })

  it('deleting the same supplier again is rejected cleanly, not a silent no-op or a crash (idempotent-safe double-click protection)', async () => {
    setSession(admin)
    const del2 = await call('admin:suppliers:delete', supplierId)
    expect(del2.success).toBe(false)
    expect(String(del2.error)).toMatch(/already deleted/i)
  })

  it('a non-existent supplier id is rejected with a clear not-found error, never a raw SQL error', async () => {
    setSession(admin)
    const res = await call('admin:suppliers:delete', 'not-a-real-supplier-id')
    expect(res.success).toBe(false)
    expect(String(res.error)).toMatch(/not found/i)
  })

  it('a caller without inventory/all permission is rejected at the backend, regardless of any frontend button state', async () => {
    setSession(admin)
    const create = await call('admin:suppliers:create', { name: 'QA Supplier 2' })
    const id = create.data.id

    setSession(noPerm)
    const del = await call('admin:suppliers:delete', id)
    expect(del.success).toBe(false)

    const row = db.prepare('SELECT is_active FROM suppliers WHERE id=?').get(id) as { is_active: number }
    expect(row.is_active).toBe(1) // untouched — permission failure must not mutate anything
  })
})

describe('Universal Delete — Categories (existing handler, now audited + frontend-wired)', () => {
  const admin = makeSession({ id: 'u-del-cat-admin', permissions: { all: true } })
  let categoryId: string

  beforeAll(() => { seedUser('u-del-cat-admin', null) })

  it('admin:categories:delete soft-deactivates and now writes an audit log (previously a silent gap)', async () => {
    setSession(admin)
    const create = await call('admin:categories:create', { name: 'QA Category' })
    expect(create.success).toBe(true)
    categoryId = create.data.id

    const del = await call('admin:categories:delete', categoryId)
    expect(del.success).toBe(true)

    const row = db.prepare('SELECT is_active FROM categories WHERE id=?').get(categoryId) as { is_active: number }
    expect(row.is_active).toBe(0)

    const audit = db.prepare(`SELECT * FROM audit_logs WHERE action='CATEGORY_DELETED' AND record_id=?`).get(categoryId)
    expect(audit).toBeTruthy()
  })

  it('a not-found category id is rejected cleanly', async () => {
    const res = await call('admin:categories:delete', 'nonexistent-category')
    expect(res.success).toBe(false)
    expect(String(res.error)).toMatch(/not found/i)
  })
})

describe('Universal Delete — Expense Categories (new soft-delete handler)', () => {
  const admin  = makeSession({ id: 'u-del-ec-admin', permissions: { all: true } })
  const noPerm = makeSession({ id: 'u-del-ec-noperm', permissions: { pos: true } })

  beforeAll(() => {
    seedUser('u-del-ec-admin', null)
    seedUser('u-del-ec-noperm', null)
  })

  it('admin:expenseCategories:delete soft-deactivates and is audited', async () => {
    setSession(admin)
    const create = await call('admin:expenseCategories:create', { name: 'QA Expense Category' })
    expect(create.success).toBe(true)
    const id = create.data.id

    const del = await call('admin:expenseCategories:delete', id)
    expect(del.success).toBe(true)

    const row = db.prepare('SELECT is_active FROM expense_categories WHERE id=?').get(id) as { is_active: number }
    expect(row.is_active).toBe(0)
    const audit = db.prepare(`SELECT * FROM audit_logs WHERE action='EXPENSE_CATEGORY_DELETED' AND record_id=?`).get(id)
    expect(audit).toBeTruthy()
  })

  it('a caller without expenses/all permission is rejected', async () => {
    setSession(admin)
    const create = await call('admin:expenseCategories:create', { name: 'QA Expense Category 2' })
    const id = create.data.id

    setSession(noPerm)
    const del = await call('admin:expenseCategories:delete', id)
    expect(del.success).toBe(false)
  })
})

describe('Universal Delete — Expenses (new hard-delete handler, gated on zero payment activity)', () => {
  const BR = 'del-expense-branch'
  const BR_OTHER = 'del-expense-other-branch'
  const admin = makeSession({ id: 'u-del-exp-admin', permissions: { all: true } })
  const mgrOtherBranch = makeSession({ id: 'u-del-exp-other', branchId: BR_OTHER, permissions: { expenses: true } })

  beforeAll(() => {
    seedBranch(BR, 'Delete QA Branch', 'DELQA')
    seedBranch(BR_OTHER, 'Delete QA Other Branch', 'DELQA2')
    seedUser('u-del-exp-admin', null)
    seedUser('u-del-exp-other', BR_OTHER)
  })

  it('an expense with zero paid_amount can be hard-deleted, and the deletion is audited + enqueued as a real DELETE sync op', async () => {
    setSession(admin)
    const create = await call('admin:expenses:create', { branch_id: BR, amount: 500, paid_amount: 0, description: 'QA unpaid expense' })
    expect(create.success).toBe(true)
    const id = create.data.id

    const del = await call('admin:expenses:delete', id)
    expect(del.success).toBe(true)

    const row = db.prepare('SELECT id FROM expenses WHERE id=?').get(id)
    expect(row).toBeUndefined() // hard-deleted, not soft-flagged — this is a real transactional record with no is_active column

    const audit = db.prepare(`SELECT * FROM audit_logs WHERE action='EXPENSE_DELETED' AND record_id=?`).get(id)
    expect(audit).toBeTruthy()

    const sync = db.prepare(`SELECT operation FROM sync_queue WHERE table_name='expenses' AND record_id=? ORDER BY created_at DESC LIMIT 1`).get(id) as { operation: string }
    expect(sync.operation).toBe('DELETE')
  })

  it('an expense with a recorded payment CANNOT be deleted — business rule: do not blindly hard-delete a financial record with real activity', async () => {
    setSession(admin)
    const create = await call('admin:expenses:create', { branch_id: BR, amount: 1000, paid_amount: 400, description: 'QA partially paid expense' })
    const id = create.data.id

    const del = await call('admin:expenses:delete', id)
    expect(del.success).toBe(false)
    expect(String(del.error)).toMatch(/recorded payments/i)

    const row = db.prepare('SELECT id FROM expenses WHERE id=?').get(id)
    expect(row).toBeTruthy() // must still exist — blocked, not force-deleted
  })

  it('a branch-scoped caller cannot delete an expense belonging to a different branch', async () => {
    setSession(admin)
    const create = await call('admin:expenses:create', { branch_id: BR, amount: 200, paid_amount: 0, description: 'QA cross-branch expense' })
    const id = create.data.id

    setSession(mgrOtherBranch)
    const del = await call('admin:expenses:delete', id)
    expect(del.success).toBe(false)
    expect(String(del.error)).toMatch(/do not have access/i)

    const row = db.prepare('SELECT id FROM expenses WHERE id=?').get(id)
    expect(row).toBeTruthy()
  })
})

describe('Universal Delete — audit-logging gaps closed on Branches and Roles', () => {
  const admin = makeSession({ id: 'u-del-audit-admin', permissions: { all: true } })

  beforeAll(() => { seedUser('u-del-audit-admin', null) })

  it('admin:branches:delete now writes an audit log entry (previously silent)', async () => {
    setSession(admin)
    const id = 'del-audit-branch'
    seedBranch(id, 'Audit Gap Branch', 'AGB')

    const del = await call('admin:branches:delete', id)
    expect(del.success).toBe(true)

    const audit = db.prepare(`SELECT * FROM audit_logs WHERE action='BRANCH_DELETED' AND record_id=?`).get(id)
    expect(audit).toBeTruthy()
  })

  it('admin:roles:delete now writes an audit log entry (previously silent)', async () => {
    setSession(admin)
    const roleId = 'del-audit-role'
    db.prepare(`INSERT OR IGNORE INTO roles (id, name) VALUES (?,?)`).run(roleId, 'QA Deletable Role')

    const del = await call('admin:roles:delete', roleId)
    expect(del.success).toBe(true)

    const audit = db.prepare(`SELECT * FROM audit_logs WHERE action='ROLE_DELETED' AND record_id=?`).get(roleId)
    expect(audit).toBeTruthy()
  })
})
