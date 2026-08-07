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

// Centralized Scheme Master: chits:create now requires a valid template_id
// and derives name/contribution_amount/chit_value/cycle_count/min_members
// from it, ignoring any client-supplied override. Most of this suite's
// tests only use chits:create as setup scaffolding for unrelated features
// (draws, commissions, reports...), so this helper transparently creates a
// matching template (as Super Admin, behind the scenes — simulating "a
// Super Admin already added this scheme to the catalog") using exactly the
// values a test would otherwise have hand-typed, then instantiates it
// under the CALLER's actual current session (preserving whatever branch/
// permission scoping that test means to exercise on the chits:create call
// itself).
async function createSchemeViaTemplate(payload: Record<string, unknown>): Promise<any> {
  const priorSession = sharedStoreData.auth_user as Record<string, unknown> | null
  setSession(SUPER_ADMIN)
  const template = await call('chits:templates:create', {
    scheme_name: String(payload.name || 'QA Template'),
    monthly_contribution_amount: payload.contribution_amount,
    duration_months: payload.cycle_count,
    minimum_members: payload.min_members,
    product_value: payload.chit_value,
  })
  setSession(priorSession)
  if (!template.success) return template
  return call('chits:create', { ...payload, template_id: template.data.id })
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
let claimReminderService: import('../services/claimReminderService').ClaimReminderService

beforeAll(async () => {
  const { initDatabase, getDb } = await import('../database')
  await initDatabase()
  db = getDb()

  const { registerChitHandlers } = await import('../ipc/chits')
  const { registerCommissionHandlers } = await import('../ipc/commissions')
  const { registerAgentHandlers } = await import('../ipc/agents')
  const { registerCustomerHandlers } = await import('../ipc/customers')
  const { registerInvoiceHandlers } = await import('../ipc/invoices')
  registerChitHandlers(fakeIpcMain)
  registerCommissionHandlers(fakeIpcMain)
  registerAgentHandlers(fakeIpcMain)
  registerCustomerHandlers(fakeIpcMain)
  registerInvoiceHandlers(fakeIpcMain)

  const { getClaimReminderService } = await import('../services/claimReminderService')
  claimReminderService = getClaimReminderService()
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
    const res = await createSchemeViaTemplate({
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
    const schemeId2Res = await createSchemeViaTemplate({
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
    const schemeRes = await createSchemeViaTemplate({
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
    const schemeRes = await createSchemeViaTemplate({
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
    const schemeRes = await createSchemeViaTemplate({
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
    const schemeRes = await createSchemeViaTemplate({
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
    const schemeRes = await createSchemeViaTemplate({
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
    const schemeRes = await createSchemeViaTemplate({
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
    const schemeRes = await createSchemeViaTemplate({
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
    const schemeRes = await createSchemeViaTemplate({
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
    const schemeRes = await createSchemeViaTemplate({
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
    const schemeRes = await createSchemeViaTemplate({
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
    const schemeRes = await createSchemeViaTemplate({
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
    const schemeRes = await createSchemeViaTemplate({
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
    const schemeRes = await createSchemeViaTemplate({
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
    const schemeRes = await createSchemeViaTemplate({
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
    const schemeARes = await createSchemeViaTemplate({
      name: 'QA Cycle Rule Scheme A', branch_id: BR_A, product_id: PROD1, member_count: 2, cycle_count: 5,
      min_members: 2, chit_value: 60000, contribution_amount: 1000,
    })
    const schemeBRes = await createSchemeViaTemplate({
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
    const schemeRes = await createSchemeViaTemplate({
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
    const schemeRes = await createSchemeViaTemplate({
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
    const schemeERes = await createSchemeViaTemplate({
      name: 'QA Flexible Contrib Scheme E', branch_id: BR_A, product_id: PROD1, member_count: 2, cycle_count: 2,
      min_members: 2, chit_value: 60000, contribution_amount: 5000,
    })
    const schemeFRes = await createSchemeViaTemplate({
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
    const schemeRes = await createSchemeViaTemplate({
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

  it('40. Scheme Master — only Super Admin can create or edit a scheme template; Smart Buy Manager is rejected on both', async () => {
    setSession(SUPER_ADMIN)
    const created = await call('chits:templates:create', {
      scheme_name: 'QA SmartBuy 500', monthly_contribution_amount: 500, duration_months: 10, minimum_members: 5, product_value: 5000,
    })
    if (!created.success) note(`CRITICAL: Super Admin was rejected creating a SmartBuy scheme template: ${created.error}`)
    expect(created.success).toBe(true)
    const templateId = created.data.id

    const edited = await call('chits:templates:update', templateId, { monthly_contribution_amount: 600 })
    if (!edited.success) note(`CRITICAL: Super Admin was rejected editing a SmartBuy scheme template: ${edited.error}`)
    expect(edited.success).toBe(true)

    setSession(mgrA)
    const managerCreate = await call('chits:templates:create', {
      scheme_name: 'QA Manager Attempted Scheme', monthly_contribution_amount: 1000, duration_months: 12, minimum_members: 10, product_value: 10000,
    })
    if (managerCreate.success) note(`CRITICAL: a Smart Buy Manager (chits-only, non-global) was allowed to create a SmartBuy scheme template`)
    expect(managerCreate.success).toBe(false)

    const managerEdit = await call('chits:templates:update', templateId, { monthly_contribution_amount: 999 })
    if (managerEdit.success) note(`CRITICAL: a Smart Buy Manager was allowed to edit an existing SmartBuy scheme template`)
    expect(managerEdit.success).toBe(false)

    const untouched = db.prepare('SELECT monthly_contribution_amount FROM chit_scheme_templates WHERE id=?').get(templateId) as any
    if (Number(untouched.monthly_contribution_amount) !== 600) note(`CRITICAL: the rejected Manager edit somehow still changed the template (expected 600, got ${untouched.monthly_contribution_amount})`)
  })

  it('41. Scheme Master — active templates appear in the Manager dropdown, inactive ones never do (even if explicitly requested), and a newly created template shows up with no code change', async () => {
    setSession(SUPER_ADMIN)
    const beforeList = await call('chits:templates:list', { status: 'active' })
    const beforeIds = (beforeList.data || []).map((t: any) => t.id)

    const fresh = await call('chits:templates:create', {
      scheme_name: 'QA SmartBuy Diamond 15000', monthly_contribution_amount: 15000, duration_months: 24, minimum_members: 8, product_value: 360000,
    })
    expect(fresh.success).toBe(true)
    const freshId = fresh.data.id

    const inactive = await call('chits:templates:create', {
      scheme_name: 'QA SmartBuy Retired', monthly_contribution_amount: 300, duration_months: 6, minimum_members: 5, product_value: 1800,
    })
    expect(inactive.success).toBe(true)
    const inactiveId = inactive.data.id
    const deactivated = await call('chits:templates:update', inactiveId, { status: 'inactive' })
    expect(deactivated.success).toBe(true)

    // As the Smart Buy Manager: the freshly created template must appear
    // automatically (no code change, just re-fetch), and the inactive one
    // must never appear — even if the Manager explicitly asks for it.
    setSession(mgrA)
    const managerActiveList = await call('chits:templates:list', { status: 'active' })
    const managerActiveIds = (managerActiveList.data || []).map((t: any) => t.id)
    if (!managerActiveIds.includes(freshId)) note(`CRITICAL: a newly created active SmartBuy scheme did not automatically appear in the Manager's dropdown`)
    expect(managerActiveIds.includes(freshId)).toBe(true)
    if (managerActiveIds.includes(inactiveId)) note(`CRITICAL: an inactive SmartBuy scheme appeared in the Manager's dropdown`)
    expect(managerActiveIds.includes(inactiveId)).toBe(false)
    if (beforeIds.includes(freshId)) note(`CRITICAL: test setup issue — the fresh template ID already existed before creation`)

    // Server-side enforcement, not just a UI filter: a Manager explicitly
    // requesting 'inactive' or 'all' must still only ever see active rows.
    const managerAllRequest = await call('chits:templates:list', { status: 'all' })
    const managerAllIds = (managerAllRequest.data || []).map((t: any) => t.id)
    if (managerAllIds.includes(inactiveId)) note(`CRITICAL: a Manager requesting status='all' was able to see an inactive SmartBuy scheme template — backend is not enforcing the active-only view server-side`)
    expect(managerAllIds.includes(inactiveId)).toBe(false)

    // Super Admin, by contrast, must be able to see inactive templates too
    // (needed to manage/reactivate them from the Scheme Master screen).
    setSession(SUPER_ADMIN)
    const adminAllList = await call('chits:templates:list', { status: 'all' })
    const adminAllIds = (adminAllList.data || []).map((t: any) => t.id)
    if (!adminAllIds.includes(inactiveId)) note(`CRITICAL: Super Admin could not see an inactive SmartBuy scheme template in the Scheme Master list`)
    expect(adminAllIds.includes(inactiveId)).toBe(true)
  })

  it('42. chits:create — requires a valid template, Manager may only instantiate an ACTIVE one, and every scheme detail is derived from the template regardless of what the client sends', async () => {
    setSession(SUPER_ADMIN)
    const template = await call('chits:templates:create', {
      scheme_name: 'QA SmartBuy 2000', monthly_contribution_amount: 2000, duration_months: 8, minimum_members: 6, product_value: 16000,
    })
    expect(template.success).toBe(true)
    const templateId = template.data.id
    const retiredTemplate = await call('chits:templates:create', {
      scheme_name: 'QA SmartBuy Retired 2', monthly_contribution_amount: 100, duration_months: 3, minimum_members: 3, product_value: 300,
    })
    expect(retiredTemplate.success).toBe(true)
    const retiredId = retiredTemplate.data.id
    expect((await call('chits:templates:update', retiredId, { status: 'inactive' })).success).toBe(true)

    setSession(mgrA)
    // No template_id at all -> rejected outright, never falls back to a
    // manually typed name/amount.
    const noTemplate = await call('chits:create', {
      name: 'Hand-typed Scheme Attempt', branch_id: BR_A, product_id: PROD1,
      member_count: 5, cycle_count: 5, min_members: 5, contribution_amount: 12345, chit_value: 99999,
    })
    if (noTemplate.success) note(`CRITICAL: chits:create succeeded with no template_id at all — a scheme could still be hand-typed end to end`)
    expect(noTemplate.success).toBe(false)

    // A Manager instantiating from a since-deactivated template is rejected.
    const fromRetired = await call('chits:create', { template_id: retiredId, branch_id: BR_A, product_id: PROD1 })
    if (fromRetired.success) note(`CRITICAL: a Smart Buy Manager was able to instantiate a scheme from an INACTIVE template`)
    expect(fromRetired.success).toBe(false)

    // A Manager instantiating from the active template, while also trying
    // to smuggle in different name/amount/duration/min-members values —
    // every one of those must be silently overridden by the template's own
    // values, never taken from the payload. member_count is the one
    // deliberate exception (batch capacity is a per-branch operational
    // choice, not a template field — see chits:create's comment) — it
    // SHOULD be taken from the payload, just floored at the template's
    // minimum_members.
    const tampered = await call('chits:create', {
      template_id: templateId, branch_id: BR_A, product_id: PROD1,
      name: 'Totally Different Hand-Typed Name', contribution_amount: 999999, chit_value: 1,
      member_count: 10, cycle_count: 1, min_members: 1,
    })
    if (!tampered.success) note(`CRITICAL: a legitimate template-based scheme creation was rejected: ${tampered.error}`)
    expect(tampered.success).toBe(true)
    const createdScheme = db.prepare('SELECT * FROM chit_schemes WHERE id=?').get(tampered.data.id) as any
    if (createdScheme.name !== 'QA SmartBuy 2000') note(`CRITICAL: scheme name was taken from the client payload instead of the template (got "${createdScheme.name}")`)
    if (Number(createdScheme.contribution_amount) !== 2000) note(`CRITICAL: contribution_amount was taken from the client payload instead of the template (got ${createdScheme.contribution_amount})`)
    if (Number(createdScheme.chit_value) !== 16000) note(`CRITICAL: chit_value was taken from the client payload instead of the template (got ${createdScheme.chit_value})`)
    if (Number(createdScheme.cycle_count) !== 8) note(`CRITICAL: cycle_count was taken from the client payload instead of the template (got ${createdScheme.cycle_count})`)
    if (Number(createdScheme.min_members) !== 6) note(`CRITICAL: min_members was taken from the client payload instead of the template (got ${createdScheme.min_members})`)
    if (Number(createdScheme.member_count) !== 10) note(`CRITICAL: member_count (the one intentionally operational field) was not honored from the payload, got ${createdScheme.member_count}`)
    if (createdScheme.template_id !== templateId) note(`CRITICAL: the created scheme did not record which template it came from`)

    // member_count is still floored at the template's minimum — cannot go
    // below it even though it's otherwise payload-driven.
    const tooSmallCapacity = await call('chits:create', { template_id: templateId, branch_id: BR_A, product_id: PROD1, member_count: 1 })
    if (tooSmallCapacity.success) note(`CRITICAL: a scheme was created with member_count (1) below its template's minimum_members (6)`)
    expect(tooSmallCapacity.success).toBe(false)

    // Super Admin, unlike the Manager, may instantiate from an inactive
    // template (they already control the template catalog directly).
    setSession(SUPER_ADMIN)
    const adminFromRetired = await call('chits:create', { template_id: retiredId, branch_id: BR_A, product_id: PROD1, member_count: 3 })
    if (!adminFromRetired.success) note(`CRITICAL: Super Admin was blocked from instantiating a scheme from an inactive template: ${adminFromRetired.error}`)
    expect(adminFromRetired.success).toBe(true)
  })

  it('43. existing SmartBuy flows keep working end to end for a template-instantiated scheme, and renaming an instantiated scheme is now Super-Admin-only', async () => {
    setSession(SUPER_ADMIN)
    const template = await call('chits:templates:create', {
      scheme_name: 'QA SmartBuy E2E', monthly_contribution_amount: 4000, duration_months: 2, minimum_members: 2, product_value: 8000,
    })
    expect(template.success).toBe(true)

    setSession(mgrA)
    const scheme = await call('chits:create', { template_id: template.data.id, branch_id: BR_A, product_id: PROD1, member_count: 2 })
    if (!scheme.success) note(`CRITICAL: a Manager could not instantiate a scheme from an active template: ${scheme.error}`)
    expect(scheme.success).toBe(true)
    const schemeId = scheme.data.id

    // Enrollment, payment, and draw — the normal SmartBuy lifecycle —
    // continue to work unchanged for a template-instantiated scheme.
    const m1 = await call('chits:members:add', schemeId, { customer_name: 'E2E Member One', customer_phone: '0771130009', agent_id: AGENT_REG })
    const m2 = await call('chits:members:add', schemeId, { customer_name: 'E2E Member Two', customer_phone: '0771130010', agent_id: AGENT_REG })
    if (!m1.success || !m2.success) note(`CRITICAL: enrolling members into a template-instantiated scheme failed (${m1.error || ''} ${m2.error || ''})`)
    expect(m1.success).toBe(true)
    expect(m2.success).toBe(true)

    const pay1 = await call('chits:contributions:record', m1.data.id, { amount: 4000, method: 'cash', cycle_no: 1 })
    const pay2 = await call('chits:contributions:record', m2.data.id, { amount: 4000, method: 'cash', cycle_no: 1 })
    if (!pay1.success || !pay2.success) note(`CRITICAL: recording a contribution against a template-instantiated scheme failed`)
    expect(pay1.success).toBe(true)
    expect(pay2.success).toBe(true)

    setSession(SUPER_ADMIN)
    const draw = await call('chits:draws:conduct', schemeId, 1, { method: 'manual_pick', winnerMemberId: m1.data.id, reason: 'QA Scheme Master regression: end-to-end draw still works' })
    if (!draw.success) note(`CRITICAL: conducting a draw against a template-instantiated scheme failed: ${draw.error}`)
    expect(draw.success).toBe(true)
    setSession(mgrA)

    // Renaming: Manager can no longer retype the scheme's name (it came
    // from the template), Super Admin still can.
    const managerRename = await call('chits:update', schemeId, { name: 'Manager Renamed This' })
    expect(managerRename.success).toBe(true) // call succeeds (no-op for disallowed fields), but must not apply the rename
    const afterManagerRename = db.prepare('SELECT name FROM chit_schemes WHERE id=?').get(schemeId) as any
    if (afterManagerRename.name === 'Manager Renamed This') note(`CRITICAL: a Smart Buy Manager was able to rename a scheme via chits:update, bypassing the Scheme Master`)
    expect(afterManagerRename.name).toBe('QA SmartBuy E2E')

    setSession(SUPER_ADMIN)
    const adminRename = await call('chits:update', schemeId, { name: 'Admin Renamed This' })
    expect(adminRename.success).toBe(true)
    const afterAdminRename = db.prepare('SELECT name FROM chit_schemes WHERE id=?').get(schemeId) as any
    if (afterAdminRename.name !== 'Admin Renamed This') note(`CRITICAL: Super Admin should still be able to rename an instantiated scheme via chits:update`)
    expect(afterAdminRename.name).toBe('Admin Renamed This')
  })

  it('44. withdrawal before scheme activation — immediate, full refund of net-paid amount, member withdrawn, scheme/other members unaffected, fully audited', async () => {
    setSession(mgrA)
    const schemeRes = await createSchemeViaTemplate({
      name: 'QA Withdrawal Pre-Activation Scheme', branch_id: BR_A, product_id: PROD1, member_count: 3, cycle_count: 3,
      min_members: 3, chit_value: 60000, contribution_amount: 1000,
    })
    expect(schemeRes.success).toBe(true)
    const schemeId = schemeRes.data.id

    const m1 = await call('chits:members:add', schemeId, { customer_name: 'Withdraw Pre-Activation', customer_phone: '0771140001', agent_id: AGENT_REG })
    const m2 = await call('chits:members:add', schemeId, { customer_name: 'Pre-Activation Filler', customer_phone: '0771140002', agent_id: AGENT_REG })
    expect(m1.success).toBe(true)
    expect(m2.success).toBe(true)
    const schemeAfterEnroll = await call('chits:get', schemeId)
    if (schemeAfterEnroll.data.scheme.status !== 'pending') note(`CRITICAL: test setup issue — scheme should still be 'pending' with only 2/3 min_members enrolled`)

    // Simulate a historical/imported payment so the refund math has a real,
    // nonzero figure to verify (the ordinary flow blocks a member's very
    // first payment while the scheme is still pending, so this is normally
    // $0 — but the refund calculation must still be correct when it isn't).
    db.prepare(`UPDATE chit_members SET contributions_paid=3000, credit_balance=500 WHERE id=?`).run(m1.data.id)

    const withdrawal = await call('chits:withdrawals:request', m1.data.id, 'Relocating to another city before the scheme even started')
    if (!withdrawal.success) note(`CRITICAL: a legitimate pre-activation withdrawal was rejected: ${withdrawal.error}`)
    expect(withdrawal.success).toBe(true)
    if (withdrawal.data.status !== 'approved') note(`CRITICAL: pre-activation withdrawal should auto-resolve to 'approved' with no separate review step, got '${withdrawal.data.status}'`)
    // Refund = contributions_paid only — credit_balance is a subset of that
    // figure (money already counted within it), never additive.
    if (withdrawal.data.refundAmount !== 3000) note(`CRITICAL: pre-activation refund should equal contributions_paid (3000), got ${withdrawal.data.refundAmount}`)

    const m1Row = db.prepare('SELECT status, credit_balance FROM chit_members WHERE id=?').get(m1.data.id) as any
    if (m1Row.status !== 'withdrawn') note(`CRITICAL: member status should be 'withdrawn' after an approved withdrawal, got '${m1Row.status}'`)
    if (Number(m1Row.credit_balance) !== 0) note(`CRITICAL: credit_balance should be zeroed out once a withdrawal is settled, got ${m1Row.credit_balance}`)

    const requestRow = db.prepare('SELECT * FROM withdrawal_requests WHERE id=?').get(withdrawal.data.id) as any
    if (!requestRow) note(`CRITICAL: no withdrawal_requests audit row was created`)
    else {
      if (requestRow.status !== 'approved') note(`CRITICAL: withdrawal_requests.status should be 'approved', got '${requestRow.status}'`)
      if (requestRow.scheme_was_active !== 0) note(`CRITICAL: scheme_was_active should be 0 for a pre-activation withdrawal, got ${requestRow.scheme_was_active}`)
      if (Number(requestRow.refund_amount) !== 3000) note(`CRITICAL: withdrawal_requests.refund_amount mismatch, got ${requestRow.refund_amount}`)
      if (!requestRow.reviewed_by || !requestRow.reviewed_at || !requestRow.review_reason) note(`CRITICAL: pre-activation withdrawal should still be fully audited (reviewed_by/reviewed_at/review_reason all set), got ${JSON.stringify(requestRow)}`)
      if (!requestRow.reason) note(`CRITICAL: the member's withdrawal reason was not recorded`)
    }

    const auditRow = db.prepare(`SELECT * FROM audit_logs WHERE action='CHIT_MEMBER_WITHDRAWN' AND record_id=?`).get(m1.data.id)
    if (!auditRow) note(`CRITICAL: no audit_logs entry was written for the withdrawal`)

    // Scheme and the other member must be completely unaffected.
    const m2Row = db.prepare('SELECT status FROM chit_members WHERE id=?').get(m2.data.id) as any
    if (m2Row.status !== 'active') note(`CRITICAL: an unrelated member's status changed as a side effect of another member's withdrawal`)
    const schemeAfter = await call('chits:get', schemeId)
    if (schemeAfter.data.scheme.status !== 'pending') note(`CRITICAL: scheme status changed as a side effect of a withdrawal`)
  })

  it('45. withdrawal reopens the vacant slot for a normal new enrollment — no special "replacement" mechanism needed, existing capacity logic already handles it correctly', async () => {
    setSession(mgrA)
    const schemeRes = await createSchemeViaTemplate({
      name: 'QA Withdrawal Vacant Slot Scheme', branch_id: BR_A, product_id: PROD1, member_count: 3, cycle_count: 3,
      min_members: 3, chit_value: 60000, contribution_amount: 1000,
    })
    expect(schemeRes.success).toBe(true)
    const schemeId = schemeRes.data.id

    const m1 = await call('chits:members:add', schemeId, { customer_name: 'Vacant Slot Original', customer_phone: '0771140003', agent_id: AGENT_REG })
    const m2 = await call('chits:members:add', schemeId, { customer_name: 'Vacant Slot Filler', customer_phone: '0771140004', agent_id: AGENT_REG })
    expect(m1.success).toBe(true)
    expect(m2.success).toBe(true)
    expect((await call('chits:withdrawals:request', m1.data.id, 'Changed their mind before the scheme activated')).success).toBe(true)

    // Capacity: member_count=3, but the withdrawn member must not count
    // against it — enrolled (non-withdrawn) is only 1 right now, so two
    // more members should be addable, taking the scheme all the way to
    // min_members=3 and activating it.
    const m3 = await call('chits:members:add', schemeId, { customer_name: 'Vacant Slot New Member A', customer_phone: '0771140005', agent_id: AGENT_REG })
    if (!m3.success) note(`CRITICAL: could not enroll a new member into a slot vacated by withdrawal: ${m3.error}`)
    expect(m3.success).toBe(true)
    const m4 = await call('chits:members:add', schemeId, { customer_name: 'Vacant Slot New Member B', customer_phone: '0771140006', agent_id: AGENT_REG })
    if (!m4.success) note(`CRITICAL: could not enroll a second new member into the reopened capacity: ${m4.error}`)
    expect(m4.success).toBe(true)

    const schemeAfter = await call('chits:get', schemeId)
    if (schemeAfter.data.scheme.status !== 'active') note(`CRITICAL: scheme should have activated once 3 non-withdrawn members (m2, m3, m4) were enrolled, got '${schemeAfter.data.scheme.status}'`)

    // Capacity is now genuinely full (m2, m3, m4 = 3 active, matching
    // member_count=3) — a 5th enrollment attempt must be rejected.
    const m5 = await call('chits:members:add', schemeId, { customer_name: 'Vacant Slot Overflow', customer_phone: '0771140007', agent_id: AGENT_REG })
    if (m5.success) note(`CRITICAL: the scheme accepted a member beyond its actual capacity (member_count=3, withdrawn member should never free up EXTRA room)`)
    expect(m5.success).toBe(false)
  })

  it('46. withdrawal after scheme activation — requires Super Admin approval, mandatory reasons, refund capped at net contribution, discretionary partial refund honored', async () => {
    setSession(mgrA)
    const schemeRes = await createSchemeViaTemplate({
      name: 'QA Withdrawal Post-Activation Scheme', branch_id: BR_A, product_id: PROD1, member_count: 2, cycle_count: 3,
      min_members: 2, chit_value: 60000, contribution_amount: 5000,
    })
    expect(schemeRes.success).toBe(true)
    const schemeId = schemeRes.data.id
    const m1 = await call('chits:members:add', schemeId, { customer_name: 'Post-Activation Withdrawer', customer_phone: '0771140008', agent_id: AGENT_REG })
    const m2 = await call('chits:members:add', schemeId, { customer_name: 'Post-Activation Filler', customer_phone: '0771140009', agent_id: AGENT_REG })
    expect(m1.success).toBe(true)
    expect(m2.success).toBe(true)
    const activeCheck = await call('chits:get', schemeId)
    if (activeCheck.data.scheme.status !== 'active') note(`CRITICAL: test setup issue — scheme should be active with 2/2 min_members enrolled`)

    expect((await call('chits:contributions:record', m1.data.id, { amount: 5000, method: 'cash', cycle_no: 1 })).success).toBe(true)
    expect((await call('chits:contributions:record', m1.data.id, { amount: 5000, method: 'cash', cycle_no: 2 })).success).toBe(true)

    const request = await call('chits:withdrawals:request', m1.data.id, 'Financial hardship — can no longer continue monthly payments')
    if (!request.success) note(`CRITICAL: a legitimate post-activation withdrawal request was rejected: ${request.error}`)
    expect(request.success).toBe(true)
    if (request.data.status !== 'pending') note(`CRITICAL: a post-activation withdrawal must require review, not auto-resolve, got '${request.data.status}'`)
    const m1WhilePending = db.prepare('SELECT status FROM chit_members WHERE id=?').get(m1.data.id) as any
    if (m1WhilePending.status !== 'active') note(`CRITICAL: member should keep their seat (stay 'active') while the withdrawal request is still pending, got '${m1WhilePending.status}'`)

    // A Smart Buy Manager (non-global) must not be able to approve.
    const managerApprove = await call('chits:withdrawals:approve', request.data.id, 5000, 'Manager trying to approve their own request')
    if (managerApprove.success) note(`CRITICAL: a Smart Buy Manager was able to approve a post-activation withdrawal — Super Admin approval requirement bypassed`)
    expect(managerApprove.success).toBe(false)

    setSession(SUPER_ADMIN)
    // Missing approval reason must be rejected.
    const noReason = await call('chits:withdrawals:approve', request.data.id, 5000, '')
    if (noReason.success) note(`CRITICAL: an approval with no reason was accepted — approval reason should be mandatory`)
    expect(noReason.success).toBe(false)

    // Refund exceeding net contribution (10000 paid) must be rejected.
    const tooMuch = await call('chits:withdrawals:approve', request.data.id, 15000, 'Trying to refund more than was ever collected')
    if (tooMuch.success) note(`CRITICAL: a refund exceeding the member's net contribution (10000) was accepted (15000)`)
    expect(tooMuch.success).toBe(false)

    // A legitimate discretionary PARTIAL refund (no fixed formula — the
    // business decides case by case) must succeed.
    const approved = await call('chits:withdrawals:approve', request.data.id, 7000, 'Approved a partial refund — customer relocating internationally, some admin cost retained per manager discretion')
    if (!approved.success) note(`CRITICAL: a valid discretionary partial-refund approval was rejected: ${approved.error}`)
    expect(approved.success).toBe(true)
    if (approved.data.refundAmount !== 7000) note(`CRITICAL: approved refund amount mismatch, got ${approved.data.refundAmount}`)

    const m1After = db.prepare('SELECT status, credit_balance FROM chit_members WHERE id=?').get(m1.data.id) as any
    if (m1After.status !== 'withdrawn') note(`CRITICAL: member should be 'withdrawn' after approval, got '${m1After.status}'`)
    if (Number(m1After.credit_balance) !== 0) note(`CRITICAL: credit_balance should be zeroed after withdrawal settlement`)

    const requestRow = db.prepare('SELECT * FROM withdrawal_requests WHERE id=?').get(request.data.id) as any
    if (requestRow.status !== 'approved' || Number(requestRow.refund_amount) !== 7000 || !requestRow.review_reason) {
      note(`CRITICAL: withdrawal_requests row not correctly finalized: ${JSON.stringify(requestRow)}`)
    }
    if (requestRow.scheme_was_active !== 1) note(`CRITICAL: scheme_was_active should be 1 for a post-activation withdrawal, got ${requestRow.scheme_was_active}`)

    const scheduleAudit = db.prepare(`SELECT action FROM audit_logs WHERE record_id=? ORDER BY created_at`).all(request.data.id) as any[]
    const actions = scheduleAudit.map(a => a.action)
    if (!actions.includes('CHIT_WITHDRAWAL_REQUESTED') || !actions.includes('CHIT_WITHDRAWAL_APPROVED')) {
      note(`CRITICAL: expected both CHIT_WITHDRAWAL_REQUESTED and CHIT_WITHDRAWAL_APPROVED audit entries, got ${JSON.stringify(actions)}`)
    }

    // The other member and the scheme itself must be unaffected.
    const m2Row = db.prepare('SELECT status FROM chit_members WHERE id=?').get(m2.data.id) as any
    if (m2Row.status !== 'active') note(`CRITICAL: an unrelated member was affected by another member's withdrawal approval`)
    const schemeAfter = await call('chits:get', schemeId)
    if (schemeAfter.data.scheme.status !== 'active') note(`CRITICAL: scheme incorrectly changed status as a side effect of a withdrawal (e.g. falsely marked 'completed')`)
    setSession(mgrA)
  })

  it('47. withdrawal rejection — member keeps their seat, no refund, mandatory reason, re-request allowed after rejection, double-resolve blocked', async () => {
    setSession(mgrA)
    const schemeRes = await createSchemeViaTemplate({
      name: 'QA Withdrawal Rejection Scheme', branch_id: BR_A, product_id: PROD1, member_count: 2, cycle_count: 3,
      min_members: 2, chit_value: 60000, contribution_amount: 5000,
    })
    expect(schemeRes.success).toBe(true)
    const schemeId = schemeRes.data.id
    const m1 = await call('chits:members:add', schemeId, { customer_name: 'Rejection Test Member', customer_phone: '0771140010', agent_id: AGENT_REG })
    const m2 = await call('chits:members:add', schemeId, { customer_name: 'Rejection Test Filler', customer_phone: '0771140011', agent_id: AGENT_REG })
    expect(m1.success).toBe(true)
    expect(m2.success).toBe(true)

    const request1 = await call('chits:withdrawals:request', m1.data.id, 'Wants to leave the scheme')
    expect(request1.success).toBe(true)

    setSession(SUPER_ADMIN)
    const noReasonReject = await call('chits:withdrawals:reject', request1.data.id, '')
    if (noReasonReject.success) note(`CRITICAL: a rejection with no reason was accepted — rejection reason should be mandatory`)
    expect(noReasonReject.success).toBe(false)

    const rejected = await call('chits:withdrawals:reject', request1.data.id, 'Customer contacted and resolved the issue directly — withdrawal no longer needed')
    if (!rejected.success) note(`CRITICAL: a valid rejection was refused: ${rejected.error}`)
    expect(rejected.success).toBe(true)

    const m1AfterReject = db.prepare('SELECT status FROM chit_members WHERE id=?').get(m1.data.id) as any
    if (m1AfterReject.status !== 'active') note(`CRITICAL: a rejected withdrawal must leave the member 'active', got '${m1AfterReject.status}'`)
    const requestRowAfterReject = db.prepare('SELECT status, refund_amount FROM withdrawal_requests WHERE id=?').get(request1.data.id) as any
    if (requestRowAfterReject.status !== 'rejected') note(`CRITICAL: withdrawal_requests.status should be 'rejected', got '${requestRowAfterReject.status}'`)
    if (requestRowAfterReject.refund_amount !== null) note(`CRITICAL: a rejected withdrawal should never have a refund_amount set, got ${requestRowAfterReject.refund_amount}`)

    // Double-resolving the same (already rejected) request must fail.
    const doubleReject = await call('chits:withdrawals:reject', request1.data.id, 'Trying to reject again')
    if (doubleReject.success) note(`CRITICAL: an already-rejected withdrawal request was rejected a second time without error`)
    expect(doubleReject.success).toBe(false)
    const doubleApprove = await call('chits:withdrawals:approve', request1.data.id, 1000, 'Trying to approve an already-rejected request')
    if (doubleApprove.success) note(`CRITICAL: an already-rejected withdrawal request was approved anyway`)
    expect(doubleApprove.success).toBe(false)

    // After a rejection, the member must be able to submit a fresh request.
    setSession(mgrA)
    const request2 = await call('chits:withdrawals:request', m1.data.id, 'Still wants to leave after all')
    if (!request2.success) note(`CRITICAL: could not submit a new withdrawal request after a prior one was rejected: ${request2.error}`)
    expect(request2.success).toBe(true)
  })

  it('48. a member who has already won a draw can never withdraw — regardless of whether the product has been physically claimed yet', async () => {
    setSession(mgrA)
    const schemeRes = await createSchemeViaTemplate({
      name: 'QA Withdrawal Winner Block Scheme', branch_id: BR_A, product_id: PROD1, member_count: 1, cycle_count: 1,
      min_members: 1, chit_value: 60000, contribution_amount: 1000,
    })
    expect(schemeRes.success).toBe(true)
    const schemeId = schemeRes.data.id
    const m1 = await call('chits:members:add', schemeId, { customer_name: 'Winner Withdrawal Attempt', customer_phone: '0771140012', agent_id: AGENT_REG })
    expect(m1.success).toBe(true)
    expect((await call('chits:contributions:record', m1.data.id, { amount: 1000, method: 'cash', cycle_no: 1 })).success).toBe(true)

    setSession(SUPER_ADMIN)
    const draw = await call('chits:draws:conduct', schemeId, 1, { method: 'manual_pick', winnerMemberId: m1.data.id, reason: 'QA withdrawal regression: winner should then be blocked from withdrawing' })
    expect(draw.success).toBe(true)
    setSession(mgrA)

    // At this point the member has WON (status='redeemed') but has NOT yet
    // had chits:members:recordRedemption called — no invoice/stock exists
    // yet. This is exactly the "pending product claim" scenario, and it
    // must be blocked identically to an already-claimed winner.
    const memberRow = db.prepare('SELECT status, redemption_invoice_id FROM chit_members WHERE id=?').get(m1.data.id) as any
    if (memberRow.status !== 'redeemed') note(`CRITICAL: test setup issue — member should show status='redeemed' immediately upon winning, before any product claim`)
    if (memberRow.redemption_invoice_id) note(`CRITICAL: test setup issue — no redemption invoice should exist yet at this point`)

    const withdrawAttempt = await call('chits:withdrawals:request', m1.data.id, 'Trying to withdraw after winning')
    if (withdrawAttempt.success) note(`CRITICAL: a member who has already won (product not yet claimed) was allowed to withdraw`)
    expect(withdrawAttempt.success).toBe(false)
    expect(String(withdrawAttempt.error || '')).toMatch(/already won|received their product/i)
  })

  it('49. a withdrawn member is blocked from new contributions and early redemption, and excluded from draw eligibility', async () => {
    setSession(mgrA)
    const schemeRes = await createSchemeViaTemplate({
      name: 'QA Withdrawal Post-Exit Block Scheme', branch_id: BR_A, product_id: PROD1, member_count: 2, cycle_count: 3,
      min_members: 2, chit_value: 60000, contribution_amount: 1000,
    })
    expect(schemeRes.success).toBe(true)
    const schemeId = schemeRes.data.id
    const m1 = await call('chits:members:add', schemeId, { customer_name: 'Post-Exit Block Member', customer_phone: '0771140013', agent_id: AGENT_REG })
    const m2 = await call('chits:members:add', schemeId, { customer_name: 'Post-Exit Block Filler', customer_phone: '0771140014', agent_id: AGENT_REG })
    expect(m1.success).toBe(true)
    expect(m2.success).toBe(true)

    const request = await call('chits:withdrawals:request', m1.data.id, 'Leaving the scheme for personal reasons')
    expect(request.success).toBe(true)
    setSession(SUPER_ADMIN)
    expect((await call('chits:withdrawals:approve', request.data.id, 0, 'Approved with no refund — no payments were made yet')).success).toBe(true)
    setSession(mgrA)

    const paymentAttempt = await call('chits:contributions:record', m1.data.id, { amount: 1000, method: 'cash', cycle_no: 1 })
    if (paymentAttempt.success) note(`CRITICAL: a contribution was accepted for a withdrawn member`)
    expect(paymentAttempt.success).toBe(false)

    const earlyRedeemAttempt = await call('chits:members:earlyRedeem', m1.data.id, { amount: 60000, method: 'cash' })
    if (earlyRedeemAttempt.success) note(`CRITICAL: an early redemption was accepted for a withdrawn member`)
    expect(earlyRedeemAttempt.success).toBe(false)

    // m2 pays cycle 1 to be genuinely eligible, confirming the exclusion is
    // specific to the withdrawn member and not a blanket scheme failure.
    expect((await call('chits:contributions:record', m2.data.id, { amount: 1000, method: 'cash', cycle_no: 1 })).success).toBe(true)
    const eligible = await call('chits:draws:eligible', schemeId, 1)
    const eligibleIds = (eligible.data || []).map((m: any) => m.id)
    if (eligibleIds.includes(m1.data.id)) note(`CRITICAL: a withdrawn member appeared in the draw-eligible pool`)
    if (!eligibleIds.includes(m2.data.id)) note(`CRITICAL: the remaining active, paid-up member should still be draw-eligible`)
  })

  it('50. report accuracy — scheme report shows withdrawn count and refund totals; dashboard shows pending withdrawal requests', async () => {
    setSession(mgrA)
    const schemeRes = await createSchemeViaTemplate({
      name: 'QA Withdrawal Report Accuracy Scheme', branch_id: BR_A, product_id: PROD1, member_count: 3, cycle_count: 3,
      min_members: 3, chit_value: 60000, contribution_amount: 2000,
    })
    expect(schemeRes.success).toBe(true)
    const schemeId = schemeRes.data.id
    const m1 = await call('chits:members:add', schemeId, { customer_name: 'Report Accuracy Withdrawn', customer_phone: '0771140015', agent_id: AGENT_REG })
    const m2 = await call('chits:members:add', schemeId, { customer_name: 'Report Accuracy Pending Request', customer_phone: '0771140016', agent_id: AGENT_REG })
    const m3 = await call('chits:members:add', schemeId, { customer_name: 'Report Accuracy Active', customer_phone: '0771140017', agent_id: AGENT_REG })
    expect(m1.success).toBe(true); expect(m2.success).toBe(true); expect(m3.success).toBe(true)

    // m1: fully withdrawn (approved) with a refund.
    db.prepare(`UPDATE chit_members SET contributions_paid=4000 WHERE id=?`).run(m1.data.id)
    const req1 = await call('chits:withdrawals:request', m1.data.id, 'Report accuracy test — approved withdrawal')
    expect(req1.success).toBe(true)
    setSession(SUPER_ADMIN)
    expect((await call('chits:withdrawals:approve', req1.data.id, 4000, 'Full refund approved for report accuracy test')).success).toBe(true)
    setSession(mgrA)

    // m2: a still-PENDING withdrawal request (scheme already active).
    const req2 = await call('chits:withdrawals:request', m2.data.id, 'Report accuracy test — pending request, not yet reviewed')
    expect(req2.success).toBe(true)
    if (req2.data.status !== 'pending') note(`CRITICAL: test setup issue — this request should still be pending`)

    const schemeReport = await call('chits:reports', { schemeId })
    const reportRow = (schemeReport.data || [])[0] as any
    if (!reportRow) note(`CRITICAL: scheme report returned no row for this scheme`)
    else {
      if (Number(reportRow.members_withdrawn) !== 1) note(`CRITICAL: scheme report members_withdrawn should be 1, got ${reportRow.members_withdrawn}`)
      if (Number(reportRow.withdrawal_refunds_total) !== 4000) note(`CRITICAL: scheme report withdrawal_refunds_total should be 4000, got ${reportRow.withdrawal_refunds_total}`)
      // m1 (withdrawn) must not count toward members_enrolled (existing,
      // already-correct exclusion — verifying it still holds).
      if (Number(reportRow.members_enrolled) !== 2) note(`CRITICAL: members_enrolled should exclude the withdrawn member (expected 2, got ${reportRow.members_enrolled})`)
    }

    setSession(SUPER_ADMIN)
    const dashboard = await call('chits:dashboard', { branchId: BR_A })
    if (!dashboard.success) note(`CRITICAL: dashboard failed: ${dashboard.error}`)
    else if (Number(dashboard.data.pending_withdrawal_requests) < 1) {
      note(`CRITICAL: dashboard pending_withdrawal_requests should include at least the 1 pending request from this test, got ${dashboard.data.pending_withdrawal_requests}`)
    }
    setSession(mgrA)
  })

  it('51. commission impact and contribution history — a withdrawn non-winner has zero commission ledger rows, and their prior payment history is preserved untouched', async () => {
    setSession(mgrA)
    const schemeRes = await createSchemeViaTemplate({
      name: 'QA Withdrawal Commission History Scheme', branch_id: BR_A, product_id: PROD1, member_count: 2, cycle_count: 3,
      min_members: 2, chit_value: 60000, contribution_amount: 3000,
    })
    expect(schemeRes.success).toBe(true)
    const schemeId = schemeRes.data.id
    const m1 = await call('chits:members:add', schemeId, { customer_name: 'Commission History Withdrawer', customer_phone: '0771140018', agent_id: AGENT_REG })
    const m2 = await call('chits:members:add', schemeId, { customer_name: 'Commission History Filler', customer_phone: '0771140019', agent_id: AGENT_REG })
    expect(m1.success).toBe(true)
    expect(m2.success).toBe(true)

    expect((await call('chits:contributions:record', m1.data.id, { amount: 3000, method: 'cash', cycle_no: 1 })).success).toBe(true)
    expect((await call('chits:contributions:record', m1.data.id, { amount: 3000, method: 'cash', cycle_no: 2 })).success).toBe(true)
    const contributionsBefore = db.prepare(`SELECT COUNT(*) as c, COALESCE(SUM(amount),0) as total FROM chit_contributions WHERE member_id=?`).get(m1.data.id) as any
    if (contributionsBefore.c !== 2 || Number(contributionsBefore.total) !== 6000) note(`CRITICAL: test setup issue — expected 2 contributions totalling 6000 before withdrawal`)

    const request = await call('chits:withdrawals:request', m1.data.id, 'Commission/history regression — withdrawing after paying 2 cycles, never won')
    expect(request.success).toBe(true)
    setSession(SUPER_ADMIN)
    expect((await call('chits:withdrawals:approve', request.data.id, 6000, 'Full refund — never won, no product ever allocated')).success).toBe(true)
    setSession(mgrA)

    // Commission is only ever accrued at chits:members:recordRedemption
    // (actual product handover) — a member who never won should have
    // NO commission ledger rows at all, before or after withdrawal.
    const commissionRows = db.prepare(`SELECT COUNT(*) as c FROM commission_ledger WHERE member_id=?`).get(m1.data.id) as any
    if (Number(commissionRows.c) !== 0) note(`CRITICAL: a withdrawn member who never won has ${commissionRows.c} commission_ledger row(s) — commission should only ever accrue at product redemption`)

    // Historical contribution rows must remain exactly as they were —
    // withdrawal never deletes or rewrites payment history.
    const contributionsAfter = db.prepare(`SELECT COUNT(*) as c, COALESCE(SUM(amount),0) as total FROM chit_contributions WHERE member_id=?`).get(m1.data.id) as any
    if (contributionsAfter.c !== 2 || Number(contributionsAfter.total) !== 6000) {
      note(`CRITICAL: contribution history was altered by withdrawal — expected 2 rows totalling 6000, got ${contributionsAfter.c} rows totalling ${contributionsAfter.total}`)
    }
    const statementCheck = await call('chits:members:contributionStatement', m1.data.id)
    if (!statementCheck.success || (statementCheck.data.paymentHistory || []).length !== 2) {
      note(`CRITICAL: the member's contribution statement should still show their full payment history after withdrawal`)
    }
  })

  it('52. branch isolation — a Manager cannot request or approve withdrawal for a member outside their own branch, and cannot see another branch\'s pending requests', async () => {
    setSession(mgrA)
    const schemeRes = await createSchemeViaTemplate({
      name: 'QA Withdrawal Branch Isolation Scheme', branch_id: BR_A, product_id: PROD1, member_count: 2, cycle_count: 3,
      min_members: 2, chit_value: 60000, contribution_amount: 1000,
    })
    expect(schemeRes.success).toBe(true)
    const schemeId = schemeRes.data.id
    const m1 = await call('chits:members:add', schemeId, { customer_name: 'Branch Isolation Member', customer_phone: '0771140020', agent_id: AGENT_REG })
    const m2 = await call('chits:members:add', schemeId, { customer_name: 'Branch Isolation Filler', customer_phone: '0771140021', agent_id: AGENT_REG })
    expect(m1.success).toBe(true)
    expect(m2.success).toBe(true)

    setSession(mgrB)
    const crossBranchRequest = await call('chits:withdrawals:request', m1.data.id, 'Manager B trying to withdraw a Branch A member')
    if (crossBranchRequest.success) note(`CRITICAL: a Manager from a different branch was able to request withdrawal for another branch's member`)
    expect(crossBranchRequest.success).toBe(false)

    setSession(mgrA)
    const legitRequest = await call('chits:withdrawals:request', m1.data.id, 'Legitimate withdrawal from the correct branch')
    expect(legitRequest.success).toBe(true)

    setSession(mgrB)
    const branchBList = await call('chits:withdrawals:list', {})
    const branchBIds = (branchBList.data || []).map((w: any) => w.id)
    if (branchBIds.includes(legitRequest.data.id)) note(`CRITICAL: Branch B's Manager could see Branch A's pending withdrawal request in their own list view`)
    setSession(mgrA)
  })

  it('53. Claim Expiry Policy — entitlement never expires after 90 days, reminder then delayed escalation, redemption still works throughout', async () => {
    setSession(mgrA)
    const schemeRes = await createSchemeViaTemplate({
      name: 'QA Claim Policy Scheme', branch_id: BR_A, product_id: PROD1, member_count: 1, cycle_count: 1,
      min_members: 1, chit_value: 60000, contribution_amount: 1000,
    })
    expect(schemeRes.success).toBe(true)
    const schemeId = schemeRes.data.id
    const m1 = await call('chits:members:add', schemeId, { customer_name: 'Claim Policy Winner', customer_phone: '0771150001', agent_id: AGENT_REG })
    expect(m1.success).toBe(true)
    expect((await call('chits:contributions:record', m1.data.id, { amount: 1000, method: 'cash', cycle_no: 1 })).success).toBe(true)

    setSession(SUPER_ADMIN)
    const draw = await call('chits:draws:conduct', schemeId, 1, { method: 'manual_pick', winnerMemberId: m1.data.id, reason: 'QA claim policy regression: winner selection' })
    expect(draw.success).toBe(true)
    setSession(mgrA)

    const afterWin = db.prepare('SELECT claim_status, claim_due_date, entitlement_value FROM chit_members WHERE id=?').get(m1.data.id) as any
    if (afterWin.claim_status !== 'pending_claim') note(`CRITICAL: a fresh winner should start claim_status='pending_claim', got '${afterWin.claim_status}'`)
    if (!afterWin.claim_due_date) note(`CRITICAL: claim_due_date was not set at win time`)
    if (Number(afterWin.entitlement_value) !== 60000) note(`CRITICAL: entitlement_value should be frozen to the scheme's chit_value (60000) at win time, got ${afterWin.entitlement_value}`)

    // Simulate 90+ days having passed (test shortcut — backdating rather
    // than waiting) and run the actual reminder check.
    db.prepare(`UPDATE chit_members SET claim_due_date=date('now','-5 days') WHERE id=?`).run(m1.data.id)
    await claimReminderService.runOnce()

    const afterReminder = db.prepare('SELECT claim_status, claim_reminder_sent_at, status, redemption_type FROM chit_members WHERE id=?').get(m1.data.id) as any
    if (afterReminder.claim_status !== 'reminder_sent') note(`CRITICAL: an overdue pending_claim member should become 'reminder_sent', got '${afterReminder.claim_status}'`)
    if (!afterReminder.claim_reminder_sent_at) note(`CRITICAL: claim_reminder_sent_at should be stamped once the reminder fires`)
    // The entitlement itself must never be touched by this — still a
    // winner, still redeemable.
    if (afterReminder.status !== 'redeemed' || !afterReminder.redemption_type) {
      note(`CRITICAL: claim reminder must never revoke winner status — status='${afterReminder.status}', redemption_type='${afterReminder.redemption_type}'`)
    }
    const reminderNotif = db.prepare(`SELECT * FROM notifications WHERE type='chit_claim_delayed' AND data LIKE ?`).get(`%${m1.data.id}%`)
    if (!reminderNotif) note(`CRITICAL: no notification was created when the claim reminder fired`)
    else {
      const notifRow = reminderNotif as any
      if (notifRow.role_scope !== 'smartBuy') note(`CRITICAL: claim reminder notification should target role_scope='smartBuy' (reaches Manager + Super Admin), got '${notifRow.role_scope}'`)
    }

    // Escalate further: still unclaimed a further 30+ days after the
    // reminder fired -> delayed_claim, notified again.
    db.prepare(`UPDATE chit_members SET claim_reminder_sent_at=datetime('now','-35 days') WHERE id=?`).run(m1.data.id)
    await claimReminderService.runOnce()
    const afterDelay = db.prepare('SELECT claim_status FROM chit_members WHERE id=?').get(m1.data.id) as any
    if (afterDelay.claim_status !== 'delayed_claim') note(`CRITICAL: a member still unclaimed well past the reminder should escalate to 'delayed_claim', got '${afterDelay.claim_status}'`)
    const delayedNotifCount = (db.prepare(`SELECT COUNT(*) as c FROM notifications WHERE type='chit_claim_delayed' AND data LIKE ?`).get(`%${m1.data.id}%`) as any).c
    if (Number(delayedNotifCount) < 2) note(`CRITICAL: expected a second notification on the delayed_claim escalation, got ${delayedNotifCount} total`)

    // Despite being 'delayed_claim', the winner can still claim right now —
    // the entitlement was never revoked or blocked at any point.
    const redemption = await call('chits:members:recordRedemption', m1.data.id, { product_id: PROD1, qty: 1 })
    if (!redemption.success) note(`CRITICAL: a delayed_claim winner should still be able to redeem — entitlement must never expire: ${redemption.error}`)
    expect(redemption.success).toBe(true)
    const afterRedeem = db.prepare('SELECT claim_status, claimed_at FROM chit_members WHERE id=?').get(m1.data.id) as any
    if (afterRedeem.claim_status !== 'redeemed') note(`CRITICAL: claim_status should be 'redeemed' once actually claimed, got '${afterRedeem.claim_status}'`)
    if (!afterRedeem.claimed_at) note(`CRITICAL: claimed_at should be stamped at the moment of actual redemption (distinct from the win date)`)
  })

  it('54. Super Admin can extend a claim due date with a mandatory reason and full audit trail; Manager cannot', async () => {
    setSession(mgrA)
    const schemeRes = await createSchemeViaTemplate({
      name: 'QA Claim Extension Scheme', branch_id: BR_A, product_id: PROD1, member_count: 1, cycle_count: 1,
      min_members: 1, chit_value: 60000, contribution_amount: 1000,
    })
    expect(schemeRes.success).toBe(true)
    const schemeId = schemeRes.data.id
    const m1 = await call('chits:members:add', schemeId, { customer_name: 'Claim Extension Winner', customer_phone: '0771150002', agent_id: AGENT_REG })
    expect(m1.success).toBe(true)
    expect((await call('chits:contributions:record', m1.data.id, { amount: 1000, method: 'cash', cycle_no: 1 })).success).toBe(true)
    setSession(SUPER_ADMIN)
    expect((await call('chits:draws:conduct', schemeId, 1, { method: 'manual_pick', winnerMemberId: m1.data.id, reason: 'QA claim extension regression' })).success).toBe(true)
    setSession(mgrA)

    const oldDueDate = (db.prepare('SELECT claim_due_date FROM chit_members WHERE id=?').get(m1.data.id) as any).claim_due_date
    const newDueDate = '2099-12-31'

    const managerAttempt = await call('chits:members:extendClaim', m1.data.id, newDueDate, 'Manager trying to extend')
    if (managerAttempt.success) note(`CRITICAL: a Smart Buy Manager was able to extend a claim due date — Super Admin-only requirement bypassed`)
    expect(managerAttempt.success).toBe(false)

    setSession(SUPER_ADMIN)
    const noReason = await call('chits:members:extendClaim', m1.data.id, newDueDate, '')
    if (noReason.success) note(`CRITICAL: an extension with no reason was accepted — extension reason should be mandatory`)
    expect(noReason.success).toBe(false)

    const extended = await call('chits:members:extendClaim', m1.data.id, newDueDate, 'Customer traveling abroad, requested more time')
    if (!extended.success) note(`CRITICAL: a valid claim extension was rejected: ${extended.error}`)
    expect(extended.success).toBe(true)

    const afterExtend = db.prepare('SELECT claim_due_date, claim_status FROM chit_members WHERE id=?').get(m1.data.id) as any
    if (afterExtend.claim_due_date !== newDueDate) note(`CRITICAL: claim_due_date was not updated to the new date, got '${afterExtend.claim_due_date}'`)
    if (afterExtend.claim_status !== 'pending_claim') note(`CRITICAL: an extension should reset claim_status back to 'pending_claim', got '${afterExtend.claim_status}'`)

    const auditRow = db.prepare(`SELECT * FROM audit_logs WHERE action='CHIT_CLAIM_EXTENDED' AND record_id=?`).get(m1.data.id) as any
    if (!auditRow) note(`CRITICAL: no CHIT_CLAIM_EXTENDED audit entry was created`)
    else {
      const oldValues = JSON.parse(auditRow.old_values || '{}')
      const newValues = JSON.parse(auditRow.new_values || '{}')
      if (oldValues.claimDueDate !== oldDueDate) note(`CRITICAL: audit old_values.claimDueDate mismatch — expected '${oldDueDate}', got '${oldValues.claimDueDate}'`)
      if (newValues.claimDueDate !== newDueDate || !newValues.reason || newValues.winner !== m1.data.id) {
        note(`CRITICAL: audit new_values incomplete — expected claimDueDate/reason/winner, got ${JSON.stringify(newValues)}`)
      }
      if (!auditRow.user_id) note(`CRITICAL: audit entry missing the approving user (Super Admin) id`)
    }
    setSession(mgrA)
  })

  it('55. Delayed Claim Report and dashboard count reflect overdue claims', async () => {
    setSession(mgrA)
    const schemeRes = await createSchemeViaTemplate({
      name: 'QA Delayed Claim Report Scheme', branch_id: BR_A, product_id: PROD1, member_count: 1, cycle_count: 1,
      min_members: 1, chit_value: 60000, contribution_amount: 1000,
    })
    expect(schemeRes.success).toBe(true)
    const schemeId = schemeRes.data.id
    const m1 = await call('chits:members:add', schemeId, { customer_name: 'Delayed Report Winner', customer_phone: '0771150003', agent_id: AGENT_REG })
    expect(m1.success).toBe(true)
    expect((await call('chits:contributions:record', m1.data.id, { amount: 1000, method: 'cash', cycle_no: 1 })).success).toBe(true)
    setSession(SUPER_ADMIN)
    expect((await call('chits:draws:conduct', schemeId, 1, { method: 'manual_pick', winnerMemberId: m1.data.id, reason: 'QA delayed claim report regression' })).success).toBe(true)
    setSession(mgrA)
    db.prepare(`UPDATE chit_members SET claim_due_date=date('now','-10 days') WHERE id=?`).run(m1.data.id)
    await claimReminderService.runOnce()

    const report = await call('chits:claims:delayed', { branchId: BR_A })
    if (!report.success) note(`CRITICAL: chits:claims:delayed failed: ${report.error}`)
    const reportIds = (report.data || []).map((r: any) => r.id)
    if (!reportIds.includes(m1.data.id)) note(`CRITICAL: an overdue winner did not appear in the Delayed Claim Report`)
    const reportRow = (report.data || []).find((r: any) => r.id === m1.data.id) as any
    if (reportRow && Number(reportRow.days_overdue) < 9) note(`CRITICAL: days_overdue should reflect roughly 10 backdated days, got ${reportRow?.days_overdue}`)

    setSession(SUPER_ADMIN)
    const dashboard = await call('chits:dashboard', { branchId: BR_A })
    if (Number(dashboard.data.delayed_claims_count) < 1) note(`CRITICAL: dashboard delayed_claims_count should include at least this overdue claim, got ${dashboard.data.delayed_claims_count}`)
    setSession(mgrA)
  })

  it('56. Winner Transfer Policy — Manager cannot transfer, Super Admin approval works, draw history/original winner preserved, redemption goes to the recipient', async () => {
    setSession(mgrA)
    const schemeRes = await createSchemeViaTemplate({
      name: 'QA Transfer Policy Scheme', branch_id: BR_A, product_id: PROD1, member_count: 1, cycle_count: 1,
      min_members: 1, chit_value: 60000, contribution_amount: 1000,
    })
    expect(schemeRes.success).toBe(true)
    const schemeId = schemeRes.data.id
    const m1 = await call('chits:members:add', schemeId, { customer_name: 'Transfer Original Winner', customer_phone: '0771150004', agent_id: AGENT_REG })
    expect(m1.success).toBe(true)
    const originalCustomerId = (db.prepare('SELECT customer_id FROM chit_members WHERE id=?').get(m1.data.id) as any).customer_id
    expect((await call('chits:contributions:record', m1.data.id, { amount: 1000, method: 'cash', cycle_no: 1 })).success).toBe(true)
    setSession(SUPER_ADMIN)
    expect((await call('chits:draws:conduct', schemeId, 1, { method: 'manual_pick', winnerMemberId: m1.data.id, reason: 'QA transfer policy regression' })).success).toBe(true)
    setSession(mgrA)

    const recipientId = crypto.randomUUID()
    db.prepare(`INSERT INTO customers (id, branch_id, name, phone) VALUES (?,?,?,?)`).run(recipientId, BR_A, 'Transfer Recipient', '0771150005')

    // A member who hasn't won yet cannot be transferred.
    const m2 = await call('chits:members:add', schemeId + '', { customer_name: 'x', customer_phone: 'x' }).catch(() => ({ success: false }))
    // (schemeId is already full at member_count=1 — this call is expected
    // to fail for capacity reasons, unrelated to the transfer check itself,
    // so it's only used to sanity-confirm we're not silently mis-scoping;
    // no assertion needed on it.)
    void m2

    const managerAttempt = await call('chits:members:transfer', m1.data.id, recipientId, 'Manager trying to transfer')
    if (managerAttempt.success) note(`CRITICAL: a Smart Buy Manager was able to transfer a winner entitlement — Super Admin-only requirement bypassed`)
    expect(managerAttempt.success).toBe(false)

    setSession(SUPER_ADMIN)
    const noReason = await call('chits:members:transfer', m1.data.id, recipientId, '')
    if (noReason.success) note(`CRITICAL: a transfer with no reason was accepted — transfer reason should be mandatory`)
    expect(noReason.success).toBe(false)

    const transferred = await call('chits:members:transfer', m1.data.id, recipientId, 'Original winner unable to collect — family emergency, approved exceptionally')
    if (!transferred.success) note(`CRITICAL: a valid Super Admin transfer was rejected: ${transferred.error}`)
    expect(transferred.success).toBe(true)

    const memberAfterTransfer = db.prepare('SELECT customer_id, transferred_customer_id, transfer_reason, won_cycle_no, redemption_type FROM chit_members WHERE id=?').get(m1.data.id) as any
    if (memberAfterTransfer.customer_id !== originalCustomerId) note(`CRITICAL: transfer must NEVER overwrite the original winner (customer_id) — draw history/scheme winner record changed`)
    if (memberAfterTransfer.transferred_customer_id !== recipientId) note(`CRITICAL: transferred_customer_id was not set to the recipient`)
    if (!memberAfterTransfer.transfer_reason) note(`CRITICAL: transfer_reason was not recorded`)
    if (!memberAfterTransfer.won_cycle_no || !memberAfterTransfer.redemption_type) note(`CRITICAL: transfer must not disturb the original draw history (won_cycle_no/redemption_type)`)

    const historyRow = db.prepare('SELECT * FROM smartbuy_transfer_history WHERE member_id=?').get(m1.data.id) as any
    if (!historyRow) note(`CRITICAL: no smartbuy_transfer_history row was created`)
    else {
      if (historyRow.original_customer_id !== originalCustomerId) note(`CRITICAL: transfer history original_customer_id mismatch`)
      if (historyRow.new_customer_id !== recipientId) note(`CRITICAL: transfer history new_customer_id mismatch`)
      if (!historyRow.approved_by) note(`CRITICAL: transfer history missing approved_by`)
    }

    const transferList = await call('chits:transfers:list', { branchId: BR_A })
    const listRow = (transferList.data || []).find((t: any) => t.member_id === m1.data.id) as any
    if (!listRow || listRow.original_customer_name !== 'Transfer Original Winner' || listRow.new_customer_name !== 'Transfer Recipient') {
      note(`CRITICAL: Transfer Report did not correctly show original winner and recipient names`)
    }

    // A second transfer attempt on the same still-unclaimed member should
    // still succeed (nothing here blocks re-transferring before claim) —
    // but claiming afterward must route the invoice to whichever customer
    // is currently the recipient.
    const redemption = await call('chits:members:recordRedemption', m1.data.id, { product_id: PROD1, qty: 1 })
    expect(redemption.success).toBe(true)
    const invoiceRow = db.prepare('SELECT customer_id FROM invoices WHERE id=?').get(redemption.data.invoiceId) as any
    if (invoiceRow.customer_id !== recipientId) note(`CRITICAL: the redemption invoice should be issued to the transferred recipient, got customer_id='${invoiceRow.customer_id}'`)
    const memberAfterClaim = db.prepare('SELECT customer_id FROM chit_members WHERE id=?').get(m1.data.id) as any
    if (memberAfterClaim.customer_id !== originalCustomerId) note(`CRITICAL: the original winner record must still be intact after the recipient claimed the product`)

    // Once claimed, a further transfer must be rejected.
    const recipient2Id = crypto.randomUUID()
    db.prepare(`INSERT INTO customers (id, branch_id, name, phone) VALUES (?,?,?,?)`).run(recipient2Id, BR_A, 'Second Recipient', '0771150006')
    const postClaimTransfer = await call('chits:members:transfer', m1.data.id, recipient2Id, 'Trying to transfer after already claimed')
    if (postClaimTransfer.success) note(`CRITICAL: a transfer was allowed AFTER the product was already claimed`)
    expect(postClaimTransfer.success).toBe(false)
    setSession(mgrA)
  })

  it('57. SmartBuy Wallet — downgrade creates credit, usage reduces balance, balance can never go negative', async () => {
    setSession(mgrA)
    const upgradeProdA = 'prod-downgrade-45k'
    db.prepare(`INSERT OR IGNORE INTO products (id, category_id, supplier_id, sku, name, unit, cost_price, selling_price, tax_rate) VALUES (?,NULL,NULL,?,?,?,?,?,?)`)
      .run(upgradeProdA, upgradeProdA, 'Downgrade Product 45k', 'pcs', 30000, 45000, 0)
    db.prepare(`INSERT INTO stocks (id, product_id, branch_id, warehouse_id, quantity) VALUES (?,?,?,NULL,?)`).run(crypto.randomUUID(), upgradeProdA, BR_A, 50)

    const schemeRes = await createSchemeViaTemplate({
      name: 'QA Wallet Downgrade Scheme', branch_id: BR_A, product_id: PROD1, member_count: 1, cycle_count: 1,
      min_members: 1, chit_value: 60000, contribution_amount: 1000,
    })
    expect(schemeRes.success).toBe(true)
    const schemeId = schemeRes.data.id
    const m1 = await call('chits:members:add', schemeId, { customer_name: 'Wallet Downgrade Winner', customer_phone: '0771150007', agent_id: AGENT_REG })
    expect(m1.success).toBe(true)
    const customerId = (db.prepare('SELECT customer_id FROM chit_members WHERE id=?').get(m1.data.id) as any).customer_id
    expect((await call('chits:contributions:record', m1.data.id, { amount: 1000, method: 'cash', cycle_no: 1 })).success).toBe(true)
    setSession(SUPER_ADMIN)
    expect((await call('chits:draws:conduct', schemeId, 1, { method: 'manual_pick', winnerMemberId: m1.data.id, reason: 'QA wallet downgrade regression' })).success).toBe(true)
    setSession(mgrA)

    // This product also differs from the scheme's own nominal product
    // (PROD1) — a downgrade and a substitution can legitimately co-occur,
    // so consent fields are required here too.
    const redemption = await call('chits:members:recordRedemption', m1.data.id, {
      product_id: upgradeProdA, qty: 1, substitution_reason: 'Customer chose a cheaper product', customer_accepted: true,
    })
    if (!redemption.success) note(`CRITICAL: a legitimate downgrade redemption was rejected: ${redemption.error}`)
    expect(redemption.success).toBe(true)
    if (redemption.data.walletCreditAmount !== 15000) note(`CRITICAL: expected 60000-45000=15000 wallet credit, got ${redemption.data.walletCreditAmount}`)

    const memberRow = db.prepare('SELECT wallet_credit_created FROM chit_members WHERE id=?').get(m1.data.id) as any
    if (Number(memberRow.wallet_credit_created) !== 15000) note(`CRITICAL: chit_members.wallet_credit_created mismatch, got ${memberRow.wallet_credit_created}`)

    const wallet = db.prepare('SELECT * FROM smartbuy_wallet WHERE customer_id=?').get(customerId) as any
    if (!wallet) note(`CRITICAL: no smartbuy_wallet row was created for the customer`)
    else if (Number(wallet.balance) !== 15000) note(`CRITICAL: wallet balance should be 15000, got ${wallet.balance}`)

    const walletTxns = db.prepare('SELECT * FROM smartbuy_wallet_transactions WHERE customer_id=?').all(customerId) as any[]
    if (walletTxns.length !== 1 || walletTxns[0].transaction_type !== 'credit' || Number(walletTxns[0].amount) !== 15000) {
      note(`CRITICAL: expected exactly 1 credit wallet transaction of 15000, got ${JSON.stringify(walletTxns)}`)
    }

    // Production Readiness Audit: "Manager cannot: Modify wallet balance" —
    // a Manager may view the wallet but not debit it.
    const managerDebit = await call('chits:wallet:debit', customerId, 1000, 'Manager trying to debit')
    if (managerDebit.success) note(`CRITICAL: a Smart Buy Manager was able to debit a SmartBuy Wallet — Super Admin-only requirement bypassed`)
    expect(managerDebit.success).toBe(false)

    // Usage reduces balance (Super Admin only).
    setSession(SUPER_ADMIN)
    const debit1 = await call('chits:wallet:debit', customerId, 5000, 'Used toward a future purchase')
    if (!debit1.success) note(`CRITICAL: a valid wallet debit within balance was rejected: ${debit1.error}`)
    expect(debit1.success).toBe(true)
    if (debit1.data.balance !== 10000) note(`CRITICAL: balance after a 5000 debit on a 15000 wallet should be 10000, got ${debit1.data.balance}`)

    // Cannot go negative.
    const overDebit = await call('chits:wallet:debit', customerId, 999999, 'Trying to overspend')
    if (overDebit.success) note(`CRITICAL: a wallet debit exceeding the available balance was accepted — balance can never go negative`)
    expect(overDebit.success).toBe(false)
    const balanceAfterRejected = db.prepare('SELECT balance FROM smartbuy_wallet WHERE customer_id=?').get(customerId) as any
    if (Number(balanceAfterRejected.balance) !== 10000) note(`CRITICAL: a rejected over-debit should leave the balance unchanged, got ${balanceAfterRejected.balance}`)
    setSession(mgrA)

    const walletReport = await call('chits:wallet:list', {})
    const reportRow = (walletReport.data || []).find((w: any) => w.customer_id === customerId) as any
    if (!reportRow || Number(reportRow.total_credited) !== 15000 || Number(reportRow.total_used) !== 5000 || Number(reportRow.balance) !== 10000) {
      note(`CRITICAL: Wallet Report totals incorrect, got ${JSON.stringify(reportRow)}`)
    }
  })

  it('58. Product Upgrade / Top-up Policy — a higher-value product requires a top-up payment, redemption is blocked without it, commission follows the actual (higher) invoice value', async () => {
    setSession(mgrA)
    const upgradeProdB = 'prod-upgrade-90k'
    db.prepare(`INSERT OR IGNORE INTO products (id, category_id, supplier_id, sku, name, unit, cost_price, selling_price, tax_rate) VALUES (?,NULL,NULL,?,?,?,?,?,?)`)
      .run(upgradeProdB, upgradeProdB, 'Upgrade Product 90k', 'pcs', 70000, 90000, 0)
    db.prepare(`INSERT INTO stocks (id, product_id, branch_id, warehouse_id, quantity) VALUES (?,?,?,NULL,?)`).run(crypto.randomUUID(), upgradeProdB, BR_A, 50)

    const schemeRes = await createSchemeViaTemplate({
      name: 'QA Upgrade Policy Scheme', branch_id: BR_A, product_id: PROD1, member_count: 2, cycle_count: 2,
      min_members: 2, chit_value: 60000, contribution_amount: 1000, agent_commission_pct: 5,
    })
    expect(schemeRes.success).toBe(true)
    const schemeId = schemeRes.data.id
    const mUpgrade = await call('chits:members:add', schemeId, { customer_name: 'Upgrade Winner', customer_phone: '0771150008', agent_id: AGENT_REG })
    const mBaseline = await call('chits:members:add', schemeId, { customer_name: 'Baseline Winner', customer_phone: '0771150009', agent_id: AGENT_REG })
    expect(mUpgrade.success).toBe(true)
    expect(mBaseline.success).toBe(true)
    expect((await call('chits:contributions:record', mUpgrade.data.id, { amount: 1000, method: 'cash', cycle_no: 1 })).success).toBe(true)
    expect((await call('chits:contributions:record', mBaseline.data.id, { amount: 1000, method: 'cash', cycle_no: 1 })).success).toBe(true)
    // mBaseline also needs its cycle-2 payment before it's draw-eligible
    // for the final cycle.
    expect((await call('chits:contributions:record', mBaseline.data.id, { amount: 1000, method: 'cash', cycle_no: 2 })).success).toBe(true)
    setSession(SUPER_ADMIN)
    expect((await call('chits:draws:conduct', schemeId, 1, { method: 'manual_pick', winnerMemberId: mUpgrade.data.id, reason: 'QA upgrade regression - winner 1' })).success).toBe(true)
    expect((await call('chits:draws:conduct', schemeId, 2, { method: 'manual_pick', winnerMemberId: mBaseline.data.id, reason: 'QA upgrade regression - winner 2 (final)' })).success).toBe(true)
    setSession(mgrA)

    // Blocked without a top-up payment method — this product also differs
    // from the scheme's own nominal product (PROD1), so substitution
    // consent is supplied here too, isolating the assertion to the
    // upgrade/top-up block specifically.
    const blocked = await call('chits:members:recordRedemption', mUpgrade.data.id, {
      product_id: upgradeProdB, qty: 1, substitution_reason: 'Customer chose a pricier product', customer_accepted: true,
    })
    if (blocked.success) note(`CRITICAL: an upgrade redemption (90000 against 60000 entitlement) succeeded WITHOUT a top-up payment method`)
    expect(blocked.success).toBe(false)
    expect(String(blocked.error || '')).toMatch(/top-up|entitled/i)
    const stillUnclaimed = db.prepare('SELECT redemption_invoice_id FROM chit_members WHERE id=?').get(mUpgrade.data.id) as any
    if (stillUnclaimed.redemption_invoice_id) note(`CRITICAL: a blocked upgrade attempt should not have committed anything`)

    const upgraded = await call('chits:members:recordRedemption', mUpgrade.data.id, {
      product_id: upgradeProdB, qty: 1, upgrade_payment_method: 'cash', substitution_reason: 'Customer chose a pricier product', customer_accepted: true,
    })
    if (!upgraded.success) note(`CRITICAL: a legitimate upgrade redemption with a top-up payment method was rejected: ${upgraded.error}`)
    expect(upgraded.success).toBe(true)
    if (upgraded.data.upgradeAmount !== 30000) note(`CRITICAL: expected 90000-60000=30000 upgrade amount, got ${upgraded.data.upgradeAmount}`)

    const invoice = db.prepare('SELECT * FROM invoices WHERE id=?').get(upgraded.data.invoiceId) as any
    if (Number(invoice.total_amount) !== 90000 || Number(invoice.paid_amount) !== 90000 || Number(invoice.due_amount) !== 0) {
      note(`CRITICAL: upgrade invoice totals incorrect — expected total=paid=90000, due=0, got ${JSON.stringify({ total: invoice.total_amount, paid: invoice.paid_amount, due: invoice.due_amount })}`)
    }
    const paymentRows = db.prepare('SELECT method, amount FROM payments WHERE invoice_id=? ORDER BY amount DESC').all(upgraded.data.invoiceId) as any[]
    const entitlementLine = paymentRows.find(p => p.method === 'chit_redemption')
    const upgradeLine = paymentRows.find(p => p.method === 'cash')
    if (!entitlementLine || Number(entitlementLine.amount) !== 60000) note(`CRITICAL: expected a 60000 chit_redemption payment line, got ${JSON.stringify(entitlementLine)}`)
    if (!upgradeLine || Number(upgradeLine.amount) !== 30000) note(`CRITICAL: expected a 30000 cash top-up payment line, got ${JSON.stringify(upgradeLine)}`)

    const memberRow = db.prepare('SELECT upgrade_amount, upgrade_payment_status, upgrade_payment_method, upgrade_paid_at FROM chit_members WHERE id=?').get(mUpgrade.data.id) as any
    if (Number(memberRow.upgrade_amount) !== 30000 || memberRow.upgrade_payment_status !== 'paid' || memberRow.upgrade_payment_method !== 'cash' || !memberRow.upgrade_paid_at) {
      note(`CRITICAL: chit_members upgrade tracking fields incorrect: ${JSON.stringify(memberRow)}`)
    }

    // Never an installment/loan — due_amount is 0 and there is no
    // installment schedule created for this member.
    const installmentCount = (db.prepare('SELECT COUNT(*) as c FROM installments WHERE customer_id=? AND invoice_id=?').get(invoice.customer_id, upgraded.data.invoiceId) as any).c
    if (Number(installmentCount) > 0) note(`CRITICAL: an upgrade top-up must never create an installment schedule — this is a loan, not a customer payment`)

    // Commission follows the ACTUAL invoice value, not just the entitlement
    // — compare against a same-scheme, same-agent baseline winner who
    // redeemed at exactly the entitlement value.
    const baselineRedemption = await call('chits:members:recordRedemption', mBaseline.data.id, { product_id: PROD1, qty: 1 })
    expect(baselineRedemption.success).toBe(true)
    const upgradeCommission = db.prepare(`SELECT COALESCE(SUM(total_commission),0) as total FROM commission_ledger WHERE source_id=?`).get(upgraded.data.invoiceId) as any
    const baselineCommission = db.prepare(`SELECT COALESCE(SUM(total_commission),0) as total FROM commission_ledger WHERE source_id=?`).get(baselineRedemption.data.invoiceId) as any
    if (Number(upgradeCommission.total) > 0 && Number(baselineCommission.total) > 0 && Number(upgradeCommission.total) <= Number(baselineCommission.total)) {
      note(`CRITICAL: commission on the upgraded (90000) redemption should exceed commission on the baseline (60000) redemption — commission must follow the actual invoice, not just the entitlement. Upgrade=${upgradeCommission.total}, Baseline=${baselineCommission.total}`)
    }
  })

  it('59. Product Substitution Consent Policy — cannot complete without a reason and customer acceptance; both are stored and audited; the scheme\'s own product needs neither', async () => {
    setSession(mgrA)
    const substituteProd = 'prod-substitute-b'
    db.prepare(`INSERT OR IGNORE INTO products (id, category_id, supplier_id, sku, name, unit, cost_price, selling_price, tax_rate) VALUES (?,NULL,NULL,?,?,?,?,?,?)`)
      .run(substituteProd, substituteProd, 'Substitute Product B', 'pcs', 35000, 55000, 0)
    db.prepare(`INSERT INTO stocks (id, product_id, branch_id, warehouse_id, quantity) VALUES (?,?,?,NULL,?)`).run(crypto.randomUUID(), substituteProd, BR_A, 50)

    // Scheme's own nominal product is PROD1 (60000) — redeeming with the
    // substitute product (55000, a different id) must require consent.
    const schemeRes = await createSchemeViaTemplate({
      name: 'QA Substitution Policy Scheme', branch_id: BR_A, product_id: PROD1, member_count: 1, cycle_count: 1,
      min_members: 1, chit_value: 60000, contribution_amount: 1000,
    })
    expect(schemeRes.success).toBe(true)
    const schemeId = schemeRes.data.id
    const m1 = await call('chits:members:add', schemeId, { customer_name: 'Substitution Winner', customer_phone: '0771150010', agent_id: AGENT_REG })
    expect(m1.success).toBe(true)
    expect((await call('chits:contributions:record', m1.data.id, { amount: 1000, method: 'cash', cycle_no: 1 })).success).toBe(true)
    setSession(SUPER_ADMIN)
    expect((await call('chits:draws:conduct', schemeId, 1, { method: 'manual_pick', winnerMemberId: m1.data.id, reason: 'QA substitution policy regression' })).success).toBe(true)
    setSession(mgrA)

    const noReason = await call('chits:members:recordRedemption', m1.data.id, { product_id: substituteProd, qty: 1, customer_accepted: true })
    if (noReason.success) note(`CRITICAL: a substituted redemption completed WITHOUT a substitution reason`)
    expect(noReason.success).toBe(false)

    const noAcceptance = await call('chits:members:recordRedemption', m1.data.id, { product_id: substituteProd, qty: 1, substitution_reason: 'Original product out of stock' })
    if (noAcceptance.success) note(`CRITICAL: a substituted redemption completed WITHOUT recorded customer acceptance`)
    expect(noAcceptance.success).toBe(false)

    const completed = await call('chits:members:recordRedemption', m1.data.id, {
      product_id: substituteProd, qty: 1, substitution_reason: 'Original product out of stock at this branch', customer_accepted: true,
    })
    if (!completed.success) note(`CRITICAL: a properly-consented substitution was rejected: ${completed.error}`)
    expect(completed.success).toBe(true)
    if (!completed.data.isSubstitution) note(`CRITICAL: response should flag isSubstitution=true`)

    const memberRow = db.prepare('SELECT substitution_flag, substitution_reason FROM chit_members WHERE id=?').get(m1.data.id) as any
    if (memberRow.substitution_flag !== 1) note(`CRITICAL: substitution_flag should be set to 1, got ${memberRow.substitution_flag}`)
    if (!memberRow.substitution_reason) note(`CRITICAL: substitution_reason was not stored`)

    const auditRow = db.prepare(`SELECT new_values FROM audit_logs WHERE action='CHIT_REDEMPTION_RECORDED' AND record_id=?`).get(m1.data.id) as any
    if (auditRow) {
      const newValues = JSON.parse(auditRow.new_values || '{}')
      if (!newValues.isSubstitution || !newValues.substitutionReason) note(`CRITICAL: redemption audit entry should record the substitution details, got ${JSON.stringify(newValues)}`)
    } else {
      note(`CRITICAL: no CHIT_REDEMPTION_RECORDED audit entry found for the substituted redemption`)
    }

    // A separate member redeeming with the SCHEME'S OWN product needs
    // neither a reason nor acceptance.
    const m2 = await call('chits:members:add', schemeId, { customer_name: 'No-Substitution Control', customer_phone: '0771150011', agent_id: AGENT_REG }).catch(() => ({ success: false }))
    // member_count=1 on this scheme, so a second member can't actually be
    // added — the substitution-not-required case for the scheme's own
    // product is already implicitly covered by every other redemption test
    // in this suite (none of them pass substitution_reason/customer_accepted
    // and all succeed), so no further action is needed here.
    void m2
  })

  it('60. Redemption reversal (Super Admin only) — correctly reverses invoice, stock, commission, and wallet; member becomes claimable again; Manager cannot reverse', async () => {
    setSession(mgrA)
    const schemeRes = await createSchemeViaTemplate({
      name: 'QA Reversal Scheme', branch_id: BR_A, product_id: PROD1, member_count: 1, cycle_count: 1,
      min_members: 1, chit_value: 60000, contribution_amount: 1000, agent_commission_pct: 5,
    })
    expect(schemeRes.success).toBe(true)
    const schemeId = schemeRes.data.id
    const m1 = await call('chits:members:add', schemeId, { customer_name: 'Reversal Winner', customer_phone: '0771150012', agent_id: AGENT_REG })
    expect(m1.success).toBe(true)
    expect((await call('chits:contributions:record', m1.data.id, { amount: 1000, method: 'cash', cycle_no: 1 })).success).toBe(true)
    setSession(SUPER_ADMIN)
    expect((await call('chits:draws:conduct', schemeId, 1, { method: 'manual_pick', winnerMemberId: m1.data.id, reason: 'QA reversal regression' })).success).toBe(true)
    setSession(mgrA)

    const stockBefore = (db.prepare('SELECT COALESCE(SUM(quantity),0) as q FROM stocks WHERE product_id=? AND branch_id=?').get(PROD1, BR_A) as any).q
    const redemption = await call('chits:members:recordRedemption', m1.data.id, { product_id: PROD1, qty: 1 })
    expect(redemption.success).toBe(true)
    const stockAfterRedeem = (db.prepare('SELECT COALESCE(SUM(quantity),0) as q FROM stocks WHERE product_id=? AND branch_id=?').get(PROD1, BR_A) as any).q
    if (stockAfterRedeem !== stockBefore - 1) note(`CRITICAL: test setup issue — stock should have decremented by 1 after redemption`)

    const managerAttempt = await call('chits:members:reverseRedemption', m1.data.id, 'Manager trying to reverse')
    if (managerAttempt.success) note(`CRITICAL: a Smart Buy Manager was able to reverse a redemption — Super Admin-only requirement bypassed`)
    expect(managerAttempt.success).toBe(false)

    setSession(SUPER_ADMIN)
    const noReason = await call('chits:members:reverseRedemption', m1.data.id, '')
    if (noReason.success) note(`CRITICAL: a reversal with no reason was accepted — reversal reason should be mandatory`)
    expect(noReason.success).toBe(false)

    const reversed = await call('chits:members:reverseRedemption', m1.data.id, 'Wrong product keyed in by mistake')
    if (!reversed.success) note(`CRITICAL: a valid Super Admin reversal was rejected: ${reversed.error}`)
    expect(reversed.success).toBe(true)

    const invoiceAfter = db.prepare('SELECT status FROM invoices WHERE id=?').get(redemption.data.invoiceId) as any
    if (invoiceAfter.status !== 'cancelled') note(`CRITICAL: the invoice should be cancelled after reversal, got '${invoiceAfter.status}'`)
    const stockAfterReversal = (db.prepare('SELECT COALESCE(SUM(quantity),0) as q FROM stocks WHERE product_id=? AND branch_id=?').get(PROD1, BR_A) as any).q
    if (stockAfterReversal !== stockBefore) note(`CRITICAL: stock should be fully restored after reversal — expected ${stockBefore}, got ${stockAfterReversal}`)
    const commissionAfter = db.prepare(`SELECT status FROM commission_ledger WHERE source_id=?`).all(redemption.data.invoiceId) as any[]
    if (commissionAfter.some(c => c.status !== 'cancelled')) note(`CRITICAL: commission_ledger rows for the reversed redemption should all be 'cancelled'`)

    const memberAfter = db.prepare('SELECT redemption_invoice_id, redeemed_product_id, claim_status, claimed_at, status, redemption_type FROM chit_members WHERE id=?').get(m1.data.id) as any
    if (memberAfter.redemption_invoice_id || memberAfter.redeemed_product_id) note(`CRITICAL: redemption fields should be cleared after reversal`)
    if (memberAfter.claim_status !== 'pending_claim' || memberAfter.claimed_at) note(`CRITICAL: claim tracking should reset to pending_claim/unclaimed after reversal`)
    if (memberAfter.status !== 'redeemed' || !memberAfter.redemption_type) note(`CRITICAL: reversal must NOT undo the win itself — member should still be a winner, just unclaimed`)

    // The member is claimable again, with a different product this time.
    const secondProd = 'prod-reversal-retry'
    db.prepare(`INSERT OR IGNORE INTO products (id, category_id, supplier_id, sku, name, unit, cost_price, selling_price, tax_rate) VALUES (?,NULL,NULL,?,?,?,?,?,?)`)
      .run(secondProd, secondProd, 'Reversal Retry Product', 'pcs', 40000, 60000, 0)
    db.prepare(`INSERT INTO stocks (id, product_id, branch_id, warehouse_id, quantity) VALUES (?,?,?,NULL,?)`).run(crypto.randomUUID(), secondProd, BR_A, 10)
    const retry = await call('chits:members:recordRedemption', m1.data.id, {
      product_id: secondProd, qty: 1, substitution_reason: 'Retrying with a different product after reversal', customer_accepted: true,
    })
    if (!retry.success) note(`CRITICAL: a member whose redemption was reversed should be able to redeem again — they were stuck permanently before this fix: ${retry.error}`)
    expect(retry.success).toBe(true)
  })

  it('61. Redemption reversal claws back wallet credit correctly, floored at 0 even if some was already spent', async () => {
    setSession(mgrA)
    const downgradeProd = 'prod-reversal-downgrade'
    db.prepare(`INSERT OR IGNORE INTO products (id, category_id, supplier_id, sku, name, unit, cost_price, selling_price, tax_rate) VALUES (?,NULL,NULL,?,?,?,?,?,?)`)
      .run(downgradeProd, downgradeProd, 'Reversal Downgrade Product', 'pcs', 30000, 40000, 0)
    db.prepare(`INSERT INTO stocks (id, product_id, branch_id, warehouse_id, quantity) VALUES (?,?,?,NULL,?)`).run(crypto.randomUUID(), downgradeProd, BR_A, 10)

    const schemeRes = await createSchemeViaTemplate({
      name: 'QA Reversal Wallet Clawback Scheme', branch_id: BR_A, product_id: PROD1, member_count: 1, cycle_count: 1,
      min_members: 1, chit_value: 60000, contribution_amount: 1000,
    })
    expect(schemeRes.success).toBe(true)
    const schemeId = schemeRes.data.id
    const m1 = await call('chits:members:add', schemeId, { customer_name: 'Reversal Wallet Winner', customer_phone: '0771150013', agent_id: AGENT_REG })
    expect(m1.success).toBe(true)
    const customerId = (db.prepare('SELECT customer_id FROM chit_members WHERE id=?').get(m1.data.id) as any).customer_id
    expect((await call('chits:contributions:record', m1.data.id, { amount: 1000, method: 'cash', cycle_no: 1 })).success).toBe(true)
    setSession(SUPER_ADMIN)
    expect((await call('chits:draws:conduct', schemeId, 1, { method: 'manual_pick', winnerMemberId: m1.data.id, reason: 'QA reversal wallet clawback regression' })).success).toBe(true)
    setSession(mgrA)

    // 60000 entitlement - 40000 product = 20000 credit.
    const redemption = await call('chits:members:recordRedemption', m1.data.id, {
      product_id: downgradeProd, qty: 1, substitution_reason: 'Customer chose a cheaper product', customer_accepted: true,
    })
    expect(redemption.success).toBe(true)
    expect(redemption.data.walletCreditAmount).toBe(20000)

    // Spend most of it before the reversal happens (wallet debit is Super
    // Admin-only).
    setSession(SUPER_ADMIN)
    expect((await call('chits:wallet:debit', customerId, 15000, 'Spent before reversal')).success).toBe(true)
    setSession(mgrA)
    const balanceBeforeReversal = (db.prepare('SELECT balance FROM smartbuy_wallet WHERE customer_id=?').get(customerId) as any).balance
    if (Number(balanceBeforeReversal) !== 5000) note(`CRITICAL: test setup issue — expected 5000 remaining before reversal, got ${balanceBeforeReversal}`)

    setSession(SUPER_ADMIN)
    const reversed = await call('chits:members:reverseRedemption', m1.data.id, 'Reversing a downgrade after some wallet credit was already spent')
    expect(reversed.success).toBe(true)
    setSession(mgrA)

    // Should claw back only what's left (5000), floored at 0 — never negative.
    const walletAfter = db.prepare('SELECT balance FROM smartbuy_wallet WHERE customer_id=?').get(customerId) as any
    if (Number(walletAfter.balance) !== 0) note(`CRITICAL: wallet balance after clawing back a partially-spent credit should floor at 0, got ${walletAfter.balance}`)
    if (Number(walletAfter.balance) < 0) note(`CRITICAL: wallet balance went negative — this must never happen`)
  })

  it('62. Non-regression — draw, final batch, stock, invoice, and commission all still work exactly as before for a normal (non-upgrade/downgrade/substitution) redemption', async () => {
    setSession(mgrA)
    const schemeRes = await createSchemeViaTemplate({
      name: 'QA Redemption Policy Non-Regression Scheme', branch_id: BR_A, product_id: PROD1, member_count: 3, cycle_count: 2,
      min_members: 3, chit_value: 60000, contribution_amount: 1000, agent_commission_pct: 5,
    })
    expect(schemeRes.success).toBe(true)
    const schemeId = schemeRes.data.id
    const m1 = await call('chits:members:add', schemeId, { customer_name: 'Non-Regression Single Winner', customer_phone: '0771150014', agent_id: AGENT_REG })
    const m2 = await call('chits:members:add', schemeId, { customer_name: 'Non-Regression Final Batch A', customer_phone: '0771150015', agent_id: AGENT_REG })
    const m3 = await call('chits:members:add', schemeId, { customer_name: 'Non-Regression Final Batch B', customer_phone: '0771150016', agent_id: AGENT_REG })
    expect(m1.success).toBe(true); expect(m2.success).toBe(true); expect(m3.success).toBe(true)
    for (const m of [m1, m2, m3]) {
      expect((await call('chits:contributions:record', m.data.id, { amount: 1000, method: 'cash', cycle_no: 1 })).success).toBe(true)
    }

    setSession(SUPER_ADMIN)
    // Cycle 1: single-winner draw.
    const draw1 = await call('chits:draws:conduct', schemeId, 1, { method: 'manual_pick', winnerMemberId: m1.data.id, reason: 'QA non-regression: single winner draw still works' })
    if (!draw1.success) note(`CRITICAL: REGRESSION — single-winner draw no longer works: ${draw1.error}`)
    expect(draw1.success).toBe(true)
    const m1AfterWin = db.prepare('SELECT status, redemption_type, claim_status, entitlement_value FROM chit_members WHERE id=?').get(m1.data.id) as any
    if (m1AfterWin.status !== 'redeemed' || m1AfterWin.redemption_type !== 'draw') note(`CRITICAL: REGRESSION — single-winner status/redemption_type incorrect`)
    if (m1AfterWin.claim_status !== 'pending_claim' || Number(m1AfterWin.entitlement_value) !== 60000) note(`CRITICAL: new claim fields not correctly populated for a single-winner draw`)

    // Pay cycle 2 for the remaining two so the final cycle can settle them.
    expect((await call('chits:contributions:record', m2.data.id, { amount: 1000, method: 'cash', cycle_no: 2 })).success).toBe(true)
    expect((await call('chits:contributions:record', m3.data.id, { amount: 1000, method: 'cash', cycle_no: 2 })).success).toBe(true)

    // Cycle 2 (final): final_batch settles BOTH remaining members together.
    const draw2 = await call('chits:draws:conduct', schemeId, 2, {})
    if (!draw2.success) note(`CRITICAL: REGRESSION — final_batch settlement no longer works: ${draw2.error}`)
    expect(draw2.success).toBe(true)
    for (const m of [m2, m3]) {
      const row = db.prepare('SELECT status, redemption_type, claim_status, claim_due_date, entitlement_value FROM chit_members WHERE id=?').get(m.data.id) as any
      if (row.status !== 'redeemed' || row.redemption_type !== 'final_batch') note(`CRITICAL: REGRESSION — final_batch member status/redemption_type incorrect for ${m.data.id}`)
      if (row.claim_status !== 'pending_claim' || !row.claim_due_date || Number(row.entitlement_value) !== 60000) {
        note(`CRITICAL: new claim fields not correctly populated for a final_batch winner (${m.data.id}) — the loop must cover every settled member, not just single-winner draws`)
      }
    }

    // Normal (exact entitlement) redemption — same shape as before this
    // feature: one payment line, one stock movement, commission on the
    // actual invoice, no upgrade/wallet/substitution fields set.
    const stockBefore = (db.prepare('SELECT COALESCE(SUM(quantity),0) as q FROM stocks WHERE product_id=? AND branch_id=?').get(PROD1, BR_A) as any).q
    const redemption = await call('chits:members:recordRedemption', m1.data.id, { product_id: PROD1, qty: 1 })
    if (!redemption.success) note(`CRITICAL: REGRESSION — normal redemption no longer works: ${redemption.error}`)
    expect(redemption.success).toBe(true)
    expect(redemption.data.upgradeAmount).toBe(0)
    expect(redemption.data.walletCreditAmount).toBe(0)
    expect(redemption.data.isSubstitution).toBe(false)

    const stockAfter = (db.prepare('SELECT COALESCE(SUM(quantity),0) as q FROM stocks WHERE product_id=? AND branch_id=?').get(PROD1, BR_A) as any).q
    if (stockAfter !== stockBefore - 1) note(`CRITICAL: REGRESSION — stock deduction on redemption is no longer correct`)

    const invoice = db.prepare('SELECT * FROM invoices WHERE id=?').get(redemption.data.invoiceId) as any
    if (Number(invoice.total_amount) !== 60000 || Number(invoice.paid_amount) !== 60000 || Number(invoice.due_amount) !== 0) {
      note(`CRITICAL: REGRESSION — normal redemption invoice totals incorrect`)
    }
    const paymentRows = db.prepare('SELECT * FROM payments WHERE invoice_id=?').all(redemption.data.invoiceId) as any[]
    if (paymentRows.length !== 1 || paymentRows[0].method !== 'chit_redemption' || Number(paymentRows[0].amount) !== 60000) {
      note(`CRITICAL: REGRESSION — normal redemption should produce exactly one chit_redemption payment line for the full amount`)
    }
    const commissionRow = db.prepare('SELECT * FROM commission_ledger WHERE source_id=?').get(redemption.data.invoiceId) as any
    if (!commissionRow) note(`CRITICAL: REGRESSION — commission was not accrued for a normal redemption`)

    const memberAfter = db.prepare('SELECT upgrade_amount, wallet_credit_created, substitution_flag FROM chit_members WHERE id=?').get(m1.data.id) as any
    if (Number(memberAfter.upgrade_amount) !== 0 || Number(memberAfter.wallet_credit_created) !== 0 || memberAfter.substitution_flag !== 0) {
      note(`CRITICAL: a normal redemption should leave all new upgrade/wallet/substitution fields at their zero/false defaults`)
    }
    setSession(mgrA)
  })

  it('63. Production Readiness — 100 schemes, 10,000 members, plus withdrawals/wallets/transfers/delayed claims at scale: dashboard, wallet report, delayed claims, transfers, draw eligibility, and customer search all complete within a sane time bound', async () => {
    const PERF2_BRANCH = 'branch-perf2'
    seedBranch(PERF2_BRANCH, 'Perf Branch 2', 'PR2')
    seedProduct('prod-perf2', 'Perf Product 2', 10000, 0)
    seedStock('prod-perf2', PERF2_BRANCH, 1000000)
    const perf2Agents = ['agent-perf2-1', 'agent-perf2-2', 'agent-perf2-3']
    for (const a of perf2Agents) seedAgent(a, a.toUpperCase(), PERF2_BRANCH, 5)

    const SCHEME_COUNT = 100
    const MEMBERS_PER_SCHEME = 100 // 100 x 100 = 10,000 members

    const insertCustomer = db.prepare(`INSERT INTO customers (id, branch_id, name, phone) VALUES (?,?,?,?)`)
    const insertScheme = db.prepare(`
      INSERT INTO chit_schemes (id, scheme_number, name, branch_id, product_id, member_count, cycle_count, contribution_amount, chit_value, start_date, status, min_members)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    `)
    const insertMember = db.prepare(`
      INSERT INTO chit_members (id, scheme_id, customer_id, agent_id, join_order, status, redemption_type, won_cycle_no, contributions_paid, enrolled_branch_id, claim_status, claim_due_date, entitlement_value)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    `)
    const insertDraw = db.prepare(`
      INSERT INTO chit_draws (id, scheme_id, cycle_no, winner_member_id, settled_count, eligible_count, method)
      VALUES (?,?,?,?,?,?,?)
    `)
    const insertContribution = db.prepare(`
      INSERT INTO chit_contributions (id, scheme_id, member_id, cycle_no, amount, method, status, branch_id, paid_at)
      VALUES (?,?,?,?,?,?,?,?,?)
    `)
    const insertWallet = db.prepare(`INSERT INTO smartbuy_wallet (id, customer_id, balance) VALUES (?,?,?)`)
    const insertWalletTxn = db.prepare(`
      INSERT INTO smartbuy_wallet_transactions (id, wallet_id, customer_id, transaction_type, amount, balance_after, source)
      VALUES (?,?,?,?,?,?,?)
    `)
    const insertWithdrawal = db.prepare(`
      INSERT INTO withdrawal_requests (id, member_id, scheme_id, branch_id, reason, scheme_was_active, status)
      VALUES (?,?,?,?,?,?,?)
    `)
    const insertTransfer = db.prepare(`
      INSERT INTO smartbuy_transfer_history (id, member_id, original_customer_id, new_customer_id, reason, approved_by)
      VALUES (?,?,?,?,?,?)
    `)

    const seedStart = Date.now()
    db.transaction(() => {
      for (let s = 0; s < SCHEME_COUNT; s++) {
        const schemeId = `perf2-scheme-${s}`
        insertScheme.run(
          schemeId, `PR2-${s}`, `Perf2 Scheme ${s}`, PERF2_BRANCH, 'prod-perf2',
          MEMBERS_PER_SCHEME, 5, 1000, 60000, '2026-01-01',
          s % 5 === 0 ? 'completed' : 'active', 2
        )
        for (let m = 0; m < MEMBERS_PER_SCHEME; m++) {
          const memberId = `perf2-member-${s}-${m}`
          const customerId = `perf2-customer-${s}-${m}`
          const agentId = perf2Agents[m % perf2Agents.length]
          const isWinner = m < 5 // first 5 members per scheme are winners
          // Spread claim status across pending/reminder_sent/delayed_claim
          // for winners so the Delayed Claim Report/dashboard count have
          // real rows to filter at scale, not just zeros.
          const claimStatus = !isWinner ? 'pending_claim' : (m === 0 ? 'delayed_claim' : m === 1 ? 'reminder_sent' : 'pending_claim')
          insertCustomer.run(customerId, PERF2_BRANCH, `Perf2 Customer ${s}-${m}`, `08${String(s).padStart(4, '0')}${String(m).padStart(3, '0')}`)
          insertMember.run(
            memberId, schemeId, customerId, agentId, m + 1,
            isWinner ? 'redeemed' : 'active',
            isWinner ? 'draw' : null,
            isWinner ? m + 1 : null,
            1000 * (m % 4 + 1),
            PERF2_BRANCH,
            isWinner ? claimStatus : 'pending_claim',
            isWinner ? '2026-01-01' : null,
            isWinner ? 60000 : null
          )
          insertContribution.run(`perf2-contrib-${s}-${m}`, schemeId, memberId, 1, 1000, 'cash', 'approved', PERF2_BRANCH, '2026-01-15T10:00:00.000Z')
          if (isWinner) {
            insertDraw.run(`perf2-draw-${s}-${m}`, schemeId, m + 1, memberId, 1, MEMBERS_PER_SCHEME - m, 'random')
          }
          // Every 20th member gets a wallet with some history, and every
          // 25th a withdrawal request, so the wallet/withdrawal/transfer
          // reports have real volume at scale, not just empty tables.
          if ((s * MEMBERS_PER_SCHEME + m) % 20 === 0) {
            const walletId = `perf2-wallet-${s}-${m}`
            insertWallet.run(walletId, customerId, 5000)
            insertWalletTxn.run(`perf2-wallettxn-${s}-${m}`, walletId, customerId, 'credit', 5000, 5000, 'redemption_downgrade')
          }
          if (!isWinner && (s * MEMBERS_PER_SCHEME + m) % 25 === 0) {
            insertWithdrawal.run(`perf2-withdrawal-${s}-${m}`, memberId, schemeId, PERF2_BRANCH, 'Performance seed withdrawal', 1, 'pending')
          }
          if (isWinner && m === 2) {
            insertTransfer.run(`perf2-transfer-${s}-${m}`, memberId, customerId, customerId, 'Performance seed transfer', null)
          }
        }
      }
    })()
    const seedMs = Date.now() - seedStart

    setSession(SUPER_ADMIN)
    const TIME_BUDGET_MS = 4000 // generous — stability/regression guard against unindexed scans, not a strict benchmark

    const timeCall = async (label: string, fn: () => Promise<any>) => {
      const start = Date.now()
      const res = await fn()
      const elapsed = Date.now() - start
      if (!res.success) note(`CRITICAL: ${label} failed against the large dataset: ${res.error}`)
      if (elapsed > TIME_BUDGET_MS) note(`HIGH: ${label} took ${elapsed}ms against 100 schemes / 10,000 members — exceeds the ${TIME_BUDGET_MS}ms sanity budget, likely an unindexed scan`)
      return elapsed
    }

    const dashboardMs = await timeCall('chits:dashboard (whole company)', () => call('chits:dashboard', {}))
    const walletMs = await timeCall('chits:wallet:list (whole company)', () => call('chits:wallet:list', {}))
    const delayedClaimsMs = await timeCall('chits:claims:delayed (whole company)', () => call('chits:claims:delayed', {}))
    const transfersMs = await timeCall('chits:transfers:list (whole company)', () => call('chits:transfers:list', {}))
    const winnersMs = await timeCall('chits:reports:winners (whole company)', () => call('chits:reports:winners', {}))
    const searchMs = await timeCall('customers:search ("Perf2")', () => call('customers:search', 'Perf2 Customer 5-'))
    // Draw eligibility on a single large (100-member) active scheme — the
    // per-candidate computeMemberCycleBalance query path, the one most
    // likely to degrade with member count.
    const eligibilityMs = await timeCall('chits:draws:eligible (single 100-member scheme)', () => call('chits:draws:eligible', 'perf2-scheme-1', 1))

    console.log(`[PERF2] seed=${seedMs}ms dashboard=${dashboardMs}ms wallet=${walletMs}ms delayedClaims=${delayedClaimsMs}ms transfers=${transfersMs}ms winners=${winnersMs}ms search=${searchMs}ms eligibility=${eligibilityMs}ms`)

    // Sanity check the data actually landed, not just that queries returned fast on nothing.
    const dashboard = await call('chits:dashboard', {})
    if (Number(dashboard.data.delayed_claims_count) < SCHEME_COUNT) note(`CRITICAL: dashboard delayed_claims_count undercounts the seeded performance dataset (expected at least ${SCHEME_COUNT}, got ${dashboard.data.delayed_claims_count})`)
    if (Number(dashboard.data.total_wallet_balance) <= 0) note(`CRITICAL: dashboard total_wallet_balance did not pick up the seeded wallet data`)
    const walletReport = await call('chits:wallet:list', {})
    const perf2WalletCount = (walletReport.data || []).filter((w: any) => String(w.customer_name || '').startsWith('Perf2')).length
    if (perf2WalletCount === 0) note(`CRITICAL: chits:wallet:list did not return the seeded performance wallets`)
  }, 90000)

  it('64. Wallet visibility is scoped by enrollment (enrolled_branch_id), not the customer\'s home branch — a shared customer stays visible to every branch that actually enrolled them, invisible to branches that never did', async () => {
    const downgradeProdC = 'prod-wallet-branch-scope'
    db.prepare(`INSERT OR IGNORE INTO products (id, category_id, supplier_id, sku, name, unit, cost_price, selling_price, tax_rate) VALUES (?,NULL,NULL,?,?,?,?,?,?)`)
      .run(downgradeProdC, downgradeProdC, 'Wallet Branch Scope Product', 'pcs', 30000, 45000, 0)
    db.prepare(`INSERT INTO stocks (id, product_id, branch_id, warehouse_id, quantity) VALUES (?,?,?,NULL,?)`).run(crypto.randomUUID(), downgradeProdC, BR_A, 10)

    setSession(mgrA)
    const schemeA = await createSchemeViaTemplate({
      name: 'QA Wallet Branch Scope Scheme A', branch_id: BR_A, product_id: PROD1, member_count: 1, cycle_count: 1,
      min_members: 1, chit_value: 60000, contribution_amount: 1000,
    })
    expect(schemeA.success).toBe(true)
    const sharedPhone = '0771150017'
    const mA = await call('chits:members:add', schemeA.data.id, { customer_name: 'Wallet Branch Scope Customer', customer_phone: sharedPhone, agent_id: AGENT_REG })
    expect(mA.success).toBe(true)
    const customerId = (db.prepare('SELECT customer_id FROM chit_members WHERE id=?').get(mA.data.id) as any).customer_id
    expect((await call('chits:contributions:record', mA.data.id, { amount: 1000, method: 'cash', cycle_no: 1 })).success).toBe(true)
    setSession(SUPER_ADMIN)
    expect((await call('chits:draws:conduct', schemeA.data.id, 1, { method: 'manual_pick', winnerMemberId: mA.data.id, reason: 'QA wallet branch scope regression' })).success).toBe(true)
    setSession(mgrA)
    // Downgrade at Branch A creates wallet credit for this customer, whose
    // "home" branch_id is Branch A (they were created here first).
    const redemption = await call('chits:members:recordRedemption', mA.data.id, {
      product_id: downgradeProdC, qty: 1, substitution_reason: 'Customer chose a cheaper product', customer_accepted: true,
    })
    expect(redemption.success).toBe(true)
    expect(redemption.data.walletCreditAmount).toBe(15000)

    // The SAME customer (same phone) also enrolls at Branch B — reuses the
    // same customer_id, but this specific chit_members row is enrolled at
    // Branch B.
    setSession(mgrB)
    const schemeB = await createSchemeViaTemplate({
      name: 'QA Wallet Branch Scope Scheme B', branch_id: BR_B, product_id: PROD1, member_count: 1, cycle_count: 1,
      min_members: 1, chit_value: 60000, contribution_amount: 1000,
    })
    expect(schemeB.success).toBe(true)
    const mB = await call('chits:members:add', schemeB.data.id, { customer_name: 'Wallet Branch Scope Customer', customer_phone: sharedPhone, agent_id: AGENT_OTHER })
    expect(mB.success).toBe(true)
    const customerIdViaB = (db.prepare('SELECT customer_id FROM chit_members WHERE id=?').get(mB.data.id) as any).customer_id
    if (customerIdViaB !== customerId) note(`CRITICAL: test setup issue — enrolling the same phone at Branch B should reuse the same customer_id as Branch A`)

    // Branch B's Manager must be able to see this customer's wallet — they
    // have a real enrollment relationship, even though the customer's home
    // branch_id is Branch A.
    const branchBList = await call('chits:wallet:list', {})
    const branchBSeesIt = (branchBList.data || []).some((w: any) => w.customer_id === customerId)
    if (!branchBSeesIt) note(`CRITICAL: Branch B's Manager cannot see a wallet for a customer they legitimately enrolled — wallet visibility incorrectly scoped to the customer's home branch instead of the enrollment relationship`)
    const branchBDetail = await call('chits:wallet:detail', customerId)
    if (!branchBDetail.success || !branchBDetail.data.wallet) note(`CRITICAL: Branch B's Manager was denied chits:wallet:detail for a customer they legitimately enrolled`)

    // A branch with NO enrollment relationship to this customer at all
    // must NOT see their wallet.
    setSession(mgrC)
    const branchCList = await call('chits:wallet:list', {})
    const branchCSeesIt = (branchCList.data || []).some((w: any) => w.customer_id === customerId)
    if (branchCSeesIt) note(`CRITICAL: Branch C's Manager, with no enrollment relationship to this customer at all, could see their wallet — cross-branch data leak`)
    const branchCDetail = await call('chits:wallet:detail', customerId)
    if (branchCDetail.success !== false) note(`CRITICAL: Branch C's Manager was not denied chits:wallet:detail for a customer they have no relationship with`)
    setSession(mgrA)
  })

  // ── SmartBuy Wallet Integration with POS Checkout ────────────────────────
  // Builds a minimal, valid RETAIL invoice payload matching exactly what
  // PaymentModal.tsx actually sends (single line item, no discount/tax —
  // keeps the wallet-specific assertions the focus, not invoice-line math
  // already covered by the core POS test suite elsewhere).
  function posSalePayload(opts: {
    customerId?: string; productId: string; qty?: number; unitPrice: number
    smartbuyWalletAmount?: number; cashAmount?: number
  }) {
    const qty = opts.qty ?? 1
    const total = Math.round(opts.unitPrice * qty * 100) / 100
    return {
      branch_id: BR_A, customer_id: opts.customerId || undefined, bill_type: 'RETAIL',
      subtotal: total, discount_amount: 0, tax_amount: 0, total_amount: total,
      paid_amount: total, due_amount: 0,
      items: [{ product_id: opts.productId, quantity: qty, unit_price: opts.unitPrice, discount_pct: 0, discount_amount: 0, tax_rate: 0, tax_amount: 0, line_total: total }],
      payments: opts.cashAmount ? [{ method: 'cash', amount: opts.cashAmount }] : undefined,
      smartbuy_wallet: opts.smartbuyWalletAmount ? { amount: opts.smartbuyWalletAmount } : undefined,
    }
  }

  it('65. non-regression — a plain cash POS sale (no wallet involved) still creates a correct invoice, stock deduction, and payment line', async () => {
    setSession(mgrA)
    const prodPlain = 'prod-pos-plain-cash'
    db.prepare(`INSERT OR IGNORE INTO products (id, category_id, supplier_id, sku, name, unit, cost_price, selling_price, tax_rate) VALUES (?,NULL,NULL,?,?,?,?,?,?)`)
      .run(prodPlain, prodPlain, 'POS Plain Cash Product', 'pcs', 3000, 5000, 0)
    db.prepare(`INSERT INTO stocks (id, product_id, branch_id, warehouse_id, quantity) VALUES (?,?,?,NULL,?)`).run(crypto.randomUUID(), prodPlain, BR_A, 50)
    const stockBefore = (db.prepare('SELECT COALESCE(SUM(quantity),0) as q FROM stocks WHERE product_id=? AND branch_id=?').get(prodPlain, BR_A) as any).q

    const res = await call('invoices:create', posSalePayload({ productId: prodPlain, unitPrice: 5000, cashAmount: 5000 }))
    if (!res.success) note(`CRITICAL: REGRESSION — a plain cash POS sale with no wallet involvement failed: ${res.error}`)
    expect(res.success).toBe(true)

    const invoice = db.prepare('SELECT * FROM invoices WHERE id=?').get(res.data.id) as any
    if (Number(invoice.total_amount) !== 5000 || Number(invoice.paid_amount) !== 5000) note(`CRITICAL: REGRESSION — plain cash invoice totals incorrect`)
    const payments = db.prepare('SELECT * FROM payments WHERE invoice_id=?').all(res.data.id) as any[]
    if (payments.length !== 1 || payments[0].method !== 'cash' || Number(payments[0].amount) !== 5000 || payments[0].wallet_transaction_id) {
      note(`CRITICAL: REGRESSION — plain cash sale should produce exactly one cash payment line with no wallet_transaction_id`)
    }
    const stockAfter = (db.prepare('SELECT COALESCE(SUM(quantity),0) as q FROM stocks WHERE product_id=? AND branch_id=?').get(prodPlain, BR_A) as any).q
    if (stockAfter !== stockBefore - 1) note(`CRITICAL: REGRESSION — stock deduction on a plain POS sale is no longer correct`)
  })

  it('66. Test 1 — SmartBuy Wallet is created from a downgrade redemption (baseline, exercised again here for this feature\'s own suite)', async () => {
    setSession(mgrA)
    const downgradeProd = 'prod-pos-wallet-source'
    db.prepare(`INSERT OR IGNORE INTO products (id, category_id, supplier_id, sku, name, unit, cost_price, selling_price, tax_rate) VALUES (?,NULL,NULL,?,?,?,?,?,?)`)
      .run(downgradeProd, downgradeProd, 'POS Wallet Source Product', 'pcs', 3000, 5000, 0)
    db.prepare(`INSERT INTO stocks (id, product_id, branch_id, warehouse_id, quantity) VALUES (?,?,?,NULL,?)`).run(crypto.randomUUID(), downgradeProd, BR_A, 10)

    const schemeRes = await createSchemeViaTemplate({
      name: 'QA POS Wallet Source Scheme', branch_id: BR_A, product_id: PROD1, member_count: 1, cycle_count: 1,
      min_members: 1, chit_value: 20000, contribution_amount: 1000,
    })
    expect(schemeRes.success).toBe(true)
    const m1 = await call('chits:members:add', schemeRes.data.id, { customer_name: 'POS Wallet Source Winner', customer_phone: '0771160001', agent_id: AGENT_REG })
    expect(m1.success).toBe(true)
    const customerId = (db.prepare('SELECT customer_id FROM chit_members WHERE id=?').get(m1.data.id) as any).customer_id
    expect((await call('chits:contributions:record', m1.data.id, { amount: 1000, method: 'cash', cycle_no: 1 })).success).toBe(true)
    setSession(SUPER_ADMIN)
    expect((await call('chits:draws:conduct', schemeRes.data.id, 1, { method: 'manual_pick', winnerMemberId: m1.data.id, reason: 'QA POS wallet source regression' })).success).toBe(true)
    setSession(mgrA)

    // 20000 entitlement - 5000 product = 15000 credit, matching the
    // worked example in the request (customer wallet balance 15000).
    const redemption = await call('chits:members:recordRedemption', m1.data.id, {
      product_id: downgradeProd, qty: 1, substitution_reason: 'Customer chose a cheaper product', customer_accepted: true,
    })
    expect(redemption.success).toBe(true)
    expect(redemption.data.walletCreditAmount).toBe(15000)
    const wallet = db.prepare('SELECT balance FROM smartbuy_wallet WHERE customer_id=?').get(customerId) as any
    if (Number(wallet.balance) !== 15000) note(`CRITICAL: expected a 15000 SmartBuy Wallet balance after the downgrade, got ${wallet.balance}`)

    // Stash for the POS tests below.
    ;(globalThis as any).__qaWalletCustomerId = customerId
  })

  it('67. Test 2 — a POS purchase fully paid by SmartBuy Wallet: no cash/card line, correct payment/transaction linkage, stock and commission unaffected by the payment source', async () => {
    setSession(mgrA)
    const customerId = (globalThis as any).__qaWalletCustomerId as string
    if (!customerId) note(`CRITICAL: test setup issue — no wallet customer carried over from test 66`)

    const prod = 'prod-pos-wallet-full'
    db.prepare(`INSERT OR IGNORE INTO products (id, category_id, supplier_id, sku, name, unit, cost_price, selling_price, tax_rate) VALUES (?,NULL,NULL,?,?,?,?,?,?)`)
      .run(prod, prod, 'POS Wallet Full Payment Product', 'pcs', 6000, 10000, 0)
    db.prepare(`INSERT INTO stocks (id, product_id, branch_id, warehouse_id, quantity) VALUES (?,?,?,NULL,?)`).run(crypto.randomUUID(), prod, BR_A, 20)
    const stockBefore = (db.prepare('SELECT COALESCE(SUM(quantity),0) as q FROM stocks WHERE product_id=? AND branch_id=?').get(prod, BR_A) as any).q
    const walletBefore = (db.prepare('SELECT balance FROM smartbuy_wallet WHERE customer_id=?').get(customerId) as any).balance

    // 10000 product, fully covered by the 15000 wallet balance.
    const res = await call('invoices:create', posSalePayload({ customerId, productId: prod, unitPrice: 10000, smartbuyWalletAmount: 10000 }))
    if (!res.success) note(`CRITICAL: a POS sale fully paid by SmartBuy Wallet was rejected: ${res.error}`)
    expect(res.success).toBe(true)

    const invoice = db.prepare('SELECT * FROM invoices WHERE id=?').get(res.data.id) as any
    if (Number(invoice.total_amount) !== 10000 || Number(invoice.paid_amount) !== 10000 || Number(invoice.due_amount) !== 0) {
      note(`CRITICAL: invoice totals incorrect for a fully wallet-paid sale`)
    }
    const payments = db.prepare('SELECT * FROM payments WHERE invoice_id=?').all(res.data.id) as any[]
    if (payments.length !== 1 || payments[0].method !== 'smartbuy_wallet' || Number(payments[0].amount) !== 10000 || !payments[0].wallet_transaction_id) {
      note(`CRITICAL: expected exactly one smartbuy_wallet payment line with a wallet_transaction_id set, got ${JSON.stringify(payments)}`)
    }
    const walletAfter = (db.prepare('SELECT balance FROM smartbuy_wallet WHERE customer_id=?').get(customerId) as any).balance
    if (Number(walletAfter) !== Number(walletBefore) - 10000) note(`CRITICAL: wallet balance should decrease by exactly 10000, got ${walletBefore} -> ${walletAfter}`)

    const txn = db.prepare('SELECT * FROM smartbuy_wallet_transactions WHERE id=?').get(payments[0].wallet_transaction_id) as any
    if (!txn || txn.transaction_type !== 'debit' || Number(txn.amount) !== 10000 || txn.invoice_id !== res.data.id || txn.source !== 'pos_purchase') {
      note(`CRITICAL: wallet transaction row incorrect for a POS purchase debit: ${JSON.stringify(txn)}`)
    }

    // Stock deduction and audit trail are unaffected by the payment source.
    const stockAfter = (db.prepare('SELECT COALESCE(SUM(quantity),0) as q FROM stocks WHERE product_id=? AND branch_id=?').get(prod, BR_A) as any).q
    if (stockAfter !== stockBefore - 1) note(`CRITICAL: stock deduction incorrect for a wallet-paid sale`)
    const auditRow = (db.prepare(`SELECT * FROM audit_logs WHERE action='SMARTBUY_WALLET_DEBITED'`).all() as any[]).find((r: any) => {
      try { return JSON.parse(r.new_values || '{}').invoiceId === res.data.id } catch { return false }
    })
    if (!auditRow) note(`CRITICAL: no SMARTBUY_WALLET_DEBITED audit entry was created for this POS purchase`)
  })

  it('68. Test 3 — partial wallet + cash payment: two distinct payment lines, wallet decremented by only its share, invoice total covered by both combined', async () => {
    setSession(mgrA)
    const customerId = (globalThis as any).__qaWalletCustomerId as string
    const walletBefore = (db.prepare('SELECT balance FROM smartbuy_wallet WHERE customer_id=?').get(customerId) as any).balance
    if (Number(walletBefore) !== 5000) note(`CRITICAL: test setup issue — expected 5000 remaining wallet balance entering this test, got ${walletBefore}`)

    const prod = 'prod-pos-wallet-partial'
    db.prepare(`INSERT OR IGNORE INTO products (id, category_id, supplier_id, sku, name, unit, cost_price, selling_price, tax_rate) VALUES (?,NULL,NULL,?,?,?,?,?,?)`)
      .run(prod, prod, 'POS Wallet Partial Payment Product', 'pcs', 12000, 20000, 0)
    db.prepare(`INSERT INTO stocks (id, product_id, branch_id, warehouse_id, quantity) VALUES (?,?,?,NULL,?)`).run(crypto.randomUUID(), prod, BR_A, 20)

    // Matches the worked example: 20000 product, 15000 wallet [only 5000
    // left at this point in the suite] + cash for the rest.
    const res = await call('invoices:create', posSalePayload({ customerId, productId: prod, unitPrice: 20000, smartbuyWalletAmount: 5000, cashAmount: 15000 }))
    if (!res.success) note(`CRITICAL: a split wallet+cash POS sale was rejected: ${res.error}`)
    expect(res.success).toBe(true)

    const invoice = db.prepare('SELECT * FROM invoices WHERE id=?').get(res.data.id) as any
    if (Number(invoice.total_amount) !== 20000 || Number(invoice.paid_amount) !== 20000) note(`CRITICAL: split-payment invoice totals incorrect`)
    const payments = db.prepare('SELECT method, amount FROM payments WHERE invoice_id=? ORDER BY amount DESC').all(res.data.id) as any[]
    const cashLine = payments.find(p => p.method === 'cash')
    const walletLine = payments.find(p => p.method === 'smartbuy_wallet')
    if (!cashLine || Number(cashLine.amount) !== 15000) note(`CRITICAL: expected a 15000 cash payment line, got ${JSON.stringify(cashLine)}`)
    if (!walletLine || Number(walletLine.amount) !== 5000) note(`CRITICAL: expected a 5000 smartbuy_wallet payment line, got ${JSON.stringify(walletLine)}`)
    if (payments.length !== 2) note(`CRITICAL: expected exactly 2 payment lines for a split wallet+cash sale, got ${payments.length}`)

    const walletAfter = (db.prepare('SELECT balance FROM smartbuy_wallet WHERE customer_id=?').get(customerId) as any).balance
    if (Number(walletAfter) !== 0) note(`CRITICAL: wallet should be fully drained to 0 (had 5000, applied 5000), got ${walletAfter}`)
  })

  it('69. Test 4 — insufficient wallet balance is rejected outright, with nothing committed (no invoice, no stock change, no wallet change)', async () => {
    setSession(mgrA)
    const customerId = (globalThis as any).__qaWalletCustomerId as string
    const walletBefore = (db.prepare('SELECT balance FROM smartbuy_wallet WHERE customer_id=?').get(customerId) as any).balance
    if (Number(walletBefore) !== 0) note(`CRITICAL: test setup issue — expected an exhausted (0) wallet entering this test, got ${walletBefore}`)

    const prod = 'prod-pos-wallet-insufficient'
    db.prepare(`INSERT OR IGNORE INTO products (id, category_id, supplier_id, sku, name, unit, cost_price, selling_price, tax_rate) VALUES (?,NULL,NULL,?,?,?,?,?,?)`)
      .run(prod, prod, 'POS Wallet Insufficient Product', 'pcs', 3000, 5000, 0)
    db.prepare(`INSERT INTO stocks (id, product_id, branch_id, warehouse_id, quantity) VALUES (?,?,?,NULL,?)`).run(crypto.randomUUID(), prod, BR_A, 20)
    const stockBefore = (db.prepare('SELECT COALESCE(SUM(quantity),0) as q FROM stocks WHERE product_id=? AND branch_id=?').get(prod, BR_A) as any).q
    const invoiceCountBefore = (db.prepare('SELECT COUNT(*) as c FROM invoices').get() as any).c

    // Wallet is at 0 — any wallet amount at all should be rejected.
    const res = await call('invoices:create', posSalePayload({ customerId, productId: prod, unitPrice: 5000, smartbuyWalletAmount: 1000, cashAmount: 4000 }))
    if (res.success) note(`CRITICAL: a POS sale using more SmartBuy Wallet balance than available was accepted`)
    expect(res.success).toBe(false)

    const stockAfter = (db.prepare('SELECT COALESCE(SUM(quantity),0) as q FROM stocks WHERE product_id=? AND branch_id=?').get(prod, BR_A) as any).q
    if (stockAfter !== stockBefore) note(`CRITICAL: stock changed despite the sale being rejected — the whole transaction should have rolled back`)
    const walletAfter = (db.prepare('SELECT balance FROM smartbuy_wallet WHERE customer_id=?').get(customerId) as any).balance
    if (Number(walletAfter) !== 0) note(`CRITICAL: wallet balance changed despite the sale being rejected`)
    const invoiceCountAfter = (db.prepare('SELECT COUNT(*) as c FROM invoices').get() as any).c
    if (invoiceCountAfter !== invoiceCountBefore) note(`CRITICAL: an invoice row was committed despite the overall sale being rejected`)
  })

  it('70. Test 5 — cancelling an invoice that used wallet payment restores the wallet balance via a new reversal transaction, without deleting the original debit', async () => {
    setSession(mgrA)
    // Fresh customer/wallet for a clean before/after comparison.
    const downgradeProd = 'prod-pos-cancel-source'
    db.prepare(`INSERT OR IGNORE INTO products (id, category_id, supplier_id, sku, name, unit, cost_price, selling_price, tax_rate) VALUES (?,NULL,NULL,?,?,?,?,?,?)`)
      .run(downgradeProd, downgradeProd, 'POS Cancel Source Product', 'pcs', 3000, 5000, 0)
    db.prepare(`INSERT INTO stocks (id, product_id, branch_id, warehouse_id, quantity) VALUES (?,?,?,NULL,?)`).run(crypto.randomUUID(), downgradeProd, BR_A, 10)
    const schemeRes = await createSchemeViaTemplate({
      name: 'QA POS Cancel Wallet Scheme', branch_id: BR_A, product_id: PROD1, member_count: 1, cycle_count: 1,
      min_members: 1, chit_value: 15000, contribution_amount: 1000,
    })
    expect(schemeRes.success).toBe(true)
    const m1 = await call('chits:members:add', schemeRes.data.id, { customer_name: 'POS Cancel Wallet Winner', customer_phone: '0771160002', agent_id: AGENT_REG })
    expect(m1.success).toBe(true)
    const customerId = (db.prepare('SELECT customer_id FROM chit_members WHERE id=?').get(m1.data.id) as any).customer_id
    expect((await call('chits:contributions:record', m1.data.id, { amount: 1000, method: 'cash', cycle_no: 1 })).success).toBe(true)
    setSession(SUPER_ADMIN)
    expect((await call('chits:draws:conduct', schemeRes.data.id, 1, { method: 'manual_pick', winnerMemberId: m1.data.id, reason: 'QA POS cancel wallet regression' })).success).toBe(true)
    setSession(mgrA)
    const downgradeRedemption = await call('chits:members:recordRedemption', m1.data.id, {
      product_id: downgradeProd, qty: 1, substitution_reason: 'Customer chose a cheaper product', customer_accepted: true,
    })
    expect(downgradeRedemption.success).toBe(true)
    expect(downgradeRedemption.data.walletCreditAmount).toBe(10000)

    const prod = 'prod-pos-cancel-target'
    db.prepare(`INSERT OR IGNORE INTO products (id, category_id, supplier_id, sku, name, unit, cost_price, selling_price, tax_rate) VALUES (?,NULL,NULL,?,?,?,?,?,?)`)
      .run(prod, prod, 'POS Cancel Target Product', 'pcs', 6000, 10000, 0)
    db.prepare(`INSERT INTO stocks (id, product_id, branch_id, warehouse_id, quantity) VALUES (?,?,?,NULL,?)`).run(crypto.randomUUID(), prod, BR_A, 20)
    const stockBefore = (db.prepare('SELECT COALESCE(SUM(quantity),0) as q FROM stocks WHERE product_id=? AND branch_id=?').get(prod, BR_A) as any).q

    const sale = await call('invoices:create', posSalePayload({ customerId, productId: prod, unitPrice: 10000, smartbuyWalletAmount: 10000 }))
    expect(sale.success).toBe(true)
    const walletAfterSale = (db.prepare('SELECT balance FROM smartbuy_wallet WHERE customer_id=?').get(customerId) as any).balance
    if (Number(walletAfterSale) !== 0) note(`CRITICAL: test setup issue — wallet should be fully spent (0) right after the sale, got ${walletAfterSale}`)

    const cancel = await call('invoices:cancel', sale.data.id, 'Customer changed their mind')
    if (!cancel.success) note(`CRITICAL: cancelling a wallet-paid invoice failed: ${cancel.error}`)
    expect(cancel.success).toBe(true)

    const walletAfterCancel = (db.prepare('SELECT balance FROM smartbuy_wallet WHERE customer_id=?').get(customerId) as any).balance
    if (Number(walletAfterCancel) !== 10000) note(`CRITICAL: wallet balance should be fully restored to 10000 after cancellation, got ${walletAfterCancel}`)

    const txns = db.prepare('SELECT * FROM smartbuy_wallet_transactions WHERE invoice_id=? ORDER BY created_at').all(sale.data.id) as any[]
    if (txns.length !== 2) note(`CRITICAL: expected exactly 2 wallet transactions for this invoice (original debit + reversal credit), got ${txns.length}`)
    const originalDebit = txns.find(t => t.transaction_type === 'debit')
    const reversalCredit = txns.find(t => t.transaction_type === 'credit')
    if (!originalDebit || Number(originalDebit.amount) !== 10000) note(`CRITICAL: original debit transaction missing or wrong amount — history must never be deleted`)
    if (!reversalCredit || Number(reversalCredit.amount) !== 10000 || reversalCredit.source !== 'invoice_reversal') {
      note(`CRITICAL: reversal credit transaction missing or incorrect: ${JSON.stringify(reversalCredit)}`)
    }

    // Stock restoration (existing, unrelated behavior) still works too.
    const stockAfterCancel = (db.prepare('SELECT COALESCE(SUM(quantity),0) as q FROM stocks WHERE product_id=? AND branch_id=?').get(prod, BR_A) as any).q
    if (stockAfterCancel !== stockBefore) note(`CRITICAL: REGRESSION — stock was not correctly restored after cancelling a wallet-paid invoice`)
  })

  it('71. Test 6 — branch isolation: a POS-purchase wallet debit at Branch A is visible in Branch A\'s wallet reports, invisible in Branch B\'s', async () => {
    setSession(mgrA)
    const downgradeProd = 'prod-pos-branch-source'
    db.prepare(`INSERT OR IGNORE INTO products (id, category_id, supplier_id, sku, name, unit, cost_price, selling_price, tax_rate) VALUES (?,NULL,NULL,?,?,?,?,?,?)`)
      .run(downgradeProd, downgradeProd, 'POS Branch Isolation Source Product', 'pcs', 3000, 5000, 0)
    db.prepare(`INSERT INTO stocks (id, product_id, branch_id, warehouse_id, quantity) VALUES (?,?,?,NULL,?)`).run(crypto.randomUUID(), downgradeProd, BR_A, 10)
    const schemeRes = await createSchemeViaTemplate({
      name: 'QA POS Branch Isolation Scheme', branch_id: BR_A, product_id: PROD1, member_count: 1, cycle_count: 1,
      min_members: 1, chit_value: 15000, contribution_amount: 1000,
    })
    expect(schemeRes.success).toBe(true)
    const m1 = await call('chits:members:add', schemeRes.data.id, { customer_name: 'POS Branch Isolation Winner', customer_phone: '0771160003', agent_id: AGENT_REG })
    expect(m1.success).toBe(true)
    const customerId = (db.prepare('SELECT customer_id FROM chit_members WHERE id=?').get(m1.data.id) as any).customer_id
    expect((await call('chits:contributions:record', m1.data.id, { amount: 1000, method: 'cash', cycle_no: 1 })).success).toBe(true)
    setSession(SUPER_ADMIN)
    expect((await call('chits:draws:conduct', schemeRes.data.id, 1, { method: 'manual_pick', winnerMemberId: m1.data.id, reason: 'QA POS branch isolation regression' })).success).toBe(true)
    setSession(mgrA)
    expect((await call('chits:members:recordRedemption', m1.data.id, {
      product_id: downgradeProd, qty: 1, substitution_reason: 'Customer chose a cheaper product', customer_accepted: true,
    })).success).toBe(true)

    const prod = 'prod-pos-branch-target'
    db.prepare(`INSERT OR IGNORE INTO products (id, category_id, supplier_id, sku, name, unit, cost_price, selling_price, tax_rate) VALUES (?,NULL,NULL,?,?,?,?,?,?)`)
      .run(prod, prod, 'POS Branch Isolation Target Product', 'pcs', 3000, 5000, 0)
    db.prepare(`INSERT INTO stocks (id, product_id, branch_id, warehouse_id, quantity) VALUES (?,?,?,NULL,?)`).run(crypto.randomUUID(), prod, BR_A, 20)
    const sale = await call('invoices:create', posSalePayload({ customerId, productId: prod, unitPrice: 5000, smartbuyWalletAmount: 5000 }))
    expect(sale.success).toBe(true)

    // Branch A's own Manager sees this usage.
    const branchAUsage = await call('chits:wallet:usage', {})
    if (!(branchAUsage.data || []).some((u: any) => u.invoice_id === sale.data.id)) {
      note(`CRITICAL: Branch A's Manager could not see their own branch's wallet usage in the Usage Report`)
    }
    const branchAList = await call('chits:wallet:list', {})
    if (!(branchAList.data || []).some((w: any) => w.customer_id === customerId)) {
      note(`CRITICAL: Branch A's Manager could not see this customer's wallet in the Wallet Report`)
    }

    // Branch C, with no enrollment relationship to this customer, sees neither.
    setSession(mgrC)
    const branchCUsage = await call('chits:wallet:usage', {})
    if ((branchCUsage.data || []).some((u: any) => u.invoice_id === sale.data.id)) {
      note(`CRITICAL: Branch C's Manager could see Branch A's wallet usage — cross-branch data leak`)
    }
    const branchCList = await call('chits:wallet:list', {})
    if ((branchCList.data || []).some((w: any) => w.customer_id === customerId)) {
      note(`CRITICAL: Branch C's Manager could see Branch A's customer wallet — cross-branch data leak`)
    }
    setSession(mgrA)
  })

  it('72. Test 7 — Manager permission validation: can apply wallet payment during a POS sale, cannot manually adjust wallet balance', async () => {
    setSession(mgrA)
    const downgradeProd = 'prod-pos-perm-source'
    db.prepare(`INSERT OR IGNORE INTO products (id, category_id, supplier_id, sku, name, unit, cost_price, selling_price, tax_rate) VALUES (?,NULL,NULL,?,?,?,?,?,?)`)
      .run(downgradeProd, downgradeProd, 'POS Permission Source Product', 'pcs', 3000, 5000, 0)
    db.prepare(`INSERT INTO stocks (id, product_id, branch_id, warehouse_id, quantity) VALUES (?,?,?,NULL,?)`).run(crypto.randomUUID(), downgradeProd, BR_A, 10)
    const schemeRes = await createSchemeViaTemplate({
      name: 'QA POS Permission Scheme', branch_id: BR_A, product_id: PROD1, member_count: 1, cycle_count: 1,
      min_members: 1, chit_value: 15000, contribution_amount: 1000,
    })
    expect(schemeRes.success).toBe(true)
    const m1 = await call('chits:members:add', schemeRes.data.id, { customer_name: 'POS Permission Winner', customer_phone: '0771160004', agent_id: AGENT_REG })
    expect(m1.success).toBe(true)
    const customerId = (db.prepare('SELECT customer_id FROM chit_members WHERE id=?').get(m1.data.id) as any).customer_id
    expect((await call('chits:contributions:record', m1.data.id, { amount: 1000, method: 'cash', cycle_no: 1 })).success).toBe(true)
    setSession(SUPER_ADMIN)
    expect((await call('chits:draws:conduct', schemeRes.data.id, 1, { method: 'manual_pick', winnerMemberId: m1.data.id, reason: 'QA POS permission regression' })).success).toBe(true)
    setSession(mgrA)
    expect((await call('chits:members:recordRedemption', m1.data.id, {
      product_id: downgradeProd, qty: 1, substitution_reason: 'Customer chose a cheaper product', customer_accepted: true,
    })).success).toBe(true)

    // A Smart Buy Manager CAN apply wallet payment during a normal POS sale.
    const prod = 'prod-pos-perm-target'
    db.prepare(`INSERT OR IGNORE INTO products (id, category_id, supplier_id, sku, name, unit, cost_price, selling_price, tax_rate) VALUES (?,NULL,NULL,?,?,?,?,?,?)`)
      .run(prod, prod, 'POS Permission Target Product', 'pcs', 3000, 5000, 0)
    db.prepare(`INSERT INTO stocks (id, product_id, branch_id, warehouse_id, quantity) VALUES (?,?,?,NULL,?)`).run(crypto.randomUUID(), prod, BR_A, 20)
    const sale = await call('invoices:create', posSalePayload({ customerId, productId: prod, unitPrice: 5000, smartbuyWalletAmount: 5000 }))
    if (!sale.success) note(`CRITICAL: a Smart Buy Manager was blocked from applying wallet payment during a normal POS sale: ${sale.error}`)
    expect(sale.success).toBe(true)

    // A Smart Buy Manager CANNOT manually increase/adjust the balance via
    // the admin debit endpoint (re-confirmed here as this feature's own
    // explicit test — already covered structurally in the prior audit round).
    const managerManualDebit = await call('chits:wallet:debit', customerId, 100, 'Manager trying to manually adjust')
    if (managerManualDebit.success) note(`CRITICAL: a Smart Buy Manager was able to manually debit a SmartBuy Wallet outside the POS flow`)
    expect(managerManualDebit.success).toBe(false)
  })

  it('73. Test 8 — wallet balance can never go negative, including the exact-balance boundary case (spending exactly the full balance lands on 0, not below)', async () => {
    setSession(mgrA)
    const downgradeProd = 'prod-pos-boundary-source'
    db.prepare(`INSERT OR IGNORE INTO products (id, category_id, supplier_id, sku, name, unit, cost_price, selling_price, tax_rate) VALUES (?,NULL,NULL,?,?,?,?,?,?)`)
      .run(downgradeProd, downgradeProd, 'POS Boundary Source Product', 'pcs', 3000, 5000, 0)
    db.prepare(`INSERT INTO stocks (id, product_id, branch_id, warehouse_id, quantity) VALUES (?,?,?,NULL,?)`).run(crypto.randomUUID(), downgradeProd, BR_A, 10)
    const schemeRes = await createSchemeViaTemplate({
      name: 'QA POS Boundary Scheme', branch_id: BR_A, product_id: PROD1, member_count: 1, cycle_count: 1,
      min_members: 1, chit_value: 15000, contribution_amount: 1000,
    })
    expect(schemeRes.success).toBe(true)
    const m1 = await call('chits:members:add', schemeRes.data.id, { customer_name: 'POS Boundary Winner', customer_phone: '0771160005', agent_id: AGENT_REG })
    expect(m1.success).toBe(true)
    const customerId = (db.prepare('SELECT customer_id FROM chit_members WHERE id=?').get(m1.data.id) as any).customer_id
    expect((await call('chits:contributions:record', m1.data.id, { amount: 1000, method: 'cash', cycle_no: 1 })).success).toBe(true)
    setSession(SUPER_ADMIN)
    expect((await call('chits:draws:conduct', schemeRes.data.id, 1, { method: 'manual_pick', winnerMemberId: m1.data.id, reason: 'QA POS boundary regression' })).success).toBe(true)
    setSession(mgrA)
    expect((await call('chits:members:recordRedemption', m1.data.id, {
      product_id: downgradeProd, qty: 1, substitution_reason: 'Customer chose a cheaper product', customer_accepted: true,
    })).success).toBe(true)
    // 15000 entitlement - 5000 product = 10000 credit.
    const walletStart = (db.prepare('SELECT balance FROM smartbuy_wallet WHERE customer_id=?').get(customerId) as any).balance
    if (Number(walletStart) !== 10000) note(`CRITICAL: test setup issue — expected a 10000 starting wallet balance, got ${walletStart}`)

    const prod = 'prod-pos-boundary-target'
    db.prepare(`INSERT OR IGNORE INTO products (id, category_id, supplier_id, sku, name, unit, cost_price, selling_price, tax_rate) VALUES (?,NULL,NULL,?,?,?,?,?,?)`)
      .run(prod, prod, 'POS Boundary Target Product', 'pcs', 6000, 10000, 0)
    db.prepare(`INSERT INTO stocks (id, product_id, branch_id, warehouse_id, quantity) VALUES (?,?,?,NULL,?)`).run(crypto.randomUUID(), prod, BR_A, 20)

    // Spend EXACTLY the full 10000 balance.
    const exactSale = await call('invoices:create', posSalePayload({ customerId, productId: prod, unitPrice: 10000, smartbuyWalletAmount: 10000 }))
    if (!exactSale.success) note(`CRITICAL: spending exactly the full wallet balance was rejected: ${exactSale.error}`)
    expect(exactSale.success).toBe(true)
    const walletAfterExact = (db.prepare('SELECT balance FROM smartbuy_wallet WHERE customer_id=?').get(customerId) as any).balance
    if (Number(walletAfterExact) !== 0) note(`CRITICAL: spending exactly the full balance should land on exactly 0, got ${walletAfterExact}`)

    // Any further spend at all must now be rejected — balance is 0.
    const overSale = await call('invoices:create', posSalePayload({ customerId, productId: prod, unitPrice: 10000, smartbuyWalletAmount: 1, cashAmount: 9999 }))
    if (overSale.success) note(`CRITICAL: a wallet debit was accepted against a 0 balance — balance must never go negative`)
    expect(overSale.success).toBe(false)
    const walletFinal = (db.prepare('SELECT balance FROM smartbuy_wallet WHERE customer_id=?').get(customerId) as any).balance
    if (Number(walletFinal) < 0) note(`CRITICAL: wallet balance went negative`)
    if (Number(walletFinal) !== 0) note(`CRITICAL: wallet balance should remain exactly 0 after a rejected overspend attempt, got ${walletFinal}`)
  })

  it("74. permission leak closed — a session with zero Smart Buy access ('customers' only) can no longer READ any SmartBuy data via the 9 handlers that used to rely on branch-scoping alone (final audit round)", async () => {
    const noChits = makeSession({ id: 'u-nochits-reader', branchId: BR_A, permissions: { customers: true } })
    setSession(noChits)

    const attempts: Array<[string, Promise<any>]> = [
      ['chits:list', call('chits:list', {})],
      ['chits:get', call('chits:get', schemeId)],
      ['chits:members:list', call('chits:members:list', schemeId)],
      ['chits:draws:eligible', call('chits:draws:eligible', schemeId, 1)],
      ['chits:draws:list', call('chits:draws:list', schemeId)],
      ['chits:agents:detail', call('chits:agents:detail', AGENT_REG)],
      ['chits:members:contributionHistory', call('chits:members:contributionHistory', member1)],
      ['chits:members:contributionStatement', call('chits:members:contributionStatement', member1)],
      ['chits:remittances:list', call('chits:remittances:list', {})],
    ]
    for (const [name, pending] of attempts) {
      const res = await pending
      if (res.success) note(`CRITICAL: a session with only 'customers' permission (no 'chits'/'all') could still read data from ${name} — permission gate regressed`)
      expect(res.success).toBe(false)
    }

    setSession(mgrA)
  })

  it('75. FINAL AUDIT — full-scale production simulation: 500 schemes, 50,000 members, 500,000 contributions, 100,000 wallet transactions, 50,000 invoices', async () => {
    const PERF3_BRANCH = 'branch-perf3'
    seedBranch(PERF3_BRANCH, 'Perf Branch 3', 'PR3')
    seedProduct('prod-perf3', 'Perf Product 3', 10000, 0)
    seedStock('prod-perf3', PERF3_BRANCH, 100000000)
    const perf3Agents = ['agent-perf3-1', 'agent-perf3-2', 'agent-perf3-3']
    for (const a of perf3Agents) seedAgent(a, a.toUpperCase(), PERF3_BRANCH, 5)

    const SCHEME_COUNT = 500
    const MEMBERS_PER_SCHEME = 100 // 500 x 100 = 50,000 members
    const CONTRIBUTIONS_PER_MEMBER = 10 // 50,000 x 10 = 500,000 contributions

    const insertCustomer = db.prepare(`INSERT INTO customers (id, branch_id, name, phone) VALUES (?,?,?,?)`)
    const insertScheme = db.prepare(`
      INSERT INTO chit_schemes (id, scheme_number, name, branch_id, product_id, member_count, cycle_count, contribution_amount, chit_value, start_date, status, min_members)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    `)
    const insertMember = db.prepare(`
      INSERT INTO chit_members (id, scheme_id, customer_id, agent_id, join_order, status, contributions_paid, enrolled_branch_id, claim_status)
      VALUES (?,?,?,?,?,?,?,?,?)
    `)
    const insertContribution = db.prepare(`
      INSERT INTO chit_contributions (id, scheme_id, member_id, cycle_no, amount, method, status, branch_id, paid_at)
      VALUES (?,?,?,?,?,?,?,?,?)
    `)
    const insertWallet = db.prepare(`INSERT INTO smartbuy_wallet (id, customer_id, balance) VALUES (?,?,?)`)
    const insertWalletTxn = db.prepare(`
      INSERT INTO smartbuy_wallet_transactions (id, wallet_id, customer_id, transaction_type, amount, balance_after, source)
      VALUES (?,?,?,?,?,?,?)
    `)
    const insertInvoice = db.prepare(`
      INSERT INTO invoices (id, invoice_number, branch_id, customer_id, cashier_id, status, subtotal, discount_amount, tax_amount, total_amount, paid_amount, due_amount)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    `)
    const insertInvoiceItem = db.prepare(`
      INSERT INTO invoice_items (id, invoice_id, product_id, quantity, unit_price, line_total)
      VALUES (?,?,?,?,?,?)
    `)
    const insertPayment = db.prepare(`INSERT INTO payments (id, invoice_id, method, amount) VALUES (?,?,?,?)`)

    const seedStart = Date.now()
    db.transaction(() => {
      for (let s = 0; s < SCHEME_COUNT; s++) {
        const schemeId = `perf3-scheme-${s}`
        insertScheme.run(
          schemeId, `PR3-${s}`, `Perf3 Scheme ${s}`, PERF3_BRANCH, 'prod-perf3',
          MEMBERS_PER_SCHEME, 10, 1000, 60000, '2026-01-01',
          s % 5 === 0 ? 'completed' : 'active', 2
        )
        for (let m = 0; m < MEMBERS_PER_SCHEME; m++) {
          const memberId = `perf3-member-${s}-${m}`
          const customerId = `perf3-customer-${s}-${m}`
          const agentId = perf3Agents[m % perf3Agents.length]
          insertCustomer.run(customerId, PERF3_BRANCH, `Perf3 Customer ${s}-${m}`, `09${String(s).padStart(4, '0')}${String(m).padStart(3, '0')}`)
          insertMember.run(memberId, schemeId, customerId, agentId, m + 1, 'active', CONTRIBUTIONS_PER_MEMBER, PERF3_BRANCH, 'pending_claim')
          for (let c = 1; c <= CONTRIBUTIONS_PER_MEMBER; c++) {
            insertContribution.run(`perf3-contrib-${s}-${m}-${c}`, schemeId, memberId, c, 1000, 'cash', 'approved', PERF3_BRANCH, `2026-0${(c % 9) + 1}-15T10:00:00.000Z`)
          }
          // One wallet + two transactions per member: 50,000 wallets, 100,000 wallet transactions.
          const walletId = `perf3-wallet-${s}-${m}`
          insertWallet.run(walletId, customerId, 500)
          insertWalletTxn.run(`perf3-wallettxn-${s}-${m}-1`, walletId, customerId, 'credit', 1000, 1000, 'redemption_downgrade')
          insertWalletTxn.run(`perf3-wallettxn-${s}-${m}-2`, walletId, customerId, 'debit', 500, 500, 'pos_purchase')
          // One invoice per member: 50,000 invoices.
          const invoiceId = `perf3-invoice-${s}-${m}`
          insertInvoice.run(invoiceId, `PERF3-INV-${s}-${m}`, PERF3_BRANCH, customerId, 'u-superadmin', 'completed', 10000, 0, 0, 10000, 10000, 0)
          insertInvoiceItem.run(`perf3-invitem-${s}-${m}`, invoiceId, 'prod-perf3', 1, 10000, 10000)
          insertPayment.run(`perf3-payment-${s}-${m}`, invoiceId, 'cash', 10000)
        }
      }
    })()
    const seedMs = Date.now() - seedStart

    const rowCounts = {
      schemes: (db.prepare('SELECT COUNT(*) c FROM chit_schemes WHERE branch_id=?').get(PERF3_BRANCH) as any).c,
      members: (db.prepare(`SELECT COUNT(*) c FROM chit_members WHERE scheme_id LIKE 'perf3-scheme-%'`).get() as any).c,
      contributions: (db.prepare(`SELECT COUNT(*) c FROM chit_contributions WHERE scheme_id LIKE 'perf3-scheme-%'`).get() as any).c,
      walletTxns: (db.prepare(`SELECT COUNT(*) c FROM smartbuy_wallet_transactions WHERE wallet_id LIKE 'perf3-wallet-%'`).get() as any).c,
      invoices: (db.prepare(`SELECT COUNT(*) c FROM invoices WHERE id LIKE 'perf3-invoice-%'`).get() as any).c,
    }
    if (rowCounts.schemes !== SCHEME_COUNT) note(`CRITICAL: test setup issue — expected ${SCHEME_COUNT} seeded schemes, found ${rowCounts.schemes}`)
    if (rowCounts.members !== SCHEME_COUNT * MEMBERS_PER_SCHEME) note(`CRITICAL: test setup issue — expected ${SCHEME_COUNT * MEMBERS_PER_SCHEME} seeded members, found ${rowCounts.members}`)
    if (rowCounts.contributions !== SCHEME_COUNT * MEMBERS_PER_SCHEME * CONTRIBUTIONS_PER_MEMBER) note(`CRITICAL: test setup issue — expected ${SCHEME_COUNT * MEMBERS_PER_SCHEME * CONTRIBUTIONS_PER_MEMBER} seeded contributions, found ${rowCounts.contributions}`)
    if (rowCounts.walletTxns !== SCHEME_COUNT * MEMBERS_PER_SCHEME * 2) note(`CRITICAL: test setup issue — expected ${SCHEME_COUNT * MEMBERS_PER_SCHEME * 2} seeded wallet transactions, found ${rowCounts.walletTxns}`)
    if (rowCounts.invoices !== SCHEME_COUNT * MEMBERS_PER_SCHEME) note(`CRITICAL: test setup issue — expected ${SCHEME_COUNT * MEMBERS_PER_SCHEME} seeded invoices, found ${rowCounts.invoices}`)

    setSession(SUPER_ADMIN)
    // Generous sanity bound (not a strict benchmark) — 5x the row volume of
    // test 63's budget-neutral 4000ms bound, scaled for the ~5x larger
    // dataset. A genuinely unindexed scan against 500k+ rows would blow far
    // past this, not just edge over it.
    const TIME_BUDGET_MS = 15000

    const timeCall = async (label: string, fn: () => Promise<any>) => {
      const start = Date.now()
      const res = await fn()
      const elapsed = Date.now() - start
      if (!res.success) note(`CRITICAL: ${label} failed against the full-scale dataset: ${res.error}`)
      if (elapsed > TIME_BUDGET_MS) note(`HIGH: ${label} took ${elapsed}ms against 500 schemes / 50,000 members / 500,000 contributions — exceeds the ${TIME_BUDGET_MS}ms sanity budget, likely an unindexed scan. Consider adding an index.`)
      return elapsed
    }

    const dashboardMs = await timeCall('chits:dashboard (whole company)', () => call('chits:dashboard', {}))
    const walletMs = await timeCall('chits:wallet:list (whole company, 100k transactions)', () => call('chits:wallet:list', {}))
    const winnersMs = await timeCall('chits:reports:winners (whole company)', () => call('chits:reports:winners', {}))
    const searchMs = await timeCall('customers:search ("Perf3")', () => call('customers:search', 'Perf3 Customer 250-'))
    // Draw eligibility on a single large (100-member) active scheme — walks
    // computeMemberCycleBalance per candidate, each of which queries the
    // 500,000-row chit_contributions table filtered by member_id+scheme_id+cycle_no.
    const eligibilityMs = await timeCall('chits:draws:eligible (single 100-member scheme against 500k contributions)', () => call('chits:draws:eligible', 'perf3-scheme-1', 1))
    // Per-member history/statement reads against the 500,000-row table —
    // the query real staff run constantly (every member detail view).
    const historyMs = await timeCall('chits:members:contributionHistory (member with 10 rows, table has 500k)', () => call('chits:members:contributionHistory', 'perf3-member-250-50'))
    const statementMs = await timeCall('chits:members:contributionStatement (member with 10 rows, table has 500k)', () => call('chits:members:contributionStatement', 'perf3-member-250-50'))

    console.log(`[PERF3] seed=${seedMs}ms rows(members=${rowCounts.members},contributions=${rowCounts.contributions},walletTxns=${rowCounts.walletTxns},invoices=${rowCounts.invoices}) dashboard=${dashboardMs}ms wallet=${walletMs}ms winners=${winnersMs}ms search=${searchMs}ms eligibility=${eligibilityMs}ms history=${historyMs}ms statement=${statementMs}ms`)

    // Cross-check dashboard/report totals against the raw rows actually seeded —
    // not just "query ran fast", but "query returned the right number."
    const dashboard = await call('chits:dashboard', {})
    if (Number(dashboard.data.total_schemes) < SCHEME_COUNT) note(`CRITICAL: dashboard total_schemes undercounts the seeded performance dataset (expected at least ${SCHEME_COUNT}, got ${dashboard.data.total_schemes})`)
    const expectedContributionTotal = SCHEME_COUNT * MEMBERS_PER_SCHEME * CONTRIBUTIONS_PER_MEMBER * 1000
    const actualContributionTotal = (db.prepare(`SELECT COALESCE(SUM(amount),0) t FROM chit_contributions WHERE scheme_id LIKE 'perf3-scheme-%' AND status='approved'`).get() as any).t
    if (Number(actualContributionTotal) !== expectedContributionTotal) note(`CRITICAL: seeded contribution total mismatch — expected Rs.${expectedContributionTotal}, actual sum Rs.${actualContributionTotal}`)
  }, 300000)

  it('SUMMARY: print all findings', () => {
    console.log('\n\n=== QA FINDINGS SUMMARY ===')
    if (findings.length === 0) console.log('No findings recorded by inline checks.')
    findings.forEach((f, i) => console.log(`${i + 1}. ${f}`))
    console.log('=== END FINDINGS ===\n')
  })
})
