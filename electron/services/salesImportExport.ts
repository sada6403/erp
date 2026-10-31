import { dialog, BrowserWindow } from 'electron'
import path from 'path'
import crypto from 'crypto'
import * as XLSX from 'xlsx'
import type Database from 'better-sqlite3'
import { getDb } from '../database'
import { enqueuSync } from './syncQueue'
import { logAudit } from './auditLog'
import { insertStockMovement } from './stockMovement'
import { syncStockRow, syncCustomerRow } from './stockSync'
import { createCompanyStore } from './companyWorkspace'

const store = createCompanyStore()

interface ProductRecord {
  id: string
  name: string
  sku: string
  barcode: string | null
  selling_price: number
  cost_price: number
  tax_rate: number
  unit: string
  category_name: string | null
}

interface BillLineItem {
  query: string
  quantity: number
  unitPrice?: number
  discountAmount?: number
  taxRate?: number
}

interface ParsedBill {
  invoiceNumber: string
  date: string
  customerName: string
  customerPhone: string
  paymentMethod: string
  items: BillLineItem[]
}

export interface ImportSalesOptions {
  deductStock?: boolean
  branchId?: string
}

export interface ExportBillsFilters {
  status?: string
  search?: string
  dateFrom?: string
  dateTo?: string
  branchId?: string
  billType?: string
}

function money(v: number): number {
  return Math.round((Number(v) || 0) * 100) / 100
}

function parseQuantity(raw: unknown): number {
  if (raw === null || raw === undefined || raw === '') return 0
  if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 ? raw : 0
  const str = String(raw).trim()
  const match = str.match(/^([0-9]+(?:\.[0-9]+)?)/)
  if (!match) return 0
  const num = parseFloat(match[1])
  return Number.isFinite(num) && num > 0 ? num : 0
}

function parseExcelDate(val: unknown): string {
  if (!val) return new Date().toISOString().replace('T', ' ').substring(0, 19)
  if (val instanceof Date) {
    return val.toISOString().replace('T', ' ').substring(0, 19)
  }
  if (typeof val === 'number') {
    // Excel date serial number (epoch is 1899-12-30)
    const d = new Date(Math.round((val - 25569) * 86400 * 1000))
    if (!isNaN(d.getTime())) return d.toISOString().replace('T', ' ').substring(0, 19)
  }
  const str = String(val).trim()
  const parsed = new Date(str)
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString().replace('T', ' ').substring(0, 19)
  }
  return new Date().toISOString().replace('T', ' ').substring(0, 19)
}

function getAuthUser(): Record<string, unknown> | undefined {
  return store.get('auth_user') as Record<string, unknown> | undefined
}

function defaultBranchId(): string {
  return 'b1111111-1111-4111-8111-111111111111'
}

/**
 * Downloads a sample past sales import template workbook (.xlsx)
 */
