import { pool, tenantPool } from './db'
import { randomUUID } from 'crypto'
import bcrypt from 'bcryptjs'
import type { QueryClient } from './db'

// ─── Resolve the per-tenant database name for a company ───────────────────────
export async function getTenantSchema(companyId: string): Promise<string | null> {
  const { rows } = await pool.query(
    `SELECT db_schema FROM companies WHERE id = ? AND status != 'cancelled'`,
    [companyId]
  )
  return (rows[0] as Record<string, string>)?.db_schema ?? null
}

// ─── Run a query inside a tenant's MySQL database ─────────────────────────────
export async function withTenant<T>(
  companyId: string,
  fn: (client: QueryClient) => Promise<T>
): Promise<T> {
  const database = await getTenantSchema(companyId)
  if (!database) throw new Error(`Company ${companyId} not found or cancelled`)
  const tp = tenantPool(database)
  const client = await tp.connect()
  try {
    return await fn(client)
  } finally {
    client.release()
  }
}

// ─── Generate URL-safe slug ───────────────────────────────────────────────────
function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50)
}

async function uniqueSlug(base: string): Promise<string> {
  let slug = base, attempt = 0
  while (true) {
    const { rows } = await pool.query(`SELECT 1 FROM companies WHERE slug = ?`, [slug])
    if (!rows.length) return slug
    slug = `${base}-${++attempt}`
  }
}

// ─── Tenant tables SQL (MySQL syntax) ────────────────────────────────────────
const TENANT_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS branches (
  id          CHAR(36)     NOT NULL PRIMARY KEY,
  name        VARCHAR(255) NOT NULL,
  code        VARCHAR(50)  NOT NULL UNIQUE,
  address     TEXT,
  phone       VARCHAR(50),
  manager_id  CHAR(36),
  is_active   BOOLEAN      NOT NULL DEFAULT 1,
  created_at  DATETIME     NOT NULL DEFAULT NOW(),
  updated_at  DATETIME     NOT NULL DEFAULT NOW() ON UPDATE NOW()
);

CREATE TABLE IF NOT EXISTS roles (
  id          CHAR(36)     NOT NULL PRIMARY KEY,
  name        VARCHAR(100) NOT NULL UNIQUE,
  permissions JSON         NOT NULL,
  is_system   BOOLEAN      NOT NULL DEFAULT 0,
  created_at  DATETIME     NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id            CHAR(36)     NOT NULL PRIMARY KEY,
  branch_id     CHAR(36),
  role_id       CHAR(36)     NOT NULL,
  name          VARCHAR(255) NOT NULL,
  email         VARCHAR(255) NOT NULL UNIQUE,
  phone         VARCHAR(50),
  password_hash VARCHAR(255) NOT NULL,
  pin_hash      VARCHAR(255),
  is_active     BOOLEAN      NOT NULL DEFAULT 1,
  last_login_at DATETIME,
  created_at    DATETIME     NOT NULL DEFAULT NOW(),
  updated_at    DATETIME     NOT NULL DEFAULT NOW() ON UPDATE NOW(),
  FOREIGN KEY (role_id) REFERENCES roles(id)
);

