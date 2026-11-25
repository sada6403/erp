import type { IpcMain } from 'electron'
import { getDb } from '../database'
import crypto from 'crypto'
import { createCompanyStore } from '../services/companyWorkspace'
import { enqueuSync } from '../services/syncQueue'
import { safeHandle } from './ipcHandler'
import { getTerminalHub } from '../services/branchHubRuntime'
import { localNumberedHolds } from '../services/numberedHoldsRuntime'
import { manualHoldNumber } from '../lib/holdNumber'
import fs from 'fs'
import { getWorkspaceDataPath } from '../services/companyWorkspace'

const store = createCompanyStore()

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
  safeHandle(ipcMain, 'holds:hubStatus', () => {
    const hub=getTerminalHub()
    if(!hub)return {success:true,data:{configured:false,hub_online:false,pending:0}}
    const queued=getDb().prepare('SELECT count(*) AS n FROM branch_billing_outbox').get() as {n:number}
    return {success:true,data:{...hub.status(),server_url:hub.config.url,billing_pending:queued.n}}
  })
  safeHandle(ipcMain, 'holds:updateHubUrl', (_e, address: string) => {
    if(!currentPerms(getAuthUser()).all)return {success:false,error:'Admin permission required'}
    const url=new URL(String(address))
    if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('Enter a server URL such as http://BRANCH-SERVER:4781')
    const filename=getWorkspaceDataPath('branch-hub-terminal.json')
    if(!fs.existsSync(filename))throw new Error('Enroll this terminal before changing its server address')
    const original=fs.readFileSync(filename,'utf8'),config=JSON.parse(original)
    fs.writeFileSync(`${filename}.backup-${Date.now()}`,original,{flag:'wx',mode:0o600})
    const pending=`${filename}.pending-${process.pid}`
    fs.writeFileSync(pending,JSON.stringify({...config,url:url.origin},null,2),{mode:0o600})
    fs.renameSync(pending,filename)
    return {success:true,data:{restart_required:true}}
  })
  safeHandle(ipcMain, 'holds:acknowledgeRecall', (_e, token: string) => {
    getTerminalHub()?.acknowledgeRecall(token)
    return { success: true }
  })
  safeHandle(ipcMain, 'holds:create', async (_e, payload: {
    hold_number?: string
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
    const hub = getTerminalHub()
    if (payload.hold_number !== undefined) {
      payload.hold_number = manualHoldNumber(payload.hold_number)
      const branch = String(getAuthUser()?.branch_id || defaultBranchId())
      if (localNumberedHolds()?.has(branch, payload.hold_number)) return { success: false, error: 'Hold number is already in use; choose another number' }
      return { success: true, data: hub ? hub.createHold(payload as unknown as Record<string, unknown>) : localNumberedHolds(true)!.create(branch, payload as unknown as Record<string, unknown>) }
    }
    if (hub) return { success: true, data: hub.createHold(payload as unknown as Record<string, unknown>) }
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
    const hub = getTerminalHub()
    const db = getDb()
    const user = getAuthUser()
    const perms = currentPerms(user)
    const cols = 'id, branch_id, bill_type, customer_name, item_count, total_amount, created_at'
    const rows = perms.all
      ? db.prepare(`SELECT ${cols} FROM held_carts ORDER BY created_at DESC LIMIT 20`).all()
      : db.prepare(`SELECT ${cols} FROM held_carts WHERE branch_id=? ORDER BY created_at DESC LIMIT 20`)
          .all((user?.branch_id as string) || defaultBranchId())
    // Existing legacy holds remain recoverable, but are never uploaded to the
    // new Hub without a deliberate ownership migration.
    return { success: true, data: [...(hub?.listHolds() || []), ...(localNumberedHolds()?.list(String(user?.branch_id || defaultBranchId())) || []), ...(rows as Record<string, unknown>[]).map(row => ({ ...row, source: 'legacy' }))] }
  })

  safeHandle(ipcMain, 'holds:recall', async (_e, id: string) => {
    const branch = String(getAuthUser()?.branch_id || defaultBranchId())
    const numbered = localNumberedHolds()
    if (numbered?.has(branch, id)) return { success: true, data: numbered.recall(branch, id) }
    const db = getDb()
    const hub = getTerminalHub()
    if (hub) {
      const legacy = db.prepare('SELECT id FROM held_carts WHERE id=?').get(id)
      if (!legacy) return { success: true, data: await hub.recallHold(id) }
    }
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
        customer:        row.customer_id ? db.prepare('SELECT * FROM customers WHERE id=?').get(row.customer_id) || null : null,
        items:           JSON.parse(String(row.items_json)),
        global_discount: row.global_discount,
        notes:           row.notes,
        valid_until:     row.valid_until,
        due_date:        row.due_date,
      },
    }
  })
}
