-- ═══════════════════════════════════════════════════════════════════════════
-- Enterprise POS ERP — SaaS Multi-Tenant Schema (MySQL 8.0+)
-- Run ONCE on the central MySQL server.  Database: pos_erp_saas
-- ═══════════════════════════════════════════════════════════════════════════

CREATE DATABASE IF NOT EXISTS pos_erp_saas CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE pos_erp_saas;

-- ─── SUPERADMINS ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS superadmins (
  id             CHAR(36)     NOT NULL PRIMARY KEY,
  name           VARCHAR(255) NOT NULL,
  email          VARCHAR(255) NOT NULL UNIQUE,
  password_hash  VARCHAR(255) NOT NULL,
  is_active      BOOLEAN      NOT NULL DEFAULT 1,
  last_login_at  DATETIME,
  created_at     DATETIME     NOT NULL DEFAULT NOW(),
  updated_at     DATETIME     NOT NULL DEFAULT NOW() ON UPDATE NOW()
);

-- ─── PACKAGES ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS packages (
  id            CHAR(36)      NOT NULL PRIMARY KEY,
  name          VARCHAR(100)  NOT NULL,
  description   TEXT,
  max_branches  INT           NOT NULL DEFAULT 1,
  max_users     INT           NOT NULL DEFAULT 5,
  max_products  INT           NOT NULL DEFAULT 500,
  features      JSON          NOT NULL,
  monthly_price DECIMAL(10,2) NOT NULL DEFAULT 0,
  annual_price  DECIMAL(10,2) NOT NULL DEFAULT 0,
  trial_days    INT           NOT NULL DEFAULT 14,
  is_active     BOOLEAN       NOT NULL DEFAULT 1,
  sort_order    INT           NOT NULL DEFAULT 0,
  created_at    DATETIME      NOT NULL DEFAULT NOW(),
  updated_at    DATETIME      NOT NULL DEFAULT NOW() ON UPDATE NOW()
);

-- ─── COMPANIES ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS companies (
  id               CHAR(36)     NOT NULL PRIMARY KEY,
  slug             VARCHAR(60)  NOT NULL UNIQUE,
  name             VARCHAR(255) NOT NULL,
  email            VARCHAR(255) NOT NULL,
  phone            VARCHAR(50),
  address          TEXT,
  logo_url         TEXT,
  timezone         VARCHAR(50)  NOT NULL DEFAULT 'Asia/Colombo',
  currency         VARCHAR(10)  NOT NULL DEFAULT 'LKR',
  country          VARCHAR(5)   NOT NULL DEFAULT 'LK',
  db_schema        VARCHAR(80)  NOT NULL UNIQUE,
  api_key          CHAR(36)     UNIQUE,
  company_key      CHAR(36)     UNIQUE,
  status           VARCHAR(20)  NOT NULL DEFAULT 'trial',
  suspension_reason TEXT        NULL,
  suspended_at     DATETIME,
  suspended_by     CHAR(36),
  admin_locked     BOOLEAN      NOT NULL DEFAULT 0,
  lock_reason      TEXT         NULL,
  locked_at        DATETIME,
  locked_by        CHAR(36),
  trial_ends_at    DATETIME,
  max_branches     INT          NOT NULL DEFAULT 1,
  max_users        INT          NOT NULL DEFAULT 5,
  max_pos_devices  INT          NOT NULL DEFAULT 2,
  max_storage_gb   INT          NOT NULL DEFAULT 5,
  admin_email      VARCHAR(255) NOT NULL,
  admin_name       VARCHAR(255) NOT NULL,
  admin_phone      VARCHAR(50),
  notes            TEXT,
  created_by       CHAR(36),
  created_at       DATETIME     NOT NULL DEFAULT NOW(),
  updated_at       DATETIME     NOT NULL DEFAULT NOW() ON UPDATE NOW(),
  INDEX idx_slug   (slug),
  INDEX idx_status (status),
  INDEX idx_email  (email)
);

