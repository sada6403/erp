import bcrypt from 'bcryptjs'
import { randomUUID } from 'crypto'
import { pool } from './db'
import type { CompanyContext } from './auth'

const MAX_ATTEMPTS = 5
const LOCKOUT_MINUTES = 15

// Business/transactional data only. Company structure and configuration
// (users, roles, branches, warehouses, plans, templates and rules) survive.
export const CLEARABLE_TENANT_TABLES = [
  'coupon_redemptions',
  'return_items',
  'installment_payments',
  'installment_schedule',
  'installment_reminders',
  'invoice_items',
  'payments',
  'deliveries',
  'credit_ledger',
  'customer_order_items',
  'purchase_items',
  'branch_transfer_prints',
  'branch_transfer_logs',
  'branch_transfer_mismatches',
  'branch_transfer_items',
  'stock_count_items',
  'chit_payment_reminders',
  'commission_approval_logs',
  'commission_statement_history',
  'commission_rule_history',
  'commission_payouts',
  'commission_ledger',
  'smartbuy_wallet_transactions',
  'smartbuy_transfer_history',
  'withdrawal_requests',
  'chit_contributions',
  'chit_draws',
  'chit_scheme_branches',
  'chit_members',
  'agent_remittances',
  'installments',
  'returns',
  'invoices',
  'customer_orders',
  'purchase_orders',
  'branch_transfers',
  'stock_transfers',
  'stock_movements',
  'stock_count_sessions',
  'cash_sessions',
  'coupons',
  'loyalty_transactions',
  'edit_requests',
  'held_carts',
  'expenses',
  'supplier_payments',
  'smartbuy_wallet',
  'chit_schemes',
  'agents',
  'product_uom',
  'product_batches',
  'stocks',
  'stock_levels',
  'discounts',
  'customers',
  'products',
  'categories',
  'suppliers',
  'audit_logs',
  'sync_deletions',
  'sync_push_receipts',
] as const

export async function verifyClearDataPassword(companyId: string, password: string): Promise<{ success: boolean; error?: string }> {
  const { rows } = await pool.query(
    `SELECT clear_data_password_hash, clear_data_attempts, clear_data_locked_until FROM companies WHERE id = ?`,
    [companyId]
  )
  const company = rows[0] as {
    clear_data_password_hash: string | null
    clear_data_attempts: number
    clear_data_locked_until: string | null
  } | undefined

  if (!company?.clear_data_password_hash) {
    return { success: false, error: 'Clear-data password not configured for this company - contact support' }
  }
  if (company.clear_data_locked_until && new Date(company.clear_data_locked_until) > new Date()) {
    const minutesLeft = Math.ceil((new Date(company.clear_data_locked_until).getTime() - Date.now()) / 60_000)
    return { success: false, error: `Too many failed attempts. Try again in ${minutesLeft} minute(s).` }
  }

  const valid = await bcrypt.compare(password, company.clear_data_password_hash)
  if (!valid) {
    const attempts = (company.clear_data_attempts || 0) + 1
    const locked = attempts >= MAX_ATTEMPTS
    await pool.query(
      `UPDATE companies SET clear_data_attempts = ?, clear_data_locked_until = ? WHERE id = ?`,
      [locked ? 0 : attempts, locked ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000) : null, companyId]
    )
    return {
      success: false,
      error: locked
        ? `Too many failed attempts. Try again in ${LOCKOUT_MINUTES} minute(s).`
        : `Incorrect password. ${MAX_ATTEMPTS - attempts} attempt(s) remaining.`,
    }
  }

  await pool.query(`UPDATE companies SET clear_data_attempts = 0, clear_data_locked_until = NULL WHERE id = ?`, [companyId])
  return { success: true }
}

export async function clearTenantBusinessData(company: CompanyContext, clearedBy: string | null): Promise<string> {
  const eventId = randomUUID()
  const client = await company.tp.connect()
  let transactionStarted = false
  try {
    await client.query('SET FOREIGN_KEY_CHECKS = 0')
    await client.query('START TRANSACTION')
    transactionStarted = true
    for (const table of CLEARABLE_TENANT_TABLES) {
      await client.query(`DELETE FROM \`${table}\``)
    }
    await client.query('DELETE FROM data_clear_events')
    await client.query(
      `INSERT INTO data_clear_events (id, cleared_by, cleared_at, created_at, updated_at)
       VALUES (?, ?, NOW(), NOW(), NOW())`,
      [eventId, clearedBy]
    )
    await client.query('COMMIT')
    transactionStarted = false
    return eventId
  } catch (error) {
    if (transactionStarted) {
      try { await client.query('ROLLBACK') } catch { /* retain original error */ }
    }
    throw error
  } finally {
    try { await client.query('SET FOREIGN_KEY_CHECKS = 1') } finally { client.release() }
  }
}
