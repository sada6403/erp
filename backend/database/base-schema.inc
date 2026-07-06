-- ═══════════════════════════════════════════════════════════════════════════
-- Enterprise POS ERP — PostgreSQL Cloud Schema
-- Base definitions for the self-hosted Next.js backend.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ─── BRANCHES ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS branches (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  address    TEXT,
  phone      TEXT,
  email      TEXT,
  is_active  BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── WAREHOUSES ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS warehouses (
  id         TEXT PRIMARY KEY,
  branch_id  TEXT NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  name       TEXT NOT NULL,
  location   TEXT,
  is_active  BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_warehouses_branch ON warehouses(branch_id);

-- ─── ROLES ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS roles (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  permissions JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── USERS ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  branch_id     TEXT REFERENCES branches(id) ON DELETE SET NULL,
  role_id       TEXT NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  pin           TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  last_login_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_users_branch ON users(branch_id);
CREATE INDEX IF NOT EXISTS idx_users_email  ON users(email);

-- ─── CATEGORIES ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS categories (
  id          TEXT PRIMARY KEY,
  parent_id   TEXT REFERENCES categories(id) ON DELETE SET NULL,
  name        TEXT NOT NULL,
  description TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── SUPPLIERS ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS suppliers (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  contact    TEXT,
  phone      TEXT,
  email      TEXT,
  address    TEXT,
  tax_number TEXT,
  is_active  BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── PRODUCTS ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS products (
  id              TEXT PRIMARY KEY,
  category_id     TEXT REFERENCES categories(id) ON DELETE SET NULL,
  supplier_id     TEXT REFERENCES suppliers(id) ON DELETE SET NULL,
  sku             TEXT NOT NULL UNIQUE,
  barcode         TEXT,
  name            TEXT NOT NULL,
  description     TEXT,
  image_url       TEXT,
  unit            TEXT NOT NULL DEFAULT 'pcs',
  cost_price      NUMERIC(14,2) NOT NULL DEFAULT 0,
  selling_price   NUMERIC(14,2) NOT NULL DEFAULT 0,
  tax_rate        NUMERIC(5,2)  NOT NULL DEFAULT 0,
  min_stock_level INTEGER NOT NULL DEFAULT 5,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_products_sku      ON products(sku);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_name_trgm ON products USING gin(name gin_trgm_ops);

-- ─── STOCKS ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS stocks (
  id           TEXT PRIMARY KEY,
  product_id   TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  branch_id    TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  warehouse_id TEXT REFERENCES warehouses(id) ON DELETE SET NULL,
  quantity     INTEGER NOT NULL DEFAULT 0,
  damaged_qty  INTEGER NOT NULL DEFAULT 0,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(product_id, branch_id, warehouse_id)
);
CREATE INDEX IF NOT EXISTS idx_stocks_product ON stocks(product_id);
CREATE INDEX IF NOT EXISTS idx_stocks_branch  ON stocks(branch_id);

CREATE TABLE IF NOT EXISTS stock_movements (
  id                   TEXT PRIMARY KEY,
  product_id            TEXT NOT NULL REFERENCES products(id),
  from_branch_id        TEXT REFERENCES branches(id),
  to_branch_id          TEXT REFERENCES branches(id),
  quantity              INTEGER NOT NULL,
  movement_type         TEXT NOT NULL CHECK (movement_type IN ('SALE','TRANSFER','ADJUSTMENT','RECEIVE')),
  reference_order_id    TEXT,
  reference_transfer_id TEXT,
  notes                 TEXT,
  created_by            TEXT REFERENCES users(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_stock_movements_product ON stock_movements(product_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_from_branch ON stock_movements(from_branch_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_to_branch ON stock_movements(to_branch_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_type ON stock_movements(movement_type);
CREATE INDEX IF NOT EXISTS idx_stock_movements_created_at ON stock_movements(created_at);

-- ─── STOCK TRANSFERS ────────────────────────────────────────────────────────
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
  dispatch_at       TIMESTAMPTZ,
  expected_delivery_at TIMESTAMPTZ,
  actual_delivery_at TIMESTAMPTZ,
  received_quantity INTEGER NOT NULL DEFAULT 0,
  missing_quantity  INTEGER NOT NULL DEFAULT 0,
  damaged_quantity  INTEGER NOT NULL DEFAULT 0,
  notes             TEXT,
  initiated_by      TEXT REFERENCES users(id),
  received_by       TEXT REFERENCES users(id),
  initiated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  received_at       TIMESTAMPTZ,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── CUSTOMERS ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS customers (
  id              TEXT PRIMARY KEY,
  branch_id       TEXT REFERENCES branches(id) ON DELETE SET NULL,
  name            TEXT NOT NULL,
  phone           TEXT,
  email           TEXT,
  address         TEXT,
  nic             TEXT,
  loyalty_points  INTEGER NOT NULL DEFAULT 0,
  credit_limit    NUMERIC(14,2) NOT NULL DEFAULT 0,
  outstanding_due NUMERIC(14,2) NOT NULL DEFAULT 0,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_customers_phone     ON customers(phone);
CREATE INDEX IF NOT EXISTS idx_customers_name_trgm ON customers USING gin(name gin_trgm_ops);

-- ─── INVOICES ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invoices (
  id              TEXT PRIMARY KEY,
  invoice_number  TEXT NOT NULL UNIQUE,
  branch_id       TEXT NOT NULL REFERENCES branches(id),
  customer_id     TEXT REFERENCES customers(id) ON DELETE SET NULL,
  cashier_id      TEXT NOT NULL REFERENCES users(id),
  status          TEXT NOT NULL DEFAULT 'draft',
  subtotal        NUMERIC(14,2) NOT NULL DEFAULT 0,
  discount_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  tax_amount      NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_amount    NUMERIC(14,2) NOT NULL DEFAULT 0,
  paid_amount     NUMERIC(14,2) NOT NULL DEFAULT 0,
  due_amount      NUMERIC(14,2) NOT NULL DEFAULT 0,
  agent_code      TEXT,
  agent_name      TEXT,
  agent_commission_pct    NUMERIC(6,2) NOT NULL DEFAULT 0,
  agent_commission_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  bill_type       TEXT,
  valid_until     TIMESTAMPTZ,
  due_date        TIMESTAMPTZ,
  approved_by     TEXT,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  synced_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_invoices_branch_date ON invoices(branch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_number      ON invoices(invoice_number);
CREATE INDEX IF NOT EXISTS idx_invoices_customer    ON invoices(customer_id);

-- ─── INVOICE ITEMS ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invoice_items (
  id              TEXT PRIMARY KEY,
  invoice_id      TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  product_id      TEXT NOT NULL REFERENCES products(id),
  quantity        INTEGER NOT NULL,
  unit_price      NUMERIC(14,2) NOT NULL,
  discount_pct    NUMERIC(5,2)  NOT NULL DEFAULT 0,
  discount_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  tax_rate        NUMERIC(5,2)  NOT NULL DEFAULT 0,
  tax_amount      NUMERIC(14,2) NOT NULL DEFAULT 0,
  line_total      NUMERIC(14,2) NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  synced_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_product ON invoice_items(product_id);

-- ─── PAYMENTS ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payments (
  id          TEXT PRIMARY KEY,
  invoice_id  TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  method      TEXT NOT NULL CHECK (method IN ('cash','card','bank_transfer','installment')),
  amount      NUMERIC(14,2) NOT NULL,
  reference   TEXT,
  received_by TEXT REFERENCES users(id),
  paid_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);

-- ─── INSTALLMENTS ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS installments (
  id                TEXT PRIMARY KEY,
  contract_number   TEXT UNIQUE,
  invoice_id        TEXT NOT NULL REFERENCES invoices(id),
  customer_id       TEXT NOT NULL REFERENCES customers(id),
  branch_id         TEXT REFERENCES branches(id),
  customer_phone    TEXT,
  cash_price        NUMERIC(14,2) NOT NULL DEFAULT 0,
  down_payment      NUMERIC(14,2) NOT NULL DEFAULT 0,
  financed_amount   NUMERIC(14,2) NOT NULL DEFAULT 0,
  interest_type     TEXT NOT NULL DEFAULT 'flat',
  interest_rate     NUMERIC(7,2) NOT NULL DEFAULT 0,
  interest_amount   NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_amount      NUMERIC(14,2) NOT NULL,
  paid_amount       NUMERIC(14,2) NOT NULL DEFAULT 0,
  due_amount        NUMERIC(14,2) NOT NULL,
  penalty_amount    NUMERIC(14,2) NOT NULL DEFAULT 0,
  grace_period_days INTEGER NOT NULL DEFAULT 0,
  late_fee          NUMERIC(14,2) NOT NULL DEFAULT 0,
  monthly_amount    NUMERIC(14,2) NOT NULL DEFAULT 0,
  installment_count INTEGER NOT NULL,
  remaining_installments INTEGER NOT NULL DEFAULT 0,
  frequency         TEXT NOT NULL DEFAULT 'monthly' CHECK (frequency IN ('weekly','monthly')),
  start_date        TEXT NOT NULL,
  next_due_date     TEXT,
  last_paid_date    TEXT,
  status            TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','completed','overdue','defaulted')),
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_installments_customer ON installments(customer_id);
CREATE INDEX IF NOT EXISTS idx_installments_status   ON installments(status);

CREATE TABLE IF NOT EXISTS installment_payments (
  id             TEXT PRIMARY KEY,
  installment_id TEXT NOT NULL REFERENCES installments(id) ON DELETE CASCADE,
  amount         NUMERIC(14,2) NOT NULL,
  method         TEXT NOT NULL DEFAULT 'cash',
  receipt_number TEXT,
  reference      TEXT,
  receipt_image_url TEXT,
  status         TEXT NOT NULL DEFAULT 'approved',
  paid_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  received_by    TEXT REFERENCES users(id),
  verified_by    TEXT REFERENCES users(id),
  verified_at    TIMESTAMPTZ,
  rejected_reason TEXT,
  branch_id      TEXT REFERENCES branches(id),
  notes          TEXT,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_installment_pmts ON installment_payments(installment_id);
CREATE INDEX IF NOT EXISTS idx_installment_pmts_status ON installment_payments(status);

CREATE TABLE IF NOT EXISTS installment_plans (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  months             INTEGER NOT NULL,
  interest_type      TEXT NOT NULL DEFAULT 'flat',
  interest_rate      NUMERIC(7,2) NOT NULL DEFAULT 0,
  min_down_payment_pct NUMERIC(7,2) NOT NULL DEFAULT 0,
  late_fee           NUMERIC(14,2) NOT NULL DEFAULT 0,
  grace_period_days  INTEGER NOT NULL DEFAULT 0,
  is_promotion       BOOLEAN NOT NULL DEFAULT false,
  is_active          BOOLEAN NOT NULL DEFAULT true,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS installment_schedule (
  id              TEXT PRIMARY KEY,
  installment_id  TEXT NOT NULL REFERENCES installments(id) ON DELETE CASCADE,
  installment_no  INTEGER NOT NULL,
  due_date        TEXT NOT NULL,
  principal       NUMERIC(14,2) NOT NULL DEFAULT 0,
  interest        NUMERIC(14,2) NOT NULL DEFAULT 0,
  penalty         NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_due       NUMERIC(14,2) NOT NULL DEFAULT 0,
  paid_amount     NUMERIC(14,2) NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'pending',
  paid_at         TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(installment_id, installment_no)
);
CREATE INDEX IF NOT EXISTS idx_installment_schedule_account ON installment_schedule(installment_id);

CREATE TABLE IF NOT EXISTS installment_reminders (
  id              TEXT PRIMARY KEY,
  installment_id  TEXT NOT NULL REFERENCES installments(id) ON DELETE CASCADE,
  schedule_id     TEXT REFERENCES installment_schedule(id),
  channel         TEXT NOT NULL,
  reminder_type   TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending',
  message         TEXT,
  scheduled_at    TIMESTAMPTZ NOT NULL,
  sent_at         TIMESTAMPTZ,
  error           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── DELIVERIES ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS deliveries (
  id            TEXT PRIMARY KEY,
  invoice_id    TEXT NOT NULL REFERENCES invoices(id),
  customer_id   TEXT NOT NULL REFERENCES customers(id),
  branch_id     TEXT NOT NULL REFERENCES branches(id),
  address       TEXT NOT NULL,
  assigned_to   TEXT REFERENCES users(id),
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','dispatched','delivered','failed')),
  scheduled_at  TIMESTAMPTZ,
  dispatched_at TIMESTAMPTZ,
  delivered_at  TIMESTAMPTZ,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_deliveries_branch ON deliveries(branch_id, status);

CREATE TABLE IF NOT EXISTS customer_orders (
  id TEXT PRIMARY KEY,
  order_number TEXT NOT NULL UNIQUE,
  branch_id TEXT NOT NULL REFERENCES branches(id),
  customer_id TEXT REFERENCES customers(id),
  customer_name TEXT NOT NULL,
  customer_phone TEXT,
  customer_address TEXT,
  sales_staff_id TEXT REFERENCES users(id),
  approved_by TEXT REFERENCES users(id),
  released_by TEXT REFERENCES users(id),
  driver_name TEXT,
  driver_phone TEXT,
  vehicle_number TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  payment_status TEXT NOT NULL DEFAULT 'unpaid',
  total_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  paid_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  delivery_date TIMESTAMPTZ,
  dispatch_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  delivery_confirmed_by TEXT REFERENCES users(id),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_customer_orders_branch ON customer_orders(branch_id);
CREATE INDEX IF NOT EXISTS idx_customer_orders_status ON customer_orders(status);

CREATE TABLE IF NOT EXISTS customer_order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES customer_orders(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL,
  unit_price NUMERIC(14,2) NOT NULL,
  line_total NUMERIC(14,2) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_customer_order_items_order ON customer_order_items(order_id);

-- ─── AUDIT LOGS ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_logs (
  id         TEXT PRIMARY KEY,
  user_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  branch_id  TEXT REFERENCES branches(id) ON DELETE SET NULL,
  action     TEXT NOT NULL,
  table_name TEXT,
  record_id  TEXT,
  old_values JSONB,
  new_values JSONB,
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user   ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_branch ON audit_logs(branch_id, created_at DESC);

-- ═══════════════════════════════════════════════════════════════════════════
-- AUTO updated_at TRIGGER
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_branches_upd         ON branches;
DROP TRIGGER IF EXISTS trg_warehouses_upd       ON warehouses;
DROP TRIGGER IF EXISTS trg_roles_upd            ON roles;
DROP TRIGGER IF EXISTS trg_users_upd            ON users;
DROP TRIGGER IF EXISTS trg_categories_upd       ON categories;
DROP TRIGGER IF EXISTS trg_suppliers_upd        ON suppliers;
DROP TRIGGER IF EXISTS trg_products_upd         ON products;
DROP TRIGGER IF EXISTS trg_stocks_upd           ON stocks;
DROP TRIGGER IF EXISTS trg_customers_upd        ON customers;
DROP TRIGGER IF EXISTS trg_invoices_upd         ON invoices;
DROP TRIGGER IF EXISTS trg_invoice_items_upd    ON invoice_items;
DROP TRIGGER IF EXISTS trg_payments_upd         ON payments;
DROP TRIGGER IF EXISTS trg_installments_upd     ON installments;
DROP TRIGGER IF EXISTS trg_installment_pmts_upd ON installment_payments;
DROP TRIGGER IF EXISTS trg_installment_plans_upd ON installment_plans;
DROP TRIGGER IF EXISTS trg_installment_schedule_upd ON installment_schedule;
DROP TRIGGER IF EXISTS trg_deliveries_upd       ON deliveries;
DROP TRIGGER IF EXISTS trg_audit_logs_upd       ON audit_logs;

CREATE TRIGGER trg_branches_upd         BEFORE UPDATE ON branches         FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_warehouses_upd       BEFORE UPDATE ON warehouses       FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_roles_upd            BEFORE UPDATE ON roles            FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_users_upd            BEFORE UPDATE ON users            FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_categories_upd       BEFORE UPDATE ON categories       FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_suppliers_upd        BEFORE UPDATE ON suppliers        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_products_upd         BEFORE UPDATE ON products         FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_stocks_upd           BEFORE UPDATE ON stocks           FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_customers_upd        BEFORE UPDATE ON customers        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_invoices_upd         BEFORE UPDATE ON invoices         FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_invoice_items_upd    BEFORE UPDATE ON invoice_items    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_payments_upd         BEFORE UPDATE ON payments         FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_installments_upd     BEFORE UPDATE ON installments     FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_installment_pmts_upd BEFORE UPDATE ON installment_payments FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_installment_plans_upd BEFORE UPDATE ON installment_plans FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_installment_schedule_upd BEFORE UPDATE ON installment_schedule FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_deliveries_upd       BEFORE UPDATE ON deliveries       FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_audit_logs_upd       BEFORE UPDATE ON audit_logs       FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY — allow anon key (used by offline-first Electron app)
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE branches          ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouses        ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles             ENABLE ROW LEVEL SECURITY;
ALTER TABLE users             ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories        ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers         ENABLE ROW LEVEL SECURITY;
ALTER TABLE products          ENABLE ROW LEVEL SECURITY;
ALTER TABLE stocks            ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movements   ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_transfers   ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers         ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices          ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_items     ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments          ENABLE ROW LEVEL SECURITY;
ALTER TABLE installments      ENABLE ROW LEVEL SECURITY;
ALTER TABLE installment_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE installment_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE installment_schedule ENABLE ROW LEVEL SECURITY;
ALTER TABLE installment_reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE deliveries        ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_orders   ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_order_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS anon_all ON branches;
DROP POLICY IF EXISTS anon_all ON warehouses;
DROP POLICY IF EXISTS anon_all ON roles;
DROP POLICY IF EXISTS anon_all ON users;
DROP POLICY IF EXISTS anon_all ON categories;
DROP POLICY IF EXISTS anon_all ON suppliers;
DROP POLICY IF EXISTS anon_all ON products;
DROP POLICY IF EXISTS anon_all ON stocks;
DROP POLICY IF EXISTS anon_all ON stock_movements;
DROP POLICY IF EXISTS anon_all ON stock_transfers;
DROP POLICY IF EXISTS anon_all ON customers;
DROP POLICY IF EXISTS anon_all ON invoices;
DROP POLICY IF EXISTS anon_all ON invoice_items;
DROP POLICY IF EXISTS anon_all ON payments;
DROP POLICY IF EXISTS anon_all ON installments;
DROP POLICY IF EXISTS anon_all ON installment_payments;
DROP POLICY IF EXISTS anon_all ON installment_plans;
DROP POLICY IF EXISTS anon_all ON installment_schedule;
DROP POLICY IF EXISTS anon_all ON installment_reminders;
DROP POLICY IF EXISTS anon_all ON deliveries;
DROP POLICY IF EXISTS anon_all ON audit_logs;
DROP POLICY IF EXISTS anon_all ON customer_orders;
DROP POLICY IF EXISTS anon_all ON customer_order_items;

CREATE POLICY anon_all ON branches          FOR ALL TO PUBLIC USING (true) WITH CHECK (true);
CREATE POLICY anon_all ON warehouses        FOR ALL TO PUBLIC USING (true) WITH CHECK (true);
CREATE POLICY anon_all ON roles             FOR ALL TO PUBLIC USING (true) WITH CHECK (true);
CREATE POLICY anon_all ON users             FOR ALL TO PUBLIC USING (true) WITH CHECK (true);
CREATE POLICY anon_all ON categories        FOR ALL TO PUBLIC USING (true) WITH CHECK (true);
CREATE POLICY anon_all ON suppliers         FOR ALL TO PUBLIC USING (true) WITH CHECK (true);
CREATE POLICY anon_all ON products          FOR ALL TO PUBLIC USING (true) WITH CHECK (true);
CREATE POLICY anon_all ON stocks            FOR ALL TO PUBLIC USING (true) WITH CHECK (true);
CREATE POLICY anon_all ON stock_movements   FOR ALL TO PUBLIC USING (true) WITH CHECK (true);
CREATE POLICY anon_all ON stock_transfers   FOR ALL TO PUBLIC USING (true) WITH CHECK (true);
CREATE POLICY anon_all ON customers         FOR ALL TO PUBLIC USING (true) WITH CHECK (true);
CREATE POLICY anon_all ON invoices          FOR ALL TO PUBLIC USING (true) WITH CHECK (true);
CREATE POLICY anon_all ON invoice_items     FOR ALL TO PUBLIC USING (true) WITH CHECK (true);
CREATE POLICY anon_all ON payments          FOR ALL TO PUBLIC USING (true) WITH CHECK (true);
CREATE POLICY anon_all ON installments      FOR ALL TO PUBLIC USING (true) WITH CHECK (true);
CREATE POLICY anon_all ON installment_payments FOR ALL TO PUBLIC USING (true) WITH CHECK (true);
CREATE POLICY anon_all ON installment_plans FOR ALL TO PUBLIC USING (true) WITH CHECK (true);
CREATE POLICY anon_all ON installment_schedule FOR ALL TO PUBLIC USING (true) WITH CHECK (true);
CREATE POLICY anon_all ON installment_reminders FOR ALL TO PUBLIC USING (true) WITH CHECK (true);
CREATE POLICY anon_all ON deliveries        FOR ALL TO PUBLIC USING (true) WITH CHECK (true);
CREATE POLICY anon_all ON audit_logs        FOR ALL TO PUBLIC USING (true) WITH CHECK (true);
CREATE POLICY anon_all ON customer_orders   FOR ALL TO PUBLIC USING (true) WITH CHECK (true);
CREATE POLICY anon_all ON customer_order_items FOR ALL TO PUBLIC USING (true) WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════════════════════
-- SEED DEFAULT ROLES
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO roles (id, name, permissions) VALUES
  ('3a6b8c9d-1e2f-4a3b-8c9d-1e2f3a6b8c9d', 'Super Admin',     '{"all":true}'),
  ('4b7c9d0e-2f3a-5b4c-9d0e-2f3a4b7c9d0e', 'Branch Manager',  '{"pos":true,"inventory":true,"reports":true,"customers":true,"employees":true}'),
  ('5c8d0e1f-3a4b-6c5d-0e1f-3a4b5c8d0e1f', 'Cashier',         '{"pos":true,"customers":true}'),
  ('6d9e1f2a-4b5c-7d6e-1f2a-4b5c6d9e1f2a', 'Warehouse Staff', '{"inventory":true,"transfers":true}'),
  ('7e0f2a3b-5c6d-8e7f-2a3b-5c6d7e0f2a3b', 'Delivery Staff',  '{"deliveries":true}')
ON CONFLICT (id) DO NOTHING;
