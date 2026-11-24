#!/usr/bin/env bash
# STEP 4 - HTTPS for staging with no DNS work: <name>.72-61-115-222.sslip.io -> 72.61.115.222.
# Adds ONE new nginx server block (a new file). Existing sites are not edited. If nginx -t fails, the new file is removed and nothing is reloaded.
# Run:  ssh nfvps 'CERTBOT_EMAIL=you@example.com bash -s' < scripts/staging/04-nginx.sh
#       Fallback if Let's Encrypt rate-limits sslip.io:  STAGING_HOST_OVERRIDE=staging-api.72.61.115.222.nip.io
set -euo pipefail
. /root/staging.env
HOST_NAME="${STAGING_HOST_OVERRIDE:-$STAGING_HOST}"
[ -n "${CERTBOT_EMAIL:-}" ] || { echo "Set CERTBOT_EMAIL=<your email>" >&2; exit 1; }
CONF=/etc/nginx/sites-available/pos-staging
LINK=/etc/nginx/sites-enabled/pos-staging
[ -e "$CONF" ] && { echo "$CONF already exists. Run 99-rollback.sh first." >&2; exit 1; }

cat > "$CONF" <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name $HOST_NAME;
    client_max_body_size 12m;
    location / {
        proxy_pass http://127.0.0.1:$STAGING_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 60s;
    }
}
NGINX
ln -s "$CONF" "$LINK"
if ! nginx -t; then rm -f "$LINK" "$CONF"; echo "nginx -t FAILED - removed the new block, nothing reloaded." >&2; exit 1; fi
systemctl reload nginx
echo "[nginx] http block live; requesting certificate for $HOST_NAME"
if ! certbot --nginx -d "$HOST_NAME" --non-interactive --agree-tos -m "$CERTBOT_EMAIL" --redirect; then
  echo "certbot failed (rate limit or DNS). Block stays on HTTP only. Try the nip.io fallback or run 99-rollback.sh." >&2; exit 1
fi
nginx -t && systemctl reload nginx
sed -i "s#^STAGING_HOST=.*#STAGING_HOST=$HOST_NAME#" /root/staging.env
sed -i "s#^PUBLIC_BASE_URL=.*#PUBLIC_BASE_URL=https://$HOST_NAME#" "$STAGING_DIR/backend/.env"
pm2 restart pos-staging --update-env >/dev/null
echo "NGINX DONE: https://$HOST_NAME"
curl -s -o /dev/null -w 'GET https://'"$HOST_NAME"'/api/health -> HTTP %{http_code}\n' "https://$HOST_NAME/api/health" || true
