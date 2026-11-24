# Staging on the VPS — one command per step

**Status (10 Nov 2026): scripts are written and syntax-checked, NOT executed.** VPS access is blocked.
When access arrives, run the steps below in order. Production (`/var/www/pos-backend`, pm2 `pos-backend`,
its databases, existing nginx sites, `pos-deploy`, `main`) is never modified; the only production
contact is a read-only `mysqldump` in step 2.

## 0. One-time: get SSH access
Install `C:\Users\matha\.ssh\nf_vps_claude.pub` into `/root/.ssh/authorized_keys` through the hosting
provider's console (never share the root password). Then `ssh nfvps "echo ok"` must print `ok`.

## What staging is
| | Production | Staging |
|---|---|---|
| Folder | `/var/www/pos-backend` | `/var/www/pos-staging` (branch `feature/mobile-app-foundation`) |
| Process | pm2 `pos-backend` (port 4001) | pm2 `pos-staging` (first free port 4101-4110) |
| Main DB | existing | `pos_stg_saas` |
| DB user | existing | `pos_stg` (grants only on `pos_stg_saas` and `pos_erp_app_test_company_*`) |
| URL | `posadmin.nfplantation.com` | `https://staging-api.72-61-115-222.sslip.io` |
| Secrets | prod `.env` | own random JWT / API secrets, push + WhatsApp **off** |
| Uploads | prod | `/var/www/pos-staging-uploads` |

All commands run from the repo root on Moni's PC (CMD works; scripts are piped over SSH):

## 1. Pre-checks (read-only)
```
ssh nfvps "bash -s" < scripts/staging/01-precheck.sh
```
Expect: Node >= 20, pm2 present, nginx + certbot + mysql present, `>= 5 GB` free disk, `>= 1 GB`
available RAM, a free port in 4101-4110, `root via socket: OK`, `nginx -t` successful, and the line
`PRECHECK DONE (nothing was changed)`.
If `root via socket: NO`, create the DB/user by hand (see "Manual MySQL") before step 3.
If RAM is under ~1 GB, add swap first (`fallocate -l 2G /swapfile && mkswap /swapfile && swapon /swapfile`):
`next build` next to a running production app can otherwise get OOM-killed.

## 2. Backups (before any change)
```
ssh nfvps "bash -s" < scripts/staging/02-backup.sh
```
Expect: `/root/backup-<timestamp>/` with `nginx.tgz`, `pm2-list.txt`, `pos-deploy.sh`, one `<db>.sql.gz` per
production database, `SHA256SUMS`, then `BACKUP DONE`. Restore-test one dump into a scratch DB:
```
ssh nfvps "d=$(cat /root/.last-staging-backup); f=$(ls $d/*.sql.gz | head -1); mysql -uroot -e 'CREATE DATABASE restore_test'; zcat $f | mysql -uroot restore_test && mysql -uroot -e 'SHOW TABLES' restore_test | wc -l; mysql -uroot -e 'DROP DATABASE restore_test'"
```
Expect a table count > 0.

## 3. Create staging
```
ssh nfvps "STAGING_BRANCH=feature/mobile-app-foundation bash -s" < scripts/staging/03-setup.sh
```
Expect (takes a few minutes): chosen port, `MySQL ready`, `checked out <hash>`, `npm ci`, `next build`, pm2 start,
`GET /api/health -> HTTP 401` or `200` (401 is fine: the health route wants a key), `SETUP DONE`.
Check production did not change: `ssh nfvps "pm2 list"` shows `pos-backend` unchanged (same uptime, no restarts).

## 4. HTTPS (nginx + certbot, sslip.io)
```
ssh nfvps "CERTBOT_EMAIL=moni@example.com bash -s" < scripts/staging/04-nginx.sh
```
Expect: `nginx -t` OK, `http block live`, certbot success, `NGINX DONE: https://staging-api.72-61-115-222.sslip.io`.
If Let's Encrypt rate-limits sslip.io, retry with `STAGING_HOST_OVERRIDE=staging-api.72.61.115.222.nip.io` in front of `bash -s`.
A failing `nginx -t` removes the new block automatically and reloads nothing.

## 5. Seed the test company
```
ssh nfvps "bash -s" < scripts/staging/05-seed.sh
```
Expect the `=== App test company seeded ===` banner: App Key, customer + Smart Buy login, other customer,
agent `AG001`, first-login invite. These are seed-only logins (password `Test@1234`) and fake data.
Sales-force roles (manager levels) appear here once the seed is extended in item 6.

## 6. Verify
```
ssh nfvps "bash -s" < scripts/staging/06-verify.sh
```
Expect every line `PASS` and `VERIFY: ALL AUTOMATED CHECKS PASSED` (HTTPS status, wrong key 401, each role login,
wrong password 401, catalog, orders, production still up). Then the manual check: place an order in the staging
APK and confirm it appears in a POS pointed at the staging URL with the app-order badge.

## 7. Staging APK
Build from `C:\np` per HANDOFF §3 with app id `nfgroups.naturefarming.app.staging`, API =
`https://staging-api.72-61-115-222.sslip.io`, App Key from step 5, mocks off, staging key in
`C:\secure\nf-keys\staging\`. Output: `C:\work\mobile app\release\NaturalPlantation-STAGING-<date>.apk`.

## Rollback (staging only)
```
ssh nfvps "CONFIRM=yes bash -s" < scripts/staging/99-rollback.sh
```
Without `CONFIRM=yes` it is a dry run. Removes pm2 `pos-staging`, the nginx staging block (+ cert), the staging
DBs/user and the staging folders. Backups in `/root/backup-*` are kept. Verify production afterwards:
`ssh nfvps "pm2 list; curl -sI http://127.0.0.1:4001/api/health"`.
If production itself ever needs restoring (it should not): `zcat /root/backup-<ts>/<db>.sql.gz | mysql -uroot <db>`
and `tar xzf /root/backup-<ts>/nginx.tgz -C /` then `nginx -t && systemctl reload nginx`. Ask Moni first.

## Manual MySQL (only if root socket login fails)
```
CREATE DATABASE pos_stg_saas CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'pos_stg'@'localhost' IDENTIFIED BY '<strong password>';
GRANT ALL ON `pos_stg_saas`.* TO 'pos_stg'@'localhost';
GRANT ALL ON `pos\_erp\_app\_test\_company\_%`.* TO 'pos_stg'@'localhost';
```
Then edit `03-setup.sh` to skip its MySQL block and write the same password into `backend/.env`.

## Safety notes
- Scripts hold no passwords. Generated secrets live only on the VPS (`/root/staging.env`, `backend/.env`, both mode 600).
- `pm2 save` persists the whole process list, which already includes production; it adds only `pos-staging`.
- The seed refuses to run unless `MYSQL_HOST` is local and `05-seed.sh` also refuses unless `.env` points at `pos_stg_saas`.
- Pushes to the staging branch never auto-deploy: the deploy workflow only reacts to `main`.
