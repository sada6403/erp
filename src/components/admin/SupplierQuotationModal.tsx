import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import Modal from '@/components/shared/Modal'
import type { Product } from '@/types'
import { PosCatalog } from '@/lib/posCatalog'
import { printSupplierRfq } from '@/lib/supplierRfqPrint'
import { colomboToday } from '@/lib/datetime'

type Row = Record<string, any>
export interface QuoteRow {
  product_id: string; name: string; sku: string; unit: string
  current_stock: number; min_stock_level: number; max_stock_level: number | null
  incoming_quantity: number; incoming_orders: string[]; sold_quantity: number
  last_purchase_price: number | null; estimated_cost: number; recommended_quantity: number
  status: string; selected: boolean; quantity: string; remarks: string
  link_supplier: boolean; override_pending: boolean; extra: boolean
  price: string; discount: string; free: string
}
type Requested = { name: string; quantity: number; unit: string; remarks: string }

const STATUS_STYLE: Record<string, string> = { out: 'text-red-400', low: 'text-amber-400', reorder: 'text-sky-400', ok: 'opacity-60' }
const fromPlan = (r: Row, selected = Boolean(r.auto_selected)): QuoteRow => ({
  product_id: String(r.product_id), name: String(r.name), sku: String(r.sku || ''), unit: String(r.unit || 'pcs'),
  current_stock: Number(r.current_stock || 0), min_stock_level: Number(r.min_stock_level || 0), max_stock_level: r.max_stock_level ?? null,
  incoming_quantity: Number(r.incoming_quantity || 0), incoming_orders: r.incoming_orders || [], sold_quantity: Number(r.sold_quantity || 0),
  last_purchase_price: r.last_purchase_price ?? null, estimated_cost: Number(r.estimated_cost || 0), recommended_quantity: Number(r.recommended_quantity || 0),
  status: String(r.status || 'ok'), selected, quantity: r.recommended_quantity > 0 ? String(r.recommended_quantity) : '', remarks: '',
  link_supplier: false, override_pending: false, extra: false, price: '', discount: '', free: '',
})

interface Props { onClose: () => void; onDone: () => void; quotationId?: string; mode?: 'request' | 'prices' }

