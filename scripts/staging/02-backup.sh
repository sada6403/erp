#!/usr/bin/env bash
# STEP 2 - Backups BEFORE any change: nginx config + mysqldump of every production database.
# Production is only READ (dump). Output: /root/backup-<timestamp>/
# Run:  ssh nfvps 'bash -s' < scripts/staging/02-backup.sh
set -euo pipefail
umask 077
TS="$(date +%Y%m%d-%H%M%S)"
DEST="/root/backup-$TS"
PROD_ENV=/var/www/pos-backend/backend/.env
mkdir -p "$DEST"

echo "[backup] nginx config -> $DEST/nginx.tgz"
tar czf "$DEST/nginx.tgz" /etc/nginx 2>/dev/null
echo "[backup] pm2 list -> $DEST/pm2-list.txt"
pm2 list > "$DEST/pm2-list.txt" 2>&1 || true
cp -a /usr/local/bin/pos-deploy "$DEST/pos-deploy.sh" 2>/dev/null || true

# MySQL credentials: use root via socket if it works, else the production app user from its .env (never printed).
CNF="$(mktemp)"; trap 'rm -f "$CNF"' EXIT
if mysql -uroot -e 'SELECT 1' >/dev/null 2>&1; then
  printf '[client]\nuser=root\n' > "$CNF"
else
  [ -f "$PROD_ENV" ] || { echo "No MySQL access: root socket failed and $PROD_ENV missing" >&2; exit 1; }
  get() { grep -E "^$1=" "$PROD_ENV" | tail -n1 | cut -d= -f2- | tr -d '\r"'"'"; }
  if [ -n "$(get DATABASE_URL)" ]; then
    u="$(get DATABASE_URL)"; rest="${u#*://}"; cred="${rest%%@*}"; hostpart="${rest#*@}"
    printf '[client]\nuser=%s\npassword=%s\nhost=%s\nport=%s\n' "${cred%%:*}" "${cred#*:}" "$(echo "${hostpart%%/*}" | cut -d: -f1)" "$(echo "${hostpart%%/*}" | grep -o ':[0-9]*$' | tr -d ':' || true)" > "$CNF"
  else
    printf '[client]\nuser=%s\npassword=%s\nhost=%s\nport=%s\n' "$(get MYSQL_USER)" "$(get MYSQL_PASSWORD)" "${MYSQL_HOST:-$(get MYSQL_HOST)}" "$(get MYSQL_PORT)" > "$CNF"
  fi
  sed -i '/^port=$/d;/^host=$/d' "$CNF"
fi

DBS="$(mysql --defaults-extra-file="$CNF" -N -e "SHOW DATABASES" | grep -Ev '^(information_schema|performance_schema|mysql|sys)$' | grep -v '^pos_stg' || true)"
[ -n "$DBS" ] || { echo "No production databases found - stopping." >&2; exit 1; }
echo "$DBS" > "$DEST/databases.txt"
for db in $DBS; do
  echo "[backup] mysqldump $db"
  mysqldump --defaults-extra-file="$CNF" --single-transaction --quick --routines --triggers --no-tablespaces "$db" | gzip > "$DEST/$db.sql.gz"
  [ "${PIPESTATUS[0]}" -eq 0 ] || { echo "dump FAILED for $db" >&2; exit 1; }
done
( cd "$DEST" && sha256sum ./*.gz ./*.tgz > SHA256SUMS )
echo; ls -lh "$DEST"; echo "$DEST" > /root/.last-staging-backup
echo "BACKUP DONE: $DEST   (restore-test it in STAGING_SETUP.md before trusting it)"
