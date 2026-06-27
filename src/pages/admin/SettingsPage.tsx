import { useState, useEffect } from 'react'
import type React from 'react'
import PageHeader from '@/components/shared/PageHeader'
import {
  Save, Building2, Barcode, ReceiptText, Printer, QrCode,
  Image as ImageIcon, Type, Ruler, Eye
} from 'lucide-react'
import toast from 'react-hot-toast'

type Tab = 'general' | 'barcode' | 'invoice'
type InvoiceDesignId = 'dot' | 'thermal' | 'a4'

const INVOICE_DESIGNS: { id: InvoiceDesignId; label: string; paper: string; description: string }[] = [
  { id: 'dot', label: 'Dot Matrix Bill', paper: 'dot_matrix', description: 'Continuous paper / dot matrix printer layout' },
  { id: 'thermal', label: 'Thermal Bill', paper: '80mm', description: '80mm / 58mm POS thermal printer layout' },
  { id: 'a4', label: 'A4 Bill', paper: 'A4', description: 'Full-page invoice for office printer / PDF' },
]

function defaultInvoiceDesign(prefix: InvoiceDesignId, name: string, paperType: string) {
  return {
    [`invoice_${prefix}_template_name`]: name,
    [`invoice_${prefix}_paper_type`]: paperType,
    [`invoice_${prefix}_logo_url`]: '',
    [`invoice_${prefix}_header_message`]: prefix === 'dot' ? 'SALES INVOICE' : 'Welcome to our store',
    [`invoice_${prefix}_footer_message`]: 'Thank you for shopping with us!',
    [`invoice_${prefix}_terms`]: 'Goods once sold will not be taken back or exchanged.',
    [`invoice_${prefix}_show_logo`]: prefix !== 'dot',
    [`invoice_${prefix}_show_company`]: true,
    [`invoice_${prefix}_show_branch`]: true,
    [`invoice_${prefix}_show_address`]: true,
    [`invoice_${prefix}_show_phone`]: true,
    [`invoice_${prefix}_show_tax_no`]: true,
    [`invoice_${prefix}_show_barcode`]: prefix !== 'dot',
    [`invoice_${prefix}_show_qr`]: prefix === 'a4',
    [`invoice_${prefix}_show_signature`]: prefix === 'a4',
    [`invoice_${prefix}_show_sku_column`]: true,
    [`invoice_${prefix}_show_discount_column`]: prefix !== 'dot',
    [`invoice_${prefix}_show_tax_column`]: prefix === 'a4',
  }
}

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>('general')
  const [form, setForm] = useState({
    company_name: 'Nature Plantation',
    company_address: '',
    company_phone: '',
    company_email: '',
    company_website: '',
    company_tin: '',
    invoice_note: 'Goods once sold will not be taken back or exchanged.',
    branch_name: '',
    currency: 'LKR',
    currency_symbol: 'Rs.',
    tax_label: 'VAT',
    receipt_header: '',
    receipt_footer: '',
    low_stock_threshold: 5,
    cloud_api_url: '',
    cloud_api_key: '',
    theme: 'dark',

    barcode_template_name: 'Default Product Label',
    barcode_format: 'EAN13',
    barcode_paper_size: 'A4',
    barcode_label_width: 48,
    barcode_label_height: 25,
    barcode_labels_per_row: 4,
    barcode_height: 42,
    barcode_margin: 3,
    barcode_product_font: 9,
    barcode_price_font: 11,
    barcode_show_company: true,
    barcode_show_product: true,
    barcode_show_sku: true,
    barcode_show_price: true,
    barcode_show_brand: true,
    barcode_sample_value: '4791234567890',
    barcode_company_x: 50,
    barcode_company_y: 8,
    barcode_product_x: 50,
    barcode_product_y: 24,
    barcode_code_x: 50,
    barcode_code_y: 48,
    barcode_number_x: 50,
    barcode_number_y: 72,
    barcode_sku_x: 18,
    barcode_sku_y: 88,
    barcode_brand_x: 50,
    barcode_brand_y: 88,
    barcode_price_x: 82,
    barcode_price_y: 88,

    invoice_template_name: 'Default Retail Invoice',
    invoice_paper_type: '80mm',
    invoice_logo_url: '',
    invoice_header_message: 'Welcome to our store',
    invoice_footer_message: 'Thank you for shopping with us!',
    invoice_terms: 'Goods once sold will not be taken back or exchanged.',
    invoice_show_logo: true,
    invoice_show_company: true,
    invoice_show_branch: true,
    invoice_show_address: true,
    invoice_show_phone: true,
    invoice_show_tax_no: true,
    invoice_show_barcode: true,
    invoice_show_qr: true,
    invoice_show_signature: false,
    invoice_show_sku_column: true,
    invoice_show_discount_column: true,
    invoice_show_tax_column: true,
    invoice_active_design: 'thermal',
    ...defaultInvoiceDesign('dot', 'Default Dot Matrix Bill', 'dot_matrix'),
    ...defaultInvoiceDesign('thermal', 'Default Thermal Bill', '80mm'),
    ...defaultInvoiceDesign('a4', 'Default A4 Invoice', 'A4'),
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    window.api.settings.get().then((res: any) => {
      if (res.success && res.data) setForm(f => ({ ...f, ...(res.data as object) }))
      setLoading(false)
    })
  }, [])

  const save = async () => {
    setSaving(true)
    const res = await window.api.settings.update(form)
    setSaving(false)
    if (res.success) toast.success('Settings saved')
    else toast.error(String(res.error || 'Settings save failed'))
  }

  const f = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(p => ({ ...p, [k]: e.target.type === 'number' ? parseFloat(e.target.value) || 0 : e.target.value }))

  const check = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(p => ({ ...p, [k]: e.target.checked }))

  if (loading) return <div className="flex items-center justify-center h-full text-slate-500">Loading...</div>

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader
        title="System Settings"
        subtitle="Company, barcode label, and invoice print layout configuration"
        actions={<button onClick={save} disabled={saving} className="btn-primary btn-sm gap-1.5"><Save size={14} />{saving ? 'Saving...' : 'Save Settings'}</button>}
      />

      <div className="flex border-b px-6 pt-4 gap-2 flex-shrink-0" style={{ borderColor: 'var(--border)' }}>
        <TabButton active={tab === 'general'} onClick={() => setTab('general')} icon={Building2} label="General" />
        <TabButton active={tab === 'barcode'} onClick={() => setTab('barcode')} icon={Barcode} label="Barcode Labels" />
        <TabButton active={tab === 'invoice'} onClick={() => setTab('invoice')} icon={ReceiptText} label="Invoice Layout" />
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {tab === 'general' && <GeneralSettings form={form} f={f} />}
        {tab === 'barcode' && <BarcodeDesigner form={form} setForm={setForm} f={f} check={check} />}
        {tab === 'invoice' && <InvoiceDesigner form={form} f={f} check={check} />}
      </div>
    </div>
  )
}

