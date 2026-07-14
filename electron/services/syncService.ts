import { getDb } from '../database'
import Store from 'electron-store'
import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import { CloudApi, CloudRateLimitError } from './cloudApi'
import { CLOUD_BRANDING_KEYS, decryptSecret, pushBrandingToCloud } from '../ipc/settings'

const store = new Store()
const BATCH_SIZE = 10
const MAX_ATTEMPTS = 5
const REQUEST_DELAY_MS = 300
const STALE_PROCESSING_MINUTES = 3
const SYNC_INTERVAL_MS = 15_000
const DRAIN_RETRY_MS = 1_500
const DEFAULT_FAILED_RETRY_MINUTES = 2

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export class SyncService {
  private timer: ReturnType<typeof setInterval> | null = null
  private drainTimer: ReturnType<typeof setTimeout> | null = null
  private running = false
  private colCache = new Map<string, Set<string>>()
  private backoffUntil = 0
  private lastFailedRetryAt = 0

  start() {
    if (this.timer) return
    this.timer = setInterval(() => this.runOnce(), SYNC_INTERVAL_MS)
    this.runOnce()
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    if (this.drainTimer) clearTimeout(this.drainTimer)
    this.timer = null
    this.drainTimer = null
  }

  private getCloudApi(): CloudApi | null {
    const settings = store.get('app_settings') as Record<string, unknown> | undefined
    const baseUrl = String(settings?.cloud_api_url || '').trim()
    // decryptSecret passes plaintext values through unchanged
    const apiKey = decryptSecret(settings?.cloud_api_key).trim()
    if (!baseUrl || !apiKey) return null
    return new CloudApi({ baseUrl, apiKey })
  }

  async runOnce(): Promise<void> {
    if (this.running) return
    if (Date.now() < this.backoffUntil) return
    this.running = true

    try {
      const cloud = this.getCloudApi()
      if (!cloud) return
      if (!await this.checkOnline(cloud)) return

      this.resetStaleProcessing()
      this.resetFailedForAutoRetry()
      if (this.needsBootstrapPull()) {
        this.ensureLocalSystemRoles()
        store.delete('last_pull_timestamp')
        await this.pullChanges(cloud)
      }
      await this.processBatch(cloud)
      if (this.hasPendingPushes()) return
      await this.pullChanges(cloud)
      await this.syncBranding(cloud)
    } catch (err) {
      if (err instanceof CloudRateLimitError) {
        this.backoffUntil = Date.now() + err.retryAfterSeconds * 1000
        console.warn(`[SyncService] Rate limited. Retrying after ${err.retryAfterSeconds}s`)
        return
      }
      console.error('[SyncService]', err)
    } finally {
      this.running = false
      if (Date.now() >= this.backoffUntil && this.safeHasPendingPushes()) {
        this.scheduleSoon(DRAIN_RETRY_MS)
      }
    }
  }

  runSoon(): void {
    this.scheduleSoon(250)
  }

  private scheduleSoon(ms: number): void {
    if (this.drainTimer) return
    this.drainTimer = setTimeout(() => {
      this.drainTimer = null
      this.runOnce()
    }, ms)
  }

  private async processBatch(cloud: CloudApi): Promise<void> {
    const db = getDb()
    const items = db.prepare(`
      SELECT * FROM sync_queue
      WHERE status = 'pending' AND attempts < ?
      ORDER BY created_at ASC
      LIMIT ?
    `).all(MAX_ATTEMPTS, BATCH_SIZE) as SyncItem[]

    if (items.length === 0) return

    const ids = items.map(item => item.id)
    db.prepare(`UPDATE sync_queue SET status='processing' WHERE id IN (${ids.map(() => '?').join(',')})`)
      .run(...ids)

    for (const item of items) {
      await this.syncItem(cloud, item, db)
      await sleep(REQUEST_DELAY_MS)
    }
  }

  private resetStaleProcessing(): void {
    const db = getDb()
    db.prepare(`
      UPDATE sync_queue
      SET status='pending', last_error='Recovered stale processing item'
      WHERE status='processing'
        AND datetime(created_at) <= datetime('now', ?)
    `).run(`-${STALE_PROCESSING_MINUTES} minutes`)
  }

  private resetFailedForAutoRetry(): void {
    const settings = store.get('app_settings') as Record<string, unknown> | undefined
    const retryMinutes = Math.max(
      1,
      Number(settings?.failed_sync_retry_minutes || DEFAULT_FAILED_RETRY_MINUTES)
    )
    const now = Date.now()
    if (now - this.lastFailedRetryAt < retryMinutes * 60_000) return

    const db = getDb()
    const result = db.prepare(`
      UPDATE sync_queue
      SET status='pending',
          attempts=0,
          last_error='Automatic retry scheduled'
      WHERE status='failed'
    `).run()

    if (result.changes > 0) {
      this.lastFailedRetryAt = now
      console.info(`[SyncService] Auto-retrying ${result.changes} failed sync item(s)`)
    }
  }

  private hasPendingPushes(): boolean {
    const db = getDb()
    const row = db.prepare(`
      SELECT COUNT(*) as c
      FROM sync_queue
      WHERE status IN ('pending','processing') AND attempts < ?
    `).get(MAX_ATTEMPTS) as { c: number }
    return row.c > 0
  }

  private safeHasPendingPushes(): boolean {
    try { return this.hasPendingPushes() } catch { return false }
  }

  private needsBootstrapPull(): boolean {
    try {
      const db = getDb()
      const row = db.prepare(`SELECT COUNT(*) as c FROM users WHERE is_active=1`).get() as { c: number }
      return row.c === 0
    } catch {
      return false
    }
  }

  private ensureLocalSystemRoles(): void {
    try {
      const db = getDb()
      db.prepare(`
        INSERT OR IGNORE INTO roles (id, name, permissions)
        VALUES
          ('3a6b8c9d-1e2f-4a3b-8c9d-1e2f3a6b8c9d', 'Company Admin', '{"all":true}'),
          ('4b7c9d0e-2f3a-5b4c-9d0e-2f3a4b7c9d0e', 'Branch Manager', '{"pos":true,"inventory":true,"reports":true,"customers":true,"employees":true,"coupons":true,"coupons_create":true,"coupons_reports":true}'),
          ('5c8d0e1f-3a4b-6c5d-0e1f-3a4b5c8d0e1f', 'Cashier', '{"pos":true,"customers":true}'),
          ('6d9e1f2a-4b5c-7d6e-1f2a-4b5c6d9e1f2a', 'Warehouse Staff', '{"inventory":true,"transfers":true}'),
          ('7e0f2a3b-5c6d-8e7f-2a3b-5c6d7e0f2a3b', 'Delivery Staff', '{"deliveries":true}')
      `).run()
    } catch {
      // Cloud sync can continue; insertFiltered will surface any real schema issue.
    }
  }

  private async uploadOfflineImage(cloud: CloudApi, localUrl: string): Promise<string | null> {
    try {
      const fileName = localUrl.replace('app-img://', '')
      const filePath = path.join(app.getPath('userData'), 'uploads', fileName)
      if (!fs.existsSync(filePath)) {
        console.warn(`[SyncService] Offline image file not found: ${filePath}`)
        return null
      }

      const extension = path.extname(filePath).toLowerCase()
      const contentTypes: Record<string, string> = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
      }
      const contentType = contentTypes[extension]
      if (!contentType) return null
      return await cloud.uploadImage(filePath, fileName, contentType)
    } catch (err) {
      console.error('[SyncService] Image upload failed:', err)
      return null
    }
  }

  private async syncItem(
    cloud: CloudApi,
    item: SyncItem,
    db: ReturnType<typeof getDb>
  ): Promise<void> {
    try {
      const payload = JSON.parse(item.payload) as Record<string, unknown>

      if (
        item.table_name === 'products'
        && typeof payload.image_url === 'string'
        && payload.image_url.startsWith('app-img://')
      ) {
        const publicUrl = await this.uploadOfflineImage(cloud, payload.image_url)
        if (publicUrl) {
          payload.image_url = publicUrl
          db.prepare("UPDATE products SET image_url = ?, updated_at = datetime('now') WHERE id = ?")
            .run(publicUrl, item.record_id)
        } else {
          // Don't push a locally-only-resolvable app-img:// URL into the cloud
          // and mark it synced — retry like any other transient failure instead.
          throw new Error('Image upload failed; retrying before pushing product record')
        }
      }

      await cloud.push({
        table: item.table_name,
        operation: item.operation,
        recordId: item.record_id,
        record: normalizeForCloud(payload),
      })

      db.prepare(`UPDATE sync_queue SET status='synced', synced_at=datetime('now') WHERE id=?`)
        .run(item.id)
    } catch (err: unknown) {
      if (err instanceof CloudRateLimitError) {
        db.prepare(`UPDATE sync_queue SET status='pending', attempts=?, last_error=? WHERE id=?`)
          .run(item.attempts, err.message, item.id)
        throw err
      }
      const message = err instanceof Error ? err.message : String(err)
      const attempts = item.attempts + 1
      const status = attempts >= MAX_ATTEMPTS ? 'failed' : 'pending'
      db.prepare(`UPDATE sync_queue SET status=?, attempts=?, last_error=? WHERE id=?`)
        .run(status, attempts, message, item.id)
    }
  }

  private async pullChanges(cloud: CloudApi): Promise<void> {
    const db = getDb()
    const lastPull = store.get('last_pull_timestamp') as string || '1970-01-01T00:00:00.000Z'
    const newPullTime = new Date().toISOString()

    const globalTables = [
      'branches', 'roles', 'users', 'categories', 'suppliers',
      'products', 'stocks', 'stock_transfers', 'stock_movements', 'customers', 'deliveries',
      'purchase_orders', 'purchase_items',
      'installments', 'installment_plans', 'installment_schedule',
      'installment_reminders', 'customer_orders', 'customer_order_items',
      'branch_transfers', 'branch_transfer_items', 'branch_transfer_mismatches',
      'branch_transfer_logs', 'branch_transfer_prints',
      'coupons', 'coupon_redemptions',
      // Phase 2 additions
      'agents', 'expense_categories', 'expenses',
      'returns', 'cash_sessions', 'loyalty_config', 'loyalty_transactions',
      'product_uom', 'product_batches', 'audit_logs',
    ]

    let pulledInstallmentIds: string[] = []
    let pulledReturnIds: string[] = []

    for (const table of globalTables) {
      let data: Record<string, unknown>[] = []
      try {
        data = await cloud.changes(table, lastPull)
        await sleep(REQUEST_DELAY_MS)
      } catch (err) {
        if (err instanceof CloudRateLimitError) throw err
        console.error('[SyncService] Failed to pull table:', table, err)
        continue
      }
      if (data.length === 0) continue

      // Capture installment/return IDs now; reuse below, no duplicate fetch.
      if (table === 'installments') {
        pulledInstallmentIds = data.map(row => String(row.id))
      }
      if (table === 'returns') {
        pulledReturnIds = data.map(row => String(row.id))
      }

      const pendingIds = (db.prepare(`
        SELECT record_id FROM sync_queue
        WHERE table_name = ? AND status IN ('pending', 'processing')
      `).all(table) as { record_id: string }[]).map(row => row.record_id)

      try {
        db.transaction(() => {
          for (const row of data) {
            if (pendingIds.includes(String(row.id))) continue
            // One row with bad/dangling data (e.g. a foreign key the cloud
            // itself never enforced) must not roll back every other row in
            // this table's batch — skip just that row and keep going.
            try {
              this.insertFiltered(db, table, row)
            } catch (err) {
              console.error(`[SyncService] Skipping row in ${table} (${row.id}):`, err)
            }
          }
        })()
      } catch (err) {
        console.error(`[SyncService] Transaction execution failed for table ${table}:`, err)
      }
    }

    // Pull invoices + child records
    try {
      const invoices = await cloud.changes('invoices', lastPull)
      if (invoices.length > 0) {
        const pendingIds = (db.prepare(`
          SELECT record_id FROM sync_queue
          WHERE table_name = 'invoices' AND status IN ('pending', 'processing')
        `).all() as { record_id: string }[]).map(row => row.record_id)
        const pulledInvoiceIds: string[] = []

        db.transaction(() => {
          for (const invoice of invoices) {
            if (pendingIds.includes(String(invoice.id))) continue
            pulledInvoiceIds.push(String(invoice.id))
            try {
              this.insertFiltered(db, 'invoices', invoice)
            } catch (err) {
              console.error(`[SyncService] Skipping invoice (${invoice.id}):`, err)
            }
          }
        })()

        for (let index = 0; index < pulledInvoiceIds.length; index += 50) {
          const ids = pulledInvoiceIds.slice(index, index + 50)
          const items = await cloud.related('invoice_items', 'invoice_id', ids)
          await sleep(REQUEST_DELAY_MS)
          const payments = await cloud.related('payments', 'invoice_id', ids)
          await sleep(REQUEST_DELAY_MS)
          db.transaction(() => {
            for (const item of items) {
              try { this.insertFiltered(db, 'invoice_items', item) }
              catch (err) { console.error(`[SyncService] Skipping invoice_item (${item.id}):`, err) }
            }
            for (const payment of payments) {
              try { this.insertFiltered(db, 'payments', payment) }
              catch (err) { console.error(`[SyncService] Skipping payment (${payment.id}):`, err) }
            }
          })()
        }
      }
    } catch (err) {
      if (err instanceof CloudRateLimitError) throw err
      console.error('[SyncService] Failed to pull invoices:', err)
    }

    // Pull installment_payments using IDs already fetched above — no duplicate API call
    if (pulledInstallmentIds.length > 0) {
      try {
        for (let index = 0; index < pulledInstallmentIds.length; index += 50) {
          const payments = await cloud.related(
            'installment_payments', 'installment_id',
            pulledInstallmentIds.slice(index, index + 50)
          )
          await sleep(REQUEST_DELAY_MS)
          db.transaction(() => {
            for (const payment of payments) {
              try { this.insertFiltered(db, 'installment_payments', payment) }
              catch (err) { console.error(`[SyncService] Skipping installment_payment (${payment.id}):`, err) }
            }
          })()
        }
      } catch (err) {
        if (err instanceof CloudRateLimitError) throw err
        console.error('[SyncService] Failed to pull installment payments:', err)
      }
    }

    // Pull return_items using IDs already fetched above — no duplicate API call
    if (pulledReturnIds.length > 0) {
      try {
        for (let index = 0; index < pulledReturnIds.length; index += 50) {
          const items = await cloud.related(
            'return_items', 'return_id',
            pulledReturnIds.slice(index, index + 50)
          )
          await sleep(REQUEST_DELAY_MS)
          db.transaction(() => {
            for (const item of items) {
              try { this.insertFiltered(db, 'return_items', item) }
              catch (err) { console.error(`[SyncService] Skipping return_item (${item.id}):`, err) }
            }
          })()
        }
      } catch (err) {
        if (err instanceof CloudRateLimitError) throw err
        console.error('[SyncService] Failed to pull return items:', err)
      }
    }

    store.set('last_pull_timestamp', newPullTime)
  }

  // Company branding: retry a pending local push first, otherwise pull the
  // company-wide branding and apply it to this device's app_settings.
  private async syncBranding(cloud: CloudApi): Promise<void> {
    try {
      if (store.get('branding_push_pending')) {
        const pushed = await pushBrandingToCloud()
        if (!pushed) return // keep local edit; don't let a pull overwrite it
      }

      const { branding } = await cloud.getBranding()
      if (!branding) return
      const incoming = JSON.stringify(branding)
      if (incoming === String(store.get('company_branding_synced') || '')) return

      const settings = (store.get('app_settings') as Record<string, unknown>) || {}
      let changed = false
      for (const key of CLOUD_BRANDING_KEYS) {
        if (!(key in branding)) continue
        const value = branding[key]
        if (value === null || value === undefined) continue // never set at company level
        const next = String(value)
        if (String(settings[key] ?? '') !== next) {
          settings[key] = next
          changed = true
        }
      }
      if (changed) store.set('app_settings', settings)
      store.set('company_branding_synced', incoming)
    } catch (err) {
      if (err instanceof CloudRateLimitError) throw err
      console.error('[SyncService] Branding sync failed:', err)
    }
  }

  private getColumns(db: ReturnType<typeof getDb>, table: string): Set<string> {
    if (this.colCache.has(table)) return this.colCache.get(table)!
    const cols = new Set(
      (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(c => c.name)
    )
    this.colCache.set(table, cols)
    return cols
  }

  private insertFiltered(
    db: ReturnType<typeof getDb>,
    table: string,
    row: Record<string, unknown>
  ): void {
    const validColumns = this.getColumns(db, table)
    const localRow: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(row)) {
      if (!validColumns.has(key)) continue
      if (typeof value === 'boolean') localRow[key] = value ? 1 : 0
      else if (value !== null && typeof value === 'object') localRow[key] = JSON.stringify(value)
      else localRow[key] = value
    }

    const keys = Object.keys(localRow)
    if (keys.length === 0) return

    // Roles are UNIQUE(name). A cloud role with the same name but a different
    // id (e.g. the locally-seeded system roles vs. the company's real cloud
    // role rows) would make INSERT OR REPLACE delete-then-reinsert on
    // conflict — which fails with a foreign key error if any local user
    // still references the row being deleted. Update the existing
    // name-matched row in place instead of replacing it.
    if (table === 'roles') {
      const existingByName = db.prepare(`SELECT id FROM roles WHERE name = ? LIMIT 1`).get(String(localRow.name)) as { id?: string } | undefined
      if (existingByName?.id && existingByName.id !== localRow.id) {
        const updateKeys = keys.filter(k => k !== 'id')
        if (updateKeys.length > 0) {
          db.prepare(
            `UPDATE roles SET ${updateKeys.map(k => `${k}=?`).join(',')} WHERE id=?`
          ).run(...updateKeys.map(k => localRow[k]), existingByName.id)
        }
        return
      }
    }

    if (table === 'categories' && localRow.parent_id) {
      const parentId = String(localRow.parent_id)
      const exists = db.prepare(`SELECT id FROM categories WHERE id = ? LIMIT 1`).get(parentId)
      if (!exists) localRow.parent_id = null
    }

    if (table === 'stock_movements') {
      if (localRow.created_by) {
        const userId = String(localRow.created_by)
        const exists = db.prepare(`SELECT id FROM users WHERE id = ? LIMIT 1`).get(userId)
        if (!exists) {
          const fallback = db.prepare(`
            SELECT id FROM users
            WHERE is_active = 1
            ORDER BY
              CASE
                WHEN lower(email) LIKE '%admin%' THEN 0
                WHEN lower(name) LIKE '%admin%' THEN 1
                ELSE 2
              END,
              created_at ASC
            LIMIT 1
          `).get() as { id?: string } | undefined
          localRow.created_by = fallback?.id ?? null
        }
      }

      if (localRow.reference_transfer_id) {
        const transferId = String(localRow.reference_transfer_id)
        const exists = db.prepare(`SELECT id FROM stock_transfers WHERE id = ? LIMIT 1`).get(transferId)
        if (!exists) localRow.reference_transfer_id = null
      }
    }

    // Users table: preserve local-only fields (pin, 2FA) and clear lockout on cloud update.
    // Cloud schema has no login_attempts/locked_until/pin/two_factor_* columns, so a plain
    // INSERT OR REPLACE would wipe them. Use upsert instead.
    if (table === 'users') {
      if (localRow.role_id) {
        const roleId = String(localRow.role_id)
        const exists = db.prepare(`SELECT id FROM roles WHERE id = ? LIMIT 1`).get(roleId)
        if (!exists) {
          const email = String(localRow.email || '').toLowerCase()
          const name = String(localRow.name || '').toLowerCase()
          const fallbackRoleName = email.includes('admin') || name.includes('admin')
            ? 'Company Admin'
            : email.includes('manager') || name.includes('manager')
              ? 'Branch Manager'
              : 'Cashier'
          const fallback = db.prepare(`SELECT id FROM roles WHERE name = ? LIMIT 1`).get(fallbackRoleName) as { id?: string } | undefined
          if (fallback?.id) localRow.role_id = fallback.id
        }
      }
      if (localRow.branch_id) {
        const branchId = String(localRow.branch_id)
        const exists = db.prepare(`SELECT id FROM branches WHERE id = ? LIMIT 1`).get(branchId)
        if (!exists) {
          const fallback = db.prepare(`
            SELECT id
            FROM branches
            WHERE is_active = 1
            ORDER BY
              CASE
                WHEN code = 'MAIN' THEN 0
                WHEN lower(name) LIKE '%main%' THEN 1
                WHEN lower(name) LIKE '%head%' THEN 2
                ELSE 3
              END,
              created_at ASC
            LIMIT 1
          `).get() as { id?: string } | undefined
          localRow.branch_id = fallback?.id ?? null
        }
      }
      // A blank credential from the cloud must never overwrite a real local hash
      // (protects against records damaged by the old password-wipe bug).
      const cloudUpdateCols = keys.filter(k => {
        if (!['name','email','phone','password_hash','pin_hash','role_id',
              'branch_id','is_active','last_login_at','updated_at'].includes(k)) return false
        if ((k === 'password_hash' || k === 'pin_hash') && !localRow[k]) return false
        return true
      })
      const setClauses = [
        ...cloudUpdateCols.map(k => `${k}=excluded.${k}`),
        'login_attempts=0', 'locked_until=NULL',
      ]
      db.prepare(
        `INSERT INTO users (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})
         ON CONFLICT(id) DO UPDATE SET ${setClauses.join(',')}`
      ).run(...keys.map(k => localRow[k]))

      // Auto-repair: if the cloud copy lost its password hash (old wipe bug) but we
      // still have a good one locally, push our copy back up.
      if (!row.password_hash) {
        const local = db.prepare(`SELECT password_hash FROM users WHERE id = ?`).get(String(row.id)) as { password_hash?: string } | undefined
        if (local?.password_hash) {
          void import('./syncQueue').then(({ enqueueUserRow }) => enqueueUserRow(String(row.id))).catch(() => undefined)
        }
      }
      return
    }

    try {
      db.prepare(
        `INSERT OR REPLACE INTO ${table} (${keys.join(',')})
         VALUES (${keys.map(() => '?').join(',')})`
      ).run(...keys.map(key => localRow[key]))
    } catch (err) {
      console.error(`[SyncService] Insert Error in table ${table}:`, err)
      console.error(`[SyncService] Problematic row:`, localRow)
      throw err
    }
  }

  private async checkOnline(cloud: CloudApi): Promise<boolean> {
    try {
      await cloud.health()
      return true
    } catch {
      return false
    }
  }
}

let singleton: SyncService | null = null

export function getSyncService(): SyncService {
  if (!singleton) singleton = new SyncService()
  return singleton
}

function normalizeForCloud(payload: Record<string, unknown>): Record<string, unknown> {
  // `pin` is the legacy plaintext PIN — never ship it; only pin_hash syncs.
  const localOnlyFields = ['synced_at', 'items', 'reason', 'payment', 'password', 'pin']
  const result = { ...payload }
  for (const field of localOnlyFields) delete result[field]
  // Never push empty credentials — they must not blank a real hash in the cloud
  if (result.password_hash === '' || result.password_hash === null) delete result.password_hash
  if (result.pin_hash === '' || result.pin_hash === null) delete result.pin_hash
  return result
}

interface SyncItem {
  id: string
  table_name: string
  record_id: string
  operation: string
  payload: string
  attempts: number
  last_error?: string
  status: string
}
