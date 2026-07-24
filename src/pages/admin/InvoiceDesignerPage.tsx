import { useState, useEffect, useRef } from 'react'
import PageHeader from '@/components/shared/PageHeader'
import { Save, Plus, Trash2, ChevronUp, ChevronDown, X, Printer, Type, Minus, Image as ImageIcon, Barcode, QrCode } from 'lucide-react'
import toast from 'react-hot-toast'

type Align = 'left' | 'center' | 'right'
type ElementType = 'text' | 'line' | 'image' | 'barcode' | 'qr'
type Design = 'dot' | 'thermal' | 'a4'

interface LayoutElement {
  id: string
  type: ElementType
  bind?: string | null
  staticText?: string
  x: number
  y: number
  width?: number
  font?: string
  size?: number
  weight?: number
  color?: string
  align?: Align
  visible?: boolean
}
interface LayoutColumn { field: string; header?: string; x: number; align?: Align }
interface FieldPos { x: number; y: number; align?: Align }
interface CustomLayout {
  enabled: boolean
  page: { w: number; h: number }
  prePrinted: boolean
  calibration: { offsetX: number; offsetY: number }
  backgroundDataUrl?: string
  elements: LayoutElement[]
  itemTable: { x: number; y: number; rowHeight: number; maxRows?: number; showHeader?: boolean; columns: LayoutColumn[] }
  totals: { subtotal?: FieldPos; discount?: FieldPos; tax?: FieldPos; total?: FieldPos }
}

const DESIGN_META: Record<Design, { label: string; page: { w: number; h: number } }> = {
  dot:     { label: 'Dot Matrix', page: { w: 241, h: 279 } },
  thermal: { label: 'Thermal',    page: { w: 80,  h: 200 } },
  a4:      { label: 'A4 / B5',    page: { w: 210, h: 297 } },
}

const BIND_GROUPS: { group: string; tokens: string[] }[] = [
  { group: 'Company', tokens: ['company.name', 'company.address', 'company.phone', 'company.email', 'company.regNo'] },
  { group: 'Invoice', tokens: ['invoice.no', 'invoice.date', 'invoice.time', 'invoice.terms', 'invoice.currency', 'invoice.copyNo', 'invoice.poNo', 'branch.name', 'cashier.name'] },
  { group: 'Customer', tokens: ['customer.name', 'customer.address', 'customer.deliveryTo'] },
  { group: 'Totals / Payment', tokens: ['subtotal', 'discount', 'tax', 'total', 'payment.method', 'payment.received', 'payment.balance'] },
]

const ITEM_TOKENS = ['item.line', 'item.code', 'item.desc', 'item.uom', 'item.qty', 'item.loc', 'item.price', 'item.disc', 'item.amount']

