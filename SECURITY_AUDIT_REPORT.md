# Security + QA Audit Report — POS/ERP + SmartBuy (Chit Scheme) Electron App

**Audit date:** 2026-08-11
**Scope:** Electron main process (`electron/`), IPC layer (`electron/ipc/`), local SQLite (`better-sqlite3`), self-hosted MySQL cloud sync backend, React/TypeScript renderer (`src/`), SmartBuy/Chit Scheme module.
**Auditor constraint:** No production/business data was modified or deleted. All exploit reasoning was verified against source code and, where noted, against a real (non-production) SQLite database via an automated test harness. Nothing was disabled to make a test "pass."

---

## Executive Summary

**Overall status: NEEDS IMPROVEMENT**

This audit found and fixed **20 confirmed access-control / IDOR vulnerabilities** across the IPC layer, ranging from CRITICAL (unauthenticated tenant-wipe trigger, client-trusted invoice pricing, a path-traversal LFI) to HIGH (systemic missing branch-scoping across purchasing, stock, orders, and SmartBuy agent assignment). All 20 are fixed in this codebase as of this report, verified by a clean `tsc --noEmit` and, for the Electron main process specifically, a successful cold restart of `npm run dev` with no startup errors.

The application's foundational Electron security posture is sound: `contextIsolation: true`, `nodeIntegration: false`, `webSecurity: true`, and a properly whitelisted `contextBridge` API surface in `preload.ts` (no raw `ipcRenderer` exposure). The vulnerabilities found were almost entirely at the **authorization layer inside individual IPC handlers**, not in the Electron process-isolation model itself — i.e., the "front door" is locked, but a number of "rooms" inside had no lock on them at all, trusting the renderer's word for `branch_id`, `created_by`, `opened_by`, and in one case an entire invoice's pricing.

This is **NEEDS IMPROVEMENT**, not READY FOR PRODUCTION, because: (1) several LOW/MEDIUM findings remain open by deliberate, documented decision rather than being fully remediated, (2) a production-dependency audit found 4 HIGH and 3 MODERATE known CVEs in shipped packages that have not been upgraded, and (3) the automated regression suite could not be *executed* in this environment (pre-existing, user-declined-to-fix native-module ABI mismatch — see Test Coverage) — so fixes are verified by direct source inspection and `tsc` compilation, not by a green test run.

---

## Architecture Overview

- **Client:** Electron 33 main process (`electron/main.ts`) + React/TypeScript renderer (`src/`), Vite dev server.
- **IPC:** `ipcMain.handle`/`ipcRenderer.invoke`, wrapped by `safeHandle`/`safeHandleModule` (`electron/ipc/ipcHandler.ts`) — these provide try/catch error-normalization and (for `safeHandleModule`) a license/module-key gate. **Neither wrapper enforces user permissions or branch scope** — that responsibility falls entirely to each handler individually, which is the root cause of nearly every finding in this report.
- **Local storage:** `better-sqlite3`, WAL mode, `PRAGMA foreign_keys = ON` (a real backstop for referential-integrity mistakes, confirmed active in `electron/database.ts`).
- **Cloud sync:** a self-hosted Next.js + MySQL backend (`backend/`), reached via `mysql2`; local writes are queued (`sync_queue`) and pushed every 30s. The real cloud schema lives in `backend/lib/auth.ts`'s migration array — `database/schema.sql` and `backend/lib` Postgres-syntax files are legacy artifacts, not actually executed.
- **RBAC model:** a `permissions` JSON blob per role (`perms.all`, `perms.inventory`, `perms.employees`, `perms.customers`, `perms.chits`, `perms.pos`, `perms.settings`, `perms.reports`, ...), resolved per-file via a duplicated `currentPerms()` helper pattern. `perms.all` = Super Admin / global scope.
- **Branch scoping:** the correct pattern (now applied consistently — see Fixed Issues) is to derive the acting branch from the caller's own session (`caller.branch_id`), never from a client-supplied `branch_id`, and to verify `targetRecord.branch_id === caller.branch_id` before any mutation for non-global callers.

---

## Test Coverage Summary

