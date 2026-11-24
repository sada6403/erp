---
name: erp-schema-change
description: Add a table or column to the ERP cloud tenant DB (MySQL) and, when the POS desktop needs it, to the desktop SQLite DB and the sync allowlist. Additive-only rules. Use for any DB change.
---

# ERP schema change

The ERP is multi-tenant: one MySQL database per company, plus the POS desktop's local SQLite that
syncs with it. A wrong change breaks sync for every branch, so follow this exactly.

## Decide first
- **Cloud-only** (app auth, wishlist, devices, notifications, reservations): steps 1 and 4.
- **Synced** (POS admin reads/writes it: join requests, banners, draw video metadata, app settings,
  new columns on existing synced tables): steps 1–4.

## Steps
1. **Cloud (MySQL):** add the statement to `ensureTenantCompatibility()` in `backend/lib/auth.ts`.
   Do NOT edit the frozen `TENANT_SCHEMA_SQL` in `backend/lib/tenant.ts`.
   - `CREATE TABLE IF NOT EXISTS …` with `id VARCHAR(191) PRIMARY KEY`, `created_at`, and
     `updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP` + an index on
     `updated_at` (sync pulls by it).
   - New column: `ALTER TABLE … ADD COLUMN …` with a DEFAULT or NULL, wrapped so "Duplicate column name"
     is ignored (same pattern as `ensureSyncSchema`).
   - Never DROP, RENAME, or change a column type. Never add NOT NULL without a default.
2. **Sync allowlist:** add the table to `ALLOWED_TABLES` in `backend/lib/sync.ts`. If its rows hang
   off a parent (e.g. `draw_proof_videos.scheme_id`), add it to `RELATED_KEYS`; if it has FK parents
   the desktop enforces, add them to `REQUIRED_SYNC_PARENTS`.
3. **Desktop (SQLite):** in `electron/database.ts` add `CREATE TABLE IF NOT EXISTS` (TEXT ids,
   `datetime('now')` defaults, `synced_at TEXT`) or a guarded `ALTER TABLE` using the existing
   `hasColumn()` check. Add the table to the desktop pull list in `electron/services/syncService.ts`
   and enqueue writes with `enqueuSync(table, id, op, row)`.
4. **Verify:** `npm run typecheck` in `backend/` and at the repo root; run the backend against a test
   tenant and confirm the table exists; for synced tables, create a row on the desktop and see it in
   the cloud, then the reverse.

## Never
- Run a migration or backfill against a real company DB without Moni's go-ahead in chat.
- Reuse a table name that exists in the desktop DB with a different meaning.
- Store secrets (tokens, passwords, keys) in a synced table.
