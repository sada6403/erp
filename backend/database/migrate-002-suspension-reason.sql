-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 002 — Add suspension reason tracking to companies
-- Run this if your database was created BEFORE this migration was added.
-- Safe to run multiple times (checks INFORMATION_SCHEMA before altering —
-- some MySQL builds reject "ADD COLUMN IF NOT EXISTS" outright).
-- ═══════════════════════════════════════════════════════════════════════════

USE pos_erp_saas;

SET @dbname = DATABASE();
SET @tablename = 'companies';

SET @sql = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = 'suspension_reason') > 0,
  'SELECT ''suspension_reason already exists''',
  'ALTER TABLE companies ADD COLUMN suspension_reason TEXT NULL AFTER status'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = 'suspended_at') > 0,
  'SELECT ''suspended_at already exists''',
  'ALTER TABLE companies ADD COLUMN suspended_at DATETIME NULL AFTER suspension_reason'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = 'suspended_by') > 0,
  'SELECT ''suspended_by already exists''',
  'ALTER TABLE companies ADD COLUMN suspended_by CHAR(36) NULL AFTER suspended_at'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT 'Migration 002 complete' AS result;
