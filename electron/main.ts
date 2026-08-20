import { app, BrowserWindow, ipcMain, shell, protocol, net, Menu } from 'electron'
import { autoUpdater } from 'electron-updater'
import path from 'path'
import { pathToFileURL } from 'url'
import { initDatabase } from './database'
import { registerProductHandlers } from './ipc/products'
import { registerInvoiceHandlers } from './ipc/invoices'
import { registerHoldHandlers } from './ipc/holds'
import { registerCustomerHandlers } from './ipc/customers'
import { registerAgentHandlers } from './ipc/agents'
import { registerRegionHandlers } from './ipc/regions'
import { registerStockHandlers } from './ipc/stocks'
import { registerAuthHandlers } from './ipc/auth'
import { registerSyncHandlers } from './ipc/sync'
import { registerPrinterHandlers } from './ipc/printer'
import { registerSettingsHandlers, ensureSettingsDefaults } from './ipc/settings'
import { registerAnalyticsHandlers } from './ipc/analytics'
import { registerAdminHandlers } from './ipc/admin'
import { registerOrderHandlers } from './ipc/orders'
import { registerPurchaseHandlers } from './ipc/purchases'
import { registerReturnHandlers } from './ipc/returns'
import { registerCashRegisterHandlers } from './ipc/cashRegister'
import { registerActivationHandlers } from './ipc/activation'
import { registerNotificationHandlers } from './ipc/notifications'
import { registerReportHandlers } from './ipc/reports'
import { registerCommunicationHandlers, startReminderScheduler } from './ipc/communications'
import { registerLoyaltyHandlers } from './ipc/loyalty'
import { registerCouponHandlers } from './ipc/coupons'
import { registerBatchHandlers } from './ipc/batches'
import { registerDiscountHandlers } from './ipc/discounts'
import { registerBranchTransferHandlers } from './ipc/branchTransfers'
import { registerBackupHandlers } from './ipc/backup'
import { registerMonitorHandlers } from './ipc/monitor'
import { registerLicenseHandlers } from './ipc/license'
import { registerChitHandlers } from './ipc/chits'
import { registerCommissionHandlers } from './ipc/commissions'
import { registerEditRequestHandlers } from './ipc/editRequests'
import { startAutoBackup, stopAutoBackup } from './services/backupService'
import { startLicenseChecks, stopLicenseChecks } from './services/licenseService'
import { type SyncService, getSyncService } from './services/syncService'
import { type ClaimReminderService, getClaimReminderService } from './services/claimReminderService'

const isDev = process.env.NODE_ENV === 'development'
const devPort = process.env.DEV_PORT || '5173'

// Without this, launching the app twice runs two independent SyncService
// loops against the same SQLite file — concurrent writers hit SQLITE_BUSY,
// which sync's per-table try/catch swallows silently, so pulls/pushes for
// whichever table loses the race just vanish with no visible error.
if (!isDev && !app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const existing = BrowserWindow.getAllWindows()[0]
    if (existing) {
      if (existing.isMinimized()) existing.restore()
      existing.focus()
    }
  })

  // Fix blank screen on some Windows GPUs
  app.disableHardwareAcceleration()
if (process.platform === 'win32') {
  app.setAppUserModelId('com.enterprise.pos-erp')
}

// Register custom protocol scheme before app is ready
protocol.registerSchemesAsPrivileged([
  { scheme: 'app-img', privileges: { bypassCSP: true, stream: true, secure: true, supportFetchAPI: true } }
])

let mainWindow: BrowserWindow | null = null
let syncService: SyncService | null = null
let claimReminderService: ClaimReminderService | null = null

function getWindowIconPath() {
  const fs = require('fs') as typeof import('fs')
  const candidates = [
    app.isPackaged ? path.join(process.resourcesPath, 'assets', 'icon.ico') : '',
    path.join(__dirname, '../assets/icon.ico'),
    path.join(__dirname, '../assets/icon.png'),
  ].filter(Boolean)

  return candidates.find((candidate) => fs.existsSync(candidate))
}

function createWindow() {
  // No File/Edit/View/Window/Help bar — Electron's default menu ships a
  // "Reload"/"Force Reload" item (and Ctrl+R/Ctrl+Shift+R accelerators)
  // that fully reloads the renderer on a stray click, wiping whatever the
  // cashier/manager was doing. Not appropriate for a POS terminal anyway.
  Menu.setApplicationMenu(null)

  const iconPath = getWindowIconPath()
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1280,
    minHeight: 768,
    backgroundColor: '#0f172a',
    show: false,
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true
    }
  })

  if (isDev) {
    mainWindow.loadURL(`http://localhost:${devPort}`)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    console.log(`[RENDERER][${level}] ${message} (${sourceId}:${line})`)
  })

  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error(`[RENDERER] Failed to load: ${url} — ${code} ${desc}`)
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
    mainWindow?.focus()
    if (isDev) mainWindow?.webContents.openDevTools()
  })

  // Fallback: force show after 10s if ready-to-show never fires
  setTimeout(() => { if (mainWindow && !mainWindow.isVisible()) mainWindow.show() }, 10000)

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // window.open('', ...) (e.g. a print-preview popup) resolves to 'about:blank' —
    // handing that to the OS shell has no registered handler and pops an unwanted
    // "Get an app to open this link" dialog. Only hand off real http(s) links.
    if (/^https?:\/\//i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.on('closed', () => { mainWindow = null })
}

