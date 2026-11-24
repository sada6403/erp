// App cash collections, POS side. Real better-sqlite3 + the real chits IPC handlers (only 'electron' and 'electron-store' are mocked,
// same harness as smartbuy.integration.test.ts).
//   PARITY  the cloud display port (backend/lib/app/collectionMath.ts) agrees with the POS contributionQuote / cycleDueDate.
//   ACCEPT  an app-style row (cash, pending_verification, collected_by_agent_id, agent-scoped receipt number) is accepted by the POS.
//   SETTLE  bulk approval: totals, remittance, late-fee split recomputed by the POS, rejection reason, scope, no double processing.
// The POS helper builds its due date from a local-midnight Date, so the parity block runs with TZ=UTC (see TIMEZONE_AUDIT.md).
import { beforeAll, describe, it, expect, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import crypto from 'crypto'
import { quoteCycle } from '../../backend/lib/app/collectionMath'

process.env.TZ = 'UTC'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smartbuy-qa-'))
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
const setSession = (s: Record<string, unknown> | null) => { sharedStoreData.auth_user = s }
function makeSession(opts: { id: string; branchId?: string | null; permissions: Record<string, unknown> }) {
  return {
    id: opts.id, name: opts.id, branch_id: opts.branchId ?? null,
    role: { permissions: opts.permissions },
    scope: { level: opts.permissions.all ? 'owner' : 'branch', branchId: opts.branchId ?? null, agentId: null },
  }
}
const SUPER_ADMIN = makeSession({ id: 'u-superadmin', permissions: { all: true } })

let db: import('better-sqlite3').Database
beforeAll(async () => {
  const { initDatabase, getDb } = await import('../database')
  await initDatabase()
  db = getDb()
  const { registerChitHandlers } = await import('../ipc/chits')
  registerChitHandlers(fakeIpcMain)
})

async function createScheme(payload: Record<string, unknown>): Promise<any> {
  setSession(SUPER_ADMIN)
  const template = await call('chits:templates:create', {
    scheme_name: String(payload.name), monthly_contribution_amount: payload.contribution_amount,
    duration_months: payload.cycle_count, minimum_members: payload.min_members, product_value: payload.chit_value,
  })
  if (!template.success) return template
  return call('chits:create', { ...payload, template_id: template.data.id })
}
const money = (n: number) => Math.round(n * 100) / 100
let phone = 771300000
const newMember = async (schemeId: string, agentId: string, name: string) => {
  const r = await call('chits:members:add', schemeId, { customer_name: name, customer_phone: `0${phone++}`, agent_id: agentId })
  expect(r.success, JSON.stringify(r)).toBe(true)
  return r.data.id as string
}
/** What the cloud route writes: a pending cash row for an agent's member (id is the app's client event id). */
function insertAppRow(o: { memberId: string; schemeId: string; branchId: string; agentId: string; cycleNo: number; amount: number; lateFee: number; receipt: string; paidAt: string }) {
  const id = crypto.randomUUID()
  db.prepare(`INSERT INTO chit_contributions (id, scheme_id, member_id, cycle_no, contribution_type, amount, method, receipt_number, status, collected_by_agent_id,
      branch_id, commission_amount, credit_applied, late_fee_applied, paid_at) VALUES (?,?,?,?, 'cycle', ?, 'cash', ?, 'pending_verification', ?, ?, 0, 0, ?, ?)`)
    .run(id, o.schemeId, o.memberId, o.cycleNo, o.amount, o.receipt, o.agentId, o.branchId, o.lateFee, o.paidAt)
  return id
}
const row = (id: string) => db.prepare('SELECT * FROM chit_contributions WHERE id=?').get(id) as Record<string, any>
const paidOf = (memberId: string) => (db.prepare('SELECT contributions_paid FROM chit_members WHERE id=?').get(memberId) as { contributions_paid: number }).contributions_paid

describe('App cash collections (POS side)', () => {
  const BR = 'ac-branch', BR2 = 'ac-branch-2'
  const AG1 = 'ac-agent-1', AG2 = 'ac-agent-2'
  let schemeId = '', weeklySchemeId = ''

  beforeAll(async () => {
    for (const [id, code] of [[BR, 'ACB'], [BR2, 'ACC']] as const) {
      db.prepare(`INSERT OR IGNORE INTO branches (id, name, code, address, phone, is_active) VALUES (?,?,?,?,?,1)`).run(id, id, code, 'a', '0')
    }
    db.prepare(`INSERT OR IGNORE INTO roles (id, name) VALUES ('ac-role','AC')`).run()
    for (const [id, br] of [['u-superadmin', null], ['u-ac-mgr', BR], ['u-ac-mgr2', BR2]] as const) {
      db.prepare(`INSERT OR IGNORE INTO users (id, branch_id, role_id, name, email, password_hash) VALUES (?,?,?,?,?,'x')`).run(id, br, 'ac-role', id, `${id}@qa.test`)
    }
    db.prepare(`INSERT OR IGNORE INTO products (id, category_id, supplier_id, sku, name, unit, cost_price, selling_price, tax_rate) VALUES ('ac-prod',NULL,NULL,'ac-prod','Cooker','pcs',1,2000,0)`).run()
    db.prepare(`INSERT OR IGNORE INTO stocks (id, product_id, branch_id, warehouse_id, quantity) VALUES (?,?,?,NULL,50)`).run(crypto.randomUUID(), 'ac-prod', BR)
    for (const [id, code, br] of [[AG1, 'AC1', BR], [AG2, 'AC2', BR]] as const) {
      db.prepare(`INSERT OR IGNORE INTO agents (id, code, name, branch_id, default_commission_pct, status) VALUES (?,?,?,?,0,'active')`).run(id, code, code, br)
    }
    const s = await createScheme({
      name: 'AC Monthly', branch_id: BR, product_id: 'ac-prod', member_count: 40, cycle_count: 12, min_members: 1,
      chit_value: 12000, contribution_amount: 1000, start_date: '2025-01-01', late_payment_days: 5, late_fee_amount: 200,
    })
    expect(s.success, JSON.stringify(s)).toBe(true)
    schemeId = s.data.id
    const w = await createScheme({
      name: 'AC Weekly', branch_id: BR, product_id: 'ac-prod', member_count: 40, cycle_count: 12, min_members: 1,
      chit_value: 12000, contribution_amount: 1000, start_date: '2025-01-01', late_payment_days: 3, late_fee_amount: 150,
    })
    expect(w.success, JSON.stringify(w)).toBe(true)
    weeklySchemeId = w.data.id
    db.prepare(`UPDATE chit_schemes SET frequency='weekly' WHERE id=?`).run(weeklySchemeId)
  })

  it('runs with a UTC timezone (precondition of the parity block)', () => {
    expect(new Date(2026, 4, 5).toISOString().slice(0, 10)).toBe('2026-05-05')
  })

  it('PARITY: the cloud port agrees with the POS quote for monthly and weekly schemes, partial / pending / paid states, before / on / after the due day', async () => {
    setSession(SUPER_ADMIN)
    const states: Array<{ name: string; setup: (m: string, sid: string) => Promise<void> }> = [
      { name: 'untouched', setup: async () => {} },
      { name: 'approved partial 400 (c1, early)', setup: async (m) => { const r = await call('chits:contributions:record', m, { amount: 400, method: 'cash', cycle_no: 1, paid_at: '2025-01-03' }); expect(r.success, JSON.stringify(r)).toBe(true) } },
      { name: 'pending app row with a late fee (c1)', setup: async (m, sid) => { insertAppRow({ memberId: m, schemeId: sid, branchId: BR, agentId: AG1, cycleNo: 1, amount: 600, lateFee: 200, receipt: `AC1-P${phone}`, paidAt: '2025-01-10' }) } },
      { name: 'fully paid c1', setup: async (m) => { const r = await call('chits:contributions:record', m, { amount: 1000, method: 'cash', cycle_no: 1, paid_at: '2025-01-02' }); expect(r.success, JSON.stringify(r)).toBe(true) } },
    ]
    let compared = 0
    for (const sid of [schemeId, weeklySchemeId]) {
      const scheme = db.prepare('SELECT contribution_amount, start_date, late_payment_days, late_fee_amount, frequency FROM chit_schemes WHERE id=?').get(sid) as any
      for (const st of states) {
        const m = await newMember(sid, AG1, `Parity ${st.name}`)
        await st.setup(m, sid)
        for (const cycleNo of [1, 2, 3]) {
          const dueDay = (await call('chits:contributions:quote', m, cycleNo, '2025-06-30')).data.dueDate as string
          const d = (s: number) => new Date(new Date(`${dueDay}T00:00:00Z`).getTime() + s * 86400e3).toISOString().slice(0, 10)
          for (const paidAt of [d(-1), d(0), d(1)]) {
            const pos = await call('chits:contributions:quote', m, cycleNo, paidAt)
            expect(pos.success).toBe(true)
            const f = db.prepare(`
              SELECT COALESCE(SUM(CASE WHEN status='approved' THEN amount - COALESCE(late_fee_applied,0) END),0) AS approvedPaid,
                     COALESCE(SUM(CASE WHEN status='approved' THEN credit_applied END),0) AS creditUsed,
                     COALESCE(SUM(late_fee_applied),0) AS feeCharged,
                     COALESCE(SUM(CASE WHEN status='pending_verification' THEN amount - COALESCE(late_fee_applied,0) END),0) AS pendingPrincipal
              FROM chit_contributions WHERE member_id=? AND scheme_id=? AND cycle_no=? AND contribution_type='cycle' AND status IN ('approved','pending_verification')`).get(m, sid, cycleNo) as any
            const mem = db.prepare('SELECT credit_balance FROM chit_members WHERE id=?').get(m) as any
            const port = quoteCycle(scheme, cycleNo, paidAt, f, Number(mem.credit_balance) || 0)
            const tag = `${scheme.frequency}/${st.name}/c${cycleNo}/${paidAt}`
            expect(port.dueDate, tag).toBe(pos.data.dueDate)
            expect(port.isLate, tag).toBe(pos.data.isLate)
            expect(port.balanceDue, tag).toBe(pos.data.balanceDue)
            expect(port.lateFee, tag).toBe(pos.data.lateFee)
            expect(port.totalPayable, tag).toBe(pos.data.totalPayable)
            compared++
          }
        }
      }
    }
    expect(compared).toBe(72)
  })

  it('ACCEPT: a pending app row changes nothing until approved (member totals and commission inputs stay put)', async () => {
    setSession(SUPER_ADMIN)
    const m = await newMember(schemeId, AG1, 'Accept Member')
    const before = paidOf(m)
    const id = insertAppRow({ memberId: m, schemeId, branchId: BR, agentId: AG1, cycleNo: 1, amount: 1000, lateFee: 0, receipt: 'AC1-000001', paidAt: '2025-01-02T04:00:00.000Z' })
    expect(paidOf(m)).toBe(before)
    const pending = await call('chits:appCollections:pending', {})
    expect(pending.success).toBe(true)
    expect(pending.data.some((r: any) => r.id === id && r.agent_code === 'AC1' && r.receipt_number === 'AC1-000001')).toBe(true)
    const approved = db.prepare(`SELECT COUNT(*) v FROM chit_contributions WHERE member_id=? AND status='approved'`).get(m) as any
    expect(approved.v).toBe(0)
  })

  it('SETTLE: approve two, reject one; the cash received must equal the approved total; remittance and member totals match', async () => {
    setSession(SUPER_ADMIN)
    const [a, b, c] = [await newMember(schemeId, AG2, 'Settle A'), await newMember(schemeId, AG2, 'Settle B'), await newMember(schemeId, AG2, 'Settle C')]
    const r1 = insertAppRow({ memberId: a, schemeId, branchId: BR, agentId: AG2, cycleNo: 1, amount: 1000, lateFee: 0, receipt: 'AC2-000001', paidAt: '2025-01-02T04:00:00.000Z' })
    const r2 = insertAppRow({ memberId: b, schemeId, branchId: BR, agentId: AG2, cycleNo: 1, amount: 400, lateFee: 0, receipt: 'AC2-000002', paidAt: '2025-01-02T05:00:00.000Z' })
    const r3 = insertAppRow({ memberId: c, schemeId, branchId: BR, agentId: AG2, cycleNo: 1, amount: 1000, lateFee: 0, receipt: 'AC2-000003', paidAt: '2025-01-02T06:00:00.000Z' })

    const wrong = await call('chits:appCollections:settle', { agent_id: AG2, approve_ids: [r1, r2], reject: [{ id: r3, reason: 'Cash not handed over' }], received_amount: 1000 })
    expect(wrong.success).toBe(false)
    expect(wrong.error).toMatch(/does not match/)
    expect(row(r1).status).toBe('pending_verification')
    expect(row(r3).status).toBe('pending_verification')

    const noReason = await call('chits:appCollections:settle', { agent_id: AG2, approve_ids: [r1], reject: [{ id: r3, reason: '  ' }], received_amount: 1000 })
    expect(noReason.success).toBe(false)

    const remittedBefore = (db.prepare('SELECT COALESCE(SUM(amount),0) v FROM agent_remittances WHERE agent_id=?').get(AG2) as any).v
    const ok = await call('chits:appCollections:settle', { agent_id: AG2, approve_ids: [r1, r2], reject: [{ id: r3, reason: 'Cash not handed over' }], received_amount: 1400 })
    expect(ok.success, JSON.stringify(ok)).toBe(true)
    expect(ok.data.approved.sort()).toEqual([r1, r2].sort())
    expect(ok.data.rejected).toEqual([r3])
    expect(ok.data.failed).toEqual([])
    expect(ok.data.remitted).toBe(1400)
    expect(row(r1).status).toBe('approved'); expect(row(r2).status).toBe('approved')
    expect(row(r3).status).toBe('rejected'); expect(row(r3).rejected_reason).toBe('Cash not handed over')
    expect(paidOf(a)).toBe(1000); expect(paidOf(b)).toBe(400); expect(paidOf(c)).toBe(0)
    const rem = db.prepare('SELECT * FROM agent_remittances WHERE agent_id=? ORDER BY created_at DESC').all(AG2) as any[]
    expect(money(rem.reduce((s, r) => s + r.amount, 0) - remittedBefore)).toBe(1400)
    // approved cash collected - remitted: the POS's own cash balance for the agent is back to zero
    const cashRow = db.prepare(`SELECT COALESCE(SUM(amount),0) v FROM chit_contributions WHERE collected_by_agent_id=? AND status='approved' AND method='cash'`).get(AG2) as any
    expect(money(cashRow.v - rem.reduce((s, r) => s + r.amount, 0))).toBe(0)

    // nothing is processed twice
    const again = await call('chits:appCollections:settle', { agent_id: AG2, approve_ids: [r1], received_amount: 1000 })
    expect(again.success).toBe(false)
    expect(paidOf(a)).toBe(1000)
  })

  it('SETTLE: the POS recomputes the late-fee split at approval and keeps the cash amount (remittance still matches)', async () => {
    setSession(SUPER_ADMIN)
    const m = await newMember(schemeId, AG1, 'Late Recompute')
    // collected on 2025-01-20 (after the 5th) but the app wrote no fee: the POS is the authority
    const id = insertAppRow({ memberId: m, schemeId, branchId: BR, agentId: AG1, cycleNo: 1, amount: 1200, lateFee: 0, receipt: 'AC1-000009', paidAt: '2025-01-20T04:00:00.000Z' })
    const res = await call('chits:appCollections:settle', { agent_id: AG1, approve_ids: [id], received_amount: 1200 })
    expect(res.success, JSON.stringify(res)).toBe(true)
    const r = row(id)
    expect(r.amount).toBe(1200)
    expect(r.late_fee_applied).toBe(200)
    expect(r.status).toBe('approved')
    expect(res.data.remitted).toBe(1200)
  })

  it('SCOPE: another agent, another branch and a plain pending bank transfer are refused', async () => {
    setSession(SUPER_ADMIN)
    const m = await newMember(schemeId, AG1, 'Scope Member')
    const id = insertAppRow({ memberId: m, schemeId, branchId: BR, agentId: AG1, cycleNo: 2, amount: 500, lateFee: 0, receipt: 'AC1-000020', paidAt: '2025-02-02T04:00:00.000Z' })
    const wrongAgent = await call('chits:appCollections:settle', { agent_id: AG2, approve_ids: [id], received_amount: 500 })
    expect(wrongAgent.success).toBe(false)
    expect(row(id).status).toBe('pending_verification')

    setSession(makeSession({ id: 'u-ac-mgr2', branchId: BR2, permissions: { chits: true } }))
    const otherBranch = await call('chits:appCollections:settle', { agent_id: AG1, approve_ids: [id], received_amount: 500 })
    expect(otherBranch.success).toBe(false)
    const list = await call('chits:appCollections:pending', {})
    expect(list.success).toBe(true)
    expect(list.data.some((r: any) => r.id === id)).toBe(false)
    expect(row(id).status).toBe('pending_verification')

    // a bank-transfer pending row is not an app collection and cannot be settled through this path
    setSession(SUPER_ADMIN)
    const bank = await call('chits:contributions:record', m, { amount: 300, method: 'bank_transfer', cycle_no: 2, paid_at: '2025-02-03' })
    expect(bank.success, JSON.stringify(bank)).toBe(true)
    const viaSettle = await call('chits:appCollections:settle', { agent_id: AG1, approve_ids: [bank.data.id], received_amount: 300 })
    expect(viaSettle.success).toBe(false)
  })
})
