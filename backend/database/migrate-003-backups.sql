-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 003 — Backup & Download Center
-- Adds backup history + per-company backup scheduling to the control-plane
-- DB (pos_erp_saas). Does NOT touch any tenant schema — backups are dumps
-- of tenant schemas, not rows within them.
-- Safe to run multiple times (CREATE TABLE IF NOT EXISTS).
-- ═══════════════════════════════════════════════════════════════════════════

USE pos_erp_saas;

CREATE TABLE IF NOT EXISTS company_backups (
  id                CHAR(36)     NOT NULL PRIMARY KEY,
  company_id        CHAR(36)     NOT NULL,
  backup_type       VARCHAR(20)  NOT NULL DEFAULT 'manual', -- manual | scheduled | pre-restore-safety
  status            VARCHAR(20)  NOT NULL DEFAULT 'pending', -- pending | completed | failed
  file_name         VARCHAR(255) NULL,
  file_size_bytes   BIGINT       NULL,
  error_message     TEXT         NULL,
  created_by        CHAR(36)     NULL, -- superadmin id; NULL for scheduled/system-triggered
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
  frequency    VARCHAR(20) NOT NULL DEFAULT 'daily', -- daily | weekly
  last_run_at  DATETIME    NULL,
  updated_by   CHAR(36)    NULL,
  updated_at   DATETIME    NOT NULL DEFAULT NOW() ON UPDATE NOW(),
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
);

SELECT 'Migration 003 complete' AS result;
