# Changelog

Internal release log. Not customer-facing.

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
