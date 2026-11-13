# Production runbook — Natural Plantation app v1.0

**PLAN ONLY. Nothing here has been run.** Every step that touches production needs Moni's explicit
go-ahead in chat first (HANDOFF §6). Target: v1.0 live on Play by **21 Nov 2026** (submit by 19 Nov).
Each step lists what to do, how to check it worked, and how to undo it.

Owners: **Moni** = approvals, Play Console, passwords. **Claude** = scripts, builds, checks.
**Sabiharan** = the other developer who releases POS v2.9.x from `main` and owns the VPS root access.

## Order at a glance
| # | Step | Touches production? |
|---|---|---|
| 0 | Preconditions (staging green, key check, Firebase, reviewer text) | No |
| 1 | Backup + restore test | Read only |
| 2 | Merge plan with the main developer | `main` |
| 3 | Backend deploy | Yes |
| 4 | Real-company App Key + one-time product re-push | Yes (data) |
| 5 | Reviewer accounts | Yes (data) |
| 6 | POS desktop release to branch PCs | Yes |
| 7 | Production AAB via EAS (Play upload key) | No (build) |
| 8 | Play Internal testing | Play |
| 9 | Play Production | Play |
| 10 | Watch + OTA fixes | — |

Rule: backend first, then POS desktop, then the app goes live. New cloud columns migrate on the first API
hit, and the app needs them before any app order can reach a POS.

## 0. Preconditions (all must be true)
- Staging (`STAGING_SETUP.md`) passed `06-verify.sh` and a staging APK was tried on a real phone for every role.
- Upload-key check: Moni pastes the Play "Upload key certificate" SHA-1/SHA-256 and the local
  `keytool -list -v -keystore C:\secure\nf-keys\nf-release-key.jks -alias nf-farming` output (Moni types the
  password, Claude never sees it). MATCH -> go on. NO MATCH -> request an upload-key reset in Play Console
  (Setup > App signing > Request upload key reset), wait for Google, then re-check.
- Keystore stored in EAS (`eas credentials`, Moni types passwords); then delete the WhatsApp copy of the keystore.
- Firebase project exists, `google-services.json` for package `nfgroups.naturefarming.app` is in place.
- Play Console: trader status declaration done; Data safety, financial-features declaration, privacy and
  account-deletion URLs filled in from `docs/play/`; "App access" text from `docs/play/APP_ACCESS.md` pasted.
- Production access: if Play requires a closed test (>= 12 testers for 14 days) the 21 Nov date is not reachable; tell Moni immediately.
- All branches green: `npm test` in `backend/`, `npm run typecheck`, mobile `npm test` + `npx tsc --noEmit` + `npx eslint .`.
- Branch is rebased on the current `origin/main` and the CI run on the branch has no conflicts in
  `electron/ipc/invoices.ts`, `orders.ts`, `electron/preload.ts`, `electron/database.ts`.

## 1. Backup + restore test (do this first, every time)
Run `scripts/staging/02-backup.sh` (read-only dumps into `/root/backup-<ts>/`).
- **Check:** `SHA256SUMS` present, one `.sql.gz` per production database, restore-test one into a scratch DB
  (command in `STAGING_SETUP.md` step 2), table count > 0.
- **Rollback:** nothing changed; delete the scratch DB.
- Also record: current pm2 list, current production commit (`git -C /var/www/pos-backend log -1`), live POS
  desktop version (`https://updates.nfplantation.com/latest.yml`).
- Remember the two update directories (memory note): any desktop release must sync BOTH `/var/www/updates`
  and `/var/www/html/updates` or auto-update silently breaks.

## 2. Merge plan with the main developer
`main` auto-deploys to production on every push (`deploy-vps.yml`), and a desktop version bump publishes the installer.
Therefore the merge **is** the backend deploy and possibly the desktop release.
1. Agree a freeze window with Sabiharan (no other pushes to `main` during the deploy hour). Moni confirms.
2. Rebase `feature/mobile-app-foundation` on `origin/main`, fix conflicts, rerun all tests.
3. Open a PR `feature/mobile-app-foundation` -> `main`; Sabiharan reviews the POS-file changes (invoices, orders, preload, database, sync).
4. Decide the desktop version: bump `package.json` only if the desktop release goes out in the same merge (step 6);
   otherwise the workflow still deploys the backend but skips the desktop publish (it compares the version with `latest.yml`).
