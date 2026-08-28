# QA Report — Full-Application Multi-Agent Test Session

**Session:** 18 — Full-app QA sweep (2026-08-27 / 28)
**Baseline:** v2.6.14, commit `2edab76`
**Status:** Testing complete for the local-testable scope. **3 areas remain blocked** (see §7).

This is a **findings document for triage**, not a fix log. Two issues have already been fixed
and verified during the session at the client's direction (§4); everything else is documented
only. Numbered `ISSUE_TRACKER.md` rows are opened per finding, one at a time, on the client's
go-ahead — the same process as every prior session.

---

## 1. Test environment and isolation

**No real company data was touched at any point.** Evidence:

- The machine hosts a **live production install** (`%APPDATA%\pos-erp`), activated to the real
  company `natural plantation` against the production VPS, and it was **running throughout**.
  It was snapshotted at the start and treated as read-only.
- Every test ran against **throwaway `mkdtemp` SQLite databases**. The harness carries a hard
  guard that refuses to start if its data directory resolves anywhere near the live profile.
- `%APPDATA%\pos-erp\config.json` was diffed at session end: **33 keys changed**, all
  attributable to the live production app's own activity during the session — sync and licence
  cursors (`last_pull_timestamp`, `license_data.checked_at`, `last_seen_watermark`), device
  authorization state (`device_authorization_version`, `offline_authorization_expires_at`), and a
  full `auth_user` block plus `auth_token`, i.e. **a real user login occurred while the session
  was running**. None of this is QA activity: the harness stubs `electron-store` with an
  in-memory `FakeStore` and never opens that file, and no QA artifact was written into the live
  profile (checked explicitly for `qa`/`fixture`/`victim`/`evil` filenames — none present).
  An earlier draft of this report said "exactly two keys changed"; that was measured mid-session,
  before the login and licence poll, and is corrected here.
- **No network request was made to `72.61.115.222`** (or any backend) at any point. The load and
  scale work was deliberately local-only, because the VPS is shared with two live tenants.
- `npm run dev` was never run: its `predev` hook executes `taskkill /F /IM electron.exe`, which
  would have killed the client's live application.

**Test tenant status:** `qa-test-co` was **never provisioned.** It requires a SuperAdmin login on
the VPS, whose database listens on `127.0.0.1` and is unreachable from this machine. The client
is creating a temporary credential separately. This blocks the three agents in §7.

### Instrument
A harness runs the **real compiled main-process IPC handlers** against **real SQLite** in
temp directories, with only `electron` and `electron-store` stubbed — 33 modules, **379 IPC
channels**, 80 tables. It runs under `ELECTRON_RUN_AS_NODE`, so `better-sqlite3` loads at its
native ABI and **no `npm rebuild` was needed**; the repo's `node_modules` was never modified.

Two fixtures, both built through the real handlers or the real schema:

| | small | large |
|---|---|---|
| size | 1.7 MB | 112.6 MB |
| products / invoices / line items | 40 / 6 / 8 | 10,000 / 50,000 / 200,000 |
| users across every role kind | 8 (+1 seeded) | 4 |
| also | 2 branches, 5 customers, 2 discount rules, Smart Buy scheme + 3 members + 1 pending bank transfer | 4 branches, 500 customers, 20,000 audit logs |

### Coverage honesty
There is **no GUI automation in this product** (`test:e2e` points at Playwright, but no config,
no `e2e/` directory, and Playwright is not installed), and a single-instance lock prevents
running more than one app instance. **The GUI was never driven.** Findings are therefore tiered:

- **REPRODUCED** — executed, with captured output.
- **INSPECTED** — evident from code with `file:line` citations; not runtime-verified.
- **UNTESTED** — in scope, not reached. Listed by name in §7 rather than dropped.

---

## 2. Consolidated findings by severity

22 findings. One (QA-004) is closed as working-as-intended and is **excluded from the counts**.

### CRITICAL — data loss, security, or blocks core operation

