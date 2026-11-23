import {describe,it,expect} from 'vitest'
import {PosCatalog} from './posCatalog'
import type {Product} from '@/types'

describe('keyword catalog bill-name regression',()=>{
  it('returns the unchanged master object to cart and print paths when an alias matches',()=>{
    const master={id:'rice',name:'Premium Rice',sku:'R',is_active:true} as Product
    const catalog=new PosCatalog([master],{context:{userId:'u',terminalId:'t',branchId:'b'},keywords:[{id:'k',product_id:'rice',keyword:'அரிசி',keyword_normalized:'அரிசி',keyword_type:'native_script',scope_type:'user',user_id:'u',is_active:1,review_status:'approved'}]})
    expect(catalog.search('அரிசி')[0]).toBe(master)
    expect(catalog.search('அரிசி')[0].name).toBe('Premium Rice')
    expect(catalog.match('அரிசி','rice')?.matchedBy).toBe('அரிசி')
    expect(new PosCatalog([master]).search('அரிசி')).toEqual([])
  })
  it('keeps previous numeric prefix behavior OFF, uses exact-only codes ON',()=>{
    const master={id:'milk',name:'Milk',sku:'10',is_active:true} as Product
    expect(new PosCatalog([master]).search('1')[0]).toBe(master)
    const enabled=new PosCatalog([master],{context:{userId:'u',terminalId:'t',branchId:'b'},keywords:[]})
    expect(enabled.search('1')).toEqual([])
    expect(enabled.search('10')[0]).toBe(master)
  })
})
