-- Non-destructive rollback: retain additive columns, IDs, reset/audit/batch data.
-- Deploy 2.9.x only after backup and compatibility checks; new IDs stop being used.
DROP INDEX IF EXISTS uq_users_login_id_ci;
DROP INDEX IF EXISTS uq_users_email_ci;
DELETE FROM release_migration_receipts WHERE version='2.10.0';
-- Never delete cost layers, quantities, password hashes or generated User IDs.