-- ─── COMPANY SUBSCRIPTIONS ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS company_subscriptions (
  id            CHAR(36)      NOT NULL PRIMARY KEY,
  company_id    CHAR(36)      NOT NULL,
  package_id    CHAR(36)      NOT NULL,
  billing_cycle VARCHAR(20)   NOT NULL DEFAULT 'monthly',
  status        VARCHAR(20)   NOT NULL DEFAULT 'active',
  amount        DECIMAL(10,2) NOT NULL DEFAULT 0,
  starts_at     DATETIME      NOT NULL DEFAULT NOW(),
  ends_at       DATETIME,
  created_at    DATETIME      NOT NULL DEFAULT NOW(),
  updated_at    DATETIME      NOT NULL DEFAULT NOW() ON UPDATE NOW(),
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  FOREIGN KEY (package_id) REFERENCES packages(id),
  INDEX idx_subs_company (company_id),
  INDEX idx_subs_status  (status, ends_at)
);

-- ─── REFRESH TOKENS ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id         CHAR(36)     NOT NULL PRIMARY KEY,
  token_hash VARCHAR(128) NOT NULL UNIQUE,
  portal     VARCHAR(20)  NOT NULL,
  user_id    VARCHAR(36)  NOT NULL,
  company_id CHAR(36),
  user_agent TEXT,
  ip_address VARCHAR(45),
  expires_at DATETIME     NOT NULL,
  revoked_at DATETIME,
  created_at DATETIME     NOT NULL DEFAULT NOW(),
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  INDEX idx_rt_hash    (token_hash),
  INDEX idx_rt_user    (portal, user_id),
  INDEX idx_rt_company (company_id)
);

-- ─── SYSTEM SETTINGS ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS system_settings (
  `key`      VARCHAR(50) NOT NULL PRIMARY KEY,
  value      JSON        NOT NULL,
  updated_at DATETIME    NOT NULL DEFAULT NOW() ON UPDATE NOW()
);

-- ─── SUPPORT SESSIONS ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS support_sessions (
  id            CHAR(36) NOT NULL PRIMARY KEY,
  superadmin_id CHAR(36) NOT NULL,
  company_id    CHAR(36) NOT NULL,
  reason        TEXT,
  started_at    DATETIME NOT NULL DEFAULT NOW(),
  ended_at      DATETIME,
  FOREIGN KEY (superadmin_id) REFERENCES superadmins(id),
  FOREIGN KEY (company_id)    REFERENCES companies(id) ON DELETE CASCADE
);

-- ─── SAAS AUDIT LOGS ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS saas_audit_logs (
  id           CHAR(36)     NOT NULL PRIMARY KEY,
  portal       VARCHAR(20)  NOT NULL,
  actor_type   VARCHAR(30)  NOT NULL,
  actor_id     VARCHAR(36)  NOT NULL,
  actor_name   VARCHAR(255),
  company_id   CHAR(36),
  action       VARCHAR(100) NOT NULL,
  resource     VARCHAR(100),
  resource_id  VARCHAR(36),
  old_values   JSON,
  new_values   JSON,
  ip_address   VARCHAR(45),
  user_agent   TEXT,
  created_at   DATETIME     NOT NULL DEFAULT NOW(),
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL,
  INDEX idx_al_actor   (actor_type, actor_id),
  INDEX idx_al_company (company_id),
  INDEX idx_al_date    (created_at)
);

-- ─── SEED: Default packages ───────────────────────────────────────────────────
INSERT IGNORE INTO packages (id, name, description, max_branches, max_users, max_products, monthly_price, annual_price, trial_days, sort_order, features)
VALUES
  (UUID(), 'Starter',
   'Perfect for single-branch shops. Basic POS and reporting.',
   1, 5, 500, 29.99, 299.00, 14, 1,
   '{"pos":true,"installments":false,"reports":"basic","api_access":false,"multi_branch":false}'),
  (UUID(), 'Professional',
   'Multi-branch operations with full features including installments.',
   5, 25, 5000, 79.99, 799.00, 14, 2,
   '{"pos":true,"installments":true,"reports":"full","api_access":true,"multi_branch":true,"purchase_orders":true}'),
  (UUID(), 'Enterprise',
   'Unlimited scale. White-label, SLA, dedicated support.',
   99, 999, 99999, 199.99, 1999.00, 30, 3,
   '{"pos":true,"installments":true,"reports":"full","api_access":true,"multi_branch":true,"purchase_orders":true,"white_label":true,"sla":true}');