5. Merge only on Moni's "go". `paths-ignore` already keeps `mobile/**` and `docs/**` commits from deploying.
- **Check:** GitHub Actions "Deploy VPS" green; `pm2 list` shows `pos-backend` restarted once; `curl https://posadmin.nfplantation.com/api/health` -> 200/401.
- **Rollback:** `git revert -m 1 <merge>` on `main` (the deploy script resets the VPS to `origin/main`), push, wait for the deploy; or
  on the VPS `git -C /var/www/pos-backend reset --hard <previous-commit>` then run `/usr/local/bin/pos-deploy`'s build/restart lines by hand.
  Cloud schema changes are additive only (new tables/columns) and need no rollback; old code ignores them.

## 3. Backend deploy (happens at the merge)
- Added 2026-11-13 (all additive, created on the first API hit per company): tables `staff_assignments`, `staff_targets`, `field_visits`, `app_collections`; column `invoices.agent_id`; routes under `/api/app/v1/staff`, `/visits`, `/agent/collections`, `/admin/staff`; the sync push now also runs the reservation release for converted app orders (`onOrderStatusChanged`) and the collection approve / reject notification (`onContributionStatusChanged`). The reservation fix changes behaviour for real companies: an app order stops reserving stock the moment the POS converts it to an invoice.
- What changes: `/api/app/v1/*`, `ensureTenantCompatibility` additions (`app_*` tables, new columns on `products`,
  `branches`, `customer_orders`, `customer_order_items`, `invoices`), sync `RELATED_KEYS`, notification queue (push + WhatsApp stay dry-run).
- **Check (right after deploy):**
  1. `curl -s https://posadmin.nfplantation.com/api/health -H "x-api-key: <sync key>"` OK.
  2. A POS client syncs normally (Sync indicator green, no error toast).
  3. `GET /api/app/v1/status` with the real App Key (step 4) returns 200.
  4. pm2 logs for `pos-backend`: no repeating errors in 5 minutes.
- **Rollback:** as step 2.

## 3a. Timezone rollout (UTC sessions vs sync cursors) - complete BEFORE the section 3 deploy
The new backend runs every MySQL connection with `SET time_zone='+00:00'`, so `CURRENT_TIMESTAMP`/`NOW()` are UTC. Sync pulls `updated_at > cursor`.

1. **Precheck (read-only):** `scripts/staging/01-precheck.sh` prints `@@global.time_zone`, `@@system_time_zone`, `NOW()`, `UTC_TIMESTAMP()` and a `TZ VERDICT`. Or run by hand: `SELECT @@global.time_zone, @@system_time_zone, NOW(), UTC_TIMESTAMP();`
2. **Path A - MySQL already UTC (offset 0):** nothing to convert. Deploy normally.
3. **Path B - MySQL is not UTC (for example +05:30):** existing rows carry local stamps (5h30 ahead of true UTC) and every device cursor sits on them. New UTC rows would sort 5h30 behind those cursors and devices would miss them for 5h30. Do this, in order:
   1. Set `SYNC_PULL_OVERLAP_MINUTES=330` in the production backend `.env` **before** deploying the new code (the setting is harmless on the old code). Every pull then re-reads the last 330 minutes; re-sent rows are idempotent upserts (last-write-wins by id), so nothing is missed and nothing is duplicated.
   2. Deploy the backend (section 3). Keep the overlap for 7 days (until every device has pulled past the switch), then remove it and restart.
   3. Do **not** bulk-convert old timestamps with `CONVERT_TZ`: rows written by the POS/JS (`toISOString`) are already UTC and would be shifted twice. The overlap is the safe path. If a one-time conversion is ever required, generate it per column on staging, diff the row counts, and have Moni approve it first.
4. **Prove it on staging first:** restore the production backup on staging (section 1), run the precheck there, set the overlap, deploy the new code, create a change from the app and from the POS, and confirm a POS device with an old cursor receives both within one sync cycle. The automated simulation of mixed old-local and new-UTC rows is `backend/tests/sync-tz.test.mjs` (`npm test` in `backend/`).
5. **POS desktop (local SQLite):** the POS writes `datetime('now')` / `toISOString()` (UTC). The POS now displays Asia/Colombo and reads bare SQLite stamps as UTC; no data is converted on the PCs.

