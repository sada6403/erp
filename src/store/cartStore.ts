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

  addItem: (product: Product, quantity?: number) => void
  removeItem: (productId: string) => void
  updateQty: (productId: string, qty: number) => void
  setItemDiscount: (productId: string, pct: number) => void
  setCustomer: (customer: Customer | null) => void
  setGlobalDiscount: (pct: number) => void
  setNotes: (notes: string) => void
  setBillType: (type: BillType) => void
  setValidUntil: (date: string) => void
  setDueDate: (date: string) => void
  clear: () => void

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

  addItem: (product, quantity = 1) => {
    const { items, globalDiscount } = get()
    const existing = items.find(i => i.product.id === product.id)
    let newItems: CartItem[]

    if (existing) {
      newItems = items.map(i =>
        i.product.id === product.id
          ? calcLine({ ...i, quantity: i.quantity + quantity })
          : i
      )
    } else {
      const newItem = calcLine({
        product, quantity,
        unit_price:      product.selling_price,
        discount_pct:    0,
        discount_amount: 0,
        tax_amount:      0,
        line_total:      0,
      })
      newItems = [...items, newItem]
    }
    set({ items: newItems, ...computeTotals(newItems, globalDiscount) })
  },

  removeItem: (productId) => {
    const { items, globalDiscount } = get()
    const newItems = items.filter(i => i.product.id !== productId)
    set({ items: newItems, ...computeTotals(newItems, globalDiscount) })
  },

  updateQty: (productId, qty) => {
    const { items, globalDiscount } = get()
    const newItems = qty <= 0
      ? items.filter(i => i.product.id !== productId)
      : items.map(i => i.product.id === productId ? calcLine({ ...i, quantity: qty }) : i)
    set({ items: newItems, ...computeTotals(newItems, globalDiscount) })
  },

  setItemDiscount: (productId, pct) => {
    const { items, globalDiscount } = get()
    const clamped = Math.max(0, Math.min(100, pct))
    const newItems = items.map(i =>
      i.product.id === productId ? calcLine({ ...i, discount_pct: clamped }) : i
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
}))
