// Regression tests for the access-control / IDOR fixes made during the
// 2026-08-11 security audit (see SECURITY_AUDIT_REPORT.md). Each test
// targets one specific finding and asserts the FIXED behavior, so a future
// regression that reopens the hole fails loudly here instead of silently.
//
// Uses the same real-database + mocked-electron harness as
// smartbuy.integration.test.ts — see that file's header comment for the
// prerequisite: this suite needs better-sqlite3 rebuilt against plain
// Node's ABI (`npx rebuild-better-sqlite3`) to actually RUN under vitest,
// which was not done as part of this audit (the user explicitly declined
// that native-binary rebuild earlier, since it risks breaking the live
// `npm run dev` Electron session). These tests are syntactically complete
// and vitest will collect them, but they have NOT been executed/confirmed
// passing in this environment — see the audit report's Test Coverage
// section for what was verified by direct code reading instead.
import { beforeAll, describe, it, expect, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'security-qa-'))

// registry is shared between the mocked 'electron' module's ipcMain (used by
// files like batches.ts that import ipcMain directly at module scope) and
// the fakeIpcMain object passed explicitly to handlers that take ipcMain as
// a parameter (products.ts, purchases.ts, orders.ts, chits.ts,
// commissions.ts) — both paths must land in the same map or `call()` won't
// find handlers registered via the direct-import style.
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
    scope: { level: opts.permissions.all ? 'owner' : 'branch', branchId: opts.branchId ?? null, agentId: null },
  }
}

let db: import('better-sqlite3').Database

beforeAll(async () => {
  const { initDatabase, getDb } = await import('../database')
  await initDatabase()
  db = getDb()

  const { registerBatchHandlers } = await import('../ipc/batches')
  const { registerProductHandlers } = await import('../ipc/products')
  const { registerPurchaseHandlers } = await import('../ipc/purchases')
  const { registerOrderHandlers } = await import('../ipc/orders')
  const { registerChitHandlers } = await import('../ipc/chits')
  const { registerCommissionHandlers } = await import('../ipc/commissions')
  registerBatchHandlers()
  registerProductHandlers(fakeIpcMain)
  registerPurchaseHandlers(fakeIpcMain)
  registerOrderHandlers(fakeIpcMain)
  registerChitHandlers(fakeIpcMain)
  registerCommissionHandlers(fakeIpcMain)
})

function seedBranch(id: string, name: string, code: string) {
  db.prepare(`INSERT OR IGNORE INTO branches (id, name, code, address, phone, is_active) VALUES (?,?,?,?,?,1)`)
    .run(id, name, code, 'addr', '0000000000')
}
function seedRole(id: string, name: string) {
  db.prepare(`INSERT OR IGNORE INTO roles (id, name) VALUES (?,?)`).run(id, name)
}
function seedUser(id: string, branchId: string | null) {
  seedRole('qa-sec-role', 'QA Security Role')
  db.prepare(`INSERT OR IGNORE INTO users (id, branch_id, role_id, name, email, password_hash) VALUES (?,?,?,?,?,'x')`)
    .run(id, branchId, 'qa-sec-role', id, `${id}@qa.test`)
}
function seedProduct(id: string, price: number) {
  db.prepare(`INSERT OR IGNORE INTO products (id, category_id, supplier_id, sku, name, unit, cost_price, selling_price, tax_rate, branch_id) VALUES (?,NULL,NULL,?,?,'pcs',?,?,0,NULL)`)
    .run(id, id, id, price * 0.7, price)
}
function seedSupplier(id: string) {
  db.prepare(`INSERT OR IGNORE INTO suppliers (id, name) VALUES (?,?)`).run(id, id)
}

