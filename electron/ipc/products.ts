import type { IpcMain } from 'electron'
import { dialog, app } from 'electron'
import { getDb } from '../database'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { enqueuSync } from '../services/syncQueue'
import { syncStockRow } from '../services/stockSync'
import { insertStockMovement } from '../services/stockMovement'
import { logAudit } from '../services/auditLog'
import { createCompanyStore, getActiveWorkspaceDir } from '../services/companyWorkspace'
import { CloudApi } from '../services/cloudApi'
import { uploadFile as s3UploadFile } from '../services/s3Service'
import type { S3Config } from '../services/s3Service'
import { decryptSecret } from './settings'
import { buildSku, categoryCodeFromName, normalizeCategoryPath, titleCase } from '../lib/catalog'
import { safeHandle } from './ipcHandler'
import { canManageAllBranchStock } from '../services/branchAccess'

const store = createCompanyStore()

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

// The daily supplier stock sheet this company actually uses: exactly two
// columns, no header row at all — column A is their own item code, column B
// the item name (e.g. "DWJ01" / "Water Jug -01"). `sheet_to_json`'s default
// first-row-as-header behaviour treats the first real product as the
// "header" and produces column keys that don't match any known field name —
// that mismatch (2 columns, neither recognizable as name/sku/price/etc.) is
// exactly the signal used here to detect this format and re-read the sheet
// with header:1 so the first row isn't silently dropped as data.
const KNOWN_COLUMN_ALIASES = new Set([
  'name', 'productname', 'itemname', 'sku', 'code', 'itemcode', 'productcode',
  'category', 'categoryname', 'supplier', 'suppliername', 'vendor',
  'price', 'sellingprice', 'saleprice', 'mrp', 'cost', 'costprice', 'purchaseprice',
  'barcode', 'ean', 'upc', 'unit', 'uom', 'measure',
  'stock', 'quantity', 'qty', 'openingstock', 'tax', 'taxrate', 'vat',
  'minstock', 'reorder', 'reorderlevel', 'description', 'desc', 'notes',
  'discount', 'discountpct', 'discountpercentage', 'discountpercent', 'discount_pct', 'discount_percentage',
])
function isHeaderlessCodeNameFile(rows: Record<string, unknown>[]): boolean {
  if (!rows.length) return false
  const headers = Object.keys(rows[0])
  if (headers.length !== 2) return false
  return !headers.some(h => KNOWN_COLUMN_ALIASES.has(normHeader(h)))
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
  // One product's own configured pack/box unit (product_uom, is_base=0) per
  // row — a small, cheap dataset (one row per product that has a pack unit
  // configured, most don't). Lets POS/reports show "N box + M pcs" without
  // adding a per-product join to the much hotter products:list query below.
  safeHandle(ipcMain, 'products:uom:listAll', () => {
    const rows = getDb().prepare(`
      SELECT pu.product_id, pu.uom_name, pu.conversion_factor
      FROM product_uom pu
      WHERE pu.id = (
        SELECT id FROM product_uom
        WHERE product_id = pu.product_id AND is_base = 0 AND conversion_factor > 1
        ORDER BY sort_order LIMIT 1
      )
    `).all()
    return { success: true, data: rows }
  })

  // ─── PRODUCT ATTRIBUTES (BUSINESS-TYPE SPECIFIC) ──────────────────────────
  safeHandle(ipcMain, 'products:attributes:list', (_e, filters: { business_type?: string; category_id?: string } = {}) => {
    const db = getDb()
    let sql = 'SELECT * FROM product_attributes WHERE is_active = 1'
    const params: unknown[] = []
    if (filters.business_type && filters.business_type !== 'all') {
      sql += ' AND (business_type = ? OR business_type = "all")'
      params.push(filters.business_type)
    }
    if (filters.category_id) {
      sql += ' AND (category_id = ? OR category_id IS NULL)'
      params.push(filters.category_id)
    }
    sql += ' ORDER BY sort_order ASC, name ASC'
    const attributes = db.prepare(sql).all(...params) as Record<string, unknown>[]

    const valuesStmt = db.prepare('SELECT * FROM product_attribute_values WHERE attribute_id = ? ORDER BY sort_order ASC, value ASC')
    const result = attributes.map(attr => ({
      ...attr,
      values: valuesStmt.all(attr.id)
    }))
    return { success: true, data: result }
  })

  safeHandle(ipcMain, 'products:attributes:create', async (_e, payload: {
    name: string
    slug?: string
    business_type?: 'supermarket' | 'normal' | 'all'
    category_id?: string | null
    description?: string
    values?: string[]
  }) => {
    const db = getDb()
    if (!payload.name?.trim()) return { success: false, error: 'Attribute name is required' }
    const id = crypto.randomUUID()
    const slug = (payload.slug || payload.name).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/(^_|_$)/g, '')
    const businessType = payload.business_type || 'all'
    const categoryId = payload.category_id || null

    db.transaction(() => {
      db.prepare(`
        INSERT INTO product_attributes (id, business_type, category_id, name, slug, description, is_active, is_system, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, 1, 0, 0)
      `).run(id, businessType, categoryId, payload.name.trim(), slug, payload.description || '')

      if (Array.isArray(payload.values)) {
        const valStmt = db.prepare('INSERT INTO product_attribute_values (id, attribute_id, value, sort_order) VALUES (?, ?, ?, ?)')
        payload.values.forEach((val, idx) => {
          if (String(val).trim()) {
            valStmt.run(crypto.randomUUID(), id, String(val).trim(), idx + 1)
          }
        })
      }
    })()

    await enqueuSync('product_attributes', id, 'INSERT', { id, business_type: businessType, category_id: categoryId, name: payload.name.trim(), slug })
    return { success: true, data: { id, name: payload.name, slug } }
  })

  safeHandle(ipcMain, 'products:attributes:update', async (_e, id: string, payload: {
    name?: string
    slug?: string
    business_type?: string
    category_id?: string | null
    description?: string
    is_active?: boolean
    values?: Array<{ id?: string; value: string; color_code?: string }>
  }) => {
    const db = getDb()
    const attr = db.prepare('SELECT * FROM product_attributes WHERE id = ?').get(id) as Record<string, unknown> | undefined
    if (!attr) return { success: false, error: 'Attribute not found' }

    db.transaction(() => {
      const name = payload.name !== undefined ? payload.name.trim() : attr.name
      const slug = payload.slug !== undefined ? payload.slug : attr.slug
      const businessType = payload.business_type !== undefined ? payload.business_type : attr.business_type
      const categoryId = payload.category_id !== undefined ? payload.category_id : attr.category_id
      const isActive = payload.is_active !== undefined ? (payload.is_active ? 1 : 0) : attr.is_active

      db.prepare(`
        UPDATE product_attributes
        SET name = ?, slug = ?, business_type = ?, category_id = ?, is_active = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(name, slug, businessType, categoryId, isActive, id)

      if (Array.isArray(payload.values)) {
        db.prepare('DELETE FROM product_attribute_values WHERE attribute_id = ?').run(id)
        const insertVal = db.prepare('INSERT INTO product_attribute_values (id, attribute_id, value, color_code, sort_order) VALUES (?, ?, ?, ?, ?)')
        payload.values.forEach((v, idx) => {
          const valText = typeof v === 'string' ? v : v.value
          const colorCode = typeof v === 'object' ? v.color_code : null
          if (String(valText).trim()) {
            insertVal.run(crypto.randomUUID(), id, String(valText).trim(), colorCode || null, idx + 1)
          }
        })
      }
    })()

    await enqueuSync('product_attributes', id, 'UPDATE', { id, ...payload })
    return { success: true }
  })

  safeHandle(ipcMain, 'products:attributes:delete', async (_e, id: string) => {
    const db = getDb()
    db.prepare("UPDATE product_attributes SET is_active = 0, updated_at = datetime('now') WHERE id = ?").run(id)
    await enqueuSync('product_attributes', id, 'UPDATE', { id, is_active: 0 })
    return { success: true }
  })

  // ─── PRODUCT VARIANTS ──────────────────────────────────────────────────────
  safeHandle(ipcMain, 'products:variants:list', (_e, productId: string, branchId?: string) => {
    const db = getDb()
    const authUser = getAuthUser()
    const targetBranch = branchId || (authUser?.branch_id as string) || null

    const stockJoin = targetBranch
      ? 'LEFT JOIN product_variant_stocks pvs ON pvs.variant_id = pv.id AND pvs.branch_id = ?'
      : `LEFT JOIN (
           SELECT variant_id, SUM(quantity) as quantity
           FROM product_variant_stocks GROUP BY variant_id
         ) pvs ON pvs.variant_id = pv.id`

    const sql = `
      SELECT pv.*,
             COALESCE(pvs.quantity, 0) as stock
      FROM product_variants pv
      ${stockJoin}
      WHERE pv.product_id = ? AND pv.is_active = 1
      ORDER BY pv.sort_order ASC, pv.variant_name ASC
    `
    const params = targetBranch ? [targetBranch, productId] : [productId]
    const rows = db.prepare(sql).all(...params) as Record<string, unknown>[]

    const parsed = rows.map(r => ({
      ...r,
      attributes: typeof r.attributes_json === 'string' ? JSON.parse(String(r.attributes_json || '{}')) : (r.attributes_json || {})
    }))
    return { success: true, data: parsed }
  })

  safeHandle(ipcMain, 'products:variants:getByBarcode', (_e, barcode: string, branchId?: string) => {
    const db = getDb()
    const authUser = getAuthUser()
    const targetBranch = branchId || (authUser?.branch_id as string) || null

    const stockJoin = targetBranch
      ? 'LEFT JOIN product_variant_stocks pvs ON pvs.variant_id = pv.id AND pvs.branch_id = ?'
      : `LEFT JOIN (
           SELECT variant_id, SUM(quantity) as quantity
           FROM product_variant_stocks GROUP BY variant_id
         ) pvs ON pvs.variant_id = pv.id`

    const sql = `
      SELECT pv.*,
             p.name as parent_product_name,
             p.tax_rate,
             p.category_id,
             p.product_type,
             COALESCE(pvs.quantity, 0) as stock
      FROM product_variants pv
      JOIN products p ON p.id = pv.product_id
      ${stockJoin}
      WHERE (pv.barcode = ? OR pv.sku = ?) AND pv.is_active = 1
      LIMIT 1
    `
    const params = targetBranch ? [targetBranch, barcode, barcode] : [barcode, barcode]
    const row = db.prepare(sql).get(...params) as Record<string, unknown> | undefined
    if (!row) return { success: true, data: null }

    return {
      success: true,
      data: {
        ...row,
        attributes: typeof row.attributes_json === 'string' ? JSON.parse(String(row.attributes_json || '{}')) : row.attributes_json
      }
    }
  })


  safeHandle(ipcMain, 'products:list', (_e, filters: { category_id?: string; is_active?: boolean; branch_id?: string } = {}) => {
      const db = getDb()
      const authUser = getAuthUser()
      const canManageAllBranches = canManageAllBranchStock(db, authUser)
      const userBranchId = authUser?.branch_id as string | undefined

      if (filters.branch_id && !canManageAllBranches && (!userBranchId || filters.branch_id !== userBranchId)) {
        return { success: false, error: 'Cannot view product stock for another branch' }
      }

      // If an explicit branch_id is requested via filters (or user is branch-scoped without filter),
      // join stock for that exact branch. Otherwise sum across all branches.
      const targetBranchId = filters.branch_id || (!canManageAllBranches ? userBranchId : undefined)

      const stockJoin = targetBranchId
        ? `LEFT JOIN stocks s ON s.product_id = p.id AND s.branch_id = ?`
        : `LEFT JOIN (
             SELECT product_id, SUM(quantity) AS quantity, SUM(damaged_qty) AS damaged_qty
             FROM stocks GROUP BY product_id
           ) s ON s.product_id = p.id`

      let sql = `
        SELECT p.*,
               COALESCE(
                 NULLIF((SELECT pu.uom_name FROM product_uom pu WHERE pu.product_id = p.id AND pu.is_base = 1 AND pu.uom_name != '' LIMIT 1), ''),
                 NULLIF(p.unit, ''),
                 'pcs'
               ) as unit,
               c.name as category_name,
               MAX(COALESCE(s.quantity, 0) - COALESCE(s.damaged_qty, 0), 0) as stock,
               b.name as branch_name,
               (SELECT COUNT(*) FROM product_variants pv WHERE pv.product_id = p.id AND pv.is_active = 1) as variant_count
        FROM products p
        LEFT JOIN categories c ON c.id = p.category_id
        LEFT JOIN branches b ON b.id = p.branch_id
        ${stockJoin}
        WHERE 1=1
      `
      const params: unknown[] = []
      if (targetBranchId) params.push(targetBranchId)

      // Only restrict branch visibility if branch-scoped user and no explicit branch filter
      if (!canManageAllBranches && userBranchId && !filters.branch_id) {
        sql += ' AND (p.branch_id = ? OR p.branch_id IS NULL)'
        params.push(userBranchId)
      }

      if (filters.category_id) { sql += ' AND p.category_id = ?'; params.push(filters.category_id) }
      if (filters.is_active !== undefined) { sql += ' AND p.is_active = ?'; params.push(filters.is_active ? 1 : 0) }
      sql += ' ORDER BY p.name'
      return { success: true, data: db.prepare(sql).all(...params) }
  })

  safeHandle(ipcMain, 'products:search', (_e, query: string) => {
      const db = getDb()
      const authUser = getAuthUser()
      const superAdmin = isSuperAdmin(authUser)
      const branchId = authUser?.branch_id as string | undefined

      const q = `%${query}%`
      const stockJoin = (superAdmin || !branchId)
        ? `LEFT JOIN (SELECT product_id, SUM(quantity) AS quantity FROM stocks GROUP BY product_id) s ON s.product_id = p.id`
        : `LEFT JOIN stocks s ON s.product_id = p.id AND s.branch_id = ?`

      let sql = `
        SELECT p.*,
               COALESCE(
                 NULLIF((SELECT pu.uom_name FROM product_uom pu WHERE pu.product_id = p.id AND pu.is_base = 1 AND pu.uom_name != '' LIMIT 1), ''),
                 NULLIF(p.unit, ''),
                 'pcs'
               ) as unit,
               COALESCE(s.quantity, 0) as stock
        FROM products p
        ${stockJoin}
        WHERE p.is_active = 1
          AND (p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ?)
      `
      const params: unknown[] = (!superAdmin && branchId) ? [branchId, q, q, q] : [q, q, q]

      sql += ' ORDER BY p.name LIMIT 50'
      return { success: true, data: db.prepare(sql).all(...params) }
  })

  safeHandle(ipcMain, 'products:searchSku', (_e, sku: string) => {
      const db = getDb()
      const authUser = getAuthUser()
      const superAdmin = isSuperAdmin(authUser)
      const branchId = authUser?.branch_id as string | undefined

      const stockJoin = (superAdmin || !branchId)
        ? `LEFT JOIN (SELECT product_id, SUM(quantity) AS quantity FROM stocks GROUP BY product_id) s ON s.product_id = p.id`
        : `LEFT JOIN stocks s ON s.product_id = p.id AND s.branch_id = ?`

      // 1. Check if SKU or Barcode matches a product variant
      const variantStockJoin = (superAdmin || !branchId)
        ? `LEFT JOIN (SELECT variant_id, SUM(quantity) AS quantity FROM product_variant_stocks GROUP BY variant_id) pvs ON pvs.variant_id = pv.id`
        : `LEFT JOIN product_variant_stocks pvs ON pvs.variant_id = pv.id AND pvs.branch_id = ?`

      const varSql = `
        SELECT p.*,
               pv.id as variant_id,
               pv.variant_name,
               pv.sku as variant_sku,
               pv.barcode as variant_barcode,
               pv.selling_price as variant_price,
               pv.attributes_json,
               COALESCE(pvs.quantity, 0) as variant_stock,
               COALESCE(
                 NULLIF((SELECT pu.uom_name FROM product_uom pu WHERE pu.product_id = p.id AND pu.is_base = 1 AND pu.uom_name != '' LIMIT 1), ''),
                 NULLIF(p.unit, ''),
                 'pcs'
               ) as unit,
               COALESCE(s.quantity, 0) as stock
        FROM product_variants pv
        JOIN products p ON p.id = pv.product_id
        ${stockJoin}
        ${variantStockJoin}
        WHERE pv.is_active = 1 AND p.is_active = 1
          AND (pv.sku = ? OR pv.barcode = ?)
        LIMIT 1
      `
      const varParams = (!superAdmin && branchId) ? [branchId, branchId, sku, sku] : [sku, sku]
      const variantMatch = db.prepare(varSql).get(...varParams) as Record<string, unknown> | undefined

      if (variantMatch) {
        return {
          success: true,
          data: {
            ...variantMatch,
            selling_price: (variantMatch.variant_price !== undefined && variantMatch.variant_price !== null && Number(variantMatch.variant_price) > 0)
              ? variantMatch.variant_price
              : variantMatch.selling_price,
            stock: variantMatch.variant_stock !== undefined ? variantMatch.variant_stock : variantMatch.stock,
            variant_id: variantMatch.variant_id,
            variant_name: variantMatch.variant_name,
            attributes: typeof variantMatch.attributes_json === 'string' ? JSON.parse(String(variantMatch.attributes_json || '{}')) : variantMatch.attributes_json
          }
        }
      }

      // 2. Standard product match
      const sql = `
        SELECT p.*,
               COALESCE(
                 NULLIF((SELECT pu.uom_name FROM product_uom pu WHERE pu.product_id = p.id AND pu.is_base = 1 AND pu.uom_name != '' LIMIT 1), ''),
                 NULLIF(p.unit, ''),
                 'pcs'
               ) as unit,
               COALESCE(s.quantity, 0) as stock
        FROM products p
        ${stockJoin}
        WHERE p.sku = ? OR p.barcode = ?
        LIMIT 1
      `
      const params: unknown[] = (!superAdmin && branchId) ? [branchId, sku, sku] : [sku, sku]
      return { success: true, data: db.prepare(sql).get(...params) || null }
  })

  safeHandle(ipcMain, 'products:get', (_e, id: string) => {
      const db = getDb()
      const row = db.prepare(`
        SELECT p.*,
               COALESCE(
                 NULLIF((SELECT pu.uom_name FROM product_uom pu WHERE pu.product_id = p.id AND pu.is_base = 1 AND pu.uom_name != '' LIMIT 1), ''),
                 NULLIF(p.unit, ''),
                 'pcs'
               ) as unit
        FROM products p WHERE p.id = ?
      `).get(id) as Record<string, unknown> | undefined
      if (!row) return { success: true, data: null }

      const variants = db.prepare(`
        SELECT pv.*,
               COALESCE(pvs.quantity, 0) as stock
        FROM product_variants pv
        LEFT JOIN (
          SELECT variant_id, SUM(quantity) as quantity
          FROM product_variant_stocks GROUP BY variant_id
        ) pvs ON pvs.variant_id = pv.id
        WHERE pv.product_id = ? AND pv.is_active = 1
        ORDER BY pv.sort_order ASC, pv.created_at ASC
      `).all(id) as Record<string, unknown>[]

      const parsedVariants = variants.map(v => ({
        ...v,
        attributes: typeof v.attributes_json === 'string' ? JSON.parse(String(v.attributes_json || '{}')) : (v.attributes_json || {})
      }))

      return { success: true, data: { ...row, variants: parsedVariants } }
  })

  // Branch Managers must submit a "new product" edit request (target_record_id
  // 'new', scoped per-user) and have it approved before they can create a
  // product; the approval is re-validated and consumed inside the same
  // transaction as the insert. Admins create directly, as before.
  safeHandle(ipcMain, 'products:create', async (_e, payload) => {
      const db = getDb()
      const id = crypto.randomUUID()
      const authUser = getAuthUser()
      const isAdmin = isSuperAdmin(authUser)
      const { edit_request_id, variants, ...rest } = (payload || {}) as Record<string, unknown> & { edit_request_id?: string; variants?: any[] }

      if (!isAdmin && !edit_request_id) {
        return { success: false, error: 'No approved edit request found — please request approval first' }
      }

      // Super admin creates global products (branch_id = NULL); branch users tag to their branch
      const branch_id = isAdmin ? null : (authUser?.branch_id as string || null)
      const targetBranch = branch_id || (authUser?.branch_id as string) || 'b1111111-1111-4111-8111-111111111111'
      const rawSku = String((rest as Record<string, unknown>)?.sku || '').trim()
      const rawBarcode = String((rest as Record<string, unknown>)?.barcode || '').trim()
      const sku = rawSku || (rawBarcode ? rawBarcode : `NO-SKU-${id.slice(0, 8).toUpperCase()}`)
      const productType = (rest.product_type as string) || (Array.isArray(variants) && variants.length > 0 ? 'variable' : 'simple')

      db.transaction(() => {
        if (!isAdmin) {
          const request = db.prepare(`
            SELECT id FROM edit_requests
            WHERE id=? AND status='approved' AND approved_expires_at > datetime('now')
              AND requested_by=? AND target_table='products' AND target_record_id='new'
          `).get(edit_request_id, authUser?.id) as { id: string } | undefined
          if (!request) throw new Error('Edit request no longer valid — please request approval again')
          db.prepare(`UPDATE edit_requests SET status='consumed', consumed_at=datetime('now'), updated_at=datetime('now') WHERE id=?`)
            .run(request.id)
        }
        const productRow = {
          id,
          branch_id: branch_id ?? null,
          category_id: (rest.category_id as string) || null,
          supplier_id: (rest.supplier_id as string) || null,
          sku,
          barcode: (rest.barcode as string) || null,
          name: (rest.name as string) || 'Unnamed Product',
          description: (rest.description as string) || '',
          image_url: (rest.image_url as string) || null,
          unit: (rest.unit as string) || 'pcs',
          cost_price: Number(rest.cost_price) || 0,
          selling_price: Number(rest.selling_price) || 0,
          tax_rate: Number(rest.tax_rate) || 0,
          discount_pct: Number(rest.discount_pct) || 0,
          min_stock_level: Number(rest.min_stock_level) || 0,
          product_type: productType,
          ...rest,
        }
        db.prepare(`
          INSERT INTO products (id, branch_id, category_id, supplier_id, sku, barcode, name, description,
            image_url, unit, cost_price, selling_price, tax_rate, discount_pct, min_stock_level, product_type)
          VALUES (@id, @branch_id, @category_id, @supplier_id, @sku, @barcode, @name, @description,
            @image_url, @unit, @cost_price, @selling_price, @tax_rate, @discount_pct, @min_stock_level, @product_type)
        `).run(productRow)

        // Save variants if variable product
        if (Array.isArray(variants) && variants.length > 0) {
          const insertVar = db.prepare(`
            INSERT INTO product_variants (id, product_id, variant_name, sku, barcode, cost_price, selling_price, attributes_json, image_url, is_active, sort_order)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
          `)
          const insertVarStock = db.prepare(`
            INSERT INTO product_variant_stocks (id, variant_id, product_id, branch_id, quantity, damaged_qty, updated_at)
            VALUES (?, ?, ?, ?, ?, 0, datetime('now'))
          `)

          let totalVarStock = 0
          variants.forEach((v, idx) => {
            const varId = v.id || crypto.randomUUID()
            const varSku = String(v.sku || '').trim() || `${sku}-${idx + 1}`
            const varBarcode = String(v.barcode || '').trim() || null
            const varCost = Number(v.cost_price) || Number(rest.cost_price) || 0
            const varPrice = Number(v.selling_price) || Number(rest.selling_price) || 0
            const attrJson = JSON.stringify(v.attributes || {})
            const varImg = v.image_url || null
            const varStock = Number(v.initial_stock || v.stock || 0)
            totalVarStock += varStock

            insertVar.run(varId, id, String(v.variant_name || `Variant ${idx + 1}`), varSku, varBarcode, varCost, varPrice, attrJson, varImg, idx + 1)
            if (varStock > 0) {
              insertVarStock.run(crypto.randomUUID(), varId, id, targetBranch, varStock)
            }
          })

          if (totalVarStock > 0) {
            db.prepare(`
              INSERT INTO stocks (id, product_id, branch_id, quantity, damaged_qty, updated_at)
              VALUES (?, ?, ?, ?, 0, datetime('now'))
            `).run(crypto.randomUUID(), id, targetBranch, totalVarStock)
          }
        }
      })()

      await enqueuSync('products', id, 'INSERT', { id, branch_id, ...rest, sku, product_type: productType })
      if (!isAdmin && edit_request_id) {
        await enqueuSync('edit_requests', edit_request_id, 'UPDATE', { id: edit_request_id, status: 'consumed' })
      }
      return { success: true, data: { id } }
  })

  // Branch Managers must submit an edit request and have it approved by a
  // Company Admin before they can update a product; the approval is
  // re-validated and consumed inside the same transaction as the update so
  // there's no check-then-use race. Admins update directly, as before.
  safeHandle(ipcMain, 'products:update', async (_e, id: string, payload) => {
      const db = getDb()
      const { edit_request_id, variants, ...rest } = (payload || {}) as Record<string, unknown> & { edit_request_id?: string; variants?: any[] }
      const nextPayload = { ...rest }
      if (!String(nextPayload.sku || '').trim()) {
        const rawBarcode = String(nextPayload.barcode || '').trim()
        nextPayload.sku = rawBarcode || `NO-SKU-${id.slice(0, 8).toUpperCase()}`
      }

      const caller = getAuthUser()
      const isAdmin = isSuperAdmin(caller)
      if (!isAdmin && !edit_request_id) {
        return { success: false, error: 'No approved edit request found — please request approval first' }
      }

      const targetBranch = (caller?.branch_id as string) || 'b1111111-1111-4111-8111-111111111111'
      const fields = Object.keys(nextPayload).map(k => `${k} = @${k}`).join(', ')
      db.transaction(() => {
        if (!isAdmin) {
          const request = db.prepare(`
            SELECT id FROM edit_requests
            WHERE id=? AND status='approved' AND approved_expires_at > datetime('now')
              AND requested_by=? AND target_table='products' AND target_record_id=?
          `).get(edit_request_id, caller?.id, id) as { id: string } | undefined
          if (!request) throw new Error('Edit request no longer valid — please request approval again')
          db.prepare(`UPDATE edit_requests SET status='consumed', consumed_at=datetime('now'), updated_at=datetime('now') WHERE id=?`)
            .run(request.id)
        }
        if (fields) {
          db.prepare(`UPDATE products SET ${fields}, updated_at = datetime('now') WHERE id = @id`)
            .run({ ...nextPayload, id })
        }

        // Handle variants updates if supplied
        if (Array.isArray(variants)) {
          const incomingIds = new Set(variants.map(v => v.id).filter(Boolean))
          if (incomingIds.size > 0) {
            const placeholders = Array.from(incomingIds).map(() => '?').join(',')
            db.prepare(`UPDATE product_variants SET is_active = 0, updated_at = datetime('now') WHERE product_id = ? AND id NOT IN (${placeholders})`)
              .run(id, ...Array.from(incomingIds))
          } else {
            db.prepare(`UPDATE product_variants SET is_active = 0, updated_at = datetime('now') WHERE product_id = ?`)
              .run(id)
          }

          const upsertVar = db.prepare(`
            INSERT INTO product_variants (id, product_id, variant_name, sku, barcode, cost_price, selling_price, attributes_json, image_url, is_active, sort_order, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, datetime('now'))
            ON CONFLICT(id) DO UPDATE SET
              variant_name = excluded.variant_name,
              sku = excluded.sku,
              barcode = excluded.barcode,
              cost_price = excluded.cost_price,
              selling_price = excluded.selling_price,
              attributes_json = excluded.attributes_json,
              image_url = excluded.image_url,
              is_active = 1,
              sort_order = excluded.sort_order,
              updated_at = datetime('now')
          `)

          const upsertVarStock = db.prepare(`
            INSERT INTO product_variant_stocks (id, variant_id, product_id, branch_id, quantity, damaged_qty, updated_at)
            VALUES (?, ?, ?, ?, ?, 0, datetime('now'))
            ON CONFLICT(variant_id, branch_id) DO UPDATE SET
              quantity = excluded.quantity,
              updated_at = datetime('now')
          `)

          let totalVarStock = 0
          variants.forEach((v, idx) => {
            const varId = v.id || crypto.randomUUID()
            const varSku = String(v.sku || '').trim() || `${nextPayload.sku || 'SKU'}-${idx + 1}`
            const varBarcode = String(v.barcode || '').trim() || null
            const varCost = Number(v.cost_price) || Number(nextPayload.cost_price) || 0
            const varPrice = Number(v.selling_price) || Number(nextPayload.selling_price) || 0
            const attrJson = JSON.stringify(v.attributes || {})
            const varImg = v.image_url || null
            const varStock = Number(v.stock !== undefined ? v.stock : (v.initial_stock || 0))
            totalVarStock += varStock

            upsertVar.run(varId, id, String(v.variant_name || `Variant ${idx + 1}`), varSku, varBarcode, varCost, varPrice, attrJson, varImg, idx + 1)
            if (v.stock !== undefined || v.initial_stock !== undefined) {
              upsertVarStock.run(crypto.randomUUID(), varId, id, targetBranch, varStock)
            }
          })

          if (variants.length > 0) {
            const sumRow = db.prepare('SELECT SUM(quantity) as total FROM product_variant_stocks WHERE product_id = ? AND branch_id = ?')
              .get(id, targetBranch) as { total: number } | undefined
            const aggQty = sumRow?.total !== undefined ? sumRow.total : totalVarStock
            db.prepare(`
              INSERT INTO stocks (id, product_id, branch_id, quantity, damaged_qty, updated_at)
              VALUES (?, ?, ?, ?, 0, datetime('now'))
              ON CONFLICT(product_id, branch_id) DO UPDATE SET
                quantity = excluded.quantity,
                updated_at = datetime('now')
            `).run(crypto.randomUUID(), id, targetBranch, aggQty)
          }
        }
      })()

      await enqueuSync('products', id, 'UPDATE', { id, ...nextPayload })
      if (!isAdmin && edit_request_id) {
        await enqueuSync('edit_requests', edit_request_id, 'UPDATE', { id: edit_request_id, status: 'consumed' })
      }
      return { success: true }
  })

  safeHandle(ipcMain, 'products:delete', async (_e, id: string) => {
      const caller = getAuthUser()
      const perms = (caller?.role as Record<string, unknown>)?.permissions as Record<string, unknown>
        || (caller?.permissions as Record<string, unknown>) || {}
      if (!perms.all && !perms.inventory) return { success: false, error: 'Inventory management access required' }

      const db = getDb()
      const product = db.prepare('SELECT id, branch_id FROM products WHERE id = ?').get(id) as { id: string; branch_id: string | null } | undefined
      if (!product) return { success: false, error: 'Product not found' }
      // A branch-tagged product may only be deactivated by an admin or a
      // caller from that same branch — global (NULL branch_id) products
      // remain admin-only in practice since perms.inventory without perms.all
      // still belongs to a specific branch.
      if (!perms.all) {
        const callerBranch = (caller?.branch_id as string) || null
        if (product.branch_id ? product.branch_id !== callerBranch : true) {
          return { success: false, error: 'Cannot deactivate a product from another branch' }
        }
      }
      db.prepare("UPDATE products SET is_active = 0, updated_at = datetime('now') WHERE id = ?").run(id)
      await enqueuSync('products', id, 'UPDATE', { id, is_active: 0 })
      return { success: true }
  })

  safeHandle(ipcMain, 'products:permanentDelete', async (_e, id: string, reason: string) => {
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

      // Check commercial transaction movements (sales, transfers, receipts, or linked to orders/transfers).
      // Opening stock adjustments on test/new products with no sales/purchases can be cleanly deleted with the product.
      try {
        const commercialMovements = db.prepare(`
          SELECT COUNT(*) as cnt FROM stock_movements 
          WHERE product_id = ? 
            AND (movement_type IN ('SALE', 'TRANSFER', 'RECEIVE') 
                 OR reference_order_id IS NOT NULL 
                 OR reference_transfer_id IS NOT NULL 
                 OR reference_branch_transfer_id IS NOT NULL)
        `).get(id) as { cnt: number } | undefined
        if (commercialMovements && commercialMovements.cnt > 0) {
          return { success: false, error: `Cannot permanently delete — this product has ${commercialMovements.cnt} sales/transfer movement record(s). Use deactivate instead to preserve history.` }
        }
      } catch {
        // Table or columns may not exist in this environment, ignore
      }

      // Check other historical and audit records to provide clear, actionable feedback
      const historyChecks = [
        { table: 'purchase_items', label: 'purchase order item(s)' },
        { table: 'damaged_items', label: 'damaged stock record(s)' },
        { table: 'order_items', label: 'held/active order(s)' },
        { table: 'customer_order_items', label: 'customer order item(s)' },
        { table: 'return_items', label: 'sales return(s)' },
        { table: 'stock_transfer_history', label: 'stock transfer(s)' },
        { table: 'stock_transfers', label: 'pending/active stock transfer(s)' },
        { table: 'branch_transfer_items', label: 'branch transfer item(s)' },
        { table: 'grn_items', label: 'goods received note (GRN) item(s)' },
        { table: 'quotation_items', label: 'quotation(s)' },
        { table: 'wastage_items', label: 'wastage record(s)' },
        { table: 'stock_count_items', label: 'stock audit session(s)' },
      ]
      for (const check of historyChecks) {
        try {
          const row = db.prepare(`SELECT COUNT(*) as cnt FROM ${check.table} WHERE product_id = ?`).get(id) as { cnt: number } | undefined
          if (row && row.cnt > 0) {
            return { success: false, error: `Cannot permanently delete — this product has ${row.cnt} ${check.label}. Use deactivate instead to preserve history.` }
          }
        } catch {
          // Table may not exist in this environment, ignore
        }
      }

      // Smart Buy — a product referenced here is live scheme/commission
      // config or a member's redemption record, not disposable. FK
      // enforcement (foreign_keys=ON) would otherwise surface this as a raw
      // constraint-failure error only after `stocks` was already deleted.
      const { cnt: schemeCnt } = db.prepare(`SELECT COUNT(*) as cnt FROM chit_schemes WHERE product_id = ?`).get(id) as { cnt: number }
      if (schemeCnt > 0) {
        return { success: false, error: `Cannot permanently delete — this product is used by ${schemeCnt} Smart Buy scheme(s). Use deactivate instead.` }
      }
      const { cnt: redeemedCnt } = db.prepare(`SELECT COUNT(*) as cnt FROM chit_members WHERE redeemed_product_id = ?`).get(id) as { cnt: number }
      if (redeemedCnt > 0) {
        return { success: false, error: `Cannot permanently delete — ${redeemedCnt} Smart Buy member(s) redeemed this product. Use deactivate instead.` }
      }
      const { cnt: ruleCnt } = db.prepare(`SELECT COUNT(*) as cnt FROM commission_rules WHERE product_id = ?`).get(id) as { cnt: number }
      if (ruleCnt > 0) {
        return { success: false, error: `Cannot permanently delete — ${ruleCnt} commission rule(s) reference this product. Remove or repoint them first.` }
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

      // Remove related disposable records (discounts, batches, uom, stock_movements, stocks) then product, atomically
      db.transaction(() => {
        try { db.prepare(`DELETE FROM discounts WHERE product_id = ?`).run(id) } catch { /* ignore if not present */ }
        try { db.prepare(`DELETE FROM product_batches WHERE product_id = ?`).run(id) } catch { /* ignore if not present */ }
        try { db.prepare(`DELETE FROM product_uom WHERE product_id = ?`).run(id) } catch { /* ignore if not present */ }
        try { db.prepare(`DELETE FROM stock_movements WHERE product_id = ?`).run(id) } catch { /* ignore if not present */ }
        db.prepare(`DELETE FROM stocks WHERE product_id = ?`).run(id)
        db.prepare(`DELETE FROM products WHERE id = ?`).run(id)
      })()

      // Was missing entirely — a permanent delete never reached the cloud or
      // any other branch, leaving them with a product that no longer exists
      // here (same class of bug as admin:users:hardDelete before its fix).
      await enqueuSync('products', id, 'DELETE', { id })

      return { success: true }
  })

  safeHandle(ipcMain, 'products:selectAndUploadImage', async (_e) => {
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
      const userDataPath = getActiveWorkspaceDir()
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
          const publicUrl = await new CloudApi({ baseUrl: cloudUrl, apiKey: cloudKey, deviceId: (store.get('device_id') as string | undefined) ?? null })
            .uploadImage(destPath, fileName, contentType)
          return { success: true, data: publicUrl }
        } catch (err) {
          console.error('[ImageUpload] Cloud API upload failed, using local fallback:', err)
        }
      }

      // 3. Fall back to local app-img:// URL — genuinely saved (the file is
      // safely in this device's userData/uploads folder and will preview
      // fine here), but NOT yet reachable from any other PC: `local_only`
      // tells the caller so it can be honest about that instead of implying
      // full "upload successful" (§C2 — this reference still gets synced to
      // other devices as row data via the normal `products` sync, but the
      // file itself only exists on this machine until cloud storage is
      // configured and syncService's retry succeeds).
      return { success: true, data: localUrl, local_only: true }
  })

  function findExistingProduct(
    db: ReturnType<typeof getDb>,
    sku?: string | null,
    barcode?: string | null,
    name?: string | null
  ): Record<string, unknown> | undefined {
    if (sku && sku.trim()) {
      const found = db.prepare('SELECT * FROM products WHERE sku = ? AND is_active = 1 LIMIT 1').get(sku.trim()) as Record<string, unknown> | undefined
      if (found) return found
      const anyStatus = db.prepare('SELECT * FROM products WHERE sku = ? LIMIT 1').get(sku.trim()) as Record<string, unknown> | undefined
      if (anyStatus) return anyStatus
    }
    if (barcode && barcode.trim()) {
      const found = db.prepare('SELECT * FROM products WHERE barcode = ? AND is_active = 1 LIMIT 1').get(barcode.trim()) as Record<string, unknown> | undefined
      if (found) return found
    }
    if (name && name.trim()) {
      const found = db.prepare('SELECT * FROM products WHERE lower(trim(name)) = lower(trim(?)) AND is_active = 1 ORDER BY updated_at DESC LIMIT 1').get(name.trim()) as Record<string, unknown> | undefined
      if (found) return found
    }
    return undefined
  }

  safeHandle(ipcMain, 'products:importExcel', async (_event, options?: { duplicateStrategy?: 'override' | 'fill_empty' | 'skip' }) => {
      const duplicateStrategy = options?.duplicateStrategy || 'fill_empty'
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
        const canImportStock = canManageAllBranchStock(db, importUser)
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
            const target = findExistingProduct(db, finalSku, barcode, name)

            if (target && duplicateStrategy === 'skip') {
              skipped++
              continue
            }

            const productId = target ? String(target.id) : crypto.randomUUID()
            let payload: Record<string, unknown>

            if (target && duplicateStrategy === 'fill_empty') {
              payload = {
                id: productId,
                branch_id: target.branch_id ?? importBranchId,
                name: (target.name as string) || name,
                sku: (target.sku as string) || finalSku,
                barcode: (target.barcode as string | null) || barcode || null,
                category_id: (target.category_id as string | null) || categoryId || null,
                supplier_id: (target.supplier_id as string | null) || supplierId || null,
                unit: (target.unit as string) || 'pcs',
                cost_price: Number(target.cost_price || 0),
                selling_price: Number(target.selling_price || 0) > 0 ? Number(target.selling_price) : sellingPrice,
                tax_rate: Number(target.tax_rate || 0),
                min_stock_level: (Number(target.min_stock_level || 5) !== 5) ? Number(target.min_stock_level) : (minStock || 5),
                description: (target.description as string | null) || description || null,
                image_url: (target.image_url as string | null) || imageUrl || null,
                brand: productHasBrand ? ((target.brand as string | null) || brand || null) : undefined,
                weight: productHasWeight ? (Number(target.weight || 0) > 0 ? Number(target.weight) : (weight || null)) : undefined,
                product_type: (target.product_type as string) || (wooType === 'variation' ? 'variation' : 'single'),
                not_for_sale: Number(target.not_for_sale ?? (wooType === 'variable' ? 1 : 0)),
              }
            } else {
              payload = {
                id: productId,
                branch_id: importBranchId,
                name: target ? (name || (target.name as string)) : name,
                sku: target ? (finalSku || (target.sku as string)) : finalSku,
                barcode: barcode || (target?.barcode as string | null) || null,
                category_id: categoryId || (target?.category_id as string | null) || null,
                supplier_id: supplierId || (target?.supplier_id as string | null) || null,
                unit: 'pcs',
                cost_price: 0,
                selling_price: sellingPrice || Number(target?.selling_price || 0),
                tax_rate: 0,
                min_stock_level: minStock,
                description: description || (target?.description as string | null) || null,
                image_url: imageUrl || (target?.image_url as string | null) || null,
                brand,
                weight,
                product_type: wooType === 'variation' ? 'variation' : 'single',
                not_for_sale: wooType === 'variable' ? 1 : 0,
              }
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
              db.prepare(`UPDATE products SET ${updateFields.join(', ')}, updated_at=datetime('now') WHERE id=@id`).run({ ...payload, sku: payload.sku || finalSku })
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
              SELECT id, quantity, damaged_qty FROM stocks
              WHERE product_id=? AND branch_id=? AND warehouse_id IS NULL
            `).get(productId, stockBranchId) as { id: string; quantity: number; damaged_qty: number } | undefined
            if (!canImportStock && stockQty !== Number(existingStock?.quantity || 0)) {
              throw new Error('Only main-branch inventory managers can import stock quantities')
            }
            if (existingStock && stockQty < Number(existingStock.damaged_qty || 0)) {
              throw new Error('Imported stock cannot be lower than the recorded damaged quantity')
            }
            let stockMovement: Record<string, unknown> | null = null
            db.transaction(() => {
              if (existingStock) {
                db.prepare('UPDATE stocks SET quantity=?, updated_at=datetime("now") WHERE id=?').run(stockQty, existingStock.id)
              } else {
                db.prepare('INSERT INTO stocks (id, product_id, branch_id, warehouse_id, quantity) VALUES (?,?,?,?,?)')
                  .run(crypto.randomUUID(), productId, stockBranchId, null, stockQty)
              }
              const delta = stockQty - Number(existingStock?.quantity || 0)
              if (delta !== 0) {
                stockMovement = insertStockMovement(db, {
                  product_id: productId,
                  from_branch_id: delta < 0 ? stockBranchId : null,
                  to_branch_id: delta > 0 ? stockBranchId : null,
                  quantity: Math.abs(delta),
                  movement_type: 'ADJUSTMENT',
                  notes: 'WooCommerce import stock reconciliation',
                  created_by: (importUser?.id as string) || null,
                })
              }
            })()
            await syncStockRow(db, productId, stockBranchId)
            if (stockMovement) await enqueuSync('stock_movements', String((stockMovement as Record<string, unknown>).id), 'INSERT', stockMovement)

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

      if (isHeaderlessCodeNameFile(rows)) {
        const importUser = getAuthUser()
        const importBranchId = isSuperAdmin(importUser) ? null : (importUser?.branch_id as string || null)
        const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as unknown[][]

        let imported = 0, created = 0, updated = 0, skipped = 0
        const errors: string[] = []
        const warnings: string[] = []

        for (let i = 0; i < raw.length; i++) {
          try {
            const code = String(raw[i][0] ?? '').trim()
            const name = String(raw[i][1] ?? '').trim()
            if (!name) { skipped++; continue }

            if (!code) {
              warnings.push(`Row ${i + 1}: "${name}" — Code / SKU வழங்கப்படவில்லை (No Code/SKU provided)`)
            }
            const sku = code || `NO-SKU-${crypto.randomUUID().slice(0, 8).toUpperCase()}`
            const existing = findExistingProduct(db, code || null, null, name)

            if (existing) {
              if (duplicateStrategy === 'skip') {
                skipped++
                continue
              }
              const finalName = duplicateStrategy === 'fill_empty' ? ((existing.name as string) || name) : name
              const finalSku = duplicateStrategy === 'fill_empty' ? ((existing.sku as string) || sku) : (sku || (existing.sku as string))
              db.prepare(`UPDATE products SET name=?, sku=?, is_active=1, updated_at=datetime('now') WHERE id=?`)
                .run(finalName, finalSku, existing.id)
              await enqueuSync('products', String(existing.id), 'UPDATE', { id: existing.id, name: finalName, sku: finalSku, is_active: 1 })
              updated++
            } else {
              const productId = crypto.randomUUID()
              db.prepare(`INSERT INTO products (id, branch_id, name, sku, unit, cost_price, selling_price, tax_rate, min_stock_level)
                VALUES (?,?,?,?,?,?,?,?,?)`).run(productId, importBranchId, name, sku, 'pcs', 0, 0, 0, 5)
              await enqueuSync('products', productId, 'INSERT', {
                id: productId, branch_id: importBranchId, name, sku, unit: 'pcs',
                cost_price: 0, selling_price: 0, tax_rate: 0, min_stock_level: 5, is_active: true,
              })
              created++
            }
            imported++
          } catch (rowErr) {
            errors.push(`Row ${i + 1}: ${(rowErr as Error).message}`)
            skipped++
          }
        }

        return { success: true, data: { imported, created, updated, skipped, errors, warnings, mode: 'code_name_list' } }
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

      // Pre-load all branches for branch-wise stock mapping
      const allBranches = db.prepare('SELECT id, name, code, is_active FROM branches').all() as { id: string; name: string; code?: string; is_active: number }[]
      const importUser = store.get('auth_user') as Record<string, unknown> | undefined
      const defaultBranchId = (importUser?.branch_id as string) || (allBranches.find(b => b.is_active)?.id) || 'b1111111-1111-4111-8111-111111111111'

      // Standard product columns to protect from false-positive branch matching
      const standardCols = new Set([
        'name', 'productname', 'sku', 'productcode', 'code', 'category', 'categoryname',
        'price', 'sellingprice', 'cost', 'costprice', 'barcode', 'supplier', 'suppliername',
        'unit', 'tax', 'taxrate', 'vat', 'discount', 'discountpct', 'discountpercentage',
        'discountpercent', 'minstock', 'minstocklevel', 'reorder', 'reorderlevel',
        'description', 'desc', 'notes', 'isactive', 'status', 'brand'
      ])
      const normClean = (v: unknown) => String(v ?? '').trim().toLowerCase().replace(/[\s_\-\(\)\[\]:#/]+/g, '')

      // Helper to extract stock counts for all branches from row columns
      const extractRowBranchStocks = (row: Record<string, unknown>): Map<string, { qty: number; branchName: string }> => {
        const result = new Map<string, { qty: number; branchName: string }>()
        const rowKeys = Object.keys(row)

        for (const branch of allBranches) {
          const bClean = normClean(branch.name)
          const bCodeClean = branch.code ? normClean(branch.code) : ''

          for (const key of rowKeys) {
            const kNorm = norm(key)
            if (standardCols.has(kNorm)) continue

            const kClean = normClean(key)
            const isMatch =
              kClean === `stock${bClean}` ||
              kClean === `${bClean}stock` ||
              kClean === `qty${bClean}` ||
              kClean === `${bClean}qty` ||
              kClean === `quantity${bClean}` ||
              kClean === `${bClean}quantity` ||
              (bCodeClean && (
                kClean === `stock${bCodeClean}` ||
                kClean === `${bCodeClean}stock` ||
                kClean === `qty${bCodeClean}` ||
                kClean === `${bCodeClean}qty` ||
                kClean === `quantity${bCodeClean}` ||
                kClean === `${bCodeClean}quantity` ||
                kClean === bCodeClean
              )) ||
              (kClean === bClean)

            if (isMatch) {
              const valStr = String(row[key] ?? '').trim()
              if (valStr !== '') {
                const parsed = parseInt(valStr, 10)
                if (!isNaN(parsed) && parsed >= 0) {
                  result.set(branch.id, { qty: parsed, branchName: branch.name })
                }
              }
            }
          }
        }

        // Fallback: If no branch-specific columns matched in this row, check for generic Stock column and optional Branch column
        if (result.size === 0) {
          const branchVal = colMap(row, 'branch', 'branchname', 'branch name', 'branchcode', 'branch code', 'location')
          const stockVal = colMap(row, 'stock', 'quantity', 'qty', 'opening stock', 'openingstock')

          if (stockVal !== '') {
            const parsed = parseInt(stockVal, 10)
            if (!isNaN(parsed) && parsed >= 0) {
              let targetBranch: { id: string; name: string; code?: string } | undefined
              if (branchVal) {
                const bValNorm = norm(branchVal)
                targetBranch = allBranches.find(b => norm(b.name) === bValNorm || (b.code && norm(b.code) === bValNorm))
              }
              if (!targetBranch) {
                targetBranch = allBranches.find(b => b.id === defaultBranchId) || allBranches[0]
              }
              if (targetBranch) {
                result.set(targetBranch.id, { qty: parsed, branchName: targetBranch.name })
              }
            }
          }
        }

        return result
      }

      let imported = 0, created = 0, updated = 0, skipped = 0
      const errors: string[] = []
      const warnings: string[] = []

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i]
        try {
          const name         = colMap(row, 'name', 'productname', 'product name', 'item name', 'itemname')
          const rawSku       = colMap(row, 'sku', 'code', 'itemcode', 'item code', 'product code').trim()
          const rawBarcode   = colMap(row, 'barcode', 'ean', 'upc', 'gtin', 'isbn').trim()
          const categoryName = colMap(row, 'category', 'categoryname', 'category name')
          const supplierName = colMap(row, 'supplier', 'suppliername', 'supplier name', 'vendor')
          const unit         = colMap(row, 'unit', 'uom', 'measure') || 'pcs'
          const costPrice    = parseFloat(colMap(row, 'cost', 'costprice', 'cost price', 'purchase price') || '0') || 0
          const sellingPrice = parseFloat(colMap(row, 'price', 'sellingprice', 'selling price', 'sale price', 'mrp') || '0') || 0
          const taxRate      = parseFloat(colMap(row, 'tax', 'taxrate', 'tax rate', 'vat') || '0') || 0
          const minStock     = parseInt(colMap(row, 'minstock', 'min stock', 'reorder', 'reorder level') || '5') || 5
          const description  = colMap(row, 'description', 'desc', 'notes')
          const discountVal  = colMap(row, 'discount', 'discountpct', 'discountpercentage', 'discountpercent', 'discount_pct', 'discount_percentage', 'discount %', 'discount percentage')

          if (!name) { skipped++; continue }

          const hasSku = rawSku !== ''
          const hasBarcode = rawBarcode !== ''

          if (!hasSku) {
            warnings.push(`Row ${i + 2}: "${name}" — SKU வழங்கப்படவில்லை (No SKU provided in CSV)`)
          }
          if (!hasBarcode) {
            warnings.push(`Row ${i + 2}: "${name}" — Barcode வழங்கப்படவில்லை (No Barcode provided in CSV)`)
          }

          let discountPct = 0
          if (discountVal !== '') {
            const parsed = parseFloat(discountVal.replace(/%/g, '').trim())
            if (isNaN(parsed)) {
              errors.push(`Row ${i + 2}: Invalid Discount Percentage value "${discountVal}". Must be a number between 0 and 100.`)
              skipped++
              continue
            }
            if (parsed < 0 || parsed > 100) {
              errors.push(`Row ${i + 2}: Discount Percentage must be between 0 and 100. Received: ${parsed}%`)
              skipped++
              continue
            }
            discountPct = parsed
          }

          const normalizedCategory = normalizeCategoryPath(categoryName)
          const categoryId = normalizedCategory ? (catMap.get(titleCase(normalizedCategory).toLowerCase()) || null) : null
          const supplierId  = supplierName ? (supMap.get(supplierName.toLowerCase()) || null) : null

          // Determine branch ownership for imported products
          const importUser = store.get('auth_user') as Record<string, unknown> | undefined
          const importBranchId = isSuperAdmin(importUser) ? null : (importUser?.branch_id as string || null)

          // Lookup existing product by user-supplied SKU, Barcode, or Name — PREVENTS DUPLICATE ENTRY
          const existing = findExistingProduct(db, hasSku ? rawSku : null, hasBarcode ? rawBarcode : null, name)

          if (existing && duplicateStrategy === 'skip') {
            skipped++
            continue
          }

          const productId = existing ? String(existing.id) : crypto.randomUUID()

          // Exactly what the user provided, NO auto-generated category/brand SKUs!
          const finalBarcode = hasBarcode ? rawBarcode : (existing ? (existing.barcode as string | null) : null)
          const finalSku = hasSku
            ? rawSku
            : (existing
                ? (existing.sku as string)
                : (hasBarcode ? rawBarcode : `NO-SKU-${productId.slice(0, 8).toUpperCase()}`))

          if (existing) {
            let finalName: string
            let finalCategoryId: string | null
            let finalSupplierId: string | null
            let updatedBarcode: string | null
            let updatedSku: string
            let finalUnit: string
            let finalCost: number
            let finalSelling: number
            let finalTax: number
            let finalDiscount: number
            let finalMinStock: number
            let finalDesc: string | null

            if (duplicateStrategy === 'fill_empty') {
              // Fill only fields that were empty in previous upload
              finalName = (existing.name as string) || name
              updatedSku = hasSku ? ((existing.sku as string) || rawSku) : (existing.sku as string)
              updatedBarcode = (existing.barcode as string | null) || (hasBarcode ? rawBarcode : null)
              finalCategoryId = (existing.category_id as string | null) || categoryId || null
              finalSupplierId = (existing.supplier_id as string | null) || supplierId || null
              finalUnit = (existing.unit && existing.unit !== 'pcs') ? (existing.unit as string) : (unit || 'pcs')
              finalCost = (Number(existing.cost_price || 0) > 0) ? Number(existing.cost_price) : costPrice
              finalSelling = (Number(existing.selling_price || 0) > 0) ? Number(existing.selling_price) : sellingPrice
              finalTax = (Number(existing.tax_rate || 0) > 0) ? Number(existing.tax_rate) : taxRate
              finalDiscount = (Number(existing.discount_pct || 0) > 0) ? Number(existing.discount_pct) : discountPct
              finalMinStock = (Number(existing.min_stock_level || 5) !== 5) ? Number(existing.min_stock_level) : (minStock || 5)
              finalDesc = (existing.description as string | null) || (description || null)
            } else {
              // Override with new CSV data
              finalName = name || (existing.name as string)
              updatedSku = hasSku ? rawSku : (existing.sku as string)
              updatedBarcode = hasBarcode ? rawBarcode : (existing.barcode as string | null)
              finalCategoryId = categoryId || (existing.category_id as string | null)
              finalSupplierId = supplierId || (existing.supplier_id as string | null)
              finalUnit = unit || (existing.unit as string) || 'pcs'
              finalCost = costPrice > 0 ? costPrice : (existing.cost_price as number) || 0
              finalSelling = sellingPrice > 0 ? sellingPrice : (existing.selling_price as number) || 0
              finalTax = taxRate > 0 ? taxRate : (existing.tax_rate as number) || 0
              finalDiscount = discountPct > 0 ? discountPct : (existing.discount_pct as number) || 0
              finalMinStock = minStock !== 5 ? minStock : (existing.min_stock_level as number) || 5
              finalDesc = description || (existing.description as string | null)
            }

            db.prepare(`UPDATE products SET name=?, sku=?, category_id=?, supplier_id=?, barcode=?, unit=?,
              cost_price=?, selling_price=?, tax_rate=?, discount_pct=?, min_stock_level=?, description=?, is_active=1, updated_at=datetime('now')
              WHERE id=?`).run(finalName, updatedSku, finalCategoryId, finalSupplierId, updatedBarcode, finalUnit,
              finalCost, finalSelling, finalTax, finalDiscount, finalMinStock, finalDesc, productId)

            await enqueuSync('products', productId, 'UPDATE', {
              id: productId, name: finalName, sku: updatedSku, barcode: updatedBarcode, category_id: finalCategoryId,
              supplier_id: finalSupplierId, unit: finalUnit, cost_price: finalCost,
              selling_price: finalSelling, tax_rate: finalTax, discount_pct: finalDiscount, min_stock_level: finalMinStock,
              description: finalDesc, is_active: true
            })
            updated++
          } else {
            db.prepare(`INSERT INTO products (id, branch_id, name, sku, barcode, category_id, supplier_id, unit,
              cost_price, selling_price, tax_rate, discount_pct, min_stock_level, description)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(productId, importBranchId, name, finalSku, finalBarcode,
              categoryId, supplierId, unit, costPrice, sellingPrice, taxRate, discountPct, minStock, description || null)
            await enqueuSync('products', productId, 'INSERT', {
              id: productId, branch_id: importBranchId, name, sku: finalSku, barcode: finalBarcode,
              category_id: categoryId, supplier_id: supplierId, unit, cost_price: costPrice,
              selling_price: sellingPrice, tax_rate: taxRate, discount_pct: discountPct, min_stock_level: minStock,
              description: description || null, is_active: true
            })
            created++
          }

          // Sync product discount rule if discountPct > 0
          if (discountPct > 0) {
            const existingDisc = db.prepare("SELECT id FROM discounts WHERE scope = 'product' AND product_id = ? AND branch_id IS NULL").get(productId) as { id: string } | undefined
            if (existingDisc) {
              db.prepare("UPDATE discounts SET value = ?, is_active = 1, updated_at = datetime('now') WHERE id = ?").run(discountPct, existingDisc.id)
            } else {
              db.prepare("INSERT INTO discounts (id, name, type, value, scope, product_id, is_active) VALUES (?, ?, 'percentage', ?, 'product', ?, 1)")
                .run(crypto.randomUUID(), `${name} discount`, discountPct, productId)
            }
          }

          // Set opening stock branch-wise for all branches specified in row
          const branchStocks = extractRowBranchStocks(row)

          if (branchStocks.size > 0) {
            const user = store.get('auth_user') as Record<string, unknown>
            if (!canManageAllBranchStock(db, user)) {
              throw new Error('Only main-branch inventory managers can import stock quantities')
            }

            for (const [branchId, { qty: branchStockQty, branchName }] of branchStocks.entries()) {
              const existingStock = db.prepare('SELECT id, quantity, damaged_qty FROM stocks WHERE product_id=? AND branch_id=?').get(productId, branchId) as { id: string; quantity: number; damaged_qty: number } | undefined

              if (duplicateStrategy === 'fill_empty' && existingStock && Number(existingStock.quantity) > 0) {
                // Keep existing stock untouched
                continue
              }

              if (existingStock && branchStockQty < Number(existingStock.damaged_qty || 0)) {
                throw new Error(`Imported stock for branch "${branchName}" cannot be lower than the recorded damaged quantity (${existingStock.damaged_qty})`)
              }

              let stockMovement: Record<string, unknown> | null = null
              db.transaction(() => {
                if (existingStock) {
                  db.prepare(`UPDATE stocks SET quantity=?, updated_at=datetime('now') WHERE product_id=? AND branch_id=?`).run(branchStockQty, productId, branchId)
                } else {
                  db.prepare(`INSERT INTO stocks (id, product_id, branch_id, quantity) VALUES (?,?,?,?)`).run(crypto.randomUUID(), productId, branchId, branchStockQty)
                }
                const delta = branchStockQty - Number(existingStock?.quantity || 0)
                if (delta !== 0) {
                  stockMovement = insertStockMovement(db, {
                    product_id: productId,
                    from_branch_id: delta < 0 ? branchId : null,
                    to_branch_id: delta > 0 ? branchId : null,
                    quantity: Math.abs(delta),
                    movement_type: 'ADJUSTMENT',
                    notes: `Product import opening stock (${branchName})`,
                    created_by: (user?.id as string) || null,
                  })
                }
              })()
              await syncStockRow(db, productId, branchId)
              if (stockMovement) await enqueuSync('stock_movements', String((stockMovement as Record<string, unknown>).id), 'INSERT', stockMovement)
            }
          }

          imported++
        } catch (rowErr) {
          errors.push(`Row ${i + 2}: ${(rowErr as Error).message}`)
          skipped++
        }
      }

      return { success: true, data: { imported, created, updated, skipped, errors, warnings, mode: 'standard', duplicateStrategy } }
  })

  safeHandle(ipcMain, 'products:normalizeCatalog', async () => {
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
  })

  safeHandle(ipcMain, 'products:catalogAudit', async () => {
      const db = getDb()
      const missingSku = db.prepare(`
        SELECT COUNT(*) AS count
        FROM products
        WHERE is_active = 1 AND (sku IS NULL OR TRIM(sku) = '' OR sku LIKE 'NO-SKU-%' OR sku LIKE 'PENDING-%')
      `).get() as { count: number }

      const duplicateSkuGroups = db.prepare(`
        SELECT COUNT(*) AS count FROM (
          SELECT sku
          FROM products
          WHERE is_active = 1 AND sku IS NOT NULL AND TRIM(sku) != '' AND sku NOT LIKE 'NO-SKU-%' AND sku NOT LIKE 'PENDING-%'
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
          totalProducts: (db.prepare('SELECT COUNT(*) AS count FROM products').get() as { count: number }).count,
          missingSku: missingSku.count,
          duplicateSkuGroups: duplicateSkuGroups.count,
          duplicateSkuProducts: duplicateSkuProducts.count,
          totalCategories: categories.length,
          rootCategories,
          missingShortCodes,
          nonNormalizedCategories,
        },
      }
  })

  safeHandle(ipcMain, 'products:exportCsv', async () => {
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
      const canManageAll = canManageAllBranchStock(db, authUser)

      const branches = db.prepare('SELECT id, name, code FROM branches WHERE is_active = 1 ORDER BY name ASC').all() as { id: string; name: string; code?: string }[]

      const allStocks = db.prepare('SELECT product_id, branch_id, quantity FROM stocks').all() as { product_id: string; branch_id: string; quantity: number }[]
      const stockMap = new Map<string, number>()
      for (const s of allStocks) {
        stockMap.set(`${s.product_id}:${s.branch_id}`, Number(s.quantity) || 0)
      }

      let sql = `
        SELECT p.id, p.sku, p.barcode, p.name, c.name as category, sp.name as supplier,
               p.unit, p.cost_price, p.selling_price, p.discount_pct as discount_percentage, p.tax_rate, p.min_stock_level,
               p.description, p.is_active
        FROM products p
        LEFT JOIN categories c ON c.id = p.category_id
        LEFT JOIN suppliers sp ON sp.id = p.supplier_id
        WHERE 1=1
      `
      const params: unknown[] = []
      if (!superAdmin && branchId && !canManageAll) {
        sql += ' AND (p.branch_id = ? OR p.branch_id IS NULL)'
        params.push(branchId)
      }
      sql += ' ORDER BY p.name'

      const rows = db.prepare(sql).all(...params) as Record<string, unknown>[]

      const branchHeaders = canManageAll && branches.length > 0
        ? branches.map(b => `Stock (${b.name})`)
        : ['Stock']

      const headers = [
        'Product Name', 'SKU', 'Category', 'Cost Price', 'Selling Price',
        ...branchHeaders,
        'Discount Percentage', 'Barcode', 'Supplier', 'Unit', 'Tax Rate', 'Min Stock Level', 'Description', 'Is Active'
      ]

      const csvRows = rows.map(row => {
        const prodId = String(row.id || '')
        const branchStockValues = canManageAll && branches.length > 0
          ? branches.map(b => String(stockMap.get(`${prodId}:${b.id}`) ?? 0))
          : [String(stockMap.get(`${prodId}:${branchId || ''}`) ?? 0)]

        const line = [
          csvCell(row.name),
          csvCell(row.sku),
          csvCell(row.category),
          csvCell(row.cost_price),
          csvCell(row.selling_price),
          ...branchStockValues.map(v => csvCell(v)),
          csvCell(row.discount_percentage),
          csvCell(row.barcode),
          csvCell(row.supplier),
          csvCell(row.unit),
          csvCell(row.tax_rate),
          csvCell(row.min_stock_level),
          csvCell(row.description),
          csvCell(row.is_active ? '1' : '0')
        ]
        return line.join(',')
      })

      const csv = [headers.join(','), ...csvRows].join('\r\n')
      try {
        fs.writeFileSync(result.filePath, csv, 'utf8')
      } catch (err: any) {
        if (err?.code === 'EBUSY' || err?.code === 'EPERM' || String(err?.message || err).includes('EBUSY')) {
          return {
            success: false,
            error: `File is locked or open in Excel: "${path.basename(result.filePath)}". Please close it in Excel and try again, or save with a different filename.`
          }
        }
        throw err
      }
      return { success: true, data: { path: result.filePath, exported: rows.length } }
  })

  safeHandle(ipcMain, 'products:downloadTemplate', async () => {
      const result = await dialog.showSaveDialog({
        title: 'Download Product Bulk Upload Template',
        defaultPath: 'product-import-template.csv',
        filters: [{ name: 'CSV', extensions: ['csv'] }]
      })
      if (result.canceled || !result.filePath) return { success: false, error: 'Cancelled' }

      const db = getDb()
      const branches = db.prepare('SELECT id, name, code FROM branches WHERE is_active = 1 ORDER BY name ASC').all() as { id: string; name: string; code?: string }[]

      const branchStockHeaders = branches.length > 0
        ? branches.map(b => `Stock (${b.name})`)
        : ['Stock (Main Branch)', 'Stock (Branch 2)']

      const headers = [
        'Product Name', 'SKU', 'Category', 'Cost Price', 'Selling Price',
        ...branchStockHeaders,
        'Discount Percentage', 'Barcode', 'Supplier', 'Unit', 'Tax Rate', 'Min Stock Level', 'Description'
      ]

      const sampleCounts1 = branches.length > 0 ? branches.map((_, i) => String(Math.max(5, 20 - i * 5))) : ['20', '15']
      const sampleCounts2 = branches.length > 0 ? branches.map((_, i) => String(Math.max(2, 10 - i * 3))) : ['10', '5']
      const sampleCounts3 = branches.length > 0 ? branches.map((_, i) => String(Math.max(10, 50 - i * 15))) : ['50', '30']

      const sampleRows = [
        ['Chair', 'C001', 'Furniture', '5000', '7500', ...sampleCounts1, '10', '4791234567801', 'Local Supplier', 'pcs', '0', '5', 'Ergonomic wooden chair'],
        ['Table', 'T001', 'Furniture', '10000', '15000', ...sampleCounts2, '15', '4791234567802', 'Local Supplier', 'pcs', '0', '5', 'Dining wooden table'],
        ['Ponni Rice 5kg', 'NP-RICE-5KG', 'Groceries', '850', '980', ...sampleCounts3, '0', '4791234567890', 'Local Supplier', 'pcs', '0', '10', 'Premium ponni boiled rice 5kg bag'],
      ]

      const csvContent = [
        headers.join(','),
        ...sampleRows.map(row => row.map(cell => csvCell(cell)).join(','))
      ].join('\r\n')

      try {
        fs.writeFileSync(result.filePath, csvContent, 'utf8')
      } catch (err: any) {
        if (err?.code === 'EBUSY' || err?.code === 'EPERM' || String(err?.message || err).includes('EBUSY')) {
          return {
            success: false,
            error: `File is locked or open in Excel: "${path.basename(result.filePath)}". Please close it in Excel and try again, or save with a different filename.`
          }
        }
        throw err
      }
      return { success: true, data: { path: result.filePath } }
  })
}
