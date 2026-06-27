import { contextBridge, ipcRenderer } from 'electron'

// Expose typed IPC bridge to the renderer process
const api = {
  // Auth
  auth: {
    login:   (payload: unknown) => ipcRenderer.invoke('auth:login', payload),
    logout:  ()                 => ipcRenderer.invoke('auth:logout'),
    whoami:  ()                 => ipcRenderer.invoke('auth:whoami'),
    pinLogin:(payload: unknown) => ipcRenderer.invoke('auth:pinLogin', payload),
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
    lowStock:     (branchId?: string)  => ipcRenderer.invoke('stocks:lowStock', branchId),
    adjust:       (payload: unknown)   => ipcRenderer.invoke('stocks:adjust', payload),
    availability:  (productId: string)  => ipcRenderer.invoke('stocks:availability', productId),
    updateTransfer:(id: string, status: string, payload?: unknown) => ipcRenderer.invoke('stocks:updateTransfer', id, status, payload),
    branchSummary: ()                   => ipcRenderer.invoke('stocks:branchSummary'),
    branchDetail:  (branchId: string)   => ipcRenderer.invoke('stocks:branchDetail', branchId),
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
    branches:    { list: () => ipcRenderer.invoke('admin:branches:list'), findByCode: (code: string) => ipcRenderer.invoke('admin:branches:findByCode', code), create: (p: unknown) => ipcRenderer.invoke('admin:branches:create', p), update: (id: string, p: unknown) => ipcRenderer.invoke('admin:branches:update', id, p) },
    users:       { list: () => ipcRenderer.invoke('admin:users:list'), create: (p: unknown) => ipcRenderer.invoke('admin:users:create', p), update: (id: string, p: unknown) => ipcRenderer.invoke('admin:users:update', id, p), delete: (id: string) => ipcRenderer.invoke('admin:users:delete', id) },
    roles:       { list: () => ipcRenderer.invoke('admin:roles:list'), create: (p: unknown) => ipcRenderer.invoke('admin:roles:create', p), update: (id: string, p: unknown) => ipcRenderer.invoke('admin:roles:update', id, p), delete: (id: string) => ipcRenderer.invoke('admin:roles:delete', id) },
    suppliers:   { list: () => ipcRenderer.invoke('admin:suppliers:list'), create: (p: unknown) => ipcRenderer.invoke('admin:suppliers:create', p), update: (id: string, p: unknown) => ipcRenderer.invoke('admin:suppliers:update', id, p) },
    categories:  { list: () => ipcRenderer.invoke('admin:categories:list'), create: (p: unknown) => ipcRenderer.invoke('admin:categories:create', p), update: (id: string, p: unknown) => ipcRenderer.invoke('admin:categories:update', id, p), delete: (id: string) => ipcRenderer.invoke('admin:categories:delete', id) },
    auditLogs:   { list: (filters?: unknown) => ipcRenderer.invoke('admin:auditLogs:list', filters) },
    deliveries:  { list: (filters?: unknown) => ipcRenderer.invoke('admin:deliveries:list', filters), update: (id: string, p: unknown) => ipcRenderer.invoke('admin:deliveries:update', id, p) },
    installments:{
      list:          (filters?: unknown)       => ipcRenderer.invoke('admin:installments:list', filters),
      get:           (id: string)              => ipcRenderer.invoke('admin:installments:get', id),
      recordPayment: (id: string, p: unknown)  => ipcRenderer.invoke('admin:installments:recordPayment', id, p),
    },
    productUom:  { list: (productId: string) => ipcRenderer.invoke('admin:productUom:list', productId), save: (productId: string, uoms: unknown) => ipcRenderer.invoke('admin:productUom:save', productId, uoms) },
    expenseCategories: { list: () => ipcRenderer.invoke('admin:expenseCategories:list'), create: (p: unknown) => ipcRenderer.invoke('admin:expenseCategories:create', p) },
    expenses:    { list: (filters?: unknown) => ipcRenderer.invoke('admin:expenses:list', filters), create: (p: unknown) => ipcRenderer.invoke('admin:expenses:create', p), update: (id: string, p: unknown) => ipcRenderer.invoke('admin:expenses:update', id, p) },
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
  },

  // Events from main → renderer
  on: (channel: string, listener: (...args: unknown[]) => void) => {
    ipcRenderer.on(channel, (_event, ...args) => listener(...args))
    return () => ipcRenderer.removeListener(channel, listener)
  },
}

contextBridge.exposeInMainWorld('api', api)

export type API = typeof api
