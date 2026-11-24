# Discovery: multilingual keywords, bulk import, expiry and clean master data

**Phase 0 only — 2026-11-23, Asia/Colombo.**

**தமிழ் சுருக்கம்:** புதிய system உருவாக்க வேண்டியதில்லை. Existing batch tables,
sale/return allocations, import mapping preview, permissions, audit, notifications
ஆகியவற்றை reuse செய்யலாம். முக்கிய gaps: multilingual keyword layer இல்லை;
import wizard தற்போது furniture-specific; sales FIFO பயன்படுத்துகிறது;
90/60/30 configurable expiry alerts இல்லை; product-name cleanup செய்தால் பழைய
bill reprint பெயரும் மாறும் risk உள்ளது. **Application code/DB மாற்றப்படவில்லை.
Phase 1 தொடங்க உங்கள் approval தேவை.**

## 1. Status, evidence and limits

This report is the requested approval checkpoint. No feature implementation,
dependency installation, application startup, migration, data cleanup, build,
test-suite run, printing, email, SMS or cloud write was performed in Phase 0.
Only this discovery document is created/updated. Existing changes from earlier
work, including manual cashier hold numbers and the optional Branch Hub, remain
outside this phase and have not been reverted or rewritten.

The root `package.json` routes development/build commands into `erp/`. Therefore
`erp/` is the active source project. `release-v2.9.5/`,
`release-v2.9.5-clean/` and `director-deploy/` are separate copies, not the target
for new changes without an explicit deployment decision.

Evidence classes used throughout:

| Evidence | What was actually inspected | Limit |
| --- | --- | --- |
| Current source | Desktop renderer, Electron main/IPC/services, SQLite schema/migrations, cloud DB/auth/sync, import/export, inventory, backups, notifications and tests | Proves implementation paths, not what version is installed at a branch |
| Snapshot A | `backups/pre-deploy-58ace25-20261110/local-pos-workspace/pos-erp.db` | Historical saved workspace; **0 products**, not a usable current catalog |
| Snapshot B | `backups/pre-deploy-58ace25-20261110/local-pos-workspace/backups/pos-erp-backup-2026-11-07T01-44-41.db` | Latest populated dated backup found in these backup sets; **176 products**; not current live data |
| Current live database | Not identified/verified in this session | Current dirty-name counts, current stock totals and a current 20-row dirty sample are **unknown**, not zero |
| Cloud production DB | No production connection made | Actual tenant schema/version/collation/row counts need staging verification later |

The inspected backup sets contain 22 `.db` files, including duplicated archived
copies: 15 have 176 products and seven have no products. This is a count of files,
not a count of unique business databases. All probes used Python's standard
SQLite driver with a `file:...?...mode=ro` URI, `PRAGMA query_only=ON` and SELECT/
metadata reads; the application initializer was deliberately not imported.

An optional question requesting the active live `pos-erp.db` path was sent while
the source review continued. Once that path or an approved current snapshot is
available, section 7 must be refreshed before any production cleanup decision.

## 2. Stack, structure and conventions

| Area | Existing implementation | Reuse/constraint |
| --- | --- | --- |
| Terminal | Electron 33, Node main process, preload/context bridge | Keep context isolation and the existing `window.api` facade |
| Renderer | React 18, TypeScript strict mode, Vite 5, React Router | Keep existing routes and lazy loading |
| State | Zustand cart/auth stores | Do not put translated/keyword text into `Product.name` or cart name fields |
| UI | TailwindCSS, CSS variables, Lucide icons, react-hot-toast; shared `Modal`, `NumberInput`, panels/tables | Extend current components; no new design system |
| Local DB | `better-sqlite3` 12; prepared raw SQL, explicit synchronous transactions; UUID IDs | No ORM. Use named/positional bound parameters and existing transaction boundaries |
| Cloud | Next.js 15 API, React 19 admin/backend, `mysql2` | **MySQL at runtime**, despite older PostgreSQL wording in README/CLAUDE/schema comments |
| Cloud query layer | `backend/lib/db.ts` exposes a pg-like `{rows}` wrapper, translates `$n`, `ILIKE`, casts to MySQL SQL | Do not infer Postgres from `$1` placeholders; do not introduce a second DB engine |
| Company isolation | Company workspace files locally; tenant pool/company context in cloud auth | Every new feature must preserve company and branch isolation |
| Local migration mechanism | `database/schema.sql` plus large imperative `runMigrations()` in `electron/database.ts` | No dedicated versioned up/down migration framework found |
| Cloud migrations | SQL `migrate-001...007`, `base-schema.inc`, runtime compatibility in `backend/lib/auth.ts` and `syncSchema.ts` | Runtime compatibility includes legacy CHANGE/MODIFY/DROP operations; **do not invoke it during a read-only audit** |
| Validation | Handwritten checks/helpers inside IPC/services; no Zod/Yup/Joi dependency in direct manifests | Add shared validators at existing boundaries; no new auth/validation framework needed |
| Files | Desktop `xlsx`; backend `exceljs`, PDFKit | Reuse workbook parsing; explicit CSV encoding/detection dependencies are not currently direct dependencies |
| Logging/audit | `services/auditLog.ts` writes `audit_logs` and queues cloud sync; console diagnostics and main-process renderer logging | New sensitive actions must use the same audit mechanism, not console-only logs |
| Tests | Vitest unit/happy-dom; integration under Electron Node for the native SQLite ABI; Playwright scripts exist | Existing suites are not evidence of a new 50k-keyword benchmark or a real branch acceptance test |

Relevant source locations:

```text
erp/
  src/pages/pos/POSPage.tsx       cashier/search/hold/payment composition
  src/components/pos/            search, grid, cart, payment, numbered hold dialogs
  src/pages/admin/               products, purchases, batches, reports, settings
  src/components/admin/         FurnitureImportPreview, variants and reusable UI
  src/lib/posCatalog.ts          current in-memory product index
  src/hooks/usePosCatalog.ts     local catalog loading and refresh lifecycle
  src/store/                    auth/cart state
  electron/main.ts              bootstrap, schedulers, IPC registration
  electron/preload.ts            IPC API exposed to renderer
  electron/database.ts           local migrations, seeding, startup data repairs
  electron/ipc/                  product/purchase/invoice/stock/return/report APIs
  electron/services/             batch ledger, imports, audit, backup, cloud sync
  electron/lib/                  catalog and validation helpers
  electron/branchHub/            optional branch hold transport and sidecar schemas
  database/schema.sql           base SQLite DDL, not the entire evolved schema
  backend/app/api/               Next.js route handlers
  backend/lib/                   MySQL, tenant auth, sync, exports/backup
  backend/database/              base/SaaS schemas and selected SQL migrations
  scripts/                      operations, maintenance outbox, import utilities
```

Style is predominantly typed React function components, hooks, aliased renderer
imports (`@/`), raw SQL in Electron/services, camelCase in TypeScript and
snake_case at database/API boundaries. Formatting is mixed across older files;
avoid whole-file formatting changes. `safeHandle` standardizes error envelopes
but **does not itself enforce permission checks**. Preserve current response
envelopes; some older handlers return `id` at top level rather than `data.id`.

## 3. Existing authorization, identities and scheduling

### Authorization

`roles.permissions` is JSON; local users reference `role_id`. Session code
normalizes role/direct permission objects, while UI routing uses
`RequirePermission`/`RequireSuperAdmin`. Local sessions use stored auth metadata
and JWT/PIN/password flows; cloud auth resolves company/tenant/device context.
Do not add a new authentication system.

Observed role definitions in Snapshot B (not proof of the current live roles):

| Role | Observed permission pattern |
| --- | --- |
| Company Admin | `all` |
| Branch Manager | POS, inventory, reports, customers/employees, coupon permissions |
| Cashier | POS and customers |
| Warehouse Staff | inventory and transfers |
| Delivery Staff | deliveries |
| Recovered Historical User | empty permissions; not a normal feature-assignment target |

Reuse `branchAccess.ts`/`permissionsFor` and existing approval flows. Product
create/update currently allow Company Admin directly; other callers require a
valid, unexpired, user-owned `edit_requests` approval consumed inside the write
transaction. Furniture import requires furniture business type and main-branch
inventory-manager/Company Admin access. New keyword/import/expiry permissions
must be enforced in main-process/cloud handlers as well as UI.

The proposed granular keys (`keywords.manage`, `import.products`, `import.stock`,
`expiry.settings`, `expiry.writeoff`, etc.) are not currently an implemented
permission set. Extend existing JSON permission editors and role seeding without
replacing roles or broadening cashier privileges. Cashiers may manage only their
own user aliases. Custom/empty role behavior and `all` bypass need explicit tests.

### Multi-branch and terminal identity

**The codebase is multi-branch.** Branch-scoped stock, users, purchase/invoice
records, single/multi-item transfers, permissions and cloud sync already exist.
Snapshot B having one branch does not make the product single-shop. Branch scope
and batch-carrying transfers must be retained in this feature set.

The main POS schema has no general-purpose `terminals` master table. Existing
identities include local activation `device_id`, cloud `pos_devices`, and the
optional Hub sidecar's branch/terminal IDs. Reuse a stable device identity for
terminal-scoped keywords; do not assume a display code such as `T01` is globally
unique or present on every installation. Scope cache keys by company, branch,
device and user, and clear/reload them on auth/workspace changes.

The optional Hub currently handles shared/manual holds and has event-transport
foundations. Production billing/stock/master data has **not** been cut over to
it. Keyword sync should extend the existing master-data sync rather than silently
switching architecture as part of A–D. Preserve F4 cashier-entered hold numbers.

### Existing timers and notification infrastructure

- `startReminderScheduler()` in `ipc/communications.ts`: starts after ~30 seconds,
  then every 24 hours; installment/chit/low-stock work with existing channel toggles.
- `ClaimReminderService`: recurring local background sweep, audit/notification patterns.
- `backupService.startAutoBackup()`: local online backup, periodic timer, retention.
- `NotificationPanel`: refresh on mount, sync data changes and every five minutes.
- `notifications:refresh`: branch-scoped aggregate upcoming-expiry-within-30-days
  and expired-stock notifications, deduped roughly per branch/title/six-hour window.

This is not a persisted, timezone-scheduled expiry engine. A 24-hour interval
after launch is not a configured Asia/Colombo calendar time and does not run when
all apps are closed. Existing low-stock scheduler SQL also references
`product_inventory`, while the reviewed local model uses `stocks`; that query
must not be copied blindly into an expiry worker. No external messages were sent.

## 4. Database and stock model

Appendix A contains **all columns, defaults, primary keys, declared foreign keys
and indexes** for the selected actual snapshot tables. It is generated from
SQLite PRAGMA metadata, not reconstructed from assumptions. It covers products,
categories, suppliers, stock/stock-in, sales/lines, returns, adjustments, users,
roles, branches/warehouses and batch allocations. Source-only Hub/device schemas
are covered separately below. Actual production/cloud drift still needs staging
introspection.

### Model map and safe reuse

| Business concept | Existing table/representation | Consequence for requested features |
| --- | --- | --- |
| Master product | `products`; category/supplier FKs; unique SKU; indexed barcode/name/category; branch_id optional | Extend rather than introduce another master |
| Product flags | `track_batches`, `track_serial`, **`track_expiry` already default 0** | Reuse; do not add a second track-expiry field |
| Brand | `products.brand` text | A normalized brands table is not currently present in the inspected schema; only add one if the approved import registry needs it |
| Category | `categories`, parent/category hierarchy | Category expiry default/settings inheritance not implemented |
| UOM/variants | `product_uom`, attributes/values, variants and variant stocks | Weighted, pack and variant flows must remain correct |
| Aggregate stock | `stocks.quantity`, `damaged_qty`, branch/warehouse; variant stock separately | There is no `products.stock` DB balance; renderer `stock` is a joined/computed value |
| Stock movement audit | `stock_movements` with positive quantity, from/to branch and movement type | Direction gives the delta; it is not the only authoritative balance today |
| Stock-in/GRN equivalent | `purchase_orders`, `purchase_items`, `purchase_attachments`; order/direct receipts | No separate GRN master is necessary just for these features |
| Batch master | **`product_batches` exists** | Reuse its names and links; do not create a duplicate table using incompatible column names |
| Received batch quantity | `original_quantity`; purchase receipt line quantity | Candidate mapping for requested `qty_received` |
| Remaining batch quantity | `product_batches.quantity` | Candidate mapping for requested `qty_remaining` |
| Other batch counters | `sold_quantity`, `returned_quantity`, `damaged_quantity`, historical cost-known flag | Preserve ledger/cost behavior; counters are not all independent balances |
| Batch supplier/stock-in | `po_id` → purchase/supplier; `purchase_item_id`, `purchase_date` | Derive existing relationships; an optional supplier FK is only needed for genuinely PO-less requirements |
| Sold lot provenance | `sale_batch_allocations` links invoice item to one or more batches with quantities and costs | Already handles multi-lot sale lines; no need to force one batch_id onto a bill line |
| Returned lot provenance | `return_batch_allocations` plus returned counts on sale allocations | Reuse for partial returns/cancellations |
| Counts/adjustments | `stock_count_sessions`, `stock_count_items`, `stocks:adjust`, ADJUSTMENT movements | Need batch-aware allocation for tracked goods; no separate stock ledger rewrite |
| Transfers | `stock_transfers`, `branch_transfers`/items and movement history | `serial_batch_no` is descriptive text, not an enforced batch-allocation FK |
| Names on historical bills | `invoice_items` references product; current detail/report queries join `products.name` | Cleanup can change old display names without changing invoice rows — see section 8 |
| Settings | per-company `app_settings` via electron-store and existing settings IPC | Feature settings are not a new SQL settings/auth system |

`products:create` currently inserts a fixed list of product columns: adding extra
keys to its intermediate object does not automatically persist fields outside
that INSERT list. `products:update` filters incoming keys against actual schema
columns. No track-expiry controls were found in the current main product page.
Phase 4 must verify create, update, UI types, imports and cloud allowlists together.

`stocks` has historically nullable warehouse uniqueness behavior. Current
`database.ts` contains additional stock deduplication/repair migrations. Do not
repeat stock imports without testing actual indexes, warehouse grouping and the
existing canonical stock reconciliation rules.

### Existing batch behavior

`services/batchInventory.ts` already implements:

- `ensureLegacyOpeningLayer`: computes the positive gap between aggregate
  **sellable** stock (`quantity - damaged_qty`, default warehouse) and known batch
  quantities, then creates a no-expiry, unknown-historical-cost opening layer.
- `allocateSaleBatches`: transactional batch allocation, supports FIFO or FEFO,
  excludes dated expired batches and checks available batch quantities.
- `createReceiptBatch`: records received quantity/cost/optional expiry and price.
- Sale reversal, partial-return restoration, return cancellation and quantity edits.
- `getSellingLayers`/batch-based price quotation; this read-looking helper can
  create a legacy opening layer inside a transaction.

