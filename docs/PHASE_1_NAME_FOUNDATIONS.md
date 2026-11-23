# Phase 1: name/encoding foundations and staging-only dry-run scan

Date: 2026-11-23 (Asia/Colombo). Authorized by the user's approval of Phase 0.
This phase stops before Phase 2 and never applies cleanup proposals.

## Implemented scope

| File | Purpose |
| --- | --- |
| `electron/lib/textEncoding.ts` | CSV/TSV byte decoding, BOM/strict UTF-8 first, `jschardet` fallback, supported overrides, bounded mojibake-repair proposals and loss warnings |
| `electron/lib/masterNames.ts` | Opt-in Latin-character validation and review-only master-name/native-keyword splitting |
| `electron/services/productNameScan.ts` | Read-only staging DB scan, proposal/issue counts, JSON-friendly review data and BOM CSV review export |
| `scripts/scan-product-names.cjs` | Explicit staging-copy CLI, read-only connection, exclusive new report output and operator/provenance metadata |
| `package.json`, lockfile | `jschardet` dependency and `names:scan` command |

**Existing product create/update/import handlers, settings/defaults, cart, stock,
bill save, receipt/PDF templates, reports and cloud endpoints are unchanged.**
The validator is a shared foundation ready for future approved integration;
installing this phase does not make the live catalog English-only or change
existing OFF behavior. No new admin feature switches or mutation APIs are exposed
yet. The three A/B/C feature flags and keyword/expiry/import UIs belong to later
phases. No keyword table, transliteration or cleanup apply operation is added.

The explicit utility option `allowNonLatinProductName` defaults false; it is not
silently mapped into a new active production setting. The approved discovery
proposal for a default-OFF D/foundation integration switch must be respected when
handlers/settings are wired in a later authorized step.

## Validation contract

`validateMasterName(name, options?)` returns `{valid, issues}` without mutating
anything. It checks required text, a default 255-code-point limit, controls and
invisible formatting, replacement characters, suspect mojibake, non-Latin
letters/marks and unsupported symbols. Latin accents and combining accents on
Latin bases, ASCII product codes/quantities, common punctuation/currency are
allowed. The explicit non-Latin exception never allows corrupt/control text.

Latin script is not an English dictionary or translator: `NALLAENAI` can pass
the character policy. Purely Tamil/Sinhala names cannot be automatically turned
into an English master; they require operator-supplied English names.

## Text decoding and repair

`decodeDelimitedText(bytes, options?)` handles CSV/TSV bytes, not XLSX files.

1. Detect UTF-8/UTF-16LE/UTF-16BE BOMs; reject unsupported UTF-32 BOMs.
2. Without BOM or override, try **strict** UTF-8. On failure, use `jschardet` on a
   bounded sample. Unsupported/low-confidence detection requires manual override.
3. Supported overrides: `utf-8`, `utf-8-bom`, `utf-16le`, `utf-16be`,
   `windows-1252`, `iso-8859-1`. ISO-8859-1 is deliberately not treated as the
   WHATWG Windows-1252 alias: byte 0x80 differs.
4. Return original decoded text, proposed text, encoding, BOM presence,
   confidence, label and warnings. Respect the explicit override and warn if it
   conflicts with a BOM. Never silently swap encodings behind the override.
5. A default 10 MiB byte limit is configurable by the caller; detection samples
   at most 256 KiB. Import job/row limits and worker execution are Phase 3 work.

`proposeMojibakeRepair` reinterprets only valid UTF-8 sequences represented by
Windows-1252 characters. It preserves unrelated currency, already-correct native
text and Latin accents. Default limit: two passes, maximum configurable three.
Accept a proposal only when suspect markers decrease and no replacement/control
characters are introduced. Unresolved text stays visible with a warning.

`?` or U+FFFD may represent permanent prior loss: the utility never invents
missing native words. A question mark can also be legitimate, so it is a review
warning rather than proof of encoding damage. BOM-free UTF-16 may superficially
pass UTF-8 as NUL-containing text; a NUL warning asks for the correct override.

