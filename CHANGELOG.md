# Changelog

## 2.11.6 - 2026-11-27 - Use saved barcodes for placeholder SKUs

- Products: saving an imported product with a barcode now replaces a `NO-SKU-` or `PENDING-` placeholder with that barcode as its SKU. Genuine custom SKUs remain unchanged and duplicate/inactive SKU reservations are still checked.

## 2.11.5 - 2026-11-27 - Remove stray zero on product cards

- POS: products with no variants no longer display a stray `0` beside the SKU. Prices and stock quantities are unchanged.

## 2.11.4 - 2026-11-27 - Keyboard billing and same-bill extra items

- POS: wider cart, visible quantity/discount/payment actions, wrapping toolbar and keyboard hints. Tab reaches quantity, price and discount fields; Enter returns from quantity to product search. Ctrl+Up/Down selects cart rows; F3 edits quantity.
- POS: Ctrl+B finds a saved bill by its number or last digits. Open it and use Ctrl+P to reprint from the billing screen.
- POS: Add items opens an extra-items cart for a completed, paid retail bill. F12 collects the extra payment and saves/prints the same bill number while preserving original lines and payments. Cash, card and bank transfer are supported; locked bills, online-order bills and bills with active returns are protected.
- Extra-item writes validate prices, discounts and stock, update stock batches and agent commissions, and record an audit entry. Concurrent changes and duplicate retries are rejected.

## 2.11.3 - 2026-11-26 - Barcode search fix

- Product search lists a product while its barcode is being typed. With search keywords enabled, digits used to match only a complete SKU or barcode, so a partly typed barcode showed nothing. From 4 digits, any part of a barcode, SKU or additional barcode now matches; 1-3 digit quick codes stay exact.
- Additional barcodes are also found by partial search when search keywords are off.

## 2.11.2 - 2026-11-26 - Keyboard stock entry, supplier quotations and faster POS scanning

- POS: a scanned barcode is added to the cart at once, even when the scanner sends no Enter, and never twice. Enter on an exact barcode/SKU always picks that product.
- POS: while the loose-item quantity panel is open, every keystroke goes to the quantity; a scanned barcode is rejected instead of being added as a quantity.
- POS: the sidebar is hidden on the billing screen for full-width billing; the menu button shows it again.
- Bills: Admins and managers can cancel one or several bills with a reason. Stock, batches, credit, coupons and wallet are reversed, and the change is audited and synced.
- Stock entry (supermarket): new keyboard-first workbench. Enter moves through product, quantity (12, 2 ctn, 500g), free qty, cost, supplier offer (10%, 150, 10+1), selling price, MRP, customer offer (90, 10%, -20) with dates, barcode, batch, MFD and expiry. It includes instant local search and scanner support, a stock and price comparison panel, F2-F9 and Ctrl shortcuts, a review step, F4 quick create, draft autosave and crash recovery.
- Additional product barcodes, internal barcode generation and duplicate barcode validation. POS scanning finds additional barcodes.
- Customer offers entered during stock entry become dated product discounts.
- Supplier quotation and reorder: pick a supplier to see its low-stock products with stock, incoming orders, 30-day sales, last price and a recommended quantity. You can add products or new-item requests, save a request for quotation, print it or save it as a PDF, or send it on WhatsApp without any prices. Then record the prices the supplier confirms and convert the quotation into a purchase order. Products already on pending orders need a manager override.
- Supplier order WhatsApp and email messages now use the company name from Settings.
- A 500-line stock receipt saves in about 1 second instead of about 2.4 seconds.

## 2.11.1 - 2026-11-26 - Supermarket purchasing, batch inventory and faster loose-item billing

