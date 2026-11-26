import { describe, it, expect } from 'vitest'
import { PosCatalog } from './posCatalog'
import { parsePosQuantity, splitQuantitySearch } from './posQuantity'
import type { Product } from '@/types'

const product = (id: string, name: string, sku = id, barcode = '') => ({ id, name, sku, barcode, is_active: true } as Product)

describe('offline cashier catalog', () => {
  it('finds a product by an additional barcode', () => {
    const catalog = new PosCatalog([{ ...product('soap', 'Sunlight', 'TKF-002', '4791034012345'), extra_barcodes: '4791034099991|CTN-555' } as Product])
    expect(catalog.lookup('4791034099991')?.id).toBe('soap')
    expect(catalog.lookup('ctn-555')?.id).toBe('soap')
    expect(catalog.lookup('4791034012345')?.id).toBe('soap')
  })
  it('prioritizes an exact scanner match above names and preserves leading zeroes', () => {
    const catalog = new PosCatalog([product('a', '001234 biscuits'), product('b', 'Milk', 'MILK', '001234')])
    expect(catalog.lookup('001234')?.id).toBe('b')
    expect(catalog.lookup('1234')).toBeUndefined()
    expect(catalog.search('001234')[0].id).toBe('b')
  })
  it('supports prefixes, multiple tokens, bounded results and fuzzy names', () => {
    const catalog = new PosCatalog([product('a', 'Organic coconut milk'), product('b', 'Coconut oil')])
    expect(catalog.search('milk org').map(p => p.id)).toEqual(['a'])
    expect(catalog.search('coconot').map(p => p.id)).toEqual(['a', 'b'])
    expect(catalog.search('coco', 1)).toHaveLength(1)
    expect(catalog.search('')).toEqual([])
  })
  it('replaces updates and removes inactive products without mutating the old snapshot', () => {
    const p = product('a', 'Milk')
    const old = new PosCatalog([p])
    const updated = new PosCatalog([{ ...p, is_active: false }])
    expect(old.search('milk')).toHaveLength(1)
    expect(updated.search('milk')).toHaveLength(0)
  })
})

describe('keyboard quantity entry', () => {
  it('converts mass, volume and length without converting incompatible dimensions', () => {
    expect(parsePosQuantity('500g', 'kg')).toBe(0.5)
    expect(parsePosQuantity('.5kg', 'g')).toBe(500)
    expect(parsePosQuantity('250ml', 'l')).toBe(0.25)
    expect(parsePosQuantity('20cm', 'm')).toBe(0.2)
    expect(parsePosQuantity('2', 'pcs')).toBe(2)
    expect(() => parsePosQuantity('2l', 'kg')).toThrow()
  })
  it.each(['0', '-1', 'Infinity', 'NaN', '1.5.2', '', '1e9'])('rejects invalid entry %s', value => {
    expect(() => parsePosQuantity(value, 'kg')).toThrow()
  })
  it('parses quantity prefix without treating ordinary scanner codes as quantities', () => {
    expect(splitQuantitySearch('5*milk')).toEqual({ query: 'milk', quantity: 5 })
    expect(splitQuantitySearch('001234')).toEqual({ query: '001234' })
  })
})
