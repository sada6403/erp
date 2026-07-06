import { contextBridge, ipcRenderer } from 'electron'

// Expose typed IPC bridge to the renderer process
const api = {
  // Auth
  auth: {
    login:   (payload: unknown) => ipcRenderer.invoke('auth:login', payload),
    logout:  ()                 => ipcRenderer.invoke('auth:logout'),
    whoami:  ()                 => ipcRenderer.invoke('auth:whoami'),
    pinLogin:(payload: unknown) => ipcRenderer.invoke('auth:pinLogin', payload),
    loginOptions:(payload: unknown) => ipcRenderer.invoke('auth:loginOptions', payload),
    changePassword:             (payload: unknown) => ipcRenderer.invoke('auth:changePassword', payload),
    completeForcePasswordChange:(payload: unknown) => ipcRenderer.invoke('auth:completeForcePasswordChange', payload),
    forgotPassword:             (email: string)    => ipcRenderer.invoke('auth:forgotPassword', { email }),
    resetWithOtp:               (email: string, otp: string, newPassword: string) => ipcRenderer.invoke('auth:resetWithOtp', { email, otp, newPassword }),
    // 2FA
    twoFa: {
      verifyLogin: (payload: unknown) => ipcRenderer.invoke('auth:2fa:verify', payload),
      setup:       (userId: string)   => ipcRenderer.invoke('auth:2fa:setup', { userId }),
      confirm:     (userId: string, otp: string) => ipcRenderer.invoke('auth:2fa:confirm', { userId, otp }),
      disable:     (userId: string, otp: string) => ipcRenderer.invoke('auth:2fa:disable', { userId, otp }),
      status:      (userId: string)   => ipcRenderer.invoke('auth:2fa:status', { userId }),
    },
  },

  // Products
  products: {
    list:       (filters?: unknown) => ipcRenderer.invoke('products:list', filters),
    get:        (id: string)        => ipcRenderer.invoke('products:get', id),
    search:     (query: string)     => ipcRenderer.invoke('products:search', query),
    searchSku:  (sku: string)       => ipcRenderer.invoke('products:searchSku', sku),
    create:     (payload: unknown)  => ipcRenderer.invoke('products:create', payload),
    update:     (id: string, payload: unknown) => ipcRenderer.invoke('products:update', id, payload),
    delete:     (id: string)        => ipcRenderer.invoke('products:delete', id),
    selectAndUploadImage: ()        => ipcRenderer.invoke('products:selectAndUploadImage'),
    importExcel:          ()        => ipcRenderer.invoke('products:importExcel'),
    exportCsv:            ()        => ipcRenderer.invoke('products:exportCsv'),
    permanentDelete:      (id: string, reason: string) => ipcRenderer.invoke('products:permanentDelete', id, reason),
  },

  // Invoices
  invoices: {
    list:               (filters?: unknown)                       => ipcRenderer.invoke('invoices:list', filters),
    get:                (id: string)                              => ipcRenderer.invoke('invoices:get', id),
    create:             (payload: unknown)                        => ipcRenderer.invoke('invoices:create', payload),
    update:             (id: string, payload: unknown)            => ipcRenderer.invoke('invoices:update', id, payload),
    hold:               (id: string)                              => ipcRenderer.invoke('invoices:hold', id),
    cancel:             (id: string)                              => ipcRenderer.invoke('invoices:cancel', id),
    return:             (id: string, payload: unknown)            => ipcRenderer.invoke('invoices:return', id, payload),
    listHeld:           ()                                        => ipcRenderer.invoke('invoices:listHeld'),
    nextNumber:         (billType?: string)                       => ipcRenderer.invoke('invoices:nextNumber', billType),
    convert:            (id: string)                              => ipcRenderer.invoke('invoices:convert', id),
    approveCreditBill:  (id: string)                              => ipcRenderer.invoke('invoices:approveCreditBill', id),
    addCreditPayment:   (id: string, payload: unknown)            => ipcRenderer.invoke('invoices:addCreditPayment', id, payload),
    pendingApproval:    ()                                        => ipcRenderer.invoke('invoices:pendingApproval'),
    creditSummary:      (customerId: string)                      => ipcRenderer.invoke('invoices:creditSummary', customerId),
  },

  // Customers
  customers: {
    list:   (filters?: unknown) => ipcRenderer.invoke('customers:list', filters),
    get:    (id: string)        => ipcRenderer.invoke('customers:get', id),
    search: (query: string)     => ipcRenderer.invoke('customers:search', query),
    create: (payload: unknown)  => ipcRenderer.invoke('customers:create', payload),
    update: (id: string, payload: unknown) => ipcRenderer.invoke('customers:update', id, payload),
    installments: (id: string)  => ipcRenderer.invoke('customers:installments', id),
    history:      (id: string)  => ipcRenderer.invoke('customers:history', id),
  },

  // Stocks
  stocks: {
    list:         (branchId?: string)  => ipcRenderer.invoke('stocks:list', branchId),
    get:          (productId: string)  => ipcRenderer.invoke('stocks:get', productId),
    transfer:     (payload: unknown)   => ipcRenderer.invoke('stocks:transfer', payload),
    listTransfers:(filters?: unknown)  => ipcRenderer.invoke('stocks:listTransfers', filters),
    getTransfer:  (id: string)         => ipcRenderer.invoke('stocks:getTransfer', id),
    logTransferPrint:(id: string, payload?: unknown) => ipcRenderer.invoke('stocks:logTransferPrint', id, payload),
    reportMismatch:(id: string, payload?: unknown) => ipcRenderer.invoke('stocks:reportMismatch', id, payload),
    lowStock:     (branchId?: string)  => ipcRenderer.invoke('stocks:lowStock', branchId),
    adjust:       (payload: unknown)   => ipcRenderer.invoke('stocks:adjust', payload),
    movements:    (filters?: unknown)  => ipcRenderer.invoke('stocks:movements', filters),
    availability:  (productId: string)  => ipcRenderer.invoke('stocks:availability', productId),
    updateTransfer:(id: string, status: string, payload?: unknown) => ipcRenderer.invoke('stocks:updateTransfer', id, status, payload),
    transferHistory:(transferId: string) => ipcRenderer.invoke('stocks:transferHistory', transferId),
    trackTransfer:(query: string) => ipcRenderer.invoke('stocks:trackTransfer', query),
    branchSummary: ()                   => ipcRenderer.invoke('stocks:branchSummary'),
    branchDetail:  (branchId: string)   => ipcRenderer.invoke('stocks:branchDetail', branchId),
  },

  // Branch Transfers
  branchTransfers: {
    create:         (payload: unknown) => ipcRenderer.invoke('branchTransfers:create', payload),
    list:           (filters?: unknown) => ipcRenderer.invoke('branchTransfers:list', filters),
    getById:        (id: string) => ipcRenderer.invoke('branchTransfers:getById', id),
    updateStatus:   (id: string, status: string, payload?: unknown) => ipcRenderer.invoke('branchTransfers:updateStatus', id, status, payload),
    receive:        (id: string, payload: unknown) => ipcRenderer.invoke('branchTransfers:receive', id, payload),
    reportMismatch: (id: string, payload: unknown) => ipcRenderer.invoke('branchTransfers:reportMismatch', id, payload),
    resolveMismatch: (id: string, payload: unknown) => ipcRenderer.invoke('branchTransfers:resolveMismatch', id, payload),
    logPrint:       (id: string) => ipcRenderer.invoke('branchTransfers:logPrint', id),
  },

  stockCounts: {
    list:       () => ipcRenderer.invoke('stockCounts:list'),
    create:     (payload: unknown) => ipcRenderer.invoke('stockCounts:create', payload),
    get:        (id: string) => ipcRenderer.invoke('stockCounts:get', id),
    updateItem: (sessionId: string, itemId: string, countedQty: number) => ipcRenderer.invoke('stockCounts:updateItem', sessionId, itemId, countedQty),
    finalize:   (id: string) => ipcRenderer.invoke('stockCounts:finalize', id),
    cancel:     (id: string) => ipcRenderer.invoke('stockCounts:cancel', id),
    exportCsv:  (sessionId: string) => ipcRenderer.invoke('stockCounts:exportCsv', sessionId),
    importCsv:  (sessionId: string) => ipcRenderer.invoke('stockCounts:importCsv', sessionId),
  },

  orders: {
    list:         (filters?: unknown) => ipcRenderer.invoke('orders:list', filters),
    get:          (id: string) => ipcRenderer.invoke('orders:get', id),
    create:       (payload: unknown) => ipcRenderer.invoke('orders:create', payload),
    updateStatus: (id: string, status: string, payload?: unknown) => ipcRenderer.invoke('orders:updateStatus', id, status, payload),
  },

  // Analytics
  analytics: {
    salesSummary:      (filters: unknown) => ipcRenderer.invoke('analytics:salesSummary', filters),
    topProducts:       (filters: unknown) => ipcRenderer.invoke('analytics:topProducts', filters),
    branchPerformance: (filters: unknown) => ipcRenderer.invoke('analytics:branchPerformance', filters),
    revenue:           (filters: unknown) => ipcRenderer.invoke('analytics:revenue', filters),
    dailyReport:       (date: string)     => ipcRenderer.invoke('analytics:dailyReport', date),
  },

  // Admin
  admin: {
    branches:    { list: () => ipcRenderer.invoke('admin:branches:list'), findByCode: (code: string) => ipcRenderer.invoke('admin:branches:findByCode', code), create: (p: unknown) => ipcRenderer.invoke('admin:branches:create', p), update: (id: string, p: unknown) => ipcRenderer.invoke('admin:branches:update', id, p), delete: (id: string) => ipcRenderer.invoke('admin:branches:delete', id) },
    users:       { list: () => ipcRenderer.invoke('admin:users:list'), create: (p: unknown) => ipcRenderer.invoke('admin:users:create', p), update: (id: string, p: unknown) => ipcRenderer.invoke('admin:users:update', id, p), delete: (id: string) => ipcRenderer.invoke('admin:users:delete', id), hardDelete: (id: string) => ipcRenderer.invoke('admin:users:hardDelete', id), toggleActive: (id: string, active: boolean) => ipcRenderer.invoke('admin:users:toggleActive', id, active), resetPassword: (id: string, newPassword: string) => ipcRenderer.invoke('admin:users:resetPassword', id, newPassword), forcePasswordChange: (id: string, force: boolean) => ipcRenderer.invoke('admin:users:forcePasswordChange', id, force) },
    roles:       { list: () => ipcRenderer.invoke('admin:roles:list'), create: (p: unknown) => ipcRenderer.invoke('admin:roles:create', p), update: (id: string, p: unknown) => ipcRenderer.invoke('admin:roles:update', id, p), delete: (id: string) => ipcRenderer.invoke('admin:roles:delete', id) },
    suppliers:   { list: () => ipcRenderer.invoke('admin:suppliers:list'), create: (p: unknown) => ipcRenderer.invoke('admin:suppliers:create', p), update: (id: string, p: unknown) => ipcRenderer.invoke('admin:suppliers:update', id, p) },
    categories:  { list: () => ipcRenderer.invoke('admin:categories:list'), create: (p: unknown) => ipcRenderer.invoke('admin:categories:create', p), update: (id: string, p: unknown) => ipcRenderer.invoke('admin:categories:update', id, p), delete: (id: string) => ipcRenderer.invoke('admin:categories:delete', id) },
    auditLogs:   { list: (filters?: unknown) => ipcRenderer.invoke('admin:auditLogs:list', filters) },
    deliveries:  { list: (filters?: unknown) => ipcRenderer.invoke('admin:deliveries:list', filters), update: (id: string, p: unknown) => ipcRenderer.invoke('admin:deliveries:update', id, p) },
    installments:{
      list:             (filters?: unknown)                            => ipcRenderer.invoke('admin:installments:list', filters),
      get:              (id: string)                                   => ipcRenderer.invoke('admin:installments:get', id),
      plans:            ()                                             => ipcRenderer.invoke('admin:installments:plans'),
      savePlan:         (p: unknown)                                   => ipcRenderer.invoke('admin:installments:savePlan', p),
      calculate:        (p: unknown)                                   => ipcRenderer.invoke('admin:installments:calculate', p),
      createSale:       (p: unknown)                                   => ipcRenderer.invoke('admin:installments:createSale', p),
      recordPayment:    (id: string, p: unknown)                       => ipcRenderer.invoke('admin:installments:recordPayment', id, p),
      verifyPayment:    (id: string, action: string, notes?: string)   => ipcRenderer.invoke('admin:installments:verifyPayment', id, action, notes),
      reports:          (filters?: unknown)                            => ipcRenderer.invoke('admin:installments:reports', filters),
      pendingTransfers: (filters?: unknown)                            => ipcRenderer.invoke('admin:installments:pendingTransfers', filters),
      applyPenalties:   ()                                             => ipcRenderer.invoke('admin:installments:applyPenalties'),
    },
    productUom:  { list: (productId: string) => ipcRenderer.invoke('admin:productUom:list', productId), save: (productId: string, uoms: unknown) => ipcRenderer.invoke('admin:productUom:save', productId, uoms) },
    expenseCategories: { list: () => ipcRenderer.invoke('admin:expenseCategories:list'), create: (p: unknown) => ipcRenderer.invoke('admin:expenseCategories:create', p) },
    expenses:    { list: (filters?: unknown) => ipcRenderer.invoke('admin:expenses:list', filters), create: (p: unknown) => ipcRenderer.invoke('admin:expenses:create', p), update: (id: string, p: unknown) => ipcRenderer.invoke('admin:expenses:update', id, p) },
    clearAllData:      () => ipcRenderer.invoke('admin:clearAllData'),
    forceReset:        () => ipcRenderer.invoke('admin:forceReset'),
    isSetupRequired:   () => ipcRenderer.invoke('admin:isSetupRequired'),
    seedLocalDefaults: () => ipcRenderer.invoke('admin:seedLocalDefaults'),
  },

  // Sync
  sync: {
    status:   () => ipcRenderer.invoke('sync:status'),
    trigger:  () => ipcRenderer.invoke('sync:trigger'),
    queueCount: () => ipcRenderer.invoke('sync:queueCount'),
    queue:    () => ipcRenderer.invoke('sync:queue'),
    diagnose:    () => ipcRenderer.invoke('sync:diagnose'),
    resetFailed:  () => ipcRenderer.invoke('sync:resetFailed'),
    discardItem:  (id: string) => ipcRenderer.invoke('sync:discardItem', id),
    fixInvoices:  () => ipcRenderer.invoke('sync:fixInvoices'),
  },

  // Printer
  printer: {
    printReceipt: (payload: unknown) => ipcRenderer.invoke('printer:printReceipt', payload),
    printInvoice: (payload: unknown) => ipcRenderer.invoke('printer:printInvoice', payload),
    printTransfer:(payload: unknown) => ipcRenderer.invoke('printer:printTransfer', payload),
    emailInvoice: (payload: unknown) => ipcRenderer.invoke('printer:emailInvoice', payload),
    test:         ()                 => ipcRenderer.invoke('printer:test'),
    listDevices:  ()                 => ipcRenderer.invoke('printer:listDevices'),
  },

  // Purchase Orders
  purchases: {
    list:         (filters?: unknown)                               => ipcRenderer.invoke('purchases:list', filters),
    get:          (id: string)                                      => ipcRenderer.invoke('purchases:get', id),
    create:       (payload: unknown)                                => ipcRenderer.invoke('purchases:create', payload),
    update:       (id: string, payload: unknown)                    => ipcRenderer.invoke('purchases:update', id, payload),
    updateStatus: (id: string, status: string, payload?: unknown)   => ipcRenderer.invoke('purchases:updateStatus', id, status, payload),
  },

  // Returns / Refunds
  returns: {
    list:             (filters?: unknown) => ipcRenderer.invoke('returns:list', filters),
    get:              (id: string)        => ipcRenderer.invoke('returns:get', id),
    getInvoiceItems:  (invoiceId: string) => ipcRenderer.invoke('returns:getInvoiceItems', invoiceId),
    create:           (payload: unknown)  => ipcRenderer.invoke('returns:create', payload),
    cancel:           (id: string)        => ipcRenderer.invoke('returns:cancel', id),
  },

  // Cash Register
  cash: {
    getOpen:  (branchId: string)  => ipcRenderer.invoke('cash:getOpen', branchId),
    open:     (payload: unknown)  => ipcRenderer.invoke('cash:open', payload),
    close:    (payload: unknown)  => ipcRenderer.invoke('cash:close', payload),
    history:  (branchId: string)  => ipcRenderer.invoke('cash:history', branchId),
  },

  // Settings
  settings: {
    get:    ()               => ipcRenderer.invoke('settings:get'),
    update: (payload: unknown) => ipcRenderer.invoke('settings:update', payload),
    revealSecret: (key: string) => ipcRenderer.invoke('settings:revealSecret', key),
    s3Test: ()               => ipcRenderer.invoke('settings:s3Test'),
  },

  // Loyalty Points
  loyalty: {
    config: {
      get:  () => ipcRenderer.invoke('loyalty:config:get'),
      save: (cfg: unknown) => ipcRenderer.invoke('loyalty:config:save', cfg),
    },
    getBalance: (customerId: string) => ipcRenderer.invoke('loyalty:getBalance', customerId),
    earn:       (payload: unknown)   => ipcRenderer.invoke('loyalty:earn', payload),
    redeem:     (payload: unknown)   => ipcRenderer.invoke('loyalty:redeem', payload),
    adjust:     (payload: unknown)   => ipcRenderer.invoke('loyalty:adjust', payload),
    history:    (customerId: string) => ipcRenderer.invoke('loyalty:history', customerId),
  },

  // Batch / Serial / Expiry Tracking
  batches: {
    list:     (filters: unknown)             => ipcRenderer.invoke('batches:list', filters),
    get:      (id: string)                   => ipcRenderer.invoke('batches:get', id),
    create:   (payload: unknown)             => ipcRenderer.invoke('batches:create', payload),
    update:   (id: string, payload: unknown) => ipcRenderer.invoke('batches:update', id, payload),
    consume:  (payload: unknown)             => ipcRenderer.invoke('batches:consume', payload),
    expiring: (days?: number)                => ipcRenderer.invoke('batches:expiring', days),
    summary:  (productId: string)            => ipcRenderer.invoke('batches:summary', productId),
  },

  // Communications (Email / SMS / WhatsApp)
  comm: {
    email: {
      test:        (testTo: string) => ipcRenderer.invoke('comm:email:test', testTo),
      sendInvoice: (payload: unknown) => ipcRenderer.invoke('comm:email:sendInvoice', payload),
    },
    sms: {
      test: (testTo: string) => ipcRenderer.invoke('comm:sms:test', testTo),
      send: (payload: unknown) => ipcRenderer.invoke('comm:sms:send', payload),
    },
    whatsapp: {
      test: (testTo: string) => ipcRenderer.invoke('comm:whatsapp:test', testTo),
      send: (payload: unknown) => ipcRenderer.invoke('comm:whatsapp:send', payload),
    },
    sendInstallmentReminder: (installmentId: string) => ipcRenderer.invoke('comm:sendInstallmentReminder', installmentId),
    sendLowStockAlert:       (adminEmail?: string)    => ipcRenderer.invoke('comm:sendLowStockAlert', adminEmail),
  },

  // Reports
  reports: {
    exportExcel:            (payload: unknown)  => ipcRenderer.invoke('reports:exportExcel', payload),
    exportCsvRows:          (payload: unknown)  => ipcRenderer.invoke('reports:exportCsvRows', payload),
    exportPdf:              (payload: unknown)  => ipcRenderer.invoke('reports:exportPdf', payload),
    openFile:               (filePath: string)  => ipcRenderer.invoke('reports:openFile', filePath),
    transactions:           (filters?: unknown) => ipcRenderer.invoke('reports:transactions', filters),
    transactionDetail:      (id: string)        => ipcRenderer.invoke('reports:transactionDetail', id),
    agentCommissions:       (filters?: unknown) => ipcRenderer.invoke('reports:agentCommissions', filters),
    advancedSummary:        (filters?: unknown) => ipcRenderer.invoke('reports:advancedSummary', filters),
    exportTransactionsCsv:  (filters?: unknown) => ipcRenderer.invoke('reports:exportTransactionsCsv', filters),
  },

  // Notifications
  notifications: {
    getAll:         () => ipcRenderer.invoke('notifications:getAll'),
    getUnreadCount: () => ipcRenderer.invoke('notifications:getUnreadCount'),
    markRead:       (id: string) => ipcRenderer.invoke('notifications:markRead', id),
    delete:         (id: string) => ipcRenderer.invoke('notifications:delete', id),
    clearAll:       () => ipcRenderer.invoke('notifications:clearAll'),
    refresh:        () => ipcRenderer.invoke('notifications:refresh'),
  },

  // Device Activation + Fingerprinting
  app: {
    isActivated:        () => ipcRenderer.invoke('app:isActivated'),
    getDeviceInfo:      () => ipcRenderer.invoke('app:getDeviceInfo'),
    getActivationInfo:  () => ipcRenderer.invoke('app:getActivationInfo'),
    getVersion:         () => ipcRenderer.invoke('app:getVersion'),
    verifyCompanyKey:   (payload: unknown) => ipcRenderer.invoke('app:verifyCompanyKey', payload),
    verifySupportPasscode: (passcode: string) => ipcRenderer.invoke('app:verifySupportPasscode', passcode),
    activate:           (payload: unknown) => ipcRenderer.invoke('app:activate', payload),
    deactivate:         () => ipcRenderer.invoke('app:deactivate'),
  },

  // Backup
  backup: {
    run:        ()               => ipcRenderer.invoke('backup:run'),
    list:       ()               => ipcRenderer.invoke('backup:list'),
    delete:     (fp: string)     => ipcRenderer.invoke('backup:delete', fp),
    openFolder: ()               => ipcRenderer.invoke('backup:openFolder'),
    export:     (fp: string)     => ipcRenderer.invoke('backup:export', fp),
    getStats:   ()               => ipcRenderer.invoke('backup:getStats'),
  },

  // System Monitor
  monitor: {
    health:    () => ipcRenderer.invoke('monitor:health'),
    vacuum:    () => ipcRenderer.invoke('monitor:vacuum'),
    integrity: () => ipcRenderer.invoke('monitor:integrity'),
  },

  // License / subscription control
  license: {
    status:  () => ipcRenderer.invoke('license:status'),
    refresh: () => ipcRenderer.invoke('license:refresh'),
  },

  // Auto-updater
  updater: {
    check:    () => ipcRenderer.invoke('update:check'),
    download: () => ipcRenderer.invoke('update:download'),
    install:  () => ipcRenderer.invoke('update:install'),
  },

  // Events from main → renderer
  on: (channel: string, listener: (...args: unknown[]) => void) => {
    ipcRenderer.on(channel, (_event, ...args) => listener(...args))
    return () => ipcRenderer.removeListener(channel, listener)
  },
}

contextBridge.exposeInMainWorld('api', api)

export type API = typeof api
