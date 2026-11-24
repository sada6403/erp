-- Applied by backup-first releaseMigration.ts; guarded ALTERs are in that runner.
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_login_id_ci ON users(LOWER(TRIM(login_id))) WHERE login_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email_ci ON users(LOWER(TRIM(email)));
CREATE TABLE IF NOT EXISTS product_batch_identities (
 id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id),
 batch_no TEXT NOT NULL, expiry_date TEXT NOT NULL DEFAULT '',mfg_date TEXT,
 needs_review INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
 UNIQUE(product_id,batch_no,expiry_date)
);
CREATE TABLE IF NOT EXISTS user_password_reset_links (
 token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),
 expires_at TEXT NOT NULL,used_at TEXT,created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS release_migration_receipts (
 version TEXT PRIMARY KEY,backup_path TEXT NOT NULL,applied_at TEXT NOT NULL
);
