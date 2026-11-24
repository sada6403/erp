import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import Database from 'better-sqlite3'
import WebSocket from 'ws'
import { createBranchHub } from './server'
import { BranchHubStore } from './store'
import { TerminalHubClient, type TerminalHubConfig } from './client'
import { LocalNumberedHolds } from './localHolds'

const tokens = { T01: 'a'.repeat(32), T02: 'b'.repeat(32) }
const cart = { items: [{ product: { id: 'milk', name: 'Milk' }, quantity: 2 }], bill_type: 'RETAIL', total_amount: 100, customer_name: 'Walk-in' }
let directory: string
let hub: ReturnType<typeof createBranchHub>
let url: string
let clients: TerminalHubClient[]
const config = (terminalId: 'T01' | 'T02'): TerminalHubConfig => ({ url, terminalId, branchId: 'BR01', token: tokens[terminalId] })
function terminal(id: 'T01' | 'T02', notify = () => {}) {
  const client = new TerminalHubClient(config(id), path.join(directory, `${id}.db`), notify)
  clients.push(client)
  return client
}
const request = <T = any>(client: TerminalHubClient, route: string, body?: unknown): Promise<T> => (client as any).request(route, body)

beforeEach(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'branchhub-test-'))
  hub = createBranchHub({ branchId: 'BR01', database: path.join(directory, 'hub.db'), terminals: tokens, backupDirectory: path.join(directory, 'backups') })
  url = `http://127.0.0.1:${await hub.listen(0)}`
  clients = []
})
afterEach(async () => {
  for (const client of clients) await client.close()
  await hub.close()
  // Only the exact temporary fixture directory may be recursively removed.
  if (path.dirname(path.resolve(directory)) !== path.resolve(os.tmpdir()) || !path.basename(directory).startsWith('branchhub-test-')) throw new Error('Unsafe test cleanup path')
  fs.rmSync(directory, { recursive: true, force: true })
})

