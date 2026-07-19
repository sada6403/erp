#!/usr/bin/env bash
# Deployed on the VPS at /usr/local/bin/pos-backup-mysql.sh, run daily via
# root's crontab (30 21 * * *  = 21:30 UTC, ~3am Asia/Colombo).
# Restore with: gunzip -c <file>.sql.gz | mysql -uroot pos_erp_saas
set -euo pipefail

DB_NAME="pos_erp_saas"
BACKUP_DIR="/var/backups/pos-erp-mysql"
RETENTION_DAYS=14
TIMESTAMP=$(date +%Y-%m-%d_%H%M%S)
OUT_FILE="$BACKUP_DIR/${DB_NAME}_${TIMESTAMP}.sql.gz"
LOG_FILE="$BACKUP_DIR/backup.log"

mkdir -p "$BACKUP_DIR"

{
  echo "[$(date -Is)] Starting backup of $DB_NAME"
  if mysqldump -uroot --single-transaction --routines --triggers --quick "$DB_NAME" | gzip > "$OUT_FILE"; then
    SIZE=$(du -h "$OUT_FILE" | cut -f1)
    echo "[$(date -Is)] OK: $OUT_FILE ($SIZE)"
  else
    echo "[$(date -Is)] FAILED: mysqldump exited non-zero"
    rm -f "$OUT_FILE"
    exit 1
  fi

  find "$BACKUP_DIR" -name "${DB_NAME}_*.sql.gz" -mtime +"$RETENTION_DAYS" -print -delete | sed "s/^/[$(date -Is)] pruned: /"
} >> "$LOG_FILE" 2>&1
