#!/usr/bin/env bash
# STEP 5 - Seed the TEST company (fake customers/agent/products, password Test@1234) into the STAGING database only.
# The seed script refuses to run unless MYSQL_HOST is local; staging .env points at the staging DB/user.
# Run:  ssh nfvps 'bash -s' < scripts/staging/05-seed.sh
set -euo pipefail
. /root/staging.env
cd "$STAGING_DIR/backend"
grep -q "^MYSQL_DATABASE=$STAGING_DB$" .env || { echo "backend/.env does not point at $STAGING_DB - refusing." >&2; exit 1; }
SEED_BASE_URL="http://127.0.0.1:$STAGING_PORT" npm run seed:app
echo
echo "App Key + logins are in $STAGING_DIR/backend/.seed-output.json (VPS only, gitignored)."
echo "Show the APP KEY only:  ssh nfvps \"node -p \\\"require('$STAGING_DIR/backend/.seed-output.json').app_key\\\"\""
