# Deploy and merge plan: feature/mobile-app-foundation -> main -> production

**PLAN ONLY. Nothing here has been run.** Audience: the main developer (Sabiharan), who owns production
and did not write this branch. Companion to `PRODUCTION_RUNBOOK.md` (step detail, scripts). No secret values
appear in this file; secrets are named only. Every production action needs Moni's explicit approval (section 9).

Owners: **Moni** = owner, approvals, Play Console. **Main dev** = merge, VPS root, deploy. **Agent** = prepares
scripts/checks, never presses production buttons.

## 1. What is in the branch
Counts from `git diff --shortstat main...HEAD` on 2026-11-13 evening: 596 files, +54.9k / -215, 82 commits (they move daily: **MAIN DEV TO CONFIRM** after `git fetch`). `main` has no commits that
the branch lacks (`git rev-list --count HEAD..main` = 0 against the local `main`; re-check after `git fetch`).
About 277 files are new `mobile/` files, about 35 docs; the production-affecting part is much smaller.

| Area | Size | What it is |
|---|---|---|
| Backend `/api/app/v1/*` | `backend/app`, `backend/lib` (153 files, +9.2k) | Mobile API: auth/JWT, catalog, cart/orders, reviews, Smart Buy (wallet, join, slips), staff/visits/targets, agent collections, admin endpoints, notification + email queues. App Key + JWT + role scoping. |
| Backend sync/infra | `backend/lib`, `deploy-vps.yml`, `next.config.ts` | UTC session timezone (`SET time_zone='+00:00'`), stock reservations released on order conversion, collection approve/reject notifications, `PRIVATE_UPLOAD_DIR`. |
| POS desktop | `electron/`, `src/` (73 files, +7.0k / -139) | Convert app order to invoice, Online Store settings, App Access, Sales Team page, Smart Buy "Agent Cash", delivery-time per branch, reviews table, Colombo-day reports. Touches `electron/ipc/invoices.ts`, `orders.ts`, `chits.ts`, `preload.ts`, `database.ts`, `App.tsx`, `AppLayout.tsx`. |
| Mobile app | `mobile/` (277 files, all new) | Expo/React Native app `nfgroups.naturefarming.app` (customer, Smart Buy, field officer, branch manager). Not deployed by the merge. |
| Docs/tests | `docs/`, `.claude/`, `.agent/`, `backend/tests`, `electron/__qa__` | No runtime effect. `paths-ignore` skips `mobile/**` and `docs/**` for deploys. |

### New cloud (MySQL, per company) schema: all additive, created on first API hit by `ensureTenantCompatibility` (`backend/lib/appSchema.ts`)
- Tables: `app_users`, `app_refresh_tokens`, `app_devices`, `app_email_verifications`, `app_credential_dispatches`,
  `app_password_reset_requests`, `app_banners`, `app_settings`, `product_reviews`, `wishlists`, `app_notifications`,
  `notification_jobs`, `email_jobs`, `app_request_receipts`, `app_addresses`, `smartbuy_join_requests`,
  `order_payment_slips`, `stock_reservations`, `staff_assignments`, `staff_targets`, `field_visits`, `app_collections`.
- Columns: `products` (`is_online`, `slug`, `gallery`, `short_description`, `unit`, `discount_pct`, `not_for_sale`,
  `enable_emi`, `is_manage_stock`, `sale_by`, `product_type`, index `idx_products_updated`); `categories.image_url`;
  `branches` (`latitude`, `longitude`, `delivery_eta_min_days`, `delivery_eta_max_days`, `delivery_eta_text`);
  `customer_orders` (`channel`, `app_user_id`, `assigned_agent_id`, `delivery_fee`, `payment_method`, ...);
  `invoices.agent_id`; `app_users.is_review_account`; `smartbuy_join_requests` (`purged_at`, `branch_id`); `companies.app_key`.
  Verified against `backend/lib/appSchema.ts`; re-diff before the deploy in case later commits added more.
- Desktop SQLite and sync lists: exact comparison in section 10 (all matches confirmed, notes for the main dev).
- Uncommitted work by another agent at time of writing: cloud-only table `app_versions` (in-app update info, edited from a POS "App Versions" page). Re-diff `appSchema.ts` before the merge.

## 2. Merge strategy
**Recommendation: merge commit (`--no-ff`), not squash.**
- 79 commits and 595 files in one squash would be one unreviewable, un-bisectable commit; history shows which
  fix belongs to which feature.
- Rollback is a single `git revert -m 1 <merge>`, which only works with a merge commit.
- The branch already contains docs-only commits; `paths-ignore` handles them without deploying.
- Squash is acceptable only if the main dev insists on linear history; then the revert target is the one squash commit.

