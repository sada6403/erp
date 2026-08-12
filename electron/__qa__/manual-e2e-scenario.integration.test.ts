// Manual E2E QA scenario — SmartBuy Cycle Payment Gating / Manual-Only Draw
// / Payment Reminders workflow, run against the REAL better-sqlite3 database
// and REAL IPC handlers (same setup pattern as smartbuy.integration.test.ts),
// calling the exact channels the renderer UI calls (ConductDrawModal,
// CyclePaymentsTab, PaymentRemindersPage, SendReminderModal), in the same
// order a person clicking through the app would trigger them.
//
// This is a throwaway verification artifact for one QA session, not part of
// the app's permanent behavior — same rebuild-for-plain-Node prerequisite as
// the main QA harness (see that file's header comment).
import { beforeAll, describe, it, expect, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import crypto from 'crypto'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smartbuy-e2e-'))
vi.mock('electron', () => ({
  app: { getPath: () => tmpDir, isPackaged: false, whenReady: () => Promise.resolve(), on: () => {} },
  ipcMain: { handle: () => {}, on: () => {} },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }), showSaveDialog: async () => ({ canceled: true, filePath: undefined }) },
  net: { request: () => ({ on: () => {}, write: () => {}, end: () => {}, setHeader: () => {} }) },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() },
  BrowserWindow: class {},
  shell: { openExternal: async () => {} },
  protocol: { registerFileProtocol: () => {}, handle: () => {} },
  Menu: { setApplicationMenu: () => {}, buildFromTemplate: () => ({}) },
}))

const sharedStoreData: Record<string, unknown> = {}
vi.mock('electron-store', () => {
  class FakeStore {
    get(key: string, def?: unknown) { return key in sharedStoreData ? sharedStoreData[key] : def }
    set(key: string, val: unknown) { sharedStoreData[key] = val }
    delete(key: string) { delete sharedStoreData[key] }
  }
  return { default: FakeStore }
})

type Handler = (event: unknown, ...args: unknown[]) => Promise<unknown> | unknown
const registry = new Map<string, Handler>()
const fakeIpcMain = { handle: (channel: string, fn: Handler) => { registry.set(channel, fn) }, on: () => {} } as unknown as import('electron').IpcMain

async function call(channel: string, ...args: unknown[]): Promise<any> {
  const fn = registry.get(channel)
  if (!fn) throw new Error(`No handler registered for channel: ${channel}`)
  return fn({} as any, ...args)
}
function setSession(session: Record<string, unknown> | null) { sharedStoreData.auth_user = session }
function makeSession(opts: { id: string; branchId?: string | null; permissions: Record<string, unknown> }) {
  return {
    id: opts.id, name: opts.id, branch_id: opts.branchId ?? null,
    role: { permissions: opts.permissions },
    scope: { level: opts.permissions.all ? 'owner' : 'branch', branchId: opts.branchId ?? null, agentId: null },
  }
}
const SUPER_ADMIN = makeSession({ id: 'u-e2e-superadmin', permissions: { all: true } })

let db: import('better-sqlite3').Database
const log: string[] = []
function step(n: string, msg: string) { const line = `[STEP ${n}] ${msg}`; log.push(line); console.log(line) }
function check(n: string, desc: string, pass: boolean, detail?: string) {
  const line = `  [${pass ? 'PASS' : 'FAIL'}] ${desc}${detail ? ` — ${detail}` : ''}`
  log.push(line); console.log(line)
  void n
}

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

  db.prepare(`INSERT OR IGNORE INTO branches (id, name, code, address, phone, is_active) VALUES (?,?,?,?,?,1)`)
    .run('e2e-branch', 'E2E Branch', 'E2E', 'addr', '0000000000')
  db.prepare(`INSERT OR IGNORE INTO products (id, category_id, supplier_id, sku, name, unit, cost_price, selling_price, tax_rate) VALUES (?,NULL,NULL,?,?,?,?,?,0)`)
    .run('e2e-prod', 'e2e-prod', 'E2E Prize TV', 'pcs', 40000, 60000)
  db.prepare(`INSERT INTO stocks (id, product_id, branch_id, warehouse_id, quantity) VALUES (?,?,?,NULL,?)`)
    .run(crypto.randomUUID(), 'e2e-prod', 'e2e-branch', 50)
  db.prepare(`INSERT OR IGNORE INTO agents (id, code, name, branch_id, default_commission_pct, status) VALUES (?,?,?,?,?,'active')`)
    .run('e2e-agent', 'AG-E2E', 'AG-E2E', 'e2e-branch', 5)
  db.prepare(`INSERT OR IGNORE INTO roles (id, name) VALUES ('e2e-role','E2E Role')`).run()
  for (const [id, branch] of [['u-e2e-superadmin', null], ['u-e2e-mgr', 'e2e-branch']] as const) {
    db.prepare(`INSERT OR IGNORE INTO users (id, branch_id, role_id, name, email, password_hash) VALUES (?,?,?,?,?,'x')`)
      .run(id, branch, 'e2e-role', id, `${id}@qa.test`)
  }
})