## 3b. Smart Buy module visibility (17 Nov pre-deploy item; read-only check done 2026-11-13)
Why: `getModules()` (`backend/lib/app/settings.ts`) hides Smart Buy and installments when `companies.business_type` is `supermarket` or `food city`, or when the package or an override turns the module off. The staging test company was `supermarket`, so the Smart Buy tab bounced to the shop until it was changed to `retail` (staging only).
Read-only result on production (no change made): company **Natural Plantation** is `business_type = retail`, status active, subscription `trial`, no `company_modules` / `company_module_overrides` rows for `smartbuy` or `installments`, and its package enables `installments` with no row that disables `smartbuy` (a module is on unless explicitly set false). So Smart Buy would **show** for the real company. The other `retail` company (`nf plantation`) is the same. Two other companies are `supermarket`; they would not see Smart Buy (expected).
- **Before the deploy:** re-run this check, because a change in Super Admin before 17 Nov (business type, package, override) would change the answer. Query is read-only: `SELECT name, business_type FROM companies;` plus `company_module_overrides` and `package_modules` for the company's package.
- **Check (right after deploy, with the real App Key):** `GET /api/app/v1/status` returns `modules.smartbuy: true` for Natural Plantation. If it is `false`, fix the business type or module in Super Admin (never in code) and re-check; do not ship the AAB until it is true.
- Also noted: production `companies` has no `app_key` column yet. It is created by the section 3 deploy (additive), so step 4 cannot be done before the deploy.

## 3c. Rotate the production database password (STOP item, with the main developer)
Why: on 13 Nov the production DATABASE_URL credentials were printed in an agent session (no values are recorded in any doc). Do this in the deploy window with the main developer, not before.
1. Create the new password for the production MySQL app user and update it in the production backend `.env` (and anywhere else that user is used) without printing it; check with key names only.
2. Restart `pos-backend` in the same window; check `/api/health` and one POS sync.
3. Rotate any other secret printed in the same session (list by name only, agree with the main developer).
- **Rollback:** put the previous password back in `.env` and restart; keep the old one valid until the checks pass.