-- ─── SEED: Default system settings ───────────────────────────────────────────
INSERT IGNORE INTO system_settings (`key`, value) VALUES
  ('branding', '{"app_name":"Enterprise POS ERP","tagline":"The SaaS ERP for modern retail","logo_url":"","primary_color":"#2563eb","support_email":"support@example.com"}'),
  ('smtp',     '{"host":"","port":587,"secure":false,"user":"","pass":"","from_name":"POS ERP","from_email":"noreply@example.com"}'),
  ('sms',      '{"provider":"twilio","account_sid":"","auth_token":"","from_number":""}'),
  ('payment',  '{"stripe_pk":"","stripe_sk":"","paypal_client_id":""}'),
  ('storage',  '{"provider":"local","s3_bucket":"","s3_region":"","s3_key":"","s3_secret":""}'),
  ('defaults', '{"trial_days":14,"default_timezone":"Asia/Colombo","default_currency":"LKR","default_country":"LK"}');

-- ─── PACKAGE MODULES ──────────────────────────────────────────────────────────
-- Defines which modules are included in each package
CREATE TABLE IF NOT EXISTS package_modules (
  id          CHAR(36)     NOT NULL PRIMARY KEY,
  package_id  CHAR(36)     NOT NULL,
  module_key  VARCHAR(50)  NOT NULL,
  module_name VARCHAR(100) NOT NULL,
  is_enabled  BOOLEAN      NOT NULL DEFAULT 1,
  sort_order  INT          NOT NULL DEFAULT 0,
  created_at  DATETIME     NOT NULL DEFAULT NOW(),
  FOREIGN KEY (package_id) REFERENCES packages(id) ON DELETE CASCADE,
  UNIQUE KEY uq_pkg_module (package_id, module_key)
);

-- ─── COMPANY MODULES ──────────────────────────────────────────────────────────
-- Per-company module overrides (superadmin can enable/disable per company)
CREATE TABLE IF NOT EXISTS company_modules (
  id         CHAR(36)    NOT NULL PRIMARY KEY,
  company_id CHAR(36)    NOT NULL,
  module_key VARCHAR(50) NOT NULL,
  is_enabled BOOLEAN     NOT NULL DEFAULT 1,
  enabled_by CHAR(36),
  enabled_at DATETIME    NOT NULL DEFAULT NOW(),
  notes      TEXT,
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  UNIQUE KEY uq_company_module (company_id, module_key),
  INDEX idx_cm_company (company_id)
);

-- ─── POS DEVICES ──────────────────────────────────────────────────────────────
-- Registered POS desktop devices per company
CREATE TABLE IF NOT EXISTS pos_devices (
  id             CHAR(36)     NOT NULL PRIMARY KEY,
  company_id     CHAR(36)     NOT NULL,
  branch_id      CHAR(36),
  device_name    VARCHAR(255) NOT NULL,
  device_id      VARCHAR(100) NOT NULL UNIQUE,
  license_key    CHAR(36)     NOT NULL UNIQUE,
  os_info        VARCHAR(255),
  app_version    VARCHAR(20),
  status         VARCHAR(20)  NOT NULL DEFAULT 'active',
  last_seen_at   DATETIME,
  activated_at   DATETIME,
  deactivated_at DATETIME,
  notes          TEXT,
  created_at     DATETIME     NOT NULL DEFAULT NOW(),
  updated_at     DATETIME     NOT NULL DEFAULT NOW() ON UPDATE NOW(),
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  INDEX idx_device_company (company_id),
  INDEX idx_device_license (license_key),
  INDEX idx_device_status  (status)
);

