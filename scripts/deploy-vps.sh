#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/pos-backend}"
BACKEND_DIR="$APP_DIR/backend"
SUPERADMIN_DIR="$APP_DIR/portals/superadmin"
DESKTOP_RELEASE_DIR="/tmp/pos-desktop-release"

if [[ -f "$DESKTOP_RELEASE_DIR/.publish-request" ]]; then
  metadata_file="$DESKTOP_RELEASE_DIR/latest.yml"
  [[ -f "$metadata_file" ]] || {
    echo "[deploy] desktop release metadata is missing" >&2
    exit 1
  }

  release_version="$(sed -nE 's/^version:[[:space:]]*([^[:space:]]+).*/\1/p' "$metadata_file" | head -n 1)"
  [[ -n "$release_version" ]] || {
    echo "[deploy] desktop release version is missing" >&2
    exit 1
  }

  echo "[deploy] publishing desktop release $release_version"
  bash "$APP_DIR/scripts/publish-vps-release.sh" "$DESKTOP_RELEASE_DIR" "$release_version"

  installer="Enterprise POS ERP Setup $release_version.exe"
  rm -f -- "$DESKTOP_RELEASE_DIR/.publish-request" "$metadata_file" "$DESKTOP_RELEASE_DIR/$installer"
  rmdir "$DESKTOP_RELEASE_DIR" 2>/dev/null || true
  exit 0
fi

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
  if [ -f "$SUPERADMIN_DIR/.env" ]; then
    sed -i '/VITE_API_URL=http:\/\//d' "$SUPERADMIN_DIR/.env" || true
  fi
  VITE_API_URL="" npm run build

  echo "[deploy] restarting superadmin"
  pm2 delete pos-superadmin >/dev/null 2>&1 || true
  pm2 serve dist 4174 --spa --name pos-superadmin
fi

pm2 save

echo "[deploy] checking listening ports and nginx configs"
grep -rn "proxy_pass" /etc/nginx/ 2>/dev/null || true
ss -tulpn 2>/dev/null | grep -E "node|next|3000|4001|4174" || true

echo "[deploy] checking pos-backend status & logs"
sleep 4
pm2 status pos-backend || true
pm2 logs pos-backend --lines 40 --nostream || true

echo "[deploy] local health check"
curl -is http://127.0.0.1:3000/api/health || true
curl -is http://127.0.0.1:4001/api/health || true

echo "[deploy] done"