| Method | What it covers | Result |
|---|---|---|
| Direct source-code inspection, handler by handler | Every fix in this report | Each vulnerable code path read and traced end-to-end before and after the fix |
| `npx tsc --noEmit` (full project) | Type-correctness of every change | **PASS** — run after every batch of edits, clean throughout, final run clean |
| Electron cold restart (`npm run dev`) | Main-process changes actually load (Vite HMR does not cover `electron/`) | **PASS** — `tsc -p tsconfig.electron.json` compiled clean, app launched, no startup errors in the log |
| `npx vitest run` on new + existing integration suites | Structural correctness of regression tests | Tests **collect and are structurally valid** (14 new tests in `security-fixes.integration.test.ts`, plus the pre-existing `smartbuy.integration.test.ts`) |
| **Actual execution** of those integration tests against a real database | Runtime confirmation the fixes behave as asserted | **BLOCKED** — see below |
| `npm audit --omit=dev --json` | Known CVEs in shipped runtime dependencies | **RAN**, real findings below |
| Manual UI exploitation (typing malicious input into the running POS/Admin UI) | End-to-end confirmation via the actual renderer | **NOT PERFORMED** this session — no UI-driving harness was set up for the IPC-layer fixes in this pass |

**Why integration tests are BLOCKED, not skipped or faked:** `better-sqlite3`'s native binary in this project is compiled against Electron's Node ABI (`NODE_MODULE_VERSION 130`), not the plain Node.js runtime `vitest` executes under (`NODE_MODULE_VERSION 141` in this environment). Running `npx vitest run electron/__qa__/security-fixes.integration.test.ts` confirms this precisely:

```
Error: The module '...\better_sqlite3.node' was compiled against a different Node.js version
using NODE_MODULE_VERSION 130. This version of Node.js requires NODE_MODULE_VERSION 141.
```

The fix (`npx rebuild-better-sqlite3`) was offered earlier in this engagement and **explicitly declined by the user**, because rebuilding the native module for plain Node would break `better-sqlite3` for the live `npm run dev` Electron session until `npx electron-rebuild` is run again afterward — a system-level, hard-to-reverse action outside a routine review's blast radius. This is stated here plainly, per the audit's own rule against claiming a test passed without running it: **the 14 new regression tests and the pre-existing SmartBuy suite are written and vitest-valid, but not confirmed passing by execution.** Confidence in the fixes instead rests on direct source verification (shown per-finding below) and the clean `tsc` compile.

---

## Findings

Severity scale: CRITICAL (data breach / financial loss / full compromise) · HIGH (cross-branch/cross-user data tampering) · MEDIUM (integrity/audit gap) · LOW (defense-in-depth / accepted risk).

### FINDING-001 — CRITICAL — Path traversal in the `app-img://` custom protocol
**Location:** `electron/main.ts`, `protocol.handle('app-img', ...)`
**Description:** The handler decoded the requested path and joined it directly under the uploads directory with no containment check. A product's `image_url` (reachable via CSV/Excel import and cloud sync, not just the upload picker) containing `../../` sequences could read arbitrary files on disk via `net.fetch(pathToFileURL(...))`.
**Reproduction:** Set a product's `image_url` to a value resolving outside `uploads/` (e.g. via bulk import) and load it in the renderer.
**Impact:** Local file disclosure (arbitrary file read) from the renderer.
**Fix:** `path.resolve` the target against the uploads dir and reject with `403` unless the resolved path is the dir itself or a descendant (`filePath === uploadsDir || filePath.startsWith(uploadsDir + path.sep)`).
**Status:** FIXED. **Verification:** source read post-fix confirms the containment check is unconditional and runs before any file access.

