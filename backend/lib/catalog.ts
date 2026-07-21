export type ModuleDefinition = {
  key: string
  name: string
  sort: number
}

export type FeatureDefinition = {
  key: string
  name: string
  moduleKey: string
  group: string
  description: string
  sort: number
}

export const MODULE_DEFINITIONS: ModuleDefinition[] = [
  { key: 'pos',             name: 'POS / Billing',               sort: 1 },
  { key: 'inventory',       name: 'Inventory Management',        sort: 2 },
  { key: 'customers',       name: 'Customer Management',         sort: 3 },
  { key: 'reports_basic',   name: 'Basic Reports',               sort: 4 },
  { key: 'installments',    name: 'Installments & Credit',       sort: 5 },
  { key: 'multi_branch',    name: 'Multi-Branch Management',     sort: 6 },
  { key: 'purchase_orders', name: 'Purchase Orders',             sort: 7 },
  { key: 'deliveries',      name: 'Delivery Management',         sort: 8 },
  { key: 'expenses',        name: 'Expense Tracking',            sort: 9 },
  { key: 'reports_full',    name: 'Advanced Reports & Analytics', sort: 10 },
  { key: 'stock_transfers', name: 'Inter-Branch Stock Transfers', sort: 11 },
  { key: 'api_access',      name: 'API Access',                   sort: 12 },
  { key: 'white_label',     name: 'White Label',                  sort: 13 },
]

// Tables frozen when a company is admin-locked (companies.admin_locked) —
// separate concept from module gating above: locking a company doesn't
// change what modules it's licensed for, it freezes staff/permission
// changes specifically while POS/sales keep working normally.
export const ADMIN_LOCK_TABLES = ['users', 'roles']

// Maps sync-pushed table names (see ALLOWED_TABLES in lib/sync.ts) to the
// optional module that owns them, for per-table enforcement in sync/push.
// Core tables (products, invoices, customers, stocks, ...) are intentionally
// left out — they stay always-allowed, same as the always-on modules already
// behave in resolveEntitlements().
export const TABLE_MODULE_MAP: Record<string, string> = {
  purchase_orders: 'purchase_orders',
  purchase_items:  'purchase_orders',

  deliveries: 'deliveries',

  expenses:           'expenses',
  expense_categories: 'expenses',

  installments:           'installments',
  installment_payments:   'installments',
  installment_plans:      'installments',
  installment_schedule:   'installments',
  installment_reminders:  'installments',

  stock_transfers:             'stock_transfers',
  branch_transfers:            'stock_transfers',
  branch_transfer_items:       'stock_transfers',
  branch_transfer_mismatches:  'stock_transfers',
  branch_transfer_logs:        'stock_transfers',
  branch_transfer_prints:      'stock_transfers',
}

export const FEATURE_DEFINITIONS: FeatureDefinition[] = [
  {
    key: 'pos.billing.create',
    name: 'Create Sales',
    moduleKey: 'pos',
    group: 'POS / Billing',
    description: 'Allow cashier to create invoices, sales orders, and receipts.',
    sort: 1,
  },
  {
    key: 'products.create',
    name: 'Create Products',
    moduleKey: 'inventory',
    group: 'Products',
    description: 'Add new products and variants to the catalog.',
    sort: 2,
  },
  {
    key: 'products.edit',
    name: 'Edit Products',
    moduleKey: 'inventory',
    group: 'Products',
    description: 'Change product details, pricing, and category assignments.',
    sort: 3,
  },
  {
    key: 'products.barcode.print',
    name: 'Barcode Printing',
    moduleKey: 'inventory',
    group: 'Products',
    description: 'Generate barcode labels for products and variants.',
    sort: 4,
  },
  {
    key: 'stock.quantity.add',
    name: 'Stock Adjustments',
    moduleKey: 'inventory',
    group: 'Inventory',
    description: 'Manually add stock, corrections, and opening quantities.',
    sort: 5,
  },
  {
    key: 'stock.transfer.create',
    name: 'Create Transfers',
    moduleKey: 'stock_transfers',
    group: 'Transfers',
    description: 'Move stock between branches and track movements.',
    sort: 6,
  },
  {
    key: 'stock.transfer.approve',
    name: 'Approve Transfers',
    moduleKey: 'stock_transfers',
    group: 'Transfers',
    description: 'Approve transfer requests before stock is released.',
    sort: 7,
  },
  {
    key: 'printer.thermal',
    name: 'Thermal Printer',
    moduleKey: 'pos',
    group: 'Printing',
    description: 'Use thermal printers for compact receipts and slips.',
    sort: 8,
  },
  {
    key: 'printer.direct_print',
    name: 'Direct Print',
    moduleKey: 'pos',
    group: 'Printing',
    description: 'Print receipts without opening the print preview.',
    sort: 9,
  },
  {
    key: 'reports.sales.view',
    name: 'Sales Reports',
    moduleKey: 'reports_basic',
    group: 'Reports',
    description: 'View sales summaries, trends, and branch performance.',
    sort: 10,
  },
  {
    key: 'reports.sales.export',
    name: 'Export Reports',
    moduleKey: 'reports_full',
    group: 'Reports',
    description: 'Export sales and stock reports to CSV or Excel.',
    sort: 11,
  },
  {
    key: 'sync.cloud',
    name: 'Cloud Sync',
    moduleKey: 'api_access',
    group: 'Sync',
    description: 'Synchronize data with the central tenant cloud database.',
    sort: 12,
  },
  {
    key: 'sync.offline',
    name: 'Offline Sync',
    moduleKey: 'api_access',
    group: 'Sync',
    description: 'Queue local changes and sync once connectivity returns.',
    sort: 13,
  },
]