Current cashier invoice calls select **FIFO**, not FEFO, and are gated by
`usesSupermarketStock` (business type or existing opt-in). This is not yet the
requested per-product expiry feature for every applicable business mode. An
untracked product in supermarket mode can still be batch-allocated today.

Existing statuses include `available`, `partially_sold`, `sold_out`, `expired`;
they differ from the requested status vocabulary. Adding expiry classification
must not silently change old API values/filters when the feature flag is OFF.
One helper checks sold quantity before expiry when assigning status, so a
partially sold expired lot can retain a partially-sold label even though expiry
filters correctly exclude it from batch selection.

`batches:create/update/consume` provide older generic batch controls. In
supermarket mode quantity edits are restricted to purchase/sale paths. Generic
batch records in other modes are not automatically a complete physical-stock
ledger. Turning on `track_expiry` alone does not enforce required receipt expiry.

### Safe legacy-stock integration proposal — not run

1. Back up and inspect the approved **staging copy**; inventory every mutation
   path and distinguish gross, damaged, sellable, batch and variant quantities.
2. Reuse the existing legacy-opening helper concept and historical-cost-known
   marker. Do not invent purchase costs, expiry dates or suppliers.
3. Build a before/after reconciliation by company/product/variant/branch/warehouse;
   compare like-for-like measures. Existing helper covers default-warehouse base
   stock, not the whole warehouse/variant problem automatically.
4. Only create missing positive opening balances once; preserve existing batches.
   A negative gap is an inconsistency to report, not permission to discard a lot.
5. Legacy stock remains explicitly no-expiry/legacy and existing flags stay false.
   Newly tracked receipts require valid expiry. Handling unknown-expiry legacy
   stock after a product is opted in needs an explicit approved policy.
6. Keep aggregate stock, batch changes, provenance, movement and durable sync
   events inside each existing commercial transaction. Do not update only one
   representation or silently defer balance validation to a background task.

## 5. Existing operational flows

### Product add/edit

`ProductsPage` → `window.api.products.create/update` → preload → product IPC →
permission/edit-approval validation → SQLite transaction → stock/variant handling,
audit and sync enqueue. Existing product-name checks do not provide the requested
Latin-only validation, mojibake repair, native-script extraction or keyword layer.
Existing `catalog.ts` provides whitespace/title-case/category/SKU helpers; these
are not Unicode encoding-repair utilities and should not be repurposed as one.

### Stock-in and receiving

Purchase UI/IPC supports purchase orders/direct stock, supplier bill attachments,
receipt history and price handling. `createStockPurchase` validates supplier,
product, date, quantities and costs; receipt paths update aggregate stock, create
receipt batches and movements inside transactions. The direct-purchase item
contract currently includes quantity/cost/optional selling price; the PO-receive
path can pass `batch_number`/`expiry_date` into `createReceiptBatch`.
Extend these optional fields and validations rather than bypassing these services
with a new stock-import writer. Preserve supplier-bill requirements.

### Cashier billing/search/payment/printing

`usePosCatalog` loads active products from **local SQLite** via `products:list`,
then `PosCatalog` searches in memory with exact SKU/barcode, token-prefix and
trigram fallback indexes. It refreshes on sync/focus/success events and periodically;
it is a full local snapshot, not a keyword-aware incremental index. Other product
search screens and scanner/scale paths still have their own IPC lookups.

`POSPage` selection → Zustand `cartStore` (quantity/discount/tax totals) →
`PaymentModal` → `invoices:create`. Main-process invoice code revalidates master
prices/permissions, writes invoice/items/payments, applies stock and optional
batch allocations, then queues synchronization. Quotes avoid stock deduction.

Receipt payloads use `i.product.name`; printer/templates consume `product_name`.
This is the correct seam to keep aliases out of financial output. Suggestions
may add optional `matched_by` metadata; **never replace the product's name with
the alias**. Receipt HTML/thermal/dot/A4/PDF/email paths must be regression-locked.

The existing search index uses NFKC/lowercase/trim; requested keyword normalization
is NFC plus zero-width removal and space collapse. Numeric queries without an
exact SKU/barcode currently may fall through to partial matching. Numeric-only
exact-code behavior must be introduced behind the keyword flag, not described
as already implemented. User/terminal scope must be refreshed on login changes,
even when branch ID is unchanged.

### Reports and exports

`ipc/reports.ts`, analytics and sales exports join masters and financial rows;
several item queries read current `products.name`. Product CSV export uses
`csvCell`, UTF-8 `writeFileSync` and CRLF but **does not prepend a BOM**. It exports
the current name as-is. There is no separate keyword export/import round trip.

### Import/export already present

`products:importExcel`, templates and product spreadsheet helpers support several
legacy/supplier/WooCommerce/furniture-like inputs. The current furniture preview:

- Selects workbook/sheet and an explicit header row; offers mappings/default
  branch and sample data, error/warning review and duplicate strategies.
- Keeps a user/workspace-scoped in-memory session with a ~30-minute TTL.
- Uses a review ID and DB fingerprint to reject an obsolete review at commit.
- Supports fill-empty, override and skip behavior and branch-stock staging.

This is useful infrastructure but is furniture-specific, not a general registry
of import types. It has no persisted `import_jobs`, row-staging history, mapping
templates, comprehensive encoding override/repair, general error-report download
or conditional rollback window. XLSX/XLS/CSV dialogs are present; explicit TSV and
encoding handling must be added/tested rather than assumed.

The existing override strategy can replace provided aggregate stock balances.
It is not equivalent to a stock-in delta with batch/expiry provenance. New Stock-In
imports must use the receipt service and make that semantic difference explicit.

## 6. Feature-by-feature gap and reuse assessment

| Feature | Already reusable | Missing / change needed after approval |
| --- | --- | --- |
| A: keywords | fast local catalog, exact code map, existing master sync, auth/device/user IDs, product management routes | keyword table/scope constraints, flags, management and own-keyword UI, transliteration/review, matched-by labels, numeric-only rules, context cache isolation, sync/tombstones, 50k benchmark |
| B: import | workbook parser, furniture mapping/review UI, review fingerprint, product/purchase templates, receipt handlers | registry, generic preview/encoding, durable jobs/history/templates, row errors CSV, size/row limits, idempotent commit/chunks, safe rollback and data-retention policy |
| C: expiry | existing flags/batches, lot sale/return links, FIFO/FEFO implementation, receipt path, batch UI, aggregate expiry notification, audit/email/SMS hooks | category defaults, enforced new-receipt expiry, selected FEFO routing, full sellable-stock consistency, manager-PIN override, per-batch 3-stage settings/engine/ack/snooze, reports/write-off and batch-carrying transfers |
| D: names/encoding/export | existing name/SKU/category helpers, CSV quoting, master references, export/printer paths, backup/audit services | conservative encoding utility, name splitter/validator, optional flags, clean default export/BOM, keyword round trip, read-only scan/approved apply with snapshots, historical reprint protection |

None of the three requested flags (`keywords_enabled`, `bulk_import_v2_enabled`,
`expiry_tracking_enabled`) or `allow_non_latin_product_name` was found as an
implemented feature setting in the reviewed source. No `product_search_keywords`,
`expiry_alert_settings`, `expiry_alerts`, `import_jobs`, `import_job_rows` or
`import_mapping_templates` table was found. Existing general notifications and
batch records must not be mislabeled as these complete features.

## 7. Dirty-name audit: measured results, not assumptions

No product names have been repaired, translated, split, renamed or exported as
cleaned data. Only product ID, SKU, name and active status were read for the scan.

| Dataset | Products | Tamil range U+0B80–0BFF | Sinhala range U+0D80–0DFF | Mojibake suspects | U+FFFD | Non-Latin letters | Question-mark names |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Snapshot A: 2026-11-10 saved workspace | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Snapshot B: dated 2026-11-07 01:44:41 backup | 176 | 0 | 0 | 0 | 0 | 0 | 0 |
| Current active live company DB | **Unknown** | Unknown | Unknown | Unknown | Unknown | Unknown | Unknown |

Mojibake detection here is a **suspect heuristic**, not an encoding diagnosis:
U+00C3/U+00C2, U+FFFD, or `U+00E0` followed by U+00AE/U+00AF/U+00B6. Non-Latin
letters were separately checked using Unicode letter categories/names. A `?`
by itself is not proof of lost text. Counts overlap; they must not be summed as
different affected products. In the populated snapshot the unique flagged count
is zero, so **there are no 20 dirty rows to honestly show from that database**.
Appendix B supplies 20 clearly labeled clean control rows instead.

Snapshot B SHA-256:
`e3b66904dda7ac7c4a84ed5d30466aa5b24d4124f5f1c7a4bbc5d2ae2b0cde8f`.
It contains an older 176-product catalog with grocery and Latin-script Tanglish
names. A script/encoding scan does not prove correct spelling or English-language
meaning: for example, `NALLAENAI` is not automatically translated by Latin-only
validation. These results must not be presented as evidence that the current live
catalog is clean. A current authorized read-only DB path/snapshot is still needed.

No repair CLI or scan application code has been added: the reusable dry-run tool
belongs to Phase 1 after approval. This Phase 0 probe is documented/reproducible
from the metadata above and the read-only method in section 1.

## 8. High-priority risks and requirement conflicts

| Risk | Evidence / impact | Required handling |
| --- | --- | --- |
| Historical names change on reprint | `invoice_items` lacks a product-name snapshot; invoice details/reports join current master name | Before Phase 5 apply, add approved compatible snapshot/fallback behavior and prove old reprints unchanged. Original sale-time names cannot be reconstructed from current joins alone |
| Historical zero-garbage criterion vs untouched history | Existing old bills may legitimately contain native/dirty names; D4 demands zero while E5/D6 preserve historical output | Acceptance must distinguish new output from immutable historical exceptions; do not silently rewrite old financial history |
| Flag OFF compatibility vs new default English validation | E4 requires old behavior with flags OFF; G2 default disallows non-Latin master names | Proposed extra D/foundation flag OFF initially, with `allow_non_latin_product_name=false` governing validation when enabled; approve semantics before implementing |
| Existing migration side effects | `initDatabase` always runs migrations/repairs; cloud auth compatibility can ALTER/rename/drop old columns | Never use app startup/auth to inspect live schema. Future additions need dedicated guarded up/down and backup checks |
| Replacing an existing batch model | Tables/flags and sale-return links already present | Map requested fields to existing columns. Do not create another `product_batches` or change the meaning of `quantity` |
| Stock double count/drift | aggregate, batch, damaged, variant and warehouse measures coexist; legacy gap is generated lazily | Snapshot/reconcile dimensions before/after; no second opening stock injection; report mismatches rather than overwrite them |
| Expired stock bypass outside allocation | generic aggregate checks and non-supermarket/adjustment/transfer paths differ | Route every enabled tracked-product mutation through validated batch-aware services; test variants and returns explicitly |
| Nullable scope uniqueness | SQLite/MySQL UNIQUE allow multiple NULL-containing scope tuples | Use an approved non-null scope key or guarded expression indexes, not a naive nullable composite UNIQUE |
| Wrong product from numeric aliases | current partial numeric fallback; user aliases may collide with barcodes/SKUs or other scoped codes | On A enabled, implement exact numeric behavior and conflict checks with visible master names; define uniqueness across overlapping scopes |
| Scoped alias/cache leakage | existing catalog lifecycle mainly keys by branch | Key keyword cache by company/branch/device/user and enforce authorization before fetching/searching |
| Sync drops or overwrites new fields | cloud/local table allowlists, schema compatibility and product reconciliation exist | Wire schema, push, pull, dependency order, cursors, deactivate/tombstones and version behavior together |
| Import restart/rollback limitations | preview sessions currently memory-only; inventory override can set absolute quantities | Persist staged jobs and ownership, bind commit to validated immutable rows, enforce safe per-row/chunk idempotency and post-sale rollback rules |
| Apparent dry-run mutates stock | `getSellingLayers()` calls legacy opening-layer creation | Scan/report/reconciliation must use raw read-only SQL, not normal catalog APIs that can repair data |
| Alerts are currently aggregate/timer-driven | 30-day branch notification, six-hour dedupe; UTC/date and host-time usage | Persist per-batch stages, recipient/channel policy, business timezone, acknowledgements, repeat and last-run state |
| New status vocabulary breaks old reports | available/partially_sold/sold_out differ from requested active/near_expiry/disposed | Prefer additive expiry classification/compatible mapping; audit all status consumers before changing values |
| Damaged/unknown-cost write-off | batch costs may be unknown historical values; damaged quantity is separate | Report unknown cost explicitly, avoid fabricated zero-loss figures and double-deducting physical stock |
| Repair can corrupt valid text | lossy `?`/U+FFFD cannot be recovered; Latin-1 is not identical to Windows-1252 | Byte-aware conservative detection, bounded repair, preview/manual approval; never generate garbage aliases |
| English language vs Latin script | Latin-script validation cannot prove a word is English | Enforce the approved character/garbage policy; no silent automatic translation of Tamil-only names |
| CSV Excel type conversion | BOM fixes encoding, not leading-zero code coercion or formula evaluation | Protect export cells and test text-code round trip; offer text-typed XLSX where necessary |
| Prior workspace changes | purchase work and earlier cashier/Hub changes already exist | Keep commits limited to each approved phase; never sweep unrelated edits into commits |

Other acceptance details to settle during the appropriate approved phase:
scope-priority versus match-strength ties; code uniqueness across overlapping
scopes; size/row limits; import transaction/chunk semantics; cleanup approval
mechanism; rollback window; expired-stock override authority and event auditing;
and which always-on process owns daily alerts when cashier PCs are all closed.

## 9. Proposed phases, tests, manual checks and rollback

**No phase below is authorized by this report itself.** Follow the user's order
and wait for the explicit next-phase instruction.

