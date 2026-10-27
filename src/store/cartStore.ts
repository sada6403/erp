import { create } from 'zustand'
import type { CartItem, Customer, Product } from '@/types'

export type BillType = 'RETAIL' | 'QUOTATION' | 'CREDIT'

interface CartState {
  items: CartItem[]
  customer: Customer | null
  globalDiscount: number
  notes: string
  billType: BillType
  validUntil: string   // for QUOTATION — expiry date
  dueDate: string      // for CREDIT — payment due date

  addItem: (product: Product, quantity?: number, autoDiscountPct?: number, variant?: { id: string; name?: string; variant_name?: string; selling_price?: number; price?: number; attributes?: Record<string, string> }) => void
  removeItem: (key: string) => void
  updateQty: (key: string, qty: number) => void
  setItemDiscount: (key: string, pct: number) => void
  updatePrice: (key: string, price: number) => void
  setCustomer: (customer: Customer | null) => void
  setGlobalDiscount: (pct: number) => void
  setNotes: (notes: string) => void
  setBillType: (type: BillType) => void
  setValidUntil: (date: string) => void
  setDueDate: (date: string) => void
  clear: () => void
  restoreCart: (data: {
    items: CartItem[]
    customer: Customer | null
    globalDiscount: number
    notes: string
    billType: BillType
    validUntil?: string
    dueDate?: string
  }) => void

  // Computed
  subtotal: number
  discountAmount: number
  taxAmount: number
  total: number
}

function calcLine(item: CartItem): CartItem {
  const gross    = item.quantity * item.unit_price
  const disc     = gross * (item.discount_pct / 100)
  const taxable  = gross - disc
  const tax      = taxable * (item.product.tax_rate / 100)
  return { ...item, discount_amount: disc, tax_amount: tax, line_total: taxable + tax }
}

function computeTotals(items: CartItem[], globalDiscount: number) {
  const subtotal       = items.reduce((s, i) => s + i.quantity * i.unit_price, 0)
  const itemDiscounts  = items.reduce((s, i) => s + i.discount_amount, 0)
  const globalDisc     = subtotal * (globalDiscount / 100)
  const discountAmount = itemDiscounts + globalDisc
  const taxAmount      = items.reduce((s, i) => s + i.tax_amount, 0)
  const total          = subtotal - discountAmount + taxAmount
  return { subtotal, discountAmount, taxAmount, total }
}

// Default due date: 30 days from today
function defaultDueDate(): string {
  const d = new Date()
  d.setDate(d.getDate() + 30)
  return d.toISOString().split('T')[0]
}

// Default quotation validity: 7 days
function defaultValidUntil(): string {
  const d = new Date()
  d.setDate(d.getDate() + 7)
  return d.toISOString().split('T')[0]
}

export const useCartStore = create<CartState>((set, get) => ({
  items:          [],
  customer:       null,
  globalDiscount: 0,
  notes:          '',
  billType:       'RETAIL',
  validUntil:     defaultValidUntil(),
  dueDate:        defaultDueDate(),
  subtotal:       0,
  discountAmount: 0,
  taxAmount:      0,
  total:          0,

  addItem: (product, quantity = 1, autoDiscountPct, variant) => {
    const { items, globalDiscount } = get()
    const variantId = variant?.id || product.variant_id
    const variantName = variant?.variant_name || variant?.name || product.variant_name
    const unitPrice = (variant?.selling_price !== undefined ? variant.selling_price : variant?.price) ?? product.selling_price
    const attributes = variant?.attributes || product.attributes

    const existing = items.find(i => variantId ? i.variant_id === variantId : (!i.variant_id && i.product.id === product.id))
    let newItems: CartItem[]

    if (existing) {
      newItems = items.map(i =>
        (variantId ? i.variant_id === variantId : (!i.variant_id && i.product.id === product.id))
          ? calcLine({ ...i, quantity: i.quantity + quantity })
          : i
      )
    } else {
      const floor = Math.max(0, Math.min(100, autoDiscountPct || 0))
      const newItem = calcLine({
        product,
        variant_id:      variantId,
        variant_name:    variantName,
        attributes,
        quantity,
        unit_price:      unitPrice,
        discount_pct:    0,
        discount_amount: 0,
        tax_amount:      0,
        line_total:      0,
        auto_discount_pct: floor || undefined,
      })
      newItems = [...items, newItem]
    }
    set({ items: newItems, ...computeTotals(newItems, globalDiscount) })
  },

  removeItem: (key) => {
    const { items, globalDiscount } = get()
    const newItems = items.filter(i => (i.variant_id ? i.variant_id !== key : i.product.id !== key))
    set({ items: newItems, ...computeTotals(newItems, globalDiscount) })
  },

  updateQty: (key, qty) => {
    const { items, globalDiscount } = get()
    const newItems = qty <= 0
      ? items.filter(i => (i.variant_id ? i.variant_id !== key : i.product.id !== key))
      : items.map(i => (i.variant_id ? i.variant_id === key : i.product.id === key) ? calcLine({ ...i, quantity: qty }) : i)
    set({ items: newItems, ...computeTotals(newItems, globalDiscount) })
  },

  setItemDiscount: (key, pct) => {
    const { items, globalDiscount } = get()
    const clamped = Math.max(0, Math.min(100, pct))
    const newItems = items.map(i =>
      (i.variant_id ? i.variant_id === key : i.product.id === key) ? calcLine({ ...i, discount_pct: clamped }) : i
    )
    set({ items: newItems, ...computeTotals(newItems, globalDiscount) })
  },

  updatePrice: (key, price) => {
    const { items, globalDiscount } = get()
    const clamped = Math.max(0, price)
    const newItems = items.map(i =>
      (i.variant_id ? i.variant_id === key : i.product.id === key) ? calcLine({ ...i, unit_price: clamped }) : i
    )
    set({ items: newItems, ...computeTotals(newItems, globalDiscount) })
  },

  setCustomer: (customer) => set({ customer }),
  setNotes:    (notes)    => set({ notes }),

  setGlobalDiscount: (pct) => {
    const { items } = get()
    const clamped = Math.max(0, Math.min(100, pct))
    set({ globalDiscount: clamped, ...computeTotals(items, clamped) })
  },

  setBillType: (billType) => {
    set({ billType })
  },

  setValidUntil: (date) => set({ validUntil: date }),
  setDueDate:    (date) => set({ dueDate: date }),

  clear: () => set({
    items: [], customer: null, globalDiscount: 0, notes: '',
    billType: 'RETAIL', validUntil: defaultValidUntil(), dueDate: defaultDueDate(),
    subtotal: 0, discountAmount: 0, taxAmount: 0, total: 0,
  }),

  // Recalling a held cart (Issue 13) — items already have discount_pct/
  // unit_price/etc. baked in from when they were held, so they're restored
  // via calcLine (not addItem, which would re-floor discounts) to reproduce
  // the exact same line totals rather than recomputing from scratch.
  restoreCart: (data) => {
    const items = data.items.map(calcLine)
    set({
      items,
      customer: data.customer,
      globalDiscount: data.globalDiscount,
      notes: data.notes,
      billType: data.billType,
      validUntil: data.validUntil || defaultValidUntil(),
      dueDate: data.dueDate || defaultDueDate(),
      ...computeTotals(items, data.globalDiscount),
    })
  },
}))