These functions return proposals, not permission to automatically rewrite any
master, CSV source, historical record or live import. The existing workbook
reader remains unchanged. `splitMasterName` refuses automatic repair of an
already-decoded XLSX cell even if a repair option was supplied.

## Name splitting

`splitMasterName(original, options?)` returns the original name, proposed master
name, keyword proposals, validation, warnings and a review indicator.

- Native Tamil/Sinhala text in parentheses or beside the name becomes a native
  keyword proposal. `(Pink)` and `(400g)` remain in the master name.
- Mixed parentheses such as `(400g <native text>)` retain the Latin size portion.
- Pure lost-text parentheses such as `(????)` or `(��)` are omitted with an
  unrecoverable-text warning. No garbage keyword is proposed.
- `/` is kept by default. Explicit `slashMode: 'first-part'` uses the first part
  as master and other parts as aliases; optional delimiters are `/ , ; |`.
  Delimiters inside Latin variant parentheses are preserved.
- Aliases are NFC-normalized, whitespace-cleaned, zero-width-cleaned and deduped.
  Garbled/lossy/control-containing aliases are omitted. Tanglish generation,
  approval state, scope, permissions and actual keyword storage are Phase 2 work.
- Empty/invalid proposed English names are flagged for manual entry. No automatic
  translation, name application, master ID creation or stock adjustment occurs.

## Read-only staging scan

From `erp/`, with a **copy of the intended company DB placed in staging**:

```powershell
npm.cmd run names:scan -- --staging-copy --db "C:\POS-staging\pos-erp.db" --output "C:\POS-staging\name-review-20261123.json"
npm.cmd run names:scan -- --staging-copy --db "C:\POS-staging\pos-erp.db" --output "C:\POS-staging\name-review-20261123.csv"
```

Use `--slash-aliases` only when the owner explicitly wants the slash-splitting
policy. Without `--output`, JSON review data is printed to stdout.

The command compiles the Electron TypeScript first, then runs the scanner using
Electron's embedded Node to match the existing SQLite native-module ABI. It does
not launch the POS UI or import its database initializer. For an already compiled
checkout, the equivalent is:

```powershell
$env:ELECTRON_RUN_AS_NODE = '1'
.\node_modules\electron\dist\electron.exe .\scripts\scan-product-names.cjs --staging-copy --db "C:\POS-staging\pos-erp.db" --output "C:\POS-staging\new-review.json"
Remove-Item Env:ELECTRON_RUN_AS_NODE
```

`--staging-copy` is an explicit operator declaration, not technical proof that a
file is not active elsewhere. Never point it at an active production DB; choose
a verified backup/staging copy. The CLI does not discover AppData, cloud access
keys or active workspaces for you. Operators must already have OS read access;
this is not a new login/auth mechanism or cashier-facing admin feature.

Safety properties:

- `readonly: true`, `fileMustExist: true`, connection `query_only=ON`.
- Consistent deferred read transaction; static product SELECT/PRAGMA metadata.
- Service rejects even a writable connection supplied by another caller.
- Unknown options, including `--apply`, are rejected. There is no write mode.
- Existing reports and database paths cannot be overwritten. Output is limited
  to a **new** `.json` or `.csv` report using exclusive file creation.
- All products, including inactive ones, are scanned. Review-row counts include
  whitespace/proposal warnings as well as invalid names; they are not a count
  of definitely corrupted products. Overlapping flags must not be summed.
- CSV review output includes a UTF-8 BOM, CSV quoting and spreadsheet-formula
  protection. JSON retains exact original values. This is a **review report**
  containing native/original text, not the clean default master export of Phase 5.
- Report audit metadata records operation, operator, selected source and dry-run
  status. No SQL audit row/outbox item is written because the scan is read-only.

## Migrations, backup and data changes

