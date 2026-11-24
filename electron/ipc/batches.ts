import { usesSupermarketStock } from '../services/supermarketModule'
import { ipcMain } from 'electron'
import { getDb } from '../database'
import { randomUUID } from 'crypto'
import { enqueuSync } from '../services/syncQueue'
import { logAudit } from '../services/auditLog'
import { safeHandle } from './ipcHandler'
import {claimBatch,inspectBatch,type BatchInput} from '../services/batchIdentity'
import {syncStockRow} from '../services/stockSync'
import {insertStockMovement} from '../services/stockMovement'
import { createCompanyStore } from '../services/companyWorkspace'

const store = createCompanyStore()

function authUser(): Record<string, unknown> {
  return (store.get('auth_user') as Record<string, unknown> | undefined) || {}
}

function currentPerms(caller: Record<string, unknown> = authUser()): Record<string, unknown> {
  return ((caller.role as Record<string, unknown>)?.permissions as Record<string, unknown>)
    || (caller.permissions as Record<string, unknown>)
    || {}
}

interface BatchRow {
  id: string
  batch_identity_id?:string|null
  batch_entry_mode?:string
  batch_warning_ack?:number
  product_id: string
  branch_id: string | null
  batch_number: string | null
  serial_number: string | null
  expiry_date: string | null
  mfg_date: string | null
  quantity: number
  selling_price: number | null
  cost_price: number
  po_id: string | null
  notes: string | null
  created_at: string
}

