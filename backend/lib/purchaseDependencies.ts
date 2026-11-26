import type {QueryClient} from './db'
export async function validatePurchaseDependencies(client:Pick<QueryClient,'query'>,record:Record<string,unknown>){
 if(record._purchase_ids===undefined)return
 if(!Array.isArray(record._purchase_ids)||record._purchase_ids.length>1000||record._purchase_ids.some(id=>typeof id!=='string'||!id||id.length>191))throw new Error('Invalid purchase synchronization dependencies')
 const ids=[...new Set(record._purchase_ids as string[])]
 if(!ids.length)return
 const {rows}=await client.query<{id:string}>(`SELECT id FROM purchase_orders WHERE id IN (${ids.map(()=>'?').join(',')})`,ids)
 const present=new Set(rows.map(row=>row.id))
 if(ids.some(id=>!present.has(id)))throw new Error('Purchase synchronization is pending or conflicted; its inventory cannot be synchronized before the purchase is accepted')
}