function defaultLayout(design: Design): CustomLayout {
  const page = DESIGN_META[design].page
  if (design === 'dot') {
    return {
      enabled: false, page, prePrinted: true, calibration: { offsetX: 0, offsetY: 0 },
      elements: [
        { id: 'date', type: 'text', bind: 'invoice.date', x: 34, y: 40, size: 9, align: 'left', visible: true },
        { id: 'name', type: 'text', bind: 'customer.name', x: 34, y: 50, size: 9, align: 'left', visible: true },
        { id: 'address', type: 'text', bind: 'customer.address', x: 34, y: 55, size: 9, align: 'left', visible: true },
        { id: 'invoiceNo', type: 'text', bind: 'invoice.no', x: 114, y: 40, size: 9, align: 'left', visible: true },
        { id: 'terms', type: 'text', bind: 'invoice.terms', x: 114, y: 45, size: 9, align: 'left', visible: true },
        { id: 'currency', type: 'text', bind: 'invoice.currency', x: 114, y: 50, size: 9, align: 'left', visible: true },
        { id: 'deliveryTo', type: 'text', bind: 'customer.deliveryTo', x: 114, y: 55, size: 9, align: 'left', visible: true },
        { id: 'enteredBy', type: 'text', bind: 'cashier.name', x: 8, y: 213, size: 9, align: 'left', visible: true },
        { id: 'dateIssue', type: 'text', bind: 'invoice.date', x: 193, y: 249, size: 9, align: 'left', visible: true },
      ],
      itemTable: {
        x: 0, y: 80, rowHeight: 7, maxRows: 12, showHeader: false,
        columns: [
          { field: 'item.line', header: 'Line', x: 13, align: 'center' },
          { field: 'item.desc', header: 'Description', x: 23, align: 'left' },
          { field: 'item.uom', header: 'UOM', x: 128, align: 'center' },
          { field: 'item.qty', header: 'Qty', x: 145, align: 'center' },
          { field: 'item.price', header: 'Rate', x: 202, align: 'right' },
          { field: 'item.amount', header: 'Value', x: 234, align: 'right' },
        ],
      },
      totals: { subtotal: { x: 234, y: 163, align: 'right' }, total: { x: 234, y: 168, align: 'right' } },
    }
  }
  return {
    enabled: false, page, prePrinted: false, calibration: { offsetX: 0, offsetY: 0 },
    elements: [
      { id: 'company', type: 'text', bind: 'company.name', x: 10, y: 10, size: 12, weight: 700, align: 'left', visible: true },
      { id: 'invoiceNo', type: 'text', bind: 'invoice.no', x: 10, y: 18, size: 9, align: 'left', visible: true },
      { id: 'date', type: 'text', bind: 'invoice.date', x: 10, y: 24, size: 9, align: 'left', visible: true },
    ],
    itemTable: {
      x: 0, y: 40, rowHeight: 6, maxRows: 20, showHeader: true,
      columns: [
        { field: 'item.desc', header: 'Item', x: 10, align: 'left' },
        { field: 'item.qty', header: 'Qty', x: Math.round(page.w * 0.6), align: 'center' },
        { field: 'item.price', header: 'Price', x: Math.round(page.w * 0.78), align: 'right' },
        { field: 'item.amount', header: 'Total', x: page.w - 10, align: 'right' },
      ],
    },
    totals: { total: { x: page.w - 10, y: 100, align: 'right' } },
  }
}

const SAMPLE_PAYLOAD = {
  invoice_number: 'SAMPLE-0001',
  bill_type: 'RETAIL',
  invoice_date: new Date().toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
  cashier_name: 'Test Cashier',
  customer_name: 'Sample Customer',
  customer_phone: '',
  customer_email: '',
  customer_address: 'Sample Address Line 1, Sample Town',
  items: [
    { product_name: 'Sample Product A', sku: 'SKU-0001', quantity: 2, unit_price: 1500, discount_amount: 0, line_total: 3000 },
    { product_name: 'Sample Product B', sku: 'SKU-0002', quantity: 1, unit_price: 750, discount_amount: 0, line_total: 750 },
  ],
  subtotal: 3750, discount_amount: 0, tax_amount: 0, total_amount: 3750,
  paid_amount: 3750, change_amount: 0, payment_method: 'cash',
}

const ICONS: Record<ElementType, React.ReactNode> = {
  text: <Type size={13} />, line: <Minus size={13} />, image: <ImageIcon size={13} />,
  barcode: <Barcode size={13} />, qr: <QrCode size={13} />,
}

