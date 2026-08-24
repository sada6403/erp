import { timingSafeEqual } from 'crypto'
import type { NextRequest } from 'next/server'
import { pool, tenantPool } from './db'

export type CompanyContext = {
  id:          string
  dbSchema:    string
  name:        string
  slug:        string
  adminLocked: boolean
  tp:          ReturnType<typeof tenantPool>
}

declare global { var _posErpTenantCompatibility: Set<string> | undefined }

const migratedTenantSchemas = global._posErpTenantCompatibility ?? new Set<string>()
global._posErpTenantCompatibility = migratedTenantSchemas

export async function ensureTenantCompatibility(dbSchema: string) {
  if (migratedTenantSchemas.has(dbSchema)) return

  const tp = tenantPool(dbSchema)
  const statements = [
    `ALTER TABLE categories ADD COLUMN description TEXT NULL`,
    `ALTER TABLE categories ADD COLUMN sort_order INT NOT NULL DEFAULT 0`,
    `ALTER TABLE categories ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT 1`,
    `ALTER TABLE categories ADD COLUMN updated_at DATETIME NOT NULL DEFAULT NOW() ON UPDATE NOW()`,
    `ALTER TABLE roles ADD COLUMN updated_at DATETIME NOT NULL DEFAULT NOW() ON UPDATE NOW()`,
    `ALTER TABLE invoices CHANGE invoice_no invoice_number VARCHAR(64) NOT NULL UNIQUE`,
    `ALTER TABLE invoices CHANGE discount discount_amount DECIMAL(14,2) NOT NULL DEFAULT 0`,
    `ALTER TABLE invoices CHANGE tax tax_amount DECIMAL(14,2) NOT NULL DEFAULT 0`,
    `ALTER TABLE invoices CHANGE total total_amount DECIMAL(14,2) NOT NULL DEFAULT 0`,
    `ALTER TABLE invoices CHANGE paid paid_amount DECIMAL(14,2) NOT NULL DEFAULT 0`,
    `ALTER TABLE invoices CHANGE change_due due_amount DECIMAL(14,2) NOT NULL DEFAULT 0`,
    `ALTER TABLE invoices ADD COLUMN bill_type VARCHAR(32) NULL`,
    `ALTER TABLE invoices ADD COLUMN valid_until DATETIME NULL`,
    `ALTER TABLE invoices ADD COLUMN due_date DATETIME NULL`,
    `ALTER TABLE invoices ADD COLUMN approved_by CHAR(36) NULL`,
    `ALTER TABLE invoices ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`,
    `ALTER TABLE invoices ADD COLUMN synced_at DATETIME NULL`,
    `ALTER TABLE invoices ADD COLUMN agent_code TEXT NULL`,
    `ALTER TABLE invoices ADD COLUMN agent_name TEXT NULL`,
    `ALTER TABLE invoices ADD COLUMN agent_commission_pct DECIMAL(6,2) NOT NULL DEFAULT 0`,
    `ALTER TABLE invoices ADD COLUMN agent_commission_amount DECIMAL(14,2) NOT NULL DEFAULT 0`,
    `ALTER TABLE invoice_items CHANGE qty quantity DECIMAL(12,2) NOT NULL DEFAULT 0`,
    `ALTER TABLE invoice_items CHANGE discount discount_amount DECIMAL(14,2) NOT NULL DEFAULT 0`,
    `ALTER TABLE invoice_items CHANGE tax tax_amount DECIMAL(14,2) NOT NULL DEFAULT 0`,
    `ALTER TABLE invoice_items CHANGE total line_total DECIMAL(14,2) NOT NULL DEFAULT 0`,
    `ALTER TABLE invoice_items ADD COLUMN discount_pct DECIMAL(6,2) NOT NULL DEFAULT 0`,
    `ALTER TABLE invoice_items ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`,
    `ALTER TABLE invoice_items ADD COLUMN synced_at DATETIME NULL`,
    `ALTER TABLE invoice_items DROP COLUMN name`,
    `ALTER TABLE invoice_items DROP COLUMN sku`,
    `ALTER TABLE users MODIFY COLUMN password_hash VARCHAR(255) NOT NULL DEFAULT ''`,
    `ALTER TABLE branches ADD COLUMN email VARCHAR(255) NULL`,
    `ALTER TABLE branches ADD COLUMN branch_pin VARCHAR(255) NULL`,
    `CREATE TABLE IF NOT EXISTS coupons (
       id            CHAR(36)      NOT NULL PRIMARY KEY,
       code          VARCHAR(64)   NOT NULL UNIQUE,
       name          VARCHAR(255)  NOT NULL,
       customer_id   CHAR(36)      NULL,
       branch_id     CHAR(36)      NULL,
       initial_value DECIMAL(14,2) NOT NULL DEFAULT 0,
       balance       DECIMAL(14,2) NOT NULL DEFAULT 0,
       status        VARCHAR(20)   NOT NULL DEFAULT 'active',
       valid_from    DATETIME      NULL,
       valid_until   DATETIME      NULL,
       issued_by     CHAR(36)      NULL,
       notes         TEXT          NULL,
       created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
       updated_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
       synced_at     DATETIME      NULL,
       INDEX idx_coupons_code (code),
       INDEX idx_coupons_customer (customer_id),
       INDEX idx_coupons_branch (branch_id),
       INDEX idx_coupons_status (status),
       INDEX idx_coupons_updated (updated_at)
     )`,
    `CREATE TABLE IF NOT EXISTS coupon_redemptions (
       id            CHAR(36)      NOT NULL PRIMARY KEY,
       coupon_id     CHAR(36)      NOT NULL,
       invoice_id    CHAR(36)      NULL,
       customer_id   CHAR(36)      NULL,
       branch_id     CHAR(36)      NULL,
       amount        DECIMAL(14,2) NOT NULL DEFAULT 0,
       balance_after DECIMAL(14,2) NOT NULL DEFAULT 0,
       type          VARCHAR(20)   NOT NULL DEFAULT 'redeem',
       redeemed_by   CHAR(36)      NULL,
       created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
       updated_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
       synced_at     DATETIME      NULL,
       INDEX idx_coupon_redemptions_coupon (coupon_id),
       INDEX idx_coupon_redemptions_invoice (invoice_id),
       INDEX idx_coupon_redemptions_branch (branch_id),
       INDEX idx_coupon_redemptions_updated (updated_at)
     )`,
    // SmartBuy <-> Coupon linkage — mirrors the local SQLite migration in
    // electron/database.ts (couponSourceColumns / couponAgentColumns). These
    // were previously only ever added to the local per-device database, so a
    // SmartBuy-issued voucher's scheme/member/cycle/Agent traceability never
    // reached the cloud copy of `coupons` on other devices/branches.
    `ALTER TABLE coupons ADD COLUMN source_type VARCHAR(32) NULL`,
    `ALTER TABLE coupons ADD COLUMN source_id VARCHAR(64) NULL`,
    `ALTER TABLE coupons ADD COLUMN smartbuy_scheme_id CHAR(36) NULL`,
    `ALTER TABLE coupons ADD COLUMN smartbuy_member_id CHAR(36) NULL`,
    `ALTER TABLE coupons ADD COLUMN smartbuy_cycle_no INT NULL`,
    `ALTER TABLE coupons ADD COLUMN smartbuy_entitlement_value DECIMAL(14,2) NULL`,
    `ALTER TABLE coupons ADD COLUMN smartbuy_product_value DECIMAL(14,2) NULL`,
    `ALTER TABLE coupons ADD COLUMN agent_id CHAR(36) NULL`,
    `ALTER TABLE coupons ADD COLUMN agent_code VARCHAR(64) NULL`,
    `ALTER TABLE coupons ADD COLUMN agent_name VARCHAR(255) NULL`,
    `ALTER TABLE coupons ADD INDEX idx_coupons_smartbuy_scheme (smartbuy_scheme_id)`,
    `ALTER TABLE coupons ADD INDEX idx_coupons_agent (agent_id)`,
    // Generic deletion tombstone — the pull side (`GET /api/sync/changes`)
    // only ever returns rows still present (`WHERE updated_at > since`), so
    // a hard-deleted row (e.g. a deleted branch) simply vanishes from that
    // result set with no signal that anything was removed. This table is
    // written by applySyncOperation's DELETE branch (lib/sync.ts) and read
    // by GET /api/sync/deletions, so every other device's pullChanges() can
    // apply the same delete locally instead of the deleted row lingering
    // forever on devices that already had it.
    `CREATE TABLE IF NOT EXISTS sync_deletions (
       id         CHAR(36)     NOT NULL PRIMARY KEY,
       table_name VARCHAR(64)  NOT NULL,
       record_id  VARCHAR(128) NOT NULL,
       deleted_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
       INDEX idx_sync_deletions_table_time (table_name, deleted_at),
       INDEX idx_sync_deletions_record (table_name, record_id)
     )`,
    `CREATE TABLE IF NOT EXISTS discounts (
       id                  CHAR(36)      NOT NULL PRIMARY KEY,
       name                VARCHAR(255)  NOT NULL,
       type                VARCHAR(20)   NOT NULL,
       value               DECIMAL(14,2) NOT NULL DEFAULT 0,
       max_discount_amount DECIMAL(14,2) NULL,
       scope               VARCHAR(20)   NOT NULL DEFAULT 'all',
       product_id          CHAR(36)      NULL,
       branch_id           CHAR(36)      NULL,
       is_active           BOOLEAN       NOT NULL DEFAULT 1,
       valid_from          DATETIME      NULL,
       valid_until         DATETIME      NULL,
       created_by          CHAR(36)      NULL,
       created_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
       updated_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
       synced_at           DATETIME      NULL,
       INDEX idx_discounts_product (product_id),
       INDEX idx_discounts_branch (branch_id),
       INDEX idx_discounts_updated (updated_at)
     )`,
    `CREATE TABLE IF NOT EXISTS suppliers (
       id         CHAR(36)     NOT NULL PRIMARY KEY,
       name       VARCHAR(255) NOT NULL,
       contact    VARCHAR(255) NULL,
       phone      VARCHAR(50)  NULL,
       email      VARCHAR(255) NULL,
       address    TEXT         NULL,
       tax_number VARCHAR(100) NULL,
       is_active  BOOLEAN      NOT NULL DEFAULT 1,
       created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
       updated_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
       synced_at  DATETIME     NULL,
       INDEX idx_suppliers_updated (updated_at)
     )`,
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
    `CREATE TABLE IF NOT EXISTS purchase_orders (
       id             CHAR(36)      NOT NULL PRIMARY KEY,
       po_number      VARCHAR(100)  NOT NULL UNIQUE,
       branch_id      CHAR(36)      NULL,
       supplier_id    CHAR(36)      NULL,
       status         VARCHAR(32)   NOT NULL DEFAULT 'DRAFT',
       subtotal       DECIMAL(14,2) NOT NULL DEFAULT 0,
       tax_amount     DECIMAL(14,2) NOT NULL DEFAULT 0,
       total          DECIMAL(14,2) NOT NULL DEFAULT 0,
       total_amount   DECIMAL(14,2) NOT NULL DEFAULT 0,
       expected_date  DATETIME      NULL,
       received_date  DATETIME      NULL,
       received_at    DATETIME      NULL,
       sent_at        DATETIME      NULL,
       cancelled_at   DATETIME      NULL,
       notes          TEXT          NULL,
       created_by     CHAR(36)      NULL,
       approved_by    CHAR(36)      NULL,
       created_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
       updated_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
       synced_at      DATETIME      NULL,
       INDEX idx_purchase_orders_branch (branch_id),
       INDEX idx_purchase_orders_supplier (supplier_id),
       INDEX idx_purchase_orders_status (status),
       INDEX idx_purchase_orders_updated (updated_at)
     )`,
    `CREATE TABLE IF NOT EXISTS purchase_items (
       id           CHAR(36)      NOT NULL PRIMARY KEY,
       po_id        CHAR(36)      NULL,
       product_id   CHAR(36)      NULL,
       ordered_qty  DECIMAL(12,2) NOT NULL DEFAULT 0,
       received_qty DECIMAL(12,2) NOT NULL DEFAULT 0,
       quantity     DECIMAL(12,2) NOT NULL DEFAULT 0,
       unit_cost    DECIMAL(14,2) NOT NULL DEFAULT 0,
       line_total   DECIMAL(14,2) NOT NULL DEFAULT 0,
       notes        TEXT          NULL,
       created_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
       updated_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
       synced_at    DATETIME      NULL,
       INDEX idx_purchase_items_po (po_id),
       INDEX idx_purchase_items_product (product_id),
       INDEX idx_purchase_items_updated (updated_at)
     )`,
    `CREATE TABLE IF NOT EXISTS branch_transfers (
       id                   CHAR(36)      NOT NULL PRIMARY KEY,
       transfer_number      VARCHAR(64)   NOT NULL UNIQUE,
       from_branch_id       CHAR(36)      NOT NULL,
       to_branch_id         CHAR(36)      NOT NULL,
       status               VARCHAR(32)   NOT NULL DEFAULT 'draft',
       driver_name          VARCHAR(255)  NULL,
       vehicle_number       VARCHAR(64)   NULL,
       driver_phone         VARCHAR(50)   NULL,
       issuing_officer_name VARCHAR(255)  NULL,
       dispatch_at          DATETIME      NULL,
       expected_delivery_at DATETIME      NULL,
       actual_delivery_at   DATETIME      NULL,
       notes                TEXT          NULL,
       created_by           CHAR(36)      NULL,
       approved_by          CHAR(36)      NULL,
       received_by          CHAR(36)      NULL,
       received_by_name     VARCHAR(255)  NULL,
       received_designation VARCHAR(255)  NULL,
       created_at           DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
       updated_at           DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
       synced_at            DATETIME      NULL,
       INDEX idx_bt_from (from_branch_id),
       INDEX idx_bt_to (to_branch_id),
       INDEX idx_bt_status (status),
       INDEX idx_bt_updated (updated_at)
     )`,
    `CREATE TABLE IF NOT EXISTS branch_transfer_items (
       id               CHAR(36)      NOT NULL PRIMARY KEY,
       transfer_id      CHAR(36)      NOT NULL,
       product_id       CHAR(36)      NOT NULL,
       quantity         DECIMAL(12,2) NOT NULL DEFAULT 0,
       unit             VARCHAR(32)   NULL,
       package_count    DECIMAL(12,2) NOT NULL DEFAULT 0,
       serial_batch_no  VARCHAR(255)  NULL,
       description      TEXT          NULL,
       received_qty     DECIMAL(12,2) NOT NULL DEFAULT 0,
       damaged_qty      DECIMAL(12,2) NOT NULL DEFAULT 0,
       missing_qty      DECIMAL(12,2) NOT NULL DEFAULT 0,
       created_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
       updated_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
       synced_at        DATETIME      NULL,
       INDEX idx_bti_transfer (transfer_id),
       INDEX idx_bti_product (product_id),
       INDEX idx_bti_updated (updated_at)
     )`,
    `CREATE TABLE IF NOT EXISTS branch_transfer_mismatches (
       id               CHAR(36)      NOT NULL PRIMARY KEY,
       transfer_id      CHAR(36)      NOT NULL,
       item_id          CHAR(36)      NOT NULL,
       missing_qty      DECIMAL(12,2) NOT NULL DEFAULT 0,
       damaged_qty      DECIMAL(12,2) NOT NULL DEFAULT 0,
       reason_category  VARCHAR(64)   NOT NULL,
       detailed_reason  TEXT          NULL,
       status           VARCHAR(32)   NOT NULL DEFAULT 'under_admin_review',
       reported_by      CHAR(36)      NULL,
       resolved_by      CHAR(36)      NULL,
       admin_reason     TEXT          NULL,
       created_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
       updated_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
       synced_at        DATETIME      NULL,
       INDEX idx_btm_transfer (transfer_id),
       INDEX idx_btm_updated (updated_at)
     )`,
    `CREATE TABLE IF NOT EXISTS branch_transfer_logs (
       id               CHAR(36)      NOT NULL PRIMARY KEY,
       transfer_id      CHAR(36)      NOT NULL,
       user_id          CHAR(36)      NULL,
       action           VARCHAR(100)  NOT NULL,
       old_values       JSON          NULL,
       new_values       JSON          NULL,
       notes            TEXT          NULL,
       created_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
       synced_at        DATETIME      NULL,
       INDEX idx_btl_transfer (transfer_id)
     )`,
    `CREATE TABLE IF NOT EXISTS branch_transfer_prints (
       id               CHAR(36)      NOT NULL PRIMARY KEY,
       transfer_id      CHAR(36)      NOT NULL,
       printed_by       CHAR(36)      NULL,
       print_type       VARCHAR(32)   NOT NULL DEFAULT 'print',
       created_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
       updated_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
       synced_at        DATETIME      NULL,
       INDEX idx_btp_transfer (transfer_id)
     )`,
    `CREATE TABLE IF NOT EXISTS deliveries (
       id            CHAR(36)     NOT NULL PRIMARY KEY,
       invoice_id    CHAR(36)     NOT NULL,
       customer_id   CHAR(36)     NOT NULL,
       branch_id     CHAR(36)     NOT NULL,
       address       TEXT         NOT NULL,
       assigned_to   CHAR(36)     NULL,
       status        VARCHAR(32)  NOT NULL DEFAULT 'pending',
       scheduled_at  DATETIME     NULL,
       dispatched_at DATETIME     NULL,
       delivered_at  DATETIME     NULL,
       notes         TEXT         NULL,
       created_at    DATETIME     NOT NULL DEFAULT NOW(),
       updated_at    DATETIME     NOT NULL DEFAULT NOW() ON UPDATE NOW(),
       synced_at     DATETIME     NULL,
       INDEX idx_deliveries_branch (branch_id, status),
       INDEX idx_deliveries_invoice (invoice_id),
       INDEX idx_deliveries_updated (updated_at)
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
    `ALTER TABLE branch_transfers ADD COLUMN approved_by CHAR(36) NULL`,
    `ALTER TABLE branch_transfer_prints ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`,

    // ── customer_orders / customer_order_items — were whitelisted and pushed
    // from every device, but the cloud table never existed, so every real
    // customer order silently failed forever. ─────────────────────────────
    `CREATE TABLE IF NOT EXISTS customer_orders (
       id                    CHAR(36)      NOT NULL PRIMARY KEY,
       order_number          VARCHAR(64)   NOT NULL UNIQUE,
       branch_id             CHAR(36)      NOT NULL,
       customer_id           CHAR(36)      NULL,
       customer_name         VARCHAR(255)  NOT NULL,
       customer_phone        VARCHAR(50)   NULL,
       customer_address      TEXT          NULL,
       sales_staff_id        CHAR(36)      NULL,
       approved_by           CHAR(36)      NULL,
       released_by           CHAR(36)      NULL,
       driver_name           VARCHAR(255)  NULL,
       driver_phone          VARCHAR(50)   NULL,
       vehicle_number        VARCHAR(64)   NULL,
       status                VARCHAR(32)   NOT NULL DEFAULT 'pending',
       payment_status        VARCHAR(32)   NOT NULL DEFAULT 'unpaid',
       total_amount          DECIMAL(14,2) NOT NULL DEFAULT 0,
       paid_amount           DECIMAL(14,2) NOT NULL DEFAULT 0,
       delivery_date         DATETIME      NULL,
       dispatch_at           DATETIME      NULL,
       delivered_at          DATETIME      NULL,
       delivery_confirmed_by CHAR(36)      NULL,
       notes                 TEXT          NULL,
       created_at            DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
       updated_at            DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
       synced_at             DATETIME      NULL,
       INDEX idx_customer_orders_branch (branch_id),
       INDEX idx_customer_orders_status (status),
       INDEX idx_customer_orders_updated (updated_at)
     )`,
    `CREATE TABLE IF NOT EXISTS customer_order_items (
       id          CHAR(36)      NOT NULL PRIMARY KEY,
       order_id    CHAR(36)      NOT NULL,
       product_id  CHAR(36)      NOT NULL,
       quantity    DECIMAL(12,2) NOT NULL DEFAULT 0,
       unit_price  DECIMAL(14,2) NOT NULL DEFAULT 0,
       line_total  DECIMAL(14,2) NOT NULL DEFAULT 0,
       updated_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
       synced_at   DATETIME      NULL,
       FOREIGN KEY (order_id) REFERENCES customer_orders(id) ON DELETE CASCADE,
       INDEX idx_coi_order (order_id)
     )`,

    // ── payments — invoice_items/payments/credit_ledger were never pushed
    // from any device (no enqueue call existed), and the cloud `payments`
    // table didn't exist either. This creates the table; the push wiring
    // is a separate electron-side fix. ─────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS payments (
       id           CHAR(36)      NOT NULL PRIMARY KEY,
       invoice_id   CHAR(36)      NOT NULL,
       method       VARCHAR(32)   NOT NULL,
       amount       DECIMAL(14,2) NOT NULL DEFAULT 0,
       reference    VARCHAR(255)  NULL,
       received_by  CHAR(36)      NULL,
       paid_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
       updated_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
       synced_at    DATETIME      NULL,
       FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
       INDEX idx_payments_invoice (invoice_id)
     )`,
    `CREATE TABLE IF NOT EXISTS credit_ledger (
       id           CHAR(36)      NOT NULL PRIMARY KEY,
       customer_id  CHAR(36)      NOT NULL,
       invoice_id   CHAR(36)      NOT NULL,
       branch_id    CHAR(36)      NOT NULL,
       amount_due   DECIMAL(14,2) NOT NULL DEFAULT 0,
       amount_paid  DECIMAL(14,2) NOT NULL DEFAULT 0,
       due_date     DATETIME      NULL,
       status       VARCHAR(32)   NOT NULL DEFAULT 'outstanding',
       created_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
       updated_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
       synced_at    DATETIME      NULL,
       INDEX idx_credit_ledger_customer (customer_id),
       INDEX idx_credit_ledger_invoice (invoice_id)
     )`,

    // ── Phase 2 Group A — agents, expenses, installment_reminders ──────────
    `CREATE TABLE IF NOT EXISTS agents (
       id                     CHAR(36)      NOT NULL PRIMARY KEY,
       code                   VARCHAR(64)   NOT NULL,
       name                   VARCHAR(255)  NOT NULL,
       phone                  VARCHAR(50)   NULL,
       email                  VARCHAR(255)  NULL,
       nic                    VARCHAR(50)   NULL,
       branch_id              CHAR(36)      NULL,
       default_commission_pct DECIMAL(6,2)  NOT NULL DEFAULT 0,
       monthly_target         DECIMAL(14,2) NOT NULL DEFAULT 0,
       status                 VARCHAR(32)   NOT NULL DEFAULT 'active',
       notes                  TEXT          NULL,
       created_by             CHAR(36)      NULL,
       created_at             DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
       updated_at             DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
       synced_at              DATETIME      NULL,
       UNIQUE KEY uq_agents_code (code),
       INDEX idx_agents_branch (branch_id)
     )`,
    // Already-provisioned tenants pre-date user_id — links an agent to a
    // real login so an agent can sign in and see only their own data.
    `ALTER TABLE agents ADD COLUMN user_id CHAR(36) NULL`,
    `ALTER TABLE agents ADD UNIQUE INDEX idx_agents_user (user_id)`,
    // Already-provisioned tenants pre-date session_scope — stable
    // restricted-portal identifier for roles (Smart Buy Manager, Agent).
    `ALTER TABLE roles ADD COLUMN session_scope VARCHAR(20) NULL`,
    `UPDATE roles SET session_scope='smartBuy' WHERE LOWER(TRIM(name))='smart buy manager' AND session_scope IS NULL`,
    // Already-provisioned tenants pre-date smartbuy_manager_id — soft
    // "this user is THE SmartBuy Manager of this branch" pointer, display/
    // report metadata only (does not drive session scoping).
    `ALTER TABLE branches ADD COLUMN smartbuy_manager_id CHAR(36) NULL`,
    // Agent Management as staff master — Zone is the broader grouping
    // (e.g. "Jaffna"), Region the narrower one within it (e.g.
    // "Vaddukoddai"), mirrors the local SQLite migration in
    // electron/database.ts. No FOREIGN KEY constraints, matching this
    // file's existing style (app-level relationships only).
    `CREATE TABLE IF NOT EXISTS zones (
       id         CHAR(36)     NOT NULL PRIMARY KEY,
       name       VARCHAR(255) NOT NULL,
       code       VARCHAR(64)  NULL,
       is_active  BOOLEAN      NOT NULL DEFAULT 1,
       created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
       updated_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
       synced_at  DATETIME     NULL
     )`,
    `CREATE TABLE IF NOT EXISTS regions (
       id         CHAR(36)     NOT NULL PRIMARY KEY,
       name       VARCHAR(255) NOT NULL,
       code       VARCHAR(64)  NULL,
       zone_id    CHAR(36)     NULL,
       is_active  BOOLEAN      NOT NULL DEFAULT 1,
       created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
       updated_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
       synced_at  DATETIME     NULL,
       INDEX idx_regions_zone (zone_id)
     )`,
    // Staff-detail columns — Personal Information / Role & Location sections
    // of the Staff Details UI. `code`/`nic`/`notes`/`branch_id`/`status`/
    // `phone`/`email` already existed above.
    `ALTER TABLE agents ADD COLUMN etf_number VARCHAR(64) NULL`,
    `ALTER TABLE agents ADD COLUMN epf_number VARCHAR(64) NULL`,
    `ALTER TABLE agents ADD COLUMN date_of_birth DATE NULL`,
    `ALTER TABLE agents ADD COLUMN position VARCHAR(255) NULL`,
    `ALTER TABLE agents ADD COLUMN region_id CHAR(36) NULL`,
    `ALTER TABLE agents ADD COLUMN appointment_date DATE NULL`,
    `ALTER TABLE agents ADD COLUMN missing_documents TEXT NULL`,
    `ALTER TABLE agents ADD INDEX idx_agents_region (region_id)`,
    // NIC uniqueness — MySQL unique indexes already treat multiple NULLs as
    // distinct (no collision for agents with no NIC on file, mirroring the
    // partial-index behavior on the SQLite side).
    `ALTER TABLE agents ADD UNIQUE INDEX idx_agents_nic (nic)`,
    `CREATE TABLE IF NOT EXISTS expense_categories (
       id          CHAR(36)     NOT NULL PRIMARY KEY,
       name        VARCHAR(255) NOT NULL UNIQUE,
       is_active   BOOLEAN      NOT NULL DEFAULT 1,
       created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
       updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
     )`,
    `CREATE TABLE IF NOT EXISTS expenses (
       id              CHAR(36)      NOT NULL PRIMARY KEY,
       branch_id       CHAR(36)      NULL,
       category_id     CHAR(36)      NULL,
       supplier_id     CHAR(36)      NULL,
       amount          DECIMAL(14,2) NOT NULL DEFAULT 0,
       paid_amount     DECIMAL(14,2) NOT NULL DEFAULT 0,
       payment_status  VARCHAR(32)   NOT NULL DEFAULT 'unpaid',
       payment_method  VARCHAR(32)   NULL,
       payment_date    DATETIME      NULL,
       payment_due     DATETIME      NULL,
       paid_by         CHAR(36)      NULL,
       description     TEXT          NULL,
       notes           TEXT          NULL,
       created_by      CHAR(36)      NULL,
       created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
       updated_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
       synced_at       DATETIME      NULL,
       INDEX idx_expenses_branch (branch_id),
       INDEX idx_expenses_category (category_id),
       INDEX idx_expenses_date (created_at)
     )`,
    `CREATE TABLE IF NOT EXISTS installment_reminders (
       id             CHAR(36)     NOT NULL PRIMARY KEY,
       installment_id CHAR(36)     NOT NULL,
       schedule_id    CHAR(36)     NULL,
       channel        VARCHAR(32)  NOT NULL,
       reminder_type  VARCHAR(32)  NOT NULL,
       status         VARCHAR(32)  NOT NULL DEFAULT 'pending',
       message        TEXT         NULL,
       scheduled_at   DATETIME     NOT NULL,
       sent_at        DATETIME     NULL,
       error          TEXT         NULL,
       created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
       synced_at      DATETIME     NULL,
       FOREIGN KEY (installment_id) REFERENCES installments(id) ON DELETE CASCADE,
       INDEX idx_installment_reminders_status (status, scheduled_at)
     )`,

    // ── Phase 2 Group B — return_items, cash_sessions, loyalty, batches, uom
    `CREATE TABLE IF NOT EXISTS returns (
       id            CHAR(36)      NOT NULL PRIMARY KEY,
       invoice_id    CHAR(36)      NULL,
       customer_id   CHAR(36)      NULL,
       return_date   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
       reason        TEXT          NULL,
       total_refund  DECIMAL(14,2) NOT NULL DEFAULT 0,
       refund_method VARCHAR(32)   NOT NULL DEFAULT 'cash',
       notes         TEXT          NULL,
       created_by    CHAR(36)      NULL,
       status        VARCHAR(32)   NOT NULL DEFAULT 'completed',
       created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
       updated_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
       synced_at     DATETIME      NULL,
       INDEX idx_returns_invoice (invoice_id),
       INDEX idx_returns_date (return_date)
     )`,
    `CREATE TABLE IF NOT EXISTS return_items (
       id              CHAR(36)      NOT NULL PRIMARY KEY,
       return_id       CHAR(36)      NOT NULL,
       product_id      CHAR(36)      NULL,
       invoice_item_id CHAR(36)      NULL,
       quantity        DECIMAL(12,2) NOT NULL DEFAULT 1,
       unit_price      DECIMAL(14,2) NOT NULL DEFAULT 0,
       created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
       synced_at       DATETIME      NULL,
       FOREIGN KEY (return_id) REFERENCES returns(id) ON DELETE CASCADE,
       INDEX idx_return_items_return (return_id)
     )`,
    `CREATE TABLE IF NOT EXISTS cash_sessions (
       id                    CHAR(36)      NOT NULL PRIMARY KEY,
       branch_id             CHAR(36)      NULL,
       opened_by             CHAR(36)      NULL,
       opened_at             DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
       opening_cash          DECIMAL(14,2) NOT NULL DEFAULT 0,
       denominations         JSON          NULL,
       notes                 TEXT          NULL,
       closed_by             CHAR(36)      NULL,
       closed_at             DATETIME      NULL,
       closing_cash          DECIMAL(14,2) NULL DEFAULT 0,
       closing_denominations JSON          NULL,
       closing_notes         TEXT          NULL,
       sales_total           DECIMAL(14,2) NULL DEFAULT 0,
       sales_count           INT           NULL DEFAULT 0,
       difference            DECIMAL(14,2) NULL DEFAULT 0,
       status                VARCHAR(32)   NOT NULL DEFAULT 'open',
       created_at            DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
       synced_at             DATETIME      NULL,
       INDEX idx_cash_sessions_branch (branch_id)
     )`,
    `CREATE TABLE IF NOT EXISTS loyalty_config (
       id              CHAR(36)      NOT NULL PRIMARY KEY,
       enabled         BOOLEAN       NOT NULL DEFAULT 0,
       earn_points     INT           NOT NULL DEFAULT 1,
       earn_per_amount DECIMAL(14,2) NOT NULL DEFAULT 100,
       redeem_points   INT           NOT NULL DEFAULT 100,
       redeem_value    DECIMAL(14,2) NOT NULL DEFAULT 10,
       min_redeem      INT           NOT NULL DEFAULT 100,
       expiry_days     INT           NOT NULL DEFAULT 0,
       updated_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
       synced_at       DATETIME      NULL
     )`,
    `CREATE TABLE IF NOT EXISTS loyalty_transactions (
       id          CHAR(36)     NOT NULL PRIMARY KEY,
       customer_id CHAR(36)     NOT NULL,
       invoice_id  CHAR(36)     NULL,
       type        VARCHAR(20)  NOT NULL,
       points      INT          NOT NULL,
       balance     INT          NOT NULL DEFAULT 0,
       note        TEXT         NULL,
       created_by  CHAR(36)     NULL,
       created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
       synced_at   DATETIME     NULL,
       INDEX idx_loyalty_customer (customer_id),
       INDEX idx_loyalty_type (type)
     )`,
    `CREATE TABLE IF NOT EXISTS product_uom (
       id                CHAR(36)      NOT NULL PRIMARY KEY,
       product_id        CHAR(36)      NOT NULL,
       uom_name          VARCHAR(64)   NOT NULL,
       conversion_factor DECIMAL(12,4) NOT NULL DEFAULT 1,
       is_base           BOOLEAN       NOT NULL DEFAULT 0,
       wastage           DECIMAL(6,2)  NOT NULL DEFAULT 0,
       sort_order        INT           NOT NULL DEFAULT 0,
       created_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
       updated_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
       synced_at         DATETIME      NULL,
       FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
       INDEX idx_product_uom_product (product_id)
     )`,
    `CREATE TABLE IF NOT EXISTS product_batches (
       id            CHAR(36)      NOT NULL PRIMARY KEY,
       product_id    CHAR(36)      NOT NULL,
       branch_id     CHAR(36)      NULL,
       batch_number  VARCHAR(128)  NULL,
       serial_number VARCHAR(128)  NULL,
       expiry_date   DATE          NULL,
       mfg_date      DATE          NULL,
       quantity      DECIMAL(12,2) NOT NULL DEFAULT 0,
       cost_price    DECIMAL(14,2) NOT NULL DEFAULT 0,
       po_id         CHAR(36)      NULL,
       notes         TEXT          NULL,
       created_by    CHAR(36)      NULL,
       created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
       updated_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
       synced_at     DATETIME      NULL,
       INDEX idx_batches_product (product_id),
       INDEX idx_batches_branch (branch_id),
       INDEX idx_batches_expiry (expiry_date)
     )`,

    // ── Chit Fund — schemes, members, draws, contributions ────────────────
    `CREATE TABLE IF NOT EXISTS chit_schemes (
       id                      CHAR(36)      NOT NULL PRIMARY KEY,
       scheme_number           VARCHAR(64)   NULL UNIQUE,
       name                    VARCHAR(255)  NOT NULL,
       branch_id               CHAR(36)      NULL,
       product_id              CHAR(36)      NULL,
       agent_id                CHAR(36)      NULL,
       member_count            INT           NOT NULL,
       cycle_count             INT           NOT NULL,
       frequency               VARCHAR(20)   NOT NULL DEFAULT 'monthly',
       contribution_amount     DECIMAL(14,2) NOT NULL DEFAULT 0,
       chit_value              DECIMAL(14,2) NOT NULL DEFAULT 0,
       early_redemption_count  INT           NOT NULL DEFAULT 0,
       early_redemption_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
       repayment_months        INT           NOT NULL DEFAULT 12,
       agent_commission_pct    DECIMAL(6,2)  NOT NULL DEFAULT 0,
       start_date              DATETIME      NOT NULL,
       next_draw_date          DATETIME      NULL,
       status                  VARCHAR(32)   NOT NULL DEFAULT 'active',
       notes                   TEXT          NULL,
       created_by              CHAR(36)      NULL,
       created_at              DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
       updated_at              DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
       synced_at               DATETIME      NULL,
       INDEX idx_chit_schemes_branch (branch_id),
       INDEX idx_chit_schemes_agent (agent_id),
       INDEX idx_chit_schemes_status (status)
     )`,
    // Already-provisioned tenants pre-date min_members — add it explicitly.
    `ALTER TABLE chit_schemes ADD COLUMN min_members INT NOT NULL DEFAULT 1`,
    `ALTER TABLE chit_schemes ADD COLUMN registration_start_date DATETIME NULL`,
    `ALTER TABLE chit_schemes ADD COLUMN registration_end_date DATETIME NULL`,
    `ALTER TABLE chit_schemes ADD COLUMN late_payment_days INT NOT NULL DEFAULT 0`,
    `ALTER TABLE chit_schemes ADD COLUMN late_fee_amount DECIMAL(14,2) NOT NULL DEFAULT 0`,
    `CREATE TABLE IF NOT EXISTS chit_members (
       id                    CHAR(36)      NOT NULL PRIMARY KEY,
       scheme_id             CHAR(36)      NOT NULL,
       customer_id           CHAR(36)      NOT NULL,
       agent_id              CHAR(36)      NULL,
       join_order            INT           NOT NULL,
       is_early_redemption   BOOLEAN       NOT NULL DEFAULT 0,
       redemption_type       VARCHAR(20)   NULL,
       won_cycle_no          INT           NULL,
       product_received_at   DATETIME      NULL,
       contributions_paid    DECIMAL(14,2) NOT NULL DEFAULT 0,
       installment_id        CHAR(36)      NULL,
       status                VARCHAR(32)   NOT NULL DEFAULT 'active',
       eligibility_note      TEXT          NULL,
       created_at            DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
       updated_at            DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
       synced_at             DATETIME      NULL,
       UNIQUE KEY uq_chit_members_scheme_customer (scheme_id, customer_id),
       UNIQUE KEY uq_chit_members_scheme_order (scheme_id, join_order),
       FOREIGN KEY (scheme_id) REFERENCES chit_schemes(id) ON DELETE CASCADE,
       INDEX idx_chit_members_customer (customer_id),
       INDEX idx_chit_members_status (status),
       INDEX idx_chit_members_agent (agent_id)
     )`,
    // Already-provisioned tenants pre-date the agent_id column above — the
    // CREATE TABLE IF NOT EXISTS is a no-op for them, so add it explicitly.
    `ALTER TABLE chit_members ADD COLUMN agent_id CHAR(36) NULL`,
    `ALTER TABLE chit_members ADD INDEX idx_chit_members_agent (agent_id)`,
    // Paper-record traceability + redemption product capture (Smart Buy).
    `ALTER TABLE chit_members ADD COLUMN paper_reference_code VARCHAR(64) NULL`,
    `ALTER TABLE chit_members ADD COLUMN redeemed_product_id CHAR(36) NULL`,
    `ALTER TABLE chit_members ADD COLUMN redeemed_product_name VARCHAR(255) NULL`,
    `ALTER TABLE chit_members ADD COLUMN redeemed_qty INT NOT NULL DEFAULT 1`,
    `ALTER TABLE chit_members ADD COLUMN redeemed_value DECIMAL(14,2) NULL`,
    `ALTER TABLE chit_members ADD COLUMN redemption_invoice_id CHAR(36) NULL`,
    `CREATE TABLE IF NOT EXISTS chit_draws (
       id               CHAR(36)     NOT NULL PRIMARY KEY,
       scheme_id        CHAR(36)     NOT NULL,
       cycle_no         INT          NOT NULL,
       draw_date        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
       winner_member_id CHAR(36)     NULL,
       settled_count    INT          NOT NULL DEFAULT 1,
       eligible_count   INT          NOT NULL DEFAULT 0,
       method           VARCHAR(20)  NOT NULL DEFAULT 'random',
       conducted_by     CHAR(36)     NULL,
       notes            TEXT         NULL,
       created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
       updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
       synced_at        DATETIME     NULL,
       UNIQUE KEY uq_chit_draws_scheme_cycle (scheme_id, cycle_no),
       FOREIGN KEY (scheme_id) REFERENCES chit_schemes(id) ON DELETE CASCADE,
       INDEX idx_chit_draws_scheme (scheme_id)
     )`,
    `CREATE TABLE IF NOT EXISTS chit_contributions (
       id                CHAR(36)      NOT NULL PRIMARY KEY,
       scheme_id         CHAR(36)      NOT NULL,
       member_id         CHAR(36)      NOT NULL,
       cycle_no          INT           NULL,
       contribution_type VARCHAR(20)   NOT NULL DEFAULT 'cycle',
       amount            DECIMAL(14,2) NOT NULL,
       method            VARCHAR(32)   NOT NULL DEFAULT 'cash',
       receipt_number    VARCHAR(64)   NULL,
       reference         VARCHAR(128)  NULL,
       status            VARCHAR(32)   NOT NULL DEFAULT 'approved',
       received_by       CHAR(36)      NULL,
       verified_by       CHAR(36)      NULL,
       verified_at       DATETIME      NULL,
       rejected_reason   TEXT          NULL,
       branch_id         CHAR(36)      NULL,
       commission_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
       notes             TEXT          NULL,
       paid_at           DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
       updated_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
       synced_at         DATETIME      NULL,
       FOREIGN KEY (scheme_id) REFERENCES chit_schemes(id) ON DELETE CASCADE,
       FOREIGN KEY (member_id) REFERENCES chit_members(id) ON DELETE CASCADE,
       INDEX idx_chit_contributions_scheme (scheme_id),
       INDEX idx_chit_contributions_member (member_id),
       INDEX idx_chit_contributions_status (status)
     )`,
    // Who physically collected the cash — distinct from received_by (office user).
    `ALTER TABLE chit_contributions ADD COLUMN collected_by_agent_id CHAR(36) NULL`,
    // Flexible (partial/excess/installment) contribution handling
    // supersedes the earlier "exactly one approved contribution per
    // (member, scheme, cycle)" rule — see the matching SQLite migration
    // for the full rationale. Drop that rule's generated-column unique
    // index (a fresh tenant that never had it will just no-op-error here,
    // swallowed by the catch below same as any other already-applied
    // migration) and add the running credit-balance columns instead.
    `ALTER TABLE chit_contributions DROP INDEX idx_chit_contributions_one_approved_per_cycle`,
    `ALTER TABLE chit_contributions DROP COLUMN approved_cycle_marker`,
    `ALTER TABLE chit_members ADD COLUMN credit_balance DECIMAL(14,2) NOT NULL DEFAULT 0`,
    `ALTER TABLE chit_contributions ADD COLUMN credit_applied DECIMAL(14,2) NOT NULL DEFAULT 0`,

    // ── Centralized Scheme Master — see the matching SQLite migration for
    // full rationale. A reusable, Super-Admin-only catalog of named SmartBuy
    // "products" (e.g. "SmartBuy 500"); chit_schemes stays the live,
    // branch-scoped running batch and now records which template it came from.
    `CREATE TABLE IF NOT EXISTS chit_scheme_templates (
       id                           CHAR(36)      NOT NULL PRIMARY KEY,
       scheme_name                  VARCHAR(255)  NOT NULL,
       monthly_contribution_amount  DECIMAL(14,2) NOT NULL,
       duration_months              INT           NOT NULL,
       minimum_members              INT           NOT NULL,
       product_value                DECIMAL(14,2) NOT NULL,
       status                       VARCHAR(32)   NOT NULL DEFAULT 'active',
       created_by                   CHAR(36)      NULL,
       created_at                   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
       updated_at                   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
       synced_at                    DATETIME      NULL,
       INDEX idx_chit_scheme_templates_status (status)
     )`,
    `ALTER TABLE chit_schemes ADD COLUMN template_id CHAR(36) NULL`,

    // ── Member Withdrawal / Exit Management — see the matching SQLite
    // migration for full rationale (one row per withdrawal, whichever path
    // — auto-approved pre-activation or Super-Admin-reviewed post-activation).
    `CREATE TABLE IF NOT EXISTS withdrawal_requests (
       id                CHAR(36)      NOT NULL PRIMARY KEY,
       member_id         CHAR(36)      NOT NULL,
       scheme_id         CHAR(36)      NOT NULL,
       branch_id         CHAR(36)      NULL,
       requested_by      CHAR(36)      NULL,
       requested_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
       reason            TEXT          NOT NULL,
       scheme_was_active TINYINT(1)    NOT NULL DEFAULT 0,
       status            VARCHAR(32)   NOT NULL DEFAULT 'pending',
       refund_amount     DECIMAL(14,2) NULL,
       reviewed_by       CHAR(36)      NULL,
       reviewed_at       DATETIME      NULL,
       review_reason     TEXT          NULL,
       created_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
       updated_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
       synced_at         DATETIME      NULL,
       FOREIGN KEY (scheme_id) REFERENCES chit_schemes(id) ON DELETE CASCADE,
       FOREIGN KEY (member_id) REFERENCES chit_members(id) ON DELETE CASCADE,
       INDEX idx_withdrawal_requests_scheme (scheme_id),
       INDEX idx_withdrawal_requests_member (member_id),
       INDEX idx_withdrawal_requests_status (status)
     )`,

    // ── Product Redemption Policy — see the matching SQLite migration for
    // full rationale. actual_product_value is intentionally omitted — the
    // existing redeemed_value column already means exactly that.
    `ALTER TABLE chit_members ADD COLUMN claim_status VARCHAR(32) NOT NULL DEFAULT 'pending_claim'`,
    `ALTER TABLE chit_members ADD COLUMN claim_due_date DATETIME NULL`,
    `ALTER TABLE chit_members ADD COLUMN claim_reminder_sent_at DATETIME NULL`,
    `ALTER TABLE chit_members ADD COLUMN claimed_at DATETIME NULL`,
    `ALTER TABLE chit_members ADD COLUMN transferred_customer_id CHAR(36) NULL`,
    `ALTER TABLE chit_members ADD COLUMN transfer_reason TEXT NULL`,
    `ALTER TABLE chit_members ADD COLUMN substitution_flag TINYINT(1) NOT NULL DEFAULT 0`,
    `ALTER TABLE chit_members ADD COLUMN substitution_reason TEXT NULL`,
    `ALTER TABLE chit_members ADD COLUMN entitlement_value DECIMAL(14,2) NULL`,
    `ALTER TABLE chit_members ADD COLUMN upgrade_amount DECIMAL(14,2) NOT NULL DEFAULT 0`,
    `ALTER TABLE chit_members ADD COLUMN upgrade_payment_status VARCHAR(32) NULL`,
    `ALTER TABLE chit_members ADD COLUMN upgrade_payment_method VARCHAR(32) NULL`,
    `ALTER TABLE chit_members ADD COLUMN upgrade_paid_at DATETIME NULL`,
    `ALTER TABLE chit_members ADD COLUMN wallet_credit_created DECIMAL(14,2) NOT NULL DEFAULT 0`,
    `ALTER TABLE chit_members ADD INDEX idx_chit_members_claim_status (claim_status)`,
    // Production Readiness Audit — see the matching SQLite migration.
    `ALTER TABLE customers ADD INDEX idx_customers_branch (branch_id)`,

    `CREATE TABLE IF NOT EXISTS smartbuy_wallet (
       id          CHAR(36)      NOT NULL PRIMARY KEY,
       customer_id CHAR(36)      NOT NULL UNIQUE,
       balance     DECIMAL(14,2) NOT NULL DEFAULT 0,
       created_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
       updated_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
       synced_at   DATETIME      NULL
     )`,
    `CREATE TABLE IF NOT EXISTS smartbuy_wallet_transactions (
       id               CHAR(36)      NOT NULL PRIMARY KEY,
       wallet_id        CHAR(36)      NOT NULL,
       customer_id      CHAR(36)      NOT NULL,
       transaction_type VARCHAR(16)   NOT NULL,
       amount           DECIMAL(14,2) NOT NULL,
       balance_after    DECIMAL(14,2) NOT NULL,
       source           VARCHAR(64)   NULL,
       redemption_id    CHAR(36)      NULL,
       notes            TEXT          NULL,
       created_by       CHAR(36)      NULL,
       created_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
       synced_at        DATETIME      NULL,
       INDEX idx_smartbuy_wallet_txn_wallet (wallet_id),
       INDEX idx_smartbuy_wallet_txn_customer (customer_id)
     )`,
    // ── SmartBuy Wallet as a POS payment method — see the matching SQLite
    // migration for full rationale.
    `ALTER TABLE payments ADD COLUMN wallet_transaction_id CHAR(36) NULL`,
    `ALTER TABLE smartbuy_wallet_transactions ADD COLUMN invoice_id CHAR(36) NULL`,
    `ALTER TABLE smartbuy_wallet_transactions ADD INDEX idx_smartbuy_wallet_txn_invoice (invoice_id)`,
    // Composite index for computeMemberCycleBalance/eligibleMembersForDraw's
    // member_id+cycle_no(+status) filter on chit_contributions — see the
    // matching SQLite migration for the full story (proven at 500k-row
    // scale to fix a 25s query down to sub-second by giving the planner an
    // unambiguous, selective index instead of the cycle_no-only one it was
    // otherwise picking).
    `ALTER TABLE chit_contributions ADD INDEX idx_chit_contributions_member_cycle (member_id, cycle_no, status)`,
    `CREATE TABLE IF NOT EXISTS smartbuy_transfer_history (
       id                    CHAR(36)  NOT NULL PRIMARY KEY,
       member_id             CHAR(36)  NOT NULL,
       original_customer_id  CHAR(36)  NOT NULL,
       new_customer_id       CHAR(36)  NOT NULL,
       reason                TEXT      NOT NULL,
       approved_by           CHAR(36)  NULL,
       approved_at           DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP,
       created_at            DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP,
       synced_at             DATETIME  NULL,
       INDEX idx_smartbuy_transfer_history_member (member_id)
     )`,

    // ── Stock counts — were pushed from the app but had no cloud table at
    // all, so every sync for them failed silently ───────────────────────
    `CREATE TABLE IF NOT EXISTS stock_count_sessions (
       id            CHAR(36)     NOT NULL PRIMARY KEY,
       branch_id     CHAR(36)     NOT NULL,
       warehouse_id  CHAR(36)     NULL,
       status        VARCHAR(20)  NOT NULL DEFAULT 'in_progress',
       notes         TEXT         NULL,
       created_by    CHAR(36)     NULL,
       completed_by  CHAR(36)     NULL,
       created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
       completed_at  DATETIME     NULL,
       updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
       synced_at     DATETIME     NULL,
       INDEX idx_stock_count_sessions_branch (branch_id),
       INDEX idx_stock_count_sessions_updated (updated_at)
     )`,
    `CREATE TABLE IF NOT EXISTS stock_count_items (
       id            CHAR(36)      NOT NULL PRIMARY KEY,
       session_id    CHAR(36)      NOT NULL,
       product_id    CHAR(36)      NOT NULL,
       system_qty    DECIMAL(12,2) NOT NULL DEFAULT 0,
       counted_qty   DECIMAL(12,2) NULL,
       notes         TEXT          NULL,
       updated_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
       synced_at     DATETIME      NULL,
       UNIQUE KEY uq_stock_count_items_session_product (session_id, product_id),
       INDEX idx_stock_count_items_session (session_id),
       INDEX idx_stock_count_items_updated (updated_at)
     )`,

    // ── Smart Buy (Chit Fund) agent cash remittance/settlement ───────────
    `CREATE TABLE IF NOT EXISTS agent_remittances (
       id             CHAR(36)      NOT NULL PRIMARY KEY,
       agent_id       CHAR(36)      NOT NULL,
       branch_id      CHAR(36)      NOT NULL,
       amount         DECIMAL(14,2) NOT NULL DEFAULT 0,
       method         VARCHAR(20)   NOT NULL DEFAULT 'cash',
       bank_reference VARCHAR(128)  NULL,
       submitted_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
       received_by    CHAR(36)      NULL,
       notes          TEXT          NULL,
       created_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
       updated_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
       synced_at      DATETIME      NULL,
       INDEX idx_agent_remittances_agent (agent_id),
       INDEX idx_agent_remittances_branch (branch_id),
       INDEX idx_agent_remittances_updated (updated_at)
     )`,
    // Already-provisioned tenants pre-date enrolled_branch_id.
    `ALTER TABLE chit_members ADD COLUMN enrolled_branch_id CHAR(36) NULL`,
    `CREATE TABLE IF NOT EXISTS chit_scheme_branches (
       id           CHAR(36)     NOT NULL PRIMARY KEY,
       scheme_id    CHAR(36)     NOT NULL,
       branch_id    CHAR(36)     NOT NULL,
       status       VARCHAR(20)  NOT NULL DEFAULT 'pending',
       requested_by CHAR(36)     NULL,
       responded_by CHAR(36)     NULL,
       responded_at DATETIME     NULL,
       notes        TEXT         NULL,
       created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
       updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
       synced_at    DATETIME     NULL,
       UNIQUE KEY uq_chit_scheme_branches (scheme_id, branch_id),
       INDEX idx_chit_scheme_branches_branch (branch_id),
       INDEX idx_chit_scheme_branches_status (status)
     )`,
    // Already-provisioned tenants pre-date products.brand.
    `ALTER TABLE products ADD COLUMN brand VARCHAR(128) NULL`,
    `ALTER TABLE products ADD INDEX idx_products_brand (brand)`,

    // ── Enterprise Commission Engine ──────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS commission_rules (
       id                     CHAR(36)      NOT NULL PRIMARY KEY,
       name                   VARCHAR(255)  NOT NULL,
       scope                  VARCHAR(20)   NOT NULL DEFAULT 'global',
       scheme_id              CHAR(36)      NULL,
       product_id             CHAR(36)      NULL,
       category_id            CHAR(36)      NULL,
       brand                  VARCHAR(128)  NULL,
       calculation_type       VARCHAR(20)   NOT NULL DEFAULT 'percentage',
       rate                   DECIMAL(14,4) NOT NULL DEFAULT 0,
       ownership_model        VARCHAR(20)   NOT NULL DEFAULT 'registration',
       registration_share_pct DECIMAL(6,2)  NOT NULL DEFAULT 100,
       sales_share_pct        DECIMAL(6,2)  NOT NULL DEFAULT 0,
       is_bonus               BOOLEAN       NOT NULL DEFAULT 0,
       priority               INT           NOT NULL DEFAULT 0,
       active_from            DATETIME      NULL,
       active_to              DATETIME      NULL,
       status                 VARCHAR(20)   NOT NULL DEFAULT 'active',
       notes                  TEXT          NULL,
       created_by             CHAR(36)      NULL,
       created_at             DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
       updated_at             DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
       synced_at              DATETIME      NULL,
       INDEX idx_commission_rules_scheme (scheme_id),
       INDEX idx_commission_rules_product (product_id),
       INDEX idx_commission_rules_category (category_id),
       INDEX idx_commission_rules_status (status)
     )`,
    `CREATE TABLE IF NOT EXISTS commission_ledger (
       id                      CHAR(36)      NOT NULL PRIMARY KEY,
       source_table            VARCHAR(32)   NOT NULL,
       source_id               CHAR(36)      NOT NULL,
       scheme_id               CHAR(36)      NULL,
       member_id               CHAR(36)      NULL,
       rule_id                 CHAR(36)      NULL,
       is_bonus                BOOLEAN       NOT NULL DEFAULT 0,
       registration_agent_id   CHAR(36)      NULL,
       sales_agent_id          CHAR(36)      NULL,
       base_amount             DECIMAL(14,2) NOT NULL DEFAULT 0,
       registration_commission DECIMAL(14,2) NOT NULL DEFAULT 0,
       sales_commission        DECIMAL(14,2) NOT NULL DEFAULT 0,
       total_commission        DECIMAL(14,2) NOT NULL DEFAULT 0,
       status                  VARCHAR(20)   NOT NULL DEFAULT 'pending',
       approved_by             CHAR(36)      NULL,
       approved_at             DATETIME      NULL,
       paid_at                 DATETIME      NULL,
       branch_id               CHAR(36)      NULL,
       notes                   TEXT          NULL,
       created_at              DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
       updated_at              DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
       synced_at               DATETIME      NULL,
       INDEX idx_commission_ledger_source (source_table, source_id),
       INDEX idx_commission_ledger_scheme (scheme_id),
       INDEX idx_commission_ledger_reg (registration_agent_id),
       INDEX idx_commission_ledger_sales (sales_agent_id),
       INDEX idx_commission_ledger_status (status)
     )`,
    `CREATE TABLE IF NOT EXISTS commission_payouts (
       id           CHAR(36)      NOT NULL PRIMARY KEY,
       agent_id     CHAR(36)      NOT NULL,
       branch_id    CHAR(36)      NULL,
       amount       DECIMAL(14,2) NOT NULL DEFAULT 0,
       method       VARCHAR(20)   NOT NULL DEFAULT 'cash',
       reference    VARCHAR(255)  NULL,
       paid_by      CHAR(36)      NULL,
       paid_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
       notes        TEXT          NULL,
       created_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
       updated_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
       synced_at    DATETIME      NULL,
       INDEX idx_commission_payouts_agent (agent_id),
       INDEX idx_commission_payouts_branch (branch_id)
     )`,
    // Already-provisioned tenants pre-date payout_id — links a ledger line
    // to the batch payment event that actually paid it out.
    `ALTER TABLE commission_ledger ADD COLUMN payout_id CHAR(36) NULL`,
    `ALTER TABLE commission_ledger ADD INDEX idx_commission_ledger_payout (payout_id)`,

    // ── Multi-level commission approval workflow ──────────────────────────
    // Status values grew past VARCHAR(20) (e.g. 'pending_manager_approval'
    // is 25 chars) — widen unconditionally, MODIFY is a safe no-op on repeat.
    `ALTER TABLE commission_ledger MODIFY COLUMN status VARCHAR(40) NOT NULL DEFAULT 'pending_manager_approval'`,
    `ALTER TABLE commission_ledger ADD COLUMN admin_approved_by CHAR(36) NULL`,
    `ALTER TABLE commission_ledger ADD COLUMN admin_approved_at DATETIME NULL`,
    `UPDATE commission_ledger SET status='pending_manager_approval' WHERE status='pending'`,
    `UPDATE commission_ledger SET status='pending_admin_approval' WHERE status='approved'`,
    // Mirrors the SQLite-side idx_commission_ledger_source_rule_unique fix —
    // blocks the same rule firing twice for the same source event while
    // still allowing a base rule + stacked bonus rules on one source_id
    // (different rule_id each). InnoDB treats every NULL as distinct for
    // uniqueness, same as SQLite, so legacy no-rule-match rows never collide.
    // If a tenant already has genuine duplicate rows this statement warns
    // (see ensureTenantCompatibility's catch below) rather than aborting
    // the rest of the migration — manual cleanup, not a crash.
    `ALTER TABLE commission_ledger ADD UNIQUE INDEX idx_commission_ledger_source_rule_unique (source_table, source_id, rule_id)`,
    `CREATE TABLE IF NOT EXISTS commission_approval_logs (
       id               CHAR(36)     NOT NULL PRIMARY KEY,
       commission_id    CHAR(36)     NOT NULL,
       agent_id         CHAR(36)     NULL,
       branch_id        CHAR(36)     NULL,
       action           VARCHAR(32)  NOT NULL,
       previous_status  VARCHAR(40)  NULL,
       new_status       VARCHAR(40)  NOT NULL,
       changed_by       CHAR(36)     NULL,
       remarks          TEXT         NULL,
       created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
       synced_at        DATETIME     NULL,
       INDEX idx_commission_approval_logs_commission (commission_id),
       INDEX idx_commission_approval_logs_agent (agent_id),
       INDEX idx_commission_approval_logs_branch (branch_id)
     )`,
    `CREATE TABLE IF NOT EXISTS commission_statement_history (
       id            CHAR(36)     NOT NULL PRIMARY KEY,
       agent_id      CHAR(36)     NOT NULL,
       generated_by  CHAR(36)     NULL,
       period_from   DATE         NULL,
       period_to     DATE         NULL,
       status_filter VARCHAR(40)  NULL,
       generated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
       synced_at     DATETIME     NULL,
       INDEX idx_commission_statement_history_agent (agent_id)
     )`,
    `CREATE TABLE IF NOT EXISTS commission_rule_history (
       id                   CHAR(36)      NOT NULL PRIMARY KEY,
       rule_id              CHAR(36)      NOT NULL,
       product_id           CHAR(36)      NULL,
       scope                VARCHAR(20)   NOT NULL,
       calculation_type     VARCHAR(20)   NOT NULL,
       rate                 DECIMAL(14,4) NOT NULL DEFAULT 0,
       effective_start_date DATETIME      NULL,
       effective_end_date   DATETIME      NULL,
       created_by           CHAR(36)      NULL,
       created_at           DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
       synced_at            DATETIME      NULL,
       INDEX idx_commission_rule_history_rule (rule_id)
     )`,

    // ── Missing-index sweep across Smart Buy / commission tables — brings
    // the cloud (MySQL) schema's indexing up to parity with the local
    // SQLite schema (SmartBuy fix audit, MED-4: schema sync). Every
    // statement goes through the standard try/catch loop below, which
    // already swallows "Duplicate key name" — safe to re-run on every boot.
    `ALTER TABLE chit_schemes ADD INDEX idx_chit_schemes_product (product_id)`,
    `ALTER TABLE chit_members ADD INDEX idx_chit_members_installment (installment_id)`,
    `ALTER TABLE chit_members ADD INDEX idx_chit_members_redeemed_product (redeemed_product_id)`,
    `ALTER TABLE chit_members ADD INDEX idx_chit_members_redemption_invoice (redemption_invoice_id)`,
    `ALTER TABLE chit_draws ADD INDEX idx_chit_draws_winner (winner_member_id)`,
    `ALTER TABLE chit_draws ADD INDEX idx_chit_draws_conducted_by (conducted_by)`,
    `ALTER TABLE chit_contributions ADD INDEX idx_chit_contributions_branch (branch_id)`,
    `ALTER TABLE chit_contributions ADD INDEX idx_chit_contributions_collected_by (collected_by_agent_id)`,
    `ALTER TABLE chit_contributions ADD INDEX idx_chit_contributions_received_by (received_by)`,
    `ALTER TABLE chit_contributions ADD INDEX idx_chit_contributions_verified_by (verified_by)`,
    `ALTER TABLE chit_contributions ADD INDEX idx_chit_contributions_cycle (cycle_no)`,
    `ALTER TABLE agent_remittances ADD INDEX idx_agent_remittances_received_by (received_by)`,
    `ALTER TABLE chit_scheme_branches ADD INDEX idx_chit_scheme_branches_requested_by (requested_by)`,
    `ALTER TABLE chit_scheme_branches ADD INDEX idx_chit_scheme_branches_responded_by (responded_by)`,
    `ALTER TABLE commission_rules ADD INDEX idx_commission_rules_brand (brand)`,
    `ALTER TABLE commission_ledger ADD INDEX idx_commission_ledger_member (member_id)`,
    `ALTER TABLE commission_ledger ADD INDEX idx_commission_ledger_rule (rule_id)`,
    `ALTER TABLE commission_ledger ADD INDEX idx_commission_ledger_approved_by (approved_by)`,
    `ALTER TABLE commission_ledger ADD INDEX idx_commission_ledger_admin_approved (admin_approved_by)`,
    // idx_commission_ledger_branch exists in SQLite but was missing here —
    // closes the one gap the audit found running the other direction.
    `ALTER TABLE commission_ledger ADD INDEX idx_commission_ledger_branch (branch_id)`,
    `ALTER TABLE commission_payouts ADD INDEX idx_commission_payouts_paid_by (paid_by)`,
    `ALTER TABLE commission_approval_logs ADD INDEX idx_commission_approval_logs_changed_by (changed_by)`,
    `ALTER TABLE commission_statement_history ADD INDEX idx_commission_statement_history_generated (generated_by)`,
    `ALTER TABLE commission_rule_history ADD INDEX idx_commission_rule_history_product (product_id)`,
    `ALTER TABLE commission_rule_history ADD INDEX idx_commission_rule_history_created_by (created_by)`,
    // (The commission_ledger(source_table, source_id, rule_id) unique index
    // for MED-2 already lives above, alongside the other approval-workflow
    // migrations — not duplicated here.)
    // Performance indexes for large-dataset reports/dashboard (production
    // readiness audit) — mirrors the SQLite-side additions.
    `ALTER TABLE chit_members ADD INDEX idx_chit_members_won_cycle (scheme_id, won_cycle_no)`,
    `ALTER TABLE chit_contributions ADD INDEX idx_chit_contributions_paid_at (paid_at)`,
    `ALTER TABLE commission_ledger ADD INDEX idx_commission_ledger_created_at (created_at)`,
    // audit_logs.ip_address existed in the local SQLite / self-hosted
    // Postgres schemas but was missing from the multi-tenant MySQL schema —
    // logAudit() now populates it (SmartBuy fix audit, HIGH-4).
    `ALTER TABLE audit_logs ADD COLUMN ip_address VARCHAR(64) NULL`,

    // ── Manual-only draw workflow — random selection removed entirely;
    // these two are the remaining "Manual Draw Result" form fields not
    // already covered by conducted_by/notes/draw_date. ─────────────────
    `ALTER TABLE chit_draws ADD COLUMN witness_name VARCHAR(255) NULL`,
    `ALTER TABLE chit_draws ADD COLUMN reference_number VARCHAR(128) NULL`,
    `CREATE TABLE IF NOT EXISTS chit_payment_reminders (
       id              CHAR(36)     NOT NULL PRIMARY KEY,
       member_id       CHAR(36)     NOT NULL,
       scheme_id       CHAR(36)     NOT NULL,
       cycle_no        INT          NOT NULL,
       reminder_type   VARCHAR(32)  NOT NULL DEFAULT 'payment_due',
       message         TEXT         NOT NULL,
       sent_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
       sent_by         CHAR(36)     NULL,
       delivery_status VARCHAR(20)  NOT NULL DEFAULT 'sent',
       notes           TEXT         NULL,
       created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
       synced_at       DATETIME     NULL,
       INDEX idx_chit_payment_reminders_member (member_id),
       INDEX idx_chit_payment_reminders_scheme (scheme_id)
     )`,

    // ── POS cart "Hold" — see held_carts table comment in
    // electron/database.ts for why this is separate from invoices ────────
    `CREATE TABLE IF NOT EXISTS held_carts (
       id              CHAR(36)     NOT NULL PRIMARY KEY,
       branch_id       CHAR(36)     NOT NULL,
       cashier_id      CHAR(36)     NULL,
       bill_type       VARCHAR(20)  NOT NULL DEFAULT 'RETAIL',
       customer_id     CHAR(36)     NULL,
       customer_name   VARCHAR(255) NULL,
       items_json      LONGTEXT     NOT NULL,
       global_discount DECIMAL(6,2) NOT NULL DEFAULT 0,
       notes           TEXT         NULL,
       valid_until     DATE         NULL,
       due_date        DATE         NULL,
       item_count      INT          NOT NULL DEFAULT 0,
       total_amount    DECIMAL(14,2) NOT NULL DEFAULT 0,
       created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
       updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
       synced_at       DATETIME     NULL,
       INDEX idx_held_carts_branch (branch_id)
     )`,

    // ── Staff/Agent positions lookup — see positions table comment in
    // electron/database.ts ────────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS positions (
       id         CHAR(36)     NOT NULL PRIMARY KEY,
       name       VARCHAR(255) NOT NULL,
       created_by CHAR(36)     NULL,
       created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
       updated_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
       synced_at  DATETIME     NULL,
       UNIQUE KEY idx_positions_name (name)
     )`,

    // ── Edit requests — manager-requested, admin-approved corrections to
    // already-completed invoices/stock ──────────────────────────────────
    `CREATE TABLE IF NOT EXISTS edit_requests (
       id                  CHAR(36)     NOT NULL PRIMARY KEY,
       target_table        VARCHAR(32)  NOT NULL,
       target_record_id    VARCHAR(128) NOT NULL,
       branch_id           CHAR(36)     NULL,
       requested_by        CHAR(36)     NOT NULL,
       reason              TEXT         NOT NULL,
       requested_changes   JSON         NOT NULL,
       status              VARCHAR(20)  NOT NULL DEFAULT 'pending',
       reviewed_by         CHAR(36)     NULL,
       reviewed_at         DATETIME     NULL,
       review_notes        TEXT         NULL,
       approved_expires_at DATETIME     NULL,
       consumed_at         DATETIME     NULL,
       created_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
       updated_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
       synced_at           DATETIME     NULL,
       INDEX idx_edit_requests_target (target_table, target_record_id),
       INDEX idx_edit_requests_status (status),
       INDEX idx_edit_requests_requester (requested_by)
     )`,

    // SmartBuy Scheme Viability Calculator — see the matching SQLite
    // migration in electron/database.ts for full rationale. Planning-only
    // inputs, unrelated to early_redemption_count/is_early_redemption.
    `ALTER TABLE chit_schemes ADD COLUMN projected_early_winners INT NOT NULL DEFAULT 0`,
    `ALTER TABLE chit_schemes ADD COLUMN avg_product_cost DECIMAL(14,2) NOT NULL DEFAULT 0`,
    `ALTER TABLE chit_schemes ADD COLUMN other_expenses DECIMAL(14,2) NOT NULL DEFAULT 0`,
  ]

  for (const sql of [...statements, ...stockTransferColumns]) {
    try {
      await tp.query(sql)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      // "check that (it) exists" covers MySQL's error text for DROP
      // INDEX/COLUMN against something that was never created in the first
      // place (e.g. a fresh tenant that never ran an old, since-removed
      // migration) — exactly as expected/idempotent as the other patterns
      // already swallowed here.
      if (!/Duplicate column name|Duplicate key name|already exists|check that (it |column\/key )?exists/i.test(message)) {
        console.warn(`[ensureTenantCompatibility] Warning running statement: "${sql}". Error: ${message}`)
      }
    }
  }

  try {
    const bcrypt = require('bcryptjs')
    const hash = bcrypt.hashSync('admin123', 10)
    const { rows: userRows } = await tp.query(`SELECT id FROM users WHERE LOWER(email) = 'admin@pos.local' LIMIT 1`)
    if (!userRows.length) {
      await tp.query(`
        INSERT INTO users (id, branch_id, role_id, name, email, password_hash, is_active)
        VALUES ('u9999999-9999-4999-8999-999999999999', 'b1111111-1111-4111-8111-111111111111', '3a6b8c9d-1e2f-4a3b-8c9d-1e2f3a6b8c9d', 'System Admin', 'admin@pos.local', ?, 1)
      `, [hash])
    }
  } catch {
    // Ignore seeding error
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

  // Also accept a just-regenerated key's previous value while its grace
  // period is still active, so rotating a key doesn't instantly lock out a
  // device that hasn't picked up the new one yet.
  const { rows } = await pool.query(
    `SELECT id, db_schema, name, slug, status, admin_locked FROM companies
     WHERE api_key = ?
        OR (previous_api_key = ? AND previous_api_key_expires_at > NOW())`,
    [apiKey, apiKey]
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
    id:          c.id,
    dbSchema:    c.db_schema,
    name:        c.name,
    slug:        c.slug,
    adminLocked: Boolean(Number(c.admin_locked)),
    tp:          tenantPool(c.db_schema),
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
