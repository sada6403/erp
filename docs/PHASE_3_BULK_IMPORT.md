# Phase 3 — Bulk Import v2

Additive extension of the existing importer, behind `bulk_import_v2_enabled`
(default **OFF**). The legacy `products:importExcel` and furniture preview APIs
remain available. No production DB migration, live import or deployment was run.
The expiry/alert rollout in Phase 4 is not enabled by this phase.

## Operator workflow

Open Products → **Bulk Import v2**, or Settings → **Bulk Import v2 settings**.
Company Admin first enables the feature in its Admin settings tab. Initial enable
backs up SQLite with its online backup API, opens the backup read-only and requires
`integrity_check = ok` before creating the three new tables.

1. Choose a type and download its UTF-8 BOM CSV header template.
2. Choose XLSX/XLS/CSV/TSV, a sheet and the header/first-data row. Preview 20 rows.
   CSV/TSV shows detected encoding, repair warnings and an encoding override.
   Delimiter override supports comma, semicolon, tab and pipe. XLS/XLSX cells are
   already decoded; mojibake is not automatically reinterpreted in workbook cells.
3. Each file column shows its header/sample values beside a system-field dropdown.
   Keep/edit suggestions or Ignore it. Required fields must be mapped or defaulted;
   one column cannot fill two destinations. Save/reuse/delete named mappings.
   Saved mappings remap by header name; inspect them before use on another file.
   Defaults fill blank/unmapped cells. To map a whole unknown category/supplier
   column to one known master, Ignore that source column and set the exact master
   name as the field default. This is not a per-value synonym dictionary.
4. Select duplicate policy, unknown-reference policy, explicit date/decimal format
   and optionally name splitting. Dry run persists normalized rows, original rows,
   warnings/errors, target preimages and a validation token. Inspect normalized
   preview and download the UTF-8 BOM, formula-safe error/warning CSV.
5. Explicitly acknowledge the preview and commit. Commit is bound to that review
   token; remapping invalidates it. Valid-rows mode uses chunk transactions and
   durable per-row progress. All-or-nothing uses one transaction (up to 2,000 rows).
6. See progress and history; interrupted jobs resume only unapplied rows. Closing
   the modal does not cancel a running import. Open history to resume/poll it.

## Registry and business behavior

`electron/lib/importRegistry.ts` holds fields, required flags, aliases, field kinds,
permissions and default options. Field kinds drive common numeric/date validation;
`importValidation.ts` implements database/business validators. `importWriter.ts`
registers each built-in row handler and the grouped receipt handler. Add a registry
entry, its business validator/writer and tests when adding another type.

| Type | Behavior / permissions |
| --- | --- |
| Master products | Company Admin only. Explicit Skip/Update/Error for existing SKU. New products start with zero stock. Prices cannot be negative; tax is 0–100. SKU/barcode/code collisions are validated against DB and file. |
| Opening stock | Requires `import.stock` and existing manual-stock branch access. **Adds** quantity to the current branch; it never sets an absolute stock balance. Creates separate existing-model batch layers and an ADJUSTMENT movement. |
| Stock-in / supplier receipt | Requires `import.stock` plus existing main-branch procurement access. Uses `createStockPurchase`, mandatory uploaded supplier bill and existing receipt price/stock/batch rules. One supplier invoice/date per file, maximum 2,000 rows, committed atomically as one receipt. Create/map the supplier before importing its invoice. |
| Price update | Company Admin only; map at least one price and select Update for existing records. |
| Search keywords | Company Admin only. Global/branch/terminal/user scopes use the existing keyword service, review rules, duplicate policy and code checks. Enable Keywords first. |
| Categories / suppliers | Company Admin only. Existing names use Skip/Update/Error; unknown references on product import may be auto-created by Admin, mapped via defaults or skipped. |
| Brands | Company Admin only. Updates the existing `products.brand` for a mapped SKU. This app has no separate brand master; no second brand table is introduced. |

Customers are optional in the original brief and are not registered here.
`import.products` and `import.stock` appear in the existing role/user editors.
Granting `import.products` alone does not bypass the Company Admin rule. Stock
permission also does not bypass existing branch/procurement restrictions.

Stock columns include `batch_no`, `expiry_date`, quantity, cost and stock/purchase
date. Supplier receipts target the resolved main branch, including when Company
Admin is signed in at another branch, matching the existing procurement service.
Opening stock targets the current terminal/user branch. The dry run shows its target
branch before commit. If a product already has `track_expiry`, its expiry is required. This phase
does not add that product flag or turn on FEFO/expiry alerts. Opening dates default
to the shop's Asia/Colombo date; supplier purchase dates must be supplied explicitly.
Three date formats are supported: YYYY-MM-DD, DD/MM/YYYY and MM/DD/YYYY, with a
four-digit year. Numbers use explicit dot/comma decimal rules and six-digit quantity
precision. XLSX uses displayed cell text, so verify long numeric codes and format
date columns to match the chosen format; store leading-zero identifiers as text.

