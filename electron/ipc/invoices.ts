import type { IpcMain } from 'electron'
import { getDb } from '../database'
import crypto from 'crypto'
import { enqueuSync } from '../services/syncQueue'
import { logAudit } from '../services/auditLog'
import Store from 'electron-store'
import { insertStockMovement } from '../services/stockMovement'
import { syncStockRow, syncCustomerRow } from '../services/stockSync'
import { redeemCouponInTransaction, reverseCouponForInvoice, type CouponRedemptionResult } from './coupons'
import { debitWalletForInvoice, reverseWalletForInvoice, type WalletDebitResult, type WalletReversalResult } from '../services/smartbuyWallet'
import { resolveApplicableDiscount } from './discounts'
import { safeHandle } from './ipcHandler'
import { computeAndRecordCommission } from '../services/commissionEngine'

const store = new Store()

export type BillType = 'RETAIL' | 'QUOTATION' | 'CREDIT'

const BILL_PREFIX: Record<BillType, string> = {
  RETAIL:    'INV',
  QUOTATION: 'QT',
  CREDIT:    'CR',
}

// Atomic sequence counter: {BRANCH_CODE}-{PREFIX}-{YEAR}-{SEQ:0004}
export function getNextBillNumber(branchId: string, billType: BillType): string {
  const db = getDb()
  const year = new Date().getFullYear()
  const prefix = BILL_PREFIX[billType]

  const branch = db.prepare('SELECT code, name FROM branches WHERE id = ?').get(branchId) as
    { code: string | null; name: string } | undefined
  const branchCode = (branch?.code || branch?.name?.slice(0, 4) || 'BR').toUpperCase().replace(/\s+/g, '')

  const seqId = `${branchId}-${billType}-${year}`
  let row = db.prepare('SELECT last_seq FROM bill_sequences WHERE branch_id=? AND bill_type=? AND year=?')
    .get(branchId, billType, year) as { last_seq: number } | undefined

  if (!row) {
    db.prepare(`
      INSERT OR IGNORE INTO bill_sequences (id, branch_id, bill_type, year, last_seq)
      VALUES (?, ?, ?, ?, 1)
    `).run(seqId, branchId, billType, year)
    row = { last_seq: 1 }
  } else {
    db.prepare(`
      UPDATE bill_sequences SET last_seq = last_seq + 1
      WHERE branch_id=? AND bill_type=? AND year=?
    `).run(branchId, billType, year)
    row = db.prepare('SELECT last_seq FROM bill_sequences WHERE branch_id=? AND bill_type=? AND year=?')
      .get(branchId, billType, year) as { last_seq: number }
  }

  const seq = String(row.last_seq).padStart(4, '0')
  return `${branchCode}-${prefix}-${year}-${seq}`
}

function getAuthUser() {
  return store.get('auth_user') as Record<string, unknown>
}

// Legacy fallback for roles nobody has explicitly configured yet via
// Admin → Discounts → Max Discount Limits (mirrors src/components/pos/Cart.tsx).
function legacyMaxDiscount(roleName: string): number {
  const lower = roleName.toLowerCase()
  if (lower.includes('cashier')) return 5
  if (lower.includes('manager')) return 15
  return 100
}

// Returns null when the caller is unrestricted (Company Admin — perms.all).
function resolveMaxDiscountPct(user: Record<string, unknown>): number | null {
  const role = user?.role as Record<string, unknown> | undefined
  const perms = (role?.permissions as Record<string, unknown>) || (user?.permissions as Record<string, unknown>) || {}
  if (perms.all) return null
  if (typeof perms.max_discount_pct === 'number') return perms.max_discount_pct
  return legacyMaxDiscount(String(role?.name || 'Cashier'))
}

function defaultBranchId() {
  return 'b1111111-1111-4111-8111-111111111111'
}

const money = (v: number) => Math.round((Number(v) || 0) * 100) / 100

