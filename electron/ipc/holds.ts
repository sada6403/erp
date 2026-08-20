import type { IpcMain } from 'electron'
import { getDb } from '../database'
import crypto from 'crypto'
import Store from 'electron-store'
import { enqueuSync } from '../services/syncQueue'
import { safeHandle } from './ipcHandler'

const store = new Store()

function getAuthUser() {
  return store.get('auth_user') as Record<string, unknown>
}

function defaultBranchId() {
  return 'b1111111-1111-4111-8111-111111111111'
}

function currentPerms(user: Record<string, unknown>): Record<string, unknown> {
  return ((user?.role as Record<string, unknown>)?.permissions as Record<string, unknown>)
    || (user?.permissions as Record<string, unknown>) || {}
}

// POS "Hold" — see the held_carts table comment in electron/database.ts for
// why this is kept entirely separate from invoices:create.
export function registerHoldHandlers(ipcMain: IpcMain) {
  safeHandle(ipcMain, 'holds:create', async (_e, payload: {
    bill_type?: string
    customer_id?: string | null
    customer_name?: string | null
    items: unknown[]
    global_discount?: number
    notes?: string | null
    valid_until?: string | null
    due_date?: string | null
    total_amount?: number
  }) => {
    if (!payload.items || payload.items.length === 0) {
      return { success: false, error: 'Cannot hold an empty cart' }
    }
    const db = getDb()
    const user = getAuthUser()
    const id = crypto.randomUUID()
    const row = {
      id,
      branch_id:       (user?.branch_id as string) || defaultBranchId(),
      cashier_id:      (user?.id as string) || null,
      bill_type:       payload.bill_type || 'RETAIL',
      customer_id:     payload.customer_id || null,
      customer_name:   payload.customer_name || null,
      items_json:      JSON.stringify(payload.items),
      global_discount: Number(payload.global_discount || 0),
      notes:           payload.notes || null,
      valid_until:     payload.valid_until || null,
      due_date:        payload.due_date || null,
      item_count:      payload.items.length,
      total_amount:    Number(payload.total_amount || 0),
    }
    db.prepare(`
      INSERT INTO held_carts (id, branch_id, cashier_id, bill_type, customer_id, customer_name,
        items_json, global_discount, notes, valid_until, due_date, item_count, total_amount)
      VALUES (@id, @branch_id, @cashier_id, @bill_type, @customer_id, @customer_name,
        @items_json, @global_discount, @notes, @valid_until, @due_date, @item_count, @total_amount)
    `).run(row)
    await enqueuSync('held_carts', id, 'INSERT', row)
    return { success: true, data: { id } }
  })

  safeHandle(ipcMain, 'holds:list', (_e) => {
    const db = getDb()
    const user = getAuthUser()
    const perms = currentPerms(user)
    const cols = 'id, branch_id, bill_type, customer_name, item_count, total_amount, created_at'
    const rows = perms.all
      ? db.prepare(`SELECT ${cols} FROM held_carts ORDER BY created_at DESC LIMIT 20`).all()
      : db.prepare(`SELECT ${cols} FROM held_carts WHERE branch_id=? ORDER BY created_at DESC LIMIT 20`)
          .all((user?.branch_id as string) || defaultBranchId())
    return { success: true, data: rows }
  })

  safeHandle(ipcMain, 'holds:recall', async (_e, id: string) => {
    const db = getDb()
    const user = getAuthUser()
    const perms = currentPerms(user)
    const row = db.prepare('SELECT * FROM held_carts WHERE id=?').get(id) as Record<string, unknown> | undefined
    if (!row) return { success: false, error: 'Held bill not found — it may have already been recalled elsewhere' }
    if (!perms.all && user?.branch_id && row.branch_id !== user.branch_id) {
      return { success: false, error: 'Cannot recall a held bill from another branch' }
    }
    // Consumed on recall — removed immediately so it can never be double-recalled.
    db.prepare('DELETE FROM held_carts WHERE id=?').run(id)
    await enqueuSync('held_carts', id, 'DELETE', { id })
    return {
      success: true,
      data: {
        bill_type:       row.bill_type,
        customer_id:     row.customer_id,
        customer_name:   row.customer_name,
        items:           JSON.parse(String(row.items_json)),
        global_discount: row.global_discount,
        notes:           row.notes,
        valid_until:     row.valid_until,
        due_date:        row.due_date,
      },
    }
  })
}
