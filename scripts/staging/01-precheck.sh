#!/usr/bin/env bash
# STEP 1 - READ-ONLY pre-checks on the VPS. Changes nothing.
# Run from your PC:  ssh nfvps 'bash -s' < scripts/staging/01-precheck.sh
set -uo pipefail
hr() { printf '\n== %s ==\n' "$1"; }

hr "OS / uptime";            . /etc/os-release 2>/dev/null; echo "${PRETTY_NAME:-unknown}"; uptime
hr "Disk (need >= 5 GB free)"; df -h / /var 2>/dev/null
hr "RAM / swap (need >= 1 GB available)"; free -h
hr "Node / npm / pm2 / docker / git"
for c in node npm pm2 docker git nginx certbot mysql mysqldump; do
  if command -v "$c" >/dev/null 2>&1; then printf '%-10s %s\n' "$c" "$("$c" --version 2>&1 | head -n1)"; else printf '%-10s MISSING\n' "$c"; fi
done
hr "pm2 processes";          pm2 list 2>/dev/null || echo "pm2 not available"
hr "Listening ports";        ss -tulpn 2>/dev/null | grep -E 'LISTEN' | awk '{print $1, $5, $7}'
hr "Free staging port candidates (4101-4110)"
for p in $(seq 4101 4110); do ss -ltn 2>/dev/null | grep -q ":$p " || echo "free: $p"; done
hr "nginx sites (names only)"; ls -1 /etc/nginx/sites-enabled /etc/nginx/conf.d 2>/dev/null
hr "nginx test";             nginx -t 2>&1
hr "How production runs"
ls -ld /var/www/pos-backend /var/www/pos-staging /var/www/updates /var/www/html/updates 2>&1
git -C /var/www/pos-backend log -1 --format='prod commit: %h %s (%cd)' 2>&1
echo "prod .env present: $([ -f /var/www/pos-backend/backend/.env ] && echo yes || echo NO)   (contents NOT printed)"
hr "MySQL"
systemctl is-active mysql mariadb 2>/dev/null | head -n2
if mysql -uroot -e 'SELECT VERSION()' >/dev/null 2>&1; then echo "root via socket: OK"; else echo "root via socket: NO (03-setup will use production DB admin credentials from the prod .env)"; fi
hr "Timezone (app order times were off by 5h30 on a local DB whose MySQL zone was not UTC; the API reads DB times as UTC)"
timedatectl 2>/dev/null | grep -E 'Time zone|Local time' || date
mysql -uroot -N -e "SELECT CONCAT('mysql global=', @@global.time_zone, ' system=', @@system_time_zone, ' NOW=', NOW(), ' UTC=', UTC_TIMESTAMP())" 2>/dev/null || echo "mysql time zone: could not read as root"
hr "Existing backups";       ls -1d /root/backup-* 2>/dev/null || echo "none"
hr "Certbot certs";          certbot certificates 2>/dev/null | grep -E 'Certificate Name|Domains|Expiry' || echo "none / certbot missing"
echo; echo "PRECHECK DONE (nothing was changed)"
