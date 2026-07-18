import { ipcMain } from 'electron'
import { getDb } from '../database'
import { randomUUID } from 'crypto'
import { enqueuSync } from '../services/syncQueue'
import { safeHandle } from './ipcHandler'

interface LoyaltyConfig {
  enabled: number
  earn_points: number
  earn_per_amount: number
  redeem_points: number
  redeem_value: number
  min_redeem: number
  expiry_days: number
}

function getConfig(): LoyaltyConfig {
  const db = getDb()
  return db.prepare(`SELECT * FROM loyalty_config WHERE id = 'default'`).get() as LoyaltyConfig
}

export function earnPoints(customerId: string, invoiceAmount: number, invoiceId: string, createdBy?: string): number {
  try {
    const db  = getDb()
    const cfg = getConfig()
    if (!cfg.enabled) return 0

    const points = Math.floor((invoiceAmount / cfg.earn_per_amount) * cfg.earn_points)
    if (points <= 0) return 0

    const newBalance = Number((db.prepare(`SELECT loyalty_points FROM customers WHERE id = ?`).get(customerId) as { loyalty_points: number })?.loyalty_points ?? 0) + points
    db.prepare(`UPDATE customers SET loyalty_points = ? WHERE id = ?`).run(newBalance, customerId)
    const txId = randomUUID()
    const txRow = {
      id: txId, customer_id: customerId, invoice_id: invoiceId, type: 'earn',
      points, balance: newBalance, note: 'Earned from invoice', created_by: createdBy ?? null,
    }
    db.prepare(`
      INSERT INTO loyalty_transactions (id, customer_id, invoice_id, type, points, balance, note, created_by)
      VALUES (@id, @customer_id, @invoice_id, @type, @points, @balance, @note, @created_by)
    `).run(txRow)
    void enqueuSync('loyalty_transactions', txId, 'INSERT', txRow)
    void enqueuSync('customers', customerId, 'UPDATE', { id: customerId, loyalty_points: newBalance })

    return points
  } catch { return 0 }
}

export function registerLoyaltyHandlers() {

  safeHandle(ipcMain, 'loyalty:config:get', () => {
    return { success: true, data: getConfig() }
  })

  safeHandle(ipcMain, 'loyalty:config:save', async (_e, cfg: Partial<LoyaltyConfig>) => {
    const db = getDb()
    const sets = Object.entries(cfg).map(([k]) => `${k} = ?`).join(', ')
    db.prepare(`UPDATE loyalty_config SET ${sets}, updated_at = datetime('now') WHERE id = 'default'`).run(...Object.values(cfg))
    const updated = db.prepare(`SELECT * FROM loyalty_config WHERE id = 'default'`).get() as Record<string, unknown>
    await enqueuSync('loyalty_config', 'default', 'UPDATE', updated)
    return { success: true }
  })

  ipcMain.handle('loyalty:getBalance', (_e, customerId: string) => {
    try {
      const db   = getDb()
      const cfg  = getConfig()
      const row  = db.prepare(`SELECT loyalty_points FROM customers WHERE id = ?`).get(customerId) as { loyalty_points: number } | undefined
      const pts  = row?.loyalty_points ?? 0
      const value = cfg.enabled ? ((pts / cfg.redeem_points) * cfg.redeem_value) : 0
      return { success: true, points: pts, redeem_value: value, config: cfg }
    } catch (err) { return { success: false, points: 0, error: String(err) } }
  })

  safeHandle(ipcMain, 'loyalty:earn', (_e, payload: { customer_id: string; invoice_id: string; amount: number; created_by?: string }) => {
    const earned = earnPoints(payload.customer_id, payload.amount, payload.invoice_id, payload.created_by)
    return { success: true, points_earned: earned }
  })

  safeHandle(ipcMain, 'loyalty:redeem', (_e, payload: { customer_id: string; invoice_id?: string; points: number; created_by?: string }) => {
    const db  = getDb()
    const cfg = getConfig()
    if (!cfg.enabled) return { success: false, error: 'Loyalty program is disabled' }
    if (payload.points < cfg.min_redeem) return { success: false, error: `Minimum ${cfg.min_redeem} points required to redeem` }

    const row = db.prepare(`SELECT loyalty_points FROM customers WHERE id = ?`).get(payload.customer_id) as { loyalty_points: number } | undefined
    const current = row?.loyalty_points ?? 0
    if (current < payload.points) return { success: false, error: `Insufficient points (available: ${current})` }

    const discount    = (payload.points / cfg.redeem_points) * cfg.redeem_value
    const newBalance  = current - payload.points
    db.prepare(`UPDATE customers SET loyalty_points = ? WHERE id = ?`).run(newBalance, payload.customer_id)
    const txId = randomUUID()
    const txRow = {
      id: txId, customer_id: payload.customer_id, invoice_id: payload.invoice_id ?? null, type: 'redeem',
      points: -payload.points, balance: newBalance,
      note: `Redeemed for Rs.${discount.toFixed(2)} discount`, created_by: payload.created_by ?? null,
    }
    db.prepare(`
      INSERT INTO loyalty_transactions (id, customer_id, invoice_id, type, points, balance, note, created_by)
      VALUES (@id, @customer_id, @invoice_id, @type, @points, @balance, @note, @created_by)
    `).run(txRow)
    void enqueuSync('loyalty_transactions', txId, 'INSERT', txRow)
    void enqueuSync('customers', payload.customer_id, 'UPDATE', { id: payload.customer_id, loyalty_points: newBalance })

    return { success: true, discount, points_used: payload.points, new_balance: newBalance }
  })

  safeHandle(ipcMain, 'loyalty:adjust', (_e, payload: { customer_id: string; points: number; note: string; created_by?: string }) => {
    const db = getDb()
    const row = db.prepare(`SELECT loyalty_points FROM customers WHERE id = ?`).get(payload.customer_id) as { loyalty_points: number } | undefined
    const current    = row?.loyalty_points ?? 0
    const newBalance = Math.max(0, current + payload.points)
    db.prepare(`UPDATE customers SET loyalty_points = ? WHERE id = ?`).run(newBalance, payload.customer_id)
    const txId = randomUUID()
    const txRow = {
      id: txId, customer_id: payload.customer_id, type: 'adjust',
      points: payload.points, balance: newBalance, note: payload.note, created_by: payload.created_by ?? null,
    }
    db.prepare(`
      INSERT INTO loyalty_transactions (id, customer_id, type, points, balance, note, created_by)
      VALUES (@id, @customer_id, @type, @points, @balance, @note, @created_by)
    `).run(txRow)
    void enqueuSync('loyalty_transactions', txId, 'INSERT', txRow)
    void enqueuSync('customers', payload.customer_id, 'UPDATE', { id: payload.customer_id, loyalty_points: newBalance })
    return { success: true, new_balance: newBalance }
  })

  ipcMain.handle('loyalty:history', (_e, customerId: string) => {
    try {
      const db = getDb()
      const rows = db.prepare(`
        SELECT lt.*, i.invoice_number
        FROM loyalty_transactions lt
        LEFT JOIN invoices i ON i.id = lt.invoice_id
        WHERE lt.customer_id = ?
        ORDER BY lt.created_at DESC
        LIMIT 50
      `).all(customerId)
      return { success: true, data: rows }
    } catch (err) { return { success: false, data: [], error: String(err) } }
  })
}