Steps:
1. Owner: main dev. Agree a **freeze window** (no other pushes to `main` for the deploy hour) with Moni.
2. Owner: agent prepares, main dev decides. `git fetch`; if `origin/main` moved, rebase or merge `main` into the
   branch **on the branch**, never on `main`. **Conflict resolution: the main dev resolves conflicts in the POS files**
   (`electron/ipc/invoices.ts`, `orders.ts`, `chits.ts`, `electron/preload.ts`, `electron/database.ts`,
   `src/App.tsx`, `AppLayout.tsx`, sync files); the agent resolves only in `mobile/`, `docs/`, new backend files.
3. Re-test after any rebase/merge (all green before the PR is approved):
   - `npm run typecheck` and `npm test` (root: includes the app-order-invoice, collections, Colombo-day integration tests);
   - `npm test` in `backend/` (app-api, join, email, sync-tz tests);
   - mobile `npm test`, `npx tsc --noEmit`, `npx eslint .`;
   - the **test POS loop** on staging: app order -> POS receives it -> convert to invoice (price locked, delivery fee
     in total, tax like a counter sale) -> stock released -> status back to the app;
   - **9-login smoke** on staging (reviewer/test logins for each of the 9 roles/accounts in
     `docs/mobile-app/integration-evidence`): each logs in and sees its own screens only.
4. Owner: main dev reviews the POS-file diff in the PR (`electron/` + `src/`, 73 files).
5. Branch protection on `main` (main dev to enable if not yet): PR required, 1 approving review (the main dev, not
   the author), CI checks required, no force push, linear history OFF (to allow merge commits), include admins.
6. Desktop version: bump `package.json` **only** if the POS release goes out with this merge (section 3 step 4);
   otherwise the workflow deploys the backend and skips the installer publish (it compares with `latest.yml`).
7. **Merge only on Moni's "go" (section 9).** Merging to `main` **is** the production backend deploy (`deploy-vps.yml`).
- **Rollback:** before merge, close the PR. After merge, `git revert -m 1 <merge>` and push (see section 7).

### Two POS bugs already on `main` (fixes ride in this branch; the main dev may take them separately)
Real companies are affected today: (1) `e7e227e`: a NULL cloud value in a NOT NULL DEFAULT local column quarantines the row, so a new POS device gets no products (`syncService.ts`, patch `docs/mobile-app/patches/pos-sync-null-default-fix.patch`); (2) `79ff639`: variant products never push their total stock row, and `datetime("now")` with double quotes throws in 6 places (patch `pos-variant-stock-and-datetime-fix.patch`). Also noted, not fixed: `cycleDueDate()` is one day early on a Colombo desktop (PROGRESS 2026-11-13). **MAIN DEV TO CONFIRM** whether to ship (1) and (2) as a hotfix before the merge.

## 3. Deploy order (maintenance window, main dev drives, Moni approves each gate)
| # | Step | Owner | Rollback |
|---|---|---|---|
| 0 | Staging green; precheck `scripts/staging/01-precheck.sh` (MySQL timezone verdict). If MySQL is not UTC set `SYNC_PULL_OVERLAP_MINUTES=330` in the backend env first (runbook 3a Path B). | Agent + main dev | Remove the setting. |
| 1 | **DB backup first**: `scripts/staging/02-backup.sh`, `SHA256SUMS`, restore-test one dump into a scratch DB, `df -h /` > 10 GB free. Record `pm2 list`, current prod commit, live POS version in `latest.yml`. Keep the last 2 backups; never delete without Moni. | Main dev | Nothing changed; drop scratch DB. |
| 2 | Set env **names** (section 4) and `PRIVATE_UPLOAD_DIR` dir (`chmod 700`) on the VPS. | Main dev | Restore the previous env file copy. |
| 3 | **Backend deploy** = merge to `main`, Actions "Deploy VPS" runs. Schema is additive and auto-created on the first API hit per company, so nothing to run by hand. Check: Actions green, `pm2 list` one restart, `/api/health` OK, a POS client syncs, 5 minutes of `pm2 logs pos-backend` without repeating errors. | Main dev | Section 7 backend. |
| 4 | Secret rotations in the same window (section 5). | Main dev + Moni | Per rotation. |
| 5 | Real-company App Key in Super Admin, `GET /api/app/v1/status` = 200 with `modules.smartbuy: true`. One-time product re-push from POS per branch PC. | Moni | Rotate App Key; `ordering_enabled=0`. |
| 6 | **POS desktop release** (version bump merged in step 3, or a second small PR). Installer must reach **BOTH `/var/www/updates` AND `/var/www/html/updates`** or auto-update silently breaks (known incident). Verify `https://updates.nfplantation.com/latest.yml` shows the new version and the installer URL returns 200 from both paths. One branch PC: counter sale + one test app order converted to invoice. | Main dev | Re-upload previous installer + `latest.yml` to both dirs. |
| 7 | Reviewer accounts (`create-review-accounts.ts`, dry run first, then `--apply`) on the VPS. | Agent prepares, Moni approves | `UPDATE app_users SET status='disabled' WHERE is_review_account=1`. |
| 8 | Production AAB via EAS (Moni types passwords; agents never run `eas submit`). | Moni | Discard the build. |
| 9 | **Play internal testing upload**, done by Moni in Play Console. Test on 2+ phones, every role. Then staged production rollout 20% -> 50% -> 100%. | Moni | Halt rollout. |

