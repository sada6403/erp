# Mobile app progress

## Run 1
- Done: repo setup (skills copied to .claude/skills, CLAUDE.md pointer, DECISIONS.md, PROGRESS.md).
- In progress: workstream A (backend), B (mobile), C (POS desktop).
- Mocked (dev only): none yet.
- Blocked: none.
- Next: contracts, schema, auth endpoints, mobile scaffold.

## 2026-11-07, convert app order to invoice (v1.0)
- POS: `orders:convertToInvoice` (Orders page, "Convert to invoice") builds on the shared `createInvoice` core in `electron/ipc/invoices.ts`; locked prices, one invoice per order (unique `invoices.source_order_id`, `customer_orders.invoice_id`), FIFO + stock + sync reused, order moves to `ready_for_delivery`.
- Price edits need a price-edit role + reason + `APP_ORDER_PRICE_OVERRIDE` audit row. Marking the order paid later settles the invoice (`settleAppOrderInvoice`).
- Backend: `GET /agent/deliveries/:id/bill` (409 until invoiced; `bill_no` = invoice number), `AgentBillDto` contract, cloud columns in `appSchema.ts`.
- Fixed: `orders.agentsForOrder` / `assignAgent` were missing from `preload.ts` (Assign agent would have failed).
- Tests: `electron/__qa__/app-order-invoice.integration.test.ts` (6 pass), backend `npm test` 20 pass, both typechecks clean.

## How to test on your phone

Phone serial `0002205R60002053`, USB debugging on. One command reconnects it after unplugging
(sets `adb reverse` for the backend :3000 and Metro :8081, starts Metro, opens the app):

```powershell
cd mobile
.\scripts\phone.ps1          # demo mock data
.\scripts\phone.ps1 -Real    # real local backend (seeded TEST company, backend must run on :3000)
```

The dev API URL is chosen per device with no code edits: a physical phone in a dev build uses
`http://localhost:3000` (through `adb reverse`, override with `API_BASE_URL_DEVICE`); the emulator keeps
`http://10.0.2.2:3000` (`API_BASE_URL`). Release builds always use `API_BASE_URL`.

Test logins (seed data only, no real accounts):

| Role | Mock mode (Quick Login cards) | Real mode (`-Real`) |
|---|---|---|
| Customer | `0771234567` | `0771110003`, password `Test@1234` |
| Smart Buy member | `NP-1042` | `0771110001` / `NP-1`, password `Test@1234` |
| Agent | `NP-AG-204` | `AG001`, password `Test@1234` |
| First login (set password) | n/a | `0771110002`, temp password in `backend/.seed-output.json` |

Mock mode accepts any password. Real-mode values come from `backend/.seed-output.json`.

Windows native build note: the repo path is too long for CMake/ninja (260 chars), so the dev APK is built from a
short-path mirror (`C:\np`, copy of `mobile/` incl. node_modules; `android/build.gradle` and `android/app/build.gradle`
set `buildStagingDirectory` to `C:/b/<module>`). `mobile/android/` is generated and git-ignored; Metro and all JS
come from the real `mobile/` folder, so only native changes need a rebuild.

## 2026-11-10 local phone E2E (realme RMX3231, Android 11, dev build, local seeded TEST company)
Passed on the phone: login by phone number and agent code; auto-login after app restart; Smart Buy home, draws, notifications
inbox, settings (theme, language); shop browse, variant sheet, cart (survives restart), address, COD checkout (order ONL-1021),
order tracking with delivery OTP; agent dashboard, assigned delivery, OTP verify + cash confirm -> order `delivered`/`paid`, and the
customer's tracking timeline updates; wallet/statement/draw-video/spend/join screens correctly block screenshots (FLAG_SECURE).
Not covered: manager / field-officer sales-force screens (not built yet), first-login temp-password flow, register, forgot password,
Bluetooth printing, push delivery (needs FCM).
Fixed during the run:
- Order tracking screen kept showing the previous user's order and delivery OTP after Logout -> now redirects to login.
- Settings showed "(User Selectable)", "(i18n)" and hex colour codes -> removed.
- Agent commission lines showed the raw table name `chit_contributions` -> readable label from the API.
Open observations (not changed):
- `customer_orders.paid_amount` stays 0 after a COD order is marked paid on delivery (only `payment_status` changes); check how POS reports use it.
- Agent delivery card still says "Cash to collect Rs 1,050" next to "Delivered" after the cash was collected.
- Order list/notification times looked 5h30 ahead on the local PC (MySQL zone not UTC). Check the VPS zone (added to `scripts/staging/01-precheck.sh`).
- Cart promo box shows the hint "Try: PLANT2026" (not a real code, AGENTS/DECISIONS say no coupon in v1.0); search bar camera icon only shows "coming soon".
- Cart, checkout address step take ~8 s to load addresses over the dev USB tunnel; measure again on a release build.
- Production EAS profile has no `API_BASE_URL` / `APP_KEY` / `ANDROID_PACKAGE`; dev manifest has SYSTEM_ALERT_WINDOW (dev client).
Tips for driving the phone with adb: `adb shell input text` drops digits when sent fast (use keyevents with a short sleep); tapping a field
can shift the layout when the keyboard opens; secure screens return empty screencaps until the app is restarted.

