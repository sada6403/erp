import { ipcMain } from 'electron'
import { getDb } from '../database'
import { randomUUID } from 'crypto'

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
    db.prepare(`
      INSERT INTO loyalty_transactions (id, customer_id, invoice_id, type, points, balance, note, created_by)
      VALUES (?, ?, ?, 'earn', ?, ?, ?, ?)
    `).run(randomUUID(), customerId, invoiceId, points, newBalance, `Earned from invoice`, createdBy ?? null)

    return points
  } catch { return 0 }
}

export function registerLoyaltyHandlers() {

  ipcMain.handle('loyalty:config:get', () => {
    try { return { success: true, data: getConfig() } }
    catch (err) { return { success: false, error: String(err) } }
  })

  ipcMain.handle('loyalty:config:save', (_e, cfg: Partial<LoyaltyConfig>) => {
    try {
      const db = getDb()
      const sets = Object.entries(cfg).map(([k]) => `${k} = ?`).join(', ')
      db.prepare(`UPDATE loyalty_config SET ${sets}, updated_at = datetime('now') WHERE id = 'default'`).run(...Object.values(cfg))
      return { success: true }
    } catch (err) { return { success: false, error: String(err) } }
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

  ipcMain.handle('loyalty:earn', (_e, payload: { customer_id: string; invoice_id: string; amount: number; created_by?: string }) => {
    try {
      const earned = earnPoints(payload.customer_id, payload.amount, payload.invoice_id, payload.created_by)
      return { success: true, points_earned: earned }
    } catch (err) { return { success: false, error: String(err) } }
  })

  ipcMain.handle('loyalty:redeem', (_e, payload: { customer_id: string; invoice_id?: string; points: number; created_by?: string }) => {
    try {
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
      db.prepare(`
        INSERT INTO loyalty_transactions (id, customer_id, invoice_id, type, points, balance, note, created_by)
        VALUES (?, ?, ?, 'redeem', ?, ?, ?, ?)
      `).run(randomUUID(), payload.customer_id, payload.invoice_id ?? null, -payload.points, newBalance, `Redeemed for Rs.${discount.toFixed(2)} discount`, payload.created_by ?? null)

      return { success: true, discount, points_used: payload.points, new_balance: newBalance }
    } catch (err) { return { success: false, error: String(err) } }
  })

  ipcMain.handle('loyalty:adjust', (_e, payload: { customer_id: string; points: number; note: string; created_by?: string }) => {
    try {
      const db = getDb()
      const row = db.prepare(`SELECT loyalty_points FROM customers WHERE id = ?`).get(payload.customer_id) as { loyalty_points: number } | undefined
      const current    = row?.loyalty_points ?? 0
      const newBalance = Math.max(0, current + payload.points)
      db.prepare(`UPDATE customers SET loyalty_points = ? WHERE id = ?`).run(newBalance, payload.customer_id)
      db.prepare(`
        INSERT INTO loyalty_transactions (id, customer_id, type, points, balance, note, created_by)
        VALUES (?, ?, 'adjust', ?, ?, ?, ?)
      `).run(randomUUID(), payload.customer_id, payload.points, newBalance, payload.note, payload.created_by ?? null)
      return { success: true, new_balance: newBalance }
    } catch (err) { return { success: false, error: String(err) } }
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
