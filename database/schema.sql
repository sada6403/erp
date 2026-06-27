-- Enterprise POS ERP - Local SQLite Schema
-- Offline-first: every record is created locally, then synced to the VPS API

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA synchronous = NORMAL;

-- ─── BRANCHES ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS branches (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  address     TEXT,
  phone       TEXT,
  email       TEXT,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  synced_at   TEXT
);

-- ─── WAREHOUSES ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS warehouses (
  id          TEXT PRIMARY KEY,
  branch_id   TEXT NOT NULL REFERENCES branches(id),
  name        TEXT NOT NULL,
  location    TEXT,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  synced_at   TEXT
);

-- ─── ROLES ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS roles (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  permissions TEXT NOT NULL DEFAULT '{}',  -- JSON
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  synced_at   TEXT
);

-- ─── USERS ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  branch_id     TEXT REFERENCES branches(id),
  role_id       TEXT NOT NULL REFERENCES roles(id),
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  pin           TEXT,                       -- 4-6 digit quick login
  is_active     INTEGER NOT NULL DEFAULT 1,
  last_login_at TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  synced_at     TEXT
);

-- ─── CATEGORIES ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS categories (
  id          TEXT PRIMARY KEY,
  parent_id   TEXT REFERENCES categories(id),
  name        TEXT NOT NULL,
  description TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  synced_at   TEXT
);

-- ─── SUPPLIERS ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS suppliers (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  contact     TEXT,
  phone       TEXT,
  email       TEXT,
  address     TEXT,
  tax_number  TEXT,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  synced_at   TEXT
);

-- ─── PRODUCTS ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS products (
  id              TEXT PRIMARY KEY,
  category_id     TEXT REFERENCES categories(id),
  supplier_id     TEXT REFERENCES suppliers(id),
  sku             TEXT NOT NULL UNIQUE,
  barcode         TEXT,
  name            TEXT NOT NULL,
  description     TEXT,
  image_url       TEXT,
  unit            TEXT NOT NULL DEFAULT 'pcs',
  cost_price      REAL NOT NULL DEFAULT 0,
  selling_price   REAL NOT NULL DEFAULT 0,
  tax_rate        REAL NOT NULL DEFAULT 0,
  min_stock_level INTEGER NOT NULL DEFAULT 5,
  is_active       INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  synced_at       TEXT
);

CREATE INDEX IF NOT EXISTS idx_products_sku      ON products(sku);
CREATE INDEX IF NOT EXISTS idx_products_barcode  ON products(barcode);
CREATE INDEX IF NOT EXISTS idx_products_name     ON products(name);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);

-- ─── STOCKS ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS stocks (
  id           TEXT PRIMARY KEY,
  product_id   TEXT NOT NULL REFERENCES products(id),
  branch_id    TEXT NOT NULL REFERENCES branches(id),
  warehouse_id TEXT REFERENCES warehouses(id),
  quantity     INTEGER NOT NULL DEFAULT 0,
  damaged_qty  INTEGER NOT NULL DEFAULT 0,
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  synced_at    TEXT,
  UNIQUE(product_id, branch_id, warehouse_id)
);

CREATE INDEX IF NOT EXISTS idx_stocks_product ON stocks(product_id);
CREATE INDEX IF NOT EXISTS idx_stocks_branch  ON stocks(branch_id);

-- ─── STOCK TRANSFERS ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS stock_transfers (
  id                TEXT PRIMARY KEY,
  transfer_number   TEXT UNIQUE,
  product_id        TEXT NOT NULL REFERENCES products(id),
  from_branch_id    TEXT REFERENCES branches(id),
  to_branch_id      TEXT REFERENCES branches(id),
  from_warehouse_id TEXT REFERENCES warehouses(id),
  to_warehouse_id   TEXT REFERENCES warehouses(id),
  quantity          INTEGER NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending_approval',
  approved_by       TEXT REFERENCES users(id),
  released_by       TEXT REFERENCES users(id),
  driver_name       TEXT,
  driver_phone      TEXT,
  vehicle_number    TEXT,
  dispatch_at       TEXT,
  expected_delivery_at TEXT,
  actual_delivery_at TEXT,
  received_quantity INTEGER NOT NULL DEFAULT 0,
  missing_quantity  INTEGER NOT NULL DEFAULT 0,
  damaged_quantity  INTEGER NOT NULL DEFAULT 0,
  notes             TEXT,
  initiated_by      TEXT REFERENCES users(id),
  received_by       TEXT REFERENCES users(id),
  initiated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  received_at       TEXT,
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  synced_at         TEXT
);

