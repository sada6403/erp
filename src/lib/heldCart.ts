import type { CartItem, Customer } from '@/types'
import type { BillType } from '@/store/cartStore'

/** IPC/storage use snake_case; the Zustand cart uses camelCase. */
export function normalizeHeldCart(data: Record<string, unknown>) {
  const type = data.billType ?? data.bill_type ?? 'RETAIL'
  if (!['RETAIL', 'QUOTATION', 'CREDIT'].includes(String(type))) throw new Error('Held bill has an invalid bill type')
  if (!Array.isArray(data.items)) throw new Error('Held bill has no item list')
  const discount = Number(data.globalDiscount ?? data.global_discount ?? 0)
  if (!Number.isFinite(discount) || discount < 0 || discount > 100) throw new Error('Held bill has an invalid discount')
  return {
    items: data.items as CartItem[], customer: (data.customer || null) as Customer | null,
    globalDiscount: discount, notes: String(data.notes || ''), billType: type as BillType,
    validUntil: String(data.validUntil ?? data.valid_until ?? ''), dueDate: String(data.dueDate ?? data.due_date ?? ''),
  }
}
