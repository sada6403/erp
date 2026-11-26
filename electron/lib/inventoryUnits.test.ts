import {describe,it,expect} from 'vitest'
import {stockUnitFactor} from './inventoryUnits'
describe('inventory unit conversions',()=>{
 it.each([['g','kg',0.001],['kg','g',1000],['ml','litre',0.001],['litre','ml',1000],['pieces','pcs',1],['bags','bag',1]])('%s to %s', (from,to,expected)=>expect(stockUnitFactor(from,to)).toBe(expected))
 it('uses product-specific bag and carton sizes',()=>{
  expect(stockUnitFactor('cartons','pieces',[{uom_name:'carton',conversion_factor:24}])).toBe(24)
  expect(stockUnitFactor('bag','kg',[{uom_name:'bag',conversion_factor:50}])).toBe(50)
 })
 it('rejects incompatible measurements and unconfigured packs',()=>{
  expect(()=>stockUnitFactor('kg','ltr')).toThrow(/No conversion/)
  expect(()=>stockUnitFactor('carton','pcs')).toThrow(/pack size/)
 })
})
