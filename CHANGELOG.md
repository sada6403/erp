# Changelog

Internal release log. Not customer-facing.

## 2.6.15 — 2026-08-28 — Security batch: five fixes from the full-app QA sweep (Issues 38-41, 43)

Five security and correctness fixes found by a systematic QA sweep of the
whole application (session 18). Four are Critical. No feature changes.

**Three of these are the same bug in different places.** An `UPDATE` statement
built its `SET` clause by interpolating caller-supplied JSON *keys* into SQL, so
a key containing a `--` comment marker commented out the trailing `WHERE`
clause and rewrote **every row** in the table. It was fixed in one handler
(Issue 38), then found in four more (Issue 40) — including one reachable by a
plain Cashier. It is now fixed as a class, via a single shared guard applied at
every site, rather than handler by handler.

- **Issue 38** — `admin:users:update` no longer accepts arbitrary object keys.
  Previously a Cashier could rename and deactivate every account in the company
  in one call, locking everyone out and queueing the corruption for cloud sync.
- **Issue 40** — the same flaw in `admin:suppliers:update`,
  `admin:categories:update`, `admin:expenses:update` and
  `admin:deliveries:update`. All four confirmed exploitable before the fix; the
  deliveries one needed no administrative permission at all.
- **Issue 39** — the bootstrap `admin@pos.local` account is no longer left on
  its shipped password. A password change is now required at next sign-in, the
  Setup Wizard no longer prints the credentials, and existing installs are
  migrated — but only where the password is still the shipped default, so an
  operator who already changed it is never disturbed.
- **Issue 41** — the Deliveries and Expenses screens had no server-side
  authorization at all; any signed-in role could read and modify both. They now
  require the same permissions the UI already assumed. Delivery Staff keeps full
  delivery access.
- **Issue 43** — backup file paths were validated with a string prefix check
  that could be bypassed, allowing an arbitrary file on the machine to be
  deleted or copied out through the export dialog. Paths are now matched against
  the actual list of backups. Every backup and database-maintenance action is
  also now restricted to Company Admin.

Note for multi-role deployments: Issues 41 and 43 tighten handlers that
previously accepted any signed-in session, so roles that were reaching
Deliveries, Expenses, Backup or System Health without an explicit permission
will now be refused. This is intentional.

Verified by 95 automated checks against the real main-process handlers and a
real database, including re-running each original exploit. See `QA_REPORT.md`
and `ISSUE_TRACKER.md` (Issues 38-43) for the full diagnosis and evidence.

## 2.6.14 — 2026-08-27 — Product sync speed + delete correctness (Issue 37)

**Fixes a severe, confirmed correctness bug**: a single product delete that
conflicted with a branch's local data (e.g. a stock row, a chit redemption)
would permanently freeze that device's deletion cursor — every future sync
cycle re-hit the same conflict and silently blocked *every other pending
deletion too*, surviving even an app restart. Reproduced live against the
actual production incident (a 447-product bulk delete on natural
plantation) and confirmed the fix resolves it: 446 of 447 now apply
correctly, only the genuinely-conflicted one retries automatically until
it clears.

- `pullDeletions()` no longer stops the whole batch on one failure — every
  other pending deletion still applies, and only the specific blocked
  entry keeps retrying.
- Bulk push throughput: `BATCH_SIZE` 10→50, cutting a large bulk
  operation's push time roughly 3x (measured ~25 min → an estimated ~7 min
  for a 447-item case).
- New: a lightweight watermark check every 3 seconds so an admin's
  product/stock/category edit reaches online branches within a few
  seconds, instead of waiting for the next full ~25-30s sync cycle. The
  full cycle is unchanged and still runs as the comprehensive catch-all
  for every other table and for offline catch-up.

See `ISSUE_TRACKER.md`, Issue 37 for the full measured diagnosis and
reproduction details.

## 2.6.13 — 2026-08-26 — Device authorization & remote revocation, Phase 1 (Issue 36)

Ships the device build needed to actually exercise Phase 1's server-side
work (already deployed to the backend on 2026-08-26): a Super Admin
deactivating a POS device from the portal previously had no real effect on
an already-activated device, online or offline — this closes that gap.

- Every request now sends a per-device `x-device-id` header alongside the
  existing company API key, so a specific device can be revoked without
  affecting the rest of the company's fleet (verified live against the
  `demo` company: revoking one test device blocked only that device,
  other devices on the same company key were unaffected).
