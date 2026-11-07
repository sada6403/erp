import type { IpcMain } from 'electron'
import crypto from 'crypto'
import { getDb } from '../database'
import { createCompanyStore } from '../services/companyWorkspace'
import { enqueuSync } from '../services/syncQueue'
import { logAudit } from '../services/auditLog'
import { safeHandle } from './ipcHandler'

const store = createCompanyStore()
type Json = Record<string, unknown>

function requireAdmin(): Json {
  const caller = (store.get('auth_user') as Json | undefined) || {}
  const perms = ((caller.role as Json)?.permissions as Json) || (caller.permissions as Json) || {}
  if (!caller.id || !perms.all) throw new Error('Only Super Admin can manage the online store')
  return caller
}

// Keys must match backend/lib/app/settings.ts SETTING_DEFAULTS.
export const STORE_SETTING_KEYS = [
  'ordering_enabled', 'maintenance_message', 'min_app_version', 'delivery_flat_fee',
  'delivery_free_over', 'download_link',
] as const
const DEFAULTS: Record<string, string> = {
  ordering_enabled: '1', maintenance_message: '', min_app_version: '1.0.0',
  delivery_flat_fee: '0', delivery_free_over: '', download_link: '',
}
const VERSION_RE = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/

function str(v: unknown, max: number): string | null {
  const s = String(v ?? '').trim()
  return s ? s.slice(0, max) : null
}
function optDate(v: unknown): string | null {
  const s = String(v ?? '').trim()
  if (!s) return null
  if (Number.isNaN(Date.parse(s))) throw new Error('Invalid date')
  return s
}
function optLink(v: unknown): string | null {
  const s = str(v, 500)
  if (!s) return null
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s) && !s.startsWith('/')) throw new Error('Link must be a URL')
  return s
}

