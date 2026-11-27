import Database from 'better-sqlite3'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { resolveProductSku } from './productSku'

let db: Database.Database
beforeEach(() => {
  db = new Database(':memory:')
  db.exec('CREATE TABLE products (id TEXT PRIMARY KEY, name TEXT, sku TEXT UNIQUE, is_active INTEGER)')
  db.prepare('INSERT INTO products VALUES (?,?,?,?)').run('anchor', 'Anchor 400g', 'NO-SKU-B1B8CE46', 1)
})
afterEach(() => db.close())

it.each(['NO-SKU-B1B8CE46', 'PENDING-ANCHOR'])('promotes the saved barcode when SKU is the placeholder %s', sku => {
  expect(resolveProductSku(db, 'anchor', sku, ' 2873307696959 ')).toBe('2873307696959')
})
it('preserves a genuine SKU when a barcode is added', () => {
  expect(resolveProductSku(db, 'anchor', 'TKF-001', '2873307696959')).toBe('TKF-001')
})
it('keeps the placeholder if there is no barcode', () => {
  expect(resolveProductSku(db, 'anchor', 'NO-SKU-B1B8CE46', '')).toBe('NO-SKU-B1B8CE46')
})
it.each([1, 0])('does not assign a barcode SKU reserved by another product with active status %i', active => {
  db.prepare('INSERT INTO products VALUES (?,?,?,?)').run('other', 'Other product', '2873307696959', active)
  expect(() => resolveProductSku(db, 'anchor', 'NO-SKU-B1B8CE46', '2873307696959')).toThrow('already used')
  expect(db.prepare('SELECT sku FROM products WHERE id=?').get('anchor')).toEqual({ sku: 'NO-SKU-B1B8CE46' })
})