-- Customer orders remain independent from invoices so quotations, deposits,
-- fulfillment, transfers and delivery can be tracked before final billing.
CREATE TABLE IF NOT EXISTS customer_orders (
  id                    TEXT PRIMARY KEY,
  order_number          TEXT NOT NULL UNIQUE,
  branch_id             TEXT NOT NULL REFERENCES branches(id),
  customer_id           TEXT REFERENCES customers(id),
  customer_name         TEXT NOT NULL,
  customer_phone        TEXT,
  customer_address      TEXT,
  sales_staff_id        TEXT REFERENCES users(id),
  approved_by           TEXT REFERENCES users(id),
  released_by           TEXT REFERENCES users(id),
  driver_name           TEXT,
  driver_phone          TEXT,
  vehicle_number        TEXT,
  status                TEXT NOT NULL DEFAULT 'pending',
  payment_status        TEXT NOT NULL DEFAULT 'unpaid',
  total_amount          REAL NOT NULL DEFAULT 0,
  paid_amount           REAL NOT NULL DEFAULT 0,
  delivery_date         TEXT,
  dispatch_at           TEXT,
  delivered_at          TEXT,
  delivery_confirmed_by TEXT REFERENCES users(id),
  notes                 TEXT,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now')),
  synced_at             TEXT
);

CREATE TABLE IF NOT EXISTS customer_order_items (
  id          TEXT PRIMARY KEY,
  order_id    TEXT NOT NULL REFERENCES customer_orders(id) ON DELETE CASCADE,
  product_id  TEXT NOT NULL REFERENCES products(id),
  quantity    INTEGER NOT NULL,
  unit_price  REAL NOT NULL,
  line_total  REAL NOT NULL,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  synced_at   TEXT
);

CREATE INDEX IF NOT EXISTS idx_customer_orders_branch ON customer_orders(branch_id);
CREATE INDEX IF NOT EXISTS idx_customer_orders_status ON customer_orders(status);
CREATE INDEX IF NOT EXISTS idx_customer_order_items_order ON customer_order_items(order_id);

-- ─── STOCK COUNT SESSIONS ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS stock_count_sessions (
  id            TEXT PRIMARY KEY,
  branch_id     TEXT NOT NULL REFERENCES branches(id),
  warehouse_id  TEXT REFERENCES warehouses(id),
  status        TEXT NOT NULL DEFAULT 'in_progress', -- draft|in_progress|completed|cancelled
  notes         TEXT,
  created_by    TEXT REFERENCES users(id),
  completed_by  TEXT REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at  TEXT,
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  synced_at     TEXT
);

CREATE TABLE IF NOT EXISTS stock_count_items (
  id            TEXT PRIMARY KEY,
  session_id    TEXT NOT NULL REFERENCES stock_count_sessions(id) ON DELETE CASCADE,
  product_id    TEXT NOT NULL REFERENCES products(id),
  system_qty    INTEGER NOT NULL DEFAULT 0,
  counted_qty   INTEGER,
  variance      INTEGER GENERATED ALWAYS AS (CASE WHEN counted_qty IS NOT NULL THEN counted_qty - system_qty ELSE NULL END) VIRTUAL,
  notes         TEXT,
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(session_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_stock_count_items_session ON stock_count_items(session_id);

-- ─── CUSTOMERS ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS customers (
  id              TEXT PRIMARY KEY,
  branch_id       TEXT REFERENCES branches(id),
  name            TEXT NOT NULL,
  phone           TEXT,
  email           TEXT,
  address         TEXT,
  nic             TEXT,                   -- National ID
  loyalty_points  INTEGER NOT NULL DEFAULT 0,
  credit_limit    REAL NOT NULL DEFAULT 0,
  outstanding_due REAL NOT NULL DEFAULT 0,
  notes           TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  synced_at       TEXT
);

CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);
CREATE INDEX IF NOT EXISTS idx_customers_name  ON customers(name);

-- ─── INVOICES ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invoices (
  id              TEXT PRIMARY KEY,
  invoice_number  TEXT NOT NULL UNIQUE,
  branch_id       TEXT NOT NULL REFERENCES branches(id),
  customer_id     TEXT REFERENCES customers(id),
  cashier_id      TEXT NOT NULL REFERENCES users(id),
  status          TEXT NOT NULL DEFAULT 'draft', -- draft|held|completed|returned|cancelled
  subtotal        REAL NOT NULL DEFAULT 0,
  discount_amount REAL NOT NULL DEFAULT 0,
  tax_amount      REAL NOT NULL DEFAULT 0,
  total_amount    REAL NOT NULL DEFAULT 0,
  paid_amount     REAL NOT NULL DEFAULT 0,
  due_amount      REAL NOT NULL DEFAULT 0,
  notes           TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  synced_at       TEXT
);

CREATE INDEX IF NOT EXISTS idx_invoices_number   ON invoices(invoice_number);
CREATE INDEX IF NOT EXISTS idx_invoices_branch   ON invoices(branch_id);
CREATE INDEX IF NOT EXISTS idx_invoices_customer ON invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status   ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_created  ON invoices(created_at);

-- ─── INVOICE ITEMS ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invoice_items (
  id              TEXT PRIMARY KEY,
  invoice_id      TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  product_id      TEXT NOT NULL REFERENCES products(id),
  quantity        INTEGER NOT NULL,
  unit_price      REAL NOT NULL,
  discount_pct    REAL NOT NULL DEFAULT 0,
  discount_amount REAL NOT NULL DEFAULT 0,
  tax_rate        REAL NOT NULL DEFAULT 0,
  tax_amount      REAL NOT NULL DEFAULT 0,
  line_total      REAL NOT NULL,
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  synced_at       TEXT
);

CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice  ON invoice_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_product  ON invoice_items(product_id);

-- ─── PAYMENTS ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payments (
  id             TEXT PRIMARY KEY,
  invoice_id     TEXT NOT NULL REFERENCES invoices(id),
  method         TEXT NOT NULL, -- cash|card|bank_transfer|installment
  amount         REAL NOT NULL,
  reference      TEXT,          -- card ref / bank ref
  received_by    TEXT REFERENCES users(id),
  paid_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  synced_at      TEXT
);

CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);

