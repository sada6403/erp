import type { IpcMain } from 'electron'
import { getDb } from '../database'
import crypto from 'crypto'
import { enqueuSync } from '../services/syncQueue'
import { logAudit } from '../services/auditLog'
import Store from 'electron-store'
import { safeHandle } from './ipcHandler'

const store = new Store()

function authUser(): Record<string, unknown> {
  return (store.get('auth_user') as Record<string, unknown> | undefined) || {}
}

function currentPerms(caller: Record<string, unknown> = authUser()): Record<string, unknown> {
  return ((caller.role as Record<string, unknown>)?.permissions as Record<string, unknown>)
    || (caller.permissions as Record<string, unknown>)
    || {}
}

function canManageLocations(perms: Record<string, unknown>): boolean {
  return Boolean(perms.all || perms.employees)
}

// Zones and Regions — supporting master data for Agent Management's Role &
// Location section (spec: Zone is the broader grouping, e.g. "Jaffna";
// Region the narrower one within it, e.g. "Vaddukoddai"). Deliberately
// simple, mirroring `branches`' shape: list/create/update only, no delete —
// deactivate via is_active instead, so an existing agent's region_id never
// dangles.
export function registerRegionHandlers(ipcMain: IpcMain) {
  safeHandle(ipcMain, 'zones:list', (_e, filters: { includeInactive?: boolean } = {}) => {
    const db = getDb()
    const where = filters.includeInactive ? '' : 'WHERE is_active = 1'
    return { success: true, data: db.prepare(`SELECT * FROM zones ${where} ORDER BY name`).all() }
  })

  safeHandle(ipcMain, 'zones:create', async (_e, p: Record<string, unknown>) => {
    const perms = currentPerms()
    if (!canManageLocations(perms)) return { success: false, error: 'Employee management access required' }
    const name = String(p.name || '').trim()
    if (!name) return { success: false, error: 'Zone name is required' }

    const db = getDb()
    const caller = authUser()
    const id = crypto.randomUUID()
    const row = { id, name, code: p.code ? String(p.code).trim() : null, is_active: 1 }
    db.prepare(`INSERT INTO zones (id, name, code, is_active) VALUES (@id, @name, @code, @is_active)`).run(row)
    await enqueuSync('zones', id, 'INSERT', row)
    logAudit(db, { userId: (caller.id as string) || null, action: 'ZONE_CREATED', tableName: 'zones', recordId: id, newValues: { name } })
    return { success: true, data: { id } }
  })

  safeHandle(ipcMain, 'zones:update', async (_e, id: string, p: Record<string, unknown>) => {
    const perms = currentPerms()
    if (!canManageLocations(perms)) return { success: false, error: 'Employee management access required' }

    const db = getDb()
    const caller = authUser()
    const existing = db.prepare('SELECT id FROM zones WHERE id = ?').get(id)
    if (!existing) return { success: false, error: 'Zone not found' }

    const update: Record<string, unknown> = {}
    if (p.name !== undefined) update.name = String(p.name || '').trim()
    if (p.code !== undefined) update.code = p.code ? String(p.code).trim() : null
    if (p.is_active !== undefined) update.is_active = p.is_active ? 1 : 0
    if (update.name === '') return { success: false, error: 'Zone name is required' }

    const fields = Object.keys(update).map(k => `${k} = @${k}`).join(', ')
    if (fields) db.prepare(`UPDATE zones SET ${fields}, updated_at = datetime('now') WHERE id = @id`).run({ ...update, id })
    await enqueuSync('zones', id, 'UPDATE', { id, ...update })
    logAudit(db, { userId: (caller.id as string) || null, action: 'ZONE_UPDATED', tableName: 'zones', recordId: id, newValues: update })
    return { success: true }
  })

  safeHandle(ipcMain, 'regions:list', (_e, filters: { zoneId?: string; includeInactive?: boolean } = {}) => {
    const db = getDb()
    const conditions: string[] = []
    const params: unknown[] = []
    if (!filters.includeInactive) conditions.push('r.is_active = 1')
    if (filters.zoneId) { conditions.push('r.zone_id = ?'); params.push(filters.zoneId) }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    const rows = db.prepare(`
      SELECT r.*, z.name as zone_name
      FROM regions r
      LEFT JOIN zones z ON z.id = r.zone_id
      ${where}
      ORDER BY z.name, r.name
    `).all(...params)
    return { success: true, data: rows }
  })

  safeHandle(ipcMain, 'regions:create', async (_e, p: Record<string, unknown>) => {
    const perms = currentPerms()
    if (!canManageLocations(perms)) return { success: false, error: 'Employee management access required' }
    const name = String(p.name || '').trim()
    if (!name) return { success: false, error: 'Region name is required' }

    const db = getDb()
    const caller = authUser()
    if (p.zone_id) {
      const zone = db.prepare('SELECT id FROM zones WHERE id = ?').get(p.zone_id)
      if (!zone) return { success: false, error: 'Selected zone not found' }
    }
    const id = crypto.randomUUID()
    const row = { id, name, code: p.code ? String(p.code).trim() : null, zone_id: p.zone_id || null, is_active: 1 }
    db.prepare(`INSERT INTO regions (id, name, code, zone_id, is_active) VALUES (@id, @name, @code, @zone_id, @is_active)`).run(row)
    await enqueuSync('regions', id, 'INSERT', row)
    logAudit(db, { userId: (caller.id as string) || null, action: 'REGION_CREATED', tableName: 'regions', recordId: id, newValues: { name } })
    return { success: true, data: { id } }
  })

  safeHandle(ipcMain, 'regions:update', async (_e, id: string, p: Record<string, unknown>) => {
    const perms = currentPerms()
    if (!canManageLocations(perms)) return { success: false, error: 'Employee management access required' }

    const db = getDb()
    const caller = authUser()
    const existing = db.prepare('SELECT id FROM regions WHERE id = ?').get(id)
    if (!existing) return { success: false, error: 'Region not found' }

    const update: Record<string, unknown> = {}
    if (p.name !== undefined) update.name = String(p.name || '').trim()
    if (p.code !== undefined) update.code = p.code ? String(p.code).trim() : null
    if (p.zone_id !== undefined) {
      if (p.zone_id) {
        const zone = db.prepare('SELECT id FROM zones WHERE id = ?').get(p.zone_id)
        if (!zone) return { success: false, error: 'Selected zone not found' }
      }
      update.zone_id = p.zone_id || null
    }
    if (p.is_active !== undefined) update.is_active = p.is_active ? 1 : 0
    if (update.name === '') return { success: false, error: 'Region name is required' }

    const fields = Object.keys(update).map(k => `${k} = @${k}`).join(', ')
    if (fields) db.prepare(`UPDATE regions SET ${fields}, updated_at = datetime('now') WHERE id = @id`).run({ ...update, id })
    await enqueuSync('regions', id, 'UPDATE', { id, ...update })
    logAudit(db, { userId: (caller.id as string) || null, action: 'REGION_UPDATED', tableName: 'regions', recordId: id, newValues: update })
    return { success: true }
  })
}