| Phase | Small implementation scope after approval | Tests and manual acceptance | Rollback / migration position |
| --- | --- | --- | --- |
| 0 (this document) | Read source and read-only backup metadata/name data; record gaps | Check report covers all seven discovery requests; verify snapshots vs live labels | No application/DB rollback needed; only a discovery document |
| 1: D foundations | Shared validator, conservative encoding detection/repair, name splitter, **dry-run-only** dirty-name tool; agree feature-flag semantics first | Mixed native parentheses extracted; Pink/400g kept; slash unchanged by default; corrupt/lossy cases warned; invalid names blocked only under approved flag; no DB writes/old receipt changes | Revert small utility/opt-in integration commits; leave flags OFF; no cleanup apply, no stock migration |
| 2: A | Add keyword layer and scoped permissions/cache, optional matched-by metadata, own-keyword/management/review UI, normalized sync | exact/prefix/contains/fuzzy ranking, scope isolation, numeric 1 not 10/11, dedupe, deactivation, manual alias preservation, reviewed transliteration, master-only bill output, 50k-keyword benchmark on representative hardware | Flags OFF first. Keep existing products untouched. Retain keyword data/tombstones; down must refuse if it would lose new business data without backup/export |
| 3: B | Generalize existing preview/mapping into an import registry and persistent jobs/templates; integrate existing product/receipt services | Required mappings blocked; encoding/sheet/date/decimal preview; duplicate strategies; row error CSV; interruption/retry/idempotency; two identical imports do not double stock; permission denial; post-sale rollback denied | Flag OFF keeps old importer. Pending jobs cancel; committed jobs reverse only safe untouched effects through logged compensations. Never delete sold product history or subtract unrelated stock |
| 4: C | Reuse existing flags/batches; validate new tracked receipts, FEFO, provenance, batch-aware transfers/adjustments; add stage settings/engine/report/actions | 2+ lots FEFO, excluded expired lots, permitted audited override, partial returns to original lot, warehouse/variant reconciliation, 90/60/30 and 120/45/15, dedupe/repeat/ack/snooze, policy/date/qty changes, Colombo midnight/DST-independent calendar, cost write-off | Stop expiry dispatch first; preserve batch allocations and financial records. Flag OFF cannot undo already committed sales/write-offs. Restore from verified staging backup only if required; otherwise use audited compensations |
| 5: apply cleanup/final regression | Approved dry-run proposals, automatic pre-apply snapshot/backup, idempotent application to masters/aliases only, audit, clean separate exports | Old reprints/amounts unchanged; new names/receipts/exports pass Unicode/mojibake scan; keyword export/import round trip; stock and financial checksums unchanged; rerun all existing suites/manual cashier loop | Restore only affected master/alias fields using audited preimages and version checks. Refuse to overwrite a newer edit; no blanket production DB restore over later sales |

For each phase, make reviewable small commits (where repository permissions
permit), record the exact tests run and failures/skips, provide its manual
checklist and rollback instructions, and stop before the next phase unless the
user explicitly authorizes it. No tests were newly run during this report-only
phase; previous session test counts are not presented as a fresh A–D baseline.

### Additive migration contract for future approved phases

1. Separate local SQLite and actual MySQL up/down scripts; use existing names,
   preserve columns/types/API shapes and guard repeated execution.
2. Explicit precondition/schema-version checks and a verified, dated backup;
   never rely only on an unverified automatic startup backup.
3. New settings default OFF; existing `track_expiry` remains false. Do not run a
   mass name/stock rewrite as part of application bootstrap or cloud login.
4. A repeatable reconciliation report before/after, with totals by relevant stock
   dimensions and financial-row/name snapshots where applicable.
5. The down path is guarded and non-destructive. Disabling a flag is not a schema
   rollback; dropping a populated new table violates live-data safety unless an
   explicit export/restore decision is approved. Prefer retaining inactive data.

### Backup commands to document/rehearse later — not executed now

The existing desktop `backup:run` IPC invokes `runBackup()` using the SQLite
online backup API. It also has retention cleanup/S3 behavior, so a migration
backup should have its own dated retention exemption and integrity verification.

For a staged SQLite copy, a DBA can use the SQLite CLI, with actual paths replaced:

```powershell
sqlite3.exe "C:\POS-staging\pos-erp.db" ".backup 'C:/POS-staging/pre-phase-N.db'"
sqlite3.exe "file:C:/POS-staging/pre-phase-N.db?mode=ro" "PRAGMA integrity_check;"
```

If the CLI is not installed, use a dedicated helper invoking the existing
`better-sqlite3` online backup API in its matching runtime, then verify a read-only
connection. Do not simply copy the main `.db` while ignoring an active WAL file.
Existing cloud backup infrastructure includes `backend/scripts/pos-backup-mysql.sh`
and tenant backup services. Rehearse with staging credentials/tenant and verify
restoration; do not run production/cloud auth compatibility code just to back up.
Future migration docs must give exact environment-specific commands after the
target runtime/DB is identified. No backup or migration command above was run.

## 10. Approval checkpoint

Requested next step, **only after approval**: Phase 1 (D foundations and a read-only
dry-run scan tool). No keywords schema, import jobs, expiry migrations or cleanup
apply should be bundled into that approval.

Review especially: the unavailable live dirty-name counts, historical reprint
protection, OFF-flag/default-name-validation semantics and legacy stock measures.
Phase 1 can start with pure utilities/tests and no live data writes; any unresolved
policy should remain disabled rather than silently changing billing behavior.

The following appendices are historical snapshot/source evidence, not current
production certification.


## Appendix A. Actual historical SQLite schema inventory

Snapshot A has **93 tables**. The following 39 relevant tables are introspected from that file. Counts show Snapshot A / populated Snapshot B, where available. All columns below are actual PRAGMA metadata. NULL allowance and primary-key position are reported separately; do not infer stricter TEXT-primary-key nullability than SQLite declares.

### `branches`

Historical row counts A / B: **1 / 1**.

| Column | Declared type | NOT NULL | PK position | Default |
| --- | --- | --- | --- | --- |
| id | TEXT | 0 | 1 | Not specified |
| name | TEXT | 1 | 0 | Not specified |
| address | TEXT | 0 | 0 | Not specified |
| phone | TEXT | 0 | 0 | Not specified |
| email | TEXT | 0 | 0 | Not specified |
| code | TEXT | 0 | 0 | Not specified |
| branch_pin | TEXT | 0 | 0 | Not specified |
| is_active | INTEGER | 1 | 0 | 1 |
| created_at | TEXT | 1 | 0 | datetime('now') |
| updated_at | TEXT | 1 | 0 | datetime('now') |
| synced_at | TEXT | 0 | 0 | Not specified |
| smartbuy_manager_id | TEXT | 0 | 0 | Not specified |

**Declared foreign keys:**
- `smartbuy_manager_id` -> `users.id`; ON UPDATE NO ACTION; ON DELETE NO ACTION; FK group 0, position 0.

**Indexes:**
- `idx_branches_code_ci` (<expression>); unique=1, origin=c, partial=1.
  SQL: `CREATE UNIQUE INDEX idx_branches_code_ci       ON branches(UPPER(TRIM(code))) WHERE code IS NOT NULL AND TRIM(code)!=''`
- `sqlite_autoindex_branches_1` (id); unique=1, origin=pk, partial=0.

### `warehouses`

Historical row counts A / B: **1 / 1**.

| Column | Declared type | NOT NULL | PK position | Default |
| --- | --- | --- | --- | --- |
| id | TEXT | 0 | 1 | Not specified |
| branch_id | TEXT | 1 | 0 | Not specified |
| name | TEXT | 1 | 0 | Not specified |
| location | TEXT | 0 | 0 | Not specified |
| is_active | INTEGER | 1 | 0 | 1 |
| created_at | TEXT | 1 | 0 | datetime('now') |
| updated_at | TEXT | 1 | 0 | datetime('now') |
| synced_at | TEXT | 0 | 0 | Not specified |

**Declared foreign keys:**
- `branch_id` -> `branches.id`; ON UPDATE NO ACTION; ON DELETE NO ACTION; FK group 0, position 0.

**Indexes:**
- `sqlite_autoindex_warehouses_1` (id); unique=1, origin=pk, partial=0.

### `roles`

Historical row counts A / B: **6 / 6**.

| Column | Declared type | NOT NULL | PK position | Default |
| --- | --- | --- | --- | --- |
| id | TEXT | 0 | 1 | Not specified |
| name | TEXT | 1 | 0 | Not specified |
| permissions | TEXT | 1 | 0 | '{}' |
| created_at | TEXT | 1 | 0 | datetime('now') |
| updated_at | TEXT | 1 | 0 | datetime('now') |
| synced_at | TEXT | 0 | 0 | Not specified |
| session_scope | TEXT | 0 | 0 | Not specified |

**Declared foreign keys:**
None declared in this snapshot (logical relationships may still be enforced in code).

**Indexes:**
- `sqlite_autoindex_roles_2` (name); unique=1, origin=u, partial=0.
- `sqlite_autoindex_roles_1` (id); unique=1, origin=pk, partial=0.

### `users`

Historical row counts A / B: **2 / 2**.

| Column | Declared type | NOT NULL | PK position | Default |
| --- | --- | --- | --- | --- |
| id | TEXT | 0 | 1 | Not specified |
| branch_id | TEXT | 0 | 0 | Not specified |
| role_id | TEXT | 1 | 0 | Not specified |
| name | TEXT | 1 | 0 | Not specified |
| email | TEXT | 1 | 0 | Not specified |
| password_hash | TEXT | 1 | 0 | Not specified |
| pin | TEXT | 0 | 0 | Not specified |
| pin_hash | TEXT | 0 | 0 | Not specified |
| is_active | INTEGER | 1 | 0 | 1 |
| last_login_at | TEXT | 0 | 0 | Not specified |
| created_at | TEXT | 1 | 0 | datetime('now') |
| updated_at | TEXT | 1 | 0 | datetime('now') |
| synced_at | TEXT | 0 | 0 | Not specified |
| two_factor_enabled | INTEGER | 1 | 0 | 0 |
| two_factor_secret | TEXT | 0 | 0 | Not specified |
| login_attempts | INTEGER | 1 | 0 | 0 |
| locked_until | TEXT | 0 | 0 | Not specified |
| force_password_change | INTEGER | 1 | 0 | 0 |

**Declared foreign keys:**
- `role_id` -> `roles.id`; ON UPDATE NO ACTION; ON DELETE NO ACTION; FK group 0, position 0.
- `branch_id` -> `branches.id`; ON UPDATE NO ACTION; ON DELETE NO ACTION; FK group 1, position 0.

**Indexes:**
- `sqlite_autoindex_users_2` (email); unique=1, origin=u, partial=0.
- `sqlite_autoindex_users_1` (id); unique=1, origin=pk, partial=0.

### `categories`

Historical row counts A / B: **0 / 0**.

| Column | Declared type | NOT NULL | PK position | Default |
| --- | --- | --- | --- | --- |
| id | TEXT | 0 | 1 | Not specified |
| parent_id | TEXT | 0 | 0 | Not specified |
| name | TEXT | 1 | 0 | Not specified |
| description | TEXT | 0 | 0 | Not specified |
| sort_order | INTEGER | 1 | 0 | 0 |
| is_active | INTEGER | 1 | 0 | 1 |
| created_at | TEXT | 1 | 0 | datetime('now') |
| updated_at | TEXT | 1 | 0 | datetime('now') |
| synced_at | TEXT | 0 | 0 | Not specified |
| short_code | TEXT | 0 | 0 | Not specified |
| image_url | TEXT | 0 | 0 | Not specified |
| show_in_menu | INTEGER | 1 | 0 | 1 |
| exclude_service_charge | INTEGER | 1 | 0 | 0 |
| issue_token | INTEGER | 1 | 0 | 0 |

**Declared foreign keys:**
- `parent_id` -> `categories.id`; ON UPDATE NO ACTION; ON DELETE NO ACTION; FK group 0, position 0.

**Indexes:**
- `sqlite_autoindex_categories_1` (id); unique=1, origin=pk, partial=0.

### `suppliers`

Historical row counts A / B: **0 / 1**.

| Column | Declared type | NOT NULL | PK position | Default |
| --- | --- | --- | --- | --- |
| id | TEXT | 0 | 1 | Not specified |
| name | TEXT | 1 | 0 | Not specified |
| contact | TEXT | 0 | 0 | Not specified |
| phone | TEXT | 0 | 0 | Not specified |
| email | TEXT | 0 | 0 | Not specified |
| address | TEXT | 0 | 0 | Not specified |
| tax_number | TEXT | 0 | 0 | Not specified |
| due_balance | REAL | 1 | 0 | 0 |
| is_active | INTEGER | 1 | 0 | 1 |
| created_at | TEXT | 1 | 0 | datetime('now') |
| updated_at | TEXT | 1 | 0 | datetime('now') |
| synced_at | TEXT | 0 | 0 | Not specified |
| first_name | TEXT | 0 | 0 | Not specified |
| last_name | TEXT | 0 | 0 | Not specified |
| middle_name | TEXT | 0 | 0 | Not specified |
| business_name | TEXT | 0 | 0 | Not specified |
| mobile_number | TEXT | 0 | 0 | Not specified |
| alt_mobile | TEXT | 0 | 0 | Not specified |
| landline | TEXT | 0 | 0 | Not specified |
| pay_terms | TEXT | 0 | 0 | Not specified |
| city | TEXT | 0 | 0 | Not specified |
| state | TEXT | 0 | 0 | Not specified |
| country | TEXT | 0 | 0 | Not specified |
| zip_code | TEXT | 0 | 0 | Not specified |

**Declared foreign keys:**
None declared in this snapshot (logical relationships may still be enforced in code).

**Indexes:**
- `sqlite_autoindex_suppliers_1` (id); unique=1, origin=pk, partial=0.

### `supplier_payments`

Historical row counts A / B: **0 / 0**.

| Column | Declared type | NOT NULL | PK position | Default |
| --- | --- | --- | --- | --- |
| id | TEXT | 0 | 1 | Not specified |
| supplier_id | TEXT | 1 | 0 | Not specified |
| branch_id | TEXT | 0 | 0 | Not specified |
| amount | REAL | 1 | 0 | Not specified |
| payment_method | TEXT | 1 | 0 | Not specified |
| reference_no | TEXT | 0 | 0 | Not specified |
| payment_date | TEXT | 1 | 0 | Not specified |
| notes | TEXT | 0 | 0 | Not specified |
| balance_before | REAL | 1 | 0 | Not specified |
| balance_after | REAL | 1 | 0 | Not specified |
| paid_by | TEXT | 0 | 0 | Not specified |
| created_at | TEXT | 1 | 0 | datetime('now') |
| updated_at | TEXT | 1 | 0 | datetime('now') |
| synced_at | TEXT | 0 | 0 | Not specified |

**Declared foreign keys:**
- `paid_by` -> `users.id`; ON UPDATE NO ACTION; ON DELETE NO ACTION; FK group 0, position 0.
- `branch_id` -> `branches.id`; ON UPDATE NO ACTION; ON DELETE NO ACTION; FK group 1, position 0.
- `supplier_id` -> `suppliers.id`; ON UPDATE NO ACTION; ON DELETE NO ACTION; FK group 2, position 0.

**Indexes:**
- `idx_supplier_payments_date` (payment_date); unique=0, origin=c, partial=0.
  SQL: `CREATE INDEX idx_supplier_payments_date ON supplier_payments(payment_date)`
- `idx_supplier_payments_supplier` (supplier_id); unique=0, origin=c, partial=0.
  SQL: `CREATE INDEX idx_supplier_payments_supplier ON supplier_payments(supplier_id)`
- `sqlite_autoindex_supplier_payments_1` (id); unique=1, origin=pk, partial=0.

### `products`

Historical row counts A / B: **0 / 176**.

