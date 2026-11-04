import type Database from 'better-sqlite3'
import { createHash } from 'crypto'
import { readAdditionalProductFields } from './productSpreadsheet'

export type ImportStrategy = 'fill_empty' | 'override' | 'skip'
export type FieldMapping = Record<string, number>
export interface ImportIssue { row?: number; field?: string; message: string }
export interface PreviewBranch { name: string; exists: boolean; rows: number; fileQty: number; importQty: number; preservedRows: number }
export interface FurnitureReview {
  reviewId?: string
  rowCount: number
  productCount: number
  newProducts: number
  existingProducts: number
  skippedRows: number
  errors: ImportIssue[]
  warnings: ImportIssue[]
  branches: PreviewBranch[]
  sample: Record<string, unknown>[]
}
export interface MappingField { name: string; required?: boolean; aliases: string[] }
const normalize = (value: unknown) => String(value ?? '').trim().toLowerCase().replace(/[\s_\-()[\]:#/.]/g, '')
const codeKey = (value: unknown) => String(value ?? '').trim().toLowerCase()
export const furnitureMappingFields: MappingField[] = [
  { name: 'Product Name', required: true, aliases: ['Product Name', 'Name', 'Item Name', 'Product Description', 'Description', 'Desc'] },
  { name: 'SKU', required: true, aliases: ['SKU', 'Item Code', 'Product Code', 'Code', 'Product No'] },
  { name: 'Category', aliases: ['Category', 'Category Name'] },
  { name: 'Cost Price', aliases: ['Cost Price', 'Purchase Price', 'Unit Cost', 'Cost'] },
  { name: 'Selling Price', aliases: ['Selling Price', 'Sale Price', 'Unit Price LKR', 'Unit Price', 'Price', 'MRP', 'New Price'] },
  { name: 'Branch', aliases: ['Branch', 'Branch Name', 'Branch Code', 'Location'] },
  { name: 'Qty', aliases: ['Qty', 'Quantity', 'Stock', 'Opening Stock', 'Balance Stock', 'Current Stock'] },
  { name: 'Stock Date', aliases: ['Stock Date', 'Date'] },
  { name: 'Discount Percentage', aliases: ['Discount Percentage', 'Discount %', 'Discount', 'Discount Pct'] },
  { name: 'Barcode', aliases: ['Barcode', 'EAN', 'UPC', 'GTIN'] },
  { name: 'Supplier', aliases: ['Supplier', 'Supplier Name', 'Vendor'] },
  { name: 'Unit', aliases: ['Unit', 'UOM', 'Measure'] },
  { name: 'Tax Rate', aliases: ['Tax Rate', 'Tax', 'VAT'] },
  { name: 'Min Stock Level', aliases: ['Min Stock Level', 'Min Stock', 'Reorder Level'] },
  ...['Description', 'Brand', 'Wholesale Price', 'Short Name', 'ISBN', 'Rack No', 'Weight', 'Image URL', 'Not For Sale', 'Enable EMI', 'Manage Stock', 'Fast Product', 'Sale As Latest Price', 'Sale By', 'Employee Commission', 'Commission Type', 'Custom Field 1', 'Custom Field 2', 'Custom Field 3', 'Is Active'].map(name => ({ name, aliases: [name] })),
]

export function describeFurnitureSheet(grid: unknown[][], headerRow: number, branches: { name: string; code?: string | null }[]) {
  if (!Number.isInteger(headerRow) || headerRow < 0 || headerRow >= grid.length) throw new Error('Choose a valid header row')
  const headers = (grid[headerRow] || []).map((value, index) => ({ index, label: String(value ?? '').trim() || `Column ${index + 1}` }))
  const fields = [...furnitureMappingFields]
  for (const header of headers) {
    const explicit = header.label.match(/^(?:stock|qty|quantity)\s*[(:\-]\s*(.+?)\s*\)?$/i)
    const branch = branches.find(branch => normalize(header.label) === normalize(branch.name) || Boolean(branch.code && normalize(header.label) === normalize(branch.code)))
    if (explicit || branch) {
      const name = `Stock (${branch?.name || explicit![1].trim()})`
      if (!fields.some(field => field.name === name)) fields.push({ name, aliases: [header.label] })
    }
  }
  const mapping: FieldMapping = {}
  for (const field of fields) {
    const match = field.aliases.map(alias => headers.find(header => normalize(header.label) === normalize(alias))).find(Boolean)
    mapping[field.name] = match?.index ?? -1
  }
  return { headers, fields, mapping, sample: grid.slice(headerRow + 1, headerRow + 4).map(row => headers.map(header => String(row[header.index] ?? ''))) }
}

export function recommendFurnitureHeader(grid: unknown[][]): number {
  let best = 0, score = -1
  for (let index = 0; index < Math.min(grid.length, 15); index++) {
    const cells = (grid[index] || []).map(normalize)
    const found = furnitureMappingFields.slice(0, 8).filter(field => field.aliases.some(alias => cells.includes(normalize(alias)))).length
    if (found > score) { score = found; best = index }
  }
  return best
}

export function furnitureImportFingerprint(db: Database.Database): string {
  const snapshot = ['products', 'branches', 'stocks', 'pending_branch_stocks', 'categories', 'suppliers'].map(table => db.prepare(`SELECT * FROM ${table} ORDER BY id`).all())
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')
}

export function buildFurnitureImportReview(db: Database.Database, grid: unknown[][], headerRow: number, mapping: FieldMapping, strategy: ImportStrategy, defaultBranchId?: string) {
  const branches = db.prepare('SELECT id, name, code, is_active FROM branches').all() as { id: string; name: string; code?: string; is_active: number }[]
  const products = db.prepare('SELECT * FROM products').all() as Record<string, any>[]
  const descriptor = describeFurnitureSheet(grid, headerRow, branches)
  const allowed = new Set(descriptor.fields.map(field => field.name))
  const errors: ImportIssue[] = [], warnings: ImportIssue[] = []
  const rows: Record<string, unknown>[] = []
  const summaries = new Map<string, PreviewBranch>()
  const seenStock = new Set<string>(), seenNames = new Map<string, string>(), seenPrices = new Map<string, number>()
  const seenProducts = new Set<string>(), newProducts = new Set<string>(), existingProducts = new Set<string>()
  let rowCount = 0, skippedRows = 0
  for (const [field, index] of Object.entries(mapping)) {
    if (!allowed.has(field) || !Number.isInteger(index) || index < -1 || index >= descriptor.headers.length) errors.push({ field, message: 'Invalid column mapping. Select an available Excel column.' })
  }
  for (const field of furnitureMappingFields.filter(field => field.required)) if (mapping[field.name] === undefined || mapping[field.name] < 0) errors.push({ field: field.name, message: `Map ${field.name} before importing.` })
  const destinations = new Map<number, string>()
  for (const [field, index] of Object.entries(mapping)) {
    if (index < 0) continue
    const previous = destinations.get(index)
    if (previous && ![previous, field].every(name => ['Product Name', 'Description'].includes(name))) errors.push({ field, message: `${descriptor.headers[index]?.label} is mapped to both ${previous} and ${field}.` })
    destinations.set(index, field)
  }
  if (errors.length) return { rows, review: { rowCount, productCount: 0, newProducts: 0, existingProducts: 0, skippedRows, errors, warnings, branches: [], sample: [] } as FurnitureReview }

  for (let index = headerRow + 1; index < grid.length; index++) {
    const raw = grid[index]
    if (!raw || raw.every(value => value === '' || value === null || value === undefined)) continue
    const rowNumber = index + 1
    const row: Record<string, unknown> = {}
    for (const [field, column] of Object.entries(mapping)) if (column >= 0 && allowed.has(field)) row[field] = raw[column] ?? ''
    const name = String(row['Product Name'] ?? '').trim(), sku = String(row.SKU ?? '').trim()
    if (/^(grand\s*total|total|sub\s*total|balance|average)$/i.test(name)) { skippedRows++; continue }
    rowCount++
    for (const field of ['SKU', 'Barcode', 'ISBN']) {
      if (typeof row[field] === 'number') warnings.push({ row: rowNumber, field, message: `${field} is stored as a number in Excel. Verify leading zeros and long codes; Text format preserves them.` })
    }
    if (!name) errors.push({ row: rowNumber, field: 'Product Name', message: 'Product name is missing.' })
    if (!sku || sku === '-') errors.push({ row: rowNumber, field: 'SKU', message: 'Item Code / SKU is missing. Add the correct model code in Excel.' })
    const matches = products.filter(product => codeKey(product.sku) === codeKey(sku))
    if (matches.length > 1) errors.push({ row: rowNumber, field: 'SKU', message: `More than one POS product matches ${sku}; resolve the product codes first.` })
    const existing = matches.length === 1 ? matches[0] : undefined
    if (existing && strategy === 'skip') { skippedRows++; continue }
    if (existing && normalize(existing.name) !== normalize(name)) warnings.push({ row: rowNumber, field: 'Product Name', message: `SKU ${sku} matches existing product "${existing.name}". The SKU will determine the product.` })
    if (seenNames.has(codeKey(sku)) && normalize(seenNames.get(codeKey(sku))) !== normalize(name)) errors.push({ row: rowNumber, field: 'SKU', message: `SKU ${sku} has different product descriptions in this sheet. Confirm the model/colour codes before importing.` })
    seenNames.set(codeKey(sku), name)
    seenProducts.add(codeKey(sku)); (existing ? existingProducts : newProducts).add(codeKey(sku))
    if (!existing && products.some(product => normalize(product.name) === normalize(name) && codeKey(product.sku) !== codeKey(sku))) warnings.push({ row: rowNumber, field: 'SKU', message: `Another product uses the name "${name}" with a different SKU. This row will remain a separate product.` })
    for (const field of ['Cost Price', 'Selling Price', 'Discount Percentage', 'Tax Rate', 'Min Stock Level', 'Qty']) {
      const value = row[field]
      if (value === '' || value === undefined || value === null) continue
      const number = Number(String(value).replace(/,/g, ''))
      if (!Number.isFinite(number) || number < 0 || (['Qty', 'Min Stock Level'].includes(field) && !Number.isInteger(number)) || (['Discount Percentage', 'Tax Rate'].includes(field) && number > 100)) errors.push({ row: rowNumber, field, message: `Invalid ${field}: ${String(value)}.` })
      else row[field] = number
    }
    try { readAdditionalProductFields(row) } catch (error) { errors.push({ row: rowNumber, message: (error as Error).message }) }
    if (!existing && (row['Selling Price'] === undefined || row['Selling Price'] === '')) warnings.push({ row: rowNumber, field: 'Selling Price', message: 'Sale price is missing; the new product will have price 0 until edited.' })
    if (!existing && (row['Cost Price'] === undefined || row['Cost Price'] === '')) warnings.push({ row: rowNumber, field: 'Cost Price', message: 'Purchase cost is missing; the new product will have cost 0 until edited.' })
    if (typeof row['Selling Price'] === 'number' && Number.isFinite(row['Selling Price'])) {
      if (seenPrices.has(codeKey(sku)) && seenPrices.get(codeKey(sku)) !== row['Selling Price']) errors.push({ row: rowNumber, field: 'Selling Price', message: `${sku} has different sale prices across rows. POS uses one product sale price; choose a single price first.` })
      seenPrices.set(codeKey(sku), row['Selling Price'] as number)
    }
    if (row['Stock Date'] !== undefined && row['Stock Date'] !== '') {
      const date = String(row['Stock Date']).trim()
      const parts = date.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
      const iso = date.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T].*)?$/)
      const values = parts ? [+parts[3], +parts[2], +parts[1]] : iso ? [+iso[1], +iso[2], +iso[3]] : null
      if (typeof row['Stock Date'] === 'number') {
        if (!Number.isFinite(row['Stock Date']) || (row['Stock Date'] as number) <= 0 || (row['Stock Date'] as number) > 2958465) errors.push({ row: rowNumber, field: 'Stock Date', message: 'Invalid Excel stock date.' })
      }
      else if (!values || values.some(value => !Number.isFinite(value)) || new Date(Date.UTC(values[0], values[1] - 1, values[2])).toISOString().slice(0, 10) !== `${values[0]}-${String(values[1]).padStart(2, '0')}-${String(values[2]).padStart(2, '0')}`) errors.push({ row: rowNumber, field: 'Stock Date', message: 'Use a valid DD/MM/YYYY or YYYY-MM-DD stock date.' })
      if (typeof row['Stock Date'] === 'number' && Number.isFinite(row['Stock Date']) && (row['Stock Date'] as number) > 0 && (row['Stock Date'] as number) <= 2958465) row['Stock Date'] = new Date(Math.round(((row['Stock Date'] as number) - 25569) * 86400000)).toISOString().slice(0, 10)
    }
    const stocks = Object.entries(row).filter(([field, value]) => field.startsWith('Stock (') && value !== '' && value !== undefined && value !== null).map(([field, value]) => ({ branch: field.slice(7, -1), qty: value }))
    const quantityPresent = row.Qty !== undefined && row.Qty !== '' && row.Qty !== null
    if (stocks.length && quantityPresent) errors.push({ row: rowNumber, field: 'Qty', message: 'Use branch stock columns OR Branch + Qty in each row, not both.' })
    if (!stocks.length && quantityPresent) {
      const fallback = branches.find(branch => branch.id === defaultBranchId && branch.is_active)
      const branch = String(row.Branch ?? '').trim() || fallback?.name || ''
      if (!branch) errors.push({ row: rowNumber, field: 'Branch', message: 'Select a default branch or map the Branch column for this quantity.' })
      else stocks.push({ branch, qty: row.Qty })
    }
    if (String(row.Branch ?? '').trim() && !quantityPresent && !stocks.length) warnings.push({ row: rowNumber, field: 'Qty', message: 'A branch is specified without a quantity; no stock will change for this row.' })
    const base = Object.fromEntries(Object.entries(row).filter(([field]) => !field.startsWith('Stock (') && field !== 'Branch' && field !== 'Qty'))
    if (!stocks.length) rows.push(base)
    for (const stock of stocks) {
      const qty = Number(String(stock.qty).replace(/,/g, ''))
      if (!Number.isInteger(qty) || qty < 0) { errors.push({ row: rowNumber, field: 'Qty', message: `Invalid stock quantity for ${stock.branch}.` }); continue }
      const branchMatches = branches.filter(branch => normalize(branch.name) === normalize(stock.branch) || Boolean(branch.code && normalize(branch.code) === normalize(stock.branch)))
      if (branchMatches.length > 1) errors.push({ row: rowNumber, field: 'Branch', message: `Branch ${stock.branch} is ambiguous; use a unique branch name.` })
      const branch = branchMatches[0]
      if (branch && !branch.is_active) errors.push({ row: rowNumber, field: 'Branch', message: `Branch ${branch.name} is inactive.` })
      const branchName = branch?.name || stock.branch
      const key = `${normalize(branchName)}:${codeKey(sku)}`
      if (seenStock.has(key)) errors.push({ row: rowNumber, field: 'Qty', message: `Repeated ${sku} stock for ${branchName}. Consolidate these rows before importing; quantities will not be silently overwritten.` })
      seenStock.add(key)
      const oldStock = existing && branch ? db.prepare('SELECT quantity, damaged_qty FROM stocks WHERE product_id=? AND branch_id=?').get(existing.id, branch.id) as { quantity: number; damaged_qty: number } | undefined : undefined
      const preserved = strategy === 'fill_empty' && Boolean(oldStock && oldStock.quantity > 0)
      if (!preserved && oldStock && qty < oldStock.damaged_qty) errors.push({ row: rowNumber, field: 'Qty', message: `${branchName}: quantity cannot be below recorded damaged stock (${oldStock.damaged_qty}).` })
      if (!branch && qty === 0) warnings.push({ row: rowNumber, field: 'Qty', message: `${branchName}: zero quantity will not create a pending stock entry.` })
      const summary = summaries.get(normalize(branchName)) || { name: branchName, exists: Boolean(branch), rows: 0, fileQty: 0, importQty: 0, preservedRows: 0 }
      summary.rows++; summary.fileQty += qty; summary.importQty += preserved ? 0 : qty; summary.preservedRows += preserved ? 1 : 0
      summaries.set(normalize(branchName), summary)
      rows.push({ ...base, Branch: branchName, Qty: qty })
    }
  }
  if (!rowCount) errors.push({ message: 'No product rows found under the selected header row.' })
  else if (!rows.length) errors.push({ message: 'No rows remain to import. Change the existing-product setting or select another sheet.' })
  for (const branch of summaries.values()) if (!branch.exists) warnings.push({ field: 'Branch', message: `${branch.name}: ${branch.importQty} units will be held pending until this branch is created.` })
  if (summaries.size && !mappingHasDate(mapping)) warnings.push({ field: 'Stock Date', message: 'No stock date is mapped. Pending stock will use the import date; verify that these quantities are the intended opening balances.' })
  return { rows, review: { rowCount, productCount: seenProducts.size, newProducts: newProducts.size, existingProducts: existingProducts.size, skippedRows, errors, warnings, branches: [...summaries.values()], sample: rows.slice(0, 10) } as FurnitureReview }
}
function mappingHasDate(mapping: FieldMapping) { return Number.isInteger(mapping['Stock Date']) && mapping['Stock Date'] >= 0 }