export function registerBatchHandlers() {
  safeHandle(ipcMain,'batches:inspect',(_e,input:BatchInput)=>{
    const caller=authUser(),perms=currentPerms(caller)
    if(!perms.all&&!perms.inventory&&!perms['import.stock'])throw new Error('Inventory access required')
    const db=getDb(),result=inspectBatch(db,input)
    if(result.existing&&!perms.all){const own=db.prepare('SELECT COALESCE(SUM(quantity),0) quantity,MIN(created_at) entered_at FROM product_batches WHERE product_id=? AND TRIM(batch_number)=? AND COALESCE(expiry_date,\'\')=? AND branch_id=?').get(input.product_id,result.dates.no,result.dates.expiry,caller.branch_id||'') as {quantity:number;entered_at:string};Object.assign(result.existing,own)}
    return {success:true,data:result}
  })

  ipcMain.handle('batches:list', (_e, filters: { product_id?: string; branch_id?: string; expiring_days?: number }) => {
    try {
      const db = getDb()
      const supermarket = usesSupermarketStock(store.get('app_settings') as Record<string, unknown>)
      const wheres: string[] = supermarket ? ['1=1'] : ['b.quantity > 0']
      const params: unknown[] = []
      const caller = authUser()
      if (!currentPerms(caller).all) { wheres.push('b.branch_id=?'); params.push(caller.branch_id || '') }
      if (filters.product_id) { wheres.push('b.product_id = ?'); params.push(filters.product_id) }
      if (filters.branch_id)  { wheres.push('b.branch_id = ?');  params.push(filters.branch_id) }
      if (filters.expiring_days) {
        wheres.push(`b.expiry_date IS NOT NULL AND b.expiry_date <= date('now', '+330 minutes', '+${Math.abs(filters.expiring_days)} days')`)
      }
      const rows = db.prepare(`
        SELECT b.*, p.name as product_name, p.sku as product_sku, br.name as branch_name
        FROM product_batches b
        JOIN products p ON p.id = b.product_id
        LEFT JOIN branches br ON br.id = b.branch_id
        WHERE ${wheres.join(' AND ')}
        ORDER BY b.expiry_date ASC NULLS LAST, b.created_at ASC
      `).all(...params)
      return { success: true, data: rows }
    } catch (err) { return { success: false, data: [], error: String(err) } }
  })

  safeHandle(ipcMain, 'batches:get', (_e, id: string) => {
    const db = getDb()
    const row = db.prepare(`SELECT * FROM product_batches WHERE id = ?`).get(id)
    return { success: true, data: row }
  })

  // Non-admins are always scoped to their own branch — the client's branch_id
  // is ignored to prevent a manager from tagging a batch to a branch they
  // don't manage. Admins keep the existing behavior (explicit branch_id, or
  // null for a global/unassigned batch).
  safeHandle(ipcMain, 'batches:create', async (_e, payload: Partial<BatchRow> & BatchInput & {add_to_stock?:boolean}) => {
    const caller = authUser()
    const perms = currentPerms(caller)
    if (!perms.all && !perms.inventory) return { success: false, error: 'Inventory access required' }
    if (usesSupermarketStock(store.get('app_settings') as Record<string, unknown>)) throw new Error('Use stock purchases and POS sales for supermarket batch quantities')
    const db = getDb()
    const id = randomUUID()
    const isAdmin = Boolean(perms.all)
    const branch_id = isAdmin ? (payload.branch_id ?? null) : ((caller.branch_id as string) ?? null)
    const row = {
      id, product_id: payload.product_id, branch_id,
      batch_number: payload.batch_number ?? null, serial_number: payload.serial_number ?? null,
      expiry_date: payload.expiry_date ?? null, mfg_date: payload.mfg_date ?? null,
      quantity: payload.quantity ?? 0, cost_price: payload.cost_price ?? 0,
      po_id: payload.po_id ?? null, notes: payload.notes ?? null,
      created_by: (caller.id as string) ?? null,
    }
    db.transaction(()=>{
    const identity=claimBatch(db,payload)
    row.batch_number=identity.no||null;row.expiry_date=identity.expiry||null;row.mfg_date=identity.mfg||null
    db.prepare(`
      INSERT INTO product_batches (id, product_id, branch_id, batch_number, serial_number, expiry_date, mfg_date, quantity, cost_price, po_id, notes, created_by)
      VALUES (@id, @product_id, @branch_id, @batch_number, @serial_number, @expiry_date, @mfg_date, @quantity, @cost_price, @po_id, @notes, @created_by)
    `).run(row)
    const columns=new Set((db.prepare('PRAGMA table_info(product_batches)').all() as {name:string}[]).map(column=>column.name))
    if(columns.has('batch_identity_id'))db.prepare('UPDATE product_batches SET batch_identity_id=?,batch_entry_mode=?,batch_warning_ack=? WHERE id=?').run(identity.id,payload.batch_resolution==='add_existing'?'add_existing':'new',payload.acknowledge_dates===true?1:0,id)
    if(payload.add_to_stock){
      if(!branch_id)throw new Error('Select a branch before adding stock')
      if(!Number.isFinite(Number(row.quantity))||Number(row.quantity)<=0||!Number.isFinite(Number(row.cost_price))||Number(row.cost_price)<0)throw new Error('Valid positive quantity and non-negative cost required')
      const stock=db.prepare('SELECT id FROM stocks WHERE product_id=? AND branch_id=? AND warehouse_id IS NULL').get(row.product_id,branch_id) as {id:string}|undefined
      if(stock)db.prepare("UPDATE stocks SET quantity=ROUND(quantity+?,6),updated_at=datetime('now') WHERE id=?").run(row.quantity,stock.id)
      else db.prepare('INSERT INTO stocks(id,product_id,branch_id,quantity,damaged_qty) VALUES(?,?,?,?,0)').run(randomUUID(),row.product_id,branch_id,row.quantity)
      const movement=insertStockMovement(db,{product_id:row.product_id,to_branch_id:branch_id,quantity:Number(row.quantity),movement_type:'ADJUSTMENT',created_by:String(caller.id||''),notes:'Batch stock entry'})
      void enqueuSync('stock_movements',String(movement.id),'INSERT',movement)
    }
    }).immediate()
    await enqueuSync('product_batches', id, 'INSERT', db.prepare('SELECT * FROM product_batches WHERE id=?').get(id) as Record<string,unknown>)
    if(payload.add_to_stock&&branch_id)await syncStockRow(db,row.product_id,branch_id)
    logAudit(db, { userId: (caller.id as string) || null, branchId: branch_id, action: 'BATCH_CREATED', tableName: 'product_batches', recordId: id, newValues: { product_id: payload.product_id, quantity: row.quantity } })
    return { success: true, id }
  })

  safeHandle(ipcMain, 'batches:update', async (_e, id: string, payload: Partial<BatchRow> & Partial<BatchInput>) => {
    const caller = authUser()
    const perms = currentPerms(caller)
    if (!perms.all && !perms.inventory) return { success: false, error: 'Inventory access required' }
    const db = getDb()
    const existing = db.prepare('SELECT * FROM product_batches WHERE id = ?').get(id) as BatchRow | undefined
    if (!existing) return { success: false, error: 'Batch not found' }
    if (!perms.all && caller.branch_id && existing.branch_id && existing.branch_id !== caller.branch_id) {
      return { success: false, error: 'Cannot edit a batch from another branch' }
    }
    if (usesSupermarketStock(store.get('app_settings') as Record<string, unknown>) && (payload.quantity !== undefined || payload.cost_price !== undefined)) throw new Error('Use purchase receipts to change supermarket inventory; purchase costs are immutable')
    if (payload.selling_price != null && (!Number.isFinite(Number(payload.selling_price)) || Number(payload.selling_price)<0)) throw new Error('Invalid selling price')
    db.transaction(()=>{
    delete payload.batch_identity_id
    delete payload.batch_entry_mode
    delete payload.batch_warning_ack
    if(['batch_number','mfg_date','expiry_date'].some(key=>key in payload)){const key=claimBatch(db,{...existing,...payload,product_id:existing.product_id},id);payload.batch_identity_id=key.id;payload.batch_entry_mode=payload.batch_resolution==='add_existing'?'add_existing':'new';payload.batch_warning_ack=payload.acknowledge_dates===true?1:0}
    const allowed = ['batch_identity_id','batch_entry_mode','batch_warning_ack','selling_price','batch_number','serial_number','expiry_date','mfg_date','quantity','cost_price','notes'] as const
    const existingColumns=new Set((db.prepare('PRAGMA table_info(product_batches)').all() as {name:string}[]).map(column=>column.name))
    const sets = allowed.filter(k => existingColumns.has(k)&&payload[k] !== undefined).map(k => `${k} = ?`)
    const vals = allowed.filter(k => existingColumns.has(k)&&payload[k] !== undefined).map(k => payload[k])
    if (!sets.length) return { success: false, error: 'Nothing to update' }
    db.prepare(`UPDATE product_batches SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...vals, id)
    }).immediate()
    const row = db.prepare(`SELECT * FROM product_batches WHERE id = ?`).get(id) as Record<string, unknown>
    await enqueuSync('product_batches', id, 'UPDATE', row)
    logAudit(db, { userId: (caller.id as string) || null, branchId: existing.branch_id, action: 'BATCH_UPDATED', tableName: 'product_batches', recordId: id, newValues: payload })
    return { success: true }
  })

  safeHandle(ipcMain, 'batches:consume', async (_e, payload: { batch_id: string; qty: number }) => {
    const caller = authUser()
    const perms = currentPerms(caller)
    if (!perms.all && !perms.inventory && !perms.pos) return { success: false, error: 'Inventory access required' }
    if (usesSupermarketStock(store.get('app_settings') as Record<string, unknown>)) throw new Error('Use stock purchases and POS sales for supermarket batch quantities')
    const db = getDb()
    const row = db.prepare(`SELECT quantity, branch_id FROM product_batches WHERE id = ?`).get(payload.batch_id) as { quantity: number; branch_id: string | null } | undefined
    if (!row) return { success: false, error: 'Batch not found' }
    if (!perms.all && caller.branch_id && row.branch_id && row.branch_id !== caller.branch_id) {
      return { success: false, error: 'Cannot consume a batch from another branch' }
    }
    if (row.quantity < payload.qty) return { success: false, error: `Insufficient batch quantity (available: ${row.quantity})` }
    db.prepare(`UPDATE product_batches SET quantity = quantity - ?, updated_at = datetime('now') WHERE id = ?`).run(payload.qty, payload.batch_id)
    const updated = db.prepare(`SELECT * FROM product_batches WHERE id = ?`).get(payload.batch_id) as Record<string, unknown>
    await enqueuSync('product_batches', payload.batch_id, 'UPDATE', updated)
    logAudit(db, { userId: (caller.id as string) || null, branchId: row.branch_id, action: 'BATCH_CONSUMED', tableName: 'product_batches', recordId: payload.batch_id, newValues: { qty: payload.qty } })
    return { success: true }
  })

  ipcMain.handle('batches:expiring', (_e, days: number = 30) => {
    try {
      const db = getDb()
      const rows = db.prepare(`
        SELECT b.*, p.name as product_name, p.sku as product_sku, br.name as branch_name,
               julianday(b.expiry_date) - julianday('now') as days_until_expiry
        FROM product_batches b
        JOIN products p ON p.id = b.product_id
        LEFT JOIN branches br ON br.id = b.branch_id
        WHERE b.expiry_date IS NOT NULL
          AND b.quantity > 0
          AND b.expiry_date <= date('now', '+330 minutes', '+' || ? || ' days')
        ORDER BY b.expiry_date ASC
      `).all(days)
      return { success: true, data: rows }
    } catch (err) { return { success: false, data: [], error: String(err) } }
  })

  safeHandle(ipcMain, 'batches:summary', (_e, productId: string) => {
    const db = getDb()
    const rows = db.prepare(`
      SELECT
        COUNT(*) as batch_count,
        SUM(quantity) as total_qty,
        MIN(expiry_date) as earliest_expiry,
        SUM(CASE WHEN expiry_date < date('now','+330 minutes') THEN quantity ELSE 0 END) as expired_qty
      FROM product_batches
      WHERE product_id = ? AND quantity > 0
    `).get(productId)
    return { success: true, data: rows }
  })
}