**No schema migration, seed, data application, new live setting or repair write
is part of Phase 1.** Therefore no dummy up/down migration is supplied. Existing
backup/migration code is not invoked by scanning.

Before creating a future staging copy, use the existing SQLite online backup
facility or the environment-specific backup instructions in `DISCOVERY.md`.
Hash and integrity-check the copy. Do not copy only the main file of an active
WAL database or use a historical empty backup as proof about today's catalog.
Phase 5 apply will require a separate approved plan, preimages, backup, audit and
historical reprint protection. No apply implementation exists here.

## Verification and manual checklist

Observed results in this workspace:

- Full unit run: **240 passed**. After adding the final control-character guard
  test, the focused foundations run passed **32 tests** (9 encoding, 23 names).
- Full SQLite integration run: **291 passed, 23 skipped**, including all six new
  scanner/history/receipt tests. Existing SmartBuy diagnostic findings and the
  known `credit_ledger` backfill warning still appear in that suite; passing
  assertions are not a blanket production-readiness certification.
- TypeScript checking and the CLI's Electron TypeScript compilation passed.
- Actual dry run on the identified **historical 2026-11-07 backup**: 176 products,
  174 active, five whitespace-only proposals, zero invalid original/proposed
  names and zero Tamil/Sinhala/mojibake/replacement-character flags. The five
  proposals only collapse double spaces; none has been applied.
- Source SHA-256 remained
  `e3b66904dda7ac7c4a84ed5d30466aa5b24d4124f5f1c7a4bbc5d2ae2b0cde8f`.
- Review artifacts: `output/phase1-name-scan-20261123.json` and the matching BOM
  `.csv`. These are historical staging evidence, **not a scan of today's live DB**.

No new screen or renderer route was changed, so this phase does not require a
new UI layout/build or claim a new end-to-end PDF acceptance result.

Commands:

```powershell
npm.cmd run test:unit -- --reporter=dot
npm.cmd run test:integration -- --reporter=dot
npm.cmd run typecheck
```

New tests cover conservative one/two-pass repairs, preserved correct text,
UTF-8/BOM/UTF-16/legacy overrides, lossy text, oversized/unsupported data, Latin
validation, name/alias splitting, XLSX repair exclusion, empty master names,
read-only enforcement, report overwrite/apply-mode rejection, BOM/formula-safe
CSV, idempotent proposals, unchanged DB hashes and unchanged invoice/stock rows.
Receipt HTML is rendered before/after a scan and must remain identical; this is
not a claim that historical native names have been made English or that a new
PDF acceptance suite has been completed.

Manual staging checklist:

1. Select the correct company backup; record its hash and row counts.
2. Scan it twice to distinct report paths. Ignore generated-at metadata when
   comparing proposals; names, aliases and issue counts must match.
3. Preview native parentheses, Latin `(Pink)`/`(400g)`, default slash retention,
   explicit slash splitting, double mojibake and permanent-loss warnings.
4. Check no native-only name is silently translated and no garbage alias appears.
5. Open a CSV review in Excel and confirm native text is readable. Retain the
   JSON source if Excel coerces a SKU/code; BOM cannot prevent type coercion.
6. Compare DB hash, stock, invoice/item totals and historical receipt before/after.
7. Run the existing cashier F4/F5 manual-number and billing tests. Normal POS
   behavior must not depend on these passive utility modules.

## Rollback

Stop using the scan command. Remove only explicitly selected generated review
files if desired; they are not databases. Revert the Phase 1 utility/tests/CLI and
package-script/dependency changes, preserving unrelated earlier work. Reinstall
from the restored lockfile if dependency rollback is needed. No DB restore,
reverse migration, stock recalculation or financial correction is required.

Keep discovery, utilities and the dry-run CLI in small local commits. Do not
include the earlier cashier/Hub or unrelated purchase edits in a Phase 1 commit.
No production deployment is performed. Phase 2 requires the user's next explicit
instruction.