export async function downloadPastSalesTemplate(): Promise<{ success: boolean; filePath?: string; cancelled?: boolean; error?: string }> {
  try {
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
    const saveResult = await dialog.showSaveDialog(win!, {
      title: 'Download Past Sales Import Template',
      defaultPath: 'past-sales-import-template.xlsx',
      filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }],
    })
    if (saveResult.canceled || !saveResult.filePath) return { success: false, cancelled: true }

    const wb = XLSX.utils.book_new()

    // Sheet 1: Sample Sales (Standard Tabular Format)
    const sampleRows = [
      {
        'Bill No': 'INV-PAST-1001',
        'Date': '2024-05-10 10:15',
        'Customer Name': 'Kumaran Silva',
        'Customer Phone': '0771234567',
        'Product Name or SKU or Barcode': 'Ponni Boiled Rice',
        'Quantity': 2,
        'Unit Price': 1450,
        'Discount Amount': 0,
        'Tax Rate %': 0,
        'Payment Method': 'Cash',
        'Notes': 'Historical sale from old POS',
      },
      {
        'Bill No': 'INV-PAST-1001',
        'Date': '2024-05-10 10:15',
        'Customer Name': 'Kumaran Silva',
        'Customer Phone': '0771234567',
        'Product Name or SKU or Barcode': 'Anchor Full Cream Milk Powder 400g',
        'Quantity': 1,
        'Unit Price': 1050,
        'Discount Amount': 0,
        'Tax Rate %': 0,
        'Payment Method': 'Cash',
        'Notes': 'Same bill multi-item',
      },
      {
        'Bill No': 'INV-PAST-1002',
        'Date': '2024-05-10 11:30',
        'Customer Name': 'M. Selvam',
        'Customer Phone': '0712345678',
        'Product Name or SKU or Barcode': 'White Cooking Oil 1L',
        'Quantity': 1,
        'Unit Price': 750,
        'Discount Amount': 0,
        'Tax Rate %': 0,
        'Payment Method': 'Card',
        'Notes': '',
      },
      {
        'Bill No': 'INV-PAST-1003',
        'Date': '2024-05-10 12:45',
        'Customer Name': 'Walk-in Customer',
        'Customer Phone': '',
        'Product Name or SKU or Barcode': 'Sugar White',
        'Quantity': 5,
        'Unit Price': 260,
        'Discount Amount': 0,
        'Tax Rate %': 0,
        'Payment Method': 'Cash',
        'Notes': 'Cash walk-in',
      },
      {
        'Bill No': 'INV-PAST-1003',
        'Date': '2024-05-10 12:45',
        'Customer Name': 'Walk-in Customer',
        'Customer Phone': '',
        'Product Name or SKU or Barcode': 'Mysore Dhal Red Lentils 1kg',
        'Quantity': 2,
        'Unit Price': 380,
        'Discount Amount': 0,
        'Tax Rate %': 0,
        'Payment Method': 'Cash',
        'Notes': '',
      },
    ]

    const wsSales = XLSX.utils.json_to_sheet(sampleRows)
    wsSales['!cols'] = [
      { wch: 18 }, // Bill No
      { wch: 18 }, // Date
      { wch: 22 }, // Customer Name
      { wch: 16 }, // Customer Phone
      { wch: 36 }, // Product Name or SKU or Barcode
      { wch: 10 }, // Quantity
      { wch: 12 }, // Unit Price
      { wch: 15 }, // Discount Amount
      { wch: 12 }, // Tax Rate %
      { wch: 15 }, // Payment Method
      { wch: 26 }, // Notes
    ]
    XLSX.utils.book_append_sheet(wb, wsSales, 'Past Sales')

    // Sheet 2: Detailed Instructions
    const instructions = XLSX.utils.aoa_to_sheet([
      ['Column Name', 'Required', 'Description & Examples'],
      ['Bill No', 'Recommended', 'Bill or Invoice Number. Multiple lines with the same Bill No will be grouped into one invoice with multiple items.'],
      ['Date', 'Optional', 'Date and time of sale (e.g. 2024-05-10 10:15). If blank, uses current timestamp.'],
      ['Customer Name', 'Optional', 'Name of customer. If new, the customer will be automatically created. Leave blank for Walk-in.'],
      ['Customer Phone', 'Optional', 'Mobile number of the customer.'],
      ['Product Name or SKU or Barcode', 'Yes', 'Product SKU (e.g. RIC-001), Barcode (e.g. 4791234567890), or exact/partial product name.'],
      ['Quantity', 'Yes', 'Number of items sold (e.g. 2, 5, 0.5).'],
      ['Unit Price', 'Optional', 'Selling price per item. If left blank, the system automatically uses the product\'s catalog selling price.'],
      ['Discount Amount', 'Optional', 'Rupee discount applied on this item (default: 0).'],
      ['Tax Rate %', 'Optional', 'Tax rate percentage (default: 0).'],
      ['Payment Method', 'Optional', 'Payment method: Cash, Card, Bank Transfer, Credit (default: Cash).'],
      ['Notes', 'Optional', 'Any additional remarks or reference for this bill.'],
      [],
      ['ADDITIONAL COMPATIBILITY NOTE:'],
      ['• You can ALSO upload Food City Matrix files directly (where product names are horizontal column headers and row cells contain quantities).'],
      ['• The system will automatically detect the layout and convert it into completed sales bills.'],
      ['• Physical Stock: During import, you will have the option to choose whether to deduct stock or keep current inventory unchanged.'],
    ])
    instructions['!cols'] = [{ wch: 28 }, { wch: 14 }, { wch: 75 }]
    XLSX.utils.book_append_sheet(wb, instructions, 'Instructions')

    XLSX.writeFile(wb, saveResult.filePath)
    return { success: true, filePath: saveResult.filePath }
  } catch (err) {
    return { success: false, error: (err as Error).message }
  }
}

/**
 * Imports past sales / invoices from an Excel file (.xlsx, .xls, .csv).
 * Supports both:
 * 1) Standard Tabular Format (columns: Bill No, Date, Customer, Product/SKU/Barcode, Qty, Unit Price)
 * 2) Matrix Format / Food City Format (columns: BILL NO, CUTOMER NAME, and product names as headers)
 */
