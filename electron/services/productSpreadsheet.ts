import * as XLSX from 'xlsx'

const textFields = [
  ['Brand', 'brand'], ['Short Name', 'sort_name'], ['ISBN', 'isbn'],
  ['Rack No', 'rack_no'], ['Image URL', 'image_url'], ['Sale By', 'sale_by'],
  ['Commission Type', 'commission_type'], ['Custom Field 1', 'custom_field1'],
  ['Custom Field 2', 'custom_field2'], ['Custom Field 3', 'custom_field3'],
] as const
const numberFields = [['Wholesale Price', 'wholesale_price'], ['Weight', 'weight'], ['Employee Commission', 'employee_commission']] as const
const booleanFields = [
  ['Not For Sale', 'not_for_sale'], ['Enable EMI', 'enable_emi'],
  ['Manage Stock', 'is_manage_stock'], ['Fast Product', 'fast_product'],
  ['Sale As Latest Price', 'sale_as_latest_price'], ['Is Active', 'is_active'],
] as const

export function readAdditionalProductFields(row: Record<string, unknown>): Record<string, string | number> {
  const normalized = new Map(Object.entries(row).map(([key, value]) => [key.toLowerCase().replace(/[\s_-]/g, ''), value]))
  const read = (header: string) => normalized.get(header.toLowerCase().replace(/[\s_-]/g, ''))
  const result: Record<string, string | number> = {}
  for (const [header, field] of textFields) {
    const value = read(header)
    if (value !== undefined && value !== null && String(value).trim() !== '') result[field] = String(value).trim()
  }
  for (const [header, field] of numberFields) {
    const raw = read(header)
    if (raw === undefined || raw === null || String(raw).trim() === '') continue
    const value = Number(String(raw).replace(/,/g, ''))
    if (!Number.isFinite(value) || value < 0) throw new Error(`${header} must be a non-negative number`)
    result[field] = value
  }
  for (const [header, field] of booleanFields) {
    const raw = read(header)
    if (raw === undefined || raw === null || String(raw).trim() === '') continue
    const value = String(raw).trim().toLowerCase()
    if (!['1', '0', 'true', 'false', 'yes', 'no'].includes(value)) throw new Error(`${header} must be Yes/No or 1/0`)
    result[field] = ['1', 'true', 'yes'].includes(value) ? 1 : 0
  }
  if (result.commission_type && !['fixed', 'percent'].includes(String(result.commission_type))) throw new Error('Commission Type must be fixed or percent')
  if (result.commission_type === 'percent' && Number(result.employee_commission || 0) > 100) throw new Error('Percentage commission cannot exceed 100')
  return result
}

export function createFurnitureProductTemplate(branches: { name: string }[]): XLSX.WorkBook {
  const stockHeaders = branches.length ? branches.map(branch => `Stock (${branch.name})`) : ['Stock (Main Branch)']
  const headers = [
    'Product Name', 'SKU', 'Category', 'Cost Price', 'Selling Price', ...stockHeaders,
    'Discount Percentage', 'Barcode', 'Supplier', 'Unit', 'Tax Rate', 'Min Stock Level', 'Description',
  ]
  const samples = [
    { 'Product Name': 'Chair', SKU: 'C001', Category: 'Furniture', 'Cost Price': 5000, 'Selling Price': 7500, 'Discount Percentage': 10, Barcode: '4791234567801', Supplier: 'Local Supplier', Unit: 'pcs', 'Tax Rate': 0, 'Min Stock Level': 5, Description: 'Ergonomic wooden chair' },
    { 'Product Name': 'Table', SKU: 'T001', Category: 'Furniture', 'Cost Price': 10000, 'Selling Price': 15000, 'Discount Percentage': 15, Barcode: '4791234567802', Supplier: 'Local Supplier', Unit: 'pcs', 'Tax Rate': 0, 'Min Stock Level': 5, Description: 'Dining wooden table' },
  ].map((sample, index) => ({ ...sample, ...Object.fromEntries(stockHeaders.map((header, branchIndex) => [header, Math.max(1, (index ? 10 : 20) - branchIndex * 5)])) }))
  const sheet = XLSX.utils.json_to_sheet(samples, { header: headers })
  sheet['!cols'] = headers.map(header => ({ wch: /Description|Product Name|Image URL/.test(header) ? 36 : /Stock \(/.test(header) ? 25 : Math.max(16, header.length + 2) }))
  sheet['!autofilter'] = { ref: sheet['!ref']! }
  for (const [index, header] of headers.entries()) {
    if (!['SKU', 'Barcode', 'ISBN'].includes(header)) continue
    for (let row = 1; row <= samples.length; row++) {
      const cell = sheet[XLSX.utils.encode_cell({ r: row, c: index })]
      if (cell) { cell.t = 's'; cell.z = '@' }
    }
  }
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, sheet, 'Products')
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ['Field / Format', 'How to use'],
    ['Sample rows', 'Replace the Chair/Table examples with your real products before importing.'],
    ['Product Name', 'Required for the full product template. SKU should identify the correct model or colour.'],
    ['Stock (Branch Name)', 'Enter quantities under the existing branch columns. Blank means no stock change; zero is an explicit quantity.'],
    ['Original stock sheets', 'Branch, Stock Date, Item Code, Description, Qty, Sale Price sheets are still accepted without conversion.'],
    ['Optional product details', 'Blank fields are optional. Enter actual cost, sale and wholesale prices separately.'],
    ['Supplier', 'Use an existing supplier name or enter a new name to create it.'],
    ['Barcode / SKU / ISBN', 'Keep as Text to preserve leading zeros and long codes.'],
    ['Advanced product setup', 'Configure variants, attribute combinations and multiple unit conversions in the product editor after import.'],
    ['Existing products', 'Fill Empty Fields preserves existing values. Override updates provided fields. Skip leaves existing products unchanged.'],
  ]), 'Instructions')
  book.Sheets.Instructions['!cols'] = [{ wch: 28 }, { wch: 115 }]
  return book
}
