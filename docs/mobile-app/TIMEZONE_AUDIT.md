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

## Known, NOT changed here (goes to Step 4 with the report day-grouping fix)
- Reads that compare `date(created_at)` / `strftime('%Y-%m', ...)` / `date('now')` (analytics, agents month, chits dashboards, installment overdue/reminder buckets, communications, batches expiry): they use the **UTC** day, so between 00:00 and 05:30 Colombo they see "yesterday". Needs per-report review.
- `BranchTransferForm.tsx` `localDateTimeInputValue` feeds a `datetime-local` input (PC zone); fine on a Colombo PC.

## Cloud
Every MySQL session runs UTC (`backend/lib/db.ts`). Rollout and cursor safety: `PRODUCTION_RUNBOOK.md` section 3a, test `backend/tests/sync-tz.test.mjs`.
