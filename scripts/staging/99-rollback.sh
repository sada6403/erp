#!/usr/bin/env bash
# ROLLBACK - removes ONLY staging: pm2 pos-staging, nginx staging block, staging DBs + user, /var/www/pos-staging(+uploads).
# Never touches pos-backend, production DBs, other nginx sites, pos-deploy. Backups in /root/backup-* are kept.
# Run:  ssh nfvps 'CONFIRM=yes bash -s' < scripts/staging/99-rollback.sh
set -uo pipefail
[ "${CONFIRM:-}" = yes ] || { echo "Dry run. Re-run with CONFIRM=yes to remove staging."; exit 0; }
[ -f /root/staging.env ] && . /root/staging.env
echo "[rollback] pm2"; pm2 delete pos-staging 2>/dev/null; pm2 save >/dev/null 2>&1
echo "[rollback] nginx"
rm -f /etc/nginx/sites-enabled/pos-staging /etc/nginx/sites-available/pos-staging
if nginx -t; then systemctl reload nginx; else echo "nginx -t FAILED after removing the staging block - check manually, do NOT reload blindly" >&2; fi
[ -n "${STAGING_HOST:-}" ] && certbot delete --cert-name "$STAGING_HOST" --non-interactive 2>/dev/null
echo "[rollback] MySQL (staging schemas only)"
if mysql -uroot -e 'SELECT 1' >/dev/null 2>&1; then
  mysql -uroot -N -e "SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='pos_stg_saas' OR SCHEMA_NAME LIKE 'pos\_erp\_app\_test\_company\_%'" | while read -r s; do
    echo "  drop $s"; mysql -uroot -e "DROP DATABASE \`$s\`"
  done
  mysql -uroot -e "DROP USER IF EXISTS 'pos_stg'@'localhost'"
fi
echo "[rollback] files"; rm -rf /var/www/pos-staging /var/www/pos-staging-uploads /root/staging.env
echo "ROLLBACK DONE. Production was not touched. Verify: pm2 list; curl -I http://127.0.0.1:4001/api/health"
