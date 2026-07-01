import { useState, useEffect } from 'react'
import type React from 'react'
import { useNavigate } from 'react-router-dom'
import PageHeader from '@/components/shared/PageHeader'
import {
  Save, Building2, Barcode, ReceiptText, Printer,
  Image as ImageIcon, Ruler, Eye, Shield, Cloud, RefreshCw,
  Mail, MessageSquare, Phone, AlertTriangle, X
} from 'lucide-react'
import toast from 'react-hot-toast'
import { applySystemTheme } from '@/lib/systemTheme'
import { useAuthStore } from '@/store/authStore'

type Tab = 'general' | 'branding' | 'security' | 'sync' | 'barcode' | 'invoice' | 'communications' | 'loyalty' | 's3' | 'danger'
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
    email_enabled: false,
    smtp_host: '',
    smtp_port: 587,
    smtp_encryption: 'TLS',
    smtp_username: '',
    smtp_password: '',
    smtp_from_email: '',
    smtp_from_name: '',
    smtp_reply_to: '',
    sms_enabled: false,
    sms_provider_name: '',
    sms_api_base_url: '',
    sms_api_key: '',
    sms_api_secret: '',
    sms_sender_id: '',
    sms_http_method: 'POST',
    sms_content_type: 'application/json',
    sms_custom_headers: '',
    sms_body_template: '{"mobile":"{phone}","message":"{message}","otp":"{otp}"}',
    whatsapp_enabled: false,
    whatsapp_provider: 'meta',
    whatsapp_phone_number_id: '',
    whatsapp_access_token: '',
    whatsapp_twilio_sid: '',
    whatsapp_twilio_token: '',
    whatsapp_from_number: '',
    company_logo_url: '',
    login_logo_url: '',
    pos_bill_logo_url: '',
    invoice_logo_url: '',
    favicon_url: '',
    footer_text: '',
    db_type: 'PostgreSQL',
    db_host: '',
    db_port: 5432,
    db_name: '',
    db_username: '',
    db_password: '',
    db_ssl_enabled: true,
    db_region: '',
    session_timeout_minutes: 30,
    password_min_length: 8,
    password_require_uppercase: true,
    password_require_number: true,
    password_require_symbol: false,
    two_factor_enabled: false,
    ip_restrictions: '',
    offline_sync_enabled: true,
    sync_interval_minutes: 5,
    failed_sync_retry_minutes: 10,
    backup_schedule: 'daily',
    backup_destination: 'local',
    backup_retention: 10,

    // S3 Storage
    s3_enabled: false,
    s3_bucket: '',
    s3_region: 'us-east-1',
    s3_access_key: '',
    s3_secret_key: '',
    s3_endpoint: '',
    s3_cdn_url: '',

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
  const [isActivated, setIsActivated] = useState(false)
  const [showClearAll, setShowClearAll] = useState(false)
  const [clearConfirmText, setClearConfirmText] = useState('')
  const [clearing, setClearing] = useState(false)
  const { logout } = useAuthStore()
  const navigate = useNavigate()

  useEffect(() => {
    Promise.all([
      window.api.settings.get(),
      window.api.app.isActivated(),
    ]).then(([res, activated]: [any, boolean]) => {
      if (res.success && res.data) setForm(f => ({ ...f, ...(res.data as object) }))
      setIsActivated(Boolean(activated))
      setLoading(false)
    })
  }, [])

  const save = async () => {
    setSaving(true)
    const res = await window.api.settings.update(form)
    setSaving(false)
    if (res.success) {
      applySystemTheme(form)
      toast.success('Settings saved')
    }
    else toast.error(String(res.error || 'Settings save failed'))
  }

  const f = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(p => ({ ...p, [k]: e.target.type === 'number' ? parseFloat(e.target.value) || 0 : e.target.value }))

  const check = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(p => ({ ...p, [k]: e.target.checked }))

  const handleClearAllData = async () => {
    if (clearConfirmText !== 'DELETE ALL') return
    setClearing(true)
    try {
      const res = await window.api.admin.clearAllData() as { success: boolean; error?: string }
      if (res.success) {
        toast.success('All data cleared. Starting setup wizard...')
        setShowClearAll(false)
        setClearConfirmText('')
        setTimeout(async () => { await logout(); navigate('/setup', { replace: true }) }, 1200)
      } else {
        toast.error(res.error || 'Failed to clear data')
      }
    } catch (err) {
      toast.error('Failed: ' + String(err))
    } finally {
      setClearing(false)
    }
  }

  if (loading) return <div className="flex items-center justify-center h-full text-slate-500">Loading...</div>

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader
        title="System Settings"
        subtitle="Company, barcode label, and invoice print layout configuration"
        actions={<button onClick={save} disabled={saving} className="btn-primary btn-sm gap-1.5"><Save size={14} />{saving ? 'Saving...' : 'Save Settings'}</button>}
      />

      <div className="flex flex-wrap border-b px-6 pt-4 gap-1 flex-shrink-0" style={{ borderColor: 'var(--border)' }}>
        <TabButton active={tab === 'general'} onClick={() => setTab('general')} icon={Building2} label="General" />
        <TabButton active={tab === 'branding'} onClick={() => setTab('branding')} icon={ImageIcon} label="Branding" />
        <TabButton active={tab === 'security'} onClick={() => setTab('security')} icon={Shield} label="Security" />
        <TabButton active={tab === 'sync'} onClick={() => setTab('sync')} icon={Cloud} label="Cloud Sync" />
        <TabButton active={tab === 'barcode'} onClick={() => setTab('barcode')} icon={Barcode} label="Barcode Labels" />
        <TabButton active={tab === 'invoice'} onClick={() => setTab('invoice')} icon={ReceiptText} label="Invoice Layout" />
        <TabButton active={tab === 'communications'} onClick={() => setTab('communications')} icon={Mail} label="Communications" />
        <TabButton active={tab === 'loyalty'} onClick={() => setTab('loyalty')} icon={Phone} label="Loyalty" />
        <TabButton active={tab === 's3'} onClick={() => setTab('s3')} icon={Cloud} label="S3 Storage" />
        <TabButton active={tab === 'danger'} onClick={() => setTab('danger')} icon={AlertTriangle} label="Danger Zone" labelClass="text-red-400" />
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {tab === 'general' && <GeneralSettings form={form} f={f} setForm={setForm} />}
        {tab === 'branding' && <BrandingSettings form={form} f={f} />}
        {tab === 'security' && <SecuritySettings form={form} f={f} check={check} />}
        {tab === 'sync' && <SyncSettings form={form} f={f} check={check} isActivated={isActivated} />}
        {tab === 'barcode' && <BarcodeDesigner form={form} setForm={setForm} f={f} check={check} />}
        {tab === 'invoice' && <InvoiceDesigner form={form} f={f} check={check} />}
        {tab === 'communications' && <CommunicationsSettings form={form} f={f} check={check} />}
        {tab === 'loyalty'        && <LoyaltySettings />}
        {tab === 's3'             && <S3Settings form={form} f={f} check={check} />}
        {tab === 'danger' && (
          <div className="max-w-xl space-y-4">
            <div className="rounded-xl p-5" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
              {/* Header */}
              <div className="flex items-center gap-3 mb-5 pb-4" style={{ borderBottom: '1px solid var(--border)' }}>
                <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
                  style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)' }}>
                  <AlertTriangle size={20} className="text-red-400" />
                </div>
                <div>
                  <h3 className="font-bold text-base" style={{ color: 'var(--text-1)' }}>Clear All Data</h3>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>Permanently wipe all data and reset to factory state</p>
                </div>
              </div>

              {/* Two columns: delete / keep */}
              <div className="grid grid-cols-2 gap-3 mb-5">
                <div className="rounded-lg p-3 space-y-1.5" style={{ background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.15)' }}>
                  <p className="text-xs font-semibold uppercase tracking-wider mb-2 text-red-400">Will be deleted</p>
                  {['All Products','All Invoices','All Transactions','All Customers','All Payments','All Stock Records','Purchase Orders','All Expenses','Branches','Categories & Suppliers','All Users & Roles','Sync Queue'].map(item => (
                    <div key={item} className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-2)' }}>
                      <X size={10} className="text-red-500 flex-shrink-0" /> {item}
                    </div>
                  ))}
                </div>
                <div className="rounded-lg p-3 space-y-1.5" style={{ background: 'rgba(34,197,94,0.07)', border: '1px solid rgba(34,197,94,0.15)' }}>
                  <p className="text-xs font-semibold uppercase tracking-wider mb-2 text-green-400">Will be kept</p>
                  <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-2)' }}>
                    <span className="text-green-400 flex-shrink-0">✓</span> Settings & Configuration
                  </div>
                  <div className="mt-3 rounded p-2 text-xs" style={{ background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.2)' }}>
                    <p className="text-blue-400 font-semibold mb-1">After clearing:</p>
                    <p style={{ color: 'var(--text-2)' }}>You will be redirected to the <span className="text-blue-300 font-semibold">Setup Wizard</span> to create a new admin account with custom credentials.</p>
                  </div>
                </div>
              </div>

              <button
                onClick={() => { setShowClearAll(true); setClearConfirmText('') }}
                className="px-5 py-2.5 rounded-lg text-sm font-semibold transition-colors"
                style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.35)', color: '#f87171' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(239,68,68,0.2)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'rgba(239,68,68,0.12)')}
              >
                Clear All Data...
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Clear All Data Confirmation Modal */}
      {showClearAll && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}>
          <div className="card w-full max-w-md" style={{ border: '2px solid #dc2626' }}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center flex-shrink-0">
                <AlertTriangle size={20} className="text-red-400" />
              </div>
              <div>
                <h3 className="font-bold text-lg text-red-400">Confirm Clear All Data</h3>
                <p className="text-xs text-slate-400">This cannot be undone</p>
              </div>
            </div>

            <div className="mb-4">
              <label className="block text-xs font-semibold text-slate-400 mb-1.5">
                Type <span className="text-red-400 font-mono">DELETE ALL</span> to confirm
              </label>
              <input
                value={clearConfirmText}
                onChange={e => setClearConfirmText(e.target.value)}
                className="input font-mono"
                placeholder="DELETE ALL"
                autoFocus
              />
            </div>

            <div className="flex gap-2 justify-end">
              <button onClick={() => { setShowClearAll(false); setClearConfirmText('') }} className="btn-secondary btn-sm">Cancel</button>
              <button
                onClick={handleClearAllData}
                disabled={clearing || clearConfirmText !== 'DELETE ALL'}
                className="btn-sm px-4 py-2 rounded-lg text-white text-sm font-semibold disabled:opacity-40"
                style={{ background: 'linear-gradient(135deg,#dc2626,#991b1b)' }}>
                {clearing ? 'Clearing...' : 'Clear All Data'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function TabButton({ active, onClick, icon: Icon, label, labelClass }: { active: boolean; onClick: () => void; icon: typeof Save; label: string; labelClass?: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-3 py-2.5 rounded-t-lg text-sm font-semibold border border-b-0 transition-colors shrink-0 whitespace-nowrap ${
        active ? 'bg-[var(--bg-card)] text-blue-500' : 'bg-transparent hover:bg-[var(--bg-soft)]'
      } ${labelClass || ''}`}
      style={{ borderColor: active ? 'var(--border)' : 'transparent', color: active ? undefined : 'var(--text-3)' }}
    >
      <Icon size={15} />
      <span className={labelClass}>{label}</span>
    </button>
  )
}

function GeneralSettings({ form, f, setForm }: { form: Record<string, any>; f: (k: string) => (e: any) => void; setForm: React.Dispatch<React.SetStateAction<any>> }) {
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

      <Section title="Theme Mode">
        <Field label="System Theme">
          <select
            value={form.theme}
            onChange={e => {
              const theme = e.target.value
              setForm((p: Record<string, any>) => ({ ...p, theme }))
              applySystemTheme({ ...form, theme })
            }}
            className="input max-w-xs"
          >
            <option value="dark">Dark Theme</option>
            <option value="light">Light Theme</option>
          </select>
        </Field>
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
        <p className="text-xs" style={{ color: 'var(--text-3)' }}>API key is managed by your platform administrator. Contact them to get your API key and paste it during POS device setup.</p>
      </Section>
    </div>
  )
}

function LogoUploadField({
  label, value, onChange,
}: {
  label: string
  value: string
  onChange: (url: string) => void
}) {
  const [uploading, setUploading] = useState(false)

  const handleUpload = async () => {
    setUploading(true)
    try {
      const res = await window.api.products.selectAndUploadImage() as { success: boolean; data?: string; error?: string }
      if (res.success && res.data) {
        onChange(res.data)
        toast.success('Logo uploaded')
      } else if (res.error && res.error !== 'Cancelled') {
        toast.error(res.error)
      }
    } finally { setUploading(false) }
  }

  return (
    <div className="space-y-2">
      <label className="label">{label}</label>
      <div className="flex gap-2 items-center">
        {/* Preview */}
        <div className="w-12 h-12 rounded-xl flex-shrink-0 flex items-center justify-center overflow-hidden"
          style={{ background: 'var(--bg-soft)', border: '1px solid var(--border)' }}>
          {value
            ? <img src={value} alt="logo" className="w-full h-full object-contain" onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
            : <ImageIcon size={18} style={{ color: 'var(--text-3)' }} />}
        </div>
        {/* URL input */}
        <input
          value={value}
          onChange={e => onChange(e.target.value)}
          className="input flex-1 text-xs font-mono"
          placeholder="https://... or click Upload to pick a file"
        />
        {/* Upload button */}
        <button
          type="button"
          onClick={handleUpload}
          disabled={uploading}
          className="btn-secondary btn-sm gap-1.5 flex-shrink-0 whitespace-nowrap"
        >
          <ImageIcon size={13} />
          {uploading ? 'Uploading…' : 'Upload'}
        </button>
        {/* Clear */}
        {value && (
          <button type="button" onClick={() => onChange('')}
            className="btn-ghost btn-sm text-red-400 flex-shrink-0 px-2">✕</button>
        )}
      </div>
    </div>
  )
}

function BrandingSettings({ form, f }: { form: Record<string, any>; f: (k: string) => (e: any) => void }) {
  const setField = (key: string) => (url: string) => {
    f(key)({ target: { value: url, type: 'text' } } as any)
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <Section title="Brand Assets">
        <div className="rounded-lg px-4 py-3 text-sm mb-2"
          style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)', color: '#818cf8' }}>
          Upload a logo file from your computer, or paste a URL (https://...).
          Uploaded files are stored locally and sync to cloud automatically.
        </div>
        <LogoUploadField label="Company Logo"     value={form.company_logo_url}   onChange={setField('company_logo_url')} />
        <LogoUploadField label="Login Page Logo"  value={form.login_logo_url}     onChange={setField('login_logo_url')} />
        <LogoUploadField label="POS Bill Logo"    value={form.pos_bill_logo_url}  onChange={setField('pos_bill_logo_url')} />
        <LogoUploadField label="Invoice Logo"     value={form.invoice_logo_url}   onChange={setField('invoice_logo_url')} />
        <Field label="Favicon URL">
          <input value={form.favicon_url} onChange={f('favicon_url')} className="input" placeholder="https://..." />
        </Field>
      </Section>
      <Section title="Company Footer">
        <Field label="Footer Text">
          <textarea value={form.footer_text} onChange={f('footer_text')} className="input h-20 resize-none" />
        </Field>
      </Section>
    </div>
  )
}


function SecuritySettings({ form, f, check }: { form: Record<string, any>; f: (k: string) => (e: any) => void; check: (k: string) => (e: any) => void }) {
  return (
    <div className="space-y-6 max-w-3xl">
      <Section title="Authentication Policy">
        <Check label="Enable Two-Factor Authentication" checked={Boolean(form.two_factor_enabled)} onChange={check('two_factor_enabled')} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Session Timeout (minutes)"><input type="number" value={form.session_timeout_minutes} onChange={f('session_timeout_minutes')} className="input" min="5" /></Field>
          <Field label="Minimum Password Length"><input type="number" value={form.password_min_length} onChange={f('password_min_length')} className="input" min="6" /></Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Check label="Uppercase Required" checked={Boolean(form.password_require_uppercase)} onChange={check('password_require_uppercase')} />
          <Check label="Number Required" checked={Boolean(form.password_require_number)} onChange={check('password_require_number')} />
          <Check label="Symbol Required" checked={Boolean(form.password_require_symbol)} onChange={check('password_require_symbol')} />
        </div>
      </Section>
      <Section title="IP Restrictions">
        <Field label="Allowed IPs / CIDR">
          <textarea value={form.ip_restrictions} onChange={f('ip_restrictions')} className="input h-24 resize-none font-mono text-sm" placeholder="192.168.1.0/24&#10;203.0.113.10" />
        </Field>
      </Section>
    </div>
  )
}

function SyncSettings({ form, f, check, isActivated }: { form: Record<string, any>; f: (k: string) => (e: any) => void; check: (k: string) => (e: any) => void; isActivated: boolean }) {
  const navigate = useNavigate()

  const handleReactivate = async () => {
    if (!confirm('This will clear the current activation and show the activation screen. Continue?')) return
    await window.api.app.deactivate()
    navigate('/activate')
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <Section title="Cloud Sync">
        <p className="text-xs -mt-1 mb-2" style={{ color: 'var(--text-3)' }}>
          This POS connects to the cloud backend to sync sales, stock, and customer data in real time.
        </p>

        {isActivated && form.cloud_api_url && (
          <div className="rounded-lg border px-4 py-3 mb-3 flex items-start gap-3" style={{ borderColor: 'var(--brand-primary)', background: 'color-mix(in srgb, var(--brand-primary) 8%, transparent)' }}>
            <Shield size={14} className="mt-0.5 flex-shrink-0" style={{ color: 'var(--brand-primary)' }} />
            <div className="text-xs" style={{ color: 'var(--text-2)' }}>
              <strong>Device is activated.</strong> The server URL is locked by your platform administrator.
              Use <em>Re-activate Device</em> below to connect to a different server.
            </div>
          </div>
        )}

        <Check label="Enable Offline Sync" checked={Boolean(form.offline_sync_enabled)} onChange={check('offline_sync_enabled')} />
        <div className="grid grid-cols-2 gap-3 mt-2">
          <Field label="Cloud API URL">
            <input
              value={form.cloud_api_url}
              onChange={f('cloud_api_url')}
              className="input font-mono text-sm"
              placeholder="https://api.example.com"
              readOnly={isActivated && Boolean(form.cloud_api_url)}
              style={isActivated && form.cloud_api_url ? { opacity: 0.6, cursor: 'not-allowed' } : {}}
            />
          </Field>
          <Field label="Sync Interval (minutes)">
            <input type="number" value={form.sync_interval_minutes} onChange={f('sync_interval_minutes')} className="input" min="1" />
          </Field>
          <Field label="Failed Retry (minutes)">
            <input type="number" value={form.failed_sync_retry_minutes} onChange={f('failed_sync_retry_minutes')} className="input" min="1" />
          </Field>
        </div>
        <div className="mt-3 rounded-lg border px-4 py-3 text-xs" style={{ borderColor: 'var(--border)', color: 'var(--text-3)', background: 'var(--bg-soft)' }}>
          <strong style={{ color: 'var(--text-2)' }}>API Key</strong> — managed by your platform administrator.
          {!isActivated && <> To activate this POS device, complete the activation flow from the login screen.</>}
        </div>
        <div className="mt-4 pt-4 border-t" style={{ borderColor: 'var(--border)' }}>
          <button
            type="button"
            onClick={handleReactivate}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/20 transition-colors border border-yellow-500/30"
          >
            <RefreshCw size={14} />
            Re-activate Device
          </button>
          <p className="text-xs mt-1.5" style={{ color: 'var(--text-3)' }}>
            Use this to connect to a different server or if activation shows "pending" in the admin portal.
          </p>
        </div>
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

// ── Loyalty Settings Tab ──────────────────────────────────────────────────────

function LoyaltySettings() {
  const [cfg, setCfg] = useState({
    enabled: 0, earn_points: 1, earn_per_amount: 100,
    redeem_points: 100, redeem_value: 10, min_redeem: 100, expiry_days: 0,
  })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    window.api.loyalty.config.get().then((r: { success: boolean; data?: Record<string, number> }) => {
      if (r.success && r.data) setCfg(r.data as typeof cfg)
    })
  }, [])

  const save = async () => {
    setSaving(true)
    const res = await window.api.loyalty.config.save(cfg) as { success: boolean; error?: string }
    setSaving(false)
    if (res.success) toast.success('Loyalty settings saved')
    else toast.error(res.error || 'Save failed')
  }

  return (
    <div className="space-y-6 max-w-xl">
      <Section title="Loyalty Points Program">
        <p className="text-xs -mt-1 mb-3" style={{ color: 'var(--text-3)' }}>
          Customers earn points on every purchase and can redeem them for discounts at POS.
        </p>
        <label className="flex items-center gap-2 mb-4 cursor-pointer">
          <input type="checkbox" checked={Boolean(cfg.enabled)} onChange={e => setCfg(c => ({ ...c, enabled: e.target.checked ? 1 : 0 }))} className="w-4 h-4 accent-yellow-500" />
          <span className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>Enable Loyalty Program ⭐</span>
        </label>

        <div className="space-y-4" style={{ opacity: cfg.enabled ? 1 : 0.5, pointerEvents: cfg.enabled ? 'auto' : 'none' }}>
          <Section title="Earn Rate">
            <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-2)' }}>
              <span>Customer earns</span>
              <input type="number" min={1} value={cfg.earn_points} onChange={e => setCfg(c => ({ ...c, earn_points: parseInt(e.target.value) || 1 }))} className="input w-20 py-1 text-center" />
              <span>point(s) for every</span>
              <input type="number" min={1} value={cfg.earn_per_amount} onChange={e => setCfg(c => ({ ...c, earn_per_amount: parseFloat(e.target.value) || 100 }))} className="input w-24 py-1 text-center" />
              <span>Rs. spent</span>
            </div>
          </Section>

          <Section title="Redemption Rate">
            <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-2)' }}>
              <input type="number" min={1} value={cfg.redeem_points} onChange={e => setCfg(c => ({ ...c, redeem_points: parseInt(e.target.value) || 100 }))} className="input w-24 py-1 text-center" />
              <span>points =</span>
              <span style={{ color: 'var(--text-3)' }}>Rs.</span>
              <input type="number" min={0.1} step={0.5} value={cfg.redeem_value} onChange={e => setCfg(c => ({ ...c, redeem_value: parseFloat(e.target.value) || 10 }))} className="input w-24 py-1 text-center" />
              <span>discount</span>
            </div>
          </Section>

          <Section title="Redemption Rules">
            <Field label="Minimum points to redeem">
              <input type="number" min={0} value={cfg.min_redeem} onChange={e => setCfg(c => ({ ...c, min_redeem: parseInt(e.target.value) || 0 }))} className="input w-32" />
            </Field>
            <Field label="Points expiry (days, 0 = never expire)">
              <input type="number" min={0} value={cfg.expiry_days} onChange={e => setCfg(c => ({ ...c, expiry_days: parseInt(e.target.value) || 0 }))} className="input w-32" />
            </Field>
          </Section>

          <div className="rounded-xl p-4 border" style={{ background: 'color-mix(in srgb, #f59e0b 8%, transparent)', borderColor: 'color-mix(in srgb, #f59e0b 30%, transparent)' }}>
            <p className="text-sm font-semibold text-yellow-500 mb-1">Preview</p>
            <p className="text-xs" style={{ color: 'var(--text-2)' }}>
              A purchase of Rs. 1,000 earns <strong>{Math.floor(1000 / cfg.earn_per_amount * cfg.earn_points)} points</strong>.
              {' '}{cfg.redeem_points} points can be redeemed for Rs. {cfg.redeem_value} discount.
            </p>
          </div>
        </div>

        <button onClick={save} disabled={saving} className="btn-primary mt-4 gap-1.5">
          <Save size={14} />{saving ? 'Saving…' : 'Save Loyalty Settings'}
        </button>
      </Section>
    </div>
  )
}

// ── Communications Tab ────────────────────────────────────────────────────────

function CommunicationsSettings({ form, f, check }: {
  form: Record<string, unknown>
  f: (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => void
  check: (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => void
}) {
  const [testEmail, setTestEmail]   = useState('')
  const [testSms, setTestSms]       = useState('')
  const [testWa, setTestWa]         = useState('')
  const [testing, setTesting]       = useState<Record<string, boolean>>({})

  const runTest = async (key: string, fn: () => Promise<{ success: boolean; error?: string }>) => {
    setTesting(t => ({ ...t, [key]: true }))
    try {
      const res = await fn()
      if (res.success) toast.success(`${key} test sent!`)
      else toast.error(res.error || `${key} test failed`)
    } finally {
      setTesting(t => ({ ...t, [key]: false }))
    }
  }

  return (
    <div className="space-y-8 max-w-3xl">

      {/* ── Email / SMTP ───────────────────────────────────────────────────── */}
      <Section title="Email (SMTP)">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs" style={{ color: 'var(--text-3)' }}>Send invoices, payment reminders, and low-stock alerts by email.</p>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={Boolean(form.email_enabled)} onChange={check('email_enabled')} className="w-4 h-4 accent-blue-600" />
            <span className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>Enable Email</span>
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="SMTP Host">
            <input value={String(form.smtp_host || '')} onChange={f('smtp_host')} className="input font-mono text-sm" placeholder="smtp.gmail.com" disabled={!form.email_enabled} />
          </Field>
          <Field label="Port">
            <input type="number" value={Number(form.smtp_port || 587)} onChange={f('smtp_port')} className="input" placeholder="587" disabled={!form.email_enabled} />
          </Field>
        </div>
        <Field label="Encryption">
          <select value={String(form.smtp_encryption || 'TLS')} onChange={f('smtp_encryption')} className="input max-w-xs" disabled={!form.email_enabled}>
            <option value="TLS">STARTTLS (port 587)</option>
            <option value="SSL">SSL/TLS (port 465)</option>
            <option value="NONE">None (port 25)</option>
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Username / Email">
            <input value={String(form.smtp_username || '')} onChange={f('smtp_username')} className="input" placeholder="you@gmail.com" disabled={!form.email_enabled} />
          </Field>
          <Field label="Password / App Password">
            <input type="password" value={String(form.smtp_password || '')} onChange={f('smtp_password')} className="input" placeholder="••••••••" disabled={!form.email_enabled} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="From Name">
            <input value={String(form.smtp_from_name || '')} onChange={f('smtp_from_name')} className="input" placeholder="Nature Plantation" disabled={!form.email_enabled} />
          </Field>
          <Field label="From Email">
            <input value={String(form.smtp_from_email || '')} onChange={f('smtp_from_email')} className="input" placeholder="noreply@company.lk" disabled={!form.email_enabled} />
          </Field>
        </div>
        <Field label="Reply-To Email (optional)">
          <input value={String(form.smtp_reply_to || '')} onChange={f('smtp_reply_to')} className="input max-w-sm" placeholder="info@company.lk" disabled={!form.email_enabled} />
        </Field>

        {/* Test email */}
        <div className="flex items-center gap-2 mt-2">
          <Mail size={13} style={{ color: 'var(--text-3)' }} />
          <input
            value={testEmail}
            onChange={e => setTestEmail(e.target.value)}
            className="input flex-1 max-w-xs py-1.5 text-sm"
            placeholder="test@example.com"
          />
          <button
            disabled={!testEmail || testing.email || !form.email_enabled}
            onClick={() => runTest('Email', () => window.api.comm.email.test(testEmail))}
            className="btn-secondary btn-sm"
          >
            {testing.email ? 'Sending…' : 'Send Test Email'}
          </button>
        </div>
      </Section>

      {/* ── SMS Gateway ────────────────────────────────────────────────────── */}
      <Section title="SMS Gateway">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs" style={{ color: 'var(--text-3)' }}>Send installment reminders and low-stock alerts via SMS. Works with any HTTP-based gateway (MSG91, TextLocal, Twilio, etc.)</p>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={Boolean(form.sms_enabled)} onChange={check('sms_enabled')} className="w-4 h-4 accent-blue-600" />
            <span className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>Enable SMS</span>
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Provider Name">
            <input value={String(form.sms_provider_name || '')} onChange={f('sms_provider_name')} className="input" placeholder="MSG91 / Twilio / TextLocal" disabled={!form.sms_enabled} />
          </Field>
          <Field label="Sender ID / From">
            <input value={String(form.sms_sender_id || '')} onChange={f('sms_sender_id')} className="input" placeholder="POSAPP" disabled={!form.sms_enabled} />
          </Field>
        </div>
        <Field label="API Base URL">
          <input value={String(form.sms_api_base_url || '')} onChange={f('sms_api_base_url')} className="input font-mono text-sm" placeholder="https://api.msg91.com/api/v5/flow/" disabled={!form.sms_enabled} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="API Key">
            <input value={String(form.sms_api_key || '')} onChange={f('sms_api_key')} className="input font-mono text-sm" placeholder="your-api-key" disabled={!form.sms_enabled} />
          </Field>
          <Field label="API Secret (optional)">
            <input type="password" value={String(form.sms_api_secret || '')} onChange={f('sms_api_secret')} className="input" placeholder="••••••••" disabled={!form.sms_enabled} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="HTTP Method">
            <select value={String(form.sms_http_method || 'POST')} onChange={f('sms_http_method')} className="input" disabled={!form.sms_enabled}>
              <option value="POST">POST</option>
              <option value="GET">GET</option>
            </select>
          </Field>
          <Field label="Content-Type">
            <select value={String(form.sms_content_type || 'application/json')} onChange={f('sms_content_type')} className="input" disabled={!form.sms_enabled}>
              <option value="application/json">JSON</option>
              <option value="application/x-www-form-urlencoded">Form URL Encoded</option>
            </select>
          </Field>
        </div>
        <Field label="Request Body Template">
          <p className="text-xs mb-1" style={{ color: 'var(--text-3)' }}>Use: <code className="bg-slate-700 px-1 rounded text-xs">&#123;phone&#125;</code>, <code className="bg-slate-700 px-1 rounded text-xs">&#123;message&#125;</code>, <code className="bg-slate-700 px-1 rounded text-xs">&#123;api_key&#125;</code>, <code className="bg-slate-700 px-1 rounded text-xs">&#123;sender_id&#125;</code></p>
          <textarea
            value={String(form.sms_body_template || '{"mobile":"{phone}","message":"{message}"}')}
            onChange={f('sms_body_template')}
            className="input font-mono text-xs h-20 resize-none"
            disabled={!form.sms_enabled}
          />
        </Field>
        <Field label="Custom Headers (one per line, Key: Value)">
          <textarea
            value={String(form.sms_custom_headers || '')}
            onChange={f('sms_custom_headers')}
            className="input font-mono text-xs h-16 resize-none"
            placeholder={'authkey: your-key\nX-Custom: value'}
            disabled={!form.sms_enabled}
          />
        </Field>

        {/* Test SMS */}
        <div className="flex items-center gap-2 mt-2">
          <MessageSquare size={13} style={{ color: 'var(--text-3)' }} />
          <input
            value={testSms}
            onChange={e => setTestSms(e.target.value)}
            className="input flex-1 max-w-xs py-1.5 text-sm"
            placeholder="+94771234567"
          />
          <button
            disabled={!testSms || testing.sms || !form.sms_enabled}
            onClick={() => runTest('SMS', () => window.api.comm.sms.test(testSms))}
            className="btn-secondary btn-sm"
          >
            {testing.sms ? 'Sending…' : 'Send Test SMS'}
          </button>
        </div>
      </Section>

      {/* ── WhatsApp ───────────────────────────────────────────────────────── */}
      <Section title="WhatsApp API">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs" style={{ color: 'var(--text-3)' }}>Send receipts and reminders via WhatsApp Business. Supports Meta Cloud API and Twilio.</p>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={Boolean(form.whatsapp_enabled)} onChange={check('whatsapp_enabled')} className="w-4 h-4 accent-blue-600" />
            <span className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>Enable WhatsApp</span>
          </label>
        </div>

        <Field label="Provider">
          <select value={String(form.whatsapp_provider || 'meta')} onChange={f('whatsapp_provider')} className="input max-w-xs" disabled={!form.whatsapp_enabled}>
            <option value="meta">Meta Cloud API (WhatsApp Business)</option>
            <option value="twilio">Twilio WhatsApp</option>
          </select>
        </Field>

        {(form.whatsapp_provider === 'meta' || !form.whatsapp_provider) && (
          <>
            <Field label="Phone Number ID">
              <input value={String(form.whatsapp_phone_number_id || '')} onChange={f('whatsapp_phone_number_id')} className="input font-mono text-sm" placeholder="1234567890" disabled={!form.whatsapp_enabled} />
            </Field>
            <Field label="Access Token">
              <input type="password" value={String(form.whatsapp_access_token || '')} onChange={f('whatsapp_access_token')} className="input font-mono text-sm" placeholder="EAAxxxxx…" disabled={!form.whatsapp_enabled} />
            </Field>
          </>
        )}

        {form.whatsapp_provider === 'twilio' && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Account SID">
                <input value={String(form.whatsapp_twilio_sid || '')} onChange={f('whatsapp_twilio_sid')} className="input font-mono text-sm" placeholder="ACxxxxxxxxxx" disabled={!form.whatsapp_enabled} />
              </Field>
              <Field label="Auth Token">
                <input type="password" value={String(form.whatsapp_twilio_token || '')} onChange={f('whatsapp_twilio_token')} className="input" placeholder="••••••••" disabled={!form.whatsapp_enabled} />
              </Field>
            </div>
            <Field label="From Number (WhatsApp)">
              <input value={String(form.whatsapp_from_number || '')} onChange={f('whatsapp_from_number')} className="input" placeholder="+14155238886" disabled={!form.whatsapp_enabled} />
            </Field>
          </>
        )}

        {/* Test WhatsApp */}
        <div className="flex items-center gap-2 mt-2">
          <Phone size={13} style={{ color: 'var(--text-3)' }} />
          <input
            value={testWa}
            onChange={e => setTestWa(e.target.value)}
            className="input flex-1 max-w-xs py-1.5 text-sm"
            placeholder="+94771234567"
          />
          <button
            disabled={!testWa || testing.whatsapp || !form.whatsapp_enabled}
            onClick={() => runTest('WhatsApp', () => window.api.comm.whatsapp.test(testWa))}
            className="btn-secondary btn-sm"
          >
            {testing.whatsapp ? 'Sending…' : 'Send Test Message'}
          </button>
        </div>
      </Section>

      {/* ── Reminder Schedule ──────────────────────────────────────────────── */}
      <Section title="Auto Reminders">
        <p className="text-xs mb-3" style={{ color: 'var(--text-3)' }}>
          The system automatically sends reminders every day at startup. Enable Email or SMS above to activate.
        </p>
        <div className="rounded-xl border divide-y" style={{ borderColor: 'var(--border)' }}>
          {[
            { label: 'Overdue installment notice', desc: 'Sent daily to customers whose payment is past due', icon: '🔴' },
            { label: 'Due today reminder', desc: 'Sent on the day payment is due', icon: '🟡' },
            { label: 'Due in 3 days reminder', desc: 'Early warning 3 days before due date', icon: '🟢' },
            { label: 'Low stock alert', desc: 'Daily email/SMS to company email when items are below min level', icon: '📦' },
          ].map(item => (
            <div key={item.label} className="flex items-center gap-3 px-4 py-3">
              <span className="text-base">{item.icon}</span>
              <div>
                <p className="text-sm font-medium" style={{ color: 'var(--text-1)' }}>{item.label}</p>
                <p className="text-xs" style={{ color: 'var(--text-3)' }}>{item.desc}</p>
              </div>
              <span className="ml-auto text-xs px-2 py-0.5 rounded-full font-medium"
                style={{ background: 'color-mix(in srgb, var(--brand-primary) 12%, transparent)', color: 'var(--brand-primary)' }}>
                Auto
              </span>
            </div>
          ))}
        </div>

        <div className="flex gap-2 mt-3">
          <button
            onClick={() => {
              window.api.comm.sendLowStockAlert().then((r: { success: boolean; count?: number; error?: string }) => {
                if (r.success) toast.success(r.count ? `Low stock alert sent for ${r.count} items` : 'No low stock items found')
                else toast.error(r.error || 'Failed to send alert')
              })
            }}
            className="btn-secondary btn-sm"
          >
            📦 Send Low Stock Alert Now
          </button>
        </div>
      </Section>
    </div>
  )
}

// ── S3 Storage Tab ────────────────────────────────────────────────────────────

function S3Settings({ form, f, check }: {
  form: Record<string, unknown>
  f: (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => void
  check: (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => void
}) {
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)

  const save = async () => {
    setSaving(true)
    const s3Fields = {
      s3_enabled: form.s3_enabled,
      s3_bucket:  form.s3_bucket,
      s3_region:  form.s3_region,
      s3_access_key: form.s3_access_key,
      s3_secret_key: form.s3_secret_key,
      s3_endpoint: form.s3_endpoint,
      s3_cdn_url:  form.s3_cdn_url,
    }
    const res = await window.api.settings.update(s3Fields) as { success: boolean; error?: string }
    setSaving(false)
    if (res.success) toast.success('S3 settings saved')
    else toast.error(res.error || 'Save failed')
  }

  const testConnection = async () => {
    setTesting(true)
    const res = await window.api.settings.s3Test() as { success: boolean; error?: string }
    setTesting(false)
    if (res.success) toast.success('S3 connection successful!')
    else toast.error(res.error || 'Connection failed')
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <Section title="AWS S3 / S3-Compatible Storage">
        <div className="flex items-center gap-3 mb-4">
          <input type="checkbox" id="s3_enabled" checked={Boolean(form.s3_enabled)} onChange={check('s3_enabled')} className="w-4 h-4" />
          <label htmlFor="s3_enabled" className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>
            Enable S3 Storage
          </label>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">S3 Bucket *</label>
            <input value={String(form.s3_bucket || '')} onChange={f('s3_bucket')} className="input" placeholder="my-pos-bucket" />
          </div>
          <div>
            <label className="label">Region *</label>
            <input value={String(form.s3_region || '')} onChange={f('s3_region')} className="input" placeholder="us-east-1" />
          </div>
          <div>
            <label className="label">Access Key ID *</label>
            <input value={String(form.s3_access_key || '')} onChange={f('s3_access_key')} className="input" placeholder="AKIAIOSFODNN7EXAMPLE" />
          </div>
          <div>
            <label className="label">Secret Access Key *</label>
            <input type="password" value={String(form.s3_secret_key || '')} onChange={f('s3_secret_key')} className="input" placeholder="••••••••" />
          </div>
          <div className="col-span-2">
            <label className="label">Custom Endpoint (optional — for MinIO / Wasabi / BackBlaze B2)</label>
            <input value={String(form.s3_endpoint || '')} onChange={f('s3_endpoint')} className="input" placeholder="https://s3.wasabisys.com" />
            <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>Leave blank to use AWS S3</p>
          </div>
          <div className="col-span-2">
            <label className="label">CDN URL (optional — prefix for uploaded file URLs)</label>
            <input value={String(form.s3_cdn_url || '')} onChange={f('s3_cdn_url')} className="input" placeholder="https://cdn.yourdomain.com" />
          </div>
        </div>

        <div className="flex gap-3 mt-4">
          <button onClick={save} disabled={saving} className="btn-primary gap-1.5">
            <Save size={14} />{saving ? 'Saving…' : 'Save S3 Settings'}
          </button>
          <button onClick={testConnection} disabled={testing || !form.s3_bucket} className="btn-secondary gap-1.5">
            {testing ? <RefreshCw size={14} className="animate-spin" /> : <Cloud size={14} />}
            {testing ? 'Testing…' : 'Test Connection'}
          </button>
        </div>

        <div className="mt-4 p-3 rounded-lg border text-xs" style={{ borderColor: 'var(--border)', color: 'var(--text-3)' }}>
          <strong style={{ color: 'var(--text-2)' }}>How it works:</strong> When S3 is enabled, product images will be uploaded
          to your S3 bucket instead of local storage. Existing local images remain accessible via the{' '}
          <code className="font-mono text-[10px]">app-img://</code> protocol.
        </div>
      </Section>
    </div>
  )
}
