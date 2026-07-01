const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const Database = require('better-sqlite3')
const XLSX = require('xlsx')

const csvPath = process.argv[2]
const dbPath = process.argv[3]

if (!csvPath || !dbPath) {
  console.error('Usage: node scripts/import-cleaned-woocommerce-to-pos.cjs <csvPath> <dbPath>')
  process.exit(1)
}

function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function normHeader(value) {
  return cleanText(value).toLowerCase().replace(/[\s_-]+/g, '')
}

function getColumn(row, ...aliases) {
  const keys = Object.keys(row)
  for (const alias of aliases) {
    const found = keys.find(key => normHeader(key) === normHeader(alias))
    if (found) return cleanText(row[found])
  }
  return ''
}

function parseNumber(value) {
  const parsed = Number.parseFloat(String(value ?? '').replace(/,/g, '').trim())
  return Number.isFinite(parsed) ? parsed : 0
}

function parseInteger(value) {
  const parsed = Number.parseInt(String(value ?? '').replace(/,/g, '').trim(), 10)
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0
}

function splitCategoryPaths(value) {
  return cleanText(value)
    .split(',')
    .map(pathValue => pathValue.split('>').map(cleanText).filter(Boolean))
    .filter(parts => parts.length > 0)
}

function firstImage(value) {
  return cleanText(cleanText(value).split(',')[0]) || null
}

function hasColumn(db, table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some(row => row.name === column)
}

function enqueueSync(db, table, recordId, operation, payload) {
  db.prepare(`
    INSERT INTO sync_queue (id, table_name, record_id, operation, payload)
    VALUES (?, ?, ?, ?, ?)
  `).run(crypto.randomUUID(), table, recordId, operation, JSON.stringify(payload))
}

function ensureCategoryPath(db, pathParts, syncOps) {
  let parentId = null
  let categoryId = null

  for (const part of pathParts) {
    const existing = db.prepare(`
      SELECT id FROM categories
      WHERE lower(name) = lower(?) AND COALESCE(parent_id, '') = COALESCE(?, '')
      LIMIT 1
    `).get(part, parentId)

    if (existing) {
      categoryId = existing.id
    } else {
      categoryId = crypto.randomUUID()
      db.prepare(`
        INSERT INTO categories (id, parent_id, name, sort_order, is_active)
        VALUES (?, ?, ?, 0, 1)
      `).run(categoryId, parentId, part)
      syncOps.push({
        table: 'categories',
        id: categoryId,
        operation: 'INSERT',
        data: { id: categoryId, parent_id: parentId, name: part, sort_order: 0, is_active: 1 },
      })
    }

    parentId = categoryId
  }

  return categoryId
}

function requireTable(db, table) {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table)
  if (!row) throw new Error(`Missing required table: ${table}`)
}

const resolvedCsv = path.resolve(csvPath)
const resolvedDb = path.resolve(dbPath)
if (!fs.existsSync(resolvedCsv)) throw new Error(`CSV not found: ${resolvedCsv}`)
if (!fs.existsSync(resolvedDb)) throw new Error(`Database not found: ${resolvedDb}`)

const workbook = XLSX.readFile(resolvedCsv)
const sheet = workbook.Sheets[workbook.SheetNames[0]]
const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' })
if (!rows.length) throw new Error('CSV has no rows')