- POS: loose items (kg, g, l, ml, m) open a quantity panel docked in the cart sidebar instead of a centre popup. Enter adds, Esc cancels, Alt+1-4 adds quick amounts (250g/500g/1kg/2kg), and the line total shows while typing. F3 or Ctrl+Enter edits the selected cart line.
- Purchases: barcode/SKU product search, create products inline linked to the supplier, free quantity, line discount, MRP, entry units with conversion, draft orders and partial receiving without duplicate stock.
- Receiving: batch number, manufacture date and expiry date are entered per line when goods arrive. Orders no longer ask for them. Expiry-tracked products cannot be received without an expiry date.
- Batch inventory: each receipt keeps its own cost, selling price, MRP and expiry. FEFO/FIFO allocation never sells expired batches in supermarket mode, and selling price cannot exceed MRP.
- Pricing: previous/latest purchase price, stock after receipt, weighted average cost and suggested price are shown during entry. Pricing can be batch-wise, latest-price or weighted-average + markup. Manual price changes need a reason and are audit-logged.
- Supplier returns, supplier due/credit balances, inventory alert reports (expired, near expiry, low stock) and stock movement history.
- Bulk stock-in import includes supplier, free quantity, discount, MRP, batch and dates, with preview and transactional import.
- Optional POS Testing Mode with a separate sandbox database. External services are blocked while it is active. An unreadable sandbox now shows an error instead of failing silently at startup.
- Payment dialog: Alt+A agent, Alt+G coupon, Alt+M amount.
- Purchase returns and new purchase/batch columns sync through additive cloud schema changes.

## 2.11.0 - 2026-11-25 - Guided checkout and branch PostgreSQL billing replica

- Agent suggestions prioritize exact codes; Enter/Tab advances agent → gift coupon → payment amount without submitting a sale. Typed coupon prefixes show bounded local suggestions, with customer/date/status filtering and final validation before applying.
- Reuse the warm keyword search index without rereading the full product catalog on every key; matched products retain current prices and stock.
- Add opt-in, per-terminal billing outboxes in the existing SQLite transaction, authenticated background delivery to branch Hub SQLite and a retry-safe PostgreSQL invoice snapshot projection. Cloud MySQL and existing product/stock sync remain unchanged.
- Branch Hub 0.2.0 supports 1–5 terminals, separate terminal invoice prefixes, changeable server addresses, PostgreSQL backlog/status and a Windows setup/rollback guide. PostgreSQL credentials stay on the branch server.
- Branch PostgreSQL support requires explicit enrollment and branch machine setup; it is not a full ERP database migration or a shared stock/wallet authority.

## 2.10.3 - 2026-11-25 - HTTPS cloud endpoint recovery

- Automatically migrate only the legacy service HTTP :4001 URL to the existing HTTPS POS API for sync, license refresh and saved settings. Custom server endpoints remain unchanged.
- Includes the 2.10.2 product SKU save and offline sync handling fixes.


## 2.10.2 - 2026-11-25 - Product SKU save and offline sync handling

- Preserve generated SKUs when blank form values are submitted; normalize barcode-derived codes and reject duplicates with an existing-product warning.
- Keep existing SKUs on partial price/status edits; retain product codes when a barcode matches a different product SKU. Inactive product codes remain reserved.
- Keep approval and duplicate checks transactional; preserve canonical product identity in sync payloads.
- Always release Sync Now loading state after rejected requests and skip extra remote diagnostic queries when the cloud health check has already failed.

## 2.10.1 - 2026-11-25 - Keyboard checkout and cloud batch sync repair

- Payment dialog: reliable amount focus, contained Tab/Shift+Tab navigation, agent Arrow/Enter selection, Ctrl+1-4 and F9/F10 method selection, F2 customer picker, and native Enter on buttons.
- Prevent repeated Enter from creating duplicate payments; suspend parent shortcuts under the customer picker and keep the footer visible while payment fields scroll.
- Add the missing cloud physical-batch identity schema through additive tenant compatibility; existing receipt quantities and costs are preserved.
- Make Windows-1252 decoding consistent between Electron/Node 20 and newer development runtimes.
- Fix standalone superadmin password-input imports so production deployment does not depend on desktop node_modules.

## 2.10.0 - 2026-11-24

- Keep email and add unique, case-insensitive User IDs with backup-first legacy ID generation. Login accepts either identifier; cashier passwords, admin identity editing and identifier-only remembering are supported.
- Default-hidden password fields have visibility controls. Added expiring, single-use email reset links using hashed tokens, with admin reset remaining available.
- Added manufacture/expiry/batch validation to product opening stock, batch entry, purchase receipt and bulk import. Duplicate batches require explicit Add quantity confirmation; mismatched dates and expired stock require acknowledgement.
- Unique physical batch identities preserve all historic receipt quantities and purchase cost layers. Batch display aggregates quantities by physical batch and branch.
- Added SQLite/MySQL staging migration and compatibility rollback runners. See docs/releases/2.10.0.md for deployment order and validation limits.