export default function InvoiceDesignerPage() {
  const [design, setDesign] = useState<Design>('dot')
  const [layout, setLayout] = useState<CustomLayout>(() => defaultLayout('dot'))
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [previewHtml, setPreviewHtml] = useState('')
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [printingCal, setPrintingCal] = useState(false)
  const [sendingEscPos, setSendingEscPos] = useState(false)
  const debounceRef = useRef<number | null>(null)

  useEffect(() => {
    setLoading(true)
    setSelectedId(null)
    window.api.settings.get().then((res: { success: boolean; data?: Record<string, unknown> }) => {
      const raw = res.success && res.data ? res.data[`invoice_${design}_custom_layout_json`] as string | undefined : undefined
      if (raw) {
        try { setLayout(JSON.parse(raw)); return } catch { /* fall through to default below */ }
      }
      setLayout(defaultLayout(design))
    }).catch(() => setLayout(defaultLayout(design)))
      .finally(() => setLoading(false))
  }, [design])

  useEffect(() => {
    if (loading) return
    if (debounceRef.current) window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(async () => {
      try {
        const res = await window.api.printer.renderInvoiceHtml(
          { ...SAMPLE_PAYLOAD, invoice_design: design }, layout
        ) as { success: boolean; html?: string; error?: string }
        if (res.success && res.html) setPreviewHtml(res.html)
        else if (!res.success) toast.error(res.error || 'Preview failed')
      } catch (err) { toast.error('Preview failed: ' + String(err)) }
    }, 200)
    return () => { if (debounceRef.current) window.clearTimeout(debounceRef.current) }
  }, [layout, design, loading])

  const save = async () => {
    setSaving(true)
    try {
      const res = await window.api.settings.update({
        [`invoice_${design}_custom_layout_json`]: JSON.stringify(layout),
      }) as { success: boolean; error?: string }
      if (res.success) toast.success('Layout saved')
      else toast.error(res.error || 'Failed to save layout')
    } catch (err) {
      toast.error('Failed to save layout: ' + String(err))
    } finally {
      setSaving(false)
    }
  }

  const resetToDefault = () => {
    if (!confirm('Reset this layout to the default starting point? Unsaved changes will be lost.')) return
    setLayout(defaultLayout(design))
    setSelectedId(null)
  }

  const addElement = (type: ElementType) => {
    const id = `el_${Date.now()}`
    const el: LayoutElement = {
      id, type, x: 20, y: 20, align: 'left', visible: true,
      ...(type === 'text' ? { bind: null, staticText: 'Label', size: 9 } : {}),
      ...(type === 'line' ? { width: 20, color: '#000000' } : {}),
      ...(type === 'barcode' || type === 'qr' ? { width: type === 'qr' ? 20 : 40 } : {}),
    }
    setLayout(p => ({ ...p, elements: [...p.elements, el] }))
    setSelectedId(id)
  }
  const updateElement = (id: string, patch: Partial<LayoutElement>) =>
    setLayout(p => ({ ...p, elements: p.elements.map(e => e.id === id ? { ...e, ...patch } : e) }))
  const removeElement = (id: string) => {
    setLayout(p => ({ ...p, elements: p.elements.filter(e => e.id !== id) }))
    if (selectedId === id) setSelectedId(null)
  }

  const addColumn = () => setLayout(p => ({
    ...p, itemTable: { ...p.itemTable, columns: [...p.itemTable.columns, { field: 'item.desc', header: 'Column', x: 20, align: 'left' as Align }] },
  }))
  const updateColumn = (idx: number, patch: Partial<LayoutColumn>) =>
    setLayout(p => ({ ...p, itemTable: { ...p.itemTable, columns: p.itemTable.columns.map((c, i) => i === idx ? { ...c, ...patch } : c) } }))
  const removeColumn = (idx: number) =>
    setLayout(p => ({ ...p, itemTable: { ...p.itemTable, columns: p.itemTable.columns.filter((_, i) => i !== idx) } }))
  const moveColumn = (idx: number, dir: -1 | 1) =>
    setLayout(p => {
      const cols = [...p.itemTable.columns]
      const j = idx + dir
      if (j < 0 || j >= cols.length) return p
      const tmp = cols[idx]; cols[idx] = cols[j]; cols[j] = tmp
      return { ...p, itemTable: { ...p.itemTable, columns: cols } }
    })

  const onBackgroundUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setLayout(p => ({ ...p, backgroundDataUrl: String(reader.result) }))
    reader.readAsDataURL(file)
  }

  const printCalibrationSheet = async () => {
    setPrintingCal(true)
    try {
      const res = await window.api.printer.printCalibrationSheet() as { success: boolean; error?: string }
      if (res.success) toast.success('Calibration sheet sent — save this layout first so the sheet matches your latest edits')
      else toast.error(res.error || 'Failed to print calibration sheet')
    } catch (err) {
      toast.error('Failed to print calibration sheet: ' + String(err))
    } finally {
      setPrintingCal(false)
    }
  }

  const sendEscPosTest = async () => {
    setSendingEscPos(true)
    try {
      const res = await window.api.printer.sendEscPosTest() as { success: boolean; error?: string }
      if (res.success) toast.success('ESC/POS test receipt sent')
      else toast.error(res.error || 'Failed — set the printer IP in Settings → Printers first')
    } catch (err) {
      toast.error('Failed to send: ' + String(err))
    } finally {
      setSendingEscPos(false)
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader
        title="Advanced Layout Designer"
        subtitle="Position every element of your invoice/receipt precisely, per print format"
        actions={
          <>
            <button onClick={resetToDefault} className="btn-secondary btn-sm">Reset to Default</button>
            <button onClick={save} disabled={saving} className="btn-primary btn-sm gap-1.5">
              <Save size={14} /> {saving ? 'Saving…' : 'Save Layout'}
            </button>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2 px-6 py-3 border-b flex-shrink-0" style={{ borderColor: 'var(--border)' }}>
        {(Object.keys(DESIGN_META) as Design[]).map(d => (
          <button key={d} onClick={() => setDesign(d)} className={design === d ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'}>
            {DESIGN_META[d].label}
          </button>
        ))}
        <label className="flex items-center gap-2 ml-4 text-sm" style={{ color: 'var(--text-2)' }}>
          <input type="checkbox" checked={layout.enabled} onChange={e => setLayout(p => ({ ...p, enabled: e.target.checked }))} />
          Use this custom layout for {DESIGN_META[design].label} bills
        </label>
      </div>

      <div className="flex-1 overflow-hidden grid grid-cols-1 lg:grid-cols-[440px_1fr]">
        {/* Left: element list + properties + item table + totals + pre-printed */}
        <div className="overflow-y-auto p-4 space-y-4 border-r" style={{ borderColor: 'var(--border)' }}>

          {/* Elements */}
          <div className="card space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm" style={{ color: 'var(--text-1)' }}>Elements</h3>
              <div className="flex gap-1">
                {(['text', 'line', 'image', 'barcode', 'qr'] as ElementType[]).map(t => (
                  <button key={t} onClick={() => addElement(t)} className="btn-ghost btn-sm p-1.5" title={`Add ${t}`}>
                    {ICONS[t]}
                  </button>
                ))}
              </div>
            </div>
            {layout.elements.length === 0 && <p className="text-xs" style={{ color: 'var(--text-3)' }}>No elements yet — add one above.</p>}
            <div className="space-y-1">
              {layout.elements.map(el => (
                <div key={el.id}>
                  <button
                    onClick={() => setSelectedId(selectedId === el.id ? null : el.id)}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-left"
                    style={{ background: selectedId === el.id ? 'var(--bg-soft)' : 'transparent', color: 'var(--text-2)' }}
                  >
                    {ICONS[el.type]}
                    <span className="flex-1 truncate">{el.bind || el.staticText || el.type}</span>
                    <span style={{ color: 'var(--text-3)' }}>x{el.x} y{el.y}</span>
                    <span onClick={e => { e.stopPropagation(); removeElement(el.id) }} className="text-red-400 hover:text-red-300 p-0.5">
                      <Trash2 size={12} />
                    </span>
                  </button>

                  {selectedId === el.id && (
                    <div className="mt-1 mb-2 p-3 rounded-lg space-y-2" style={{ background: 'var(--bg-soft)' }}>
                      {el.type === 'text' && (
                        <div>
                          <label className="label text-xs">Bind to field</label>
                          <select
                            value={el.bind || '__static__'}
                            onChange={e => updateElement(el.id, { bind: e.target.value === '__static__' ? null : e.target.value })}
                            className="input text-xs py-1"
                          >
                            <option value="__static__">Static text (not bound)</option>
                            {BIND_GROUPS.map(g => (
                              <optgroup key={g.group} label={g.group}>
                                {g.tokens.map(t => <option key={t} value={t}>{t}</option>)}
                              </optgroup>
                            ))}
                          </select>
                          {!el.bind && (
                            <input value={el.staticText || ''} onChange={e => updateElement(el.id, { staticText: e.target.value })}
                              className="input text-xs py-1 mt-1.5" placeholder="Static label text" />
                          )}
                        </div>
                      )}
                      {el.type === 'image' && (
                        <div>
                          <label className="label text-xs">Image</label>
                          <input type="file" accept="image/png,image/jpeg" onChange={e => {
                            const file = e.target.files?.[0]; if (!file) return
                            const reader = new FileReader()
                            reader.onload = () => updateElement(el.id, { staticText: String(reader.result) })
                            reader.readAsDataURL(file)
                          }} className="input text-xs py-1" />
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-2">
                        <div><label className="label text-xs">X (mm)</label>
                          <input type="number" step="0.5" value={el.x} onChange={e => updateElement(el.id, { x: parseFloat(e.target.value) || 0 })} className="input text-xs py-1" /></div>
                        <div><label className="label text-xs">Y (mm)</label>
                          <input type="number" step="0.5" value={el.y} onChange={e => updateElement(el.id, { y: parseFloat(e.target.value) || 0 })} className="input text-xs py-1" /></div>
                      </div>
                      {(el.type === 'line' || el.type === 'image' || el.type === 'barcode' || el.type === 'qr') && (
                        <div><label className="label text-xs">Width (mm)</label>
                          <input type="number" step="1" value={el.width || 0} onChange={e => updateElement(el.id, { width: parseFloat(e.target.value) || 0 })} className="input text-xs py-1" /></div>
                      )}
                      {el.type === 'text' && (
                        <>
                          <div className="grid grid-cols-3 gap-2">
                            <div><label className="label text-xs">Size (pt)</label>
                              <input type="number" value={el.size || 9} onChange={e => updateElement(el.id, { size: parseFloat(e.target.value) || 9 })} className="input text-xs py-1" /></div>
                            <div><label className="label text-xs">Weight</label>
                              <select value={el.weight || 400} onChange={e => updateElement(el.id, { weight: parseInt(e.target.value) })} className="input text-xs py-1">
                                <option value={400}>Normal</option>
                                <option value={700}>Bold</option>
                              </select></div>
                            <div><label className="label text-xs">Align</label>
                              <select value={el.align || 'left'} onChange={e => updateElement(el.id, { align: e.target.value as Align })} className="input text-xs py-1">
                                <option value="left">Left</option><option value="center">Center</option><option value="right">Right</option>
                              </select></div>
                          </div>
                          <div><label className="label text-xs">Color</label>
                            <input type="color" value={el.color || '#000000'} onChange={e => updateElement(el.id, { color: e.target.value })} className="input text-xs py-1 h-8" /></div>
                        </>
                      )}
                      <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-3)' }}>
                        <input type="checkbox" checked={el.visible !== false} onChange={e => updateElement(el.id, { visible: e.target.checked })} />
                        Visible
                      </label>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Item Table */}
          <div className="card space-y-2">
            <h3 className="font-semibold text-sm" style={{ color: 'var(--text-1)' }}>Item Table</h3>
            <div className="grid grid-cols-2 gap-2">
              <div><label className="label text-xs">First Row Y (mm)</label>
                <input type="number" step="0.5" value={layout.itemTable.y} onChange={e => setLayout(p => ({ ...p, itemTable: { ...p.itemTable, y: parseFloat(e.target.value) || 0 } }))} className="input text-xs py-1" /></div>
              <div><label className="label text-xs">Row Height (mm)</label>
                <input type="number" step="0.5" value={layout.itemTable.rowHeight} onChange={e => setLayout(p => ({ ...p, itemTable: { ...p.itemTable, rowHeight: parseFloat(e.target.value) || 1 } }))} className="input text-xs py-1" /></div>
              <div><label className="label text-xs">Max Rows</label>
                <input type="number" value={layout.itemTable.maxRows || 12} onChange={e => setLayout(p => ({ ...p, itemTable: { ...p.itemTable, maxRows: parseInt(e.target.value) || 1 } }))} className="input text-xs py-1" /></div>
              <label className="flex items-center gap-2 text-xs mt-5" style={{ color: 'var(--text-3)' }}>
                <input type="checkbox" checked={layout.itemTable.showHeader !== false} onChange={e => setLayout(p => ({ ...p, itemTable: { ...p.itemTable, showHeader: e.target.checked } }))} />
                Print header row
              </label>
            </div>
            <div className="space-y-1.5 pt-1">
              {layout.itemTable.columns.map((col, i) => (
                <div key={i} className="flex items-center gap-1.5 p-2 rounded-lg" style={{ background: 'var(--bg-soft)' }}>
                  <select value={col.field} onChange={e => updateColumn(i, { field: e.target.value })} className="input text-xs py-1 flex-1">
                    {ITEM_TOKENS.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <input value={col.header || ''} onChange={e => updateColumn(i, { header: e.target.value })} placeholder="Header" className="input text-xs py-1 w-20" />
                  <input type="number" step="0.5" value={col.x} onChange={e => updateColumn(i, { x: parseFloat(e.target.value) || 0 })} title="X (mm)" className="input text-xs py-1 w-16" />
                  <select value={col.align || 'left'} onChange={e => updateColumn(i, { align: e.target.value as Align })} className="input text-xs py-1 w-20">
                    <option value="left">L</option><option value="center">C</option><option value="right">R</option>
                  </select>
                  <button onClick={() => moveColumn(i, -1)} className="btn-ghost btn-sm p-1"><ChevronUp size={12} /></button>
                  <button onClick={() => moveColumn(i, 1)} className="btn-ghost btn-sm p-1"><ChevronDown size={12} /></button>
                  <button onClick={() => removeColumn(i)} className="btn-ghost btn-sm p-1 text-red-400"><X size={12} /></button>
                </div>
              ))}
            </div>
            <button onClick={addColumn} className="btn-secondary btn-sm gap-1.5"><Plus size={12} /> Add Column</button>
          </div>

          {/* Totals */}
          <div className="card space-y-2">
            <h3 className="font-semibold text-sm" style={{ color: 'var(--text-1)' }}>Totals</h3>
            {(['subtotal', 'discount', 'tax', 'total'] as const).map(key => {
              const pos = layout.totals[key]
              return (
                <div key={key} className="flex items-center gap-2">
                  <label className="flex items-center gap-1.5 text-xs w-20" style={{ color: 'var(--text-3)' }}>
                    <input type="checkbox" checked={Boolean(pos)}
                      onChange={e => setLayout(p => ({ ...p, totals: { ...p.totals, [key]: e.target.checked ? { x: 20, y: 20, align: 'right' as Align } : undefined } }))} />
                    {key}
                  </label>
                  {pos && (
                    <>
                      <input type="number" step="0.5" value={pos.x} onChange={e => setLayout(p => ({ ...p, totals: { ...p.totals, [key]: { ...pos, x: parseFloat(e.target.value) || 0 } } }))} className="input text-xs py-1 w-20" title="X (mm)" />
                      <input type="number" step="0.5" value={pos.y} onChange={e => setLayout(p => ({ ...p, totals: { ...p.totals, [key]: { ...pos, y: parseFloat(e.target.value) || 0 } } }))} className="input text-xs py-1 w-20" title="Y (mm)" />
                      <select value={pos.align || 'right'} onChange={e => setLayout(p => ({ ...p, totals: { ...p.totals, [key]: { ...pos, align: e.target.value as Align } } }))} className="input text-xs py-1">
                        <option value="left">L</option><option value="center">C</option><option value="right">R</option>
                      </select>
                    </>
                  )}
                </div>
              )
            })}
          </div>

          {/* ESC/POS (thermal only) */}
          {design === 'thermal' && (
            <div className="card space-y-2">
              <h3 className="font-semibold text-sm" style={{ color: 'var(--text-1)' }}>ESC/POS Network Printing</h3>
              <p className="text-xs" style={{ color: 'var(--text-3)' }}>
                Sends a fixed-format receipt as raw ESC/POS bytes to a network thermal printer —
                a different rendering path from the mm-positioned layout above (thermal printers
                are line/character based, not X/Y positioned). Set the printer IP in Settings → Printers.
              </p>
              <button onClick={sendEscPosTest} disabled={sendingEscPos} className="btn-secondary btn-sm gap-1.5">
                <Printer size={13} /> {sendingEscPos ? 'Sending…' : 'Send Test Print (ESC/POS)'}
              </button>
            </div>
          )}

          {/* Pre-printed / calibration (dot-matrix only) */}
          {design === 'dot' && (
            <div className="card space-y-2">
              <h3 className="font-semibold text-sm" style={{ color: 'var(--text-1)' }}>Pre-Printed Stationery</h3>
              <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-3)' }}>
                <input type="checkbox" checked={layout.prePrinted} onChange={e => setLayout(p => ({ ...p, prePrinted: e.target.checked }))} />
                Company logo/labels/gridlines already colour pre-printed — print data only
              </label>
              <div>
                <label className="label text-xs">Background reference (designer only, never printed)</label>
                <input type="file" accept="image/png,image/jpeg" onChange={onBackgroundUpload} className="input text-xs py-1" />
                {layout.backgroundDataUrl && (
                  <button onClick={() => setLayout(p => ({ ...p, backgroundDataUrl: undefined }))} className="text-xs text-red-400 mt-1">Remove background</button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div><label className="label text-xs">Calibration Offset X (mm)</label>
                  <input type="number" step="0.5" value={layout.calibration.offsetX} onChange={e => setLayout(p => ({ ...p, calibration: { ...p.calibration, offsetX: parseFloat(e.target.value) || 0 } }))} className="input text-xs py-1" /></div>
                <div><label className="label text-xs">Calibration Offset Y (mm)</label>
                  <input type="number" step="0.5" value={layout.calibration.offsetY} onChange={e => setLayout(p => ({ ...p, calibration: { ...p.calibration, offsetY: parseFloat(e.target.value) || 0 } }))} className="input text-xs py-1" /></div>
              </div>
              <p className="text-xs" style={{ color: 'var(--text-3)' }}>Small nudge only (a few mm) — not the page size.</p>
              <button onClick={printCalibrationSheet} disabled={printingCal} className="btn-secondary btn-sm gap-1.5">
                <Printer size={13} /> {printingCal ? 'Printing…' : 'Print Calibration Sheet'}
              </button>
            </div>
          )}
        </div>

        {/* Right: live preview */}
        <div className="overflow-auto p-6 flex items-start justify-center" style={{ background: '#334155' }}>
          <div className="bg-white shadow-2xl flex-shrink-0" style={{ width: `${layout.page.w}mm` }}>
            {previewHtml ? (
              <iframe title="Invoice preview" srcDoc={previewHtml}
                style={{ width: `${layout.page.w}mm`, height: `${Math.max(layout.page.h, 100)}mm`, border: 'none', display: 'block' }} />
            ) : (
              <div className="p-10 text-center text-slate-400 text-sm">Loading preview…</div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
