import type { IpcMain } from 'electron'
import { getDb } from '../database'
import crypto from 'crypto'
import { enqueuSync } from '../services/syncQueue'
import { logAudit } from '../services/auditLog'
import Store from 'electron-store'
import { insertStockMovement } from '../services/stockMovement'
import { redeemCouponInTransaction, reverseCouponForInvoice, type CouponRedemptionResult } from './coupons'

const store = new Store()

type BillType = 'RETAIL' | 'QUOTATION' | 'CREDIT'

const BILL_PREFIX: Record<BillType, string> = {
  RETAIL:    'INV',
  QUOTATION: 'QT',
  CREDIT:    'CR',
}

// Atomic sequence counter: {BRANCH_CODE}-{PREFIX}-{YEAR}-{SEQ:0004}
function getNextBillNumber(branchId: string, billType: BillType): string {
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

function defaultBranchId() {
  return 'b1111111-1111-4111-8111-111111111111'
}

export function registerInvoiceHandlers(ipcMain: IpcMain) {
  // Get next bill number preview
  ipcMain.handle('invoices:nextNumber', (_e, billType: BillType = 'RETAIL') => {
    try {
      const user = getAuthUser()
      const branchId = (user?.branch_id as string) || defaultBranchId()
      const number = getNextBillNumber(branchId, billType)
      return { success: true, data: number }
    } catch (err: unknown) { return { success: false, error: (err as Error).message } }
  })

  // Create invoice — handles all 3 bill types
  ipcMain.handle('invoices:create', async (_e, payload) => {
    try {
      const db = getDb()
      const user = getAuthUser()
      const branchId = payload.branch_id || (user?.branch_id as string) || defaultBranchId()
      const billType: BillType = payload.bill_type || 'RETAIL'
      const id = crypto.randomUUID()
      const invoiceNumber = getNextBillNumber(branchId, billType)
      const movementRecords: Record<string, unknown>[] = []
      const itemRecords: Record<string, unknown>[] = []
      const paymentRecords: Record<string, unknown>[] = []
      let creditLedgerRecord: Record<string, unknown> | null = null
      let couponResult: CouponRedemptionResult | null = null
      const agentCode = String(payload.agent_code || '').trim() || null
      const agentName = String(payload.agent_name || '').trim() || null
      const agentId = String(payload.agent_id || '').trim() || null
      const agentCommissionPct = Math.max(0, Math.min(100, Number(payload.agent_commission_pct || 0)))
      const agentCommissionAmount = agentCode || agentName
        ? Number(((Number(payload.total_amount || 0) * agentCommissionPct) / 100).toFixed(2))
        : 0

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
          if (customer.credit_limit > 0 && currentOutstanding + payload.total_amount > customer.credit_limit) {
            return {
              success: false,
              error: `Credit limit exceeded. Limit: ${customer.credit_limit.toFixed(2)}, Outstanding: ${currentOutstanding.toFixed(2)}, This bill: ${payload.total_amount.toFixed(2)}`
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
          subtotal:        payload.subtotal,
          discount_amount: payload.discount_amount || 0,
          tax_amount:      payload.tax_amount || 0,
          total_amount:    payload.total_amount,
          paid_amount:     payload.paid_amount || 0,
          due_amount:      payload.due_amount || 0,
          agent_code:      agentCode,
          agent_name:      agentName,
          agent_id:        agentId,
          agent_commission_pct: agentCommissionPct,
          agent_commission_amount: agentCommissionAmount,
          notes:           payload.notes || null,
        })

        // Insert line items
        for (const item of (payload.items || [])) {
          const itemRow = {
            id:              crypto.randomUUID(),
            invoice_id:      id,
            product_id:      item.product_id,
            quantity:        item.quantity,
            unit_price:      item.unit_price,
            discount_pct:    item.discount_pct || 0,
            discount_amount: item.discount_amount || 0,
            tax_rate:        item.tax_rate || 0,
            tax_amount:      item.tax_amount || 0,
            line_total:      item.line_total,
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
          }
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

        // Credit bill: update credit_ledger and customer outstanding
        if (billType === 'CREDIT') {
          const dueAmt = payload.total_amount - (payload.paid_amount || 0)
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
        } else if (payload.customer_id && (payload.due_amount || 0) > 0) {
          db.prepare(`
            UPDATE customers SET outstanding_due = outstanding_due + ?, updated_at = datetime('now') WHERE id = ?
          `).run(payload.due_amount, payload.customer_id)
        }

        // Audit log
        logAudit(db, {
          userId: user?.id as string, branchId,
          action: `CREATE_${billType}_BILL`, tableName: 'invoices', recordId: id,
          newValues: { bill_type: billType, total: payload.total_amount },
        })
      })

      insertInvoice()

      await enqueuSync('invoices', id, 'INSERT', {
        id, invoice_number: invoiceNumber, branch_id: branchId,
        customer_id: payload.customer_id || null,
        cashier_id: (user?.id as string) || 'u9999999-9999-4999-8999-999999999999',
        bill_type: billType, status: billType === 'QUOTATION' ? 'draft' : 'completed',
        subtotal: payload.subtotal, discount_amount: payload.discount_amount || 0,
        tax_amount: payload.tax_amount || 0, total_amount: payload.total_amount,
        paid_amount: payload.paid_amount || 0, due_amount: payload.due_amount || 0,
        agent_code: agentCode, agent_name: agentName, agent_id: agentId,
        agent_commission_pct: agentCommissionPct,
        agent_commission_amount: agentCommissionAmount,
        notes: payload.notes || null,
      })
      for (const movement of movementRecords) {
        await enqueuSync('stock_movements', String(movement.id), 'INSERT', movement)
      }
      for (const itemRow of itemRecords) {
        await enqueuSync('invoice_items', String(itemRow.id), 'INSERT', itemRow)
      }
      for (const paymentRow of paymentRecords) {
        await enqueuSync('payments', String(paymentRow.id), 'INSERT', paymentRow)
      }
      if (creditLedgerRecord) {
        await enqueuSync('credit_ledger', String((creditLedgerRecord as Record<string, unknown>).id), 'INSERT', creditLedgerRecord)
      }
      // (cast: TS cannot see the assignment inside the transaction closure)
      const redeemed = couponResult as CouponRedemptionResult | null
      if (redeemed) {
        await enqueuSync('coupons', redeemed.couponId, 'UPDATE', redeemed.couponRow)
        await enqueuSync('coupon_redemptions', redeemed.redemptionId, 'INSERT', redeemed.redemptionRow)
      }

      return { success: true, data: { id, invoice_number: invoiceNumber, bill_type: billType } }
    } catch (err: unknown) { return { success: false, error: (err as Error).message } }
  })

  // Convert QUOTATION → RETAIL (deducts stock, changes bill_type)
  ipcMain.handle('invoices:convert', async (_e, id: string) => {
    try {
      const db = getDb()
      const user = getAuthUser()
      const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id) as Record<string, unknown>
      if (!invoice) return { success: false, error: 'Invoice not found' }
      if (invoice.bill_type !== 'QUOTATION') return { success: false, error: 'Only QUOTATION bills can be converted' }
      if (invoice.status === 'cancelled' || invoice.status === 'expired') {
        return { success: false, error: 'Cannot convert a cancelled or expired quotation' }
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
      }
      return { success: true, data: { invoice_number: newNumber } }
    } catch (err: unknown) { return { success: false, error: (err as Error).message } }
  })

  // Approve a CREDIT bill (manager only, cannot be same as creator)
  ipcMain.handle('invoices:approveCreditBill', async (_e, id: string) => {
    try {
      const db = getDb()
      const user = getAuthUser()
      const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id) as Record<string, unknown>
      if (!invoice) return { success: false, error: 'Invoice not found' }
      if (invoice.bill_type !== 'CREDIT') return { success: false, error: 'Not a credit bill' }
      if (invoice.cashier_id === (user?.id as string)) {
        return { success: false, error: 'Creator cannot approve. Another manager must approve.' }
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
    } catch (err: unknown) { return { success: false, error: (err as Error).message } }
  })

  // Add payment to a CREDIT bill
  ipcMain.handle('invoices:addCreditPayment', async (_e, payload: { invoice_id: string; amount: number; method: string; reference?: string }) => {
    try {
      const db = getDb()
      const user = getAuthUser()
      const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(payload.invoice_id) as Record<string, unknown>
      if (!invoice) return { success: false, error: 'Invoice not found' }

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

      return { success: true }
    } catch (err: unknown) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle('invoices:list', (_e, filters: Record<string, unknown> = {}) => {
    try {
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
      if (!isSuperAdmin && !filters.all_branches) {
        sql += ' AND i.branch_id = ?'; params.push((user?.branch_id as string) || defaultBranchId())
      }
      if (filters.branch_id)  { sql += ' AND i.branch_id = ?';  params.push(filters.branch_id) }
      if (filters.bill_type)  { sql += ' AND i.bill_type = ?';  params.push(filters.bill_type) }
      if (filters.status)     { sql += ' AND i.status = ?';     params.push(filters.status) }
      if (filters.customer_id){ sql += ' AND i.customer_id = ?';params.push(filters.customer_id) }
      if (filters.date_from)  { sql += ' AND date(i.created_at) >= ?'; params.push(filters.date_from) }
      if (filters.date_to)    { sql += ' AND date(i.created_at) <= ?'; params.push(filters.date_to) }
      sql += ' ORDER BY i.created_at DESC LIMIT 500'
      return { success: true, data: db.prepare(sql).all(...params) }
    } catch (err: unknown) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle('invoices:get', (_e, id: string) => {
    try {
      const db = getDb()
      const invoice = db.prepare(`
        SELECT i.*, c.name as customer_name, u.name as cashier_name, a.name as approver_name
        FROM invoices i
        LEFT JOIN customers c ON c.id = i.customer_id
        LEFT JOIN users u ON u.id = i.cashier_id
        LEFT JOIN users a ON a.id = i.approved_by
        WHERE i.id = ?
      `).get(id)

      const items = db.prepare(`
        SELECT ii.*, p.name as product_name, p.sku
        FROM invoice_items ii
        LEFT JOIN products p ON p.id = ii.product_id
        WHERE ii.invoice_id = ?
      `).all(id)

      const payments = db.prepare('SELECT * FROM payments WHERE invoice_id = ? ORDER BY paid_at').all(id)
      const ledger = db.prepare('SELECT * FROM credit_ledger WHERE invoice_id = ?').all(id)

      return { success: true, data: { ...invoice as object, items, payments, ledger } }
    } catch (err: unknown) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle('invoices:hold', async (_e, id: string) => {
    try {
      const db = getDb()
      db.prepare("UPDATE invoices SET status='held', updated_at=datetime('now') WHERE id=?").run(id)
      await enqueuSync('invoices', id, 'UPDATE', { id, status: 'held' })
      return { success: true }
    } catch (err: unknown) { return { success: false, error: (err as Error).message } }
  })

  // Cancel invoice — restore stock for RETAIL and CREDIT bills
  ipcMain.handle('invoices:cancel', async (_e, id: string, reason?: string) => {
    try {
      const db = getDb()
      const user = getAuthUser()
      const invoice = db.prepare('SELECT * FROM invoices WHERE id=?').get(id) as Record<string, unknown>
      if (!invoice) return { success: false, error: 'Invoice not found' }
      if (invoice.locked_at) return { success: false, error: 'Invoice is locked for day-end. Contact admin.' }
      const movementRecords: Record<string, unknown>[] = []
      let couponReversals: CouponRedemptionResult[] = []

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
      }
      for (const reversal of couponReversals) {
        await enqueuSync('coupons', reversal.couponId, 'UPDATE', reversal.couponRow)
        await enqueuSync('coupon_redemptions', reversal.redemptionId, 'INSERT', reversal.redemptionRow)
      }
      return { success: true }
    } catch (err: unknown) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle('invoices:listHeld', (_e) => {
    try {
      const db = getDb()
      const user = getAuthUser()
      const rows = db.prepare(`
        SELECT i.*, c.name as customer_name FROM invoices i
        LEFT JOIN customers c ON c.id = i.customer_id
        WHERE i.status = 'held' AND i.branch_id = ?
        ORDER BY i.updated_at DESC LIMIT 5
      `).all((user?.branch_id as string) || defaultBranchId())
      return { success: true, data: rows }
    } catch (err: unknown) { return { success: false, error: (err as Error).message } }
  })

  // List pending-approval credit bills
  ipcMain.handle('invoices:pendingApproval', (_e) => {
    try {
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
    } catch (err: unknown) { return { success: false, error: (err as Error).message } }
  })

  // Get credit summary for a customer
  ipcMain.handle('invoices:creditSummary', (_e, customerId: string) => {
    try {
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
    } catch (err: unknown) { return { success: false, error: (err as Error).message } }
  })
}
