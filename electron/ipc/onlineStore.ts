import type { IpcMain } from 'electron'
import crypto from 'crypto'
import { getDb } from '../database'
import { createCompanyStore } from '../services/companyWorkspace'
import { enqueuSync } from '../services/syncQueue'
import { logAudit } from '../services/auditLog'
import { safeHandle } from './ipcHandler'
import { CloudApi } from '../services/cloudApi'
import { decryptSecret } from './settings'
import { buildBannerRow, parseHomeLayout, validateHomeLayout } from '../services/bannerRules'

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

function getCloud(): CloudApi {
  const st = (store.get('app_settings') as Json) || {}
  const baseUrl = String(st.cloud_api_url || '').trim()
  const apiKey = decryptSecret(st.cloud_api_key).trim()
  if (!baseUrl || !apiKey) throw new Error('This device is not connected to the cloud (Settings > Cloud Sync)')
  return new CloudApi({ baseUrl, apiKey, deviceId: (store.get('device_id') as string | undefined) ?? null })
}

function str(v: unknown, max: number): string | null {
  const s = String(v ?? '').trim()
  return s ? s.slice(0, max) : null
}

export function registerOnlineStoreHandlers(ipcMain: IpcMain) {
  // Banners (App Control). Times are Asia/Colombo wall time ('YYYY-MM-DD HH:MM:SS').
  safeHandle(ipcMain, 'onlineStore:banners:list', () => {
    requireAdmin()
    return { success: true, data: getDb().prepare('SELECT * FROM app_banners ORDER BY sort_order, created_at DESC').all() }
  })

  safeHandle(ipcMain, 'onlineStore:banners:save', async (_e, p: Json) => {
    const caller = requireAdmin()
    const db = getDb()
    const row = buildBannerRow(p, (kind, id) => !!db.prepare(kind === 'product' ? 'SELECT 1 FROM products WHERE id=?' : 'SELECT 1 FROM categories WHERE id=?').get(id))
    let id = str(p.id, 64)
    if (id) {
      if (!db.prepare('SELECT 1 FROM app_banners WHERE id=?').get(id)) throw new Error('Banner not found')
      db.prepare(`UPDATE app_banners SET title=@title, subtitle=@subtitle, image_url=@image_url, image_en=@image_en, image_ta=@image_ta, image_si=@image_si,
        link_type=@link_type, link_target=@link_target, link_url=@link_url, audience=@audience,
        sort_order=@sort_order, is_active=@is_active, starts_at=@starts_at, ends_at=@ends_at, updated_at=datetime('now') WHERE id=@id`)
        .run({ ...row, id })
      await enqueuSync('app_banners', id, 'UPDATE', { id, ...row })
    } else {
      id = crypto.randomUUID()
      db.prepare(`INSERT INTO app_banners (id,title,subtitle,image_url,image_en,image_ta,image_si,link_type,link_target,link_url,audience,sort_order,is_active,starts_at,ends_at)
        VALUES (@id,@title,@subtitle,@image_url,@image_en,@image_ta,@image_si,@link_type,@link_target,@link_url,@audience,@sort_order,@is_active,@starts_at,@ends_at)`).run({ ...row, id })
      await enqueuSync('app_banners', id, 'INSERT', { id, ...row })
    }
    logAudit(db, { userId: caller.id as string, branchId: (caller.branch_id as string) || null, action: 'APP_BANNER_SAVED', tableName: 'app_banners', recordId: id, newValues: row })
    return { success: true, data: { id } }
  })

  safeHandle(ipcMain, 'onlineStore:banners:setActive', async (_e, id: string, active: boolean) => {
    const caller = requireAdmin()
    const db = getDb()
    const flag = active ? 1 : 0
    const r = db.prepare(`UPDATE app_banners SET is_active=?, updated_at=datetime('now') WHERE id=?`).run(flag, String(id))
    if (!r.changes) throw new Error('Banner not found')
    await enqueuSync('app_banners', String(id), 'UPDATE', { id: String(id), is_active: flag })
    logAudit(db, { userId: caller.id as string, branchId: (caller.branch_id as string) || null, action: 'APP_BANNER_SAVED', tableName: 'app_banners', recordId: String(id), newValues: { is_active: flag } })
    return { success: true }
  })

  // Drag-to-reorder: ids in the new display order
  safeHandle(ipcMain, 'onlineStore:banners:reorder', async (_e, ids: string[]) => {
    const caller = requireAdmin()
    if (!Array.isArray(ids) || !ids.length || ids.length > 200) throw new Error('Nothing to reorder')
    const db = getDb()
    const upd = db.prepare(`UPDATE app_banners SET sort_order=?, updated_at=datetime('now') WHERE id=?`)
    const changed: Array<[string, number]> = []
    db.transaction(() => { ids.forEach((id, i) => { if (upd.run((i + 1) * 10, String(id)).changes) changed.push([String(id), (i + 1) * 10]) }) })()
    for (const [id, sort_order] of changed) await enqueuSync('app_banners', id, 'UPDATE', { id, sort_order })
    logAudit(db, { userId: caller.id as string, branchId: (caller.branch_id as string) || null, action: 'APP_BANNER_SAVED', tableName: 'app_banners', newValues: { reordered: changed.length } })
    return { success: true }
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

  // Impressions / taps per banner (cloud counters; needs the cloud connection)
  safeHandle(ipcMain, 'onlineStore:banners:stats', async (_e, p: Json = {}) => {
    requireAdmin()
    return { success: true, data: await getCloud().bannerStats(str(p.from, 10) ?? undefined, str(p.to, 10) ?? undefined) }
  })

  safeHandle(ipcMain, 'onlineStore:categories:list', () => {
    requireAdmin()
    return { success: true, data: getDb().prepare('SELECT id, name FROM categories ORDER BY name LIMIT 500').all() }
  })

  // Home page sections (app_settings key 'home_layout', JSON; synced like the other settings)
  safeHandle(ipcMain, 'onlineStore:homeLayout:get', () => {
    requireAdmin()
    const row = getDb().prepare(`SELECT value FROM app_settings WHERE setting_key='home_layout'`).get() as { value: string | null } | undefined
    return { success: true, data: parseHomeLayout(row?.value) }
  })

  safeHandle(ipcMain, 'onlineStore:homeLayout:save', async (_e, sections: unknown) => {
    const caller = requireAdmin()
    const value = JSON.stringify(validateHomeLayout(sections))
    const db = getDb()
    const existing = db.prepare(`SELECT id FROM app_settings WHERE setting_key='home_layout'`).get() as { id: string } | undefined
    const id = existing?.id || 'home_layout'
    if (existing) db.prepare(`UPDATE app_settings SET value=?, updated_at=datetime('now') WHERE id=?`).run(value, id)
    else db.prepare('INSERT INTO app_settings (id, setting_key, value) VALUES (?,?,?)').run(id, 'home_layout', value)
    await enqueuSync('app_settings', id, existing ? 'UPDATE' : 'INSERT', { id, setting_key: 'home_layout', value })
    logAudit(db, { userId: caller.id as string, branchId: (caller.branch_id as string) || null, action: 'APP_SETTINGS_SAVED', tableName: 'app_settings', newValues: { home_layout: value } })
    return { success: true }
  })

  // Flash deals = the existing dated POS product discounts (managed in Discounts). Read-only here: no price logic of our own.
  safeHandle(ipcMain, 'onlineStore:flashDeals:list', () => {
    requireAdmin()
    const rows = getDb().prepare(`SELECT d.id, d.name, d.type, d.value, d.valid_from, d.valid_until, p.id AS product_id, p.name AS product_name, p.selling_price
        FROM discounts d JOIN products p ON p.id = d.product_id
       WHERE d.scope='product' AND d.is_active=1 AND d.valid_until IS NOT NULL AND d.valid_until > datetime('now')
         AND (d.valid_from IS NULL OR d.valid_from <= datetime('now')) AND p.is_active=1 ORDER BY d.valid_until LIMIT 200`).all() as Array<Json>
    return { success: true, data: rows.map(r => {
      const price = Number(r.selling_price) || 0
      const deal = r.type === 'percentage' ? price * (1 - Number(r.value) / 100) : price - Number(r.value)
      return { ...r, deal_price: Math.round(deal * 100) / 100 }
    }) }
  })

  // Delivery time per branch (shown on the app's product page; all empty = not shown)
  safeHandle(ipcMain, 'onlineStore:delivery:list', () => {
    requireAdmin()
    return { success: true, data: getDb().prepare(`SELECT id, name, delivery_eta_min_days, delivery_eta_max_days, delivery_eta_text FROM branches WHERE is_active = 1 ORDER BY name`).all() }
  })

  safeHandle(ipcMain, 'onlineStore:delivery:save', async (_e, branchId: string, p: Json) => {
    const caller = requireAdmin()
    const db = getDb()
    if (!db.prepare('SELECT 1 FROM branches WHERE id=?').get(String(branchId))) throw new Error('Branch not found')
    const day = (v: unknown, label: string): number | null => {
      const raw = String(v ?? '').trim()
      if (!raw) return null
      const n = Number(raw)
      if (!Number.isInteger(n) || n < 0 || n > 90) throw new Error(`${label} must be a whole number of days (0-90)`)
      return n
    }
    let min = day(p.min_days, 'Minimum days')
    let max = day(p.max_days, 'Maximum days')
    if (min !== null && max === null) max = min
    if (max !== null && min === null) min = max
    if (min !== null && max !== null && min > max) throw new Error('Minimum days cannot be more than maximum days')
    const text = str(p.text, 120)
    db.prepare(`UPDATE branches SET delivery_eta_min_days=?, delivery_eta_max_days=?, delivery_eta_text=?, updated_at=datetime('now') WHERE id=?`).run(min, max, text, String(branchId))
    await enqueuSync('branches', String(branchId), 'UPDATE', { id: String(branchId), delivery_eta_min_days: min, delivery_eta_max_days: max, delivery_eta_text: text })
    logAudit(db, { userId: caller.id as string, branchId: (caller.branch_id as string) || null, action: 'APP_DELIVERY_TIME_SAVED', tableName: 'branches', recordId: String(branchId), newValues: { min, max, text } })
    return { success: true }
  })

  // Online products
  safeHandle(ipcMain, 'onlineStore:products:list', (_e, f: Json = {}) => {
    requireAdmin()
    let sql = 'SELECT id, name, sku, selling_price, image_url, is_online, is_featured FROM products WHERE is_active=1'
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

  // Featured products (home page "Featured" rail)
  safeHandle(ipcMain, 'onlineStore:products:setFeatured', async (_e, ids: string[], featured: boolean) => {
    const caller = requireAdmin()
    if (!Array.isArray(ids) || !ids.length) throw new Error('Select at least one product')
    if (ids.length > 500) throw new Error('Too many products at once')
    const db = getDb()
    const flag = featured ? 1 : 0
    const upd = db.prepare(`UPDATE products SET is_featured=?, updated_at=datetime('now') WHERE id=?`)
    const changed: string[] = []
    db.transaction(() => { for (const id of ids) if (upd.run(flag, String(id)).changes) changed.push(String(id)) })()
    for (const id of changed) await enqueuSync('products', id, 'UPDATE', { id, is_featured: flag })
    logAudit(db, { userId: caller.id as string, branchId: (caller.branch_id as string) || null, action: 'APP_PRODUCTS_FEATURED', tableName: 'products', newValues: { count: changed.length, is_featured: flag } })
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