CREATE TABLE IF NOT EXISTS categories (
  id         CHAR(36)     NOT NULL PRIMARY KEY,
  name       VARCHAR(255) NOT NULL,
  parent_id  CHAR(36),
  created_at DATETIME     NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS products (
  id             CHAR(36)       NOT NULL PRIMARY KEY,
  category_id    CHAR(36),
  name           VARCHAR(255)   NOT NULL,
  sku            VARCHAR(100)   NOT NULL UNIQUE,
  barcode        VARCHAR(100),
  description    TEXT,
  cost_price     DECIMAL(12,2)  NOT NULL DEFAULT 0,
  selling_price  DECIMAL(12,2)  NOT NULL DEFAULT 0,
  tax_rate       DECIMAL(5,2)   NOT NULL DEFAULT 0,
  track_stock    BOOLEAN        NOT NULL DEFAULT 1,
  is_active      BOOLEAN        NOT NULL DEFAULT 1,
  image_url      TEXT,
  created_at     DATETIME       NOT NULL DEFAULT NOW(),
  updated_at     DATETIME       NOT NULL DEFAULT NOW() ON UPDATE NOW()
);

CREATE TABLE IF NOT EXISTS stock_levels (
  id         CHAR(36)      NOT NULL PRIMARY KEY,
  product_id CHAR(36)      NOT NULL,
  branch_id  CHAR(36)      NOT NULL,
  quantity   DECIMAL(12,2) NOT NULL DEFAULT 0,
  reorder_at DECIMAL(12,2) NOT NULL DEFAULT 0,
  updated_at DATETIME      NOT NULL DEFAULT NOW() ON UPDATE NOW(),
  UNIQUE KEY uq_stock (product_id, branch_id)
);

CREATE TABLE IF NOT EXISTS customers (
  id            CHAR(36)      NOT NULL PRIMARY KEY,
  name          VARCHAR(255)  NOT NULL,
  email         VARCHAR(255),
  phone         VARCHAR(50),
  address       TEXT,
  loyalty_pts   INT           NOT NULL DEFAULT 0,
  credit_limit  DECIMAL(12,2) NOT NULL DEFAULT 0,
  outstanding   DECIMAL(12,2) NOT NULL DEFAULT 0,
  is_active     BOOLEAN       NOT NULL DEFAULT 1,
  created_at    DATETIME      NOT NULL DEFAULT NOW(),
  updated_at    DATETIME      NOT NULL DEFAULT NOW() ON UPDATE NOW()
);

CREATE TABLE IF NOT EXISTS invoices (
  id             CHAR(36)      NOT NULL PRIMARY KEY,
  invoice_no     VARCHAR(50)   NOT NULL UNIQUE,
  branch_id      CHAR(36)      NOT NULL,
  customer_id    CHAR(36),
  cashier_id     CHAR(36),
  subtotal       DECIMAL(12,2) NOT NULL DEFAULT 0,
  discount       DECIMAL(12,2) NOT NULL DEFAULT 0,
  tax            DECIMAL(12,2) NOT NULL DEFAULT 0,
  total          DECIMAL(12,2) NOT NULL DEFAULT 0,
  paid           DECIMAL(12,2) NOT NULL DEFAULT 0,
  change_due     DECIMAL(12,2) NOT NULL DEFAULT 0,
  payment_method VARCHAR(50)   NOT NULL DEFAULT 'cash',
  status         VARCHAR(20)   NOT NULL DEFAULT 'completed',
  notes          TEXT,
  created_at     DATETIME      NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS invoice_items (
  id          CHAR(36)      NOT NULL PRIMARY KEY,
  invoice_id  CHAR(36)      NOT NULL,
  product_id  CHAR(36)      NOT NULL,
  name        VARCHAR(255)  NOT NULL,
  sku         VARCHAR(100)  NOT NULL,
  qty         DECIMAL(12,2) NOT NULL,
  unit_price  DECIMAL(12,2) NOT NULL,
  discount    DECIMAL(12,2) NOT NULL DEFAULT 0,
  tax_rate    DECIMAL(5,2)  NOT NULL DEFAULT 0,
  total       DECIMAL(12,2) NOT NULL,
  FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS installment_plans (
  id                   CHAR(36)      NOT NULL PRIMARY KEY,
  name                 VARCHAR(255)  NOT NULL,
  months               INT           NOT NULL,
  interest_type        VARCHAR(20)   NOT NULL DEFAULT 'flat',
  interest_rate        DECIMAL(5,2)  NOT NULL DEFAULT 0,
  min_down_payment_pct DECIMAL(5,2)  NOT NULL DEFAULT 10,
  late_fee             DECIMAL(10,2) NOT NULL DEFAULT 0,
  grace_period_days    INT           NOT NULL DEFAULT 3,
  is_promotion         BOOLEAN       NOT NULL DEFAULT 0,
  is_active            BOOLEAN       NOT NULL DEFAULT 1,
  created_at           DATETIME      NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS installments (
  id                     CHAR(36)      NOT NULL PRIMARY KEY,
  contract_number        VARCHAR(50)   NOT NULL UNIQUE,
  invoice_id             CHAR(36),
  customer_id            CHAR(36)      NOT NULL,
  branch_id              CHAR(36)      NOT NULL,
  plan_id                CHAR(36),
  cash_price             DECIMAL(12,2) NOT NULL,
  down_payment           DECIMAL(12,2) NOT NULL DEFAULT 0,
  financed_amount        DECIMAL(12,2) NOT NULL,
  interest_type          VARCHAR(20)   NOT NULL DEFAULT 'flat',
  interest_rate          DECIMAL(5,2)  NOT NULL DEFAULT 0,
  interest_amount        DECIMAL(12,2) NOT NULL DEFAULT 0,
  total_amount           DECIMAL(12,2) NOT NULL,
  paid_amount            DECIMAL(12,2) NOT NULL DEFAULT 0,
  due_amount             DECIMAL(12,2) NOT NULL DEFAULT 0,
  penalty_amount         DECIMAL(12,2) NOT NULL DEFAULT 0,
  grace_period_days      INT           NOT NULL DEFAULT 3,
  late_fee               DECIMAL(12,2) NOT NULL DEFAULT 0,
  monthly_amount         DECIMAL(12,2) NOT NULL,
  installment_count      INT           NOT NULL,
  remaining_installments INT           NOT NULL,
  start_date             DATE          NOT NULL,
  next_due_date          DATE,
  status                 VARCHAR(20)   NOT NULL DEFAULT 'active',
  notes                  TEXT,
  created_by             CHAR(36),
  created_at             DATETIME      NOT NULL DEFAULT NOW(),
  updated_at             DATETIME      NOT NULL DEFAULT NOW() ON UPDATE NOW()
);

CREATE TABLE IF NOT EXISTS installment_schedule (
  id             CHAR(36)      NOT NULL PRIMARY KEY,
  installment_id CHAR(36)      NOT NULL,
  installment_no INT           NOT NULL,
  due_date       DATE          NOT NULL,
  principal      DECIMAL(12,2) NOT NULL DEFAULT 0,
  interest       DECIMAL(12,2) NOT NULL DEFAULT 0,
  penalty        DECIMAL(12,2) NOT NULL DEFAULT 0,
  total_due      DECIMAL(12,2) NOT NULL,
  paid_amount    DECIMAL(12,2) NOT NULL DEFAULT 0,
  status         VARCHAR(20)   NOT NULL DEFAULT 'pending',
  paid_at        DATETIME,
  FOREIGN KEY (installment_id) REFERENCES installments(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS installment_payments (
  id                 CHAR(36)      NOT NULL PRIMARY KEY,
  installment_id     CHAR(36)      NOT NULL,
  receipt_number     VARCHAR(50)   NOT NULL UNIQUE,
  amount             DECIMAL(12,2) NOT NULL,
  payment_method     VARCHAR(30)   NOT NULL DEFAULT 'cash',
  reference_no       VARCHAR(100),
  status             VARCHAR(30)   NOT NULL DEFAULT 'approved',
  verified_by        CHAR(36),
  verified_at        DATETIME,
  verification_notes TEXT,
  collected_by       CHAR(36),
  notes              TEXT,
  created_at         DATETIME      NOT NULL DEFAULT NOW(),
  FOREIGN KEY (installment_id) REFERENCES installments(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sync_queue (
  id         CHAR(36)    NOT NULL PRIMARY KEY,
  table_name VARCHAR(50) NOT NULL,
  operation  VARCHAR(10) NOT NULL,
  record_id  VARCHAR(36) NOT NULL,
  payload    JSON,
  attempts   INT         NOT NULL DEFAULT 0,
  status     VARCHAR(20) NOT NULL DEFAULT 'pending',
  created_at DATETIME    NOT NULL DEFAULT NOW(),
  synced_at  DATETIME
);
`

const DEFAULT_ROLES_SQL = `
INSERT IGNORE INTO roles (id, name, permissions, is_system) VALUES
  (UUID(), 'Company Admin',   '{"all":true}', 1),
  (UUID(), 'Branch Manager',  '{"pos":true,"inventory":true,"reports":true,"customers":true,"employees":true}', 1),
  (UUID(), 'Cashier',         '{"pos":true,"customers":true}', 1),
  (UUID(), 'Warehouse Staff', '{"inventory":true,"transfers":true}', 1),
  (UUID(), 'Delivery Staff',  '{"deliveries":true}', 1);
`

// ─── Create a new company + MySQL database + seed tables ─────────────────────
export async function deleteTenant(companyId: string): Promise<void> {
  const { rows } = await pool.query(
    `SELECT db_schema FROM companies WHERE id = ?`,
    [companyId]
  )
  const row = rows[0] as Record<string, string> | undefined
  if (!row) throw new Error(`Company not found: ${companyId}`)

  const dbSchema = row.db_schema
  await pool.query(`DROP DATABASE IF EXISTS \`${dbSchema}\``)
  await pool.query(`DELETE FROM companies WHERE id = ?`, [companyId])
}

export async function createTenant(params: {
  name: string; email: string; phone?: string; address?: string
  adminEmail: string; adminName: string; adminPhone?: string; adminPassword?: string
  timezone?: string; currency?: string; country?: string
  packageId?: string; trialDays?: number; createdBy?: string; notes?: string
  maxBranches?: number; maxUsers?: number; maxPosDevices?: number; maxStorageGb?: number
}): Promise<{ companyId: string; slug: string; dbSchema: string; apiKey: string }> {
  const slug     = await uniqueSlug(slugify(params.name))
  const dbSchema = `pos_erp_${slug.replace(/-/g, '_').slice(0, 35)}_${Date.now().toString(36)}`
  const companyId = randomUUID()
  const apiKey    = randomUUID()   // unique key the Electron POS uses to sync
  const trialDays = params.trialDays ?? 14

  // Fetch package limits, then apply any manual overrides from params
  let maxBranches = 1, maxUsers = 5, maxPosDevices = 2, maxStorageGb = 5
  if (params.packageId) {
    const { rows: pkgRows } = await pool.query(
      `SELECT max_branches, max_users FROM packages WHERE id = ?`,
      [params.packageId]
    )
    const pkg = pkgRows[0] as Record<string, number> | undefined
    if (pkg) {
      maxBranches   = pkg.max_branches ?? 1
      maxUsers      = pkg.max_users    ?? 5
      maxPosDevices = Math.max(2, Math.floor(maxBranches * 2))
      maxStorageGb  = maxBranches >= 99 ? 500 : maxBranches >= 5 ? 50 : 5
    }
  }
  // Manual overrides take priority over package defaults
  if (params.maxBranches   != null) maxBranches   = params.maxBranches
  if (params.maxUsers      != null) maxUsers      = params.maxUsers
  if (params.maxPosDevices != null) maxPosDevices = params.maxPosDevices
  if (params.maxStorageGb  != null) maxStorageGb  = params.maxStorageGb

  // 1. Insert company row in main DB
  await pool.query(
    `INSERT INTO companies
       (id, slug, name, email, phone, address, timezone, currency, country,
        db_schema, api_key, status, trial_ends_at,
        max_branches, max_users, max_pos_devices, max_storage_gb,
        admin_email, admin_name, admin_phone, notes, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,'trial', DATE_ADD(NOW(), INTERVAL ? DAY),?,?,?,?,?,?,?,?,?)`,
    [
      companyId, slug, params.name, params.email, params.phone ?? null, params.address ?? null,
      params.timezone ?? 'Asia/Colombo', params.currency ?? 'LKR', params.country ?? 'LK',
      dbSchema, apiKey, trialDays,
      maxBranches, maxUsers, maxPosDevices, maxStorageGb,
      params.adminEmail, params.adminName, params.adminPhone ?? null,
      params.notes ?? null, params.createdBy ?? null,
    ]
  )

  // 2. Subscription row
  if (params.packageId) {
    await pool.query(
      `INSERT INTO company_subscriptions (id, company_id, package_id, billing_cycle, status, starts_at, ends_at)
       VALUES (?, ?, ?, 'trial', 'trial', NOW(), DATE_ADD(NOW(), INTERVAL ? DAY))`,
      [randomUUID(), companyId, params.packageId, trialDays]
    )
  }

  // 3. Create isolated MySQL database for this tenant
  await pool.query(`CREATE DATABASE IF NOT EXISTS \`${dbSchema}\``)

  // 4. Bootstrap tables inside tenant database
  const tp = tenantPool(dbSchema)
  const stmts = TENANT_SCHEMA_SQL.split(';').map(s => s.trim()).filter(Boolean)
  for (const stmt of stmts) {
    await tp.query(stmt)
  }
  await tp.query(DEFAULT_ROLES_SQL)

  // 5. Default HQ branch
  const branchId = randomUUID()
  await tp.query(
    `INSERT INTO branches (id, name, code, is_active) VALUES (?, 'Head Office', 'HQ-001', 1)`,
    [branchId]
  )

  // 6. Create default Company Admin user
  const { rows: adminRoleRows } = await tp.query(
    `SELECT id FROM roles WHERE name = 'Company Admin' LIMIT 1`
  )
  const adminRoleId = (adminRoleRows[0] as Record<string, string>)?.id
  if (adminRoleId) {
    const defaultPassword = params.adminPassword || 'Admin@1234'
    const passwordHash = await bcrypt.hash(defaultPassword, 10)
    await tp.query(
      `INSERT INTO users (id, branch_id, role_id, name, email, password_hash, is_active)
       VALUES (?, ?, ?, ?, ?, ?, 1)`,
      [randomUUID(), branchId, adminRoleId, params.adminName, params.adminEmail.toLowerCase(), passwordHash]
    )
  }

  return { companyId, slug, dbSchema, apiKey }
}

// ─── Change company status ────────────────────────────────────────────────────
export async function setCompanyStatus(
  companyId: string, status: 'active' | 'suspended' | 'cancelled' | 'trial'
): Promise<void> {
  await pool.query(`UPDATE companies SET status = ? WHERE id = ?`, [status, companyId])
}

// ─── Paginated company list ───────────────────────────────────────────────────
export async function listCompanies(params: {
  page?: number; limit?: number; search?: string; status?: string
}): Promise<{ rows: unknown[]; total: number }> {
  const page   = Math.max(1, params.page  ?? 1)
  const limit  = Math.min(100, params.limit ?? 20)
  const offset = (page - 1) * limit

  const conditions: string[] = ['1=1']
  const args: unknown[] = []

  if (params.search) {
    conditions.push(`(c.name LIKE ? OR c.email LIKE ? OR c.slug LIKE ?)`)
    const s = `%${params.search}%`
    args.push(s, s, s)
  }
  if (params.status) {
    conditions.push(`c.status = ?`)
    args.push(params.status)
  }

  const where = conditions.join(' AND ')

  const [{ rows: data }, { rows: cnt }] = await Promise.all([
    pool.query(
      `SELECT c.*, s.package_id, p.name as package_name, s.billing_cycle, s.ends_at as sub_ends_at
       FROM companies c
       LEFT JOIN company_subscriptions s ON s.company_id = c.id AND s.status IN ('active','trial')
       LEFT JOIN packages p ON p.id = s.package_id
       WHERE ${where}
       ORDER BY c.created_at DESC
       LIMIT ${limit} OFFSET ${offset}`,
      args
    ),
    pool.query(`SELECT COUNT(*) as total FROM companies c WHERE ${where}`, args),
  ])

  return { rows: data, total: Number((cnt[0] as Record<string, number>).total) }
}