### FINDING-002 — CRITICAL — `invoices:create` trusted client-supplied pricing and totals
**Location:** `electron/ipc/invoices.ts`, `invoices:create`
**Description:** `subtotal`, `discount_amount`, `tax_amount`, `total_amount`, and every line item's `unit_price`/`tax_rate`/`line_total` were taken directly from the IPC payload. A modified renderer (or a direct IPC call, since `contextBridge` only restricts the *official* API surface, not a determined attacker with devtools access) could sell any product at any price, including negative totals.
**Impact:** Direct financial loss, credit-limit bypass (checked against the *claimed* total, not the real one), inventory/accounting mismatches.
**Fix:** Server now recomputes every line from `products.selling_price`/`tax_rate` read fresh from the DB, rejects a client `unit_price` that doesn't match within 0.01, and recomputes `subtotal`/`discount_amount`/`tax_amount`/`total_amount`/`due_amount` server-side. The one legitimate feature preserved: a manager's whole-bill discount beyond item-level discounts, computed as the portion of the claimed discount beyond the server-recomputed item-level discount total. Existing per-item/global discount-percentage caps (`resolveMaxDiscountPct`) were verified intact and unchanged.
**Status:** FIXED. **Verification:** confirmed no legitimate "custom price override" UI feature exists anywhere in the POS Cart components (grepped for `custom.?price|override.*price` — no matches), so the fix cannot break a real feature.

### FINDING-003 — CRITICAL — `admin:forceReset` had no real re-verification before wiping local data
**Location:** `electron/ipc/admin.ts`, `admin:forceReset`
**Description:** This handler is meant to fire automatically when the cloud confirms a tenant/license is gone (anti-piracy), but as an IPC-exposed channel it could be invoked directly with no server-side confirmation that the trigger condition was real.
**Fix:** The handler now independently re-verifies against the cloud API (using server-stored credentials, not renderer input) that the tenant genuinely returns `401` before proceeding; if the cloud can't be reached or doesn't confirm, the reset is refused.
**Status:** FIXED — without disabling the legitimate automatic flow (a `perms.all` gate would have been semantically wrong here, since the trigger must fire regardless of which role happens to be logged in).

### FINDING-004 — CRITICAL — `admin.ts` user-management handlers missing branch scope + self-protection
**Location:** `electron/ipc/admin.ts` — `admin:users:toggleActive`, `admin:users:resetPassword`, `admin:users:forcePasswordChange`
**Description:** A Branch Manager with `perms.employees` (not `perms.all`) could disable, reset the password of, or force a password change on **any** user system-wide, including users in other branches and the seeded Super Admin account.
**Fix:** New shared `assertCanManageUser(id)` helper: verifies the target exists, blocks any non-Super-Admin caller from touching the seeded Super Admin account, and blocks cross-branch targeting for non-global callers.
**Status:** FIXED.

### FINDING-005 — CRITICAL — `loyalty:adjust` had no permission gate and trusted a spoofable `created_by`
**Location:** `electron/ipc/loyalty.ts`
**Description:** Any authenticated session could add or remove arbitrary loyalty points for any customer, with the acting user for the audit trail taken from the payload instead of the real session.
**Fix:** Added `perms.all || perms.customers` gate, input validation (finite non-zero points, non-empty note), replaced `payload.created_by` with `caller.id`, added `logAudit`.
**Status:** FIXED.

### FINDING-006 — CRITICAL — `backup:export` path traversal
**Location:** `electron/ipc/backup.ts`
**Description:** `backup:delete` already had a containment check restricting operations to the backup directory; `backup:export` did not, allowing a save-path outside it.
**Fix:** Applied the identical `filepath.startsWith(backupDir)` check before the save dialog completes.
**Status:** FIXED.

### FINDING-007 — HIGH — `customers:update` had no permission or branch check, and accepted arbitrary fields
**Location:** `electron/ipc/customers.ts`
**Fix:** Added `perms.all || perms.customers` gate, branch-ownership check, and a field whitelist (`name, phone, email, address, nic, notes, credit_limit`) instead of blind mass-assignment.
**Status:** FIXED.

### FINDING-008 — HIGH — `invoices:hold` performed a blind UPDATE with zero prior lookup
**Location:** `electron/ipc/invoices.ts`
**Fix:** Added invoice lookup, not-found guard, and branch check.
**Status:** FIXED.

### FINDING-009 — HIGH — `invoices:cancel` / `approveCreditBill` / `addCreditPayment` / `convert` missing perm or branch checks
**Location:** `electron/ipc/invoices.ts`
**Fix:** `approveCreditBill` — added manager gate + branch check (creator≠approver check already existed). `addCreditPayment` — added `amount > 0` validation + branch check. `cancel` — added a manager-or-own-quotation check + branch check. `convert` — added branch check.
**Status:** FIXED.

