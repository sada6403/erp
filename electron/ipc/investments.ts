import { usesSupermarketStock } from '../services/supermarketModule'
import type { IpcMain } from 'electron'
import { randomUUID } from 'crypto'
import { getDb } from '../database'
import { safeHandle } from './ipcHandler'
import { createCompanyStore } from '../services/companyWorkspace'
import { enqueuSync } from '../services/syncQueue'
import { logAudit } from '../services/auditLog'

const store = createCompanyStore()
function requireOwner() {
  if (!usesSupermarketStock(store.get('app_settings') as Record<string, unknown>)) throw new Error('Supermarket module required')
  const user = (store.get('auth_user') as Record<string, any> | undefined) || {}
  const permissions = user.role?.permissions || user.permissions || {}
  if (!permissions.all) throw new Error('Company Admin access required for owner investments')
  return user
}

export function registerInvestmentHandlers(ipcMain: IpcMain) {
  safeHandle(ipcMain, 'investments:list', (_e, filters: { from?: string; to?: string } = {}) => {
    requireOwner(); const db = getDb(); const where: string[] = []; const args: unknown[] = []
    if (filters.from) { where.push('date(transaction_date)>=date(?)'); args.push(filters.from) }
    if (filters.to) { where.push('date(transaction_date)<=date(?)'); args.push(filters.to) }
    const rows = db.prepare(`SELECT ct.*,b.name branch_name,u.name created_by_name FROM capital_transactions ct
      LEFT JOIN branches b ON b.id=ct.branch_id LEFT JOIN users u ON u.id=ct.created_by
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY transaction_date DESC,created_at DESC`).all(...args)
    const totals = db.prepare(`SELECT
      COALESCE(SUM(CASE WHEN transaction_type='investment' THEN amount ELSE 0 END),0) investments,
      COALESCE(SUM(CASE WHEN transaction_type='withdrawal' THEN amount ELSE 0 END),0) withdrawals
      FROM capital_transactions ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`).get(...args) as Record<string, number>
    return { success: true, data: { rows, totals: { ...totals, net_capital: Number(totals.investments)-Number(totals.withdrawals) } } }
  })
  safeHandle(ipcMain, 'investments:create', async (_e, payload: Record<string, unknown>) => {
    const user = requireOwner(); const db = getDb()
    const type = String(payload.transaction_type); const amount = Math.round(Number(payload.amount)*100)/100
    if (!['investment','withdrawal'].includes(type)) throw new Error('Invalid capital transaction type')
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('Amount must be greater than zero')
    if (!String(payload.owner_name || '').trim()) throw new Error('Owner / investor is required')
    if (payload.transaction_date && !/^\d{4}-\d{2}-\d{2}$/.test(String(payload.transaction_date))) throw new Error('Invalid investment date')
    const row = { id: randomUUID(), branch_id: payload.branch_id || user.branch_id || null, transaction_type: type, transaction_date: payload.transaction_date || new Date().toISOString().slice(0,10), amount, owner_name: String(payload.owner_name).trim(), payment_method: String(payload.payment_method || 'cash'), account_name: payload.account_name || null, reference_number: payload.reference_number || null, description: payload.description || null, supporting_document: payload.supporting_document || null, created_by: user.id || null }
    db.transaction(() => { db.prepare(`INSERT INTO capital_transactions (id,branch_id,transaction_type,transaction_date,amount,owner_name,payment_method,account_name,reference_number,description,supporting_document,created_by)
      VALUES (@id,@branch_id,@transaction_type,@transaction_date,@amount,@owner_name,@payment_method,@account_name,@reference_number,@description,@supporting_document,@created_by)`).run(row)
      logAudit(db,{userId:user.id,branchId:row.branch_id as string,action:'CAPITAL_TRANSACTION_CREATE',tableName:'capital_transactions',recordId:row.id,newValues:row}) })()
    await enqueuSync('capital_transactions',row.id,'INSERT',row)
    return { success:true,data:row }
  })
}
