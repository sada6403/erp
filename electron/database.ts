import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'
import { app } from 'electron'
import { enqueuSync } from './services/syncQueue'

let db: Database.Database

export function getDb(): Database.Database {
  if (!db) throw new Error('Database not initialized')
  return db
}

export async function initDatabase(): Promise<void> {
  const userDataPath = app.getPath('userData')
  const dbPath = path.join(userDataPath, 'pos-erp.db')
  const schemaPath = app.isPackaged
    ? path.join(process.resourcesPath, 'database', 'schema.sql')
    : path.join(__dirname, '../database/schema.sql')

  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('synchronous = NORMAL')

  // Run schema if DB is fresh
  const tableExists = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='branches'"
  ).get()

  if (!tableExists) {
    const schema = fs.readFileSync(schemaPath, 'utf-8')
    db.exec(schema)
    seedDefaultData()
  }
  // Always run migrations, even right after a fresh schema.sql — the base
  // schema has drifted behind runMigrations() (e.g. users.login_attempts,
  // users.locked_until, products.track_batches never made it into
  // schema.sql), so a fresh install silently ended up missing columns that
  // sync and login code assume exist. Every statement here is guarded by
  // hasColumn()/hasTable(), so re-running on an already-migrated DB is a no-op.
  runMigrations()

  console.log('[DB] SQLite initialized at', dbPath)
}

function hasTable(table: string): boolean {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table))
}

function hasColumn(table: string, column: string): boolean {
  if (!hasTable(table)) return true  // table not yet created; skip ALTER TABLE
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  return cols.some(c => c.name === column)
}

