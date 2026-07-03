import { timingSafeEqual } from 'crypto'
import type { NextRequest } from 'next/server'
import { pool, tenantPool } from './db'

export type CompanyContext = {
  id:       string
  dbSchema: string
  name:     string
  slug:     string
  tp:       ReturnType<typeof tenantPool>
}

declare global { var _posErpTenantCompatibility: Set<string> | undefined }

const migratedTenantSchemas = global._posErpTenantCompatibility ?? new Set<string>()
global._posErpTenantCompatibility = migratedTenantSchemas

async function ensureTenantCompatibility(dbSchema: string) {
  if (migratedTenantSchemas.has(dbSchema)) return

  const tp = tenantPool(dbSchema)
  const statements = [
    `ALTER TABLE categories ADD COLUMN description TEXT NULL`,
    `ALTER TABLE categories ADD COLUMN sort_order INT NOT NULL DEFAULT 0`,
    `ALTER TABLE categories ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT 1`,
    `ALTER TABLE categories ADD COLUMN updated_at DATETIME NOT NULL DEFAULT NOW() ON UPDATE NOW()`,
    `ALTER TABLE invoices ADD COLUMN agent_code TEXT NULL`,
    `ALTER TABLE invoices ADD COLUMN agent_name TEXT NULL`,
    `ALTER TABLE invoices ADD COLUMN agent_commission_pct DECIMAL(6,2) NOT NULL DEFAULT 0`,
    `ALTER TABLE invoices ADD COLUMN agent_commission_amount DECIMAL(14,2) NOT NULL DEFAULT 0`,
    `CREATE TABLE IF NOT EXISTS stocks (
       id           CHAR(36)      NOT NULL PRIMARY KEY,
       product_id   CHAR(36)      NOT NULL,
       branch_id    CHAR(36)      NOT NULL,
       warehouse_id CHAR(36)      NULL,
       quantity     DECIMAL(12,2) NOT NULL DEFAULT 0,
       damaged_qty  DECIMAL(12,2) NOT NULL DEFAULT 0,
       updated_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
       synced_at    DATETIME      NULL,
       UNIQUE KEY uq_stocks_product_branch_wh (product_id, branch_id, warehouse_id),
       INDEX idx_stocks_product (product_id),
       INDEX idx_stocks_branch (branch_id)
     )`,
    `CREATE TABLE IF NOT EXISTS stock_movements (
       id                    CHAR(36)      NOT NULL PRIMARY KEY,
       product_id             CHAR(36)      NOT NULL,
       from_branch_id         CHAR(36)      NULL,
       to_branch_id           CHAR(36)      NULL,
       quantity               DECIMAL(12,2) NOT NULL DEFAULT 0,
       movement_type          VARCHAR(32)   NOT NULL,
       reference_order_id     CHAR(36)      NULL,
       reference_transfer_id  CHAR(36)      NULL,
       notes                  TEXT          NULL,
       created_by             CHAR(36)      NULL,
       created_at             DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
       updated_at             DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
       synced_at              DATETIME      NULL,
       INDEX idx_stock_movements_product (product_id),
       INDEX idx_stock_movements_from_branch (from_branch_id),
       INDEX idx_stock_movements_to_branch (to_branch_id),
       INDEX idx_stock_movements_type (movement_type),
       INDEX idx_stock_movements_updated (updated_at)
     )`,
    `CREATE TABLE IF NOT EXISTS stock_transfers (
       id                   CHAR(36)      NOT NULL PRIMARY KEY,
       transfer_number      VARCHAR(64)   NULL UNIQUE,
       product_id           CHAR(36)      NOT NULL,
       from_branch_id       CHAR(36)      NULL,
       to_branch_id         CHAR(36)      NULL,
       from_warehouse_id    CHAR(36)      NULL,
       to_warehouse_id      CHAR(36)      NULL,
       quantity             DECIMAL(12,2) NOT NULL DEFAULT 0,
       status               VARCHAR(32)   NOT NULL DEFAULT 'pending_approval',
       approved_by          CHAR(36)      NULL,
       released_by          CHAR(36)      NULL,
       driver_name          VARCHAR(255)  NULL,
       driver_phone         VARCHAR(50)   NULL,
       vehicle_number       VARCHAR(64)   NULL,
       dispatch_at          DATETIME      NULL,
       expected_delivery_at DATETIME      NULL,
       actual_delivery_at   DATETIME      NULL,
       received_quantity    DECIMAL(12,2) NOT NULL DEFAULT 0,
       missing_quantity     DECIMAL(12,2) NOT NULL DEFAULT 0,
       damaged_quantity     DECIMAL(12,2) NOT NULL DEFAULT 0,
       notes                TEXT          NULL,
       initiated_by         CHAR(36)      NULL,
       received_by          CHAR(36)      NULL,
       reject_reason        TEXT          NULL,
       rejected_by          CHAR(36)      NULL,
       discrepancy_note     TEXT          NULL,
       discrepancy_by       CHAR(36)      NULL,
       initiated_at         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
       received_at          DATETIME      NULL,
       updated_at           DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
       synced_at            DATETIME      NULL,
       INDEX idx_stock_transfers_from_branch (from_branch_id),
       INDEX idx_stock_transfers_to_branch (to_branch_id),
       INDEX idx_stock_transfers_status (status),
       INDEX idx_stock_transfers_updated (updated_at)
     )`,
    `CREATE TABLE IF NOT EXISTS audit_logs (
       id          CHAR(36)     NOT NULL PRIMARY KEY,
       user_id     CHAR(36)     NULL,
       branch_id   CHAR(36)     NULL,
       action      VARCHAR(100) NOT NULL,
       table_name  VARCHAR(100) NULL,
       record_id   VARCHAR(100) NULL,
       old_values  JSON         NULL,
       new_values  JSON         NULL,
       created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
       updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
       synced_at   DATETIME     NULL,
       INDEX idx_audit_logs_user (user_id),
       INDEX idx_audit_logs_action (action),
       INDEX idx_audit_logs_updated (updated_at)
     )`,
  ]

  const stockTransferColumns = [
    `ALTER TABLE stock_transfers ADD COLUMN product_id CHAR(36) NOT NULL`,
    `ALTER TABLE stock_transfers ADD COLUMN from_branch_id CHAR(36) NULL`,
    `ALTER TABLE stock_transfers ADD COLUMN to_branch_id CHAR(36) NULL`,
    `ALTER TABLE stock_transfers ADD COLUMN quantity DECIMAL(12,2) NOT NULL DEFAULT 0`,
    `ALTER TABLE stock_transfers ADD COLUMN status VARCHAR(32) NOT NULL DEFAULT 'pending_approval'`,
    `ALTER TABLE stock_transfers ADD COLUMN notes TEXT NULL`,
    `ALTER TABLE stock_transfers ADD COLUMN transfer_number VARCHAR(64) NULL UNIQUE`,
    `ALTER TABLE stock_transfers ADD COLUMN from_warehouse_id CHAR(36) NULL`,
    `ALTER TABLE stock_transfers ADD COLUMN to_warehouse_id CHAR(36) NULL`,
    `ALTER TABLE stock_transfers ADD COLUMN approved_by CHAR(36) NULL`,
    `ALTER TABLE stock_transfers ADD COLUMN released_by CHAR(36) NULL`,
    `ALTER TABLE stock_transfers ADD COLUMN driver_name VARCHAR(255) NULL`,
    `ALTER TABLE stock_transfers ADD COLUMN driver_phone VARCHAR(50) NULL`,
    `ALTER TABLE stock_transfers ADD COLUMN vehicle_number VARCHAR(64) NULL`,
    `ALTER TABLE stock_transfers ADD COLUMN dispatch_at DATETIME NULL`,
    `ALTER TABLE stock_transfers ADD COLUMN expected_delivery_at DATETIME NULL`,
    `ALTER TABLE stock_transfers ADD COLUMN actual_delivery_at DATETIME NULL`,
    `ALTER TABLE stock_transfers ADD COLUMN received_quantity DECIMAL(12,2) NOT NULL DEFAULT 0`,
    `ALTER TABLE stock_transfers ADD COLUMN missing_quantity DECIMAL(12,2) NOT NULL DEFAULT 0`,
    `ALTER TABLE stock_transfers ADD COLUMN damaged_quantity DECIMAL(12,2) NOT NULL DEFAULT 0`,
    `ALTER TABLE stock_transfers ADD COLUMN initiated_by CHAR(36) NULL`,
    `ALTER TABLE stock_transfers ADD COLUMN received_by CHAR(36) NULL`,
    `ALTER TABLE stock_transfers ADD COLUMN reject_reason TEXT NULL`,
    `ALTER TABLE stock_transfers ADD COLUMN rejected_by CHAR(36) NULL`,
    `ALTER TABLE stock_transfers ADD COLUMN discrepancy_note TEXT NULL`,
    `ALTER TABLE stock_transfers ADD COLUMN discrepancy_by CHAR(36) NULL`,
    `ALTER TABLE stock_transfers ADD COLUMN initiated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP`,
    `ALTER TABLE stock_transfers ADD COLUMN received_at DATETIME NULL`,
    `ALTER TABLE stock_transfers ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`,
    `ALTER TABLE stock_transfers ADD COLUMN synced_at DATETIME NULL`,
  ]

  for (const sql of [...statements, ...stockTransferColumns]) {
    try {
      await tp.query(sql)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!/Duplicate column name|Duplicate key name|already exists/i.test(message)) throw error
    }
  }

  migratedTenantSchemas.add(dbSchema)
}

