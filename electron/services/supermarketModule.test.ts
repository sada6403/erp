import { describe, expect, it } from 'vitest'
import { usesSupermarketStock } from './supermarketModule'
describe('supermarket stock module scope', () => {
  it('enables only supermarket companies or explicitly opted-in workspaces', () => {
    expect(usesSupermarketStock({ business_type: 'retail' })).toBe(false)
    expect(usesSupermarketStock({ business_type: 'furniture' })).toBe(false)
    expect(usesSupermarketStock({ business_type: 'supermarket' })).toBe(true)
    expect(usesSupermarketStock({ business_type: 'retail', supermarket_stock_enabled: true })).toBe(true)
    expect(usesSupermarketStock({ business_type: 'retail', supermarket_stock_enabled: 'false' })).toBe(false)
  })
})
