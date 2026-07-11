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

-- modules
CREATE TABLE IF NOT EXISTS modules (
  id          CHAR(36)     NOT NULL PRIMARY KEY,
  module_key  VARCHAR(64)  NOT NULL UNIQUE,
  module_name VARCHAR(128) NOT NULL,
  description TEXT         NULL,
  sort_order  INT          NOT NULL DEFAULT 0,
  is_active   BOOLEAN      NOT NULL DEFAULT 1,
  created_at  DATETIME     NOT NULL DEFAULT NOW(),
  updated_at  DATETIME     NOT NULL DEFAULT NOW() ON UPDATE NOW()
);

-- features
CREATE TABLE IF NOT EXISTS features (
  id          CHAR(36)      NOT NULL PRIMARY KEY,
  feature_key VARCHAR(128)  NOT NULL UNIQUE,
  feature_name VARCHAR(128) NOT NULL,
  module_key  VARCHAR(64)   NOT NULL,
  description TEXT          NULL,
  sort_order  INT           NOT NULL DEFAULT 0,
  is_active   BOOLEAN       NOT NULL DEFAULT 1,
  created_at  DATETIME      NOT NULL DEFAULT NOW(),
  updated_at  DATETIME      NOT NULL DEFAULT NOW() ON UPDATE NOW()
);

-- plans
CREATE TABLE IF NOT EXISTS plans (
  id            CHAR(36)      NOT NULL PRIMARY KEY,
  plan_key      VARCHAR(64)   NOT NULL UNIQUE,
  plan_name     VARCHAR(128)  NOT NULL,
  description   TEXT          NULL,
  monthly_price DECIMAL(12,2) NOT NULL DEFAULT 0,
  annual_price  DECIMAL(12,2) NOT NULL DEFAULT 0,
  validity_days INT           NOT NULL DEFAULT 30,
  is_active     BOOLEAN       NOT NULL DEFAULT 1,
  created_at    DATETIME      NOT NULL DEFAULT NOW(),
  updated_at    DATETIME      NOT NULL DEFAULT NOW() ON UPDATE NOW()
);

-- plan_modules
CREATE TABLE IF NOT EXISTS plan_modules (
  id         CHAR(36)    NOT NULL PRIMARY KEY,
  plan_id    CHAR(36)    NOT NULL,
  module_key VARCHAR(64) NOT NULL,
  is_enabled BOOLEAN     NOT NULL DEFAULT 1,
  created_at DATETIME    NOT NULL DEFAULT NOW(),
  FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE CASCADE,
  UNIQUE KEY uq_plan_module (plan_id, module_key)
);

-- plan_features
CREATE TABLE IF NOT EXISTS plan_features (
  id          CHAR(36)      NOT NULL PRIMARY KEY,
  plan_id     CHAR(36)      NOT NULL,
  feature_key VARCHAR(128)  NOT NULL,
  is_enabled  BOOLEAN       NOT NULL DEFAULT 1,
  created_at  DATETIME      NOT NULL DEFAULT NOW(),
  FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE CASCADE,
  UNIQUE KEY uq_plan_feature (plan_id, feature_key)
);

-- company feature/module overrides
CREATE TABLE IF NOT EXISTS company_module_overrides (
  id         CHAR(36)    NOT NULL PRIMARY KEY,
  company_id  CHAR(36)    NOT NULL,
  module_key  VARCHAR(64) NOT NULL,
  is_enabled  BOOLEAN     NOT NULL DEFAULT 1,
  enabled_by  CHAR(36),
  enabled_at  DATETIME    NULL,
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  UNIQUE KEY uq_company_module_override (company_id, module_key)
);

CREATE TABLE IF NOT EXISTS company_feature_overrides (
  id          CHAR(36)      NOT NULL PRIMARY KEY,
  company_id  CHAR(36)      NOT NULL,
  feature_key VARCHAR(128)  NOT NULL,
  is_enabled  BOOLEAN       NOT NULL DEFAULT 1,
  enabled_by  CHAR(36),
  enabled_at  DATETIME      NULL,
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  UNIQUE KEY uq_company_feature_override (company_id, feature_key)
);

-- company_limits
CREATE TABLE IF NOT EXISTS company_limits (
  id            CHAR(36)      NOT NULL PRIMARY KEY,
  company_id    CHAR(36)      NOT NULL UNIQUE,
  max_users     INT           NOT NULL DEFAULT 0,
  max_branches   INT           NOT NULL DEFAULT 0,
  max_pos_devices INT          NOT NULL DEFAULT 0,
  max_storage_gb INT           NOT NULL DEFAULT 0,
  updated_by    CHAR(36),
  updated_at    DATETIME      NOT NULL DEFAULT NOW() ON UPDATE NOW(),
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
);

-- licenses
CREATE TABLE IF NOT EXISTS licenses (
  id          CHAR(36)      NOT NULL PRIMARY KEY,
  company_id  CHAR(36)      NOT NULL,
  license_key VARCHAR(255)  NOT NULL UNIQUE,
  status      VARCHAR(20)   NOT NULL DEFAULT 'active',
  plan_id     CHAR(36)      NULL,
  issued_to   VARCHAR(255)  NULL,
  issued_at   DATETIME      NOT NULL DEFAULT NOW(),
  expires_at  DATETIME      NULL,
  revoked_at  DATETIME      NULL,
  device_id   VARCHAR(255)  NULL,
  notes       TEXT          NULL,
  created_at  DATETIME      NOT NULL DEFAULT NOW(),
  updated_at  DATETIME      NOT NULL DEFAULT NOW() ON UPDATE NOW()
);

-- feature usage + subscription history
CREATE TABLE IF NOT EXISTS feature_usage (
  id           CHAR(36)      NOT NULL PRIMARY KEY,
  company_id   CHAR(36)      NOT NULL,
  user_id      CHAR(36)      NULL,
  device_id    VARCHAR(255)  NULL,
  feature_key  VARCHAR(128)  NOT NULL,
  usage_count  INT           NOT NULL DEFAULT 0,
  last_used_at DATETIME      NULL,
  created_at   DATETIME      NOT NULL DEFAULT NOW(),
  updated_at   DATETIME      NOT NULL DEFAULT NOW() ON UPDATE NOW(),
  UNIQUE KEY uq_feature_usage (company_id, feature_key, device_id)
);

CREATE TABLE IF NOT EXISTS subscription_history (
  id          CHAR(36)      NOT NULL PRIMARY KEY,
  company_id  CHAR(36)      NOT NULL,
  plan_id     CHAR(36)      NULL,
  status      VARCHAR(20)   NOT NULL,
  starts_at   DATETIME      NOT NULL DEFAULT NOW(),
  ends_at     DATETIME      NULL,
  changed_by  CHAR(36)      NULL,
  notes       TEXT          NULL,
  created_at  DATETIME      NOT NULL DEFAULT NOW(),
  updated_at  DATETIME      NOT NULL DEFAULT NOW() ON UPDATE NOW()
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
