import { getDb } from '../database'
import Store from 'electron-store'
import fs from 'fs'
import path from 'path'
import { app, BrowserWindow } from 'electron'
import { CloudApi, CloudRateLimitError, DeviceRevokedError } from './cloudApi'
import { CLOUD_BRANDING_KEYS, decryptSecret, pushBrandingToCloud } from '../ipc/settings'
import { reconcileLocalDefaultRoles } from './roleReconcile'
import { isDeviceLocked, reportDeviceRevoked } from './licenseService'

const store = new Store()
// Issue 36: was 10 — a large bulk push (e.g. a 447-product bulk delete)
// took ~45 cycles to drain at 10/cycle, since every cycle also pays the
// full pullChanges() cost regardless. Raised to 50 to cut that roughly 3x;
// the per-item REQUEST_DELAY_MS throttle below is untouched (shared-backend
// rate-limit protection, out of scope for this fix).
const BATCH_SIZE = 50
const MAX_ATTEMPTS = 5
const REQUEST_DELAY_MS = 300
const STALE_PROCESSING_MINUTES = 3
const SYNC_INTERVAL_MS = 60_000
const STARTUP_SYNC_DELAY_MS = 4_000
const DRAIN_RETRY_MS = 1_500
// Issue 37 (36c) — near-instant propagation for the tables that matter most
// for a cashier's day-to-day experience (products/pricing, stock counts,
// categories) without shortening the full-table cycle. A lightweight
// watermark check every 10s is fast enough for another till to see changes
// while avoiding a permanent network request loop on low-powered devices.
// escalating to a targeted pull only when tracked data actually changed.
const WATERMARK_INTERVAL_MS = 10_000
const WATERMARK_STARTUP_DELAY_MS = 15_000
const WATERMARK_TABLES = ['categories', 'products', 'stocks', 'branch_transfers', 'branch_transfer_items']
const DEFAULT_FAILED_RETRY_MINUTES = 2

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function notifyPendingDeletions(item: {
  id: string
  tableName: string
  recordId: string
  action: string
  productName: string
  productSku: string
}) {
  try {
    const wins = BrowserWindow?.getAllWindows ? BrowserWindow.getAllWindows() : []
    for (const win of wins) {
      if (!win.isDestroyed()) {
        win.webContents.send('sync:pendingDeletions', item)
      }
    }
  } catch {
    // In headless or test environments
  }
}

function notifyRendererDataChanged() {
  try {
    const wins = BrowserWindow?.getAllWindows ? BrowserWindow.getAllWindows() : []
    for (const win of wins) {
      if (!win.isDestroyed()) win.webContents.send('sync:dataChanged')
    }
  } catch {
    // Renderer may not exist yet during startup sync.
  }
}

export class SyncService {
  private timer: ReturnType<typeof setInterval> | null = null
  private startupTimer: ReturnType<typeof setTimeout> | null = null
  private drainTimer: ReturnType<typeof setTimeout> | null = null
  private watermarkTimer: ReturnType<typeof setInterval> | null = null
  private watermarkStartupTimer: ReturnType<typeof setTimeout> | null = null
  private watermarkChecking = false
  private running = false
  private colCache = new Map<string, Set<string>>()
  private backoffUntil = 0
  private lastFailedRetryAt = 0
  // Issue 35: reconcileDefaultRolesFromCloud() previously only ran inside
  // needsBootstrapPull() (empty local `users` table) — so an already-
  // activated device with drifted role data never self-healed on a normal
  // app update, only on first-ever activation. This flag makes the full
  // role reconciliation run once per process launch instead, regardless of
  // bootstrap state — cheap (a handful of role/user rows) and only once,
  // not on every 15s tick.
  private startupReconcileDone = false

  start() {
    if (this.timer) return
    // A hard shutdown can leave the persisted display flag set even though no
    // sync exists in this new process.
    store.set('sync_running', false)
    this.timer = setInterval(() => this.runOnce(), SYNC_INTERVAL_MS)
    // Let the renderer become interactive before the first comprehensive
    // cloud reconciliation starts. Outbox writes still call runSoon().
    this.startupTimer = setTimeout(() => {
      this.startupTimer = null
      this.runOnce()
    }, STARTUP_SYNC_DELAY_MS)
    if (!this.watermarkTimer && !this.watermarkStartupTimer) {
      // The first full sync already covers these tables. Start the quick
      // watermark watcher only after startup work has settled.
      this.watermarkStartupTimer = setTimeout(() => {
        this.watermarkStartupTimer = null
        void this.checkWatermark()
        this.watermarkTimer = setInterval(() => this.checkWatermark(), WATERMARK_INTERVAL_MS)
      }, WATERMARK_STARTUP_DELAY_MS)
    }
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    if (this.startupTimer) clearTimeout(this.startupTimer)
    if (this.drainTimer) clearTimeout(this.drainTimer)
    if (this.watermarkTimer) clearInterval(this.watermarkTimer)
    if (this.watermarkStartupTimer) clearTimeout(this.watermarkStartupTimer)
    this.timer = null
    this.startupTimer = null
    this.drainTimer = null
    this.watermarkTimer = null
    this.watermarkStartupTimer = null
  }

