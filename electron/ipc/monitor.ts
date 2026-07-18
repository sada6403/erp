import { ipcMain, app } from 'electron'
import { getDb } from '../database'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { safeHandle } from './ipcHandler'

interface TableStat { name: string; count: number }

export function registerMonitorHandlers(): void {
  safeHandle(ipcMain, 'monitor:health', () => {
      const db = getDb()
      const userDataPath = app.getPath('userData')
      const dbPath = path.join(userDataPath, 'pos-erp.db')

      // DB file size
      let dbSize = 0
      try { dbSize = fs.statSync(dbPath).size } catch {}

      // Table row counts
      const tables = ['invoices', 'products', 'customers', 'users', 'sync_queue', 'notifications']
      const tableCounts: TableStat[] = tables.map(name => {
        try {
          const row = db.prepare(`SELECT COUNT(*) as c FROM ${name}`).get() as { c: number }
          return { name, count: row.c }
        } catch {
          return { name, count: 0 }
        }
      })

      // Sync queue stats
      let syncPending = 0
      let syncFailed = 0
      try {
        const sq = db.prepare(`SELECT status, COUNT(*) as c FROM sync_queue GROUP BY status`).all() as { status: string; c: number }[]
        sq.forEach(r => {
          if (r.status === 'pending') syncPending = r.c
          if (r.status === 'failed') syncFailed = r.c
        })
      } catch {}

      // Unread notifications
      let unreadNotifications = 0
      try {
        const n = db.prepare(`SELECT COUNT(*) as c FROM notifications WHERE is_read = 0`).get() as { c: number }
        unreadNotifications = n.c
      } catch {}

      // Memory
      const memUsage = process.memoryUsage()
      const sysMem = { total: os.totalmem(), free: os.freemem() }

      // Uptime
      const appUptimeSeconds = Math.floor(process.uptime())

      // CPU model
      const cpuModel = os.cpus()[0]?.model ?? 'Unknown'
      const cpuCount = os.cpus().length

      // Platform info
      const platform = `${os.platform()} ${os.release()}`

      return {
        success: true,
        data: {
          db: {
            sizeBytes: dbSize,
            sizeMb: (dbSize / 1024 / 1024).toFixed(2),
            path: dbPath,
          },
          tables: tableCounts,
          sync: { pending: syncPending, failed: syncFailed },
          notifications: { unread: unreadNotifications },
          memory: {
            heapUsedMb: (memUsage.heapUsed / 1024 / 1024).toFixed(1),
            heapTotalMb: (memUsage.heapTotal / 1024 / 1024).toFixed(1),
            rssMb: (memUsage.rss / 1024 / 1024).toFixed(1),
            sysTotalMb: (sysMem.total / 1024 / 1024).toFixed(0),
            sysFreeMb: (sysMem.free / 1024 / 1024).toFixed(0),
            sysUsedPct: ((1 - sysMem.free / sysMem.total) * 100).toFixed(1),
          },
          system: {
            platform,
            cpuModel,
            cpuCount,
            appUptimeSeconds,
            nodeVersion: process.version,
          },
        }
      }
  })

  safeHandle(ipcMain, 'monitor:vacuum', () => {
    const db = getDb()
    db.exec('VACUUM')
    return { success: true }
  })

  safeHandle(ipcMain, 'monitor:integrity', () => {
    const db = getDb()
    const result = db.prepare(`PRAGMA integrity_check`).all() as { integrity_check: string }[]
    const passed = result.length === 1 && result[0].integrity_check === 'ok'
    return { success: true, data: { passed, details: result.map(r => r.integrity_check) } }
  })
}