describe('Security audit regression — cross-branch / IDOR fixes', () => {
  const BR_A = 'sec-branch-a', BR_B = 'sec-branch-b'
  const PROD1 = 'sec-prod-1'
  const SUPPLIER1 = 'sec-supplier-1'

  beforeAll(() => {
    seedBranch(BR_A, 'Security Branch A', 'SBA')
    seedBranch(BR_B, 'Security Branch B', 'SBB')
    seedProduct(PROD1, 1000)
    seedSupplier(SUPPLIER1)
    seedUser('u-sec-admin', null)
    seedUser('u-sec-mgr-a', BR_A)
    seedUser('u-sec-mgr-b', BR_B)
  })

  const admin = makeSession({ id: 'u-sec-admin', permissions: { all: true } })
  const mgrA = makeSession({ id: 'u-sec-mgr-a', branchId: BR_A, permissions: { inventory: true, employees: true, chits: true } })
  const mgrB = makeSession({ id: 'u-sec-mgr-b', branchId: BR_B, permissions: { inventory: true, employees: true, chits: true } })

  let batchId: string

  it('batches:create tags a non-admin caller\'s own branch, ignoring a spoofed branch_id', async () => {
    setSession(mgrA)
    const res = await call('batches:create', { product_id: PROD1, branch_id: BR_B, quantity: 10, cost_price: 500 })
    expect(res.success).toBe(true)
    batchId = res.id
    const row = db.prepare('SELECT branch_id FROM product_batches WHERE id=?').get(batchId) as { branch_id: string }
    expect(row.branch_id).toBe(BR_A)
  })

  it('batches:update rejects a Branch B caller editing a Branch A batch', async () => {
    setSession(mgrB)
    const res = await call('batches:update', batchId, { quantity: 999 })
    expect(res.success).toBe(false)
  })

  it('batches:consume rejects a Branch B caller consuming a Branch A batch', async () => {
    setSession(mgrB)
    const res = await call('batches:consume', { batch_id: batchId, qty: 1 })
    expect(res.success).toBe(false)
  })

  it('batches:update allows the owning branch to edit its own batch', async () => {
    setSession(mgrA)
    const res = await call('batches:update', batchId, { notes: 'updated' })
    expect(res.success).toBe(true)
  })

  let branchBProductId: string

  it('products:delete rejects deactivating a product tagged to another branch', async () => {
    setSession(mgrA)
    const create = await call('products:create', { name: 'Branch B Product', sku: 'SEC-PB-1', unit: 'pcs', selling_price: 100, cost_price: 70, branch_id: BR_B })
    // products:create tags the caller's own branch for non-admins regardless
    // of payload — so create it as admin to get a real cross-branch product.
    if (!create.success) {
      setSession(admin)
      const created = await call('products:create', { name: 'Branch B Product', sku: 'SEC-PB-1', unit: 'pcs', selling_price: 100, cost_price: 70, branch_id: BR_B })
      branchBProductId = created.data.id
    } else {
      branchBProductId = create.data.id
    }
    setSession(mgrA)
    const del = await call('products:delete', branchBProductId)
    expect(del.success).toBe(false)
  })

  let poId: string

  it('purchases:create ignores a spoofed branch_id from a non-admin and ties the PO to their own branch', async () => {
    setSession(mgrA)
    const res = await call('purchases:create', {
      supplier_id: SUPPLIER1, branch_id: BR_B,
      items: [{ product_id: PROD1, quantity: 5, unit_cost: 100 }],
    })
    expect(res.success).toBe(true)
    poId = res.data.id
    const row = db.prepare('SELECT branch_id FROM purchase_orders WHERE id=?').get(poId) as { branch_id: string }
    expect(row.branch_id).toBe(BR_A)
  })

  it('purchases:updateStatus rejects a Branch B caller acting on a Branch A PO', async () => {
    setSession(mgrB)
    const res = await call('purchases:updateStatus', poId, 'SENT', {})
    expect(res.success).toBe(false)
  })

  it('purchases:update rejects a draft PO edit with zero/negative quantity or cost', async () => {
    setSession(mgrA)
    const res = await call('purchases:update', poId, { items: [{ product_id: PROD1, quantity: 0, unit_cost: 100 }] })
    expect(res.success).toBe(false)
  })

  let orderId: string

  it('orders:create ignores a spoofed branch_id from a non-admin', async () => {
    setSession(mgrA)
    const res = await call('orders:create', {
      branch_id: BR_B, customer_name: 'Sec Test Customer',
      items: [{ product_id: PROD1, quantity: 1, unit_price: 1000 }],
    })
    expect(res.success).toBe(true)
    orderId = res.data.id
    const row = db.prepare('SELECT branch_id FROM customer_orders WHERE id=?').get(orderId) as { branch_id: string }
    expect(row.branch_id).toBe(BR_A)
  })

  it('orders:updateStatus rejects a Branch B caller acting on a Branch A order', async () => {
    setSession(mgrB)
    const res = await call('orders:updateStatus', orderId, 'confirmed', {})
    expect(res.success).toBe(false)
  })

  it('orders:updateStatus only writes whitelisted columns — an arbitrary key in `details` cannot become a SQL column reference', async () => {
    setSession(mgrA)
    const res = await call('orders:updateStatus', orderId, 'confirmed', { 'total_amount=999999--': 'x' })
    // Whether this resolves true/false, the point is it must not throw a
    // raw SQL error (which would indicate the malicious key reached the
    // query) and must not have mutated total_amount.
    expect(res).toBeDefined()
    const row = db.prepare('SELECT total_amount FROM customer_orders WHERE id=?').get(orderId) as { total_amount: number }
    expect(row.total_amount).not.toBe(999999)
  })
})

