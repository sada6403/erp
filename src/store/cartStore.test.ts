import { describe, it, expect, beforeEach } from 'vitest'
import { useCartStore } from './cartStore'
import { makeProduct, makeCustomer } from '@/test/factories'

// Money math: use whole-number assertions to avoid floating-point noise.
// Every price in this file is chosen so subtotal × (1 - discount) + tax gives a clean result.

beforeEach(() => {
  useCartStore.getState().clear()
})

describe('useCartStore — totals math', () => {
  it('starts with zeros', () => {
    const s = useCartStore.getState()
    expect(s.items).toEqual([])
    expect(s.subtotal).toBe(0)
    expect(s.discountAmount).toBe(0)
    expect(s.taxAmount).toBe(0)
    expect(s.total).toBe(0)
  })

  it('one item @ 100 with 10% tax: subtotal 100, tax 10, total 110', () => {
    useCartStore.getState().addItem(makeProduct({ selling_price: 100, tax_rate: 10 }))
    const s = useCartStore.getState()
    expect(s.subtotal).toBe(100)
    expect(s.discountAmount).toBe(0)
    expect(s.taxAmount).toBe(10)
    expect(s.total).toBe(110)
  })

  it('quantity 3 of @ 100 = subtotal 300, tax 30, total 330', () => {
    useCartStore.getState().addItem(makeProduct({ selling_price: 100, tax_rate: 10 }), 3)
    const s = useCartStore.getState()
    expect(s.subtotal).toBe(300)
    expect(s.taxAmount).toBe(30)
    expect(s.total).toBe(330)
  })

  it('two items: subtotal is sum, tax is sum of per-line tax, total is correct', () => {
    useCartStore.getState().addItem(makeProduct({ id: 'p1', selling_price: 100, tax_rate: 10 }), 2)
    useCartStore.getState().addItem(makeProduct({ id: 'p2', selling_price: 50,  tax_rate: 0  }), 1)
    const s = useCartStore.getState()
    expect(s.subtotal).toBe(250)         // 200 + 50
    expect(s.taxAmount).toBe(20)          // (2*100)*0.1 + (1*50)*0
    expect(s.total).toBe(270)
  })

  it('global discount 10% off subtotal, tax computed on pre-discount amount', () => {
    // Note: the cart store computes tax on the per-line taxable amount (gross - line
    // discount). The global discount is applied to the grand total at the end, not
    // to the tax base. This is intentional behavior — see computeTotals().
    useCartStore.getState().addItem(makeProduct({ selling_price: 100, tax_rate: 10 }), 1)
    useCartStore.getState().setGlobalDiscount(10)
    const s = useCartStore.getState()
    // subtotal 100, global disc 10, tax 10 (on pre-discount), total = 100 - 10 + 10 = 100
    expect(s.subtotal).toBe(100)
    expect(s.discountAmount).toBe(10)
    expect(s.taxAmount).toBe(10)
    expect(s.total).toBe(100)
  })

  it('item discount 50% on a 100-unit line: line_tax 5, line_total 55', () => {
    const product = makeProduct({ id: 'p1', selling_price: 100, tax_rate: 10 })
    useCartStore.getState().addItem(product, 1)
    useCartStore.getState().setItemDiscount('p1', 50)
    const s = useCartStore.getState()
    const item = s.items[0]
    expect(item.discount_amount).toBe(50)
    expect(item.tax_amount).toBe(5)
    expect(item.line_total).toBe(55)
    // totals: subtotal 100, discount 50, tax 5, total 55
    expect(s.subtotal).toBe(100)
    expect(s.discountAmount).toBe(50)
    expect(s.taxAmount).toBe(5)
    expect(s.total).toBe(55)
  })

  it('combining item + global discount compounds correctly', () => {
    // Per-line tax is computed on (gross - line disc); global discount only affects total.
    useCartStore.getState().addItem(makeProduct({ id: 'p1', selling_price: 100, tax_rate: 10 }), 1)
    useCartStore.getState().setItemDiscount('p1', 20)   // line: 100, disc 20, tax 8
    useCartStore.getState().setGlobalDiscount(10)       // global on subtotal 100 = 10
    const s = useCartStore.getState()
    expect(s.subtotal).toBe(100)
    expect(s.discountAmount).toBe(30)                   // 20 (line) + 10 (global)
    expect(s.taxAmount).toBe(8)                          // tax is on per-line discounted base
    expect(s.total).toBe(78)                             // 100 - 30 + 8
  })
})

describe('useCartStore — item manipulation', () => {
  it('addItem with same product id increments quantity instead of duplicating', () => {
    const product = makeProduct({ id: 'p1' })
    useCartStore.getState().addItem(product, 1)
    useCartStore.getState().addItem(product, 2)
    const s = useCartStore.getState()
    expect(s.items).toHaveLength(1)
    expect(s.items[0].quantity).toBe(3)
  })

  it('updateQty with 0 removes the line', () => {
    useCartStore.getState().addItem(makeProduct({ id: 'p1' }), 1)
    useCartStore.getState().updateQty('p1', 0)
    expect(useCartStore.getState().items).toHaveLength(0)
  })

  it('updateQty with negative removes the line (defensive)', () => {
    useCartStore.getState().addItem(makeProduct({ id: 'p1' }), 1)
    useCartStore.getState().updateQty('p1', -3)
    expect(useCartStore.getState().items).toHaveLength(0)
  })

  it('removeItem deletes the matching line and leaves others alone', () => {
    useCartStore.getState().addItem(makeProduct({ id: 'p1' }), 1)
    useCartStore.getState().addItem(makeProduct({ id: 'p2' }), 1)
    useCartStore.getState().removeItem('p1')
    const s = useCartStore.getState()
    expect(s.items).toHaveLength(1)
    expect(s.items[0].product.id).toBe('p2')
  })

  it('setItemDiscount clamps pct to [0, 100]', () => {
    useCartStore.getState().addItem(makeProduct({ id: 'p1' }), 1)
    useCartStore.getState().setItemDiscount('p1', 999)
    expect(useCartStore.getState().items[0].discount_pct).toBe(100)
    useCartStore.getState().setItemDiscount('p1', -5)
    expect(useCartStore.getState().items[0].discount_pct).toBe(0)
  })
})

describe('useCartStore — meta state', () => {
  it('setCustomer stores the customer', () => {
    const c = makeCustomer()
    useCartStore.getState().setCustomer(c)
    expect(useCartStore.getState().customer).toEqual(c)
  })

  it('setBillType changes bill type', () => {
    useCartStore.getState().setBillType('CREDIT')
    expect(useCartStore.getState().billType).toBe('CREDIT')
  })

  it('setGlobalDiscount clamps to [0, 100]', () => {
    useCartStore.getState().setGlobalDiscount(150)
    expect(useCartStore.getState().globalDiscount).toBe(100)
    useCartStore.getState().setGlobalDiscount(-10)
    expect(useCartStore.getState().globalDiscount).toBe(0)
  })

  it('clear() resets to empty defaults', () => {
    useCartStore.getState().addItem(makeProduct({ id: 'p1' }), 5)
    useCartStore.getState().setGlobalDiscount(25)
    useCartStore.getState().setCustomer(makeCustomer())
    useCartStore.getState().setBillType('QUOTATION')
    useCartStore.getState().clear()
    const s = useCartStore.getState()
    expect(s.items).toEqual([])
    expect(s.globalDiscount).toBe(0)
    expect(s.customer).toBeNull()
    expect(s.billType).toBe('RETAIL')
    expect(s.total).toBe(0)
  })
})
