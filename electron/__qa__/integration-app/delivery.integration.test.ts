// Fork C: agent deliveries (list/detail, POS assigns agent, status + OTP, COD settlement, bill) and Smart Buy join requests.
// app API <-> exact cloud MySQL rows <-> POS SQLite (real SyncService + the real POS IPC handlers the screens call).
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { appApi, BASE_URL, cloudDb, createPos, Evidence, j, startTenant, stopTenant, type CloudDb, type Pos, type Seed } from './harness'

const hoisted = vi.hoisted(() => ({
  state: { data: {} as Record<string, any>, directory: '' },
  registry: new Map<string, (...args: unknown[]) => unknown>(),
}))
const state = hoisted.state
vi.mock('electron-store', () => ({ default: class {
  get(key: string, fallback?: unknown) { return state.data[key] ?? fallback }
  set(key: string, value: unknown) { state.data[key] = value }
  delete(key: string) { delete state.data[key] }
} }))
vi.mock('electron', () => ({
  app: { getPath: () => state.directory, isPackaged: false, whenReady: () => Promise.resolve(), on: () => {} },
  ipcMain: { handle: (c: string, fn: (...a: unknown[]) => unknown) => { hoisted.registry.set(c, fn) }, on: () => {} },
  BrowserWindow: { getAllWindows: () => [] },
  dialog: {}, shell: { openExternal: async () => {} }, protocol: { registerFileProtocol: () => {}, handle: () => {} },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() },
  net: { fetch: (...a: Parameters<typeof fetch>) => fetch(...a) },
}))
vi.mock('../../services/licenseService', () => ({ isDeviceLocked: () => false, reportDeviceRevoked: vi.fn() }))

const fakeIpcMain = { handle: (c: string, fn: (...a: unknown[]) => unknown) => { hoisted.registry.set(c, fn) }, on: () => {} } as unknown as import('electron').IpcMain
const ipc = async (channel: string, ...args: unknown[]): Promise<any> => {
  const fn = hoisted.registry.get(channel)
  if (!fn) throw new Error(`No handler registered for channel: ${channel}`)
  return fn({} as any, ...args)
}

let seed: Seed, api: ReturnType<typeof appApi>, db: CloudDb, pos: Pos
let customer: string, agent: string
const ev = new Evidence('delivery')
const t: { orderId?: string; orderNo?: string; invoiceId?: string; otp?: string; custId?: string } = {}

const placeOrder = async (token: string) => {
  const body = { items: [{ product_id: seed.product_ids[0], quantity: 2 }], payment_method: 'cod', address: { recipient_name: 'Del Test', phone: '0771110077', line1: '5 Temple Road', city: 'Kandy' }, notes: 'int-test delivery' }
  const q = await api.post('/checkout/quote', { items: body.items }, { token })
  return api.post('/orders', { ...body, expected_total: q.json.total }, { token, headers: { 'idempotency-key': `del-${Date.now()}-${Math.random()}` } })
}

beforeAll(async () => {
  seed = startTenant()
  api = appApi(seed)
  db = await cloudDb(seed)
  pos = await createPos(state, seed)
  const [{ registerOrderHandlers }, { registerInvoiceHandlers }] = await Promise.all([import('../../ipc/orders'), import('../../ipc/invoices')])
  registerOrderHandlers(fakeIpcMain)
  registerInvoiceHandlers(fakeIpcMain)
  await pos.sync() // bootstrap pull: branches, agents, products, stocks, customers, orders, users
  const admin = pos.get<{ id: string; name: string }>('SELECT id, name FROM users ORDER BY created_at LIMIT 1')!
  state.data.auth_user = { id: admin.id, name: admin.name, branch_id: null, role: { permissions: { all: true } }, scope: { level: 'owner', branchId: null, agentId: null } }
  customer = await api.login(seed.logins.customer_smartbuy.identifier, seed.password)
  agent = await api.login(seed.logins.agent.identifier, seed.password)
}, 240_000)

afterAll(async () => {
  ev.save()
  await db?.close()
  stopTenant(seed)
})

