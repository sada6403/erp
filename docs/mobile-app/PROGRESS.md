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