## 4. Real-company App Key and product re-push
1. Super Admin portal -> company -> generate App Key (`npk_...`). The key goes into the production EAS profile (build env `APP_KEY`, read by `mobile/app.config.ts`) — it identifies the company only, it is not a secret like the sync key.
2. Products created before the deploy lack the new columns; do the one-time re-push from the POS per branch PC (use the POS's existing full-sync / product re-push action; confirm the exact menu name on a branch PC before the day, it was not re-checked for this plan).
- **Check:** the app shop shows real products with prices equal to the POS (tax on top rule, DECISIONS 2026-11-07), variants present, images load.
- **Rollback:** rotate the App Key in Super Admin (old key stays valid for the grace period, then dies); set `ordering_enabled = 0` in POS > Online Store to stop app orders instantly.

## 5. Reviewer accounts (real company)
```
cd backend
set REVIEW_COMPANY_NAME=<exact company name>
set REVIEW_PASSWORD=<strong password Moni chooses>
node scripts/run-ts.cjs scripts/create-review-accounts.ts            (dry run first)
set REVIEW_CONFIRM_COMPANY=<exact company name>
node scripts/run-ts.cjs scripts/create-review-accounts.ts --apply
```
Run it on the VPS in `/var/www/pos-backend/backend` (it needs production `.env`), only after Moni's go.
- **Check:** log in to the **production** app build with each reviewer login (customer, Smart Buy, Field Officer, Branch Manager once built) and see real screens; place a test order, confirm the POS shows notes `[TEST ORDER - Play review]`.
- **Rollback:** disable the accounts: `UPDATE app_users SET status='disabled' WHERE is_review_account=1;` and delete the `[PLAY REVIEW]` scheme/customer/agent rows from the POS.
- Put the exact "App access" text (with the password Moni chose) into Play Console; the password is not stored in git.

## 6. POS desktop release to branch PCs (before app launch)
The convert-to-invoice, App Access, Online Store and assign-agent features live in the desktop app. **Added 2026-11-13:** the Sales Team page (Mobile App menu) and the Smart Buy "Agent Cash" page (bulk approval of cash agents collected in the app; changes in `electron/ipc/chits.ts`, `preload.ts`, `App.tsx`, `AppLayout.tsx`, listed for the main developer in PROGRESS.md). Both read and write through the cloud, so the backend deploy (section 3) must come first. Release on 17 Nov together with the backend deploy, only after Moni's approval.
1. Bump `package.json` version; merge as in step 2; the workflow builds the Windows installer and publishes it to `updates.nfplantation.com` (both update directories).
2. Branch PCs auto-update on next start. Moni checks each branch PC shows the new version (check how the POS displays its version before the day).
- **Check:** one branch PC places a counter sale, receives one test app order, converts it to an invoice (price locked, delivery fee in total, tax like a counter sale).
- **Rollback:** republish the previous installer + `latest.yml` to BOTH update directories; PCs on the new version keep working against the (additive) cloud schema.

## 7. Production AAB (Moni types passwords where asked)
```
cd mobile
eas build --platform android --profile production      (credentialsSource: remote, Play upload key)
```
`versionCode 6`, `versionName 1.0.0`, package `nfgroups.naturefarming.app`, mocks off, `APP_KEY` = real company key, production API URL, Firebase file present.
- **Check:** AAB size and the size Play reports (<= 25 MB download), `bundletool` install on the phone, cold start <= 2.5 s, login with a reviewer account, place a TEST order, see push dry-run logged.
- **Rollback:** nothing is published yet; discard the build.

## 8. Play Internal testing
Upload the AAB to Internal testing, add Moni + boss + team emails (<= 100).
- **Check:** install from the Play link on 2+ phones (different Android versions); each role logs in; deep links from pushes work; Data safety and declarations show no errors in the Console "Publishing overview".
- **Rollback:** halt the testing rollout or remove testers; production still serves versionCode 4.

## 9. Play Production
Promote the same build to Production (staged rollout 20% -> 50% -> 100% over 2-3 days if time allows; full rollout if the date is tight).
Play review can take hours to days: submit by 19 Nov.
- **Check:** Play Console "Releases overview" = In review/Available; crash rate and ANR in Android vitals stay under bad-behaviour thresholds.
- **Rollback:** Play cannot revert a release; instead halt the rollout and push versionCode 7 containing the previous JS, or ship an OTA JS fix (step 10). The old Flutter build (code 4) cannot be re-promoted if code 6 is already higher; hence the staged rollout.

## 10. After launch
- Fix JS/UI bugs with `eas update` on the production channel (no Play review). Native changes need a new Play build.
- Watch for 48 h: `pm2 logs pos-backend`, app order counts, "Login failed" rate, Play vitals.
- Kill switches (no deploy needed): `ordering_enabled=0`, `maintenance_message`, `min_app_version` (POS > Online Store), rotate the App Key, disable a user in POS > App Access.

## One-line go decision
Go to production when: staging verified, backup restored once, upload key = MATCH, reviewer text ready, Sabiharan agreed the freeze window, Moni said "go" in chat.

## Backups on the VPS: retention rule (Moni, 2026-11-12)
- Backups live in `/root/backup-<timestamp>/` (nginx, pm2 list, one `.sql.gz` per MySQL database, the PostgreSQL and MongoDB dumps below, `SHA256SUMS`). The first full set (`backup-20261112-081656`) is ~0.4 MB; the server has ~60 GB free (38 % used).
- **Keep the last 2 backups.** Take a new one before every change to production, restore-test one dump (STAGING_SETUP §2), and only then is the oldest-but-two eligible for removal.
- **Never delete a backup without Moni's explicit approval**, even an old one. The agent lists candidates (`ls -d /root/backup-* | sort`, size with `du -sh`) and asks.
- Check free space before every backup: `df -h /` must show > 10 GB free; if the sum of backups grows past 5 GB, tell Moni instead of deleting.

### Other engines on the VPS (read-only dumps, services untouched)
- PostgreSQL `nature_farming`: `su postgres -c "pg_dump -Fc nature_farming" > pg_nature_farming.dump`. Verify: `createdb scratch_verify_pg`, `pg_restore --no-owner -d scratch_verify_pg`, compare per-table row counts, `dropdb`.
- MongoDB (`nf-farming`, `nf-plantation`, `nf_farming`, `nf_plantation`; no auth, localhost): `mongodump --db <name> --gzip --archive=mongo_<name>.archive.gz`. Verify: `mongorestore --gzip --archive=... --nsFrom '<name>.*' --nsTo 'scratch_verify_<x>.*'`, compare per-collection document and index counts, drop the scratch DB.
- Never stop, restart or reconfigure these services. Confirm no `scratch_verify*` database is left afterwards.
- Set verified 2026-11-12 in `/root/backup-20261112-144809-v2` (11 files in `SHA256SUMS`, `sha256sum -c` clean): nature_farming 10 tables / 34 rows; nf-farming 35 collections / 99,677 docs (160 MB); nf-plantation 39 / 194; nf_farming 27 / 0 (empty); nf_plantation 20 / 91. All restores matched exactly.
- Copies made for staging (`/root/staging-copy/`) are separate and small; remove them with the staging rollback (`99-rollback.sh`).

## New in Step 6: private uploads (join NIC photos, bank slips)
- Set `PRIVATE_UPLOAD_DIR=/var/www/<app>-private` in the backend `.env` (directory `chmod 700`, owned by the app user) **before** deploying. Without it files go to `<cwd>/private-uploads`, which a redeploy that replaces the directory would wipe.
- Include that directory in the backups (it holds NIC photos: personal data). Never serve it through nginx; never copy it to staging.
- Staging already uses `/var/www/pos-staging-private`.
- The two new cloud tables (`smartbuy_join_requests`, `order_payment_slips`) are created by `ensureTenantCompatibility` on first request; no manual SQL.
