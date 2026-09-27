#!/usr/bin/env bash
# Backs up the control database and every tenant database. Run before deploys
# and from root's daily cron (30 21 * * * = 21:30 UTC, ~3am Asia/Colombo).
# Restore with: gunzip -c <file>.sql.gz | mysql -uroot
set -euo pipefail

BACKUP_PREFIX="pos_erp_all"
BACKUP_DIR="/var/backups/pos-erp-mysql"
RETENTION_DAYS=14
TIMESTAMP=$(date +%Y-%m-%d_%H%M%S)
OUT_FILE="$BACKUP_DIR/${BACKUP_PREFIX}_${TIMESTAMP}.sql.gz"
LOG_FILE="$BACKUP_DIR/backup.log"

mkdir -p "$BACKUP_DIR"

{
  mapfile -t DATABASES < <(mysql -uroot -Nse "SHOW DATABASES" | awk '/^pos_erp_/')
  if [ "${#DATABASES[@]}" -eq 0 ]; then
    echo "[$(date -Is)] FAILED: no pos_erp_* databases found"
    exit 1
  fi

  echo "[$(date -Is)] Starting backup of ${#DATABASES[@]} POS database(s): ${DATABASES[*]}"
  if mysqldump -uroot --single-transaction --routines --triggers --quick --databases "${DATABASES[@]}" | gzip > "$OUT_FILE"; then
    SIZE=$(du -h "$OUT_FILE" | cut -f1)
    echo "[$(date -Is)] OK: $OUT_FILE ($SIZE)"
  else
    echo "[$(date -Is)] FAILED: mysqldump exited non-zero"
    rm -f "$OUT_FILE"
    exit 1
  fi

  find "$BACKUP_DIR" -name "${BACKUP_PREFIX}_*.sql.gz" -mtime +"$RETENTION_DAYS" -print -delete | sed "s/^/[$(date -Is)] pruned: /"
} >> "$LOG_FILE" 2>&1
