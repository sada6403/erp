#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/pos-backend}"
BACKEND_DIR="$APP_DIR/backend"
SUPERADMIN_DIR="$APP_DIR/portals/superadmin"

echo "[deploy] app dir: $APP_DIR"
cd "$APP_DIR"

echo "[deploy] fetching latest main"
git fetch origin main
git reset --hard origin/main

echo "[deploy] installing backend dependencies"
cd "$BACKEND_DIR"
npm ci

echo "[deploy] building backend"
npm run build

echo "[deploy] restarting backend"
pm2 restart pos-backend --update-env || pm2 start "npm start" --name pos-backend --cwd "$BACKEND_DIR"

if [ -d "$SUPERADMIN_DIR" ]; then
  echo "[deploy] installing superadmin dependencies"
  cd "$SUPERADMIN_DIR"
  npm ci

  echo "[deploy] building superadmin"
  npm run build

  echo "[deploy] restarting superadmin"
  pm2 delete pos-superadmin >/dev/null 2>&1 || true
  pm2 serve dist 4174 --spa --name pos-superadmin
fi

pm2 save

echo "[deploy] done"
