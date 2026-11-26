import type Database from 'better-sqlite3'
import { randomUUID } from 'crypto'
import { queueInventoryRecord } from './inventoryOutbox'

const PATTERN = /^[A-Za-z0-9-]{3,64}$/

export function normalizeBarcode(value: unknown): string {
  return String(value ?? '').trim()
}

/** Which product (if any) already owns this code, as primary or additional barcode. */
export function barcodeOwner(db: Database.Database, barcode: string): { id: string; name: string } | undefined {
  const code = normalizeBarcode(barcode)
  if (!code) return undefined
  const primary = db.prepare('SELECT id,name FROM products WHERE barcode=? LIMIT 1').get(code) as { id: string; name: string } | undefined
  if (primary) return primary
  const hasTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='product_barcodes'").get()
  if (!hasTable) return undefined
  return db.prepare(`SELECT p.id,p.name FROM product_barcodes b JOIN products p ON p.id=b.product_id
    WHERE b.barcode=? AND b.is_active=1 LIMIT 1`).get(code) as { id: string; name: string } | undefined
}

/**
 * Gives a product a barcode. A product without a primary barcode gets it as the
 * primary; otherwise it is stored as an additional barcode. Both are queued for
 * sync in the same transaction.
 */
export function addProductBarcode(db: Database.Database, input: { productId: string; barcode: string; userId?: string | null }) {
  const code = normalizeBarcode(input.barcode)
  if (!PATTERN.test(code)) throw new Error('Barcode must be 3-64 letters, digits or dashes')
  return db.transaction(() => {
    const product = db.prepare('SELECT * FROM products WHERE id=?').get(input.productId) as Record<string, unknown> | undefined
    if (!product) throw new Error('Product not found')
    const owner = barcodeOwner(db, code)
    if (owner && owner.id !== input.productId) throw new Error(`Barcode already belongs to ${owner.name}`)
    if (owner) return { product_id: input.productId, barcode: code, kind: 'existing' as const }
    if (!normalizeBarcode(product.barcode)) {
      db.prepare("UPDATE products SET barcode=?,updated_at=datetime('now') WHERE id=?").run(code, input.productId)
      queueInventoryRecord(db, 'products', db.prepare('SELECT * FROM products WHERE id=?').get(input.productId) as Record<string, unknown>, 'UPDATE')
      return { product_id: input.productId, barcode: code, kind: 'primary' as const }
    }
    const row = { id: randomUUID(), product_id: input.productId, barcode: code, is_active: 1, created_by: input.userId || null }
    db.prepare('INSERT INTO product_barcodes(id,product_id,barcode,is_active,created_by) VALUES(@id,@product_id,@barcode,@is_active,@created_by)').run(row)
    queueInventoryRecord(db, 'product_barcodes', db.prepare('SELECT * FROM product_barcodes WHERE id=?').get(row.id) as Record<string, unknown>)
    return { product_id: input.productId, barcode: code, kind: 'additional' as const }
  }).immediate()
}

/** EAN-13 in the in-store 28xxxxx range (outside the 20-24 weighing-scale prefixes). */
export function generateInternalBarcode(db: Database.Database): string {
  for (let attempt = 0; attempt < 20; attempt++) {
    const base = '28' + String(Date.now()).slice(-7) + String(Math.floor(Math.random() * 1000)).padStart(3, '0')
    let sum = 0
    for (let i = 0; i < 12; i++) sum += Number(base[i]) * (i % 2 === 0 ? 1 : 3)
    const code = base + ((10 - (sum % 10)) % 10)
    if (!barcodeOwner(db, code)) return code
  }
  throw new Error('Could not generate a unique barcode; try again')
}
