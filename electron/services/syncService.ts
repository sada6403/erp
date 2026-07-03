import { getDb } from '../database'
import Store from 'electron-store'
import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import { CloudApi, CloudRateLimitError } from './cloudApi'

const store = new Store()
const BATCH_SIZE = 5
const MAX_ATTEMPTS = 5
const REQUEST_DELAY_MS = 1_000
const STALE_PROCESSING_MINUTES = 3
const SYNC_INTERVAL_MS = 30_000
const DRAIN_RETRY_MS = 5_000

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export class SyncService {
  private timer: ReturnType<typeof setInterval> | null = null
  private drainTimer: ReturnType<typeof setTimeout> | null = null
  private running = false
  private colCache = new Map<string, Set<string>>()
  private backoffUntil = 0

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
    const apiKey = String(settings?.cloud_api_key || '').trim()
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
      await this.processBatch(cloud)
      if (this.hasPendingPushes()) return
      await this.pullChanges(cloud)
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
      'branches', 'warehouses', 'roles', 'users', 'categories', 'suppliers',
      'products', 'stocks', 'stock_movements', 'customers', 'deliveries',
      'installments', 'installment_plans', 'installment_schedule',
      'installment_reminders', 'stock_transfers', 'customer_orders', 'customer_order_items',
    ]

    let pulledInstallmentIds: string[] = []

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

      // Capture installment IDs now; reuse below, no duplicate fetch.
      if (table === 'installments') {
        pulledInstallmentIds = data.map(row => String(row.id))
      }

      const pendingIds = (db.prepare(`
        SELECT record_id FROM sync_queue
        WHERE table_name = ? AND status IN ('pending', 'processing')
      `).all(table) as { record_id: string }[]).map(row => row.record_id)

      db.transaction(() => {
        for (const row of data) {
          if (pendingIds.includes(String(row.id))) continue
          this.insertFiltered(db, table, row)
        }
      })()
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
            this.insertFiltered(db, 'invoices', invoice)
          }
        })()

        for (let index = 0; index < pulledInvoiceIds.length; index += 50) {
          const ids = pulledInvoiceIds.slice(index, index + 50)
          const items = await cloud.related('invoice_items', 'invoice_id', ids)
          await sleep(REQUEST_DELAY_MS)
          const payments = await cloud.related('payments', 'invoice_id', ids)
          await sleep(REQUEST_DELAY_MS)
          db.transaction(() => {
            for (const item of items) this.insertFiltered(db, 'invoice_items', item)
            for (const payment of payments) this.insertFiltered(db, 'payments', payment)
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
            for (const payment of payments) this.insertFiltered(db, 'installment_payments', payment)
          })()
        }
      } catch (err) {
        if (err instanceof CloudRateLimitError) throw err
        console.error('[SyncService] Failed to pull installment payments:', err)
      }
    }

    store.set('last_pull_timestamp', newPullTime)
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

    // Users table: preserve local-only fields (pin, 2FA) and clear lockout on cloud update.
    // Cloud schema has no login_attempts/locked_until/pin/two_factor_* columns, so a plain
    // INSERT OR REPLACE would wipe them. Use upsert instead.
    if (table === 'users') {
      const cloudUpdateCols = keys.filter(k =>
        ['name','email','phone','password_hash','pin_hash','role_id',
         'branch_id','is_active','last_login_at','updated_at'].includes(k)
      )
      db.prepare(
        `INSERT INTO users (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})
         ON CONFLICT(id) DO UPDATE SET
           ${cloudUpdateCols.map(k => `${k}=excluded.${k}`).join(',')},
           login_attempts=0, locked_until=NULL`
      ).run(...keys.map(k => localRow[k]))
      return
    }

    db.prepare(
      `INSERT OR REPLACE INTO ${table} (${keys.join(',')})
       VALUES (${keys.map(() => '?').join(',')})`
    ).run(...keys.map(key => localRow[key]))
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
  const localOnlyFields = ['synced_at', 'items', 'reason', 'payment', 'password']
  const result = { ...payload }
  for (const field of localOnlyFields) delete result[field]
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
