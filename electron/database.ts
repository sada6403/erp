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
    // Bill type system
    ['invoices', 'bill_type',    "TEXT NOT NULL DEFAULT 'RETAIL'"],
    ['invoices', 'valid_until',  "TEXT"],
    ['invoices', 'due_date',     "TEXT"],
    ['invoices', 'approved_by',  "TEXT"],
    ['invoices', 'locked_at',    "TEXT"],
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
  ]

  for (const [table, column, definition] of migrations) {
    if (!hasColumn(table, column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
      console.log(`[DB] Migration: added ${table}.${column}`)
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

  // Seed super admin user (using standard UUID format and super admin role UUID)
  const hash = bcrypt.hashSync('admin123', 10)
  db.prepare(`
    INSERT OR IGNORE INTO users (id, branch_id, role_id, name, email, password_hash, pin)
    VALUES (?, ?, '3a6b8c9d-1e2f-4a3b-8c9d-1e2f3a6b8c9d', 'System Admin', 'admin@pos.local', ?, '1234')
  `).run('u9999999-9999-4999-8999-999999999999', branchId, hash)

  console.log('[DB] Default data seeded')
}