## 2.9.6 - 2026-11-23 - Mobile app orders, Smart Buy app features & sync fixes

- App orders: convert a mobile-app order to a POS invoice with locked prices, delivery fee and extracted tax; the order's stock reservation is released at conversion (no double count); Cash on Delivery settles the invoice paid amount.
- Product sync: product attributes/variants (`product_attributes`) and variant stock aggregates now sync to the cloud and app correctly; the POS pull keeps rows whose optional parent was deleted and accepts NULL for defaulted NOT NULL columns.
- New admin pages: App Access, Online Store, App Control (banners, featured products, app versions per channel), Product Reviews moderation, Sales Team (hierarchy, monthly targets), Agent Cash approval/remittance, Smart Buy join requests and bank-slip review.
- Business dates are shown in Asia/Colombo (UTC storage); sync pull overlap handles non-UTC machines.
- Company profile from POS settings now drives app, receipts and the Play legal pages.
- Upgrade note: desktop 2.9.6 works with the deployed backend (c9a2ed0). Older desktops keep syncing but do not push the new app-order/product fields.

## 2.9.5 - 2026-11-10 - POS Management Control, Terminal Isolation & Draft PO Workflow Fix

- Added the Company-Admin-only Management Control menu (`/admin/management`) with secure HTTPS Electron IPC integration for managing Director/management accounts, branch/region/zone scopes, sales targets, salary & commission policies, payroll drafts/approvals, and live session revocation without exposing tokens or Cloud API keys to the renderer.
- Enforced POS operational terminal isolation blocking `Management Web Only` staff accounts from cashier/POS terminal logins while preserving full access for authorized POS roles.
- Fixed supermarket Draft Purchase Order creation so staff can place and share purchase orders (WhatsApp/Email) without an upfront supplier invoice while leaving inventory, FIFO stock batches, and prices unchanged; direct stock entries and the order receiving gate (`PARTIAL` / `RECEIVED`) continue strictly enforcing mandatory supplier PDF/image bills inside the transaction.
- Migrated desktop auto-updater feed URL (`publish.url`) to HTTPS (`https://updates.nfplantation.com/`) while preserving backward-compatible update hosting for existing v2.9.4 installations.

## 2.9.4 - 2026-11-07 - Required supplier bills and detailed upload history

- Supplier PDF/image bills are required for new supermarket purchases and stock receiving. Validation runs inside the transaction so bill failures cannot commit stock or price changes.
- Existing attached bills can be reused when receiving an order. Removing the last bill requires uploading its replacement first.
- Supplier Bills now lists individual files with supplier, invoice/purchase reference, purchase date, upload date/time, uploader, file type and size.
- Added upload-date, uploader, file-type and status filters alongside existing supplier/date/search filters, plus upload metadata in purchase details.
- Supermarket Excel imports prepare drafts; upload the supplier bill before receiving stock.
- Corrected the paid-purchase details display so a zero outstanding balance stays zero.

## 2.9.3 - 2026-11-06 - Supermarket stock purchases and product pricing

- Added two stock-entry options on the existing purchase page: supplier purchase orders with receiving, and direct entry of delivered stock using product search.
- Added supplier PDF/image bills during entry and receiving, date-wise received-stock history, and supplier/date/bill-reference filters.
- Connected receipts, POS sales, returns, cancellations and invoice corrections to FIFO batch cost tracking. Historical batch costs remain unchanged.
- Added separate Stock & Profit and Owner Investments pages while preserving the original Dashboard. Fixed duplicate active sidebar selection.
- Receipt prices now update current product purchase/selling prices and refresh Products/POS. Products without a common selling price require one when receiving stock.
- Added separate owner investment records, supermarket-only activation, additive local/cloud schema updates and sync support.

Deployment order: backend compatibility migrations first, followed by desktop installer and updater metadata. Existing stock/sales without recorded batch costs remain explicitly marked as historical cost unknown. Purchase bill files are stored in the company workspace on the receiving device.

## 2.8.3 — 2026-10-25 — Supermarket SmartBuy Scheme Enhancements & Winner Settlement