const mgrA = makeSession({ id: 'u-e2e-mgr', branchId: 'e2e-branch', permissions: { customers: true, chits: true } })

async function createScheme() {
  setSession(SUPER_ADMIN)
  const template = await call('chits:templates:create', {
    scheme_name: 'E2E Manual QA Scheme', monthly_contribution_amount: 5000, duration_months: 4,
    minimum_members: 4, product_value: 60000,
  })
  setSession(mgrA)
  return call('chits:create', {
    name: 'E2E Manual QA Scheme', branch_id: 'e2e-branch', product_id: 'e2e-prod',
    member_count: 4, cycle_count: 4, min_members: 4, chit_value: 60000, contribution_amount: 5000,
    template_id: template.data.id,
  })
}

describe('MANUAL E2E QA SCENARIO — SmartBuy payment gate / manual draw / reminders', () => {
  it('runs the full 19-step scenario', async () => {
    // ── 1. Create/use a test SmartBuy scheme with 4 members ──────────────
    step('1', 'Create scheme with 4 members')
    setSession(mgrA)
    const schemeRes = await createScheme()
    expect(schemeRes.success).toBe(true)
    const schemeId = schemeRes.data.id

    const names = ['Nimal Perera', 'Kamal Silva', 'Sunil Fernando', 'Ruwan Jayasuriya']
    const phones = ['0770000101', '0770000102', '0770000103', '0770000104']
    const memberIds: string[] = []
    for (let i = 0; i < 4; i++) {
      const r = await call('chits:members:add', schemeId, { customer_name: names[i], customer_phone: phones[i], agent_id: 'e2e-agent' })
      expect(r.success).toBe(true)
      memberIds.push(r.data.id)
    }
    const [m1, m2, m3, m4] = memberIds
    const got = await call('chits:get', schemeId)
    check('1', 'Scheme active after reaching min_members=4', got.data.scheme.status === 'active', `status=${got.data.scheme.status}`)

    // ── 2. Leave one member (m4 / Ruwan) unpaid ───────────────────────────
    step('2', 'Pay cycle 1 for m1/m2/m3, leave m4 (Ruwan Jayasuriya) unpaid')
    for (const mid of [m1, m2, m3]) {
      const pay = await call('chits:contributions:record', mid, { amount: 5000, method: 'cash', cycle_no: 1 })
      expect(pay.success).toBe(true)
    }

    // ── 3. Open the current cycle payment/draw screen ─────────────────────
    // Same two calls ConductDrawModal.load() makes.
    step('3', 'Open cycle 1 payment/draw screen (chits:draws:eligible + chits:cycles:paymentProgress)')
    let progress = (await call('chits:cycles:paymentProgress', schemeId, 1)).data

    // ── 4. Verify paid count / pending member / outstanding / not ready ──
    step('4', 'Verify payment progress and draw-block')
    check('4', 'Paid count is 3 of 4', progress.paidMembers === 3 && progress.totalMembers === 4, `paidMembers=${progress.paidMembers}/${progress.totalMembers}`)
    const pendingNames = (progress.pendingMembers || []).map((p: any) => p.customer_name)
    check('4', 'Pending member (Ruwan Jayasuriya) is clearly shown', pendingNames.includes('Ruwan Jayasuriya'), `pending=${JSON.stringify(pendingNames)}`)
    check('4', 'Outstanding amount is correct (Rs.5000)', Number(progress.totalOutstanding) === 5000, `totalOutstanding=${progress.totalOutstanding}`)
    const isReadyBefore = progress.totalMembers > 0 && progress.paidMembers >= progress.totalMembers
    check('4', 'Cycle is NOT ready for draw', !isReadyBefore)
    setSession(SUPER_ADMIN)
    const blockedDraw = await call('chits:draws:conduct', schemeId, 1, {
      winnerMemberId: m1, reason: 'E2E test — should be blocked, not everyone paid', witnessName: 'W', referenceNumber: 'R1',
    })
    check('4', 'Conduct Draw is blocked with the correct readiness message', blockedDraw.success === false && /not ready for the draw/i.test(String(blockedDraw.error)), `error="${blockedDraw.error}"`)

    // ── 5. Record the missing member's full payment ───────────────────────
    step('5', 'Record m4 (Ruwan) full cycle-1 payment')
    setSession(mgrA)
    const m4Pay = await call('chits:contributions:record', m4, { amount: 5000, method: 'cash', cycle_no: 1 })
    expect(m4Pay.success).toBe(true)

    // ── 6. Verify the cycle immediately becomes Ready for Manual Draw ────
    step('6', 'Re-check payment progress — cycle should now be ready')
    progress = (await call('chits:cycles:paymentProgress', schemeId, 1)).data
    const isReadyAfter = progress.totalMembers > 0 && progress.paidMembers >= progress.totalMembers
    check('6', 'Cycle 1 is now 4/4 paid and Ready for Manual Draw', isReadyAfter, `paidMembers=${progress.paidMembers}/${progress.totalMembers}`)

    // ── 7/8. Open Conduct Manual Draw — verify no random option ──────────
    step('7-8', 'Open Conduct Manual Draw — verify no random/automatic winner option exists')
    const eligibleRes = await call('chits:draws:eligible', schemeId, 1)
    check('7-8', 'chits:draws:eligible returns all 4 members (manual-selection candidate list, no auto-pick)', (eligibleRes.data || []).length === 4, `eligible=${(eligibleRes.data || []).length}`)
    // Source-level confirmation (not re-checked by runtime data): grepped
    // ChitSchemeDetailPage.tsx's ConductDrawModal — the only winner input is
    // a <select> populated from `eligible`, with no "Random"/"Auto" control
    // anywhere in the component. Backend read (chits.ts:2043-2055): `options.
    // method` is not even inspected at runtime any more — the *only* branch
    // is `isFinalCycle ? (settle everyone) : (require options.winnerMemberId
    // to match a real eligible row)`. There is no code path that can pick a
    // winner without an explicit, real, eligible member id — passing
    // method:'random' with no winnerMemberId proves this: it fails the same
    // way any missing-winnerMemberId call would, not via a special
    // "random rejected" branch, because no such branch exists to reject.
    const randomAttempt = await call('chits:draws:conduct', schemeId, 1, { method: 'random', reason: 'attempting a winnerless/auto-pick draw' })
    check('7-8', 'A draw call with no explicit winnerMemberId fails — confirms no automatic/random selection path exists anywhere in the handler', randomAttempt.success === false, `error="${randomAttempt.error}"`)

    // ── 9/10. Only Company Admin can submit — try non-admin first ────────
    step('9-10', 'Attempt draw submission as a non-admin Branch Manager — must be rejected')
    setSession(mgrA)
    const byManager = await call('chits:draws:conduct', schemeId, 1, {
      winnerMemberId: m1, reason: 'Non-admin attempt, should be rejected', witnessName: 'Staff W', referenceNumber: 'REF-1',
    })
    check('9-10', 'Non-admin (Branch Manager, no perms.all) draw submission is rejected', byManager.success === false, `error="${byManager.error}"`)

    // ── 11-13. Company Admin selects an eligible winner, enters reason/
    // witness/reference, confirms the draw ────────────────────────────────
    step('11-13', 'Login as Company Admin, select winner m3 (Sunil Fernando), enter reason/witness/reference, confirm')
    setSession(SUPER_ADMIN)
    const winnerMember = m3
    const draw = await call('chits:draws:conduct', schemeId, 1, {
      winnerMemberId: winnerMember,
      reason: 'Physical lucky draw conducted at branch counter, ticket #7 drawn',
      witnessName: 'Nadeeka (Branch Supervisor)', referenceNumber: 'DRAW-E2E-0001',
    })
    check('11-13', 'Draw with a valid admin session + reason + witness + reference succeeds', draw.success === true, `error=${draw.error}`)

    // ── 14. Verify winner saved, cycle Draw Completed, commission/claim,
    // audit log ─────────────────────────────────────────────────────────
    step('14', 'Verify winner persisted, cycle status, commission/claim, and audit log')
    const drawRow = db.prepare('SELECT * FROM chit_draws WHERE scheme_id=? AND cycle_no=1').get(schemeId) as any
    check('14', 'chit_draws row has correct winner_member_id', drawRow?.winner_member_id === winnerMember, `winner_member_id=${drawRow?.winner_member_id}`)
    check('14', 'chit_draws row persisted witness_name', drawRow?.witness_name === 'Nadeeka (Branch Supervisor)', `witness_name=${drawRow?.witness_name}`)
    check('14', 'chit_draws row persisted reference_number', drawRow?.reference_number === 'DRAW-E2E-0001', `reference_number=${drawRow?.reference_number}`)
    check('14', 'chit_draws row persisted reason/notes', String(drawRow?.notes || '').includes('ticket #7'), `notes=${drawRow?.notes}`)
    const winnerMemberRow = db.prepare('SELECT status, redemption_type FROM chit_members WHERE id=?').get(winnerMember) as any
    check('14', "Winner member flips to status='redeemed', redemption_type='draw'", winnerMemberRow.status === 'redeemed' && winnerMemberRow.redemption_type === 'draw', JSON.stringify(winnerMemberRow))

    const cycle1HasDraw = Boolean(db.prepare('SELECT id FROM chit_draws WHERE scheme_id=? AND cycle_no=1').get(schemeId))
    check('14', "Cycle 1 status is now 'Draw Completed' (a chit_draws row exists for it — same computeCycleStatus rule the UI/reports use)", cycle1HasDraw)

    // Commission/claim logic: award the product to the winner (the real
    // atomic chits:members:recordRedemption path SmartBuyAwardWizardPage
    // uses), confirm invoice + commission ledger.
    setSession(SUPER_ADMIN)
    const ruleRes = await call('commissions:rules:create', {
      name: 'E2E Product Rule', scope: 'product', product_id: 'e2e-prod',
      calculation_type: 'percentage', rate: 10, ownership_model: 'registration', status: 'active',
    })
    expect(ruleRes.success).toBe(true)
    setSession(mgrA)
    const redemption = await call('chits:members:recordRedemption', winnerMember, { product_id: 'e2e-prod', qty: 1 })
    check('14', 'Product award (recordRedemption) succeeds for the drawn winner', redemption.success === true, `error=${redemption.error}`)
    const ledgerRow = db.prepare('SELECT * FROM commission_ledger WHERE member_id=?').get(winnerMember) as any
    check('14', 'Commission ledger row created at redemption (10% of 60000 = 6000)', Boolean(ledgerRow) && Math.abs(Number(ledgerRow?.total_commission || 0) - 6000) < 0.01, `total_commission=${ledgerRow?.total_commission}`)

    const auditRow = db.prepare(`SELECT * FROM audit_logs WHERE action='CHIT_DRAW_CONDUCTED' AND record_id=? ORDER BY created_at DESC LIMIT 1`).get(drawRow?.id) as any
    if (auditRow) {
      const nv = JSON.parse(auditRow.new_values || '{}')
      check('14', 'Audit log entry exists for the draw', true)
      check('14', 'Audit log new_values includes winnerMemberIds', Array.isArray(nv.winnerMemberIds) && nv.winnerMemberIds.includes(winnerMember), JSON.stringify(nv.winnerMemberIds))
      check('14', 'Audit log new_values includes witnessName', nv.witnessName === 'Nadeeka (Branch Supervisor)', nv.witnessName)
      check('14', 'Audit log new_values includes referenceNumber', nv.referenceNumber === 'DRAW-E2E-0001', nv.referenceNumber)
      check('14', 'Audit log new_values includes reason', String(nv.reason || '').includes('ticket #7'), nv.reason)
    } else {
      check('14', 'Audit log entry exists for the draw', false, 'NO audit_logs row found for CHIT_DRAW_CONDUCTED/entity_id=schemeId')
    }

    // ── 15. Try conducting the same cycle again — must be blocked ────────
    step('15', 'Attempt to conduct cycle 1 again — must be blocked')
    const secondDrawAttempt = await call('chits:draws:conduct', schemeId, 1, {
      winnerMemberId: m1, reason: 'Attempting a second draw on an already-drawn cycle', witnessName: 'W', referenceNumber: 'REF-2',
    })
    check('15', 'A second draw on the same cycle is rejected', secondDrawAttempt.success === false, `error="${secondDrawAttempt.error}"`)

    // ── 16. Partial payment leaves a member incomplete ────────────────────
    step('16', 'Partial payment on cycle 2 — member remains incomplete/partial, not paid')
    const partial = await call('chits:contributions:record', m1, { amount: 2000, method: 'cash', cycle_no: 2 })
    expect(partial.success).toBe(true)
    check('16', "Partial payment reports cycleStatus='partial' with balanceDue=3000", partial.data.cycleStatus === 'partial' && Number(partial.data.balanceDue) === 3000, JSON.stringify(partial.data))
    const progressCycle2 = (await call('chits:cycles:paymentProgress', schemeId, 2)).data
    const m1Pending = (progressCycle2.pendingMembers || []).find((p: any) => p.member_id === m1)
    check('16', 'm1 (Nimal) still appears in cycle-2 pendingMembers as partial, not counted as paid', Boolean(m1Pending) && m1Pending.status === 'partial', JSON.stringify(m1Pending))

    // ── 17. Overdue member ─────────────────────────────────────────────
    step('17', 'Overdue member — cycle 2 due date already passed, unpaid member shows status=overdue in the Outstanding report')
    // cycleDueDate anchors off the scheme's own start_date, not "today" —
    // since this scheme was created moments ago, cycle 2's due date
    // naturally falls next month (correctly not overdue yet). To exercise
    // a genuinely overdue member, back-date start_date so cycle 2's due
    // date falls well before today, same as a real scheme that's been
    // running a few months.
    db.prepare(`UPDATE chit_schemes SET late_payment_days=1, start_date=? WHERE id=?`).run('2026-05-01', schemeId)
    const outstandingRes = await call('chits:reports:outstanding', { branchId: 'e2e-branch' })
    expect(outstandingRes.success).toBe(true)
    const m2Row = (outstandingRes.data || []).find((r: any) => r.member_phone === phones[1] && Number(r.cycle_no) === 2)
    check('17', "Unpaid member (Kamal) shows status='overdue' with days_overdue > 0 in chits:reports:outstanding", Boolean(m2Row) && m2Row.status === 'overdue' && Number(m2Row.days_overdue) > 0, JSON.stringify(m2Row))

    // ── 18. Send a payment reminder, verify reminder history ─────────────
    step('18', 'Send a payment reminder to m2 (Kamal) and verify reminder history')
    setSession(mgrA)
    const preview = await call('chits:reminders:preview', m2, 2)
    check('18', 'Reminder preview includes member name and correct balance', String(preview.data?.message || '').includes('Kamal Silva') && Number(preview.data?.balanceDue) === 5000, preview.data?.message)
    const sent = await call('chits:reminders:send', m2, 2)
    check('18', 'Reminder send succeeds', sent.success === true, sent.error)
    const history = await call('chits:reminders:list', { memberId: m2 })
    check('18', 'Reminder history shows exactly 1 entry for m2/cycle2', (history.data || []).length === 1, `count=${(history.data || []).length}`)
    const resend = await call('chits:reminders:send', m2, 2)
    check('18', 'Same-day resend without force is blocked with requiresConfirmation', resend.success === false && resend.requiresConfirmation === true, JSON.stringify(resend))

    // ── 19. Dashboard/report values match actual payment data ────────────
    step('19', 'Cross-check dashboard + reports against actual DB payment data')
    const dashRes = await call('chits:dashboard', { branchId: 'e2e-branch' })
    expect(dashRes.success).toBe(true)
    const realCollected = (db.prepare(`SELECT COALESCE(SUM(amount),0) as s FROM chit_contributions WHERE scheme_id=? AND status='approved'`).get(schemeId) as any).s
    const schemeReport = await call('chits:reports', { schemeId })
    const reportRow = (schemeReport.data || [])[0]
    check('19', 'chits:reports contributions_collected matches the real sum of approved contributions for this scheme', Boolean(reportRow) && Math.abs(Number(reportRow.contributions_collected ?? NaN) - realCollected) < 0.01, `report=${reportRow?.contributions_collected} real=${realCollected}`)
    const winnersReport = await call('chits:reports:winners', { schemeId })
    const winnerReportRow = (winnersReport.data || []).find((w: any) => w.member_id === winnerMember)
    check('19', 'chits:reports:winners includes the real drawn winner with matching cycle_no', Boolean(winnerReportRow) && Number(winnerReportRow.cycle_no) === 1, JSON.stringify(winnerReportRow))

    console.log('\n\n=== MANUAL E2E QA SCENARIO LOG ===')
    log.forEach(l => console.log(l))
    console.log('=== END LOG ===\n')
  })
})