### FINDING-010 — HIGH — `returns:create` had no branch check, trusted client `unit_price`, and had no cap on repeat returns
**Location:** `electron/ipc/returns.ts`
**Description:** The same `invoice_item_id` could be returned/restocked repeatedly with no server-side limit, and the refunded amount came from the client instead of the real sale price.
**Fix:** Branch check against the invoice's real branch; per-line `unit_price` re-derived from `invoice_items`; an "already returned" sum query caps total returned quantity at what was actually sold; `created_by` replaced with the real session id; `logAudit` added.
**Status:** FIXED.

### FINDING-011 — HIGH — `returns:cancel` missing permission/branch check
**Location:** `electron/ipc/returns.ts`
**Fix:** Manager gate, branch check via the linked invoice, already-cancelled guard, audit log.
**Status:** FIXED.

### FINDING-012 — HIGH — Cash register open/close: spoofable actor, no branch/ownership check
**Location:** `electron/ipc/cashRegister.ts`
**Description:** `cash:open`/`cash:close` trusted client-supplied `opened_by`/`closed_by`, and any cashier could close a colleague's still-open drawer from any branch.
**Fix:** Actor always taken from the authenticated session; branch check added to both; `cash:close` now requires the original opener or a manager; `logAudit` added to both.
**Status:** FIXED.

### FINDING-013 — HIGH — `branchTransfers.ts` — module-wide missing branch scoping
**Location:** `electron/ipc/branchTransfers.ts`
**Fix:** New shared `requireBranch(...branchIds)` guard requiring `perms.inventory` and caller-branch membership in at least one of the transfer's branches; applied across `create`, `updateStatus`, `reportMismatch`, `receive`; `resolveMismatch` restricted to `perms.all` (admin-only reconciliation).
**Status:** FIXED.

### FINDING-014 — HIGH — `stocks.ts` — multiple handlers missing branch scoping and/or audit trail
**Location:** `electron/ipc/stocks.ts`
**Description:** `stocks:adjust`, `stocks:updateTransfer`, `stocks:transfer` had no branch check; `stockCounts:create/updateItem/finalize/cancel` had little-to-no permission, branch, or audit coverage — `stockCounts:finalize` in particular overwrites real stock quantities directly.
**Fix:** Branch checks added throughout (note: `stocks:adjust` deliberately kept ungated on *permission*, per an existing in-code design comment explaining it also fires automatically on every product-form save — only the branch check was added there, to avoid breaking that flow); `perms.inventory` gate added to `stockCounts:create`/`finalize`; session+branch check added to `stockCounts:updateItem`/`cancel`; `logAudit('STOCK_COUNT_FINALIZED')` added.
**Status:** FIXED.

### FINDING-015 — HIGH — `batches.ts` — `update`/`consume` had zero access control
**Location:** `electron/ipc/batches.ts`
**Description:** Any authenticated session could overwrite any product batch's quantity/cost, or deplete any batch's quantity, regardless of branch — with no audit trail on any of `create`/`update`/`consume`.
**Fix:** `perms.inventory` gate + branch-ownership check added to `update` and `consume`; `create` gained an explicit permission gate (previously implicit) plus `logAudit`; all three now write `logAudit` (`BATCH_CREATED`/`BATCH_UPDATED`/`BATCH_CONSUMED`).
**Status:** FIXED. **Regression test:** `security-fixes.integration.test.ts` — "batches:update/consume rejects a Branch B caller acting on a Branch A batch."

### FINDING-016 — HIGH — `products:delete` missing branch-ownership check
**Location:** `electron/ipc/products.ts`
**Description:** A Warehouse Staff account (`perms.inventory`, no `perms.all`) could deactivate any product system-wide, including products explicitly tagged to a different branch — inconsistent with `products:update`, which requires a Company-Admin-approved edit request for the exact same class of user.
**Fix:** Added a branch-ownership check mirroring the read-path convention already used elsewhere in the file (`p.branch_id = ? OR p.branch_id IS NULL`): a non-admin may only deactivate a product tagged to their own branch.
**Status:** FIXED. **Regression test:** `security-fixes.integration.test.ts` — "products:delete rejects deactivating a product tagged to another branch."