-- ─── SYNC LOGS ────────────────────────────────────────────────────────────────
-- Tracks every sync push/pull from POS devices to the backend
CREATE TABLE IF NOT EXISTS sync_logs (
  id           CHAR(36)    NOT NULL PRIMARY KEY,
  company_id   CHAR(36)    NOT NULL,
  device_id    VARCHAR(100),
  branch_id    CHAR(36),
  direction    VARCHAR(10) NOT NULL DEFAULT 'push',
  table_name   VARCHAR(50),
  record_count INT         NOT NULL DEFAULT 0,
  status       VARCHAR(20) NOT NULL DEFAULT 'success',
  error_msg    TEXT,
  duration_ms  INT,
  created_at   DATETIME    NOT NULL DEFAULT NOW(),
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  INDEX idx_sync_company (company_id),
  INDEX idx_sync_date    (created_at),
  INDEX idx_sync_device  (device_id)
);

-- ─── COMPANY BACKUPS ──────────────────────────────────────────────────────────
-- Metadata for encrypted mysqldump backups of a company's own tenant schema.
-- The dump files themselves live on disk (BACKUP_STORAGE_DIR), not in this DB.
CREATE TABLE IF NOT EXISTS company_backups (
  id                CHAR(36)     NOT NULL PRIMARY KEY,
  company_id        CHAR(36)     NOT NULL,
  backup_type       VARCHAR(20)  NOT NULL DEFAULT 'manual',
  status            VARCHAR(20)  NOT NULL DEFAULT 'pending',
  file_name         VARCHAR(255) NULL,
  file_size_bytes   BIGINT       NULL,
  error_message     TEXT         NULL,
  created_by        CHAR(36)     NULL,
  download_count    INT          NOT NULL DEFAULT 0,
  last_downloaded_at DATETIME    NULL,
  restored_at       DATETIME     NULL,
  restored_by       CHAR(36)     NULL,
  created_at        DATETIME     NOT NULL DEFAULT NOW(),
  completed_at      DATETIME     NULL,
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  INDEX idx_backups_company (company_id),
  INDEX idx_backups_status  (status)
);

CREATE TABLE IF NOT EXISTS company_backup_schedules (
  company_id   CHAR(36)    NOT NULL PRIMARY KEY,
  enabled      BOOLEAN     NOT NULL DEFAULT 0,
  frequency    VARCHAR(20) NOT NULL DEFAULT 'daily',
  last_run_at  DATETIME    NULL,
  updated_by   CHAR(36)    NULL,
  updated_at   DATETIME    NOT NULL DEFAULT NOW() ON UPDATE NOW(),
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
);

-- ─── COMPANY EXPORTS ──────────────────────────────────────────────────────────
-- Metadata for per-company data exports (CSV/JSON/Excel/PDF/SQL). Export
-- files themselves live on disk (EXPORT_STORAGE_DIR), not in this DB.
CREATE TABLE IF NOT EXISTS company_exports (
  id                CHAR(36)     NOT NULL PRIMARY KEY,
  company_id        CHAR(36)     NOT NULL,
  entity            VARCHAR(30)  NOT NULL,
  format            VARCHAR(10)  NOT NULL,
  status            VARCHAR(20)  NOT NULL DEFAULT 'pending',
  file_name         VARCHAR(255) NULL,
  file_size_bytes   BIGINT       NULL,
  row_count         INT          NULL,
  error_message     TEXT         NULL,
  created_by        CHAR(36)     NULL,
  download_count    INT          NOT NULL DEFAULT 0,
  last_downloaded_at DATETIME    NULL,
  created_at        DATETIME     NOT NULL DEFAULT NOW(),
  completed_at      DATETIME     NULL,
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  INDEX idx_exports_company (company_id),
  INDEX idx_exports_status  (status)
);

