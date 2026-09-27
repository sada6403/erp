import { describe, expect, it, vi } from 'vitest'
import { applySyncOperation } from '../../backend/lib/sync'
import { ensureSyncSchema } from '../../backend/lib/syncSchema'
import { ALLOWED_TABLES } from '../../backend/lib/sync'
import { duplicateStockGroups, identicalStockBalances } from '../../backend/lib/stockIdentity'

function client(options: { existing?: boolean; stocks?: object[]; deleteFails?: boolean } = {}) {
  return { release: vi.fn(), query: vi.fn(async (sql: string, values?: unknown[]) => {
    if (sql.includes('information_schema.COLUMNS')) return { rows: ['id','name','quantity','damaged_qty','product_id','branch_id','warehouse_id','updated_at'].map(COLUMN_NAME => ({ COLUMN_NAME })) }
    if (sql.includes('GET_LOCK')) return { rows: [{ acquired: 1 }] }
    if (sql.includes('FROM stocks') && sql.includes('FOR UPDATE')) return { rows: options.stocks || [] }
    if (sql.startsWith('SELECT id')) return { rows: options.existing ? [{ id: 'row' }] : [] }
    if (sql.startsWith('DELETE') && options.deleteFails) throw new Error('foreign key blocked')
    return { rows: [] }
  }) }
}