-- ─── INSTALLMENTS ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS installments (
  id           TEXT PRIMARY KEY,
  invoice_id   TEXT NOT NULL REFERENCES invoices(id),
  customer_id  TEXT NOT NULL REFERENCES customers(id),
  total_amount REAL NOT NULL,
  paid_amount  REAL NOT NULL DEFAULT 0,
  due_amount   REAL NOT NULL,
  installment_count INTEGER NOT NULL,
  frequency    TEXT NOT NULL DEFAULT 'monthly', -- weekly|monthly
  start_date   TEXT NOT NULL,
  next_due_date TEXT,
  status       TEXT NOT NULL DEFAULT 'active', -- active|completed|overdue|defaulted
  notes        TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  synced_at    TEXT
);

CREATE TABLE IF NOT EXISTS installment_payments (
  id              TEXT PRIMARY KEY,
  installment_id  TEXT NOT NULL REFERENCES installments(id),
  amount          REAL NOT NULL,
  paid_at         TEXT NOT NULL DEFAULT (datetime('now')),
  received_by     TEXT REFERENCES users(id),
  notes           TEXT,
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  synced_at       TEXT
);

-- ─── DELIVERIES ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS deliveries (
  id              TEXT PRIMARY KEY,
  invoice_id      TEXT NOT NULL REFERENCES invoices(id),
  customer_id     TEXT NOT NULL REFERENCES customers(id),
  branch_id       TEXT NOT NULL REFERENCES branches(id),
  address         TEXT NOT NULL,
  assigned_to     TEXT REFERENCES users(id),
  status          TEXT NOT NULL DEFAULT 'pending', -- pending|dispatched|delivered|failed
  scheduled_at    TEXT,
  dispatched_at   TEXT,
  delivered_at    TEXT,
  notes           TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  synced_at       TEXT
);

-- ─── SYNC QUEUE ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sync_queue (
  id           TEXT PRIMARY KEY,
  table_name   TEXT NOT NULL,
  record_id    TEXT NOT NULL,
  operation    TEXT NOT NULL, -- INSERT|UPDATE|DELETE
  payload      TEXT NOT NULL, -- JSON
  attempts     INTEGER NOT NULL DEFAULT 0,
  last_error   TEXT,
  status       TEXT NOT NULL DEFAULT 'pending', -- pending|processing|synced|failed
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  synced_at    TEXT
);

CREATE INDEX IF NOT EXISTS idx_sync_queue_status ON sync_queue(status);
CREATE INDEX IF NOT EXISTS idx_sync_queue_table  ON sync_queue(table_name, record_id);

-- ─── AUDIT LOGS ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_logs (
  id         TEXT PRIMARY KEY,
  user_id    TEXT REFERENCES users(id),
  branch_id  TEXT REFERENCES branches(id),
  action     TEXT NOT NULL,
  table_name TEXT,
  record_id  TEXT,
  old_values TEXT, -- JSON
  new_values TEXT, -- JSON
  ip_address TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  synced_at  TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user   ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_date   ON audit_logs(created_at);

-- ─── SEED DEFAULT ROLES ────────────────────────────────────────────────────
INSERT OR IGNORE INTO roles (id, name, permissions) VALUES
  ('3a6b8c9d-1e2f-4a3b-8c9d-1e2f3a6b8c9d',   'Super Admin',     '{"all":true}'),
  ('4b7c9d0e-2f3a-5b4c-9d0e-2f3a4b7c9d0e',   'Branch Manager',  '{"pos":true,"inventory":true,"reports":true,"customers":true,"employees":true}'),
  ('5c8d0e1f-3a4b-6c5d-0e1f-3a4b5c8d0e1f',   'Cashier',         '{"pos":true,"customers":true}'),
  ('6d9e1f2a-4b5c-7d6e-1f2a-4b5c6d9e1f2a',   'Warehouse Staff', '{"inventory":true,"transfers":true}'),
  ('7e0f2a3b-5c6d-8e7f-2a3b-5c6d7e0f2a3b',   'Delivery Staff',  '{"deliveries":true}');
