-- Run via migrate-release-2.10.mjs after database backup.
CREATE TABLE IF NOT EXISTS product_batch_identities (
 id VARCHAR(191) PRIMARY KEY,product_id CHAR(36) NOT NULL,
 batch_no VARCHAR(191) COLLATE utf8mb4_bin NOT NULL,
 expiry_date VARCHAR(10) NOT NULL DEFAULT '',mfg_date VARCHAR(10) NULL,
 needs_review BOOLEAN NOT NULL DEFAULT 0,
 created_at DATETIME(3) NOT NULL,updated_at DATETIME(3) NOT NULL,
 UNIQUE KEY uq_physical_batch(product_id,batch_no,expiry_date),
 INDEX idx_batch_identity_updated(updated_at,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS user_password_reset_links (
 token_hash CHAR(64) PRIMARY KEY,user_id VARCHAR(191) NOT NULL,password_fingerprint CHAR(64) NOT NULL,
 expires_at DATETIME(3) NOT NULL,used_at DATETIME(3) NULL,created_at DATETIME(3) NOT NULL
);
