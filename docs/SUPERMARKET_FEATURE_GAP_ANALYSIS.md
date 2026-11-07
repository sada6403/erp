# Supermarket stock and profit audit

Date: 2026-11-06

## Existing functionality reused

The Electron/React/SQLite POS already provides products, suppliers, purchase orders, stock receiving, stock movements, batch/expiry screens, sales, returns, roles, and reports. No replacement POS or duplicate procurement/batch pages were needed.

## Gaps found and implementation

| Requirement | Gap found | Implementation |
|---|---|---|
| Purchases and bills | No distinct purchase invoice history or saved bill attachments | Extended existing purchase details with invoice dates, persistent local PDF/image attachments, and date filters; removed the silent 200-row history limit |
| FIFO batches | Receipts and checkout only changed aggregate stock | Receipt cost layers and transactional FIFO allocations linked to invoice items; show remaining, purchased, sold and finished stock on existing Batches screen |
| Selling prices | Batch prices were absent | Optional selling price at receipt and on existing batch details; blank uses the product common price. Checkout quotes a weighted unit price when one line spans batches |
| Profit | Current product cost changed apparent historical profit | Immutable sale allocation costs, discount-adjusted revenue, original-layer returns and cancellations |
| Dashboard | Existing dashboard showed many unrelated operational metrics | Supermarket-only dashboard with the five requested totals, refreshed on entry, window focus, every 15 seconds, and after investment entry |
| Owner investment | No separate general supermarket capital ledger | Owner-only amount/date form and filtered history in the dashboard; excluded from sales and profit |

## Data and module boundaries

Schema changes are additive. Existing product costs and receipts are retained. Missing historical stock costs are explicitly marked unknown; the dashboard excludes unknown costs from cost/profit totals and shows the affected quantities. Existing historical sales without batch allocation records cannot have their actual cost reconstructed.

Supermarket checkout uses FIFO and disallows overselling. Other modules retain their previous cost calculation and do not use the new supermarket dashboard or receipt allocations. Direct supermarket batch quantity/cost edits are blocked to keep the purchase and aggregate-stock ledgers consistent. Purchases continue to use the existing main-branch procurement permissions.

Bill files are retained in the active company workspace on the receiving device. This implementation does not add remote storage for attachment binaries.

## Validation

- Frontend TypeScript check, Electron TypeScript check, and production web build passed.
- Real SQLite integration tests cover the requested Rice example, overselling rollback, exact cancellation restoration, partial returns and return cancellation, mixed/common selling prices, fractional quantities, and invoice quantity corrections (6 tests passed).
- Existing cart regression tests plus a FIFO batch price test (19 tests passed).

Rice example: purchases 5 at Rs.150 and 10 at Rs.200, sold 7 at Rs.250: cost Rs.1,150, earned gross profit Rs.600, remaining 8 units costing Rs.1,600, expected sales Rs.2,000, expected gross profit Rs.400.

Desktop visual testing and live multi-device/cloud synchronization are not covered by these tests. Additional advanced workflows (supplier returns, expense attachments, price-audit systems, and redesigns) are outside this request.

## UI visibility follow-up

The active local company was Retail, while a separate Supermarket workspace exists. Supermarket controls correctly remain restricted to the Supermarket company. The existing packaged executable dated 2026-11-03 also predates the new functionality.

Fixed one-time module detection by sharing a hook that reloads on settings updates and window focus, with normalized company types and dashboard retry handling. The sidebar branding cache now detects business-type changes. Added clear links to Stock & Profit and Owner Investments and supermarket labels for existing purchase/batch pages.

Verification: 2 module-visibility regression tests passed; frontend typecheck passed; browser preview with isolated mock data rendered the five totals, investment form, purchase date filters, and menu links. Switching that preview to Retail removed supermarket links, and switching back restored them without reload. Screenshot: `output/playwright/supermarket-dashboard-visible.png`.

Built `release/Enterprise POS ERP Setup 2.9.2.exe`. The standard packaging rebuild encountered a file lock from the running POS, so packaging reused the existing Electron-compatible native binary with npmRebuild disabled. A smoke test of the packaged SQLite dependency against an in-memory database passed. No live company configuration or database was changed, and the installer has not been installed automatically.

## Actual TK Fresh Choice activation and verification

The reported screenshot was from the real development app, authenticated as Company Admin in TK Fresh Choice. This company is centrally classified Retail, so the original industry-only gate hid every new stock/profit feature. Asking the user to select another company did not resolve their intended workflow.

Added a company-local `supermarket_stock_enabled` setting and wired the stock/profit backend and UI to it consistently. Its toggle is in Settings > Industry & Supermarket Settings; enabling/disabling requires Company Admin. Existing supermarket-industry companies remain enabled automatically. This setting does not change the company's industry, Smart Buy, installments, or unrelated modules and is preserved during cloud branding refresh.