describe('agent deliveries', () => {
  it('DEL-01 agent list + detail of the seeded delivery (cloud agent_id/branch, POS has the same order)', async () => {
    const list = await api.get('/agent/deliveries', { token: agent })
    expect(list.status).toBe(200)
    expect(list.json.items.some((x: any) => x.id === seed.delivery_order_id)).toBe(true)
    const det = await api.get(`/agent/deliveries/${seed.delivery_order_id}`, { token: agent })
    expect(det.status).toBe(200)
    expect(det.json.items.length).toBeGreaterThan(0)
    const row = await db.one(`SELECT id, order_number, status, payment_method, assigned_agent_id, branch_id, total_amount, created_at, updated_at FROM customer_orders WHERE id = ?`, [seed.delivery_order_id])
    expect(row.assigned_agent_id).toBe(seed.agent_id)
    const local = pos.get(`SELECT id, status, assigned_agent_id, branch_id FROM customer_orders WHERE id = ?`, seed.delivery_order_id)
    expect(local?.assigned_agent_id).toBe(seed.agent_id)
    const screen = (await ipc('orders:list', { channel: 'app' })).data.find((o: any) => o.id === seed.delivery_order_id)
    ev.add({ id: 'DEL-01', action: 'Agent opens delivery list + detail', api: `GET /agent/deliveries -> ${list.status}; GET /agent/deliveries/:id -> ${det.status} (${det.json.items.length} items)`,
      cloud: `customer_orders ${j(row)}`, pos: `Orders screen (orders:list) shows ${screen?.order_number} agent=${screen?.assigned_agent_name ?? screen?.assigned_agent_id}`, reverse: 'n/a', ms: list.ms + det.ms, result: screen ? 'PASS' : 'FAIL' })
    expect(screen).toBeTruthy()
  })

  it('DEL-02 customer places COD order: unassigned, agent gets 404, order reaches POS', async () => {
    const o = await placeOrder(customer)
    expect(o.status, JSON.stringify(o.json)).toBe(201)
    t.orderId = o.json.id; t.orderNo = o.json.order_number
    const row = await db.one(`SELECT id, order_number, status, payment_method, payment_status, assigned_agent_id, branch_id, customer_id, total_amount, paid_amount, created_at FROM customer_orders WHERE id = ?`, [t.orderId])
    t.custId = row.customer_id
    const mine = await api.get(`/orders/${t.orderId}`, { token: customer })
    t.otp = mine.json.delivery_otp
    expect(t.otp).toMatch(/^\d{4}$/)
    expect(row.assigned_agent_id).toBeNull()
    const agentView = await api.get(`/agent/deliveries/${t.orderId}`, { token: agent })
    expect(agentView.status).toBe(404)
    const ms = await pos.syncUntil(() => !!pos.get('SELECT id FROM customer_orders WHERE id=?', t.orderId))
    const screen = (await ipc('orders:list', { channel: 'app' })).data.find((x: any) => x.id === t.orderId)
    ev.add({ id: 'DEL-02', action: 'Customer places COD order; unassigned agent cannot see it', api: `POST /orders -> ${o.status}; agent GET /agent/deliveries/:id -> ${agentView.status}`,
      cloud: `customer_orders ${j(row)} (OTP shown only to the owner via GET /orders/:id)`, pos: `Orders screen row ${screen?.order_number} status=${screen?.status}`, reverse: 'n/a', ms: o.ms + ms, result: screen ? 'PASS' : 'FAIL' })
    expect(screen).toBeTruthy()
  })

  it('DEL-03 POS confirms, assigns the agent, converts to invoice -> cloud + agent sees it', async () => {
    const st = await ipc('orders:updateStatus', t.orderId, 'confirmed')
    expect(st.success, JSON.stringify(st)).toBe(true)
    const asg = await ipc('orders:assignAgent', t.orderId, seed.agent_id)
    expect(asg.success, JSON.stringify(asg)).toBe(true)
    const conv = await ipc('orders:convertToInvoice', t.orderId)
    expect(conv.success, JSON.stringify(conv)).toBe(true)
    t.invoiceId = conv.data.id
    const t0 = Date.now()
    await pos.sync()
    const row = await db.one(`SELECT id, status, assigned_agent_id, invoice_id, branch_id, updated_at FROM customer_orders WHERE id = ?`, [t.orderId])
    const inv = await db.one(`SELECT id, invoice_number, branch_id, customer_id, total_amount, paid_amount, due_amount, status, source_order_id, created_at FROM invoices WHERE id = ?`, [t.invoiceId])
    const list = await api.get('/agent/deliveries', { token: agent })
    const seen = list.json.items.find((x: any) => x.id === t.orderId)
    const ms = Date.now() - t0
    ev.add({ id: 'DEL-03', action: 'POS confirms + assigns agent + converts to invoice', api: `agent GET /agent/deliveries -> ${list.status}, order ${seen ? 'listed' : 'missing'} status=${seen?.status}`,
      cloud: `customer_orders ${j(row)}; invoices ${j(inv)}`, pos: 'Orders screen: orders:updateStatus/assignAgent/convertToInvoice -> sync_queue pushed', reverse: 'POS -> cloud -> app agent list', ms,
      result: row?.assigned_agent_id === seed.agent_id && row?.invoice_id === t.invoiceId && row?.status === 'ready_for_delivery' && seen ? 'PASS' : 'FAIL' })
    expect(row.assigned_agent_id).toBe(seed.agent_id)
    expect(row.invoice_id).toBe(t.invoiceId)
    expect(row.status).toBe('ready_for_delivery')
    expect(inv.source_order_id).toBe(t.orderId)
    expect(Number(inv.due_amount)).toBe(Number(inv.total_amount))
    expect(seen).toBeTruthy()
  })

  it('DEL-04 agent marks out for delivery -> cloud status, POS Orders screen, customer tracking', async () => {
    const r = await api.post(`/agent/deliveries/${t.orderId}/status`, { status: 'in_transit' }, { token: agent })
    expect(r.status, JSON.stringify(r.json)).toBe(200)
    const row = await db.one(`SELECT status, dispatch_at, updated_at FROM customer_orders WHERE id = ?`, [t.orderId])
    expect(row.status).toBe('in_transit')
    const ms = await pos.syncUntil(() => pos.get('SELECT status FROM customer_orders WHERE id=?', t.orderId)?.status === 'in_transit')
    const screen = (await ipc('orders:list', { channel: 'app' })).data.find((x: any) => x.id === t.orderId)
    const tr = await api.get(`/orders/${t.orderId}/tracking`, { token: customer })
    ev.add({ id: 'DEL-04', action: 'Agent: out for delivery', api: `POST /agent/deliveries/:id/status in_transit -> ${r.status}; tracking -> ${tr.json.status}`,
      cloud: `customer_orders ${j(row)}`, pos: `Orders screen status=${screen?.status}`, reverse: 'n/a', ms: r.ms + ms, result: screen?.status === 'in_transit' && tr.json.status === 'in_transit' ? 'PASS' : 'FAIL' })
    expect(screen.status).toBe('in_transit')
    expect(tr.json.status).toBe('in_transit')
  })

  it('DEL-05 OTP: wrong 400, right completes once, replay idempotent; COD settles order/invoice/payment/customer', async () => {
    const before = await db.one(`SELECT outstanding FROM customers WHERE id = ?`, [t.custId])
    const wrong = await api.post(`/agent/deliveries/${t.orderId}/complete`, { otp: t.otp === '0000' ? '1111' : '0000', event_id: `evt-w-${Date.now()}` }, { token: agent })
    expect(wrong.status).toBe(400)
    expect(wrong.json.error.code).toBe('OTP_INVALID')
    const eid = `evt-${Date.now()}`
    const ok = await api.post(`/agent/deliveries/${t.orderId}/complete`, { otp: t.otp, event_id: eid }, { token: agent })
    expect(ok.status, JSON.stringify(ok.json)).toBe(200)
    expect(ok.json.status).toBe('delivered')
    const replay = await api.post(`/agent/deliveries/${t.orderId}/complete`, { otp: t.otp, event_id: eid }, { token: agent })
    expect(replay.status).toBe(200)
    expect(replay.json.delivered_at).toBe(ok.json.delivered_at)
    const o = await db.one(`SELECT status, payment_status, total_amount, paid_amount, delivered_at, updated_at FROM customer_orders WHERE id = ?`, [t.orderId])
    const inv = await db.one(`SELECT total_amount, paid_amount, due_amount, status, updated_at FROM invoices WHERE id = ?`, [t.invoiceId])
    const pays = await db.query(`SELECT id, method, amount, reference, paid_at FROM payments WHERE invoice_id = ?`, [t.invoiceId])
    const after = await db.one(`SELECT outstanding FROM customers WHERE id = ?`, [t.custId])
    expect(o.status).toBe('delivered')
    expect(o.payment_status).toBe('paid')
    expect(Number(o.paid_amount)).toBe(Number(o.total_amount))
    expect(Number(inv.paid_amount)).toBe(Number(inv.total_amount))
    expect(Number(inv.due_amount)).toBe(0)
    expect(inv.status).toBe('paid')
    expect(pays.length).toBe(1)
    expect(pays[0].method).toBe('cash')
    expect(Number(pays[0].amount)).toBe(Number(o.total_amount))
    expect(Date.now() - new Date(String(o.delivered_at).replace(' ', 'T') + 'Z').getTime()).toBeLessThan(5 * 60_000) // stored UTC
    ev.add({ id: 'DEL-05', action: 'Delivery OTP + COD collection', api: `wrong OTP -> ${wrong.status} ${wrong.json.error.code}; right -> ${ok.status}; replay -> ${replay.status} same delivered_at`,
      cloud: `customer_orders ${j(o)}; invoices ${j(inv)}; payments ${j(pays)}; customers.outstanding ${before?.outstanding} -> ${after?.outstanding}`, pos: 'see DEL-06', reverse: 'n/a', ms: ok.ms, result: 'PASS' })
  })

  it('DEL-06 POS after sync: same order/invoice/payment/customer values; Orders screen shows delivered', async () => {
    const ms = await pos.syncUntil(() => pos.get('SELECT status FROM customer_orders WHERE id=?', t.orderId)?.status === 'delivered')
    const lo = pos.get('SELECT status, payment_status, total_amount, paid_amount FROM customer_orders WHERE id=?', t.orderId)
    const li = pos.get('SELECT total_amount, paid_amount, due_amount, status FROM invoices WHERE id=?', t.invoiceId)
    const lp = pos.all('SELECT method, amount FROM payments WHERE invoice_id=?', t.invoiceId)
    const cust = pos.get('SELECT outstanding_due AS outstanding FROM customers WHERE id=?', t.custId)
    const cc = await db.one(`SELECT outstanding FROM customers WHERE id = ?`, [t.custId])
    const screen = (await ipc('orders:list', { channel: 'app', status: 'delivered' })).data.find((x: any) => x.id === t.orderId)
    const ok = lo?.payment_status === 'paid' && Number(lo.paid_amount) === Number(lo.total_amount) && Number(li?.due_amount) === 0 && li?.status === 'paid'
      && lp.length === 1 && lp[0].method === 'cash' && Number(cust?.outstanding) === Number(cc?.outstanding) && !!screen
    ev.add({ id: 'DEL-06', action: 'COD result visible in POS', api: 'n/a (POS pull)', cloud: 'see DEL-05',
      pos: `SQLite order ${j(lo)}; invoice ${j(li)}; payments ${j(lp)}; customer.outstanding ${cust?.outstanding} (cloud ${cc?.outstanding}); Orders screen delivered=${!!screen}`, reverse: 'n/a', ms, result: ok ? 'PASS' : 'FAIL' })
    expect(lo?.payment_status).toBe('paid')
    expect(Number(li?.due_amount)).toBe(0)
    expect(li?.status).toBe('paid')
    expect(lp.length).toBe(1)
    expect(Number(cust?.outstanding)).toBe(Number(cc?.outstanding))
    expect(screen).toBeTruthy()
  })

  it('DEL-07 bill carries company name/TIN/note from POS company settings and the POS invoice number', async () => {
    const put = await fetch(`${BASE_URL}/api/company/branding`, { method: 'PUT', headers: { 'x-api-key': seed.pos_api_key, 'content-type': 'application/json' },
      body: JSON.stringify({ company_legal_name: 'Int Test (Pvt) Ltd', company_tin: 'PV-998877', company_address: '1 Test Lane, Kandy', invoice_note: 'Int note' }) })
    expect(put.status).toBe(200)
    const b = await api.get(`/agent/deliveries/${t.orderId}/bill`, { token: agent })
    expect(b.status, JSON.stringify(b.json)).toBe(200)
    const inv = await db.one(`SELECT invoice_number, created_at FROM invoices WHERE id = ?`, [t.invoiceId])
    expect(b.json.bill_no).toBe(inv.invoice_number)
    expect(b.json.company_name).toBe('Int Test (Pvt) Ltd')
    expect(b.json.company_tin).toBe('PV-998877')
    expect(b.json.footer_note).toBe('Int note')
    expect(b.json.company_address).toBe('1 Test Lane, Kandy')
    expect(b.json.date).toMatch(/Z$/)
    expect(new Date(b.json.date).getTime()).toBe(new Date(String(inv.created_at).replace(' ', 'T') + 'Z').getTime())
    expect(b.json.paid_in_full).toBe(true)
    ev.add({ id: 'DEL-07', action: 'Delivery bill with company details', api: `PUT /api/company/branding -> ${put.status}; GET /agent/deliveries/:id/bill -> ${b.status} bill_no=${b.json.bill_no} company=${b.json.company_name} tin=${b.json.company_tin} note=${b.json.footer_note} date=${b.json.date}`,
      cloud: `invoices ${j(inv)} (date = created_at UTC)`, pos: 'POS Settings company fields (branding) -> cloud', reverse: 'POS company settings -> app bill', ms: b.ms, result: 'PASS' })
  })

  it('DEL-08 commission ledger rows for the delivery (if the engine created any)', async () => {
    const rows = await db.query(`SELECT id, source_table, source_id, sales_agent_id, registration_agent_id, base_amount, total_commission, status, created_at FROM commission_ledger WHERE sales_agent_id = ? OR registration_agent_id = ?`, [seed.agent_id, seed.agent_id])
    const c = await api.get('/agent/commission', { token: agent })
    expect(c.status).toBe(200)
    ev.add({ id: 'DEL-08', action: 'Agent commission/earnings after delivery', api: `GET /agent/commission -> ${c.status} (${c.json.items?.length ?? 0} items)`,
      cloud: `commission_ledger rows for agent: ${j(rows)}`, pos: 'Commissions screen reads commission_ledger (POS-computed; not created by the cloud COD path)', reverse: 'n/a', ms: c.ms,
      result: 'PASS', notes: rows.some((r: any) => r.source_id === t.orderId) ? 'delivery commission row present' : 'No delivery commission row is created by the app/cloud path (commissions are computed by the POS engine); informational.' })
  })

  it('DEL-09 security: customer on agent routes, wrong key, no token, wrong order id', async () => {
    const a = await api.get(`/agent/deliveries/${t.orderId}`, { token: customer })
    const b = await api.get('/agent/deliveries', { token: customer })
    const c = await api.get(`/agent/deliveries/${t.orderId}/bill`, { token: customer })
    const d = await api.get('/agent/deliveries', { token: agent, key: 'npk_wrong' })
    const e = await api.get('/agent/deliveries')
    const f = await api.get('/agent/deliveries/00000000-0000-0000-0000-000000000000', { token: agent })
    const g = await api.post(`/agent/deliveries/${t.orderId}/complete`, { otp: '1234', event_id: 'x' }, { token: customer })
    expect([a.status, b.status, c.status, g.status]).toEqual([403, 403, 403, 403])
    expect(d.status).toBe(401)
    expect(e.status).toBe(401)
    expect(f.status).toBe(404)
    ev.add({ id: 'DEL-09', action: 'Security: customer/agent route scoping', api: `customer on agent routes ${a.status}/${b.status}/${c.status}/${g.status}; wrong key ${d.status}; no token ${e.status}; unknown order ${f.status}`,
      cloud: 'no rows changed', pos: 'n/a', reverse: 'n/a', ms: a.ms, result: 'PASS' })
  })
})