- **Supermarket SmartBuy Scheme Engine**:
  - Added support for flexible scheme frequencies (Weekly, Monthly).
  - Enforced strict maximum customer capacity (`max_customers`) with capacity validation and slots remaining indicator in Admin UI.
  - Added option `add_winner_paid_amount` ("Scheme + Paid" vs "Scheme Only"):
    - Scheme + Paid: Winner receives Scheme Chit Value + Total Installment Amount paid by the winner.
    - Scheme Only: Winner receives original Scheme Chit Value.
    - Final cycle settlement ensures remaining customers receive original Scheme Amount.
- **Reporting & Accounting**:
  - SmartBuy winning draws report now displays `Scheme Amount`, `Paid by Winner`, and `Product Purchase Value`.
- **Backend & Tenant Compatibility**:
  - Added automated migration in `runTenantCompatibility` for `frequency`, `max_customers`, `add_winner_paid_amount` on `chit_schemes`, and `winner_paid_amount`, `product_purchase_value` on `chit_draws`.
  - Updated tenant creation module defaults.

## 2.8.2 — 2026-10-17 — Lock Business Type selection to SuperAdmin only

- Removed editable `Business Type` dropdown selector from Desktop POS System Settings.
- Replaced with read-only badge indicator showing centrally assigned industry mode (Supermarket, Retail, Furniture, Chit Fund).
- Prevents local POS operators from altering company industry assignment; industry types are exclusively managed in SuperAdmin portal.

## 2.8.1 — 2026-10-17 — Supermarket clean mode & SmartBuy industry isolation

- **Supermarket / Food City Isolation**:
  - Hides SmartBuy, Chit Funds, Installments, and Quotations cleanly across Desktop POS and Admin UI when `business_type` is set to `supermarket`.
  - Removes SmartBuy scheme buttons from Customers page, voucher filtering from Coupons, and Manager assignments from Branches for supermarkets.
  - POS payment modal suppresses Installment payment tab and SmartBuy wallet options in supermarket mode.
- **SmartBuy Continuity for Natural Plantation & Retail**:
  - Ensures SmartBuy and Chit Fund features remain 100% active and accessible for Natural Plantation and non-supermarket businesses.
  - Added backward-compatible module resolution so existing companies retain full SmartBuy access.

## 2.7.28 — 2026-10-12 — WhatsApp credentials share and branch management updates

- Added "Share via WhatsApp" click-to-chat action to branch cards with pre-filled activation key and manager credentials.
- WhatsApp compose opens with pre-typed text and waits for manual user confirmation before sending.
- Fixed SMTP email service configuration persistence for active company workspaces.

## 2.7.27 — 2026-10-09 — Company contact details cloud sync

- Company address, phone, email, website, TIN/registration number and invoice
  note now sync as company-wide settings across every activated POS device.
- Login screens refresh the shared company contact details from the cloud.
- Branding sync now compares the actual cached fields as well as its sync
  marker, repairing devices whose old cache was incorrectly considered current.

Deployment order: backend first, followed by the 2.7.27 Windows installer and
auto-updater metadata.

## 2.7.26 — 2026-10-07 — Cross-branch stock correction fix

- Company Admin can correct stock for any active branch from Edit Product, not only Main Branch.
- Inactive/recovered historical branches are hidden from the stock target list; the backend now returns a clear "branch is inactive" error instead of a misleading authorization error.
- "Product updated" toast is shown only after the stock correction succeeds (no more split success).

## 2.7.24 — 2026-10-06 — Stock control permissions and edit_requests sync repair

- Fixed sync failure on `edit_requests` where cloud database rejected insert with "Field 'reason' doesn't have a default value":
  - Kept `reason` in cloud payloads instead of stripping it as a local-only field.
  - Added server-side fallback values and adjusted MySQL schema so reason and requested changes are nullable.
  - Fix & Retry now automatically heals and requeues any blocked edit request records.
- Stock count sessions and manual branch stock corrections are restricted to Main Branch inventory controllers and Company Admin.

Deployment order: backend first, followed by the 2.7.24 Windows installer and auto-updater metadata.


- Clear All Data events are now included in the fast cloud watermark so every
  open branch device detects a company-wide reset within seconds.
- Other devices immediately show a blocking “All Company Data Was Cleared”
  screen with a Refresh button; a local polling fallback prevents missed IPC
  events during renderer reloads.
- Refresh wipes stale local transactional data and starts a full cloud re-pull
  before allowing the device to continue.