| Column | Declared type | NOT NULL | PK position | Default |
| --- | --- | --- | --- | --- |
| id | TEXT | 0 | 1 | Not specified |
| category_id | TEXT | 0 | 0 | Not specified |
| supplier_id | TEXT | 0 | 0 | Not specified |
| sku | TEXT | 1 | 0 | Not specified |
| barcode | TEXT | 0 | 0 | Not specified |
| name | TEXT | 1 | 0 | Not specified |
| description | TEXT | 0 | 0 | Not specified |
| image_url | TEXT | 0 | 0 | Not specified |
| unit | TEXT | 1 | 0 | 'pcs' |
| cost_price | REAL | 1 | 0 | 0 |
| selling_price | REAL | 1 | 0 | 0 |
| tax_rate | REAL | 1 | 0 | 0 |
| discount_pct | REAL | 1 | 0 | 0 |
| min_stock_level | INTEGER | 1 | 0 | 5 |
| is_active | INTEGER | 1 | 0 | 1 |
| created_at | TEXT | 1 | 0 | datetime('now') |
| updated_at | TEXT | 1 | 0 | datetime('now') |
| synced_at | TEXT | 0 | 0 | Not specified |
| branch_id | TEXT | 0 | 0 | Not specified |
| sort_name | TEXT | 0 | 0 | Not specified |
| isbn | TEXT | 0 | 0 | Not specified |
| brand | TEXT | 0 | 0 | Not specified |
| rack_no | TEXT | 0 | 0 | Not specified |
| alert_qty | INTEGER | 1 | 0 | 5 |
| weight | REAL | 1 | 0 | 0 |
| wholesale_price | REAL | 1 | 0 | 0 |
| not_for_sale | INTEGER | 1 | 0 | 0 |
| enable_emi | INTEGER | 1 | 0 | 0 |
| is_manage_stock | INTEGER | 1 | 0 | 1 |
| fast_product | INTEGER | 1 | 0 | 0 |
| sale_as_latest_price | INTEGER | 1 | 0 | 0 |
| product_type | TEXT | 1 | 0 | 'single' |
| sale_by | TEXT | 1 | 0 | 'normal' |
| employee_commission | REAL | 1 | 0 | 0 |
| commission_type | TEXT | 1 | 0 | 'fixed' |
| custom_field1 | TEXT | 0 | 0 | Not specified |
| custom_field2 | TEXT | 0 | 0 | Not specified |
| custom_field3 | TEXT | 0 | 0 | Not specified |
| track_batches | INTEGER | 1 | 0 | 0 |
| track_serial | INTEGER | 1 | 0 | 0 |
| track_expiry | INTEGER | 1 | 0 | 0 |

**Declared foreign keys:**
- `supplier_id` -> `suppliers.id`; ON UPDATE NO ACTION; ON DELETE NO ACTION; FK group 0, position 0.
- `category_id` -> `categories.id`; ON UPDATE NO ACTION; ON DELETE NO ACTION; FK group 1, position 0.

**Indexes:**
- `idx_products_category` (category_id); unique=0, origin=c, partial=0.
  SQL: `CREATE INDEX idx_products_category ON products(category_id)`
- `idx_products_name` (name); unique=0, origin=c, partial=0.
  SQL: `CREATE INDEX idx_products_name     ON products(name)`
- `idx_products_barcode` (barcode); unique=0, origin=c, partial=0.
  SQL: `CREATE INDEX idx_products_barcode  ON products(barcode)`
- `idx_products_sku` (sku); unique=0, origin=c, partial=0.
  SQL: `CREATE INDEX idx_products_sku      ON products(sku)`
- `sqlite_autoindex_products_2` (sku); unique=1, origin=u, partial=0.
- `sqlite_autoindex_products_1` (id); unique=1, origin=pk, partial=0.

### `product_uom`

Historical row counts A / B: **0 / 1**.

| Column | Declared type | NOT NULL | PK position | Default |
| --- | --- | --- | --- | --- |
| id | TEXT | 0 | 1 | Not specified |
| product_id | TEXT | 1 | 0 | Not specified |
| uom_name | TEXT | 1 | 0 | Not specified |
| conversion_factor | REAL | 1 | 0 | 1 |
| is_base | INTEGER | 1 | 0 | 0 |
| wastage | REAL | 1 | 0 | 0 |
| sort_order | INTEGER | 1 | 0 | 0 |
| created_at | TEXT | 1 | 0 | datetime('now') |
| updated_at | TEXT | 1 | 0 | datetime('now') |

**Declared foreign keys:**
- `product_id` -> `products.id`; ON UPDATE NO ACTION; ON DELETE CASCADE; FK group 0, position 0.

**Indexes:**
- `idx_product_uom_product` (product_id); unique=0, origin=c, partial=0.
  SQL: `CREATE INDEX idx_product_uom_product ON product_uom(product_id)`
- `sqlite_autoindex_product_uom_1` (id); unique=1, origin=pk, partial=0.

### `product_attributes`

Historical row counts A / B: **14 / 14**.

| Column | Declared type | NOT NULL | PK position | Default |
| --- | --- | --- | --- | --- |
| id | TEXT | 0 | 1 | Not specified |
| business_type | TEXT | 1 | 0 | 'all' |
| category_id | TEXT | 0 | 0 | Not specified |
| name | TEXT | 1 | 0 | Not specified |
| slug | TEXT | 1 | 0 | Not specified |
| description | TEXT | 0 | 0 | Not specified |
| is_active | INTEGER | 1 | 0 | 1 |
| is_system | INTEGER | 1 | 0 | 0 |
| sort_order | INTEGER | 1 | 0 | 0 |
| created_at | TEXT | 1 | 0 | datetime('now') |
| updated_at | TEXT | 1 | 0 | datetime('now') |
| synced_at | TEXT | 0 | 0 | Not specified |

**Declared foreign keys:**
- `category_id` -> `categories.id`; ON UPDATE NO ACTION; ON DELETE SET NULL; FK group 0, position 0.

**Indexes:**
- `idx_prod_attr_cat` (category_id); unique=0, origin=c, partial=0.
  SQL: `CREATE INDEX idx_prod_attr_cat ON product_attributes(category_id)`
- `idx_prod_attr_biz` (business_type); unique=0, origin=c, partial=0.
  SQL: `CREATE INDEX idx_prod_attr_biz ON product_attributes(business_type)`
- `sqlite_autoindex_product_attributes_1` (id); unique=1, origin=pk, partial=0.

### `product_attribute_values`

Historical row counts A / B: **91 / 91**.

| Column | Declared type | NOT NULL | PK position | Default |
| --- | --- | --- | --- | --- |
| id | TEXT | 0 | 1 | Not specified |
| attribute_id | TEXT | 1 | 0 | Not specified |
| value | TEXT | 1 | 0 | Not specified |
| color_code | TEXT | 0 | 0 | Not specified |
| sort_order | INTEGER | 1 | 0 | 0 |
| created_at | TEXT | 1 | 0 | datetime('now') |
| updated_at | TEXT | 1 | 0 | datetime('now') |
| synced_at | TEXT | 0 | 0 | Not specified |

**Declared foreign keys:**
- `attribute_id` -> `product_attributes.id`; ON UPDATE NO ACTION; ON DELETE CASCADE; FK group 0, position 0.

**Indexes:**
- `idx_prod_attr_val_attr` (attribute_id); unique=0, origin=c, partial=0.
  SQL: `CREATE INDEX idx_prod_attr_val_attr ON product_attribute_values(attribute_id)`
- `sqlite_autoindex_product_attribute_values_1` (id); unique=1, origin=pk, partial=0.

### `product_variants`

Historical row counts A / B: **0 / 0**.

| Column | Declared type | NOT NULL | PK position | Default |
| --- | --- | --- | --- | --- |
| id | TEXT | 0 | 1 | Not specified |
| product_id | TEXT | 1 | 0 | Not specified |
| variant_name | TEXT | 1 | 0 | Not specified |
| sku | TEXT | 1 | 0 | Not specified |
| barcode | TEXT | 0 | 0 | Not specified |
| cost_price | REAL | 1 | 0 | 0 |
| selling_price | REAL | 1 | 0 | 0 |
| attributes_json | TEXT | 1 | 0 | '{}' |
| image_url | TEXT | 0 | 0 | Not specified |
| is_active | INTEGER | 1 | 0 | 1 |
| sort_order | INTEGER | 1 | 0 | 0 |
| created_at | TEXT | 1 | 0 | datetime('now') |
| updated_at | TEXT | 1 | 0 | datetime('now') |
| synced_at | TEXT | 0 | 0 | Not specified |

**Declared foreign keys:**
- `product_id` -> `products.id`; ON UPDATE NO ACTION; ON DELETE CASCADE; FK group 0, position 0.

**Indexes:**
- `idx_prod_var_barcode` (barcode); unique=0, origin=c, partial=0.
  SQL: `CREATE INDEX idx_prod_var_barcode ON product_variants(barcode)`
- `idx_prod_var_sku` (sku); unique=0, origin=c, partial=0.
  SQL: `CREATE INDEX idx_prod_var_sku ON product_variants(sku)`
- `idx_prod_var_prod` (product_id); unique=0, origin=c, partial=0.
  SQL: `CREATE INDEX idx_prod_var_prod ON product_variants(product_id)`
- `sqlite_autoindex_product_variants_1` (id); unique=1, origin=pk, partial=0.

### `product_variant_stocks`

Historical row counts A / B: **0 / 0**.

| Column | Declared type | NOT NULL | PK position | Default |
| --- | --- | --- | --- | --- |
| id | TEXT | 0 | 1 | Not specified |
| variant_id | TEXT | 1 | 0 | Not specified |
| product_id | TEXT | 1 | 0 | Not specified |
| branch_id | TEXT | 1 | 0 | Not specified |
| quantity | REAL | 1 | 0 | 0 |
| damaged_qty | REAL | 1 | 0 | 0 |
| updated_at | TEXT | 1 | 0 | datetime('now') |
| synced_at | TEXT | 0 | 0 | Not specified |

**Declared foreign keys:**
- `branch_id` -> `branches.id`; ON UPDATE NO ACTION; ON DELETE NO ACTION; FK group 0, position 0.
- `product_id` -> `products.id`; ON UPDATE NO ACTION; ON DELETE CASCADE; FK group 1, position 0.
- `variant_id` -> `product_variants.id`; ON UPDATE NO ACTION; ON DELETE CASCADE; FK group 2, position 0.

**Indexes:**
- `idx_prod_var_stocks_var_branch` (variant_id, branch_id); unique=1, origin=c, partial=0.
  SQL: `CREATE UNIQUE INDEX idx_prod_var_stocks_var_branch ON product_variant_stocks(variant_id, branch_id)`
- `idx_prod_var_stocks_branch` (branch_id); unique=0, origin=c, partial=0.
  SQL: `CREATE INDEX idx_prod_var_stocks_branch ON product_variant_stocks(branch_id)`
- `idx_prod_var_stocks_var` (variant_id); unique=0, origin=c, partial=0.
  SQL: `CREATE INDEX idx_prod_var_stocks_var ON product_variant_stocks(variant_id)`
- `sqlite_autoindex_product_variant_stocks_2` (variant_id, branch_id); unique=1, origin=u, partial=0.
- `sqlite_autoindex_product_variant_stocks_1` (id); unique=1, origin=pk, partial=0.

### `stocks`

Historical row counts A / B: **0 / 100**.

| Column | Declared type | NOT NULL | PK position | Default |
| --- | --- | --- | --- | --- |
| id | TEXT | 0 | 1 | Not specified |
| product_id | TEXT | 1 | 0 | Not specified |
| branch_id | TEXT | 1 | 0 | Not specified |
| warehouse_id | TEXT | 0 | 0 | Not specified |
| quantity | INTEGER | 1 | 0 | 0 |
| damaged_qty | INTEGER | 1 | 0 | 0 |
| updated_at | TEXT | 1 | 0 | datetime('now') |
| synced_at | TEXT | 0 | 0 | Not specified |

**Declared foreign keys:**
- `warehouse_id` -> `warehouses.id`; ON UPDATE NO ACTION; ON DELETE NO ACTION; FK group 0, position 0.
- `branch_id` -> `branches.id`; ON UPDATE NO ACTION; ON DELETE NO ACTION; FK group 1, position 0.
- `product_id` -> `products.id`; ON UPDATE NO ACTION; ON DELETE NO ACTION; FK group 2, position 0.

**Indexes:**
- `idx_stocks_branch` (branch_id); unique=0, origin=c, partial=0.
  SQL: `CREATE INDEX idx_stocks_branch  ON stocks(branch_id)`
- `idx_stocks_product` (product_id); unique=0, origin=c, partial=0.
  SQL: `CREATE INDEX idx_stocks_product ON stocks(product_id)`
- `sqlite_autoindex_stocks_2` (product_id, branch_id, warehouse_id); unique=1, origin=u, partial=0.
- `sqlite_autoindex_stocks_1` (id); unique=1, origin=pk, partial=0.

### `pending_branch_stocks`

Historical row counts A / B: **0 / 0**.

| Column | Declared type | NOT NULL | PK position | Default |
| --- | --- | --- | --- | --- |
| id | TEXT | 0 | 1 | Not specified |
| branch_name | TEXT | 1 | 0 | Not specified |
| product_id | TEXT | 1 | 0 | Not specified |
| quantity | INTEGER | 1 | 0 | 0 |
| stock_date | TEXT | 0 | 0 | Not specified |
| sale_price | REAL | 0 | 0 | Not specified |
| status | TEXT | 1 | 0 | 'pending' |
| notes | TEXT | 0 | 0 | Not specified |
| created_at | TEXT | 1 | 0 | datetime('now') |
| applied_at | TEXT | 0 | 0 | Not specified |
| applied_branch_id | TEXT | 0 | 0 | Not specified |

**Declared foreign keys:**
- `applied_branch_id` -> `branches.id`; ON UPDATE NO ACTION; ON DELETE NO ACTION; FK group 0, position 0.
- `product_id` -> `products.id`; ON UPDATE NO ACTION; ON DELETE NO ACTION; FK group 1, position 0.

**Indexes:**
- `idx_pending_branch_stocks_prod` (product_id); unique=0, origin=c, partial=0.
  SQL: `CREATE INDEX idx_pending_branch_stocks_prod       ON pending_branch_stocks(product_id)`
- `idx_pending_branch_stocks_name` (branch_name, status); unique=0, origin=c, partial=0.
  SQL: `CREATE INDEX idx_pending_branch_stocks_name       ON pending_branch_stocks(branch_name, status)`
- `sqlite_autoindex_pending_branch_stocks_1` (id); unique=1, origin=pk, partial=0.

### `stock_movements`

Historical row counts A / B: **0 / 474**.