describe('Smart Buy join requests', () => {
  it('JOIN-01 member join request -> POS Join Requests -> approve/reject -> app', async () => {
    // v1.0 has no join-request API: the app sheet is demo-mock only (JoinSheet SB_DEMO) and the POS has no Join Requests screen.
    const probes = await Promise.all(['/smartbuy/join', '/smartbuy/join-requests', '/smartbuy/me/join-requests', '/join-requests'].map(p => api.post(p, { scheme_id: seed.scheme_id, nic: '901234567V' }, { token: customer })))
    const posProbe = await fetch(`${BASE_URL}/api/app/v1/admin/join-requests`, { headers: { 'x-api-key': seed.pos_api_key } })
    const tables = await db.query(`SELECT table_name AS t FROM information_schema.tables WHERE table_schema = ? AND table_name LIKE '%join%'`, [seed.db_schema])
    expect(probes.every(p => p.status === 404)).toBe(true)
    ev.add({ id: 'JOIN-01', action: 'Member submits Smart Buy join request; POS lists + approves; app sees status', api: `POST join endpoints -> ${probes.map(p => p.status).join('/')}; GET admin/join-requests -> ${posProbe.status}`,
      cloud: `no join/request table in tenant schema (${j(tables)})`, pos: 'No Join Requests screen/handler exists in the POS (grep join_request: none)', reverse: 'n/a', result: 'SKIP',
      notes: 'Not implemented in v1.0: the app JoinSheet submit is disabled in release builds and neither the API nor the POS has a join-request flow. Needs a product decision before building (HANDOFF/Step 6).' })
  })
})