## 2026-11-10 Step 2: untouched auth flows on the phone (local backend, TEST company)
| Flow | Result |
|---|---|
| First login with temp password (0771110002) | PASS: forced "Set your password" screen, mismatch shows "Passwords do not match", save clears `must_change_password` in the DB, then email step, Skip works, lands on Smart Buy home. |
| Verify email | PASS (by design): no SMTP locally, so the app shows the "email unavailable" toast and stays on the step; the code is logged by the dev server only. Real code entry needs SMTP (staging). |
| Register | PASS: client validation (name/phone/password), duplicate phone rejected, new phone creates the account and signs in as Customer. |
| Forgot password | PASS: no verified email -> `app_password_reset_requests` row `pending` + generic toast. The email-code path needs SMTP. |
| Logout / login role switching | PASS: customer -> agent (AG001) -> customer; header, tabs and data follow the role, nothing from the previous role shows. Orders screen is FLAG_SECURE (screenshots are blank by design). |

Fixed after the run: stale "Enter your mobile..." error stays after typing (login form now validates on touch); Sign Up tab said "Welcome back! Please sign in"; duplicate phone showed "This already exists." (now "This mobile number is already registered. Please sign in."); a guest tapping a product heart queued a wishlist add (401, later applied to whoever signs in next) - guests are now sent to Login. New strings are in en/ta/si (ta/si are drafts for native review).

Observations for Step 5 (design): the company name in the header is cut to "N..." (customer/Smart Buy) or "..." (agent) next to the role chip; the "Temporary password" field is not prefilled after login.
Local DB note: rows written before the UTC session switch are 5h30 ahead; for Step 4 sync checks on this local DB set `SYNC_PULL_OVERLAP_MINUTES=330` (see PRODUCTION_RUNBOOK 3a).

## 2026-11-10 Follow-ups after Step 2
- **Overlap safety:** `electron/__qa__/sync-overlap.integration.test.ts`. With `SYNC_PULL_OVERLAP_MINUTES` the cloud re-sends older copies of rows; the desktop pull skips every row that has a `pending`/`processing`/`failed` sync_queue item (generic, by table + record id), so an unsent local edit is never overwritten. The test covers every synced table whose schema a generic row can satisfy (more than 20) for all three queue states, and has a control proving normal rows still refresh. No code change was needed. A pushed edit (item gone) is safe by construction: the cloud already holds that value. A timestamp-based "local is newer" guard was deliberately NOT added: device and server clocks differ, and a device clock running ahead would block real cloud updates.
- **The 4 `[FAIL]` log lines** (`manual-e2e-scenario.integration.test.ts`, step 14) were a stale expectation, not a bug: since the voucher rework (commit e05fcb7, Aug 2026) a draw winner receives a full POS voucher, so `recordRedemption` correctly refuses ("already received a full SmartBuy voucher") and no redemption commission row is written. The scenario now asserts that behaviour; zero `[FAIL]` lines.
- **Email flows, local:** no Docker on this PC, so a small dev-only SMTP catcher (`scripts/dev/mail-catcher.cjs`; run `npm i --no-save smtp-server mailparser` in a scratch folder, then `node mail-catcher.cjs`, listens on 127.0.0.1:1025 and writes `mails.jsonl`) stands in for Mailpit. The TEST company's `branding_json.smtp` points at it (local DB only). On the phone: Verify email (wrong code -> "Wrong code.", right code -> verified) and forgot password by email code (new password works, old rejected) both PASS end to end. Found and fixed: the reset form kept the previous code/password, and the reset screen said "Welcome back! Please sign in".

