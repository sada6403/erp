import type Database from 'better-sqlite3'

function clean(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

export function titleCase(value: unknown): string {
  return clean(value)
    .split(' ')
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ')
}

export function normalizeCategoryPath(value: unknown): string {
  return clean(value)
    .split('>')
    .map(titleCase)
    .filter(Boolean)
    .join(' > ')
}

export function sanitizeCode(value: unknown, fallback = 'X'): string {
  const text = clean(value).toUpperCase().replace(/[^A-Z0-9]+/g, '')
  return text || fallback
}

export function categoryCodeFromName(name: unknown): string {
  const cleanName = titleCase(name)
  if (!cleanName) return 'CAT'
  const tokens = cleanName.split(' ').filter(Boolean)
  if (!tokens.length) return 'CAT'
  const code = tokens.map(t => t[0]).join('').slice(0, 3)
  return sanitizeCode(code, 'CAT').slice(0, 3).padEnd(3, 'X')
}

export function brandCodeFromName(name: unknown): string {
  const cleanName = titleCase(name)
  if (!cleanName) return 'GEN'
  const tokens = cleanName.split(' ').filter(Boolean)
  if (!tokens.length) return 'GEN'
  const code = tokens.map(t => t[0]).join('').slice(0, 3)
  return sanitizeCode(code, 'GEN').slice(0, 3).padEnd(3, 'X')
}

export function nextSkuSequence(
  db: Database.Database,
  brandCode: string,
  categoryCode: string
): string {
  const prefix = `${brandCode}-${categoryCode}-`
  const rows = db.prepare(`
    SELECT sku FROM products
    WHERE sku LIKE ?
  `).all(`${prefix}%`) as { sku: string }[]

  let max = 0
  for (const row of rows) {
    const match = String(row.sku || '').match(/-(\d{3,})$/)
    if (match) max = Math.max(max, Number(match[1]) || 0)
  }

  return String(max + 1).padStart(3, '0')
}

export function buildSku(
  db: Database.Database,
  brand: unknown,
  categoryName: unknown,
  existingSku?: unknown,
): string {
  const sku = clean(existingSku)
  if (sku) return sku
  const brandCode = brandCodeFromName(brand)
  const categoryCode = categoryCodeFromName(categoryName)
  const sequence = nextSkuSequence(db, brandCode, categoryCode)
  return `${brandCode}-${categoryCode}-${sequence}`
}