| ID | Finding | Tier |
|---|---|---|
| **A-005** ✅ | **SQL injection via JSON object keys in `admin:users:update`.** A Cashier renamed and deactivated all 9 accounts in one call; a `--` in a key comments out `WHERE id=@id`. Same primitive can write any column for all rows — e.g. every `password_hash`. Corrupted rows are then queued for sync to production. **FIXED & VERIFIED (§4).** | REPRODUCED |
| **A-006** ✅ | **The A-005 injection is NOT unique to `admin:users:update` — at least 4 more handlers have the identical flaw; 3 confirmed exploitable.** `admin:suppliers:update` (4/4 rows), `admin:categories:update` (7/7), `admin:expenses:update` (3/3) each rewrote **100% of their table** from a single call, all returning `{"success":true}`. A census found **11 sites** building SET clauses from caller-supplied keys; only 2 are guarded. Reachable by Warehouse Staff, and the expenses/deliveries handlers sit behind `safeHandleModule` — a licence gate that **fails open**, with no role check at all. Census now **complete**: **4 vulnerable (all reproduced), 5 cleared as safe, 2 already guarded** of 11 sites. Worst is `admin:deliveries:update` — exploited **from a plain Cashier session**, since `safeHandleModule` is a licence gate that fails open and adds no role check. **This is why fixing A-005 alone was not sufficient. FIXED & VERIFIED as Issue 40 (§4).** | REPRODUCED |
| **B-004** | **Two terminals in one branch mint identical invoice numbers; cloud sync silently overwrites one real sale with the other.** `bill_sequences` is per-device and never synced, `invoice_number` is UNIQUE in both databases, and the push upsert is `ON DUPLICATE KEY UPDATE` — which in MySQL fires on *any* unique key, so the second sale UPDATEs the first row instead of inserting. Silent financial data loss. | **INSPECTED — needs live confirmation** |
| **A-003** ✅ | **`backup:delete` / `backup:export` containment is a bare `String.startsWith`**, bypassable by `..` traversal and by sibling-prefix (`<dir>-evil\x`). Arbitrary file deletion and arbitrary file exfiltration. Ungated (see A-004). A file outside the backup directory was actually deleted. **FIXED & VERIFIED as Issue 43 (§4).** | REPRODUCED |
| **QA-003** ✅ | **Every install ships a full-admin `admin@pos.local` / `admin123`**, never forced to rotate, printed on the Setup Wizard screen, and re-created by Clear All Data. **FIXED & VERIFIED (§4)**, with one follow-up deferred (§5). | REPRODUCED |

### HIGH / MAJOR — wrong behaviour, workaround may exist

