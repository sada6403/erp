import type { IpcMain } from 'electron'
import { dialog, app } from 'electron'
import { getDb } from '../database'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { enqueuSync } from '../services/syncQueue'
import { logAudit } from '../services/auditLog'
import Store from 'electron-store'
import { CloudApi } from '../services/cloudApi'
import { uploadFile as s3UploadFile } from '../services/s3Service'
import type { S3Config } from '../services/s3Service'
import { decryptSecret } from './settings'
import { buildSku, categoryCodeFromName, normalizeCategoryPath, titleCase } from '../lib/catalog'

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

function normHeader(v: unknown): string {
  return String(v ?? '').trim().toLowerCase().replace(/[\s_-]+/g, '')
}

function cleanText(v: unknown): string {
  return String(v ?? '').replace(/\s+/g, ' ').trim()
}

function parseNumber(v: unknown): number {
  const n = parseFloat(String(v ?? '').replace(/,/g, '').trim())
  return Number.isFinite(n) ? n : 0
}

function parseInteger(v: unknown): number {
  const n = parseInt(String(v ?? '').replace(/,/g, '').trim(), 10)
  return Number.isFinite(n) ? Math.max(0, n) : 0
}

function getColumn(row: Record<string, unknown>, ...aliases: string[]): string {
  const keys = Object.keys(row)
  for (const alias of aliases) {
    const found = keys.find(k => normHeader(k) === normHeader(alias))
    if (found) return cleanText(row[found])
  }
  return ''
}

function hasColumn(db: ReturnType<typeof getDb>, table: string, column: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  return cols.some(c => c.name === column)
}

function isWooCommerceExport(rows: Record<string, unknown>[]): boolean {
  if (!rows.length) return false
  const headers = Object.keys(rows[0]).map(normHeader)
  return (
    headers.includes('type') &&
    headers.includes('regularprice') &&
    headers.includes('categories') &&
    headers.includes('instock?')
  )
}

function splitCategoryPaths(value: string): string[][] {
  return value
    .split(',')
    .map(path => path.split('>').map(cleanText).filter(Boolean))
    .filter(path => path.length > 0)
}

async function ensureCategoryPath(
  db: ReturnType<typeof getDb>,
  pathParts: string[],
  syncOps: { table: string; id: string; operation: 'INSERT' | 'UPDATE'; data: Record<string, unknown> }[]
): Promise<string | null> {
  let parentId: string | null = null
  let categoryId: string | null = null

  for (const part of pathParts) {
    const existing = db.prepare(`
      SELECT id FROM categories
      WHERE lower(name) = lower(?) AND COALESCE(parent_id, '') = COALESCE(?, '')
      LIMIT 1
    `).get(part, parentId) as { id: string } | undefined

    if (existing) {
      categoryId = existing.id
    } else {
      categoryId = crypto.randomUUID()
      const normalized = titleCase(part)
      db.prepare(`
        INSERT INTO categories (id, parent_id, name, short_code, sort_order, is_active)
        VALUES (?, ?, ?, ?, 0, 1)
      `).run(categoryId, parentId, normalized, categoryCodeFromName(normalized))
      syncOps.push({
        table: 'categories',
        id: categoryId,
        operation: 'INSERT',
        data: { id: categoryId, parent_id: parentId, name: normalized, short_code: categoryCodeFromName(normalized), sort_order: 0, is_active: 1 },
      })
    }

    parentId = categoryId
  }

  return categoryId
}

function firstImage(value: string): string | null {
  return cleanText(value.split(',')[0]) || null
}

