import type { IpcMain } from 'electron'
import { dialog, app } from 'electron'
import { getDb } from '../database'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { enqueuSync } from '../services/syncQueue'
import Store from 'electron-store'
import { CloudApi } from '../services/cloudApi'

const store = new Store()

function getAuthUser(): Record<string, unknown> | undefined {
  return store.get('auth_user') as Record<string, unknown> | undefined
}

function isSuperAdmin(user: Record<string, unknown> | undefined): boolean {
  if (!user) return false
  const perms = (user.role as Record<string, unknown>)?.permissions as Record<string, unknown>
    || user.permissions as Record<string, unknown>
    || {}
  return Boolean(perms.all)
}

function csvCell(value: unknown): string {
  const text = String(value ?? '')
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

export function registerProductHandlers(ipcMain: IpcMain) {
  ipcMain.handle('products:list', (_e, filters: { category_id?: string; is_active?: boolean } = {}) => {
    try {
      const db = getDb()
      const authUser = getAuthUser()
      const superAdmin = isSuperAdmin(authUser)
      const branchId = authUser?.branch_id as string | undefined

      let sql = `
        SELECT p.*, c.name as category_name,
               COALESCE(s.quantity, 0) as stock
        FROM products p
        LEFT JOIN categories c ON c.id = p.category_id
        LEFT JOIN stocks s ON s.product_id = p.id AND s.branch_id = ?
        WHERE 1=1
      `
      const params: unknown[] = [branchId || null]

      // Branch users see only their branch products + global (NULL branch) products
      if (!superAdmin && branchId) {
        sql += ' AND (p.branch_id = ? OR p.branch_id IS NULL)'
        params.push(branchId)
      }

      if (filters.category_id) { sql += ' AND p.category_id = ?'; params.push(filters.category_id) }
      if (filters.is_active !== undefined) { sql += ' AND p.is_active = ?'; params.push(filters.is_active ? 1 : 0) }
      sql += ' ORDER BY p.name'
      return { success: true, data: db.prepare(sql).all(...params) }
    } catch (err: unknown) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle('products:search', (_e, query: string) => {
    try {
      const db = getDb()
      const authUser = getAuthUser()
      const superAdmin = isSuperAdmin(authUser)
      const branchId = authUser?.branch_id as string | undefined

      const q = `%${query}%`
      let sql = `
        SELECT p.*, COALESCE(s.quantity, 0) as stock
        FROM products p
        LEFT JOIN stocks s ON s.product_id = p.id AND s.branch_id = ?
        WHERE p.is_active = 1
          AND (p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ?)
      `
      const params: unknown[] = [branchId || null, q, q, q]

      sql += ' ORDER BY p.name LIMIT 50'
      return { success: true, data: db.prepare(sql).all(...params) }
    } catch (err: unknown) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle('products:searchSku', (_e, sku: string) => {
    try {
      const db = getDb()
      const authUser = getAuthUser()
      const branchId = authUser?.branch_id as string | undefined
      const row = db.prepare(`
        SELECT p.*, COALESCE(s.quantity, 0) as stock
        FROM products p
        LEFT JOIN stocks s ON s.product_id = p.id AND s.branch_id = ?
        WHERE p.sku = ? OR p.barcode = ?
        LIMIT 1
      `).get(branchId || null, sku, sku)
      return { success: true, data: row || null }
    } catch (err: unknown) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle('products:get', (_e, id: string) => {
    try {
      const db = getDb()
      const row = db.prepare('SELECT * FROM products WHERE id = ?').get(id)
      return { success: true, data: row || null }
    } catch (err: unknown) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle('products:create', async (_e, payload) => {
    try {
      const db = getDb()
      const id = crypto.randomUUID()
      const authUser = getAuthUser()
      // Super admin creates global products (branch_id = NULL); branch users tag to their branch
      const branch_id = isSuperAdmin(authUser) ? null : (authUser?.branch_id as string || null)

      db.prepare(`
        INSERT INTO products (id, branch_id, category_id, supplier_id, sku, barcode, name, description,
          image_url, unit, cost_price, selling_price, tax_rate, min_stock_level)
        VALUES (@id, @branch_id, @category_id, @supplier_id, @sku, @barcode, @name, @description,
          @image_url, @unit, @cost_price, @selling_price, @tax_rate, @min_stock_level)
      `).run({ id, branch_id, ...payload })

      await enqueuSync('products', id, 'INSERT', { id, branch_id, ...payload })
      return { success: true, data: { id } }
    } catch (err: unknown) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle('products:update', async (_e, id: string, payload) => {
    try {
      const db = getDb()
      const fields = Object.keys(payload).map(k => `${k} = @${k}`).join(', ')
      db.prepare(`UPDATE products SET ${fields}, updated_at = datetime('now') WHERE id = @id`)
        .run({ ...payload, id })

      await enqueuSync('products', id, 'UPDATE', { id, ...payload })
      return { success: true }
    } catch (err: unknown) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle('products:delete', async (_e, id: string) => {
    try {
      const db = getDb()
      db.prepare("UPDATE products SET is_active = 0, updated_at = datetime('now') WHERE id = ?").run(id)
      await enqueuSync('products', id, 'UPDATE', { id, is_active: 0 })
      return { success: true }
    } catch (err: unknown) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle('products:selectAndUploadImage', async (_e) => {
    try {
      const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] }]
      })

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, error: 'Cancelled' }
      }

      const filePath = result.filePaths[0]
      const ext = path.extname(filePath)
      const fileName = `${crypto.randomUUID()}${ext}`

      // Create uploads directory if not exists
      const userDataPath = app.getPath('userData')
      const uploadsDir = path.join(userDataPath, 'uploads')
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true })
      }

      const destPath = path.join(uploadsDir, fileName)
      fs.copyFileSync(filePath, destPath)

      const localUrl = `app-img://${fileName}`

      // Try uploading to the self-hosted Next.js API if configured and online
      const settings = store.get('app_settings') as Record<string, unknown> | undefined
      const url = String(settings?.cloud_api_url || '').trim()
      const key = String(settings?.cloud_api_key || '').trim()

      if (url && key) {
        try {
          const contentTypes: Record<string, string> = {
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.png': 'image/png',
            '.gif': 'image/gif',
            '.webp': 'image/webp',
          }
          const contentType = contentTypes[ext.toLowerCase()]
          if (contentType) {
            const publicUrl = await new CloudApi({ baseUrl: url, apiKey: key })
              .uploadImage(destPath, fileName, contentType)
            return { success: true, data: publicUrl }
          }
        } catch (err) {
          console.error('[ImageUpload] Cloud upload failed, using local fallback:', err)
        }
      }

      return { success: true, data: localUrl }
    } catch (err: unknown) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('products:importExcel', async () => {
    try {
      const { filePaths } = await dialog.showOpenDialog({
        title: 'Select Excel File',
        filters: [{ name: 'Excel', extensions: ['xlsx', 'xls', 'csv'] }],
        properties: ['openFile']
      })
      if (!filePaths || filePaths.length === 0) return { success: false, error: 'Cancelled' }

      const XLSX = require('xlsx')
      const db = getDb()
      const workbook = XLSX.readFile(filePaths[0])
      const sheet = workbook.Sheets[workbook.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' }) as Record<string, unknown>[]

      if (rows.length === 0) return { success: false, error: 'No data found in file' }

      // Flexible column mapping (case-insensitive, trim)
      const norm = (v: unknown) => String(v ?? '').trim().toLowerCase().replace(/[\s_-]+/g, '')
      const colMap = (row: Record<string, unknown>, ...aliases: string[]): string => {
        const keys = Object.keys(row)
        for (const alias of aliases) {
          const found = keys.find(k => norm(k) === norm(alias))
          if (found) return String(row[found] ?? '').trim()
        }
        return ''
      }

      // Pre-load categories and suppliers by name for lookup
      const cats = db.prepare('SELECT id, name FROM categories').all() as { id: string; name: string }[]
      const sups = db.prepare('SELECT id, name FROM suppliers').all() as { id: string; name: string }[]
      const catMap = new Map(cats.map(c => [c.name.toLowerCase(), c.id]))
      const supMap = new Map(sups.map(s => [s.name.toLowerCase(), s.id]))

      let imported = 0, skipped = 0
      const errors: string[] = []

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i]
        try {
          const name         = colMap(row, 'name', 'productname', 'product name', 'item name', 'itemname')
          const sku          = colMap(row, 'sku', 'code', 'itemcode', 'item code', 'product code')
          const barcode      = colMap(row, 'barcode', 'ean', 'upc')
          const categoryName = colMap(row, 'category', 'categoryname', 'category name')
          const supplierName = colMap(row, 'supplier', 'suppliername', 'supplier name', 'vendor')
          const unit         = colMap(row, 'unit', 'uom', 'measure') || 'pcs'
          const costPrice    = parseFloat(colMap(row, 'cost', 'costprice', 'cost price', 'purchase price') || '0') || 0
          const sellingPrice = parseFloat(colMap(row, 'price', 'sellingprice', 'selling price', 'sale price', 'mrp') || '0') || 0
          const taxRate      = parseFloat(colMap(row, 'tax', 'taxrate', 'tax rate', 'vat') || '0') || 0
          const minStock     = parseInt(colMap(row, 'minstock', 'min stock', 'reorder', 'reorder level') || '5') || 5
          const description  = colMap(row, 'description', 'desc', 'notes')
          const stockQty     = parseInt(colMap(row, 'stock', 'quantity', 'qty', 'opening stock', 'openingstock') || '0') || 0

          if (!name) { skipped++; continue }

          const autoSku = sku || `SKU-${Date.now()}-${i}`
          const categoryId = categoryName ? (catMap.get(categoryName.toLowerCase()) || null) : null
          const supplierId  = supplierName ? (supMap.get(supplierName.toLowerCase()) || null) : null

          // Determine branch ownership for imported products
          const importUser = store.get('auth_user') as Record<string, unknown> | undefined
          const importBranchId = isSuperAdmin(importUser) ? null : (importUser?.branch_id as string || null)

          // Upsert by SKU
          const existing = sku ? db.prepare('SELECT id FROM products WHERE sku = ?').get(autoSku) as { id: string } | undefined : undefined
          const productId = existing ? existing.id : crypto.randomUUID()

          if (existing) {
            db.prepare(`UPDATE products SET name=?, category_id=?, supplier_id=?, barcode=?, unit=?,
              cost_price=?, selling_price=?, tax_rate=?, min_stock_level=?, description=?, updated_at=datetime('now')
              WHERE id=?`).run(name, categoryId, supplierId, barcode || null, unit,
              costPrice, sellingPrice, taxRate, minStock, description || null, productId)
          } else {
            db.prepare(`INSERT INTO products (id, branch_id, name, sku, barcode, category_id, supplier_id, unit,
              cost_price, selling_price, tax_rate, min_stock_level, description)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(productId, importBranchId, name, autoSku, barcode || null,
              categoryId, supplierId, unit, costPrice, sellingPrice, taxRate, minStock, description || null)
            await enqueuSync('products', productId, 'INSERT', {
              id: productId, branch_id: importBranchId, name, sku: autoSku, barcode: barcode || null,
              category_id: categoryId, supplier_id: supplierId, unit, cost_price: costPrice,
              selling_price: sellingPrice, tax_rate: taxRate, min_stock_level: minStock,
              description: description || null, is_active: true
            })
          }

          // Set opening stock
          if (stockQty > 0) {
            const user = store.get('auth_user') as Record<string, unknown>
            const branchId = user?.branch_id as string || 'b1111111-1111-4111-8111-111111111111'
            const existingStock = db.prepare('SELECT id FROM stocks WHERE product_id=? AND branch_id=?').get(productId, branchId)
            if (existingStock) {
              db.prepare(`UPDATE stocks SET quantity=?, updated_at=datetime('now') WHERE product_id=? AND branch_id=?`).run(stockQty, productId, branchId)
            } else {
              db.prepare(`INSERT INTO stocks (id, product_id, branch_id, quantity) VALUES (?,?,?,?)`).run(crypto.randomUUID(), productId, branchId, stockQty)
            }
          }

          imported++
        } catch (rowErr) {
          errors.push(`Row ${i + 2}: ${(rowErr as Error).message}`)
          skipped++
        }
      }

      return { success: true, data: { imported, skipped, errors } }
    } catch (err: unknown) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('products:exportCsv', async () => {
    try {
      const result = await dialog.showSaveDialog({
        title: 'Export Products CSV',
        defaultPath: `products-${new Date().toISOString().slice(0, 10)}.csv`,
        filters: [{ name: 'CSV', extensions: ['csv'] }]
      })
      if (result.canceled || !result.filePath) return { success: false, error: 'Cancelled' }

      const db = getDb()
      const authUser = getAuthUser()
      const superAdmin = isSuperAdmin(authUser)
      const branchId = authUser?.branch_id as string | undefined

      let sql = `
        SELECT p.sku, p.barcode, p.name, c.name as category, sp.name as supplier,
               p.unit, p.cost_price, p.selling_price, p.tax_rate, p.min_stock_level,
               p.description, p.is_active, COALESCE(s.quantity, 0) as stock
        FROM products p
        LEFT JOIN categories c ON c.id = p.category_id
        LEFT JOIN suppliers sp ON sp.id = p.supplier_id
        LEFT JOIN stocks s ON s.product_id = p.id AND s.branch_id = ?
        WHERE 1=1
      `
      const params: unknown[] = [branchId || null]
      if (!superAdmin && branchId) {
        sql += ' AND (p.branch_id = ? OR p.branch_id IS NULL)'
        params.push(branchId)
      }
      sql += ' ORDER BY p.name'

      const rows = db.prepare(sql).all(...params) as Record<string, unknown>[]
      const headers = [
        'sku', 'barcode', 'name', 'category', 'supplier', 'unit', 'cost_price',
        'selling_price', 'tax_rate', 'min_stock_level', 'stock', 'description', 'is_active'
      ]
      const csv = [
        headers.join(','),
        ...rows.map(row => headers.map(h => csvCell(row[h])).join(','))
      ].join('\r\n')

      fs.writeFileSync(result.filePath, csv, 'utf8')
      return { success: true, data: { path: result.filePath, exported: rows.length } }
    } catch (err: unknown) {
      return { success: false, error: (err as Error).message }
    }
  })
}
