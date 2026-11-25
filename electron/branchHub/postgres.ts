import type { BranchHubStore } from './store'

export interface PgClient {
  query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }>
  release(): void
}
export interface PgPool { connect(): Promise<PgClient>; end(): Promise<void>; on?(event: string, handler: () => void): void }

/** The branch server is the only process with PostgreSQL credentials.
 * PostgreSQL outages never block the LAN SQLite receipt acknowledgement. */
export class BranchPostgres {
  private running = false
  private ready = false
  private lastError = ''
  constructor(private store: BranchHubStore, private pool: PgPool) {
    store.db.exec(`CREATE TABLE IF NOT EXISTS hub_postgres_delivery (
      singleton INTEGER PRIMARY KEY CHECK(singleton=1), cursor INTEGER NOT NULL DEFAULT 0);
      INSERT OR IGNORE INTO hub_postgres_delivery VALUES(1,0);`)
  }
  status() {
    const cursor = Number((this.store.db.prepare('SELECT cursor FROM hub_postgres_delivery WHERE singleton=1').get() as { cursor: number }).cursor)
    const pending = Number((this.store.db.prepare('SELECT count(*) AS n FROM hub_events WHERE cursor>?').get(cursor) as { n: number }).n)
    return { configured: true, connected: this.ready && !this.lastError, pending, error: this.lastError }
  }
  async flush() {
    if (this.running) return
    this.running = true
    let client: PgClient | undefined
    try {
      client = await this.pool.connect()
      if (!this.ready) {
        await client.query(`CREATE TABLE IF NOT EXISTS branch_pos_identity (
          singleton INTEGER PRIMARY KEY CHECK(singleton=1), branch_id TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS branch_pos_events (
            branch_id TEXT NOT NULL, event_id TEXT NOT NULL, terminal_id TEXT NOT NULL,
            kind TEXT NOT NULL, payload JSONB NOT NULL, payload_hash TEXT NOT NULL,
            received_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY(branch_id,event_id));
          CREATE TABLE IF NOT EXISTS branch_pos_invoices (
            branch_id TEXT NOT NULL, invoice_id TEXT NOT NULL, invoice_number TEXT NOT NULL,
            terminal_id TEXT NOT NULL, revision BIGINT NOT NULL, snapshot JSONB NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY(branch_id,invoice_id), UNIQUE(branch_id,invoice_number));
          CREATE INDEX IF NOT EXISTS branch_pos_invoices_updated ON branch_pos_invoices(updated_at);`)
        await client.query('INSERT INTO branch_pos_identity(singleton,branch_id) VALUES(1,$1) ON CONFLICT(singleton) DO NOTHING', [this.store.branchId])
        const identity = await client.query('SELECT branch_id FROM branch_pos_identity WHERE singleton=1')
        if (identity.rows[0]?.branch_id !== this.store.branchId) throw new Error('PostgreSQL branch identity mismatch')
        this.ready = true
      }
      const cursor = Number((this.store.db.prepare('SELECT cursor FROM hub_postgres_delivery WHERE singleton=1').get() as { cursor: number }).cursor)
      const events = this.store.db.prepare('SELECT * FROM hub_events WHERE cursor>? ORDER BY cursor LIMIT 50').all(cursor) as Record<string, unknown>[]
      if (events.length) {
        await client.query('BEGIN')
        try {
          for (const event of events) {
            const recorded = await client.query(`INSERT INTO branch_pos_events(branch_id,event_id,terminal_id,kind,payload,payload_hash)
              VALUES($1,$2,$3,$4,$5::jsonb,$6) ON CONFLICT(branch_id,event_id) DO UPDATE
              SET event_id=EXCLUDED.event_id RETURNING terminal_id,payload_hash`,
              [this.store.branchId,event.event_id,event.terminal_id,event.kind,event.payload,event.payload_hash])
            if (recorded.rows[0]?.terminal_id !== event.terminal_id || recorded.rows[0]?.payload_hash !== event.payload_hash) throw new Error('PostgreSQL event replay conflict')
            if (event.kind === 'invoice.snapshot') {
              const payload = JSON.parse(String(event.payload))
              await client.query(`INSERT INTO branch_pos_invoices(branch_id,invoice_id,invoice_number,terminal_id,revision,snapshot)
                VALUES($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT(branch_id,invoice_id) DO UPDATE
                SET invoice_number=EXCLUDED.invoice_number,revision=EXCLUDED.revision,snapshot=EXCLUDED.snapshot,updated_at=CURRENT_TIMESTAMP
                WHERE branch_pos_invoices.terminal_id=EXCLUDED.terminal_id AND branch_pos_invoices.revision<EXCLUDED.revision`,
                [this.store.branchId,payload.bill_id,payload.bill_number,event.terminal_id,payload.revision,event.payload])
              const owner = await client.query('SELECT terminal_id FROM branch_pos_invoices WHERE branch_id=$1 AND invoice_id=$2', [this.store.branchId,payload.bill_id])
              if (owner.rows[0]?.terminal_id !== event.terminal_id) throw new Error('PostgreSQL invoice terminal conflict')
            }
          }
          await client.query('COMMIT')
        } catch (err) { await client.query('ROLLBACK'); throw err }
        // Crash after COMMIT/before this checkpoint replays safely on restart.
        this.store.db.prepare('UPDATE hub_postgres_delivery SET cursor=? WHERE singleton=1').run(events[events.length-1].cursor)
      }
      this.lastError = ''
    } catch {
      // Never return driver messages: connection errors may contain credentials.
      this.lastError = 'Branch PostgreSQL delivery pending; check server connection, identity and invoice conflicts'
    } finally { client?.release(); this.running = false }
  }
  async close() {
    while (this.running) await new Promise(resolve => setTimeout(resolve, 20))
    await this.pool.end()
  }
}
