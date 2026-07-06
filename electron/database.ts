import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'
import { app } from 'electron'

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
  } else {
    runMigrations()
  }

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
    // Hashed quick-login PIN — syncs to the cloud (users.pin_hash), unlike the
    // legacy plaintext `pin` column which stays local-only.
    ['users', 'pin_hash', "TEXT"],
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