| Column | Declared type | NOT NULL | PK position | Default |
| --- | --- | --- | --- | --- |
| id | TEXT | 0 | 1 | Not specified |
| product_id | TEXT | 1 | 0 | Not specified |
| from_branch_id | TEXT | 0 | 0 | Not specified |
| to_branch_id | TEXT | 0 | 0 | Not specified |
| quantity | INTEGER | 1 | 0 | Not specified |
| movement_type | TEXT | 1 | 0 | Not specified |
| reference_order_id | TEXT | 0 | 0 | Not specified |
| reference_transfer_id | TEXT | 0 | 0 | Not specified |
| reference_branch_transfer_id | TEXT | 0 | 0 | Not specified |
| notes | TEXT | 0 | 0 | Not specified |
| created_by | TEXT | 0 | 0 | Not specified |
| status | TEXT | 1 | 0 | 'POSTED' |
| created_at | TEXT | 1 | 0 | datetime('now') |
| synced_at | TEXT | 0 | 0 | Not specified |
| variant_id | TEXT | 0 | 0 | Not specified |

**Declared foreign keys:**
- `created_by` -> `users.id`; ON UPDATE NO ACTION; ON DELETE NO ACTION; FK group 0, position 0.
- `reference_branch_transfer_id` -> `branch_transfers.id`; ON UPDATE NO ACTION; ON DELETE NO ACTION; FK group 1, position 0.
- `reference_transfer_id` -> `stock_transfers.id`; ON UPDATE NO ACTION; ON DELETE NO ACTION; FK group 2, position 0.
- `to_branch_id` -> `branches.id`; ON UPDATE NO ACTION; ON DELETE NO ACTION; FK group 3, position 0.
- `from_branch_id` -> `branches.id`; ON UPDATE NO ACTION; ON DELETE NO ACTION; FK group 4, position 0.
- `product_id` -> `products.id`; ON UPDATE NO ACTION; ON DELETE NO ACTION; FK group 5, position 0.

**Indexes:**
- `idx_stock_movements_branch_transfer` (reference_branch_transfer_id); unique=0, origin=c, partial=0.
  SQL: `CREATE INDEX idx_stock_movements_branch_transfer ON stock_movements(reference_branch_transfer_id)`
- `idx_stock_movements_created_at` (created_at); unique=0, origin=c, partial=0.
  SQL: `CREATE INDEX idx_stock_movements_created_at ON stock_movements(created_at)`
- `idx_stock_movements_type` (movement_type); unique=0, origin=c, partial=0.
  SQL: `CREATE INDEX idx_stock_movements_type ON stock_movements(movement_type)`
- `idx_stock_movements_to_branch` (to_branch_id); unique=0, origin=c, partial=0.
  SQL: `CREATE INDEX idx_stock_movements_to_branch ON stock_movements(to_branch_id)`
- `idx_stock_movements_from_branch` (from_branch_id); unique=0, origin=c, partial=0.
  SQL: `CREATE INDEX idx_stock_movements_from_branch ON stock_movements(from_branch_id)`
- `idx_stock_movements_product` (product_id); unique=0, origin=c, partial=0.
  SQL: `CREATE INDEX idx_stock_movements_product ON stock_movements(product_id)`
- `sqlite_autoindex_stock_movements_1` (id); unique=1, origin=pk, partial=0.

### `stock_transfers`

Historical row counts A / B: **0 / 0**.

| Column | Declared type | NOT NULL | PK position | Default |
| --- | --- | --- | --- | --- |
| id | TEXT | 0 | 1 | Not specified |
| transfer_number | TEXT | 0 | 0 | Not specified |
| product_id | TEXT | 1 | 0 | Not specified |
| from_branch_id | TEXT | 0 | 0 | Not specified |
| to_branch_id | TEXT | 0 | 0 | Not specified |
| from_warehouse_id | TEXT | 0 | 0 | Not specified |
| to_warehouse_id | TEXT | 0 | 0 | Not specified |
| quantity | INTEGER | 1 | 0 | Not specified |
| status | TEXT | 1 | 0 | 'pending_approval' |
| approved_by | TEXT | 0 | 0 | Not specified |
| released_by | TEXT | 0 | 0 | Not specified |
| driver_name | TEXT | 0 | 0 | Not specified |
| driver_phone | TEXT | 0 | 0 | Not specified |
| vehicle_number | TEXT | 0 | 0 | Not specified |
| dispatch_at | TEXT | 0 | 0 | Not specified |
| expected_delivery_at | TEXT | 0 | 0 | Not specified |
| actual_delivery_at | TEXT | 0 | 0 | Not specified |
| received_quantity | INTEGER | 1 | 0 | 0 |
| missing_quantity | INTEGER | 1 | 0 | 0 |
| damaged_quantity | INTEGER | 1 | 0 | 0 |
| package_count | REAL | 1 | 0 | 0 |
| serial_batch_no | TEXT | 0 | 0 | Not specified |
| item_description | TEXT | 0 | 0 | Not specified |
| issuing_officer_name | TEXT | 0 | 0 | Not specified |
| received_by_name | TEXT | 0 | 0 | Not specified |
| received_designation | TEXT | 0 | 0 | Not specified |
| received_remarks | TEXT | 0 | 0 | Not specified |
| mismatch_reason_category | TEXT | 0 | 0 | Not specified |
| mismatch_details | TEXT | 0 | 0 | Not specified |
| print_count | INTEGER | 1 | 0 | 0 |
| last_printed_at | TEXT | 0 | 0 | Not specified |
| notes | TEXT | 0 | 0 | Not specified |
| initiated_by | TEXT | 0 | 0 | Not specified |
| received_by | TEXT | 0 | 0 | Not specified |
| initiated_at | TEXT | 1 | 0 | datetime('now') |
| received_at | TEXT | 0 | 0 | Not specified |
| updated_at | TEXT | 1 | 0 | datetime('now') |
| synced_at | TEXT | 0 | 0 | Not specified |
| reject_reason | TEXT | 0 | 0 | Not specified |
| discrepancy_note | TEXT | 0 | 0 | Not specified |
| rejected_by | TEXT | 0 | 0 | Not specified |
| discrepancy_by | TEXT | 0 | 0 | Not specified |

**Declared foreign keys:**
- `received_by` -> `users.id`; ON UPDATE NO ACTION; ON DELETE NO ACTION; FK group 0, position 0.
- `initiated_by` -> `users.id`; ON UPDATE NO ACTION; ON DELETE NO ACTION; FK group 1, position 0.
- `released_by` -> `users.id`; ON UPDATE NO ACTION; ON DELETE NO ACTION; FK group 2, position 0.
- `approved_by` -> `users.id`; ON UPDATE NO ACTION; ON DELETE NO ACTION; FK group 3, position 0.
- `to_warehouse_id` -> `warehouses.id`; ON UPDATE NO ACTION; ON DELETE NO ACTION; FK group 4, position 0.
- `from_warehouse_id` -> `warehouses.id`; ON UPDATE NO ACTION; ON DELETE NO ACTION; FK group 5, position 0.
- `to_branch_id` -> `branches.id`; ON UPDATE NO ACTION; ON DELETE NO ACTION; FK group 6, position 0.
- `from_branch_id` -> `branches.id`; ON UPDATE NO ACTION; ON DELETE NO ACTION; FK group 7, position 0.
- `product_id` -> `products.id`; ON UPDATE NO ACTION; ON DELETE NO ACTION; FK group 8, position 0.

**Indexes:**
- `sqlite_autoindex_stock_transfers_2` (transfer_number); unique=1, origin=u, partial=0.
- `sqlite_autoindex_stock_transfers_1` (id); unique=1, origin=pk, partial=0.

### `stock_transfer_history`

Historical row counts A / B: **0 / 0**.

| Column | Declared type | NOT NULL | PK position | Default |
| --- | --- | --- | --- | --- |
| id | TEXT | 0 | 1 | Not specified |
| transfer_id | TEXT | 1 | 0 | Not specified |
| product_id | TEXT | 1 | 0 | Not specified |
| variant_id | TEXT | 0 | 0 | Not specified |
| quantity | REAL | 1 | 0 | 0 |
| from_branch_id | TEXT | 0 | 0 | Not specified |
| to_branch_id | TEXT | 0 | 0 | Not specified |
| requested_by | TEXT | 0 | 0 | Not specified |
| approved_by | TEXT | 0 | 0 | Not specified |
| status | TEXT | 1 | 0 | Not specified |
| notes | TEXT | 0 | 0 | Not specified |
| created_by | TEXT | 0 | 0 | Not specified |
| created_at | TEXT | 1 | 0 | datetime('now') |
| synced_at | TEXT | 0 | 0 | Not specified |

**Declared foreign keys:**
- `created_by` -> `users.id`; ON UPDATE NO ACTION; ON DELETE NO ACTION; FK group 0, position 0.
- `approved_by` -> `users.id`; ON UPDATE NO ACTION; ON DELETE NO ACTION; FK group 1, position 0.
- `requested_by` -> `users.id`; ON UPDATE NO ACTION; ON DELETE NO ACTION; FK group 2, position 0.
- `to_branch_id` -> `branches.id`; ON UPDATE NO ACTION; ON DELETE NO ACTION; FK group 3, position 0.
- `from_branch_id` -> `branches.id`; ON UPDATE NO ACTION; ON DELETE NO ACTION; FK group 4, position 0.
- `product_id` -> `products.id`; ON UPDATE NO ACTION; ON DELETE NO ACTION; FK group 5, position 0.
- `transfer_id` -> `stock_transfers.id`; ON UPDATE NO ACTION; ON DELETE NO ACTION; FK group 6, position 0.

**Indexes:**
- `idx_stock_transfer_history_branches` (from_branch_id, to_branch_id); unique=0, origin=c, partial=0.
  SQL: `CREATE INDEX idx_stock_transfer_history_branches ON stock_transfer_history(from_branch_id, to_branch_id)`
- `idx_stock_transfer_history_product` (product_id); unique=0, origin=c, partial=0.
  SQL: `CREATE INDEX idx_stock_transfer_history_product ON stock_transfer_history(product_id)`
- `idx_stock_transfer_history_transfer` (transfer_id); unique=0, origin=c, partial=0.
  SQL: `CREATE INDEX idx_stock_transfer_history_transfer ON stock_transfer_history(transfer_id)`
- `sqlite_autoindex_stock_transfer_history_1` (id); unique=1, origin=pk, partial=0.

### `branch_transfers`

Historical row counts A / B: **0 / 0**.

| Column | Declared type | NOT NULL | PK position | Default |
| --- | --- | --- | --- | --- |
| id | TEXT | 0 | 1 | Not specified |
| transfer_number | TEXT | 1 | 0 | Not specified |
| from_branch_id | TEXT | 1 | 0 | Not specified |
| to_branch_id | TEXT | 1 | 0 | Not specified |
| status | TEXT | 1 | 0 | 'draft' |
| driver_name | TEXT | 0 | 0 | Not specified |
| vehicle_number | TEXT | 0 | 0 | Not specified |
| driver_phone | TEXT | 0 | 0 | Not specified |
| issuing_officer_name | TEXT | 0 | 0 | Not specified |
| dispatch_at | TEXT | 0 | 0 | Not specified |
| expected_delivery_at | TEXT | 0 | 0 | Not specified |
| actual_delivery_at | TEXT | 0 | 0 | Not specified |
| notes | TEXT | 0 | 0 | Not specified |
| created_by | TEXT | 0 | 0 | Not specified |
| approved_by | TEXT | 0 | 0 | Not specified |
| received_by | TEXT | 0 | 0 | Not specified |
| received_by_name | TEXT | 0 | 0 | Not specified |
| received_designation | TEXT | 0 | 0 | Not specified |
| created_at | TEXT | 1 | 0 | datetime('now') |
| updated_at | TEXT | 1 | 0 | datetime('now') |
| synced_at | TEXT | 0 | 0 | Not specified |

**Declared foreign keys:**
None declared in this snapshot (logical relationships may still be enforced in code).

**Indexes:**
- `idx_bt_status` (status); unique=0, origin=c, partial=0.
  SQL: `CREATE INDEX idx_bt_status ON branch_transfers(status)`
- `idx_bt_to` (to_branch_id); unique=0, origin=c, partial=0.
  SQL: `CREATE INDEX idx_bt_to ON branch_transfers(to_branch_id)`
- `idx_bt_from` (from_branch_id); unique=0, origin=c, partial=0.
  SQL: `CREATE INDEX idx_bt_from ON branch_transfers(from_branch_id)`
- `sqlite_autoindex_branch_transfers_2` (transfer_number); unique=1, origin=u, partial=0.
- `sqlite_autoindex_branch_transfers_1` (id); unique=1, origin=pk, partial=0.

### `branch_transfer_items`

Historical row counts A / B: **0 / 0**.

| Column | Declared type | NOT NULL | PK position | Default |
| --- | --- | --- | --- | --- |
| id | TEXT | 0 | 1 | Not specified |
| transfer_id | TEXT | 1 | 0 | Not specified |
| product_id | TEXT | 1 | 0 | Not specified |
| quantity | REAL | 1 | 0 | 0 |
| unit | TEXT | 0 | 0 | Not specified |
| package_count | REAL | 1 | 0 | 0 |
| serial_batch_no | TEXT | 0 | 0 | Not specified |
| description | TEXT | 0 | 0 | Not specified |
| received_qty | REAL | 1 | 0 | 0 |
| damaged_qty | REAL | 1 | 0 | 0 |
| missing_qty | REAL | 1 | 0 | 0 |
| created_at | TEXT | 1 | 0 | datetime('now') |
| updated_at | TEXT | 1 | 0 | datetime('now') |
| synced_at | TEXT | 0 | 0 | Not specified |

**Declared foreign keys:**
- `transfer_id` -> `branch_transfers.id`; ON UPDATE NO ACTION; ON DELETE CASCADE; FK group 0, position 0.

**Indexes:**
- `idx_bti_transfer` (transfer_id); unique=0, origin=c, partial=0.
  SQL: `CREATE INDEX idx_bti_transfer ON branch_transfer_items(transfer_id)`
- `sqlite_autoindex_branch_transfer_items_1` (id); unique=1, origin=pk, partial=0.

### `stock_count_sessions`

Historical row counts A / B: **0 / 0**.

| Column | Declared type | NOT NULL | PK position | Default |
| --- | --- | --- | --- | --- |
| id | TEXT | 0 | 1 | Not specified |
| branch_id | TEXT | 1 | 0 | Not specified |
| warehouse_id | TEXT | 0 | 0 | Not specified |
| status | TEXT | 1 | 0 | 'in_progress' |
| notes | TEXT | 0 | 0 | Not specified |
| created_by | TEXT | 0 | 0 | Not specified |
| completed_by | TEXT | 0 | 0 | Not specified |
| created_at | TEXT | 1 | 0 | datetime('now') |
| completed_at | TEXT | 0 | 0 | Not specified |
| updated_at | TEXT | 1 | 0 | datetime('now') |
| synced_at | TEXT | 0 | 0 | Not specified |

