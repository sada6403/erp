# Mobile app progress

## Run 1
- Done: repo setup (skills copied to .claude/skills, CLAUDE.md pointer, DECISIONS.md, PROGRESS.md).
- In progress: workstream A (backend), B (mobile), C (POS desktop).
- Mocked (dev only): none yet.
- Blocked: none.
- Next: contracts, schema, auth endpoints, mobile scaffold.

## 2026-11-07, convert app order to invoice (v1.0)
- POS: `orders:convertToInvoice` (Orders page, "Convert to invoice") builds on the shared `createInvoice` core in `electron/ipc/invoices.ts`; locked prices, one invoice per order (unique `invoices.source_order_id`, `customer_orders.invoice_id`), FIFO + stock + sync reused, order moves to `ready_for_delivery`.
- Price edits need a price-edit role + reason + `APP_ORDER_PRICE_OVERRIDE` audit row. Marking the order paid later settles the invoice (`settleAppOrderInvoice`).
- Backend: `GET /agent/deliveries/:id/bill` (409 until invoiced; `bill_no` = invoice number), `AgentBillDto` contract, cloud columns in `appSchema.ts`.
- Fixed: `orders.agentsForOrder` / `assignAgent` were missing from `preload.ts` (Assign agent would have failed).
- Tests: `electron/__qa__/app-order-invoice.integration.test.ts` (6 pass), backend `npm test` 20 pass, both typechecks clean.

## How to test on your phone

Phone serial `0002205R60002053`, USB debugging on. One command reconnects it after unplugging
(sets `adb reverse` for the backend :3000 and Metro :8081, starts Metro, opens the app):

```powershell
cd mobile
.\scripts\phone.ps1          # demo mock data
.\scripts\phone.ps1 -Real    # real local backend (seeded TEST company, backend must run on :3000)
```

The dev API URL is chosen per device with no code edits: a physical phone in a dev build uses
`http://localhost:3000` (through `adb reverse`, override with `API_BASE_URL_DEVICE`); the emulator keeps
`http://10.0.2.2:3000` (`API_BASE_URL`). Release builds always use `API_BASE_URL`.

Test logins (seed data only, no real accounts):

| Role | Mock mode (Quick Login cards) | Real mode (`-Real`) |
|---|---|---|
| Customer | `0771234567` | `0771110003`, password `Test@1234` |
| Smart Buy member | `NP-1042` | `0771110001` / `NP-1`, password `Test@1234` |
| Agent | `NP-AG-204` | `AG001`, password `Test@1234` |
| First login (set password) | n/a | `0771110002`, temp password in `backend/.seed-output.json` |

Mock mode accepts any password. Real-mode values come from `backend/.seed-output.json`.

Windows native build note: the repo path is too long for CMake/ninja (260 chars), so the dev APK is built from a
short-path mirror (`C:\np`, copy of `mobile/` incl. node_modules; `android/build.gradle` and `android/app/build.gradle`
set `buildStagingDirectory` to `C:/b/<module>`). `mobile/android/` is generated and git-ignored; Metro and all JS
come from the real `mobile/` folder, so only native changes need a rebuild.
