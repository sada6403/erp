// Smart Buy join requests (agent initiated + customer self join, one flow) and bank-transfer slips:
// app API <-> exact cloud rows <-> private image files <-> POS admin endpoints (x-api-key) <-> POS SQLite via the real SyncService.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'crypto'
import zlib from 'zlib'
import { appApi, BASE_URL, cloudDb, createPos, Evidence, j, posAdmin, startTenant, stopTenant, type CloudDb, type Pos, type Seed } from './harness'

const state = vi.hoisted(() => ({ data: {} as Record<string, any>, directory: '' }))
vi.mock('electron-store', () => ({ default: class {
  get(key: string, fallback?: unknown) { return state.data[key] ?? fallback }
  set(key: string, value: unknown) { state.data[key] = value }
  delete(key: string) { delete state.data[key] }
} }))
vi.mock('electron', () => ({
  app: { getPath: () => state.directory, isPackaged: false },
  BrowserWindow: { getAllWindows: () => [] },
  net: { fetch: (...a: Parameters<typeof fetch>) => fetch(...a) },
}))
vi.mock('../../services/licenseService', () => ({ isDeviceLocked: () => false, reportDeviceRevoked: vi.fn() }))

/** Solid-colour PNG (no image library needed). */
function png(w: number, h: number, [r, g, b]: [number, number, number]): Buffer {
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
  const crc = (buf: Buffer) => { let c = 0xffffffff; for (const x of buf) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
  const chunk = (type: string, data: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]) }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => [r, g, b]).flat())])
  const raw = Buffer.concat(Array.from({ length: h }, () => row))
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
const file = (b: Buffer, name: string, type = 'image/png') => new File([new Uint8Array(b)], name, { type })
const rnd = (n: number) => String(Math.floor(Math.random() * 10 ** n)).padStart(n, '0')

let seed: Seed, api: ReturnType<typeof appApi>, admin: ReturnType<typeof posAdmin>, db: CloudDb, pos: Pos
let agent = '', custA = '', custB = '', schemeId = ''
const ev = new Evidence('join-slip')

const joinForm = (o: Partial<Record<string, string>> = {}, files: { front?: Blob | null; back?: Blob | null } = {}) => {
  const f = new FormData()
  const fields: Record<string, string> = {
    scheme_id: schemeId, full_name: `Join Tester ${rnd(4)}`, phone: `07${rnd(8)}`, nic_number: `9${rnd(8)}V`, address: '12 Lake Road, Kandy',
    client_event_id: randomUUID(), ...o as Record<string, string>,
  }
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) f.append(k, v)
  const front = files.front === undefined ? file(png(40, 30, [200, 50, 50]), 'front.png') : files.front
  const back = files.back === undefined ? file(png(40, 30, [50, 50, 200]), 'back.png') : files.back
  if (front) f.append('nic_front', front, 'front.png')
  if (back) f.append('nic_back', back, 'back.png')
  return { f, fields }
}

beforeAll(async () => {
  seed = startTenant()
  api = appApi(seed)
  admin = posAdmin(seed)
  db = await cloudDb(seed)
  pos = await createPos(state, seed)
  agent = await api.login(seed.logins.agent.identifier, seed.password)
  custA = await api.login(seed.logins.customer_smartbuy.identifier, seed.password)
  custB = await api.login(seed.logins.other_customer.identifier, seed.password)
  // A scheme with room (the seeded one is full: 4/4).
  schemeId = randomUUID()
  await db.exec(
    `INSERT INTO chit_schemes (id, scheme_number, name, branch_id, agent_id, member_count, cycle_count, frequency, contribution_amount, chit_value, start_date, next_draw_date, status)
     VALUES (?, 'SB-JOIN', 'Join Test Scheme', ?, ?, 10, 10, 'monthly', 1000, 10000, NOW(), DATE_ADD(NOW(), INTERVAL 10 DAY), 'active')`, [schemeId, seed.branches.main, seed.agent_id])
}, 240_000)

afterAll(async () => {
  ev.save()
  await db?.close()
  stopTenant(seed)
})

