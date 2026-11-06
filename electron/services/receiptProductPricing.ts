import type Database from 'better-sqlite3'

/** Product fields describe the latest receipt; batch costs remain immutable. */
export function applyReceiptProductPrices(db: Database.Database, productId: string, cost: number, sellingPrice: number | null) {
  const product=db.prepare('SELECT * FROM products WHERE id=?').get(productId) as Record<string,unknown>|undefined
  if(!product) throw new Error('Product not found')
  if(sellingPrice==null && !(Number(product.selling_price)>0)) throw new Error(`Enter a selling price for ${product.name || product.sku || 'this product'}; it has no common selling price yet.`)
  if(!Number.isFinite(cost)||cost<0|| (sellingPrice!=null&&(!Number.isFinite(sellingPrice)||sellingPrice<0))) throw new Error('Invalid receipt price')
  db.prepare("UPDATE products SET cost_price=?,selling_price=COALESCE(?,selling_price),updated_at=datetime('now') WHERE id=?").run(cost,sellingPrice,productId)
}

/** Repair only missing product prices from saved receipt values, never stock. */
export function repairMissingReceiptPrices(db: Database.Database, purchaseId: string): Record<string,unknown>[] {
  const products=db.prepare('SELECT DISTINCT product_id FROM purchase_items WHERE po_id=? AND received_qty>0').all(purchaseId) as {product_id:string}[]
  const updated:Record<string,unknown>[]=[]
  for(const {product_id} of products){
    const product=db.prepare('SELECT * FROM products WHERE id=?').get(product_id) as Record<string,unknown>
    const latest=db.prepare(`SELECT cost_price,selling_price FROM product_batches WHERE product_id=? AND historical_cost_known=1 AND purchase_item_id IS NOT NULL
      ORDER BY purchase_date DESC,created_at DESC,id DESC LIMIT 1`).get(product_id) as {cost_price:number;selling_price:number|null}|undefined
    if(!latest) continue
    const cost=Number(product.cost_price)>0 ? Number(product.cost_price) : latest.cost_price
    const sell=Number(product.selling_price)>0 ? Number(product.selling_price) : latest.selling_price ?? Number(product.selling_price||0)
    if(cost===Number(product.cost_price)&&sell===Number(product.selling_price)) continue
    db.prepare("UPDATE products SET cost_price=?,selling_price=?,updated_at=datetime('now') WHERE id=?").run(cost,sell,product_id)
    updated.push(db.prepare('SELECT * FROM products WHERE id=?').get(product_id) as Record<string,unknown>)
  }
  return updated
}