// ─── Account status error (thrown when company is suspended or cancelled) ─────
export class AccountStatusError extends Error {
  constructor(
    public readonly code: 'ACCOUNT_SUSPENDED' | 'ACCOUNT_CANCELLED',
    message: string
  ) {
    super(message)
    this.name = 'AccountStatusError'
  }
}

// ─── Resolve company from x-api-key header ────────────────────────────────────
// Used by Electron POS sync. Each company has a unique api_key.
// Throws AccountStatusError for suspended/cancelled companies so callers can
// return a 403 with a meaningful code instead of a generic 401.
export async function resolveCompany(req: NextRequest): Promise<CompanyContext | null> {
  const apiKey = req.headers.get('x-api-key')
  if (!apiKey) return null

  const { rows } = await pool.query(
    `SELECT id, db_schema, name, slug, status FROM companies WHERE api_key = ?`,
    [apiKey]
  )
  if (!rows.length) return null

  const c = rows[0] as Record<string, string>

  if (c.status === 'suspended') {
    throw new AccountStatusError('ACCOUNT_SUSPENDED', 'Account suspended. Contact your administrator.')
  }
  if (c.status === 'cancelled') {
    throw new AccountStatusError('ACCOUNT_CANCELLED', 'Account cancelled. Contact your service provider.')
  }
  if (!['active', 'trial'].includes(c.status)) return null

  await ensureTenantCompatibility(c.db_schema)

  return {
    id:       c.id,
    dbSchema: c.db_schema,
    name:     c.name,
    slug:     c.slug,
    tp:       tenantPool(c.db_schema),
  }
}

// ─── Legacy single-tenant API key check (kept for backward compat) ────────────
export function isAuthorized(request: NextRequest): boolean {
  const expected = process.env.CLOUD_API_KEY
  const received = request.headers.get('x-api-key')
  if (!expected || !received) return false
  const expectedBuffer = Buffer.from(expected)
  const receivedBuffer = Buffer.from(received)
  return expectedBuffer.length === receivedBuffer.length
    && timingSafeEqual(expectedBuffer, receivedBuffer)
}