| ID | Finding | Tier |
|---|---|---|
| **C-002** | **`chits:contributions:verify` fails OPEN.** Approve is the `else` of a single `action === 'reject'` test, so `'REJECT'`, `''`, `0`, `true` or any typo **approves and credits**. Three downstream branches test the *positive* `=== 'approve'`, so the DB says approved-and-credited while the audit log records `CHIT_CONTRIBUTION_REJECTED` and sync pushes `status:'rejected'` — a permanent local/cloud divergence on a payment. | REPRODUCED |
| **C-001** | Bank-transfer verification bypassed by any casing/spelling variant of the method string. | REPRODUCED |
| **B-005** | **Credit-bill overpayment is unlimited and unvalidated.** 100,000 accepted against a 201 bill; `paid_amount` 100,050 vs `total_amount` 201, ledger marked `paid`, no change/refund trail. Lower bounds *are* validated (0 and −50 rejected) — only the ceiling is missing. | REPRODUCED |
| **B-001** | **Previewing a bill number permanently consumes it.** `invoices:nextNumber` does a committed `UPDATE ... last_seq + 1` with no peek mode, and fires at 5 points in `POSPage.tsx` including every bill-type toggle and after every completed sale. Three previews + one sale ⇒ invoice `0004` with 0001–0003 permanently missing. **Client has flagged this for a separate session: it needs a business/legal ruling**, since gapless invoice numbering is a statutory requirement in many jurisdictions and this is a Sri Lankan deployment. | REPRODUCED |
| **B-002** | Held bills past the 20 most recent are **silently unrecoverable** — `holds:list` has a hardcoded `LIMIT 20`, no offset, no count, and the modal does no paging. 25 held, 20 returned, 5 unreachable with no warning. | REPRODUCED |
| **F-002** | **Quotations print with invoice labelling** — "Invoice No.", "Amount Paid" and a "Cash" badge on an unpaid offer, across all 7 print profiles. The stored data is correct; only the customer-facing template is wrong. | REPRODUCED |
| **F-003** | Multi-page bills print with **no repeating column headers and no row-splitting protection** on any profile. A 90-item A4/B5 bill has bare unlabelled columns from page 2 onward. | REPRODUCED |
| **H-002** | **`analytics:dailyReport` is broken on every dataset** — instant raw `Too few parameter values were provided`; the handler never executes. | REPRODUCED |
| **A-002** | `admin:auditLogs:list` has no permission gate and no branch scoping — any session reads the company-wide audit trail. Also a tamper-detection blind spot. | REPRODUCED |
| **A-004** ✅ | Every `backup:*` and `monitor:*` channel is completely ungated — a Cashier can run, list and delete backups and `VACUUM` the live database. **FULLY FIXED**: deliveries/expenses as Issue 41, `backup:*`/`monitor:*` as Issue 43. | REPRODUCED |
| **A-001** | `admin:users:list` has no permission gate — any session enumerates the branch staff directory including role names, `session_scope`, agent codes and `has_pin`. | REPRODUCED |

### MINOR — cosmetic or edge-case

| ID | Finding | Tier |
|---|---|---|
| **QA-001** | One-shot sync backfill sets its completion flag **even when the backfill throws**, permanently defeating the retry its own comment promises. Minor on fresh installs; potentially Major on upgrades (silent cloud-sync gap). Also a scale hazard — see §3. | REPRODUCED |
| **C-003** | A `null` payload crashes several `chits` handlers with raw V8 TypeErrors. `undefined` is handled; explicit `null` is not, because the default-parameter idiom doesn't catch it. | REPRODUCED |
| **QA-002** | `admin:users:create` hashes an absent password unconditionally; PIN-only staff creation works only because the renderer generates a throwaway password — in two independent places. | REPRODUCED |
| **F-001** | Issue 26's contrast fix is incomplete: `#6b7280` survives in 78/91 renders. **Correctly graded minor** — it is the `.sig` *border* colour, not body text; the text colour is properly `#4b5563`. | REPRODUCED |
| **F-004** | B5 is designable but not selectable at print time — confirms the gap Issue 23 recorded as known and out of scope. | INSPECTED |

### CLOSED — not a defect

| ID | Finding | Resolution |
|---|---|---|
| QA-004 | No discount possible when no discount rule is configured, for any role | **Working as intended** (client ruling, 2026-08-27). Retained as documentation so it is not re-raised. |

### Verified correct (checked, no defect — recorded so they are not re-investigated)
Branch spoofing by a cashier is properly rejected · stock exhaustion is enforced, including the
same product added twice in one cart · injection-shaped strings in `notes`/`agent_code` are
stored literally, not executed · `chits:purgeCancelled` leaves **no** orphaned child rows
(a suspected finding, disproved — the original count was unscoped) · cancelled schemes correctly
refuse enrol/collect/draw/toggle · double-cancel does not double-restock · a Cashier cannot
cancel a bill · totals ordering is correct on **all 91** print renders · page sizes are correct
on all 7 print profiles.

---

## 3. Scale and capacity (full detail: `H-SCALE-REPORT.md`)

Measured locally through the real handlers; **no backend load was generated**.

**Billing is fast; reporting is not.**

