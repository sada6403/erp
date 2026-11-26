import { normalizeKeyword, foldTanglish } from './keywordNormalize'

export interface SearchKeyword {
  id: string; product_id: string; keyword: string; keyword_normalized: string; keyword_type: string;
  scope_type: string; branch_id?: string | null; terminal_id?: string | null; user_id?: string | null;
  is_active: number | boolean; review_status: string
}
export interface KeywordSearchContext { userId: string; terminalId: string; branchId: string }
export interface SearchMaster { id: string; name: string; sku: string; barcode?: string; extra_barcodes?: string | null; is_active?: number | boolean }
const codesOf = (product: SearchMaster) => [product.sku, product.barcode, ...String(product.extra_barcodes || '').split('|')].filter(Boolean).map(code => normalizeKeyword(String(code)))
export interface KeywordMatch { productId: string; matchedBy?: string; scope?: string; strength: number }
const priority: Record<string,number> = { user:4, terminal:3, branch:2, global:1 }
const grams = (value: string) => new Set(Array.from({ length: Math.max(0,value.length-2) },(_,i)=>value.slice(i,i+3)))

/** Immutable, authorized local snapshot. Matches contain metadata, never a
 * translated product name. Numeric queries never enter partial/fuzzy search. */
export class KeywordSearchIndex {
  private records: { keyword: SearchKeyword; keys: string[] }[] = []
  private exact = new Map<string,Set<number>>()
  private prefixes = new Map<string,Set<number>>()
  private trigrams = new Map<string,Set<number>>()
  private masters: SearchMaster[]
  constructor(products: SearchMaster[], keywords: SearchKeyword[], context: KeywordSearchContext) {
    this.masters = products.filter(product => product.is_active !== false && product.is_active !== 0)
    const productIds = new Set(this.masters.map(product=>product.id))
    const add = (map: Map<string,Set<number>>, key:string, index:number) => { let set=map.get(key);if(!set){set=new Set();map.set(key,set)}set.add(index) }
    for (const keyword of keywords) {
      const visible = keyword.scope_type==='global' || keyword.scope_type==='branch' && keyword.branch_id===context.branchId || keyword.scope_type==='terminal' && keyword.terminal_id===context.terminalId || keyword.scope_type==='user' && keyword.user_id===context.userId
      if (!visible || !keyword.is_active || keyword.review_status!=='approved' || !productIds.has(keyword.product_id)) continue
      const normalized=normalizeKeyword(keyword.keyword_normalized), keys=[...new Set([normalized,foldTanglish(normalized)])]
      const index=this.records.length
      this.records.push({ keyword,keys })
      for(const key of keys) {
        add(this.exact,key,index)
        for(const word of new Set([key,...key.split(' ')])) for(let n=1;n<=Math.min(word.length,32);n++) add(this.prefixes,word.slice(0,n),index)
        for(const gram of grams(key)) add(this.trigrams,gram,index)
      }
    }
  }
  search(query:string, limit=30, masterFallback: SearchMaster[] = []): KeywordMatch[] {
    const q=normalizeKeyword(query)
    if(!q || limit<=0) return []
    const numeric=/^\d+$/.test(q), queries=[...new Set([q,foldTanglish(q)])]
    const candidates=new Map<number,number>()
    for(const key of queries) {
      for(const index of this.exact.get(key)||[]) candidates.set(index,4)
      if(numeric) continue
      for(const index of this.prefixes.get(key)||[]) candidates.set(index,Math.max(candidates.get(index)||0,3))
      const queryGrams=grams(key)
      if(key.length>=3) {
        const postings=[...queryGrams].map(gram=>this.trigrams.get(gram)||new Set<number>()).sort((a,b)=>a.size-b.size)
        for(const index of postings[0]||[]) {
          if(this.records[index].keys.some(value=>value.includes(key))) candidates.set(index,Math.max(candidates.get(index)||0,2))
        }
        if(!candidates.size && key.length>=4) {
          const overlap=new Map<number,number>()
          for(const gram of queryGrams) for(const index of this.trigrams.get(gram)||[]) overlap.set(index,(overlap.get(index)||0)+1)
          for(const [index,count] of overlap) if(count/queryGrams.size>=0.5) candidates.set(index,1)
        }
      } else {
        this.records.forEach((record,index)=>{if(record.keys.some(value=>value.includes(key)))candidates.set(index,Math.max(candidates.get(index)||0,2))})
      }
    }
    const best=new Map<string,{match:KeywordMatch;rank:number}>()
    const offer=(match:KeywordMatch,rank:number)=>{if(!best.has(match.productId)||best.get(match.productId)!.rank<rank)best.set(match.productId,{match,rank})}
    for(const [index,strength] of candidates) {
      const keyword=this.records[index].keyword
      if(numeric && keyword.keyword_type!=='code')continue
      offer({productId:keyword.product_id,matchedBy:keyword.keyword,scope:keyword.scope_type,strength},strength*100+(priority[keyword.scope_type]||0)*10)
    }
    // Digits are a barcode/SKU. From 4 digits, match any part of a code (also additional barcodes) so a partly typed barcode still lists the product.
    // Short numbers (quick codes such as 1 or 12) stay exact.
    const fallback=numeric ? best.size ? [] : this.masters.filter(product=>codesOf(product).some(code=>q.length>=4 ? code.includes(q) : code===q)) : masterFallback
    for(const product of fallback) {
      const texts=[normalizeKeyword(product.name),...codesOf(product)]
      const strength=texts.includes(q)?4:texts.some(value=>value.split(' ').some(word=>word.startsWith(q)))?3:texts.some(value=>value.includes(q))?2:1
      offer({productId:product.id,strength},strength*100)
    }
    return [...best.values()].sort((a,b)=>b.rank-a.rank||a.match.productId.localeCompare(b.match.productId)).slice(0,limit).map(row=>row.match)
  }
}