Restarted the actual development Electron app gracefully and enabled the module through its authenticated settings handler for TK Fresh Choice. Verified real dashboard totals, owner investment form, purchase history/date filters, purchase entry modal, and remaining-stock screen using Playwright attached to that running app. Confirmed activation survives page reload and cloud branding refresh. No test purchases, sales, or investments were added to the real company.

Live screenshot: `output/playwright/tk-fresh-choice-supermarket-live.png`. The dashboard correctly reports that historical cost is unavailable for existing opening stock and sales. Historical stock quantities remain available; actual profit is recorded from new costed receipts and batch-allocated sales onward. Existing company identity and industry remain unchanged.

## Dashboard restoration and two purchase-entry routes

Restored the original Dashboard at `/admin` including its existing revenue, alerts, charts and transfer workflows. Stock & Profit is now `/admin/stock-profit`; Owner Investments is `/admin/investments`. Each menu selects only its own route.

The existing Stock Purchases & Bills page now offers (1) Order from Supplier: draft, send, partial/full receipt; and (2) Add Received Stock Directly: search existing products, quantities, cost, optional selling price and immediate stock receipt. Both use the same purchase/order/item/batch/attachment tables. Only `purchase_type` and line `selling_price` columns were added.

Both entry forms and PO receiving allow supplier PDFs/images to be selected before saving. Receipt/bill rows commit in the same transaction. Cancelling a form discards unlinked staged files; failed saves can retry. Existing purchase-detail attachment upload remains available. Duplicate supplier invoice numbers and repeated form submissions do not add stock twice. Fractional stock movements retain their quantities.

The page includes All Purchases, Purchase Orders, Direct Stock, Date-wise Stock Received, and Supplier Bills views. Filters include purchase/receipt dates, supplier and purchase/bill reference. Receipt history records each received batch with received/remaining quantities and access to bills.

Validation: 15 SQLite integration tests passed across FIFO, both entry workflows and real attachment file staging/persistence/rollback. Live TK Fresh Choice UI checked through Playwright: original dashboard restored; exactly one sidebar selection on each new page; both entry forms display bill upload; product search returns existing Rice products; received-stock history query and bill/supplier filters work. No test financial records were inserted into the live company. Evidence: `output/playwright/tk-dashboard-restored.png`, `tk-purchase-two-options.png`, `tk-direct-stock-search.png`, and `tk-order-stock-with-bill.png`.

## Receipt price propagation fix

Receipt quantities and batch costs were saved, but product-master prices were not updated. Product-list caching also kept stale data across navigation. Both direct receipts and purchase-order receiving now update the current product cost and any explicitly entered selling price atomically with the stock receipt, preserving all prior batch costs. Blank selling price retains a valid existing common price; a product without one requires an entered selling price before receiving.

Received-product rows are synchronized and a products-updated event invalidates the shared product-list cache and refreshes the POS grid. Entry guidance now explains purchase versus selling prices.

Repaired the two missing master purchase costs in saved receipt MAIN-001-PO-2026-0001 through the authenticated app handler: CHOCO BLOOBS Rs.150 (stock unchanged at 10), GOLD MARIE BISCUTE Rs.100 (stock unchanged at 16). No selling prices were stored for these lines, so selling prices were not invented. The owner must enter those through the existing product edit form. The repair only fills missing master prices and does not overwrite known prices or change stock.

Validation: 20 real SQLite integration tests passed, including master-price updates, unchanged historical batch costs, preservation of existing common selling prices, missing-selling-price rejection, rollback, and cost repair without quantity changes. Frontend and Electron TypeScript checks passed. Actual Products UI verified both corrected costs. Screenshot: output/playwright/tk-receipt-product-prices-repaired.png.

## Mandatory supplier bills and upload history (2026-11-07)

New supermarket purchases in both entry modes now require an uploaded PDF/image before saving. Receiving existing orders requires at least one active saved bill or a newly selected upload. These checks run in the stock transaction; missing/expired/empty uploads cannot commit stock or product-price changes. Existing orders and data remain intact. The last saved bill cannot be removed until a replacement has been attached. Excel imports remain available as draft preparation; bill-free immediate receiving is blocked.

The existing Supplier Bills tab now shows individual files with supplier, invoice/purchase reference, purchase date, uploaded-at local time, uploader name, file type/size and purchase total. Filters cover purchase date, upload date, staff, supplier, file type, status and text search. Existing purchase details also display upload time and uploader next to the file. Reused the existing purchase_attachments table and permissions; no duplicate document tables/pages were added.

Validation: 29 SQLite integration tests passed across mandatory bill enforcement, transactional rollback, upload integrity, bill-history scoping/filtering and FIFO. Frontend and Electron TypeScript checks passed. Live TK Fresh Choice forms verified disabled save buttons without bills; existing supplier image appeared with Admin upload metadata and working filters. No test purchases were created in live data. Evidence: output/playwright/mandatory-supplier-bill-direct.png and output/playwright/supplier-bill-history-filters.png. These changes are included in v2.9.4; v2.9.3 was the previous release.