### FINDING-017 — HIGH — `purchases.ts` — branch trust and missing validation across create/updateStatus/update
**Location:** `electron/ipc/purchases.ts`
**Description:** `purchases:create` trusted a client-supplied `branch_id` outright (no permission gate at all beyond the license-module check); `purchases:updateStatus` had no permission/branch check for the `SENT`/`CANCELLED` transitions (only `RECEIVED`/`PARTIAL` were gated); `purchases:update` (draft PO edits) had no permission/branch check and, unlike `purchases:create`, **accepted zero or negative quantity/unit cost with no rejection**.
**Fix:** `perms.inventory` gate + own-branch-only enforcement added to `create` (client `branch_id` is only trusted for `perms.all`); `updateStatus` and `update` both gained the same gate + branch check; `update` now validates `product_id`/positive quantity/positive unit cost identically to `create`.
**Status:** FIXED. **Regression tests:** 3 tests covering branch-spoof rejection, cross-branch status-update rejection, and zero-quantity rejection.

### FINDING-018 — HIGH — `orders.ts` — branch trust + mass-assignment into raw SQL column list
**Location:** `electron/ipc/orders.ts`, `orders:create` / `orders:updateStatus`
**Description:** Two separate issues. (1) `orders:create` trusted a client-supplied `branch_id`, and neither handler had any permission check at all — no `logAudit` import existed in the file. (2) `orders:updateStatus(id, status, details)` did `const patch = { status, ...details }` and then built the `UPDATE` column list from `Object.keys(patch)` — **any key present in the caller-supplied `details` object became a column in the SET clause**, meaning a caller could overwrite *any* column on the order (`branch_id`, `customer_id`, `total_amount`, `paid_amount`, etc.) via mass assignment, not just the intended status-transition metadata fields.
**Impact:** A cashier-level session could silently rewrite an order's branch attribution or financial totals.
**Fix:** `perms.employees || perms.pos` gate + own-branch enforcement added to `create`; `updateStatus` gained the same gate, a branch-ownership check against the real order row, and — the core fix — a strict whitelist (`ORDER_UPDATE_ALLOWED_FIELDS = ['notes','delivery_date','payment_status','paid_amount']`) so only those four keys are ever read out of `details`, regardless of what else the caller sends. `logAudit` added to both handlers.
**Status:** FIXED. **Regression tests:** branch-spoof rejection on create, cross-branch rejection on updateStatus, and a direct test asserting a malicious key in `details` cannot mutate `total_amount`.

### FINDING-019 — HIGH — SmartBuy: wrong-branch `agent_id` acceptance in member enrollment
**Location:** `electron/ipc/chits.ts`, `chits:members:add` and `chits:members:registerHistorical`
**Description:** A non-agent-scoped caller (ordinary staff/manager) could pass an arbitrary `agent_id` with no validation that the agent belonged to the enrolling branch — letting an agent from a completely different branch earn commission on a member they never touched. (Contrast: `chits:agents:remittances:record` already validated this correctly via `assertBranchScope`.)
**Fix:** Both handlers now look up the target agent and reject (`Selected agent does not belong to this branch`) if the agent has a branch and it doesn't match the enrolling branch. The existing Agent-portal self-scoping (`resolveScopedAgentId`) is untouched — this check only applies when a staff caller is choosing an agent on someone else's behalf.
**Status:** FIXED. **Regression test:** `security-fixes.integration.test.ts` — "chits:members:add rejects an agent_id that belongs to a different branch."

### FINDING-020 — HIGH — Commission self-approval by a staff account linked to an agent
**Location:** `electron/ipc/commissions.ts`, `commissions:ledger:approve` / `reject` / `markPaid`
**Description:** The existing `resolveScopedAgentId(caller)` check correctly blocks an Agent-portal session from approving/rejecting their own commission line, but did **not** check whether a normally-logged-in staff user (Branch Manager, or even Super Admin) whose login happens to also be linked as `agents.user_id` could approve, reject, or mark-paid a commission line where they themselves are the registration/sales agent.
**Fix:** New `callerLinkedAgentId(db, caller)` helper resolves whether the caller's own user id is linked to an agent; all three mutation paths (`approve`, `reject`, `markPaid`) now reject/skip when the ledger line's agent matches the caller's own linked agent id.
**Status:** FIXED. **Regression test:** `security-fixes.integration.test.ts` — approve and reject both rejected for a self-linked agent.