**Declared foreign keys:**
- `completed_by` -> `users.id`; ON UPDATE NO ACTION; ON DELETE NO ACTION; FK group 0, position 0.
- `created_by` -> `users.id`; ON UPDATE NO ACTION; ON DELETE NO ACTION; FK group 1, position 0.
- `warehouse_id` -> `warehouses.id`; ON UPDATE NO ACTION; ON DELETE NO ACTION; FK group 2, position 0.
- `branch_id` -> `branches.id`; ON UPDATE NO ACTION; ON DELETE NO ACTION; FK group 3, position 0.

**Indexes:**
- `idx_stock_count_sessions_branch` (branch_id); unique=0, origin=c, partial=0.
  SQL: `CREATE INDEX idx_stock_count_sessions_branch ON stock_count_sessions(branch_id)`
- `sqlite_autoindex_stock_count_sessions_1` (id); unique=1, origin=pk, partial=0.

### `stock_count_items`

Historical row counts A / B: **0 / 0**.

| Column | Declared type | NOT NULL | PK position | Default |
| --- | --- | --- | --- | --- |
| id | TEXT | 0 | 1 | Not specified |
| session_id | TEXT | 1 | 0 | Not specified |
| product_id | TEXT | 1 | 0 | Not specified |
| system_qty | INTEGER | 1 | 0 | 0 |
| counted_qty | INTEGER | 0 | 0 | Not specified |
| notes | TEXT | 0 | 0 | Not specified |
| updated_at | TEXT | 1 | 0 | datetime('now') |

**Declared foreign keys:**
- `product_id` -> `products.id`; ON UPDATE NO ACTION; ON DELETE NO ACTION; FK group 0, position 0.
- `session_id` -> `stock_count_sessions.id`; ON UPDATE NO ACTION; ON DELETE CASCADE; FK group 1, position 0.

**Indexes:**
- `idx_stock_count_items_product` (product_id); unique=0, origin=c, partial=0.
  SQL: `CREATE INDEX idx_stock_count_items_product   ON stock_count_items(product_id)`
- `idx_stock_count_items_session` (session_id); unique=0, origin=c, partial=0.
  SQL: `CREATE INDEX idx_stock_count_items_session ON stock_count_items(session_id)`
- `sqlite_autoindex_stock_count_items_2` (session_id, product_id); unique=1, origin=u, partial=0.
- `sqlite_autoindex_stock_count_items_1` (id); unique=1, origin=pk, partial=0.

### `purchase_orders`

Historical row counts A / B: **0 / 1**.

| Column | Declared type | NOT NULL | PK position | Default |
| --- | --- | --- | --- | --- |
| id | TEXT | 0 | 1 | Not specified |
| po_number | TEXT | 1 | 0 | Not specified |
| branch_id | TEXT | 1 | 0 | Not specified |
| supplier_id | TEXT | 1 | 0 | Not specified |
| status | TEXT | 1 | 0 | 'DRAFT' |
| subtotal | REAL | 1 | 0 | 0 |
| tax_amount | REAL | 1 | 0 | 0 |
| total | REAL | 1 | 0 | 0 |
| expected_date | TEXT | 0 | 0 | Not specified |
| received_date | TEXT | 0 | 0 | Not specified |
| notes | TEXT | 0 | 0 | Not specified |
| created_by | TEXT | 0 | 0 | Not specified |
| approved_by | TEXT | 0 | 0 | Not specified |
| created_at | TEXT | 1 | 0 | datetime('now') |
| updated_at | TEXT | 1 | 0 | datetime('now') |
| synced_at | TEXT | 0 | 0 | Not specified |
| total_amount | REAL | 1 | 0 | 0 |
| received_at | TEXT | 0 | 0 | Not specified |
| sent_at | TEXT | 0 | 0 | Not specified |
| cancelled_at | TEXT | 0 | 0 | Not specified |
| supplier_invoice_number | TEXT | 0 | 0 | Not specified |
| purchase_date | TEXT | 0 | 0 | Not specified |
| invoice_date | TEXT | 0 | 0 | Not specified |
| payment_status | TEXT | 1 | 0 | 'unpaid' |
| paid_amount | REAL | 1 | 0 | 0 |
| outstanding_amount | REAL | 1 | 0 | 0 |
| purchase_type | TEXT | 1 | 0 | 'order' |

**Declared foreign keys:**
- `approved_by` -> `users.id`; ON UPDATE NO ACTION; ON DELETE NO ACTION; FK group 0, position 0.
- `created_by` -> `users.id`; ON UPDATE NO ACTION; ON DELETE NO ACTION; FK group 1, position 0.
- `supplier_id` -> `suppliers.id`; ON UPDATE NO ACTION; ON DELETE NO ACTION; FK group 2, position 0.
- `branch_id` -> `branches.id`; ON UPDATE NO ACTION; ON DELETE NO ACTION; FK group 3, position 0.

**Indexes:**
- `idx_purchase_orders_invoice_date` (invoice_date); unique=0, origin=c, partial=0.
  SQL: `CREATE INDEX idx_purchase_orders_invoice_date ON purchase_orders(invoice_date)`
- `idx_purchase_orders_purchase_date` (purchase_date); unique=0, origin=c, partial=0.
  SQL: `CREATE INDEX idx_purchase_orders_purchase_date ON purchase_orders(purchase_date)`
- `uq_purchase_supplier_invoice` (supplier_id, supplier_invoice_number); unique=1, origin=c, partial=1.
  SQL: `CREATE UNIQUE INDEX uq_purchase_supplier_invoice       ON purchase_orders(supplier_id, supplier_invoice_number)       WHERE supplier_invoice_number IS NOT NULL AND trim(supplier_invoice_number) <> ''`
- `idx_purchase_orders_supplier` (supplier_id); unique=0, origin=c, partial=0.
  SQL: `CREATE INDEX idx_purchase_orders_supplier ON purchase_orders(supplier_id)`
- `idx_purchase_orders_branch` (branch_id); unique=0, origin=c, partial=0.
  SQL: `CREATE INDEX idx_purchase_orders_branch   ON purchase_orders(branch_id)`
- `sqlite_autoindex_purchase_orders_2` (po_number); unique=1, origin=u, partial=0.
- `sqlite_autoindex_purchase_orders_1` (id); unique=1, origin=pk, partial=0.

### `purchase_items`

Historical row counts A / B: **0 / 2**.

| Column | Declared type | NOT NULL | PK position | Default |
| --- | --- | --- | --- | --- |
| id | TEXT | 0 | 1 | Not specified |
| po_id | TEXT | 1 | 0 | Not specified |
| product_id | TEXT | 1 | 0 | Not specified |
| ordered_qty | REAL | 1 | 0 | 0 |
| received_qty | REAL | 1 | 0 | 0 |
| unit_cost | REAL | 1 | 0 | 0 |
| line_total | REAL | 1 | 0 | 0 |
| updated_at | TEXT | 1 | 0 | datetime('now') |
| synced_at | TEXT | 0 | 0 | Not specified |
| quantity | REAL | 1 | 0 | 0 |
| notes | TEXT | 0 | 0 | Not specified |
| batch_number | TEXT | 0 | 0 | Not specified |
| expiry_date | TEXT | 0 | 0 | Not specified |
| selling_price | REAL | 0 | 0 | Not specified |

**Declared foreign keys:**
- `product_id` -> `products.id`; ON UPDATE NO ACTION; ON DELETE NO ACTION; FK group 0, position 0.
- `po_id` -> `purchase_orders.id`; ON UPDATE NO ACTION; ON DELETE CASCADE; FK group 1, position 0.

**Indexes:**
- `idx_purchase_items_po` (po_id); unique=0, origin=c, partial=0.
  SQL: `CREATE INDEX idx_purchase_items_po        ON purchase_items(po_id)`
- `sqlite_autoindex_purchase_items_1` (id); unique=1, origin=pk, partial=0.

### `purchase_attachments`

Historical row counts A / B: **0 / 1**.

| Column | Declared type | NOT NULL | PK position | Default |
| --- | --- | --- | --- | --- |
| id | TEXT | 0 | 1 | Not specified |
| purchase_id | TEXT | 1 | 0 | Not specified |
| original_name | TEXT | 1 | 0 | Not specified |
| stored_name | TEXT | 1 | 0 | Not specified |
| relative_path | TEXT | 1 | 0 | Not specified |
| mime_type | TEXT | 1 | 0 | Not specified |
| file_size | INTEGER | 1 | 0 | Not specified |
| uploaded_by | TEXT | 0 | 0 | Not specified |
| uploaded_at | TEXT | 1 | 0 | datetime('now') |
| is_active | INTEGER | 1 | 0 | 1 |
| deleted_by | TEXT | 0 | 0 | Not specified |
| deleted_at | TEXT | 0 | 0 | Not specified |
| delete_reason | TEXT | 0 | 0 | Not specified |
| updated_at | TEXT | 1 | 0 | datetime('now') |
| synced_at | TEXT | 0 | 0 | Not specified |

**Declared foreign keys:**
- `deleted_by` -> `users.id`; ON UPDATE NO ACTION; ON DELETE NO ACTION; FK group 0, position 0.
- `uploaded_by` -> `users.id`; ON UPDATE NO ACTION; ON DELETE NO ACTION; FK group 1, position 0.
- `purchase_id` -> `purchase_orders.id`; ON UPDATE NO ACTION; ON DELETE NO ACTION; FK group 2, position 0.

**Indexes:**
- `idx_purchase_attachments_purchase` (purchase_id, is_active); unique=0, origin=c, partial=0.
  SQL: `CREATE INDEX idx_purchase_attachments_purchase ON purchase_attachments(purchase_id, is_active)`
- `sqlite_autoindex_purchase_attachments_2` (stored_name); unique=1, origin=u, partial=0.
- `sqlite_autoindex_purchase_attachments_1` (id); unique=1, origin=pk, partial=0.

### `product_batches`

Historical row counts A / B: **0 / 97**.

| Column | Declared type | NOT NULL | PK position | Default |
| --- | --- | --- | --- | --- |
| id | TEXT | 0 | 1 | Not specified |
| product_id | TEXT | 1 | 0 | Not specified |
| branch_id | TEXT | 0 | 0 | Not specified |
| batch_number | TEXT | 0 | 0 | Not specified |
| serial_number | TEXT | 0 | 0 | Not specified |
| expiry_date | TEXT | 0 | 0 | Not specified |
| mfg_date | TEXT | 0 | 0 | Not specified |
| quantity | REAL | 1 | 0 | 0 |
| cost_price | REAL | 1 | 0 | 0 |
| po_id | TEXT | 0 | 0 | Not specified |
| notes | TEXT | 0 | 0 | Not specified |
| created_by | TEXT | 0 | 0 | Not specified |
| created_at | TEXT | 1 | 0 | datetime('now') |
| updated_at | TEXT | 1 | 0 | datetime('now') |
| purchase_item_id | TEXT | 0 | 0 | Not specified |
| purchase_date | TEXT | 0 | 0 | Not specified |
| original_quantity | REAL | 1 | 0 | 0 |
| sold_quantity | REAL | 1 | 0 | 0 |
| returned_quantity | REAL | 1 | 0 | 0 |
| damaged_quantity | REAL | 1 | 0 | 0 |
| selling_price | REAL | 0 | 0 | Not specified |
| status | TEXT | 1 | 0 | 'available' |
| historical_cost_known | INTEGER | 1 | 0 | 1 |
| synced_at | TEXT | 0 | 0 | Not specified |

**Declared foreign keys:**
- `purchase_item_id` -> `purchase_items.id`; ON UPDATE NO ACTION; ON DELETE NO ACTION; FK group 0, position 0.
- `created_by` -> `users.id`; ON UPDATE NO ACTION; ON DELETE NO ACTION; FK group 1, position 0.
- `po_id` -> `purchase_orders.id`; ON UPDATE NO ACTION; ON DELETE NO ACTION; FK group 2, position 0.
- `branch_id` -> `branches.id`; ON UPDATE NO ACTION; ON DELETE NO ACTION; FK group 3, position 0.
- `product_id` -> `products.id`; ON UPDATE NO ACTION; ON DELETE NO ACTION; FK group 4, position 0.

**Indexes:**
- `idx_batches_batch_no` (batch_number); unique=0, origin=c, partial=0.
  SQL: `CREATE INDEX idx_batches_batch_no  ON product_batches(batch_number)`
- `idx_batches_expiry` (expiry_date); unique=0, origin=c, partial=0.
  SQL: `CREATE INDEX idx_batches_expiry    ON product_batches(expiry_date)`
- `idx_batches_branch` (branch_id); unique=0, origin=c, partial=0.
  SQL: `CREATE INDEX idx_batches_branch    ON product_batches(branch_id)`
- `idx_batches_product` (product_id); unique=0, origin=c, partial=0.
  SQL: `CREATE INDEX idx_batches_product   ON product_batches(product_id)`
- `sqlite_autoindex_product_batches_1` (id); unique=1, origin=pk, partial=0.

### `invoices`

Historical row counts A / B: **0 / 41**.

| Column | Declared type | NOT NULL | PK position | Default |
| --- | --- | --- | --- | --- |
| id | TEXT | 0 | 1 | Not specified |
| invoice_number | TEXT | 1 | 0 | Not specified |
| branch_id | TEXT | 1 | 0 | Not specified |
| customer_id | TEXT | 0 | 0 | Not specified |
| cashier_id | TEXT | 1 | 0 | Not specified |
| status | TEXT | 1 | 0 | 'draft' |
| subtotal | REAL | 1 | 0 | 0 |
| discount_amount | REAL | 1 | 0 | 0 |
| tax_amount | REAL | 1 | 0 | 0 |
| total_amount | REAL | 1 | 0 | 0 |
| paid_amount | REAL | 1 | 0 | 0 |
| due_amount | REAL | 1 | 0 | 0 |
| agent_code | TEXT | 0 | 0 | Not specified |
| agent_name | TEXT | 0 | 0 | Not specified |
| agent_commission_pct | REAL | 1 | 0 | 0 |
| agent_commission_amount | REAL | 1 | 0 | 0 |
| notes | TEXT | 0 | 0 | Not specified |
| created_at | TEXT | 1 | 0 | datetime('now') |
| updated_at | TEXT | 1 | 0 | datetime('now') |
| synced_at | TEXT | 0 | 0 | Not specified |
| bill_type | TEXT | 1 | 0 | 'RETAIL' |
| valid_until | TEXT | 0 | 0 | Not specified |
| due_date | TEXT | 0 | 0 | Not specified |
| approved_by | TEXT | 0 | 0 | Not specified |
| locked_at | TEXT | 0 | 0 | Not specified |
| agent_id | TEXT | 0 | 0 | Not specified |

**Declared foreign keys:**
- `agent_id` -> `agents.id`; ON UPDATE NO ACTION; ON DELETE NO ACTION; FK group 0, position 0.
- `cashier_id` -> `users.id`; ON UPDATE NO ACTION; ON DELETE NO ACTION; FK group 1, position 0.
- `customer_id` -> `customers.id`; ON UPDATE NO ACTION; ON DELETE NO ACTION; FK group 2, position 0.
- `branch_id` -> `branches.id`; ON UPDATE NO ACTION; ON DELETE NO ACTION; FK group 3, position 0.