| Operation | small | large (50k invoices) | multiplier |
|---|---:|---:|---:|
| `reports:advancedSummary` all time | 5.28 ms | **6,645 ms** | 1,259x |
| `reports:advancedSummary` 1 year | 4.08 ms | **5,911 ms** | 1,449x |
| `analytics:topProducts` (dashboard) | 0.20 ms | **~2,250 ms** | ~11,000x |
| `analytics:profitSummary` all time | 0.94 ms | **1,615 ms** | 1,718x |
| `products:list` | 0.61 ms | 147 ms | 240x |
| POS search-as-you-type burst | 1.42 ms | 77 ms | 54x |

6 operations exceed 1 s; 14 exceed 100 ms. Core POS paths stay in single/double-digit ms.

**Root cause is one query shape.** `EXPLAIN QUERY PLAN` isolates the `invoice_items` → `invoices`
join with `GROUP BY product` at **7,667 ms** — it walks all 200,000 line items with a per-row
lookup. It underlies `topProducts` and the product-wise report sections.

**Concurrency is *not* a problem.** 20 separate processes writing to one shared database file:

| Terminals | throughput | median latency | `SQLITE_BUSY` | duplicate numbers |
|---:|---:|---:|---:|---:|
| 1 | 1,158/s | 0.48 ms | 0 | **0** |
| 20 | 812/s | 0.66 ms | 0 | **0** |

~30% throughput cost at 20 terminals, zero errors, zero duplicates. The corollary matters:
numbering is safe when terminals *share* a database, which is precisely why **B-004** — separate
devices with separate counters — is the real risk.

**Measured index win:** adding `invoices(branch_id, created_at)` made bill history **24x faster**
(29.7 ms → 1.2 ms) and costs 0.2 s to build. The schema has `branch_id` and `created_at` indexed
separately, which SQLite cannot combine.

**Two Phase-0 hypotheses were wrong and are recorded as such:** `updated_at` indexes for sync
scans made **no difference** (the predicate is low-selectivity, so a scan is correct), and
`LIKE '%term%'` product search is **fine at 10,000 products** (0.76 ms).

**Verdict.** Billing and concurrency are safe for a multi-branch chain today. **Reporting is
not** — at 50,000 invoices Advanced Reports takes 5–6.6 s and the dashboard 2.25 s. A shop doing
200 bills/day reaches 50,000 invoices in ~8 months; a 4-branch chain in ~2. **B-004 is the
blocking correctness issue** for multiple terminals per branch, independent of performance.
**Backend capacity is entirely unmeasured** and no device-count ceiling is asserted.

---

## 4. Fixed and verified during this session

Five fixes were applied at the client's explicit direction. **Neither is pushed, built as a
release, or deployed.**

**Issue 38 — A-005.** Constrains the `SET` clause to real columns via `PRAGMA table_info(users)`
(the pattern `admin:branches:update` already used), *plus* strips caller-supplied
`password_hash`/`pin_hash`/`id`/`created_at`/`synced_at` at handler entry. That second part is
load-bearing: `users` genuinely has those columns, so a PRAGMA-only filter would still let a
caller write a chosen bcrypt hash and bypass the current-password gate.

Re-running the exact exploit: **0/9 renamed, 0/9 deactivated, `WHERE` clause intact** (was 9/9).

