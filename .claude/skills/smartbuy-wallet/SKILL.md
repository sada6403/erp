---
name: smartbuy-wallet
description: Any change touching the Smart Buy wallet — balance, credit after a win or scheme end, wallet checkout, wallet history, or the POS↔cloud wallet sync. Prevents double spending.
---

# Smart Buy wallet

Rules from the business: wallet money comes only from a draw win or a completed scheme, after POS admin
approval. It can ONLY buy products. No cash withdrawal from the app. Leftover stays in the wallet.

## Existing code (ERP repo)
- Tables: `smartbuy_wallet` (one per customer, `balance`), `smartbuy_wallet_transactions`
  (`transaction_type` credit|debit, `amount`, `balance_after`, `source`, `redemption_id`, `invoice_id`).
- Desktop debit: `electron/services/smartbuyWallet.ts` (local SQLite, then syncs the wallet row with an
  absolute `balance`).

## The known bug you must not make worse
Cloud sync is last-write-wins per row. A desktop push of `smartbuy_wallet` with an absolute balance can
overwrite a debit the app made in the cloud (and vice versa) → double spend.
Before any app wallet checkout ships, implement the fix chosen in `docs/mobile-app/ARCHITECTURE.md` §10
(default A: ledger-authoritative balance):
1. In `backend/lib/sync.ts` `applyOperation`, special-case `smartbuy_wallet`: ignore the incoming
   `balance`; inside the existing transaction `SELECT … FOR UPDATE` the wallet, then set
   `balance = SUM(credit) − SUM(debit)` from `smartbuy_wallet_transactions` for that wallet.
2. Push order matters: the desktop must push the transaction row before the wallet row (check
   `syncQueue` ordering); the server recompute makes the order harmless either way.
3. A desktop debit that would make the ledger negative → reject with a clear sync error and create a
   review item; never clamp silently.

## App wallet checkout (server)
`POST /api/app/v1/orders` with `wallet_amount > 0`:
1. Idempotency-Key required.
2. `START TRANSACTION` → lock wallet `FOR UPDATE` → recompute balance from ledger →
   `wallet_amount ≤ balance` and `wallet_amount ≤ product subtotal` (never delivery fee unless
   `app_settings.wallet_covers_delivery = true`).
3. Insert order + items, insert debit transaction (`source = 'app_order'`, link order id), update
   `balance`, commit. Any failure → rollback, nothing spent.
4. Cancelled/returned order → credit back with `source = 'app_order_refund'`, linked to the debit.

## App (`mobile/`)
- Never compute or cache a spendable balance for decisions. Show the cached balance with an "as of"
  time; checkout always re-quotes from the server (`/checkout/quote`, never persisted).
- The order mutation sends a UUID `Idempotency-Key` generated once per checkout attempt, so a retry
  after a timeout can't debit twice.
- Wallet screens call `usePreventScreenCapture()`.

## Tests
- Two parallel checkouts that each fit the balance but not together → exactly one succeeds.
- Desktop push of an old absolute balance after an app debit → cloud balance still equals the ledger.
- Wallet cannot pay the delivery fee (default) and cannot go negative.
