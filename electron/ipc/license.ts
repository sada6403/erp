import type { IpcMain } from 'electron'
import { getCachedLicense, fetchAndCacheLicense } from '../services/licenseService'
import { safeHandle } from './ipcHandler'

export function registerLicenseHandlers(ipcMain: IpcMain) {
  safeHandle(ipcMain, 'license:status', () => {
    return { success: true, data: getCachedLicense() }
  })

  safeHandle(ipcMain, 'license:refresh', async () => {
    const data = await fetchAndCacheLicense()
    return { success: true, data }
  })
}