**Issue 39 — QA-003.** Forces rotation of the seeded admin, reusing the `force_password_change`
machinery that already existed end to end. A guarded migration discriminates on
`bcrypt.compare('admin123', hash)` so an operator who already rotated is never disturbed, and
sets its one-shot flag **only on success** (QA-001's lesson). The Setup Wizard no longer prints
the password.

Two corrections were made during implementation, both caught by runtime verification that
typechecking had passed: the proposed fresh-install seed hunk was **dropped** (on a fresh DB
`seedDefaultData()` runs *before* the column exists), and the retrofit was **relocated** to run
after the column migration instead of before.

**Verification: 11 checks across 4 isolated processes, all passing** — including the critical
regression that an already-rotated admin is left untouched. The A-005 exploit re-run against the
fixed code gives **0/9 renamed, 0/9 deactivated, `WHERE` clause intact** (was 9/9).

**Typecheck:** renderer (`tsc --noEmit`) and electron main (`tsconfig.electron.json --noEmit`)
both clean. **The backend does NOT typecheck clean** — 5 errors — but they are **pre-existing and
unrelated**, verified by stashing all three source edits and re-running: identical 5 errors.
Causes: stale `.next` generated types referencing a deleted `app/api/superadmin/impersonate`
route, and `exceljs`/`pdfkit` declared in `backend/package.json` but absent from its
`node_modules` (a local-environment gap — `scripts/deploy-vps.sh` runs `npm ci`, so the VPS is
unaffected). No release build (`electron-builder`) was run.

---

## 5. Regression analysis against previously-fixed issues

**No previously-fixed issue has regressed.** Specifically:

| Prior issue | Status |
|---|---|
| Issue 28 (bank-transfer confirm/reject) | Mechanism **works**. C-001/C-002 are defects in the *verification logic* it calls, not a regression of the UI Issue 28 built. |
| Issue 26 (invoice contrast) | **Incomplete, not regressed** — F-001 is a border colour the fix did not cover; body text is correctly darkened. |
| Issue 23 (B5 print) | **Known gap confirmed unchanged** — F-004 is the limitation Issue 23 explicitly recorded. |
| Issue 21 (invoice/quotation design) | F-002 is a **coverage gap** in that review (conducted against invoice samples), not a regression. |
| Issue 13 (hold/recall) | Works. B-002/B-003 are limits of the design, not breakage. |
| Issue 11 (discounts) | Confirmed working as intended (QA-004). |
| Issue 9 (Retail↔Quotation switch) | Works. B-001 is pre-existing and merely made **easier to hit** by frictionless toggling. |
| Issues 31/32/35 (role drift, post-clear login) | No recurrence observed; the guess-fallback hardening is present in the pulled-user upsert. |
| Issue 37 (sync/delete correctness) | No recurrence. B-004 is a **different** sync defect (secondary-unique-key upsert), not a return of the deletion-cursor bug. |

---

## 6. Recommended order

1. **A-006** — **done (Issue 40).** Was top priority; A-005 is fixed, but the same primitive is live in **4 more
   confirmed-exploitable handlers**, one of them reachable by a Cashier. Scope is now exact: 4 handlers,
   all in `electron/ipc/admin.ts` (the 5 `patch` sites were checked and cleared). Fix as a *class*:
   extract the existing `PRAGMA table_info` guard into one shared `buildSafeUpdate()` helper and
   apply it at all 11 sites — patching them one at a time is exactly what let this survive Issue 38.
2. **A-005** — done (Issue 38); its fix is the template for A-006.
3. **B-004** — confirm live on `qa-test-co` the moment it exists, **and run a read-only
   `GROUP BY invoice_number HAVING COUNT(*) > 1` against both live tenants**. If duplicates
   already exist in production, this outranks everything else here.
4. **A-003 + A-004** — done (Issues 41 and 43).
5. **C-002 + C-001** — payment verification failing open, with local/cloud divergence.
6. **QA-003** — done (Issue 39). Its deferred follow-up (below) still needs scheduling.
7. **B-005** — overpayment ceiling.
8. **A-001 + A-002** — permission gates on list/audit channels. (A-004's deliveries/expenses half done as Issue 41; `backup:*`/`monitor:*` still ungated and belongs here.)
9. **F-002** — customer-facing quotation labelling; cheap.
10. **Scale**: the `invoices(branch_id, created_at)` index (measured 24x, trivial), then the Q8 join shape.
11. **B-001** — awaiting the client's business/legal ruling.
12. **B-003** — approved design (held price + change-notice + end-of-day expiry); queue as its own Issue.
13. Remainder: B-002, F-003, H-002, QA-001, QA-002, C-003, F-004.

### Deferred follow-up from Issue 39 (not yet an Issue)
`password_hash` **is** in the sync upsert allowlist and every install seeds the *same* fixed admin
id with the *same* `admin123` hash. A freshly installed device can therefore push its
default-password row up with a newer `updated_at` and overwrite a hash another device already
rotated. The per-device `force_password_change` flag does not catch this. Candidate fixes:
exclude the bootstrap admin id from the users push allowlist, or give each install a unique
bootstrap admin id — the latter collides with the fallback-`cashier_id` references in
`invoices.ts:361,555` and `sync.ts:132`, a refactor the client has explicitly deferred.

---

## 7. UNTESTED — in scope, not reached

Listed by name rather than dropped.

**Blocked on the `qa-test-co` tenant** (needs the VPS SuperAdmin credential):
- **Agent D — multi-device sync.** Product edit/delete propagation, `pullDeletions` FK recovery,
  offline→online catch-up, role reconciliation, the Issue 30 clear-event lock screen.
  **B-004's live confirmation belongs here.**
- **Agent E — auth & security paths.** Support-access token lifecycle (generate → redeem →
  expire → reuse-rejected → cross-company-rejected), the Issue 29 clear-data password gate
  end-to-end, device authorization/revocation (Issue 36), forgot-password/OTP, 2FA.
- **Agent G — backend-side concurrency.** Two devices confirming the same bank transfer, a
  support token redeemed twice concurrently, cross-device double-submit.

**Not reachable without GUI automation:** all rendering, layout, focus and keyboard behaviour;
the 5 pre-router gate screens (Data-Cleared Lock, Activation, Device Locked, Account Suspended,
Loading); the ~8 login sub-states; modal interaction across the 60 routed screens; the SuperAdmin
portal's 6 routes including the 14-modal Companies screen.

**Deliberately not executed:** any real `admin:clearAllData` success path; Delete Company;
support-token generation against a real company; anything touching `natural-plantation-1` or
`demo` beyond read-only inspection.

**Known but unexercised attack surface:** main registers **379** IPC channels while `preload.ts`
exposes ~330 — a ~49-channel gap that was never characterised as dead code vs. reachable surface.

### Measured channel coverage
Per-agent COVERED/UNTESTED lists are in `findings/*-COVERAGE.md`, generated from **evidence**
(a channel counts as covered only if its literal name appears in that agent's executed scripts
or captured logs) rather than from any agent's own claim.

| Agent | scope | covered | untested |
|---|---:|---:|---:|
| A — Company Admin | 143 | 48 (34%) | 95 |
| B — POS / Cashier | 70 | 42 (60%) | 28 |
| C — Smart Buy | 90 | 76 (84%) | 14 |
| F — Printing | 23 | 2 (9%)* | 21 |
| H — Analytics | 6 | 6 (100%) | 0 |
| **D / E / G — blocked on tenant** | **47** | **0** | **47** |
| **Total** | **379** | **174 (46%)** | **205** |

\* Understated: Agent F tested the pure template functions directly (91 rendered artifacts
across 7 profiles x 13 cart shapes) because `BrowserWindow` is stubbed, so its real coverage of
the printing surface does not show up as `printer:*` channel names. See `F-COVERAGE.md`.

**Every channel is accounted for — 0 unassigned.** Agent A's 34% is the largest genuine gap:
it owns the biggest surface (143 channels) and its run was cut short, so its findings
(including the Critical A-005) come from the ~third of its scope it reached. **The untested
two-thirds of Agent A's scope is the most likely place for further defects of the same class.**

---

## 8. Session artifacts

Individual findings, harness, fixtures and raw measurements are in the session scratchpad:
`findings/` (one file per finding, with repro steps and captured output), `harness/`
(reusable — `harness.js` plus per-agent scripts), `data/` (both fixtures + id map),
`findings/F-artifacts/` (91 rendered print artifacts + structural index).

**The harness is the reusable asset from this session**: it runs the real main-process handlers
against real SQLite with no GUI, no rebuild, and no risk to the production install, and it is
what made every REPRODUCED finding above possible.
