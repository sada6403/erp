import type { IpcMain } from 'electron'
import { getCachedLicense, fetchAndCacheLicense } from '../services/licenseService'

export function registerLicenseHandlers(ipcMain: IpcMain) {
  ipcMain.handle('license:status', () => {
    return { success: true, data: getCachedLicense() }
  })

  ipcMain.handle('license:refresh', async () => {
    const data = await fetchAndCacheLicense()
    return { success: true, data }
  })
}
