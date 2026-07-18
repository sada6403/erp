import type { IpcMain } from 'electron'
import { getDb } from '../database'
import Store from 'electron-store'
import { CloudApi } from '../services/cloudApi'
import { decryptSecret } from './settings'
import { safeHandle } from './ipcHandler'

const store = new Store()

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    )
  ])
}

export function registerSyncHandlers(ipcMain: IpcMain) {
  safeHandle(ipcMain, 'sync:status', () => {
    {
      const db = getDb()
      const pending = (db.prepare("SELECT COUNT(*) as c FROM sync_queue WHERE status IN ('pending','processing')").get() as { c: number }).c
      const failed = (db.prepare("SELECT COUNT(*) as c FROM sync_queue WHERE status='failed'").get() as { c: number }).c
      const last = db.prepare("SELECT synced_at FROM sync_queue WHERE status='synced' ORDER BY synced_at DESC LIMIT 1").get() as { synced_at: string } | undefined
      return { success: true, data: { pending, failed, last_sync: last?.synced_at } }
    }
  })

  safeHandle(ipcMain, 'sync:queueCount', () => {
    {
      const db = getDb()
      const row = db.prepare("SELECT COUNT(*) as c FROM sync_queue WHERE status IN ('pending','processing')").get() as { c: number }
      return { success: true, data: row.c }
    }
  })

  safeHandle(ipcMain, 'sync:trigger', async () => {
    {
      const { getSyncService } = await import('../services/syncService')
      const service = getSyncService()
      await service.runOnce()
      return { success: true }
    }
  })

  safeHandle(ipcMain, 'sync:resetFailed', () => {
    {
      const db = getDb()
      const result = db.prepare(`
        UPDATE sync_queue SET status='pending', attempts=0, last_error=NULL
        WHERE status IN ('failed','processing')
      `).run()
      return { success: true, data: result.changes }
    }
  })

  safeHandle(ipcMain, 'sync:diagnose', async () => {
    const steps: { step: string; ok: boolean; detail: string }[] = []
    const settings = store.get('app_settings') as Record<string, unknown> | undefined
    const url = String(settings?.cloud_api_url || '').trim()
    const key = decryptSecret(settings?.cloud_api_key).trim()

    steps.push({
      step: 'Cloud API Config',
      ok: Boolean(url && key),
      detail: url ? `URL: ${url.slice(0, 60)}` : 'Cloud API URL is not configured',
    })

    let networkOk = false
    let networkDetail = ''
    try {
      if (!url || !key) throw new Error('Cloud API URL/key is missing')
      const health = await withTimeout(
        new CloudApi({ baseUrl: url, apiKey: key }).health(),
        5000,
        'Cloud API'
      )
      networkOk = health.status === 'ok' && health.database === 'connected'
      networkDetail = `API: ${health.status}, database: ${health.database}`
    } catch (error) {
      networkDetail = (error as Error).message
    }
    steps.push({ step: 'Next.js API + PostgreSQL', ok: networkOk, detail: networkDetail })

    let queryOk = false
    let queryDetail = ''
    try {
      if (!url || !key) throw new Error('Cloud API URL/key is missing')
      const db = getDb()
      const activeQueue = (db.prepare("SELECT COUNT(*) as c FROM sync_queue WHERE status IN ('pending','processing')").get() as { c: number }).c
      if (activeQueue > 0) {
        queryOk = true
        queryDetail = `Skipped while ${activeQueue} item(s) are syncing`
      } else {
        const data = await withTimeout(
          new CloudApi({ baseUrl: url, apiKey: key }).changes(
            'categories',
            '1970-01-01T00:00:00.000Z'
          ),
          5000,
          'Cloud query'
        )
        queryOk = true
        queryDetail = `OK (${data.length} rows)`
      }
    } catch (error) {
      queryDetail = (error as Error).message
    }
    steps.push({ step: 'Cloud Query (categories)', ok: queryOk, detail: queryDetail })

    let sqliteOk = false
    let sqliteDetail = ''
    try {
      const db = getDb()
      const pending = (db.prepare("SELECT COUNT(*) as c FROM sync_queue WHERE status IN ('pending','processing')").get() as { c: number }).c
      sqliteOk = true
      sqliteDetail = `${pending} pending item(s) in queue`
    } catch (error) {
      sqliteDetail = (error as Error).message
    }
    steps.push({ step: 'SQLite Queue', ok: sqliteOk, detail: sqliteDetail })
    return { success: true, data: steps }
  })

  safeHandle(ipcMain, 'sync:fixInvoices', () => {
    {
      const db = getDb()
      const user = store.get('auth_user') as Record<string, unknown> | undefined
      const cashierId = (user?.id as string) || 'u9999999-9999-4999-8999-999999999999'
      const items = db.prepare(`
        SELECT id, payload FROM sync_queue
        WHERE table_name='invoices' AND status IN ('pending','failed')
      `).all() as { id: string; payload: string }[]

      for (const item of items) {
        try {
          const payload = JSON.parse(item.payload) as Record<string, unknown>
          if (!payload.cashier_id) {
            payload.cashier_id = cashierId
            if (!payload.status) payload.status = 'completed'
            db.prepare(`
              UPDATE sync_queue
              SET payload=?, attempts=0, status='pending', last_error=NULL
              WHERE id=?
            `).run(JSON.stringify(payload), item.id)
          }
        } catch {
          // Skip malformed queue records.
        }
      }
      return { success: true, data: items.length }
    }
  })

  safeHandle(ipcMain, 'sync:discardItem', (_event, id: string) => {
    {
      getDb().prepare('DELETE FROM sync_queue WHERE id = ?').run(id)
      return { success: true }
    }
  })

  safeHandle(ipcMain, 'sync:queue', () => {
    {
      const rows = getDb().prepare(`
        SELECT id, table_name, operation, status, attempts, last_error, created_at, synced_at
        FROM sync_queue
        WHERE status IN ('pending','failed','processing')
        ORDER BY created_at DESC
        LIMIT 100
      `).all()
      return { success: true, data: rows }
    }
  })
}