export function registerProductHandlers(ipcMain: IpcMain) {
  ipcMain.handle('products:list', (_e, filters: { category_id?: string; is_active?: boolean } = {}) => {
    try {
      const db = getDb()
      const authUser = getAuthUser()
      const superAdmin = isSuperAdmin(authUser)
      const branchId = authUser?.branch_id as string | undefined

      // Super admin / no-branch users: sum stock across ALL branches
      // Branch users: stock for their specific branch only
      const stockJoin = (superAdmin || !branchId)
        ? `LEFT JOIN (
             SELECT product_id, SUM(quantity) AS quantity
             FROM stocks GROUP BY product_id
           ) s ON s.product_id = p.id`
        : `LEFT JOIN stocks s ON s.product_id = p.id AND s.branch_id = ?`

      let sql = `
        SELECT p.*, c.name as category_name,
               COALESCE(s.quantity, 0) as stock
        FROM products p
        LEFT JOIN categories c ON c.id = p.category_id
        ${stockJoin}
        WHERE 1=1
      `
      const params: unknown[] = []
      // Branch-scoped users pass branchId as first param for the stock JOIN
      if (!superAdmin && branchId) params.push(branchId)

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
      const stockJoin = (superAdmin || !branchId)
        ? `LEFT JOIN (SELECT product_id, SUM(quantity) AS quantity FROM stocks GROUP BY product_id) s ON s.product_id = p.id`
        : `LEFT JOIN stocks s ON s.product_id = p.id AND s.branch_id = ?`

      let sql = `
        SELECT p.*, COALESCE(s.quantity, 0) as stock
        FROM products p
        ${stockJoin}
        WHERE p.is_active = 1
          AND (p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ?)
      `
      const params: unknown[] = (!superAdmin && branchId) ? [branchId, q, q, q] : [q, q, q]

      sql += ' ORDER BY p.name LIMIT 50'
      return { success: true, data: db.prepare(sql).all(...params) }
    } catch (err: unknown) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle('products:searchSku', (_e, sku: string) => {
    try {
      const db = getDb()
      const authUser = getAuthUser()
      const superAdmin = isSuperAdmin(authUser)
      const branchId = authUser?.branch_id as string | undefined

      const stockJoin = (superAdmin || !branchId)
        ? `LEFT JOIN (SELECT product_id, SUM(quantity) AS quantity FROM stocks GROUP BY product_id) s ON s.product_id = p.id`
        : `LEFT JOIN stocks s ON s.product_id = p.id AND s.branch_id = ?`

      const sql = `
        SELECT p.*, COALESCE(s.quantity, 0) as stock
        FROM products p
        ${stockJoin}
        WHERE p.sku = ? OR p.barcode = ?
        LIMIT 1
      `
      const params: unknown[] = (!superAdmin && branchId) ? [branchId, sku, sku] : [sku, sku]
      return { success: true, data: db.prepare(sql).get(...params) || null }
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
      const category = payload?.category_id
        ? db.prepare('SELECT name FROM categories WHERE id=?').get(payload.category_id) as { name?: string } | undefined
        : undefined
      const sku = buildSku(db, (payload as Record<string, unknown>)?.brand || '', category?.name || (payload as Record<string, unknown>)?.name || '', (payload as Record<string, unknown>)?.sku)

      db.prepare(`
        INSERT INTO products (id, branch_id, category_id, supplier_id, sku, barcode, name, description,
          image_url, unit, cost_price, selling_price, tax_rate, min_stock_level)
        VALUES (@id, @branch_id, @category_id, @supplier_id, @sku, @barcode, @name, @description,
          @image_url, @unit, @cost_price, @selling_price, @tax_rate, @min_stock_level)
      `).run({ id, branch_id, ...payload, sku })

      await enqueuSync('products', id, 'INSERT', { id, branch_id, ...payload, sku })
      return { success: true, data: { id } }
    } catch (err: unknown) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle('products:update', async (_e, id: string, payload) => {
    try {
      const db = getDb()
      const nextPayload = { ...(payload as Record<string, unknown>) }
      if (!String(nextPayload.sku || '').trim()) {
        const category = nextPayload.category_id
          ? db.prepare('SELECT name FROM categories WHERE id=?').get(nextPayload.category_id) as { name?: string } | undefined
          : undefined
        nextPayload.sku = buildSku(db, nextPayload.brand || '', category?.name || nextPayload.name || '', nextPayload.sku)
      }
      const fields = Object.keys(nextPayload).map(k => `${k} = @${k}`).join(', ')
      db.prepare(`UPDATE products SET ${fields}, updated_at = datetime('now') WHERE id = @id`)
        .run({ ...nextPayload, id })

      await enqueuSync('products', id, 'UPDATE', { id, ...nextPayload })
      return { success: true }
    } catch (err: unknown) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle('products:delete', async (_e, id: string) => {
    try {
      const caller = getAuthUser()
      const perms = (caller?.role as Record<string, unknown>)?.permissions as Record<string, unknown>
        || (caller?.permissions as Record<string, unknown>) || {}
      if (!perms.all && !perms.inventory) return { success: false, error: 'Inventory management access required' }

      const db = getDb()
      db.prepare("UPDATE products SET is_active = 0, updated_at = datetime('now') WHERE id = ?").run(id)
      await enqueuSync('products', id, 'UPDATE', { id, is_active: 0 })
      return { success: true }
    } catch (err: unknown) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle('products:permanentDelete', async (_e, id: string, reason: string) => {
    try {
      const db = getDb()
      const caller = getAuthUser()

      // Permissions may be at caller.permissions OR caller.role.permissions
      const rolePerms = (caller?.role as Record<string, unknown>)?.permissions as Record<string, unknown> || {}
      const directPerms = (caller?.permissions as Record<string, unknown>) || {}
      const perms = Object.keys(rolePerms).length ? rolePerms : directPerms
      if (!perms.all) return { success: false, error: 'Only Company Admin can permanently delete products' }

      const product = db.prepare(`SELECT id, name, sku, barcode FROM products WHERE id = ?`).get(id) as Record<string, unknown> | undefined
      if (!product) return { success: false, error: 'Product not found' }

      // Check if product has invoice_items — protect financial history
      const hasInvoiceItems = db.prepare(`SELECT COUNT(*) as cnt FROM invoice_items WHERE product_id = ?`).get(id) as { cnt: number }
      if (hasInvoiceItems.cnt > 0) {
        return { success: false, error: `Cannot permanently delete — this product appears in ${hasInvoiceItems.cnt} invoice(s). Use deactivate instead to preserve financial history.` }
      }

      // Audit log before deletion
      logAudit(db, {
        userId: (caller?.id as string) || null,
        branchId: ((caller?.branch_id || (caller?.branch as Record<string,unknown>)?.id) as string) || null,
        action: 'PRODUCT_PERMANENT_DELETE',
        tableName: 'products',
        recordId: id,
        oldValues: { name: product.name, sku: product.sku, barcode: product.barcode, reason },
      })

      // Remove related stock records then product
      db.prepare(`DELETE FROM stocks WHERE product_id = ?`).run(id)
      db.prepare(`DELETE FROM products WHERE id = ?`).run(id)

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

      const contentTypes: Record<string, string> = {
        '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
        '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp',
      }
      const contentType = contentTypes[ext.toLowerCase()] ?? 'image/octet-stream'

      const settings = store.get('app_settings') as Record<string, unknown> | undefined

      // 1. Try S3 upload first (if configured)
      const s3Enabled = store.get('s3_enabled')
      if (s3Enabled) {
        try {
          const s3Config: S3Config = {
            bucket:    String(store.get('s3_bucket')     || ''),
            region:    String(store.get('s3_region')     || 'us-east-1'),
            accessKey: String(store.get('s3_access_key') || ''),
            secretKey: String(store.get('s3_secret_key') || ''),
            endpoint:  store.get('s3_endpoint')  ? String(store.get('s3_endpoint'))  : undefined,
            cdnUrl:    store.get('s3_cdn_url')   ? String(store.get('s3_cdn_url'))   : undefined,
          }
          if (s3Config.bucket && s3Config.accessKey && s3Config.secretKey) {
            const s3Key = `images/${fileName}`
            const s3Result = await s3UploadFile(destPath, s3Key, s3Config, contentType)
            if (s3Result.success && s3Result.url) {
              return { success: true, data: s3Result.url }
            }
            console.error('[ImageUpload] S3 upload failed:', s3Result.error)
          }
        } catch (err) {
          console.error('[ImageUpload] S3 upload error:', err)
        }
      }

      // 2. Try Cloud API (self-hosted Next.js) upload
      const cloudUrl = String(settings?.cloud_api_url || '').trim()
      const cloudKey = decryptSecret(settings?.cloud_api_key).trim()
      if (cloudUrl && cloudKey) {
        try {
          const publicUrl = await new CloudApi({ baseUrl: cloudUrl, apiKey: cloudKey })
            .uploadImage(destPath, fileName, contentType)
          return { success: true, data: publicUrl }
        } catch (err) {
          console.error('[ImageUpload] Cloud API upload failed, using local fallback:', err)
        }
      }

      // 3. Fall back to local app-img:// URL
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

      if (isWooCommerceExport(rows)) {
        const importUser = store.get('auth_user') as Record<string, unknown> | undefined
        const importBranchId = isSuperAdmin(importUser) ? null : (importUser?.branch_id as string || null)
        const stockBranchId = importUser?.branch_id as string || 'b1111111-1111-4111-8111-111111111111'
        const productHasBrand = hasColumn(db, 'products', 'brand')
        const productHasWeight = hasColumn(db, 'products', 'weight')
        const productHasProductType = hasColumn(db, 'products', 'product_type')
        const productHasNotForSale = hasColumn(db, 'products', 'not_for_sale')
        const syncOps: { table: string; id: string; operation: 'INSERT' | 'UPDATE'; data: Record<string, unknown> }[] = []
        const sups = db.prepare('SELECT id, name FROM suppliers').all() as { id: string; name: string }[]
        const supMap = new Map(sups.map(s => [s.name.toLowerCase(), s.id]))
        const wooById = new Map<string, Record<string, unknown>>()
        const wooBySku = new Map<string, Record<string, unknown>>()

        for (const row of rows) {
          const id = getColumn(row, 'ID')
          const sku = getColumn(row, 'SKU')
          if (id) wooById.set(id, row)
          if (sku) wooBySku.set(sku, row)
        }

        const resolveWooParent = (row: Record<string, unknown>): Record<string, unknown> | undefined => {
          const parent = getColumn(row, 'Parent')
          if (!parent) return undefined
          const idMatch = parent.match(/^id:(\d+)$/)
          if (idMatch) return wooById.get(idMatch[1])
          return wooBySku.get(parent)
        }

        let imported = 0
        let created = 0
        let updated = 0
        let skipped = 0
        let deactivatedDuplicates = 0
        const errors: string[] = []

        for (let i = 0; i < rows.length; i++) {
          const row = rows[i]
          try {
            const parent = resolveWooParent(row)
            const inherited = parent || row
            const sku = getColumn(row, 'SKU')
            const name = getColumn(row, 'Name') || sku
            if (!name) { skipped++; continue }

            const wooType = getColumn(row, 'Type').toLowerCase()
            const categoryValue = normalizeCategoryPath(getColumn(row, 'Categories') || getColumn(inherited, 'Categories'))
            const categoryPaths = splitCategoryPaths(categoryValue)
            const categoryId = categoryPaths.length ? await ensureCategoryPath(db, categoryPaths[0], syncOps) : null
            const supplierName = getColumn(row, 'Supplier', 'Vendor')
            const supplierId = supplierName ? (supMap.get(supplierName.toLowerCase()) || null) : null
            const brand = getColumn(inherited, 'Brands', 'Brand') || null
            const description = getColumn(row, 'Description') || getColumn(row, 'Short description') || null
            const imageUrl = firstImage(getColumn(row, 'Images') || getColumn(inherited, 'Images'))
            const sellingPrice = parseNumber(getColumn(row, 'Regular price', 'Sale price'))
            const stockQty = parseInteger(getColumn(row, 'Stock'))
            const barcode = getColumn(row, 'GTIN, UPC, EAN, or ISBN') || null
            const weight = parseNumber(getColumn(row, 'Weight (kg)', 'Weight'))
            const minStock = parseInteger(getColumn(row, 'Low stock amount')) || 5

            const finalSku = buildSku(db, brand, categoryPaths[0]?.join(' > ') || name, sku)
            const existing = db.prepare('SELECT id FROM products WHERE sku = ?').get(finalSku) as { id: string } | undefined
            const sameName = !existing
              ? db.prepare('SELECT id, sku FROM products WHERE lower(name) = lower(?) AND is_active = 1 ORDER BY updated_at DESC LIMIT 1').get(name) as { id: string; sku: string } | undefined
              : undefined
            const target = existing || sameName

            if (sameName && sameName.sku !== finalSku) {
              const skuConflict = db.prepare('SELECT id FROM products WHERE sku = ? AND id <> ?').get(finalSku, sameName.id) as { id: string } | undefined
              if (skuConflict) {
                errors.push(`Row ${i + 2}: SKU ${finalSku} already exists on another product`)
                skipped++
                continue
              }
            }

            const productId = target ? target.id : crypto.randomUUID()
            const payload = {
              id: productId,
              branch_id: importBranchId,
              name,
              sku: finalSku,
              barcode,
              category_id: categoryId,
              supplier_id: supplierId,
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
              const updateFields = [
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
              if (productHasBrand) updateFields.push('brand=@brand')
              if (productHasWeight) updateFields.push('weight=@weight')
              if (productHasProductType) updateFields.push('product_type=@product_type')
              if (productHasNotForSale) updateFields.push('not_for_sale=@not_for_sale')
              db.prepare(`UPDATE products SET ${updateFields.join(', ')}, updated_at=datetime('now') WHERE id=@id`).run({ ...payload, sku: finalSku })
              syncOps.push({ table: 'products', id: productId, operation: 'UPDATE', data: payload })
              updated++
            } else {
              db.prepare(`INSERT INTO products (id, branch_id, category_id, supplier_id, sku, barcode, name, description,
                image_url, unit, cost_price, selling_price, tax_rate, min_stock_level)
                VALUES (@id, @branch_id, @category_id, @supplier_id, @sku, @barcode, @name, @description,
                @image_url, @unit, @cost_price, @selling_price, @tax_rate, @min_stock_level)`).run({ ...payload, sku: finalSku })
              if (productHasBrand && brand) db.prepare('UPDATE products SET brand=? WHERE id=?').run(brand, productId)
              if (productHasWeight) db.prepare('UPDATE products SET weight=? WHERE id=?').run(weight, productId)
              if (productHasProductType) db.prepare('UPDATE products SET product_type=? WHERE id=?').run(payload.product_type, productId)
              if (productHasNotForSale) db.prepare('UPDATE products SET not_for_sale=? WHERE id=?').run(payload.not_for_sale, productId)
              syncOps.push({ table: 'products', id: productId, operation: 'INSERT', data: { ...payload, sku: finalSku, is_active: true } })
              created++
            }

            const duplicates = db.prepare(`
              SELECT id FROM products
              WHERE id <> ? AND lower(name) = lower(?) AND is_active = 1
            `).all(productId, name) as { id: string }[]
            for (const dup of duplicates) {
              db.prepare("UPDATE products SET is_active = 0, updated_at = datetime('now') WHERE id = ?").run(dup.id)
              syncOps.push({ table: 'products', id: dup.id, operation: 'UPDATE', data: { id: dup.id, is_active: 0 } })
              deactivatedDuplicates++
            }

            const existingStock = db.prepare(`
              SELECT id FROM stocks
              WHERE product_id=? AND branch_id=? AND warehouse_id IS NULL
            `).get(productId, stockBranchId) as { id: string } | undefined
            if (existingStock) {
              db.prepare('UPDATE stocks SET quantity=?, updated_at=datetime("now") WHERE id=?').run(stockQty, existingStock.id)
            } else {
              db.prepare('INSERT INTO stocks (id, product_id, branch_id, warehouse_id, quantity) VALUES (?,?,?,?,?)')
                .run(crypto.randomUUID(), productId, stockBranchId, null, stockQty)
            }

            imported++
          } catch (rowErr) {
            errors.push(`Row ${i + 2}: ${(rowErr as Error).message}`)
            skipped++
          }
        }

        for (const op of syncOps) {
          await enqueuSync(op.table, op.id, op.operation, op.data)
        }

        return {
          success: true,
          data: { imported, created, updated, skipped, deactivatedDuplicates, errors, mode: 'woocommerce' }
        }
      }

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

          const normalizedCategory = normalizeCategoryPath(categoryName)
          const autoSku = buildSku(db, '', normalizedCategory || categoryName || name, sku)
          const categoryId = normalizedCategory ? (catMap.get(titleCase(normalizedCategory).toLowerCase()) || null) : null
          const supplierId  = supplierName ? (supMap.get(supplierName.toLowerCase()) || null) : null

          // Determine branch ownership for imported products
          const importUser = store.get('auth_user') as Record<string, unknown> | undefined
          const importBranchId = isSuperAdmin(importUser) ? null : (importUser?.branch_id as string || null)

          // Upsert by SKU
          const existing = db.prepare('SELECT id FROM products WHERE sku = ?').get(autoSku) as { id: string } | undefined
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

  ipcMain.handle('products:normalizeCatalog', async () => {
    try {
      const db = getDb()
      const syncOps: { table: string; id: string; operation: 'INSERT' | 'UPDATE'; data: Record<string, unknown> }[] = []
      let categoriesUpdated = 0
      let productsUpdated = 0

      const categories = db.prepare('SELECT * FROM categories ORDER BY parent_id, sort_order, name').all() as Record<string, unknown>[]
      for (const cat of categories) {
        const name = titleCase(cat.name)
        const shortCode = String(cat.short_code || '').trim() || categoryCodeFromName(name)
        const patch: Record<string, unknown> = {}
        if (name !== cat.name) patch.name = name
        if (shortCode !== cat.short_code) patch.short_code = shortCode
        if (Object.keys(patch).length) {
          db.prepare(`UPDATE categories SET ${Object.keys(patch).map(k => `${k}=@${k}`).join(', ')}, updated_at=datetime('now') WHERE id=@id`)
            .run({ ...patch, id: cat.id })
          syncOps.push({ table: 'categories', id: String(cat.id), operation: 'UPDATE', data: { id: cat.id, ...patch } })
          categoriesUpdated++
        }
      }

      const products = db.prepare(`
        SELECT p.*, c.name AS category_name
        FROM products p
        LEFT JOIN categories c ON c.id = p.category_id
        WHERE p.is_active = 1
        ORDER BY p.name
      `).all() as Record<string, unknown>[]

      const seen = new Set<string>()
      for (const product of products) {
        const categoryName = String(product.category_name || '').trim()
        const brand = String(product.brand || '').trim()
        const sku = String(product.sku || '').trim()
        const generated = buildSku(db, brand, categoryName || String(product.name || ''), sku)
        let nextSku = generated
        let suffix = 2
        while (seen.has(nextSku) || db.prepare('SELECT id FROM products WHERE sku=? AND id<>?').get(nextSku, product.id)) {
          nextSku = `${generated}-${suffix++}`
        }
        seen.add(nextSku)
        if (nextSku !== sku) {
          db.prepare('UPDATE products SET sku=?, updated_at=datetime("now") WHERE id=?').run(nextSku, product.id)
          syncOps.push({ table: 'products', id: String(product.id), operation: 'UPDATE', data: { id: product.id, sku: nextSku } })
          productsUpdated++
        } else {
          seen.add(sku)
        }
      }

      for (const op of syncOps) {
        await enqueuSync(op.table, op.id, op.operation, op.data)
      }

      return { success: true, data: { categoriesUpdated, productsUpdated } }
    } catch (err: unknown) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('products:catalogAudit', async () => {
    try {
      const db = getDb()
      const missingSku = db.prepare(`
        SELECT COUNT(*) AS count
        FROM products
        WHERE is_active = 1 AND (sku IS NULL OR TRIM(sku) = '')
      `).get() as { count: number }

      const duplicateSkuGroups = db.prepare(`
        SELECT COUNT(*) AS count FROM (
          SELECT sku
          FROM products
          WHERE is_active = 1 AND sku IS NOT NULL AND TRIM(sku) != ''
          GROUP BY sku
          HAVING COUNT(*) > 1
        )
      `).get() as { count: number }

      const duplicateSkuProducts = db.prepare(`
        SELECT COALESCE(SUM(cnt - 1), 0) AS count FROM (
          SELECT COUNT(*) AS cnt
          FROM products
          WHERE is_active = 1 AND sku IS NOT NULL AND TRIM(sku) != ''
          GROUP BY sku
          HAVING COUNT(*) > 1
        )
      `).get() as { count: number }

      const categories = db.prepare('SELECT name, short_code, parent_id FROM categories WHERE is_active = 1').all() as Record<string, unknown>[]
      const titleCase = (value: unknown) => String(value ?? '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean)
        .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()).join(' ')
      const nonNormalizedCategories = categories.filter(cat => String(cat.name || '') !== titleCase(cat.name)).length
      const missingShortCodes = categories.filter(cat => !String(cat.short_code || '').trim()).length
      const rootCategories = categories.filter(cat => !cat.parent_id).length

      return {
        success: true,
        data: {
          totalProducts: (db.prepare('SELECT COUNT(*) AS count FROM products WHERE is_active = 1').get() as { count: number }).count,
          missingSku: missingSku.count,
          duplicateSkuGroups: duplicateSkuGroups.count,
          duplicateSkuProducts: duplicateSkuProducts.count,
          totalCategories: categories.length,
          rootCategories,
          missingShortCodes,
          nonNormalizedCategories,
        },
      }
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
