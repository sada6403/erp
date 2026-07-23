// Shared invoice/quotation detail shape + print-payload builder, used by
// TransactionReportPage, BillsPage, and InvoiceDetailModal so the mapping
// from a `reports:transactionDetail` response to a printer.printInvoice
// payload is defined exactly once.

export interface InvoiceDetail {
  id: string
  invoice_number: string
  status: string
  bill_type: string
  branch_name: string
  customer_name: string | null
  customer_phone: string | null
  cashier_name: string
  subtotal: number
  discount_amount: number
  tax_amount: number
  total_amount: number
  paid_amount: number
  due_amount: number
  agent_code?: string | null
  agent_name?: string | null
  agent_commission_pct?: number
  agent_commission_amount?: number
  notes: string | null
  valid_until?: string | null
  created_at: string
  items: Array<{
    id: string
    product_name: string
    sku: string
    barcode: string
    unit: string
    quantity: number
    unit_price: number
    discount: number
    tax: number
    total: number
  }>
  payments: Array<{
    id: string
    method: string
    amount: number
    reference: string | null
    paid_at: string
  }>
}

export function buildInvoicePrintPayload(d: InvoiceDetail) {
  return {
    invoice_number: d.invoice_number,
    bill_type: d.bill_type,
    invoice_date: d.created_at,
    cashier_name: d.cashier_name,
    customer_name: d.customer_name || undefined,
    customer_phone: d.customer_phone || undefined,
    items: d.items.map(i => ({
      product_name: i.product_name, sku: i.sku, quantity: i.quantity,
      unit_price: i.unit_price, discount_amount: i.discount, line_total: i.total,
    })),
    subtotal: d.subtotal,
    discount_amount: d.discount_amount,
    tax_amount: d.tax_amount,
    total_amount: d.total_amount,
    paid_amount: d.paid_amount,
    change_amount: 0,
    payment_method: d.payments[0]?.method || 'cash',
    payments: d.payments.map(p => ({ method: p.method, amount: p.amount, reference: p.reference || undefined })),
  }
}
