const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const path = require('path')
const fs = require('fs')
const root = path.resolve(__dirname, '../..')
const dataDir = fs.mkdtempSync(path.join(__dirname, 'furniture-data-'))
app.setPath('userData', dataDir)
app.commandLine.appendSwitch('remote-debugging-port', '9337')
process.env.SMTP_ENABLED = 'false'
app.whenReady().then(async () => {
  const { initDatabase, getDb } = require(path.join(root, 'dist-electron/database.js'))
  await initDatabase()
  const db = getDb()
  const { createCompanyStore } = require(path.join(root, 'dist-electron/services/companyWorkspace.js'))
  const store = createCompanyStore()
  store.set('app_settings', { business_type: 'furniture', company_name: 'Furniture QA', email_enabled: false, cloud_api_url: '', cloud_api_key: '', theme: 'dark' })
  db.prepare('UPDATE users SET force_password_change=0 WHERE email=?').run('admin@pos.local')
  const modules = ['products', 'admin', 'settings', 'stocks', 'auth', 'sync', 'notifications', 'license']
  const functions = ['registerProductHandlers', 'registerAdminHandlers', 'registerSettingsHandlers', 'registerStockHandlers', 'registerAuthHandlers', 'registerSyncHandlers', 'registerNotificationHandlers', 'registerLicenseHandlers']
  modules.forEach((name, i) => require(path.join(root, `dist-electron/ipc/${name}.js`))[functions[i]](ipcMain))
  const user = db.prepare('SELECT * FROM users WHERE email=?').get('admin@pos.local')
  const roleRow = db.prepare('SELECT * FROM roles WHERE id=?').get(user.role_id)
  const role = { ...roleRow, permissions: JSON.parse(roleRow.permissions) }
  store.set('auth_user', { ...user, password_hash: undefined, role, business_type: 'furniture' })
  store.set('auth_token', require('jsonwebtoken').sign({ id: user.id }, store.get('jwt_secret'), { expiresIn: '1h' }))
  ipcMain.handle('app:isActivated', () => true)
  ipcMain.handle('app:getPendingClearEvent', () => ({ locked: false, eventId: null }))
  ipcMain.handle('app:getDeviceLockStatus', () => ({ locked: false }))
  ipcMain.handle('app:getVersion', () => app.getVersion())
  ipcMain.handle('app:getActivationInfo', () => ({ business_type: 'furniture' }))
  const XLSX = require('xlsx')
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ['Branch', 'Stock Date', 'Item Code', 'Description', 'Qty', 'Sale Price'],
    ['CHAVAKACHERY', '16/09/2026', 'KKBP 018', 'BED', 1, 36900],
    ['CHAVAKACHERY', '16/09/2026', 'PDC 307', 'CHAIR (JW)', 19, 3110],
    ['CHAVAKACHERY', '16/09/2026', 'PDC 307', 'CHAIR (RW)', 15, 3110],
    ['Main Branch', '16/09/2026', 'KKBP 018', 'BED', 2, 36900],
  ]), 'Furniture Stock')
  const fixture = path.join(__dirname, 'furniture-stock-qa.xlsx')
  XLSX.writeFile(book, fixture)
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fixture] })
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: path.join(__dirname, 'downloaded-furniture-template.xlsx') })
  ipcMain.handle('qa:inspect', () => ({
    products: db.prepare('SELECT id, name, sku, selling_price FROM products').all(),
    pending: db.prepare('SELECT branch_name, product_id, quantity, status FROM pending_branch_stocks').all(),
    stock: db.prepare('SELECT p.name, b.name AS branch_name, s.quantity FROM stocks s JOIN products p ON p.id=s.product_id JOIN branches b ON b.id=s.branch_id').all(),
    movements: db.prepare('SELECT product_id, quantity, to_branch_id FROM stock_movements').all(),
    branches: db.prepare('SELECT id, name FROM branches').all(),
  }))
  ipcMain.handle('qa:businessType', (_e, type) => { store.set('app_settings', { ...store.get('app_settings'), business_type: type }); return true })
  const win = new BrowserWindow({ width: 1440, height: 900, show: false, webPreferences: { preload: path.join(__dirname, 'furniture-qa-preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: false } })
  await win.loadFile(path.join(root, 'dist/index.html'), { hash: '/admin/products' })
  fs.writeFileSync(path.join(__dirname, 'qa-runtime.json'), JSON.stringify({ dataDir, fixture }))
  console.log('FURNITURE_QA_READY')
}).catch(error => { console.error(error); app.exit(1) })
app.on('window-all-closed', () => app.quit())
