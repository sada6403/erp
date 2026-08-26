# Changelog

Internal release log. Not customer-facing.

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