function TabButton({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: typeof Save; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2.5 rounded-t-lg text-sm font-semibold border border-b-0 transition-colors ${
        active ? 'bg-[var(--bg-card)] text-blue-500' : 'bg-transparent hover:bg-[var(--bg-soft)]'
      }`}
      style={{ borderColor: active ? 'var(--border)' : 'transparent', color: active ? undefined : 'var(--text-3)' }}
    >
      <Icon size={15} />
      {label}
    </button>
  )
}

function GeneralSettings({ form, f }: { form: Record<string, any>; f: (k: string) => (e: any) => void }) {
  return (
    <div className="space-y-6 max-w-3xl">
      <Section title="Company Information">
        <p className="text-xs -mt-1 mb-2" style={{ color: 'var(--text-3)' }}>Appears on printed invoices, barcode labels, and emailed invoices.</p>
        <Field label="Company Name"><input value={form.company_name} onChange={f('company_name')} className="input" placeholder="Nature Plantation" /></Field>
        <Field label="Address"><textarea value={form.company_address} onChange={f('company_address')} className="input h-16 resize-none" placeholder="No. 12, Main Street, Colombo 03" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Phone"><input value={form.company_phone} onChange={f('company_phone')} className="input" placeholder="+94 11 000 0000" /></Field>
          <Field label="Email"><input value={form.company_email} onChange={f('company_email')} className="input" placeholder="info@company.lk" /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Website"><input value={form.company_website} onChange={f('company_website')} className="input" placeholder="www.company.lk" /></Field>
          <Field label="TIN / Reg. No."><input value={form.company_tin} onChange={f('company_tin')} className="input" placeholder="VAT Reg / Business Reg" /></Field>
        </div>
        <Field label="Invoice Terms / Note"><input value={form.invoice_note} onChange={f('invoice_note')} className="input" /></Field>
      </Section>

      <Section title="Branch Settings">
        <Field label="Branch Name"><input value={form.branch_name} onChange={f('branch_name')} className="input" /></Field>
      </Section>

      <Section title="Currency & Tax">
        <div className="grid grid-cols-3 gap-3">
          <Field label="Currency Code"><input value={form.currency} onChange={f('currency')} className="input" placeholder="LKR" /></Field>
          <Field label="Symbol"><input value={form.currency_symbol} onChange={f('currency_symbol')} className="input" placeholder="Rs." /></Field>
          <Field label="Tax Label"><input value={form.tax_label} onChange={f('tax_label')} className="input" placeholder="VAT" /></Field>
        </div>
      </Section>

      <Section title="Thermal Receipt Defaults">
        <Field label="Header Text"><input value={form.receipt_header} onChange={f('receipt_header')} className="input" /></Field>
        <Field label="Footer Text"><textarea value={form.receipt_footer} onChange={f('receipt_footer')} className="input h-16 resize-none" /></Field>
      </Section>

      <Section title="Inventory">
        <Field label="Low Stock Alert Threshold">
          <input type="number" value={form.low_stock_threshold} onChange={f('low_stock_threshold')} className="input w-32" min="0" />
        </Field>
      </Section>

      <Section title="Self-Hosted Cloud Sync">
        <Field label="Cloud API URL"><input value={form.cloud_api_url} onChange={f('cloud_api_url')} className="input font-mono text-sm" placeholder="https://api.example.com" /></Field>
        <Field label="Cloud API Key"><input type="password" value={form.cloud_api_key} onChange={f('cloud_api_key')} className="input font-mono text-sm" /></Field>
      </Section>
    </div>
  )
}

function BarcodeDesigner({ form, setForm, f, check }: {
  form: Record<string, any>
  setForm: React.Dispatch<React.SetStateAction<any>>
  f: (k: string) => (e: any) => void
  check: (k: string) => (e: any) => void
}) {
  return (
    <div className="grid grid-cols-1 xl:grid-cols-[520px_1fr] gap-6">
      <div className="space-y-6">
        <Section title="Barcode Print Design">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Template Name"><input value={form.barcode_template_name} onChange={f('barcode_template_name')} className="input" /></Field>
            <Field label="Barcode Format">
              <select value={form.barcode_format} onChange={f('barcode_format')} className="input">
                <option value="EAN13">EAN13</option>
                <option value="Code128">Code128</option>
                <option value="UPC">UPC</option>
                <option value="QR">QR Code</option>
              </select>
            </Field>
            <Field label="Paper Size">
              <select value={form.barcode_paper_size} onChange={f('barcode_paper_size')} className="input">
                <option value="A4">A4 Sheet</option>
                <option value="Thermal">Thermal Roll</option>
                <option value="Custom">Custom</option>
              </select>
            </Field>
            <Field label="Labels Per Row"><input type="number" value={form.barcode_labels_per_row} onChange={f('barcode_labels_per_row')} className="input" min="1" max="6" /></Field>
            <Field label="Label Width (mm)"><input type="number" value={form.barcode_label_width} onChange={f('barcode_label_width')} className="input" min="20" /></Field>
            <Field label="Label Height (mm)"><input type="number" value={form.barcode_label_height} onChange={f('barcode_label_height')} className="input" min="12" /></Field>
            <Field label="Barcode Height (px)"><input type="number" value={form.barcode_height} onChange={f('barcode_height')} className="input" min="24" /></Field>
            <Field label="Margin (mm)"><input type="number" value={form.barcode_margin} onChange={f('barcode_margin')} className="input" min="0" /></Field>
            <Field label="Product Font"><input type="number" value={form.barcode_product_font} onChange={f('barcode_product_font')} className="input" min="7" /></Field>
            <Field label="Price Font"><input type="number" value={form.barcode_price_font} onChange={f('barcode_price_font')} className="input" min="8" /></Field>
            <Field label="Sample Barcode"><input value={form.barcode_sample_value} onChange={f('barcode_sample_value')} className="input font-mono" /></Field>
          </div>
        </Section>

        <Section title="Label Content">
          <div className="grid grid-cols-2 gap-3">
            <Check label="Company Name" checked={form.barcode_show_company} onChange={check('barcode_show_company')} />
            <Check label="Product Name" checked={form.barcode_show_product} onChange={check('barcode_show_product')} />
            <Check label="SKU" checked={form.barcode_show_sku} onChange={check('barcode_show_sku')} />
            <Check label="Price" checked={form.barcode_show_price} onChange={check('barcode_show_price')} />
            <Check label="Brand" checked={form.barcode_show_brand} onChange={check('barcode_show_brand')} />
          </div>
        </Section>

        <Section title="Drag & Drop Design">
          <p className="text-xs" style={{ color: 'var(--text-3)' }}>Drag items in the label preview to adjust product name, barcode, SKU, brand and amount positions.</p>
          <div className="grid grid-cols-3 gap-2 text-xs">
            {[
              ['Company', 'barcode_company_x', 'barcode_company_y'],
              ['Product', 'barcode_product_x', 'barcode_product_y'],
              ['Barcode', 'barcode_code_x', 'barcode_code_y'],
              ['Number', 'barcode_number_x', 'barcode_number_y'],
              ['SKU', 'barcode_sku_x', 'barcode_sku_y'],
              ['Brand', 'barcode_brand_x', 'barcode_brand_y'],
              ['Amount', 'barcode_price_x', 'barcode_price_y'],
            ].map(([label, xKey, yKey]) => (
              <div key={label} className="rounded-lg border p-2" style={{ borderColor: 'var(--border)' }}>
                <p className="font-semibold mb-1" style={{ color: 'var(--text-2)' }}>{label}</p>
                <div className="flex gap-1">
                  <input type="number" value={form[xKey]} onChange={f(xKey)} className="input py-1 text-xs" min="0" max="100" />
                  <input type="number" value={form[yKey]} onChange={f(yKey)} className="input py-1 text-xs" min="0" max="100" />
                </div>
              </div>
            ))}
          </div>
        </Section>
      </div>

      <PreviewPanel title="Barcode Label Preview" onPrint={() => window.print()}>
        <div className="bg-white text-black rounded-lg p-5 overflow-auto">
          <div
            className="grid gap-2"
            style={{ gridTemplateColumns: `repeat(${Math.max(1, Number(form.barcode_labels_per_row) || 1)}, minmax(0, 1fr))` }}
          >
            {Array.from({ length: Math.min(12, Math.max(1, Number(form.barcode_labels_per_row) || 1) * 3) }).map((_, i) => (
              <BarcodeLabel key={i} form={form} setForm={i === 0 ? setForm : undefined} />
            ))}
          </div>
        </div>
      </PreviewPanel>
    </div>
  )
}

function InvoiceDesigner({ form, f, check }: { form: Record<string, any>; f: (k: string) => (e: any) => void; check: (k: string) => (e: any) => void }) {
  const [design, setDesign] = useState<InvoiceDesignId>((form.invoice_active_design as InvoiceDesignId) || 'thermal')
  const prefix = `invoice_${design}_`
  const k = (field: string) => `${prefix}${field}`
  const activeMeta = INVOICE_DESIGNS.find(d => d.id === design)!

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[520px_1fr] gap-6">
      <div className="space-y-6">
        <Section title="Bill Type">
          <div className="grid grid-cols-3 gap-2">
            {INVOICE_DESIGNS.map(item => (
              <button
                key={item.id}
                onClick={() => setDesign(item.id)}
                className={`rounded-lg border p-3 text-left transition-colors ${design === item.id ? 'border-blue-500 bg-blue-500/10' : 'hover:bg-[var(--bg-soft)]'}`}
                style={{ borderColor: design === item.id ? undefined : 'var(--border)' }}
              >
                <p className="text-sm font-semibold" style={{ color: design === item.id ? '#60a5fa' : 'var(--text-1)' }}>{item.label}</p>
                <p className="text-[11px] mt-1" style={{ color: 'var(--text-3)' }}>{item.description}</p>
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 rounded-lg border px-3 py-2 mt-3 cursor-pointer" style={{ borderColor: 'var(--border)' }}>
            <input
              type="radio"
              checked={form.invoice_active_design === design}
              onChange={() => {
                f('invoice_active_design')({ target: { type: 'text', value: design } })
              }}
              className="w-4 h-4 accent-blue-600"
            />
            <span className="text-sm" style={{ color: 'var(--text-2)' }}>Use {activeMeta.label} as default print design</span>
          </label>
        </Section>

        <Section title={`${activeMeta.label} Designer`}>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Template Name"><input value={form[k('template_name')]} onChange={f(k('template_name'))} className="input" /></Field>
            <Field label="Paper Type">
              <select value={form[k('paper_type')]} onChange={f(k('paper_type'))} className="input">
                {design === 'dot' && <option value="dot_matrix">Dot Matrix Continuous</option>}
                <option value="80mm">80mm Thermal</option>
                <option value="58mm">58mm Thermal</option>
                <option value="A4">A4</option>
                <option value="A5">A5</option>
              </select>
            </Field>
            <Field label="Logo URL"><input value={form[k('logo_url')]} onChange={f(k('logo_url'))} className="input" placeholder="Optional logo image URL" /></Field>
            <Field label="Header Message"><input value={form[k('header_message')]} onChange={f(k('header_message'))} className="input" /></Field>
          </div>
          <Field label="Footer Message"><input value={form[k('footer_message')]} onChange={f(k('footer_message'))} className="input" /></Field>
          <Field label="Terms and Conditions"><textarea value={form[k('terms')]} onChange={f(k('terms'))} className="input h-20 resize-none" /></Field>
        </Section>

        <Section title="Invoice Elements">
          <div className="grid grid-cols-2 gap-3">
            <Check label="Logo" checked={Boolean(form[k('show_logo')])} onChange={check(k('show_logo'))} />
            <Check label="Company Name" checked={Boolean(form[k('show_company')])} onChange={check(k('show_company'))} />
            <Check label="Branch Name" checked={Boolean(form[k('show_branch')])} onChange={check(k('show_branch'))} />
            <Check label="Address" checked={Boolean(form[k('show_address')])} onChange={check(k('show_address'))} />
            <Check label="Phone" checked={Boolean(form[k('show_phone')])} onChange={check(k('show_phone'))} />
            <Check label="Tax Number" checked={Boolean(form[k('show_tax_no')])} onChange={check(k('show_tax_no'))} />
            <Check label="Invoice Barcode" checked={Boolean(form[k('show_barcode')])} onChange={check(k('show_barcode'))} />
            <Check label="QR Code" checked={Boolean(form[k('show_qr')])} onChange={check(k('show_qr'))} />
            <Check label="Signature Area" checked={Boolean(form[k('show_signature')])} onChange={check(k('show_signature'))} />
            <Check label="SKU Column" checked={Boolean(form[k('show_sku_column')])} onChange={check(k('show_sku_column'))} />
            <Check label="Discount Column" checked={Boolean(form[k('show_discount_column')])} onChange={check(k('show_discount_column'))} />
            <Check label="Tax Column" checked={Boolean(form[k('show_tax_column')])} onChange={check(k('show_tax_column'))} />
          </div>
        </Section>
      </div>

      <PreviewPanel title="Invoice Live Preview" onPrint={() => window.print()}>
        <InvoicePreview form={form} design={design} />
      </PreviewPanel>
    </div>
  )
}

function BarcodeLabel({ form, setForm }: { form: Record<string, any>; setForm?: React.Dispatch<React.SetStateAction<any>> }) {
  const width = Number(form.barcode_label_width) || 48
  const height = Number(form.barcode_label_height) || 25
  const margin = Number(form.barcode_margin) || 3
  const move = (xKey: string, yKey: string) => (e: React.DragEvent<HTMLDivElement>) => {
    if (!setForm) return
    const rect = e.currentTarget.parentElement?.getBoundingClientRect()
    if (!rect) return
    const x = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100))
    const y = Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100))
    setForm((prev: any) => ({ ...prev, [xKey]: Math.round(x), [yKey]: Math.round(y) }))
  }
  const itemStyle = (x: number, y: number): React.CSSProperties => ({
    position: 'absolute',
    left: `${x}%`,
    top: `${y}%`,
    transform: 'translate(-50%, -50%)',
    cursor: setForm ? 'move' : 'default',
    maxWidth: '92%',
  })
  const dragProps = (xKey: string, yKey: string) => ({
    draggable: Boolean(setForm),
    onDragEnd: move(xKey, yKey),
  })
  return (
    <div
      className="relative border border-dashed border-slate-400 bg-white text-black overflow-hidden"
      style={{ width: `${width}mm`, minHeight: `${height}mm`, padding: `${margin}mm` }}
    >
      {form.barcode_show_company && <div {...dragProps('barcode_company_x', 'barcode_company_y')} className="font-bold leading-none text-center whitespace-nowrap" style={{ ...itemStyle(Number(form.barcode_company_x), Number(form.barcode_company_y)), fontSize: 8 }}>{form.company_name || 'Company Name'}</div>}
      {form.barcode_show_product && <div {...dragProps('barcode_product_x', 'barcode_product_y')} className="font-semibold leading-tight text-center truncate" style={{ ...itemStyle(Number(form.barcode_product_x), Number(form.barcode_product_y)), fontSize: Number(form.barcode_product_font) || 9 }}>Sample Product</div>}
      <div {...dragProps('barcode_code_x', 'barcode_code_y')} style={{ ...itemStyle(Number(form.barcode_code_x), Number(form.barcode_code_y)), width: '78%' }}>
        {form.barcode_format === 'QR' ? <QrPreview /> : <BarcodeSvg value={String(form.barcode_sample_value || '4791234567890')} height={Number(form.barcode_height) || 42} />}
      </div>
      <div {...dragProps('barcode_number_x', 'barcode_number_y')} className="font-mono leading-none whitespace-nowrap" style={{ ...itemStyle(Number(form.barcode_number_x), Number(form.barcode_number_y)), fontSize: 8 }}>{form.barcode_sample_value || '4791234567890'}</div>
      {form.barcode_show_sku && <div {...dragProps('barcode_sku_x', 'barcode_sku_y')} className="font-mono truncate" style={{ ...itemStyle(Number(form.barcode_sku_x), Number(form.barcode_sku_y)), fontSize: 7 }}>SKU-001</div>}
      {form.barcode_show_brand && <div {...dragProps('barcode_brand_x', 'barcode_brand_y')} className="truncate" style={{ ...itemStyle(Number(form.barcode_brand_x), Number(form.barcode_brand_y)), fontSize: 7 }}>Brand</div>}
      {form.barcode_show_price && <div {...dragProps('barcode_price_x', 'barcode_price_y')} className="font-bold whitespace-nowrap" style={{ ...itemStyle(Number(form.barcode_price_x), Number(form.barcode_price_y)), fontSize: Number(form.barcode_price_font) || 11 }}>Rs.1,250</div>}
    </div>
  )
}

function BarcodeSvg({ value, height }: { value: string; height: number }) {
  const chars = value.split('')
  const totalWidth = Math.max(160, chars.length * 12)
  let x = 0
  const bars = chars.flatMap((ch, index) => {
    const n = ch.charCodeAt(0)
    const parts = [1 + (n % 3), 1, 2 + (index % 2), 1]
    return parts.map((w, i) => {
      const currentX = x
      x += w + 1
      return i % 2 === 0 ? <rect key={`${index}-${i}`} x={currentX} y="0" width={w} height={height} fill="#111827" /> : null
    })
  })
  return (
    <svg width="100%" height={height} viewBox={`0 0 ${totalWidth} ${height}`} preserveAspectRatio="none" aria-label="Barcode preview">
      {bars}
    </svg>
  )
}

function QrPreview() {
  return (
    <div className="grid grid-cols-7 gap-[1px] w-14 h-14 my-1">
      {Array.from({ length: 49 }).map((_, i) => (
        <span key={i} className={(i * 7 + i) % 5 < 3 || [0,1,2,7,14,42,43,44,35,28,4,5,6,13,20].includes(i) ? 'bg-black' : 'bg-white'} />
      ))}
    </div>
  )
}

function designValue(form: Record<string, any>, design: InvoiceDesignId, field: string, fallback?: unknown) {
  return form[`invoice_${design}_${field}`] ?? form[`invoice_${field}`] ?? fallback
}

function InvoicePreview({ form, design }: { form: Record<string, any>; design: InvoiceDesignId }) {
  const paperType = String(designValue(form, design, 'paper_type', design === 'dot' ? 'dot_matrix' : design === 'a4' ? 'A4' : '80mm'))
  const thermal = paperType === '80mm' || paperType === '58mm'
  const dot = paperType === 'dot_matrix'
  const show = (field: string, fallback = true) => Boolean(designValue(form, design, field, fallback))
  return (
    <div className="bg-slate-200 p-5 rounded-lg overflow-auto">
      <div className={`bg-white text-black mx-auto shadow-lg ${dot ? 'p-4 font-mono' : 'p-5'}`} style={{ width: dot ? 720 : thermal ? (paperType === '58mm' ? 220 : 302) : 620 }}>
        <div className={`text-center border-b border-slate-300 pb-3 ${dot ? 'border-dashed' : ''}`}>
          {show('show_logo') && (
            <div className="mx-auto mb-2 w-12 h-12 rounded border border-slate-300 flex items-center justify-center overflow-hidden">
              {designValue(form, design, 'logo_url') ? <img src={String(designValue(form, design, 'logo_url'))} className="w-full h-full object-cover" alt="" /> : <ImageIcon size={18} />}
            </div>
          )}
          {show('show_company') && <h2 className="font-bold text-lg">{form.company_name || 'Company Name'}</h2>}
          {show('show_branch') && <p className="text-xs">{form.branch_name || 'Main Branch'}</p>}
          {show('show_address') && <p className="text-xs">{form.company_address || 'Company address'}</p>}
          {show('show_phone') && <p className="text-xs">{form.company_phone || '+94 11 000 0000'}</p>}
          {show('show_tax_no') && <p className="text-xs">Tax No: {form.company_tin || 'TIN-0000'}</p>}
          <p className="text-xs mt-2">{String(designValue(form, design, 'header_message', ''))}</p>
        </div>

        <div className="py-3 text-xs grid grid-cols-2 gap-2 border-b border-slate-300">
          <span>Invoice No: MAIN-INV-2026-0062</span>
          <span className="text-right">Date: 27/06/2026</span>
          <span>Customer: Walk-in</span>
          <span className="text-right">Cashier: System Admin</span>
        </div>

        <table className="w-full text-xs my-3">
          <thead>
            <tr className="border-b border-slate-300">
              <th className="text-left py-1">Item</th>
              {show('show_sku_column') && <th className="text-left py-1">SKU</th>}
              <th className="text-right py-1">Qty</th>
              <th className="text-right py-1">Price</th>
              {show('show_discount_column') && <th className="text-right py-1">Disc</th>}
              {show('show_tax_column') && <th className="text-right py-1">Tax</th>}
              <th className="text-right py-1">Total</th>
            </tr>
          </thead>
          <tbody>
            {[
              ['Kids Chair', 'SAM-CH-TR-6565', '1', '6,000', '0', '0', '6,000'],
              ['Electric cooker', 'TAT-COOK-tr-0052', '1', '15,000', '0', '0', '15,000'],
            ].map(row => (
              <tr key={row[1]} className="border-b border-slate-200">
                <td className="py-1">{row[0]}</td>
                {show('show_sku_column') && <td className="py-1">{row[1]}</td>}
                <td className="py-1 text-right">{row[2]}</td>
                <td className="py-1 text-right">{row[3]}</td>
                {show('show_discount_column') && <td className="py-1 text-right">{row[4]}</td>}
                {show('show_tax_column') && <td className="py-1 text-right">{row[5]}</td>}
                <td className="py-1 text-right font-semibold">{row[6]}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="ml-auto w-48 text-xs space-y-1">
          <div className="flex justify-between"><span>Subtotal</span><span>Rs.21,000</span></div>
          <div className="flex justify-between"><span>Discount</span><span>Rs.0</span></div>
          <div className="flex justify-between font-bold text-base border-t border-slate-300 pt-1"><span>Total</span><span>Rs.21,000</span></div>
        </div>

        <div className="text-center text-xs mt-5 border-t border-slate-300 pt-3">
          {show('show_barcode') && <BarcodeSvg value="MAIN-INV-2026-0062" height={34} />}
          {show('show_qr') && <div className="flex justify-center"><QrPreview /></div>}
          {show('show_signature') && <div className="mt-6 border-t border-slate-400 w-40 mx-auto pt-1">Authorized Signature</div>}
          <p className="font-semibold mt-2">{String(designValue(form, design, 'footer_message', ''))}</p>
          <p className="mt-1">{String(designValue(form, design, 'terms', ''))}</p>
        </div>
      </div>
    </div>
  )
}

function PreviewPanel({ title, children, onPrint }: { title: string; children: React.ReactNode; onPrint: () => void }) {
  return (
    <div className="card h-fit sticky top-4">
      <div className="flex items-center justify-between gap-3 mb-4">
        <h3 className="font-semibold text-sm flex items-center gap-2" style={{ color: 'var(--text-1)' }}><Eye size={15} /> {title}</h3>
        <button onClick={onPrint} className="btn-secondary btn-sm gap-1.5"><Printer size={14} /> Print Preview</button>
      </div>
      {children}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card space-y-4">
      <h3 className="font-semibold text-sm pb-3 flex items-center gap-2" style={{ color: 'var(--text-2)', borderBottom: '1px solid var(--border)' }}>
        <Ruler size={14} /> {title}
      </h3>
      {children}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-3)' }}>{label}</label>
      {children}
    </div>
  )
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void }) {
  return (
    <label className="flex items-center gap-2 rounded-lg border px-3 py-2 cursor-pointer" style={{ borderColor: 'var(--border)', color: 'var(--text-2)' }}>
      <input type="checkbox" checked={checked} onChange={onChange} className="w-4 h-4 accent-blue-600" />
      <span className="text-sm">{label}</span>
    </label>
  )
}