  isBusy(): boolean {
    return this.running || this.watermarkChecking
  }

  // Issue 37 (36c) — the fast path. Skips entirely while a full runOnce()
  // cycle is already in flight (it will cover these same 3 tables anyway as
  // part of its normal sweep) or while the device is locked/offline, so
  // this never does redundant or unauthorized work.
  private async checkWatermark(): Promise<void> {
    if (this.watermarkChecking || this.running) return
    if (Date.now() < this.backoffUntil) return
    if (isDeviceLocked()) return
    const cloud = this.getCloudApi()
    if (!cloud) return

    this.watermarkChecking = true
    try {
      const { watermark } = await cloud.getSyncWatermark()
      if (!watermark) return
      const lastSeen = store.get('last_seen_watermark') as string | undefined
      if (lastSeen === watermark) return
      // First-ever check on a device (no lastSeen yet) — nothing to react
      // to, the normal bootstrap/full-cycle pull already covers it.

      await this.pullWatermarkTables(cloud)
      store.set('last_seen_watermark', watermark)
    } catch (err) {
      if (err instanceof DeviceRevokedError) { reportDeviceRevoked(err.message); return }
      if (err instanceof CloudRateLimitError) return // let the main cycle's backoff handle it
      console.error('[SyncService] Watermark check failed:', err)
    } finally {
      this.watermarkChecking = false
    }
  }

  // Targeted pull for just the watermark-tracked tables — same upsert logic
  // as the full pullChanges() loop (insertFiltered), same idempotency
  // guarantees, just scoped to the watermark tables instead of the full set and on its own cursor
  // so it never interacts with pullChanges()'s own cursor bookkeeping.
  private async pullWatermarkTables(cloud: CloudApi): Promise<void> {
    await this.pullTables(cloud, WATERMARK_TABLES)
    notifyRendererDataChanged()
  }

  private getCloudApi(): CloudApi | null {
    const settings = store.get('app_settings') as Record<string, unknown> | undefined
    const baseUrl = String(settings?.cloud_api_url || '').trim()
    // decryptSecret passes plaintext values through unchanged
    const apiKey = decryptSecret(settings?.cloud_api_key).trim()
    if (!baseUrl || !apiKey) return null
    const deviceId = (store.get('device_id') as string | undefined) ?? null
    return new CloudApi({ baseUrl, apiKey, deviceId })
  }