### FINDING-021 — MEDIUM (documented, unchanged by design) — `chits:contributions:record` duplicate-payment guard is cycle-scoped only
**Location:** `electron/ipc/chits.ts`
**Description:** The "already fully paid" guard only runs when `payload.cycle_no` is supplied; a contribution recorded with no `cycle_no` bypasses it entirely.
**Analysis:** This is confirmed, but is **explicit, documented, intentional business logic** — a contribution with no cycle number (e.g. `registerHistorical`'s backdated initial payment) is not claiming to be "for" any specific cycle, so there is nothing to duplicate-check against. It is not an access-control bug; every caller reaching this code already passed the `canManage`/branch checks.
**Status:** ACCEPTED — not a vulnerability, no code change made.

### FINDING-022 — LOW (accepted) — No upper sanity cap on `chits:contributions:record`'s `amount`
**Description:** Overpayment is designed to convert to `credit_balance`, but there is no ceiling on a single entry. A typo (extra zero) could create a large stray credit balance.
**Analysis:** Only `canManage`-authorized staff/agents can reach this handler — this is a data-entry safety concern, not an authorization vulnerability. Any fixed cap risks rejecting a legitimate large lump-sum payment (e.g. a customer settling several cycles at once).
**Status:** ACCEPTED RISK — recommend a UI-level confirmation dialog above a configurable threshold rather than a hard server-side cap, as a future enhancement.

### FINDING-023 — LOW (accepted) — `sandbox: false` in `BrowserWindow.webPreferences`
**Location:** `electron/main.ts:105`
**Description:** The renderer's OS-level sandbox is disabled. `contextIsolation: true` + `nodeIntegration: false` remain the primary and effective boundary (confirmed: `preload.ts` only exposes an explicit, whitelisted `window.api` surface via `contextBridge`, never raw `ipcRenderer`).
**Status:** ACCEPTED — flagged for future hardening; not fixed this session since enabling `sandbox: true` can require preload-script changes (some native/File-System APIs behave differently) that need dedicated regression testing beyond this audit's scope.

### FINDING-024 — LOW (accepted) — No `will-navigate` handler
**Location:** `electron/main.ts`
**Description:** Only `setWindowOpenHandler` is present (correctly denies popups, routes `http(s)` to `shell.openExternal`). No handler blocks in-place navigation of the main window itself.
**Analysis:** The app only ever loads its own bundled content (`loadURL` to the dev server in dev, `loadFile` to the bundled `index.html` in production) — there is no code path that would navigate the main window to an untrusted URL, so the practical risk is minimal.
**Status:** ACCEPTED — recommend adding a `will-navigate` handler that denies navigation outside the app's own origin as defense-in-depth.

### FINDING-025 — LOW (accepted) — `reports:openFile` uses unvalidated `shell.openPath(filePath)`
**Location:** `electron/ipc/reports.ts`
**Description:** No path containment check, unlike `backup:export`/`backup:delete`.
**Analysis:** The only caller (`AnalyticsPage.tsx`) always passes a path the user just chose via a native save dialog in the same session — restricting it would break the legitimate "export anywhere, then open" flow, and `shell.openPath` does not execute the file, only opens it with the OS default handler.
**Status:** ACCEPTED RISK.

### FINDING-026 — Dependency audit (production only)
**Command run:** `npm audit --omit=dev --json` (fresh run against this checkout, not a cached earlier result)
**Result:** 0 critical, **4 high**, **3 moderate**, 0 low — 7 total.

| Package | Severity | Issue |
|---|---|---|
| `xlsx` | HIGH | Prototype pollution in SheetJS; ReDoS |
| `fast-uri` | HIGH | Host confusion via backslash/IDN authority parsing |
| `js-yaml` | HIGH | Quadratic-complexity DoS via merge-key/alias handling |
| `nanoid` | HIGH | Non-cryptographic ID generator can loop indefinitely with a negative size |
| `react-router` / `react-router-dom` / `@remix-run/router` | MODERATE | Open-redirect via protocol-relative/backslash paths; arbitrary constructor injection in SSR error deserialization (this app does not use React Router SSR, reducing that specific sub-finding's relevance) |

**Risk assessment:** `xlsx` is the most relevant one in this app specifically — it powers the product/customer bulk import feature, which parses user-supplied `.xlsx` files, i.e. untrusted input reaches a package with a known prototype-pollution issue. `js-yaml`/`fast-uri`/`nanoid` are most likely transitive (pulled in by build tooling or a sub-dependency) rather than directly exercised by application code reachable from the renderer, but were not individually traced to confirm zero runtime reachability in this pass.
**Status:** **OPEN — not fixed this session.** Upgrading `xlsx` in particular can be a breaking change to the import feature's behavior; blindly running `npm audit fix --force` mid-audit risks an unverified regression in a financial-data-adjacent feature. **Recommendation:** schedule a dedicated dependency-upgrade pass with import/export regression testing, prioritizing `xlsx` first.

---

## Security Matrix

| Category | Tested | Passed | Failed (found) | Status |
|---|---|---|---|---|
| Authentication | Yes (source review: `auth.ts`, session/JWT/PIN/2FA flows) | Yes | 0 new findings this pass | PASS |
| Authorization / RBAC | Yes (handler-by-handler across `electron/ipc/`) | Partial | 20 (all fixed) | FIXED |
| Electron IPC / process isolation | Yes (`main.ts` webPreferences, `preload.ts` contextBridge surface) | Yes | 1 LOW (`sandbox:false`, accepted) | PASS (with noted accepted risk) |
| Multi-Branch access control | Yes (systemic sweep) | Partial | 12 of the 20 findings were branch-scoping gaps specifically | FIXED |
| POS (invoices/pricing/stock) | Yes | Partial | FINDING-002 (critical, fixed); atomic stock-decrement (`WHERE quantity >= ?`) and discount caps confirmed already safe | FIXED |
| SmartBuy / Chit Scheme | Yes | Partial | FINDING-019, 020 (fixed); FINDING-021, 022 (accepted, not bugs) | FIXED |
| Financial Logic | Yes | Partial | FINDING-002, 018 (fixed) | FIXED |
| Database (SQLite integrity, FKs) | Yes (`PRAGMA foreign_keys=ON` confirmed active) | Yes | 0 | PASS |
| SQL Injection | Yes (grepped all `.prepare()`/`.exec()` calls with template-literal interpolation) | Yes, with 1 mass-assignment exception | FINDING-018 (fixed — not classic string-concatenation SQLi, but an equivalent column-list mass-assignment hole) | FIXED |
| XSS / Input Injection | Reviewed for dangerouslySetInnerHTML / unescaped renders in earlier phase of this engagement | — | No new findings this pass | NOT RE-TESTED THIS PASS |
| File Security (path traversal, arbitrary access) | Yes | Partial | FINDING-001 (critical, fixed), FINDING-006 (critical, fixed), FINDING-025 (accepted) | FIXED |
| Audit Logs | Yes (confirmed immutable — no `audit_logs:update`/`delete` IPC channel exists; the only `UPDATE audit_logs` statements in the codebase are branch/user-deletion FK-cleanup, not general edits) | Yes | Several handlers were missing `logAudit` calls entirely (returns, cashRegister, batches, orders, loyalty) — all now added | FIXED |
| Concurrency / Race Conditions | Reasoned about (Electron main process is single-threaded/synchronous per better-sqlite3 call; no `await` exists between the `chits:contributions:record` balance check and its transaction, so no real TOCTOU window exists there despite first appearances) | Yes | 0 confirmed races | PASS |
| Backup / Restore | Path-traversal fixed (FINDING-006); an actual restore-from-backup was **not** performed this pass | — | — | NOT TESTED (restore) / FIXED (export path traversal) |
| Dependencies | Yes — fresh `npm audit --omit=dev` run | No | 7 (4 high, 3 moderate) | **OPEN** |
| Performance | Not load-tested this pass | — | — | NOT TESTED |

---

## Fixed Issues (this report)

001, 002, 003, 004, 005, 006, 007, 008, 009, 010, 011, 012, 013, 014, 015, 016, 017, 018, 019, 020 — see Findings above for full detail. In short: an LFI, a client-trusted-pricing hole, an unauthenticated destructive-reset trigger, and a systemic pattern of missing branch/permission checks across purchasing, stock, batches, products, orders, returns, cash register, branch transfers, and SmartBuy agent assignment — plus a commission self-approval loophole.

## Remaining Risks (open, by decision)

- **FINDING-026 (dependency CVEs)** — 4 HIGH, 3 MODERATE, in production dependencies (`xlsx`, `fast-uri`, `js-yaml`, `nanoid`, React Router family). Not upgraded this session — recommend a dedicated pass.
- **FINDING-023 (`sandbox:false`)** — accepted, flagged for future hardening.
- **FINDING-024 (no `will-navigate` handler)** — accepted, low practical risk given the app never loads remote content.
- **FINDING-025 (`reports:openFile`)** — accepted, matches its one legitimate call site's usage pattern.
- **FINDING-021/022 (SmartBuy contribution edge cases)** — confirmed not to be vulnerabilities; documented as intentional design / acceptable data-entry risk respectively.
- **Test execution gap** — the new and pre-existing integration suites cannot run in this environment until `better-sqlite3` is rebuilt for plain Node (user-declined this session, for the stated reason). Fixes are verified by direct source inspection + `tsc`, not by a green test run.
- **Two scope boundaries already decided earlier in this engagement, reaffirmed here rather than re-litigated:** (a) consolidating phone/email/NIC validation across `customers.ts`/`admin.ts`/`agents.ts` was explicitly declared out of SmartBuy-module scope; (b) a full fixed-decimal money-precision replatform was explicitly declined as too broad / high regression risk for the value delivered.
- **Not re-tested this pass:** XSS/input-injection sweep and performance/load testing — both were covered in an earlier phase of this same engagement (per prior findings already fixed before this report's fix set began) but were not re-run fresh in this session; no new findings are claimed for them here.

---

## Final Score: 68 / 100

**Rationale:** Strong foundational Electron process-isolation model (+), a large, systemic authorization gap across the IPC layer that is now fixed (+, but its prior existence is why the score isn't higher), one class of vulnerability (client-trusted financial data) that was genuinely critical (−), 7 open dependency CVEs including one in a package that parses untrusted user input (−), and a real gap in this session's ability to prove the fixes via automated test execution rather than source review alone (−). This is a deliberately non-inflated score: the fixes are real and verified by the strongest means available in this environment, but "verified by reading the code and getting a clean compile" is a lower bar than "verified by a green CI run," and the dependency debt is real and unaddressed.

## Production Readiness: **READY AFTER MINOR FIXES**

The CRITICAL and HIGH findings that represented genuine exploitable holes (LFI, price tampering, tenant-wipe, systemic branch-scoping gaps) are fixed and typecheck-clean. Before shipping this specific fix set to production, at minimum:
1. Run the new regression suite for real (rebuild `better-sqlite3` for plain Node in a throwaway environment, or add a CI job on Electron's own Node ABI) to convert "verified by reading" into "verified by execution."
2. Address the `xlsx` HIGH-severity CVE specifically, given it's reachable from user-supplied import files.
3. Manually smoke-test the highest-blast-radius fix (`invoices:create`'s server-side price recomputation) against real product data in a staging environment before the next production deploy, since POS_ERP's deploy pipeline pushes straight to production with no staging gate.

---

## Summary

- **Total findings investigated:** 26
- **Fixed:** 20 (all CRITICAL and HIGH severity findings)
- **Accepted risk / by-design, no code change:** 5 (FINDING-021 through 025)
- **Open, unresolved:** 1 (FINDING-026 — dependency CVEs)
- **Severity breakdown of fixed findings:** 6 CRITICAL, 14 HIGH
- **Blocked:** automated test *execution* (not test *writing*) — pre-existing environment constraint, user-acknowledged
- **Not tested this pass:** performance/load testing, live backup-restore, fresh XSS sweep, manual UI-driven exploitation
- **Final score:** 68/100
- **Production readiness:** READY AFTER MINOR FIXES
