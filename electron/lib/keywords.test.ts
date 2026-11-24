import {describe,it,expect} from 'vitest'
import {normalizeKeyword,validateKeyword,transliterationProposals} from './keywordText'
import {KeywordSearchIndex,type SearchKeyword} from './keywordSearch'
const products=[{id:'rice',name:'Rice',sku:'R',is_active:1},{id:'milk',name:'Milk',sku:'10',is_active:1},{id:'tea',name:'Tea',sku:'11',is_active:1}]
const context={userId:'u',terminalId:'t',branchId:'b'}
const alias=(id:string,product_id:string,keyword:string,scope_type='global',extra:Partial<SearchKeyword>={}):SearchKeyword=>({id,product_id,keyword,keyword_normalized:normalizeKeyword(keyword),keyword_type:/^\d+$/.test(keyword)?'code':'word',scope_type,is_active:1,review_status:'approved',...extra})
describe('multilingual keyword search',()=>{
  it('normalizes Unicode, whitespace and invisible characters',()=>{expect(normalizeKeyword('  ARI\u200bSI  Rice  ')).toBe('arisi rice');expect(normalizeKeyword('e\u0301')).toBe('é');expect(()=>validateKeyword('அரிசி😀')).toThrow();expect(()=>validateKeyword('???')).toThrow()})
  it('proposes at most three reviewed Roman variants for native text',()=>{expect(transliterationProposals('அரிசி')).toContain('arisi');expect(transliterationProposals('සහල්').length).toBeGreaterThan(0);expect(transliterationProposals('அரிசி').length).toBeLessThanOrEqual(3)})
  it('numeric 1 excludes SKU 10 and 11, and uses exact fallback only',()=>{
    expect(new KeywordSearchIndex(products,[],context).search('1',30,products)).toEqual([])
    const index=new KeywordSearchIndex(products,[alias('a','rice','1'),alias('b','milk','10')],context)
    expect(index.search('1').map(row=>row.productId)).toEqual(['rice'])
    expect(index.search('11').map(row=>row.productId)).toEqual(['tea'])
  })
  it('isolates users and terminals, hides drafts, ranks scope and deduplicates products',()=>{
    const index=new KeywordSearchIndex(products,[alias('a','rice','arisi'),alias('b','milk','arisi','user',{user_id:'u'}),alias('c','tea','arisi','user',{user_id:'other'}),alias('d','rice','arisi','terminal',{terminal_id:'t'}),alias('e','tea','arisi','terminal',{terminal_id:'other'}),alias('f','tea','arisi','branch',{branch_id:'other'}),alias('g','tea','arisi','global',{review_status:'pending'})],context)
    expect(index.search('arisi').map(row=>row.productId)).toEqual(['milk','rice'])
  })
  it('supports Tamil, Sinhala and tolerant Roman vowels without changing names',()=>{
    const index=new KeywordSearchIndex(products,[alias('a','rice','அரிசி'),alias('b','rice','arisi'),alias('c','rice','சஹல்'),alias('d','rice','සහල්')],context)
    for(const q of ['அரிசி','aarisi','සහල්'])expect(index.search(q)[0].productId).toBe('rice')
    expect(products[0].name).toBe('Rice')
  })
  it('searches a 50k keyword snapshot within 100ms after warmup',()=>{
    const keywords=Array.from({length:50_000},(_,i)=>alias(String(i),'rice',`catalog item ${i}`))
    const index=new KeywordSearchIndex(products,keywords,context)
    index.search('catalog item 43210')
    const start=performance.now();const found=index.search('catalog item 43210');const elapsed=performance.now()-start
    expect(found[0].productId).toBe('rice');expect(elapsed).toBeLessThan(100)
  })
})
