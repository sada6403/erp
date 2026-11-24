export const measuredUnits = new Set(['kg', 'g', 'l', 'ml', 'm', 'cm', 'mm'])

export function parsePosQuantity(input: string, unit: string): number {
  const match = input.trim().toLowerCase().match(/^(\d+(?:\.\d+)?|\.\d+)\s*(kg|g|ml|l|mm|cm|m)?$/)
  if (!match) throw new Error('Enter a positive quantity, optionally followed by a unit')
  const value = Number(match[1])
  const target = unit.toLowerCase()
  const source = match[2] || target
  const units: Record<string, [string, number]> = {
    kg: ['mass', 1000], g: ['mass', 1], l: ['volume', 1000], ml: ['volume', 1],
    m: ['length', 1000], cm: ['length', 10], mm: ['length', 1],
  }
  if (source !== target && (!units[source] || !units[target] || units[source][0] !== units[target][0])) {
    throw new Error('Quantity unit does not match this product')
  }
  const result = source === target ? value : value * units[source][1] / units[target][1]
  if (!Number.isFinite(result) || result <= 0) throw new Error('Quantity must be greater than zero')
  return result
}

export function splitQuantitySearch(query: string): { query: string; quantity?: number } {
  const match = query.match(/^(\d+(?:\.\d+)?)\*(.*)$/)
  if (!match || Number(match[1]) <= 0) return { query }
  return { query: match[2], quantity: Number(match[1]) }
}