const backupDir = path.resolve('database-backups')
fs.mkdirSync(backupDir, { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const backupPath = path.join(backupDir, `pos-erp-before-woocommerce-import-${stamp}.db`)

const db = new Database(resolvedDb)
db.pragma('foreign_keys = ON')
db.pragma('journal_mode = WAL')
db.pragma('busy_timeout = 5000')

async function main() {
  requireTable(db, 'products')
  requireTable(db, 'categories')
  requireTable(db, 'stocks')
  requireTable(db, 'branches')
  requireTable(db, 'sync_queue')

  await db.backup(backupPath)

  const branch = db.prepare("SELECT id FROM branches WHERE is_active = 1 ORDER BY created_at LIMIT 1").get()
  const stockBranchId = branch?.id || 'b1111111-1111-4111-8111-111111111111'
  const productHasBrand = hasColumn(db, 'products', 'brand')
  const productHasWeight = hasColumn(db, 'products', 'weight')
  const productHasProductType = hasColumn(db, 'products', 'product_type')
  const productHasNotForSale = hasColumn(db, 'products', 'not_for_sale')

  const byId = new Map()
  const bySku = new Map()
  for (const row of rows) {
    const id = getColumn(row, 'ID')
    const sku = getColumn(row, 'SKU')
    if (id) byId.set(id, row)
    if (sku) bySku.set(sku, row)
  }

  const resolveParent = row => {
    const parent = getColumn(row, 'Parent')
    if (!parent) return undefined
    const idMatch = parent.match(/^id:(\d+)$/)
    if (idMatch) return byId.get(idMatch[1])
    return bySku.get(parent)
  }

  const stats = {
    inputRows: rows.length,
    imported: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    deactivatedDuplicates: 0,
    categoriesCreated: 0,
    stockRowsCreated: 0,
    stockRowsUpdated: 0,
    errors: [],
    backupPath,
    dbPath: resolvedDb,
  }

  const importTransaction = db.transaction(() => {
    const syncOps = []
    const categoryCountBefore = db.prepare('SELECT COUNT(*) AS count FROM categories').get().count

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      try {
        const parent = resolveParent(row)
        const inherited = parent || row
        const sku = getColumn(row, 'SKU')
        const name = getColumn(row, 'Name') || sku
        if (!name || !sku) {
          stats.skipped++
          continue
        }

        const wooType = getColumn(row, 'Type').toLowerCase()
        const categoryValue = getColumn(row, 'Categories') || getColumn(inherited, 'Categories')
        const categoryPaths = splitCategoryPaths(categoryValue)
        const categoryId = categoryPaths.length ? ensureCategoryPath(db, categoryPaths[0], syncOps) : null
        const brand = getColumn(inherited, 'Brands', 'Brand') || null
        const description = getColumn(row, 'Description') || getColumn(row, 'Short description') || null
        const imageUrl = firstImage(getColumn(row, 'Images') || getColumn(inherited, 'Images'))
        const sellingPrice = parseNumber(getColumn(row, 'Regular price', 'Sale price'))
        const stockQty = parseInteger(getColumn(row, 'Stock'))
        const barcode = getColumn(row, 'GTIN, UPC, EAN, or ISBN') || null
        const weight = parseNumber(getColumn(row, 'Weight (kg)', 'Weight'))
        const minStock = parseInteger(getColumn(row, 'Low stock amount')) || 5

        const existing = db.prepare('SELECT id FROM products WHERE sku = ?').get(sku)
        const sameName = !existing
          ? db.prepare('SELECT id, sku FROM products WHERE lower(name) = lower(?) AND is_active = 1 ORDER BY updated_at DESC LIMIT 1').get(name)
          : undefined
        const target = existing || sameName

        if (sameName && sameName.sku !== sku) {
          const skuConflict = db.prepare('SELECT id FROM products WHERE sku = ? AND id <> ?').get(sku, sameName.id)
          if (skuConflict) {
            stats.errors.push(`Row ${i + 2}: SKU ${sku} already exists on another product`)
            stats.skipped++
            continue
          }
        }

        const productId = target ? target.id : crypto.randomUUID()
        const payload = {
          id: productId,
          branch_id: null,
          name,
          sku,
          barcode,
          category_id: categoryId,
          supplier_id: null,
          unit: 'pcs',
          cost_price: 0,
          selling_price: sellingPrice,
          tax_rate: 0,
          min_stock_level: minStock,
          description,
          image_url: imageUrl,
          brand,
          weight,
          product_type: wooType === 'variation' ? 'variation' : 'single',
          not_for_sale: wooType === 'variable' ? 1 : 0,
        }

        if (target) {
          const fields = [
            'name=@name',
            'sku=@sku',
            'barcode=@barcode',
            'category_id=@category_id',
            'supplier_id=@supplier_id',
            'unit=@unit',
            'cost_price=@cost_price',
            'selling_price=@selling_price',
            'tax_rate=@tax_rate',
            'min_stock_level=@min_stock_level',
            'description=@description',
            'image_url=@image_url',
            'is_active=1',
          ]
          if (productHasBrand) fields.push('brand=@brand')
          if (productHasWeight) fields.push('weight=@weight')
          if (productHasProductType) fields.push('product_type=@product_type')
          if (productHasNotForSale) fields.push('not_for_sale=@not_for_sale')
          db.prepare(`UPDATE products SET ${fields.join(', ')}, updated_at=datetime('now') WHERE id=@id`).run(payload)
          syncOps.push({ table: 'products', id: productId, operation: 'UPDATE', data: payload })
          stats.updated++
        } else {
          db.prepare(`
            INSERT INTO products (id, branch_id, category_id, supplier_id, sku, barcode, name, description,
              image_url, unit, cost_price, selling_price, tax_rate, min_stock_level)
            VALUES (@id, @branch_id, @category_id, @supplier_id, @sku, @barcode, @name, @description,
              @image_url, @unit, @cost_price, @selling_price, @tax_rate, @min_stock_level)
          `).run(payload)
          if (productHasBrand && brand) db.prepare('UPDATE products SET brand=? WHERE id=?').run(brand, productId)
          if (productHasWeight) db.prepare('UPDATE products SET weight=? WHERE id=?').run(weight, productId)
          if (productHasProductType) db.prepare('UPDATE products SET product_type=? WHERE id=?').run(payload.product_type, productId)
          if (productHasNotForSale) db.prepare('UPDATE products SET not_for_sale=? WHERE id=?').run(payload.not_for_sale, productId)
          syncOps.push({ table: 'products', id: productId, operation: 'INSERT', data: { ...payload, is_active: true } })
          stats.created++
        }

        const duplicates = db.prepare(`
          SELECT id FROM products
          WHERE id <> ? AND lower(name) = lower(?) AND is_active = 1
        `).all(productId, name)
        for (const duplicate of duplicates) {
          db.prepare("UPDATE products SET is_active = 0, updated_at = datetime('now') WHERE id = ?").run(duplicate.id)
          syncOps.push({ table: 'products', id: duplicate.id, operation: 'UPDATE', data: { id: duplicate.id, is_active: 0 } })
          stats.deactivatedDuplicates++
        }

        const existingStock = db.prepare(`
          SELECT id FROM stocks
          WHERE product_id=? AND branch_id=? AND warehouse_id IS NULL
          LIMIT 1
        `).get(productId, stockBranchId)
        if (existingStock) {
          db.prepare("UPDATE stocks SET quantity=?, updated_at=datetime('now') WHERE id=?").run(stockQty, existingStock.id)
          stats.stockRowsUpdated++
        } else {
          db.prepare('INSERT INTO stocks (id, product_id, branch_id, warehouse_id, quantity) VALUES (?,?,?,?,?)')
            .run(crypto.randomUUID(), productId, stockBranchId, null, stockQty)
          stats.stockRowsCreated++
        }

        stats.imported++
      } catch (error) {
        stats.errors.push(`Row ${i + 2}: ${error.message}`)
        stats.skipped++
      }
    }

    stats.categoriesCreated = db.prepare('SELECT COUNT(*) AS count FROM categories').get().count - categoryCountBefore

    for (const op of syncOps) {
      enqueueSync(db, op.table, op.id, op.operation, op.data)
    }
  })

  importTransaction()

  const post = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM products WHERE is_active=1) AS activeProducts,
      (SELECT COUNT(*) FROM products) AS totalProducts,
      (SELECT COUNT(*) FROM stocks) AS stockRows,
      (SELECT COUNT(*) FROM sync_queue WHERE status='pending') AS pendingSync
  `).get()

  console.log(JSON.stringify({ ...stats, ...post }, null, 2))
}

main()
  .catch(error => {
    console.error(error.stack || error.message)
    process.exitCode = 1
  })
  .finally(() => {
    db.close()
  })
