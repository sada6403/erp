import Database from 'better-sqlite3'
import { createHash } from 'crypto'
import { manualHoldNumber } from '../lib/holdNumber'

export class HubError extends Error {
  constructor(message: string, public status = 400) { super(message) }
}

export interface HubHold {
  id: string
  hold_number: string
  local_number?: string | null
  business_day: string
  terminal_id: string
  payload: Record<string, unknown>
  state: 'available' | 'consumed'
  created_at: string
}

const digest = (payload: unknown) => createHash('sha256').update(JSON.stringify(payload)).digest('hex')
export function businessDay(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date)
  const get = (type: string) => parts.find(p => p.type === type)!.value
  return `${get('year')}-${get('month')}-${get('day')}`
}

/** Separate Hub DB; never opens or migrates an existing terminal database. */
export class BranchHubStore {
  readonly db: Database.Database
  constructor(filename: string, readonly branchId: string, readonly timezone = 'Asia/Colombo', private now = () => new Date()) {
    businessDay(this.now(), timezone) // Validate before creating any files/tables.
    if (!branchId) throw new Error('Hub branch ID is required')
    this.db = new Database(filename)
    const existingTables = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]
    if (existingTables.length && !existingTables.some(table => table.name === 'hub_identity')) { this.db.close(); throw new Error('Refusing to initialize Hub tables in an existing non-Hub database') }
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('synchronous = FULL')
    this.db.pragma('busy_timeout = 5000')
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS hub_identity (singleton INTEGER PRIMARY KEY CHECK(singleton=1), branch_id TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS hub_hold_sequences (business_day TEXT PRIMARY KEY, next_value INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS hub_holds (
        id TEXT PRIMARY KEY, hold_number TEXT NOT NULL, business_day TEXT NOT NULL,
        terminal_id TEXT NOT NULL, payload TEXT NOT NULL, payload_hash TEXT NOT NULL, local_number TEXT UNIQUE,
        state TEXT NOT NULL DEFAULT 'available', consumed_by TEXT, created_at TEXT NOT NULL,
        UNIQUE(business_day, hold_number));
      CREATE INDEX IF NOT EXISTS hub_holds_available ON hub_holds(state,business_day,created_at);
      CREATE UNIQUE INDEX IF NOT EXISTS hub_manual_hold_active ON hub_holds(json_extract(payload,'$.hold_number'))
        WHERE state='available' AND json_extract(payload,'$.hold_number') IS NOT NULL;
      CREATE TABLE IF NOT EXISTS hub_requests (
        terminal_id TEXT NOT NULL, request_id TEXT NOT NULL, payload_hash TEXT NOT NULL, response TEXT NOT NULL,
        PRIMARY KEY(terminal_id,request_id));
      CREATE TABLE IF NOT EXISTS hub_events (
        cursor INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL UNIQUE, terminal_id TEXT NOT NULL,
        kind TEXT NOT NULL, payload TEXT NOT NULL, payload_hash TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS hub_paid_bill_id ON hub_events(json_extract(payload,'$.bill_id')) WHERE kind='bill.paid';
      CREATE UNIQUE INDEX IF NOT EXISTS hub_paid_bill_number ON hub_events(json_extract(payload,'$.bill_number')) WHERE kind='bill.paid';
      CREATE TABLE IF NOT EXISTS hub_stock_balances (
        product_id TEXT NOT NULL, variant_id TEXT NOT NULL DEFAULT '', quantity REAL NOT NULL,
        PRIMARY KEY(product_id,variant_id));
      CREATE TABLE IF NOT EXISTS hub_cloud_outbox (
        event_id TEXT PRIMARY KEY, attempts INTEGER NOT NULL DEFAULT 0, next_retry_at TEXT,
        acknowledged_at TEXT, last_error TEXT);
      CREATE INDEX IF NOT EXISTS hub_cloud_pending ON hub_cloud_outbox(acknowledged_at,next_retry_at);
    `)
    const identity = this.db.prepare('SELECT branch_id FROM hub_identity WHERE singleton=1').get() as { branch_id: string } | undefined
    if (identity && identity.branch_id !== branchId) { this.db.close(); throw new Error('Hub database belongs to a different branch') }
    this.db.prepare('INSERT OR IGNORE INTO hub_identity VALUES (1,?)').run(branchId)
  }

  private decode(row: Record<string, unknown>): HubHold {
    const payload = JSON.parse(String(row.payload))
    return { ...row, hold_number: row.manual_number || payload.hold_number || row.hold_number, payload } as unknown as HubHold
  }

  createHold(terminal: string, id: string, payload: Record<string, unknown>, localNumber?: string): HubHold {
    if (typeof id !== 'string' || !id || id.length > 100 || !payload || !Array.isArray(payload.items) || !payload.items.length) throw new HubError('A non-empty hold and stable ID are required')
    const hash = digest(payload)
    const manual = payload.hold_number == null ? undefined : manualHoldNumber(payload.hold_number)
    if (manual !== undefined && manual !== payload.hold_number) throw new HubError('Hold number must be trimmed')
    if (localNumber && (typeof localNumber !== 'string' || !localNumber.startsWith(`H-${terminal}-`) || !/^\d{4,}$/.test(localNumber.slice(terminal.length + 3)))) throw new HubError('Invalid terminal hold number')
    return this.db.transaction(() => {
      const existing = this.db.prepare('SELECT * FROM hub_holds WHERE id=?').get(id) as Record<string, unknown> | undefined
      if (existing) {
        if (existing.terminal_id !== terminal || existing.payload_hash !== hash || (existing.local_number || undefined) !== localNumber) throw new HubError('Hold ID reused with different content or terminal', 409)
        return this.decode(existing)
      }
      const date = this.now()
      if (manual && this.db.prepare("SELECT id FROM hub_holds WHERE state='available' AND json_extract(payload,'$.hold_number')=?").get(manual)) throw new HubError('Hold number is already in use; choose another number', 409)
      const day = businessDay(date, this.timezone)
      this.db.prepare('INSERT OR IGNORE INTO hub_hold_sequences VALUES (?,1)').run(day)
      const { next_value: number } = this.db.prepare('SELECT next_value FROM hub_hold_sequences WHERE business_day=?').get(day) as { next_value: number }
      this.db.prepare('UPDATE hub_hold_sequences SET next_value=next_value+1 WHERE business_day=?').run(day)
      const hold: HubHold = { id, hold_number: `H-${String(number).padStart(2, '0')}`, local_number: localNumber, business_day: day, terminal_id: terminal, payload, state: 'available', created_at: date.toISOString() }
      this.db.prepare('INSERT INTO hub_holds (id,hold_number,business_day,terminal_id,payload,payload_hash,local_number,created_at) VALUES (?,?,?,?,?,?,?,?)')
        .run(id, hold.hold_number, day, terminal, JSON.stringify(payload), hash, localNumber || null, hold.created_at)
      return { ...hold, hold_number: manual || hold.hold_number }
    }).immediate()
  }

  listHolds(): (HubHold & { overdue: boolean })[] {
    const today = businessDay(this.now(), this.timezone)
    return (this.db.prepare("SELECT id,hold_number,local_number,json_extract(payload,'$.hold_number') AS manual_number,business_day,terminal_id,state,created_at,json_object('customer_name',json_extract(payload,'$.customer_name'),'item_count',json_array_length(json_extract(payload,'$.items')),'total_amount',json_extract(payload,'$.total_amount'),'bill_type',json_extract(payload,'$.bill_type')) AS payload FROM hub_holds WHERE state='available' ORDER BY created_at DESC LIMIT 500").all() as Record<string, unknown>[])
      .map(row => ({ ...this.decode(row), overdue: String(row.business_day) < today }))
  }

  resolveHold(number: string): string {
    const row = this.db.prepare("SELECT id FROM hub_holds WHERE state='available' AND json_extract(payload,'$.hold_number')=?").get(manualHoldNumber(number)) as { id: string } | undefined
    if (!row) throw new HubError('Held bill not found', 404)
    return row.id
  }

  /** Atomic consumption with durable replay: a lost HTTP response is retried
   * with the same terminal/request ID and returns the original cart. */
  consumeHold(terminal: string, requestId: string, idOrNumber: string): HubHold {
    if (typeof requestId !== 'string' || !requestId || requestId.length > 100 || typeof idOrNumber !== 'string' || !idOrNumber || idOrNumber.length > 100) throw new HubError('Recall request ID and hold are required')
    const hash = digest({ idOrNumber })
    return this.db.transaction(() => {
      const previous = this.db.prepare('SELECT * FROM hub_requests WHERE terminal_id=? AND request_id=?').get(terminal, requestId) as Record<string, unknown> | undefined
      if (previous) {
        if (previous.payload_hash !== hash) throw new HubError('Recall request ID reused', 409)
        return JSON.parse(String(previous.response)) as HubHold
      }
      const row = this.db.prepare("SELECT * FROM hub_holds WHERE id=? OR (hold_number=? AND business_day=?) OR local_number=? OR (state='available' AND json_extract(payload,'$.hold_number')=?) ORDER BY CASE WHEN id=? THEN 0 ELSE 1 END LIMIT 1")
        .get(idOrNumber, idOrNumber.toUpperCase(), businessDay(this.now(), this.timezone), idOrNumber.toUpperCase(), idOrNumber, idOrNumber) as Record<string, unknown> | undefined
      if (!row) throw new HubError('Held bill not found', 404)
      if (row.state !== 'available') throw new HubError('Another terminal already resumed this hold', 409)
      const updated = this.db.prepare("UPDATE hub_holds SET state='consumed',consumed_by=? WHERE id=? AND state='available'").run(terminal, row.id)
      if (updated.changes !== 1) throw new HubError('Hold is no longer available', 409)
      const hold = this.decode({ ...row, state: 'consumed' })
      this.db.prepare('INSERT INTO hub_requests VALUES (?,?,?,?)').run(terminal, requestId, hash, JSON.stringify(hold))
      return hold
    }).immediate()
  }

  /** Transport contract for future billing cutover. Append-only delta events,
   * not absolute legacy stock rows. Inbox, projection and cloud outbox commit together. */
  appendEvents(terminal: string, events: { event_id: string; kind: 'stock.delta' | 'bill.paid'; payload: Record<string, unknown> }[]): string[] {
    if (!Array.isArray(events) || !events.length || events.length > 500) throw new HubError('Batch must contain 1–500 events')
    return this.db.transaction(() => {
      for (const event of events) {
        if (!event || typeof event.event_id !== 'string' || !event.event_id || event.event_id.length > 100 || !['stock.delta', 'bill.paid'].includes(event.kind) || !event.payload || typeof event.payload !== 'object' || Array.isArray(event.payload)) throw new HubError('Invalid event')
        const hash = digest({ kind: event.kind, payload: event.payload })
        const previous = this.db.prepare('SELECT terminal_id,payload_hash FROM hub_events WHERE event_id=?').get(event.event_id) as { terminal_id: string; payload_hash: string } | undefined
        if (previous) {
          if (previous.terminal_id !== terminal || previous.payload_hash !== hash) throw new HubError('Event ID reused with different content', 409)
          continue
        }
        if (event.kind === 'stock.delta') {
          const { product_id, variant_id, delta } = event.payload
          if (typeof product_id !== 'string' || !product_id || typeof delta !== 'number' || !Number.isFinite(delta) || delta === 0 || (variant_id != null && typeof variant_id !== 'string')) throw new HubError('Invalid stock delta')
          if (!Number.isSafeInteger(Math.round(delta * 1e6)) || Math.abs(delta * 1e6 - Math.round(delta * 1e6)) > 0.001) throw new HubError('Stock delta supports at most six decimal places within the safe numeric range')
          this.db.prepare('INSERT INTO hub_stock_balances VALUES (?,?,?) ON CONFLICT(product_id,variant_id) DO UPDATE SET quantity=round(quantity+excluded.quantity,6)')
            .run(product_id, variant_id || '', delta)
        } else {
          if (typeof event.payload.bill_id !== 'string' || !event.payload.bill_id || typeof event.payload.bill_number !== 'string' || !event.payload.bill_number || !Array.isArray(event.payload.items) || !event.payload.items.length) throw new HubError('Invalid paid bill event')
          const collision = this.db.prepare("SELECT event_id FROM hub_events WHERE kind='bill.paid' AND (json_extract(payload,'$.bill_id')=? OR json_extract(payload,'$.bill_number')=?)").get(event.payload.bill_id, event.payload.bill_number)
          if (collision) throw new HubError('Paid bill identity or number already exists', 409)
        }
        this.db.prepare('INSERT INTO hub_events(event_id,terminal_id,kind,payload,payload_hash,created_at) VALUES (?,?,?,?,?,?)')
          .run(event.event_id, terminal, event.kind, JSON.stringify(event.payload), hash, this.now().toISOString())
        this.db.prepare('INSERT INTO hub_cloud_outbox(event_id) VALUES (?)').run(event.event_id)
      }
      return events.map(event => event.event_id)
    }).immediate()
  }

  changes(after: number, limit = 500): { cursor: number; events: Record<string, unknown>[] } {
    if (!Number.isSafeInteger(after) || after < 0) throw new HubError('Invalid cursor')
    const events = this.db.prepare('SELECT cursor,event_id,terminal_id,kind,payload,created_at FROM hub_events WHERE cursor>? ORDER BY cursor LIMIT ?').all(after, Math.max(1, Math.min(limit, 500))) as Record<string, unknown>[]
    return { cursor: events.length ? Number(events[events.length - 1].cursor) : after, events: events.map(event => ({ ...event, payload: JSON.parse(String(event.payload)) })) }
  }

  pendingCloud(): number { return (this.db.prepare('SELECT count(*) AS n FROM hub_cloud_outbox WHERE acknowledged_at IS NULL').get() as { n: number }).n }
  close() { this.db.close() }
}
