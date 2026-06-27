// ─── Core Domain Types ───────────────────────────────────────────────────────

export interface Branch {
  id: string
  name: string
  address?: string
  phone?: string
  email?: string
  is_active: boolean
  created_at: string
  updated_at: string
  synced_at?: string
}

export interface Warehouse {
  id: string
  branch_id: string
  name: string
  location?: string
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface Role {
  id: string
  name: string
  permissions: Record<string, boolean>
  created_at: string
}

export interface User {
  id: string
  branch_id?: string
  role_id: string
  name: string
  email: string
  pin?: string
  is_active: boolean
  last_login_at?: string
  created_at: string
  updated_at: string
  // joined
  role?: Role
  branch?: Branch
}

export interface Category {
  id: string
  parent_id?: string
  name: string
  description?: string
  sort_order: number
  is_active: boolean
  children?: Category[]
}

export interface Supplier {
  id: string
  name: string
  contact?: string
  phone?: string
  email?: string
  address?: string
  tax_number?: string
  is_active: boolean
}

export interface Product {
  id: string
  category_id?: string
  supplier_id?: string
  sku: string
  barcode?: string
  name: string
  description?: string
  image_url?: string
  unit: string
  cost_price: number
  selling_price: number
  tax_rate: number
  min_stock_level: number
  is_active: boolean
  // joined
  category?: Category
  supplier?: Supplier
  stock?: number
}

export interface Stock {
  id: string
  product_id: string
  branch_id: string
  warehouse_id?: string
  quantity: number
  damaged_qty: number
  updated_at: string
}

export interface StockTransfer {
  id: string
  product_id: string
  from_branch_id?: string
  to_branch_id?: string
  from_warehouse_id?: string
  to_warehouse_id?: string
  quantity: number
  status: 'pending' | 'in_transit' | 'received' | 'cancelled'
  notes?: string
  initiated_by?: string
  received_by?: string
  initiated_at: string
  received_at?: string
}

export interface Customer {
  id: string
  branch_id?: string
  name: string
  phone?: string
  email?: string
  address?: string
  nic?: string
  loyalty_points: number
  credit_limit: number
  outstanding_due: number
  notes?: string
  created_at: string
  updated_at: string
}

export interface InvoiceItem {
  id: string
  invoice_id: string
  product_id: string
  quantity: number
  unit_price: number
  discount_pct: number
  discount_amount: number
  tax_rate: number
  tax_amount: number
  line_total: number
  // joined
  product?: Product
}

export type InvoiceStatus = 'draft' | 'held' | 'completed' | 'returned' | 'cancelled'

export interface Invoice {
  id: string
  invoice_number: string
  branch_id: string
  customer_id?: string
  cashier_id: string
  status: InvoiceStatus
  subtotal: number
  discount_amount: number
  tax_amount: number
  total_amount: number
  paid_amount: number
  due_amount: number
  notes?: string
  created_at: string
  updated_at: string
  // joined
  items?: InvoiceItem[]
  customer?: Customer
  cashier?: User
  payments?: Payment[]
}

export type PaymentMethod = 'cash' | 'card' | 'bank_transfer' | 'installment' | 'gift_voucher'

export interface Payment {
  id: string
  invoice_id: string
  method: PaymentMethod
  amount: number
  reference?: string
  received_by?: string
  paid_at: string
}

export interface Installment {
  id: string
  invoice_id: string
  customer_id: string
  total_amount: number
  paid_amount: number
  due_amount: number
  installment_count: number
  frequency: 'weekly' | 'monthly'
  start_date: string
  next_due_date?: string
  status: 'active' | 'completed' | 'overdue' | 'defaulted'
  notes?: string
  created_at: string
}

export interface InstallmentPayment {
  id: string
  installment_id: string
  amount: number
  paid_at: string
  received_by?: string
  notes?: string
}

export interface Delivery {
  id: string
  invoice_id: string
  customer_id: string
  branch_id: string
  address: string
  assigned_to?: string
  status: 'pending' | 'dispatched' | 'delivered' | 'failed'
  scheduled_at?: string
  dispatched_at?: string
  delivered_at?: string
  notes?: string
  created_at: string
}

export interface StockCountSession {
  id: string
  branch_id: string
  warehouse_id?: string
  status: 'draft' | 'in_progress' | 'completed' | 'cancelled'
  notes?: string
  created_by?: string
  completed_by?: string
  created_at: string
  completed_at?: string
  // joined
  branch_name?: string
  warehouse_name?: string
  item_count?: number
  variance_count?: number
}

export interface StockCountItem {
  id: string
  session_id: string
  product_id: string
  system_qty: number
  counted_qty: number | null
  variance: number | null
  notes?: string
  // joined
  product_name?: string
  sku?: string
  unit?: string
}

export interface SyncQueueItem {
  id: string
  table_name: string
  record_id: string
  operation: 'INSERT' | 'UPDATE' | 'DELETE'
  payload: string
  attempts: number
  last_error?: string
  status: 'pending' | 'processing' | 'synced' | 'failed'
  created_at: string
  synced_at?: string
}

export interface AuditLog {
  id: string
  user_id?: string
  branch_id?: string
  action: string
  table_name?: string
  record_id?: string
  old_values?: Record<string, unknown>
  new_values?: Record<string, unknown>
  created_at: string
}

// ─── POS / Cart Types ─────────────────────────────────────────────────────────

export interface CartItem {
  product: Product
  quantity: number
  unit_price: number
  discount_pct: number
  discount_amount: number
  tax_amount: number
  line_total: number
}

export interface Cart {
  items: CartItem[]
  customer?: Customer
  discount_amount: number
  subtotal: number
  tax_amount: number
  total_amount: number
  notes: string
}

// ─── Auth Types ───────────────────────────────────────────────────────────────

export interface AuthUser {
  id: string
  name: string
  email: string
  role: Role
  branch?: Branch
}

export interface LoginCredentials {
  email: string
  password: string
  pin?: string
}

// ─── Analytics Types ──────────────────────────────────────────────────────────

export interface SalesSummary {
  date: string
  total_invoices: number
  total_revenue: number
  total_discount: number
  total_tax: number
}

export interface TopProduct {
  product_id: string
  name: string
  sku: string
  total_qty: number
  total_revenue: number
}

export interface BranchPerformance {
  branch_id: string
  branch_name: string
  total_revenue: number
  total_invoices: number
  avg_invoice_value: number
}

// ─── IPC Bridge Types ─────────────────────────────────────────────────────────

export interface IPCResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

export interface PrinterConfig {
  type: 'usb' | 'bluetooth' | 'network'
  vid?: number
  pid?: number
  address?: string
  port?: number
}

export interface AppSettings {
  branch_id: string
  branch_name: string
  currency: string
  currency_symbol: string
  tax_label: string
  receipt_header: string
  receipt_footer: string
  low_stock_threshold: number
  printer?: PrinterConfig
  cloud_api_url: string
  cloud_api_key: string
  theme: 'dark' | 'light'
}