  async runOnce(): Promise<boolean> {
    if (this.running || this.watermarkChecking) return false
    if (Date.now() < this.backoffUntil) return false
    // Phase 1 device-authorization work — a locked device must not push or
    // pull anything, even if it somehow still has connectivity (defense in
    // depth alongside the UI-level lock screen in App.tsx).
    if (isDeviceLocked()) return false
    this.running = true
    store.set('sync_running', true)

    try {
      const cloud = this.getCloudApi()
      if (!cloud) throw new Error('Cloud API is not configured')
      if (!await this.checkOnline(cloud)) throw new Error('Cloud server is unavailable')

      this.resetStaleProcessing()
      this.resetFailedForAutoRetry()
      if (!this.startupReconcileDone) {
        this.startupReconcileDone = true
        await this.reconcileDefaultRolesFromCloud(cloud)
        await this.reconcileUserRolesFromCloud(cloud)
      }
      if (this.needsBootstrapPull()) {
        this.ensureLocalSystemRoles()
        await this.reconcileDefaultRolesFromCloud(cloud)
        store.delete('last_pull_timestamp')
      }
      await this.processBatch(cloud)
      // Previously gated the ENTIRE pull (every table) on the local outbox
      // being fully drained — but pullChanges() already has its own correct,
      // per-record protection against clobbering a genuinely in-flight local
      // push (the `pendingIds` skip-list below), so this outer gate was only
      // ever redundant with that, and actively harmful: one slow-draining or
      // repeatedly-failing item (any table) delayed every OTHER table's pull
      // too, sometimes for the full ~2-minute resetFailedForAutoRetry cycle.
      await this.pullChanges(cloud)
      notifyRendererDataChanged()
      await this.syncBranding(cloud)
      await this.reconcileSupportSession(cloud)
      const unfinished = getDb().prepare("SELECT COUNT(*) AS n FROM sync_queue WHERE status != 'synced'").get() as { n: number }
      if (unfinished.n) throw new Error(`${unfinished.n} upload(s) still pending or failed`)
      store.delete('sync_cycle_error')
      store.set('last_successful_sync_v2_at', new Date().toISOString())
      return true
    } catch (err) {
      store.set('sync_cycle_error', err instanceof Error ? err.message : String(err))
      if (err instanceof CloudRateLimitError) {
        this.backoffUntil = Date.now() + err.retryAfterSeconds * 1000
        console.warn(`[SyncService] Rate limited. Retrying after ${err.retryAfterSeconds}s`)
        return false
      }
      if (err instanceof DeviceRevokedError) {
        reportDeviceRevoked(err.message)
        return false
      }
      console.error('[SyncService]', err)
      return false
    } finally {
      this.running = false
      store.set('sync_running', false)
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
      ORDER BY created_at ASC, rowid ASC
      LIMIT ?
    `).all(MAX_ATTEMPTS, BATCH_SIZE) as SyncItem[]

    if (items.length === 0) return

    for (const item of items) {
      const predecessor = db.prepare(`SELECT 1 FROM sync_queue WHERE table_name=? AND record_id=?
        AND status IN ('pending','processing','failed') AND rowid < (SELECT rowid FROM sync_queue WHERE id=?) LIMIT 1`)
        .get(item.table_name, item.record_id, item.id)
      if (predecessor) continue
      const claim = db.prepare(`UPDATE sync_queue SET status='processing'
        WHERE id=? AND status='pending' AND payload=? AND operation=?`).run(item.id, item.payload, item.operation)
      if (!claim.changes) continue
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

  // Issue 32a: ensureLocalSystemRoles() above just re-seeded the 5 default
  // roles at their fixed local placeholder ids — this is the exact
  // recurring trigger that caused the Issue 31 incident (a bootstrap pull
  // reintroducing placeholder ids that don't match this tenant's real cloud
  // role ids). Reconcile immediately, before pullChanges() processes
  // `users`, so role_id references resolve correctly on the very first
  // pass instead of falling back to a guess.
  private async reconcileDefaultRolesFromCloud(cloud: CloudApi): Promise<void> {
    try {
      const cloudRoles = await cloud.changes('roles', '1970-01-01T00:00:00.000Z')
      const cloudRolesByName: Record<string, string> = {}
      for (const row of cloudRoles) {
        const name = String(row.name || '')
        const id = String(row.id || '')
        if (name && id) cloudRolesByName[name] = id
      }
      reconcileLocalDefaultRoles(getDb(), cloudRolesByName)
    } catch (err) {
      console.error('[SyncService] Role reconciliation failed:', err)
    }
  }

  // Issue 35: reconcileDefaultRolesFromCloud() above only fixes a role ID
  // that doesn't match between local's placeholder and cloud's real ID for
  // the 5 default role names — it can't catch a user whose role_id points
  // to a role that legitimately exists locally, just the *wrong* one (which
  // is what actually happened here: local drifted to Cashier while cloud
  // correctly held Company Admin, and ordinary incremental pulls never
  // re-fetch a user row whose cloud `updated_at` hasn't changed since the
  // last successful pull checkpoint — so a drift predating that checkpoint
  // never gets noticed). This does a full (since-epoch) fetch of every
  // cloud user, same technique as the roles fetch above, and self-heals any
  // local user whose role_id disagrees with cloud's — but only when cloud's
  // value resolves to a role that actually exists locally (never point a
  // user at a nonexistent role). Cloud has proven to be the reliable side
  // here (both the push-side resolveRoleId hardening and this incident's
  // own data confirm cloud stayed correct throughout), so it wins on a
  // confirmed disagreement — this is a targeted correction of a known-bad
  // value, not a guess.
  private async reconcileUserRolesFromCloud(cloud: CloudApi): Promise<void> {
    try {
      const cloudUsers = await cloud.changes('users', '1970-01-01T00:00:00.000Z')
      const db = getDb()
      for (const cu of cloudUsers) {
        const id = String(cu.id || '')
        const cloudRoleId = String(cu.role_id || '')
        if (!id || !cloudRoleId) continue
        const localUser = db.prepare(`SELECT role_id, email FROM users WHERE id = ?`).get(id) as
          { role_id?: string; email?: string } | undefined
        if (!localUser?.role_id || localUser.role_id === cloudRoleId) continue
        const cloudRoleExistsLocally = db.prepare(`SELECT id FROM roles WHERE id = ? LIMIT 1`).get(cloudRoleId)
        if (!cloudRoleExistsLocally) continue
        console.warn(
          `[SyncService] Startup role consistency check: local role_id for user ` +
          `${localUser.email || id} disagrees with cloud (local=${localUser.role_id}, ` +
          `cloud=${cloudRoleId}) — see Issue 35. Correcting local to match cloud.`
        )
        db.prepare(`UPDATE users SET role_id = ?, updated_at = datetime('now') WHERE id = ?`).run(cloudRoleId, id)
      }
    } catch (err) {
      console.error('[SyncService] User role consistency check failed:', err)
    }
  }

  // Server-side kill-switch for an active emergency support session (Issue
  // 33) — independent of the device's own local clock, which the whoami
  // handler's expiry check alone cannot defend against (a tampered system
  // clock could otherwise keep a support session "valid" indefinitely).
  // A no-op whenever no support session is active locally.
  private async reconcileSupportSession(cloud: CloudApi): Promise<void> {
    const supportSession = store.get('support_session') as { id: string; expiresAt: string } | undefined
    if (!supportSession) return
    try {
      const status = await cloud.getSupportSessionStatus(supportSession.id)
      if (!status.active) {
        store.delete('support_session')
        store.delete('auth_token')
        store.delete('auth_user')
      }
    } catch (err) {
      console.error('[SyncService] Support session status check failed:', err)
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
        } else if (item.attempts < MAX_ATTEMPTS - 1) {
          // Don't push a locally-only-resolvable app-img:// URL into the cloud
          // and mark it synced — retry like any other transient failure instead.
          throw new Error('Image upload failed; retrying before pushing product record')
        } else {
          // Out of retries for the image specifically — this must NOT keep
          // blocking the rest of the row (name/price/stock) from ever
          // reaching other devices. Push it as-is: image_url stays
          // app-img://... (won't render elsewhere until cloud storage is
          // fixed and the image is re-uploaded), but everything else syncs.
          console.warn(`[SyncService] Giving up on cloud image upload for product ${item.record_id} after ${item.attempts + 1} attempts — syncing the rest of the row with the local-only image reference.`)
        }
      }

      const effectiveOp = (item.table_name === 'stocks' && item.operation === 'UPDATE') ? 'INSERT' : item.operation
      try {
        await cloud.push({
          table: item.table_name, operation: effectiveOp,
          recordId: item.record_id, record: normalizeForCloud(payload), eventId: item.id,
        })
      } catch (error) {
        // Recover UPDATE-only events left by older queue coalescing code.
        if (effectiveOp !== 'UPDATE' || !(error instanceof Error) || !error.message.includes('Sync target is missing')
          || !/^[a-z][a-z0-9_]*$/.test(item.table_name)) throw error
        const full = db.prepare(`SELECT * FROM ${item.table_name} WHERE id=?`).get(item.record_id) as Record<string, unknown> | undefined
        if (!full) throw error
        await cloud.push({ table: item.table_name, operation: 'INSERT', recordId: item.record_id, eventId: item.id,
          record: normalizeForCloud({ ...full, ...payload }) })
      }

      if (item.table_name === 'stocks' && item.operation !== 'DELETE') {
        const baseline = { quantity: Number(payload.quantity), damaged_qty: Number(payload.damaged_qty ?? 0) }
        db.prepare('INSERT OR REPLACE INTO sync_stock_baselines (record_id,quantity,damaged_qty) VALUES (?,?,?)')
          .run(item.record_id, baseline.quantity, baseline.damaged_qty)
        const newer = db.prepare("SELECT id,payload FROM sync_queue WHERE table_name='stocks' AND record_id=? AND status='pending'")
          .all(item.record_id) as { id: string; payload: string }[]
        for (const event of newer) db.prepare('UPDATE sync_queue SET payload=? WHERE id=?')
          .run(JSON.stringify({ ...JSON.parse(event.payload), _base_stock: baseline }), event.id)
      }

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
    let failure: unknown
    try { await this.pullTables(cloud, ['branches', 'warehouses', 'roles', 'users', 'categories', 'suppliers', 'products', 'stocks', 'customers', 'agents', 'positions', 'regions', 'zones', 'invoices', 'invoice_items', 'payments', 'installment_plans', 'installments', 'installment_payments', 'returns', 'return_items', 'chit_scheme_templates', 'chit_schemes', 'chit_members', 'chit_draws', 'chit_contributions', 'chit_scheme_branches', 'withdrawal_requests', 'stock_transfers', 'stock_movements', 'deliveries', 'purchase_orders', 'purchase_items', 'installment_schedule', 'installment_reminders', 'customer_orders', 'customer_order_items', 'branch_transfers', 'branch_transfer_items', 'branch_transfer_mismatches', 'branch_transfer_logs', 'branch_transfer_prints', 'coupons', 'coupon_redemptions', 'expense_categories', 'expenses', 'cash_sessions', 'loyalty_config', 'loyalty_transactions', 'product_uom', 'product_batches', 'audit_logs', 'edit_requests', 'credit_ledger', 'stock_count_sessions', 'stock_count_items', 'discounts', 'agent_remittances', 'smartbuy_wallet', 'smartbuy_wallet_transactions', 'smartbuy_transfer_history', 'commission_rules', 'commission_ledger', 'commission_payouts', 'commission_approval_logs', 'commission_statement_history', 'commission_rule_history', 'chit_payment_reminders', 'held_carts', 'data_clear_events']) } catch (error) { failure = error }
    try { await this.pullTables(cloud, ['supplier_payments']) } catch (error) { failure = failure || error }
    try { await this.pullDeletions(cloud, getDb()) } catch (error) { failure = failure || error }
    if (failure) throw failure
  }

  private async pullTables(cloud: CloudApi, tables: string[]): Promise<void> {
    const db = getDb()
    // Derive parent-first order from the actual migrated SQLite schema.
    const remainingTables = new Set(tables)
    const orderedTables: string[] = []
    while (remainingTables.size) {
      const ready = [...remainingTables].filter(table =>
        (db.prepare(`PRAGMA foreign_key_list(${table})`).all() as { table: string }[])
          .every(fk => fk.table === table || !remainingTables.has(fk.table)))
      if (!ready.length) { orderedTables.push(...remainingTables); break }
      for (const table of ready) { orderedTables.push(table); remainingTables.delete(table) }
    }
    // v2 intentionally starts at epoch: the old global cursor skipped failed rows.
    const cursors = (store.get('sync_table_cursors_v2') || {}) as Record<string, string>
    const errors = { ...((store.get('sync_pull_errors') || {}) as Record<string, string>) }
    const failures: string[] = []
    let batch: Awaited<ReturnType<CloudApi['batchChanges']>> | undefined
    try {
      batch = await cloud.batchChanges(orderedTables.map(table => ({
        table, since: cursors[table] || '1970-01-01T00:00:00.000Z',
      })))
    } catch {
      // Rolling-deploy compatibility: an updated desktop may briefly reach an
      // older backend. Fall back to the existing per-table endpoint.
    }
    for (const table of orderedTables) {
      const since = cursors[table] || '1970-01-01T00:00:00.000Z'
      try {
        const batched = batch?.[table]
        if (batched?.error) throw new Error(batched.error)
        let rows = batched?.data ?? await cloud.changes(table, since)
        // Preserve the existing complete pagination path for unusually large
        // tables instead of accepting a truncated batch page.
        if (batched?.truncated) rows = await cloud.changes(table, since)
        if (table === 'data_clear_events' && rows.length) {
          rows = [rows.reduce((latest, row) => String(row.cleared_at) > String(latest.cleared_at) ? row : latest)]
        }
        const stockBalances = new Map<string, string>()
        const stockConflicts = new Set<string>()
        if (table === 'stocks') for (const row of rows) {
          const key = JSON.stringify([row.product_id, row.branch_id, row.warehouse_id ?? null])
          const balance = JSON.stringify([Number(row.quantity), Number(row.damaged_qty ?? 0)])
          if (stockBalances.has(key) && stockBalances.get(key) !== balance) stockConflicts.add(key)
          stockBalances.set(key, balance)
        }
        const pending = new Set((db.prepare(`SELECT record_id FROM sync_queue
          WHERE table_name=? AND status IN ('pending','processing','failed')`).all(table) as
          { record_id: string }[]).map(r => r.record_id))
        let blocked = 0
        let latest = Date.parse(since)
        const rowErrors = new Set<string>()
        // Retry once after inserting the other parents in a self-referencing table.
        let remaining = rows
        for (let pass = 0; pass < 2; pass++) {
          const retry: Record<string, unknown>[] = []
          for (const row of remaining) {
            if (pending.has(String(row.id))) {
              if (pass === 0) blocked++
              continue
            }
            try {
              if (table === 'stocks') {
                const key = JSON.stringify([row.product_id, row.branch_id, row.warehouse_id ?? null])
                if (stockConflicts.has(key)) throw new Error('Conflicting duplicate stock balances need reconciliation')
                const local = db.prepare('SELECT id FROM stocks WHERE product_id=? AND branch_id=? AND warehouse_id IS ?')
                  .get(row.product_id, row.branch_id, row.warehouse_id ?? null) as { id: string } | undefined
                if (local && pending.has(local.id)) throw new Error('Local stock upload pending')
              }
              if (table === 'data_clear_events') {
                if (String(row.id) !== store.get('last_acknowledged_clear_event_id')) {
                  store.set('pending_clear_event_id', String(row.id))
                }
              }
              if (table === 'products' && [0, false, '0'].includes(row.is_active as never)) {
                const product = db.prepare('SELECT name, sku, is_active FROM products WHERE id=?').get(row.id) as
                  { name: string; sku: string; is_active: number } | undefined
                if (product?.is_active === 1) {
                  db.prepare(`INSERT INTO pending_sync_deletions
                    (id,table_name,record_id,action,record_name,record_sku,deleted_at,status)
                    VALUES (?,'products',?,'deactivate',?,?,?,'pending')
                    ON CONFLICT(id) DO UPDATE SET deleted_at=excluded.deleted_at`).run(
                    `deact_${row.id}`, String(row.id), product.name, product.sku, String(row.updated_at))
                  continue
                }
              }
              this.insertFiltered(db, table, row)
              if (table === 'stocks') {
                const local = db.prepare('SELECT id FROM stocks WHERE product_id=? AND branch_id=? AND warehouse_id IS ?')
                  .get(row.product_id, row.branch_id, row.warehouse_id ?? null) as { id: string }
                db.prepare('INSERT OR REPLACE INTO sync_stock_baselines (record_id,quantity,damaged_qty) VALUES (?,?,?)')
                  .run(local.id, Number(row.quantity), Number(row.damaged_qty ?? 0))
              }
            } catch (error) {
              retry.push(row)
              if (pass === 1) rowErrors.add(error instanceof Error ? error.message : String(error))
            }
          }
          remaining = retry
          if (!retry.length) break
        }
        blocked += remaining.length
        if (blocked) throw new Error(`${blocked} record(s) awaiting upload or repair${rowErrors.size ? ': ' + [...rowErrors].join('; ') : ''}`)
        for (const row of rows) {
          const timestamp = Date.parse(String(row.updated_at))
          if (!Number.isFinite(timestamp)) throw new Error('Cloud row missing a valid updated_at')
          latest = Math.max(latest, timestamp)
        }
        // Overlap the boundary second. Never use the device clock as a cloud cursor.
        if (rows.length) cursors[table] = new Date(Math.max(Date.parse(since), latest - 1000)).toISOString()
        else if (batched?.checkpoint) cursors[table] = new Date(batched.checkpoint).toISOString()
        store.set('sync_table_cursors_v2', cursors)
        delete errors[table]
      } catch (error) {
        errors[table] = error instanceof Error ? error.message : String(error)
        failures.push(table)
        if (error instanceof CloudRateLimitError || error instanceof DeviceRevokedError) {
          store.set('sync_pull_errors', errors)
          throw error
        }
      }
      store.set('sync_pull_errors', errors)
    }
    if (failures.length) throw new Error(`Cloud sync incomplete: ${failures.join(', ')}`)
  }

  // Applies deletion tombstones (see backend/app/api/sync/deletions/route.ts)
  // — the changes-based pull above can only ever see rows that still exist,
  // so a hard-deleted row (e.g. a deleted branch) simply isn't in a
  // `WHERE updated_at > since` result set anymore and would otherwise linger
  // forever on any device that already had it. Tracks its OWN cursor
  // (`last_deletion_pull_timestamp`), separate from `last_pull_timestamp`.
  //
  // Issue 36: this used to `break` the whole loop on the first row that
  // failed to delete (e.g. FOREIGN KEY constraint failed — this app runs
  // SQLite with foreign_keys=ON, so a branch that still has a local `stocks`
  // row, a chit redemption, a discount, etc. referencing a product being
  // deleted will hit exactly this). That `break` meant ONE conflicted row
  // permanently froze `last_deletion_pull_timestamp`, and since the cursor
  // never advanced, every future cycle re-fetched the exact same batch and
  // hit the exact same conflict again — forever, blocking every OTHER
  // table's deletions too, surviving even an app restart (the bootstrap-pull
  // reset only clears `last_pull_timestamp`, never this cursor). Reproduced
  // live against real production tombstone data during Issue 36's
  // investigation: a single conflicting row blocked all 447 pending
  // deletions in the same batch, indefinitely.
  //
  // Fix: attempt every entry every cycle (never let one failure block the
  // rest), and only advance the cursor up to — never past — the first entry
  // that's still failing, in chronological order. Already-applied entries
  // being re-sent on a later cycle (because the cursor can't move past an
  // earlier unresolved failure) is a harmless no-op — DELETE on an
  // already-gone row affects 0 rows. Once whatever locally referenced the
  // blocked row is itself cleared, that entry succeeds on some later cycle
  // and the cursor becomes free to advance again — self-healing, no manual
  // intervention or extra state needed.
  private async pullDeletions(cloud: CloudApi, db: ReturnType<typeof getDb>): Promise<void> {
    const lastPull = store.get('last_deletion_pull_timestamp') as string || '1970-01-01T00:00:00.000Z'
    let deletions: Array<{ table_name: string; record_id: string; deleted_at: string }> = []
    try {
      deletions = await cloud.deletions(lastPull)
    } catch (err) {
      if (err instanceof CloudRateLimitError) throw err
      throw err
    }
    if (deletions.length === 0) return

    // Defense in depth: table_name in this response can only ever be one of
    // ALLOWED_TABLES (assertTable() gates every write to sync_deletions on
    // the server), but this is a raw-identifier DELETE, so re-validate the
    // shape locally before ever interpolating it into SQL.
    const SAFE_TABLE_NAME = /^[a-z][a-z0-9_]*$/

    let advanceTo = lastPull
    let sawFailure = false
    for (const d of deletions) {
      if (!SAFE_TABLE_NAME.test(d.table_name) || !d.record_id) {
        console.error('[SyncService] Skipping malformed deletion entry:', d)
        continue
      }
      try {
        if (d.table_name === 'products') {
          // Requirement 5, 7: DO NOT silently delete local products!
          const existingProduct = db.prepare(`SELECT id, name, sku FROM products WHERE id = ?`).get(d.record_id) as
            { id: string; name: string; sku: string } | undefined

          if (existingProduct) {
            const pendingId = `del_${d.record_id}`
            db.prepare(`
              INSERT INTO pending_sync_deletions
                (id, table_name, record_id, action, record_name, record_sku, detected_at, deleted_at, status)
              VALUES
                (?, 'products', ?, 'delete', ?, ?, datetime('now'), ?, 'pending')
              ON CONFLICT(id) DO UPDATE SET
                status=CASE WHEN excluded.deleted_at > pending_sync_deletions.deleted_at THEN 'pending' ELSE pending_sync_deletions.status END,
                deleted_at=MAX(pending_sync_deletions.deleted_at,excluded.deleted_at)
            `).run(pendingId, d.record_id, existingProduct.name, existingProduct.sku, d.deleted_at)

            notifyPendingDeletions({
              id: pendingId,
              tableName: 'products',
              recordId: d.record_id,
              action: 'delete',
              productName: existingProduct.name,
              productSku: existingProduct.sku,
            })

            // Do not silently delete local product! Stage it into pending deletions.
            if (!sawFailure) advanceTo = d.deleted_at
            continue
          }
        }

        db.prepare(`DELETE FROM ${d.table_name} WHERE id = ?`).run(d.record_id)
        if (!sawFailure) advanceTo = d.deleted_at
      } catch (err) {
        console.error(`[SyncService] Deletion still blocked for ${d.table_name}(${d.record_id}) — see Issue 36; will retry every cycle until it clears:`, err)
        sawFailure = true
      }
    }
    if (sawFailure) throw new Error('Some cloud deletions await local reference repair')
    store.set('last_deletion_pull_timestamp', new Date(Math.max(Date.parse(lastPull), Date.parse(advanceTo) - 1000)).toISOString())
  }

  // Company branding: retry a pending local push first, otherwise pull the
  public async pullLatestBranding(): Promise<void> {
    const cloud = this.getCloudApi()
    if (cloud) {
      await this.syncBranding(cloud)
    }
  }

  // Fetch company-wide branding and apply it to this device's app_settings.
  private async syncBranding(cloud: CloudApi): Promise<void> {
    try {
      if (store.get('branding_push_pending')) {
        const pushed = await pushBrandingToCloud()
        if (!pushed) return // keep local edit; don't let a pull overwrite it
      }

      const { branding } = await cloud.getBranding()
      if (!branding) return
      const incoming = JSON.stringify(branding)

      const settings = (store.get('app_settings') as Record<string, unknown>) || {}
      const needsSmtpSync = branding.smtp && typeof branding.smtp === 'object' && Boolean((branding.smtp as Record<string, unknown>).host) && !settings.smtp_host
      if (!needsSmtpSync && incoming === String(store.get('company_branding_synced') || '')) return

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
      if (branding.smtp && typeof branding.smtp === 'object') {
        const smtp = branding.smtp as Record<string, unknown>
        if (smtp.host) {
          if (settings.email_enabled !== true) { settings.email_enabled = true; changed = true }
          if (settings.smtp_host !== String(smtp.host)) { settings.smtp_host = String(smtp.host); changed = true }
          if (smtp.port && settings.smtp_port !== Number(smtp.port)) { settings.smtp_port = Number(smtp.port); changed = true }
          const enc = Number(smtp.port) === 465 || Boolean(smtp.secure) ? 'SSL' : 'TLS'
          if (settings.smtp_encryption !== enc) { settings.smtp_encryption = enc; changed = true }
          if (smtp.user && settings.smtp_username !== String(smtp.user)) { settings.smtp_username = String(smtp.user); changed = true }
          if (smtp.pass && smtp.pass !== '********' && settings.smtp_password !== String(smtp.pass)) { settings.smtp_password = String(smtp.pass); changed = true }
          if (smtp.from_name && settings.smtp_from_name !== String(smtp.from_name)) { settings.smtp_from_name = String(smtp.from_name); changed = true }
          if (smtp.from_email && settings.smtp_from_email !== String(smtp.from_email)) { settings.smtp_from_email = String(smtp.from_email); changed = true }
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
        // Issue 32a consistency-check safeguard: a role name existing on
        // both sides with a different id is exactly the drift that caused
        // the Issue 31 incident. This doesn't auto-fix it (the reconcile
        // call in runOnce()/activation.ts is what actively fixes the 5
        // known default roles) — it just makes sure any remaining drift is
        // never silent, including for a role name reconciliation doesn't
        // cover (e.g. one that was renamed to collide with another).
        console.warn(
          `[SyncService] Role-ID drift detected: local role "${localRow.name}" has id ${existingByName.id}, ` +
          `but the cloud's same-named role has id ${localRow.id}. Updating local role's other fields in place ` +
          `(name/permissions), but NOT changing its id — existing users keep their current role assignment.`
        )
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
      if (!exists) throw new Error('Category parent has not arrived yet')
    }

    // Stocks: NULL warehouse_id defeats the UNIQUE(product_id,branch_id,warehouse_id)
    // constraint (SQL NULL never equals NULL), so a blind INSERT OR REPLACE by `id`
    // can leave the existing local row untouched and insert a second row for the
    // same product+branch — doubling the quantity everywhere it's summed. Match by
    // the real business key first and update in place instead.
    if (table === 'stocks' && localRow.product_id && localRow.branch_id) {
      const existingByKey = db.prepare(`
        SELECT id FROM stocks WHERE product_id = ? AND branch_id = ? AND warehouse_id IS ?
      `).get(
        String(localRow.product_id),
        String(localRow.branch_id),
        localRow.warehouse_id != null ? String(localRow.warehouse_id) : null
      ) as { id?: string } | undefined
      if (existingByKey?.id) {
        const updateKeys = keys.filter(k => k !== 'id')
        if (updateKeys.length > 0) {
          db.prepare(
            `UPDATE stocks SET ${updateKeys.map(k => `${k}=?`).join(',')} WHERE id=?`
          ).run(...updateKeys.map(k => localRow[k]), existingByKey.id)
        }
        return
      }
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
          // Issue 32a: this used to silently GUESS a replacement role by
          // matching "admin"/"manager" substrings in the email/name,
          // defaulting to Cashier otherwise — this is what silently
          // downgraded a real Company Admin to Cashier during the Issue 31
          // incident (their name/email had no such substring). Never guess
          // a role. Preserve whatever role this user already has locally
          // (if any); only fall back to unassigned if there's truly nothing
          // to preserve — and always log loudly so it surfaces for review
          // instead of silently changing someone's access.
          const existingLocal = db.prepare(`
            SELECT u.role_id FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?
          `).get(String(localRow.id)) as { role_id?: string } | undefined
          console.warn(
            `[SyncService] Pulled user ${localRow.email || localRow.id} references role_id ${roleId}, ` +
            `which does not exist locally (role-ID drift — see Issue 32a). ` +
            (existingLocal?.role_id
              ? `Keeping this user's existing local role_id (${existingLocal.role_id}) instead of guessing.`
              : `No existing local role for this user — leaving role_id unassigned instead of guessing. Needs admin review.`)
          )
          localRow.role_id = existingLocal?.role_id ?? null
        }
      }
      if (localRow.branch_id && !db.prepare('SELECT id FROM branches WHERE id=?').get(String(localRow.branch_id))) {
        throw new Error('User references a missing cloud branch; restore the branch before importing this user')
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
        `INSERT INTO ${table} (${keys.join(',')})
         VALUES (${keys.map(() => '?').join(',')})
         ON CONFLICT(id) DO UPDATE SET ${keys.filter(k => k !== 'id').map(k => `${k}=excluded.${k}`).join(',') || 'id=excluded.id'}`
      ).run(...keys.map(key => localRow[key]))
    } catch (err) {
      // pullTables persists one actionable summary per table instead of
      // flooding logs with the same historical constraint failure each cycle.
      throw err
    }
  }

  private async checkOnline(cloud: CloudApi): Promise<boolean> {
    try {
      const health = await cloud.health()
      return health.status === 'ok' && health.database === 'connected'
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
