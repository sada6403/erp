-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 006 — Grace period on api_key/company_key regeneration
-- Safe to run multiple times (INFORMATION_SCHEMA-guarded, same pattern as
-- migrate-002/003/004 — plain ADD COLUMN IF NOT EXISTS isn't reliable here).
-- ═══════════════════════════════════════════════════════════════════════════

USE pos_erp_saas;

SET @dbname = DATABASE();
SET @tablename = 'companies';

SET @sql = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = 'previous_api_key') > 0,
  'SELECT ''previous_api_key already exists''',
  'ALTER TABLE companies ADD COLUMN previous_api_key CHAR(36) NULL AFTER api_key'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = 'previous_api_key_expires_at') > 0,
  'SELECT ''previous_api_key_expires_at already exists''',
  'ALTER TABLE companies ADD COLUMN previous_api_key_expires_at DATETIME NULL AFTER previous_api_key'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = 'previous_company_key') > 0,
  'SELECT ''previous_company_key already exists''',
  'ALTER TABLE companies ADD COLUMN previous_company_key CHAR(36) NULL AFTER company_key'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = 'previous_company_key_expires_at') > 0,
  'SELECT ''previous_company_key_expires_at already exists''',
  'ALTER TABLE companies ADD COLUMN previous_company_key_expires_at DATETIME NULL AFTER previous_company_key'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT 'Migration 006 complete' AS result;
