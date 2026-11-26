import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import type { Product } from '@/types'
import { PosCatalog } from '@/lib/posCatalog'
import { purchaseLine, validateMrp, weightedPurchaseCost } from '../../../electron/lib/purchaseMath'
import { effectiveCost, marginPercent, parseCustomerOffer, parseEntryQuantity, parseSupplierOffer, type Pack } from '../../../electron/lib/stockEntryMath'

type Row = Record<string, any>

export interface StockLine {
  key: string
  product_id: string
  product_name: string
  sku?: string
  barcode?: string
  unit: string
  tax_rate?: number
  entry_unit: string
  factor: number
  quantity: number
  free_quantity: number
  manual_free?: number
  unit_cost: number
  discount_amount: number
  supplier_offer?: string
  shelf_price: number | null
  shelf_mrp: number | null
  /** Per entry unit, as the purchase IPC expects (it divides by the unit factor). */
  selling_price: string
  mrp: string
  customer_offer?: { type: 'percentage' | 'flat'; value: number; offer_price: number; text: string; from?: string; to?: string } | null
  new_barcode?: string
  batch_number?: string
  mfg_date?: string
  expiry_date?: string
  line_total: number
  stock_quantity: number
  effective_unit_cost: number
}

type FieldId = 'product' | 'qty' | 'free' | 'cost' | 'supplierOffer' | 'selling' | 'mrp' | 'customerOffer' | 'offerFrom' | 'offerTo' | 'barcode' | 'batch' | 'mfg' | 'expiry'
type Entry = Record<FieldId, string>
const EMPTY: Entry = { product: '', qty: '', free: '', cost: '', supplierOffer: '', selling: '', mrp: '', customerOffer: '', offerFrom: '', offerTo: '', barcode: '', batch: '', mfg: '', expiry: '' }
const LABELS: Record<FieldId, string> = {
  product: 'Product / barcode', qty: 'Quantity', free: 'Free qty', cost: 'Purchase price', supplierOffer: 'Supplier offer',
  selling: 'Selling price', mrp: 'MRP', customerOffer: 'Customer offer', offerFrom: 'Offer from', offerTo: 'Offer to',
  barcode: 'Barcode', batch: 'Batch no', mfg: 'MFD', expiry: 'Expiry',
}
const HINTS: Partial<Record<FieldId, string>> = {
  qty: '12 · 2 ctn · 500g', free: 'optional', supplierOffer: '10% · 150 · 10+1', selling: 'per base unit', mrp: 'per base unit',
  customerOffer: '90 · 10% · -20', offerFrom: 'YYYY-MM-DD', offerTo: 'YYYY-MM-DD', barcode: 'Alt+G generate', batch: 'optional', mfg: 'YYYY-MM-DD', expiry: 'YYYY-MM-DD',
}
const LOOSE = new Set(['kg', 'g', 'ltr', 'l', 'ml'])
const money = (value: number | null | undefined) => value == null || !Number.isFinite(value) ? '—' : `Rs.${(Math.round(value * 100) / 100).toLocaleString()}`
const num = (value: string) => value.trim() === '' ? null : Number(value)
const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value
const uid = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`)

interface Props {
  products: Row[]
  items: StockLine[]
  onItemsChange: (items: StockLine[]) => void
  direct: boolean
  draftKey: string
  onQuickCreate: (input: { name: string; barcode: string; unit: string; cost_price: string; selling_price: string; track_expiry: boolean }) => Promise<Row | null>
  onConfirm: () => void
  onSaveDraft: () => void
}

export default function StockEntryWorkbench({ products, items, onItemsChange, direct, draftKey, onQuickCreate, onConfirm, onSaveDraft }: Props) {
  const [entry, setEntry] = useState<Entry>(EMPTY)
  const [product, setProduct] = useState<Row | null>(null)
  const [context, setContext] = useState<Row | null>(null)
  const [highlight, setHighlight] = useState(0)
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [error, setError] = useState<{ field: FieldId | 'form'; message: string } | null>(null)
  const [showBarcode, setShowBarcode] = useState(false)
  const [editing, setEditing] = useState<StockLine | null>(null)
  const [selected, setSelected] = useState(-1)
  const [quick, setQuick] = useState<null | { name: string; barcode: string; unit: string; cost_price: string; selling_price: string; track_expiry: boolean }>(null)
  const [creating, setCreating] = useState(false)
  const [restore, setRestore] = useState<{ items: StockLine[] } | null>(null)
  const [reviewing, setReviewing] = useState(false)
  const refs = useRef<Partial<Record<FieldId, HTMLInputElement | null>>>({})
  const quickRef = useRef<HTMLInputElement | null>(null)
  const costTouched = useRef(false)
  const contextRequest = useRef(0)

  // ── Local, indexed search (brand is searchable through the name text) ──────
  const catalog = useMemo(() => new PosCatalog(products.filter(p => p.is_active !== 0 && p.is_active !== false).map(p => ({
    ...p, is_active: true, name: [p.name, p.brand, p.brand_name].filter(Boolean).join(' '),
  })) as unknown as Product[]), [products])
  const byId = useMemo(() => new Map(products.map(p => [String(p.id), p])), [products])
  const suggestions = useMemo(() => {
    if (product || !entry.product.trim()) return []
    return catalog.search(entry.product.trim(), 8).map(p => byId.get(String(p.id))).filter(Boolean) as Row[]
  }, [catalog, byId, entry.product, product])

  const unit = String(product?.unit || 'pcs')
  const loose = LOOSE.has(unit.toLowerCase())
  const packs: Pack[] = (context?.packs as Pack[]) || []
  const fields: FieldId[] = useMemo(() => {
    const list: FieldId[] = ['product', 'qty', 'free', 'cost', 'supplierOffer', 'selling', 'mrp', 'customerOffer']
    if (entry.customerOffer.trim()) list.push('offerFrom', 'offerTo')
    if (product && (showBarcode || (!String(product.barcode || '').trim() && !loose))) list.push('barcode')
    if (direct) list.push('batch', 'mfg', 'expiry')
    return list
  }, [entry.customerOffer, product, showBarcode, loose, direct])

  const focus = useCallback((field: FieldId) => {
    requestAnimationFrame(() => { const el = refs.current[field]; el?.focus(); el?.select() })
  }, [])

  // ── Draft autosave / crash recovery ───────────────────────────────────────
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(draftKey) || 'null') as { items?: StockLine[] } | null
      if (saved?.items?.length && !items.length) setRestore({ items: saved.items })
    } catch { /* unreadable draft: ignore */ }
    focus('product')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey])
  useEffect(() => {
    if (restore) return
    const timer = setTimeout(() => {
      try { items.length ? localStorage.setItem(draftKey, JSON.stringify({ items, saved_at: new Date().toISOString() })) : localStorage.removeItem(draftKey) } catch { /* storage full or blocked */ }
    }, 300)
    return () => clearTimeout(timer)
  }, [items, draftKey, restore])

  // ── Product selection ─────────────────────────────────────────────────────
  const choose = useCallback((row: Row, keep?: Partial<Entry>) => {
    setProduct(row); setShowSuggestions(false); setError(null); costTouched.current = Boolean(keep?.cost)
    setEntry({ ...EMPTY, product: String(row.name), cost: String(Number(row.cost_price) > 0 ? row.cost_price : ''), selling: String(Number(row.selling_price) > 0 ? row.selling_price : ''), ...keep })
    setContext(null)
    const request = ++contextRequest.current
    window.api.purchases?.pricingContext?.(String(row.id)).then((res: Row) => {
      if (request !== contextRequest.current || !res?.success) return
      setContext(res.data)
      const latest = Number(res.data?.latest_purchase_price)
      const lastMrp = (res.data?.batches as Row[] | undefined)?.find(b => b.mrp != null)?.mrp
      setEntry(old => ({
        ...old,
        cost: !costTouched.current && latest > 0 ? String(latest) : old.cost,
        mrp: old.mrp || (lastMrp != null ? String(lastMrp) : ''),
      }))
    }).catch(() => undefined)
    focus('qty')
  }, [focus])

  const resetEntry = useCallback(() => {
    setEntry(EMPTY); setProduct(null); setContext(null); setError(null); setShowBarcode(false); setHighlight(0); setShowSuggestions(false)
    focus('product')
  }, [focus])

  // ── Live calculations for the comparison panel ────────────────────────────
  const live = useMemo(() => {
    if (!product) return null
    try {
      const q = entry.qty.trim() ? parseEntryQuantity(entry.qty, unit, packs) : null
      const cost = num(entry.cost) ?? 0
      const offer = q && cost > 0 ? parseSupplierOffer(entry.supplierOffer, q.quantity, cost) : { discount_amount: 0, offer_free_quantity: 0, label: '' }
      const free = (num(entry.free) ?? 0) + offer.offer_free_quantity
      const eff = q && cost > 0 ? effectiveCost({ paidQuantity: q.quantity, freeQuantity: free, unitCost: cost, discount: offer.discount_amount, factor: q.factor }) : null
      const stock = Number(context?.quantity ?? product.stock ?? 0)
      const average = eff && context?.average_cost != null ? weightedPurchaseCost(stock, Number(context.average_cost), eff.stock_quantity, eff.unit_cost) : null
      const shelf = num(entry.selling) ?? Number(product.selling_price || 0)
      const markup = Number(context?.markup_pct || 0)
      return { q, eff, free, offer, stock, newStock: eff ? Math.round((stock + eff.stock_quantity) * 1e6) / 1e6 : null, average, shelf,
        suggested: average != null ? average * (1 + (markup || 20) / 100) : null, margin: eff ? marginPercent(shelf, eff.unit_cost) : null }
    } catch { return null }
  }, [product, entry.qty, entry.cost, entry.free, entry.supplierOffer, entry.selling, unit, packs, context])

  // ── Validation per field ──────────────────────────────────────────────────
  const validate = (field: FieldId): string | null => {
    const value = entry[field].trim()
    try {
      switch (field) {
        case 'qty': parseEntryQuantity(value, unit, packs); return null
        case 'free': return value && !(Number(value) >= 0) ? 'Free quantity cannot be negative' : null
        case 'cost': return !(Number(value) > 0) ? 'Enter the purchase price' : null
        case 'supplierOffer': { const q = parseEntryQuantity(entry.qty, unit, packs); parseSupplierOffer(value, q.quantity, Number(entry.cost)); return null }
        case 'selling': return value === '' ? (Number(product?.selling_price) > 0 ? null : 'Enter a selling price') : !(Number(value) > 0) ? 'Enter a valid selling price' : null
        case 'mrp': {
          if (!value) return null
          const shelf = num(entry.selling) ?? Number(product?.selling_price || 0)
          validateMrp(shelf * (1 + Number(product?.tax_rate || 0) / 100), Number(value)); return null
        }
        case 'customerOffer': parseCustomerOffer(value, num(entry.selling) ?? Number(product?.selling_price || 0)); return null
        case 'offerFrom': case 'offerTo': case 'mfg': case 'expiry':
          if (value && !isDate(value)) return 'Use YYYY-MM-DD'
          if (field === 'offerTo' && value && entry.offerFrom && value < entry.offerFrom) return 'Offer end is before its start'
          if (field === 'expiry' && value && entry.mfg && value <= entry.mfg) return 'Expiry must be after MFD'
          if (field === 'expiry' && !value && Number(product?.track_expiry) === 1) return 'This product needs an expiry date'
          return null
        case 'barcode': return value && !/^[A-Za-z0-9-]{3,64}$/.test(value) ? 'Barcode: 3-64 letters, digits or dashes' : null
        default: return null
      }
    } catch (err) { return (err as Error).message }
  }

  // ── Build and add the line ────────────────────────────────────────────────
  const addLine = async () => {
    if (!product) { setError({ field: 'product', message: 'Select a product first' }); focus('product'); return }
    for (const field of fields.slice(1)) {
      const message = validate(field)
      if (message) { setError({ field, message }); focus(field); return }
    }
    const code = entry.barcode.trim()
    if (code) {
      const owner = await window.api.products.barcodeOwner?.(code).catch(() => null)
      if (owner?.data && String(owner.data.id) !== String(product.id)) { setError({ field: 'barcode', message: `Barcode belongs to ${owner.data.name}` }); focus('barcode'); return }
      if (items.some(line => line.new_barcode === code && line.product_id !== String(product.id))) { setError({ field: 'barcode', message: 'Barcode already used on another line' }); focus('barcode'); return }
    }
    try {
      const q = parseEntryQuantity(entry.qty, unit, packs)
      const cost = Number(entry.cost)
      const offer = parseSupplierOffer(entry.supplierOffer, q.quantity, cost)
      const free = (num(entry.free) ?? 0) + offer.offer_free_quantity
      const line = purchaseLine(q.quantity, cost, free, offer.discount_amount, q.factor)
      const shelf = num(entry.selling)
      const shelfMrp = num(entry.mrp)
      const customer = parseCustomerOffer(entry.customerOffer, shelf ?? Number(product.selling_price || 0))
      const next: StockLine = {
        key: editing?.key || uid(),
        product_id: String(product.id), product_name: String(product.name), sku: product.sku, barcode: product.barcode,
        unit, tax_rate: Number(product.tax_rate || 0), entry_unit: q.entry_unit, factor: q.factor,
        quantity: q.quantity, free_quantity: free, manual_free: num(entry.free) ?? 0, unit_cost: cost, discount_amount: offer.discount_amount,
        supplier_offer: entry.supplierOffer.trim() || undefined,
        shelf_price: shelf, shelf_mrp: shelfMrp,
        selling_price: shelf == null ? '' : String(shelf * q.factor),
        mrp: shelfMrp == null ? '' : String(shelfMrp * q.factor),
        customer_offer: customer ? { ...customer, text: entry.customerOffer.trim(), from: entry.offerFrom || undefined, to: entry.offerTo || undefined } : null,
        new_barcode: code || undefined,
        batch_number: entry.batch.trim() || undefined, mfg_date: entry.mfg || undefined, expiry_date: entry.expiry || undefined,
        line_total: line.line_total, stock_quantity: line.quantity, effective_unit_cost: line.unit_cost,
      }
      onItemsChange([...items, next])
      setEditing(null); setSelected(items.length)
      resetEntry()
    } catch (err) { setError({ field: 'form', message: (err as Error).message }) }
  }

  // ── Enter navigation ──────────────────────────────────────────────────────
  const advance = (field: FieldId) => {
    const message = validate(field)
    if (message) { setError({ field, message }); return }
    setError(null)
    const index = fields.indexOf(field)
    if (index === fields.length - 1) void addLine()
    else focus(fields[index + 1])
  }

  const onProductKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setShowSuggestions(true); setHighlight(h => Math.min(h + 1, Math.max(0, suggestions.length - 1))); return }
    if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight(h => Math.max(0, h - 1)); return }
    if (e.key !== 'Enter') return
    e.preventDefault()
    if (product) { focus('qty'); return }
    const text = entry.product.trim()
    if (!text) { if (items.length) toast('Press Ctrl+Enter to review and confirm the receipt', { icon: '⌨️' }); return }
    const exact = catalog.lookup(text)
    const hit = exact ? byId.get(String(exact.id)) : suggestions[highlight]
    if (hit) { choose(hit); return }
    setError({ field: 'product', message: 'No matching product. Press F4 to create it here.' })
  }

  // Scanner: an exact barcode is selected at once, even without Enter.
  useEffect(() => {
    if (product) return
    const text = entry.product.trim()
    if (text.length < 6 || !/^[0-9A-Za-z-]+$/.test(text)) return
    const exact = catalog.lookup(text)
    if (!exact) return
    const timer = setTimeout(() => { const row = byId.get(String(exact.id)); if (row) choose(row) }, 90)
    return () => clearTimeout(timer)
  }, [entry.product, product, catalog, byId, choose])

  const onFieldKey = (field: FieldId) => async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (field === 'barcode' && e.altKey && e.key.toLowerCase() === 'g') {
      e.preventDefault()
      const res = await window.api.products.generateBarcode?.().catch((err: Error) => ({ success: false, error: err.message }))
      if (res?.success) setEntry(old => ({ ...old, barcode: String(res.data) })); else toast.error(res?.error || 'Could not generate a barcode')
      return
    }
    if (e.key === 'Enter' && !e.ctrlKey) { e.preventDefault(); advance(field) }
  }

  // ── Quick create (F4) ─────────────────────────────────────────────────────
  const openQuick = () => {
    const text = entry.product.trim()
    const looksLikeCode = /^[0-9-]{6,}$/.test(text)
    setQuick({ name: looksLikeCode ? '' : text, barcode: looksLikeCode ? text : '', unit: 'pcs', cost_price: '', selling_price: '', track_expiry: false })
    requestAnimationFrame(() => quickRef.current?.focus())
  }
  const submitQuick = async () => {
    if (!quick || creating) return
    setCreating(true)
    try {
      const created = await onQuickCreate(quick)
      if (created) { setQuick(null); choose(created, { cost: quick.cost_price }) }
    } finally { setCreating(false) }
  }

  // ── Row actions ───────────────────────────────────────────────────────────
  const editRow = (index: number) => {
    const line = items[index]
    if (!line) return
    const row = byId.get(line.product_id) || { id: line.product_id, name: line.product_name, unit: line.unit, sku: line.sku, barcode: line.barcode }
    onItemsChange(items.filter((_, i) => i !== index))
    setEditing(line)
    const paid = line.quantity
    choose(row, {
      qty: `${paid}${line.entry_unit && line.entry_unit !== line.unit ? ' ' + line.entry_unit : ''}`,
      free: line.manual_free ? String(line.manual_free) : '',
      cost: String(line.unit_cost), supplierOffer: line.supplier_offer || '',
      selling: line.shelf_price == null ? '' : String(line.shelf_price), mrp: line.shelf_mrp == null ? '' : String(line.shelf_mrp),
      customerOffer: line.customer_offer?.text || '', offerFrom: line.customer_offer?.from || '', offerTo: line.customer_offer?.to || '',
      barcode: line.new_barcode || '', batch: line.batch_number || '', mfg: line.mfg_date || '', expiry: line.expiry_date || '',
    })
    if (line.new_barcode) setShowBarcode(true)
  }
  const cancelEditing = () => {
    if (editing) { onItemsChange([...items, editing]); setEditing(null) }
    resetEntry()
  }
  const removeRow = (index: number) => { onItemsChange(items.filter((_, i) => i !== index)); setSelected(s => Math.min(s, items.length - 2)) }
  const printLabel = async (line: StockLine) => {
    const code = line.new_barcode || line.barcode
    if (!code) { toast.error('This product has no barcode yet'); return }
    const res = await window.api.printer?.printLabel?.({ product_name: line.product_name, sku: line.sku, barcode: code, price: line.shelf_price ?? undefined })
    if (res?.success) toast.success('Label sent to printer'); else toast.error(res?.error || 'Failed to print label')
  }

  // Stable row callbacks so memoised rows do not re-render on every keystroke.
  const rowActions = useRef({ editRow, removeRow, printLabel })
  rowActions.current = { editRow, removeRow, printLabel }
  const onRowEdit = useCallback((i: number) => rowActions.current.editRow(i), [])
  const onRowRemove = useCallback((i: number) => rowActions.current.removeRow(i), [])
  const onRowLabel = useCallback((line: StockLine) => { void rowActions.current.printLabel(line) }, [])

  // ── Global shortcuts (capture so the dialog's own Esc does not close it) ──
  const handlers = useRef({ resetEntry, cancelEditing, openQuick, editRow, addLine, onConfirm, onSaveDraft, focus })
  handlers.current = { resetEntry, cancelEditing, openQuick, editRow, addLine, onConfirm, onSaveDraft, focus }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const h = handlers.current
      const stop = () => { e.preventDefault(); e.stopImmediatePropagation() }
      if (restore) {
        if (e.key === 'Enter') { stop(); onItemsChange(restore.items); setRestore(null); h.focus('product') }
        if (e.key === 'Escape') { stop(); try { localStorage.removeItem(draftKey) } catch { /* */ } setRestore(null); h.focus('product') }
        return
      }
      if (quick) {
        if (e.key === 'Escape') { stop(); setQuick(null); h.focus('product') }
        return
      }
      if (reviewing) {
        if (e.key === 'Enter') { stop(); setReviewing(false); h.onConfirm() }
        else if (e.key === 'Escape') { stop(); setReviewing(false); h.focus('product') }
        else if (!e.ctrlKey && !e.altKey) stop()
        return
      }
      if (e.key === 'Escape') {
        if (showSuggestions && suggestions.length) { stop(); setShowSuggestions(false); return }
        if (editing) { stop(); h.cancelEditing(); return }
        if (product || entry.product) { stop(); h.resetEntry(); return }
        return // nothing to cancel: let the dialog close
      }
      if (e.ctrlKey && e.key === 'Enter') { stop(); if (product) void h.addLine(); else if (items.length) setReviewing(true); else toast.error('Add at least one product'); return }
      if (e.ctrlKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { stop(); setSelected(s => Math.max(0, Math.min(items.length - 1, (s < 0 ? items.length : s) + (e.key === 'ArrowUp' ? -1 : 1)))); return }
      if (e.ctrlKey && e.key === 'Delete' && selected >= 0) { stop(); removeRow(selected); return }
      if (e.ctrlKey && e.key.toLowerCase() === 'z' && !product && !entry.product && items.length) { stop(); h.editRow(items.length - 1); return }
      switch (e.key) {
        case 'F2': stop(); h.focus('product'); break
        case 'F3': stop(); if (items.length) h.editRow(selected >= 0 && selected < items.length ? selected : items.length - 1); break
        case 'F4': stop(); h.openQuick(); break
        case 'F6': stop(); if (product) h.focus('supplierOffer'); break
        case 'F7': stop(); if (product) { setShowBarcode(true); requestAnimationFrame(() => h.focus('barcode')) } break
        case 'F8': stop(); void h.addLine(); break
        case 'F9': stop(); h.onSaveDraft(); break
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restore, reviewing, quick, showSuggestions, suggestions.length, editing, product, entry.product, items, selected, draftKey])

  // ── Totals ────────────────────────────────────────────────────────────────
  const totals = useMemo(() => items.reduce((sum, line) => {
    const gross = Math.round(line.quantity * line.unit_cost * 100) / 100
    const shelf = line.shelf_price ?? Number(byId.get(line.product_id)?.selling_price || 0)
    return {
      gross: sum.gross + gross, discount: sum.discount + line.discount_amount, net: sum.net + line.line_total,
      free: sum.free + line.free_quantity * line.factor,
      profit: sum.profit + (shelf - line.effective_unit_cost) * line.stock_quantity,
    }
  }, { gross: 0, discount: 0, net: 0, free: 0, profit: 0 }), [items, byId])

  const set = (field: FieldId) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    if (field === 'cost') costTouched.current = true
    if (field === 'product') { setProduct(null); setContext(null); setShowSuggestions(true); setHighlight(0) }
    setEntry(old => ({ ...old, [field]: value }))
    if (error?.field === field || error?.field === 'form') setError(null)
  }

  const input = (field: FieldId, extra: string = 'w-24') => (
    <label key={field} className={`flex flex-col text-[11px] ${extra}`} style={{ color: 'var(--text-3)' }}>
      <span className="truncate">{LABELS[field]}{field === 'expiry' && Number(product?.track_expiry) === 1 ? ' *' : ''}</span>
      <input
        ref={el => { refs.current[field] = el }}
        aria-label={LABELS[field]}
        className={`input py-1 text-sm focus:ring-2 focus:ring-brand-500 ${error?.field === field ? 'border-red-500 ring-1 ring-red-500' : ''}`}
        value={entry[field]}
        placeholder={HINTS[field] || ''}
        disabled={!product}
        inputMode={['qty', 'free', 'cost', 'selling', 'mrp'].includes(field) ? 'decimal' : undefined}
        onChange={set(field)}
        onKeyDown={onFieldKey(field)}
      />
    </label>
  )

  return (
    <div className="space-y-3" data-testid="stock-entry">
      {restore && (
        <div role="alert" className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
          Unfinished stock entry found ({restore.items.length} line(s)). <kbd className="kbd">Enter</kbd> restore · <kbd className="kbd">Esc</kbd> discard
        </div>
      )}

      {reviewing && (
        <div role="alert" aria-label="Review stock receipt" className="rounded-lg border-2 border-brand-500 bg-brand-500/10 p-3 text-sm flex flex-wrap gap-x-6 gap-y-1 items-center">
          <strong>Confirm {direct ? 'stock receipt' : 'purchase order'}?</strong>
          <span>{items.length} line(s)</span>
          <span>Net Rs.{(Math.round(totals.net * 100) / 100).toLocaleString()}</span>
          <span>Free units {Math.round(totals.free * 1000) / 1000}</span>
          <span><kbd className="kbd">Enter</kbd> confirm · <kbd className="kbd">Esc</kbd> back to entry</span>
        </div>
      )}

      {/* Entry panel */}
      <div className="rounded-xl border-2 p-3 space-y-2" style={{ borderColor: 'var(--border)' }}>
        <div className="flex flex-wrap items-end gap-2">
          <div className="relative flex-1 min-w-[220px]">
            <label className="flex flex-col text-[11px]" style={{ color: 'var(--text-3)' }}>
              <span>{editing ? 'Editing line · Esc cancels edit' : LABELS.product} <kbd className="kbd text-[9px]">F2</kbd></span>
              <input
                ref={el => { refs.current.product = el }}
                aria-label={LABELS.product}
                className={`input py-1.5 text-base font-semibold focus:ring-2 focus:ring-brand-500 ${error?.field === 'product' ? 'border-red-500' : ''}`}
                placeholder="Type name, SKU or scan barcode"
                value={entry.product}
                autoComplete="off"
                onChange={set('product')}
                onKeyDown={onProductKey}
                onFocus={() => setShowSuggestions(true)}
              />
            </label>
            {showSuggestions && !product && suggestions.length > 0 && (
              <ul role="listbox" aria-label="Product suggestions" className="absolute z-20 left-0 right-0 mt-1 max-h-72 overflow-auto rounded-lg border shadow-xl" style={{ background: 'var(--surface-1, #0f172a)', borderColor: 'var(--border)' }}>
                {suggestions.map((row, index) => (
                  <li key={String(row.id)} role="option" aria-selected={index === highlight}
                    className={`px-3 py-1.5 cursor-pointer text-sm flex justify-between gap-3 ${index === highlight ? 'bg-brand-500/25' : ''}`}
                    onMouseDown={e => { e.preventDefault(); choose(row) }}>
                    <span className="truncate"><strong>{String(row.name)}</strong> <span className="text-xs opacity-60">{String(row.sku || '')} {String(row.barcode || '')}</span></span>
                    <span className="text-xs opacity-70 whitespace-nowrap">Stock {Number(row.stock ?? 0)} {String(row.unit || '')} · {money(Number(row.selling_price))}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {input('qty', 'w-28')}
          {input('free', 'w-16')}
          {input('cost')}
          {input('supplierOffer')}
          {input('selling')}
          {input('mrp', 'w-20')}
          {input('customerOffer')}
          {fields.includes('offerFrom') && input('offerFrom', 'w-28')}
          {fields.includes('offerTo') && input('offerTo', 'w-28')}
          {fields.includes('barcode') && input('barcode', 'w-36')}
          {direct && input('batch')}
          {direct && input('mfg', 'w-28')}
          {direct && input('expiry', 'w-28')}
          <button type="button" className="btn-primary btn-sm self-end" disabled={!product} onClick={() => void addLine()}>Add <kbd className="kbd text-[9px]">F8</kbd></button>
        </div>
        {error && <p role="alert" className="text-xs text-red-400">{error.message}</p>}

        {quick && (
          <div className="rounded-lg border p-2 grid grid-cols-2 md:grid-cols-6 gap-2 items-end" style={{ borderColor: 'var(--border)' }} aria-label="Quick create product">
            <p className="col-span-full text-xs font-semibold">Quick create product <span className="opacity-60">· Enter next · Esc cancel</span></p>
            {(['name', 'barcode', 'unit', 'cost_price', 'selling_price'] as const).map((key, index, all) => (
              <label key={key} className="flex flex-col text-[11px]" style={{ color: 'var(--text-3)' }}>
                <span>{{ name: 'Name', barcode: 'Barcode', unit: 'Unit (pcs/kg/ltr…)', cost_price: 'Purchase price', selling_price: 'Selling price' }[key]}</span>
                <input ref={index === 0 ? quickRef : undefined} aria-label={`New product ${key}`} className="input py-1 text-sm" value={quick[key]}
                  onChange={e => setQuick({ ...quick, [key]: e.target.value })}
                  onKeyDown={e => {
                    if (e.key !== 'Enter') return
                    e.preventDefault()
                    const next = e.currentTarget.closest('[aria-label="Quick create product"]')?.querySelectorAll('input')[index + 1] as HTMLInputElement | undefined
                    if (index < all.length - 1 && next) next.focus(); else void submitQuick()
                  }} />
              </label>
            ))}
            <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={quick.track_expiry} onChange={e => setQuick({ ...quick, track_expiry: e.target.checked })} />Needs expiry</label>
            <button type="button" className="btn-primary btn-sm" disabled={creating} onClick={() => void submitQuick()}>{creating ? 'Creating…' : 'Create & select'}</button>
          </div>
        )}

        {product && (
          <div className="grid grid-cols-2 md:grid-cols-5 lg:grid-cols-9 gap-2 text-xs" aria-label="Stock and price comparison">
            <Stat label="Previous purchase" value={money(context?.previous_purchase_price)} />
            <Stat label="Latest purchase" value={money(context?.latest_purchase_price ?? Number(product.cost_price))} />
            <Stat label="Current selling" value={money(Number(product.selling_price))} />
            <Stat label="Stock now" value={`${live?.stock ?? Number(product.stock ?? 0)} ${unit}`} />
            <Stat label="Stock after" value={live?.newStock == null ? '—' : `${live.newStock} ${unit}`} />
            <Stat label="Effective cost" value={live?.eff ? `${money(live.eff.unit_cost)} / ${unit}` : '—'} />
            <Stat label="Weighted avg" value={context?.cost_known === false ? 'Unknown' : money(live?.average)} />
            <Stat label="Suggested price" value={money(live?.suggested)} />
            <Stat label="Margin" value={live?.margin == null ? '—' : `${live.margin}%`} tone={live?.margin != null && live.margin < 0 ? 'text-red-400' : undefined} />
          </div>
        )}
      </div>

      {/* Received lines */}
      <div className="rounded-xl border overflow-auto max-h-[45vh]" style={{ borderColor: 'var(--border)' }}>
        <table className="w-full text-xs">
          <thead className="sticky top-0" style={{ background: 'var(--surface-1, #0f172a)' }}>
            <tr>{['#', 'Product', 'Qty', 'Free', 'Cost', 'Offer', 'Net', 'Selling', 'MRP', 'Cust. offer', direct ? 'Batch · Expiry' : '', ''].map((h, i) => <th key={i} className="text-left px-2 py-1.5 font-medium" style={{ color: 'var(--text-3)' }}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {items.map((line, index) => (
              <LineRow key={line.key} line={line} index={index} direct={direct} active={index === selected}
                onSelect={setSelected} onEdit={onRowEdit} onRemove={onRowRemove} onLabel={onRowLabel} />
            ))}
            {!items.length && <tr><td colSpan={12} className="text-center py-6" style={{ color: 'var(--text-3)' }}>Scan or type a product to start. Each line is added with Enter on the last field or F8.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
        <span>Lines <strong>{items.length}</strong></span>
        <span>Gross <strong>{money(totals.gross)}</strong></span>
        <span>Supplier discount <strong>{money(totals.discount)}</strong></span>
        <span>Free units <strong>{Math.round(totals.free * 1000) / 1000}</strong></span>
        <span>Net payable <strong>{money(totals.net)}</strong></span>
        <span>Expected profit <strong className={totals.profit < 0 ? 'text-red-400' : 'text-emerald-400'}>{money(totals.profit)}</strong></span>
      </div>
      <p className="text-[11px] leading-5" style={{ color: 'var(--text-3)' }}>
        <kbd className="kbd">Enter</kbd> next field · <kbd className="kbd">Shift+Tab</kbd> back · <kbd className="kbd">↑↓</kbd> suggestions · <kbd className="kbd">F2</kbd> search · <kbd className="kbd">F3</kbd> edit line · <kbd className="kbd">F4</kbd> new product · <kbd className="kbd">F6</kbd> offer · <kbd className="kbd">F7</kbd> barcode · <kbd className="kbd">F8</kbd> add line · <kbd className="kbd">F9</kbd> save draft · <kbd className="kbd">Ctrl+↑↓</kbd> select line · <kbd className="kbd">Ctrl+Del</kbd> remove line · <kbd className="kbd">Ctrl+Z</kbd> undo last line · <kbd className="kbd">Ctrl+Enter</kbd> review &amp; confirm · <kbd className="kbd">Esc</kbd> cancel
      </p>
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return <div className="rounded-md px-2 py-1" style={{ background: 'var(--bg-soft)' }}><span className="block opacity-60">{label}</span><strong className={tone}>{value}</strong></div>
}

const LineRow = memo(function LineRow({ line, index, direct, active, onSelect, onEdit, onRemove, onLabel }: {
  line: StockLine; index: number; direct: boolean; active: boolean
  onSelect: (i: number) => void; onEdit: (i: number) => void; onRemove: (i: number) => void; onLabel: (line: StockLine) => void
}) {
  return (
    <tr className={`border-t ${active ? 'bg-brand-500/15' : ''}`} style={{ borderColor: 'var(--border)' }} onClick={() => onSelect(index)}>
      <td className="px-2 py-1">{index + 1}</td>
      <td className="px-2 py-1 max-w-[220px] truncate" title={line.product_name}>{line.product_name}{line.new_barcode && <span className="ml-1 text-[10px] text-sky-400">+{line.new_barcode}</span>}</td>
      <td className="px-2 py-1 whitespace-nowrap">{line.quantity} {line.entry_unit}{line.factor !== 1 && <span className="opacity-60"> = {line.stock_quantity - line.free_quantity * line.factor} {line.unit}</span>}</td>
      <td className="px-2 py-1">{line.free_quantity || ''}</td>
      <td className="px-2 py-1">{line.unit_cost}</td>
      <td className="px-2 py-1">{line.discount_amount ? `-${line.discount_amount}` : ''}{line.supplier_offer ? <span className="opacity-60"> ({line.supplier_offer})</span> : ''}</td>
      <td className="px-2 py-1 font-semibold">{line.line_total.toLocaleString()}</td>
      <td className="px-2 py-1">{line.shelf_price ?? ''}</td>
      <td className="px-2 py-1">{line.shelf_mrp ?? ''}</td>
      <td className="px-2 py-1">{line.customer_offer ? `${line.customer_offer.offer_price}${line.customer_offer.to ? ' → ' + line.customer_offer.to : ''}` : ''}</td>
      <td className="px-2 py-1 whitespace-nowrap">{direct ? [line.batch_number, line.expiry_date].filter(Boolean).join(' · ') : ''}</td>
      <td className="px-2 py-1 whitespace-nowrap text-right">
        <button type="button" tabIndex={-1} className="btn-ghost btn-sm" onClick={e => { e.stopPropagation(); onEdit(index) }}>Edit</button>
        <button type="button" tabIndex={-1} className="btn-ghost btn-sm" onClick={e => { e.stopPropagation(); onLabel(line) }}>Label</button>
        <button type="button" tabIndex={-1} className="btn-ghost btn-sm text-red-400" onClick={e => { e.stopPropagation(); onRemove(index) }}>✕</button>
      </td>
    </tr>
  )
})
