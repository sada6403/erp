import { randomUUID } from 'crypto'
import { getDb } from '../database'
import { logAudit } from './auditLog'

const EPSILON = 0.01

function money(v: number): number {
  return Math.round((Number(v) || 0) * 100) / 100
}

export interface WalletDebitResult {
  walletId: string
  transactionId: string
  paymentId: string
  walletRow: Record<string, unknown>
  transactionRow: Record<string, unknown>
  paymentRow: Record<string, unknown>
}

export interface WalletReversalResult {
  walletId: string
  transactionId: string
  walletRow: Record<string, unknown>
  transactionRow: Record<string, unknown>
}

// Runs INSIDE the invoice DB transaction — mirrors redeemCouponInTransaction
// (electron/ipc/coupons.ts) exactly: any throw rolls the whole sale back, so
// a failed sale can never spend wallet balance. Also inserts the payments
// row (method='smartbuy_wallet') here, main-process only — the renderer's
// own 'smartbuy_wallet' payment lines are rejected upstream in
// invoices:create, the same defense already used for 'coupon' lines.
//
// "Using another customer's wallet" is prevented by construction, not a
// runtime check: this always resolves the wallet via the INVOICE's own
// customerId — there is no separate "wallet owner" parameter a caller could
// mismatch against.
export function debitWalletForInvoice(
  db: ReturnType<typeof getDb>,
  input: { customerId: string; amount: number; invoiceId: string; branchId?: string | null; userId?: string | null }
): WalletDebitResult {
  const amount = money(input.amount)
  if (!input.customerId) throw new Error('SmartBuy Wallet payment requires a customer')
  if (!(amount > 0)) throw new Error('SmartBuy Wallet amount must be greater than zero')

  const wallet = db.prepare('SELECT * FROM smartbuy_wallet WHERE customer_id=?').get(input.customerId) as
    { id: string; balance: number } | undefined
  if (!wallet) throw new Error('This customer has no SmartBuy Wallet')
  const balance = Number(wallet.balance) || 0
  if (amount > balance + EPSILON) {
    throw new Error(`SmartBuy Wallet balance is Rs.${balance.toFixed(2)} — cannot apply Rs.${amount.toFixed(2)}`)
  }

  // Conditional decrement — the same double-spend guard as coupons and
  // every other balance-touching write in this codebase: the row only
  // updates if the balance is still sufficient at write time, closing the
  // race window between the read above and this write.
  const newBalance = money(Math.max(0, balance - amount))
  const changed = db.prepare(`
    UPDATE smartbuy_wallet SET balance=?, updated_at=datetime('now') WHERE id=? AND balance >= ?
  `).run(newBalance, wallet.id, amount - EPSILON)
  if (!changed.changes) throw new Error('SmartBuy Wallet balance changed — please re-check and try again')

  const transactionId = randomUUID()
  const transactionRow = {
    id: transactionId, wallet_id: wallet.id, customer_id: input.customerId, transaction_type: 'debit',
    amount, balance_after: newBalance, source: 'pos_purchase', redemption_id: null,
    invoice_id: input.invoiceId, notes: null, created_by: input.userId || null,
  }
  db.prepare(`
    INSERT INTO smartbuy_wallet_transactions
      (id, wallet_id, customer_id, transaction_type, amount, balance_after, source, redemption_id, invoice_id, notes, created_by)
    VALUES (@id,@wallet_id,@customer_id,@transaction_type,@amount,@balance_after,@source,@redemption_id,@invoice_id,@notes,@created_by)
  `).run(transactionRow)

  const paymentId = randomUUID()
  const paymentRow = {
    id: paymentId, invoice_id: input.invoiceId, method: 'smartbuy_wallet', amount,
    reference: null, received_by: input.userId || null, wallet_transaction_id: transactionId,
  }
  db.prepare(`
    INSERT INTO payments (id, invoice_id, method, amount, reference, received_by, wallet_transaction_id)
    VALUES (@id,@invoice_id,@method,@amount,@reference,@received_by,@wallet_transaction_id)
  `).run(paymentRow)

  logAudit(db, {
    userId: input.userId || null, branchId: input.branchId || null,
    action: 'SMARTBUY_WALLET_DEBITED', tableName: 'smartbuy_wallet', recordId: wallet.id,
    oldValues: { balance }, newValues: { balance: newBalance, amount, invoiceId: input.invoiceId },
  })

  const walletRow = db.prepare('SELECT * FROM smartbuy_wallet WHERE id=?').get(wallet.id) as Record<string, unknown>
  return { walletId: wallet.id, transactionId, paymentId, walletRow, transactionRow, paymentRow }
}

// Runs INSIDE the invoice cancel transaction — mirrors reverseCouponForInvoice
// exactly: restores the balance for every un-reversed POS-purchase debit on
// this invoice via a new, separate 'credit' transaction row (source=
// 'invoice_reversal'). The original debit row is never touched or deleted —
// full history stays intact either way.
export function reverseWalletForInvoice(
  db: ReturnType<typeof getDb>,
  invoiceId: string,
  userId?: string | null
): WalletReversalResult[] {
  const debits = db.prepare(`
    SELECT wallet_id, customer_id, SUM(amount) as net_amount
    FROM smartbuy_wallet_transactions
    WHERE invoice_id=? AND transaction_type='debit'
    GROUP BY wallet_id, customer_id
    HAVING SUM(amount) > 0
  `).all(invoiceId) as { wallet_id: string; customer_id: string; net_amount: number }[]

  const results: WalletReversalResult[] = []
  for (const d of debits) {
    const wallet = db.prepare('SELECT * FROM smartbuy_wallet WHERE id=?').get(d.wallet_id) as { id: string; balance: number } | undefined
    if (!wallet) continue
    const amount = money(d.net_amount)
    const newBalance = money(Number(wallet.balance) + amount)
    db.prepare(`UPDATE smartbuy_wallet SET balance=?, updated_at=datetime('now') WHERE id=?`).run(newBalance, wallet.id)

    const transactionId = randomUUID()
    const transactionRow = {
      id: transactionId, wallet_id: wallet.id, customer_id: d.customer_id, transaction_type: 'credit',
      amount, balance_after: newBalance, source: 'invoice_reversal', redemption_id: null,
      invoice_id: invoiceId, notes: 'Invoice cancelled — wallet payment reversed', created_by: userId || null,
    }
    db.prepare(`
      INSERT INTO smartbuy_wallet_transactions
        (id, wallet_id, customer_id, transaction_type, amount, balance_after, source, redemption_id, invoice_id, notes, created_by)
      VALUES (@id,@wallet_id,@customer_id,@transaction_type,@amount,@balance_after,@source,@redemption_id,@invoice_id,@notes,@created_by)
    `).run(transactionRow)

    logAudit(db, {
      userId: userId || null, branchId: null,
      action: 'SMARTBUY_WALLET_REVERSED', tableName: 'smartbuy_wallet', recordId: wallet.id,
      oldValues: { balance: wallet.balance }, newValues: { balance: newBalance, amount, invoiceId },
    })

    const walletRow = db.prepare('SELECT * FROM smartbuy_wallet WHERE id=?').get(wallet.id) as Record<string, unknown>
    results.push({ walletId: wallet.id, transactionId, walletRow, transactionRow })
  }
  return results
}
