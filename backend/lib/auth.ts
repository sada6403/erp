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
    `CREATE TABLE IF NOT EXISTS chit_members (
       id                    CHAR(36)      NOT NULL PRIMARY KEY,
       scheme_id             CHAR(36)      NOT NULL,
       customer_id           CHAR(36)      NOT NULL,
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
       INDEX idx_chit_members_status (status)
     )`,
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
  ]

  for (const sql of [...statements, ...stockTransferColumns]) {
    try {
      await tp.query(sql)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!/Duplicate column name|Duplicate key name|already exists/i.test(message)) {
        console.warn(`[ensureTenantCompatibility] Warning running statement: "${sql}". Error: ${message}`)
      }
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
