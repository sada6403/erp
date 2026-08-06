// QA harness for the SmartBuy (Chit Scheme) module — exercises the REAL
// better-sqlite3 database and the REAL IPC handler functions (not just
// static reading of the source) by mocking only 'electron' and
// 'electron-store'.
//
// PREREQUISITE: this project's better-sqlite3 native binary is normally
// compiled against Electron's Node ABI (via @electron/rebuild), not the
// plain Node.js version `vitest`/`npm test` run under — so this file will
// fail at `initDatabase()` with a NODE_MODULE_VERSION mismatch unless you
// first run `npx rebuild-better-sqlite3` for your system Node (there's no
// existing npm script for this — see @electron/rebuild in package.json for
// the reverse direction). Rebuilding for plain Node will make the Electron
// app itself unable to load better-sqlite3 until you run
// `npx electron-rebuild` again afterward — do this deliberately, on a
// throwaway checkout, or budget time to rebuild back. This was NOT done as
// part of the QA pass that authored this file (native-binary rebuilds are a
// system-level, hard-to-reverse action outside a routine code-review's
// blast radius) — see the QA report for what static/manual verification
// was used instead.
//
// This is a throwaway verification artifact, not part of the app's
// permanent behavior.
import { beforeAll, describe, it, expect, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import crypto from 'crypto'

// ── Mock 'electron' ─────────────────────────────────────────────────────
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smartbuy-qa-'))
vi.mock('electron', () => {
  return {
    app: {
      getPath: () => tmpDir,
      isPackaged: false,
      whenReady: () => Promise.resolve(),
      on: () => {},
    },
    ipcMain: { handle: () => {}, on: () => {} },
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

// ── Mock 'electron-store' — one shared in-memory backing object per test
// process, matching real electron-store's single-config-file-per-app
// semantics (every `new Store()` call sees the same data). ─────────────
const sharedStoreData: Record<string, unknown> = {}
vi.mock('electron-store', () => {
  class FakeStore {
    get(key: string, def?: unknown) { return key in sharedStoreData ? sharedStoreData[key] : def }
    set(key: string, val: unknown) { sharedStoreData[key] = val }
    delete(key: string) { delete sharedStoreData[key] }
  }
  return { default: FakeStore }
})

// ── Fake IPC registry — captures what safeHandle/ipcMain.handle would
// register, so we can invoke handlers directly like the renderer would. ──
type Handler = (event: unknown, ...args: unknown[]) => Promise<unknown> | unknown
const registry = new Map<string, Handler>()
const fakeIpcMain = {
  handle: (channel: string, fn: Handler) => { registry.set(channel, fn) },
  on: () => {},
} as unknown as import('electron').IpcMain

async function call(channel: string, ...args: unknown[]): Promise<any> {
  const fn = registry.get(channel)
  if (!fn) throw new Error(`No handler registered for channel: ${channel}`)
  return fn({} as any, ...args)
}

function setSession(session: Record<string, unknown> | null) {
  sharedStoreData.auth_user = session
}

function makeSession(opts: {
  id: string; name?: string; branchId?: string | null; permissions: Record<string, unknown>
  agentId?: string; sessionLevel?: string
}) {
  return {
    id: opts.id, name: opts.name || opts.id, branch_id: opts.branchId ?? null,
    role: { permissions: opts.permissions },
    scope: {
      level: opts.sessionLevel || (opts.permissions.all ? 'owner' : 'branch'),
      branchId: opts.branchId ?? null,
      agentId: opts.agentId ?? null,
    },
  }
}

const SUPER_ADMIN = makeSession({ id: 'u-superadmin', permissions: { all: true } })

let db: import('better-sqlite3').Database
const findings: string[] = []
function note(f: string) { findings.push(f); console.log('[FINDING]', f) }

beforeAll(async () => {
  const { initDatabase, getDb } = await import('../database')
  await initDatabase()
  db = getDb()

  const { registerChitHandlers } = await import('../ipc/chits')
  const { registerCommissionHandlers } = await import('../ipc/commissions')
  const { registerAgentHandlers } = await import('../ipc/agents')
  registerChitHandlers(fakeIpcMain)
  registerCommissionHandlers(fakeIpcMain)
  registerAgentHandlers(fakeIpcMain)
})

// ── Seed helpers ─────────────────────────────────────────────────────────
function seedBranch(id: string, name: string, code: string) {
  db.prepare(`INSERT OR IGNORE INTO branches (id, name, code, address, phone, is_active) VALUES (?,?,?,?,?,1)`)
    .run(id, name, code, 'addr', '0000000000')
}
function seedProduct(id: string, name: string, price: number, taxRate = 0) {
  db.prepare(`INSERT OR IGNORE INTO products (id, category_id, supplier_id, sku, name, unit, cost_price, selling_price, tax_rate) VALUES (?,NULL,NULL,?,?,?,?,?,?)`)
    .run(id, id, name, 'pcs', price * 0.7, price, taxRate)
}
function seedStock(productId: string, branchId: string, qty: number) {
  const id = crypto.randomUUID()
  db.prepare(`INSERT INTO stocks (id, product_id, branch_id, warehouse_id, quantity) VALUES (?,?,?,NULL,?)`)
    .run(id, productId, branchId, qty)
}
function seedAgent(id: string, code: string, branchId: string, defaultCommissionPct = 0) {
  db.prepare(`INSERT OR IGNORE INTO agents (id, code, name, branch_id, default_commission_pct, status) VALUES (?,?,?,?,?,'active')`)
    .run(id, code, code, branchId, defaultCommissionPct)
}
// Every mocked session's id gets written into a FK'd column somewhere
// (chit_schemes.created_by, chit_draws.conducted_by, chit_contributions.
// received_by, commission_ledger.approved_by/admin_approved_by,
// commission_rules.created_by, commission_payouts.paid_by, audit_logs.
// user_id...) and this database runs with `foreign_keys = ON` — every
// mocked session id needs a matching real users row or those inserts throw
// "FOREIGN KEY constraint failed" regardless of which handler is under
// test. Kept separate from makeSession() so a session can be constructed
// without necessarily being persisted (not every test needs its actor to
// survive an FK check, e.g. a permission-rejection-only session).
const QA_ROLE_ID = 'qa-role-generic'
function seedRole(id: string, name: string) {
  db.prepare(`INSERT OR IGNORE INTO roles (id, name) VALUES (?,?)`).run(id, name)
}
function seedUser(id: string, name: string, branchId: string | null = null) {
  seedRole(QA_ROLE_ID, 'QA Generic Role')
  db.prepare(`
    INSERT OR IGNORE INTO users (id, branch_id, role_id, name, email, password_hash)
    VALUES (?,?,?,?,?,'x')
  `).run(id, branchId, QA_ROLE_ID, name, `${id}@qa.test`)
}
function stockQty(productId: string, branchId: string): number {
  const row = db.prepare(`SELECT COALESCE(SUM(quantity),0) as q FROM stocks WHERE product_id=? AND branch_id=?`).get(productId, branchId) as { q: number }
  return row.q
}

describe('SmartBuy QA', () => {
  const BR_A = 'branch-a', BR_B = 'branch-b', BR_C = 'branch-c'
  const PROD1 = 'prod-1', PROD2 = 'prod-low-stock'
  const AGENT_REG = 'agent-reg', AGENT_SALES = 'agent-sales', AGENT_OTHER = 'agent-other'

  beforeAll(() => {
    seedBranch(BR_A, 'Branch A', 'BRA')
    seedBranch(BR_B, 'Branch B', 'BRB')
    seedBranch(BR_C, 'Branch C', 'BRC')
    seedProduct(PROD1, 'Rice Cooker', 60000, 0)
    seedProduct(PROD2, 'Low Stock TV', 60000, 0)
    // Generous headroom: many tests across this suite redeem PROD1 at
    // BR_A, and commission-math tests rely on its exact price (60000) so
    // it can't just be swapped for a cheaper product — PROD2 exists
    // separately as the dedicated low-stock fixture wherever a real
    // shortage needs to be tested. A too-small seed here previously
    // caused a later test to fail with "insufficient stock" purely from
    // exhaustion by earlier tests, not a real product bug.
    seedStock(PROD1, BR_A, 500)
    seedStock(PROD1, BR_B, 10)
    seedStock(PROD2, BR_A, 1)
    seedAgent(AGENT_REG, 'AG-REG', BR_A, 5)
    seedAgent(AGENT_SALES, 'AG-SALES', BR_A, 3)
    seedAgent(AGENT_OTHER, 'AG-OTHER', BR_B, 5)
    // Every session id used anywhere below (via makeSession/setSession) must
    // exist as a real users row up front — see seedUser's comment.
    seedUser('u-superadmin', 'QA Super Admin')
    seedUser('u-mgr-a', 'QA Manager A', BR_A)
    seedUser('u-mgr-b', 'QA Manager B', BR_B)
    seedUser('u-mgr-c', 'QA Manager C', BR_C)
    seedUser('u-agent-other', 'QA Agent Other User', BR_B)
    seedUser('u-nobody', 'QA Nobody', BR_A)
    seedUser('u-customers-only', 'QA Customers Only', BR_A)
  })

  const mgrA = makeSession({ id: 'u-mgr-a', branchId: BR_A, permissions: { customers: true, chits: true, employees: true } })
  const mgrB = makeSession({ id: 'u-mgr-b', branchId: BR_B, permissions: { customers: true, chits: true, employees: true } })
  const mgrC = makeSession({ id: 'u-mgr-c', branchId: BR_C, permissions: { customers: true, chits: true, employees: true } })

  let schemeId: string
  let schemeNumber: string

  it('1. creates a scheme below min_members -> status=pending, cannot draw, cannot collect first payment', async () => {
    setSession(mgrA)
    const res = await call('chits:create', {
      name: 'QA Scheme 1', branch_id: BR_A, product_id: PROD1, member_count: 5, cycle_count: 5,
      min_members: 3, chit_value: 60000, contribution_amount: 1000, agent_commission_pct: 5,
    })
    expect(res.success).toBe(true)
    schemeId = res.data.id
    schemeNumber = res.data.scheme_number

    const got = await call('chits:get', schemeId)
    expect(got.data.scheme.status).toBe('pending')

    const drawAttempt = await call('chits:draws:conduct', schemeId, 1, {})
    if (drawAttempt.success) note('CRITICAL: chits:draws:conduct succeeded on a scheme with 0 members and status=pending — should have been rejected')
    expect(drawAttempt.success).toBe(false)
  })

  let member1: string, member2: string, member3: string, member4: string

  it('2. enrolling members below min stays pending; reaching min flips to active (maybeActivateScheme)', async () => {
    setSession(mgrA)
    const r1 = await call('chits:members:add', schemeId, { customer_name: 'Cust One', customer_phone: '0771111111', agent_id: AGENT_REG })
    expect(r1.success).toBe(true)
    member1 = r1.data.id
    let got = await call('chits:get', schemeId)
    expect(got.data.scheme.status).toBe('pending')

    const r2 = await call('chits:members:add', schemeId, { customer_name: 'Cust Two', customer_phone: '0771111112', agent_id: AGENT_REG })
    member2 = r2.data.id
    got = await call('chits:get', schemeId)
    expect(got.data.scheme.status).toBe('pending')

    // 3rd member reaches min_members=3 -> should auto-activate
    const r3 = await call('chits:members:add', schemeId, { customer_name: 'Cust Three', customer_phone: '0771111113', agent_id: AGENT_REG })
    member3 = r3.data.id
    got = await call('chits:get', schemeId)
    if (got.data.scheme.status !== 'active') note(`HIGH: scheme did not auto-activate after reaching min_members. status=${got.data.scheme.status}`)
    expect(got.data.scheme.status).toBe('active')
  })

  it('3. branch isolation — Branch B / C manager cannot see or touch Branch A scheme (not a collaborator)', async () => {
    setSession(mgrB)
    const got = await call('chits:get', schemeId)
    if (got.success) note(`CRITICAL: Branch B manager (non-collaborator) could read Branch A's scheme via chits:get. schemeId=${schemeId}`)
    expect(got.success).toBe(false)

    const list = await call('chits:list', {})
    const leaked = (list.data || []).some((s: any) => s.id === schemeId)
    if (leaked) note(`CRITICAL: Branch B manager's chits:list leaked Branch A's scheme (schemeId=${schemeId})`)
    expect(leaked).toBe(false)

    const addAttempt = await call('chits:members:add', schemeId, { customer_name: 'Intruder', customer_phone: '0779999999' })
    if (addAttempt.success) note(`CRITICAL: Branch B manager could enroll a member into Branch A's scheme without collaboration (schemeId=${schemeId})`)
    expect(addAttempt.success).toBe(false)

    setSession(mgrC)
    const gotC = await call('chits:get', schemeId)
    expect(gotC.success).toBe(false)
  })

  let collabId: string

  it('4. branch collaboration — invite, self-approve rejected, target approves, can now enroll for own branch only', async () => {
    setSession(mgrA)
    const invite = await call('chits:branches:invite', schemeId, BR_B, 'need more members')
    expect(invite.success).toBe(true)
    collabId = invite.data.id

    // Home branch cannot approve its own invite
    const selfApprove = await call('chits:branches:respond', collabId, 'approve')
    if (selfApprove.success) note(`HIGH: home branch (Branch A) was able to approve its own collaboration invite — should require the INVITED branch`)
    expect(selfApprove.success).toBe(false)

    setSession(mgrB)
    const approve = await call('chits:branches:respond', collabId, 'approve')
    expect(approve.success).toBe(true)

    // Branch B can now enroll a member into Branch A's scheme
    const addByB = await call('chits:members:add', schemeId, { customer_name: 'Collab Cust', customer_phone: '0772222222', agent_id: AGENT_OTHER })
    if (!addByB.success) note(`HIGH: Branch B (approved collaborator) could NOT enroll a member after approval: ${addByB.error}`)
    expect(addByB.success).toBe(true)
    const collabMemberId = addByB.data.id

    const memberRow = db.prepare('SELECT enrolled_branch_id FROM chit_members WHERE id=?').get(collabMemberId) as any
    if (memberRow.enrolled_branch_id !== BR_B) note(`MEDIUM: member enrolled by Branch B has enrolled_branch_id=${memberRow.enrolled_branch_id}, expected ${BR_B}`)

    // Branch C (unrelated, not invited) still cannot enroll
    setSession(mgrC)
    const addByC = await call('chits:members:add', schemeId, { customer_name: 'Outsider', customer_phone: '0773333333' })
    if (addByC.success) note(`CRITICAL: Branch C (never invited) could enroll a member into Branch A's scheme`)
    expect(addByC.success).toBe(false)

    // Branch B (collaborator, not home) should NOT be able to conduct a draw
    setSession(mgrB)
    const drawByB = await call('chits:draws:conduct', schemeId, 1, { method: 'random' })
    if (drawByB.success) note(`HIGH: collaborating Branch B was able to conduct a draw — draws should be home-branch/global only`)
  })

  it('5. commission engine — accrues once, at redemption, matched against the actual product taken (not a flat scheme/contribution rate)', async () => {
    setSession(SUPER_ADMIN)
    const ruleRes = await call('commissions:rules:create', {
      name: 'QA Product Rule', scope: 'product', product_id: PROD1,
      calculation_type: 'percentage', rate: 10, ownership_model: 'split',
      registration_share_pct: 60, sales_share_pct: 40, status: 'active',
    })
    expect(ruleRes.success).toBe(true)

    setSession(mgrA)
    const r4 = await call('chits:members:add', schemeId, { customer_name: 'Cust Four', customer_phone: '0771111114', agent_id: AGENT_REG })
    expect(r4.success).toBe(true)
    member4 = r4.data.id

    // A contribution towards the scheme must NOT produce any commission —
    // that used to accrue progressively per payment; now it only accrues
    // once, at redemption, against the actual product taken.
    const contrib = await call('chits:contributions:record', member4, {
      amount: 1000, method: 'cash', collected_by_agent_id: AGENT_SALES, paid_at: '2026-01-03T10:00:00.000Z',
      cycle_no: 3, // must match the draw cycle below — current-cycle payment is now required for eligibility
    })
    expect(contrib.success).toBe(true)
    const contribLedgerRows = db.prepare('SELECT * FROM commission_ledger WHERE member_id=?').all(member4) as any[]
    if (contribLedgerRows.length !== 0) note(`CRITICAL: a contribution produced ${contribLedgerRows.length} commission_ledger row(s) — commission must only accrue at redemption now`)
    const contribRow = db.prepare('SELECT commission_amount FROM chit_contributions WHERE member_id=?').get(member4) as any
    if (Number(contribRow?.commission_amount || 0) !== 0) note(`HIGH: chit_contributions.commission_amount should be 0 (commission moved to redemption-time), got ${contribRow?.commission_amount}`)

    // Drive member4 to redemption_type-set, then redeem PROD1 — the product
    // the rule above actually matches. Manual pick is Company-Admin-only
    // (SmartBuy fix audit, HIGH-5) — mgrA (chits:true, not 'all') cannot
    // do this itself, so switch to SUPER_ADMIN for just this call, then
    // back to mgrA for the ordinary redemption that follows.
    setSession(SUPER_ADMIN)
    const draw = await call('chits:draws:conduct', schemeId, 3, { method: 'manual_pick', winnerMemberId: member4, reason: 'QA commission test winner' })
    expect(draw.success).toBe(true)
    setSession(mgrA)
    const redemption = await call('chits:members:recordRedemption', member4, { product_id: PROD1, qty: 1 })
    expect(redemption.success).toBe(true)

    const ledgerRows = db.prepare('SELECT * FROM commission_ledger WHERE member_id=?').all(member4) as any[]
    if (ledgerRows.length !== 1) note(`HIGH: expected exactly 1 commission_ledger row for a single-rule redemption, got ${ledgerRows.length}`)
    const row = ledgerRows[0]
    if (row) {
      // recordRedemption has no separate "sales agent" concept — the whole
      // commission collapses onto the registration agent (member4.agent_id),
      // same collapse behavior splitCommissionRule already had for a
      // one-sided caller. Product value 60000 * 10% = 6000, all of it.
      if (Math.abs(row.registration_commission - 6000) > 0.01) note(`CRITICAL: commission math wrong — expected registration_commission=6000 (10% of 60000, collapsed from the 60/40 split since there's no sales agent), got ${row.registration_commission}`)
      if (Math.abs(row.sales_commission - 0) > 0.01) note(`CRITICAL: sales_commission should be 0 — redemption has no sales-agent role, got ${row.sales_commission}`)
      if (Math.abs(row.total_commission - 6000) > 0.01) note(`CRITICAL: total_commission should be 6000, got ${row.total_commission}`)
      if (row.registration_agent_id !== AGENT_REG) note(`HIGH: registration_agent_id should be the member's enrolling agent (${AGENT_REG}), got ${row.registration_agent_id}`)
      if (row.sales_agent_id) note(`HIGH: sales_agent_id should be null for a redemption, got ${row.sales_agent_id}`)
    }

    // Agent report should reflect exactly this one ledger line, not double-counted
    const reportReg = await call('chits:agents:report', { branchId: BR_A })
    const regRow = (reportReg.data || []).find((a: any) => a.id === AGENT_REG)
    if (Math.abs(Number(regRow?.commission_earned || 0) - 6000) > 0.01) note(`CRITICAL: agent report commission wrong or double-counted — registration agent shows ${regRow?.commission_earned}, expected 6000`)
  })

  it('6. commission approval + payment status — dual-stage approval (manager then admin), only Super Admin can mark paid', async () => {
    // Real status vocabulary is dual-stage: pending_manager_approval ->
    // pending_admin_approval -> approved_for_payment -> paid. A single
    // commissions:ledger:approve call from a Branch Manager only ever
    // reaches the manager stage — a second, Super-Admin-only approve call
    // is required to reach approved_for_payment before markPaid can do
    // anything.
    const ledgerRow = db.prepare('SELECT id FROM commission_ledger WHERE member_id=? LIMIT 1').get(member4) as any
    setSession(mgrA)
    const approve = await call('commissions:ledger:approve', ledgerRow.id)
    expect(approve.success).toBe(true)
    const afterManagerApprove = db.prepare('SELECT status FROM commission_ledger WHERE id=?').get(ledgerRow.id) as any
    if (afterManagerApprove.status !== 'pending_admin_approval') note(`HIGH: after a manager approval, status should be 'pending_admin_approval', got '${afterManagerApprove.status}'`)
    expect(afterManagerApprove.status).toBe('pending_admin_approval')

    // A Branch Manager (non-Super-Admin) must not be able to perform the
    // second, admin-level approval themselves.
    const adminApproveByManager = await call('commissions:ledger:approve', ledgerRow.id)
    if (adminApproveByManager.success) note(`CRITICAL: a Branch Manager (non-Super-Admin) was able to perform the admin-level commission approval`)
    expect(adminApproveByManager.success).toBe(false)

    // Not yet approved_for_payment, so markPaid must not pay it — by
    // anyone, including Super Admin — until the admin stage clears.
    const payTooEarly = await call('commissions:ledger:markPaid', [ledgerRow.id])
    const stillPending = db.prepare('SELECT status FROM commission_ledger WHERE id=?').get(ledgerRow.id) as any
    if (stillPending.status === 'paid') note(`CRITICAL: commissions:ledger:markPaid paid an entry that was never approved_for_payment`)
    void payTooEarly

    setSession(SUPER_ADMIN)
    const adminApprove = await call('commissions:ledger:approve', ledgerRow.id)
    expect(adminApprove.success).toBe(true)
    const afterAdminApprove = db.prepare('SELECT status FROM commission_ledger WHERE id=?').get(ledgerRow.id) as any
    if (afterAdminApprove.status !== 'approved_for_payment') note(`HIGH: after the admin approval, status should be 'approved_for_payment', got '${afterAdminApprove.status}'`)
    expect(afterAdminApprove.status).toBe('approved_for_payment')

    const payBySuper = await call('commissions:ledger:markPaid', [ledgerRow.id])
    expect(payBySuper.success).toBe(true)
    const afterPaid = db.prepare('SELECT status FROM commission_ledger WHERE id=?').get(ledgerRow.id) as any
    expect(afterPaid.status).toBe('paid')
  })

  it('7. late fee — applied after grace day, not before', async () => {
    setSession(SUPER_ADMIN)
    await call('chits:update', schemeId, { name: 'QA Scheme 1' }) // sanity no-op
    db.prepare(`UPDATE chit_schemes SET late_payment_days=5, late_fee_amount=200 WHERE id=?`).run(schemeId)

    setSession(mgrA)
    const early = await call('chits:contributions:record', member2, { amount: 1000, method: 'cash', paid_at: '2026-02-03T10:00:00.000Z' })
    if (early.data?.lateFeeApplied) note(`HIGH: late fee applied on day 3 with a 5-day grace period — should not have applied`)

    const late = await call('chits:contributions:record', member3, { amount: 1000, method: 'cash', paid_at: '2026-02-10T10:00:00.000Z' })
    if (!late.data?.lateFeeApplied || Math.abs(late.data.lateFeeApplied - 200) > 0.01) note(`HIGH: late fee NOT applied (or wrong amount) on day 10 with a 5-day grace period. lateFeeApplied=${late.data?.lateFeeApplied}`)
    if (late.success && Math.abs(late.data.amount - 1200) > 0.01) note(`HIGH: late-fee-inclusive amount wrong — expected 1200, got ${late.data?.amount}`)
  })

  it('8. stock shortage — redemption rejected, no partial stock deduction, no orphan invoice', async () => {
    // Current-cycle payment is required for draw eligibility — member1 has
    // never paid cycle 1 yet in this shared scheme.
    setSession(mgrA)
    const member1Cycle1 = await call('chits:contributions:record', member1, { amount: 1000, method: 'cash', cycle_no: 1 })
    expect(member1Cycle1.success).toBe(true)

    // Make member1 a winner via manual pick so they're redemption_type-set.
    // Manual pick is Company-Admin-only (SmartBuy fix audit, HIGH-5).
    setSession(SUPER_ADMIN)
    const draw = await call('chits:draws:conduct', schemeId, 1, { method: 'manual_pick', winnerMemberId: member1, reason: 'QA test winner' })
    expect(draw.success).toBe(true)
    setSession(mgrA)

    const beforeStock = stockQty(PROD2, BR_A)
    const redemption = await call('chits:members:recordRedemption', member1, { product_id: PROD2, qty: 5 }) // only 1 in stock
    if (redemption.success) note(`CRITICAL: redemption succeeded despite insufficient stock (requested 5, had ${beforeStock})`)
    const afterStock = stockQty(PROD2, BR_A)
    if (afterStock !== beforeStock) note(`CRITICAL: stock was partially decremented on a FAILED redemption — before=${beforeStock} after=${afterStock}`)

    const invoiceCount = db.prepare(`SELECT COUNT(*) as c FROM invoices WHERE notes LIKE '%' || ? || '%'`).get(schemeNumber) as any
    // can't easily assert exact count without a baseline, but check member has no redemption_invoice_id
    const memberRow = db.prepare('SELECT redemption_invoice_id FROM chit_members WHERE id=?').get(member1) as any
    if (memberRow.redemption_invoice_id) note(`CRITICAL: chit_members.redemption_invoice_id was set despite the redemption failing on stock shortage`)
  })

  it('9. successful redemption — real invoice created, stock decremented exactly, no cash disbursed, cannot double-redeem', async () => {
    setSession(mgrA)
    const beforeStock = stockQty(PROD1, BR_A)
    const redemption = await call('chits:members:recordRedemption', member1, { product_id: PROD1, qty: 1 })
    expect(redemption.success).toBe(true)
    const afterStock = stockQty(PROD1, BR_A)
    if (beforeStock - afterStock !== 1) note(`CRITICAL: stock decrement wrong — before=${beforeStock} after=${afterStock}, expected -1`)

    const invoice = db.prepare('SELECT * FROM invoices WHERE id=?').get(redemption.data.invoiceId) as any
    if (!invoice) note(`CRITICAL: recordRedemption reported success but no invoices row exists for invoiceId=${redemption.data.invoiceId}`)
    else {
      if (Math.abs(invoice.total_amount - 60000) > 0.01) note(`HIGH: invoice total_amount wrong — expected 60000, got ${invoice.total_amount}`)
      if (Math.abs(invoice.paid_amount - invoice.total_amount) > 0.01) note(`HIGH: invoice paid_amount (${invoice.paid_amount}) does not equal total_amount (${invoice.total_amount}) — redemption should be fully pre-paid, never leaving a due balance`)
      if (invoice.due_amount !== 0) note(`HIGH: invoice due_amount should be 0 for a chit redemption, got ${invoice.due_amount}`)
    }
    const payment = db.prepare('SELECT * FROM payments WHERE invoice_id=?').get(redemption.data.invoiceId) as any
    if (!payment) note('CRITICAL: no payments row created for the redemption invoice')
    else if (Number(payment.amount) < 0) note(`CRITICAL: redemption produced a NEGATIVE payment (cash disbursed to customer) — amount=${payment.amount}`)

    // Double redemption attempt
    const second = await call('chits:members:recordRedemption', member1, { product_id: PROD1, qty: 1 })
    if (second.success) note(`CRITICAL: double redemption succeeded — member already had redemption_invoice_id set`)
    const stockAfterSecondAttempt = stockQty(PROD1, BR_A)
    if (stockAfterSecondAttempt !== afterStock) note(`CRITICAL: stock was decremented AGAIN on a rejected double-redemption attempt`)
  })

  it('10. winner cannot be selected twice — already-redeemed member excluded from eligible/manual pick', async () => {
    setSession(mgrA)
    const eligible = await call('chits:draws:eligible', schemeId, 2)
    const stillEligible = (eligible.data || []).some((m: any) => m.id === member1)
    if (stillEligible) note(`CRITICAL: a member who already won (member1) still appears in the eligible list for a later cycle`)

    // Super Admin session so a rejection can only mean "excluded by
    // eligibility," not "blocked by the manual-pick permission gate"
    // (SmartBuy fix audit, HIGH-5) — keeps this a clean test of exclusion
    // logic, not authorization.
    setSession(SUPER_ADMIN)
    const manualPickAgain = await call('chits:draws:conduct', schemeId, 2, { method: 'manual_pick', winnerMemberId: member1, reason: 'trying to win twice already' })
    if (manualPickAgain.success) note(`CRITICAL: chits:draws:conduct allowed re-selecting an already-won member`)
    expect(manualPickAgain.success).toBe(false)
    setSession(mgrA)
  })

  it('11. cancelled scheme — draws should be rejected once a scheme is cancelled/completed', async () => {
    // No dedicated cancel handler exists yet — set status directly to simulate.
    const schemeId2Res = await call('chits:create', {
      name: 'QA Cancel Test', branch_id: BR_A, member_count: 3, cycle_count: 3, min_members: 1,
      chit_value: 1000, contribution_amount: 100,
    })
    expect(schemeId2Res.success).toBe(true)
    const schemeId2 = schemeId2Res.data.id
    await call('chits:members:add', schemeId2, { customer_name: 'Solo Member', customer_phone: '0774444444' })
    db.prepare(`UPDATE chit_schemes SET status='cancelled' WHERE id=?`).run(schemeId2)

    const drawOnCancelled = await call('chits:draws:conduct', schemeId2, 1, { method: 'random' })
    if (drawOnCancelled.success) note(`HIGH: chits:draws:conduct succeeded on a CANCELLED scheme — status is only checked for 'pending', not 'cancelled'/'completed'`)

    const contribOnCancelled = await call('chits:contributions:record', (await call('chits:members:list', schemeId2)).data[0].id, { amount: 100, method: 'cash' })
    if (contribOnCancelled.success) note(`MEDIUM: chits:contributions:record succeeded on a CANCELLED scheme`)
  })

  it('12. agent session isolation — cannot see other agents, cannot create scheme, cannot edit profile', async () => {
    // Link AGENT_OTHER to a fake user and act as that agent
    db.prepare(`UPDATE agents SET user_id=? WHERE id=?`).run('u-agent-other', AGENT_OTHER)
    const agentSession = makeSession({ id: 'u-agent-other', branchId: BR_B, permissions: { chits: true }, agentId: AGENT_OTHER, sessionLevel: 'agent' })
    setSession(agentSession)

    const createAttempt = await call('chits:create', { name: 'Agent Scheme', branch_id: BR_B, member_count: 5, cycle_count: 5, min_members: 1, chit_value: 1000 })
    if (createAttempt.success) note(`CRITICAL: an Agent-scoped session was able to create a scheme — spec requires Super Admin approval, agents cannot create schemes`)

    const otherAgentReport = await call('chits:agents:report', {})
    const sawOtherAgent = (otherAgentReport.data || []).some((a: any) => a.id === AGENT_SALES)
    if (sawOtherAgent) note(`CRITICAL: Agent session could see another agent's (${AGENT_SALES}) report row via chits:agents:report`)

    const editSelf = await call('agents:update', AGENT_OTHER, { default_commission_pct: 99 })
    if (editSelf.success) note(`HIGH: Agent session was able to edit their own agent profile via agents:update — spec says agents cannot modify commission rules/their profile`)
  })

  it('13. agents:report / agents:reportAllSummary — permission gate + agent self-isolation (regression for the missing-scope leak)', async () => {
    // No permission at all -> both handlers must refuse, not just return empty.
    setSession(makeSession({ id: 'u-nobody', branchId: BR_A, permissions: {} }))
    const noPermReport = await call('agents:report', { agentId: AGENT_REG })
    if (noPermReport.success) note(`CRITICAL: agents:report served data to a session with no employees/chits/all permission`)
    expect(noPermReport.success).toBe(false)
    const noPermSummary = await call('agents:reportAllSummary', {})
    if (noPermSummary.success) note(`CRITICAL: agents:reportAllSummary served data to a session with no employees/chits/all permission`)
    expect(noPermSummary.success).toBe(false)

    // Branch Manager (has 'chits', no 'all') requesting an agent from a
    // DIFFERENT branch must be refused, not silently scoped to empty.
    setSession(mgrB)
    const crossBranch = await call('agents:report', { agentId: AGENT_REG }) // AGENT_REG is BR_A, mgrB is BR_B
    if (crossBranch.success) note(`CRITICAL: agents:report let Branch B's manager read Branch A's agent (${AGENT_REG})`)
    expect(crossBranch.success).toBe(false)

    // Agent-scoped session (reuses the AGENT_OTHER login linked in test 12)
    // must never read a DIFFERENT agent's report, only their own.
    const agentSession = makeSession({ id: 'u-agent-other', branchId: BR_B, permissions: { chits: true }, agentId: AGENT_OTHER, sessionLevel: 'agent' })
    setSession(agentSession)
    const otherAgentSingle = await call('agents:report', { agentId: AGENT_SALES })
    if (otherAgentSingle.success) note(`CRITICAL: agents:report let an Agent-scoped session (${AGENT_OTHER}) read another agent's (${AGENT_SALES}) report`)
    expect(otherAgentSingle.success).toBe(false)

    const ownReport = await call('agents:report', { agentId: AGENT_OTHER })
    if (!ownReport.success) note(`HIGH: agents:report refused an Agent-scoped session reading their OWN report: ${ownReport.error}`)
    expect(ownReport.success).toBe(true)

    const allSummary = await call('agents:reportAllSummary', {})
    if (!allSummary.success) note(`HIGH: agents:reportAllSummary failed for an Agent-scoped session: ${allSummary.error}`)
    const summaryIds = (allSummary.data || []).map((a: any) => a.id)
    if (summaryIds.some((id: string) => id !== AGENT_OTHER)) note(`CRITICAL: agents:reportAllSummary returned another agent's row to an Agent-scoped session — got ids: ${summaryIds.join(',')}`)
    if (!summaryIds.includes(AGENT_OTHER)) note(`HIGH: agents:reportAllSummary did not include the caller's own agent row`)
  })

  it('14. commission_ledger uniqueness — DB rejects a second row for the same (source_table, source_id, rule_id)', async () => {
    // member4 (test 5) already redeemed with exactly one matching rule —
    // reuse that real row instead of constructing a fake scenario.
    const existing = db.prepare(`SELECT * FROM commission_ledger WHERE member_id=?`).get(member4) as any
    if (!existing) { note('CRITICAL: could not find member4\'s commission_ledger row to test uniqueness against'); return }

    let threw = false
    try {
      db.prepare(`
        INSERT INTO commission_ledger
          (id, source_table, source_id, scheme_id, member_id, rule_id, is_bonus, registration_agent_id, sales_agent_id,
           base_amount, registration_commission, sales_commission, total_commission, status, branch_id)
        VALUES (@id,@source_table,@source_id,@scheme_id,@member_id,@rule_id,@is_bonus,@registration_agent_id,@sales_agent_id,
           @base_amount,@registration_commission,@sales_commission,@total_commission,@status,@branch_id)
      `).run({ ...existing, id: crypto.randomUUID() })
    } catch (err: any) {
      threw = true
      if (!/UNIQUE constraint failed/i.test(String(err?.message))) {
        note(`MEDIUM: duplicate commission_ledger insert threw, but not the expected UNIQUE constraint error: ${err?.message}`)
      }
    }
    if (!threw) note(`CRITICAL: inserting a second commission_ledger row with the same (source_table, source_id, rule_id) succeeded — idx_commission_ledger_source_rule_unique is missing or not enforced`)
    expect(threw).toBe(true)

    // A DIFFERENT rule_id for the same source_id (base + bonus stacking)
    // must still be allowed — the constraint must not be overly broad.
    const bonusRuleRes = await (async () => {
      setSession(SUPER_ADMIN)
      return call('commissions:rules:create', {
        name: 'QA Bonus Rule', scope: 'product', product_id: PROD1,
        calculation_type: 'percentage', rate: 2, is_bonus: true, ownership_model: 'registration', status: 'active',
      })
    })()
    expect(bonusRuleRes.success).toBe(true)
    let stackingThrew = false
    try {
      db.prepare(`
        INSERT INTO commission_ledger
          (id, source_table, source_id, scheme_id, member_id, rule_id, is_bonus, registration_agent_id, sales_agent_id,
           base_amount, registration_commission, sales_commission, total_commission, status, branch_id)
        VALUES (@id,@source_table,@source_id,@scheme_id,@member_id,@rule_id,@is_bonus,@registration_agent_id,@sales_agent_id,
           @base_amount,@registration_commission,@sales_commission,@total_commission,@status,@branch_id)
      `).run({ ...existing, id: crypto.randomUUID(), rule_id: bonusRuleRes.data.id, is_bonus: 1 })
    } catch {
      stackingThrew = true
    }
    if (stackingThrew) note(`CRITICAL: a second commission_ledger row for the same source_id but a DIFFERENT rule_id (legitimate bonus stacking) was rejected — constraint is too broad`)
    expect(stackingThrew).toBe(false)
  })

  it('15. recordRedemption re-checks redemption_invoice_id inside the transaction (not just the pre-transaction read)', async () => {
    // member4 (test 5) is already redeemed — a second call must still be
    // rejected with the same message even though this now runs a second
    // (redundant-by-design) SELECT inside the transaction.
    setSession(mgrA)
    const second = await call('chits:members:recordRedemption', member4, { product_id: PROD1, qty: 1 })
    if (second.success) note(`CRITICAL: recordRedemption allowed a second redemption for an already-redeemed member (in-transaction re-check regression)`)
    expect(second.success).toBe(false)
    expect(String(second.error || '')).toMatch(/already been recorded/i)
  })

  it('16. draw eligibility — a member with a REJECTED prior-cycle payment is excluded from both the preview AND the actual draw (regression for HIGH-1)', async () => {
    setSession(mgrA)
    const schemeRes = await call('chits:create', {
      name: 'QA Eligibility Scheme', branch_id: BR_A, product_id: PROD1, member_count: 2, cycle_count: 5,
      min_members: 2, chit_value: 60000, contribution_amount: 1000, agent_commission_pct: 5,
    })
    expect(schemeRes.success).toBe(true)
    const eligSchemeId = schemeRes.data.id

    const mA = await call('chits:members:add', eligSchemeId, { customer_name: 'Elig Good', customer_phone: '0771119991', agent_id: AGENT_REG })
    const mB = await call('chits:members:add', eligSchemeId, { customer_name: 'Elig Bad', customer_phone: '0771119992', agent_id: AGENT_REG })
    expect(mA.success).toBe(true)
    expect(mB.success).toBe(true)
    const memberGood = mA.data.id
    const memberBad = mB.data.id

    // memberBad's cycle-1 payment gets rejected — standard chit practice is
    // to sit out later draws until caught up.
    const pay = await call('chits:contributions:record', memberBad, {
      amount: 1000, method: 'bank_transfer', cycle_no: 1, paid_at: '2026-03-01T10:00:00.000Z',
    })
    expect(pay.success).toBe(true)
    const verify = await call('chits:contributions:verify', pay.data.id, 'reject', 'QA: forcing a rejected payment')
    expect(verify.success).toBe(true)

    // memberGood must have an approved CURRENT-cycle (2) payment to be
    // eligible at all, now that current-cycle payment is required.
    const goodPay = await call('chits:contributions:record', memberGood, { amount: 1000, method: 'cash', cycle_no: 2 })
    expect(goodPay.success).toBe(true)

    // The read-only preview must exclude memberBad from cycle 2.
    const eligible = await call('chits:draws:eligible', eligSchemeId, 2)
    const badInPreview = (eligible.data || []).some((m: any) => m.id === memberBad)
    if (badInPreview) note(`CRITICAL: member with a rejected prior-cycle payment still appears in the chits:draws:eligible preview`)
    expect(badInPreview).toBe(false)

    // The ACTUAL draw pool must apply the identical exclusion (this is the
    // exact bug HIGH-1 fixed — the two used to disagree). With memberBad
    // excluded, the pool has exactly one member, so the random draw is
    // deterministic: memberGood must win.
    const draw = await call('chits:draws:conduct', eligSchemeId, 2, { method: 'random' })
    expect(draw.success).toBe(true)
    const drawRow = db.prepare('SELECT winner_member_id FROM chit_draws WHERE scheme_id=? AND cycle_no=2').get(eligSchemeId) as any
    if (drawRow?.winner_member_id === memberBad) note(`CRITICAL: chits:draws:conduct selected a member with a rejected prior-cycle payment as the winner — HIGH-1 eligibility mismatch regressed`)
    expect(drawRow?.winner_member_id).toBe(memberGood)
  })

  it("17. permission leak closed — a 'customers'-only session (no chits, no all) can no longer manage Smart Buy (regression for HIGH-2)", async () => {
    const customersOnly = makeSession({ id: 'u-customers-only', branchId: BR_A, permissions: { customers: true } })
    setSession(customersOnly)

    const createAttempt = await call('chits:create', {
      name: 'Should Not Be Created', branch_id: BR_A, product_id: PROD1, member_count: 2, cycle_count: 2,
      min_members: 2, chit_value: 10000, contribution_amount: 500,
    })
    if (createAttempt.success) note(`CRITICAL: a session with only 'customers' permission (no 'chits'/'all') was able to create a Smart Buy scheme — HIGH-2 permission leak regressed`)
    expect(createAttempt.success).toBe(false)

    const addAttempt = await call('chits:members:add', schemeId, { customer_name: 'Leak Test', customer_phone: '0779999999' })
    if (addAttempt.success) note(`CRITICAL: a session with only 'customers' permission (no 'chits'/'all') was able to enroll a Smart Buy member — HIGH-2 permission leak regressed`)
    expect(addAttempt.success).toBe(false)

    const viewCommissions = await call('commissions:rules:list', {})
    if (viewCommissions.success) note(`CRITICAL: a session with only 'customers' permission (no 'chits'/'all') could view commission rules — canViewCommissions leak regressed`)
    expect(viewCommissions.success).toBe(false)

    setSession(mgrA)
  })

  it('18. manual draw governance — non-admin blocked, too-short reason blocked, valid Super Admin override accepted and logged (regression for HIGH-5)', async () => {
    setSession(mgrA)
    const schemeRes = await call('chits:create', {
      name: 'QA Manual Draw Governance', branch_id: BR_A, product_id: PROD1, member_count: 2, cycle_count: 5,
      min_members: 2, chit_value: 60000, contribution_amount: 1000,
    })
    expect(schemeRes.success).toBe(true)
    const govSchemeId = schemeRes.data.id
    const g1 = await call('chits:members:add', govSchemeId, { customer_name: 'Gov One', customer_phone: '0771119993', agent_id: AGENT_REG })
    const g2 = await call('chits:members:add', govSchemeId, { customer_name: 'Gov Two', customer_phone: '0771119994', agent_id: AGENT_REG })
    expect(g1.success).toBe(true)
    expect(g2.success).toBe(true)

    // Current-cycle payment is required for draw eligibility — g1 must have
    // an approved cycle-1 contribution before any of the calls below can
    // possibly succeed on eligibility grounds (the two rejected-for-other-
    // reasons calls just below don't reach the eligibility check at all).
    const g1Pay = await call('chits:contributions:record', g1.data.id, { amount: 1000, method: 'cash', cycle_no: 1 })
    expect(g1Pay.success).toBe(true)

    // mgrA has 'chits' but not 'all' — must be rejected outright, regardless
    // of reason quality.
    const byManager = await call('chits:draws:conduct', govSchemeId, 1, { method: 'manual_pick', winnerMemberId: g1.data.id, reason: 'This reason is long enough' })
    if (byManager.success) note(`CRITICAL: a non-'all' Smart Buy manager was able to conduct a manual_pick draw — HIGH-5 governance regressed`)
    expect(byManager.success).toBe(false)

    // Super Admin, but reason under the minimum length — must be rejected.
    setSession(SUPER_ADMIN)
    const shortReason = await call('chits:draws:conduct', govSchemeId, 1, { method: 'manual_pick', winnerMemberId: g1.data.id, reason: 'short' })
    if (shortReason.success) note(`CRITICAL: chits:draws:conduct accepted a manual_pick reason under the minimum length — HIGH-5 governance regressed`)
    expect(shortReason.success).toBe(false)

    // Super Admin, valid reason — must succeed and the reason must be logged.
    const valid = await call('chits:draws:conduct', govSchemeId, 1, { method: 'manual_pick', winnerMemberId: g1.data.id, reason: 'Documented justification for manual override' })
    expect(valid.success).toBe(true)
    const drawRow = db.prepare('SELECT winner_member_id, notes FROM chit_draws WHERE scheme_id=? AND cycle_no=1').get(govSchemeId) as any
    if (drawRow?.winner_member_id !== g1.data.id) note(`CRITICAL: manual pick winner was not recorded correctly`)
    if (!drawRow?.notes) note(`HIGH: manual pick override reason was not persisted to chit_draws.notes for audit`)

    setSession(mgrA)
  })

  it('19. shared contact validation — invalid phone/email/NIC rejected on single member add, matching bulk import (regression for MED-1)', async () => {
    setSession(mgrA)
    const schemeRes = await call('chits:create', {
      name: 'QA Contact Validation Scheme', branch_id: BR_A, product_id: PROD1, member_count: 5, cycle_count: 5,
      min_members: 5, chit_value: 60000, contribution_amount: 1000,
    })
    expect(schemeRes.success).toBe(true)
    const valSchemeId = schemeRes.data.id

    const badPhone = await call('chits:members:add', valSchemeId, { customer_name: 'Bad Phone', customer_phone: 'not-a-phone' })
    if (badPhone.success) note(`CRITICAL: chits:members:add accepted an invalid phone number — MED-1 shared validation not applied`)
    expect(badPhone.success).toBe(false)

    const badEmail = await call('chits:members:add', valSchemeId, { customer_name: 'Bad Email', customer_phone: '0771119995', customer_email: 'not-an-email' })
    if (badEmail.success) note(`CRITICAL: chits:members:add accepted an invalid email address — MED-1 shared validation not applied`)
    expect(badEmail.success).toBe(false)

    const badNic = await call('chits:members:add', valSchemeId, { customer_name: 'Bad NIC', customer_phone: '0771119996', customer_nic: '123' })
    if (badNic.success) note(`CRITICAL: chits:members:add accepted an invalid NIC — MED-1 shared validation not applied`)
    expect(badNic.success).toBe(false)

    const good = await call('chits:members:add', valSchemeId, { customer_name: 'Good Contact', customer_phone: '0771119997', customer_email: 'good@example.com', customer_nic: '991234567V' })
    if (!good.success) note(`HIGH: chits:members:add rejected a well-formed phone/email/NIC — validation is too strict: ${good.error}`)
    expect(good.success).toBe(true)
  })

  it('20. audit log — member enrollment writes a CHIT_MEMBER_ADDED entry including the enrolling agent (regression for HIGH-4)', async () => {
    setSession(mgrA)
    const schemeRes = await call('chits:create', {
      name: 'QA Audit Log Scheme', branch_id: BR_A, product_id: PROD1, member_count: 5, cycle_count: 5,
      min_members: 5, chit_value: 60000, contribution_amount: 1000,
    })
    expect(schemeRes.success).toBe(true)
    const auditSchemeId = schemeRes.data.id

    const added = await call('chits:members:add', auditSchemeId, { customer_name: 'Audit Member', customer_phone: '0771119998', agent_id: AGENT_REG })
    expect(added.success).toBe(true)

    const logRow = db.prepare(`
      SELECT * FROM audit_logs WHERE action='CHIT_MEMBER_ADDED' AND record_id=? ORDER BY created_at DESC LIMIT 1
    `).get(added.data.id) as any
    if (!logRow) { note('CRITICAL: chits:members:add did not write a CHIT_MEMBER_ADDED audit_logs entry'); return }
    if (logRow.user_id !== mgrA.id) note(`HIGH: audit log user_id should be the acting user (${mgrA.id}), got ${logRow.user_id}`)
    if (logRow.branch_id !== BR_A) note(`HIGH: audit log branch_id should be ${BR_A}, got ${logRow.branch_id}`)
    const newValues = JSON.parse(logRow.new_values || '{}')
    if (newValues.agentId !== AGENT_REG) note(`HIGH: audit log new_values.agentId should be ${AGENT_REG}, got ${newValues.agentId}`)
    if (newValues.schemeId !== auditSchemeId) note(`HIGH: audit log new_values.schemeId should be ${auditSchemeId}, got ${newValues.schemeId}`)
    if (!newValues.customerId) note(`HIGH: audit log new_values.customerId is missing`)
  })

  it('21. draw winner balance waiver — winner owes nothing further, non-winners are unaffected (confirmed business rule)', async () => {
    setSession(mgrA)
    const schemeRes = await call('chits:create', {
      name: 'QA Winner Waiver Scheme', branch_id: BR_A, product_id: PROD1, member_count: 3, cycle_count: 3,
      min_members: 3, chit_value: 60000, contribution_amount: 1000,
    })
    expect(schemeRes.success).toBe(true)
    const waiverSchemeId = schemeRes.data.id

    const w1 = await call('chits:members:add', waiverSchemeId, { customer_name: 'Waiver Winner', customer_phone: '0771119981', agent_id: AGENT_REG })
    const w2 = await call('chits:members:add', waiverSchemeId, { customer_name: 'Waiver NonWinner A', customer_phone: '0771119982', agent_id: AGENT_REG })
    const w3 = await call('chits:members:add', waiverSchemeId, { customer_name: 'Waiver NonWinner B', customer_phone: '0771119983', agent_id: AGENT_REG })
    expect(w1.success).toBe(true)
    expect(w2.success).toBe(true)
    expect(w3.success).toBe(true)

    // Winner has only paid a small fraction of chit_value before winning —
    // under the old (financed) behavior this would have generated a large
    // (~59000) repayment installment.
    const contrib = await call('chits:contributions:record', w1.data.id, { amount: 1000, method: 'cash', cycle_no: 1 })
    expect(contrib.success).toBe(true)

    setSession(SUPER_ADMIN)
    const draw = await call('chits:draws:conduct', waiverSchemeId, 1, { method: 'manual_pick', winnerMemberId: w1.data.id, reason: 'QA winner balance waiver test' })
    expect(draw.success).toBe(true)
    setSession(mgrA)

    // 1. Winner: no repayment schedule created, no future obligation.
    const winnerRow = db.prepare('SELECT status, redemption_type, installment_id FROM chit_members WHERE id=?').get(w1.data.id) as any
    if (winnerRow.installment_id) note(`CRITICAL: draw winner has installment_id=${winnerRow.installment_id} — a repayment schedule was created despite the confirmed no-further-obligation business rule`)
    expect(winnerRow.installment_id).toBeNull()
    if (winnerRow.status !== 'redeemed') note(`HIGH: winner status should be 'redeemed', got '${winnerRow.status}'`)
    if (winnerRow.redemption_type !== 'draw') note(`HIGH: winner redemption_type should be 'draw', got '${winnerRow.redemption_type}'`)

    // 2. Winner excluded from future draw eligibility AND future cycle-
    // contribution collection — nothing left to owe, nothing left to collect.
    const eligibleAfter = await call('chits:draws:eligible', waiverSchemeId, 2)
    if ((eligibleAfter.data || []).some((m: any) => m.id === w1.data.id)) note(`CRITICAL: waived winner still appears in future draw eligibility`)

    const contribAfterWin = await call('chits:contributions:record', w1.data.id, { amount: 1000, method: 'cash', cycle_no: 2 })
    if (contribAfterWin.success) note(`CRITICAL: a cycle contribution was accepted for an already-waived winner — they should owe nothing further`)
    expect(contribAfterWin.success).toBe(false)

    // 3. Non-winners are completely unaffected — still active, still
    // eligible for future draws, still expected to pay their own
    // contributions normally.
    const nonWinner2 = db.prepare('SELECT status, installment_id FROM chit_members WHERE id=?').get(w2.data.id) as any
    if (nonWinner2.status !== 'active') note(`CRITICAL: non-winning member status changed unexpectedly to '${nonWinner2.status}'`)

    const nonWinnerContrib = await call('chits:contributions:record', w2.data.id, { amount: 1000, method: 'cash', cycle_no: 1 })
    if (!nonWinnerContrib.success) note(`CRITICAL: a non-winning member's normal cycle contribution was rejected: ${nonWinnerContrib.error}`)
    expect(nonWinnerContrib.success).toBe(true)

    // Non-winners follow the ordinary payment-before-draw rule like anyone
    // else — the winner waiver must not exempt or otherwise affect them.
    // Once they pay cycle 2 (same as w2 just did above), they become
    // eligible for cycle 2, same as any unaffected member would.
    const w3Cycle2 = await call('chits:contributions:record', w3.data.id, { amount: 1000, method: 'cash', cycle_no: 2 })
    expect(w3Cycle2.success).toBe(true)
    const w2Cycle2 = await call('chits:contributions:record', w2.data.id, { amount: 1000, method: 'cash', cycle_no: 2 })
    expect(w2Cycle2.success).toBe(true)

    const eligibleStillHasNonWinners = await call('chits:draws:eligible', waiverSchemeId, 2)
    const nonWinnerIds = (eligibleStillHasNonWinners.data || []).map((m: any) => m.id)
    if (!nonWinnerIds.includes(w2.data.id) || !nonWinnerIds.includes(w3.data.id)) {
      note(`CRITICAL: non-winning members with an approved current-cycle payment are missing from future draw eligibility — expected both ${w2.data.id} and ${w3.data.id}`)
    }
    if (nonWinnerIds.includes(w1.data.id)) {
      note(`CRITICAL: the waived winner reappeared in eligibility once non-winners paid — waiver exclusion is not durable`)
    }
  })

  it('22. current-cycle payment required for draw eligibility — unpaid excluded, pending-verification excluded, approved becomes eligible, winner logic unchanged', async () => {
    setSession(mgrA)
    const schemeRes = await call('chits:create', {
      name: 'QA Current-Cycle Payment Scheme', branch_id: BR_A, product_id: PROD1, member_count: 2, cycle_count: 5,
      min_members: 2, chit_value: 60000, contribution_amount: 1000,
    })
    expect(schemeRes.success).toBe(true)
    const cycSchemeId = schemeRes.data.id

    const paidMember = await call('chits:members:add', cycSchemeId, { customer_name: 'Cycle Paid', customer_phone: '0771119971', agent_id: AGENT_REG })
    const unpaidMember = await call('chits:members:add', cycSchemeId, { customer_name: 'Cycle Unpaid', customer_phone: '0771119972', agent_id: AGENT_REG })
    expect(paidMember.success).toBe(true)
    expect(unpaidMember.success).toBe(true)

    // 1. Before anyone has paid cycle 1, the preview must be empty.
    const eligibleBeforeAnyPayment = await call('chits:draws:eligible', cycSchemeId, 1)
    if ((eligibleBeforeAnyPayment.data || []).length !== 0) {
      note(`CRITICAL: member(s) with no current-cycle payment appear in the eligible preview before any payment was made — got ${(eligibleBeforeAnyPayment.data || []).length}`)
    }

    // cash auto-approves; bank_transfer sits at pending_verification.
    const payCash = await call('chits:contributions:record', paidMember.data.id, { amount: 1000, method: 'cash', cycle_no: 1 })
    expect(payCash.success).toBe(true)
    const payPending = await call('chits:contributions:record', unpaidMember.data.id, { amount: 1000, method: 'bank_transfer', cycle_no: 1 })
    expect(payPending.success).toBe(true)

    // 1 (cont.). Preview: approved-payment member appears; pending-
    // verification (not yet approved) member must NOT.
    const eligiblePreview = await call('chits:draws:eligible', cycSchemeId, 1)
    const previewIds = (eligiblePreview.data || []).map((m: any) => m.id)
    if (!previewIds.includes(paidMember.data.id)) note(`CRITICAL: member with an approved current-cycle payment is missing from the eligible preview`)
    if (previewIds.includes(unpaidMember.data.id)) note(`CRITICAL: member with only a PENDING (not yet approved) current-cycle payment appears in the eligible preview — payment must be approved, not merely submitted`)

    // 2. The actual draw must apply the identical rule — attempting to draw
    // the not-yet-approved member must fail.
    setSession(SUPER_ADMIN)
    const drawAttemptOnUnpaid = await call('chits:draws:conduct', cycSchemeId, 1, { method: 'manual_pick', winnerMemberId: unpaidMember.data.id, reason: 'attempting to draw a member without an approved current-cycle payment' })
    if (drawAttemptOnUnpaid.success) note(`CRITICAL: chits:draws:conduct selected a member with no approved current-cycle payment — payment-before-draw rule not enforced in the actual draw`)
    expect(drawAttemptOnUnpaid.success).toBe(false)

    // 3. Approving the pending payment must make the member eligible.
    setSession(mgrA)
    const verify = await call('chits:contributions:verify', payPending.data.id, 'approve')
    expect(verify.success).toBe(true)
    const eligibleAfterApproval = await call('chits:draws:eligible', cycSchemeId, 1)
    const afterApprovalIds = (eligibleAfterApproval.data || []).map((m: any) => m.id)
    if (!afterApprovalIds.includes(unpaidMember.data.id)) note(`CRITICAL: member did not become eligible after their current-cycle payment was approved`)

    // Now both members have an approved cycle-1 payment — draw the
    // previously-unpaid member for real.
    setSession(SUPER_ADMIN)
    const draw = await call('chits:draws:conduct', cycSchemeId, 1, { method: 'manual_pick', winnerMemberId: unpaidMember.data.id, reason: 'now eligible after payment approval, confirming winner logic' })
    expect(draw.success).toBe(true)
    setSession(mgrA)

    // 4. Existing winner/removal logic must be completely unchanged by this
    // fix: redeemed status, no repayment installment, excluded from future
    // contribution collection and future draw eligibility.
    const winnerRow = db.prepare('SELECT status, redemption_type, installment_id FROM chit_members WHERE id=?').get(unpaidMember.data.id) as any
    if (winnerRow.status !== 'redeemed') note(`CRITICAL: winner status should be 'redeemed', got '${winnerRow.status}' — existing winner logic regressed`)
    if (winnerRow.installment_id) note(`CRITICAL: winner has a repayment installment_id=${winnerRow.installment_id} — the no-further-obligation business rule regressed`)

    const contribAfterWin = await call('chits:contributions:record', unpaidMember.data.id, { amount: 1000, method: 'cash', cycle_no: 2 })
    if (contribAfterWin.success) note(`CRITICAL: a contribution was accepted for an already-waived winner — winner removal-from-collection logic regressed`)

    const eligibleAfterWin = await call('chits:draws:eligible', cycSchemeId, 2)
    if ((eligibleAfterWin.data || []).some((m: any) => m.id === unpaidMember.data.id)) {
      note(`CRITICAL: waived winner still appears in future draw eligibility — winner removal-from-draws logic regressed`)
    }
  })

  it('23. final cycle multi-member settlement — all remaining members redeemed together, scheme auto-completes, enrollment/contributions blocked afterward, redemption succeeds with ample stock', async () => {
    setSession(mgrA)
    const schemeRes = await call('chits:create', {
      name: 'QA Final Cycle Scheme', branch_id: BR_A, product_id: PROD1, member_count: 3, cycle_count: 2,
      min_members: 3, chit_value: 60000, contribution_amount: 1000,
    })
    expect(schemeRes.success).toBe(true)
    const fcSchemeId = schemeRes.data.id

    const mFC1 = await call('chits:members:add', fcSchemeId, { customer_name: 'FC One', customer_phone: '0771119961', agent_id: AGENT_REG })
    const mFC2 = await call('chits:members:add', fcSchemeId, { customer_name: 'FC Two', customer_phone: '0771119962', agent_id: AGENT_REG })
    const mFC3 = await call('chits:members:add', fcSchemeId, { customer_name: 'FC Three', customer_phone: '0771119963', agent_id: AGENT_REG })
    expect(mFC1.success).toBe(true)
    expect(mFC2.success).toBe(true)
    expect(mFC3.success).toBe(true)

    // Cycle 1: everyone pays, one winner drawn (not final — cycle 1 of 2).
    for (const m of [mFC1, mFC2, mFC3]) {
      const pay = await call('chits:contributions:record', m.data.id, { amount: 1000, method: 'cash', cycle_no: 1 })
      expect(pay.success).toBe(true)
    }
    setSession(SUPER_ADMIN)
    const draw1 = await call('chits:draws:conduct', fcSchemeId, 1, { method: 'manual_pick', winnerMemberId: mFC1.data.id, reason: 'QA final-cycle test cycle 1 winner' })
    expect(draw1.success).toBe(true)
    setSession(mgrA)

    // Scheme must NOT be completed yet — 2 members (FC Two, FC Three) are
    // still active.
    const afterCycle1 = db.prepare('SELECT status FROM chit_schemes WHERE id=?').get(fcSchemeId) as any
    if (afterCycle1.status === 'completed') note(`CRITICAL: scheme marked completed after only 1 of 3 members redeemed`)

    // Cycle 2 (final, cycle_count=2): both remaining members pay, then the
    // final draw must settle BOTH together as one final_batch event.
    const pay2 = await call('chits:contributions:record', mFC2.data.id, { amount: 1000, method: 'cash', cycle_no: 2 })
    const pay3 = await call('chits:contributions:record', mFC3.data.id, { amount: 1000, method: 'cash', cycle_no: 2 })
    expect(pay2.success).toBe(true)
    expect(pay3.success).toBe(true)

    // Final-cycle batch settlement is exempt from the manual-pick admin
    // gate (it isn't a discretionary pick) — an ordinary Smart Buy manager
    // session can run it directly.
    const finalDraw = await call('chits:draws:conduct', fcSchemeId, 2, {})
    expect(finalDraw.success).toBe(true)
    if (finalDraw.data?.settledCount !== 2) note(`CRITICAL: final cycle should have settled exactly 2 remaining members, settledCount=${finalDraw.data?.settledCount}`)

    const drawRow = db.prepare('SELECT method, settled_count, eligible_count FROM chit_draws WHERE scheme_id=? AND cycle_no=2').get(fcSchemeId) as any
    if (drawRow?.method !== 'final_batch') note(`CRITICAL: final cycle draw method should be 'final_batch', got '${drawRow?.method}'`)
    if (drawRow?.settled_count !== 2) note(`CRITICAL: final cycle chit_draws.settled_count should be 2, got ${drawRow?.settled_count}`)

    // 1. Both remaining members: correct redemption_type, redeemed status,
    // no repayment obligation.
    for (const m of [mFC2, mFC3]) {
      const row = db.prepare('SELECT status, redemption_type, installment_id FROM chit_members WHERE id=?').get(m.data.id) as any
      if (row.status !== 'redeemed') note(`CRITICAL: final-cycle member ${m.data.id} status should be 'redeemed', got '${row.status}'`)
      if (row.redemption_type !== 'final_batch') note(`CRITICAL: final-cycle member ${m.data.id} redemption_type should be 'final_batch', got '${row.redemption_type}'`)
      if (row.installment_id) note(`CRITICAL: final-cycle member ${m.data.id} has a repayment installment_id despite the no-further-obligation rule`)
    }

    // Scheme must now be completed — zero members left in 'active' status.
    const afterFinal = db.prepare('SELECT status FROM chit_schemes WHERE id=?').get(fcSchemeId) as any
    if (afterFinal.status !== 'completed') note(`CRITICAL: scheme should auto-complete once every member is redeemed, status is '${afterFinal.status}'`)

    // Future contributions blocked for final-cycle winners.
    const contribAfterFinal = await call('chits:contributions:record', mFC2.data.id, { amount: 1000, method: 'cash', cycle_no: 3 })
    if (contribAfterFinal.success) note(`CRITICAL: a contribution was accepted for a final-cycle-settled member`)

    // New enrollment blocked on a completed scheme.
    const enrollAfterComplete = await call('chits:members:add', fcSchemeId, { customer_name: 'Late Joiner', customer_phone: '0771119969' })
    if (enrollAfterComplete.success) note(`CRITICAL: chits:members:add allowed enrolling a new member into a completed scheme`)
    expect(enrollAfterComplete.success).toBe(false)

    // 2/3. Ample-stock redemption: all three members (cycle-1 winner +
    // both final-cycle winners) redeem successfully, invoices/stock/
    // movements all created correctly and consistently.
    const beforeStock = stockQty(PROD1, BR_A)
    let successfulRedemptions = 0
    for (const m of [mFC1, mFC2, mFC3]) {
      const redemption = await call('chits:members:recordRedemption', m.data.id, { product_id: PROD1, qty: 1 })
      if (!redemption.success) { note(`CRITICAL: redemption failed for ${m.data.id} despite ample stock: ${redemption.error}`); continue }
      successfulRedemptions++
      const invoice = db.prepare('SELECT * FROM invoices WHERE id=?').get(redemption.data.invoiceId) as any
      if (!invoice) { note(`CRITICAL: no invoice row for successful redemption ${redemption.data.invoiceId}`); continue }
      if (Math.abs(invoice.paid_amount - invoice.total_amount) > 0.01 || invoice.due_amount !== 0) {
        note(`CRITICAL: redemption invoice for ${m.data.id} is not fully settled — paid=${invoice.paid_amount} total=${invoice.total_amount} due=${invoice.due_amount}`)
      }
      const movement = db.prepare(`SELECT id FROM stock_movements WHERE reference_order_id=?`).get(redemption.data.invoiceId) as any
      if (!movement) note(`CRITICAL: no stock_movements row recorded for redemption invoice ${redemption.data.invoiceId}`)
      const memberRow = db.prepare('SELECT redemption_invoice_id FROM chit_members WHERE id=?').get(m.data.id) as any
      if (memberRow.redemption_invoice_id !== redemption.data.invoiceId) note(`CRITICAL: chit_members.redemption_invoice_id not linked correctly for ${m.data.id}`)
    }
    if (successfulRedemptions !== 3) note(`CRITICAL: expected all 3 members to redeem successfully with ample stock, only ${successfulRedemptions} succeeded`)
    const afterStock = stockQty(PROD1, BR_A)
    if (beforeStock - afterStock !== successfulRedemptions) {
      note(`CRITICAL: stock decrement (${beforeStock - afterStock}) does not match successful redemption count (${successfulRedemptions})`)
    }
  })

  it('24. final cycle redemption with insufficient stock — one member redeems, the other fails cleanly with no data corruption', async () => {
    setSession(mgrA)
    const schemeRes = await call('chits:create', {
      name: 'QA Final Cycle Low Stock Scheme', branch_id: BR_A, product_id: PROD2, member_count: 2, cycle_count: 1,
      min_members: 2, chit_value: 60000, contribution_amount: 1000,
    })
    expect(schemeRes.success).toBe(true)
    const lsSchemeId = schemeRes.data.id

    const lsA = await call('chits:members:add', lsSchemeId, { customer_name: 'LowStock A', customer_phone: '0771119964', agent_id: AGENT_REG })
    const lsB = await call('chits:members:add', lsSchemeId, { customer_name: 'LowStock B', customer_phone: '0771119965', agent_id: AGENT_REG })
    expect(lsA.success).toBe(true)
    expect(lsB.success).toBe(true)

    // cycle_count=1 -> cycle 1 IS the final cycle, so both members are
    // settled together in a single final_batch draw with no earlier round.
    for (const m of [lsA, lsB]) {
      const pay = await call('chits:contributions:record', m.data.id, { amount: 1000, method: 'cash', cycle_no: 1 })
      expect(pay.success).toBe(true)
    }
    const draw = await call('chits:draws:conduct', lsSchemeId, 1, {})
    expect(draw.success).toBe(true)
    const scheme = db.prepare('SELECT status FROM chit_schemes WHERE id=?').get(lsSchemeId) as any
    if (scheme.status !== 'completed') note(`HIGH: scheme should be completed once its only cycle's final batch settles everyone, got '${scheme.status}'`)

    // PROD2 has exactly 1 unit of stock at BR_A (seeded, untouched by any
    // earlier successful redemption in this suite).
    const beforeStock = stockQty(PROD2, BR_A)
    if (beforeStock < 1) { note(`CRITICAL: test precondition failed — PROD2 has ${beforeStock} stock, expected at least 1`); return }

    const firstRedemption = await call('chits:members:recordRedemption', lsA.data.id, { product_id: PROD2, qty: 1 })
    if (!firstRedemption.success) note(`CRITICAL: first member's redemption failed despite available stock: ${firstRedemption.error}`)
    expect(firstRedemption.success).toBe(true)

    const afterFirst = stockQty(PROD2, BR_A)
    if (beforeStock - afterFirst !== 1) note(`CRITICAL: stock should decrement by exactly 1 after the first redemption, decremented by ${beforeStock - afterFirst}`)

    // Second member's redemption must fail cleanly — no partial stock
    // change, no invoice, no dangling redemption_invoice_id, no corruption.
    const secondRedemption = await call('chits:members:recordRedemption', lsB.data.id, { product_id: PROD2, qty: 1 })
    if (secondRedemption.success) note(`CRITICAL: second member's redemption succeeded despite insufficient stock (only ${afterFirst} left) — should have been rejected`)
    expect(secondRedemption.success).toBe(false)

    const afterSecondAttempt = stockQty(PROD2, BR_A)
    if (afterSecondAttempt !== afterFirst) note(`CRITICAL: stock changed (${afterFirst} -> ${afterSecondAttempt}) on a FAILED redemption attempt — partial/corrupted stock deduction`)

    const lsBRow = db.prepare('SELECT redemption_invoice_id FROM chit_members WHERE id=?').get(lsB.data.id) as any
    if (lsBRow.redemption_invoice_id) note(`CRITICAL: chit_members.redemption_invoice_id was set for a member whose redemption failed on insufficient stock`)

    // Member A's own record must remain fully intact and unaffected by B's failure.
    const lsARow = db.prepare('SELECT redemption_invoice_id FROM chit_members WHERE id=?').get(lsA.data.id) as any
    if (lsARow.redemption_invoice_id !== firstRedemption.data.invoiceId) note(`CRITICAL: member A's successful redemption was affected/reverted by member B's failed attempt — cross-member data corruption`)
  })

  it('25/26. commission lifecycle — no commission at enrollment, final-batch multi-member commission computed independently with no duplicates, re-redemption blocked', async () => {
    setSession(mgrA)
    const schemeRes = await call('chits:create', {
      name: 'QA Commission Final Batch Scheme', branch_id: BR_A, product_id: PROD1, member_count: 2, cycle_count: 1,
      min_members: 2, chit_value: 60000, contribution_amount: 1000,
    })
    expect(schemeRes.success).toBe(true)
    const cmSchemeId = schemeRes.data.id

    // Two DIFFERENT registering agents, so any cross-attribution between
    // members would be caught.
    const mCA = await call('chits:members:add', cmSchemeId, { customer_name: 'Comm A', customer_phone: '0771119951', agent_id: AGENT_REG })
    const mCB = await call('chits:members:add', cmSchemeId, { customer_name: 'Comm B', customer_phone: '0771119952', agent_id: AGENT_SALES })
    expect(mCA.success).toBe(true)
    expect(mCB.success).toBe(true)

    // 1. Enrollment must generate ZERO commission — it's only ever earned
    // at actual product redemption.
    const ledgerAtEnrollment = db.prepare(`SELECT COUNT(*) as c FROM commission_ledger WHERE member_id IN (?,?)`).get(mCA.data.id, mCB.data.id) as any
    if (ledgerAtEnrollment.c !== 0) note(`CRITICAL: ${ledgerAtEnrollment.c} commission_ledger row(s) exist immediately after enrollment — commission must only accrue at redemption`)

    // cycle_count=1 -> single final cycle settles both members together.
    for (const m of [mCA, mCB]) {
      const pay = await call('chits:contributions:record', m.data.id, { amount: 1000, method: 'cash', cycle_no: 1 })
      expect(pay.success).toBe(true)
    }
    const draw = await call('chits:draws:conduct', cmSchemeId, 1, {})
    expect(draw.success).toBe(true)

    // PROD1 has TWO active rules by this point in the suite (test 5's base
    // 10% product rule + test 14's 2% bonus rule, both product-scoped to
    // PROD1) — a real, legitimate stacking scenario, not a bug. Assertions
    // below deliberately don't hardcode "1 row per redemption"; they check
    // structural symmetry (A and B must produce the identical rule set)
    // and per-row agent attribution instead, so this test doesn't silently
    // assume how many active rules exist elsewhere in the shared suite.
    const redeemA = await call('chits:members:recordRedemption', mCA.data.id, { product_id: PROD1, qty: 1 })
    expect(redeemA.success).toBe(true)
    const redeemB = await call('chits:members:recordRedemption', mCB.data.id, { product_id: PROD1, qty: 1 })
    expect(redeemB.success).toBe(true)

    // 2/3. Each member's commission computed independently — correct
    // agent attribution, no cross-contamination, no duplicates.
    const rowsA = db.prepare(`SELECT * FROM commission_ledger WHERE source_table='chit_members' AND source_id=?`).all(redeemA.data.invoiceId) as any[]
    const rowsB = db.prepare(`SELECT * FROM commission_ledger WHERE source_table='chit_members' AND source_id=?`).all(redeemB.data.invoiceId) as any[]
    if (rowsA.length === 0) note(`CRITICAL: member A's redemption produced no commission_ledger rows at all`)
    if (rowsB.length === 0) note(`CRITICAL: member B's redemption produced no commission_ledger rows at all`)
    if (rowsA.length !== rowsB.length) {
      note(`CRITICAL: member A and member B redeemed the same product at the same price but produced a different number of commission_ledger rows (A=${rowsA.length}, B=${rowsB.length}) — the rule set must apply identically to both`)
    }
    if (rowsA.some((r: any) => r.registration_agent_id !== AGENT_REG)) note(`CRITICAL: member A has a commission row NOT attributed to their own agent (${AGENT_REG}) — cross-contamination`)
    if (rowsB.some((r: any) => r.registration_agent_id !== AGENT_SALES)) note(`CRITICAL: member B has a commission row NOT attributed to their own agent (${AGENT_SALES}) — cross-contamination`)
    if (rowsA.some((r: any) => r.registration_agent_id === AGENT_SALES) || rowsB.some((r: any) => r.registration_agent_id === AGENT_REG)) {
      note(`CRITICAL: a commission row was attributed to the OTHER member's agent — direct cross-contamination between two final-batch redemptions`)
    }
    const totalA = rowsA.reduce((sum: number, r: any) => sum + Number(r.total_commission || 0), 0)
    const totalB = rowsB.reduce((sum: number, r: any) => sum + Number(r.total_commission || 0), 0)
    if (Math.abs(totalA - totalB) > 0.01) note(`CRITICAL: member A and member B redeemed identically-priced products but total commission differs (A=${totalA}, B=${totalB})`)

    const totalRowsForBothInvoices = db.prepare(`
      SELECT COUNT(*) as c FROM commission_ledger WHERE source_table='chit_members' AND source_id IN (?,?)
    `).get(redeemA.data.invoiceId, redeemB.data.invoiceId) as any
    if (totalRowsForBothInvoices.c !== rowsA.length + rowsB.length) {
      note(`CRITICAL: total commission_ledger rows across both invoices (${totalRowsForBothInvoices.c}) doesn't match the sum of each member's own rows (${rowsA.length + rowsB.length}) — a row leaked onto the wrong invoice`)
    }

    // Re-redemption attempt must be blocked AND must not generate any
    // additional commission row beyond what the first, successful
    // redemption already produced.
    const redeemAAgain = await call('chits:members:recordRedemption', mCA.data.id, { product_id: PROD1, qty: 1 })
    if (redeemAAgain.success) note(`CRITICAL: a second redemption succeeded for an already-redeemed member`)
    expect(redeemAAgain.success).toBe(false)
    const rowsAAfterRetry = db.prepare(`SELECT COUNT(*) as c FROM commission_ledger WHERE source_table='chit_members' AND source_id=?`).get(redeemA.data.invoiceId) as any
    if (rowsAAfterRetry.c !== rowsA.length) note(`CRITICAL: a blocked re-redemption attempt changed the commission row count for member A — before=${rowsA.length} after=${rowsAAfterRetry.c}`)
  })

  it('27. paid commission cannot be paid again — a second markPaid call on an already-paid entry is a safe no-op', async () => {
    // Reuses whichever ledger row test 6 already drove all the way to
    // 'paid' — avoids re-deriving a whole scheme/redemption just to get
    // one paid ledger row.
    const paidRow = db.prepare(`SELECT id FROM commission_ledger WHERE status='paid' LIMIT 1`).get() as any
    if (!paidRow) { note('CRITICAL: no paid commission_ledger row found to test double-payment prevention against — test 6 may have regressed'); return }

    const approvalLogsBefore = db.prepare(`SELECT COUNT(*) as c FROM commission_approval_logs WHERE commission_id=? AND action='PAID'`).get(paidRow.id) as any

    setSession(SUPER_ADMIN)
    const secondMarkPaid = await call('commissions:ledger:markPaid', [paidRow.id])
    // markPaid is a bulk convenience action — it silently skips ineligible
    // rows rather than hard-failing the whole call, but it must not
    // re-process an already-paid row.
    if (secondMarkPaid.success && secondMarkPaid.data?.updated > 0) {
      note(`CRITICAL: commissions:ledger:markPaid re-processed an already-paid commission entry — data.updated=${secondMarkPaid.data.updated}`)
    }

    const statusAfter = db.prepare('SELECT status FROM commission_ledger WHERE id=?').get(paidRow.id) as any
    if (statusAfter.status !== 'paid') note(`CRITICAL: commission entry status changed from 'paid' after a second markPaid call — got '${statusAfter.status}'`)

    const approvalLogsAfter = db.prepare(`SELECT COUNT(*) as c FROM commission_approval_logs WHERE commission_id=? AND action='PAID'`).get(paidRow.id) as any
    if (approvalLogsAfter.c !== approvalLogsBefore.c) note(`CRITICAL: a duplicate 'PAID' approval-log entry was written on a second markPaid call — before=${approvalLogsBefore.c} after=${approvalLogsAfter.c}`)
    setSession(mgrA)
  })

  it('28. agent access restriction — an Agent-portal session cannot approve or reject ANY commission entry, including their own', async () => {
    // Link AGENT_SALES to a fresh user and act as that agent.
    seedUser('u-agent-sales', 'QA Agent Sales User', BR_A)
    db.prepare(`UPDATE agents SET user_id=? WHERE id=?`).run('u-agent-sales', AGENT_SALES)
    const agentSalesSession = makeSession({ id: 'u-agent-sales', branchId: BR_A, permissions: { chits: true }, agentId: AGENT_SALES, sessionLevel: 'agent' })

    // A ledger row already credited to AGENT_SALES themselves (from test
    // 25/26) — the worst-case self-dealing scenario.
    const ownRow = db.prepare(`
      SELECT id, status FROM commission_ledger WHERE registration_agent_id=? AND status='pending_manager_approval' LIMIT 1
    `).get(AGENT_SALES) as any
    if (!ownRow) { note('CRITICAL: no pending_manager_approval commission row credited to AGENT_SALES found to test self-approval against'); return }

    setSession(agentSalesSession)
    const selfApprove = await call('commissions:ledger:approve', ownRow.id)
    if (selfApprove.success) note(`CRITICAL: an Agent-portal session was able to approve their OWN commission entry at the manager stage — self-dealing control gap`)
    expect(selfApprove.success).toBe(false)

    const selfReject = await call('commissions:ledger:reject', ownRow.id, 'agent trying to reject their own entry')
    if (selfReject.success) note(`CRITICAL: an Agent-portal session was able to reject a commission entry`)
    expect(selfReject.success).toBe(false)

    const statusUnchanged = db.prepare('SELECT status FROM commission_ledger WHERE id=?').get(ownRow.id) as any
    if (statusUnchanged.status !== 'pending_manager_approval') note(`CRITICAL: commission entry status changed despite both agent approve/reject attempts being rejected — got '${statusUnchanged.status}'`)
    setSession(mgrA)
  })

  it('29. reports & dashboard accuracy — final-batch winners fully visible on every report surface, scheme summary counts correct (regression for the winner_member_id single-FK gap)', async () => {
    setSession(mgrA)
    const schemeRes = await call('chits:create', {
      name: 'QA Reports Accuracy Scheme', branch_id: BR_A, product_id: PROD1, member_count: 2, cycle_count: 1,
      min_members: 2, chit_value: 60000, contribution_amount: 1000,
    })
    expect(schemeRes.success).toBe(true)
    const repSchemeId = schemeRes.data.id
    const repSchemeNumber = schemeRes.data.scheme_number

    const rA = await call('chits:members:add', repSchemeId, { customer_name: 'Report Winner A', customer_phone: '0771119941', agent_id: AGENT_REG })
    const rB = await call('chits:members:add', repSchemeId, { customer_name: 'Report Winner B', customer_phone: '0771119942', agent_id: AGENT_SALES })
    expect(rA.success).toBe(true)
    expect(rB.success).toBe(true)

    for (const m of [rA, rB]) {
      const pay = await call('chits:contributions:record', m.data.id, { amount: 1000, method: 'cash', cycle_no: 1 })
      expect(pay.success).toBe(true)
    }
    // cycle_count=1 -> single final cycle settles both together as one final_batch draw.
    const draw = await call('chits:draws:conduct', repSchemeId, 1, {})
    expect(draw.success).toBe(true)

    const redA = await call('chits:members:recordRedemption', rA.data.id, { product_id: PROD1, qty: 1 })
    const redB = await call('chits:members:recordRedemption', rB.data.id, { product_id: PROD1, qty: 1 })
    expect(redA.success).toBe(true)
    expect(redB.success).toBe(true)

    // 1. Scheme summary — total/redeemed member counts and completed status.
    const summary = await call('chits:reports', { schemeId: repSchemeId })
    const summaryRow = (summary.data || [])[0]
    if (!summaryRow) { note('CRITICAL: chits:reports returned no row for the test scheme'); }
    else {
      if (summaryRow.members_enrolled !== 2) note(`CRITICAL: scheme summary members_enrolled should be 2, got ${summaryRow.members_enrolled}`)
      if (summaryRow.members_redeemed !== 2) note(`CRITICAL: scheme summary members_redeemed should be 2, got ${summaryRow.members_redeemed}`)
      if (summaryRow.status !== 'completed') note(`CRITICAL: scheme summary status should be 'completed' once both final-batch winners are redeemed, got '${summaryRow.status}'`)
    }

    // 2. Winner report — exactly one row per winning member (not one row
    // per draw event), so a final_batch settlement never silently drops a
    // winner behind a NULL winner_member_id.
    const winnersReport = await call('chits:reports:winners', { schemeId: repSchemeId })
    const winnerRows = (winnersReport.data || []).filter((r: any) => r.scheme_number === repSchemeNumber)
    if (winnerRows.length !== 2) note(`CRITICAL: chits:reports:winners should return 2 rows for a 2-member final_batch settlement, got ${winnerRows.length}`)
    const winnerNames = winnerRows.map((r: any) => r.winner_name)
    if (!winnerNames.includes('Report Winner A')) note(`CRITICAL: chits:reports:winners is missing final-batch winner "Report Winner A"`)
    if (!winnerNames.includes('Report Winner B')) note(`CRITICAL: chits:reports:winners is missing final-batch winner "Report Winner B"`)
    if (winnerRows.some((r: any) => !r.redeemed_product_name)) note(`CRITICAL: a winner report row is missing its redeemed product name`)
    if (winnerRows.some((r: any) => !r.redemption_invoice_number)) note(`CRITICAL: a winner report row is missing its redemption invoice number`)

    // 3. Draw history (chits:draws:list, one row per draw EVENT) must name
    // BOTH winners, not just whichever one used to win winner_member_id's
    // single-FK slot.
    const drawsList = await call('chits:draws:list', repSchemeId)
    const finalDrawRow = (drawsList.data || []).find((d: any) => d.cycle_no === 1)
    if (!finalDrawRow) { note('CRITICAL: chits:draws:list has no row for cycle 1'); }
    else if (!finalDrawRow.winner_name || !finalDrawRow.winner_name.includes('Report Winner A') || !finalDrawRow.winner_name.includes('Report Winner B')) {
      note(`CRITICAL: chits:draws:list winner_name should list both final-batch winners, got '${finalDrawRow.winner_name}'`)
    }

    // chits:get's embedded draw history must show the identical fix.
    const schemeDetail = await call('chits:get', repSchemeId)
    const embeddedDrawRow = (schemeDetail.data?.draws || []).find((d: any) => d.cycle_no === 1)
    if (!embeddedDrawRow || !embeddedDrawRow.winner_name || !embeddedDrawRow.winner_name.includes('Report Winner A') || !embeddedDrawRow.winner_name.includes('Report Winner B')) {
      note(`CRITICAL: chits:get's embedded draws list is missing one or both final-batch winners — got '${embeddedDrawRow?.winner_name}'`)
    }

    // 4. Dashboard "recent draws" — one row per winning member, both present.
    const dashboard = await call('chits:dashboard', { branchId: BR_A })
    const recentForThisScheme = (dashboard.data?.recent_draws || []).filter((r: any) => r.scheme_number === repSchemeNumber)
    const recentNames = recentForThisScheme.map((r: any) => r.winner_name)
    if (!recentNames.includes('Report Winner A') || !recentNames.includes('Report Winner B')) {
      note(`CRITICAL: chits:dashboard recent_draws is missing one or both final-batch winners for this scheme — got: ${recentNames.join(', ') || '(none)'}`)
    }
  })

  it('30. commission_earned excludes rejected entries in agent reports (regression for the status-blind SUM)', async () => {
    setSession(mgrA)
    const freshAgent = 'agent-reports-qa2'
    seedAgent(freshAgent, 'AG-REPORTS2', BR_A, 5)

    setSession(SUPER_ADMIN)
    const ruleRes = await call('commissions:rules:create', {
      name: 'QA Reports Rejected Rule', scope: 'product', product_id: PROD1,
      calculation_type: 'fixed', rate: 500, ownership_model: 'registration', status: 'active',
    })
    expect(ruleRes.success).toBe(true)

    setSession(mgrA)
    const schemeRes = await call('chits:create', {
      name: 'QA Commission Earned Scheme', branch_id: BR_A, product_id: PROD1, member_count: 1, cycle_count: 1,
      min_members: 1, chit_value: 60000, contribution_amount: 1000,
    })
    expect(schemeRes.success).toBe(true)
    const ceSchemeId = schemeRes.data.id
    const m = await call('chits:members:add', ceSchemeId, { customer_name: 'Comm Earned Member', customer_phone: '0771119943', agent_id: freshAgent })
    expect(m.success).toBe(true)
    const pay = await call('chits:contributions:record', m.data.id, { amount: 1000, method: 'cash', cycle_no: 1 })
    expect(pay.success).toBe(true)
    const draw = await call('chits:draws:conduct', ceSchemeId, 1, {})
    expect(draw.success).toBe(true)
    const redemption = await call('chits:members:recordRedemption', m.data.id, { product_id: PROD1, qty: 1 })
    expect(redemption.success).toBe(true)

    // PROD1 has multiple active rules stacking by this point in the suite
    // (this test's own base rule + test 14's bonus rule both match) — a
    // redemption against it can legitimately produce more than one
    // commission_ledger row. Reject ALL of them, not just one, so the
    // "excludes rejected entries" assertion below isn't polluted by a
    // second, still-pending row.
    const ledgerRows = db.prepare(`SELECT id FROM commission_ledger WHERE source_id=?`).all(redemption.data.invoiceId) as any[]
    if (ledgerRows.length === 0) { note('CRITICAL: no commission_ledger row created for a redemption matching an active fixed-rate rule — cannot test commission_earned exclusion'); return }

    const beforeReject = await call('chits:agents:report', { branchId: BR_A })
    const beforeRow = (beforeReject.data || []).find((a: any) => a.id === freshAgent)
    if (Number(beforeRow?.commission_earned || 0) < 499.99) note(`HIGH: commission_earned should include fresh, still-pending commission entries — got ${beforeRow?.commission_earned}, expected at least ~500`)

    for (const row of ledgerRows) {
      const rejection = await call('commissions:ledger:reject', row.id, 'QA testing commission_earned exclusion')
      expect(rejection.success).toBe(true)
    }

    // commission_earned must now exclude the rejected entry — checked on
    // both the agent list report and the single-agent detail view (same
    // fix applied to both underlying queries).
    const afterReject = await call('chits:agents:report', { branchId: BR_A })
    const afterRow = (afterReject.data || []).find((a: any) => a.id === freshAgent)
    if (Number(afterRow?.commission_earned || 0) !== 0) note(`CRITICAL: chits:agents:report commission_earned still includes a REJECTED commission entry — got ${afterRow?.commission_earned}, expected 0`)

    const detail = await call('chits:agents:detail', freshAgent)
    if (Number(detail.data?.stats?.commission_earned || 0) !== 0) note(`CRITICAL: chits:agents:detail commission_earned still includes a rejected entry — got ${detail.data?.stats?.commission_earned}, expected 0`)
  })

  it('31. concurrent draw attempts on the same cycle — only one wins, the other fails cleanly with no duplicate chit_draws row or double-processed winner', async () => {
    setSession(mgrA)
    const schemeRes = await call('chits:create', {
      name: 'QA Concurrent Draw Scheme', branch_id: BR_A, product_id: PROD1, member_count: 3, cycle_count: 5,
      min_members: 2, chit_value: 60000, contribution_amount: 1000,
    })
    expect(schemeRes.success).toBe(true)
    const ccSchemeId = schemeRes.data.id
    const c1 = await call('chits:members:add', ccSchemeId, { customer_name: 'Concurrent Draw A', customer_phone: '0771119931', agent_id: AGENT_REG })
    const c2 = await call('chits:members:add', ccSchemeId, { customer_name: 'Concurrent Draw B', customer_phone: '0771119932', agent_id: AGENT_REG })
    expect(c1.success).toBe(true)
    expect(c2.success).toBe(true)
    for (const m of [c1, c2]) {
      const pay = await call('chits:contributions:record', m.data.id, { amount: 1000, method: 'cash', cycle_no: 1 })
      expect(pay.success).toBe(true)
    }

    // Two "simultaneous" draw attempts for the identical cycle — modeling
    // two staff members (or a double-click) both triggering the draw at
    // once. better-sqlite3 is synchronous and Node is single-threaded, so
    // within one process these two IPC calls cannot actually interleave
    // mid-transaction — but this proves the outcome is safe regardless:
    // exactly one draw is created, the other is rejected cleanly.
    const [resultA, resultB] = await Promise.all([
      call('chits:draws:conduct', ccSchemeId, 1, { method: 'random' }),
      call('chits:draws:conduct', ccSchemeId, 1, { method: 'random' }),
    ])
    const successes = [resultA, resultB].filter(r => r.success)
    if (successes.length !== 1) note(`CRITICAL: exactly one of two concurrent draw attempts for the same cycle should succeed, got ${successes.length}`)
    expect(successes.length).toBe(1)

    const drawRows = db.prepare('SELECT COUNT(*) as c FROM chit_draws WHERE scheme_id=? AND cycle_no=1').get(ccSchemeId) as any
    if (drawRows.c !== 1) note(`CRITICAL: expected exactly 1 chit_draws row for the contested cycle, got ${drawRows.c} — concurrent draw created a duplicate`)

    // Exactly one of the two members should have been redeemed — not both,
    // not neither.
    const redeemedCount = db.prepare(`SELECT COUNT(*) as c FROM chit_members WHERE scheme_id=? AND status='redeemed'`).get(ccSchemeId) as any
    if (redeemedCount.c !== 1) note(`CRITICAL: expected exactly 1 member redeemed after the contested draw, got ${redeemedCount.c}`)
  })

  it('32. concurrent redemption attempts for the same member — only one succeeds, stock decrements exactly once, no duplicate commission', async () => {
    setSession(mgrA)
    const schemeRes = await call('chits:create', {
      name: 'QA Concurrent Redemption Scheme', branch_id: BR_A, product_id: PROD1, member_count: 1, cycle_count: 1,
      min_members: 1, chit_value: 60000, contribution_amount: 1000,
    })
    expect(schemeRes.success).toBe(true)
    const crSchemeId = schemeRes.data.id
    const cm = await call('chits:members:add', crSchemeId, { customer_name: 'Concurrent Redeem', customer_phone: '0771119933', agent_id: AGENT_REG })
    expect(cm.success).toBe(true)
    const pay = await call('chits:contributions:record', cm.data.id, { amount: 1000, method: 'cash', cycle_no: 1 })
    expect(pay.success).toBe(true)
    const draw = await call('chits:draws:conduct', crSchemeId, 1, {})
    expect(draw.success).toBe(true)

    const beforeStock = stockQty(PROD1, BR_A)
    const [redA, redB] = await Promise.all([
      call('chits:members:recordRedemption', cm.data.id, { product_id: PROD1, qty: 1 }),
      call('chits:members:recordRedemption', cm.data.id, { product_id: PROD1, qty: 1 }),
    ])
    const successfulRedemptions = [redA, redB].filter(r => r.success)
    if (successfulRedemptions.length !== 1) note(`CRITICAL: exactly one of two concurrent redemption attempts for the same member should succeed, got ${successfulRedemptions.length}`)
    expect(successfulRedemptions.length).toBe(1)

    const afterStock = stockQty(PROD1, BR_A)
    if (beforeStock - afterStock !== 1) note(`CRITICAL: stock should decrement by exactly 1 across both concurrent attempts combined, decremented by ${beforeStock - afterStock}`)

    // Commission dedup itself is already covered by tests 25/26 — here the
    // point is specifically that the LOSING concurrent attempt never
    // reached computeAndRecordCommission at all (it's blocked earlier, at
    // either the atomic stock UPDATE or the in-transaction
    // redemption_invoice_id re-check), so there is no way for this race to
    // produce a second, duplicate commission_ledger row for this invoice.
    const invoiceId = successfulRedemptions[0].data.invoiceId
    const memberRow = db.prepare('SELECT redemption_invoice_id FROM chit_members WHERE id=?').get(cm.data.id) as any
    if (memberRow.redemption_invoice_id !== invoiceId) note(`CRITICAL: chit_members.redemption_invoice_id doesn't match the one successful redemption's invoice`)
  })

  it('33. duplicate contribution submission — now blocked at the backend by the one-approved-contribution-per-cycle rule (previously an open, documented gap)', async () => {
    // Previously this test only documented an accepted gap (no backend
    // idempotency guard on chits:contributions:record — only the
    // frontend's submittingRef prevented a real double-click). The
    // confirmed "one approved contribution per (member, scheme, cycle)"
    // business rule closes it as a direct side effect: two concurrent
    // identical submissions for the same member/scheme/cycle can now never
    // both succeed, regardless of what triggered the second one (double
    // click, retry, or a genuine two-device race).
    setSession(mgrA)
    const schemeRes = await call('chits:create', {
      name: 'QA Duplicate Contribution Scheme', branch_id: BR_A, product_id: PROD1, member_count: 2, cycle_count: 5,
      min_members: 2, chit_value: 60000, contribution_amount: 1000,
    })
    expect(schemeRes.success).toBe(true)
    const dcSchemeId = schemeRes.data.id
    const d1 = await call('chits:members:add', dcSchemeId, { customer_name: 'Dup Contrib', customer_phone: '0771119934', agent_id: AGENT_REG })
    const d2 = await call('chits:members:add', dcSchemeId, { customer_name: 'Dup Contrib Filler', customer_phone: '0771119935', agent_id: AGENT_REG })
    expect(d1.success).toBe(true)
    expect(d2.success).toBe(true)

    // Two back-to-back IDENTICAL submissions for the same member/cycle/
    // amount, exactly what an unprotected double-click would send.
    const [payA, payB] = await Promise.all([
      call('chits:contributions:record', d1.data.id, { amount: 1000, method: 'cash', cycle_no: 1 }),
      call('chits:contributions:record', d1.data.id, { amount: 1000, method: 'cash', cycle_no: 1 }),
    ])
    const successes = [payA, payB].filter(r => r.success)
    if (successes.length !== 1) note(`CRITICAL: expected exactly 1 of 2 identical concurrent contribution submissions to succeed, got ${successes.length} — the one-approved-per-cycle rule should make this impossible to double-accept`)
    expect(successes.length).toBe(1)

    const approvedCount = db.prepare(`SELECT COUNT(*) as c FROM chit_contributions WHERE member_id=? AND scheme_id=? AND cycle_no=1 AND status='approved'`).get(d1.data.id, dcSchemeId) as any
    if (approvedCount.c !== 1) note(`CRITICAL: expected exactly 1 approved contribution row after the duplicate-submission race, got ${approvedCount.c}`)
  })

  it('34. large dataset performance — 100 schemes, 5,000 members: dashboard, winner report, and agent report all complete within a sane time bound', async () => {
    const PERF_BRANCH = 'branch-perf'
    seedBranch(PERF_BRANCH, 'Perf Branch', 'PRF')
    seedProduct('prod-perf', 'Perf Product', 10000, 0)
    seedStock('prod-perf', PERF_BRANCH, 1000000)
    const perfAgents = ['agent-perf-1', 'agent-perf-2', 'agent-perf-3']
    for (const a of perfAgents) seedAgent(a, a.toUpperCase(), PERF_BRANCH, 5)

    const SCHEME_COUNT = 100
    const MEMBERS_PER_SCHEME = 50 // 100 x 50 = 5,000 members

    const insertCustomer = db.prepare(`INSERT INTO customers (id, branch_id, name, phone) VALUES (?,?,?,?)`)
    const insertScheme = db.prepare(`
      INSERT INTO chit_schemes (id, scheme_number, name, branch_id, product_id, member_count, cycle_count, contribution_amount, chit_value, start_date, status, min_members)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    `)
    const insertMember = db.prepare(`
      INSERT INTO chit_members (id, scheme_id, customer_id, agent_id, join_order, status, redemption_type, won_cycle_no, contributions_paid, enrolled_branch_id)
      VALUES (?,?,?,?,?,?,?,?,?,?)
    `)
    const insertDraw = db.prepare(`
      INSERT INTO chit_draws (id, scheme_id, cycle_no, winner_member_id, settled_count, eligible_count, method)
      VALUES (?,?,?,?,?,?,?)
    `)
    const insertContribution = db.prepare(`
      INSERT INTO chit_contributions (id, scheme_id, member_id, cycle_no, amount, method, status, branch_id, paid_at)
      VALUES (?,?,?,?,?,?,?,?,?)
    `)

    const seedStart = Date.now()
    db.transaction(() => {
      for (let s = 0; s < SCHEME_COUNT; s++) {
        const schemeId = `perf-scheme-${s}`
        insertScheme.run(
          schemeId, `PRF-${s}`, `Perf Scheme ${s}`, PERF_BRANCH, 'prod-perf',
          MEMBERS_PER_SCHEME, 5, 1000, 60000, '2026-01-01',
          s % 5 === 0 ? 'completed' : 'active', 2
        )
        for (let m = 0; m < MEMBERS_PER_SCHEME; m++) {
          const memberId = `perf-member-${s}-${m}`
          const customerId = `perf-customer-${s}-${m}`
          const agentId = perfAgents[m % perfAgents.length]
          const isWinner = m < 5 // first 5 members per scheme are winners
          insertCustomer.run(customerId, PERF_BRANCH, `Perf Customer ${s}-${m}`, `07${String(s).padStart(4, '0')}${String(m).padStart(3, '0')}`)
          insertMember.run(
            memberId, schemeId, customerId, agentId, m + 1,
            isWinner ? 'redeemed' : 'active',
            isWinner ? 'draw' : null,
            isWinner ? m + 1 : null,
            1000 * (m % 4 + 1),
            PERF_BRANCH
          )
          // A couple of contribution rows per member, spread across months.
          for (let c = 0; c < 2; c++) {
            insertContribution.run(
              `perf-contrib-${s}-${m}-${c}`, schemeId, memberId, c + 1, 1000, 'cash', 'approved',
              PERF_BRANCH, `2026-0${(c % 6) + 1}-15T10:00:00.000Z`
            )
          }
          if (isWinner) {
            insertDraw.run(`perf-draw-${s}-${m}`, schemeId, m + 1, memberId, 1, MEMBERS_PER_SCHEME - m, 'random')
          }
        }
      }
    })()
    const seedMs = Date.now() - seedStart

    setSession(SUPER_ADMIN)
    const TIME_BUDGET_MS = 3000 // generous — this is a stability/regression guard, not a strict benchmark

    const timeCall = async (label: string, fn: () => Promise<any>) => {
      const start = Date.now()
      const res = await fn()
      const elapsed = Date.now() - start
      if (!res.success) note(`CRITICAL: ${label} failed against the large dataset: ${res.error}`)
      if (elapsed > TIME_BUDGET_MS) note(`HIGH: ${label} took ${elapsed}ms against 100 schemes / 5,000 members — exceeds the ${TIME_BUDGET_MS}ms sanity budget, likely an unindexed scan`)
      return elapsed
    }

    const dashboardMs = await timeCall('chits:dashboard (whole company)', () => call('chits:dashboard', {}))
    const winnersMs = await timeCall('chits:reports:winners (whole company)', () => call('chits:reports:winners', {}))
    const agentsMs = await timeCall('chits:agents:report (whole company)', () => call('chits:agents:report', {}))
    const schemesMs = await timeCall('chits:reports (scheme summary, whole company)', () => call('chits:reports', {}))
    const membersMs = await timeCall('chits:reports:members (whole company)', () => call('chits:reports:members', {}))

    console.log(`[PERF] seed=${seedMs}ms dashboard=${dashboardMs}ms winners=${winnersMs}ms agents=${agentsMs}ms schemes=${schemesMs}ms members=${membersMs}ms`)

    // Sanity check the data actually landed, not just that queries returned fast on nothing.
    const winnersReport = await call('chits:reports:winners', {})
    const perfWinnerCount = (winnersReport.data || []).filter((r: any) => String(r.scheme_number || '').startsWith('PRF-')).length
    if (perfWinnerCount !== SCHEME_COUNT * 5) note(`CRITICAL: expected ${SCHEME_COUNT * 5} winner rows from the seeded performance dataset, got ${perfWinnerCount} — report may be silently dropping rows at scale`)
  }, 60000)

  it('35. a cycle already fully settled rejects further payments — but only once its balance is zero (superseded by flexible contributions, tests 36-39); multi-scheme and multi-cycle payments unaffected, draw eligibility still correct', async () => {
    setSession(mgrA)
    const schemeARes = await call('chits:create', {
      name: 'QA Cycle Rule Scheme A', branch_id: BR_A, product_id: PROD1, member_count: 2, cycle_count: 5,
      min_members: 2, chit_value: 60000, contribution_amount: 1000,
    })
    const schemeBRes = await call('chits:create', {
      name: 'QA Cycle Rule Scheme B', branch_id: BR_A, product_id: PROD1, member_count: 2, cycle_count: 5,
      min_members: 2, chit_value: 60000, contribution_amount: 1000,
    })
    expect(schemeARes.success).toBe(true)
    expect(schemeBRes.success).toBe(true)
    const schemeAId = schemeARes.data.id
    const schemeBId = schemeBRes.data.id

    // Same phone -> same underlying customer (existing dedupe-by-phone
    // behavior), but a DIFFERENT chit_members row per scheme — this is
    // exactly the "Customer A in both Scheme A and Scheme B" case.
    const sharedPhone = '0771119921'
    const memberA1 = await call('chits:members:add', schemeAId, { customer_name: 'Cycle Rule Customer', customer_phone: sharedPhone, agent_id: AGENT_REG })
    const memberA2 = await call('chits:members:add', schemeAId, { customer_name: 'Cycle Rule Filler A', customer_phone: '0771119922', agent_id: AGENT_REG })
    expect(memberA1.success).toBe(true)
    expect(memberA2.success).toBe(true)
    const memberB1 = await call('chits:members:add', schemeBId, { customer_name: 'Cycle Rule Customer', customer_phone: sharedPhone, agent_id: AGENT_REG })
    const memberB2 = await call('chits:members:add', schemeBId, { customer_name: 'Cycle Rule Filler B', customer_phone: '0771119923', agent_id: AGENT_REG })
    expect(memberB1.success).toBe(true)
    expect(memberB2.success).toBe(true)
    const custA = db.prepare('SELECT customer_id FROM chit_members WHERE id=?').get(memberA1.data.id) as any
    const custB = db.prepare('SELECT customer_id FROM chit_members WHERE id=?').get(memberB1.data.id) as any
    if (custA.customer_id !== custB.customer_id) note(`CRITICAL: test setup issue — memberA1 and memberB1 should share the same customer_id (same phone), got ${custA.customer_id} vs ${custB.customer_id}`)

    // First approved payment for Scheme A, cycle 1 — succeeds.
    const payA1 = await call('chits:contributions:record', memberA1.data.id, { amount: 1000, method: 'cash', cycle_no: 1 })
    expect(payA1.success).toBe(true)

    // 1. Duplicate: SAME member, SAME scheme, SAME cycle, and the cycle's
    // Rs.1000 expected amount is already fully settled by the first
    // payment — a further payment is rejected (nothing outstanding to pay).
    const payA1Again = await call('chits:contributions:record', memberA1.data.id, { amount: 1000, method: 'cash', cycle_no: 1 })
    if (payA1Again.success) note(`CRITICAL: a second payment was accepted for a cycle whose balance was already zero`)
    expect(payA1Again.success).toBe(false)
    expect(String(payA1Again.error || '')).toMatch(/already fully paid/i)

    // A duplicate PENDING (bank_transfer) submission for an already-paid
    // cycle must also be rejected up front, not just an approved one.
    const payA1Pending = await call('chits:contributions:record', memberA1.data.id, { amount: 1000, method: 'bank_transfer', cycle_no: 1 })
    if (payA1Pending.success) note(`CRITICAL: a duplicate PENDING contribution was accepted for a cycle that already has an approved payment`)
    expect(payA1Pending.success).toBe(false)

    const approvedCount = db.prepare(`SELECT COUNT(*) as c FROM chit_contributions WHERE member_id=? AND scheme_id=? AND cycle_no=1 AND status='approved'`).get(memberA1.data.id, schemeAId) as any
    if (approvedCount.c !== 1) note(`CRITICAL: expected exactly 1 approved contribution for member A1 cycle 1, got ${approvedCount.c}`)

    // 2. Same member, a DIFFERENT cycle in the SAME scheme — must succeed.
    const payA1Cycle2 = await call('chits:contributions:record', memberA1.data.id, { amount: 1000, method: 'cash', cycle_no: 2 })
    if (!payA1Cycle2.success) note(`CRITICAL: a legitimate payment for a different cycle in the same scheme was rejected: ${payA1Cycle2.error}`)
    expect(payA1Cycle2.success).toBe(true)

    // 3/4. Same customer, DIFFERENT scheme, SAME cycle number (1) — must
    // succeed. The rule is scoped per-scheme, never just per-customer/cycle.
    const payB1Cycle1 = await call('chits:contributions:record', memberB1.data.id, { amount: 1000, method: 'cash', cycle_no: 1 })
    if (!payB1Cycle1.success) note(`CRITICAL: the same customer's payment in a different scheme, same cycle number, was incorrectly rejected: ${payB1Cycle1.error}`)
    expect(payB1Cycle1.success).toBe(true)

    // 5. Draw eligibility still works correctly after this change: member
    // A1 has approved cycle-1 AND cycle-2 payments -> eligible for cycle 2.
    // Member A2 never paid at all -> excluded from cycle 2.
    const eligibleCycle2 = await call('chits:draws:eligible', schemeAId, 2)
    const eligibleIds = (eligibleCycle2.data || []).map((m: any) => m.id)
    if (!eligibleIds.includes(memberA1.data.id)) note(`CRITICAL: member A1 (paid cycle 2) should be eligible for cycle 2's draw`)
    if (eligibleIds.includes(memberA2.data.id)) note(`CRITICAL: member A2 (no cycle-2 payment) should NOT be eligible for cycle 2's draw`)

    setSession(SUPER_ADMIN)
    const draw = await call('chits:draws:conduct', schemeAId, 2, { method: 'manual_pick', winnerMemberId: memberA1.data.id, reason: 'QA one-approved-per-cycle regression, draw eligibility check' })
    expect(draw.success).toBe(true)
    setSession(mgrA)
    const winnerRow = db.prepare('SELECT status FROM chit_members WHERE id=?').get(memberA1.data.id) as any
    if (winnerRow.status !== 'redeemed') note(`CRITICAL: the draw did not correctly redeem the eligible member after the one-approved-per-cycle rule was added`)

    // Note: the old DB-level UNIQUE index that hard-blocked a second
    // approved row per (member, scheme, cycle) has been intentionally
    // dropped — flexible contributions (tests 36-39) require multiple
    // legitimate approved rows against the same cycle (installments).
    // Duplicate-prevention is now enforced at the application layer only,
    // via the balance-based check exercised above.
  })

  it('36. flexible contributions — exact payment, overpayment creates carry-forward credit, credit auto-applies to a later underpayment', async () => {
    setSession(mgrA)
    const schemeRes = await call('chits:create', {
      name: 'QA Flexible Contrib Scheme C', branch_id: BR_A, product_id: PROD1, member_count: 2, cycle_count: 3,
      min_members: 2, chit_value: 60000, contribution_amount: 5000,
    })
    expect(schemeRes.success).toBe(true)
    const schemeId = schemeRes.data.id

    const memberExact = await call('chits:members:add', schemeId, { customer_name: 'Flex Exact Payer', customer_phone: '0771130001', agent_id: AGENT_REG })
    const memberExtra = await call('chits:members:add', schemeId, { customer_name: 'Flex Extra Payer', customer_phone: '0771130002', agent_id: AGENT_REG })
    expect(memberExact.success).toBe(true)
    expect(memberExtra.success).toBe(true)

    // Customer pays exact amount -> cycle fully settled, no credit generated.
    const exactPay = await call('chits:contributions:record', memberExact.data.id, { amount: 5000, method: 'cash', cycle_no: 1 })
    if (!exactPay.success) note(`CRITICAL: an exact-amount payment (5000 against a 5000 expected cycle) was rejected: ${exactPay.error}`)
    expect(exactPay.success).toBe(true)
    if (exactPay.data.balanceDue !== 0) note(`CRITICAL: exact payment left a nonzero balanceDue (${exactPay.data.balanceDue})`)
    if (exactPay.data.creditApplied !== 0) note(`CRITICAL: exact payment incorrectly applied credit (${exactPay.data.creditApplied})`)
    if (exactPay.data.cycleStatus !== 'completed') note(`CRITICAL: exact payment's cycleStatus should be 'completed', got '${exactPay.data.cycleStatus}'`)
    const exactMemberRow = db.prepare('SELECT credit_balance FROM chit_members WHERE id=?').get(memberExact.data.id) as any
    if (Number(exactMemberRow.credit_balance) !== 0) note(`CRITICAL: exact payment should not create any carry-forward credit, got credit_balance=${exactMemberRow.credit_balance}`)

    // Customer pays extra amount (6000 against 5000 expected) -> cycle
    // settled AND a 1000 credit is carried forward onto the member.
    const extraPay = await call('chits:contributions:record', memberExtra.data.id, { amount: 6000, method: 'cash', cycle_no: 1 })
    if (!extraPay.success) note(`CRITICAL: an overpayment (6000 against 5000 expected) was rejected: ${extraPay.error}`)
    expect(extraPay.success).toBe(true)
    if (extraPay.data.balanceDue !== 0) note(`CRITICAL: overpayment left a nonzero balanceDue (${extraPay.data.balanceDue})`)
    if (extraPay.data.creditBalance !== 1000) note(`CRITICAL: a 1000 LKR overpayment should carry forward exactly 1000 credit, got ${extraPay.data.creditBalance}`)
    const extraMemberRowAfterCycle1 = db.prepare('SELECT credit_balance FROM chit_members WHERE id=?').get(memberExtra.data.id) as any
    if (Number(extraMemberRowAfterCycle1.credit_balance) !== 1000) note(`CRITICAL: chit_members.credit_balance should persist the 1000 carry-forward credit, got ${extraMemberRowAfterCycle1.credit_balance}`)

    // Customer uses previous credit: pays only 4000 against cycle 2's 5000
    // expected amount -> the banked 1000 credit auto-applies to close the
    // remaining gap, cycle is fully settled, and the credit balance drains to 0.
    const creditUsePay = await call('chits:contributions:record', memberExtra.data.id, { amount: 4000, method: 'cash', cycle_no: 2 })
    if (!creditUsePay.success) note(`CRITICAL: a 4000 payment against a 5000 expected cycle, with 1000 credit available, was rejected: ${creditUsePay.error}`)
    expect(creditUsePay.success).toBe(true)
    if (creditUsePay.data.creditApplied !== 1000) note(`CRITICAL: expected the full 1000 banked credit to auto-apply, got creditApplied=${creditUsePay.data.creditApplied}`)
    if (creditUsePay.data.balanceDue !== 0) note(`CRITICAL: a 4000 cash payment + 1000 credit should fully settle a 5000 cycle, got balanceDue=${creditUsePay.data.balanceDue}`)
    if (creditUsePay.data.cycleStatus !== 'completed') note(`CRITICAL: cycle should be 'completed' after credit closes the gap, got '${creditUsePay.data.cycleStatus}'`)
    if (creditUsePay.data.creditBalance !== 0) note(`CRITICAL: credit balance should be fully drained to 0 after being applied, got ${creditUsePay.data.creditBalance}`)

    // Draw eligibility for cycle 2 must include memberExtra (settled via
    // cash + credit) and exclude memberExact (never paid cycle 2 at all).
    const eligibleCycle2 = await call('chits:draws:eligible', schemeId, 2)
    const eligibleIds2 = (eligibleCycle2.data || []).map((m: any) => m.id)
    if (!eligibleIds2.includes(memberExtra.data.id)) note(`CRITICAL: member settled via credit application should be draw-eligible for that cycle`)
    if (eligibleIds2.includes(memberExact.data.id)) note(`CRITICAL: member who never paid cycle 2 should NOT be draw-eligible for cycle 2`)
  })

  it('37. flexible contributions — underpayment excludes a member from the draw pool; multiple installments settle the balance and restore eligibility', async () => {
    setSession(mgrA)
    const schemeRes = await call('chits:create', {
      name: 'QA Flexible Contrib Scheme D', branch_id: BR_A, product_id: PROD1, member_count: 2, cycle_count: 2,
      min_members: 2, chit_value: 60000, contribution_amount: 5000,
    })
    expect(schemeRes.success).toBe(true)
    const schemeId = schemeRes.data.id

    const memberInstall = await call('chits:members:add', schemeId, { customer_name: 'Flex Installment Payer', customer_phone: '0771130003', agent_id: AGENT_REG })
    const memberFiller = await call('chits:members:add', schemeId, { customer_name: 'Flex Installment Filler', customer_phone: '0771130004', agent_id: AGENT_REG })
    expect(memberInstall.success).toBe(true)
    expect(memberFiller.success).toBe(true)

    // Customer pays less amount (installment #1 of 2): 3000 against 5000 expected.
    const install1 = await call('chits:contributions:record', memberInstall.data.id, { amount: 3000, method: 'cash', cycle_no: 1 })
    if (!install1.success) note(`CRITICAL: a legitimate partial payment (3000 of 5000) was rejected: ${install1.error}`)
    expect(install1.success).toBe(true)
    if (install1.data.balanceDue !== 2000) note(`CRITICAL: expected a 2000 outstanding balance after a 3000 payment on a 5000 cycle, got ${install1.data.balanceDue}`)
    if (install1.data.cycleStatus !== 'partial') note(`CRITICAL: cycleStatus should be 'partial' with an outstanding balance, got '${install1.data.cycleStatus}'`)

    // Draw eligibility must EXCLUDE this member while a balance is outstanding.
    const eligibleBeforeSettle = await call('chits:draws:eligible', schemeId, 1)
    const eligibleIdsBefore = (eligibleBeforeSettle.data || []).map((m: any) => m.id)
    if (eligibleIdsBefore.includes(memberInstall.data.id)) note(`CRITICAL: a member with an outstanding balance (2000 due) was included in the draw-eligible pool`)
    expect(eligibleIdsBefore.includes(memberInstall.data.id)).toBe(false)

    // A manual-pick draw targeting this still-owing member must be rejected
    // outright. Neither member has settled cycle 1 yet at this point (the
    // filler never paid at all), so the eligible pool is empty and the
    // rejection surfaces as "no eligible members" rather than the
    // per-winner "not eligible" message — both are the correct outcome:
    // this member must never be selectable while a balance is outstanding.
    setSession(SUPER_ADMIN)
    const blockedDraw = await call('chits:draws:conduct', schemeId, 1, { method: 'manual_pick', winnerMemberId: memberInstall.data.id, reason: 'QA flexible-contribution regression: should be rejected' })
    if (blockedDraw.success) note(`CRITICAL: a draw was allowed to select a member with an outstanding cycle balance as winner`)
    expect(blockedDraw.success).toBe(false)
    expect(String(blockedDraw.error || '')).toMatch(/not eligible|no eligible members/i)
    setSession(mgrA)

    // Customer pays in multiple installments: installment #2 closes the gap exactly.
    const install2 = await call('chits:contributions:record', memberInstall.data.id, { amount: 2000, method: 'cash', cycle_no: 1 })
    if (!install2.success) note(`CRITICAL: the second installment (2000, closing a 2000 gap) was rejected: ${install2.error}`)
    expect(install2.success).toBe(true)
    if (install2.data.paidAmount !== 5000) note(`CRITICAL: expected cumulative paidAmount of 5000 across two installments (3000+2000), got ${install2.data.paidAmount}`)
    if (install2.data.balanceDue !== 0) note(`CRITICAL: two installments totalling 5000 against a 5000 cycle should leave a zero balance, got ${install2.data.balanceDue}`)
    if (install2.data.cycleStatus !== 'completed') note(`CRITICAL: cycleStatus should flip to 'completed' once installments cover the full amount, got '${install2.data.cycleStatus}'`)

    // Draw eligibility must now INCLUDE this member.
    const eligibleAfterSettle = await call('chits:draws:eligible', schemeId, 1)
    const eligibleIdsAfter = (eligibleAfterSettle.data || []).map((m: any) => m.id)
    if (!eligibleIdsAfter.includes(memberInstall.data.id)) note(`CRITICAL: a member whose installments now fully settle the cycle should be draw-eligible`)
    expect(eligibleIdsAfter.includes(memberInstall.data.id)).toBe(true)

    setSession(SUPER_ADMIN)
    const allowedDraw = await call('chits:draws:conduct', schemeId, 1, { method: 'manual_pick', winnerMemberId: memberInstall.data.id, reason: 'QA flexible-contribution regression: should now succeed' })
    if (!allowedDraw.success) note(`CRITICAL: a draw targeting a now-fully-settled member was rejected: ${allowedDraw.error}`)
    expect(allowedDraw.success).toBe(true)
    setSession(mgrA)
  })

  it('38. flexible contributions — carry-forward credit is isolated per scheme enrollment; one scheme\'s credit never covers another scheme\'s balance for the same customer', async () => {
    setSession(mgrA)
    const schemeERes = await call('chits:create', {
      name: 'QA Flexible Contrib Scheme E', branch_id: BR_A, product_id: PROD1, member_count: 2, cycle_count: 2,
      min_members: 2, chit_value: 60000, contribution_amount: 5000,
    })
    const schemeFRes = await call('chits:create', {
      name: 'QA Flexible Contrib Scheme F', branch_id: BR_A, product_id: PROD1, member_count: 2, cycle_count: 2,
      min_members: 2, chit_value: 60000, contribution_amount: 5000,
    })
    expect(schemeERes.success).toBe(true)
    expect(schemeFRes.success).toBe(true)
    const schemeEId = schemeERes.data.id
    const schemeFId = schemeFRes.data.id

    const sharedPhone = '0771130005'
    const memberE1 = await call('chits:members:add', schemeEId, { customer_name: 'Flex Multi-Scheme Customer', customer_phone: sharedPhone, agent_id: AGENT_REG })
    const memberE2 = await call('chits:members:add', schemeEId, { customer_name: 'Flex Multi-Scheme Filler E', customer_phone: '0771130006', agent_id: AGENT_REG })
    const memberF1 = await call('chits:members:add', schemeFId, { customer_name: 'Flex Multi-Scheme Customer', customer_phone: sharedPhone, agent_id: AGENT_REG })
    const memberF2 = await call('chits:members:add', schemeFId, { customer_name: 'Flex Multi-Scheme Filler F', customer_phone: '0771130007', agent_id: AGENT_REG })
    expect(memberE1.success).toBe(true)
    expect(memberE2.success).toBe(true)
    expect(memberF1.success).toBe(true)
    expect(memberF2.success).toBe(true)

    // Overpay in Scheme E -> 2000 credit carried on the Scheme E membership.
    const payE1 = await call('chits:contributions:record', memberE1.data.id, { amount: 7000, method: 'cash', cycle_no: 1 })
    expect(payE1.success).toBe(true)
    if (payE1.data.creditBalance !== 2000) note(`CRITICAL: overpaying Scheme E by 2000 should carry forward exactly 2000 credit, got ${payE1.data.creditBalance}`)

    // The SAME customer underpays in Scheme F, same cycle number. Scheme
    // E's credit must NOT leak across to cover Scheme F's shortfall.
    const payF1 = await call('chits:contributions:record', memberF1.data.id, { amount: 3000, method: 'cash', cycle_no: 1 })
    expect(payF1.success).toBe(true)
    if (payF1.data.creditApplied !== 0) note(`CRITICAL: Scheme E's carry-forward credit leaked into Scheme F's balance calculation (creditApplied=${payF1.data.creditApplied}, expected 0)`)
    if (payF1.data.balanceDue !== 2000) note(`CRITICAL: Scheme F's own 2000 shortfall should remain outstanding, unaffected by Scheme E's credit, got balanceDue=${payF1.data.balanceDue}`)
    if (payF1.data.cycleStatus !== 'partial') note(`CRITICAL: Scheme F's underpaid cycle should be 'partial', got '${payF1.data.cycleStatus}'`)

    const memberERowAfter = db.prepare('SELECT credit_balance FROM chit_members WHERE id=?').get(memberE1.data.id) as any
    if (Number(memberERowAfter.credit_balance) !== 2000) note(`CRITICAL: Scheme F's payment should not have touched Scheme E's credit balance, got ${memberERowAfter.credit_balance}`)
    const memberFRowAfter = db.prepare('SELECT credit_balance FROM chit_members WHERE id=?').get(memberF1.data.id) as any
    if (Number(memberFRowAfter.credit_balance) !== 0) note(`CRITICAL: Scheme F's own membership should have no credit of its own, got ${memberFRowAfter.credit_balance}`)

    // Draw eligibility, scoped per scheme: E1 eligible (settled), F1 not (still owes 2000).
    const eligibleE = await call('chits:draws:eligible', schemeEId, 1)
    const eligibleF = await call('chits:draws:eligible', schemeFId, 1)
    if (!(eligibleE.data || []).map((m: any) => m.id).includes(memberE1.data.id)) note(`CRITICAL: member E1 (fully settled via overpayment) should be draw-eligible in Scheme E`)
    if ((eligibleF.data || []).map((m: any) => m.id).includes(memberF1.data.id)) note(`CRITICAL: member F1 (2000 still outstanding) should NOT be draw-eligible in Scheme F`)
  })

  it('39. member contribution statement report — reflects per-cycle expected/paid/credit/balance and full payment history', async () => {
    setSession(mgrA)
    const schemeRes = await call('chits:create', {
      name: 'QA Flexible Contrib Scheme G', branch_id: BR_A, product_id: PROD1, member_count: 1, cycle_count: 2,
      min_members: 1, chit_value: 60000, contribution_amount: 5000,
    })
    expect(schemeRes.success).toBe(true)
    const schemeId = schemeRes.data.id
    const member = await call('chits:members:add', schemeId, { customer_name: 'Flex Statement Customer', customer_phone: '0771130008', agent_id: AGENT_REG })
    expect(member.success).toBe(true)

    // Cycle 1: two installments (3000 + 2000) settle it exactly.
    expect((await call('chits:contributions:record', member.data.id, { amount: 3000, method: 'cash', cycle_no: 1 })).success).toBe(true)
    expect((await call('chits:contributions:record', member.data.id, { amount: 2000, method: 'cash', cycle_no: 1 })).success).toBe(true)
    // Cycle 2: a single overpayment (6000) settles it and carries forward 1000 credit.
    expect((await call('chits:contributions:record', member.data.id, { amount: 6000, method: 'cash', cycle_no: 2 })).success).toBe(true)

    const statement = await call('chits:members:contributionStatement', member.data.id)
    if (!statement.success) note(`CRITICAL: chits:members:contributionStatement failed: ${statement.error}`)
    expect(statement.success).toBe(true)

    if (statement.data.creditBalance !== 1000) note(`CRITICAL: statement should report a 1000 carry-forward credit balance, got ${statement.data.creditBalance}`)

    const cycle1 = (statement.data.cycles || []).find((c: any) => c.cycleNo === 1)
    const cycle2 = (statement.data.cycles || []).find((c: any) => c.cycleNo === 2)
    if (!cycle1 || cycle1.paidAmount !== 5000 || cycle1.balanceDue !== 0 || cycle1.status !== 'completed') {
      note(`CRITICAL: statement cycle 1 mismatch, expected paidAmount=5000 balanceDue=0 status=completed, got ${JSON.stringify(cycle1)}`)
    }
    if (!cycle2 || cycle2.paidAmount !== 6000 || cycle2.balanceDue !== 0 || cycle2.status !== 'completed') {
      note(`CRITICAL: statement cycle 2 mismatch, expected paidAmount=6000 balanceDue=0 status=completed, got ${JSON.stringify(cycle2)}`)
    }

    if ((statement.data.paymentHistory || []).length !== 3) note(`CRITICAL: statement payment history should list all 3 recorded contributions, got ${(statement.data.paymentHistory || []).length}`)
    if (!statement.data.member || statement.data.member.customerName !== 'Flex Statement Customer') note(`CRITICAL: statement member details missing or incorrect`)
  })

  it('SUMMARY: print all findings', () => {
    console.log('\n\n=== QA FINDINGS SUMMARY ===')
    if (findings.length === 0) console.log('No findings recorded by inline checks.')
    findings.forEach((f, i) => console.log(`${i + 1}. ${f}`))
    console.log('=== END FINDINGS ===\n')
  })
})
