/** Display one physical batch per branch while retaining every receipt cost layer. */
export function groupPhysicalBatches<T extends {id:string;product_id:string;batch_number:string|null;expiry_date:string|null;quantity:number;branch_id?:string|null;branch_name?:string|null;batch_identity_id?:string|null;original_quantity?:number;sold_quantity?:number}>(rows:T[]):(T&{layers:T[]})[]{
 const groups=new Map<string,T&{layers:T[]}>()
 for(const row of rows){
  const key=JSON.stringify([row.batch_identity_id||(row.batch_number?[row.product_id,row.batch_number.trim(),row.expiry_date||'']:row.id),row.branch_id||row.branch_name||''])
  const group=groups.get(key)
  if(!group)groups.set(key,{...row,layers:[row]})
  else{group.layers.push(row);group.quantity=Math.round((Number(group.quantity)+Number(row.quantity))*1e6)/1e6;group.original_quantity=Number(group.original_quantity||0)+Number(row.original_quantity||0);group.sold_quantity=Number(group.sold_quantity||0)+Number(row.sold_quantity||0)}
 }
 return [...groups.values()]
}
