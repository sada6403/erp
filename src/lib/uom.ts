// Shared box/piece unit-conversion helpers. Stock is always stored/tracked
// in the product's base unit (pieces) — a "pack" unit (Box, Carton, ...) is
// just an alternate input/display unit, converted via its own
// conversion_factor (product_uom.is_base = 0). See ISSUE 15.
export interface PackUom {
  uom_name: string
  conversion_factor: number
}

export function toBaseQty(boxes: number, pieces: number, pack: PackUom | null | undefined): number {
  if (!pack || Number(pack.conversion_factor) <= 1) return pieces
  return Math.max(0, boxes) * Number(pack.conversion_factor) + Math.max(0, pieces)
}

export function splitQty(baseQty: number, pack: PackUom | null | undefined): { boxes: number; pieces: number } {
  if (!pack || Number(pack.conversion_factor) <= 1) return { boxes: 0, pieces: baseQty }
  const factor = Number(pack.conversion_factor)
  const boxes = Math.floor(baseQty / factor)
  return { boxes, pieces: Math.round((baseQty - boxes * factor) * 100) / 100 }
}

export function formatQtyWithUom(baseQty: number, pack: PackUom | null | undefined, baseUnitLabel = 'pcs'): string {
  if (!pack || Number(pack.conversion_factor) <= 1) return `${baseQty} ${baseUnitLabel}`
  const { boxes, pieces } = splitQty(baseQty, pack)
  if (boxes === 0) return `${pieces} ${baseUnitLabel}`
  if (pieces === 0) return `${boxes} ${pack.uom_name}`
  return `${boxes} ${pack.uom_name} + ${pieces} ${baseUnitLabel}`
}