Order rule: backend first, POS desktop second, app last. The app needs the new cloud columns before any app
order can reach a POS, and the POS needs the backend before it syncs the new tables.

## 4. Production env changes (names only, never print values)
Add or verify in the production backend env, via a script or editor, then check by key name only:
- `EMAIL_MODE=production` (without it all mail incl. existing admin/onboarding emails is suppressed); `EMAIL_ALLOWLIST` unset.
- SMTP for the production company (Super Admin > company > email, or platform SMTP; **MAIN DEV TO CONFIRM** which one production uses); sender domain has SPF/DKIM;
  send the "email test" to an owner address first. Staging has no SMTP, so the 14 email types are unproven: send one of each to a test address.
- `PUBLIC_BASE_URL` (logo URLs in emails and hosted pages).
- `CRON_SECRET` (new value, section 5).
- `PRIVATE_UPLOAD_DIR` (NIC photos and bank slips; included in backups; never served by nginx, never copied to staging).
- `SYNC_PULL_OVERLAP_MINUTES` only if MySQL is not UTC (3a); remove after 7 days.
- Names seen on staging (`grep -o '^[A-Z_]*='` only): `MYSQL_HOST/PORT/USER/PASSWORD/DATABASE`, `CLOUD_API_KEY`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `CRON_SECRET`, `UPLOAD_DIR`, `PUBLIC_BASE_URL`, `MAX_UPLOAD_BYTES`, `APP_PUSH_ENABLED`, `WHATSAPP_CLOUD_API_ENABLED`, `PRIVATE_UPLOAD_DIR`, `EMAIL_MODE`, `EMAIL_ALLOWLIST`. **MAIN DEV TO CONFIRM** production uses the same names (it may use `DATABASE_URL`), that `JWT_*` differ from staging, and the production `PUBLIC_BASE_URL`, `UPLOAD_DIR` and `PRIVATE_UPLOAD_DIR` values. Mocks off; push and WhatsApp stay dry-run until approved (section 9).

## 5. Secret rotations (STOP items; both in the maintenance window with the main dev)
Both were exposed in agent output on 13 Nov 2026. No values are recorded in any doc.
1. **Production DB password (runbook 3c).** Create the new password for the production MySQL app user; update the
   backend env without printing it; restart `pos-backend`; check `/api/health` and one POS sync. Keep the old
   password valid until the checks pass. Rollback: put the old value back, restart. Also rotate anything else
   printed in the same session (agree the list by name with the main dev).