describe('Smart Buy join requests', () => {
  let reqId = '', member: any, event = ''

  it('JOIN-01 agent submits a join request with NIC photos; POS sees it; approve creates customer + member that sync to the POS', async () => {
    const { f, fields } = joinForm()
    event = fields.client_event_id
    const r = await api.postForm('/smartbuy/join-requests', f, { token: agent })
    expect(r.status, JSON.stringify(r.json)).toBe(201)
    reqId = r.json.id
    expect(r.json.status).toBe('pending')
    expect(JSON.stringify(r.json)).not.toContain(fields.nic_number) // NIC never echoed
    expect(r.json.phone_masked).toMatch(/\*\*\*\*/)

    const row = await db.one(`SELECT source, agent_id, scheme_id, phone, nic_number, nic_front_ref, nic_back_ref, status FROM smartbuy_join_requests WHERE id = ?`, [reqId])
    expect(row.source).toBe('agent')
    expect(row.agent_id).toBe(seed.agent_id)
    expect(row.nic_front_ref).toMatch(/\.webp$/)
    const pub = await fetch(`${BASE_URL}/api/files/${row.nic_front_ref}`)
    expect(pub.status).toBe(404) // private: not reachable through the public files route

    const replay = await api.postForm('/smartbuy/join-requests', joinForm({ client_event_id: event }).f, { token: agent })
    expect(replay.status).toBe(200)
    expect(replay.json.id).toBe(reqId)

    const list = await admin.get('/join-requests?status=pending')
    const mine = list.json.items.find((x: any) => x.id === reqId)
    expect(mine).toMatchObject({ source: 'agent', agent_code: 'AG001', full_name: fields.full_name, phone: fields.phone, nic_number: fields.nic_number, has_nic_front: true, has_nic_back: true })
    const img = await admin.raw(`/join-requests/${reqId}/photo?side=front`)
    expect(img.status).toBe(200)
    expect(img.type).toContain('image/webp')
    expect(img.bytes.subarray(0, 4).toString('latin1')).toBe('RIFF')
    const noKey = await fetch(`${BASE_URL}/api/app/v1/admin/join-requests/${reqId}/photo`)
    const appKeyOnly = await fetch(`${BASE_URL}/api/app/v1/admin/join-requests`, { headers: { 'x-app-key': seed.app_key } })
    expect([noKey.status, appKeyOnly.status]).toEqual([401, 401])

    const dec = await admin.post(`/join-requests/${reqId}/decision`, { decision: 'approve', decided_by: 'int-test' })
    expect(dec.status, JSON.stringify(dec.json)).toBe(200)
    member = await db.one(`SELECT m.id, m.agent_id, m.join_order, m.status, c.phone, c.name FROM chit_members m JOIN customers c ON c.id = m.customer_id WHERE m.id = ?`, [dec.json.member_id])
    expect(member).toMatchObject({ agent_id: seed.agent_id, status: 'active', phone: fields.phone, join_order: 1 })
    const again = await admin.post(`/join-requests/${reqId}/decision`, { decision: 'approve' })
    expect(again.status).toBe(409)

    const mineApp = await api.get('/smartbuy/join-requests', { token: agent })
    expect(mineApp.json.items.find((x: any) => x.id === reqId).status).toBe('approved')
    const notif = await db.one(`SELECT title FROM app_notifications WHERE user_id = ? AND title LIKE 'Smart Buy request approved%'`, [seed.logins.agent.user_id])
    expect(notif).toBeTruthy()

    const ms = await pos.syncUntil(() => !!pos.get(`SELECT id FROM chit_members WHERE id = ?`, dec.json.member_id))
    const local = pos.get<any>(`SELECT m.agent_id, m.join_order, c.phone FROM chit_members m JOIN customers c ON c.id = m.customer_id WHERE m.id = ?`, dec.json.member_id)
    expect(local).toMatchObject({ agent_id: seed.agent_id, phone: fields.phone })
    ev.add({
      id: 'JOIN-01', action: 'Agent submits Smart Buy join (NIC photos) -> POS lists + approves -> customer + member -> POS SQLite',
      api: `POST /smartbuy/join-requests -> ${r.status} (replay ${replay.status}); admin list/photo ${img.status}; decision ${dec.status} (again ${again.status})`,
      cloud: `smartbuy_join_requests ${j(row)}; chit_members+customers ${j(member)}`,
      pos: `Join Requests screen data via GET admin/join-requests; SQLite chit_members ${j(local)}`, reverse: 'POS decision -> app request status + notification', ms: r.ms + ms, result: 'PASS',
    })
  })

  it('JOIN-02 validation, duplicates, scheme full, roles and isolation', async () => {
    const bad = async (o: Partial<Record<string, string>>, files: { front?: Blob | null; back?: Blob | null } = {}, token = agent) =>
      (await api.postForm('/smartbuy/join-requests', joinForm(o, files).f, { token })).status
    const results = {
      badNic: await bad({ nic_number: '123' }),
      badPhone: await bad({ phone: '12345' }),
      noPhoto: await bad({}, { back: null }),
      notAnImage: await bad({}, { front: file(Buffer.from('this is not an image at all, just text'), 'x.png') }),
      unknownField: await bad({ is_admin: '1' }),
      noEvent: await bad({ client_event_id: 'x' }),
      full: await bad({ scheme_id: seed.scheme_id }),
      noToken: (await api.postForm('/smartbuy/join-requests', joinForm().f, {})).status,
      wrongKey: (await api.postForm('/smartbuy/join-requests', joinForm().f, { token: agent, key: 'nope' })).status,
    }
    expect(results).toEqual({ badNic: 400, badPhone: 400, noPhoto: 400, notAnImage: 400, unknownField: 400, noEvent: 400, full: 409, noToken: 401, wrongKey: 401 })
    // already a member (the approved person from JOIN-01) and a second pending request for the same phone
    const dupMember = await api.postForm('/smartbuy/join-requests', joinForm({ phone: member.phone }).f, { token: agent })
    expect(dupMember.status).toBe(409)
    expect(dupMember.json.error.code).toBe('ALREADY_MEMBER')
    const first = joinForm()
    expect((await api.postForm('/smartbuy/join-requests', first.f, { token: agent })).status).toBe(201)
    const dupPending = await api.postForm('/smartbuy/join-requests', joinForm({ phone: first.fields.phone }).f, { token: agent })
    expect(dupPending.status).toBe(409)
    // another user never sees this agent's requests; admin endpoints reject the app token
    const otherList = await api.get('/smartbuy/join-requests', { token: custB })
    expect(otherList.json.items.find((x: any) => x.id === reqId)).toBeUndefined()
    const asAdmin = await fetch(`${BASE_URL}/api/app/v1/admin/join-requests`, { headers: { authorization: `Bearer ${agent}`, 'x-app-key': seed.app_key } })
    expect(asAdmin.status).toBe(401)
    ev.add({ id: 'JOIN-02', action: 'Join request validation + security', api: j(results), cloud: 'no extra rows for rejected input; duplicate pending/member blocked 409', pos: 'n/a', reverse: 'n/a', result: 'PASS' })
  })

  it('JOIN-03 POS rejects with a reason; app shows it; reject needs a reason', async () => {
    const { f } = joinForm()
    const r = await api.postForm('/smartbuy/join-requests', f, { token: agent })
    expect(r.status).toBe(201)
    const noReason = await admin.post(`/join-requests/${r.json.id}/decision`, { decision: 'reject' })
    expect(noReason.status).toBe(400)
    const dec = await admin.post(`/join-requests/${r.json.id}/decision`, { decision: 'reject', reason: 'NIC photo is blurry', decided_by: 'int-test' })
    expect(dec.status).toBe(200)
    const mine = (await api.get('/smartbuy/join-requests', { token: agent })).json.items.find((x: any) => x.id === r.json.id)
    expect(mine).toMatchObject({ status: 'rejected', reject_reason: 'NIC photo is blurry' })
    const members = await db.one(`SELECT COUNT(*) AS n FROM chit_members WHERE scheme_id = ?`, [schemeId])
    expect(Number(members.n)).toBe(1)
    ev.add({ id: 'JOIN-03', action: 'POS rejects join request', api: `reject without reason ${noReason.status}; with reason ${dec.status}`, cloud: `status rejected, no member created (members in scheme: ${members.n})`, pos: 'n/a', reverse: 'app request shows rejected + reason', result: 'PASS' })
  })

  it('JOIN-04 customer self join (same flow, source=self) -> approve links the member to the customer', async () => {
    const f = joinForm({ full_name: 'Self Joiner', phone: `07${rnd(8)}` }).f
    const r = await api.postForm('/smartbuy/join-requests', f, { token: custB })
    expect(r.status, JSON.stringify(r.json)).toBe(201)
    const row = await db.one(`SELECT source, agent_id, customer_id FROM smartbuy_join_requests WHERE id = ?`, [r.json.id])
    expect(row).toMatchObject({ source: 'self', agent_id: null })
    expect(row.customer_id).toBe(seed.logins.other_customer.customer_id)
    const dec = await admin.post(`/join-requests/${r.json.id}/decision`, { decision: 'approve' })
    expect(dec.status).toBe(200)
    const m = await db.one(`SELECT customer_id, agent_id FROM chit_members WHERE id = ?`, [dec.json.member_id])
    expect(m.customer_id).toBe(seed.logins.other_customer.customer_id)
    expect(m.agent_id).toBeNull()
    const my = await api.get('/smartbuy/me/schemes', { token: custB })
    expect(my.status).toBe(200)
    expect(my.json.items.some((x: any) => x.scheme_id === schemeId)).toBe(true)
    ev.add({ id: 'JOIN-04', action: 'Customer self join (shared flow)', api: `POST ${r.status}; decision ${dec.status}; GET /smartbuy/me/schemes lists the scheme`, cloud: `request ${j(row)}; member ${j(m)}`, pos: 'n/a', reverse: 'approval -> member visible in the customer app', result: 'PASS' })
  })
})