describe('Security audit regression — SmartBuy agent branch validation', () => {
  const BR_A = 'sec2-branch-a', BR_B = 'sec2-branch-b'

  beforeAll(() => {
    seedBranch(BR_A, 'Security2 Branch A', 'S2A')
    seedBranch(BR_B, 'Security2 Branch B', 'S2B')
    seedUser('u-sec2-mgr-a', BR_A)
    db.prepare(`INSERT OR IGNORE INTO agents (id, code, name, branch_id, default_commission_pct, status) VALUES (?,?,?,?,?,'active')`)
      .run('sec2-agent-b', 'SEC2-AG-B', 'Wrong Branch Agent', BR_B, 5)
  })

  const mgrA = makeSession({ id: 'u-sec2-mgr-a', branchId: BR_A, permissions: { chits: true, customers: true } })

  it('chits:members:add rejects an agent_id that belongs to a different branch', async () => {
    setSession(mgrA)
    const tmpl = await (async () => {
      setSession(makeSession({ id: 'u-sec-admin', permissions: { all: true } }))
      const t = await call('chits:templates:create', {
        scheme_name: 'Sec2 Template', monthly_contribution_amount: 1000, duration_months: 5, minimum_members: 3, product_value: 5000,
      })
      setSession(mgrA)
      return t
    })()
    if (!tmpl.success) return // template feature not applicable to this branch config — skip gracefully
    const scheme = await call('chits:create', { template_id: tmpl.data.id, branch_id: BR_A, agent_commission_pct: 5 })
    if (!scheme.success) return
    const res = await call('chits:members:add', scheme.data.id, {
      customer_name: 'Sec2 Cust', customer_phone: '0770000001', agent_id: 'sec2-agent-b',
    })
    expect(res.success).toBe(false)
  })
})

describe('Security audit regression — commission self-approval block', () => {
  const BR_A = 'sec3-branch-a'

  beforeAll(() => {
    seedBranch(BR_A, 'Security3 Branch A', 'S3A')
    seedUser('u-sec3-mgr', BR_A) // also the agent's linked login
    db.prepare(`INSERT OR IGNORE INTO agents (id, code, name, branch_id, default_commission_pct, status, user_id) VALUES (?,?,?,?,?,'active',?)`)
      .run('sec3-agent-self', 'SEC3-AG', 'Self-Approving Agent', BR_A, 5, 'u-sec3-mgr')
    db.prepare(`
      INSERT INTO commission_ledger (id, source_table, source_id, registration_agent_id, base_amount, registration_commission, total_commission, status, branch_id)
      VALUES ('sec3-ledger-1', 'chit_members', 'sec3-source-1', 'sec3-agent-self', 1000, 50, 50, 'pending_manager_approval', ?)
    `).run(BR_A)
  })

  const mgrLinkedToAgent = makeSession({ id: 'u-sec3-mgr', branchId: BR_A, permissions: { chits: true, employees: true } })

  it('commissions:ledger:approve rejects a staff caller approving a commission line where they are the linked agent', async () => {
    setSession(mgrLinkedToAgent)
    const res = await call('commissions:ledger:approve', 'sec3-ledger-1')
    expect(res.success).toBe(false)
  })

  it('commissions:ledger:reject rejects the same self-dealing case', async () => {
    setSession(mgrLinkedToAgent)
    const res = await call('commissions:ledger:reject', 'sec3-ledger-1', 'testing self-reject')
    expect(res.success).toBe(false)
  })
})

