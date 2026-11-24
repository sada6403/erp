import { describe, it, expect, afterEach } from 'vitest'
import { normalizeHeldCart } from './heldCart'
import { useCartStore } from '@/store/cartStore'
import type { Product, Customer } from '@/types'

afterEach(() => useCartStore.getState().clear())
describe('held cart storage compatibility', () => {
  it('restores real cart totals, customer, dates and bill type from snake_case hold records', () => {
    const cart = useCartStore.getState()
    cart.addItem({ id: 'milk', name: 'Milk', selling_price: 100, tax_rate: 0 } as Product, 2)
    const items = useCartStore.getState().items
    const customer = { id: 'customer', name: 'Customer' } as Customer
    cart.clear()
    cart.restoreCart(normalizeHeldCart({ items, customer, global_discount: 10, bill_type: 'CREDIT', due_date: '2026-12-22', notes: 'held' }))
    expect(useCartStore.getState()).toMatchObject({ total: 180, billType: 'CREDIT', customer, globalDiscount: 10, dueDate: '2026-12-22' })
  })
  it('supports camelCase records and rejects invalid totals before modifying the cart', () => {
    expect(normalizeHeldCart({ items: [], billType: 'QUOTATION', globalDiscount: 5 }).billType).toBe('QUOTATION')
    expect(() => normalizeHeldCart({ items: [], global_discount: 'bad' })).toThrow(/discount/)
  })
})