describe('NIC retention and privacy', () => {
  it('JOIN-05 NIC number + photos are deleted 30 days after the decision; recent ones stay; cloud customers has no NIC column', async () => {
    const mk = async () => {
      const r = await api.postForm('/smartbuy/join-requests', joinForm().f, { token: agent })
      expect(r.status, JSON.stringify(r.json)).toBe(201)
      return r.json.id as string
    }
    const [oldApproved, oldRejected, recentRejected, stillPending] = [await mk(), await mk(), await mk(), await mk()]
    expect((await admin.post(`/join-requests/${oldApproved}/decision`, { decision: 'approve' })).status).toBe(200)
    expect((await admin.post(`/join-requests/${oldRejected}/decision`, { decision: 'reject', reason: 'blurry' })).status).toBe(200)
    expect((await admin.post(`/join-requests/${recentRejected}/decision`, { decision: 'reject', reason: 'blurry' })).status).toBe(200)
    const before = await db.one(`SELECT nic_front_ref, nic_number FROM smartbuy_join_requests WHERE id = ?`, [oldApproved])
    expect(before.nic_front_ref).toBeTruthy()
    expect((await admin.raw(`/join-requests/${oldApproved}/photo?side=front`)).status).toBe(200)
    await db.exec(`UPDATE smartbuy_join_requests SET decided_at = DATE_SUB(NOW(), INTERVAL 31 DAY) WHERE id IN (?, ?)`, [oldApproved, oldRejected])
    await db.exec(`UPDATE smartbuy_join_requests SET decided_at = DATE_SUB(NOW(), INTERVAL 5 DAY) WHERE id = ?`, [recentRejected])
    await db.exec(`UPDATE smartbuy_join_requests SET created_at = DATE_SUB(NOW(), INTERVAL 90 DAY) WHERE id = ?`, [stillPending])

    const list = await admin.get('/join-requests')
    expect(list.status).toBe(200)
    const by = (id: string) => list.json.items.find((x: any) => x.id === id)
    expect(by(oldApproved)).toMatchObject({ nic_number: '', has_nic_front: false, has_nic_back: false, status: 'approved' })
    expect(by(oldRejected)).toMatchObject({ nic_number: '', has_nic_front: false, has_nic_back: false, status: 'rejected' })
    expect(by(recentRejected).nic_number).toMatch(/^9\d{8}V$/)
    expect(by(recentRejected).has_nic_front).toBe(true)
    expect(by(stillPending).nic_number).toMatch(/^9\d{8}V$/) // a pending request is never purged, however old
    const gone = await db.one(`SELECT nic_number, nic_front_ref, nic_back_ref, purged_at, full_name, phone FROM smartbuy_join_requests WHERE id = ?`, [oldApproved])
    expect(gone).toMatchObject({ nic_number: '', nic_front_ref: null, nic_back_ref: null })
    expect(gone.purged_at).toBeTruthy()
    expect(gone.full_name).toBeTruthy()
    expect((await admin.raw(`/join-requests/${oldApproved}/photo?side=front`)).status).toBe(404)
    expect((await admin.raw(`/join-requests/${recentRejected}/photo?side=front`)).status).toBe(200)
    const nicCols = await db.query(`SELECT table_name AS t FROM information_schema.columns WHERE table_schema = ? AND table_name = 'customers' AND column_name IN ('nic', 'nic_number')`, [seed.db_schema])
    expect(nicCols).toEqual([])
    ev.add({ id: 'JOIN-05', action: 'NIC retention (30 days after decision) + no NIC in cloud customers', api: 'GET admin/join-requests purges expired rows; old photo -> 404; recent -> 200', cloud: `purged row ${j(gone)}; customers has no nic column`, pos: 'approved data lives in the POS customer record', reverse: 'n/a', result: 'PASS' })
  })
})

