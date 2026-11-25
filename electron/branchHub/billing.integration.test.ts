import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { initializeBillingOutbox, nextBillingSnapshot, flushBillingSnapshots, claimBillingInvoice } from './billing'
import { BranchHubStore } from './store'
import { BranchPostgres, type PgClient } from './postgres'
import { PGlite } from '../../branch-hub/node_modules/@electric-sql/pglite'

let db: Database.Database
beforeEach(() => {
  db = new Database(':memory:')
  db.exec(`CREATE TABLE invoices(id TEXT PRIMARY KEY, invoice_number TEXT, branch_id TEXT, status TEXT);
    CREATE TABLE invoice_items(id TEXT PRIMARY KEY, invoice_id TEXT, quantity REAL);
    CREATE TABLE payments(id TEXT PRIMARY KEY, invoice_id TEXT, amount REAL);`)
  initializeBillingOutbox(db, 'BR1', 'T01')
})
afterEach(() => db.close())
function sale() {
  db.transaction(() => {
    claimBillingInvoice(db,'bill1')
    db.prepare('INSERT INTO invoices VALUES(?,?,?,?)').run('bill1','BR1-T01-INV-1','BR1','completed')
    db.prepare('INSERT INTO invoice_items VALUES(?,?,?)').run('item1','bill1',2)
    db.prepare('INSERT INTO payments VALUES(?,?,?)').run('payment1','bill1',100)
  })()
}
describe('durable terminal billing replication', () => {
  it('commits the complete snapshot intent with the sale and rolls it back with a failed sale', () => {
    expect(() => db.transaction(() => { sale(); throw new Error('rollback') })()).toThrow('rollback')
    expect(nextBillingSnapshot(db)).toBeUndefined()
    sale(); const event=nextBillingSnapshot(db)!
    expect(event.payload.items).toHaveLength(1);expect(event.payload.payments).toHaveLength(1)
    expect(db.prepare('SELECT count(*) AS n FROM branch_billing_outbox').get()).toEqual({n:1})
  })
  it('freezes retries across edits and never deletes a newer mutation after acknowledgement', async () => {
    sale();const original=nextBillingSnapshot(db)!
    db.prepare("UPDATE invoices SET status='cancelled' WHERE id='bill1'").run()
    expect(nextBillingSnapshot(db)).toEqual(original)
    await flushBillingSnapshots(db,async event=>{expect(event).toEqual(original);return true},1)
    const newer=nextBillingSnapshot(db)!
    expect(newer.event_id).not.toBe(original.event_id);expect(newer.payload.invoice.status).toBe('cancelled')
  })
  it('retains bills after a LAN error and replays after delivery worker restart', async () => {
    sale();const original=nextBillingSnapshot(db)
    await expect(flushBillingSnapshots(db,async()=>{throw new Error('LAN offline')})).rejects.toThrow('LAN offline')
    expect(nextBillingSnapshot(db)).toEqual(original)
    await flushBillingSnapshots(db,async()=>true);expect(nextBillingSnapshot(db)).toBeUndefined()
  })
  it('isolates branches and refuses reassigning a terminal database', () => {
    db.prepare('INSERT INTO invoices VALUES(?,?,?,?)').run('other','OTHER-1','BR2','completed')
    expect(nextBillingSnapshot(db)).toBeUndefined()
    expect(()=>initializeBillingOutbox(db,'BR1','T02')).toThrow(/different terminal/)
  })
  it('does not replay shared cloud invoices as locally owned bills', () => {
    db.prepare('INSERT INTO invoices VALUES(?,?,?,?)').run('shared','BR1-T02-INV-1','BR1','completed')
    db.prepare('INSERT INTO invoice_items VALUES(?,?,?)').run('shared-item','shared',2)
    db.prepare("UPDATE invoices SET status='cancelled' WHERE id='shared'").run()
    expect(nextBillingSnapshot(db)).toBeUndefined()
  })
  it('keeps a durable Hub copy, rejects cross-terminal ownership and wrong-branch payloads', () => {
    sale();const event=nextBillingSnapshot(db)!
    const hub=new BranchHubStore(':memory:','BR1')
    try {
      expect(hub.appendEvents('T01',[event])).toEqual([event.event_id]);hub.appendEvents('T01',[event])
      expect(hub.changes(0).events).toHaveLength(1)
      expect(()=>hub.appendEvents('T02',[{...event,event_id:'T02:invoice:3'}])).toThrow(/another terminal/)
      expect(()=>hub.appendEvents('T01',[{...event,event_id:'wrong',payload:{...event.payload,branch_id:'BR2'}}])).toThrow(/Invalid branch/)
    } finally {hub.close()}
  })
  it('checkpoints only after a PostgreSQL commit and retries a rejected transaction', async () => {
    sale();const event=nextBillingSnapshot(db)!,hub=new BranchHubStore(':memory:','BR1');hub.appendEvents('T01',[event])
    const queries:string[]=[];let fail=true
    const client:PgClient={release(){},async query(sql,values){
      queries.push(sql)
      if(sql.includes('SELECT branch_id FROM branch_pos_identity'))return {rows:[{branch_id:'BR1'}]}
      if(sql.includes('INSERT INTO branch_pos_events'))return {rows:[{terminal_id:'T01',payload_hash:(hub.db.prepare('SELECT payload_hash FROM hub_events').get() as any).payload_hash}]}
      if(sql.includes('INSERT INTO branch_pos_invoices')&&fail)throw new Error('temporary failure with secret credentials')
      if(sql.includes('SELECT terminal_id FROM branch_pos_invoices'))return {rows:[{terminal_id:'T01'}]}
      return {rows:[]}
    }}
    const worker=new BranchPostgres(hub,{async connect(){return client},async end(){}})
    try {
      await worker.flush();expect(queries).toContain('ROLLBACK');expect(worker.status().pending).toBe(1)
      expect(worker.status().error).not.toContain('secret')
      fail=false;await worker.flush();expect(queries).toContain('COMMIT');expect(worker.status().pending).toBe(0)
    } finally {await worker.close();hub.close()}
  })
  it('executes the PostgreSQL schema, JSONB projection, replay and later invoice updates on a PostgreSQL engine', async () => {
    const postgres = new PGlite()
    const hub = new BranchHubStore(':memory:', 'BR1')
    const pool = {
      async connect(): Promise<PgClient> { return {release(){},async query(sql,values){
        if(!values && sql.includes('CREATE TABLE')) {await postgres.exec(sql);return {rows:[]}}
        const result=await postgres.query<Record<string,unknown>>(sql,values);return {rows:result.rows}
      }} },
      async end(){await postgres.close()}
    }
    const worker=new BranchPostgres(hub,pool)
    try {
      sale();const original=nextBillingSnapshot(db)!;hub.appendEvents('T01',[original])
      await worker.flush();expect(worker.status().error).toBe('');expect(worker.status().pending).toBe(0)
      const stored=await postgres.query<{snapshot:any}>('SELECT snapshot FROM branch_pos_invoices')
      expect(stored.rows[0].snapshot.items).toHaveLength(1);expect(stored.rows[0].snapshot.payments[0].amount).toBe(100)
      hub.db.prepare('UPDATE hub_postgres_delivery SET cursor=0').run();await worker.flush()
      expect((await postgres.query<{n:number}>('SELECT count(*)::int AS n FROM branch_pos_events')).rows[0].n).toBe(1)
      await flushBillingSnapshots(db,async()=>true)
      db.prepare("UPDATE invoices SET status='cancelled' WHERE id='bill1'").run()
      hub.appendEvents('T01',[nextBillingSnapshot(db)!]);await worker.flush()
      expect(worker.status().error).toBe('')
      expect((await postgres.query<{snapshot:any}>('SELECT snapshot FROM branch_pos_invoices')).rows[0].snapshot.invoice.status).toBe('cancelled')
      // Replaying old transport events must not revert a newer invoice revision.
      hub.db.prepare('UPDATE hub_postgres_delivery SET cursor=0').run();await worker.flush()
      expect((await postgres.query<{snapshot:any}>('SELECT snapshot FROM branch_pos_invoices')).rows[0].snapshot.invoice.status).toBe('cancelled')
    } finally {await worker.close();hub.close()}
  },30000)
})
