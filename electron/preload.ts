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
    uomListAll: ()                  => ipcRenderer.invoke('products:uom:listAll'),
    get:        (id: string)        => ipcRenderer.invoke('products:get', id),
    search:     (query: string)     => ipcRenderer.invoke('products:search', query),
    searchSku:  (sku: string)       => ipcRenderer.invoke('products:searchSku', sku),
    create:     (payload: unknown)  => ipcRenderer.invoke('products:create', payload),
    update:     (id: string, payload: unknown) => ipcRenderer.invoke('products:update', id, payload),
    delete:     (id: string)        => ipcRenderer.invoke('products:delete', id),
    selectAndUploadImage: ()        => ipcRenderer.invoke('products:selectAndUploadImage'),
    importExcel:          ()        => ipcRenderer.invoke('products:importExcel'),
    exportCsv:            ()        => ipcRenderer.invoke('products:exportCsv'),
    normalizeCatalog:     ()        => ipcRenderer.invoke('products:normalizeCatalog'),
    catalogAudit:         ()        => ipcRenderer.invoke('products:catalogAudit'),
    permanentDelete:      (id: string, reason: string) => ipcRenderer.invoke('products:permanentDelete', id, reason),
  },

  // Invoices
  invoices: {
    list:               (filters?: unknown)                       => ipcRenderer.invoke('invoices:list', filters),
    get:                (id: string)                              => ipcRenderer.invoke('invoices:get', id),
    create:             (payload: unknown)                        => ipcRenderer.invoke('invoices:create', payload),
    update:             (id: string, payload: unknown)            => ipcRenderer.invoke('invoices:update', id, payload),
    cancel:             (id: string)                              => ipcRenderer.invoke('invoices:cancel', id),
    return:             (id: string, payload: unknown)            => ipcRenderer.invoke('invoices:return', id, payload),
    nextNumber:         (billType?: string)                       => ipcRenderer.invoke('invoices:nextNumber', billType),
    convert:            (id: string)                              => ipcRenderer.invoke('invoices:convert', id),
    approveCreditBill:  (id: string)                              => ipcRenderer.invoke('invoices:approveCreditBill', id),
    addCreditPayment:   (id: string, payload: unknown)            => ipcRenderer.invoke('invoices:addCreditPayment', id, payload),
    pendingApproval:    ()                                        => ipcRenderer.invoke('invoices:pendingApproval'),
    creditSummary:      (customerId: string)                      => ipcRenderer.invoke('invoices:creditSummary', customerId),
    applyEdit:          (id: string, payload: unknown)            => ipcRenderer.invoke('invoices:applyEdit', id, payload),
  },

  // POS cart "Hold" — pauses a cart-in-progress, separate from invoices
  // (see held_carts table comment in electron/database.ts)
  holds: {
    create: (payload: unknown) => ipcRenderer.invoke('holds:create', payload),
    list:   ()                 => ipcRenderer.invoke('holds:list'),
    recall: (id: string)       => ipcRenderer.invoke('holds:recall', id),
  },

  // Customers
  customers: {
    list:   (filters?: unknown) => ipcRenderer.invoke('customers:list', filters),
    get:    (id: string)        => ipcRenderer.invoke('customers:get', id),
    search: (query: string)     => ipcRenderer.invoke('customers:search', query),
    create: (payload: unknown)  => ipcRenderer.invoke('customers:create', payload),
    update: (id: string, payload: unknown) => ipcRenderer.invoke('customers:update', id, payload),
    delete: (id: string)        => ipcRenderer.invoke('customers:delete', id),
    installments: (id: string)  => ipcRenderer.invoke('customers:installments', id),
    history:      (id: string)  => ipcRenderer.invoke('customers:history', id),
    chitMemberships:    (id: string)  => ipcRenderer.invoke('customers:chitMemberships', id),
    findByPhoneOrNic:   (payload: unknown) => ipcRenderer.invoke('customers:findByPhoneOrNic', payload),
    importExcel:      ()        => ipcRenderer.invoke('customers:importExcel'),
    downloadTemplate: ()        => ipcRenderer.invoke('customers:downloadTemplate'),
  },

  // Agents (referral / sales commission)
  agents: {
    list:             (filters?: unknown) => ipcRenderer.invoke('agents:list', filters),
    get:              (id: string)        => ipcRenderer.invoke('agents:get', id),
    create:           (payload: unknown)  => ipcRenderer.invoke('agents:create', payload),
    update:           (id: string, payload: unknown) => ipcRenderer.invoke('agents:update', id, payload),
    delete:           (id: string)        => ipcRenderer.invoke('agents:delete', id),
    linkUser:         (agentId: string, userId: string | null) => ipcRenderer.invoke('agents:linkUser', agentId, userId),
    createUserForAgent: (agentId: string, payload: unknown) => ipcRenderer.invoke('agents:createUserForAgent', agentId, payload),
    approve:          (id: string)        => ipcRenderer.invoke('agents:approve', id),
    report:           (filters: unknown)  => ipcRenderer.invoke('agents:report', filters),
    reportAllSummary: (filters?: unknown) => ipcRenderer.invoke('agents:reportAllSummary', filters),
    importExcel:      ()                  => ipcRenderer.invoke('agents:importExcel'),
    downloadTemplate: ()                  => ipcRenderer.invoke('agents:downloadTemplate'),
  },

  // Staff/Agent positions lookup (Issue 19)
  positions: {
    list:   ()                   => ipcRenderer.invoke('positions:list'),
    create: (payload: { name: string }) => ipcRenderer.invoke('positions:create', payload),
  },

  regions: {
    list:   (filters?: unknown)               => ipcRenderer.invoke('regions:list', filters),
    create: (payload: unknown)                => ipcRenderer.invoke('regions:create', payload),
    update: (id: string, payload: unknown)    => ipcRenderer.invoke('regions:update', id, payload),
  },
  zones: {
    list:   (filters?: unknown)               => ipcRenderer.invoke('zones:list', filters),
    create: (payload: unknown)                => ipcRenderer.invoke('zones:create', payload),
    update: (id: string, payload: unknown)    => ipcRenderer.invoke('zones:update', id, payload),
  },

  // Chit Fund
  chits: {
    list:    (filters?: unknown) => ipcRenderer.invoke('chits:list', filters),
    get:     (id: string)        => ipcRenderer.invoke('chits:get', id),
    create:  (payload: unknown)  => ipcRenderer.invoke('chits:create', payload),
    update:  (id: string, payload: unknown) => ipcRenderer.invoke('chits:update', id, payload),
    delete:  (id: string)                   => ipcRenderer.invoke('chits:delete', id),
    purgeCancelled: (id: string)             => ipcRenderer.invoke('chits:purgeCancelled', id),
    toggleActive: (id: string)              => ipcRenderer.invoke('chits:toggleActive', id),
    reports: (filters?: unknown) => ipcRenderer.invoke('chits:reports', filters),
    reportsMembers:           (filters?: unknown) => ipcRenderer.invoke('chits:reports:members', filters),
    reportsContributions:     (filters?: unknown) => ipcRenderer.invoke('chits:reports:contributions', filters),
    reportsWinners:           (filters?: unknown) => ipcRenderer.invoke('chits:reports:winners', filters),
    reportsBranchPerformance: () => ipcRenderer.invoke('chits:reports:branchPerformance'),
    reportsMemberPayments:    (filters?: unknown) => ipcRenderer.invoke('chits:reports:memberPayments', filters),
    reportsOutstanding:       (filters?: unknown) => ipcRenderer.invoke('chits:reports:outstanding', filters),
    reportsCycleCollection:   (filters?: unknown) => ipcRenderer.invoke('chits:reports:cycleCollection', filters),
    reportsFinancialOverview: (filters?: unknown) => ipcRenderer.invoke('chits:reports:financialOverview', filters),
    customersList: (filters?: unknown) => ipcRenderer.invoke('chits:customers:list', filters),
    viability: {
      calculate: (payload: unknown) => ipcRenderer.invoke('chits:viability:calculate', payload),
    },
    schemes: {
      financials: (schemeId: string) => ipcRenderer.invoke('chits:schemes:financials', schemeId),
    },
    templates: {
      list:   (filters?: unknown) => ipcRenderer.invoke('chits:templates:list', filters),
      create: (payload: unknown)  => ipcRenderer.invoke('chits:templates:create', payload),
      update: (id: string, payload: unknown) => ipcRenderer.invoke('chits:templates:update', id, payload),
    },
    members: {
      add:                (schemeId: string, payload: unknown) => ipcRenderer.invoke('chits:members:add', schemeId, payload),
      list:               (schemeId: string)                   => ipcRenderer.invoke('chits:members:list', schemeId),
      downloadTemplate:   ()                                   => ipcRenderer.invoke('chits:members:downloadTemplate'),
      importExcel:        (schemeId: string)                   => ipcRenderer.invoke('chits:members:importExcel', schemeId),
      earlyRedeem:        (memberId: string, payload: unknown) => ipcRenderer.invoke('chits:members:earlyRedeem', memberId, payload),
      contributionHistory: (memberId: string)                  => ipcRenderer.invoke('chits:members:contributionHistory', memberId),
      contributionStatement: (memberId: string)                => ipcRenderer.invoke('chits:members:contributionStatement', memberId),
      registerHistorical: (schemeId: string, payload: unknown) => ipcRenderer.invoke('chits:members:registerHistorical', schemeId, payload),
      recordRedemption:   (memberId: string, payload: unknown) => ipcRenderer.invoke('chits:members:recordRedemption', memberId, payload),
      reverseRedemption:  (memberId: string, reason: string)   => ipcRenderer.invoke('chits:members:reverseRedemption', memberId, reason),
      extendClaim:        (memberId: string, newDueDate: string, reason: string) => ipcRenderer.invoke('chits:members:extendClaim', memberId, newDueDate, reason),
      transfer:           (memberId: string, newCustomerId: string, reason: string) => ipcRenderer.invoke('chits:members:transfer', memberId, newCustomerId, reason),
    },
    draws: {
      eligible: (schemeId: string, cycleNo: number) => ipcRenderer.invoke('chits:draws:eligible', schemeId, cycleNo),
      conduct:  (schemeId: string, cycleNo: number, options?: unknown) => ipcRenderer.invoke('chits:draws:conduct', schemeId, cycleNo, options),
      list:     (schemeId: string) => ipcRenderer.invoke('chits:draws:list', schemeId),
    },
    cycles: {
      paymentProgress: (schemeId: string, cycleNo?: number) => ipcRenderer.invoke('chits:cycles:paymentProgress', schemeId, cycleNo),
    },
    reminders: {
      preview: (memberId: string, cycleNo?: number) => ipcRenderer.invoke('chits:reminders:preview', memberId, cycleNo),
      send:    (memberId: string, cycleNo?: number, force?: boolean) => ipcRenderer.invoke('chits:reminders:send', memberId, cycleNo, force),
      list:    (filters?: unknown) => ipcRenderer.invoke('chits:reminders:list', filters),
    },
    contributions: {
      record:           (memberId: string, payload: unknown) => ipcRenderer.invoke('chits:contributions:record', memberId, payload),
      verify:            (id: string, action: 'approve' | 'reject', notes?: string) => ipcRenderer.invoke('chits:contributions:verify', id, action, notes),
      pendingTransfers: (filters?: unknown) => ipcRenderer.invoke('chits:contributions:pendingTransfers', filters),
    },
    agents: {
      report: (filters?: unknown) => ipcRenderer.invoke('chits:agents:report', filters),
      detail: (agentId: string)   => ipcRenderer.invoke('chits:agents:detail', agentId),
    },
    remittances: {
      record: (payload: unknown)   => ipcRenderer.invoke('chits:remittances:record', payload),
      list:   (filters?: unknown)  => ipcRenderer.invoke('chits:remittances:list', filters),
    },
    withdrawals: {
      request: (memberId: string, reason: string) => ipcRenderer.invoke('chits:withdrawals:request', memberId, reason),
      approve: (id: string, refundAmount: number, reviewReason: string) => ipcRenderer.invoke('chits:withdrawals:approve', id, refundAmount, reviewReason),
      reject:  (id: string, reviewReason: string)  => ipcRenderer.invoke('chits:withdrawals:reject', id, reviewReason),
      list:    (filters?: unknown)                 => ipcRenderer.invoke('chits:withdrawals:list', filters),
    },
    claims: {
      delayed: (filters?: unknown) => ipcRenderer.invoke('chits:claims:delayed', filters),
    },
    transfers: {
      list: (filters?: unknown) => ipcRenderer.invoke('chits:transfers:list', filters),
    },
    wallet: {
      list:   (filters?: unknown)                       => ipcRenderer.invoke('chits:wallet:list', filters),
      usage:  (filters?: unknown)                       => ipcRenderer.invoke('chits:wallet:usage', filters),
      detail: (customerId: string)                      => ipcRenderer.invoke('chits:wallet:detail', customerId),
      debit:  (customerId: string, amount: number, notes: string) => ipcRenderer.invoke('chits:wallet:debit', customerId, amount, notes),
    },
    branches: {
      invite:        (schemeId: string, targetBranchId: string, notes?: string) => ipcRenderer.invoke('chits:branches:invite', schemeId, targetBranchId, notes),
      respond:       (collaborationId: string, action: 'approve' | 'reject', notes?: string) => ipcRenderer.invoke('chits:branches:respond', collaborationId, action, notes),
      remove:        (collaborationId: string) => ipcRenderer.invoke('chits:branches:remove', collaborationId),
      pendingInvites: () => ipcRenderer.invoke('chits:branches:pendingInvites'),
    },
    dashboard: () => ipcRenderer.invoke('chits:dashboard'),
  },

  // Enterprise Commission Engine
  commissions: {
    rules: {
      list:    (filters?: unknown) => ipcRenderer.invoke('commissions:rules:list', filters),
      create:  (payload: unknown)  => ipcRenderer.invoke('commissions:rules:create', payload),
      update:  (id: string, payload: unknown) => ipcRenderer.invoke('commissions:rules:update', id, payload),
      delete:  (id: string)        => ipcRenderer.invoke('commissions:rules:delete', id),
      history: (ruleId: string)    => ipcRenderer.invoke('commissions:rules:history', ruleId),
    },
    ledger: {
      list:     (filters?: unknown) => ipcRenderer.invoke('commissions:ledger:list', filters),
      approve:  (id: string, remarks?: string) => ipcRenderer.invoke('commissions:ledger:approve', id, remarks),
      reject:   (id: string, remarks: string)  => ipcRenderer.invoke('commissions:ledger:reject', id, remarks),
      cancel:   (id: string, remarks?: string) => ipcRenderer.invoke('commissions:ledger:cancel', id, remarks),
      markPaid: (ids: string[])     => ipcRenderer.invoke('commissions:ledger:markPaid', ids),
    },
    approvalLogs: {
      list: (commissionId: string) => ipcRenderer.invoke('commissions:approvalLogs:list', commissionId),
    },
    statement: {
      generate: (agentId: string, filters?: unknown) => ipcRenderer.invoke('commissions:statement:generate', agentId, filters),
    },
    payouts: {
      create: (payload: unknown)   => ipcRenderer.invoke('commissions:payouts:create', payload),
      list:   (filters?: unknown)  => ipcRenderer.invoke('commissions:payouts:list', filters),
    },
  },

  // Edit requests — manager-requested, admin-approved corrections to
  // already-completed invoices / stock records
  editRequests: {
    create:        (payload: unknown)                     => ipcRenderer.invoke('editRequests:create', payload),
    list:          (filters?: unknown)                    => ipcRenderer.invoke('editRequests:list', filters),
    review:        (id: string, action: 'approve' | 'reject', notes?: string) => ipcRenderer.invoke('editRequests:review', id, action, notes),
    checkUnlocked: (targetTable: string, targetRecordId: string) => ipcRenderer.invoke('editRequests:checkUnlocked', targetTable, targetRecordId),
  },

  // Stocks
  stocks: {
    list:         (branchId?: string)  => ipcRenderer.invoke('stocks:list', branchId),
    get:          (productId: string)  => ipcRenderer.invoke('stocks:get', productId),
    transfer:     (payload: unknown)   => ipcRenderer.invoke('stocks:transfer', payload),
    adjustCorrection: (payload: unknown) => ipcRenderer.invoke('stocks:adjustCorrection', payload),
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
    profitSummary:     (filters: unknown) => ipcRenderer.invoke('analytics:profitSummary', filters),
    dailyReport:       (date: string)     => ipcRenderer.invoke('analytics:dailyReport', date),
  },

  // Admin
  admin: {
    branches:    { list: () => ipcRenderer.invoke('admin:branches:list'), findByCode: (code: string) => ipcRenderer.invoke('admin:branches:findByCode', code), create: (p: unknown) => ipcRenderer.invoke('admin:branches:create', p), update: (id: string, p: unknown) => ipcRenderer.invoke('admin:branches:update', id, p), delete: (id: string) => ipcRenderer.invoke('admin:branches:delete', id) },
    users:       { list: () => ipcRenderer.invoke('admin:users:list'), create: (p: unknown) => ipcRenderer.invoke('admin:users:create', p), update: (id: string, p: unknown) => ipcRenderer.invoke('admin:users:update', id, p), delete: (id: string) => ipcRenderer.invoke('admin:users:delete', id), hardDelete: (id: string) => ipcRenderer.invoke('admin:users:hardDelete', id), toggleActive: (id: string, active: boolean) => ipcRenderer.invoke('admin:users:toggleActive', id, active), resetPassword: (id: string, newPassword: string) => ipcRenderer.invoke('admin:users:resetPassword', id, newPassword), forcePasswordChange: (id: string, force: boolean) => ipcRenderer.invoke('admin:users:forcePasswordChange', id, force), importExcel: () => ipcRenderer.invoke('admin:users:importExcel'), downloadTemplate: () => ipcRenderer.invoke('admin:users:downloadTemplate'), getAgentInfo: (userId: string) => ipcRenderer.invoke('admin:users:getAgentInfo', userId), auditUnlinkedUsers: () => ipcRenderer.invoke('agents:auditUnlinkedUsers') },
    roles:       { list: () => ipcRenderer.invoke('admin:roles:list'), create: (p: unknown) => ipcRenderer.invoke('admin:roles:create', p), update: (id: string, p: unknown) => ipcRenderer.invoke('admin:roles:update', id, p), delete: (id: string) => ipcRenderer.invoke('admin:roles:delete', id) },
    suppliers:   { list: () => ipcRenderer.invoke('admin:suppliers:list'), create: (p: unknown) => ipcRenderer.invoke('admin:suppliers:create', p), update: (id: string, p: unknown) => ipcRenderer.invoke('admin:suppliers:update', id, p), delete: (id: string) => ipcRenderer.invoke('admin:suppliers:delete', id) },
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
    expenseCategories: { list: () => ipcRenderer.invoke('admin:expenseCategories:list'), create: (p: unknown) => ipcRenderer.invoke('admin:expenseCategories:create', p), delete: (id: string) => ipcRenderer.invoke('admin:expenseCategories:delete', id) },
    expenses:    { list: (filters?: unknown) => ipcRenderer.invoke('admin:expenses:list', filters), create: (p: unknown) => ipcRenderer.invoke('admin:expenses:create', p), update: (id: string, p: unknown) => ipcRenderer.invoke('admin:expenses:update', id, p), delete: (id: string) => ipcRenderer.invoke('admin:expenses:delete', id) },
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
    fixOrphanedParents: () => ipcRenderer.invoke('sync:fixOrphanedParents'),
  },

  // Printer
  printer: {
    printReceipt: (payload: unknown) => ipcRenderer.invoke('printer:printReceipt', payload),
    printInvoice: (payload: unknown) => ipcRenderer.invoke('printer:printInvoice', payload),
    renderInvoiceHtml: (payload: unknown, draftLayout?: unknown) => ipcRenderer.invoke('printer:renderInvoiceHtml', payload, draftLayout),
    exportInvoicePdf: (payload: unknown) => ipcRenderer.invoke('printer:exportInvoicePdf', payload),
    printTransfer:(payload: unknown) => ipcRenderer.invoke('printer:printTransfer', payload),
    printCoupon:  (payload: unknown) => ipcRenderer.invoke('printer:printCoupon', payload),
    printSmartBuyVouchers: (couponIds: string[]) => ipcRenderer.invoke('printer:printSmartBuyVouchers', couponIds),
    printDeliveryNote:     (payload: unknown) => ipcRenderer.invoke('printer:printDeliveryNote', payload),
    exportDeliveryNotePdf: (payload: unknown) => ipcRenderer.invoke('printer:exportDeliveryNotePdf', payload),
    printCalibrationSheet: () => ipcRenderer.invoke('printer:printCalibrationSheet'),
    sendEscPos:     (payload: unknown) => ipcRenderer.invoke('printer:sendEscPos', payload),
    sendEscPosTest: () => ipcRenderer.invoke('printer:sendEscPosTest'),
    emailInvoice: (payload: unknown) => ipcRenderer.invoke('printer:emailInvoice', payload),
    test:         ()                 => ipcRenderer.invoke('printer:test'),
    listDevices:  ()                 => ipcRenderer.invoke('printer:listDevices'),
    listSystemPrinters: ()            => ipcRenderer.invoke('printer:listSystemPrinters'),
    listPrinterConfigs:  (branchId?: string) => ipcRenderer.invoke('printer:listPrinterConfigs', branchId),
    savePrinterConfig:   (payload: unknown)  => ipcRenderer.invoke('printer:savePrinterConfig', payload),
    deletePrinterConfig: (id: string)        => ipcRenderer.invoke('printer:deletePrinterConfig', id),
    testPrinterConfig:   (id: string)        => ipcRenderer.invoke('printer:testPrinterConfig', id),
    printKitchenTicket:  (payload: unknown)  => ipcRenderer.invoke('printer:printKitchenTicket', payload),
    printLabel:          (payload: unknown)  => ipcRenderer.invoke('printer:printLabel', payload),
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
    refreshBranding: ()      => ipcRenderer.invoke('settings:refreshBranding'),
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

  // Coupons (balance-type gift vouchers)
  coupons: {
    create:   (payload: unknown)              => ipcRenderer.invoke('coupons:create', payload),
    list:     (filters?: unknown)             => ipcRenderer.invoke('coupons:list', filters),
    get:      (idOrCode: string)              => ipcRenderer.invoke('coupons:get', idOrCode),
    validate: (code: string)                  => ipcRenderer.invoke('coupons:validate', code),
    void:     (id: string, reason?: string)   => ipcRenderer.invoke('coupons:void', id, reason),
    reports:  (filters?: unknown)             => ipcRenderer.invoke('coupons:reports', filters),
    smartbuyDashboard: (filters?: unknown)    => ipcRenderer.invoke('coupons:smartbuyDashboard', filters),
    changeAgent: (couponId: string, newAgentId: string, reason?: string, confirmCrossBranch?: boolean) => ipcRenderer.invoke('coupons:changeAgent', couponId, newAgentId, reason, confirmCrossBranch),
  },

  // Discounts (admin-managed product/branch discount rules)
  discounts: {
    list:         (filters?: unknown)            => ipcRenderer.invoke('discounts:list', filters),
    activeMap:    (branchId?: string)             => ipcRenderer.invoke('discounts:activeMap', branchId),
    create:       (payload: unknown)              => ipcRenderer.invoke('discounts:create', payload),
    update:       (id: string, payload: unknown)  => ipcRenderer.invoke('discounts:update', id, payload),
    toggleActive: (id: string, active: boolean)   => ipcRenderer.invoke('discounts:toggleActive', id, active),
    delete:       (id: string)                    => ipcRenderer.invoke('discounts:delete', id),
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
      test:        (testTo: string, overrideConfig?: unknown) => ipcRenderer.invoke('comm:email:test', testTo, overrideConfig),
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