**Indexes:**
- `idx_invoices_created` (created_at); unique=0, origin=c, partial=0.
  SQL: `CREATE INDEX idx_invoices_created  ON invoices(created_at)`
- `idx_invoices_status` (status); unique=0, origin=c, partial=0.
  SQL: `CREATE INDEX idx_invoices_status   ON invoices(status)`
- `idx_invoices_customer` (customer_id); unique=0, origin=c, partial=0.
  SQL: `CREATE INDEX idx_invoices_customer ON invoices(customer_id)`
- `idx_invoices_branch` (branch_id); unique=0, origin=c, partial=0.
  SQL: `CREATE INDEX idx_invoices_branch   ON invoices(branch_id)`
- `idx_invoices_number` (invoice_number); unique=0, origin=c, partial=0.
  SQL: `CREATE INDEX idx_invoices_number   ON invoices(invoice_number)`
- `sqlite_autoindex_invoices_2` (invoice_number); unique=1, origin=u, partial=0.
- `sqlite_autoindex_invoices_1` (id); unique=1, origin=pk, partial=0.

### `invoice_items`

Historical row counts A / B: **0 / 341**.

| Column | Declared type | NOT NULL | PK position | Default |
| --- | --- | --- | --- | --- |
| id | TEXT | 0 | 1 | Not specified |
| invoice_id | TEXT | 1 | 0 | Not specified |
| product_id | TEXT | 1 | 0 | Not specified |
| variant_id | TEXT | 0 | 0 | Not specified |
| variant_title | TEXT | 0 | 0 | Not specified |
| quantity | INTEGER | 1 | 0 | Not specified |
| unit_price | REAL | 1 | 0 | Not specified |
| discount_pct | REAL | 1 | 0 | 0 |
| discount_amount | REAL | 1 | 0 | 0 |
| tax_rate | REAL | 1 | 0 | 0 |
| tax_amount | REAL | 1 | 0 | 0 |
| line_total | REAL | 1 | 0 | Not specified |
| updated_at | TEXT | 1 | 0 | datetime('now') |
| synced_at | TEXT | 0 | 0 | Not specified |

**Declared foreign keys:**
- `variant_id` -> `product_variants.id`; ON UPDATE NO ACTION; ON DELETE NO ACTION; FK group 0, position 0.
- `product_id` -> `products.id`; ON UPDATE NO ACTION; ON DELETE NO ACTION; FK group 1, position 0.
- `invoice_id` -> `invoices.id`; ON UPDATE NO ACTION; ON DELETE CASCADE; FK group 2, position 0.

**Indexes:**
- `idx_invoice_items_product` (product_id); unique=0, origin=c, partial=0.
  SQL: `CREATE INDEX idx_invoice_items_product  ON invoice_items(product_id)`
- `idx_invoice_items_invoice` (invoice_id); unique=0, origin=c, partial=0.
  SQL: `CREATE INDEX idx_invoice_items_invoice  ON invoice_items(invoice_id)`
- `sqlite_autoindex_invoice_items_1` (id); unique=1, origin=pk, partial=0.

### `payments`

Historical row counts A / B: **0 / 41**.

| Column | Declared type | NOT NULL | PK position | Default |
| --- | --- | --- | --- | --- |
| id | TEXT | 0 | 1 | Not specified |
| invoice_id | TEXT | 1 | 0 | Not specified |
| method | TEXT | 1 | 0 | Not specified |
| amount | REAL | 1 | 0 | Not specified |
| reference | TEXT | 0 | 0 | Not specified |
| received_by | TEXT | 0 | 0 | Not specified |
| paid_at | TEXT | 1 | 0 | datetime('now') |
| updated_at | TEXT | 1 | 0 | datetime('now') |
| synced_at | TEXT | 0 | 0 | Not specified |
| wallet_transaction_id | TEXT | 0 | 0 | Not specified |

**Declared foreign keys:**
- `wallet_transaction_id` -> `smartbuy_wallet_transactions.id`; ON UPDATE NO ACTION; ON DELETE NO ACTION; FK group 0, position 0.
- `received_by` -> `users.id`; ON UPDATE NO ACTION; ON DELETE NO ACTION; FK group 1, position 0.
- `invoice_id` -> `invoices.id`; ON UPDATE NO ACTION; ON DELETE NO ACTION; FK group 2, position 0.

**Indexes:**
- `idx_payments_invoice` (invoice_id); unique=0, origin=c, partial=0.
  SQL: `CREATE INDEX idx_payments_invoice ON payments(invoice_id)`
- `sqlite_autoindex_payments_1` (id); unique=1, origin=pk, partial=0.

### `credit_ledger`

Historical row counts A / B: **0 / 0**.

| Column | Declared type | NOT NULL | PK position | Default |
| --- | --- | --- | --- | --- |
| id | TEXT | 0 | 1 | Not specified |
| customer_id | TEXT | 1 | 0 | Not specified |
| invoice_id | TEXT | 1 | 0 | Not specified |
| branch_id | TEXT | 1 | 0 | Not specified |
| amount_due | REAL | 1 | 0 | 0 |
| amount_paid | REAL | 1 | 0 | 0 |
| due_date | TEXT | 0 | 0 | Not specified |
| status | TEXT | 1 | 0 | 'outstanding' |
| created_at | TEXT | 1 | 0 | datetime('now') |
| updated_at | TEXT | 1 | 0 | datetime('now') |
| synced_at | TEXT | 0 | 0 | Not specified |

**Declared foreign keys:**
- `branch_id` -> `branches.id`; ON UPDATE NO ACTION; ON DELETE NO ACTION; FK group 0, position 0.
- `invoice_id` -> `invoices.id`; ON UPDATE NO ACTION; ON DELETE NO ACTION; FK group 1, position 0.
- `customer_id` -> `customers.id`; ON UPDATE NO ACTION; ON DELETE NO ACTION; FK group 2, position 0.

**Indexes:**
- `idx_credit_ledger_invoice` (invoice_id); unique=0, origin=c, partial=0.
  SQL: `CREATE INDEX idx_credit_ledger_invoice  ON credit_ledger(invoice_id)`
- `idx_credit_ledger_customer` (customer_id); unique=0, origin=c, partial=0.
  SQL: `CREATE INDEX idx_credit_ledger_customer ON credit_ledger(customer_id)`
- `sqlite_autoindex_credit_ledger_1` (id); unique=1, origin=pk, partial=0.

### `returns`

Historical row counts A / B: **0 / 0**.

| Column | Declared type | NOT NULL | PK position | Default |
| --- | --- | --- | --- | --- |
| id | TEXT | 0 | 1 | Not specified |
| invoice_id | TEXT | 0 | 0 | Not specified |
| customer_id | TEXT | 0 | 0 | Not specified |
| return_date | TEXT | 1 | 0 | datetime('now') |
| reason | TEXT | 1 | 0 | '' |
| total_refund | REAL | 1 | 0 | 0 |
| refund_method | TEXT | 1 | 0 | 'cash' |
| notes | TEXT | 0 | 0 | Not specified |
| created_by | TEXT | 0 | 0 | Not specified |
| status | TEXT | 1 | 0 | 'completed' |
| created_at | TEXT | 1 | 0 | datetime('now') |
| updated_at | TEXT | 1 | 0 | datetime('now') |

**Declared foreign keys:**
- `created_by` -> `users.id`; ON UPDATE NO ACTION; ON DELETE NO ACTION; FK group 0, position 0.
- `customer_id` -> `customers.id`; ON UPDATE NO ACTION; ON DELETE NO ACTION; FK group 1, position 0.
- `invoice_id` -> `invoices.id`; ON UPDATE NO ACTION; ON DELETE NO ACTION; FK group 2, position 0.

**Indexes:**
- `idx_returns_date` (return_date); unique=0, origin=c, partial=0.
  SQL: `CREATE INDEX idx_returns_date ON returns(return_date)`
- `idx_returns_invoice` (invoice_id); unique=0, origin=c, partial=0.
  SQL: `CREATE INDEX idx_returns_invoice ON returns(invoice_id)`
- `sqlite_autoindex_returns_1` (id); unique=1, origin=pk, partial=0.

### `return_items`

Historical row counts A / B: **0 / 0**.

| Column | Declared type | NOT NULL | PK position | Default |
| --- | --- | --- | --- | --- |
| id | TEXT | 0 | 1 | Not specified |
| return_id | TEXT | 1 | 0 | Not specified |
| product_id | TEXT | 0 | 0 | Not specified |
| invoice_item_id | TEXT | 0 | 0 | Not specified |
| quantity | REAL | 1 | 0 | 1 |
| unit_price | REAL | 1 | 0 | 0 |
| created_at | TEXT | 1 | 0 | datetime('now') |

**Declared foreign keys:**
- `product_id` -> `products.id`; ON UPDATE NO ACTION; ON DELETE NO ACTION; FK group 0, position 0.
- `return_id` -> `returns.id`; ON UPDATE NO ACTION; ON DELETE CASCADE; FK group 1, position 0.

**Indexes:**
- `sqlite_autoindex_return_items_1` (id); unique=1, origin=pk, partial=0.

### `sale_batch_allocations`

Historical row counts A / B: **0 / 0**.

| Column | Declared type | NOT NULL | PK position | Default |
| --- | --- | --- | --- | --- |
| id | TEXT | 0 | 1 | Not specified |
| invoice_id | TEXT | 1 | 0 | Not specified |
| invoice_item_id | TEXT | 1 | 0 | Not specified |
| product_id | TEXT | 1 | 0 | Not specified |
| batch_id | TEXT | 1 | 0 | Not specified |
| branch_id | TEXT | 1 | 0 | Not specified |
| quantity | REAL | 1 | 0 | Not specified |
| returned_quantity | REAL | 1 | 0 | 0 |
| unit_cost | REAL | 1 | 0 | 0 |
| unit_selling_price | REAL | 1 | 0 | 0 |
| cost_known | INTEGER | 1 | 0 | 1 |
| created_at | TEXT | 1 | 0 | datetime('now') |
| updated_at | TEXT | 1 | 0 | datetime('now') |
| synced_at | TEXT | 0 | 0 | Not specified |

**Declared foreign keys:**
- `branch_id` -> `branches.id`; ON UPDATE NO ACTION; ON DELETE NO ACTION; FK group 0, position 0.
- `batch_id` -> `product_batches.id`; ON UPDATE NO ACTION; ON DELETE NO ACTION; FK group 1, position 0.
- `product_id` -> `products.id`; ON UPDATE NO ACTION; ON DELETE NO ACTION; FK group 2, position 0.
- `invoice_item_id` -> `invoice_items.id`; ON UPDATE NO ACTION; ON DELETE NO ACTION; FK group 3, position 0.
- `invoice_id` -> `invoices.id`; ON UPDATE NO ACTION; ON DELETE NO ACTION; FK group 4, position 0.

**Indexes:**
- `idx_sale_batch_alloc_product_branch` (product_id, branch_id); unique=0, origin=c, partial=0.
  SQL: `CREATE INDEX idx_sale_batch_alloc_product_branch ON sale_batch_allocations(product_id, branch_id)`
- `idx_sale_batch_alloc_batch` (batch_id); unique=0, origin=c, partial=0.
  SQL: `CREATE INDEX idx_sale_batch_alloc_batch ON sale_batch_allocations(batch_id)`
- `idx_sale_batch_alloc_item` (invoice_item_id); unique=0, origin=c, partial=0.
  SQL: `CREATE INDEX idx_sale_batch_alloc_item ON sale_batch_allocations(invoice_item_id)`
- `idx_sale_batch_alloc_invoice` (invoice_id); unique=0, origin=c, partial=0.
  SQL: `CREATE INDEX idx_sale_batch_alloc_invoice ON sale_batch_allocations(invoice_id)`
- `sqlite_autoindex_sale_batch_allocations_1` (id); unique=1, origin=pk, partial=0.

### `return_batch_allocations`

Historical row counts A / B: **0 / 0**.

| Column | Declared type | NOT NULL | PK position | Default |
| --- | --- | --- | --- | --- |
| id | TEXT | 0 | 1 | Not specified |
| return_id | TEXT | 1 | 0 | Not specified |
| return_item_id | TEXT | 1 | 0 | Not specified |
| sale_allocation_id | TEXT | 1 | 0 | Not specified |
| batch_id | TEXT | 1 | 0 | Not specified |
| quantity | REAL | 1 | 0 | Not specified |
| created_at | TEXT | 1 | 0 | datetime('now') |
| updated_at | TEXT | 1 | 0 | datetime('now') |
| synced_at | TEXT | 0 | 0 | Not specified |

**Declared foreign keys:**
- `batch_id` -> `product_batches.id`; ON UPDATE NO ACTION; ON DELETE NO ACTION; FK group 0, position 0.
- `sale_allocation_id` -> `sale_batch_allocations.id`; ON UPDATE NO ACTION; ON DELETE NO ACTION; FK group 1, position 0.
- `return_item_id` -> `return_items.id`; ON UPDATE NO ACTION; ON DELETE NO ACTION; FK group 2, position 0.
- `return_id` -> `returns.id`; ON UPDATE NO ACTION; ON DELETE NO ACTION; FK group 3, position 0.

**Indexes:**
- `idx_return_batch_alloc_item` (return_item_id); unique=0, origin=c, partial=0.
  SQL: `CREATE INDEX idx_return_batch_alloc_item ON return_batch_allocations(return_item_id)`
- `idx_return_batch_alloc_return` (return_id); unique=0, origin=c, partial=0.
  SQL: `CREATE INDEX idx_return_batch_alloc_return ON return_batch_allocations(return_id)`
- `sqlite_autoindex_return_batch_allocations_1` (id); unique=1, origin=pk, partial=0.

### `audit_logs`

Historical row counts A / B: **3 / 26**.

| Column | Declared type | NOT NULL | PK position | Default |
| --- | --- | --- | --- | --- |
| id | TEXT | 0 | 1 | Not specified |
| user_id | TEXT | 0 | 0 | Not specified |
| branch_id | TEXT | 0 | 0 | Not specified |
| action | TEXT | 1 | 0 | Not specified |
| table_name | TEXT | 0 | 0 | Not specified |
| record_id | TEXT | 0 | 0 | Not specified |
| old_values | TEXT | 0 | 0 | Not specified |
| new_values | TEXT | 0 | 0 | Not specified |
| ip_address | TEXT | 0 | 0 | Not specified |
| created_at | TEXT | 1 | 0 | datetime('now') |
| updated_at | TEXT | 1 | 0 | datetime('now') |
| synced_at | TEXT | 0 | 0 | Not specified |