describe('Bank transfer slips', () => {
  let orderId = '', slipId = '', event = ''
  const order = async (pm: 'bank_transfer' | 'cod') => {
    const items = [{ product_id: seed.product_ids[1], quantity: 1 }]
    const o = await api.post('/orders', { items, branch_id: seed.branches.main, address: { recipient_name: 'Slip Tester', phone: '0771234567', line1: '1 Temple Road', city: 'Kandy' }, payment_method: pm }, { token: custA, headers: { 'idempotency-key': randomUUID() } })
    expect(o.status, JSON.stringify(o.json)).toBe(201)
    return o.json
  }
  const slipForm = (eventId: string = randomUUID(), reference = 'REF-778', img: Blob | null = file(png(60, 40, [20, 120, 60]), 'slip.png')) => {
    const f = new FormData()
    f.append('client_event_id', eventId)
    if (reference) f.append('reference', reference)
    if (img) f.append('slip', img, 'slip.png')
    return f
  }

  it('SLIP-01 customer uploads a bank slip; POS sees the image; reject -> re-upload -> verify marks the order paid', async () => {
    const o = await order('bank_transfer')
    orderId = o.id
    event = randomUUID()
    const up = await api.postForm(`/orders/${orderId}/slip`, slipForm(event), { token: custA })
    expect(up.status, JSON.stringify(up.json)).toBe(201)
    slipId = up.json.id
    expect(up.json.status).toBe('pending')
    const replay = await api.postForm(`/orders/${orderId}/slip`, slipForm(event), { token: custA })
    expect(replay.status).toBe(200)
    expect(replay.json.id).toBe(slipId)
    const second = await api.postForm(`/orders/${orderId}/slip`, slipForm(), { token: custA })
    expect(second.status).toBe(409) // one pending slip at a time
    const row = await db.one(`SELECT file_ref, status, reference FROM order_payment_slips WHERE id = ?`, [slipId])
    expect(row.file_ref).toMatch(/\.webp$/)
    expect((await fetch(`${BASE_URL}/api/files/${row.file_ref}`)).status).toBe(404)

    const list = await admin.get('/payment-slips?status=pending')
    const mine = list.json.items.find((x: any) => x.id === slipId)
    expect(mine).toMatchObject({ order_id: orderId, order_number: o.order_number, status: 'pending', reference: 'REF-778' })
    const img = await admin.raw(`/payment-slips/${slipId}/image`)
    expect(img.status).toBe(200)
    expect(img.type).toContain('image/webp')

    const noReason = await admin.post(`/payment-slips/${slipId}/decision`, { decision: 'reject' })
    expect(noReason.status).toBe(400)
    const rej = await admin.post(`/payment-slips/${slipId}/decision`, { decision: 'reject', reason: 'Amount does not match', reviewed_by: 'int-test' })
    expect(rej.status).toBe(200)
    const afterRej = await api.get(`/orders/${orderId}/slip`, { token: custA })
    expect(afterRej.json.items[0]).toMatchObject({ id: slipId, status: 'rejected', reject_reason: 'Amount does not match' })
    expect((await db.one(`SELECT payment_status FROM customer_orders WHERE id = ?`, [orderId])).payment_status).not.toBe('paid')

    const up2 = await api.postForm(`/orders/${orderId}/slip`, slipForm(), { token: custA })
    expect(up2.status).toBe(201)
    const ver = await admin.post(`/payment-slips/${up2.json.id}/decision`, { decision: 'verify', reviewed_by: 'int-test' })
    expect(ver.status, JSON.stringify(ver.json)).toBe(200)
    const paid = await db.one(`SELECT payment_status, paid_amount, total_amount FROM customer_orders WHERE id = ?`, [orderId])
    expect(paid.payment_status).toBe('paid')
    expect(Number(paid.paid_amount)).toBe(Number(paid.total_amount))
    expect((await api.get(`/orders/${orderId}`, { token: custA })).json.payment_status).toBe('paid')
    const ms = await pos.syncUntil(() => pos.get<any>(`SELECT payment_status FROM customer_orders WHERE id = ?`, orderId)?.payment_status === 'paid')
    const again = await admin.post(`/payment-slips/${up2.json.id}/decision`, { decision: 'verify' })
    expect(again.status).toBe(409)
    const late = await api.postForm(`/orders/${orderId}/slip`, slipForm(), { token: custA })
    expect(late.status).toBe(409) // already paid
    ev.add({
      id: 'SLIP-01', action: 'Bank slip upload -> POS reject -> re-upload -> verify -> order paid',
      api: `POST slip ${up.status} (replay ${replay.status}, second while pending ${second.status}); reject ${rej.status}; re-upload ${up2.status}; verify ${ver.status} (again ${again.status}; upload after paid ${late.status})`,
      cloud: `order_payment_slips ${j(row)}; customer_orders ${j(paid)}`, pos: `payment-slips list + image ${img.status} ${img.type}; SQLite payment_status paid`, reverse: 'POS verification -> app order paid + notification', ms: up.ms + ms, result: 'PASS',
    })
  })

  it('SLIP-02 validation + isolation: not an image, COD order, other customer, no token', async () => {
    const cod = await order('cod')
    const bank = await order('bank_transfer')
    const r = {
      notImage: (await api.postForm(`/orders/${bank.id}/slip`, slipForm(randomUUID(), 'x', file(Buffer.from('plain text pretending to be a slip'), 's.png')), { token: custA })).status,
      noFile: (await api.postForm(`/orders/${bank.id}/slip`, slipForm(randomUUID(), 'x', null), { token: custA })).status,
      cod: (await api.postForm(`/orders/${cod.id}/slip`, slipForm(), { token: custA })).status,
      otherCustomerPost: (await api.postForm(`/orders/${bank.id}/slip`, slipForm(), { token: custB })).status,
      otherCustomerGet: (await api.get(`/orders/${bank.id}/slip`, { token: custB })).status,
      noToken: (await api.postForm(`/orders/${bank.id}/slip`, slipForm(), {})).status,
      agentRole: (await api.postForm(`/orders/${bank.id}/slip`, slipForm(), { token: agent })).status,
      unknownOrder: (await api.postForm(`/orders/${randomUUID()}/slip`, slipForm(), { token: custA })).status,
      unknownField: await (async () => { const f = slipForm(); f.append('status', 'verified'); return (await api.postForm(`/orders/${bank.id}/slip`, f, { token: custA })).status })(),
      adminNoKey: (await fetch(`${BASE_URL}/api/app/v1/admin/payment-slips`)).status,
    }
    expect(r).toEqual({ notImage: 400, noFile: 400, cod: 409, otherCustomerPost: 404, otherCustomerGet: 404, noToken: 401, agentRole: 403, unknownOrder: 404, unknownField: 400, adminNoKey: 401 })
    const rows = await db.one(`SELECT COUNT(*) AS n FROM order_payment_slips WHERE order_id IN (?, ?)`, [cod.id, bank.id])
    expect(Number(rows.n)).toBe(0)
    ev.add({ id: 'SLIP-02', action: 'Bank slip validation + isolation', api: j(r), cloud: 'no slip rows created for rejected uploads', pos: 'n/a', reverse: 'n/a', result: 'PASS' })
  })
})
