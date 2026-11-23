# Phase 2 — multilingual search keywords

Implemented behind `keywords_enabled` (default **false**). `enforce_unique_codes`
defaults to **true**. No production database migration or product rename was run.
Phases 3 onward are outside this change.

## Use

Company Admin: Settings → Search keyword settings → Enable keywords. First enable
makes a SQLite online backup, checks its integrity, then applies the additive
migration. Disabling keeps keyword data and uses the previous search behavior.
The POS Search keywords button opens management; each enabled product suggestion
offers Add my keyword. Select a product first to add its aliases.

Cashiers can manage their user scope. Existing Branch Managers with inventory
permission retain management access; explicit `keywords.manage` / `keywords.own`
flags can grant or revoke these defaults. Permissions are resolved from the
current local user/role, not renderer input. Managers can manage global, current
branch and current terminal aliases. Company Admin can review other users' drafts.
Scope ownership cannot be moved by editing a row.

Search uses NFC/lowercase/space/zero-width normalization, tolerant `aa/a` and
`ee/i`, exact/prefix/contains matches and fuzzy fallback when literal keyword
matches are absent. Match strength precedes user → terminal → branch → global →
master priority. Numeric queries use exact quick-code matches; only when absent
do they use exact SKU/barcode. `1` never partially matches `10` or `11`.
Code uniqueness checks all active local scopes plus master SKU/barcodes.

Tamil/Sinhala saves propose at most three Roman variants as **inactive pending
drafts**. They require review or an explicit manual edit; existing manual aliases
are never regenerated over. Transliteration is best effort; unknown marks produce
no guessed draft. Offline Noto Sans Tamil/Sinhala fonts and OFL licenses are bundled
under `public/fonts` and used only by keyword content.

Alias metadata stays outside the Product object. Selection returns the exact
master object; cart, invoice and print paths keep the master English name.
This phase does not activate Phase 1 name repair or rename historical masters.

## Sync and conflicts

Global/branch rows and their audits enter the existing SQLite sync outbox in the
same transaction as the edit. User/terminal aliases and their text-bearing audits
remain **local/private**; they do not roam between devices. Renderer snapshots are
scoped by cashier, branch, company/device session and refreshed on keyword/sync
events. No network request is made while typing into the POS search index.

Cloud keyword upload requires an authorized device; branch aliases must match its
branch. Private rows and hard deletes are rejected. Equal-version divergent edits,
stale edits, version gaps and independently created duplicate identities fail with
a review-required error instead of overwriting. Existing sync diagnostics retain
failed outbox items. Reconcile conflicting records on staging with an admin before
retrying; no automatic destructive conflict-resolution button is provided.
Cloud updates use server time so an offline edit cannot fall behind pull cursors.
Local pending edits are protected by the existing pull skip rule. Product
deactivation disables its aliases locally and in cloud; effective searches also
exclude inactive masters. Reactivating a product does not reactivate old aliases.

The optional cloud table is **not** created during startup. Old tenants without it
continue existing sync; keyword sync needs the staging migration and backend
deployment before enabling the desktop feature. The cloud receiver checks product
existence itself; the SQLite table additionally has an actual product foreign key.
Actual MySQL tenant/collation and two-device behavior require a configured staging
server; no real MySQL endpoint was used during this implementation.

## Backup-first staging commands (PowerShell)

Use an isolated copy, never the live application's database. From `erp`:

```powershell
npm.cmd run hub:build
$env:ELECTRON_RUN_AS_NODE='1'
.\node_modules\.bin\electron.cmd .\scripts\migrate-keywords.cjs --db C:\staging\pos-test.db --backup-dir C:\staging\backups --direction up --staging-copy
```

Repeat `up` to verify idempotence. For an empty keyword table use the same command
with `--direction down`. A populated rollback is refused: disable the feature and
retain its data. Full snapshot restore is only appropriate on a stopped staging
instance; restoring an older database would also discard subsequent sales.

Cloud test tenant only, from `erp/backend`, with MySQL connection environment
variables configured privately:

```powershell
$env:KEYWORDS_ENV='test'
$env:KEYWORDS_TEST_DATABASE='pos_keywords_test'
$env:KEYWORDS_BACKUP_DIR='C:\staging\mysql-backups'
node .\scripts\migrate-keywords.mjs up
```

The runner requires a test-named database, captures `mysqldump` before DDL and
rejects an empty/failed dump. Verify restoring that dump to a separate test tenant.
Use `down` only when the keyword table is empty; populated rollback is refused.
Both SQL migration pairs are idempotent. No existing column is altered.

## Verification and manual acceptance

Automated coverage includes normalization/native proposals, private scope isolation,
numeric exactness, 50,000-keyword search under 100 ms after warmup, master-object
identity, cloud version conflicts, migration backup/idempotence, guarded rollback,
permission checks, draft approval and product deactivation. Existing cashier
F4/F5 manual-number regression remains enabled.

Before deployment, complete on staging:

- Enable, disable, restart; confirm backup exists and ordinary billing works OFF.
- Add `1`, `arisi`, `அரிசி`, `සහල්`; select each and print: only master name appears.
- Confirm `1` excludes `10`/`11`; duplicate code warns with existing product name.
- Login as another cashier and switch company/device; private aliases disappear.
- Review/edit/remove native proposals; check keyboard navigation and offline fonts.
- Sync two devices, force concurrent edits, inspect failed-row diagnostics; confirm
  private aliases never enter cloud tables/audits and unrelated sales still sync.
- Deactivate a master, sync, then reactivate: aliases stay inactive until reviewed.
- Verify real MySQL migration/restore and schema compatibility on the test tenant.

Existing QA suites emit SmartBuy “FINDING” messages and a `credit_ledger` fixture
warning while passing. These are pre-existing findings, not resolved by Phase 2.
