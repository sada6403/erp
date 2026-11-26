import { stockUnit, stockUnitFactor } from './inventoryUnits'

export type Pack = { uom_name: string; conversion_factor: number }
const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100
const qty = (value: number) => Math.round(value * 1e6) / 1e6

/**
 * "12", "2 ctn", "2carton", "500g", "1.5 kg". Returns the number in the entered
 * unit plus that unit and its factor to the product's base unit.
 */
export function parseEntryQuantity(text: string, baseUnit: string, packs: Pack[] = []) {
  const match = String(text).trim().toLowerCase().match(/^(\d+(?:\.\d+)?|\.\d+)\s*([a-z]*)$/)
  if (!match) throw new Error('Enter a quantity such as 12, 2 ctn or 500g')
  const value = Number(match[1])
  if (!(value > 0)) throw new Error('Quantity must be greater than zero')
  const unit = match[2] ? stockUnit(match[2]) : stockUnit(baseUnit || 'pcs')
  const factor = stockUnitFactor(unit, baseUnit || 'pcs', packs)
  return { quantity: value, entry_unit: unit, factor, base_quantity: qty(value * factor) }
}

/**
 * Supplier offer on one line, typed in a single field:
 *   "10%"   percentage discount on the line gross
 *   "150"   fixed amount off the line
 *   "10+1"  buy 10 get 1 free (repeats for every full 10 bought)
 * Blank means no offer.
 */
export function parseSupplierOffer(text: string, paidQuantity: number, unitCost: number) {
  const value = String(text || '').trim().toLowerCase().replace(/\s+/g, '')
  const gross = money(paidQuantity * unitCost)
  if (!value) return { discount_amount: 0, offer_free_quantity: 0, label: '' }
  let m = value.match(/^(\d+(?:\.\d+)?)%$/)
  if (m) {
    const pct = Number(m[1])
    if (pct <= 0 || pct >= 100) throw new Error('Supplier discount % must be between 0 and 100')
    return { discount_amount: money(gross * pct / 100), offer_free_quantity: 0, label: `${pct}% off` }
  }
  m = value.match(/^(?:buy)?(\d+)(?:\+|get)(\d+)$/)
  if (m) {
    const buy = Number(m[1]), get = Number(m[2])
    if (!(buy > 0) || !(get > 0)) throw new Error('Use buy+free, for example 10+1')
    return { discount_amount: 0, offer_free_quantity: Math.floor(paidQuantity / buy) * get, label: `Buy ${buy} get ${get}` }
  }
  m = value.match(/^(?:rs\.?)?(\d+(?:\.\d+)?)$/)
  if (m) {
    const amount = Number(m[1])
    if (amount <= 0 || amount >= gross) throw new Error('Supplier discount must be less than the line amount')
    return { discount_amount: money(amount), offer_free_quantity: 0, label: `Rs.${amount} off` }
  }
  throw new Error('Supplier offer: use 10%, 150 or 10+1')
}

/**
 * Customer (shelf) offer, typed in a single field relative to the selling price:
 *   "90"   promotional selling price
 *   "10%"  percentage off
 *   "-20"  fixed amount off
 */
export function parseCustomerOffer(text: string, sellingPrice: number) {
  const value = String(text || '').trim().toLowerCase().replace(/\s+/g, '')
  if (!value) return null
  if (!(sellingPrice > 0)) throw new Error('Enter the selling price before a customer offer')
  let m = value.match(/^(\d+(?:\.\d+)?)%$/)
  if (m) {
    const pct = Number(m[1])
    if (pct <= 0 || pct >= 100) throw new Error('Offer % must be between 0 and 100')
    return { type: 'percentage' as const, value: pct, offer_price: money(sellingPrice * (1 - pct / 100)) }
  }
  m = value.match(/^-(\d+(?:\.\d+)?)$/)
  if (m) {
    const off = Number(m[1])
    if (off <= 0 || off >= sellingPrice) throw new Error('Offer amount must be less than the selling price')
    return { type: 'flat' as const, value: money(off), offer_price: money(sellingPrice - off) }
  }
  m = value.match(/^(\d+(?:\.\d+)?)$/)
  if (m) {
    const price = Number(m[1])
    if (price <= 0 || price >= sellingPrice) throw new Error('Offer price must be below the selling price')
    return { type: 'flat' as const, value: money(sellingPrice - price), offer_price: money(price) }
  }
  throw new Error('Customer offer: use 90 (offer price), 10% or -20')
}

/** Effective cost per base unit after discount and free goods, and the margin at a selling price. */
export function effectiveCost(input: { paidQuantity: number; freeQuantity: number; unitCost: number; discount: number; factor: number }) {
  const gross = money(input.paidQuantity * input.unitCost)
  const net = money(gross - input.discount)
  const stock = qty((input.paidQuantity + input.freeQuantity) * input.factor)
  return { gross, net, stock_quantity: stock, unit_cost: stock > 0 ? net / stock : 0 }
}

export function marginPercent(sellingPrice: number, unitCost: number) {
  return sellingPrice > 0 ? Math.round(((sellingPrice - unitCost) / sellingPrice) * 10000) / 100 : 0
}