2. **VPS superadmin backup-cron secret.** It lives in root's crontab, which calls port 4001
   `/api/superadmin/cron/run-scheduled-backups`. Change the env var on the production process **and** the crontab
   line together in one window (never one without the other, or the nightly backup silently fails). Restart the
   process, then confirm the next run succeeded in `/var/log/pos-scheduled-backups.log` (HTTP 200, no 401).
   Rollback: restore both the previous env var and the previous crontab line from the copies taken beforehand.
   Also rotate the staging `CRON_SECRET` (and production's if it was the same value).
   **Rotate the production backup-cron secret in the deploy window:** it lives in the root crontab calling port 4001 `/api/superadmin/cron/run-scheduled-backups` header `x-cron-secret` and was exposed in agent output on 13 Nov (twice); change the production env var and the crontab line together; verify the next run in `/var/log/pos-scheduled-backups.log`. Read the crontab only via `ssh -o BatchMode=yes nfvps 'crontab -l' | node scripts/mask-secrets.mjs` (AGENTS.md rule 14). The value is never written in any doc.
3. **Anything else read through pm2 / crontab / systemd / shell history in agent sessions** gets the same treatment: list by name with the main dev. From now on every such read goes through `scripts/mask-secrets.mjs`.

## 6. Production data prep (Moni + branch staff, before the launch gate)
- **Categories:** production has 0 categories and about 775 uncategorised products. Create categories in the POS
  and assign products before launch; otherwise the app's Categories page is empty by design. Re-push products after.
- **Category images:** POS category image upload is a manual URL only (v1.1); the app shows text tiles without it.
- **Delivery time** per branch: POS Online Store > Ordering & delivery > Delivery time (min/max days). Unset = no estimate in the app.
- **Company profile/logo/contact** filled in (used by emails and the app).
- **Smart Buy modules:** production company Natural Plantation is `business_type = retail`, so Smart Buy shows
  (read-only check 13 Nov). Re-run the check right before deploy (runbook 3b; "Natural Plantation = retail" is from the read-only check on 13 Nov, **MAIN DEV TO CONFIRM** live) because a Super Admin change would alter it;
  fix in Super Admin, never in code. Supermarket/food city companies correctly do not show Smart Buy.
- Prices in the app equal POS prices (tax on top rule); images load; variants present.

## 7. Smoke test, monitoring, rollback
**Smoke after deploy.** (a) Read-only first: health, `GET /api/app/v1/status` with the App Key, POS sync indicator
green, a catalog read, `SELECT status, COUNT(*) FROM email_jobs GROUP BY status` shows `sent` not `suppressed`/`failed`.
(b) Then **one real low-value order placed by the owner** in the production app build, converted to an invoice in
the POS, delivery email/notification received, stock correct. Cancel/refund per the normal procedure afterwards.

**First 24 hours watch list.** `pm2 logs pos-backend` (repeating errors, restarts); sync failures and `sync_queue`
items stuck at `failed`; `email_jobs` failed count; app order count vs POS invoices; "Login failed" rate; MySQL
connections and disk; nightly backup log after the cron rotation; update server hits for the new POS version;
Play vitals (crashes/ANR). Kill switches need no deploy: `ordering_enabled=0`, `maintenance_message`,
`min_app_version` (POS > Online Store), rotate App Key, disable a user in POS > App Access.

**Rollback plan.**
- Backend: `git revert -m 1 <merge>` on `main`, push, wait for the deploy; or on the VPS `git reset --hard <previous-commit>`
  and run the deploy's build/restart lines by hand. Pre-deploy commit hash recorded in step 1.
- DB: columns/tables are additive and old code ignores them, so **no schema rollback**. Only restore a backup if data
  corruption is proven, and only with Moni's approval.
- POS desktop: re-upload the previous installer and `latest.yml` to BOTH update directories; PCs already on the new
  version keep working against the additive schema.
- App: halt the staged rollout in Play Console; fix JS issues by OTA (needs approval); native fixes need a new build
  (Play cannot revert; old code 4 cannot be re-promoted once code 6 is higher, hence the staged rollout).
- Secrets: restore previous values from the copies taken before rotation; keep old ones valid until checks pass.

## 8. Open risks and decisions needed
**Date conflict in the docs:** the runbook puts backend + POS release on 17 Nov, RELEASE_PLAN on 18 Nov (day 11); pick one. **MAIN DEV TO CONFIRM** with Moni.
**From Moni:** go/no-go date (target v1.0 live 21 Nov, submit by 19 Nov); if Play needs a closed test (12 testers for
14 days) the date is not reachable; freeze window; who sets the reviewer password; when push/WhatsApp go from dry-run
to live; confirmation that live payment keys stay off for v1.0.
**From the main dev:** merge commit vs squash; who enables branch protection; whether the POS version bump ships in
the merge or a second PR; MySQL timezone (UTC or +05:30 overlap path); `PRIVATE_UPLOAD_DIR` path; SMTP/sender domain
for the production company; confirmation of the exact POS "full sync / product re-push" menu name; how the POS shows its version.
**Risks:** merging deploys immediately (no separate staging gate); the reservation fix changes real-company
behaviour (an app order stops reserving stock when converted to an invoice); POS conflicts if `main` moved; email
delivery unproven on staging; Play upload-key SHA must MATCH before upload (runbook 0); 775 uncategorised products
make the app look empty; both update dirs must be synced; backup cron breaks if only one half of the rotation is done.

## 9. Go/no-go checklist and STOP list
**Go only if all are true:** staging verified (verify script + APK on a real phone per role); all tests green after the
final merge/rebase (root, backend, mobile, test POS loop, 9-login smoke); backup taken and one dump restore-tested;
env names set (section 4); data prep done (section 6); freeze window agreed; main dev reviewed the POS diff; upload-key
check = MATCH; rollback commit hashes and previous installer recorded; Moni said "go" in chat.

**STOP list: a human presses every one of these buttons, only with Moni's explicit approval (owner).** Agents prepare
and verify; they do not execute:
- production deploy (the merge to `main` and the Actions run);
- production DB password rotation, and the backup-cron secret rotation;
- merge to `main`;
- Play upload (internal testing and production); agents never run `eas submit`;
- OTA publish (`eas update` on the production channel);
- turning on real WhatsApp sending;
- live payment keys;
- rotating any production secret (DB password, backup-cron secret, `CRON_SECRET`, App Key);
- deleting backups, running production SQL that writes data, creating reviewer accounts in production.

## 10. POS desktop SQLite and sync list check (2026-11-13; `main...HEAD` diff of `electron/database.ts`, `electron/services/syncService.ts`, `backend/lib/appSchema.ts`, `backend/lib/sync.ts`)
**Confirmed identical (cloud column set = POS migration list):**
- `product_reviews` (15 columns incl. `order_item_id` UNIQUE, `is_hidden`, `hidden_*`): in cloud `ALLOWED_TABLES`, in the POS pull list; POS moderation pushes via `enqueuSync` in `electron/ipc/productReviews.ts`.
- `app_password_reset_requests`, `app_banners`, `app_settings`: column sets match; all three in `ALLOWED_TABLES` and the POS pull list.
- `branches`: `latitude, longitude, delivery_eta_min_days, delivery_eta_max_days, delivery_eta_text` on both sides.
- `customer_orders`: `channel, app_user_id, assigned_agent_id, delivery_fee, payment_method, wallet_amount, delivery_otp_hash, needs_call_confirmation, estimated_delivery_date, status_history, payment_reference, invoice_id` on both sides.
- `customer_order_items` (`net_unit_price, tax_rate, tax_amount, variant_id, variant_name, product_name`), `invoices` (`source_order_id, delivery_fee`), `products` (`is_online, slug, gallery, short_description, unit, discount_pct, not_for_sale, enable_emi, is_manage_stock, sale_by, product_type`), `categories.image_url`: on both sides. The unique index on `invoices.source_order_id` is partial in SQLite and plain in MySQL (equivalent, NULLs allowed). `invoices.agent_id` already existed in the POS on `main`; the cloud adds it.
- Cloud-only by design (not in `ALLOWED_TABLES`, not in the POS database, in no POS sync list; grep clean): `app_users` (+`is_review_account`), `app_refresh_tokens`, `app_devices`, `app_email_verifications`, `app_credential_dispatches`, `wishlists`, `app_notifications`, `notification_jobs`, `email_jobs`, `app_request_receipts`, `app_addresses`, `smartbuy_join_requests` (+`purged_at`, `branch_id`), `order_payment_slips`, `stock_reservations`, `staff_assignments`, `staff_targets`, `field_visits`, `app_collections`, and the uncommitted `app_versions`. The POS reaches them only through the admin endpoints (App Access, App Requests, Sales Team).
- `REQUIRED_SYNC_PARENTS` is unchanged on this branch and needs no entry for the new tables (no FK on `product_reviews` on either side). `RELATED_KEYS` gained `product_variants.product_id`, `product_variant_stocks.product_id`, `product_attribute_values.attribute_id`. The POS has no separate push list (push is the generic `sync_queue`).

**Notes for the main dev (none blocks the deploy):**
1. The POS pull list is one long literal in `syncService.ts` (about line 755), extended by 4 names; a merge conflict there is resolved by keeping both sides' additions. **MAIN DEV TO CONFIRM** after `git fetch`.
2. Cloud `customers` has no NIC and no `outstanding_due`. The branch adds a one-time local balance reduction for a new COD payment pulled from the cloud (`isNewAppCodPayment` in `syncService.ts`). **MAIN DEV TO CONFIRM** it cannot double count with the POS's own COD flow.
3. NULL-in-NOT-NULL-DEFAULT rows (e.g. `products.unit`) stay quarantined unless the `e7e227e` fix ships; the new `products.unit` column makes this likelier.
4. Not verified: that a POS on an older version ignores the new cloud columns (the pull uses the local column list, so it should). **MAIN DEV TO CONFIRM** on one old-version PC during the staged POS release.
5. Not verified: first start of the new POS on a COPY of a real POS database (migrations are `ADD COLUMN` and `CREATE ... IF NOT EXISTS`, no data rewrite expected). **MAIN DEV TO CONFIRM.**
