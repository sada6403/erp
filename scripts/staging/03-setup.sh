#!/usr/bin/env bash
# STEP 3 - Create the isolated STAGING backend: own folder, own pm2 process, own port, own MySQL DB + user.
# Never touches /var/www/pos-backend, the pos-backend pm2 process, production databases or existing nginx sites.
# Run:  ssh nfvps 'STAGING_BRANCH=feature/mobile-app-foundation bash -s' < scripts/staging/03-setup.sh
set -euo pipefail
umask 077
BRANCH="${STAGING_BRANCH:-feature/mobile-app-foundation}"
APP_DIR=/var/www/pos-staging
UPLOADS=/var/www/pos-staging-uploads
STATE=/root/staging.env
PROD_DIR=/var/www/pos-backend
STG_DB=pos_stg_saas
STG_USER=pos_stg
HOST_NAME="${STAGING_HOST:-staging-api.72-61-115-222.sslip.io}"

[ -d "$APP_DIR" ] && { echo "$APP_DIR already exists. Run 99-rollback.sh first, or update it with: git -C $APP_DIR pull" >&2; exit 1; }
[ -f "$STATE" ] && { echo "$STATE already exists - staging was set up before. Run 99-rollback.sh first." >&2; exit 1; }

# ---- free port (never 3000/4001) ----
PORT="${STAGING_PORT:-}"
if [ -z "$PORT" ]; then for p in $(seq 4101 4110); do ss -ltn | grep -q ":$p " || { PORT=$p; break; }; done; fi
[ -n "$PORT" ] || { echo "No free port in 4101-4110" >&2; exit 1; }
ss -ltn | grep -q ":$PORT " && { echo "Port $PORT is in use" >&2; exit 1; }
echo "[setup] staging port: $PORT   host: $HOST_NAME   branch: $BRANCH"

# ---- MySQL: staging DB + user limited to staging schemas only ----
if mysql -uroot -e 'SELECT 1' >/dev/null 2>&1; then MYSQL_ADMIN=(mysql -uroot)
else echo "root MySQL socket login failed. Create the staging DB/user manually (see STAGING_SETUP.md, 'Manual MySQL')." >&2; exit 1; fi
DB_PASS="$(openssl rand -hex 24)"
"${MYSQL_ADMIN[@]}" <<SQL
CREATE DATABASE IF NOT EXISTS \`$STG_DB\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '$STG_USER'@'localhost' IDENTIFIED BY '$DB_PASS';
ALTER USER '$STG_USER'@'localhost' IDENTIFIED BY '$DB_PASS';
GRANT ALL PRIVILEGES ON \`$STG_DB\`.* TO '$STG_USER'@'localhost';
-- tenant schemas created by the seed are named pos_erp_app_test_company_<ts>; production tenants never match this pattern
GRANT ALL PRIVILEGES ON \`pos\_erp\_app\_test\_company\_%\`.* TO '$STG_USER'@'localhost';
FLUSH PRIVILEGES;
SQL
echo "[setup] MySQL ready: $STG_DB / user $STG_USER (password in $STATE only)"

# ---- code: clone the branch (reuse production's git remote; URL is not printed) ----
ORIGIN="$(git -C "$PROD_DIR" remote get-url origin)"
git clone --quiet --branch "$BRANCH" --single-branch "$ORIGIN" "$APP_DIR"
git -C "$APP_DIR" log -1 --format='[setup] checked out %h %s'
mkdir -p "$UPLOADS"

# ---- backend/.env (separate secrets; push + WhatsApp OFF) ----
cat > "$APP_DIR/backend/.env" <<ENV
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=$STG_USER
MYSQL_PASSWORD=$DB_PASS
MYSQL_DATABASE=$STG_DB
CLOUD_API_KEY=$(openssl rand -hex 32)
JWT_SECRET=$(openssl rand -hex 64)
JWT_REFRESH_SECRET=$(openssl rand -hex 64)
CRON_SECRET=$(openssl rand -hex 24)
UPLOAD_DIR=$UPLOADS
PUBLIC_BASE_URL=https://$HOST_NAME
MAX_UPLOAD_BYTES=10485760
APP_PUSH_ENABLED=false
WHATSAPP_CLOUD_API_ENABLED=false
NODE_ENV=production
ENV
chmod 600 "$APP_DIR/backend/.env"

cat > "$STATE" <<ST
STAGING_PORT=$PORT
STAGING_HOST=$HOST_NAME
STAGING_DIR=$APP_DIR
STAGING_UPLOADS=$UPLOADS
STAGING_DB=$STG_DB
STAGING_DB_USER=$STG_USER
STAGING_DB_PASS=$DB_PASS
ST
chmod 600 "$STATE"

# ---- build + start (low priority so production stays responsive) ----
cd "$APP_DIR/backend"
echo "[setup] npm ci"; nice -n 10 npm ci --no-audit --no-fund
echo "[setup] next build"; nice -n 10 npm run build
PORT="$PORT" pm2 start "npm start" --name pos-staging --cwd "$APP_DIR/backend" --max-memory-restart 700M
pm2 save >/dev/null
sleep 6
echo "[setup] local check:"; curl -s -o /dev/null -w 'GET /api/health -> HTTP %{http_code}\n' "http://127.0.0.1:$PORT/api/health"
echo "SETUP DONE. Next: 04-nginx.sh"