export function registerInvoiceHandlers(ipcMain: IpcMain) {
  // Get next bill number preview
  safeHandle(ipcMain, 'invoices:nextNumber', (_e, billType: BillType = 'RETAIL') => {
    const user = getAuthUser()
    const branchId = (user?.branch_id as string) || defaultBranchId()
    const number = getNextBillNumber(branchId, billType)
    return { success: true, data: number }
  })

  // Create invoice — handles all 3 bill types
  safeHandle(ipcMain, 'invoices:create', async (_e, payload) => {
      const db = getDb()
      const user = getAuthUser()
      const perms = ((user?.role as Record<string, unknown>)?.permissions as Record<string, unknown>) || (user?.permissions as Record<string, unknown>) || {}
      // A non-global caller's session branch always wins — `payload.branch_id`
      // used to be trusted outright, so a cashier could attribute a sale
      // (and its stock decrement / credit-ledger posting) to another branch
      // just by sending a different id. Only a global (perms.all) caller may
      // set an explicit branch via payload (e.g. Company Admin backfilling).
      const branchId = perms.all
        ? (payload.branch_id || (user?.branch_id as string) || defaultBranchId())
        : ((user?.branch_id as string) || defaultBranchId())
      const billType: BillType = payload.bill_type || 'RETAIL'
      const id = crypto.randomUUID()
      const invoiceNumber = getNextBillNumber(branchId, billType)
      const movementRecords: Record<string, unknown>[] = []
      const itemRecords: Record<string, unknown>[] = []
      const paymentRecords: Record<string, unknown>[] = []
      const commissionEnqueue: Array<{ table: string; id: string; row: Record<string, unknown>; op: 'INSERT' }> = []
      let creditLedgerRecord: Record<string, unknown> | null = null
      let couponResult: CouponRedemptionResult | null = null
      let walletDebitResult: WalletDebitResult | null = null
      const agentCode = String(payload.agent_code || '').trim() || null
      const agentName = String(payload.agent_name || '').trim() || null
      const agentId = String(payload.agent_id || '').trim() || null
      // Commission is computed per line item below, against each product's
      // own Commission Rule — not a flat % of the whole bill the cashier
      // used to type in. A line with no matching rule earns nothing.
      let agentCommissionAmount = 0

      // --- Server-side price integrity (renderer is untrusted) ---
      // unit_price/tax_rate/line_total used to be taken as-is from the
      // payload — a modified client (or a direct IPC call) could set ANY
      // price. There's no "custom price" feature anywhere in this app, so
      // every line's unit_price must match the product's real, current
      // selling_price; quantity must be a positive whole number. This is
      // the actual amount downstream discount/credit/total logic trusts.
      const priceByProduct = new Map<string, { selling_price: number; tax_rate: number }>()
      for (const item of (payload.items || [])) {
        const qty = Number(item.quantity)
        if (!Number.isFinite(qty) || qty <= 0 || !Number.isInteger(qty)) {
          return { success: false, error: 'Every item must have a whole-number quantity greater than zero' }
        }
        const productId = String(item.product_id || '')
        if (!priceByProduct.has(productId)) {
          const product = db.prepare('SELECT selling_price, tax_rate FROM products WHERE id=?')
            .get(productId) as { selling_price: number; tax_rate: number } | undefined
          if (!product) return { success: false, error: `Product not found: ${productId}` }
          priceByProduct.set(productId, product)
        }
        const real = priceByProduct.get(productId)!
        if (Math.abs(Number(item.unit_price || 0) - Number(real.selling_price || 0)) > 0.01) {
          return { success: false, error: 'A product price changed since this was added to the cart — please refresh and try again' }
        }
      }

      // --- Discount cap validation (server-side; the client-side cap in
      // Cart.tsx can be bypassed by a modified renderer) — and, in the same
      // pass, the server-authoritative subtotal/discount/tax this handler
      // now uses for the invoice header instead of trusting payload totals.
      const maxDiscountPct = resolveMaxDiscountPct(user)
      let itemsSubtotal = 0, itemsDiscountTotal = 0, itemsTaxTotal = 0
      {
        const TOLERANCE = 0.5 // absorb client-side rounding
        let clientItemDiscountTotal = 0
        for (const item of (payload.items || [])) {
          const real = priceByProduct.get(String(item.product_id))!
          const unitPrice = money(real.selling_price)
          const qty = Number(item.quantity)
          const pct = Number(item.discount_pct || 0)
          clientItemDiscountTotal += Number(item.discount_amount || 0)
          const discountAmount = money(unitPrice * qty * Math.max(0, Math.min(100, pct)) / 100)
          const taxable = money(unitPrice * qty - discountAmount)
          itemsSubtotal += unitPrice * qty
          itemsDiscountTotal += discountAmount
          itemsTaxTotal += money(taxable * (Number(real.tax_rate) || 0) / 100)
          if (maxDiscountPct === null || unitPrice <= 0) continue
          const auto = resolveApplicableDiscount(db, item.product_id, unitPrice, branchId)
          const allowed = Math.max(maxDiscountPct, auto?.pct || 0)
          if (pct > allowed + TOLERANCE) {
            return { success: false, error: `Discount ${pct}% on an item exceeds your allowed limit (${allowed.toFixed(1)}%)` }
          }
        }
        itemsSubtotal = money(itemsSubtotal)
        itemsDiscountTotal = money(itemsDiscountTotal)
        itemsTaxTotal = money(itemsTaxTotal)
        if (maxDiscountPct !== null) {
          const subtotal = Number(payload.subtotal || 0)
          const globalDiscountAmount = Number(payload.discount_amount || 0) - clientItemDiscountTotal
          const globalDiscountPct = subtotal > 0 ? (globalDiscountAmount / subtotal) * 100 : 0
          if (globalDiscountPct > maxDiscountPct + TOLERANCE) {
            return { success: false, error: `Overall discount ${globalDiscountPct.toFixed(1)}% exceeds your allowed limit (${maxDiscountPct}%)` }
          }
        }
      }
      // Whole-bill discount on top of item-level discounts (e.g. a manager
      // knocking a flat amount off the total) — its percentage is already
      // capped above; only the portion beyond the items' own discounts
      // survives into the authoritative total.
      const globalDiscount = Math.max(0, money(Number(payload.discount_amount || 0)) - money(
        (payload.items || []).reduce((sum: number, item: Record<string, unknown>) => sum + (Number(item.discount_amount) || 0), 0)
      ))
      const finalSubtotal = itemsSubtotal
      const finalDiscountAmount = money(itemsDiscountTotal + globalDiscount)
      const finalTaxAmount = itemsTaxTotal
      const finalTotalAmount = money(finalSubtotal - finalDiscountAmount + finalTaxAmount)
      const finalDueAmount = money(Math.max(0, finalTotalAmount - Number(payload.paid_amount || 0)))

      // --- Credit bill validation ---
      if (billType === 'CREDIT') {
        if (!payload.customer_id) {
          return { success: false, error: 'Credit bill requires a customer' }
        }
        // Check credit limit
        const customer = db.prepare('SELECT credit_limit, outstanding_due FROM customers WHERE id = ?')
          .get(payload.customer_id) as { credit_limit: number; outstanding_due: number } | undefined
        if (customer) {
          // Also sum from credit_ledger
          const ledger = db.prepare(`
            SELECT COALESCE(SUM(amount_due - amount_paid), 0) as balance
            FROM credit_ledger WHERE customer_id = ? AND status = 'outstanding'
          `).get(payload.customer_id) as { balance: number }
          const currentOutstanding = Math.max(customer.outstanding_due, ledger.balance)
          if (customer.credit_limit > 0 && currentOutstanding + finalTotalAmount > customer.credit_limit) {
            return {
              success: false,
              error: `Credit limit exceeded. Limit: ${customer.credit_limit.toFixed(2)}, Outstanding: ${currentOutstanding.toFixed(2)}, This bill: ${finalTotalAmount.toFixed(2)}`
            }
          }
        }
        // Maker-checker: approver cannot be the same as the creator
        if (payload.approved_by && payload.approved_by === (user?.id as string)) {
          return { success: false, error: 'Creator cannot approve a credit bill. Another manager must approve.' }
        }
      }

      // --- Coupon validation (balance-type gift voucher) ---
      // The redemption itself runs INSIDE the invoice transaction below, so a
      // failed sale never spends coupon balance. Renderer-supplied 'coupon'
      // payment lines are rejected — the payments row is inserted by the main
      // process only (prevents double-counting).
      const couponRequest = payload.coupon as { code?: string; amount?: number } | undefined
      if (couponRequest && billType !== 'RETAIL') {
        return { success: false, error: 'Coupons can only be redeemed on retail bills' }
      }
      const rendererPaymentLines = Array.isArray(payload.payments) ? payload.payments : (payload.payment ? [payload.payment] : [])
      if (rendererPaymentLines.some((p: Record<string, unknown>) => String(p?.method || '').toLowerCase() === 'coupon')) {
        return { success: false, error: 'Coupon payments must be sent via the coupon field, not as a payment line' }
      }

      // --- SmartBuy Wallet validation ---
      // Same pattern as coupons: the renderer never gets to claim a trusted
      // wallet amount as a plain payment line (a modified client could
      // otherwise just assert "paid Rs.X via wallet" with no server-side
      // balance check) — it's sent via its own field and the main process
      // validates + debits + inserts the payments row itself, inside the
      // same invoice transaction so a failed sale never spends wallet balance.
      if (rendererPaymentLines.some((p: Record<string, unknown>) => String(p?.method || '').toLowerCase() === 'smartbuy_wallet')) {
        return { success: false, error: 'SmartBuy Wallet payments must be sent via the smartbuy_wallet field, not as a payment line' }
      }
      const walletRequest = payload.smartbuy_wallet as { amount?: number } | undefined
      const walletAmount = walletRequest ? Number(walletRequest.amount || 0) : 0
      if (walletAmount > 0) {
        if (billType !== 'RETAIL') return { success: false, error: 'SmartBuy Wallet can only be used on retail bills' }
        // "Prevent: using another customer's wallet" is enforced by
        // construction below (debitWalletForInvoice always resolves the
        // wallet via THIS invoice's own customer_id) — this check only
        // covers the simpler, equally-required case of no customer at all.
        if (!payload.customer_id) return { success: false, error: 'SmartBuy Wallet requires a customer to be selected' }
      }

      const insertInvoice = db.transaction(() => {
        // Determine status based on bill type
        let status = 'completed'
        if (billType === 'QUOTATION') status = 'draft'
        if (billType === 'CREDIT') status = payload.approved_by ? 'completed' : 'pending_approval'

        db.prepare(`
          INSERT INTO invoices (id, invoice_number, branch_id, customer_id, cashier_id,
            bill_type, status, valid_until, due_date, approved_by,
            subtotal, discount_amount, tax_amount, total_amount, paid_amount, due_amount,
            agent_code, agent_name, agent_id, agent_commission_pct, agent_commission_amount, notes)
          VALUES (@id, @invoice_number, @branch_id, @customer_id, @cashier_id,
            @bill_type, @status, @valid_until, @due_date, @approved_by,
            @subtotal, @discount_amount, @tax_amount, @total_amount, @paid_amount, @due_amount,
            @agent_code, @agent_name, @agent_id, @agent_commission_pct, @agent_commission_amount, @notes)
        `).run({
          id,
          invoice_number:  invoiceNumber,
          branch_id:       branchId,
          customer_id:     payload.customer_id || null,
          cashier_id:      (user?.id as string) || 'u9999999-9999-4999-8999-999999999999',
          bill_type:       billType,
          status,
          valid_until:     billType === 'QUOTATION' ? (payload.valid_until || null) : null,
          due_date:        billType === 'CREDIT' ? (payload.due_date || null) : null,
          approved_by:     billType === 'CREDIT' ? (payload.approved_by || null) : null,
          subtotal:        finalSubtotal,
          discount_amount: finalDiscountAmount,
          tax_amount:      finalTaxAmount,
          total_amount:    finalTotalAmount,
          paid_amount:     payload.paid_amount || 0,
          due_amount:      finalDueAmount,
          agent_code:      agentCode,
          agent_name:      agentName,
          agent_id:        agentId,
          // Filled in below once each line's commission is computed —
          // depends on the invoice_items rows this same statement is about
          // to precede.
          agent_commission_pct: 0,
          agent_commission_amount: 0,
          notes:           payload.notes || null,
        })

        // Insert line items — money fields recomputed from the product's
        // real price/tax_rate (validated above) and the already-capped
        // discount_pct, never taken as-is from the payload. Only the
        // percentage is trusted (it passed the discount-cap check above);
        // every absolute rupee figure is derived from it server-side.
        for (const item of (payload.items || [])) {
          const real = priceByProduct.get(String(item.product_id))!
          const unitPrice = money(real.selling_price)
          const qty = Number(item.quantity)
          const discountPct = Math.max(0, Math.min(100, Number(item.discount_pct) || 0))
          const discountAmount = money(unitPrice * qty * discountPct / 100)
          const taxRate = Number(real.tax_rate) || 0
          const taxableAmount = money(unitPrice * qty - discountAmount)
          const taxAmount = money(taxableAmount * taxRate / 100)
          const lineTotal = money(taxableAmount + taxAmount)
          const itemRow = {
            id:              crypto.randomUUID(),
            invoice_id:      id,
            product_id:      item.product_id,
            quantity:        qty,
            unit_price:      unitPrice,
            discount_pct:    discountPct,
            discount_amount: discountAmount,
            tax_rate:        taxRate,
            tax_amount:      taxAmount,
            line_total:      lineTotal,
          }
          db.prepare(`
            INSERT INTO invoice_items (id, invoice_id, product_id, quantity, unit_price,
              discount_pct, discount_amount, tax_rate, tax_amount, line_total)
            VALUES (@id, @invoice_id, @product_id, @quantity, @unit_price,
              @discount_pct, @discount_amount, @tax_rate, @tax_amount, @line_total)
          `).run(itemRow)
          itemRecords.push(itemRow)

          // QUOTATION: do NOT deduct stock. RETAIL and CREDIT: deduct immediately.
          if (billType !== 'QUOTATION') {
            const changed = db.prepare(`
              UPDATE stocks SET quantity = quantity - ?, updated_at = datetime('now')
              WHERE product_id = ? AND branch_id = ? AND quantity >= ?
            `).run(item.quantity, item.product_id, branchId, item.quantity)
            if (!changed.changes) {
              throw new Error(`Insufficient branch stock for product ${item.product_id}`)
            }
            movementRecords.push(insertStockMovement(db, {
              product_id: item.product_id,
              from_branch_id: branchId,
              to_branch_id: null,
              quantity: item.quantity,
              movement_type: 'SALE',
              reference_order_id: id,
              notes: `${billType} bill ${invoiceNumber}`,
              created_by: (user?.id as string) || null,
            }))

            // Commission for this line — matched against this product's own
            // Commission Rule only. agentId is only a real agents.id when the
            // cashier selected a suggestion (free-typed agent text can't be
            // credited, there's no agent row to point the ledger at).
            if (agentId) {
              const lineAmount = Number((Number(itemRow.unit_price) * Number(itemRow.quantity) - Number(itemRow.discount_amount)).toFixed(2))
              const commissionResult = computeAndRecordCommission(db, {
                sourceTable: 'invoice_items', sourceId: String(itemRow.id), productId: String(itemRow.product_id),
                schemeId: null, memberId: null, registrationAgentId: agentId, salesAgentId: null,
                amount: lineAmount, branchId,
              })
              agentCommissionAmount += commissionResult.totalCommission
              commissionEnqueue.push(...commissionResult.enqueue)
            }
          }
        }

        if (agentCommissionAmount > 0) {
          const derivedPct = finalSubtotal > 0 ? Number(((agentCommissionAmount / finalSubtotal) * 100).toFixed(2)) : 0
          db.prepare(`UPDATE invoices SET agent_commission_pct=?, agent_commission_amount=? WHERE id=?`)
            .run(derivedPct, agentCommissionAmount, id)
        }

        // Record payment lines. POS can send split payments, e.g. gift voucher + cash/card balance.
        const paymentLines = Array.isArray(payload.payments)
          ? payload.payments
          : payload.payment
            ? [payload.payment]
            : []
        if (billType === 'RETAIL') {
          const insertPayment = db.prepare(`
            INSERT INTO payments (id, invoice_id, method, amount, reference, received_by)
            VALUES (?, ?, ?, ?, ?, ?)
          `)
          for (const payment of paymentLines) {
            const amount = Number(payment?.amount || 0)
            if (!payment?.method || amount <= 0) continue
            const paymentId = crypto.randomUUID()
            insertPayment.run(
              paymentId, id,
              payment.method, amount,
              payment.reference || null, (user?.id as string) || null
            )
            paymentRecords.push({
              id: paymentId, invoice_id: id,
              method: payment.method, amount,
              reference: payment.reference || null,
              received_by: (user?.id as string) || null,
            })
          }
        }

        // Redeem coupon inside the same transaction — throws roll the sale back
        if (couponRequest?.code && Number(couponRequest.amount || 0) > 0) {
          couponResult = redeemCouponInTransaction(db, {
            code: String(couponRequest.code),
            amount: Number(couponRequest.amount),
            invoiceId: id,
            customerId: (payload.customer_id as string) || null,
            branchId,
            userId: (user?.id as string) || null,
          })
        }

        // SmartBuy Wallet — debit inside the same transaction; a throw
        // (insufficient balance, no wallet, concurrent balance change) rolls
        // the whole sale back, same as coupon redemption above.
        if (walletAmount > 0) {
          walletDebitResult = debitWalletForInvoice(db, {
            customerId: String(payload.customer_id), amount: walletAmount, invoiceId: id, branchId, userId: (user?.id as string) || null,
          })
        }

        // Credit bill: update credit_ledger and customer outstanding
        if (billType === 'CREDIT') {
          const dueAmt = finalDueAmount
          if (dueAmt > 0) {
            const ledgerId = crypto.randomUUID()
            db.prepare(`
              INSERT INTO credit_ledger (id, customer_id, invoice_id, branch_id, amount_due, amount_paid, due_date)
              VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(
              ledgerId, payload.customer_id, id, branchId,
              dueAmt, payload.paid_amount || 0, payload.due_date || null
            )
            creditLedgerRecord = {
              id: ledgerId, customer_id: payload.customer_id, invoice_id: id, branch_id: branchId,
              amount_due: dueAmt, amount_paid: payload.paid_amount || 0, due_date: payload.due_date || null,
            }
            db.prepare(`
              UPDATE customers SET outstanding_due = outstanding_due + ?, updated_at = datetime('now') WHERE id = ?
            `).run(dueAmt, payload.customer_id)
          }
        } else if (payload.customer_id && finalDueAmount > 0) {
          db.prepare(`
            UPDATE customers SET outstanding_due = outstanding_due + ?, updated_at = datetime('now') WHERE id = ?
          `).run(finalDueAmount, payload.customer_id)
        }

        // Audit log
        logAudit(db, {
          userId: user?.id as string, branchId,
          action: `CREATE_${billType}_BILL`, tableName: 'invoices', recordId: id,
          newValues: { bill_type: billType, total: finalTotalAmount },
        })
      })

      insertInvoice()

      const commissionPctForSync = agentCommissionAmount > 0 && finalSubtotal > 0
        ? Number(((agentCommissionAmount / finalSubtotal) * 100).toFixed(2))
        : 0
      await enqueuSync('invoices', id, 'INSERT', {
        id, invoice_number: invoiceNumber, branch_id: branchId,
        customer_id: payload.customer_id || null,
        cashier_id: (user?.id as string) || 'u9999999-9999-4999-8999-999999999999',
        bill_type: billType, status: billType === 'QUOTATION' ? 'draft' : 'completed',
        subtotal: finalSubtotal, discount_amount: finalDiscountAmount,
        tax_amount: finalTaxAmount, total_amount: finalTotalAmount,
        paid_amount: payload.paid_amount || 0, due_amount: finalDueAmount,
        agent_code: agentCode, agent_name: agentName, agent_id: agentId,
        agent_commission_pct: commissionPctForSync,
        agent_commission_amount: agentCommissionAmount,
        notes: payload.notes || null,
      })
      for (const movement of movementRecords) {
        await enqueuSync('stock_movements', String(movement.id), 'INSERT', movement)
        await syncStockRow(db, String(movement.product_id), String(movement.from_branch_id || movement.to_branch_id))
      }
      for (const itemRow of itemRecords) {
        await enqueuSync('invoice_items', String(itemRow.id), 'INSERT', itemRow)
      }
      for (const item of commissionEnqueue) {
        await enqueuSync(item.table, item.id, item.op, item.row)
      }
      for (const paymentRow of paymentRecords) {
        await enqueuSync('payments', String(paymentRow.id), 'INSERT', paymentRow)
      }
      if (creditLedgerRecord) {
        await enqueuSync('credit_ledger', String((creditLedgerRecord as Record<string, unknown>).id), 'INSERT', creditLedgerRecord)
      }
      if (payload.customer_id && (billType === 'CREDIT' || finalDueAmount > 0)) {
        await syncCustomerRow(db, String(payload.customer_id))
      }
      // (cast: TS cannot see the assignment inside the transaction closure)
      const redeemed = couponResult as CouponRedemptionResult | null
      if (redeemed) {
        await enqueuSync('coupons', redeemed.couponId, 'UPDATE', redeemed.couponRow)
        await enqueuSync('coupon_redemptions', redeemed.redemptionId, 'INSERT', redeemed.redemptionRow)
      }
      const walletDebit = walletDebitResult as WalletDebitResult | null
      if (walletDebit) {
        await enqueuSync('smartbuy_wallet', walletDebit.walletId, 'UPDATE', walletDebit.walletRow)
        await enqueuSync('smartbuy_wallet_transactions', walletDebit.transactionId, 'INSERT', walletDebit.transactionRow)
        await enqueuSync('payments', walletDebit.paymentId, 'INSERT', walletDebit.paymentRow)
      }

      return { success: true, data: { id, invoice_number: invoiceNumber, bill_type: billType } }
  })

  // Convert QUOTATION → RETAIL (deducts stock, changes bill_type)
  safeHandle(ipcMain, 'invoices:convert', async (_e, id: string) => {
      const db = getDb()
      const user = getAuthUser()
      const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id) as Record<string, unknown>
      if (!invoice) return { success: false, error: 'Invoice not found' }
      if (invoice.bill_type !== 'QUOTATION') return { success: false, error: 'Only QUOTATION bills can be converted' }
      if (invoice.status === 'cancelled' || invoice.status === 'expired') {
        return { success: false, error: 'Cannot convert a cancelled or expired quotation' }
      }
      {
        const perms = ((user?.role as Record<string, unknown>)?.permissions as Record<string, unknown>) || (user?.permissions as Record<string, unknown>) || {}
        if (!perms.all && user?.branch_id && invoice.branch_id !== user.branch_id) {
          return { success: false, error: 'Cannot convert a quotation from another branch' }
        }
      }

      const items = db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ?').all(id) as
        { product_id: string; quantity: number }[]
      const movementRecords: Record<string, unknown>[] = []

      const convert = db.transaction(() => {
        const newNumber = getNextBillNumber(invoice.branch_id as string, 'RETAIL')

        // Deduct stock for each item
        for (const item of items) {
          const changed = db.prepare(`
            UPDATE stocks SET quantity = quantity - ?, updated_at = datetime('now')
            WHERE product_id = ? AND branch_id = ? AND quantity >= ?
          `).run(item.quantity, item.product_id, invoice.branch_id, item.quantity)
          if (!changed.changes) {
            throw new Error(`Insufficient branch stock for product ${item.product_id}`)
          }
          movementRecords.push(insertStockMovement(db, {
            product_id: item.product_id,
            from_branch_id: invoice.branch_id as string,
            to_branch_id: null,
            quantity: item.quantity,
            movement_type: 'SALE',
            reference_order_id: id,
            notes: `Quotation converted to ${newNumber}`,
            created_by: (user?.id as string) || null,
          }))
        }

        db.prepare(`
          UPDATE invoices SET bill_type='RETAIL', status='completed',
            invoice_number=?, valid_until=NULL, updated_at=datetime('now')
          WHERE id=?
        `).run(newNumber, id)

        // Record payment if provided
        logAudit(db, {
          userId: user?.id as string, branchId: invoice.branch_id as string,
          action: 'CONVERT_QUOTATION', tableName: 'invoices', recordId: id,
        })

        return newNumber
      })

      const newNumber = convert()
      await enqueuSync('invoices', id, 'UPDATE', { id, bill_type: 'RETAIL', status: 'completed', invoice_number: newNumber })
      for (const movement of movementRecords) {
        await enqueuSync('stock_movements', String(movement.id), 'INSERT', movement)
        await syncStockRow(db, String(movement.product_id), String(movement.from_branch_id || movement.to_branch_id))
      }
      return { success: true, data: { invoice_number: newNumber } }
  })

  // Approve a CREDIT bill (manager only, cannot be same as creator)
  safeHandle(ipcMain, 'invoices:approveCreditBill', async (_e, id: string) => {
      const db = getDb()
      const user = getAuthUser()
      const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id) as Record<string, unknown>
      if (!invoice) return { success: false, error: 'Invoice not found' }
      if (invoice.bill_type !== 'CREDIT') return { success: false, error: 'Not a credit bill' }
      if (invoice.cashier_id === (user?.id as string)) {
        return { success: false, error: 'Creator cannot approve. Another manager must approve.' }
      }
      {
        const perms = ((user?.role as Record<string, unknown>)?.permissions as Record<string, unknown>) || (user?.permissions as Record<string, unknown>) || {}
        if (!perms.all && !perms.employees) return { success: false, error: 'Manager access required to approve a credit bill' }
        if (!perms.all && user?.branch_id && invoice.branch_id !== user.branch_id) {
          return { success: false, error: 'Cannot approve a credit bill from another branch' }
        }
      }

      db.prepare(`
        UPDATE invoices SET approved_by=?, status='completed', updated_at=datetime('now') WHERE id=?
      `).run(user?.id, id)

      logAudit(db, {
        userId: user?.id as string, branchId: invoice.branch_id as string,
        action: 'APPROVE_CREDIT_BILL', tableName: 'invoices', recordId: id,
      })

      await enqueuSync('invoices', id as string, 'UPDATE', { id, approved_by: user?.id, status: 'completed' })
      return { success: true }
  })

  // Add payment to a CREDIT bill
  safeHandle(ipcMain, 'invoices:addCreditPayment', async (_e, payload: { invoice_id: string; amount: number; method: string; reference?: string }) => {
      const db = getDb()
      const user = getAuthUser()
      const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(payload.invoice_id) as Record<string, unknown>
      if (!invoice) return { success: false, error: 'Invoice not found' }
      if (!(Number(payload.amount) > 0)) return { success: false, error: 'Enter a valid payment amount' }
      {
        const perms = ((user?.role as Record<string, unknown>)?.permissions as Record<string, unknown>) || (user?.permissions as Record<string, unknown>) || {}
        if (!perms.all && user?.branch_id && invoice.branch_id !== user.branch_id) {
          return { success: false, error: 'Cannot post a payment against a bill from another branch' }
        }
      }

      let paymentRow: Record<string, unknown> | null = null
      let updatedInvoice: Record<string, unknown> | null = null
      let ledgerId: string | null = null

      const addPayment = db.transaction(() => {
        const paymentId = crypto.randomUUID()
        db.prepare(`
          INSERT INTO payments (id, invoice_id, method, amount, reference, received_by)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(paymentId, payload.invoice_id, payload.method, payload.amount, payload.reference || null, user?.id)
        paymentRow = {
          id: paymentId, invoice_id: payload.invoice_id, method: payload.method,
          amount: payload.amount, reference: payload.reference || null, received_by: user?.id || null,
        }

        const newPaid = (invoice.paid_amount as number) + payload.amount
        const newDue  = Math.max(0, (invoice.total_amount as number) - newPaid)
        const newStatus = newDue <= 0 ? 'completed' : 'completed'

        db.prepare(`
          UPDATE invoices SET paid_amount=?, due_amount=?, status=?, updated_at=datetime('now') WHERE id=?
        `).run(newPaid, newDue, newStatus, payload.invoice_id)
        updatedInvoice = { ...invoice, paid_amount: newPaid, due_amount: newDue, status: newStatus }

        // Update credit_ledger
        db.prepare(`
          UPDATE credit_ledger SET amount_paid = amount_paid + ?,
            status = CASE WHEN amount_paid + ? >= amount_due THEN 'paid' ELSE 'outstanding' END,
            updated_at = datetime('now')
          WHERE invoice_id = ?
        `).run(payload.amount, payload.amount, payload.invoice_id)
        ledgerId = (db.prepare(`SELECT id FROM credit_ledger WHERE invoice_id = ?`).get(payload.invoice_id) as { id?: string } | undefined)?.id ?? null

        // Update customer outstanding
        if (invoice.customer_id) {
          db.prepare(`
            UPDATE customers SET outstanding_due = MAX(0, outstanding_due - ?), updated_at=datetime('now') WHERE id=?
          `).run(payload.amount, invoice.customer_id)
        }

        logAudit(db, {
          userId: user?.id as string, branchId: invoice.branch_id as string,
          action: 'CREDIT_PAYMENT', tableName: 'invoices', recordId: payload.invoice_id,
          newValues: { amount: payload.amount, method: payload.method },
        })
      })

      addPayment()

      if (paymentRow) await enqueuSync('payments', String((paymentRow as Record<string, unknown>).id), 'INSERT', paymentRow)
      if (updatedInvoice) await enqueuSync('invoices', payload.invoice_id, 'UPDATE', updatedInvoice)
      if (ledgerId) {
        const ledgerRow = db.prepare(`SELECT * FROM credit_ledger WHERE id = ?`).get(ledgerId) as Record<string, unknown>
        await enqueuSync('credit_ledger', ledgerId, 'UPDATE', ledgerRow)
      }
      if (invoice.customer_id) await syncCustomerRow(db, String(invoice.customer_id))

      return { success: true }
  })

  safeHandle(ipcMain, 'invoices:list', (_e, filters: Record<string, unknown> = {}) => {
      const db = getDb()
      const user = getAuthUser()
      const perms = ((user?.role as Record<string, unknown>)?.permissions as Record<string, unknown>)
        || user?.permissions as Record<string, unknown> || {}
      const isSuperAdmin = Boolean(perms.all)

      let sql = `
        SELECT i.*, c.name as customer_name, b.name as branch_name,
               u.name as cashier_name, a.name as approver_name
        FROM invoices i
        LEFT JOIN customers c ON c.id = i.customer_id
        LEFT JOIN branches b ON b.id = i.branch_id
        LEFT JOIN users u ON u.id = i.cashier_id
        LEFT JOIN users a ON a.id = i.approved_by
        WHERE 1=1
      `
      const params: unknown[] = []
      // `all_branches` must only bypass branch scoping for an actually global
      // caller — it was previously honored for any renderer-supplied filter,
      // so a non-admin session could read every branch's invoices by passing
      // { all_branches: true } to a direct IPC call.
      if (!isSuperAdmin) {
        sql += ' AND i.branch_id = ?'; params.push((user?.branch_id as string) || defaultBranchId())
      }
      if (isSuperAdmin && filters.branch_id) { sql += ' AND i.branch_id = ?'; params.push(filters.branch_id) }
      if (filters.bill_type)  { sql += ' AND i.bill_type = ?';  params.push(filters.bill_type) }
      if (filters.status)     { sql += ' AND i.status = ?';     params.push(filters.status) }
      if (filters.customer_id){ sql += ' AND i.customer_id = ?';params.push(filters.customer_id) }
      if (filters.date_from)  { sql += ' AND date(i.created_at) >= ?'; params.push(filters.date_from) }
      if (filters.date_to)    { sql += ' AND date(i.created_at) <= ?'; params.push(filters.date_to) }
      if (filters.search) {
        sql += ' AND (i.invoice_number LIKE ? OR c.name LIKE ?)'
        const term = `%${filters.search}%`
        params.push(term, term)
      }
      sql += ' ORDER BY i.created_at DESC LIMIT 500'
      return { success: true, data: db.prepare(sql).all(...params) }
  })

  safeHandle(ipcMain, 'invoices:get', (_e, id: string) => {
      const db = getDb()
      const invoice = db.prepare(`
        SELECT i.*, c.name as customer_name, u.name as cashier_name, a.name as approver_name
        FROM invoices i
        LEFT JOIN customers c ON c.id = i.customer_id
        LEFT JOIN users u ON u.id = i.cashier_id
        LEFT JOIN users a ON a.id = i.approved_by
        WHERE i.id = ?
      `).get(id) as { branch_id?: unknown } | undefined
      if (!invoice) return { success: true, data: undefined }

      const user = getAuthUser()
      const perms = ((user?.role as Record<string, unknown>)?.permissions as Record<string, unknown>) || (user?.permissions as Record<string, unknown>) || {}
      if (!perms.all && user?.branch_id && invoice.branch_id !== user.branch_id) {
        return { success: false, error: 'Cannot access a bill from another branch' }
      }

      const items = db.prepare(`
        SELECT ii.*, p.name as product_name, p.sku
        FROM invoice_items ii
        LEFT JOIN products p ON p.id = ii.product_id
        WHERE ii.invoice_id = ?
      `).all(id)

      const payments = db.prepare('SELECT * FROM payments WHERE invoice_id = ? ORDER BY paid_at').all(id)
      const ledger = db.prepare('SELECT * FROM credit_ledger WHERE invoice_id = ?').all(id)

      return { success: true, data: { ...invoice as object, items, payments, ledger } }
  })

  safeHandle(ipcMain, 'invoices:hold', async (_e, id: string) => {
      const db = getDb()
      const user = getAuthUser()
      const invoice = db.prepare('SELECT branch_id FROM invoices WHERE id=?').get(id) as { branch_id: unknown } | undefined
      if (!invoice) return { success: false, error: 'Invoice not found' }
      const perms = ((user?.role as Record<string, unknown>)?.permissions as Record<string, unknown>) || (user?.permissions as Record<string, unknown>) || {}
      if (!perms.all && user?.branch_id && invoice.branch_id !== user.branch_id) {
        return { success: false, error: 'Cannot hold a bill from another branch' }
      }
      db.prepare("UPDATE invoices SET status='held', updated_at=datetime('now') WHERE id=?").run(id)
      await enqueuSync('invoices', id, 'UPDATE', { id, status: 'held' })
      return { success: true }
  })

  // Cancel invoice — restore stock for RETAIL and CREDIT bills
  safeHandle(ipcMain, 'invoices:cancel', async (_e, id: string, reason?: string) => {
      const db = getDb()
      const user = getAuthUser()
      const invoice = db.prepare('SELECT * FROM invoices WHERE id=?').get(id) as Record<string, unknown>
      if (!invoice) return { success: false, error: 'Invoice not found' }
      if (invoice.locked_at) return { success: false, error: 'Invoice is locked for day-end. Contact admin.' }

      // Cancelling a RETAIL/CREDIT bill reverses real stock, credit ledger,
      // coupon, and wallet state — that needs a manager, not just whoever's
      // logged in. A QUOTATION never touched stock, so its own creator can
      // still cancel it (matches existing UI: QuotationsPage lets a cashier
      // cancel a quote they raised); anyone else still needs manager+.
      const perms = ((user?.role as Record<string, unknown>)?.permissions as Record<string, unknown>) || (user?.permissions as Record<string, unknown>) || {}
      const isManager = Boolean(perms.all || perms.employees)
      const isOwnQuotation = invoice.bill_type === 'QUOTATION' && String(invoice.cashier_id) === String(user?.id)
      if (!isManager && !isOwnQuotation) {
        return { success: false, error: 'Manager access required to cancel this bill' }
      }
      if (!perms.all && user?.branch_id && invoice.branch_id !== user.branch_id) {
        return { success: false, error: 'Cannot cancel a bill from another branch' }
      }
      const movementRecords: Record<string, unknown>[] = []
      let couponReversals: CouponRedemptionResult[] = []
      let walletReversals: WalletReversalResult[] = []

      const cancel = db.transaction(() => {
        // Restore stock for RETAIL and CREDIT bills (not QUOTATION — stock was never deducted)
        if (invoice.bill_type !== 'QUOTATION' && invoice.status !== 'cancelled') {
          const items = db.prepare('SELECT * FROM invoice_items WHERE invoice_id=?').all(id) as
            { product_id: string; quantity: number }[]
          for (const item of items) {
            db.prepare(`
              UPDATE stocks SET quantity = quantity + ?, updated_at=datetime('now')
              WHERE product_id=? AND branch_id=?
            `).run(item.quantity, item.product_id, invoice.branch_id)
            movementRecords.push(insertStockMovement(db, {
              product_id: item.product_id,
              from_branch_id: null,
              to_branch_id: invoice.branch_id as string,
              quantity: item.quantity,
              movement_type: 'ADJUSTMENT',
              reference_order_id: id,
              notes: `Invoice cancelled: ${reason || 'No reason provided'}`,
              created_by: (user?.id as string) || null,
            }))
          }
        }

        // Reverse credit_ledger entry
        if (invoice.bill_type === 'CREDIT' && invoice.customer_id) {
          const ledger = db.prepare(`
            SELECT COALESCE(SUM(amount_due - amount_paid), 0) as balance
            FROM credit_ledger WHERE invoice_id=? AND status='outstanding'
          `).get(id) as { balance: number }
          if (ledger.balance > 0) {
            db.prepare(`
              UPDATE customers SET outstanding_due = MAX(0, outstanding_due - ?), updated_at=datetime('now') WHERE id=?
            `).run(ledger.balance, invoice.customer_id)
          }
          db.prepare(`UPDATE credit_ledger SET status='cancelled', updated_at=datetime('now') WHERE invoice_id=?`).run(id)
        }

        // Restore coupon balance for any redemptions on this invoice
        if (invoice.status !== 'cancelled') {
          couponReversals = reverseCouponForInvoice(db, id, (user?.id as string) || null)
        }

        // Restore SmartBuy Wallet balance for any POS-purchase debit on this
        // invoice — a new reversal transaction, never deleting the original.
        if (invoice.status !== 'cancelled') {
          walletReversals = reverseWalletForInvoice(db, id, (user?.id as string) || null)
        }

        db.prepare(`UPDATE invoices SET status='cancelled', updated_at=datetime('now') WHERE id=?`).run(id)

        logAudit(db, {
          userId: user?.id as string, branchId: invoice.branch_id as string,
          action: 'CANCEL_INVOICE', tableName: 'invoices', recordId: id,
          newValues: { reason: reason || 'No reason provided' },
        })
      })

      cancel()
      await enqueuSync('invoices', id, 'UPDATE', { id, status: 'cancelled' })
      for (const movement of movementRecords) {
        await enqueuSync('stock_movements', String(movement.id), 'INSERT', movement)
        await syncStockRow(db, String(movement.product_id), String(movement.from_branch_id || movement.to_branch_id))
      }
      if (invoice.bill_type === 'CREDIT' && invoice.customer_id) {
        await syncCustomerRow(db, String(invoice.customer_id))
      }
      for (const reversal of couponReversals) {
        await enqueuSync('coupons', reversal.couponId, 'UPDATE', reversal.couponRow)
        await enqueuSync('coupon_redemptions', reversal.redemptionId, 'INSERT', reversal.redemptionRow)
      }
      for (const reversal of walletReversals) {
        await enqueuSync('smartbuy_wallet', reversal.walletId, 'UPDATE', reversal.walletRow)
        await enqueuSync('smartbuy_wallet_transactions', reversal.transactionId, 'INSERT', reversal.transactionRow)
      }
      return { success: true }
  })

  // Corrects a single line item's quantity/price on an already-completed
  // invoice. Deliberately narrow — no item add/delete, no customer/payment
  // changes, no void (that stays on invoices:cancel). Non-admins must supply
  // an edit_request_id from an approved editRequests row; it's re-validated
  // and consumed inside this same transaction so there's no check-then-use race.
  safeHandle(ipcMain, 'invoices:applyEdit', async (_e, id: string, payload: {
    item_id: string; new_quantity: number; new_unit_price: number; edit_request_id?: string
  }) => {
      const db = getDb()
      const user = getAuthUser()
      const perms = ((user?.role as Record<string, unknown>)?.permissions as Record<string, unknown>)
        || (user?.permissions as Record<string, unknown>) || {}
      const isAdmin = Boolean(perms.all)

      const invoice = db.prepare('SELECT * FROM invoices WHERE id=?').get(id) as Record<string, unknown> | undefined
      if (!invoice) return { success: false, error: 'Invoice not found' }
      if (invoice.status !== 'completed') return { success: false, error: 'Only completed invoices can be corrected this way' }
      if (invoice.locked_at) return { success: false, error: 'Invoice is locked for day-end. Contact admin.' }

      const item = db.prepare('SELECT * FROM invoice_items WHERE id=? AND invoice_id=?')
        .get(payload.item_id, id) as Record<string, unknown> | undefined
      if (!item) return { success: false, error: 'Invoice line item not found' }

      const newQty = Number(payload.new_quantity)
      const newPrice = Number(payload.new_unit_price)
      if (!(newQty > 0) || newPrice < 0) return { success: false, error: 'Enter a valid quantity and price' }

      const money = (v: number) => Math.round(v * 100) / 100
      const discountPct = Number(item.discount_pct || 0)
      const taxRate = Number(item.tax_rate || 0)
      const newGross = newQty * newPrice
      const newDiscountAmount = money(newGross * discountPct / 100)
      const newTaxAmount = money((newGross - newDiscountAmount) * taxRate / 100)
      const newLineTotal = money(newGross - newDiscountAmount + newTaxAmount)
      const deltaQuantity = newQty - Number(item.quantity)
      const deltaLineTotal = money(newLineTotal - Number(item.line_total))

      const movementRecords: Record<string, unknown>[] = []

      db.transaction(() => {
        if (!isAdmin) {
          const request = db.prepare(`
            SELECT id FROM edit_requests
            WHERE id=? AND status='approved' AND approved_expires_at > datetime('now')
              AND requested_by=? AND target_table='invoices' AND target_record_id=?
          `).get(payload.edit_request_id, user?.id, id) as { id: string } | undefined
          if (!request) throw new Error('Edit request no longer valid — please request approval again')
          db.prepare(`UPDATE edit_requests SET status='consumed', consumed_at=datetime('now'), updated_at=datetime('now') WHERE id=?`)
            .run(request.id)
        }

        db.prepare(`
          UPDATE invoice_items
          SET quantity=?, unit_price=?, discount_amount=?, tax_amount=?, line_total=?, updated_at=datetime('now')
          WHERE id=?
        `).run(newQty, newPrice, newDiscountAmount, newTaxAmount, newLineTotal, item.id)

        if (deltaQuantity !== 0 && invoice.bill_type !== 'QUOTATION') {
          // A quantity increase sells more (stock decreases further); a decrease restores stock.
          db.prepare(`
            UPDATE stocks SET quantity = quantity - ?, updated_at=datetime('now')
            WHERE product_id=? AND branch_id=?
          `).run(deltaQuantity, item.product_id, invoice.branch_id)
          movementRecords.push(insertStockMovement(db, {
            product_id: item.product_id as string,
            from_branch_id: deltaQuantity > 0 ? invoice.branch_id as string : null,
            to_branch_id: deltaQuantity < 0 ? invoice.branch_id as string : null,
            quantity: Math.abs(deltaQuantity),
            movement_type: 'ADJUSTMENT',
            reference_order_id: id,
            notes: `Invoice item correction on ${invoice.invoice_number}`,
            created_by: (user?.id as string) || null,
          }))
        }

        const newSubtotal = money(Number(invoice.subtotal) + (newGross - Number(item.quantity) * Number(item.unit_price)))
        const newDiscount = money(Number(invoice.discount_amount) + (newDiscountAmount - Number(item.discount_amount)))
        const newTax = money(Number(invoice.tax_amount) + (newTaxAmount - Number(item.tax_amount)))
        const newTotal = money(Number(invoice.total_amount) + deltaLineTotal)
        const newDue = money(Number(invoice.due_amount) + deltaLineTotal)

        db.prepare(`
          UPDATE invoices
          SET subtotal=?, discount_amount=?, tax_amount=?, total_amount=?, due_amount=?, updated_at=datetime('now')
          WHERE id=?
        `).run(newSubtotal, newDiscount, newTax, newTotal, Math.max(0, newDue), id)

        if (invoice.bill_type === 'CREDIT' && deltaLineTotal !== 0) {
          db.prepare(`
            UPDATE credit_ledger SET amount_due = MAX(0, amount_due + ?), updated_at=datetime('now')
            WHERE invoice_id=? AND status='outstanding'
          `).run(deltaLineTotal, id)
          if (invoice.customer_id) {
            db.prepare(`
              UPDATE customers SET outstanding_due = MAX(0, outstanding_due + ?), updated_at=datetime('now') WHERE id=?
            `).run(deltaLineTotal, invoice.customer_id)
          }
        }

        logAudit(db, {
          userId: (user?.id as string) || null, branchId: invoice.branch_id as string,
          action: 'INVOICE_ITEM_CORRECTED', tableName: 'invoices', recordId: id,
          oldValues: { quantity: item.quantity, unit_price: item.unit_price, line_total: item.line_total },
          newValues: { quantity: newQty, unit_price: newPrice, line_total: newLineTotal },
        })
      })()

      await enqueuSync('invoice_items', String(item.id), 'UPDATE', {
        id: item.id, quantity: newQty, unit_price: newPrice,
        discount_amount: newDiscountAmount, tax_amount: newTaxAmount, line_total: newLineTotal,
      })
      const updatedInvoice = db.prepare('SELECT * FROM invoices WHERE id=?').get(id)
      await enqueuSync('invoices', id, 'UPDATE', updatedInvoice as Record<string, unknown>)
      for (const movement of movementRecords) {
        await enqueuSync('stock_movements', String(movement.id), 'INSERT', movement)
        await syncStockRow(db, String(movement.product_id), String(movement.from_branch_id || movement.to_branch_id))
      }
      if (invoice.bill_type === 'CREDIT' && deltaLineTotal !== 0 && invoice.customer_id) {
        await syncCustomerRow(db, String(invoice.customer_id))
      }
      if (!isAdmin && payload.edit_request_id) {
        await enqueuSync('edit_requests', payload.edit_request_id, 'UPDATE', { id: payload.edit_request_id, status: 'consumed' })
      }
      return { success: true }
  })

  safeHandle(ipcMain, 'invoices:listHeld', (_e) => {
      const db = getDb()
      const user = getAuthUser()
      const rows = db.prepare(`
        SELECT i.*, c.name as customer_name FROM invoices i
        LEFT JOIN customers c ON c.id = i.customer_id
        WHERE i.status = 'held' AND i.branch_id = ?
        ORDER BY i.updated_at DESC LIMIT 5
      `).all((user?.branch_id as string) || defaultBranchId())
      return { success: true, data: rows }
  })

  // List pending-approval credit bills
  safeHandle(ipcMain, 'invoices:pendingApproval', (_e) => {
      const db = getDb()
      const user = getAuthUser()
      const rows = db.prepare(`
        SELECT i.*, c.name as customer_name, u.name as cashier_name
        FROM invoices i
        LEFT JOIN customers c ON c.id = i.customer_id
        LEFT JOIN users u ON u.id = i.cashier_id
        WHERE i.bill_type = 'CREDIT' AND i.status = 'pending_approval' AND i.branch_id = ?
        ORDER BY i.created_at DESC
      `).all((user?.branch_id as string) || defaultBranchId())
      return { success: true, data: rows }
  })

  // Get credit summary for a customer
  safeHandle(ipcMain, 'invoices:creditSummary', (_e, customerId: string) => {
      const db = getDb()
      const customer = db.prepare('SELECT credit_limit, outstanding_due FROM customers WHERE id=?')
        .get(customerId) as { credit_limit: number; outstanding_due: number } | undefined
      const ledger = db.prepare(`
        SELECT COALESCE(SUM(amount_due), 0) as total_due,
               COALESCE(SUM(amount_paid), 0) as total_paid,
               COALESCE(SUM(amount_due - amount_paid), 0) as balance
        FROM credit_ledger WHERE customer_id=? AND status='outstanding'
      `).get(customerId) as { total_due: number; total_paid: number; balance: number }
      return {
        success: true,
        data: {
          credit_limit:   customer?.credit_limit || 0,
          outstanding_due: ledger.balance,
          available_credit: Math.max(0, (customer?.credit_limit || 0) - ledger.balance),
        }
      }
  })
}
