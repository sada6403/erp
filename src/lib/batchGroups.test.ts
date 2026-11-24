import {describe,it,expect} from 'vitest'
import {groupPhysicalBatches} from './batchGroups'
describe('physical batch quantity display',()=>{
 it('adds receipt quantities without merging different costs or branches',()=>{
  const rows=[{id:'r1',product_id:'p',batch_number:'B1',expiry_date:'2027-01-01',quantity:3,cost_price:100,branch_id:'a'},{id:'r2',product_id:'p',batch_number:'B1',expiry_date:'2027-01-01',quantity:4,cost_price:120,branch_id:'a'},{id:'r3',product_id:'p',batch_number:'B1',expiry_date:'2027-01-01',quantity:2,cost_price:90,branch_id:'b'}]
  const groups=groupPhysicalBatches(rows);expect(groups).toHaveLength(2);expect(groups[0].quantity).toBe(7);expect(groups[0].layers.map(row=>row.cost_price)).toEqual([100,120]);expect(rows[0].quantity).toBe(3)
 })
})