**Declared foreign keys:**
- `branch_id` -> `branches.id`; ON UPDATE NO ACTION; ON DELETE NO ACTION; FK group 0, position 0.
- `user_id` -> `users.id`; ON UPDATE NO ACTION; ON DELETE NO ACTION; FK group 1, position 0.

**Indexes:**
- `idx_audit_logs_date` (created_at); unique=0, origin=c, partial=0.
  SQL: `CREATE INDEX idx_audit_logs_date   ON audit_logs(created_at)`
- `idx_audit_logs_action` (action); unique=0, origin=c, partial=0.
  SQL: `CREATE INDEX idx_audit_logs_action ON audit_logs(action)`
- `idx_audit_logs_user` (user_id); unique=0, origin=c, partial=0.
  SQL: `CREATE INDEX idx_audit_logs_user   ON audit_logs(user_id)`
- `sqlite_autoindex_audit_logs_1` (id); unique=1, origin=pk, partial=0.

### `notifications`

Historical row counts A / B: **0 / 13**.

| Column | Declared type | NOT NULL | PK position | Default |
| --- | --- | --- | --- | --- |
| id | TEXT | 0 | 1 | Not specified |
| type | TEXT | 1 | 0 | Not specified |
| title | TEXT | 1 | 0 | Not specified |
| message | TEXT | 1 | 0 | Not specified |
| is_read | INTEGER | 1 | 0 | 0 |
| data | TEXT | 0 | 0 | Not specified |
| created_at | TEXT | 1 | 0 | datetime('now') |
| user_id | TEXT | 0 | 0 | Not specified |
| role_scope | TEXT | 0 | 0 | Not specified |
| target_branch_id | TEXT | 0 | 0 | Not specified |
| required_permission | TEXT | 0 | 0 | Not specified |

**Declared foreign keys:**
- `target_branch_id` -> `branches.id`; ON UPDATE NO ACTION; ON DELETE NO ACTION; FK group 0, position 0.
- `user_id` -> `users.id`; ON UPDATE NO ACTION; ON DELETE NO ACTION; FK group 1, position 0.

**Indexes:**
- `idx_notifications_permission` (required_permission); unique=0, origin=c, partial=0.
  SQL: `CREATE INDEX idx_notifications_permission ON notifications(required_permission)`
- `idx_notifications_role_branch` (role_scope, target_branch_id); unique=0, origin=c, partial=0.
  SQL: `CREATE INDEX idx_notifications_role_branch ON notifications(role_scope, target_branch_id)`
- `idx_notifications_user` (user_id); unique=0, origin=c, partial=0.
  SQL: `CREATE INDEX idx_notifications_user ON notifications(user_id)`
- `idx_notifications_created` (created_at); unique=0, origin=c, partial=0.
  SQL: `CREATE INDEX idx_notifications_created ON notifications(created_at DESC)`
- `idx_notifications_read` (is_read); unique=0, origin=c, partial=0.
  SQL: `CREATE INDEX idx_notifications_read    ON notifications(is_read)`
- `sqlite_autoindex_notifications_1` (id); unique=1, origin=pk, partial=0.

### `held_carts`

Historical row counts A / B: **0 / 0**.

| Column | Declared type | NOT NULL | PK position | Default |
| --- | --- | --- | --- | --- |
| id | TEXT | 0 | 1 | Not specified |
| branch_id | TEXT | 1 | 0 | Not specified |
| cashier_id | TEXT | 0 | 0 | Not specified |
| bill_type | TEXT | 1 | 0 | 'RETAIL' |
| customer_id | TEXT | 0 | 0 | Not specified |
| customer_name | TEXT | 0 | 0 | Not specified |
| items_json | TEXT | 1 | 0 | Not specified |
| global_discount | REAL | 1 | 0 | 0 |
| notes | TEXT | 0 | 0 | Not specified |
| valid_until | TEXT | 0 | 0 | Not specified |
| due_date | TEXT | 0 | 0 | Not specified |
| item_count | INTEGER | 1 | 0 | 0 |
| total_amount | REAL | 1 | 0 | 0 |
| created_at | TEXT | 1 | 0 | datetime('now') |
| updated_at | TEXT | 1 | 0 | datetime('now') |
| synced_at | TEXT | 0 | 0 | Not specified |

**Declared foreign keys:**
- `customer_id` -> `customers.id`; ON UPDATE NO ACTION; ON DELETE NO ACTION; FK group 0, position 0.
- `cashier_id` -> `users.id`; ON UPDATE NO ACTION; ON DELETE NO ACTION; FK group 1, position 0.
- `branch_id` -> `branches.id`; ON UPDATE NO ACTION; ON DELETE NO ACTION; FK group 2, position 0.

**Indexes:**
- `idx_held_carts_branch` (branch_id); unique=0, origin=c, partial=0.
  SQL: `CREATE INDEX idx_held_carts_branch ON held_carts(branch_id)`
- `sqlite_autoindex_held_carts_1` (id); unique=1, origin=pk, partial=0.

### `sync_queue`

Historical row counts A / B: **3 / 981**.

| Column | Declared type | NOT NULL | PK position | Default |
| --- | --- | --- | --- | --- |
| id | TEXT | 0 | 1 | Not specified |
| table_name | TEXT | 1 | 0 | Not specified |
| record_id | TEXT | 1 | 0 | Not specified |
| operation | TEXT | 1 | 0 | Not specified |
| payload | TEXT | 1 | 0 | Not specified |
| attempts | INTEGER | 1 | 0 | 0 |
| failure_cycles | INTEGER | 1 | 0 | 0 |
| next_retry_at | TEXT | 0 | 0 | Not specified |
| last_error | TEXT | 0 | 0 | Not specified |
| status | TEXT | 1 | 0 | 'pending' |
| created_at | TEXT | 1 | 0 | datetime('now') |
| synced_at | TEXT | 0 | 0 | Not specified |

**Declared foreign keys:**
None declared in this snapshot (logical relationships may still be enforced in code).

**Indexes:**
- `idx_sync_queue_table` (table_name, record_id); unique=0, origin=c, partial=0.
  SQL: `CREATE INDEX idx_sync_queue_table  ON sync_queue(table_name, record_id)`
- `idx_sync_queue_status` (status); unique=0, origin=c, partial=0.
  SQL: `CREATE INDEX idx_sync_queue_status ON sync_queue(status)`
- `sqlite_autoindex_sync_queue_1` (id); unique=1, origin=pk, partial=0.

### `sync_stock_baselines`

Historical row counts A / B: **0 / 100**.

| Column | Declared type | NOT NULL | PK position | Default |
| --- | --- | --- | --- | --- |
| record_id | TEXT | 0 | 1 | Not specified |
| quantity | REAL | 1 | 0 | Not specified |
| damaged_qty | REAL | 1 | 0 | 0 |

**Declared foreign keys:**
None declared in this snapshot (logical relationships may still be enforced in code).

**Indexes:**
- `sqlite_autoindex_sync_stock_baselines_1` (record_id); unique=1, origin=pk, partial=0.

## Appendix B. Twenty clean control rows - NOT dirty examples

Snapshot B contains **zero flagged product names**, so no dirty-row samples exist in that snapshot. These 20 rows are only controls showing which historical dataset was inspected. They are not current live products or proposed cleanup changes.

| Product ID | SKU | Existing historical master name | Active | Scan result |
| --- | --- | --- | --- | --- |
| 000484ba-0a6d-4b68-b159-69710228cac4 | PRD-110 | NALLAENAI (250ML) | 1 | No configured name-scan flag |
| 018c1ae2-576f-4ba8-b436-2a3b0ab70f3d | PRD-095 | BABY SHAMPOO | 1 | No configured name-scan flag |
| 01a02c26-3c17-45e3-9bec-77f1ef0aaf95 | PRD-006 | BISTHAM | 1 | No configured name-scan flag |
| 02e4bd35-0ec2-4dab-9144-72fab9e3e0f3 | PRD-151 | SIGNAL (BIG) | 1 | No configured name-scan flag |
| 051aed4b-df06-4ec5-836d-3a6e5a2d392c | PRD-096 | BABY POWDER | 1 | No configured name-scan flag |
| 08177b34-6fcd-44c3-8da1-23af67a9849d | PRD-043 | SOYA MEET (100G) | 1 | No configured name-scan flag |
| 0907d028-4398-45ae-ae2b-29a9f0f05cfa | PRD-038 | MORMILAKA | 1 | No configured name-scan flag |
| 0927436d-9764-4d46-9043-3b3b6c6ef219 | PRD-181 | CHIK SHAMPOO | 1 | No configured name-scan flag |
| 092ca949-a91d-4ce7-a21b-43fd6cba7377 | PRD-141 | FAIR LOVELY BIG | 1 | No configured name-scan flag |
| 092cb1fd-69f8-47f2-b23c-344ceb74b6de | PRD-069 | COHOCALTE BISCUTE | 1 | No configured name-scan flag |
| 09466c53-cfaa-4f99-98db-43c96dd1b691 | NO-SKU-09466C53 | ANCHOR | 0 | No configured name-scan flag |
| 09b4e5e7-b444-4f7f-b17e-0a70fc61f77f | PRD-042 | KADDALA PARUPPU | 1 | No configured name-scan flag |
| 09d6aa0a-0226-441a-8cf6-1a8179af8219 | PRD-186 | LIBBOUY SHOP | 1 | No configured name-scan flag |
| 0a4c7130-f2cb-4d82-b616-963e6643378e | PRD-008 | WHITE SUGAR | 1 | No configured name-scan flag |
| 0b229f80-d964-40f7-9deb-0fb403d2241d | PRD-052 | MANJAL KATTI | 1 | No configured name-scan flag |
| 0c2d5892-5620-4ec8-a7f0-69eda44ce216 | PRD-185 | AMIRTHA PATTHI | 1 | No configured name-scan flag |
| 0d0256a8-d4b2-406e-be37-4ac2f797fc9f | PRD-176 | KOMBA SHOP | 1 | No configured name-scan flag |
| 0ff3585e-29a6-4b7a-a966-58277aec7cc8 | PRD-056 | PEERICHANPALAM | 1 | No configured name-scan flag |
| 106fd1be-7abd-42bc-b2f3-401025578af7 | PRD-072 | KACHAN | 1 | No configured name-scan flag |
| 144be401-ea35-46f3-8a42-f170ad081917 | PRD-170 | NIVIRA CREAM | 1 | No configured name-scan flag |

## Appendix C. Source-only terminal/device schemas

The following definitions were read as text, not executed. They are not proof that the corresponding sidecar or cloud table exists in the current live deployment. The main POS database has no general `terminals` table in Snapshot A.

### `pos_devices` -> `erp/backend/database/saas-schema.sql`

```sql
CREATE TABLE IF NOT EXISTS pos_devices (
  id             CHAR(36)     NOT NULL PRIMARY KEY,
  company_id     CHAR(36)     NOT NULL,
  branch_id      CHAR(36),
  device_name    VARCHAR(255) NOT NULL,
  device_id      VARCHAR(100) NOT NULL UNIQUE,
  license_key    CHAR(36)     NOT NULL UNIQUE,
  os_info        VARCHAR(255),
  app_version    VARCHAR(20),
  status         VARCHAR(20)  NOT NULL DEFAULT 'active',
  last_seen_at   DATETIME,
  activated_at   DATETIME,
  deactivated_at DATETIME,
  notes          TEXT,
  created_at     DATETIME     NOT NULL DEFAULT NOW(),
  updated_at     DATETIME     NOT NULL DEFAULT NOW() ON UPDATE NOW(),
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  INDEX idx_device_company (company_id),
  INDEX idx_device_license (license_key),
  INDEX idx_device_status  (status)
);
```

### `terminal_hub_identity` -> `erp/electron/branchHub/client.ts`

```sql
CREATE TABLE IF NOT EXISTS terminal_hub_identity (id INTEGER PRIMARY KEY CHECK(id=1), branch_id TEXT NOT NULL, terminal_id TEXT NOT NULL, hub_url TEXT NOT NULL);
```

### `terminal_hub_holds` -> `erp/electron/branchHub/client.ts`

```sql
CREATE TABLE IF NOT EXISTS terminal_hub_holds (
        id TEXT PRIMARY KEY, hold_number TEXT NOT NULL, payload TEXT NOT NULL,
        state TEXT NOT NULL, created_at TEXT NOT NULL, remote_number TEXT, error TEXT);
```

### `terminal_hub_recalls` -> `erp/electron/branchHub/client.ts`

```sql
CREATE TABLE IF NOT EXISTS terminal_hub_recalls (
        request_id TEXT PRIMARY KEY, hold_key TEXT NOT NULL UNIQUE, state TEXT NOT NULL,
        payload TEXT, error TEXT, created_at TEXT NOT NULL);
```

### `manual_local_holds` -> `erp/electron/branchHub/localHolds.ts`

```sql
CREATE TABLE IF NOT EXISTS manual_local_holds (
      id TEXT PRIMARY KEY, branch_id TEXT NOT NULL, number TEXT NOT NULL,
      payload TEXT NOT NULL, state TEXT NOT NULL, created_at TEXT NOT NULL);
```

### `hub_identity` -> `erp/electron/branchHub/store.ts`

```sql
CREATE TABLE IF NOT EXISTS hub_identity (singleton INTEGER PRIMARY KEY CHECK(singleton=1), branch_id TEXT NOT NULL);
```

### `hub_holds` -> `erp/electron/branchHub/store.ts`

```sql
CREATE TABLE IF NOT EXISTS hub_holds (
        id TEXT PRIMARY KEY, hold_number TEXT NOT NULL, business_day TEXT NOT NULL,
        terminal_id TEXT NOT NULL, payload TEXT NOT NULL, payload_hash TEXT NOT NULL, local_number TEXT UNIQUE,
        state TEXT NOT NULL DEFAULT 'available', consumed_by TEXT, created_at TEXT NOT NULL,
        UNIQUE(business_day, hold_number));
```

### `hub_requests` -> `erp/electron/branchHub/store.ts`

```sql
CREATE TABLE IF NOT EXISTS hub_requests (
        terminal_id TEXT NOT NULL, request_id TEXT NOT NULL, payload_hash TEXT NOT NULL, response TEXT NOT NULL,
        PRIMARY KEY(terminal_id,request_id));
```

## Appendix D. Evidence integrity and scope

| Historical database | SHA-256 |
| --- | --- |
| `backups/pre-deploy-58ace25-20261110/local-pos-workspace/pos-erp.db` | `f058eec8bdbd896e80c8ee477463defc22b3c262e1e652a992e16af7acc6196f` |
| `backups/pre-deploy-58ace25-20261110/local-pos-workspace/backups/pos-erp-backup-2026-11-07T01-44-41.db` | `e3b66904dda7ac7c4a84ed5d30466aa5b24d4124f5f1c7a4bbc5d2ae2b0cde8f` |

Hashes were compared before and after metadata generation and remained identical. No source module, migration, settings or database content was written by this discovery work. Source review and these historical read-only probes do not validate the current live company data or production tenant schema.
