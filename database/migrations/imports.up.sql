CREATE TABLE IF NOT EXISTS import_jobs (
 id TEXT PRIMARY KEY, type TEXT NOT NULL, owner_id TEXT NOT NULL, branch_id TEXT NOT NULL,
 filename TEXT NOT NULL, file_hash TEXT NOT NULL, file_data BLOB,
 status TEXT NOT NULL DEFAULT 'uploaded', options_json TEXT NOT NULL DEFAULT '{}',
 mapping_json TEXT NOT NULL DEFAULT '{}', sheet_name TEXT, header_row INTEGER NOT NULL DEFAULT 0,
 encoding_label TEXT, warnings_json TEXT NOT NULL DEFAULT '[]', dedupe_key TEXT UNIQUE, review_token TEXT,
 total_rows INTEGER NOT NULL DEFAULT 0, valid_rows INTEGER NOT NULL DEFAULT 0,
 error_rows INTEGER NOT NULL DEFAULT 0, warning_rows INTEGER NOT NULL DEFAULT 0,
 applied_rows INTEGER NOT NULL DEFAULT 0, skipped_rows INTEGER NOT NULL DEFAULT 0,
 last_error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 committed_at TEXT, rolled_back_at TEXT, retained_until TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_import_jobs_owner ON import_jobs(owner_id,created_at);
CREATE INDEX IF NOT EXISTS idx_import_jobs_branch ON import_jobs(branch_id,created_at);
CREATE TABLE IF NOT EXISTS import_job_rows (
 id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES import_jobs(id) ON DELETE CASCADE,
 row_number INTEGER NOT NULL, raw_json TEXT NOT NULL, normalized_json TEXT,
 status TEXT NOT NULL DEFAULT 'staged', issues_json TEXT NOT NULL DEFAULT '[]',
 target_json TEXT, effects_json TEXT NOT NULL DEFAULT '[]', UNIQUE(job_id,row_number)
);
CREATE INDEX IF NOT EXISTS idx_import_rows_job ON import_job_rows(job_id,status,row_number);
CREATE TABLE IF NOT EXISTS import_mapping_templates (
 id TEXT PRIMARY KEY, type TEXT NOT NULL, name TEXT NOT NULL, owner_id TEXT NOT NULL,
 mapping_json TEXT NOT NULL, options_json TEXT NOT NULL, headers_json TEXT NOT NULL,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(owner_id,type,name)
);
