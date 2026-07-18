import { ipcMain, dialog, shell } from 'electron'
import path from 'path'
import fs from 'fs'
import { app } from 'electron'
import { runBackup, listBackups, getBackupDir } from '../services/backupService'
import { safeHandle } from './ipcHandler'

export function registerBackupHandlers(): void {
  safeHandle(ipcMain, 'backup:run', async () => {
    return await runBackup()
  })

  safeHandle(ipcMain, 'backup:list', () => {
    return { success: true, data: listBackups() }
  })

  safeHandle(ipcMain, 'backup:delete', (_e, filepath: string) => {
    // Safety: must be inside backup dir
    const backupDir = getBackupDir()
    if (!filepath.startsWith(backupDir)) {
      return { success: false, error: 'Invalid path' }
    }
    fs.unlinkSync(filepath)
    return { success: true }
  })

  safeHandle(ipcMain, 'backup:openFolder', async () => {
    const dir = getBackupDir()
    await shell.openPath(dir)
    return { success: true }
  })

  safeHandle(ipcMain, 'backup:export', async (_e, filepath: string) => {
    const result = await dialog.showSaveDialog({
      title: 'Export Backup',
      defaultPath: path.basename(filepath),
      filters: [{ name: 'SQLite Database', extensions: ['db'] }],
    })
    if (result.canceled || !result.filePath) return { success: false, error: 'Cancelled' }
    fs.copyFileSync(filepath, result.filePath)
    return { success: true, path: result.filePath }
  })

  safeHandle(ipcMain, 'backup:getStats', () => {
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