describe('Backend sync write contract', () => {
  it('timestamps offline uploads using server SQL time', async () => {
    const db = client()
    await applySyncOperation(db as any, { table: 'products', operation: 'INSERT', recordId: 'p', record: { id: 'p', name: 'Desk', updated_at: '2001-01-01T00:00:00.000Z' } })
    const insert = db.query.mock.calls.find(([sql]) => sql.startsWith('INSERT INTO `products`'))!
    expect(insert[0]).toContain('CURRENT_TIMESTAMP')
    expect(insert[1]).not.toContain('2001-01-01 00:00:00')
    expect(db.query.mock.calls.at(-1)?.[0]).toBe('COMMIT')
  })
  it('rejects UPDATE of an absent record instead of reporting zero-row success', async () => {
    const db = client()
    await expect(applySyncOperation(db as any, { table: 'products', operation: 'UPDATE', recordId: 'p', record: { name: 'New' } }))
      .rejects.toThrow('target is missing')
    expect(db.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK')
  })
  it('rolls a tombstone back if its deletion fails', async () => {
    const db = client({ deleteFails: true })
    await expect(applySyncOperation(db as any, { table: 'products', operation: 'DELETE', recordId: 'p', record: {} }))
      .rejects.toThrow('foreign key')
    expect(db.query.mock.calls.some(([sql]) => sql === 'COMMIT')).toBe(false)
    expect(db.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK')
  })
  it('matches a stock business key even when the device uses a different row ID', async () => {
    const db = client({ stocks: [{ id: 'canonical', quantity: 10, damaged_qty: 0 }] })
    await applySyncOperation(db as any, { table: 'stocks', operation: 'INSERT', recordId: 'device-id', record: {
      id: 'device-id', product_id: 'p', branch_id: 'b', quantity: 9, _base_stock: { quantity: 10, damaged_qty: 0 },
    } })
    const insert = db.query.mock.calls.find(([sql]) => sql.startsWith('INSERT INTO `stocks`'))!
    expect(insert[1]).toContain('canonical')
    expect(insert[1]).not.toContain('device-id')
    expect(db.query.mock.calls.at(-1)?.[0]).toContain('RELEASE_LOCK')
  })
  it('merges a stale device stock delta without overwriting another device balance', async () => {
    const db = client({ stocks: [{ id: 'canonical', quantity: 8, damaged_qty: 0 }] })
    await applySyncOperation(db as any, { table: 'stocks', operation: 'INSERT', recordId: 'p', record: {
      product_id: 'p', branch_id: 'b', quantity: 9, _base_stock: { quantity: 10 },
    } })
    const insert = db.query.mock.calls.find(([sql]) => sql.startsWith('INSERT INTO `stocks`'))!
    expect(insert[1]).toContain(7)
  })
  it('rejects a concurrent stock merge that would create a negative balance', async () => {
    const db = client({ stocks: [{ id: 'canonical', quantity: 2, damaged_qty: 0 }] })
    await expect(applySyncOperation(db as any, { table: 'stocks', operation: 'INSERT', recordId: 'p', record: {
      product_id: 'p', branch_id: 'b', quantity: 4, _base_stock: { quantity: 10 },
    } })).rejects.toThrow('would be negative')
    expect(db.query.mock.calls.some(([sql]) => sql.startsWith('INSERT INTO `stocks`'))).toBe(false)
  })
  it('refuses to pick one duplicate stock balance arbitrarily', async () => {
    const db = client({ stocks: [{ id: 'one', quantity: 1 }, { id: 'two', quantity: 2 }] })
    await expect(applySyncOperation(db as any, { table: 'stocks', operation: 'INSERT', recordId: 'p', record: {
      product_id: 'p', branch_id: 'b', quantity: 9,
    } })).rejects.toThrow('duplicate cloud balances')
  })
  it('acknowledges an already applied event without writing it twice', async () => {
    const db = client()
    db.query.mockImplementation(async (sql: string) => {
      if (sql.includes('GET_LOCK')) return { rows: [{ acquired: 1 }] }
      if (sql.startsWith('SELECT table_name')) return { rows: [{ table_name: 'products', record_id: 'p' }] }
      return { rows: [] }
    })
    await applySyncOperation(db as any, { eventId: 'event-1', table: 'products', operation: 'INSERT', recordId: 'p', record: { id: 'p' } })
    expect(db.query.mock.calls.some(([sql]) => sql.startsWith('INSERT INTO `products`'))).toBe(false)
    expect(db.query.mock.calls.at(-1)?.[0]).toBe('COMMIT')
  })
  it('rejects reuse of an event ID for another record', async () => {
    const db = client()
    db.query.mockImplementation(async (sql: string) => sql.startsWith('SELECT table_name')
      ? { rows: [{ table_name: 'products', record_id: 'other' }] } : { rows: [] })
    await expect(applySyncOperation(db as any, { eventId: 'event-1', table: 'products', operation: 'INSERT', recordId: 'p', record: { id: 'p' } }))
      .rejects.toThrow('identity mismatch')
    expect(db.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK')
  })
})

describe('Tenant synchronization schema contract', () => {
  it('deduplicates only equivalent business records without adding their balances', () => {
    const rows = [
      { id: 'a', product_id: 'p', branch_id: 'b', warehouse_id: null, quantity: '12', damaged_qty: 0 },
      { id: 'b', product_id: 'p', branch_id: 'b', warehouse_id: null, quantity: 12, damaged_qty: 0 },
    ]
    expect(duplicateStockGroups(rows)).toHaveLength(1)
    expect(identicalStockBalances(rows)).toBe(true)
    expect(identicalStockBalances([rows[0], { ...rows[1], quantity: 13 }])).toBe(false)
  })
  it('adds updated_at to every sync table that lacks it', async () => {
    const query = vi.fn(async (sql: string) => ({ rows: sql.startsWith('SELECT')
      ? [...ALLOWED_TABLES].map(TABLE_NAME => ({ TABLE_NAME, COLUMN_NAME: 'id' })) : [] }))
    await ensureSyncSchema({ query } as any)
    expect(query.mock.calls.filter(([sql]) => sql.startsWith('ALTER TABLE'))).toHaveLength(ALLOWED_TABLES.size)
  })
  it('propagates migration errors so an incomplete schema is not cached ready', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.startsWith('ALTER')) throw new Error('permission denied')
      return { rows: sql.startsWith('SELECT') ? [...ALLOWED_TABLES].map(TABLE_NAME => ({ TABLE_NAME, COLUMN_NAME: 'id' })) : [] }
    })
    await expect(ensureSyncSchema({ query } as any)).rejects.toThrow('permission denied')
  })
})
