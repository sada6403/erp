#!/usr/bin/env bash
# STEP 7 - READ-ONLY copy of ONE production company ("test", slug test-1) into STAGING.
# Production is only read (mysqldump --single-transaction, one SELECT). Nothing is moved, changed or deleted there.
# Writes go only to: new schema pos_erp_app_test_company_testcopy, and one row in pos_stg_saas.companies.
# Fresh api_key / company_key / app_key are generated; no production secret or password hash is copied.
# Run:  ssh nfvps 'bash -s' < scripts/staging/07-copy-test-company.sh
set -euo pipefail
umask 077
. /root/staging.env
SRC_ID=3e1d228c-4f62-4412-b70a-77c75f66a3c7
SRC_DB=pos_erp_test_1_mvbn545i
DST_DB=pos_erp_app_test_company_testcopy
NEW_ID=$(cat /proc/sys/kernel/random/uuid)
STG=(mysql -u"$STAGING_DB_USER" -p"$STAGING_DB_PASS")
[ "$(mysql -uroot -N -e "SELECT db_schema FROM pos_erp_saas.companies WHERE id='$SRC_ID'")" = "$SRC_DB" ] || { echo "source company/schema mismatch - refusing" >&2; exit 1; }
HAVE_ROW=$(mysql -uroot -N -e "SELECT COUNT(*) FROM pos_stg_saas.companies WHERE db_schema='$DST_DB'")
[ "$HAVE_ROW" = "0" ] || { echo "staging company for $DST_DB already exists - refusing" >&2; exit 1; }
HAVE_DB=$(mysql -uroot -N -e "SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name='$DST_DB'")

mkdir -p /root/staging-copy
if [ "$HAVE_DB" = "0" ]; then
echo "[copy] mysqldump $SRC_DB (read-only)"
mysqldump -uroot --single-transaction --no-tablespaces --skip-add-drop-table "$SRC_DB" | gzip > /root/staging-copy/test-tenant.sql.gz
echo "[copy] create $DST_DB and import"
mysql -uroot -e "CREATE DATABASE \`$DST_DB\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
"${STG[@]}" -e "SELECT 1" "$DST_DB" >/dev/null   # staging user must be able to use it (pattern grant)
zcat /root/staging-copy/test-tenant.sql.gz | "${STG[@]}" "$DST_DB"
else echo "[copy] $DST_DB already imported - resuming at master row"; fi

echo "[copy] master company row -> staging"
COLS=$(mysql -uroot -N -e "SELECT GROUP_CONCAT(CONCAT('\`',column_name,'\`')) FROM information_schema.columns WHERE table_schema='pos_erp_saas' AND table_name='companies' AND column_name NOT IN ('id','db_schema','api_key','previous_api_key','previous_api_key_expires_at','company_key','previous_company_key','previous_company_key_expires_at','clear_data_password_hash','initial_admin_password','clear_data_attempts','clear_data_locked_until','status','admin_locked','lock_reason','locked_at','locked_by','suspension_reason','suspended_at','suspended_by','trial_ends_at','max_branches','max_users','max_pos_devices','max_storage_gb')")
mysql -uroot -e "INSERT INTO pos_stg_saas.companies (id, db_schema, api_key, company_key, status, trial_ends_at, max_branches, max_users, max_pos_devices, max_storage_gb, app_key, $COLS)
 SELECT '$NEW_ID', '$DST_DB', UUID(), UUID(), 'active', DATE_ADD(NOW(), INTERVAL 365 DAY), 5, 50, 20, 5, CONCAT('npk_', LOWER(HEX(RANDOM_BYTES(16)))), $COLS
 FROM pos_erp_saas.companies WHERE id='$SRC_ID'"
echo "STAGING_TEST_COMPANY_ID=$NEW_ID" > /root/staging-copy/ids.env
echo "[copy] done: staging company $NEW_ID -> $DST_DB   (next: ensureTenantCompatibility + logins via staging-copy-finish.ts)"
