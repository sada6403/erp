import type Database from 'better-sqlite3'

export interface BillingSnapshot extends Record<string, unknown> {
  bill_id: string; bill_number: string; revision: number; branch_id: string
  invoice: Record<string, unknown>; items: Record<string, unknown>[]; payments: Record<string, unknown>[]
}

/** This outbox lives in the billing DB, so sale and replication intent commit together.
 * No network call or second database participates in the cashier transaction. */
export function initializeBillingOutbox(db: Database.Database, branchId: string, terminalId: string) {
  return db.transaction(() => installBillingOutbox(db, branchId, terminalId)).immediate()
}

function installBillingOutbox(db: Database.Database, branchId: string, terminalId: string) {
  if (!branchId || !/^[A-Za-z0-9_-]{1,40}$/.test(terminalId)) throw new Error('Invalid billing terminal identity')
  db.exec(`CREATE TABLE IF NOT EXISTS branch_billing_identity (
    singleton INTEGER PRIMARY KEY CHECK(singleton=1), branch_id TEXT NOT NULL, terminal_id TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS branch_billing_outbox (
      revision INTEGER PRIMARY KEY AUTOINCREMENT, invoice_id TEXT NOT NULL, payload TEXT);
    CREATE TABLE IF NOT EXISTS branch_billing_owned (invoice_id TEXT PRIMARY KEY);
    CREATE INDEX IF NOT EXISTS branch_billing_pending_invoice ON branch_billing_outbox(invoice_id,revision);`)
  const identity = db.prepare('SELECT * FROM branch_billing_identity WHERE singleton=1').get() as { branch_id: string; terminal_id: string } | undefined
  if (identity && (identity.branch_id !== branchId || identity.terminal_id !== terminalId)) throw new Error('Billing database belongs to a different terminal; do not clone terminal databases')
  db.prepare('INSERT OR IGNORE INTO branch_billing_identity VALUES (1,?,?)').run(branchId, terminalId)
  // SQLite trigger bodies cannot bind values. SQL-quote the validated branch identity.
  const branch = "'" + branchId.replace(/'/g, "''") + "'"
  for (const operation of ['INSERT', 'UPDATE'] as const) {
    db.exec(`CREATE TRIGGER IF NOT EXISTS branch_invoice_${operation.toLowerCase()} AFTER ${operation} ON invoices
      WHEN NEW.branch_id=${branch} AND EXISTS(SELECT 1 FROM branch_billing_owned WHERE invoice_id=NEW.id) BEGIN
      INSERT INTO branch_billing_outbox(invoice_id) VALUES(NEW.id); END;`)
  }
  for (const table of ['invoice_items', 'payments']) {
    for (const operation of ['INSERT', 'UPDATE', 'DELETE'] as const) {
      const row = operation === 'DELETE' ? 'OLD' : 'NEW'
      db.exec(`CREATE TRIGGER IF NOT EXISTS branch_${table}_${operation.toLowerCase()} AFTER ${operation} ON ${table}
        WHEN EXISTS(SELECT 1 FROM invoices i JOIN branch_billing_owned o ON o.invoice_id=i.id WHERE i.id=${row}.invoice_id AND i.branch_id=${branch}) BEGIN
        INSERT INTO branch_billing_outbox(invoice_id) VALUES(${row}.invoice_id); END;`)
    }
  }
}

/** Call inside the local sale transaction, before INSERT. Cloud pulls never claim ownership. */
export function claimBillingInvoice(db: Database.Database, invoiceId: string) {
  if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='branch_billing_owned'").get()) {
    db.prepare('INSERT OR IGNORE INTO branch_billing_owned(invoice_id) VALUES(?)').run(invoiceId)
  }
}

export function nextBillingSnapshot(db: Database.Database): { event_id: string; kind: 'invoice.snapshot'; payload: BillingSnapshot } | undefined {
  return db.transaction(() => {
    const identity = db.prepare('SELECT * FROM branch_billing_identity WHERE singleton=1').get() as { branch_id: string; terminal_id: string } | undefined
    if (!identity) return undefined
    const first = db.prepare('SELECT * FROM branch_billing_outbox ORDER BY revision LIMIT 1').get() as { revision: number; invoice_id: string; payload: string | null } | undefined
    if (!first) return undefined
    if (first.payload) return { event_id: `${identity.terminal_id}:invoice:${first.revision}`, kind: 'invoice.snapshot' as const, payload: JSON.parse(first.payload) as BillingSnapshot }
    const invoice = db.prepare('SELECT * FROM invoices WHERE id=? AND branch_id=?').get(first.invoice_id, identity.branch_id) as Record<string, unknown> | undefined
    if (!invoice) throw new Error('Pending branch invoice is missing; restore the billing database before continuing replication')
    const latest = db.prepare('SELECT MAX(revision) AS revision FROM branch_billing_outbox WHERE invoice_id=? AND payload IS NULL').get(first.invoice_id) as { revision: number }
    const payload: BillingSnapshot = {
      bill_id: String(invoice.id), bill_number: String(invoice.invoice_number), branch_id: identity.branch_id, revision: latest.revision,
      invoice,
      items: db.prepare('SELECT * FROM invoice_items WHERE invoice_id=? ORDER BY id').all(first.invoice_id) as Record<string, unknown>[],
      payments: db.prepare('SELECT * FROM payments WHERE invoice_id=? ORDER BY id').all(first.invoice_id) as Record<string, unknown>[],
    }
    db.prepare('UPDATE branch_billing_outbox SET payload=? WHERE revision=?').run(JSON.stringify(payload), latest.revision)
    db.prepare('DELETE FROM branch_billing_outbox WHERE invoice_id=? AND payload IS NULL AND revision<?').run(first.invoice_id, latest.revision)
    return { event_id: `${identity.terminal_id}:invoice:${latest.revision}`, kind: 'invoice.snapshot' as const, payload }
  })()
}

export async function flushBillingSnapshots(db: Database.Database, send: (event: NonNullable<ReturnType<typeof nextBillingSnapshot>>) => Promise<boolean>, limit = 10) {
  for (let n=0; n<limit; n++) {
    const event = nextBillingSnapshot(db)
    if (!event) return
    if (!await send(event)) throw new Error('Branch Hub did not acknowledge the invoice snapshot')
    db.prepare('DELETE FROM branch_billing_outbox WHERE revision=? AND payload IS NOT NULL').run(event.payload.revision)
  }
}
