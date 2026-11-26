import { dialog, BrowserWindow } from 'electron'
import path from 'path'
import crypto from 'crypto'
import * as XLSX from 'xlsx'
import { getDb } from '../database'
import { logAudit } from './auditLog'
import { insertStockMovement } from './stockMovement'
import { createCompanyStore } from './companyWorkspace'
import { resolveMainBranchId } from './branchAccess'
import { createReceiptBatch, ensureLegacyOpeningLayer } from './batchInventory'
import { batchDates } from './batchIdentity'
import { applyReceiptProductPrices } from './receiptProductPricing'
import { queueInventoryRecord } from './inventoryOutbox'
import {stockUnit,stockUnitFactor} from '../lib/inventoryUnits'
import {purchaseLine,validateMrp} from '../lib/purchaseMath'
import {applyPurchaseBalance} from './purchaseAccounting'

const store = createCompanyStore()

export interface ImportPOOptions {
  branchId?: string
  defaultSupplierId?: string
  markAsReceived?: boolean
}

function money(v: number): number {
  return Math.round((Number(v) || 0) * 100) / 100
}

export function parseQtyAndUnit(raw: unknown): { qty: number; unit?: string } {
  if (raw === null || raw === undefined || raw === '') return { qty: 0, unit: undefined }
  if (typeof raw === 'number') return { qty: Number.isFinite(raw) && raw > 0 ? raw : 0, unit: undefined }
  const str = String(raw).trim()
  if (/^no$/i.test(str)) return { qty: 0, unit: undefined }

  // Handles strings like "70KG", "110 PCS", "10 KG", "12 PACKT", "2.5 KG", "850 G"
  const match = str.match(/^([0-9]+(?:\.[0-9]+)?)\s*([a-zA-Z]+)?$/)
  if (!match) return { qty: 0, unit: undefined }
  const num = parseFloat(match[1])
  let unit = match[2]?.toLowerCase()
  if (unit === 'g' || unit === 'gm') unit = 'g'
  else if (unit === 'kg' || unit === 'kgs') unit = 'kg'
  else if (unit === 'pcs' || unit === 'pc' || unit === 'nos') unit = 'pcs'
  else if (unit === 'pkt' || unit === 'packt' || unit === 'packet') unit = 'pkt'
  else if (unit === 'ltr' || unit === 'l') unit = 'ltr'

  return { qty: Number.isFinite(num) && num > 0 ? num : 0, unit }
}

function parseCost(raw: unknown): number {
  if (raw === null || raw === undefined || raw === '') return 0
  if (typeof raw === 'number') return Number.isFinite(raw) && raw >= 0 ? raw : NaN
  const clean = String(raw).replace(/,/g, '').trim()
  const val = Number(clean)
  return Number.isFinite(val) && val >= 0 ? val : NaN
}

function getAuthUser(): Record<string, unknown> | undefined {
  return store.get('auth_user') as Record<string, unknown> | undefined
}

/**
 * Downloads a sample Purchase Order Import Template (.xlsx)
 */