Optional name splitting reuses Phase 1 encoding/name utilities. Latin parentheses
such as `Baby Soap (Pink)` remain. Tamil/Sinhala text becomes imported aliases with
review-required Roman drafts. Garbled/lost aliases are refused or omitted with a
warning. New imported names must be Latin; renaming a product referenced by existing
invoice items is refused because old reprints join live master names. Historical
names and the other existing product create/update APIs are not cleaned here.

## Durability, sync and duplicate prevention

`import_jobs`, `import_job_rows` and `import_mapping_templates` are local per-company
staging/history tables. Source bytes and rows survive restart. They are not sent
through unrestricted company sync, particularly because private aliases may be
present. Committed business rows/audits use the existing sync outbox in the same
SQLite transaction. Master/reference events precede new alias events.

The same file bytes + sheet + import type + branch can start only one commit.
Changing mapping/options or uploading it from another cashier does not bypass that
guard. Resume the original job. To intentionally receive another delivery, use its
own source invoice/batch data; renaming an unchanged file is insufficient. Existing
supplier invoice checks provide an additional duplicate guard.

Each chunk rechecks current session/permissions/settings and live dependencies.
Only the original importing user may edit/commit/resume its staged job; Company
Admin can inspect history and perform an eligible rollback for another user.
Product/reference changes since validation stop the job; committed chunks stay
visible as partial history. Retry never replays applied rows. A partially applied
job cannot be remapped; resolve the reported conflict or use eligible rollback.
All-or-nothing runtime failures roll back its entire business/outbox transaction.

Defaults: 10 MB file, 10,000 source data rows (plus header), 100 rows/chunk, 30-day
raw staging retention and 48-hour rollback window. Admin can configure bounded
limits. XLSX expanded content is also capped before parsing. Retention purge runs
when the import service is used; it clears expired source bytes/raw/normalized
staging and expires unfinished drafts, while retaining audit summaries/effect
preimages. Active commits are excluded and retention extends through rollback.

## Rollback / disable

Admin may roll back the latest applied import in a branch within the configured
window. Checks run atomically before compensation:

- Imported values/batches must still match saved postimages.
- Sales history, later stock movements/consumption, later master references or a
  newer applied import block automatic reversal. Sales checks are deliberately
  conservative: existing invoice-item history also blocks automatic rollback.
- Existing values restore from preimages. New masters/aliases are deactivated;
  new stock/batch quantities become zero, movements become VOID and a new receipt
  becomes CANCELLED with received quantities zero. Bill attachments/history stay.
- Compensation is audited and queued for sync. Alias versions stay monotonic.

A rollback is not a destructive deletion of purchase/audit history. A cancelled
supplier invoice remains subject to the existing unique invoice-number rule.
Rolled-back new product SKUs remain inactive and need explicit master review before
reuse. If reversal is blocked, use the existing reviewed business correction flow;
do not delete sales, batches or queued records to force it through.

Disabling the feature preserves all data and restores use of the legacy importer.
Physical down migration refuses any populated history/template table, even after
business rollback. Do not restore an old whole database over subsequent live sales.

## Backup-first staging CLI

From `erp`, use a stopped/consistent **staging copy**, never the live database:

```powershell
npm.cmd run hub:build
$env:ELECTRON_RUN_AS_NODE='1'
.\node_modules\.bin\electron.cmd .\scripts\migrate-imports.cjs --db C:\staging\pos-test.db --backup-dir C:\staging\backups --direction up --staging-copy
```

Repeat `up` to verify idempotence. Use `--direction down` only on an empty import
schema; the runner verifies a backup first and refuses populated tables. Migration
changes only the three import tables/indexes and does not alter stock totals,
financial tables or existing columns. Test backup restore on a separate copy.

## Verification / deployment checklist

Automated tests cover file formats/encoding, required/duplicate mappings, decimal
and date validation, review-token binding, native-name extraction, keyword policies,
valid-only and atomic commits, duplicate receipt/stock prevention, interruption
resume, main-branch permissions, migration backup/up/down, unchanged stock total,
guarded rollback, raw retention and wizard controls. Existing purchase tests retain
their mandatory bill and receipt behavior. Full-suite logs are written under
`output/phase3-*-tests.log`; pre-existing SmartBuy QA findings/credit-ledger fixture
warnings are not resolved by this import change.

Before live enable, complete on a current staging company copy:

- Exercise a real workbook with multiple sheets, header offsets, alternate encoding,
  decimal/date formats and leading-zero codes; open error CSV in Excel.
- Save/reload mapping templates, default/map unknown masters and verify all policies.
- Import one file twice; restart during chunking and resume without double stock.
- Receive an uploaded supplier bill containing two batches; verify stock/batch totals,
  purchase totals, audit and outbox. Verify denied users and non-main procurement.
- Test rollback, later-sale/transfer blocking, retention expiry and feature OFF.
- Print a bill after selecting an extracted native alias: master name only.
- Verify business-row sync on two staging devices. Phase 2's optional cloud keyword
  migration/backend must already be staged before importing global/branch aliases.

No production import or two-device cloud acceptance run is claimed here.