Deployment order: backend watermark first, followed by the 2.7.19 Windows
installer and auto-updater metadata.

Internal release log. Not customer-facing.

## 2.7.18 — 2026-10-06 — Main Branch Admin stock correction

- Edit Product now lets the Company Admin manually correct Current Stock Qty
  when Main Branch is selected.
- Manual stock corrections require a reason and create stock movement and audit
  records. Other roles and non-main branches remain read-only.
- Stock Count create, edit, import and finalize operations now enforce the same
  Company Admin + Main Branch restriction.
- Branch stock totals and manual corrections safely handle multiple warehouse
  rows without duplicating count items or multiplying quantities.

Deployment order: publish the 2.7.18 Windows installer and auto-updater metadata.

Internal release log. Not customer-facing.

## 2.7.17 — 2026-10-06 — Company deletion and Clear All Data reliability

- POS now detects a company permanently deleted from SuperAdmin even while the
  device is logged out, then safely resets the deleted workspace and returns to
  company activation.
- Clear All Data now removes business and transactional records from the cloud
  tenant database before wiping the local device, preventing deleted products,
  invoices, customers and stock from returning on the next sync.
- Password verification, cloud clearing and the multi-device reset event are
  handled as one protected server-side flow. Users, roles, branches and company
  configuration are retained.

Deployment order: backend first, followed by the 2.7.17 Windows installer and
auto-updater metadata.

Internal release log. Not customer-facing.

## 2.7.16 — 2026-10-01 — SuperAdmin English onboarding, password recovery & login stability

- SuperAdmin: Onboarding guides for WhatsApp and Email are 100% English only.
- SuperAdmin: Added dedicated Password Manager with options to view current saved password, send current password via WhatsApp/Email, or reset to a new password with 1-click delivery.
- POS Login: Fixed PIN toast notification spam on email typing keystrokes.
- POS Login: Removed dummy admin email auto-fill / pre-fill on logout.

## 2.7.14 — 2026-09-29 — Smart Buy payments, sync recovery, and branch-safe scheme creation

- Late Smart Buy payments now show the full cycle balance plus the applicable
  late fee before collection. Late fees are charged once per cycle and never
  count as installment principal or advance credit.
- Pending-payment management now includes customer search and a clearer
  required/paid/balance/late-charge/pay-now breakdown.
- Smart Buy voucher balances can be printed with winner bills and remain
  visible in the pending-voucher dashboard until fully used.
- Cloud sync now repairs a missing Scheme → Member parent chain before retrying
  a contribution, preventing Smart Buy payments from remaining permanently
  failed with a foreign-key error.
- Sync cursor compatibility was added for Smart Buy wallet, transfer,
  commission-history, and payment-reminder tables.
- The header warning dot now appears only for a real failed/error state;
  ordinary pending work uses a pulsing Wi-Fi icon and refreshes immediately
  after sync data changes.
- The New Smart Buy Scheme form now exposes the required Scheme Master template
  selector. Template-controlled financial fields auto-fill and are locked.
- Smart Buy Managers are restricted to their login branch and that branch's
  agents when creating a scheme. Cross-branch participation continues through
  the existing invite/approve collaboration workflow. Super Admin retains
  company-wide branch selection.

Deployment order: deploy the backend first, then publish the Windows installer
and updater metadata from `release/`.

## 2.7.0 — 2026-08-29 — Stock/inventory feature work + reporting

Minor version bump (not a patch) — this release folds in feature work from
a separate session, in addition to everything already shipped through
2.6.15:

- New Product/Stock Intelligence pages and stock-management IPC handlers
  (`electron/ipc/stocks.ts`, `electron/ipc/products.ts` extended).
- New `AdvancedReportsPage` — multi-category data viewing with CSV/Excel/PDF
  export.
- `AnalyticsPage`/`InventoryPage` updates, a small local schema addition
  (`database/schema.sql`, `electron/database.ts`), and an updated product
  import template.

**Scope note, stated plainly**: this feature work was authored in a
different session, not this one. It was pulled in via `git pull`, and
verified only to the extent that both `tsc --noEmit` checks (electron +
renderer) pass cleanly after the merge — the feature logic itself has not
been independently reviewed or manually tested here. Client-side only;
no backend files are touched by this batch, so the already-deployed
backend needs no changes for this release.

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