export async function downloadPOTemplate(): Promise<{ success: boolean; filePath?: string; cancelled?: boolean; error?: string }> {
  try {
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
    const saveResult = await dialog.showSaveDialog(win!, {
      title: 'Download Purchase Order Import Template',
      defaultPath: 'purchase-order-import-template.xlsx',
      filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }],
    })
    if (saveResult.canceled || !saveResult.filePath) return { success: false, cancelled: true }

    const wb = XLSX.utils.book_new()

    // Sheet 1: Purchase Orders
    const sampleRows = [
      {
        'PO Number': 'PO-2026-10-001',
        'Order Date': '2026-10-13',
        'Supplier': 'Lanka Supermarket Distributors',
        'Item Name': 'Keeri Samba Rice 5kg',
        'Quantity': 50,
        'Unit Cost (Rs.)': 1250,
        'Selling Price (Rs.)': 1400,
        'Total Cost (Rs.)': 62500,
        'Status': 'RECEIVED',
        'Notes': 'Opening grocery procurement',
      },
      {
        'PO Number': 'PO-2026-10-001',
        'Order Date': '2026-10-13',
        'Supplier': 'Lanka Supermarket Distributors',
        'Item Name': 'Anchor Milk Powder 400g',
        'Quantity': 110,
        'Unit Cost (Rs.)': 1250,
        'Selling Price (Rs.)': 1300,
        'Total Cost (Rs.)': 137500,
        'Status': 'RECEIVED',
        'Notes': 'Dairy stock',
      },
      {
        'PO Number': 'PO-2026-10-002',
        'Order Date': '2026-10-14',
        'Supplier': 'Ceylon Sugar Mills',
        'Item Name': 'Sugar White 1kg',
        'Quantity': 300,
        'Unit Cost (Rs.)': 242,
        'Selling Price (Rs.)': 250,
        'Total Cost (Rs.)': 72600,
        'Status': 'RECEIVED',
        'Notes': 'Sugar 50kg bulk bags',
      },
      {
        'PO Number': 'PO-2026-10-003',
        'Order Date': '2026-10-15',
        'Supplier': 'Sunlight & Unilever',
        'Item Name': 'Sunlight Soap 115g',
        'Quantity': 100,
        'Unit Cost (Rs.)': 135,
        'Selling Price (Rs.)': 150,
        'Total Cost (Rs.)': 13500,
        'Status': 'RECEIVED',
        'Notes': 'Detergent & soaps',
      },
    ]

    const wsPO = XLSX.utils.json_to_sheet(sampleRows.map(row=>({...row,'Barcode':'','Unit':'pcs','Free Quantity':0,'Line Discount':0,'MRP':'','Batch Number':'','Manufacture Date':'','Expiry Date':''})))
    wsPO['!cols'] = [
      { wch: 18 }, // PO Number
      { wch: 14 }, // Order Date
      { wch: 30 }, // Supplier
      { wch: 32 }, // Item Name
      { wch: 12 }, // Quantity
      { wch: 15 }, // Unit Cost
      { wch: 18 }, // Selling Price
      { wch: 16 }, // Total Cost
      { wch: 12 }, // Status
      { wch: 30 }, // Notes
    ]
    XLSX.utils.book_append_sheet(wb, wsPO, 'Purchase Orders')

    // Sheet 2: Instructions
    const instructions = XLSX.utils.aoa_to_sheet([
      ['Column Name', 'Required', 'Description & Rules'],
      ['PO Number', 'Optional', 'Purchase Order identifier (e.g. PO-2026-10-001). Items with the same PO Number will be grouped into a single purchase order.'],
      ['Order Date', 'Optional', 'Date of purchase (e.g. 2026-10-13). If left empty, uses current date.'],
      ['Supplier', 'Optional', 'Supplier name. If not yet registered, the system will automatically create the supplier.'],
      ['Item Name', 'Yes', 'Product name, SKU, or Barcode.'],
      ['Quantity', 'Yes', 'Procurement quantity (e.g. 50, 110, 25.5).'],
      ['Unit Cost (Rs.)', 'Yes', 'Cost price paid per unit.'],
      ['Selling Price (Rs.)', 'Optional', 'Retail price. If provided, updates or sets the catalog selling price.'],
      ['Barcode', 'Optional', 'Exact product barcode; keep leading zeros.'],
      ['Unit', 'Optional', 'Quantity and all prices use this unit. kg/g and litre/ml convert automatically; bags/cartons require configured product pack sizes.'],
      ['Batch Number', 'Optional', 'Supplier batch identifier. Existing batches require review on the purchase screen.'],
      ['Manufacture Date', 'Optional', 'YYYY-MM-DD; leave empty for products without manufacture dates.'],
      ['Expiry Date', 'Optional', 'YYYY-MM-DD, after manufacture date; leave empty for non-expiring products.'],
      ['Free Quantity', 'Optional', 'Received free units; they increase stock without increasing invoice cost.'],
      ['Line Discount', 'Optional', 'Discount amount in rupees for this entire line, not a percentage.'],
      ['MRP', 'Optional', 'Maximum retail price per entered unit including tax. Selling price must not exceed it.'],
      ['Total Cost (Rs.)', 'Optional', 'Total amount (Quantity x Unit Cost). Calculated automatically if omitted.'],
      ['Status', 'Optional', 'RECEIVED (default, updates inventory stock) or DRAFT or SENT.'],
      ['Notes', 'Optional', 'Remarks or invoice reference from the vendor.'],
      [],
      ['COMPATIBILITY WITH COMPANY TRACKERS:'],
      ['• You can upload "Grocery Store Inventory Tracker.xlsx" directly!'],
      ['  The system automatically detects all daily procurement sheets (13.10.2026, 14, 15.10.2026, etc.) and creates separate purchase orders for each date.'],
      ['• Products not yet in the system will be automatically registered so no procurement row is lost.'],
    ])
    instructions['!cols'] = [{ wch: 22 }, { wch: 12 }, { wch: 80 }]
    XLSX.utils.book_append_sheet(wb, instructions, 'Instructions')

    XLSX.writeFile(wb, saveResult.filePath)
    return { success: true, filePath: saveResult.filePath }
  } catch (err) {
    return { success: false, error: (err as Error).message }
  }
}

