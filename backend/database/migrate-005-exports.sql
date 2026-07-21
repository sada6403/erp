-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 005 — Export Center
-- Metadata for per-company data exports (CSV/JSON/Excel/PDF/SQL). Export
-- files themselves live on disk (EXPORT_STORAGE_DIR), not in this DB.
-- Safe to run multiple times (CREATE TABLE IF NOT EXISTS).
-- ═══════════════════════════════════════════════════════════════════════════

USE pos_erp_saas;

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

SELECT 'Migration 005 complete' AS result;
