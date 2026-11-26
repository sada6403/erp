import type Database from 'better-sqlite3'

const round=(value:number)=>Math.round(value*1e6)/1e6

export function receiptQuantity(ordered:number,previous:number,received:unknown,observed:unknown,requireObserved=false){
  const quantity=Number(received)
  if(!Number.isFinite(quantity)||quantity<0||!Number.isFinite(previous)||previous<0||!Number.isFinite(ordered)||ordered<0)throw new Error('Received quantity must be a valid non-negative number')
  if(requireObserved && observed===undefined)throw new Error('Refresh this purchase order before receiving stock')
  if(observed!==undefined && (!Number.isFinite(Number(observed))||round(Number(observed))!==round(previous)))throw new Error('This purchase order was already updated. Refresh it before receiving more stock.')
  const total=round(previous+quantity)
  if(total>round(ordered))throw new Error('Received quantity exceeds ordered quantity for product')
  return {quantity:round(quantity),total}
}

export function purchaseFullyReceived(db:Database.Database,id:string){
  const row=db.prepare('SELECT COUNT(*) total,SUM(CASE WHEN ROUND(COALESCE(received_qty,0),6)<ROUND(quantity,6) THEN 1 ELSE 0 END) remaining FROM purchase_items WHERE po_id=?').get(id) as {total:number;remaining:number|null}
  return row.total>0 && Number(row.remaining)===0
}