- A device now checks its own authorization on every 5-minute license poll
  and picks up a revocation while online; if offline, it can keep working
  for up to 72 hours before requiring an online re-validation.
- A revoked/expired-lease device shows a dedicated "Activation Required"
  screen (reusing the existing activation flow) — no login screen, no
  dashboard, no cached business data reachable. Local data itself is never
  auto-purged on revocation, only locked, matching this project's existing
  Clear-All-Data safety convention.
- Reactivating with a fresh valid key always starts a clean authorization
  state and forces a full re-sync, never restoring stale prior state.
- Backward compatible: a device still on an older build (not yet sending
  `x-device-id`) is unaffected by this change until it updates — same as
  any other fix delivered via the normal update mechanism.

Scope note: this is Phase 1 of a much larger architecture request. An
idempotency ledger, version/conflict detection, uninstall data cleanup,
and an observability dashboard are deliberately deferred to future
sessions — see `ISSUE_TRACKER.md`, Issue 36.

## 2.6.12 — 2026-08-24 — Login reliability fix (Issue 35)

Fixes the role-ID drift lockout recurring on an already-activated device
after a normal app update (hit natural plantation right after updating to
2.6.11 — same symptom as Issue 31 and the live recurrence found during
Issue 32a).

**Root cause**: `reconcileDefaultRolesFromCloud()` (Issue 32a's self-heal)
only ran inside `needsBootstrapPull()` (empty local `users` table), so an
already-activated device with existing data never re-checked after its
first-ever bootstrap — only a fresh install/activation got the benefit of
32a's fix.

**Fix** (`electron/services/syncService.ts`):
- Role reconciliation now runs once per app process launch, unconditionally
  — not gated behind bootstrap state.
- New `reconcileUserRolesFromCloud()`: does a full (since-epoch) fetch of
  every cloud user and self-heals any local user whose `role_id` disagrees
  with cloud's confirmed value — but only when cloud's value resolves to a
  role that actually exists locally, and always with a loud warning. This
  is the piece that actually catches this failure shape (a user pointed at
  a real-but-wrong local role), which the default-role remap alone can't.

Verified via a real (not mocked) end-to-end simulation against a scratch
copy of the affected account's data and the live backend before this
release was cut — see `ISSUE_TRACKER.md`, Issue 35.

## 2.6.11 — 2026-08-24 — Security response release

Follow-up to 2.6.10. Documents the audit and closes out the incident opened
by the parallel session's commits.

**Background**: a build containing a hardcoded `admin@pos.local`/`admin123`
universal login bypass (Electron-local, bcrypt/lockout-bypassing), a
matching cloud-side auto-seed of that same account into every tenant, and a
forgot-password fallback that issued a valid reset code for the oldest
active user regardless of the email entered, was live on the update server
from `2026-08-22T15:11Z` to `2026-08-24T09:30:52Z` (~42 hours). All three
were removed in 2.6.10 (commit `f871461`).

**This release (Issue 34) adds no code change** — 34b (credential rotation)
was skipped because the audit found no unattributed exposure. It exists to
mark the incident closed with its own version bump and deploy, matching the
version-per-incident convention already used for 2.6.10.

**Audit summary (full detail in ISSUE_TRACKER.md, Issue 34)**:
- Update-server logs show 2 external IPs fully downloaded the vulnerable
  installer during the window, plus 4 more partial/range-request fetches —
  all since confirmed by the client as known/legitimate, not unattributed
  exposure.
- No evidence found (in any reachable log) that the login-bypass or
  reset-code bugs were actually exploited — the distinctive `LOGIN_SUCCESS`/
  `superadmin_override` signature never appears in either tenant's synced
  audit history, and no forgot-password-reset events appear either. Local-
  only activity that never synced to the cloud is inherently invisible to
  this audit — that limit is real and is called out explicitly, not glossed
  over.
- No credential rotation was performed — 34b was skipped per the client's
  explicit confirmation that all identified activity is attributable to
  known, legitimate accounts.

## 2.6.10 — 2026-08-24

Issues 25–33 batch (Bills UI/invoice contrast, sync allowlist, Smart Buy
bank transfers, Clear-All-Data password gate + multi-device lock, post-clear
login fix, role-ID drift fix, emergency support access) plus the security
fix removing the backdoor described above (commit `f871461`).
