export const purchaseMoney=(value:number)=>Math.round((value+Number.EPSILON)*100)/100
const quantity=(value:number)=>Math.round(value*1e6)/1e6

export function purchaseLine(paid:number,cost:number,free=0,discount=0,factor=1){
 if(!Number.isFinite(paid)||paid<=0||!Number.isFinite(free)||free<0)throw new Error('Quantity must be positive and free quantity cannot be negative')
 if(!Number.isFinite(cost)||cost<=0||!Number.isFinite(factor)||factor<=0)throw new Error('Purchase price and unit conversion must be positive')
 const gross=purchaseMoney(paid*cost)
 if(!Number.isFinite(gross)||!Number.isFinite(discount)||discount<0||discount>gross)throw new Error('Discount must be between zero and the line gross amount')
 const total=purchaseMoney(gross-discount),stockQuantity=quantity((paid+free)*factor)
 if(stockQuantity<=0||!Number.isFinite(stockQuantity))throw new Error('Quantity is smaller than supported precision')
 return {quantity:stockQuantity,paid_quantity:quantity(paid*factor),free_quantity:quantity(free*factor),discount_amount:purchaseMoney(discount),purchase_unit_cost:cost/factor,unit_cost:total/stockQuantity,line_total:total,entry_quantity:paid,entry_free_quantity:free,unit_factor:factor}
}

export function weightedPurchaseCost(oldQuantity:number,oldAverage:number,newQuantity:number,newCost:number){
 if([oldQuantity,oldAverage,newQuantity,newCost].some(value=>!Number.isFinite(value)||value<0))throw new Error('Invalid weighted average values')
 const total=oldQuantity+newQuantity
 return total>0?(oldQuantity*oldAverage+newQuantity*newCost)/total:0
}

export function validateMrp(price:number|null|undefined,mrp:number|null|undefined){
 if(mrp!=null&&(!Number.isFinite(mrp)||mrp<=0))throw new Error('MRP must be a positive amount or left empty')
 if(price!=null&&(!Number.isFinite(price)||price<0))throw new Error('Selling price must be a valid non-negative amount')
 if(mrp!=null&&price!=null&&price>mrp+0.000001)throw new Error('Selling price cannot exceed MRP')
}