export default function SupplierQuotationModal({ onClose, onDone, quotationId, mode = 'request' }: Props) {
  const prices = mode === 'prices'
  const [suppliers, setSuppliers] = useState<Row[]>([])
  const [supplierQuery, setSupplierQuery] = useState('')
  const [supplierHighlight, setSupplierHighlight] = useState(0)
  const [supplier, setSupplier] = useState<Row | null>(null)
  const [branches, setBranches] = useState<Row[]>([])
  const [branchId, setBranchId] = useState('')
  const [rows, setRows] = useState<QuoteRow[]>([])
  const [selected, setSelected] = useState(0)
  const [requested, setRequested] = useState<Requested[]>([])
  const [products, setProducts] = useState<Row[]>([])
  const [adding, setAdding] = useState<null | { query: string; highlight: number }>(null)
  const [linkPrompt, setLinkPrompt] = useState<QuoteRow | null>(null)
  const [requestDraft, setRequestDraft] = useState<Requested | null>(null)
  const [delivery, setDelivery] = useState('')
  const [requiredBy, setRequiredBy] = useState('')
  const [quotation, setQuotation] = useState<Row | null>(null)
  const [busy, setBusy] = useState(false)
  const [reviewing, setReviewing] = useState(false)
  const [nextStep, setNextStep] = useState<null | 'share' | 'convert'>(null)
  const [error, setError] = useState('')
  const [history, setHistory] = useState<Row[]>([])
  const [settings, setSettings] = useState<Row>({})
  const supplierRef = useRef<HTMLInputElement>(null)
  const tableRef = useRef<HTMLDivElement>(null)
  const addRef = useRef<HTMLInputElement>(null)
  const cellRefs = useRef(new Map<string, HTMLInputElement>())

  useEffect(() => {
    window.api.admin.suppliers.list().then((r: Row) => r.success && setSuppliers(r.data))
    window.api.admin.branches?.list?.().then((r: Row) => r?.success && setBranches(r.data)).catch(() => undefined)
    window.api.products.list({ is_active: true }).then((r: Row) => r.success && setProducts(r.data))
    window.api.settings?.get?.().then((r: Row) => r?.success && setSettings(r.data || {})).catch(() => undefined)
    if (!quotationId) requestAnimationFrame(() => supplierRef.current?.focus())
  }, [quotationId])

  // ── Supplier search: name, business name, phone or mobile ─────────────────
  const supplierMatches = useMemo(() => {
    const q = supplierQuery.trim().toLowerCase()
    if (!q || supplier) return []
    return suppliers.filter(s => [s.name, s.business_name, s.phone, s.mobile_number, s.code].some(v => String(v || '').toLowerCase().includes(q))).slice(0, 8)
  }, [supplierQuery, suppliers, supplier])

  const loadPlan = useCallback(async (s: Row, branch: string, keep?: QuoteRow[]) => {
    setBusy(true); setError('')
    try {
      const res = await window.api.purchases.reorderPlan(String(s.id), { branch_id: branch || undefined, exclude_purchase_id: quotationId })
      if (!res.success) throw new Error(res.error)
      const plan = (res.data.rows as Row[]).map(r => fromPlan(r))
      const merged = keep ? [...keep.map(k => ({ ...(plan.find(p => p.product_id === k.product_id) || k), selected: true, quantity: k.quantity, remarks: k.remarks, price: k.price, discount: k.discount, free: k.free, extra: !plan.some(p => p.product_id === k.product_id) })),
        ...plan.filter(p => !keep.some(k => k.product_id === p.product_id))] : plan
      merged.sort((a, b) => Number(b.selected) - Number(a.selected))
      setRows(merged); setSelected(0)
      window.api.purchases.supplierHistory(String(s.id)).then((h: Row) => h.success && setHistory(h.data)).catch(() => undefined)
      requestAnimationFrame(() => tableRef.current?.focus())
    } catch (err) { setError((err as Error).message) } finally { setBusy(false) }
  }, [quotationId])

  const chooseSupplier = (s: Row) => { setSupplier(s); setSupplierQuery(String(s.name)); void loadPlan(s, branchId) }

  // ── Open an existing quotation (edit quantities or record supplier prices) ─
  useEffect(() => {
    if (!quotationId || !suppliers.length) return
    window.api.purchases.get(quotationId).then((res: Row) => {
      if (!res.success) { setError(res.error); return }
      const po = res.data
      setQuotation(po); setDelivery(po.delivery_requirements || ''); setRequiredBy(po.expected_date || '')
      setRequested(po.requested_items ? JSON.parse(po.requested_items) : [])
      const s = suppliers.find(x => String(x.id) === String(po.supplier_id)) || { id: po.supplier_id, name: po.supplier_name }
      setSupplier(s); setSupplierQuery(String(s.name))
      const lines: QuoteRow[] = (po.items as Row[]).map(item => ({
        ...fromPlan({ product_id: item.product_id, name: item.product_name, sku: item.sku, unit: item.product_unit, estimated_cost: item.unit_cost }, true),
        quantity: String(item.quantity), remarks: item.remarks || '',
        price: Number(item.price_confirmed) === 1 && !prices ? String(item.unit_cost) : '',
        discount: item.discount_amount ? String(item.discount_amount) : '', free: item.free_quantity ? String(item.free_quantity) : '',
      }))
      if (prices) { setRows(lines); requestAnimationFrame(() => cellRefs.current.get(`0:price`)?.focus()) }
      else void loadPlan(s, branchId, lines)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quotationId, suppliers.length])

  // ── Manual product addition (F4) ──────────────────────────────────────────
  const catalog = useMemo(() => new PosCatalog(products.map(p => ({ ...p, is_active: true })) as unknown as Product[]), [products])
  const addMatches = useMemo(() => adding?.query.trim() ? catalog.search(adding.query.trim(), 8) as unknown as Row[] : [], [adding?.query, catalog])
  const addProduct = (p: Row) => {
    setAdding(null)
    const existing = rows.findIndex(r => r.product_id === String(p.id))
    if (existing >= 0) { setRows(rs => rs.map((r, i) => i === existing ? { ...r, selected: true } : r)); setSelected(existing); focusCell(existing, 'quantity'); return }
    const row: QuoteRow = { ...fromPlan({ product_id: p.id, name: p.name, sku: p.sku, unit: p.unit, current_stock: p.stock, min_stock_level: p.min_stock_level, estimated_cost: p.cost_price }, true), quantity: '', extra: true }
    if (!p.supplier_id && supplier) { setLinkPrompt(row); return }
    insertRow(row)
  }
  const insertRow = (row: QuoteRow) => {
    setRows(rs => [row, ...rs]); setSelected(0); focusCell(0, 'quantity')
  }

  const focusCell = (index: number, field: string) => requestAnimationFrame(() => { const el = cellRefs.current.get(`${index}:${field}`); el?.focus(); el?.select() })
  const update = (index: number, patch: Partial<QuoteRow>) => setRows(rs => rs.map((r, i) => i === index ? { ...r, ...patch } : r))
  const toggle = (index: number) => setRows(rs => rs.map((r, i) => i !== index ? r : { ...r, selected: !r.selected, override_pending: !r.selected && r.incoming_quantity > 0 }))

  const chosen = rows.filter(r => r.selected)
  const estimate = chosen.reduce((sum, r) => sum + (Number(r.quantity) || 0) * (r.estimated_cost || 0), 0)

  // ── Save / print / share / convert ────────────────────────────────────────
  const save = async (): Promise<Row | null> => {
    if (!supplier) { setError('Select a supplier first (F2)'); return null }
    const bad = chosen.find(r => !(Number(r.quantity) > 0))
    if (bad) { setError(`Enter a quantity for ${bad.name}`); focusCell(rows.indexOf(bad), 'quantity'); return null }
    setBusy(true); setError('')
    try {
      const res = await window.api.purchases.saveQuotation({
        id: quotation?.id, supplier_id: supplier.id, delivery_requirements: delivery, expected_date: requiredBy || undefined, requested_items: requested,
        lines: chosen.map(r => ({ product_id: r.product_id, quantity: Number(r.quantity), estimated_cost: r.estimated_cost, remarks: r.remarks, link_supplier: r.link_supplier, override_pending: r.override_pending })),
      })
      if (!res.success) {
        const text = String(res.error || '')
        try { const info = JSON.parse(text); if (info.code === 'PENDING_ORDER') { setError(`Already on pending orders: ${info.items.join('; ')}. Remove them or select them again to override (manager).`); return null } } catch { /* plain message */ }
        throw new Error(text)
      }
      setQuotation(res.data)
      toast.success(`Quotation ${res.data.quotation_number} saved`)
      return res.data
    } catch (err) { setError((err as Error).message); return null } finally { setBusy(false) }
  }
  const print = async () => {
    const saved = quotation && !busy ? quotation : await save()
    if (!saved || !supplier) return
    const branch = branches.find(b => String(b.id) === String(saved.branch_id))
    printSupplierRfq({
      rfq_number: String(saved.quotation_number), date: String(saved.purchase_date || colomboToday()).slice(0, 10), required_by: requiredBy || undefined,
      company: { name: String(settings.company_name || 'Our store'), address: settings.company_address, phone: settings.company_phone, email: settings.company_email, branch: branch?.name },
      supplier: { name: String(supplier.name), business_name: supplier.business_name, phone: supplier.phone, mobile_number: supplier.mobile_number, email: supplier.email, address: supplier.address },
      items: chosen.map(r => ({ name: r.name, code: r.sku, unit: r.unit, quantity: Number(r.quantity), remarks: r.remarks })),
      requested_items: requested, delivery_requirements: delivery,
    })
  }
  const share = async () => {
    const saved = quotation || await save()
    if (!saved) return
    const res = await window.api.purchases.shareQuotation(String(saved.id))
    if (res.success) toast.success('WhatsApp opened with the quotation request'); else setError(res.error)
  }
  const finalize = async () => {
    const saved = await save()
    if (saved) setNextStep(supplier?.mobile_number || supplier?.phone ? 'share' : null)
    if (saved && !(supplier?.mobile_number || supplier?.phone)) { onDone() }
  }
  const confirmPrices = async () => {
    if (!quotation) return
    const missing = rows.findIndex(r => !(Number(r.price) > 0))
    if (missing >= 0) { setError(`Enter the supplier price for ${rows[missing].name}`); focusCell(missing, 'price'); return }
    setBusy(true); setError('')
    try {
      const res = await window.api.purchases.confirmQuotationPrices(String(quotation.id), rows.map(r => ({ product_id: r.product_id, quantity: Number(r.quantity), unit_cost: Number(r.price), discount_amount: Number(r.discount || 0), free_quantity: Number(r.free || 0), remarks: r.remarks })))
      if (!res.success) throw new Error(res.error)
      toast.success('Supplier prices recorded')
      setNextStep('convert')
    } catch (err) { setError((err as Error).message) } finally { setBusy(false) }
  }
  const convert = async () => {
    if (!quotation) return
    const res = await window.api.purchases.updateStatus(String(quotation.id), 'SENT', { open_whatsapp: false, send_email: false })
    if (res.success) { toast.success(`Purchase order ${quotation.po_number} created. Receive the stock when it arrives.`); onDone() } else setError(res.error)
  }

  // ── Keyboard ──────────────────────────────────────────────────────────────
  const latest = useRef({ save, print, finalize, confirmPrices, convert, share, toggle })
  latest.current = { save, print, finalize, confirmPrices, convert, share, toggle }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const h = latest.current
      const stop = () => { e.preventDefault(); e.stopImmediatePropagation() }
      const target = e.target as HTMLElement
      const inInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
      if (nextStep) {
        if (e.key === 'Enter') { stop(); setNextStep(null); if (nextStep === 'share') void h.share().then(onDone); else void h.convert() }
        if (e.key === 'Escape') { stop(); setNextStep(null); if (nextStep === 'share') onDone() }
        return
      }
      if (linkPrompt) {
        const key = e.key.toLowerCase()
        if (key === 'y' || key === 'n' || e.key === 'Escape') { stop(); insertRow({ ...linkPrompt, link_supplier: key === 'y' }); setLinkPrompt(null) }
        return
      }
      if (reviewing) {
        if (e.key === 'Enter') { stop(); setReviewing(false); void h.finalize() }
        else if (e.key === 'Escape') { stop(); setReviewing(false) }
        return
      }
      if (e.key === 'Escape' && (adding || requestDraft)) { stop(); setAdding(null); setRequestDraft(null); tableRef.current?.focus(); return }
      if (e.ctrlKey && e.key.toLowerCase() === 'p') { stop(); void h.print(); return }
      if (e.ctrlKey && e.key === 'Enter') { stop(); if (prices) void h.confirmPrices(); else if (chosen.length || requested.length) setReviewing(true); else setError('Select at least one product'); return }
      if (e.key === 'F2' && !prices) { stop(); setSupplier(null); setRows([]); requestAnimationFrame(() => { supplierRef.current?.focus(); supplierRef.current?.select() }); return }
      if (e.key === 'F4' && !prices) { stop(); if (!supplier) { setError('Select a supplier first (F2)'); return } setAdding({ query: '', highlight: 0 }); requestAnimationFrame(() => addRef.current?.focus()); return }
      if (e.key === 'F9') { stop(); if (prices) toast('Supplier prices are recorded together with Ctrl+Enter', { icon: '⌨️' }); else void h.save(); return }
      if (e.key === 'F3') { stop(); focusCell(selected, prices ? 'price' : 'quantity'); return }
      if (inInput) return
      if (e.key === 'ArrowDown') { stop(); setSelected(s => Math.min(rows.length - 1, s + 1)) }
      else if (e.key === 'ArrowUp') { stop(); setSelected(s => Math.max(0, s - 1)) }
      else if (e.key === ' ' && !prices) { stop(); h.toggle(selected) }
      else if (e.key === 'Delete' && !prices) { stop(); setRows(rs => rs.filter((_, i) => i !== selected)); setSelected(s => Math.max(0, Math.min(s, rows.length - 2))) }
      else if (e.key === 'Enter' && rows[selected]) { stop(); if (!prices && !rows[selected].selected) h.toggle(selected); focusCell(selected, prices ? 'price' : 'quantity') }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextStep, linkPrompt, reviewing, adding, requestDraft, prices, chosen.length, requested.length, supplier, selected, rows])

  const fields = prices ? ['quantity', 'price', 'discount', 'free', 'remarks'] : ['quantity', 'estimated', 'remarks']
  const cellKey = (index: number, field: string) => (e: React.KeyboardEvent<HTMLInputElement>) => {
    const at = fields.indexOf(field)
    if (e.key === 'Enter') {
      e.preventDefault()
      if (at < fields.length - 1) focusCell(index, fields[at + 1])
      else if (index < rows.length - 1) { setSelected(index + 1); prices ? focusCell(index + 1, fields[0] === 'quantity' ? 'price' : fields[0]) : tableRef.current?.focus() }
      else tableRef.current?.focus()
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const next = Math.max(0, Math.min(rows.length - 1, index + (e.key === 'ArrowDown' ? 1 : -1)))
      setSelected(next); focusCell(next, field)
    }
  }
  const cell = (index: number, field: string, value: string, onChange: (v: string) => void, width = 'w-20', label = field) => (
    <input ref={el => { if (el) cellRefs.current.set(`${index}:${field}`, el); else cellRefs.current.delete(`${index}:${field}`) }}
      aria-label={`${label} ${rows[index]?.name}`} className={`input py-0.5 px-1 text-xs ${width}`} value={value}
      inputMode={field === 'remarks' ? undefined : 'decimal'} onFocus={() => setSelected(index)}
      onChange={e => onChange(e.target.value)} onKeyDown={cellKey(index, field)} />
  )

  const title = prices ? `Record supplier prices · ${quotation?.quotation_number || ''}` : quotation ? `Supplier quotation · ${quotation.quotation_number}` : 'Supplier quotation & reorder'
  return (
    <Modal title={title} onClose={() => { if (!busy) onClose() }} size="xl">
      <div className="space-y-3 text-sm">
        {/* Supplier, branch and request details */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2 items-end">
          <div className="relative md:col-span-2">
            <label className="flex flex-col text-[11px]" style={{ color: 'var(--text-3)' }}>Supplier <kbd className="kbd text-[9px] w-fit">F2</kbd>
              <input ref={supplierRef} aria-label="Supplier search" className="input py-1.5" value={supplierQuery} disabled={prices} placeholder="Name, business or phone"
                onChange={e => { setSupplierQuery(e.target.value); setSupplier(null); setSupplierHighlight(0) }}
                onKeyDown={e => {
                  if (e.key === 'ArrowDown') { e.preventDefault(); setSupplierHighlight(h => Math.min(h + 1, supplierMatches.length - 1)) }
                  if (e.key === 'ArrowUp') { e.preventDefault(); setSupplierHighlight(h => Math.max(0, h - 1)) }
                  if (e.key === 'Enter' && supplierMatches[supplierHighlight]) { e.preventDefault(); chooseSupplier(supplierMatches[supplierHighlight]) }
                }} />
            </label>
            {supplierMatches.length > 0 && (
              <ul role="listbox" aria-label="Supplier suggestions" className="absolute z-30 left-0 right-0 mt-1 rounded-lg border shadow-xl" style={{ background: 'var(--surface-1, #0f172a)', borderColor: 'var(--border)' }}>
                {supplierMatches.map((s, i) => <li key={String(s.id)} role="option" aria-selected={i === supplierHighlight} onMouseDown={e => { e.preventDefault(); chooseSupplier(s) }}
                  className={`px-3 py-1.5 cursor-pointer ${i === supplierHighlight ? 'bg-brand-500/25' : ''}`}>{String(s.name)} <span className="text-xs opacity-60">{String(s.business_name || '')} {String(s.mobile_number || s.phone || '')}</span></li>)}
              </ul>
            )}
          </div>
          {!prices && branches.length > 1 && (
            <label className="flex flex-col text-[11px]" style={{ color: 'var(--text-3)' }}>Stock of branch
              <select aria-label="Stock branch" className="input py-1.5" value={branchId} onChange={e => { setBranchId(e.target.value); if (supplier) void loadPlan(supplier, e.target.value, rows.filter(r => r.selected && r.extra)) }}>
                <option value="">Main branch</option>{branches.map(b => <option key={String(b.id)} value={String(b.id)}>{String(b.name)}</option>)}
              </select>
            </label>
          )}
          {!prices && <label className="flex flex-col text-[11px]" style={{ color: 'var(--text-3)' }}>Required by
            <input aria-label="Required by" type="date" className="input py-1.5" value={requiredBy} onChange={e => setRequiredBy(e.target.value)} />
          </label>}
          {!prices && <label className="flex flex-col text-[11px] md:col-span-4" style={{ color: 'var(--text-3)' }}>Delivery requirements (printed for the supplier)
            <input aria-label="Delivery requirements" className="input py-1.5" value={delivery} placeholder="e.g. Deliver before 10am, cartons only" onChange={e => setDelivery(e.target.value)} />
          </label>}
        </div>

        {linkPrompt && <div role="alert" className="rounded-lg border border-sky-500/60 bg-sky-500/10 p-2">Link <strong>{linkPrompt.name}</strong> to <strong>{String(supplier?.name)}</strong> permanently? <kbd className="kbd">Y</kbd> yes · <kbd className="kbd">N</kbd> only this quotation</div>}
        {reviewing && <div role="alert" aria-label="Review quotation" className="rounded-lg border-2 border-brand-500 bg-brand-500/10 p-2">Save quotation for <strong>{String(supplier?.name)}</strong>: {chosen.length} product(s){requested.length ? ` + ${requested.length} new item request(s)` : ''}. <kbd className="kbd">Enter</kbd> save · <kbd className="kbd">Esc</kbd> back</div>}
        {nextStep === 'share' && <div role="alert" className="rounded-lg border border-emerald-500/60 bg-emerald-500/10 p-2">Saved. Send the request to the supplier on WhatsApp? <kbd className="kbd">Enter</kbd> send · <kbd className="kbd">Esc</kbd> later · <kbd className="kbd">Ctrl+P</kbd> print / PDF</div>}
        {nextStep === 'convert' && <div role="alert" className="rounded-lg border border-emerald-500/60 bg-emerald-500/10 p-2">Prices recorded. Convert this quotation into a purchase order now? <kbd className="kbd">Enter</kbd> convert · <kbd className="kbd">Esc</kbd> keep as quotation</div>}
        {error && <p role="alert" className="text-red-400 text-xs">{error}</p>}

        {adding && (
          <div className="relative">
            <input ref={addRef} aria-label="Add product search" className="input py-1.5" placeholder="Add product: name, SKU or barcode · Enter add · Esc close" value={adding.query}
              onChange={e => setAdding({ query: e.target.value, highlight: 0 })}
              onKeyDown={e => {
                if (e.key === 'ArrowDown') { e.preventDefault(); setAdding(a => a && { ...a, highlight: Math.min(a.highlight + 1, addMatches.length - 1) }) }
                if (e.key === 'ArrowUp') { e.preventDefault(); setAdding(a => a && { ...a, highlight: Math.max(0, a.highlight - 1) }) }
                if (e.key === 'Enter') {
                  e.preventDefault()
                  const exact = catalog.lookup(adding.query.trim()) as unknown as Row | undefined
                  const hit = exact || addMatches[adding.highlight]
                  if (hit) addProduct(products.find(p => String(p.id) === String(hit.id)) || hit)
                  else if (adding.query.trim()) { setRequestDraft({ name: adding.query.trim(), quantity: 1, unit: 'pcs', remarks: '' }); setAdding(null) }
                }
              }} />
            {addMatches.length > 0 && <ul role="listbox" aria-label="Add product suggestions" className="absolute z-30 left-0 right-0 mt-1 rounded-lg border shadow-xl" style={{ background: 'var(--surface-1, #0f172a)', borderColor: 'var(--border)' }}>
              {addMatches.map((p, i) => <li key={String(p.id)} role="option" aria-selected={i === adding.highlight} onMouseDown={e => { e.preventDefault(); addProduct(products.find(x => String(x.id) === String(p.id)) || p) }}
                className={`px-3 py-1 cursor-pointer ${i === adding.highlight ? 'bg-brand-500/25' : ''}`}>{String(p.name)} <span className="text-xs opacity-60">{String(p.sku || '')}</span></li>)}
            </ul>}
            {adding.query.trim() && !addMatches.length && <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>Not in inventory: Enter adds it as a new product request.</p>}
          </div>
        )}
        {requestDraft && (
          <div className="flex flex-wrap gap-2 items-end rounded-lg border p-2" style={{ borderColor: 'var(--border)' }} aria-label="New product request">
            <span className="text-xs font-semibold">New product request</span>
            {(['name', 'quantity', 'unit', 'remarks'] as const).map((key, i, all) => (
              <input key={key} aria-label={`Request ${key}`} autoFocus={i === 1} className="input py-1 text-xs w-32" value={String(requestDraft[key])} placeholder={key}
                onChange={e => setRequestDraft({ ...requestDraft, [key]: key === 'quantity' ? Number(e.target.value) : e.target.value })}
                onKeyDown={e => {
                  if (e.key !== 'Enter') return
                  e.preventDefault()
                  const next = e.currentTarget.parentElement?.querySelectorAll('input')[i + 1] as HTMLInputElement | undefined
                  if (i < all.length - 1 && next) next.focus()
                  else if (requestDraft.name && requestDraft.quantity > 0) { setRequested(r => [...r, requestDraft]); setRequestDraft(null); tableRef.current?.focus() }
                }} />
            ))}
          </div>
        )}

        {/* Quotation lines */}
        <div ref={tableRef} tabIndex={0} aria-label="Quotation lines" className="rounded-xl border overflow-auto max-h-[48vh] outline-none focus:ring-2 focus:ring-brand-500" style={{ borderColor: 'var(--border)' }}>
          <table className="w-full text-xs">
            <thead className="sticky top-0" style={{ background: 'var(--surface-1, #0f172a)' }}>
              <tr>{(prices ? ['Product', 'Code', 'Qty', 'Supplier price', 'Discount (Rs.)', 'Free qty', 'Remarks']
                : ['', 'Product', 'Code', 'Status', 'Stock', 'Min/Max', 'Incoming', `Sold ${30}d`, 'Last price', 'Recommended', 'Order qty', 'Est. price (internal)', 'Remarks'])
                .map((h, i) => <th key={i} className="text-left px-2 py-1.5 font-medium" style={{ color: 'var(--text-3)' }}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.product_id} className={`border-t ${i === selected ? 'bg-brand-500/15' : ''} ${!prices && !r.selected ? 'opacity-50' : ''}`} style={{ borderColor: 'var(--border)' }} onClick={() => setSelected(i)}>
                  {!prices && <td className="px-2"><input type="checkbox" tabIndex={-1} aria-label={`Include ${r.name}`} checked={r.selected} onChange={() => toggle(i)} /></td>}
                  <td className="px-2 py-1 max-w-[200px] truncate" title={r.name}>{r.name}{r.extra && <span className="ml-1 text-[10px] text-sky-400">added</span>}{r.link_supplier && <span className="ml-1 text-[10px] text-emerald-400">link</span>}</td>
                  <td className="px-2">{r.sku}</td>
                  {prices ? <>
                    <td className="px-2">{cell(i, 'quantity', r.quantity, v => update(i, { quantity: v }), 'w-16', 'Quantity')} {r.unit}</td>
                    <td className="px-2">{cell(i, 'price', r.price, v => update(i, { price: v }), 'w-24', 'Supplier price')}</td>
                    <td className="px-2">{cell(i, 'discount', r.discount, v => update(i, { discount: v }), 'w-20', 'Discount')}</td>
                    <td className="px-2">{cell(i, 'free', r.free, v => update(i, { free: v }), 'w-16', 'Free')}</td>
                    <td className="px-2">{cell(i, 'remarks', r.remarks, v => update(i, { remarks: v }), 'w-32', 'Remarks')}</td>
                  </> : <>
                    <td className={`px-2 capitalize ${STATUS_STYLE[r.status] || ''}`}>{r.status === 'ok' ? 'in stock' : r.status}</td>
                    <td className="px-2">{r.current_stock} {r.unit}</td>
                    <td className="px-2">{r.min_stock_level}{r.max_stock_level != null ? ` / ${r.max_stock_level}` : ''}</td>
                    <td className="px-2">{r.incoming_quantity > 0 ? <span className="text-amber-400" title={r.incoming_orders.join(', ')}>{r.incoming_quantity} ({r.incoming_orders.join(', ')}){r.selected && ' · override'}</span> : '—'}</td>
                    <td className="px-2">{r.sold_quantity}</td>
                    <td className="px-2">{r.last_purchase_price ?? '—'}</td>
                    <td className="px-2">{r.recommended_quantity || '—'}</td>
                    <td className="px-2">{cell(i, 'quantity', r.quantity, v => update(i, { quantity: v, selected: true, override_pending: r.incoming_quantity > 0 }), 'w-16', 'Order quantity')}</td>
                    <td className="px-2">{cell(i, 'estimated', String(r.estimated_cost || ''), v => update(i, { estimated_cost: Number(v) || 0 }), 'w-20', 'Estimated price')}</td>
                    <td className="px-2">{cell(i, 'remarks', r.remarks, v => update(i, { remarks: v }), 'w-32', 'Remarks')}</td>
                  </>}
                </tr>
              ))}
              {requested.map((r, i) => (
                <tr key={`req-${i}`} className="border-t" style={{ borderColor: 'var(--border)' }}>
                  {!prices && <td />}<td className="px-2 py-1" colSpan={prices ? 2 : 9}>{r.name} <span className="text-[10px] text-sky-400">new product request</span></td>
                  <td className="px-2">{r.quantity} {r.unit}</td><td className="px-2" colSpan={prices ? 4 : 2}>{r.remarks}</td>
                </tr>
              ))}
              {!rows.length && !requested.length && <tr><td colSpan={13} className="text-center py-6" style={{ color: 'var(--text-3)' }}>{busy ? 'Loading…' : supplier ? 'No products linked to this supplier yet. Press F4 to add products.' : 'Select a supplier (F2) to load its low-stock products.'}</td></tr>}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap gap-x-6 gap-y-1">
          {!prices && <><span>Selected <strong>{chosen.length}</strong></span><span>New requests <strong>{requested.length}</strong></span><span>Estimated amount (internal) <strong>Rs.{Math.round(estimate).toLocaleString()}</strong></span></>}
          {quotation && <span>Reference <strong>{quotation.quotation_number}</strong> · {quotation.po_number}</span>}
        </div>
        {!prices && history.length > 0 && (
          <details className="text-xs"><summary className="cursor-pointer">Supplier history ({history.length})</summary>
            <table className="w-full mt-1"><tbody>{history.slice(0, 15).map(h => <tr key={String(h.id)} className="border-t" style={{ borderColor: 'var(--border)' }}>
              <td className="px-2 py-0.5">{String(h.purchase_date || '').slice(0, 10)}</td><td className="px-2">{h.is_quotation ? h.quotation_number : h.po_number}</td>
              <td className="px-2">{h.is_quotation && h.status === 'DRAFT' ? 'Quotation' : h.status}</td><td className="px-2">Rs.{Number(h.total_amount || 0).toLocaleString()}</td>
              <td className="px-2">{Number(h.discount_total) ? `Disc Rs.${h.discount_total}` : ''}</td><td className="px-2">{Number(h.pending_quantity) ? `Pending ${h.pending_quantity}` : ''}</td></tr>)}</tbody></table>
          </details>
        )}
        <p className="text-[11px] leading-5" style={{ color: 'var(--text-3)' }}>
          {prices
            ? <><kbd className="kbd">Enter</kbd> next field · <kbd className="kbd">↑↓</kbd> rows · <kbd className="kbd">F3</kbd> edit price · <kbd className="kbd">Ctrl+Enter</kbd> record prices · <kbd className="kbd">Ctrl+P</kbd> print</>
            : <><kbd className="kbd">F2</kbd> supplier · <kbd className="kbd">↑↓</kbd> rows · <kbd className="kbd">Space</kbd> select · <kbd className="kbd">Enter</kbd>/<kbd className="kbd">F3</kbd> edit qty · <kbd className="kbd">F4</kbd> add product · <kbd className="kbd">Del</kbd> remove · <kbd className="kbd">F9</kbd> save draft · <kbd className="kbd">Ctrl+P</kbd> print / PDF · <kbd className="kbd">Ctrl+Enter</kbd> review &amp; finalize · <kbd className="kbd">Esc</kbd> close</>}
        </p>
      </div>
    </Modal>
  )
}
