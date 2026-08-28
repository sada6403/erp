import { ipcMain, dialog, shell } from 'electron'
import path from 'path'
import fs from 'fs'
import { app } from 'electron'
import { runBackup, listBackups, getBackupDir } from '../services/backupService'
import { safeHandle } from './ipcHandler'
import Store from 'electron-store'

const store = new Store()

function authUser(): Record<string, unknown> {
  return (store.get('auth_user') as Record<string, unknown> | undefined) || {}
}

function currentPerms(caller: Record<string, unknown> = authUser()): Record<string, unknown> {
  return ((caller.role as Record<string, unknown>)?.permissions as Record<string, unknown>)
    || (caller.permissions as Record<string, unknown>)
    || {}
}

/** Company-Admin-only, matching RequireSuperAdmin on the corresponding route. */
function requireAdmin(): { success: false; error: string } | null {
  return currentPerms().all ? null : { success: false, error: 'Company Admin access required' }
}

/**
 * Resolves a caller-supplied path to a REAL backup, or null.
 *
 * Deliberately an identity allowlist, not a path-prefix test. The previous
 * `filepath.startsWith(backupDir)` compared un-normalised strings while `fs`
 * resolves `..`, so both `<dir>\..\x` and the sibling-prefix `<dir>-evil\x`
 * passed it — giving arbitrary file deletion and exfiltration (A-003).
 * Matching against what listBackups() actually enumerates removes string math
 * from the decision entirely, and additionally defeats a symlink planted inside
 * the directory, which a corrected prefix check would still accept.
 */
function resolveBackupPath(candidate: unknown): string | null {
  if (typeof candidate !== 'string' || !candidate) return null
  const target = path.resolve(candidate)
  const same = process.platform === 'win32'
    ? (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
    : (a: string, b: string) => a === b
  const match = listBackups().find(b => same(path.resolve(b.filepath), target))
  return match ? path.resolve(match.filepath) : null
}

export function registerBackupHandlers(): void {
  safeHandle(ipcMain, 'backup:run', async () => {
    const denied = requireAdmin(); if (denied) return denied
    return await runBackup()
  })

  safeHandle(ipcMain, 'backup:list', () => {
    const denied = requireAdmin(); if (denied) return denied
    return { success: true, data: listBackups() }
  })

  safeHandle(ipcMain, 'backup:delete', (_e, filepath: string) => {
    const denied = requireAdmin(); if (denied) return denied
    const safePath = resolveBackupPath(filepath)
    if (!safePath) return { success: false, error: 'Invalid path' }
    fs.unlinkSync(safePath)
    return { success: true }
  })

  safeHandle(ipcMain, 'backup:openFolder', async () => {
    const denied = requireAdmin(); if (denied) return denied
    const dir = getBackupDir()
    await shell.openPath(dir)
    return { success: true }
  })

  safeHandle(ipcMain, 'backup:export', async (_e, filepath: string) => {
    // Destination is dialog-chosen (safe), but `filepath` (the SOURCE being
    // copied) comes straight from the IPC argument — without this check any
    // renderer-side call could copy an arbitrary local file out through the
    // save dialog (e.g. `backup:export('C:\\Users\\...\\credentials.json')`),
    // same class of bug as backup:delete already guards against.
    const denied = requireAdmin(); if (denied) return denied
    const safePath = resolveBackupPath(filepath)
    if (!safePath) return { success: false, error: 'Invalid path' }
    const result = await dialog.showSaveDialog({
      title: 'Export Backup',
      defaultPath: path.basename(safePath),
      filters: [{ name: 'SQLite Database', extensions: ['db'] }],
    })
    if (result.canceled || !result.filePath) return { success: false, error: 'Cancelled' }
    fs.copyFileSync(safePath, result.filePath)
    return { success: true, path: result.filePath }
  })

  safeHandle(ipcMain, 'backup:getStats', () => {
    const denied = requireAdmin(); if (denied) return denied
    const backups = listBackups()
    const totalSize = backups.reduce((sum, b) => sum + b.size, 0)
    const dir = getBackupDir()
    return {
      success: true,
      data: {
        count: backups.length,
        totalSize,
        latest: backups[0] || null,
        backupDir: dir,
      }
    }
  })
}