export function registerOnlineStoreHandlers(ipcMain: IpcMain) {
  // Banners
  safeHandle(ipcMain, 'onlineStore:banners:list', () => {
    requireAdmin()
    return { success: true, data: getDb().prepare('SELECT * FROM app_banners ORDER BY sort_order, created_at DESC').all() }
  })

  safeHandle(ipcMain, 'onlineStore:banners:save', async (_e, p: Json) => {
    const caller = requireAdmin()
    const db = getDb()
    const title = str(p.title, 120)
    if (!title) throw new Error('Title is required')
    const row = {
      title, subtitle: str(p.subtitle, 200), image_url: optLink(p.image_url), link_url: optLink(p.link_url),
      sort_order: Math.trunc(Number(p.sort_order) || 0), is_active: p.is_active === false || p.is_active === 0 ? 0 : 1,
      starts_at: optDate(p.starts_at), ends_at: optDate(p.ends_at),
    }
    let id = str(p.id, 64)
    if (id) {
      if (!db.prepare('SELECT 1 FROM app_banners WHERE id=?').get(id)) throw new Error('Banner not found')
      db.prepare(`UPDATE app_banners SET title=@title, subtitle=@subtitle, image_url=@image_url, link_url=@link_url,
        sort_order=@sort_order, is_active=@is_active, starts_at=@starts_at, ends_at=@ends_at, updated_at=datetime('now') WHERE id=@id`)
        .run({ ...row, id })
      await enqueuSync('app_banners', id, 'UPDATE', { id, ...row })
    } else {
      id = crypto.randomUUID()
      db.prepare(`INSERT INTO app_banners (id,title,subtitle,image_url,link_url,sort_order,is_active,starts_at,ends_at)
        VALUES (@id,@title,@subtitle,@image_url,@link_url,@sort_order,@is_active,@starts_at,@ends_at)`).run({ ...row, id })
      await enqueuSync('app_banners', id, 'INSERT', { id, ...row })
    }
    logAudit(db, { userId: caller.id as string, branchId: (caller.branch_id as string) || null, action: 'APP_BANNER_SAVED', tableName: 'app_banners', recordId: id, newValues: row })
    return { success: true, data: { id } }
  })

  safeHandle(ipcMain, 'onlineStore:banners:delete', async (_e, id: string) => {
    const caller = requireAdmin()
    const db = getDb()
    const r = db.prepare('DELETE FROM app_banners WHERE id=?').run(String(id))
    if (!r.changes) throw new Error('Banner not found')
    await enqueuSync('app_banners', String(id), 'DELETE', { id: String(id) })
    logAudit(db, { userId: caller.id as string, branchId: (caller.branch_id as string) || null, action: 'APP_BANNER_DELETED', tableName: 'app_banners', recordId: String(id) })
    return { success: true }
  })

  // Online products
  safeHandle(ipcMain, 'onlineStore:products:list', (_e, f: Json = {}) => {
    requireAdmin()
    let sql = 'SELECT id, name, sku, selling_price, image_url, is_online FROM products WHERE is_active=1'
    const params: unknown[] = []
    const q = String(f.search || '').trim()
    if (q) { sql += ' AND (name LIKE ? OR sku LIKE ?)'; params.push(`%${q}%`, `%${q}%`) }
    if (f.online === true) sql += ' AND is_online=1'
    if (f.online === false) sql += ' AND is_online=0'
    sql += ' ORDER BY name LIMIT 500'
    return { success: true, data: getDb().prepare(sql).all(...params) }
  })

  safeHandle(ipcMain, 'onlineStore:products:setOnline', async (_e, ids: string[], online: boolean) => {
    const caller = requireAdmin()
    if (!Array.isArray(ids) || !ids.length) throw new Error('Select at least one product')
    if (ids.length > 500) throw new Error('Too many products at once')
    const db = getDb()
    const flag = online ? 1 : 0
    const upd = db.prepare(`UPDATE products SET is_online=?, updated_at=datetime('now') WHERE id=?`)
    const changed: string[] = []
    db.transaction(() => { for (const id of ids) if (upd.run(flag, String(id)).changes) changed.push(String(id)) })()
    for (const id of changed) await enqueuSync('products', id, 'UPDATE', { id, is_online: flag })
    logAudit(db, { userId: caller.id as string, branchId: (caller.branch_id as string) || null, action: 'APP_PRODUCTS_ONLINE', tableName: 'products', newValues: { count: changed.length, is_online: flag } })
    return { success: true, data: { updated: changed.length } }
  })

  // Settings (app_settings key/value; id = key like the backend setSetting)
  safeHandle(ipcMain, 'onlineStore:settings:get', () => {
    requireAdmin()
    const out: Record<string, string> = { ...DEFAULTS }
    const rows = getDb().prepare('SELECT setting_key, value FROM app_settings').all() as Array<{ setting_key: string; value: string | null }>
    for (const r of rows) if ((STORE_SETTING_KEYS as readonly string[]).includes(r.setting_key)) out[r.setting_key] = r.value ?? ''
    return { success: true, data: out }
  })

  safeHandle(ipcMain, 'onlineStore:settings:save', async (_e, p: Json) => {
    const caller = requireAdmin()
    const next: Record<string, string> = {}
    if (p.ordering_enabled !== undefined) next.ordering_enabled = p.ordering_enabled === true || p.ordering_enabled === '1' || p.ordering_enabled === 1 ? '1' : '0'
    if (p.maintenance_message !== undefined) next.maintenance_message = String(p.maintenance_message).trim().slice(0, 500)
    if (p.min_app_version !== undefined) {
      const v = String(p.min_app_version).trim()
      if (!VERSION_RE.test(v)) throw new Error('Minimum app version must look like 1.0.0')
      next.min_app_version = v
    }
    for (const k of ['delivery_flat_fee', 'delivery_free_over'] as const) {
      if (p[k] === undefined) continue
      const raw = String(p[k]).trim()
      if (raw === '' && k === 'delivery_free_over') { next[k] = ''; continue }
      const n = Number(raw)
      if (!Number.isFinite(n) || n < 0) throw new Error(`${k === 'delivery_flat_fee' ? 'Delivery fee' : 'Free delivery threshold'} must be a non-negative number`)
      next[k] = String(n)
    }
    if (p.download_link !== undefined) {
      const l = String(p.download_link).trim()
      if (l && !/^https?:\/\//i.test(l)) throw new Error('Download link must start with http:// or https://')
      next.download_link = l.slice(0, 300)
    }
    const db = getDb()
    for (const [key, value] of Object.entries(next)) {
      const existing = db.prepare('SELECT id FROM app_settings WHERE setting_key=?').get(key) as { id: string } | undefined
      const id = existing?.id || key
      if (existing) db.prepare(`UPDATE app_settings SET value=?, updated_at=datetime('now') WHERE id=?`).run(value, id)
      else db.prepare('INSERT INTO app_settings (id, setting_key, value) VALUES (?,?,?)').run(id, key, value)
      await enqueuSync('app_settings', id, existing ? 'UPDATE' : 'INSERT', { id, setting_key: key, value })
    }
    logAudit(db, { userId: caller.id as string, branchId: (caller.branch_id as string) || null, action: 'APP_SETTINGS_SAVED', tableName: 'app_settings', newValues: next })
    return { success: true }
  })
}