async function bootstrap() {
  await app.whenReady()

  // Register custom protocol handler for offline image loading.
  // SECURITY: urlPath comes from a product's stored image_url (renderer
  // src/lib/imageUrl.ts builds `app-img://<value>` from it) — that column is
  // reachable via CSV/Excel import and cloud sync, not just the built-in
  // upload picker, so it must be treated as untrusted input. Without the
  // containment check below, a value like `../../../../Windows/System32/...`
  // or an encoded equivalent resolves outside the uploads directory and lets
  // the app read (and serve back into the renderer) an arbitrary file on
  // disk — e.g. the app's own SQLite DB or OS files. Resolving the final
  // path and verifying it's still inside uploadsDir closes that off; any
  // request that would escape is rejected with 403 instead of served.
  const uploadsDir = path.join(app.getPath('userData'), 'uploads')
  protocol.handle('app-img', (request) => {
    const urlPath = decodeURIComponent(request.url.replace('app-img://', ''))
    const filePath = path.resolve(uploadsDir, urlPath)
    if (filePath !== uploadsDir && !filePath.startsWith(uploadsDir + path.sep)) {
      return new Response('Forbidden', { status: 403 })
    }
    return net.fetch(pathToFileURL(filePath).toString())
  })

  await initDatabase()
  ensureSettingsDefaults()

  // Register all IPC handlers
  registerAuthHandlers(ipcMain)
  registerProductHandlers(ipcMain)
  registerInvoiceHandlers(ipcMain)
  registerHoldHandlers(ipcMain)
  registerCustomerHandlers(ipcMain)
  registerAgentHandlers(ipcMain)
  registerRegionHandlers(ipcMain)
  registerStockHandlers(ipcMain)
  registerSyncHandlers(ipcMain)
  registerPrinterHandlers(ipcMain)
  registerSettingsHandlers(ipcMain)
  registerAnalyticsHandlers(ipcMain)
  registerAdminHandlers(ipcMain)
  registerOrderHandlers(ipcMain)
  registerPurchaseHandlers(ipcMain)
  registerReturnHandlers()
  registerCashRegisterHandlers()
  registerActivationHandlers()
  registerNotificationHandlers()
  registerReportHandlers()
  registerCommunicationHandlers()
  startReminderScheduler()
  registerLoyaltyHandlers()
  registerCouponHandlers()
  registerBatchHandlers()
  registerDiscountHandlers()
  registerBranchTransferHandlers(ipcMain)
  registerBackupHandlers()
  registerMonitorHandlers()
  registerLicenseHandlers(ipcMain)
  registerChitHandlers(ipcMain)
  registerCommissionHandlers(ipcMain)
  registerEditRequestHandlers(ipcMain)
  startAutoBackup()
  startLicenseChecks()

  ipcMain.handle('app:getVersion', () => app.getVersion())
  ipcMain.handle('update:check',    () => isDev ? null : autoUpdater.checkForUpdates())
  ipcMain.handle('update:download', () => isDev ? null : autoUpdater.downloadUpdate())
  ipcMain.handle('update:install',  () => { if (!isDev) autoUpdater.quitAndInstall(false, true) })

  createWindow()

  // Auto-updater (production only)
  if (!isDev) {
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = true

    autoUpdater.on('update-available', (info) => {
      mainWindow?.webContents.send('update:available', info)
    })
    autoUpdater.on('download-progress', (progress) => {
      mainWindow?.webContents.send('update:progress', progress)
    })
    autoUpdater.on('update-downloaded', (info) => {
      mainWindow?.webContents.send('update:downloaded', info)
    })
    autoUpdater.on('error', (err) => {
      mainWindow?.webContents.send('update:error', err.message)
    })

    // Check after 8s so the app fully loads first
    setTimeout(() => { autoUpdater.checkForUpdates().catch(() => {}) }, 8000)
  }
  // (dev no-op update handlers not needed — the update:* handlers above
  // already return null in dev; registering twice crashes on startup)

  // Start background sync service
  syncService = getSyncService()
  syncService.start()

  // SmartBuy claim reminder — local-only, independent of cloud sync.
  claimReminderService = getClaimReminderService()
  claimReminderService.start()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}

bootstrap().catch((err) => {
  console.error('[FATAL]', err)
  const { dialog } = require('electron')
  try { dialog.showErrorBox('Startup Error', String(err?.message || err)) } catch {}
  app.quit()
})

app.on('window-all-closed', () => {
  syncService?.stop()
  claimReminderService?.stop()
  stopAutoBackup()
  stopLicenseChecks()
  if (process.platform !== 'darwin') app.quit()
})
}
