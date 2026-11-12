# Timezone audit (POS code paths that write or compare dates)

Rule: **timestamps are UTC, business dates are the Asia/Colombo calendar day, display is Asia/Colombo.**

## Timestamps written by POS (all UTC already, nothing to convert)
`datetime('now')` (SQLite, ~100 sites) and `new Date().toISOString()` (`branchTransfers.ts`, `orders.ts` dispatch/delivered, `claimReminderService.ts`, `InstallmentsPage.tsx` paid_at). No POS path writes a local-time *timestamp* string, so historical POS rows do not shift on screen.

## Business dates (date-only fields): were UTC or PC-local, now Colombo (fixed)
| Where | Was | Now |
|---|---|---|
| `electron/ipc/chits.ts` product_received_at (draw win, early redemption: SQL + synced row) | `date('now')` / `toISOString().slice(0,10)` (UTC day) | `date('now','+330 minutes')` / `colomboToday()` |
| `electron/ipc/admin.ts` installments `last_paid_date` (2 sites) | `date('now')` | `date('now','+330 minutes')` |
| `electron/services/purchaseBillHistory.ts` uploaded_from/to filter | `date(x,'localtime')` (PC zone) | `date(x,'+330 minutes')` |
| `PurchaseOrdersPage.tsx` (2), `SupermarketOverview.tsx` default date | `getTimezoneOffset()` (PC zone) | `colomboToday()` |

## Report day grouping: fixed in Step 4
Stored timestamps stay UTC; every report/dashboard query now converts to the Colombo calendar day in SQL: `date(x.created_at,'+330 minutes')`, `strftime('%Y-%m', x.created_at, '+330 minutes')`, and `date('now','+330 minutes')` instead of `date('now')` (a sale at 19:00Z = 00:30 next day in Colombo now lands on the next day; 17:00Z stays on the same day).

| Area | Files |
|---|---|
| Sales / revenue / profit / daily report, default date ranges (`colomboToday()`) | `ipc/analytics.ts`, `ipc/reports.ts` |
| Invoice list filters, sales export | `ipc/invoices.ts`, `services/salesImportExport.ts` |
| Agents, commissions, coupons, expenses filters | `ipc/agents.ts`, `ipc/commissions.ts`, `ipc/coupons.ts`, `ipc/admin.ts` |
| Smart Buy dashboards (collected today/this month, 6-month trends, draw windows) | `ipc/chits.ts` |
| Installment overdue/due-today buckets, reminders, batch expiry, discount validity, notifications | `ipc/admin.ts`, `ipc/communications.ts`, `ipc/notifications.ts`, `ipc/batches.ts`, `ipc/discounts.ts` |

Test: `electron/__qa__/colombo-report-day.integration.test.ts` (19:00Z -> 11 Nov, 17:00Z -> 10 Nov, via `analytics:salesSummary` and `analytics:dailyReport`).

## Still open (low impact)
- `chits.ts` scheduling helpers that build date strings with `new Date().toISOString().slice(0,10)` (draw/cycle due dates, lines ~159, 294, 960, 3212, 3555) still use the UTC day between 00:00 and 05:30 Colombo.
- `purchases.ts` `date(COALESCE(purchase_date, created_at))` fallback and `BranchTransferForm.tsx` `datetime-local` input (PC zone; fine on a Colombo PC).

## Cloud
Every MySQL session runs UTC (`backend/lib/db.ts`). Rollout and cursor safety: `PRODUCTION_RUNBOOK.md` section 3a, test `backend/tests/sync-tz.test.mjs`.