/**
 * Imports Purchase Orders and Procurement records from Excel (.xlsx, .xls, .csv).
 * Supports both:
 * 1) Standard PO Excel templates (with PO Number, Supplier, Items)
 * 2) Grocery Store Inventory Tracker multi-sheet procurements (e.g. sheets 13.10.2026, 14, 15.10.2026, etc.)
 * 3) Food City Sheet1 Stock Register
 */
export async function importPOsFromExcel(
  options: ImportPOOptions = {}
): Promise<{
  success: boolean
  cancelled?: boolean
  error?: string
  filePath?: string
  importedPOs?: number
  totalItems?: number
  totalProcurementAmount?: number
  warnings?: string[]
}> {
  try {
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
    const { filePaths } = await dialog.showOpenDialog(win!, {
      title: 'Select Purchase Orders Excel File (Grocery Store Tracker / Food City / Standard PO)',
      filters: [{ name: 'Excel / CSV', extensions: ['xlsx', 'xls', 'csv'] }],
      properties: ['openFile'],
    })
    if (!filePaths || filePaths.length === 0) return { success: false, cancelled: true }

    const filePath = filePaths[0]
    const workbook = XLSX.readFile(filePath, { cellDates: true })
    const db = getDb()
    const user = getAuthUser()
    const mainBranchId = options.branchId || resolveMainBranchId(db)
    const markAsReceived = options.markAsReceived !== false
    // Persist the offline outbox in the same SQLite transaction as inventory.
    const queueRow=(table:string,id:string,data:Record<string,unknown>)=>{
      queueInventoryRecord(db,table,{...data,id})
    }

    // Pre-load suppliers
    const suppliers = db.prepare('SELECT id, name FROM suppliers').all() as { id: string; name: string }[]
    const supplierMap = new Map<string, string>()
    for (const s of suppliers) {
      supplierMap.set(s.name.trim().toLowerCase(), s.id)
    }

    const resolveSupplierId = (nameCandidate?: string): string => {
      const name = nameCandidate?.trim() || 'Main Supermarket Supplier'
      const lower = name.toLowerCase()
      if (supplierMap.has(lower)) return supplierMap.get(lower)!

      const newId = crypto.randomUUID()
      db.prepare(`
        INSERT INTO suppliers (id, name, contact, is_active, created_at, updated_at)
        VALUES (?, ?, 'Procurement Team', 1, datetime('now'), datetime('now'))
      `).run(newId, name)
      supplierMap.set(lower, newId)
      queueRow('suppliers',newId,db.prepare('SELECT * FROM suppliers WHERE id=?').get(newId) as Record<string,unknown>)
      return newId
    }

    // Pre-load products
    interface ProdRow {
      id: string
      name: string
      sku: string
      barcode: string | null
      cost_price: number
      selling_price: number
      unit: string
    }
    const allProducts = db.prepare(`SELECT id, name, sku, barcode, cost_price, selling_price, unit FROM products`).all() as ProdRow[]
    const byName = new Map<string, ProdRow>()
    const bySku = new Map<string, ProdRow>()
    const byBarcode = new Map<string, ProdRow>()

    for (const p of allProducts) {
      byName.set(p.name.trim().toLowerCase(), p)
      bySku.set(p.sku.trim().toLowerCase(), p)
      if(p.barcode) byBarcode.set(p.barcode.trim().toLowerCase(), p)
    }

    const findOrCreateProduct = (itemName: string, costPrice: number, sellingPrice: number, unitCandidate?: string, barcode?:string, supplierId?:string): ProdRow => {
      const trimmed = itemName.trim()
      const lower = trimmed.toLowerCase()
      if(barcode && byBarcode.has(barcode.toLowerCase())) return byBarcode.get(barcode.toLowerCase())!
      if (byBarcode.has(lower)) return byBarcode.get(lower)!
      if (bySku.has(lower)) return bySku.get(lower)!
      if (byName.has(lower)) {
        const match=byName.get(lower)!
        if(barcode && match.barcode && barcode!==match.barcode)throw new Error(`Barcode conflicts with existing product ${trimmed}`)
        return match
      }

      // Auto-create product if missing so procurement items are never dropped
      if(!(sellingPrice>0))throw new Error(`Enter a selling price for new product ${trimmed}`)
      const newId = crypto.randomUUID()
      const skuPrefix = 'GRO'
      const skuSuffix = crypto.randomUUID().slice(0, 6).toUpperCase()
      const newSku = `${skuPrefix}-${skuSuffix}`
      const unit = unitCandidate || 'pcs'
      const cost = money(costPrice > 0 ? costPrice : 0)
      const price = money(sellingPrice)

      const newProduct: ProdRow = {
        id: newId,
        name: trimmed,
        sku: newSku,
        barcode: barcode||null,
        cost_price: cost,
        selling_price: price,
        unit,
      }

      db.prepare(`
        INSERT INTO products (id, name, sku, barcode, supplier_id, cost_price, selling_price, unit, is_active, created_at, updated_at)
        VALUES (@id, @name, @sku, @barcode, @supplier_id, @cost_price, @selling_price, @unit, 1, datetime('now'), datetime('now'))
      `).run({...newProduct,supplier_id:supplierId||null})

      allProducts.push(newProduct)
      byName.set(lower, newProduct)
      bySku.set(newSku.toLowerCase(), newProduct)
      if(barcode)byBarcode.set(barcode.toLowerCase(),newProduct)

      queueRow('products',newId,db.prepare('SELECT * FROM products WHERE id=?').get(newId) as Record<string,unknown>)
      return newProduct
    }

    interface ExtractedItem {
      itemName: string
      quantity: number
      unitCost: number
      sellingPrice: number
      lineTotal: number
      unit?: string
      batchNumber?: string
      expiryDate?: string
      mfgDate?: string
      barcode?:string
      freeQuantity:number;discount:number;mrp:number|null
    }

    interface ExtractedPO {
      poNumber: string
      date: string
      supplierName: string
      items: ExtractedItem[]
      notes?: string
    }

    const extractedPOs: ExtractedPO[] = []
    const warnings: string[] = []
    const errors: string[] = []
    const importDate = (raw: unknown): string => {
      if(raw === '' || raw == null) return ''
      const value=raw instanceof Date ? `${raw.getFullYear()}-${String(raw.getMonth()+1).padStart(2,'0')}-${String(raw.getDate()).padStart(2,'0')}` : String(raw).trim()
      batchDates({product_id:'import',mfg_date:value})
      return value
    }

    // Helper: inspect a sheet and check if it contains procurement/PO rows
    const processSheetForPO = (sheet: XLSX.WorkSheet, sheetName: string) => {
      const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as unknown[][]
      if (!rawRows || rawRows.length < 2) return

      // Find header row (rows 0 to 8)
      let headerIdx = -1
      for (let r = 0; r < Math.min(8, rawRows.length); r++) {
        const row = (rawRows[r] || []).map(c => String(c).trim().toLowerCase())
        const hasItem = row.some(c => c.includes('item name') || c.includes('product name') || c.includes('product') || c === 'name')
        const hasQtyOrCost = row.some(c => c.includes('procuremet') || c.includes('procurement') || c.includes('qty') || c.includes('cost') || c.includes('rate') || c.includes('quantity'))
        if (hasItem && hasQtyOrCost) {
          headerIdx = r
          break
        }
      }

      if (headerIdx < 0) return

      const headers = (rawRows[headerIdx] || []).map(c => String(c).trim())
      const nameColIdx = headers.findIndex(h => /item\s*name|product\s*name|product|item|^name$/i.test(h))
      const qtyColIdx = headers.findIndex(h => /in\s*procuremet|in\s*procurement|qty|quantity|count/i.test(h))
      const costColIdx = headers.findIndex(h => /unit\s*cost|rate|cost\s*price|cost/i.test(h))
      const totalColIdx = headers.findIndex(h => /total\s*cost|value/i.test(h))
      const priceColIdx = headers.findIndex(h => /selling\s*price|new\s*price|^price$/i.test(h))
      const poColIdx = headers.findIndex(h => /po\s*number|order\s*no|po\s*#/i.test(h))
      const supColIdx = headers.findIndex(h => /supplier|vendor/i.test(h))
      const dateColIdx = headers.findIndex(h => /^(order|purchase)\s*date$|^date$/i.test(h))
      const batchColIdx = headers.findIndex(h => /batch/i.test(h))
      const expiryColIdx = headers.findIndex(h => /expiry|expiration/i.test(h))
      const mfgColIdx = headers.findIndex(h => /manufactur|mfg/i.test(h))
      const barcodeColIdx = headers.findIndex(h=>/^barcode$/i.test(h))
      const unitColIdx = headers.findIndex(h=>/^unit$/i.test(h))
      const freeColIdx=headers.findIndex(h=>/^free\s*(quantity|qty)$/i.test(h))
      const discountColIdx=headers.findIndex(h=>/^(line\s*)?discount(\s*amount)?$/i.test(h))
      const mrpColIdx=headers.findIndex(h=>/^mrp$/i.test(h))

      if (nameColIdx < 0) return

      // Derive default PO Number and Date from sheet name or current timestamp
      // e.g. Sheet "13.10.2026" -> Date: 2026-10-13, PO Number: PO-2026-10-13
      let defaultDate = new Date().toISOString().slice(0, 10)
      let defaultPoNumber = `PO-${sheetName.replace(/[^a-zA-Z0-9]/g, '-').toUpperCase()}`
      const dateMatch = sheetName.match(/(\d{1,2})[.-](\d{1,2})[.-](\d{4})/)
      if (dateMatch) {
        const day = dateMatch[1].padStart(2, '0')
        const month = dateMatch[2].padStart(2, '0')
        const year = dateMatch[3]
        defaultDate = `${year}-${month}-${day}`
        defaultPoNumber = `PO-${year}-${month}-${day}`
      }

      const poItemsMap = new Map<string, ExtractedItem[]>()
      const poMetadataMap = new Map<string, { date: string; supplier: string }>()

      for (let r = headerIdx + 1; r < rawRows.length; r++) {
        const row = rawRows[r] as unknown[]
        if (!row || row.every(c => c === '' || c === null || c === undefined)) continue

        const itemName = nameColIdx >= 0 ? String(row[nameColIdx] ?? '').trim() : ''
        if (!itemName || /^(total|balance|average|subtotal)$/i.test(itemName)) continue

        let { qty, unit } = qtyColIdx >= 0 ? parseQtyAndUnit(row[qtyColIdx]) : { qty: 0, unit: undefined }
        
        if (qty <= 0) { errors.push(`${sheetName} row ${r+1}: quantity must be greater than zero`); continue }
        const freeQuantity=freeColIdx>=0?parseCost(row[freeColIdx]):0,discount=discountColIdx>=0?parseCost(row[discountColIdx]):0
        const mrp=mrpColIdx>=0&&row[mrpColIdx]!==''?parseCost(row[mrpColIdx]):null

        let unitCost = costColIdx >= 0 ? parseCost(row[costColIdx]) : 0
        const totalCost = totalColIdx >= 0 ? parseCost(row[totalColIdx]) : 0
        if (unitCost === 0 && totalCost > 0 && qty > 0) {
          unitCost = money((totalCost+discount) / qty)
        }
        const lineTotal = money(unitCost*qty-discount)

        const sellingPrice = priceColIdx >= 0 ? parseCost(row[priceColIdx]) : 0
        if(!Number.isFinite(unitCost) || unitCost<=0 || !Number.isFinite(sellingPrice)) { errors.push(`${sheetName} row ${r+1}: invalid purchase or selling price`); continue }
        try{purchaseLine(qty,unitCost,freeQuantity,discount);validateMrp(sellingPrice||null,mrp);if(totalCost>0&&Math.abs(totalCost-lineTotal)>0.01)throw new Error('Total cost must equal paid quantity × cost minus discount')}catch(error){errors.push(`${sheetName} row ${r+1}: ${(error as Error).message}`);continue}
        const poNum = poColIdx >= 0 && row[poColIdx] ? String(row[poColIdx]).trim() : defaultPoNumber
        let rowDate: string, expiryDate: string, mfgDate: string
        try {
          rowDate=importDate((dateColIdx>=0 ? row[dateColIdx] : '') || defaultDate)
          expiryDate=importDate(expiryColIdx>=0 ? row[expiryColIdx] : '')
          mfgDate=importDate(mfgColIdx>=0 ? row[mfgColIdx] : '')
          batchDates({product_id:'import',expiry_date:expiryDate,mfg_date:mfgDate})
        } catch { errors.push(`${sheetName} row ${r+1}: invalid purchase, manufacture or expiry date`); continue }
        const supplier = supColIdx >= 0 && row[supColIdx] ? String(row[supColIdx]).trim() : 'Supermarket Procurement Supplier'

        if (!poItemsMap.has(poNum)) {
          poItemsMap.set(poNum, [])
          poMetadataMap.set(poNum, { date: rowDate, supplier })
        }

        poItemsMap.get(poNum)!.push({
          itemName,
          quantity: qty,
          unitCost,
          sellingPrice,
          lineTotal,
          unit: unitColIdx>=0 && row[unitColIdx] ? String(row[unitColIdx]).trim().toLowerCase() : unit,
          barcode:barcodeColIdx>=0 ? String(row[barcodeColIdx]||'').trim() : '',
          batchNumber: batchColIdx>=0 ? String(row[batchColIdx]||'').trim() : '',
          expiryDate, mfgDate,
          freeQuantity,discount,mrp,
        })
      }

      for (const [poNum, items] of poItemsMap) {
        if (items.length > 0) {
          const meta = poMetadataMap.get(poNum) || { date: defaultDate, supplier: 'Supermarket Procurement Supplier' }
          extractedPOs.push({
            poNumber: poNum,
            date: meta.date,
            supplierName: meta.supplier,
            items,
            notes: `Imported from sheet "${sheetName}" in ${path.basename(filePath)}`,
          })
        }
      }
    }

    // Process all sheets in the workbook (supports multi-sheet procurement in Grocery Store Tracker)
    for (const sheetName of workbook.SheetNames) {
      // Skip the product catalog sheet if it's purely catalog and other sheets exist
      if ((sheetName === 'Sheet4' || sheetName.toLowerCase().includes('stock and sales')) && workbook.SheetNames.length > 1) {
        continue
      }
      const s = workbook.Sheets[sheetName]
      processSheetForPO(s, sheetName)
    }

    // Fallback: If no procurement sheets matched, check remaining sheets (like Sheet4 / Stock and Sales)
    if (errors.length) return {success:false,error:`Import validation failed. No stock was changed.\n${errors.slice(0,50).join('\n')}`}
    if (extractedPOs.length === 0) {
      for (const sheetName of workbook.SheetNames) {
        const s = workbook.Sheets[sheetName]
        processSheetForPO(s, sheetName)
      }
    }

    if (errors.length) return {success:false,error:`Import validation failed. No stock was changed.\n${errors.slice(0,50).join('\n')}`}
    if (extractedPOs.length === 0) {
      return {
        success: false,
        error: 'No valid purchase orders or procurement rows found in the selected Excel file.',
      }
    }

    const seenOrders=new Set<string>()
    for(const po of extractedPOs){
      if(seenOrders.has(po.poNumber) || db.prepare('SELECT 1 FROM purchase_orders WHERE po_number=?').get(po.poNumber)) return {success:false,error:`Purchase ${po.poNumber} already exists or is repeated in this file. No stock was changed.`}
      seenOrders.add(po.poNumber)
    }
    const preview=await dialog.showMessageBox(win!,{
      type:'question',title:'Review purchase import',buttons:['Cancel','Import purchases'],defaultId:0,cancelId:0,
      message:`${extractedPOs.length} purchases · ${extractedPOs.reduce((n,po)=>n+po.items.length,0)} product rows`,
      detail:`${markAsReceived?'Receive stock and create batch cost layers':'Create draft orders without changing stock'}. Missing products and suppliers will be created.\n\n`+extractedPOs.slice(0,20).map(po=>`${po.poNumber} | ${po.date} | ${po.supplierName} | ${po.items.length} rows`).join('\n'),
    })
    if(preview.response!==1) return {success:false,cancelled:true}

    // Database insertion inside transaction
    let importedPOs = 0
    let totalItems = 0
    let totalProcurementAmount = 0

    const checkPOStmt = db.prepare('SELECT id FROM purchase_orders WHERE po_number = ?')
    const insertPOStmt = db.prepare(`
      INSERT INTO purchase_orders (id, po_number, branch_id, supplier_id, status, subtotal, total, total_amount, expected_date, received_date, received_at, notes, created_by, created_at, updated_at)
      VALUES (@id, @po_number, @branch_id, @supplier_id, @status, @subtotal, @total, @total_amount, @expected_date, @received_date, @received_at, @notes, @created_by, @created_at, @updated_at)
    `)

    const insertPOItemStmt = db.prepare(`
      INSERT INTO purchase_items (id, po_id, product_id, ordered_qty, quantity, received_qty, unit_cost, line_total, notes, updated_at)
      VALUES (@id, @po_id, @product_id, @ordered_qty, @quantity, @received_qty, @unit_cost, @line_total, @notes, @updated_at)
    `)

    const updateStockStmt = db.prepare(`
      UPDATE stocks SET quantity = quantity + ?, updated_at = datetime('now')
      WHERE product_id = ? AND branch_id = ? AND warehouse_id IS NULL
    `)
    const insertStockStmt = db.prepare(`
      INSERT INTO stocks (id, product_id, branch_id, quantity, damaged_qty, updated_at)
      VALUES (?, ?, ?, ?, 0, datetime('now'))
    `)

    const syncOps: Array<{ table: string; id: string; op: 'INSERT'; data: Record<string, unknown> }> = []

    const executeTransaction = db.transaction(() => {
      for (const po of extractedPOs) {
        const finalPoNumber = po.poNumber
        if (checkPOStmt.get(finalPoNumber)) {
          throw new Error(`Purchase ${finalPoNumber} already exists. Import cancelled to prevent duplicate stock.`)
        }

        const poId = crypto.randomUUID()
        const supplierId = options.defaultSupplierId || resolveSupplierId(po.supplierName)
        const poDate = po.date || new Date().toISOString().slice(0, 10)
        const poStatus = markAsReceived ? 'RECEIVED' : 'DRAFT'

        let poTotal = 0
        const validItems: Array<{
          product: ProdRow
          quantity: number
          unitCost: number
          lineTotal: number
          source: ExtractedItem
          normalized:ReturnType<typeof purchaseLine>
          mrp:number|null
        }> = []

        for (const it of po.items) {
          const product = findOrCreateProduct(it.itemName, it.unitCost, it.sellingPrice, it.unit,it.barcode,supplierId)
          const packs=it.unit && stockUnit(it.unit)!==stockUnit(product.unit) ? db.prepare('SELECT uom_name,conversion_factor FROM product_uom WHERE product_id=? AND is_base=0').all(product.id) as {uom_name:string;conversion_factor:number}[] : []
          const factor=it.unit?stockUnitFactor(it.unit,product.unit,packs):1
          const normalized=purchaseLine(it.quantity,it.unitCost,it.freeQuantity,it.discount,factor)
          const lineTotal = normalized.line_total
          const mrp=it.mrp==null?null:it.mrp/factor
          const productTax=db.prepare('SELECT * FROM products WHERE id=?').get(product.id) as {tax_rate?:number}
          validateMrp((it.sellingPrice?it.sellingPrice/factor:product.selling_price)*(1+Number(productTax.tax_rate||0)/100),mrp)
          poTotal += lineTotal
          validItems.push({
            product,
            quantity: normalized.quantity,
            unitCost: normalized.unit_cost,
            lineTotal,
            source: {...it,sellingPrice:it.sellingPrice/factor},
            normalized,mrp,
          })
        }

        poTotal = money(poTotal)

        const poRecord = {
          id: poId,
          po_number: finalPoNumber,
          branch_id: mainBranchId,
          supplier_id: supplierId,
          status: poStatus,
          subtotal: poTotal,
          total: poTotal,
          total_amount: poTotal,
          expected_date: poDate,
          received_date: markAsReceived ? poDate : null,
          received_at: markAsReceived ? poDate : null,
          notes: po.notes || 'Procurement imported from Excel',
          created_by: (user?.id as string) || null,
          created_at: poDate,
          updated_at: poDate,
        }
        insertPOStmt.run(poRecord)
        syncOps.push({ table: 'purchase_orders', id: poId, op: 'INSERT', data: poRecord })

        for (const it of validItems) {
          const itemId = crypto.randomUUID()
          const itemRecord = {
            id: itemId,
            po_id: poId,
            product_id: it.product.id,
            ordered_qty: it.quantity,
            quantity: it.quantity,
            received_qty: markAsReceived ? it.quantity : 0,
            unit_cost: it.unitCost,
            line_total: it.lineTotal,
            notes: null,
            updated_at: poDate,
          }
          insertPOItemStmt.run(itemRecord)
          db.prepare('UPDATE purchase_items SET selling_price=?,batch_number=?,expiry_date=?,mfg_date=? WHERE id=?').run(it.source.sellingPrice||null,it.source.batchNumber||null,it.source.expiryDate||null,it.source.mfgDate||null,itemId)
          const metadata={...it.normalized,mrp:it.mrp,entry_unit:it.source.unit||it.product.unit}
          const columns=new Set((db.prepare('PRAGMA table_info(purchase_items)').all() as {name:string}[]).map(row=>row.name))
          for(const field of ['paid_quantity','free_quantity','discount_amount','purchase_unit_cost','mrp','entry_unit','entry_quantity','entry_free_quantity','unit_factor'] as const)if(columns.has(field))db.prepare(`UPDATE purchase_items SET ${field}=? WHERE id=?`).run(metadata[field],itemId)
          syncOps.push({ table: 'purchase_items', id: itemId, op: 'INSERT', data: db.prepare('SELECT * FROM purchase_items WHERE id=?').get(itemId) as Record<string,unknown> })

          if (markAsReceived && it.quantity > 0) {
            const opening=ensureLegacyOpeningLayer(db,it.product.id,mainBranchId)
            if(opening)queueInventoryRecord(db,'product_batches',opening)
            applyReceiptProductPrices(db,it.product.id,it.unitCost,it.source.sellingPrice>0 ? it.source.sellingPrice : null)
            const batch=createReceiptBatch(db,{productId:it.product.id,branchId:mainBranchId,purchaseId:poId,purchaseItemId:itemId,quantity:it.quantity,unitCost:it.unitCost,mrp:it.mrp,sellingPrice:it.source.sellingPrice>0?it.source.sellingPrice:null,purchaseDate:poDate,batchNumber:it.source.batchNumber,expiryDate:it.source.expiryDate,mfgDate:it.source.mfgDate,createdBy:(user?.id as string)||null})
            syncOps.push({table:'product_batches',id:String(batch.id),op:'INSERT',data:batch})
            syncOps.push({table:'products',id:it.product.id,op:'INSERT',data:db.prepare('SELECT * FROM products WHERE id=?').get(it.product.id) as Record<string,unknown>})
            const stockRow = db.prepare('SELECT id, quantity FROM stocks WHERE product_id = ? AND branch_id = ? AND warehouse_id IS NULL')
              .get(it.product.id, mainBranchId) as { id: string; quantity: number } | undefined
            if (stockRow) {
              updateStockStmt.run(it.quantity, it.product.id, mainBranchId)
            } else {
              insertStockStmt.run(crypto.randomUUID(), it.product.id, mainBranchId, it.quantity)
            }

            const movement=insertStockMovement(db, {
              product_id: it.product.id,
              from_branch_id: null,
              to_branch_id: mainBranchId,
              quantity: it.quantity,
              movement_type: 'RECEIVE',
              reference_order_id: poId,
              notes: `PO ${finalPoNumber} Received`,
              created_by: (user?.id as string) || null,
            })

            syncOps.push({table:'stock_movements',id:String(movement.id),op:'INSERT',data:movement})
            const updatedStock=db.prepare('SELECT * FROM stocks WHERE product_id=? AND branch_id=? AND warehouse_id IS NULL').get(it.product.id,mainBranchId) as Record<string,unknown>
            syncOps.push({table:'stocks',id:String(updatedStock.id),op:'INSERT',data:updatedStock})
          }
          totalItems++
        }

        importedPOs++
        totalProcurementAmount += poTotal
        if(markAsReceived){
          applyPurchaseBalance(db,poId)
          const updated=db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(poId) as Record<string,unknown>
          syncOps.push({table:'purchase_orders',id:poId,op:'INSERT',data:updated})
        }
      }
      for(const op of syncOps) queueRow(op.table,op.id,op.data)
    })

    executeTransaction()

    logAudit(db, {
      userId: (user?.id as string) || null,
      branchId: mainBranchId,
      action: 'PURCHASE_ORDERS_IMPORT',
      tableName: 'purchase_orders',
      recordId: `import-${Date.now()}`,
      newValues: {
        filePath: path.basename(filePath),
        importedPOs,
        totalItems,
        totalProcurementAmount: money(totalProcurementAmount),
      },
    })

    return {
      success: true,
      filePath,
      importedPOs,
      totalItems,
      totalProcurementAmount: money(totalProcurementAmount),
      warnings: warnings.slice(0, 30),
    }
  } catch (err) {
    return { success: false, error: (err as Error).message }
  }
}