## 2026-11-12 NOTE FOR THE MAIN-BRANCH DEVELOPER: POS pull bug that can ship before our merge
**Problem (affects real companies):** a new or second POS device pulls its data from the cloud. Real cloud rows can hold NULL in a
column that is `NOT NULL DEFAULT ...` in the POS SQLite schema (the real "test" company: every `products.unit` is NULL, pushed by an
earlier POS version). `SyncService.insertFiltered` then fails with `NOT NULL constraint failed: products.unit`, the row goes to
`sync_pull_quarantine`, and the device ends up with **no products** (also stocks / stock movements that depend on them). Seen on
the real "test" tenant: 89 products, 83 stocks, 82 stock movements all isolated.
**Fix:** commit `e7e227e` on `feature/mobile-app-foundation` (file `electron/services/syncService.ts` only, +18 lines): when a cloud
value is NULL/undefined and the local column is NOT NULL with a DEFAULT, skip the key so the local default applies.
Standalone patch (applies to `main`'s syncService.ts if it has not diverged): `docs/mobile-app/patches/pos-sync-null-default-fix.patch`
(`git apply --3way docs/mobile-app/patches/pos-sync-null-default-fix.patch`, or `git cherry-pick -x e7e227e` and drop the other files).
No schema change, no cloud change, safe for existing devices (only affects rows that were failing before).
**Test:** `electron/__qa__/integration-app/staging-test-company.integration.test.ts` ST-01 (needs a seed of such a tenant), or unit-test
`insertFiltered` with a `products` row whose `unit` is null. One more data note: a `product_attributes` row of the real "test" company points
at a deleted category (FK), so it stays isolated; harmless.
We did not touch `main`.

## 2026-11-13 NOTE FOR THE MAIN-BRANCH DEVELOPER: two more POS bugs that exist on `main` (real companies affected)
Both fixed in commit `79ff639` on `feature/mobile-app-foundation` (files `electron/ipc/products.ts`, `invoices.ts`, `stocks.ts` only).
Standalone patch: `docs/mobile-app/patches/pos-variant-stock-and-datetime-fix.patch` (`git apply --3way ...`, or `git cherry-pick -x 79ff639` and drop the test/doc/mobile files).
1. **Variant products never pushed their total stock row.** `products:create` / `products:update` enqueue the variant rows but not the aggregate
   `stocks` row, so the cloud (and a second POS) shows stock 0 for every product that has variants; an order for it fails with "need 2, have 0".
   Fix: call `syncStockRow(db, id, targetBranch)` after `enqueueProductVariantRows` when the product has variants. Existing products need one re-save to push.
2. **`datetime("now")` with double quotes** (6 places on `main`: 3 in `products.ts`, 2 in `invoices.ts`, 1 in `stocks.ts`). better-sqlite3 rejects double-quoted
   string literals (`no such column: "now"`), so the affected action (e.g. variant stock decrement on sale, stock-count items) throws. Fix: `datetime('now')`.
No schema change, no cloud change. Test: `electron/__qa__/integration-app/staging-catalog-seed.integration.test.ts` (phases `data` and `phone`).

## 2026-11-13 NOTE FOR THE MAIN-BRANCH DEVELOPER: POS changes for Smart Buy cash collected in the mobile app (part of the 17 Nov POS desktop release)
Agents now take Smart Buy cash in the app. The app only creates a `chit_contributions` row in status `pending_verification` (method `cash`, `collected_by_agent_id` set, receipt number `AG001-000123`). The POS already pulls that table; the branch approves it with the EXISTING `chits:contributions:verify` path. Everything below is additive; nothing existing changes behaviour. Please review these exact spots when you merge:
1. `electron/ipc/chits.ts`, **one mechanical change to existing code:** the body of the `chits:contributions:verify` handler is now a named function `verifyContribution(contributionId, action, notes)` (body unchanged, line for line) and the handler is a one-line wrapper that calls it. Reason: the new settlement approves through exactly the same code.
2. `electron/ipc/chits.ts`, **new block "App cash collections (additive)" right after that handler:** `APP_COLLECTION_WHERE` (pending + cash + has a collecting agent: the POS itself only ever makes `bank_transfer` rows pending), `reconcileAppCollectionFee()`, and two handlers `chits:appCollections:pending` and `chits:appCollections:settle` (approve the cash that was received, reject the rest with a reason, record the `agent_remittances` row; the cash received must equal the approved total). The POS recomputes the late-fee SPLIT at approval (`late_fee_applied` only; the cash amount never changes, so the remittance still matches).
3. `electron/preload.ts`: new `chits.appCollections` (`pending`, `settle`).
4. New page `src/pages/admin/AgentCashPage.tsx`; route `/admin/agent-cash` in `src/App.tsx` (behind `RequireSmartBuyAccess`); menu item "Agent Cash" under Smart Buy in `AppLayout.tsx`.
5. Tests: `electron/__qa__/app-collections.integration.test.ts` (6 tests incl. a 72-case parity run against `contributionQuote`/`cycleDueDate`) and the existing `smartbuy.integration.test.ts` still passes (102/102) after the refactor in item 1.
**POS bug found (not fixed, it is your area):** `cycleDueDate()` builds `new Date(y, m, day)` (local midnight) and reads it back with `toISOString()`, so on a Colombo desktop every monthly due date is ONE DAY EARLY (day 5 becomes the 4th) and a payment on the due day itself is charged the late fee. TIMEZONE_AUDIT.md lists the same family. The app's display port (`backend/lib/app/collectionMath.ts`) uses the intended calendar day; the parity test runs the POS with `TZ=UTC` for that reason. If you fix it (e.g. `Date.UTC(...)`), the port already agrees.

## 2026-11-13 Reservation fix + Step 6 sales force v1.0 (server, POS page, app screens)
**Reservation double-count: fixed** (54b4a40). The cloud now releases an app order's stock reservation as soon as the POS converts it (`invoice_id` set), not only at dispatch. Test RSV-01 (place -> available drops; convert -> unchanged; shelf-minus-available gap identical) passes on staging; ST-03 asserts the new behaviour. Staging runs it; production does not yet (needs the 17 Nov deploy).
**Developer note for `main`:** the variant-stock push and `datetime("now")` fixes exist on main too (commit 79ff639, standalone patch `docs/mobile-app/patches/pos-variant-stock-and-datetime-fix.patch`, see the 2026-11-13 note above).

**Sales force v1.0 scope (smaller than the ARCHITECTURE section 18 proposal, to fit 21 Nov).** Built: hierarchy (7 levels), targets with history and team roll-up, target vs achievement, field visits (GPS, outcome, offline, follow-ups), visit report for managers, POS "Sales Team" page, app Team and Visits screens. **Not in v1.0 (moved to v1.1):** salary rules / commission slabs / monthly performance job / approval chain, card payment (PayHere), reassign customers, activate/deactivate subordinates, leaderboard, alerts, statement, server reminder push (needs a scheduler: stop-and-ask item), syncing the new tables to the POS database.
**Deliberate deviations from section 18 (all in DECISIONS.md):** the new tables are cloud-only (`staff_assignments`, `staff_targets`, `field_visits` in `appSchema.ts`) and the POS manages them through admin endpoints (same pattern as App Requests), instead of synced tables; `AppRole` is not widened: a manager is an `agent` app user whose `agents` row has an active `staff_assignments` row (the app asks `GET /staff/me/dashboard`, 403 = not on the hierarchy, Team tab hidden); `invoices.agent_id` is added to the cloud so the POS push can carry the officer (older invoices fall back to `agent_code`).
**Server:** `backend/lib/app/staffLib.ts` (scope resolved from the DB on every request, never from the token; ids outside the subtree answer 404; targets only for strict descendants, audited; target rows are closed, never overwritten). Routes: `GET /staff/me/dashboard`, `GET /staff/team`, `GET /staff/{id}/performance`, `GET|POST /staff/{id}/targets`, `POST /visits`, `GET /visits/today`, `GET /visits/report`, admin `GET|POST|DELETE /admin/staff/assignments`, `GET|POST /admin/staff/targets`, `GET /admin/staff/overview`.
**Tests (staging, `sales-force.integration.test.ts`): 9/9 pass.** A 10-person hierarchy (Director > Manager > Zonal > 2 Regional > 2 Branch > 3 Field Officers) plus a plain agent: for every level own/descendant = 200, sibling, other branch, ancestor and peer = 404, set-target on a non-descendant = 404 with no row left behind, no token = 401, wrong App Key = 401, customer = 403, plain agent = 403, no salary/commission data in responses, audit rows written, target history and roll-up and override, achievement rule (cancelled ignored, wallet-paid part excluded, returns subtracted, other officer's sale ignored, old invoice credited by agent code, other month ignored), visits idempotent on `client_event_id`, GPS-missing flag, validation, follow-up cleared by a revisit, scoped visit report. The test removes its own staging rows.
**POS:** Admin > Mobile App > Sales Team (Super Admin only): tree with target vs achievement, add / move / remove person, set target with history. Typecheck clean (not yet clicked through on a running desktop app).
**App:** new Visits tab (all agents) and Team tab (only accounts on the hierarchy); Print Bill moved from the tab bar to the Earnings screen so six tabs fit. Needs `expo-location` (native rebuild). 57 jest tests, tsc and eslint clean. Tamil / Sinhala wording (`sf.*`) needs a native review.
**Staging demo data for the phone:** `DEMO-DIR` (Director) > `AG001` (Branch Manager) > `DEMO-FO1`, `DEMO-FO2` (Field Officers), targets for the current month and four `DEMO-000x` invoices. Staging only.

## 2026-11-12 Step 6 started: join requests + bank slips
Done and pushed (backend + POS + tests): `POST/GET /smartbuy/join-requests`, `POST/GET /orders/{id}/slip`, admin join-requests and payment-slips (list, image, decision), POS "App Requests" page, tests JOIN-01..04 and SLIP-01..02 (6/6 pass; JOIN-01 and SHOP-04b are no longer SKIP). Staging VPS updated (`PRIVATE_UPLOAD_DIR=/var/www/pos-staging-private`).
Mobile (code done, typecheck/lint/jest green, **not in an APK yet**): slip upload card on the order screen, agent "Add member" screen with NIC photos, `expo-image-picker` plugin. Needs one native rebuild (both ABIs).
Phone checks on the installed staging APK: wishlist add/remove and order cancel PASS (server rows confirmed). Cosmetic fix made in code: a cancelled order no longer shows ETA/progress timeline.
**Blocker:** the C: drive has ~0.4 GB free (leftover `%TEMP%\np-pos-*` test folders from earlier runs, about 6.7 GB; the sandbox refuses to delete them). The APK rebuild and the slip/join phone checks wait for that space.

## Step 6 phone checks (2026-11-12, staging APK with expo-image-picker, armeabi-v7a + arm64-v8a)
- Bank slip: order -> "Upload payment slip" -> camera photo -> "Slip received". POS reject ("Slip unclear") shows "Slip not accepted: Slip unclear" + "Upload a new slip"; re-upload then POS verify shows "Payment verified". Pass.
- Join: agent Members -> Add member (screen is capture-protected) -> name/phone/NIC + 2 camera photos -> POS list shows both photos -> approve -> the agent's list shows the new member and the request as approved. Client validation (mobile/NIC) works. Pass.
- Cancelled order: no ETA, OTP or timeline. Pass.
- Known small issues: (1) an order screen already open does not refetch the slip status until reopened; (2) "Cancel order" is still shown on a paid bank-transfer order; (3) the photo-source dialog has no title/message text; (4) Add member is visible even when Smart Buy is disabled for the company (supermarket) and then says "No open schemes".
- Test harness: `vitest.workspace.ts` integration project now runs `electron/__qa__/cleanupTemp.ts` and `globalCleanupTemp.ts`; temp folders (smartbuy-qa-*, np-pos-*, ...) created during a run are removed on success or failure. Folders from older runs (about 650 MB each) must be deleted by hand.

## 2026-11-13 (evening) Step A: Smart Buy cash collection by agents, built end to end
**Server** (`backend/lib/app/collectionsLib.ts`, `collectionMath.ts`, routes `POST /agent/collections`, `GET /agent/collections/today`, `GET /agent/collections/{id}/receipt`, members list now carries `collection` = this cycle's due, arrears, pending, last payment): scope is the agent's own members (anything else 404), idempotent on `client_event_id` (which is also the contribution id, so an offline replay is one row), receipt numbers unique per agent (`app_collections` table, UNIQUE (agent, receipt)), amount capped at the due minus what is already pending, late fee charged once per cycle inside the collected amount (POS convention: `amount = principal + fee`), member told "Payment received"; the POS approve / reject (arrives through `/api/sync/push`) tells the member "Payment confirmed" / "not confirmed" and the agent the rejection reason.
**POS:** Smart Buy > Agent Cash (bulk approve, reject with reason, cash received must equal the approved total, remittance recorded). See the developer note above.
**App:** Members screen shows each member's due, arrears, pending and last payment; Collect (prefilled with the due, partial allowed up to it); works offline through the outbox; on-screen receipt with a WhatsApp PDF (Bluetooth printing stays v1.1); "Today's collections" with count, total, cash in hand and waiting for the branch; the member statement shows Pending verification / Paid / Rejected. **Logout is refused while receipts are unsent** (the offline queue used to be wiped on logout; that would have lost cash records).
**Tests:** cloud `agent-collections.integration.test.ts` 14/14 on staging (replay = one row, other agent / other member / customer / no token / wrong key, validation, late fee once, summary, receipt scope, approve and reject round trip, achievement counts only after approval, remittance lowers cash in hand); POS `app-collections.integration.test.ts` 6/6 (parity 72 cases, accept, bulk settle with remittance totals, late-fee recompute, scope); mobile jest 65/65.
**Not in v1.0 (see RELEASE_PLAN v1.1):** managers' collections by person and by day, Bluetooth printing.
