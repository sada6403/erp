import { describe, expect, it } from 'vitest'
import { effectiveCost, marginPercent, parseCustomerOffer, parseEntryQuantity, parseSupplierOffer } from './stockEntryMath'

const packs = [{ uom_name: 'Carton', conversion_factor: 24 }, { uom_name: 'Box', conversion_factor: 12 }]

describe('stock entry quantities', () => {
  it('converts cartons, boxes and grams to the base unit', () => {
    expect(parseEntryQuantity('2 ctn', 'pcs', packs)).toMatchObject({ quantity: 2, entry_unit: 'carton', factor: 24, base_quantity: 48 })
    expect(parseEntryQuantity('3box', 'pcs', packs)).toMatchObject({ base_quantity: 36 })
    expect(parseEntryQuantity('500g', 'kg')).toMatchObject({ quantity: 500, entry_unit: 'g', base_quantity: 0.5 })
    expect(parseEntryQuantity('12', 'pcs')).toMatchObject({ quantity: 12, factor: 1, base_quantity: 12 })
    expect(parseEntryQuantity('1.25', 'kg')).toMatchObject({ base_quantity: 1.25 })
  })
  it('rejects unknown packs and bad input', () => {
    expect(() => parseEntryQuantity('2 ctn', 'pcs')).toThrow(/pack size/)
    expect(() => parseEntryQuantity('abc', 'pcs')).toThrow()
    expect(() => parseEntryQuantity('0', 'pcs')).toThrow()
  })
})

describe('supplier offers', () => {
  it('handles percentage, fixed and buy X get Y', () => {
    expect(parseSupplierOffer('10%', 10, 100)).toMatchObject({ discount_amount: 100, offer_free_quantity: 0 })
    expect(parseSupplierOffer('150', 10, 100)).toMatchObject({ discount_amount: 150 })
    expect(parseSupplierOffer('10+1', 25, 100)).toMatchObject({ discount_amount: 0, offer_free_quantity: 2 })
    expect(parseSupplierOffer('buy 12 get 2', 12, 100)).toMatchObject({ offer_free_quantity: 2 })
    expect(parseSupplierOffer('', 10, 100)).toMatchObject({ discount_amount: 0, offer_free_quantity: 0 })
  })
  it('rejects discounts that exceed the line', () => {
    expect(() => parseSupplierOffer('1000', 10, 100)).toThrow()
    expect(() => parseSupplierOffer('120%', 10, 100)).toThrow()
  })
  it('computes effective cost: 10 paid + 2 free = 12 stock units', () => {
    const cost = effectiveCost({ paidQuantity: 10, freeQuantity: 2, unitCost: 120, discount: 0, factor: 1 })
    expect(cost).toMatchObject({ gross: 1200, net: 1200, stock_quantity: 12, unit_cost: 100 })
    expect(marginPercent(125, cost.unit_cost)).toBe(20)
  })
})

describe('customer offers', () => {
  it('reads offer price, percentage and fixed amount', () => {
    expect(parseCustomerOffer('90', 100)).toEqual({ type: 'flat', value: 10, offer_price: 90 })
    expect(parseCustomerOffer('10%', 100)).toEqual({ type: 'percentage', value: 10, offer_price: 90 })
    expect(parseCustomerOffer('-15', 100)).toEqual({ type: 'flat', value: 15, offer_price: 85 })
    expect(parseCustomerOffer('', 100)).toBeNull()
    expect(() => parseCustomerOffer('120', 100)).toThrow()
  })
})
