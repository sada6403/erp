import {describe,it,expect} from 'vitest'
import {purchaseLine,weightedPurchaseCost,validateMrp} from './purchaseMath'
describe('purchase calculations',()=>{
 it('spreads net invoice cost across paid and free stock',()=>{
  expect(purchaseLine(10,100,2,100)).toMatchObject({quantity:12,paid_quantity:10,free_quantity:2,line_total:900,unit_cost:75})
 })
 it('converts paid and free quantities while preserving money',()=>{
  expect(purchaseLine(500,0.2,100,10,0.001)).toMatchObject({quantity:0.6,paid_quantity:0.5,free_quantity:0.1,line_total:90,unit_cost:150})
 })
 it('uses the required weighted average formula',()=>{
  expect(weightedPurchaseCost(10,100,20,250)).toBe(200)
  expect(weightedPurchaseCost(0,0,5,100)).toBe(100)
 })
 it.each([[-1,100,0,0],[1,0,0,0],[1,100,-1,0],[1,100,0,101],[Infinity,100,0,0]])('rejects invalid receipt arithmetic', (q,c,f,d)=>expect(()=>purchaseLine(q,c,f,d)).toThrow())
 it('validates optional MRP and rejects over-MRP selling',()=>{
  expect(()=>validateMrp(100,null)).not.toThrow()
  expect(()=>validateMrp(100,100)).not.toThrow()
  expect(()=>validateMrp(101,100)).toThrow(/MRP/)
  expect(()=>validateMrp(0,0)).toThrow(/positive/)
 })
})