-- ─── SEED: Package modules ────────────────────────────────────────────────────
-- Starter modules
INSERT IGNORE INTO package_modules (id, package_id, module_key, module_name, is_enabled, sort_order)
SELECT UUID(), p.id, m.module_key, m.module_name, m.is_enabled, m.sort_order
FROM packages p
JOIN (
  SELECT 'pos'           AS module_key, 'POS / Billing'         AS module_name, 1 AS is_enabled, 1 AS sort_order UNION ALL
  SELECT 'inventory',                   'Inventory Management',                  1,               2               UNION ALL
  SELECT 'customers',                   'Customer Management',                   1,               3               UNION ALL
  SELECT 'reports_basic',               'Basic Reports',                         1,               4               UNION ALL
  SELECT 'installments',                'Installments & Credit',                 0,               5               UNION ALL
  SELECT 'multi_branch',                'Multi-Branch Management',               0,               6               UNION ALL
  SELECT 'purchase_orders',             'Purchase Orders',                       0,               7               UNION ALL
  SELECT 'deliveries',                  'Delivery Management',                   0,               8               UNION ALL
  SELECT 'expenses',                    'Expense Tracking',                      0,               9               UNION ALL
  SELECT 'reports_full',                'Advanced Reports & Analytics',          0,               10              UNION ALL
  SELECT 'stock_transfers',             'Inter-Branch Stock Transfers',          0,               11              UNION ALL
  SELECT 'api_access',                  'API Access',                            0,               12              UNION ALL
  SELECT 'white_label',                 'White Label',                           0,               13
) m ON 1=1
WHERE p.name = 'Starter';

-- Professional modules
INSERT IGNORE INTO package_modules (id, package_id, module_key, module_name, is_enabled, sort_order)
SELECT UUID(), p.id, m.module_key, m.module_name, m.is_enabled, m.sort_order
FROM packages p
JOIN (
  SELECT 'pos'           AS module_key, 'POS / Billing'         AS module_name, 1 AS is_enabled, 1 AS sort_order UNION ALL
  SELECT 'inventory',                   'Inventory Management',                  1,               2               UNION ALL
  SELECT 'customers',                   'Customer Management',                   1,               3               UNION ALL
  SELECT 'reports_basic',               'Basic Reports',                         1,               4               UNION ALL
  SELECT 'installments',                'Installments & Credit',                 1,               5               UNION ALL
  SELECT 'multi_branch',                'Multi-Branch Management',               1,               6               UNION ALL
  SELECT 'purchase_orders',             'Purchase Orders',                       1,               7               UNION ALL
  SELECT 'deliveries',                  'Delivery Management',                   1,               8               UNION ALL
  SELECT 'expenses',                    'Expense Tracking',                      1,               9               UNION ALL
  SELECT 'reports_full',                'Advanced Reports & Analytics',          1,               10              UNION ALL
  SELECT 'stock_transfers',             'Inter-Branch Stock Transfers',          1,               11              UNION ALL
  SELECT 'api_access',                  'API Access',                            1,               12              UNION ALL
  SELECT 'white_label',                 'White Label',                           0,               13
) m ON 1=1
WHERE p.name = 'Professional';

-- Enterprise modules (all enabled)
INSERT IGNORE INTO package_modules (id, package_id, module_key, module_name, is_enabled, sort_order)
SELECT UUID(), p.id, m.module_key, m.module_name, 1, m.sort_order
FROM packages p
JOIN (
  SELECT 'pos'           AS module_key, 'POS / Billing'         AS module_name, 1 AS sort_order UNION ALL
  SELECT 'inventory',                   'Inventory Management',                  2               UNION ALL
  SELECT 'customers',                   'Customer Management',                   3               UNION ALL
  SELECT 'reports_basic',               'Basic Reports',                         4               UNION ALL
  SELECT 'installments',                'Installments & Credit',                 5               UNION ALL
  SELECT 'multi_branch',                'Multi-Branch Management',               6               UNION ALL
  SELECT 'purchase_orders',             'Purchase Orders',                       7               UNION ALL
  SELECT 'deliveries',                  'Delivery Management',                   8               UNION ALL
  SELECT 'expenses',                    'Expense Tracking',                      9               UNION ALL
  SELECT 'reports_full',                'Advanced Reports & Analytics',          10              UNION ALL
  SELECT 'stock_transfers',             'Inter-Branch Stock Transfers',          11              UNION ALL
  SELECT 'api_access',                  'API Access',                            12              UNION ALL
  SELECT 'white_label',                 'White Label',                           13
) m ON 1=1
WHERE p.name = 'Enterprise';

-- ─── NOTE: Create first superadmin via the setup script ──────────────────────
-- cd backend && node scripts/create-superadmin.js