describe('Branch Hub with real SQLite and LAN transport', () => {
  it('preserves cashier-entered numbers through sync, prevents duplicates and allows reuse after resume', async () => {
    const t1 = terminal('T01'), t2 = terminal('T02')
    expect(t1.createHold({ ...cart, hold_number: '25' }).hold_number).toBe('25')
    expect(() => t1.createHold({ ...cart, hold_number: '25' })).toThrow(/already in use/)
    await t1.syncOnce(); await t2.syncOnce()
    expect(t2.listHolds()[0].hold_number).toBe('25')
    expect(() => hub.store.createHold('T02', 'duplicate-25', { ...cart, hold_number: '25' })).toThrow(/already in use/)
    const first = await t1.recallHold('25')
    t1.acknowledgeRecall(String(first.recall_token))
    const second = t1.createHold({ ...cart, hold_number: '25', notes: 'second cart' })
    await t1.syncOnce(); await t2.syncOnce()
    expect(hub.store.resolveHold('25')).toBe(second.id)
    const restored = await t2.recallHold('25')
    expect(restored.notes).toBe('second cart')
    expect(restored.hold_number).toBe('25')
  })

  it('preserves both carts when two disconnected terminals choose the same number', async () => {
    const t1 = terminal('T01'), t2 = terminal('T02')
    t1.createHold({ ...cart, hold_number: '7' })
    t2.createHold({ ...cart, hold_number: '7', notes: 'offline second cashier' })
    await t1.syncOnce(); await t2.syncOnce()
    expect(t2.listHolds().find(h => h.source === 'blocked')?.error).toMatch(/already in use/)
    expect(t2.status().blocked).toBe(1)
    const local = await t2.recallHold('7')
    expect(local.notes).toBe('offline second cashier')
    t2.acknowledgeRecall(String(local.recall_token))
    t2.createHold({ ...cart, hold_number: '8', notes: local.notes })
    await t2.syncOnce()
    expect(t2.status().blocked).toBe(0)
    expect(hub.store.listHolds().map(h => h.hold_number).sort()).toEqual(['7', '8'])
  })

  it('supports manual numbers without configuring a Hub and retains them across restart', () => {
    const filename = path.join(directory, 'local-numbers.db')
    let local = new LocalNumberedHolds(filename)
    local.create('BR01', { ...cart, hold_number: '007' })
    expect(() => local.create('BR01', { ...cart, hold_number: '007' })).toThrow(/already in use/)
    local.close()
    local = new LocalNumberedHolds(filename)
    try {
      expect(local.list('BR01')[0].hold_number).toBe('007')
      expect(local.has('OTHER-BRANCH', '007')).toBe(false)
      expect(local.recall('BR01', '007').items).toEqual(cart.items)
      expect(local.create('BR01', { ...cart, hold_number: '007' }).hold_number).toBe('007')
    } finally { local.close() }
  })
  it('saves and recalls locally without contacting the Hub', async () => {
    const t1 = terminal('T01')
    const network = vi.spyOn(t1 as any, 'request')
    const held = t1.createHold(cart)
    expect(held.hold_number).toBe('H-T01-0001')
    expect(network).not.toHaveBeenCalled()
    const restored = await t1.recallHold(held.id)
    expect(restored.items).toEqual(cart.items)
    expect(network).not.toHaveBeenCalled()
    expect(t1.listHolds()[0].source).toBe('recovery')
    t1.acknowledgeRecall(String(restored.recall_token))
    expect(t1.listHolds()).toEqual([])
    await t1.syncOnce()
    expect(hub.store.listHolds()).toEqual([])
  })

  it('publishes one numbered hold and lets another terminal resume it', async () => {
    const t1 = terminal('T01'), t2 = terminal('T02')
    const held = t1.createHold(cart)
    await t1.syncOnce()
    await t2.syncOnce()
    expect(t2.listHolds()[0]).toMatchObject({ id: held.id, hold_number: 'H-01', source: 'hub' })
    // The number initially shown by the offline cashier remains a valid alias.
    const restored = await t2.recallHold(held.hold_number)
    expect(restored.items).toEqual(cart.items)
    t2.acknowledgeRecall(String(restored.recall_token))
    await t1.syncOnce()
    expect(t1.listHolds()).toEqual([])
    expect(hub.store.listHolds()).toEqual([])
  })

  it('allows exactly one of two simultaneous remote recalls', async () => {
    const t1 = terminal('T01'), t2 = terminal('T02')
    const held = t1.createHold(cart)
    await t1.syncOnce()
    const results = await Promise.allSettled([t1.recallHold(held.id), t2.recallHold(held.id)])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
  })

  it('runs reconnecting terminals with authenticated WebSockets and pushes hold changes', async () => {
    const t1 = terminal('T01'), t2 = terminal('T02')
    t1.start(); t2.start()
    await vi.waitFor(() => {
      expect((t1 as any).socket?.readyState).toBe(WebSocket.OPEN)
      expect((t2 as any).socket?.readyState).toBe(WebSocket.OPEN)
    }, { timeout: 5000 })
    await request(t1, '/v1/holds', { id: 'pushed-hold', payload: cart })
    await vi.waitFor(() => expect(t2.listHolds().some(hold => hold.id === 'pushed-hold')).toBe(true), { timeout: 5000 })
  })

  it('refuses to create Hub or terminal tables in an existing billing database', () => {
    const filename = path.join(directory, 'billing.db')
    const billing = new Database(filename)
    billing.exec('CREATE TABLE invoices(id TEXT PRIMARY KEY); INSERT INTO invoices VALUES (\'original\')')
    billing.close()
    expect(() => new BranchHubStore(filename, 'BR01')).toThrow(/non-Hub/)
    expect(() => new TerminalHubClient(config('T01'), filename)).toThrow(/existing POS/)
    const saved = new Database(filename, { readonly: true })
    try { expect(saved.prepare('SELECT * FROM invoices').all()).toEqual([{ id: 'original' }]) } finally { saved.close() }
  })

  it('replays a consumed hold after a lost response and terminal restart', async () => {
    let t1 = terminal('T01')
    const hold = hub.store.createHold('T02', 'shared-hold', cart)
    const response = hub.store.consumeHold('T01', 'stable-request', hold.id)
    t1.db.prepare("INSERT INTO terminal_hub_recalls VALUES (?,?,'pending',NULL,NULL,?)").run('stable-request', hold.id, new Date().toISOString())
    await t1.close(); clients = []
    t1 = terminal('T01')
    await t1.syncOnce()
    expect(t1.status().recoverable).toBe(1)
    const restored = await t1.recallHold('recovery:stable-request')
    expect(restored.items).toEqual(response.payload.items)
    expect(() => hub.store.consumeHold('T02', 'other-request', hold.id)).toThrow(/already resumed/)
  })

  it('does not resurrect a delivered recall when a late parallel replay completes', async () => {
    const t1 = terminal('T01')
    const hold = hub.store.createHold('T02', 'late-response-hold', cart)
    const restored = await t1.recallHold(hold.id)
    t1.acknowledgeRecall(String(restored.recall_token))
    const replay = hub.store.consumeHold('T01', String(restored.recall_token), hold.id)
    ;(t1 as any).finishRecall(String(restored.recall_token), replay)
    expect(t1.status().recoverable).toBe(0)
    await expect(t1.recallHold(hold.id)).rejects.toThrow(/already restored/)
  })

  it('retries an ambiguous publication with the same ID and never recalls it offline twice', async () => {
    let t1 = terminal('T01')
    const held = t1.createHold(cart)
    const original = (t1 as any).request.bind(t1)
    vi.spyOn(t1 as any, 'request').mockImplementation(async (...args: unknown[]) => {
      const result = await original(...args)
      if (args[0] === '/v1/holds') throw new Error('Response lost after Hub commit')
      return result
    })
    await t1.syncOnce()
    expect(t1.listHolds()[0].source).toBe('publishing')
    await expect(t1.recallHold(held.id)).rejects.toThrow(/ownership/)
    await t1.close(); clients = []
    t1 = terminal('T01')
    await t1.syncOnce()
    expect(hub.store.listHolds()).toHaveLength(1)
    expect(t1.listHolds()[0].hold_number).toBe('H-01')
  })

  it('keeps working locally while Hub is down and drains pending holds after restart', async () => {
    const t1 = terminal('T01')
    const port = Number(new URL(url).port)
    await hub.close()
    await t1.syncOnce()
    expect(t1.status().hub_online).toBe(false)
    t1.createHold(cart)
    expect(t1.status().pending).toBe(1)
    hub = createBranchHub({ branchId: 'BR01', database: path.join(directory, 'hub.db'), terminals: tokens })
    await hub.listen(port)
    await t1.syncOnce()
    expect(t1.status()).toMatchObject({ hub_online: true, pending: 0 })
    expect(hub.store.listHolds()[0].hold_number).toBe('H-01')
  })

  it('sums concurrent stock deltas, deduplicates retry and persists the cloud outbox', async () => {
    const t1 = terminal('T01'), t2 = terminal('T02')
    const a = { event_id: 'sale-a', kind: 'stock.delta', payload: { product_id: 'milk', delta: -2 } }
    const b = { event_id: 'sale-b', kind: 'stock.delta', payload: { product_id: 'milk', delta: -3 } }
    await Promise.all([request(t1, '/v1/events', { events: [a] }), request(t2, '/v1/events', { events: [b] })])
    await request(t1, '/v1/events', { events: [a] })
    expect(hub.store.db.prepare('SELECT quantity FROM hub_stock_balances').get()).toEqual({ quantity: -5 })
    expect(hub.store.pendingCloud()).toBe(2)
    expect(hub.store.changes(0).events).toHaveLength(2)
    const first = hub.store.changes(0, 1)
    expect(hub.store.changes(first.cursor).events).toHaveLength(1)
    await expect(request(t1, '/v1/events', { events: [{ ...a, payload: { product_id: 'milk', delta: -9 } }] })).rejects.toThrow(/reused/)
  })

  it('rolls back a whole invalid batch and protects immutable paid bill identities', () => {
    expect(() => hub.store.appendEvents('T01', [
      { event_id: 'valid', kind: 'stock.delta', payload: { product_id: 'milk', delta: 10 } },
      { event_id: 'invalid', kind: 'stock.delta', payload: { product_id: 'milk', delta: 0 } },
    ])).toThrow()
    expect(hub.store.pendingCloud()).toBe(0)
    expect(hub.store.db.prepare('SELECT * FROM hub_stock_balances').all()).toEqual([])
    const event = { event_id: 'paid', kind: 'bill.paid' as const, payload: { bill_id: 'bill-1', bill_number: 'BR01-T01-000001', items: cart.items } }
    hub.store.appendEvents('T01', [event])
    expect(() => hub.store.appendEvents('T02', [{ ...event, event_id: 'paid-again' }])).toThrow(/already exists/)
  })

  it('validates event inputs and keeps decimal stock projections stable', async () => {
    const t1 = terminal('T01')
    await expect(request(t1, '/v1/events', { events: [null] })).rejects.toMatchObject({ status: 400 })
    hub.store.appendEvents('T01', [
      { event_id: 'decimal-a', kind: 'stock.delta', payload: { product_id: 'milk', delta: 0.1 } },
      { event_id: 'decimal-b', kind: 'stock.delta', payload: { product_id: 'milk', delta: 0.2 } },
    ])
    expect(hub.store.db.prepare('SELECT quantity FROM hub_stock_balances').get()).toEqual({ quantity: 0.3 })
    expect(() => hub.store.appendEvents('T01', [{ event_id: 'too-large', kind: 'stock.delta', payload: { product_id: 'milk', delta: 1e50 } }])).toThrow(/safe numeric/)
  })

  it('rejects credentials from another branch and protects database identity', async () => {
    const wrong = new TerminalHubClient({ ...config('T01'), branchId: 'BR02' }, path.join(directory, 'wrong.db'))
    clients.push(wrong)
    await expect(request(wrong, '/v1/status')).rejects.toMatchObject({ status: 401 })
    expect(() => new BranchHubStore(path.join(directory, 'hub.db'), 'BR02')).toThrow(/different branch/)
  })

  it('sends authenticated WebSocket change notifications and verifies backup contents', async () => {
    const socket = new WebSocket(`${url.replace('http:', 'ws:')}/v1/ws`, { headers: { authorization: `Bearer ${tokens.T01}`, 'x-pos-terminal': 'T01', 'x-pos-branch': 'BR01' } })
    try {
      await new Promise<void>((resolve, reject) => { socket.once('message', () => resolve()); socket.once('error', reject) })
      const changed = new Promise<string>(resolve => socket.once('message', data => resolve(String(data))))
      await request(terminal('T01'), '/v1/holds', { id: 'ws-hold', payload: cart })
      expect(JSON.parse(await changed).type).toBe('hub.changed')
      const backup = await hub.backup()
      const saved = new Database(backup!, { readonly: true })
      try {
        expect(saved.pragma('integrity_check', { simple: true })).toBe('ok')
        expect(saved.prepare('SELECT count(*) AS n FROM hub_holds').get()).toEqual({ n: 1 })
      } finally { saved.close() }
    } finally { socket.terminate() }
  })

  it('allocates daily numbers by branch timezone and flags old holds without deleting them', () => {
    let now = new Date('2026-11-22T18:29:00Z')
    const store = new BranchHubStore(':memory:', 'BR01', 'Asia/Colombo', () => now)
    try {
      expect(store.createHold('T01', 'day-one', cart).hold_number).toBe('H-01')
      now = new Date('2026-11-22T18:31:00Z')
      expect(store.createHold('T02', 'day-two', cart).hold_number).toBe('H-01')
      expect(store.listHolds().find(h => h.id === 'day-one')?.overdue).toBe(true)
      expect(store.consumeHold('T01', 'today', 'H-01').id).toBe('day-two')
      expect(store.consumeHold('T01', 'old-day', 'day-one').id).toBe('day-one')
    } finally { store.close() }
  })
})
