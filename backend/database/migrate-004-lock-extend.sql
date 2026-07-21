-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 004 — Company Lock (admin-config freeze, distinct from suspend)
-- Safe to run multiple times (checks INFORMATION_SCHEMA before altering —
-- some MySQL builds reject "ADD COLUMN IF NOT EXISTS" outright).
-- ═══════════════════════════════════════════════════════════════════════════

USE pos_erp_saas;

SET @dbname = DATABASE();
SET @tablename = 'companies';

SET @sql = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = 'admin_locked') > 0,
  'SELECT ''admin_locked already exists''',
  'ALTER TABLE companies ADD COLUMN admin_locked BOOLEAN NOT NULL DEFAULT 0 AFTER status'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = 'lock_reason') > 0,
  'SELECT ''lock_reason already exists''',
  'ALTER TABLE companies ADD COLUMN lock_reason TEXT NULL AFTER admin_locked'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = 'locked_at') > 0,
  'SELECT ''locked_at already exists''',
  'ALTER TABLE companies ADD COLUMN locked_at DATETIME NULL AFTER lock_reason'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = 'locked_by') > 0,
  'SELECT ''locked_by already exists''',
  'ALTER TABLE companies ADD COLUMN locked_by CHAR(36) NULL AFTER locked_at'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT 'Migration 004 complete' AS result;