function runMigrations(): void {
  const migrations: [string, string, string][] = [
    // [table, column, definition]
    ['roles',                'updated_at',  "TEXT NOT NULL DEFAULT ''"],
    ['stock_transfers',      'updated_at',  "TEXT NOT NULL DEFAULT ''"],
    ['invoice_items',        'updated_at',  "TEXT NOT NULL DEFAULT ''"],
    ['payments',             'updated_at',  "TEXT NOT NULL DEFAULT ''"],
    ['installment_payments', 'updated_at',  "TEXT NOT NULL DEFAULT ''"],
    ['audit_logs',           'updated_at',  "TEXT NOT NULL DEFAULT ''"],
    ['products',             'branch_id',   "TEXT"],
    ['branches',             'code',        "TEXT"],
    ['branches',             'branch_pin',  "TEXT"],
    ['users',                'pin_hash',    "TEXT"],
    ['branch_transfers',     'approved_by', "TEXT"],
    // Bill type system
    ['invoices', 'bill_type',    "TEXT NOT NULL DEFAULT 'RETAIL'"],
    ['invoices', 'valid_until',  "TEXT"],
    ['invoices', 'due_date',     "TEXT"],
    ['invoices', 'approved_by',  "TEXT"],
    ['invoices', 'locked_at',    "TEXT"],
    ['invoices', 'agent_code',   "TEXT"],
    ['invoices', 'agent_name',   "TEXT"],
    ['invoices', 'agent_commission_pct',    "REAL NOT NULL DEFAULT 0"],
    ['invoices', 'agent_commission_amount', "REAL NOT NULL DEFAULT 0"],
    // Transfer extended statuses
    ['stock_transfers', 'reject_reason',    "TEXT"],
    ['stock_transfers', 'discrepancy_note', "TEXT"],
    ['stock_transfers', 'rejected_by',      "TEXT"],
    ['stock_transfers', 'discrepancy_by',   "TEXT"],
    ['stock_transfers', 'package_count',             "REAL NOT NULL DEFAULT 0"],
    ['stock_transfers', 'serial_batch_no',           "TEXT"],
    ['stock_transfers', 'item_description',          "TEXT"],
    ['stock_transfers', 'issuing_officer_name',      "TEXT"],
    ['stock_transfers', 'received_by_name',          "TEXT"],
    ['stock_transfers', 'received_designation',      "TEXT"],
    ['stock_transfers', 'received_remarks',          "TEXT"],
    ['stock_transfers', 'mismatch_reason_category',  "TEXT"],
    ['stock_transfers', 'mismatch_details',          "TEXT"],
    ['stock_transfers', 'print_count',               "INTEGER NOT NULL DEFAULT 0"],
    ['stock_transfers', 'last_printed_at',           "TEXT"],
    // Product extended fields
    ['products', 'sort_name',           "TEXT"],
    ['products', 'isbn',                "TEXT"],
    ['products', 'brand',               "TEXT"],
    ['products', 'rack_no',             "TEXT"],
    ['products', 'alert_qty',           "INTEGER NOT NULL DEFAULT 5"],
    ['products', 'weight',              "REAL NOT NULL DEFAULT 0"],
    ['products', 'wholesale_price',     "REAL NOT NULL DEFAULT 0"],
    ['products', 'not_for_sale',        "INTEGER NOT NULL DEFAULT 0"],
    ['products', 'enable_emi',          "INTEGER NOT NULL DEFAULT 0"],
    ['products', 'is_manage_stock',     "INTEGER NOT NULL DEFAULT 1"],
    ['products', 'fast_product',        "INTEGER NOT NULL DEFAULT 0"],
    ['products', 'sale_as_latest_price',"INTEGER NOT NULL DEFAULT 0"],
    ['products', 'product_type',        "TEXT NOT NULL DEFAULT 'single'"],
    ['products', 'sale_by',             "TEXT NOT NULL DEFAULT 'normal'"],
    ['products', 'employee_commission', "REAL NOT NULL DEFAULT 0"],
    ['products', 'commission_type',     "TEXT NOT NULL DEFAULT 'fixed'"],
    ['products', 'custom_field1',       "TEXT"],
    ['products', 'custom_field2',       "TEXT"],
    ['products', 'custom_field3',       "TEXT"],
    // Category extended fields
    ['categories', 'short_code',              "TEXT"],
    ['categories', 'image_url',               "TEXT"],
    ['categories', 'show_in_menu',            "INTEGER NOT NULL DEFAULT 1"],
    ['categories', 'exclude_service_charge',  "INTEGER NOT NULL DEFAULT 0"],
    ['categories', 'issue_token',             "INTEGER NOT NULL DEFAULT 0"],
    // Supplier extended fields
    ['suppliers', 'first_name',    "TEXT"],
    ['suppliers', 'last_name',     "TEXT"],
    ['suppliers', 'middle_name',   "TEXT"],
    ['suppliers', 'business_name', "TEXT"],
    ['suppliers', 'mobile_number', "TEXT"],
    ['suppliers', 'alt_mobile',    "TEXT"],
    ['suppliers', 'landline',      "TEXT"],
    ['suppliers', 'pay_terms',     "TEXT"],
    ['suppliers', 'due_balance',   "REAL NOT NULL DEFAULT 0"],
    ['suppliers', 'city',          "TEXT"],
    ['suppliers', 'state',         "TEXT"],
    ['suppliers', 'country',       "TEXT"],
    ['suppliers', 'zip_code',      "TEXT"],
  ]

  for (const [table, column, definition] of migrations) {
    if (!hasColumn(table, column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
      console.log(`[DB] Migration: added ${table}.${column}`)
    }
  }

  // One-time backfill: hash legacy plaintext PINs so they can sync safely.
  // Each migrated row is also enqueued for cloud sync so PINs created before
  // this update start working on the company's other devices.
  {
    const bcrypt = require('bcryptjs')
    const { randomUUID } = require('crypto')
    const enqueue = (table: string, recordId: string, payload: Record<string, unknown>) => {
      try {
        db.prepare(`INSERT INTO sync_queue (id, table_name, record_id, operation, payload) VALUES (?,?,?,'UPDATE',?)`)
          .run(randomUUID(), table, recordId, JSON.stringify(payload))
      } catch { /* sync_queue not ready — periodic sync will catch up later */ }
    }

    const legacyUsers = db.prepare(
      `SELECT id, pin FROM users WHERE pin IS NOT NULL AND pin != '' AND (pin_hash IS NULL OR pin_hash = '')`
    ).all() as { id: string; pin: string }[]
    for (const u of legacyUsers) {
      db.prepare(`UPDATE users SET pin_hash = ?, pin = NULL, updated_at = datetime('now') WHERE id = ?`)
        .run(bcrypt.hashSync(String(u.pin), 10), u.id)
      const row = db.prepare(
        `SELECT id, branch_id, role_id, name, email, password_hash, pin_hash, is_active, last_login_at, created_at, updated_at
         FROM users WHERE id = ?`
      ).get(u.id) as Record<string, unknown> | undefined
      if (row) enqueue('users', u.id, row)
    }
    if (legacyUsers.length) console.log(`[DB] Migration: hashed ${legacyUsers.length} plaintext user PIN(s)`)

    // Branch PINs: same treatment (bcrypt hashes start with $2)
    const legacyBranches = db.prepare(
      `SELECT id, branch_pin FROM branches WHERE branch_pin IS NOT NULL AND branch_pin != '' AND branch_pin NOT LIKE '$2%'`
    ).all() as { id: string; branch_pin: string }[]
    for (const b of legacyBranches) {
      db.prepare(`UPDATE branches SET branch_pin = ?, updated_at = datetime('now') WHERE id = ?`)
        .run(bcrypt.hashSync(String(b.branch_pin), 10), b.id)
      const row = db.prepare(`SELECT * FROM branches WHERE id = ?`).get(b.id) as Record<string, unknown> | undefined
      if (row) {
        delete row.synced_at
        enqueue('branches', b.id, row)
      }
    }
    if (legacyBranches.length) console.log(`[DB] Migration: hashed ${legacyBranches.length} plaintext branch PIN(s)`)
  }

  // One-time backfill: invoice_items/payments/credit_ledger were never
  // enqueued for cloud push before this update (no enqueueSync call existed
  // at any of their insert sites), so historical rows sit in local SQLite
  // only. Queue anything not already represented in sync_queue — gated by a
  // flag so this full-table scan runs once, not on every startup.
  {
    const Store = require('electron-store')
    const store = new Store()
    const FLAG = 'backfill_invoice_items_payments_credit_ledger_v1'
    if (!store.get(FLAG)) {
      const { randomUUID } = require('crypto')
      const enqueue = (table: string, recordId: string, payload: Record<string, unknown>) => {
        try {
          db.prepare(`INSERT INTO sync_queue (id, table_name, record_id, operation, payload) VALUES (?,?,?,'INSERT',?)`)
            .run(randomUUID(), table, recordId, JSON.stringify(payload))
        } catch { /* sync_queue not ready — next launch will retry (flag not set) */ }
      }

      for (const table of ['invoice_items', 'payments', 'credit_ledger']) {
        try {
          const rows = db.prepare(`
            SELECT * FROM ${table}
            WHERE id NOT IN (SELECT record_id FROM sync_queue WHERE table_name = ?)
          `).all(table) as Record<string, unknown>[]
          for (const row of rows) enqueue(table, String(row.id), row)
          if (rows.length) console.log(`[DB] Backfill: queued ${rows.length} historical ${table} row(s) for cloud sync`)
        } catch (err) {
          console.error(`[DB] Backfill failed for ${table}:`, err)
        }
      }

      store.set(FLAG, true)
    }
  }

  const transferMigrations: [string, string][] = [
    ['transfer_number',       'TEXT'],
    ['approved_by',           'TEXT'],
    ['released_by',           'TEXT'],
    ['driver_name',           'TEXT'],
    ['driver_phone',          'TEXT'],
    ['vehicle_number',        'TEXT'],
    ['dispatch_at',           'TEXT'],
    ['expected_delivery_at',  'TEXT'],
    ['actual_delivery_at',    'TEXT'],
    ['received_quantity',     'INTEGER NOT NULL DEFAULT 0'],
    ['missing_quantity',      'INTEGER NOT NULL DEFAULT 0'],
    ['damaged_quantity',      'INTEGER NOT NULL DEFAULT 0'],
  ]
  for (const [column, definition] of transferMigrations) {
    if (!hasColumn('stock_transfers', column)) {
      db.exec(`ALTER TABLE stock_transfers ADD COLUMN ${column} ${definition}`)
    }
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS stock_transfer_history (
      id             TEXT PRIMARY KEY,
      transfer_id    TEXT NOT NULL REFERENCES stock_transfers(id),
      product_id     TEXT NOT NULL REFERENCES products(id),
      variant_id     TEXT,
      quantity       REAL NOT NULL DEFAULT 0,
      from_branch_id TEXT REFERENCES branches(id),
      to_branch_id   TEXT REFERENCES branches(id),
      requested_by   TEXT REFERENCES users(id),
      approved_by    TEXT REFERENCES users(id),
      status         TEXT NOT NULL,
      notes          TEXT,
      created_by     TEXT REFERENCES users(id),
      created_at     TEXT NOT NULL DEFAULT (datetime('now')),
      synced_at      TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_stock_transfer_history_transfer ON stock_transfer_history(transfer_id);
    CREATE INDEX IF NOT EXISTS idx_stock_transfer_history_product ON stock_transfer_history(product_id);
    CREATE INDEX IF NOT EXISTS idx_stock_transfer_history_branches ON stock_transfer_history(from_branch_id, to_branch_id);

    CREATE TABLE IF NOT EXISTS stock_transfer_print_logs (
      id             TEXT PRIMARY KEY,
      transfer_id    TEXT NOT NULL REFERENCES stock_transfers(id) ON DELETE CASCADE,
      printed_by     TEXT REFERENCES users(id),
      printed_at     TEXT NOT NULL DEFAULT (datetime('now')),
      print_type     TEXT NOT NULL DEFAULT 'print',
      copy_no        INTEGER NOT NULL DEFAULT 1,
      device_name    TEXT,
      synced_at      TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_stock_transfer_print_logs_transfer ON stock_transfer_print_logs(transfer_id);

    CREATE TABLE IF NOT EXISTS stock_transfer_receive_logs (
      id                   TEXT PRIMARY KEY,
      transfer_id          TEXT NOT NULL REFERENCES stock_transfers(id) ON DELETE CASCADE,
      received_by_user     TEXT REFERENCES users(id),
      received_by_name     TEXT,
      designation          TEXT,
      received_quantity    REAL NOT NULL DEFAULT 0,
      missing_quantity     REAL NOT NULL DEFAULT 0,
      damaged_quantity     REAL NOT NULL DEFAULT 0,
      remarks              TEXT,
      received_at          TEXT NOT NULL DEFAULT (datetime('now')),
      synced_at            TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_stock_transfer_receive_logs_transfer ON stock_transfer_receive_logs(transfer_id);

    CREATE TABLE IF NOT EXISTS stock_transfer_mismatches (
      id                 TEXT PRIMARY KEY,
      transfer_id        TEXT NOT NULL REFERENCES stock_transfers(id) ON DELETE CASCADE,
      product_id         TEXT REFERENCES products(id),
      sent_quantity      REAL NOT NULL DEFAULT 0,
      received_quantity  REAL NOT NULL DEFAULT 0,
      missing_quantity   REAL NOT NULL DEFAULT 0,
      damaged_quantity   REAL NOT NULL DEFAULT 0,
      reason_category    TEXT NOT NULL,
      detailed_reason    TEXT,
      reported_by        TEXT REFERENCES users(id),
      status             TEXT NOT NULL DEFAULT 'under_admin_review',
      admin_reason       TEXT,
      resolved_by        TEXT REFERENCES users(id),
      resolved_at        TEXT,
      created_at         TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at         TEXT NOT NULL DEFAULT (datetime('now')),
      synced_at          TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_stock_transfer_mismatches_transfer ON stock_transfer_mismatches(transfer_id);

    CREATE TABLE IF NOT EXISTS branch_transfers (
      id                   TEXT PRIMARY KEY,
      transfer_number      TEXT NOT NULL UNIQUE,
      from_branch_id       TEXT NOT NULL,
      to_branch_id         TEXT NOT NULL,
      status               TEXT NOT NULL DEFAULT 'draft',
      driver_name          TEXT,
      vehicle_number       TEXT,
      driver_phone         TEXT,
      issuing_officer_name TEXT,
      dispatch_at          TEXT,
      expected_delivery_at TEXT,
      actual_delivery_at   TEXT,
      notes                TEXT,
      created_by           TEXT,
      approved_by          TEXT,
      received_by          TEXT,
      received_by_name     TEXT,
      received_designation TEXT,
      created_at           TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at           TEXT NOT NULL DEFAULT (datetime('now')),
      synced_at            TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_bt_from ON branch_transfers(from_branch_id);
    CREATE INDEX IF NOT EXISTS idx_bt_to ON branch_transfers(to_branch_id);
    CREATE INDEX IF NOT EXISTS idx_bt_status ON branch_transfers(status);

    CREATE TABLE IF NOT EXISTS branch_transfer_items (
      id               TEXT PRIMARY KEY,
      transfer_id      TEXT NOT NULL REFERENCES branch_transfers(id) ON DELETE CASCADE,
      product_id       TEXT NOT NULL,
      quantity         REAL NOT NULL DEFAULT 0,
      unit             TEXT,
      package_count    REAL NOT NULL DEFAULT 0,
      serial_batch_no  TEXT,
      description      TEXT,
      received_qty     REAL NOT NULL DEFAULT 0,
      damaged_qty      REAL NOT NULL DEFAULT 0,
      missing_qty      REAL NOT NULL DEFAULT 0,
      created_at       TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
      synced_at        TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_bti_transfer ON branch_transfer_items(transfer_id);

    CREATE TABLE IF NOT EXISTS branch_transfer_mismatches (
      id               TEXT PRIMARY KEY,
      transfer_id      TEXT NOT NULL REFERENCES branch_transfers(id) ON DELETE CASCADE,
      item_id          TEXT NOT NULL REFERENCES branch_transfer_items(id) ON DELETE CASCADE,
      missing_qty      REAL NOT NULL DEFAULT 0,
      damaged_qty      REAL NOT NULL DEFAULT 0,
      reason_category  TEXT NOT NULL,
      detailed_reason  TEXT,
      status           TEXT NOT NULL DEFAULT 'under_admin_review',
      reported_by      TEXT,
      resolved_by      TEXT,
      admin_reason     TEXT,
      created_at       TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
      synced_at        TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_btm_transfer ON branch_transfer_mismatches(transfer_id);

    CREATE TABLE IF NOT EXISTS branch_transfer_logs (
      id               TEXT PRIMARY KEY,
      transfer_id      TEXT NOT NULL REFERENCES branch_transfers(id) ON DELETE CASCADE,
      user_id          TEXT,
      action           TEXT NOT NULL,
      old_values       TEXT,
      new_values       TEXT,
      notes            TEXT,
      created_at       TEXT NOT NULL DEFAULT (datetime('now')),
      synced_at        TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_btl_transfer ON branch_transfer_logs(transfer_id);

    CREATE TABLE IF NOT EXISTS branch_transfer_prints (
      id               TEXT PRIMARY KEY,
      transfer_id      TEXT NOT NULL REFERENCES branch_transfers(id) ON DELETE CASCADE,
      printed_by       TEXT,
      print_type       TEXT NOT NULL DEFAULT 'print',
      created_at       TEXT NOT NULL DEFAULT (datetime('now')),
      synced_at        TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_btp_transfer ON branch_transfer_prints(transfer_id);
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS customer_orders (
      id TEXT PRIMARY KEY, order_number TEXT NOT NULL UNIQUE,
      branch_id TEXT NOT NULL REFERENCES branches(id),
      customer_id TEXT REFERENCES customers(id), customer_name TEXT NOT NULL,
      customer_phone TEXT, customer_address TEXT,
      sales_staff_id TEXT REFERENCES users(id), approved_by TEXT REFERENCES users(id),
      released_by TEXT REFERENCES users(id), driver_name TEXT, driver_phone TEXT,
      vehicle_number TEXT, status TEXT NOT NULL DEFAULT 'pending',
      payment_status TEXT NOT NULL DEFAULT 'unpaid',
      total_amount REAL NOT NULL DEFAULT 0, paid_amount REAL NOT NULL DEFAULT 0,
      delivery_date TEXT, dispatch_at TEXT, delivered_at TEXT,
      delivery_confirmed_by TEXT REFERENCES users(id), notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')), synced_at TEXT
    );
    CREATE TABLE IF NOT EXISTS customer_order_items (
      id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES customer_orders(id) ON DELETE CASCADE,
      product_id TEXT NOT NULL REFERENCES products(id), quantity INTEGER NOT NULL,
      unit_price REAL NOT NULL, line_total REAL NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')), synced_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_customer_orders_branch ON customer_orders(branch_id);
    CREATE INDEX IF NOT EXISTS idx_customer_orders_status ON customer_orders(status);
    CREATE INDEX IF NOT EXISTS idx_customer_order_items_order ON customer_order_items(order_id);

    -- Bill sequence counters: one row per branch+type+year
    CREATE TABLE IF NOT EXISTS bill_sequences (
      id          TEXT PRIMARY KEY,
      branch_id   TEXT NOT NULL REFERENCES branches(id),
      bill_type   TEXT NOT NULL,
      year        INTEGER NOT NULL,
      last_seq    INTEGER NOT NULL DEFAULT 0,
      UNIQUE(branch_id, bill_type, year)
    );

    -- Credit ledger: tracks outstanding credit per bill
    CREATE TABLE IF NOT EXISTS credit_ledger (
      id          TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL REFERENCES customers(id),
      invoice_id  TEXT NOT NULL REFERENCES invoices(id),
      branch_id   TEXT NOT NULL REFERENCES branches(id),
      amount_due  REAL NOT NULL DEFAULT 0,
      amount_paid REAL NOT NULL DEFAULT 0,
      due_date    TEXT,
      status      TEXT NOT NULL DEFAULT 'outstanding',
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
      synced_at   TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_credit_ledger_customer ON credit_ledger(customer_id);
    CREATE INDEX IF NOT EXISTS idx_credit_ledger_invoice  ON credit_ledger(invoice_id);

    -- Purchase orders
    CREATE TABLE IF NOT EXISTS purchase_orders (
      id              TEXT PRIMARY KEY,
      po_number       TEXT NOT NULL UNIQUE,
      branch_id       TEXT NOT NULL REFERENCES branches(id),
      supplier_id     TEXT NOT NULL REFERENCES suppliers(id),
      status          TEXT NOT NULL DEFAULT 'DRAFT',
      subtotal        REAL NOT NULL DEFAULT 0,
      tax_amount      REAL NOT NULL DEFAULT 0,
      total           REAL NOT NULL DEFAULT 0,
      expected_date   TEXT,
      received_date   TEXT,
      notes           TEXT,
      created_by      TEXT REFERENCES users(id),
      approved_by     TEXT REFERENCES users(id),
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
      synced_at       TEXT
    );
    CREATE TABLE IF NOT EXISTS purchase_items (
      id              TEXT PRIMARY KEY,
      po_id           TEXT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
      product_id      TEXT NOT NULL REFERENCES products(id),
      ordered_qty     REAL NOT NULL DEFAULT 0,
      received_qty    REAL NOT NULL DEFAULT 0,
      unit_cost       REAL NOT NULL DEFAULT 0,
      line_total      REAL NOT NULL DEFAULT 0,
      updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
      synced_at       TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_purchase_orders_branch   ON purchase_orders(branch_id);
    CREATE INDEX IF NOT EXISTS idx_purchase_orders_supplier ON purchase_orders(supplier_id);
    CREATE INDEX IF NOT EXISTS idx_purchase_items_po        ON purchase_items(po_id);
  `)

  // purchase_orders / purchase_items column additions (run after CREATE TABLE)
  const poMigrations: [string, string, string][] = [
    ['purchase_orders', 'total_amount', "REAL NOT NULL DEFAULT 0"],
    ['purchase_orders', 'received_at',  "TEXT"],
    ['purchase_orders', 'sent_at',      "TEXT"],
    ['purchase_orders', 'cancelled_at', "TEXT"],
    ['purchase_items',  'quantity',     "REAL NOT NULL DEFAULT 0"],
    ['purchase_items',  'notes',        "TEXT"],
  ]
  for (const [table, column, definition] of poMigrations) {
    if (!hasColumn(table, column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
      console.log(`[DB] Migration: added ${table}.${column}`)
    }
  }

  // New tables for enhanced product/expense features
  db.exec(`
    CREATE TABLE IF NOT EXISTS product_uom (
      id                TEXT PRIMARY KEY,
      product_id        TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      uom_name          TEXT NOT NULL,
      conversion_factor REAL NOT NULL DEFAULT 1,
      is_base           INTEGER NOT NULL DEFAULT 0,
      wastage           REAL NOT NULL DEFAULT 0,
      sort_order        INTEGER NOT NULL DEFAULT 0,
      created_at        TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_product_uom_product ON product_uom(product_id);

    CREATE TABLE IF NOT EXISTS expense_categories (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL UNIQUE,
      is_active   INTEGER NOT NULL DEFAULT 1,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS expenses (
      id              TEXT PRIMARY KEY,
      branch_id       TEXT REFERENCES branches(id),
      category_id     TEXT REFERENCES expense_categories(id),
      supplier_id     TEXT REFERENCES suppliers(id),
      amount          REAL NOT NULL DEFAULT 0,
      paid_amount     REAL NOT NULL DEFAULT 0,
      payment_status  TEXT NOT NULL DEFAULT 'unpaid',
      payment_method  TEXT,
      payment_date    TEXT,
      payment_due     TEXT,
      paid_by         TEXT REFERENCES users(id),
      description     TEXT,
      notes           TEXT,
      created_by      TEXT REFERENCES users(id),
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
      synced_at       TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_expenses_branch   ON expenses(branch_id);
    CREATE INDEX IF NOT EXISTS idx_expenses_category ON expenses(category_id);
    CREATE INDEX IF NOT EXISTS idx_expenses_date     ON expenses(created_at);
  `)

  // Referral / sales agents — matched against invoices.agent_code (free text,
  // predates this table) case/whitespace-insensitively, never by strict FK.
  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id                      TEXT PRIMARY KEY,
      code                    TEXT NOT NULL,
      name                    TEXT NOT NULL,
      phone                   TEXT,
      email                   TEXT,
      nic                     TEXT,
      branch_id               TEXT REFERENCES branches(id),
      default_commission_pct  REAL NOT NULL DEFAULT 0,
      monthly_target          REAL NOT NULL DEFAULT 0,
      status                  TEXT NOT NULL DEFAULT 'active',
      notes                   TEXT,
      created_by              TEXT REFERENCES users(id),
      created_at              TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at              TEXT NOT NULL DEFAULT (datetime('now')),
      synced_at               TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_code_ci ON agents(UPPER(TRIM(code)));
    CREATE INDEX IF NOT EXISTS idx_agents_branch ON agents(branch_id);
  `)
  if (!hasColumn('invoices', 'agent_id')) {
    db.exec(`ALTER TABLE invoices ADD COLUMN agent_id TEXT REFERENCES agents(id)`)
  }

  // Stable session-scope identifier for restricted-portal roles (Smart Buy
  // Manager, Agent) — replaces matching on the role's display name, which
  // silently breaks the portal restriction if the role is ever renamed.
  // NULL for ordinary (non-restricted) roles.
  if (!hasColumn('roles', 'session_scope')) {
    db.exec(`ALTER TABLE roles ADD COLUMN session_scope TEXT`)
    // One-time backfill so upgrading installs don't lose the existing
    // "Smart Buy Manager" restricted-portal behavior the moment the
    // string-match becomes only a fallback.
    db.exec(`UPDATE roles SET session_scope='smartBuy' WHERE LOWER(TRIM(name))='smart buy manager'`)
  }

  // Links an agent record to a real login (users row) so an agent can sign
  // in and see only their own schemes/members/commission, instead of being
  // a passive record admins manage on their behalf. Partial unique index —
  // many agents can share user_id=NULL (not yet linked to a login).
  if (!hasColumn('agents', 'user_id')) {
    db.exec(`ALTER TABLE agents ADD COLUMN user_id TEXT REFERENCES users(id)`)
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_user ON agents(user_id) WHERE user_id IS NOT NULL`)
  }

  // Formal "this user is THE SmartBuy Manager of this branch" pointer — a
  // soft assignment (no uniqueness enforced; a user could in principle be
  // pointed at from more than one branch, or a branch left unassigned).
  // Distinct from `users.branch_id`, which is what actually drives a Smart
  // Buy Manager's session scoping on login — this column is display/report
  // metadata only (e.g. "Manager Name" on the branch performance report),
  // so admin.ts validates the two agree when this is set.
  if (!hasColumn('branches', 'smartbuy_manager_id')) {
    db.exec(`ALTER TABLE branches ADD COLUMN smartbuy_manager_id TEXT REFERENCES users(id)`)
  }

  // Chit Fund — a group of customers (recruited by an agent) contributes
  // toward a product over a fixed number of cycles. One member wins the
  // product each cycle by lottery draw; on the final cycle every remaining
  // (non-winning) member receives their product together, all at once.
  // Members flagged early_redemption may instead take the product up front
  // for a partial payment and repay the rest afterward via the existing
  // installments engine (chit_members.installment_id links to it).
  db.exec(`
    CREATE TABLE IF NOT EXISTS chit_schemes (
      id                      TEXT PRIMARY KEY,
      scheme_number           TEXT UNIQUE,
      name                    TEXT NOT NULL,
      branch_id               TEXT REFERENCES branches(id),
      product_id              TEXT REFERENCES products(id),
      agent_id                TEXT REFERENCES agents(id),
      member_count            INTEGER NOT NULL,
      cycle_count             INTEGER NOT NULL,
      frequency               TEXT NOT NULL DEFAULT 'monthly',
      contribution_amount     REAL NOT NULL DEFAULT 0,
      chit_value              REAL NOT NULL DEFAULT 0,
      early_redemption_count  INTEGER NOT NULL DEFAULT 0,
      early_redemption_amount REAL NOT NULL DEFAULT 0,
      repayment_months        INTEGER NOT NULL DEFAULT 12,
      agent_commission_pct    REAL NOT NULL DEFAULT 0,
      start_date              TEXT NOT NULL,
      next_draw_date          TEXT,
      status                  TEXT NOT NULL DEFAULT 'active',
      notes                   TEXT,
      created_by              TEXT REFERENCES users(id),
      created_at              TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at              TEXT NOT NULL DEFAULT (datetime('now')),
      synced_at               TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_chit_schemes_branch ON chit_schemes(branch_id);
    CREATE INDEX IF NOT EXISTS idx_chit_schemes_agent  ON chit_schemes(agent_id);
    CREATE INDEX IF NOT EXISTS idx_chit_schemes_status ON chit_schemes(status);

    CREATE TABLE IF NOT EXISTS chit_members (
      id                    TEXT PRIMARY KEY,
      scheme_id             TEXT NOT NULL REFERENCES chit_schemes(id),
      customer_id           TEXT NOT NULL REFERENCES customers(id),
      agent_id              TEXT REFERENCES agents(id),
      join_order            INTEGER NOT NULL,
      is_early_redemption   INTEGER NOT NULL DEFAULT 0,
      redemption_type       TEXT,
      won_cycle_no          INTEGER,
      product_received_at   TEXT,
      contributions_paid    REAL NOT NULL DEFAULT 0,
      installment_id        TEXT REFERENCES installments(id),
      status                TEXT NOT NULL DEFAULT 'active',
      eligibility_note      TEXT,
      paper_reference_code  TEXT,
      redeemed_product_id   TEXT REFERENCES products(id),
      redeemed_product_name TEXT,
      redeemed_qty          INTEGER NOT NULL DEFAULT 1,
      redeemed_value        REAL,
      created_at            TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at            TEXT NOT NULL DEFAULT (datetime('now')),
      synced_at             TEXT,
      UNIQUE(scheme_id, customer_id),
      UNIQUE(scheme_id, join_order)
    );
    CREATE INDEX IF NOT EXISTS idx_chit_members_scheme   ON chit_members(scheme_id);
    CREATE INDEX IF NOT EXISTS idx_chit_members_customer ON chit_members(customer_id);
    CREATE INDEX IF NOT EXISTS idx_chit_members_status   ON chit_members(status);
  `)
  // Activation floor: a scheme starts life as 'pending' and only flips to
  // 'active' once enrolled members reach min_members (member_count remains
  // the separate capacity/maximum). Defaults to 1 at the column level so
  // existing schemes aren't retroactively knocked back to pending on
  // upgrade — the spec's default of 50 is applied by chits:create instead.
  if (!hasColumn('chit_schemes', 'min_members')) {
    db.exec(`ALTER TABLE chit_schemes ADD COLUMN min_members INTEGER NOT NULL DEFAULT 1`)
  }
  // Registration Lock — when set, enrollment (chits:members:add/
  // registerHistorical/importExcel) is rejected outside this window.
  // NULL means no lock (enrollment always open), matching existing schemes.
  if (!hasColumn('chit_schemes', 'registration_start_date')) {
    db.exec(`ALTER TABLE chit_schemes ADD COLUMN registration_start_date TEXT`)
  }
  if (!hasColumn('chit_schemes', 'registration_end_date')) {
    db.exec(`ALTER TABLE chit_schemes ADD COLUMN registration_end_date TEXT`)
  }
  // Late Fee — grace period (days into the month) before a cycle
  // contribution is considered late; late_fee_amount is added on top of the
  // recorded amount when a contribution is collected past that day.
  if (!hasColumn('chit_schemes', 'late_payment_days')) {
    db.exec(`ALTER TABLE chit_schemes ADD COLUMN late_payment_days INTEGER NOT NULL DEFAULT 0`)
  }
  if (!hasColumn('chit_schemes', 'late_fee_amount')) {
    db.exec(`ALTER TABLE chit_schemes ADD COLUMN late_fee_amount REAL NOT NULL DEFAULT 0`)
  }
  if (!hasColumn('chit_members', 'agent_id')) {
    db.exec(`ALTER TABLE chit_members ADD COLUMN agent_id TEXT REFERENCES agents(id)`)
  }
  // Paper-record traceability (Register Historical Member) + redemption
  // product capture (winner picks a product, possibly not the scheme default).
  if (!hasColumn('chit_members', 'paper_reference_code')) {
    db.exec(`ALTER TABLE chit_members ADD COLUMN paper_reference_code TEXT`)
  }
  if (!hasColumn('chit_members', 'redeemed_product_id')) {
    db.exec(`ALTER TABLE chit_members ADD COLUMN redeemed_product_id TEXT REFERENCES products(id)`)
  }
  if (!hasColumn('chit_members', 'redeemed_product_name')) {
    db.exec(`ALTER TABLE chit_members ADD COLUMN redeemed_product_name TEXT`)
  }
  if (!hasColumn('chit_members', 'redeemed_qty')) {
    db.exec(`ALTER TABLE chit_members ADD COLUMN redeemed_qty INTEGER NOT NULL DEFAULT 1`)
  }
  if (!hasColumn('chit_members', 'redeemed_value')) {
    db.exec(`ALTER TABLE chit_members ADD COLUMN redeemed_value REAL`)
  }
  // Links to the real POS invoice generated when the redemption is recorded
  // (stock decrement + invoice_items + payment) — makes the product handout
  // show up in stock-on-hand and sales/tax reporting like any other sale.
  if (!hasColumn('chit_members', 'redemption_invoice_id')) {
    db.exec(`ALTER TABLE chit_members ADD COLUMN redemption_invoice_id TEXT REFERENCES invoices(id)`)
  }
  db.exec(`

    CREATE TABLE IF NOT EXISTS chit_draws (
      id                TEXT PRIMARY KEY,
      scheme_id         TEXT NOT NULL REFERENCES chit_schemes(id),
      cycle_no          INTEGER NOT NULL,
      draw_date         TEXT NOT NULL DEFAULT (date('now')),
      winner_member_id  TEXT REFERENCES chit_members(id),
      settled_count     INTEGER NOT NULL DEFAULT 1,
      eligible_count    INTEGER NOT NULL DEFAULT 0,
      method            TEXT NOT NULL DEFAULT 'random',
      conducted_by      TEXT REFERENCES users(id),
      notes             TEXT,
      created_at        TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
      synced_at         TEXT,
      UNIQUE(scheme_id, cycle_no)
    );
    CREATE INDEX IF NOT EXISTS idx_chit_draws_scheme ON chit_draws(scheme_id);

    CREATE TABLE IF NOT EXISTS chit_contributions (
      id                    TEXT PRIMARY KEY,
      scheme_id             TEXT NOT NULL REFERENCES chit_schemes(id),
      member_id             TEXT NOT NULL REFERENCES chit_members(id),
      cycle_no              INTEGER,
      contribution_type     TEXT NOT NULL DEFAULT 'cycle',
      amount                REAL NOT NULL,
      method                TEXT NOT NULL DEFAULT 'cash',
      receipt_number        TEXT,
      reference             TEXT,
      status                TEXT NOT NULL DEFAULT 'approved',
      received_by           TEXT REFERENCES users(id),
      collected_by_agent_id TEXT REFERENCES agents(id),
      verified_by           TEXT REFERENCES users(id),
      verified_at           TEXT,
      rejected_reason       TEXT,
      branch_id             TEXT REFERENCES branches(id),
      commission_amount     REAL NOT NULL DEFAULT 0,
      notes                 TEXT,
      paid_at               TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at            TEXT NOT NULL DEFAULT (datetime('now')),
      synced_at             TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_chit_contributions_scheme ON chit_contributions(scheme_id);
    CREATE INDEX IF NOT EXISTS idx_chit_contributions_member ON chit_contributions(member_id);
    CREATE INDEX IF NOT EXISTS idx_chit_contributions_status ON chit_contributions(status);
  `)
  if (!hasColumn('chit_contributions', 'collected_by_agent_id')) {
    db.exec(`ALTER TABLE chit_contributions ADD COLUMN collected_by_agent_id TEXT REFERENCES agents(id)`)
  }

  // Agent cash remittance/settlement — a field agent collects cash from
  // customers (chit_contributions.collected_by_agent_id) and later hands it
  // over to the office as a separate event. "Balance owed" is computed as
  // collected-minus-remitted, not stored — this table only records the
  // remittance side.
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_remittances (
      id             TEXT PRIMARY KEY,
      agent_id       TEXT NOT NULL REFERENCES agents(id),
      branch_id      TEXT NOT NULL REFERENCES branches(id),
      amount         REAL NOT NULL,
      method         TEXT NOT NULL DEFAULT 'cash',
      bank_reference TEXT,
      submitted_at   TEXT NOT NULL DEFAULT (datetime('now')),
      received_by    TEXT REFERENCES users(id),
      notes          TEXT,
      created_at     TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
      synced_at      TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_agent_remittances_agent  ON agent_remittances(agent_id);
    CREATE INDEX IF NOT EXISTS idx_agent_remittances_branch ON agent_remittances(branch_id);
  `)

  // Branch Collaboration — when a scheme's home branch (chit_schemes.branch_id)
  // can't reach min_members alone, it can invite another branch to enroll
  // members into the SAME scheme. There is still only ONE scheme, ONE home
  // branch, and ONE responsible agent (chit_schemes.agent_id) — collaboration
  // only extends who may enroll/collect for it, never splits ownership.
  db.exec(`
    CREATE TABLE IF NOT EXISTS chit_scheme_branches (
      id             TEXT PRIMARY KEY,
      scheme_id      TEXT NOT NULL REFERENCES chit_schemes(id),
      branch_id      TEXT NOT NULL REFERENCES branches(id),
      status         TEXT NOT NULL DEFAULT 'pending',
      requested_by   TEXT REFERENCES users(id),
      responded_by   TEXT REFERENCES users(id),
      responded_at   TEXT,
      notes          TEXT,
      created_at     TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
      synced_at      TEXT,
      UNIQUE(scheme_id, branch_id)
    );
    CREATE INDEX IF NOT EXISTS idx_chit_scheme_branches_scheme ON chit_scheme_branches(scheme_id);
    CREATE INDEX IF NOT EXISTS idx_chit_scheme_branches_branch ON chit_scheme_branches(branch_id);
    CREATE INDEX IF NOT EXISTS idx_chit_scheme_branches_status ON chit_scheme_branches(status);
  `)
  // Which branch actually recruited this member — defaults to the scheme's
  // home branch for members enrolled there; set to the collaborating
  // branch's id when enrolled through an active collaboration. Drives
  // per-branch member access (a collaborating branch only manages members
  // it recruited; the home branch always sees everyone).
  if (!hasColumn('chit_members', 'enrolled_branch_id')) {
    db.exec(`ALTER TABLE chit_members ADD COLUMN enrolled_branch_id TEXT REFERENCES branches(id)`)
  }
  // Every collaborator-scoped member query (assertMemberAccess call sites)
  // filters on this column — without an index it's a full table scan once a
  // scheme has any meaningful member count.
  db.exec(`CREATE INDEX IF NOT EXISTS idx_chit_members_enrolled_branch ON chit_members(enrolled_branch_id)`)

  // Optional brand tag on products, needed for brand-wise commission rules
  // (category-wise/product-wise already have FKs to reuse).
  if (!hasColumn('products', 'brand')) {
    db.exec(`ALTER TABLE products ADD COLUMN brand TEXT`)
    db.exec(`CREATE INDEX IF NOT EXISTS idx_products_brand ON products(brand)`)
  }

  // Enterprise Commission Engine — configurable rules (no hardcoded % or
  // ownership logic). A rule matches at exactly one specificity level
  // (product > category > brand > scheme > global); multiple 'bonus' rules
  // may stack on top of the one base (non-bonus) rule that matches.
  // ownership_model decides how a matched rule's commission splits between
  // the member's registering agent (chit_members.agent_id) and whoever
  // physically collected this particular payment
  // (chit_contributions.collected_by_agent_id) — the two-agent scenario
  // ("Agent A registered, Agent B collected") the spec calls out explicitly.
  db.exec(`
    CREATE TABLE IF NOT EXISTS commission_rules (
      id                      TEXT PRIMARY KEY,
      name                    TEXT NOT NULL,
      scope                   TEXT NOT NULL DEFAULT 'global',
      scheme_id               TEXT REFERENCES chit_schemes(id),
      product_id              TEXT REFERENCES products(id),
      category_id             TEXT REFERENCES categories(id),
      brand                   TEXT,
      calculation_type        TEXT NOT NULL DEFAULT 'percentage',
      rate                    REAL NOT NULL DEFAULT 0,
      ownership_model         TEXT NOT NULL DEFAULT 'registration',
      registration_share_pct  REAL NOT NULL DEFAULT 100,
      sales_share_pct         REAL NOT NULL DEFAULT 0,
      is_bonus                INTEGER NOT NULL DEFAULT 0,
      priority                INTEGER NOT NULL DEFAULT 0,
      active_from             TEXT,
      active_to               TEXT,
      status                  TEXT NOT NULL DEFAULT 'active',
      notes                   TEXT,
      created_by              TEXT REFERENCES users(id),
      created_at              TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at              TEXT NOT NULL DEFAULT (datetime('now')),
      synced_at               TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_commission_rules_scheme   ON commission_rules(scheme_id);
    CREATE INDEX IF NOT EXISTS idx_commission_rules_product  ON commission_rules(product_id);
    CREATE INDEX IF NOT EXISTS idx_commission_rules_category ON commission_rules(category_id);
    CREATE INDEX IF NOT EXISTS idx_commission_rules_status   ON commission_rules(status);

    CREATE TABLE IF NOT EXISTS commission_ledger (
      id                      TEXT PRIMARY KEY,
      source_table            TEXT NOT NULL,
      source_id               TEXT NOT NULL,
      scheme_id               TEXT REFERENCES chit_schemes(id),
      member_id               TEXT REFERENCES chit_members(id),
      rule_id                 TEXT REFERENCES commission_rules(id),
      is_bonus                INTEGER NOT NULL DEFAULT 0,
      registration_agent_id   TEXT REFERENCES agents(id),
      sales_agent_id          TEXT REFERENCES agents(id),
      base_amount             REAL NOT NULL DEFAULT 0,
      registration_commission REAL NOT NULL DEFAULT 0,
      sales_commission        REAL NOT NULL DEFAULT 0,
      total_commission        REAL NOT NULL DEFAULT 0,
      status                  TEXT NOT NULL DEFAULT 'pending',
      approved_by             TEXT REFERENCES users(id),
      approved_at             TEXT,
      paid_at                 TEXT,
      branch_id               TEXT REFERENCES branches(id),
      notes                   TEXT,
      created_at              TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at              TEXT NOT NULL DEFAULT (datetime('now')),
      synced_at               TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_commission_ledger_source  ON commission_ledger(source_table, source_id);
    CREATE INDEX IF NOT EXISTS idx_commission_ledger_scheme  ON commission_ledger(scheme_id);
    CREATE INDEX IF NOT EXISTS idx_commission_ledger_reg     ON commission_ledger(registration_agent_id);
    CREATE INDEX IF NOT EXISTS idx_commission_ledger_sales   ON commission_ledger(sales_agent_id);
    CREATE INDEX IF NOT EXISTS idx_commission_ledger_status  ON commission_ledger(status);
    CREATE INDEX IF NOT EXISTS idx_commission_ledger_branch  ON commission_ledger(branch_id);
  `)

  // Records an actual payment event to an agent, covering one or more
  // approved commission_ledger rows in one batch — commission_ledger.status
  // alone only says "paid", with no trail of when/how/by-whom/how-much was
  // actually handed over. A payout always targets exactly one agent (the
  // ledger rows it covers may themselves be split registration/sales
  // commission, but that split is intra-row, not something this table needs
  // to unpick — see commissions.ts:payouts:create).
  db.exec(`
    CREATE TABLE IF NOT EXISTS commission_payouts (
      id           TEXT PRIMARY KEY,
      agent_id     TEXT NOT NULL REFERENCES agents(id),
      branch_id    TEXT REFERENCES branches(id),
      amount       REAL NOT NULL DEFAULT 0,
      method       TEXT NOT NULL DEFAULT 'cash',
      reference    TEXT,
      paid_by      TEXT REFERENCES users(id),
      paid_at      TEXT NOT NULL DEFAULT (datetime('now')),
      notes        TEXT,
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
      synced_at    TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_commission_payouts_agent  ON commission_payouts(agent_id);
    CREATE INDEX IF NOT EXISTS idx_commission_payouts_branch ON commission_payouts(branch_id);
  `)
  if (!hasColumn('commission_ledger', 'payout_id')) {
    db.exec(`ALTER TABLE commission_ledger ADD COLUMN payout_id TEXT REFERENCES commission_payouts(id)`)
    db.exec(`CREATE INDEX IF NOT EXISTS idx_commission_ledger_payout ON commission_ledger(payout_id)`)
  }

  // Multi-level commission approval — the manager-level decision keeps
  // reusing the existing approved_by/approved_at (it always fires first);
  // these two are only for the second, Super-Admin-level decision. Their
  // absence also doubles as the one-time guard for the status-vocabulary
  // migration right below (both ship together, so "column doesn't exist yet"
  // reliably means "this install hasn't run either upgrade yet").
  if (!hasColumn('commission_ledger', 'admin_approved_by')) {
    db.exec(`ALTER TABLE commission_ledger ADD COLUMN admin_approved_by TEXT REFERENCES users(id)`)
    db.exec(`ALTER TABLE commission_ledger ADD COLUMN admin_approved_at TEXT`)
    // 'pending' was always manager-level (nobody had reviewed it yet);
    // 'approved' was always the old single manager-level approval (markPaid
    // separately required isCommissionAdmin, i.e. Super Admin already had to
    // act before 'paid' — so an 'approved' row is exactly a row that's now
    // awaiting that Super Admin step). 'paid' is unchanged.
    db.exec(`UPDATE commission_ledger SET status='pending_manager_approval' WHERE status='pending'`)
    db.exec(`UPDATE commission_ledger SET status='pending_admin_approval' WHERE status='approved'`)
  }

  // Structured commission approval/rejection/cancellation trail — one row
  // per status transition, distinct from the generic audit_logs (which
  // stores an unstructured JSON blob) because the approval-history UI needs
  // previous_status/new_status/remarks as first-class queryable fields.
  db.exec(`
    CREATE TABLE IF NOT EXISTS commission_approval_logs (
      id               TEXT PRIMARY KEY,
      commission_id    TEXT NOT NULL REFERENCES commission_ledger(id),
      agent_id         TEXT REFERENCES agents(id),
      branch_id        TEXT REFERENCES branches(id),
      action           TEXT NOT NULL,
      previous_status  TEXT,
      new_status       TEXT NOT NULL,
      changed_by       TEXT REFERENCES users(id),
      remarks          TEXT,
      created_at       TEXT NOT NULL DEFAULT (datetime('now')),
      synced_at        TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_commission_approval_logs_commission ON commission_approval_logs(commission_id);
    CREATE INDEX IF NOT EXISTS idx_commission_approval_logs_agent      ON commission_approval_logs(agent_id);
    CREATE INDEX IF NOT EXISTS idx_commission_approval_logs_branch     ON commission_approval_logs(branch_id);
  `)

  // One row per "Download Commission Statement" click — audit trail of who
  // pulled a statement, for which agent, and for what period.
  db.exec(`
    CREATE TABLE IF NOT EXISTS commission_statement_history (
      id            TEXT PRIMARY KEY,
      agent_id      TEXT NOT NULL REFERENCES agents(id),
      generated_by  TEXT REFERENCES users(id),
      period_from   TEXT,
      period_to     TEXT,
      status_filter TEXT,
      generated_at  TEXT NOT NULL DEFAULT (datetime('now')),
      synced_at     TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_commission_statement_history_agent ON commission_statement_history(agent_id);
  `)

  // Commission rule version history — a snapshot of a commission_rules row's
  // prior values, written just before a rate/scope-changing update is
  // applied. commission_ledger rows already store baked-in dollar amounts
  // (never a live rule reference), so past commissions were never at risk
  // from a later rate change — this only adds the ability to audit "what was
  // the rate on date X," which wasn't previously recorded anywhere.
  db.exec(`
    CREATE TABLE IF NOT EXISTS commission_rule_history (
      id                  TEXT PRIMARY KEY,
      rule_id             TEXT NOT NULL REFERENCES commission_rules(id),
      product_id          TEXT REFERENCES products(id),
      scope               TEXT NOT NULL,
      calculation_type    TEXT NOT NULL,
      rate                REAL NOT NULL DEFAULT 0,
      effective_start_date TEXT,
      effective_end_date   TEXT,
      created_by          TEXT REFERENCES users(id),
      created_at          TEXT NOT NULL DEFAULT (datetime('now')),
      synced_at           TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_commission_rule_history_rule ON commission_rule_history(rule_id);
  `)

  // Edit requests — a branch manager/cashier wanting to correct an
  // already-completed invoice line item or a direct stock quantity must
  // submit a request here; only after a Company Admin approves it does the
  // edit unlock (single-use, 48h window) for that specific user + record.
  db.exec(`
    CREATE TABLE IF NOT EXISTS edit_requests (
      id                  TEXT PRIMARY KEY,
      target_table        TEXT NOT NULL,
      target_record_id    TEXT NOT NULL,
      branch_id           TEXT REFERENCES branches(id),
      requested_by        TEXT NOT NULL REFERENCES users(id),
      reason              TEXT NOT NULL,
      requested_changes   TEXT NOT NULL,
      status              TEXT NOT NULL DEFAULT 'pending',
      reviewed_by         TEXT REFERENCES users(id),
      reviewed_at         TEXT,
      review_notes        TEXT,
      approved_expires_at TEXT,
      consumed_at         TEXT,
      created_at          TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
      synced_at           TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_edit_requests_target ON edit_requests(target_table, target_record_id);
    CREATE INDEX IF NOT EXISTS idx_edit_requests_status ON edit_requests(status);
    CREATE INDEX IF NOT EXISTS idx_edit_requests_requester ON edit_requests(requested_by);
    CREATE INDEX IF NOT EXISTS idx_edit_requests_branch ON edit_requests(branch_id);
  `)

  // Stock count sessions
  db.exec(`
    CREATE TABLE IF NOT EXISTS stock_movements (
      id                   TEXT PRIMARY KEY,
      product_id            TEXT NOT NULL REFERENCES products(id),
      from_branch_id        TEXT REFERENCES branches(id),
      to_branch_id          TEXT REFERENCES branches(id),
      quantity              INTEGER NOT NULL,
      movement_type         TEXT NOT NULL CHECK (movement_type IN ('SALE','TRANSFER','ADJUSTMENT','RECEIVE')),
      reference_order_id    TEXT,
      reference_transfer_id TEXT REFERENCES stock_transfers(id),
      notes                 TEXT,
      created_by            TEXT REFERENCES users(id),
      created_at            TEXT NOT NULL DEFAULT (datetime('now')),
      synced_at             TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_stock_movements_product ON stock_movements(product_id);
    CREATE INDEX IF NOT EXISTS idx_stock_movements_from_branch ON stock_movements(from_branch_id);
    CREATE INDEX IF NOT EXISTS idx_stock_movements_to_branch ON stock_movements(to_branch_id);
    CREATE INDEX IF NOT EXISTS idx_stock_movements_type ON stock_movements(movement_type);
    CREATE INDEX IF NOT EXISTS idx_stock_movements_created_at ON stock_movements(created_at);

    CREATE TABLE IF NOT EXISTS stock_count_sessions (
      id            TEXT PRIMARY KEY,
      branch_id     TEXT REFERENCES branches(id),
      warehouse_id  TEXT REFERENCES warehouses(id),
      notes         TEXT,
      status        TEXT NOT NULL DEFAULT 'draft',
      created_by    TEXT REFERENCES users(id),
      completed_by  TEXT REFERENCES users(id),
      completed_at  TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS stock_count_items (
      id           TEXT PRIMARY KEY,
      session_id   TEXT NOT NULL REFERENCES stock_count_sessions(id) ON DELETE CASCADE,
      product_id   TEXT NOT NULL REFERENCES products(id),
      system_qty   REAL NOT NULL DEFAULT 0,
      counted_qty  REAL,
      notes        TEXT,
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_stock_count_sessions_branch ON stock_count_sessions(branch_id);
    CREATE INDEX IF NOT EXISTS idx_stock_count_items_session   ON stock_count_items(session_id);
    CREATE INDEX IF NOT EXISTS idx_stock_count_items_product   ON stock_count_items(product_id);
  `)

  // Installment enhancements
  const instCols: [string, string][] = [
    ['down_payment',    'REAL NOT NULL DEFAULT 0'],
    ['monthly_amount',  'REAL NOT NULL DEFAULT 0'],
    ['customer_phone',  'TEXT'],
    ['last_paid_date',  'TEXT'],
    ['contract_number', 'TEXT'],
    ['branch_id',       'TEXT'],
    ['cash_price',      'REAL NOT NULL DEFAULT 0'],
    ['financed_amount', 'REAL NOT NULL DEFAULT 0'],
    ['interest_type',   "TEXT NOT NULL DEFAULT 'flat'"],
    ['interest_rate',   'REAL NOT NULL DEFAULT 0'],
    ['interest_amount', 'REAL NOT NULL DEFAULT 0'],
    ['penalty_amount',  'REAL NOT NULL DEFAULT 0'],
    ['grace_period_days', 'INTEGER NOT NULL DEFAULT 0'],
    ['late_fee',        'REAL NOT NULL DEFAULT 0'],
    ['remaining_installments', 'INTEGER NOT NULL DEFAULT 0'],
  ]
  for (const [col, def] of instCols) {
    if (!hasColumn('installments', col)) {
      db.exec(`ALTER TABLE installments ADD COLUMN ${col} ${def}`)
      console.log(`[DB] Migration: added installments.${col}`)
    }
  }
  // Back-fill monthly_amount for existing records where it's 0
  db.exec(`
    UPDATE installments
    SET monthly_amount = ROUND((due_amount + paid_amount - down_payment) / NULLIF(installment_count, 0), 2)
    WHERE monthly_amount = 0 AND installment_count > 0
  `)
  db.exec(`
    UPDATE installments
    SET contract_number = COALESCE(contract_number, 'INS-' || substr(id, 1, 8)),
        branch_id = COALESCE(branch_id, (SELECT branch_id FROM invoices WHERE invoices.id = installments.invoice_id)),
        cash_price = CASE WHEN cash_price = 0 THEN total_amount ELSE cash_price END,
        financed_amount = CASE WHEN financed_amount = 0 THEN total_amount - down_payment ELSE financed_amount END,
        remaining_installments = CASE
          WHEN remaining_installments = 0 THEN MAX(installment_count - (
            SELECT COUNT(*) FROM installment_payments ip
            WHERE ip.installment_id = installments.id
          ), 0)
          ELSE remaining_installments
        END
    WHERE 1=1
  `)
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_installments_contract ON installments(contract_number);
    CREATE INDEX IF NOT EXISTS idx_installments_branch ON installments(branch_id);
    CREATE INDEX IF NOT EXISTS idx_installments_next_due ON installments(next_due_date);

    CREATE TABLE IF NOT EXISTS installment_plans (
      id                 TEXT PRIMARY KEY,
      name               TEXT NOT NULL,
      months             INTEGER NOT NULL,
      interest_type      TEXT NOT NULL DEFAULT 'flat',
      interest_rate      REAL NOT NULL DEFAULT 0,
      min_down_payment_pct REAL NOT NULL DEFAULT 0,
      late_fee           REAL NOT NULL DEFAULT 0,
      grace_period_days  INTEGER NOT NULL DEFAULT 0,
      is_promotion       INTEGER NOT NULL DEFAULT 0,
      is_active          INTEGER NOT NULL DEFAULT 1,
      created_at         TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at         TEXT NOT NULL DEFAULT (datetime('now')),
      synced_at          TEXT
    );
    CREATE TABLE IF NOT EXISTS installment_schedule (
      id              TEXT PRIMARY KEY,
      installment_id  TEXT NOT NULL REFERENCES installments(id) ON DELETE CASCADE,
      installment_no  INTEGER NOT NULL,
      due_date        TEXT NOT NULL,
      principal       REAL NOT NULL DEFAULT 0,
      interest        REAL NOT NULL DEFAULT 0,
      penalty         REAL NOT NULL DEFAULT 0,
      total_due       REAL NOT NULL DEFAULT 0,
      paid_amount     REAL NOT NULL DEFAULT 0,
      status          TEXT NOT NULL DEFAULT 'pending',
      paid_at         TEXT,
      updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
      synced_at       TEXT,
      UNIQUE(installment_id, installment_no)
    );
    CREATE INDEX IF NOT EXISTS idx_installment_schedule_account ON installment_schedule(installment_id);
    CREATE INDEX IF NOT EXISTS idx_installment_schedule_due ON installment_schedule(due_date, status);

    CREATE TABLE IF NOT EXISTS installment_reminders (
      id              TEXT PRIMARY KEY,
      installment_id  TEXT NOT NULL REFERENCES installments(id) ON DELETE CASCADE,
      schedule_id     TEXT REFERENCES installment_schedule(id),
      channel         TEXT NOT NULL,
      reminder_type   TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'pending',
      message         TEXT,
      scheduled_at    TEXT NOT NULL,
      sent_at         TEXT,
      error           TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      synced_at       TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_installment_reminders_status ON installment_reminders(status, scheduled_at);
  `)

  const instPaymentCols: [string, string][] = [
    ['method', 'TEXT NOT NULL DEFAULT "cash"'],
    ['receipt_number', 'TEXT'],
    ['reference', 'TEXT'],
    ['receipt_image_url', 'TEXT'],
    ['status', "TEXT NOT NULL DEFAULT 'approved'"],
    ['verified_by', 'TEXT'],
    ['verified_at', 'TEXT'],
    ['rejected_reason', 'TEXT'],
    ['branch_id', 'TEXT'],
  ]
  for (const [col, def] of instPaymentCols) {
    if (!hasColumn('installment_payments', col)) {
      db.exec(`ALTER TABLE installment_payments ADD COLUMN ${col} ${def}`)
      console.log(`[DB] Migration: added installment_payments.${col}`)
    }
  }
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_installment_payments_status ON installment_payments(status);
    CREATE INDEX IF NOT EXISTS idx_installment_payments_branch ON installment_payments(branch_id);
    INSERT OR IGNORE INTO installment_plans
      (id, name, months, interest_type, interest_rate, min_down_payment_pct, late_fee, grace_period_days, is_promotion)
    VALUES
      ('plan-3-flat',  '3 Months',  3,  'flat', 0, 0, 0, 0, 0),
      ('plan-6-flat',  '6 Months',  6,  'flat', 0, 0, 0, 0, 0),
      ('plan-12-flat', '12 Months', 12, 'flat', 0, 0, 0, 0, 0),
      ('plan-18-flat', '18 Months', 18, 'flat', 0, 0, 0, 0, 0),
      ('plan-24-flat', '24 Months', 24, 'flat', 0, 0, 0, 0, 0),
      ('plan-36-flat', '36 Months', 36, 'flat', 0, 0, 0, 0, 0);
  `)

  // Returns & refunds
  db.exec(`
    CREATE TABLE IF NOT EXISTS returns (
      id             TEXT PRIMARY KEY,
      invoice_id     TEXT REFERENCES invoices(id),
      customer_id    TEXT REFERENCES customers(id),
      return_date    TEXT NOT NULL DEFAULT (datetime('now')),
      reason         TEXT NOT NULL DEFAULT '',
      total_refund   REAL NOT NULL DEFAULT 0,
      refund_method  TEXT NOT NULL DEFAULT 'cash',
      notes          TEXT,
      created_by     TEXT REFERENCES users(id),
      status         TEXT NOT NULL DEFAULT 'completed',
      created_at     TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS return_items (
      id              TEXT PRIMARY KEY,
      return_id       TEXT NOT NULL REFERENCES returns(id) ON DELETE CASCADE,
      product_id      TEXT REFERENCES products(id),
      invoice_item_id TEXT,
      quantity        REAL NOT NULL DEFAULT 1,
      unit_price      REAL NOT NULL DEFAULT 0,
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_returns_invoice ON returns(invoice_id);
    CREATE INDEX IF NOT EXISTS idx_returns_date ON returns(return_date);
  `)

  // Cash register sessions (day open/close)
  db.exec(`
    CREATE TABLE IF NOT EXISTS cash_sessions (
      id                    TEXT PRIMARY KEY,
      branch_id             TEXT REFERENCES branches(id),
      opened_by             TEXT REFERENCES users(id),
      opened_at             TEXT NOT NULL DEFAULT (datetime('now')),
      opening_cash          REAL NOT NULL DEFAULT 0,
      denominations         TEXT NOT NULL DEFAULT '{}',
      notes                 TEXT,
      closed_by             TEXT REFERENCES users(id),
      closed_at             TEXT,
      closing_cash          REAL DEFAULT 0,
      closing_denominations TEXT DEFAULT '{}',
      closing_notes         TEXT,
      sales_total           REAL DEFAULT 0,
      sales_count           INTEGER DEFAULT 0,
      difference            REAL DEFAULT 0,
      status                TEXT NOT NULL DEFAULT 'open',
      created_at            TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_cash_sessions_branch ON cash_sessions(branch_id);
  `)

  // Set branch code on seed branch if missing
  db.prepare(`
    UPDATE branches SET code = 'MAIN' WHERE id = 'b1111111-1111-4111-8111-111111111111' AND (code IS NULL OR code = '')
  `).run()

  // Notification center
  db.exec(`
    CREATE TABLE IF NOT EXISTS notifications (
      id          TEXT PRIMARY KEY,
      type        TEXT NOT NULL,
      title       TEXT NOT NULL,
      message     TEXT NOT NULL,
      is_read     INTEGER NOT NULL DEFAULT 0,
      data        TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_notifications_read    ON notifications(is_read);
    CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at DESC);
  `)
  // Targeting — all nullable, so NULL/NULL/NULL preserves today's broadcast
  // behavior (visible to everyone) for every pre-existing notification type.
  // Only new SmartBuy call sites (agent/scheme/commission events) set these;
  // low-stock alerts, chit payment/closing reminders, etc. are untouched.
  if (!hasColumn('notifications', 'user_id')) {
    db.exec(`ALTER TABLE notifications ADD COLUMN user_id TEXT REFERENCES users(id)`)
    db.exec(`ALTER TABLE notifications ADD COLUMN role_scope TEXT`)
    db.exec(`ALTER TABLE notifications ADD COLUMN target_branch_id TEXT REFERENCES branches(id)`)
    db.exec(`CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id)`)
    db.exec(`CREATE INDEX IF NOT EXISTS idx_notifications_role_branch ON notifications(role_scope, target_branch_id)`)
  }

  // ── Loyalty Points ─────────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS loyalty_config (
      id              TEXT PRIMARY KEY DEFAULT 'default',
      enabled         INTEGER NOT NULL DEFAULT 0,
      earn_points     INTEGER NOT NULL DEFAULT 1,
      earn_per_amount REAL    NOT NULL DEFAULT 100,
      redeem_points   INTEGER NOT NULL DEFAULT 100,
      redeem_value    REAL    NOT NULL DEFAULT 10,
      min_redeem      INTEGER NOT NULL DEFAULT 100,
      expiry_days     INTEGER NOT NULL DEFAULT 0,
      updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    INSERT OR IGNORE INTO loyalty_config (id) VALUES ('default');

    CREATE TABLE IF NOT EXISTS loyalty_transactions (
      id          TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL REFERENCES customers(id),
      invoice_id  TEXT REFERENCES invoices(id),
      type        TEXT NOT NULL CHECK (type IN ('earn','redeem','expire','adjust')),
      points      INTEGER NOT NULL,
      balance     INTEGER NOT NULL DEFAULT 0,
      note        TEXT,
      created_by  TEXT REFERENCES users(id),
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_loyalty_customer ON loyalty_transactions(customer_id);
    CREATE INDEX IF NOT EXISTS idx_loyalty_type     ON loyalty_transactions(type);
  `)
  if (!hasColumn('customers', 'loyalty_points')) {
    db.exec(`ALTER TABLE customers ADD COLUMN loyalty_points INTEGER NOT NULL DEFAULT 0`)
  }

  // ── Batch / Serial / Expiry Tracking ────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS product_batches (
      id            TEXT PRIMARY KEY,
      product_id    TEXT NOT NULL REFERENCES products(id),
      branch_id     TEXT REFERENCES branches(id),
      batch_number  TEXT,
      serial_number TEXT,
      expiry_date   TEXT,
      mfg_date      TEXT,
      quantity      REAL NOT NULL DEFAULT 0,
      cost_price    REAL NOT NULL DEFAULT 0,
      po_id         TEXT REFERENCES purchase_orders(id),
      notes         TEXT,
      created_by    TEXT REFERENCES users(id),
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_batches_product   ON product_batches(product_id);
    CREATE INDEX IF NOT EXISTS idx_batches_branch    ON product_batches(branch_id);
    CREATE INDEX IF NOT EXISTS idx_batches_expiry    ON product_batches(expiry_date);
    CREATE INDEX IF NOT EXISTS idx_batches_batch_no  ON product_batches(batch_number);
  `)
  if (!hasColumn('products', 'track_batches')) {
    db.exec(`ALTER TABLE products ADD COLUMN track_batches INTEGER NOT NULL DEFAULT 0`)
  }
  if (!hasColumn('products', 'track_serial')) {
    db.exec(`ALTER TABLE products ADD COLUMN track_serial INTEGER NOT NULL DEFAULT 0`)
  }
  if (!hasColumn('products', 'track_expiry')) {
    db.exec(`ALTER TABLE products ADD COLUMN track_expiry INTEGER NOT NULL DEFAULT 0`)
  }
  if (!hasColumn('purchase_items', 'batch_number')) {
    db.exec(`ALTER TABLE purchase_items ADD COLUMN batch_number TEXT`)
  }
  if (!hasColumn('purchase_items', 'expiry_date')) {
    db.exec(`ALTER TABLE purchase_items ADD COLUMN expiry_date TEXT`)
  }

  // ── 2FA columns ────────────────────────────────────────────────────────────
  if (!hasColumn('users', 'two_factor_enabled')) {
    db.exec(`ALTER TABLE users ADD COLUMN two_factor_enabled INTEGER NOT NULL DEFAULT 0`)
  }
  if (!hasColumn('users', 'two_factor_secret')) {
    db.exec(`ALTER TABLE users ADD COLUMN two_factor_secret TEXT`)
  }

  // Rename legacy 'Super Admin' role → 'Company Admin'
  db.prepare(`UPDATE roles SET name = 'Company Admin' WHERE name = 'Super Admin'`).run()

  // Add login_attempts and force_password_change columns if missing
  if (!hasColumn('users', 'login_attempts')) {
    db.exec(`ALTER TABLE users ADD COLUMN login_attempts INTEGER NOT NULL DEFAULT 0`)
  }
  if (!hasColumn('users', 'locked_until')) {
    db.exec(`ALTER TABLE users ADD COLUMN locked_until TEXT`)
  }
  if (!hasColumn('users', 'force_password_change')) {
    db.exec(`ALTER TABLE users ADD COLUMN force_password_change INTEGER NOT NULL DEFAULT 0`)
  }
  if (!hasColumn('stock_count_sessions', 'completed_by')) {
    db.exec(`ALTER TABLE stock_count_sessions ADD COLUMN completed_by TEXT REFERENCES users(id)`)
  }
  if (!hasColumn('stock_count_sessions', 'completed_at')) {
    db.exec(`ALTER TABLE stock_count_sessions ADD COLUMN completed_at TEXT`)
  }
  if (!hasColumn('stock_count_sessions', 'updated_at')) {
    db.exec(`ALTER TABLE stock_count_sessions ADD COLUMN updated_at TEXT NOT NULL DEFAULT (datetime('now'))`)
  }
  if (!hasColumn('stock_transfers', 'reject_reason')) {
    db.exec(`ALTER TABLE stock_transfers ADD COLUMN reject_reason TEXT`)
  }
  if (!hasColumn('stock_transfers', 'rejected_by')) {
    db.exec(`ALTER TABLE stock_transfers ADD COLUMN rejected_by TEXT`)
  }
  if (!hasColumn('stock_transfers', 'discrepancy_note')) {
    db.exec(`ALTER TABLE stock_transfers ADD COLUMN discrepancy_note TEXT`)
  }
  if (!hasColumn('stock_transfers', 'discrepancy_by')) {
    db.exec(`ALTER TABLE stock_transfers ADD COLUMN discrepancy_by TEXT`)
  }

  // ── Coupons: balance-type gift vouchers (cloud-synced) ─────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS coupons (
      id            TEXT PRIMARY KEY,
      code          TEXT NOT NULL UNIQUE,
      name          TEXT NOT NULL,
      customer_id   TEXT REFERENCES customers(id),
      branch_id     TEXT REFERENCES branches(id),
      initial_value REAL NOT NULL,
      balance       REAL NOT NULL,
      status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','used_up','expired','void')),
      valid_from    TEXT NOT NULL,
      valid_until   TEXT,
      issued_by     TEXT REFERENCES users(id),
      notes         TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
      synced_at     TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_coupons_code     ON coupons(code);
    CREATE INDEX IF NOT EXISTS idx_coupons_customer ON coupons(customer_id);
    CREATE INDEX IF NOT EXISTS idx_coupons_branch   ON coupons(branch_id);
    CREATE INDEX IF NOT EXISTS idx_coupons_status   ON coupons(status);

    CREATE TABLE IF NOT EXISTS coupon_redemptions (
      id            TEXT PRIMARY KEY,
      coupon_id     TEXT NOT NULL REFERENCES coupons(id),
      invoice_id    TEXT REFERENCES invoices(id),
      customer_id   TEXT,
      branch_id     TEXT,
      amount        REAL NOT NULL,
      balance_after REAL NOT NULL,
      type          TEXT NOT NULL DEFAULT 'redeem' CHECK (type IN ('redeem','reversal')),
      redeemed_by   TEXT REFERENCES users(id),
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
      synced_at     TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_coupon  ON coupon_redemptions(coupon_id);
    CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_invoice ON coupon_redemptions(invoice_id);
    CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_branch  ON coupon_redemptions(branch_id);
  `)

  // Grant coupon permissions to the system Branch Manager role (idempotent)
  try {
    const bm = db.prepare(`SELECT id, permissions FROM roles WHERE id = '4b7c9d0e-2f3a-5b4c-9d0e-2f3a4b7c9d0e'`)
      .get() as { id: string; permissions: string } | undefined
    if (bm) {
      const perms = JSON.parse(bm.permissions || '{}') as Record<string, boolean>
      if (!perms.coupons) {
        perms.coupons = true
        perms.coupons_create = true
        perms.coupons_reports = true
        db.prepare(`UPDATE roles SET permissions = ?, updated_at = datetime('now') WHERE id = ?`)
          .run(JSON.stringify(perms), bm.id)
        console.log('[DB] Migration: granted coupon permissions to Branch Manager role')
      }
    }
  } catch { /* roles table not ready — seed covers fresh installs */ }

  // ── Discounts: admin-managed product/branch discount rules ─────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS discounts (
      id                  TEXT PRIMARY KEY,
      name                TEXT NOT NULL,
      type                TEXT NOT NULL CHECK (type IN ('percentage','flat')),
      value               REAL NOT NULL,
      max_discount_amount REAL,
      scope               TEXT NOT NULL DEFAULT 'all' CHECK (scope IN ('all','product')),
      product_id          TEXT REFERENCES products(id),
      branch_id           TEXT REFERENCES branches(id),
      is_active           INTEGER NOT NULL DEFAULT 1,
      valid_from          TEXT,
      valid_until         TEXT,
      created_by          TEXT REFERENCES users(id),
      created_at          TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
      synced_at           TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_discounts_product ON discounts(product_id);
    CREATE INDEX IF NOT EXISTS idx_discounts_branch  ON discounts(branch_id);
  `)

  // ── Printers: which physical/OS printer handles which print purpose ───────
  // Local-only (no synced_at) — a Windows printer_name is only meaningful on
  // the machine it's installed on. device_id = '' means "branch-level default".
  db.exec(`
    CREATE TABLE IF NOT EXISTS printers (
      id               TEXT PRIMARY KEY,
      branch_id        TEXT NOT NULL REFERENCES branches(id),
      device_id        TEXT NOT NULL DEFAULT '',
      printer_name     TEXT NOT NULL,
      printer_type     TEXT NOT NULL DEFAULT 'thermal' CHECK (printer_type IN ('thermal','dot_matrix','laser','label')),
      connection_type  TEXT NOT NULL DEFAULT 'windows_driver' CHECK (connection_type IN ('windows_driver','network_escpos')),
      ip_address       TEXT,
      port             INTEGER,
      paper_size       TEXT,
      assigned_module  TEXT NOT NULL CHECK (assigned_module IN ('receipt','invoice','label','kitchen')),
      copies           INTEGER NOT NULL DEFAULT 1,
      is_active        INTEGER NOT NULL DEFAULT 1,
      created_by       TEXT REFERENCES users(id),
      created_at       TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_printers_branch ON printers(branch_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_printers_scope_module
      ON printers(branch_id, device_id, assigned_module);
  `)

  // ── One-time repair: merge duplicate stock rows created by a past sync bug ──
  // NULL warehouse_id defeats UNIQUE(product_id,branch_id,warehouse_id), so a
  // cloud-pull could insert a second row per product+branch instead of updating
  // the existing one, inflating every SUM(quantity) display (dashboard low-stock
  // count, product list, etc). Keep the most recently updated row, drop the rest.
  try {
    const dupGroups = db.prepare(`
      SELECT product_id, branch_id, COALESCE(warehouse_id, '') as wid
      FROM stocks
      GROUP BY product_id, branch_id, COALESCE(warehouse_id, '')
      HAVING COUNT(*) > 1
    `).all() as { product_id: string; branch_id: string; wid: string }[]

    if (dupGroups.length > 0) {
      const dedupe = db.transaction(() => {
        for (const g of dupGroups) {
          const rows = db.prepare(`
            SELECT id FROM stocks
            WHERE product_id = ? AND branch_id = ? AND COALESCE(warehouse_id, '') = ?
            ORDER BY datetime(updated_at) DESC, quantity DESC
          `).all(g.product_id, g.branch_id, g.wid) as { id: string }[]
          for (const loser of rows.slice(1)) {
            db.prepare(`DELETE FROM stocks WHERE id = ?`).run(loser.id)
          }
        }
      })
      dedupe()
      console.log(`[DB] Migration: merged duplicate stock rows for ${dupGroups.length} product/branch pair(s)`)
    }
  } catch (err) {
    console.error('[DB] Stocks dedup migration failed:', err)
  }

  // ── One-time backfill: push current stock/customer-balance truth to the cloud ──
  // Several flows (sales, transfers, PO receiving, stock counts, returns, imports)
  // used to mutate `stocks.quantity` / `customers.outstanding_due` locally without
  // ever enqueuing that change for sync — only the stock_movements audit trail
  // reached the cloud, not the resulting number. Local values have been correct
  // the whole time; they just never made it to the cloud/other devices. Push each
  // device's current local truth once so the cloud (and every other device) catches
  // up, without touching any data.
  db.exec(`CREATE TABLE IF NOT EXISTS app_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))`)
  const backfillName = 'sync_backfill_stocks_customers_v1'
  const backfillDone = db.prepare(`SELECT 1 FROM app_migrations WHERE name = ?`).get(backfillName)
  if (!backfillDone) {
    try {
      const stockRows = db.prepare(`SELECT * FROM stocks`).all() as Record<string, unknown>[]
      for (const row of stockRows) {
        void enqueuSync('stocks', String(row.id), 'UPDATE', row)
      }
      const customerRows = db.prepare(`SELECT * FROM customers WHERE outstanding_due > 0`).all() as Record<string, unknown>[]
      for (const row of customerRows) {
        void enqueuSync('customers', String(row.id), 'UPDATE', row)
      }
      db.prepare(`INSERT INTO app_migrations (name) VALUES (?)`).run(backfillName)
      console.log(`[DB] Migration: queued ${stockRows.length} stock row(s) and ${customerRows.length} customer row(s) for cloud sync backfill`)
    } catch (err) {
      console.error('[DB] Sync backfill migration failed:', err)
    }
  }
}

function seedDefaultData() {
  const bcrypt = require('bcryptjs')

  // Seed a default branch (using standard UUID format)
  const branchId = 'b1111111-1111-4111-8111-111111111111'
  db.prepare(`
    INSERT OR IGNORE INTO branches (id, name, address, phone)
    VALUES (?, 'Main Branch', 'Head Office', '+94 11 000 0000')
  `).run(branchId)

  // Seed a default warehouse (using standard UUID format)
  db.prepare(`
    INSERT OR IGNORE INTO warehouses (id, branch_id, name)
    VALUES (?, ?, 'Main Warehouse')
  `).run('w2222222-2222-4222-8222-222222222222', branchId)

  // Seed default company admin user (using standard UUID format and company admin role UUID)
  const hash = bcrypt.hashSync('admin123', 10)
  const pinHash = bcrypt.hashSync('1234', 10)
  db.prepare(`
    INSERT OR IGNORE INTO users (id, branch_id, role_id, name, email, password_hash, pin_hash)
    VALUES (?, ?, '3a6b8c9d-1e2f-4a3b-8c9d-1e2f3a6b8c9d', 'System Admin', 'admin@pos.local', ?, ?)
  `).run('u9999999-9999-4999-8999-999999999999', branchId, hash, pinHash)

  console.log('[DB] Default data seeded')
}
