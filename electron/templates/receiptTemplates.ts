// Plain-text receipt template — relocated byte-for-byte out of ipc/printer.ts
// (Phase 8 of the PrinterService refactor).

export function buildReceiptText(payload: Record<string, unknown>, settings: Record<string, unknown>): string {
  const sep = '================================'
  const header   = (settings.company_name     as string) || (settings.receipt_header as string) || 'Nature Plantation'
  const footer   = (settings.receipt_footer   as string) || 'Thank you for your purchase!'
  const currency = (settings.currency_symbol  as string) || 'Rs.'

  const lines: string[] = [
    header, sep,
    `Invoice: ${payload.invoice_number}`,
    `Date: ${new Date().toLocaleString()}`,
    `Cashier: ${payload.cashier_name}`,
    sep, 'ITEMS:', sep
  ]

  for (const item of (payload.items || []) as Record<string, unknown>[]) {
    lines.push(`${item.product_name}`)
    lines.push(`  ${item.quantity} x ${currency}${Number(item.unit_price).toFixed(2)} = ${currency}${Number(item.line_total).toFixed(2)}`)
  }

  lines.push(sep)
  lines.push(`Subtotal:  ${currency}${Number(payload.subtotal).toFixed(2)}`)
  if (Number(payload.discount_amount) > 0) lines.push(`Discount:  -${currency}${Number(payload.discount_amount).toFixed(2)}`)
  if (Number(payload.tax_amount) > 0)      lines.push(`Tax:       ${currency}${Number(payload.tax_amount).toFixed(2)}`)
  lines.push(`TOTAL:     ${currency}${Number(payload.total_amount).toFixed(2)}`)
  lines.push(sep)
  lines.push(footer)
  lines.push('')

  return lines.join('\n')
}
