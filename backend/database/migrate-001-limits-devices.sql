-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 001 — Add resource limits + new tables to pos_erp_saas
-- Run this if your database was created BEFORE saas-schema.sql was updated.
-- Safe to run multiple times (uses IF NOT EXISTS / IF EXISTS).
-- ═══════════════════════════════════════════════════════════════════════════

USE pos_erp_saas;

-- Add limit columns to companies (if not already present)
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS max_branches    INT NOT NULL DEFAULT 1  AFTER trial_ends_at,
  ADD COLUMN IF NOT EXISTS max_users       INT NOT NULL DEFAULT 5  AFTER max_branches,
  ADD COLUMN IF NOT EXISTS max_pos_devices INT NOT NULL DEFAULT 2  AFTER max_users,
  ADD COLUMN IF NOT EXISTS max_storage_gb  INT NOT NULL DEFAULT 5  AFTER max_pos_devices;

-- package_modules
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

-- company_modules
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

-- pos_devices
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

-- sync_logs
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

SELECT 'Migration 001 complete' AS result;