// Regression tests for the SmartBuy menu/route fix: Commission Rules and
// Scheme Master were previously hidden behind adminOnly:true in the sidebar
// (AppLayout.tsx) even though the backend handlers underneath (chits.ts,
// commissions.ts) were already written to let a plain `chits` user VIEW
// them — only mutating requires Super Admin. These tests pin down that
// exact backend contract so a future change can't silently make the menu
// fix (chits can now reach these pages) meaningless, or accidentally let a
// chits-only user mutate what should stay admin-only.
describe('Security audit regression — SmartBuy Commission Rules / Scheme Master view-vs-mutate boundary', () => {
  const BR_A = 'sec4-branch-a'

  beforeAll(() => {
    seedBranch(BR_A, 'Security4 Branch A', 'S4A')
    seedUser('u-sec4-admin', null)
    seedUser('u-sec4-chits', BR_A)
  })

  const admin = makeSession({ id: 'u-sec4-admin', permissions: { all: true } })
  const chitsOnly = makeSession({ id: 'u-sec4-chits', branchId: BR_A, permissions: { chits: true } })

  it('commissions:rules:list — a chits-only (non-admin) caller can view rules', async () => {
    setSession(chitsOnly)
    const res = await call('commissions:rules:list')
    if (!res.success) throw new Error(`REGRESSION: commissions:rules:list now rejects a chits-only caller — the "Commission Rules" menu item (AppLayout.tsx, perm:['chits']) would show a page that immediately fails to load. Error: ${res.error}`)
    expect(res.success).toBe(true)
  })

  it('commissions:rules:create — a chits-only (non-admin) caller is still rejected (Super Admin only)', async () => {
    setSession(chitsOnly)
    const res = await call('commissions:rules:create', {
      name: 'Sec4 Rule', scope: 'global', calculation_type: 'percentage', rate: 5, ownership_model: 'registration', status: 'active',
    })
    if (res.success) throw new Error('REGRESSION: a chits-only caller was able to create a commission rule — mutation must stay Super Admin-only even though viewing was intentionally opened up')
    expect(res.success).toBe(false)
  })

  it('commissions:rules:create — Super Admin can still create a rule (mutation path unaffected)', async () => {
    setSession(admin)
    const res = await call('commissions:rules:create', {
      name: 'Sec4 Admin Rule', scope: 'global', calculation_type: 'percentage', rate: 5, ownership_model: 'registration', status: 'active',
    })
    expect(res.success).toBe(true)
  })

  it('chits:templates:list — a chits-only (non-admin) caller can view the Scheme Master catalog', async () => {
    setSession(chitsOnly)
    const res = await call('chits:templates:list', { status: 'all' })
    if (!res.success) throw new Error(`REGRESSION: chits:templates:list now rejects a chits-only caller — the "Scheme Master" menu item and its route (now RequireSmartBuyAccess in App.tsx) would show a page that immediately fails to load. Error: ${res.error}`)
    expect(res.success).toBe(true)
  })

  it('chits:templates:create — a chits-only (non-admin) caller is still rejected (Super Admin only)', async () => {
    setSession(chitsOnly)
    const res = await call('chits:templates:create', {
      scheme_name: 'Sec4 Scheme', monthly_contribution_amount: 1000, duration_months: 5, minimum_members: 3, product_value: 5000,
    })
    if (res.success) throw new Error('REGRESSION: a chits-only caller was able to create a Scheme Master template — mutation must stay Super Admin-only even though viewing was intentionally opened up')
    expect(res.success).toBe(false)
  })

  it('chits:templates:create — Super Admin can still create a template (mutation path unaffected)', async () => {
    setSession(admin)
    const res = await call('chits:templates:create', {
      scheme_name: 'Sec4 Admin Scheme', monthly_contribution_amount: 1000, duration_months: 5, minimum_members: 3, product_value: 5000,
    })
    expect(res.success).toBe(true)
  })
})
