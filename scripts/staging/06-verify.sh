#!/usr/bin/env bash
# STEP 6 - Verify staging end to end: status, every seeded login, catalog, an order, HTTPS.
# Run:  ssh nfvps 'bash -s' < scripts/staging/06-verify.sh      (exit code 0 = all passed)
set -uo pipefail
. /root/staging.env
SEED="$STAGING_DIR/backend/.seed-output.json"
BASE="https://$STAGING_HOST/api/app/v1"
FAIL=0
ok()  { printf '  PASS  %s\n' "$1"; }
bad() { printf '  FAIL  %s\n' "$1"; FAIL=1; }
KEY="$(node -p "require('$SEED').app_key")"
PW="$(node -p "require('$SEED').password")"
call() { curl -s -m 20 -w '\n%{http_code}' -H "x-app-key: $KEY" -H 'content-type: application/json' "$@"; }

echo "[1] HTTPS + status"
out="$(call "$BASE/status")"; code="${out##*$'\n'}"; [ "$code" = 200 ] && ok "GET /status 200" || bad "GET /status -> $code"
out="$(curl -s -m 20 -o /dev/null -w '%{http_code}' -H 'x-app-key: npk_wrong' "$BASE/status")"; [ "$out" = 401 ] && ok "wrong App Key -> 401" || bad "wrong App Key -> $out"

echo "[2] Login for every seeded role"
TOKENS="$(mktemp)"; trap 'rm -f "$TOKENS"' EXIT
for who in $(node -p "Object.entries(require('$SEED').logins).filter(([k,v])=>v.identifier&&(v.password||k==='first_login_invite')).map(([k])=>k).join(' ')"); do
  id="$(node -p "require('$SEED').logins['$who'].identifier")"
  pw="$(node -p "require('$SEED').logins['$who'].password||require('$SEED').logins['$who'].temp_password||''")"
  [ -n "$pw" ] || { ok "$who skipped (no password in seed)"; continue; }
  out="$(call -X POST "$BASE/auth/login" -d "{\"identifier\":\"$id\",\"password\":\"$pw\"}")"; code="${out##*$'\n'}"
  if [ "$code" = 200 ]; then ok "login $who ($id)"; echo "$who $(echo "${out%$'\n'*}" | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).tokens.access_token')" >> "$TOKENS"
  else bad "login $who ($id) -> $code"; fi
done
out="$(call -X POST "$BASE/auth/login" -d '{"identifier":"0771110001","password":"definitely-wrong"}')"; [ "${out##*$'\n'}" = 401 ] && ok "wrong password -> 401" || bad "wrong password not rejected"

echo "[3] Catalog + order as the Smart Buy customer"
TOK="$(awk '$1=="customer_smartbuy"{print $2}' "$TOKENS")"
if [ -n "$TOK" ]; then
  out="$(call -H "authorization: Bearer $TOK" "$BASE/catalog/products?limit=5")"; [ "${out##*$'\n'}" = 200 ] && ok "catalog products 200" || bad "catalog -> ${out##*$'\n'}"
  out="$(call -H "authorization: Bearer $TOK" "$BASE/orders")"; [ "${out##*$'\n'}" = 200 ] && ok "orders list 200" || bad "orders -> ${out##*$'\n'}"
else bad "no customer token"; fi

echo "[4] Production untouched"
pm2 describe pos-backend >/dev/null 2>&1 && ok "pm2 pos-backend still present" || bad "pm2 pos-backend missing!"
curl -s -m 10 -o /dev/null -w '%{http_code}' http://127.0.0.1:4001/api/health | grep -qE '^(200|401)$' && ok "production :4001 responds" || bad "production :4001 not responding"

echo
echo "MANUAL (needs a human): place an order in the staging APK, then in a POS pointed at"
echo "  https://$STAGING_HOST  (Settings > cloud sync, POS api key from $SEED) confirm it shows with the app-order badge."
[ $FAIL = 0 ] && echo "VERIFY: ALL AUTOMATED CHECKS PASSED" || { echo "VERIFY: FAILURES ABOVE"; exit 1; }