export async function importSalesFromExcel(
  options: ImportSalesOptions = {}
): Promise<{
  success: boolean
  cancelled?: boolean
  error?: string
  filePath?: string
  format?: 'tabular' | 'matrix'
  importedBills?: number
  importedItems?: number
  totalSalesAmount?: number
  skippedCount?: number
  warnings?: string[]
}> {
  try {
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
    const { filePaths } = await dialog.showOpenDialog(win!, {
      title: 'Select Past Sales Excel / CSV File',
      filters: [{ name: 'Excel / CSV', extensions: ['xlsx', 'xls', 'csv'] }],
      properties: ['openFile'],
    })
    if (!filePaths || filePaths.length === 0) return { success: false, cancelled: true }

    const filePath = filePaths[0]
    const workbook = XLSX.readFile(filePath, { cellDates: true })

    // Find the best sheet with sales data
    let chosenSheetName = workbook.SheetNames[0]
    let maxRows = 0
    for (const name of workbook.SheetNames) {
      const s = workbook.Sheets[name]
      const range = XLSX.utils.decode_range(s['!ref'] || 'A1:A1')
      const rowCount = range.e.r - range.s.r + 1
      if (name.toLowerCase().includes('sale') || rowCount > maxRows) {
        chosenSheetName = name
        maxRows = rowCount
      }
    }

    const sheet = workbook.Sheets[chosenSheetName]
    const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as unknown[][]
    if (!rawData || rawData.length < 2) {
      return { success: false, error: 'The selected Excel sheet has no data rows.' }
    }

    // Locate the header row (scan rows 0 to 15)
    let headerRowIdx = 0
    let detectedFormat: 'tabular' | 'matrix' = 'tabular'
    let headers: string[] = []

    for (let r = 0; r < Math.min(15, rawData.length); r++) {
      const row = (rawData[r] || []).map(c => String(c ?? '').trim())
      const nonEmpties = row.filter(Boolean)
      if (nonEmpties.length < 2) continue

      const rowUpper = row.map(c => c.toUpperCase())
      const hasBill = rowUpper.some(c => c.includes('BILL') || c.includes('INVOICE') || c.includes('INV #') || c === 'NAME' || c.includes('CUTOMER'))
      const hasProd = rowUpper.some(c => c.includes('PRODUCT') || c.includes('ITEM') || c.includes('SKU') || c.includes('BARCODE'))
      const hasQty = rowUpper.some(c => c.includes('QTY') || c.includes('QUANTITY') || c.includes('COUNT'))

      if (hasBill && hasProd && hasQty) {
        headerRowIdx = r
        headers = row
        detectedFormat = 'tabular'
        break
      }

      // Matrix check: has BILL NO or CUSTOMER and many columns (> 5)
      if (hasBill && row.length >= 6) {
        headerRowIdx = r
        headers = row
        detectedFormat = 'matrix'
        break
      }
    }

    if (headers.length === 0) {
      headerRowIdx = 0
      headers = (rawData[0] || []).map(c => String(c ?? '').trim())
      detectedFormat = headers.length > 8 ? 'matrix' : 'tabular'
    }

    const db = getDb()
    const user = getAuthUser()
    const branchId = options.branchId || (user?.branch_id as string) || defaultBranchId()
    const deductStock = Boolean(options.deductStock)

    // Load active products for matching
    const allProducts = db.prepare(`
      SELECT p.id, p.name, p.sku, p.barcode, p.selling_price, p.cost_price, p.tax_rate, p.unit, c.name as category_name
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      WHERE p.is_active = 1
    `).all() as ProductRecord[]

    const byBarcode = new Map<string, ProductRecord>()
    const bySku = new Map<string, ProductRecord>()
    const byName = new Map<string, ProductRecord>()
    const byNormalized = new Map<string, ProductRecord>()

    for (const p of allProducts) {
      if (p.barcode) byBarcode.set(p.barcode.trim(), p)
      bySku.set(p.sku.trim().toLowerCase(), p)
      byName.set(p.name.trim().toLowerCase(), p)
      const norm = p.name.toLowerCase().replace(/[^a-z0-9]/g, '')
      if (norm) byNormalized.set(norm, p)
    }

    // Helper: multi-tier fuzzy product resolution
    const findProduct = (query: string): ProductRecord | undefined => {
      const q = query.trim()
      if (!q) return undefined

      if (byBarcode.has(q)) return byBarcode.get(q)
      if (bySku.has(q.toLowerCase())) return bySku.get(q.toLowerCase())
      if (byName.has(q.toLowerCase())) return byName.get(q.toLowerCase())

      const qNorm = q.toLowerCase().replace(/[^a-z0-9]/g, '')
      if (byNormalized.has(qNorm)) return byNormalized.get(qNorm)

      // Token word matching
      const tokens = q.toLowerCase().split(/\s+/).filter(t => t.length > 1)
      if (tokens.length > 0) {
        let best: ProductRecord | undefined
        let bestScore = 0
        for (const p of allProducts) {
          const pNorm = p.name.toLowerCase()
          let score = 0
          for (const t of tokens) {
            if (pNorm.includes(t)) score++
          }
          if (score === tokens.length && score > bestScore) {
            best = p
            bestScore = score
          }
        }
        if (best) return best
      }

      // Substring matching
      for (const p of allProducts) {
        const pClean = p.name.toLowerCase().replace(/[^a-z0-9]/g, '')
        if (pClean.includes(qNorm) || (qNorm.length >= 4 && qNorm.includes(pClean))) {
          return p
        }
      }
      return undefined
    }

    // Load existing customers for auto-matching
    const customerMap = new Map<string, string>() // trimmed lowercase name -> customer id
    const existingCustomers = db.prepare('SELECT id, name FROM customers').all() as { id: string; name: string }[]
    for (const c of existingCustomers) {
      customerMap.set(c.name.trim().toLowerCase(), c.id)
    }

    const resolveCustomerId = (custName: string, custPhone?: string): string | null => {
      const name = custName.trim()
      if (!name || name.toLowerCase() === 'walk-in' || name.toLowerCase() === 'walk in') return null
      const lower = name.toLowerCase()
      if (customerMap.has(lower)) return customerMap.get(lower)!

      const newId = crypto.randomUUID()
      const newCust = {
        id: newId,
        branch_id: branchId,
        name,
        phone: custPhone?.trim() || null,
        address: 'Imported Customer',
        notes: 'Created during past sales Excel import',
      }
      db.prepare(`
        INSERT INTO customers (id, branch_id, name, phone, address, notes)
        VALUES (@id, @branch_id, @name, @phone, @address, @notes)
      `).run(newCust)
      customerMap.set(lower, newId)
      enqueuSync('customers', newId, 'INSERT', newCust).catch(() => {})
      return newId
    }

    const billsMap = new Map<string, ParsedBill>()
    const warnings: string[] = []

    if (detectedFormat === 'tabular') {
      // Find column indices
      const billColIdx = headers.findIndex(h => /bill|invoice|inv\s*#|receipt/i.test(h))
      const dateColIdx = headers.findIndex(h => /date|time|created/i.test(h))
      const custColIdx = headers.findIndex(h => /customer|cutomer|client/i.test(h))
      const phoneColIdx = headers.findIndex(h => /phone|mobile|tel/i.test(h))
      const prodColIdx = headers.findIndex(h => /product|item|sku|barcode|description|particular/i.test(h))
      const qtyColIdx = headers.findIndex(h => /qty|quantity|count|pcs/i.test(h))
      const priceColIdx = headers.findIndex(h => /price|rate|mrp|unit\s*price/i.test(h))
      const discColIdx = headers.findIndex(h => /discount|disc/i.test(h))
      const taxColIdx = headers.findIndex(h => /tax|vat/i.test(h))
      const payColIdx = headers.findIndex(h => /payment|pay\s*mode|method/i.test(h))

      let autoSeq = 1000

      for (let r = headerRowIdx + 1; r < rawData.length; r++) {
        const row = rawData[r] as unknown[]
        if (!row || row.every(c => c === '' || c === null || c === undefined)) continue

        const rawBill = billColIdx >= 0 ? String(row[billColIdx] ?? '').trim() : ''
        const billNo = rawBill || `PAST-BILL-${++autoSeq}`
        const rawDate = dateColIdx >= 0 ? row[dateColIdx] : null
        const date = parseExcelDate(rawDate)
        const custName = custColIdx >= 0 ? String(row[custColIdx] ?? '').trim() : ''
        const custPhone = phoneColIdx >= 0 ? String(row[phoneColIdx] ?? '').trim() : ''
        const prodQuery = prodColIdx >= 0 ? String(row[prodColIdx] ?? '').trim() : ''
        const rawQty = qtyColIdx >= 0 ? row[qtyColIdx] : 1
        const qty = parseQuantity(rawQty) || 1
        const unitPrice = priceColIdx >= 0 && row[priceColIdx] !== '' && !isNaN(Number(row[priceColIdx])) ? Number(row[priceColIdx]) : undefined
        const discountAmount = discColIdx >= 0 && !isNaN(Number(row[discColIdx])) ? Number(row[discColIdx]) : 0
        const taxRate = taxColIdx >= 0 && !isNaN(Number(row[taxColIdx])) ? Number(row[taxColIdx]) : 0
        const paymentMethod = payColIdx >= 0 ? String(row[payColIdx] ?? '').trim() || 'cash' : 'cash'

        if (!prodQuery) continue

        if (!billsMap.has(billNo)) {
          billsMap.set(billNo, {
            invoiceNumber: billNo,
            date,
            customerName: custName,
            customerPhone: custPhone,
            paymentMethod,
            items: [],
          })
        }

        billsMap.get(billNo)!.items.push({
          query: prodQuery,
          quantity: qty,
          unitPrice,
          discountAmount,
          taxRate,
        })
      }
    } else {
      // MATRIX FORMAT (Food City style)
      // Locate metadata columns: BILL NO, CUSTOMER NAME, DATE
      const billColIdx = headers.findIndex(h => /bill\s*no|bill|invoice/i.test(h))
      const custColIdx = headers.findIndex(h => /cutomer|customer/i.test(h))
      const dateColIdx = headers.findIndex(h => /date|time/i.test(h))

      const productColumns: Array<{ colIdx: number; headerName: string; product?: ProductRecord }> = []

      for (let c = 0; c < headers.length; c++) {
        if (c === billColIdx || c === custColIdx || c === dateColIdx) continue
        const hName = headers[c]?.trim()
        if (!hName || /^(name|sl|no|total|amount|balalnce|balance)$/i.test(hName)) continue

        const matchedProd = findProduct(hName)
        if (matchedProd) {
          productColumns.push({ colIdx: c, headerName: hName, product: matchedProd })
        } else {
          warnings.push(`Matrix product column "${hName}" could not be matched to an active product.`)
        }
      }

      let autoSeq = 2000

      for (let r = headerRowIdx + 1; r < rawData.length; r++) {
        const row = rawData[r] as unknown[]
        if (!row || row.every(c => c === '' || c === null || c === undefined)) continue

        const rawBill = billColIdx >= 0 ? String(row[billColIdx] ?? '').trim() : ''
        const billNo = rawBill ? `FC-BILL-${rawBill}` : `PAST-BILL-${++autoSeq}`
        const custName = custColIdx >= 0 ? String(row[custColIdx] ?? '').trim() : ''
        const rawDate = dateColIdx >= 0 ? row[dateColIdx] : null
        const date = parseExcelDate(rawDate)

        const items: BillLineItem[] = []

        for (const col of productColumns) {
          const val = row[col.colIdx]
          const qty = parseQuantity(val)
          if (qty > 0 && col.product) {
            items.push({
              query: col.product.sku,
              quantity: qty,
              unitPrice: col.product.selling_price,
            })
          }
        }

        if (items.length > 0) {
          billsMap.set(billNo, {
            invoiceNumber: billNo,
            date,
            customerName: custName,
            customerPhone: '',
            paymentMethod: 'cash',
            items,
          })
        }
      }
    }

    if (billsMap.size === 0) {
      return {
        success: false,
        error: 'No valid sales bills could be parsed from the Excel file. Please verify column headers.',
        warnings,
      }
    }

    // Now insert invoices, invoice_items, payments inside a database transaction
    let importedBills = 0
    let importedItems = 0
    let totalSalesAmount = 0
    let skippedCount = 0

    const checkInvoiceExists = db.prepare('SELECT id FROM invoices WHERE invoice_number = ?')
    const insertInvoiceStmt = db.prepare(`
      INSERT INTO invoices (id, invoice_number, branch_id, customer_id, cashier_id,
        bill_type, status, subtotal, discount_amount, tax_amount, total_amount, paid_amount, due_amount,
        notes, created_at, updated_at)
      VALUES (@id, @invoice_number, @branch_id, @customer_id, @cashier_id,
        @bill_type, @status, @subtotal, @discount_amount, @tax_amount, @total_amount, @paid_amount, @due_amount,
        @notes, @created_at, @updated_at)
    `)

    const insertItemStmt = db.prepare(`
      INSERT INTO invoice_items (id, invoice_id, product_id, quantity, unit_price,
        discount_pct, discount_amount, tax_rate, tax_amount, line_total, updated_at)
      VALUES (@id, @invoice_id, @product_id, @quantity, @unit_price,
        @discount_pct, @discount_amount, @tax_rate, @tax_amount, @line_total, @updated_at)
    `)

    const insertPaymentStmt = db.prepare(`
      INSERT INTO payments (id, invoice_id, method, amount, reference, received_by, paid_at, updated_at)
      VALUES (@id, @invoice_id, @method, @amount, @reference, @received_by, @paid_at, @updated_at)
    `)

    const updateStockStmt = db.prepare(`
      UPDATE stocks SET quantity = quantity - ?, updated_at = datetime('now')
      WHERE product_id = ? AND branch_id = ?
    `)
    const insertStockStmt = db.prepare(`
      INSERT INTO stocks (id, product_id, branch_id, quantity, damaged_qty, updated_at)
      VALUES (?, ?, ?, ?, 0, datetime('now'))
    `)

    const syncQueueItems: Array<{ table: string; id: string; op: 'INSERT'; data: Record<string, unknown> }> = []

    const executeTransaction = db.transaction(() => {
      for (const [_, bill] of billsMap) {
        if (checkInvoiceExists.get(bill.invoiceNumber)) {
          skippedCount++
          continue
        }

        const customerId = resolveCustomerId(bill.customerName, bill.customerPhone)
        const invoiceId = crypto.randomUUID()

        let billSubtotal = 0
        let billDiscount = 0
        let billTax = 0

        const validItems: Array<{
          id: string
          product: ProductRecord
          quantity: number
          unitPrice: number
          discountAmount: number
          taxRate: number
          taxAmount: number
          lineTotal: number
        }> = []

        for (const item of bill.items) {
          const product = findProduct(item.query)
          if (!product) {
            warnings.push(`Item "${item.query}" in bill ${bill.invoiceNumber} not found in catalog, skipped.`)
            continue
          }

          const unitPrice = money(item.unitPrice !== undefined && item.unitPrice >= 0 ? item.unitPrice : product.selling_price)
          const qty = item.quantity
          const itemDiscount = money(item.discountAmount || 0)
          const taxable = money(unitPrice * qty - itemDiscount)
          const taxRate = item.taxRate !== undefined ? item.taxRate : product.tax_rate
          const itemTax = money(taxable * (taxRate / 100))
          const lineTotal = money(taxable + itemTax)

          billSubtotal += money(unitPrice * qty)
          billDiscount += itemDiscount
          billTax += itemTax

          validItems.push({
            id: crypto.randomUUID(),
            product,
            quantity: qty,
            unitPrice,
            discountAmount: itemDiscount,
            taxRate,
            taxAmount: itemTax,
            lineTotal,
          })
        }

        if (validItems.length === 0) {
          skippedCount++
          continue
        }

        billSubtotal = money(billSubtotal)
        billDiscount = money(billDiscount)
        billTax = money(billTax)
        const billTotal = money(billSubtotal - billDiscount + billTax)

        // Insert Invoice
        const invoiceRecord = {
          id: invoiceId,
          invoice_number: bill.invoiceNumber,
          branch_id: branchId,
          customer_id: customerId,
          cashier_id: (user?.id as string) || 'u9999999-9999-4999-8999-999999999999',
          bill_type: 'RETAIL',
          status: 'completed',
          subtotal: billSubtotal,
          discount_amount: billDiscount,
          tax_amount: billTax,
          total_amount: billTotal,
          paid_amount: billTotal,
          due_amount: 0,
          notes: 'Imported past sale from Excel',
          created_at: bill.date,
          updated_at: bill.date,
        }
        insertInvoiceStmt.run(invoiceRecord)
        syncQueueItems.push({ table: 'invoices', id: invoiceId, op: 'INSERT', data: invoiceRecord })

        // Insert Line Items
        for (const vItem of validItems) {
          const itemRecord = {
            id: vItem.id,
            invoice_id: invoiceId,
            product_id: vItem.product.id,
            quantity: vItem.quantity,
            unit_price: vItem.unitPrice,
            discount_pct: 0,
            discount_amount: vItem.discountAmount,
            tax_rate: vItem.taxRate,
            tax_amount: vItem.taxAmount,
            line_total: vItem.lineTotal,
            updated_at: bill.date,
          }
          insertItemStmt.run(itemRecord)
          syncQueueItems.push({ table: 'invoice_items', id: vItem.id, op: 'INSERT', data: itemRecord })

          // Optional stock deduction
          if (deductStock) {
            const stockRow = db.prepare('SELECT id, quantity FROM stocks WHERE product_id = ? AND branch_id = ?')
              .get(vItem.product.id, branchId) as { id: string; quantity: number } | undefined
            if (stockRow) {
              updateStockStmt.run(vItem.quantity, vItem.product.id, branchId)
            } else {
              insertStockStmt.run(crypto.randomUUID(), vItem.product.id, branchId, -vItem.quantity)
            }
            insertStockMovement(db, {
              product_id: vItem.product.id,
              from_branch_id: branchId,
              to_branch_id: null,
              quantity: vItem.quantity,
              movement_type: 'SALE',
              reference_order_id: invoiceId,
              notes: `Past bill ${bill.invoiceNumber}`,
              created_by: (user?.id as string) || null,
            })
            syncStockRow(db, vItem.product.id, branchId).catch(() => {})
          }
          importedItems++
        }

        // Insert Payment
        const paymentId = crypto.randomUUID()
        const paymentRecord = {
          id: paymentId,
          invoice_id: invoiceId,
          method: bill.paymentMethod || 'cash',
          amount: billTotal,
          reference: 'PAST_IMPORT',
          received_by: (user?.id as string) || null,
          paid_at: bill.date,
          updated_at: bill.date,
        }
        insertPaymentStmt.run(paymentRecord)
        syncQueueItems.push({ table: 'payments', id: paymentId, op: 'INSERT', data: paymentRecord })

        if (customerId) {
          syncCustomerRow(db, customerId).catch(() => {})
        }

        importedBills++
        totalSalesAmount += billTotal
      }
    })

    executeTransaction()

    // Enqueue background sync
    for (const q of syncQueueItems) {
      enqueuSync(q.table, q.id, q.op, q.data).catch(() => {})
    }

    logAudit(db, {
      userId: (user?.id as string) || null,
      branchId,
      action: 'PAST_SALES_IMPORT',
      tableName: 'invoices',
      recordId: `batch-${Date.now()}`,
      newValues: {
        filePath: path.basename(filePath),
        format: detectedFormat,
        importedBills,
        importedItems,
        totalSalesAmount: money(totalSalesAmount),
        skippedCount,
      },
    })

    return {
      success: true,
      filePath,
      format: detectedFormat,
      importedBills,
      importedItems,
      totalSalesAmount: money(totalSalesAmount),
      skippedCount,
      warnings: warnings.slice(0, 50),
    }
  } catch (err) {
    return { success: false, error: (err as Error).message }
  }
}

/**
 * Exports bills and their detailed line items to a formatted Excel workbook (.xlsx)
 */
export async function exportBillsToExcel(
  filters: ExportBillsFilters = {}
): Promise<{ success: boolean; filePath?: string; cancelled?: boolean; exportedBills?: number; exportedItems?: number; error?: string }> {
  try {
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
    const defaultName = `bills-export-${new Date().toISOString().slice(0, 10)}.xlsx`

    const saveResult = await dialog.showSaveDialog(win!, {
      title: 'Export Bills to Excel',
      defaultPath: defaultName,
      filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }],
    })
    if (saveResult.canceled || !saveResult.filePath) return { success: false, cancelled: true }

    const db = getDb()
    const caller = getAuthUser()
    const perms = ((caller?.role as Record<string, unknown>)?.permissions as Record<string, unknown>) ||
      (caller?.permissions as Record<string, unknown>) || {}
    const isGlobal = Boolean(perms.all || perms.reports)
    const callerBranchId = caller?.branch_id as string | undefined

    const conditions: string[] = []
    const params: unknown[] = []

    if (!isGlobal && callerBranchId) {
      conditions.push('i.branch_id = ?')
      params.push(callerBranchId)
    } else if (filters.branchId) {
      conditions.push('i.branch_id = ?')
      params.push(filters.branchId)
    }

    if (filters.status) {
      conditions.push('i.status = ?')
      params.push(filters.status)
    }
    if (filters.billType) {
      conditions.push('COALESCE(i.bill_type, "RETAIL") = ?')
      params.push(filters.billType)
    }
    if (filters.dateFrom) {
      conditions.push('date(i.created_at) >= date(?)')
      params.push(filters.dateFrom)
    }
    if (filters.dateTo) {
      conditions.push('date(i.created_at) <= date(?)')
      params.push(filters.dateTo)
    }
    if (filters.search) {
      conditions.push('(i.invoice_number LIKE ? OR c.name LIKE ? OR c.phone LIKE ?)')
      params.push(`%${filters.search}%`, `%${filters.search}%`, `%${filters.search}%`)
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

    const invoiceRows = db.prepare(`
      SELECT i.id, i.invoice_number, i.created_at, i.status, COALESCE(i.bill_type, 'RETAIL') as bill_type,
             b.name as branch_name, c.name as customer_name, c.phone as customer_phone,
             u.name as cashier_name,
             i.subtotal, i.discount_amount, i.tax_amount, i.total_amount, i.paid_amount, i.due_amount,
             (SELECT GROUP_CONCAT(DISTINCT method) FROM payments WHERE invoice_id = i.id) as payment_methods,
             i.notes
      FROM invoices i
      LEFT JOIN branches b ON b.id = i.branch_id
      LEFT JOIN customers c ON c.id = i.customer_id
      LEFT JOIN users u ON u.id = i.cashier_id
      ${whereClause}
      ORDER BY i.created_at DESC
      LIMIT 100000
    `).all(params) as Record<string, unknown>[]

    if (invoiceRows.length === 0) {
      return { success: false, error: 'No bills match the selected filters to export.' }
    }

    const invoiceIds = invoiceRows.map(r => String(r.id))
    // Query line items in batches of 500 to stay safely under SQLite parameter limit
    const itemRows: Record<string, unknown>[] = []
    const BATCH_SIZE = 500
    for (let i = 0; i < invoiceIds.length; i += BATCH_SIZE) {
      const batchIds = invoiceIds.slice(i, i + BATCH_SIZE)
      const batchItems = db.prepare(`
        SELECT ii.invoice_id, i.invoice_number, i.created_at,
               c.name as customer_name,
               p.name as product_name, p.sku, p.barcode, p.unit,
               cat.name as category_name,
               ii.quantity, ii.unit_price, ii.discount_amount, ii.tax_amount, ii.line_total
        FROM invoice_items ii
        JOIN invoices i ON i.id = ii.invoice_id
        JOIN products p ON p.id = ii.product_id
        LEFT JOIN categories cat ON cat.id = p.category_id
        LEFT JOIN customers c ON c.id = i.customer_id
        WHERE ii.invoice_id IN (${batchIds.map(() => '?').join(',')})
        ORDER BY i.created_at DESC, ii.id ASC
      `).all(batchIds) as Record<string, unknown>[]
      itemRows.push(...batchItems)
    }

    const wb = XLSX.utils.book_new()

    // Sheet 1: Bills Summary
    const summaryData = invoiceRows.map(r => ({
      'Bill #': r.invoice_number,
      'Date & Time': r.created_at,
      'Branch': r.branch_name || 'Main Branch',
      'Customer': r.customer_name || 'Walk-in',
      'Customer Phone': r.customer_phone || '',
      'Cashier': r.cashier_name || 'System',
      'Bill Type': r.bill_type,
      'Status': r.status,
      'Payment Method': r.payment_methods || 'Cash',
      'Subtotal (Rs.)': Number(r.subtotal || 0),
      'Discount (Rs.)': Number(r.discount_amount || 0),
      'Tax (Rs.)': Number(r.tax_amount || 0),
      'Total Amount (Rs.)': Number(r.total_amount || 0),
      'Paid Amount (Rs.)': Number(r.paid_amount || 0),
      'Due Amount (Rs.)': Number(r.due_amount || 0),
      'Notes': r.notes || '',
    }))

    const wsSummary = XLSX.utils.json_to_sheet(summaryData)
    wsSummary['!cols'] = [
      { wch: 18 }, // Bill #
      { wch: 20 }, // Date & Time
      { wch: 18 }, // Branch
      { wch: 20 }, // Customer
      { wch: 15 }, // Phone
      { wch: 16 }, // Cashier
      { wch: 12 }, // Bill Type
      { wch: 12 }, // Status
      { wch: 16 }, // Payment Method
      { wch: 15 }, // Subtotal
      { wch: 15 }, // Discount
      { wch: 12 }, // Tax
      { wch: 18 }, // Total Amount
      { wch: 16 }, // Paid Amount
      { wch: 14 }, // Due Amount
      { wch: 24 }, // Notes
    ]
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Bills Summary')

    // Sheet 2: Detailed Line Items
    const itemsData = itemRows.map(it => ({
      'Bill #': it.invoice_number,
      'Date & Time': it.created_at,
      'Customer': it.customer_name || 'Walk-in',
      'Category': it.category_name || 'General',
      'Product Name': it.product_name,
      'SKU': it.sku,
      'Barcode': it.barcode || '',
      'Unit': it.unit || 'pcs',
      'Quantity': Number(it.quantity || 0),
      'Unit Price (Rs.)': Number(it.unit_price || 0),
      'Discount (Rs.)': Number(it.discount_amount || 0),
      'Tax (Rs.)': Number(it.tax_amount || 0),
      'Line Total (Rs.)': Number(it.line_total || 0),
    }))

    const wsItems = XLSX.utils.json_to_sheet(itemsData)
    wsItems['!cols'] = [
      { wch: 18 }, // Bill #
      { wch: 20 }, // Date & Time
      { wch: 20 }, // Customer
      { wch: 18 }, // Category
      { wch: 32 }, // Product Name
      { wch: 15 }, // SKU
      { wch: 16 }, // Barcode
      { wch: 8 },  // Unit
      { wch: 10 }, // Quantity
      { wch: 15 }, // Unit Price
      { wch: 14 }, // Discount
      { wch: 12 }, // Tax
      { wch: 16 }, // Line Total
    ]
    XLSX.utils.book_append_sheet(wb, wsItems, 'Detailed Items')

    XLSX.writeFile(wb, saveResult.filePath)

    logAudit(db, {
      userId: (caller?.id as string) || null,
      branchId: filters.branchId || null,
      action: 'BILLS_EXPORT_EXCEL',
      tableName: 'invoices',
      recordId: `export-${Date.now()}`,
      newValues: {
        exportedBills: invoiceRows.length,
        exportedItems: itemRows.length,
        filePath: path.basename(saveResult.filePath),
      },
    })

    return {
      success: true,
      filePath: saveResult.filePath,
      exportedBills: invoiceRows.length,
      exportedItems: itemRows.length,
    }
  } catch (err) {
    return { success: false, error: (err as Error).message }
  }
}
