import Database from 'better-sqlite3'
import { randomUUID } from 'crypto'
import { manualHoldNumber } from '../lib/holdNumber'

/** Numbered local holds use a new sidecar; legacy POS tables stay untouched. */
export class LocalNumberedHolds {
  readonly db: Database.Database
  constructor(filename: string) {
    this.db = new Database(filename)
    const tables = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]
    if (tables.length && !tables.some(table => table.name === 'manual_local_holds')) { this.db.close(); throw new Error('Not a numbered-hold sidecar database') }
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('synchronous = FULL')
    this.db.exec(`CREATE TABLE IF NOT EXISTS manual_local_holds (
      id TEXT PRIMARY KEY, branch_id TEXT NOT NULL, number TEXT NOT NULL,
      payload TEXT NOT NULL, state TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS manual_local_hold_active ON manual_local_holds(branch_id,number) WHERE state='available';`)
  }
  has(branch: string, key: string) {
    return Boolean(this.db.prepare("SELECT id FROM manual_local_holds WHERE branch_id=? AND state='available' AND (id=? OR number=?)").get(branch, key.replace(/^local-manual:/, ''), key))
  }
  create(branch: string, payload: Record<string, unknown>) {
    const number = manualHoldNumber(payload.hold_number)
    if (!Array.isArray(payload.items) || !payload.items.length) throw new Error('Cannot hold an empty cart')
    return this.db.transaction(() => {
      if (this.has(branch, number)) throw new Error('Hold number is already in use; choose another number')
      const id = randomUUID()
      this.db.prepare("INSERT INTO manual_local_holds VALUES (?,?,?,?,'available',?)").run(id, branch, number, JSON.stringify(payload), new Date().toISOString())
      return { id: `local-manual:${id}`, hold_number: number }
    }).immediate()
  }
  list(branch: string) {
    return (this.db.prepare("SELECT * FROM manual_local_holds WHERE branch_id=? AND state='available' ORDER BY created_at DESC,rowid DESC").all(branch) as Record<string, unknown>[])
      .map(row => { const payload = JSON.parse(String(row.payload)); return { ...payload, id: `local-manual:${row.id}`, hold_number: row.number, source: 'manual-local', item_count: payload.items.length, created_at: row.created_at } })
  }
  recall(branch: string, key: string) {
    return this.db.transaction(() => {
      const row = this.db.prepare("SELECT * FROM manual_local_holds WHERE branch_id=? AND state='available' AND (id=? OR number=?)").get(branch, key.replace(/^local-manual:/, ''), key) as Record<string, unknown> | undefined
      if (!row) throw new Error('Held bill not found')
      this.db.prepare("UPDATE manual_local_holds SET state='consumed' WHERE id=?").run(row.id)
      return JSON.parse(String(row.payload)) as Record<string, unknown>
    }).immediate()
  }
  close() { this.db.close() }
}
