import BatchFields from '@/components/shared/BatchFields'
import {useBatchGuard} from '@/hooks/useBatchGuard'
import { useEffect, useState } from 'react'
import {
  Plus, RefreshCw, Eye, Send, PackageCheck, XCircle, MessageSquare, Mail, Phone,
  Upload, Download, CheckCircle, FileSpreadsheet, Printer, AlertTriangle
} from 'lucide-react'
import { useBusinessType } from '@/hooks/useBusinessType'
import PageHeader from '@/components/shared/PageHeader'
import Modal from '@/components/shared/Modal'
import ProductSearchSelect from '@/components/shared/ProductSearchSelect'
import CreatableSearchSelect from '@/components/shared/CreatableSearchSelect'
import { useProductsStore } from '@/store/productsStore'
import PurchaseBillPicker from '@/components/shared/PurchaseBillPicker'
import NumberInput from '@/components/shared/NumberInput'
import BulkImportWizard from '@/components/admin/BulkImportWizard'
import PurchasePricingPanel from '@/components/admin/PurchasePricingPanel'
import PurchaseInventoryReport from '@/components/admin/PurchaseInventoryReport'
import PurchaseReturnModal from '@/components/admin/PurchaseReturnModal'
import {purchaseMoney} from '../../../electron/lib/purchaseMath'
import { toBaseQty, splitQty, formatQtyWithUom, type PackUom } from '@/lib/uom'
import { printPurchaseQuotation, type PurchaseQuotationItem } from '@/lib/purchaseQuotationPrint'
import toast from 'react-hot-toast'
import { colomboToday } from '../../lib/datetime'

type PO = Record<string, unknown>
type POItem = Record<string, unknown>

function uploadTime(value:unknown) {
  if(!value) return 'Not recorded'
  const text=String(value);const utc=/^\d{4}-\d{2}-\d{2} \d{2}:/.test(text)?text.replace(' ','T')+'Z':text
  const date=new Date(utc);return Number.isNaN(date.getTime())?text:date.toLocaleString()
}

const PO_STATUSES = ['DRAFT', 'SENT', 'PARTIAL', 'RECEIVED', 'CANCELLED'] as const

function statusBadge(status: string) {
  const map: Record<string, string> = {
    DRAFT: 'badge-yellow', SENT: 'badge-blue',
    PARTIAL: 'badge-orange', RECEIVED: 'badge-green', CANCELLED: 'badge-red'
  }
  return <span className={map[status] || 'badge-blue'}>{status}</span>
}

export default function PurchaseOrdersPage() {
  const { isSupermarket: supermarket } = useBusinessType()
  const [pos, setPOs]         = useState<PO[]>([])
  const [statusFilter, setFilter] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [loading, setLoading] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [entryMode,setEntryMode] = useState<'order'|'direct'>('order')
  const [historyView,setHistoryView] = useState('all')
  const [supplierFilter,setSupplierFilter] = useState('')
  const [search,setSearch] = useState('')
  const [receipts,setReceipts] = useState<PO[]>([])
  const [billRows,setBillRows] = useState<PO[]>([])
  const [uploaders,setUploaders] = useState<{id:string;name:string}[]>([])
  const [uploadedFrom,setUploadedFrom] = useState('')
  const [uploadedTo,setUploadedTo] = useState('')
  const [uploadedBy,setUploadedBy] = useState('')
  const [fileType,setFileType] = useState('')
  const [viewPO, setViewPO]   = useState<(PO & { items?: POItem[] }) | null>(null)
  const [showReceive, setShowReceive] = useState(false)

  // PO Excel Import & Template state
  const [showImportModal, setShowImportModal] = useState(false)
  const [showStockImport,setShowStockImport]=useState(false)
  const [showInventoryReport,setShowInventoryReport]=useState(false)
  const [returnPurchaseId,setReturnPurchaseId]=useState('')
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<{
    importedPOs?: number
    totalItems?: number
    totalProcurementAmount?: number
    warnings?: string[]
  } | null>(null)
  const [importSupplierId, setImportSupplierId] = useState('')
  const [markReceived, setMarkReceived] = useState(true)
  const [suppliers, setSuppliers] = useState<{ id: string; name: string }[]>([])

  useEffect(() => {
    window.api?.admin?.suppliers?.list?.().then((r: { success: boolean; data?: unknown[] }) => {
      if (r?.success && Array.isArray(r.data)) {
        setSuppliers(r.data.map((s: any) => ({ id: String(s.id), name: String(s.name) })))
      }
    }).catch(() => {})
  }, [])

  const handleDownloadTemplate = async () => {
    try {
      const res = await window.api.purchases.downloadTemplate()
      if (res?.success) toast.success('Purchase Order template downloaded successfully!')
      else if (!res?.cancelled) toast.error(res?.error || 'Failed to download template')
    } catch (err) {
      toast.error('Failed to download template: ' + String(err))
    }
  }

  const handleImportPOs = async () => {
    setImporting(true)
    try {
      const res = await window.api.purchases.importExcel({
        defaultSupplierId: importSupplierId || undefined,
        markAsReceived: supermarket ? false : markReceived,
      })
      if (!res?.success) {
        if (!res?.cancelled) toast.error(res?.error || 'Import failed')
        return
      }
      setImportResult(res)
      toast.success(`Successfully imported ${res.importedPOs} Purchase Orders (${res.totalItems} items)!`)
      load()
    } catch (err) {
      toast.error('Import failed: ' + String(err))
    } finally {
      setImporting(false)
    }
  }

  const load = async () => {
    setLoading(true)
    try {
      const filters = { status: statusFilter || undefined, from: from || undefined, to: to || undefined, supplier_id: supplierFilter || undefined, search: search || undefined, purchase_type: ['order','direct'].includes(historyView) ? historyView : undefined, has_bill: historyView === 'bills', uploaded_from: uploadedFrom || undefined, uploaded_to: uploadedTo || undefined, uploaded_by: uploadedBy || undefined, file_type: fileType || undefined }
      const res = historyView === 'bills' ? await window.api.purchases.billHistory(filters) : historyView === 'receipts' ? await window.api.purchases.receiptHistory(filters) : await window.api.purchases.list(filters)
      if (res.success) { if(historyView === 'bills') { setBillRows(res.data.rows);setUploaders(res.data.uploaders) } else if(historyView === 'receipts') setReceipts(res.data as PO[]); else setPOs(res.data as PO[]) }
      else toast.error(String(res.error || 'Failed to load purchase orders'))
    } catch (err) {
      toast.error('Failed to load purchase orders: ' + String(err))
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [statusFilter, from, to, historyView, supplierFilter, search, uploadedFrom, uploadedTo, uploadedBy, fileType])

  const loadDetail = async (id: string) => {
    try {
      const res = await window.api.purchases.get(id)
      if (res.success) setViewPO(res.data as PO & { items?: POItem[] })
      else toast.error(String(res.error || 'Failed to load purchase order'))
    } catch (err) {
      toast.error('Failed to load purchase order: ' + String(err))
    }
  }

  const updateStatus = async (po: PO, status: string, extra?: unknown,refreshDetail=true) => {
    try {
      const res = await window.api.purchases.updateStatus(String(po.id), status, extra)
      if (res.success) {
        toast.success(`PO ${po.po_number} → ${res.data?.status||status}`)
        load()
        if (refreshDetail&&viewPO?.id === po.id) await loadDetail(String(po.id))
        useProductsStore.getState().invalidate()
        return true
      } else {
        toast.error(String(res.error)); return false
      }
    } catch (err) {
      toast.error('Failed to update purchase order: ' + String(err)); return false
    }
  }

  const notifySupplier = async (poId: string, options?: { openWhatsApp?: boolean; sendEmail?: boolean }) => {
    try {
      const res = await window.api.purchases.notifySupplier(poId, options)
      if (res.success) {
        const notif = res.data as { whatsapp?: { phone?: string }; email?: { to?: string; result?: { success?: boolean; error?: string } } } | undefined
        if (options?.sendEmail && notif?.email?.result?.success) {
          toast.success(`Email sent to ${notif.email.to}`)
        } else if (options?.sendEmail && notif?.email?.result?.error) {
          toast(`Email status: ${notif.email.result.error}`, { icon: 'ℹ️' })
        }
        if (options?.openWhatsApp) {
          toast.success(`WhatsApp prepared for ${notif?.whatsapp?.phone || 'supplier'}`)
        }
      } else {
        toast.error(res.error || 'Failed to notify supplier')
      }
    } catch (err) {
      toast.error('Failed to notify supplier: ' + String(err))
    }
  }

  const quickPrintPO = async (po: PO) => {
    try {
      const res = await window.api.purchases.get(String(po.id))
      if (!res?.success || !res?.data) {
        toast.error('Could not load PO details for quotation')
        return
      }
      const fullPO = res.data as Record<string, unknown> & { items?: Record<string, unknown>[] }
      const settingsRes = await window.api?.settings?.get?.().catch(() => null)
      const settings = settingsRes?.success ? (settingsRes.data as Record<string, unknown>) : {}

      const items = (fullPO.items || []) as Record<string, unknown>[]
      const printItems: PurchaseQuotationItem[] = items.map(item => ({
        product_name: String(item.product_name || 'Product'),
        sku: String(item.sku || ''),
        barcode: String(item.barcode || ''),
        unit: String(item.unit || 'pcs'),
        quantity: Number(item.quantity || 0),
        unit_cost: Number(item.unit_cost || 0),
        line_total: Number(item.line_total || (Number(item.quantity || 0) * Number(item.unit_cost || 0))),
      }))

      printPurchaseQuotation({
        document_title: fullPO.purchase_type === 'direct' ? 'STOCK RECEIPT & INVOICE SHEET' : 'SUPPLIER PURCHASE QUOTATION / PO',
        document_number: String(fullPO.po_number || 'PO'),
        date: String(fullPO.purchase_date || String(fullPO.created_at || '').slice(0, 10)),
        expected_date: fullPO.expected_date ? String(fullPO.expected_date) : undefined,
        company_name: String(settings.company_name || 'Nature Plantation'),
        company_address: String(settings.company_address || ''),
        company_phone: String(settings.company_phone || ''),
        company_email: String(settings.company_email || ''),
        supplier: {
          name: String(fullPO.supplier_name || 'Supplier'),
          business_name: fullPO.business_name ? String(fullPO.business_name) : undefined,
          phone: fullPO.phone ? String(fullPO.phone) : undefined,
          mobile_number: fullPO.mobile_number ? String(fullPO.mobile_number) : undefined,
          email: fullPO.email ? String(fullPO.email) : undefined,
          address: fullPO.address ? String(fullPO.address) : undefined,
          city: fullPO.city ? String(fullPO.city) : undefined,
        },
        items: printItems,
        total_amount: Number(fullPO.total_amount || 0),
        notes: fullPO.notes ? String(fullPO.notes) : undefined,
      })
    } catch (err) {
      toast.error('Failed to print quotation: ' + String(err))
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader
        title={supermarket ? "Stock Purchases & Bills" : "Purchase Orders"}
        subtitle={historyView === 'bills' ? `${billRows.length} uploaded supplier bills` : historyView === 'receipts' ? `${receipts.length} stock receipts` : `${pos.length} ${supermarket ? 'purchases' : 'purchase orders'}`}
        actions={
          <div className="flex flex-wrap justify-end gap-2">
            <button className="btn-ghost btn-sm gap-1.5" onClick={load} disabled={loading}>
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
            </button>
            <button className="btn-secondary btn-sm gap-1.5" onClick={handleDownloadTemplate}>
              <Download size={14} /> PO Template
            </button>
            <button className="btn-secondary btn-sm gap-1.5" onClick={() => setShowImportModal(true)}>
              <Upload size={14} /> Import PO (Excel)
            </button>
            {supermarket&&<button className="btn-secondary btn-sm gap-1.5" onClick={()=>setShowStockImport(true)}><FileSpreadsheet size={14}/>Bulk stock upload</button>}
            {supermarket&&<button className="btn-secondary btn-sm" onClick={()=>setShowInventoryReport(true)}>Batch inventory & alerts</button>}
            {!supermarket && <button className="btn-primary btn-sm gap-1.5" onClick={() => {setEntryMode('order');setShowCreate(true)}}>
              <Plus size={14} /> New PO
            </button>}
          </div>
        }
      />

      {showStockImport&&<BulkImportWizard initialType="stock_in" onClose={()=>setShowStockImport(false)} onImported={()=>{load();useProductsStore.getState().invalidate()}}/>}
      {showInventoryReport&&<PurchaseInventoryReport onClose={()=>setShowInventoryReport(false)}/>}
      {returnPurchaseId&&<PurchaseReturnModal purchaseId={returnPurchaseId} onClose={()=>setReturnPurchaseId('')} onDone={()=>{setReturnPurchaseId('');load();useProductsStore.getState().invalidate()}}/>}
      {supermarket && <div className="px-6 pt-4 pb-3 grid md:grid-cols-2 gap-3 border-b" style={{borderColor:'var(--border)'}}>
        <button className="btn-secondary justify-start py-3" onClick={()=>{setEntryMode('order');setShowCreate(true)}}><span className="text-left"><strong className="block">1. Order from Supplier</strong><span className="text-xs font-normal">Create order, track progress, then receive stock and upload the supplier bill.</span></span></button>
        <button className="btn-primary justify-start py-3" onClick={()=>{setEntryMode('direct');setShowCreate(true)}}><span className="text-left"><strong className="block">2. Add Received Stock Directly</strong><span className="text-xs font-normal">Search products from the delivered bill and add stock immediately.</span></span></button>
      </div>}
      {supermarket && <div className="flex gap-2 flex-wrap px-6 pt-3">{[['all','All Purchases'],['order','Purchase Orders'],['direct','Direct Stock'],['receipts','Date-wise Stock Received'],['bills','Supplier Bills']].map(([key,label])=><button key={key} className={historyView===key?'btn-primary btn-sm':'btn-secondary btn-sm'} onClick={()=>{setHistoryView(key);setFilter('')}}>{label}</button>)}</div>}
      <div hidden={!supermarket} className="flex gap-3 px-6 py-3"><label>Purchase date from<input className="input" type="date" value={from} onChange={e => setFrom(e.target.value)} /></label><label>To<input className="input" type="date" value={to} onChange={e => setTo(e.target.value)} /></label></div>
      {supermarket && <div className="flex gap-3 px-6 pb-3"><input className="input flex-1" aria-label="Search purchase history" placeholder={historyView==='bills' ? 'Search file name, supplier, invoice number or staff' : 'Search purchase / bill number or supplier'} value={search} onChange={e=>setSearch(e.target.value)} /><select aria-label="Filter supplier" className="input max-w-xs" value={supplierFilter} onChange={e=>setSupplierFilter(e.target.value)}><option value="">All suppliers</option>{suppliers.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></div>}
      {supermarket && historyView==='bills' && <div className="px-6 pb-3 grid grid-cols-2 xl:grid-cols-4 gap-3">
        <label className="text-sm">Uploaded from<input aria-label="Uploaded from" type="date" className="input" value={uploadedFrom} onChange={e=>setUploadedFrom(e.target.value)} /></label>
        <label className="text-sm">Uploaded to<input aria-label="Uploaded to" type="date" className="input" value={uploadedTo} onChange={e=>setUploadedTo(e.target.value)} /></label>
        <label className="text-sm">Uploaded by<select aria-label="Uploaded by" className="input" value={uploadedBy} onChange={e=>setUploadedBy(e.target.value)}><option value="">All staff</option>{uploaders.map(u=><option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
        <label className="text-sm">File type<select aria-label="Bill file type" className="input" value={fileType} onChange={e=>setFileType(e.target.value)}><option value="">PDF and images</option><option value="pdf">PDF</option><option value="image">Images</option></select></label>
      </div>}
      {/* Status filter tabs */}
      <div className="flex gap-2 px-6 py-3 border-b border-slate-800 overflow-x-auto">
        {['', ...PO_STATUSES].map(s => (
          <button key={s} onClick={() => setFilter(s)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap
              ${statusFilter === s ? 'bg-brand-600 text-white' : 'bg-surface-800 text-slate-400 hover:text-white'}`}>
            {s || 'All'}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto">
        {supermarket && historyView === 'receipts' ? <table className="w-full"><thead><tr>{['Stock Date','Product','Received','Remaining','Unit Cost','Supplier','Purchase','Bills'].map(h=><th key={h} className="table-header">{h}</th>)}</tr></thead><tbody>{receipts.map(row=><tr key={String(row.id)} className="table-row"><td className="table-cell">{String(row.purchase_date||'?')}</td><td className="table-cell">{String(row.product_name)}<small className="block">{String(row.sku)}</small></td><td className="table-cell">{Number(row.original_quantity)}</td><td className="table-cell">{Number(row.quantity)}</td><td className="table-cell">Rs.{Number(row.cost_price).toLocaleString()}</td><td className="table-cell">{String(row.supplier_name||'?')}</td><td className="table-cell">{String(row.po_number)}<small className="block">{row.purchase_type==='direct'?'Direct receipt':'Purchase order'}</small></td><td className="table-cell"><button className="btn-secondary btn-sm" onClick={()=>loadDetail(String(row.po_id))}>Bills ({Number(row.bill_count)}) / View</button></td></tr>)}{!receipts.length&&<tr><td colSpan={8} className="text-center py-12">No stock receipts in this date range.</td></tr>}</tbody></table> : supermarket && historyView==='bills' ? <table className="w-full"><thead><tr>{['Bill File','Supplier','Invoice / Purchase','Purchase Date','Uploaded At','Uploaded By','File Details','Purchase Total','Actions'].map(h=><th key={h} className="table-header px-3">{h}</th>)}</tr></thead><tbody>{billRows.map(bill=><tr key={String(bill.id)} className="table-row">
        <td className="table-cell"><button className="text-sky-400 underline" onClick={async()=>{const r=await window.api.purchases.openAttachment(String(bill.id));if(!r.success)toast.error(r.error||'Could not open bill')}}>{String(bill.original_name)}</button></td>
        <td className="table-cell">{String(bill.supplier_name||'Unknown supplier')}</td><td className="table-cell">{String(bill.supplier_invoice_number||'No invoice number')}<small className="block">{String(bill.po_number)} | {bill.purchase_type==='direct'?'Direct stock':'Purchase order'}</small></td>
        <td className="table-cell">{String(bill.purchase_date||'Not recorded')}</td><td className="table-cell">{uploadTime(bill.uploaded_at)}</td><td className="table-cell">{String(bill.uploaded_by_name||'Unknown user')}</td>
        <td className="table-cell">{String(bill.mime_type)}<small className="block">{(Number(bill.file_size||0)/1024).toFixed(1)} KB</small></td><td className="table-cell">Rs.{Number(bill.total_amount||0).toLocaleString()}</td>
        <td className="table-cell"><button className="btn-secondary btn-sm" onClick={()=>loadDetail(String(bill.purchase_id))}>Purchase Details</button></td>
      </tr>)}{!billRows.length&&<tr><td colSpan={9} className="text-center py-12">No uploaded bills match these filters.</td></tr>}</tbody></table> : <table className="w-full">
          <thead className="sticky top-0 bg-surface-900">
            <tr>
              {(supermarket ? ['Purchase / Bill','Supplier','Purchase Date','Items','Total','Expected','Status','Actions'] : ['PO #', 'Supplier', 'Branch', 'Items', 'Total', 'Expected', 'Status', '']).map(h =>
                <th className="table-header px-4 py-3 text-left" key={h}>{h}</th>
              )}
            </tr>
          </thead>
          <tbody>
            {pos.map(po => (
              <tr className="table-row" key={String(po.id)}>
                <td className="table-cell font-mono text-xs text-brand-400">{String(po.po_number)}{supermarket && <><small className="block">{po.purchase_type==='direct'?'Direct stock':'Purchase order'}</small><small className="block">Bill: {String(po.supplier_invoice_number||'Not entered')} | {Number(po.bill_count||0)} files</small></>}</td>
                <td className="table-cell font-medium">{String(po.supplier_name || '—')}</td>
                <td className="table-cell text-slate-400 text-sm">{supermarket ? String(po.purchase_date || String(po.created_at || '').slice(0,10)) : String(po.branch_name || '')}</td>
                <td className="table-cell text-center">{String(po.item_count ?? 0)}</td>
                <td className="table-cell font-semibold">
                  Rs.{Number(po.total_amount || 0).toLocaleString()}
                </td>
                <td className="table-cell text-xs text-slate-400">
                  {po.expected_date ? new Date(String(po.expected_date)).toLocaleDateString() : '—'}
                </td>
                <td className="table-cell">{statusBadge(String(po.status))}</td>
                <td className="table-cell">
                  <div className="flex gap-1.5 flex-wrap">
                    <button className="btn-ghost btn-sm gap-1"
                      onClick={() => { loadDetail(String(po.id)) }}>
                      <Eye size={12} /> View
                    </button>
                    <button className="btn-ghost btn-sm text-sky-400 hover:text-sky-300 gap-1"
                      title="Print Quotation / PO Sheet"
                      onClick={() => quickPrintPO(po)}>
                      <Printer size={12} /> Quotation
                    </button>
                    <button
                      className="btn-ghost btn-sm text-emerald-400 hover:text-emerald-300 gap-1"
                      title="Send via WhatsApp"
                      onClick={() => notifySupplier(String(po.id), { openWhatsApp: true, sendEmail: false })}>
                      <MessageSquare size={12} /> WhatsApp
                    </button>
                    <button
                      className="btn-ghost btn-sm text-sky-400 hover:text-sky-300 gap-1"
                      title="Send via Email"
                      onClick={() => notifySupplier(String(po.id), { openWhatsApp: false, sendEmail: true })}>
                      <Mail size={12} /> Email
                    </button>
                    {po.status === 'DRAFT' && (
                      <button className="btn-secondary btn-sm gap-1"
                        onClick={() => updateStatus(po, 'SENT')}>
                        <Send size={12} /> Send
                      </button>
                    )}
                    {(po.status === 'SENT' || po.status === 'PARTIAL') && (
                      <button className="btn-primary btn-sm gap-1"
                        onClick={() => { loadDetail(String(po.id)); setShowReceive(true) }}>
                        <PackageCheck size={12} /> Receive
                      </button>
                    )}
                    {(po.status === 'DRAFT' || po.status === 'SENT') && (
                      <button className="btn-ghost btn-sm text-red-400 gap-1"
                        onClick={() => updateStatus(po, 'CANCELLED')}>
                        <XCircle size={12} /> Cancel
                      </button>
                    )}
                    {supermarket&&['PARTIAL','RECEIVED'].includes(String(po.status))&&<button className="btn-secondary btn-sm" onClick={()=>setReturnPurchaseId(String(po.id))}>Supplier return</button>}
                  </div>
                </td>
              </tr>
            ))}
            {pos.length === 0 && (
              <tr>
                <td colSpan={8} className="text-center py-16 text-slate-500">No purchase orders found</td>
              </tr>
            )}
          </tbody>
        </table>}
      </div>

      {/* Excel Import Modal */}
      {showImportModal && (
        <Modal
          title="Import Purchase Orders & Procurement (கொள்முதல் இறக்குமதி)"
          onClose={() => { if (!importing) setShowImportModal(false) }}
          footer={
            <div className="flex justify-between items-center w-full">
              <button
                type="button"
                onClick={handleDownloadTemplate}
                className="btn-ghost btn-sm gap-1.5 text-sky-400 hover:text-sky-300"
              >
                <Download size={14} /> Download PO Template
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowImportModal(false)}
                  disabled={importing}
                  className="btn-secondary btn-sm"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleImportPOs}
                  disabled={importing}
                  className="btn-primary btn-sm gap-1.5"
                >
                  <Upload size={14} className={importing ? 'animate-spin' : ''} />
                  {importing ? 'Importing...' : 'Select Excel File & Import'}
                </button>
              </div>
            </div>
          }
        >
          <div className="space-y-4">
            {/* Supermarket direct compatibility notice */}
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3.5 flex items-start gap-3">
              <FileSpreadsheet size={20} className="text-emerald-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-xs font-semibold text-emerald-300">
                  Direct Supermarket Tracker & PO Import (சூப்பர் மார்க்கெட் நேரடி இறக்குமதி)
                </p>
                <p className="text-[12px] text-slate-300 mt-1">
                  You can upload <strong>Grocery Store Inventory Tracker.xlsx</strong> (all daily procurement sheets are automatically extracted) or <strong>FOOD CITY.xlsx</strong> or any standard PO template!
                </p>
                <p className="text-[11px] text-emerald-200/80 mt-1 italic">
                  அனைத்து தினசரி கொள்முதல் தாள்களும் (13.10.2026, 14, 15.10.2026 போன்றவை) தானாகவே தேதியிடப்பட்ட தனித்தனி கொள்முதல் பட்டியல்களாக (PO) மாற்றப்பட்டு இருப்பு புதுப்பிக்கப்படும்.
                </p>
              </div>
            </div>

            {/* Options */}
            <div className="bg-surface-800/80 border border-slate-700/60 rounded-xl p-3.5 space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Default Supplier (இயல்புநிலை சப்ளையர் - விருப்பத்தேர்வு)
                </label>
                <select
                  value={importSupplierId}
                  onChange={e => setImportSupplierId(e.target.value)}
                  className="input w-full text-xs"
                >
                  <option value="">Auto-resolve from Excel / Create as needed</option>
                  {suppliers.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
                <p className="text-[11px] text-slate-400 mt-1">
                  Excel கோப்பில் சப்ளையர் பெயர் இருந்தால் அதுவே பயன்படுத்தப்படும்; இல்லையெனில் இங்கு தேர்வுசெய்யப்பட்ட சப்ளையர் ஒதுக்கப்படும்.
                </p>
              </div>

              {supermarket && <p className="text-sm text-amber-400">Excel imports create draft orders only. Upload the supplier bill in purchase details before receiving stock.</p>}
              <div hidden={supermarket} className="pt-2 border-t border-slate-700/60">
                <label className="flex items-start gap-2.5 cursor-pointer text-slate-300 hover:text-white select-none">
                  <input
                    type="checkbox"
                    checked={markReceived}
                    onChange={e => setMarkReceived(e.target.checked)}
                    className="mt-0.5 rounded text-brand-500 focus:ring-brand-400 bg-surface-900 border-slate-700"
                  />
                  <div>
                    <span className="text-xs font-medium text-white block">
                      Mark as RECEIVED and update inventory stocks immediately
                    </span>
                    <span className="text-[11px] text-slate-400 block mt-0.5">
                      பொருட்கள் பெறப்பட்டதாகக் குறித்து, கிளை இருப்பில் உடனடியாகச் சேர்க்கப்படும் (Stock movement & inventory update).
                    </span>
                  </div>
                </label>
              </div>
            </div>

            {/* Results card if any */}
            {importResult && (
              <div className="rounded-xl border border-sky-500/30 bg-sky-500/10 p-3.5 space-y-2">
                <div className="flex items-center gap-2 text-sky-300 font-semibold text-xs">
                  <CheckCircle size={16} /> Import Summary (இறக்குமதி சுருக்கம்)
                </div>
                <div className="grid grid-cols-3 gap-2 text-center pt-1">
                  <div className="bg-surface-900/60 rounded-lg p-2 border border-slate-800">
                    <div className="text-lg font-bold text-white">{importResult.importedPOs ?? 0}</div>
                    <div className="text-[10px] text-slate-400 uppercase tracking-wide">Purchase Orders</div>
                  </div>
                  <div className="bg-surface-900/60 rounded-lg p-2 border border-slate-800">
                    <div className="text-lg font-bold text-emerald-400">{importResult.totalItems ?? 0}</div>
                    <div className="text-[10px] text-slate-400 uppercase tracking-wide">Total Items</div>
                  </div>
                  <div className="bg-surface-900/60 rounded-lg p-2 border border-slate-800">
                    <div className="text-sm font-bold text-sky-300 mt-1">Rs.{(importResult.totalProcurementAmount ?? 0).toLocaleString()}</div>
                    <div className="text-[10px] text-slate-400 uppercase tracking-wide">Total Value</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}

      {showCreate && (
        <CreatePOModal
          mode={entryMode}
          onClose={() => setShowCreate(false)}
          onDone={() => { useProductsStore.getState().invalidate(); setShowCreate(false); load() }}
        />
      )}

      {viewPO && !showReceive && (
        <PODetailModal
          po={viewPO}
          onClose={() => setViewPO(null)}
          onReceive={() => setShowReceive(true)}
          onSend={() => updateStatus(viewPO, 'SENT')}
          onCancel={() => updateStatus(viewPO, 'CANCELLED')}
          onNotify={(opts) => notifySupplier(String(viewPO.id), opts)}
        />
      )}

      {viewPO && showReceive && (
        <ReceivePOModal
          po={viewPO}
          onClose={() => { setShowReceive(false); setViewPO(null) }}
          onDone={async (items, attachmentToken) => {
            const isFullReceive = items.every((i: Record<string, unknown>) =>
              Number(i.received_qty) === Number(i.ordered_qty) - Number(i.already_received))
            const ok = await updateStatus(viewPO, isFullReceive ? 'RECEIVED' : 'PARTIAL', { items, attachment_token: attachmentToken },false)
            if(ok) { setShowReceive(false); setViewPO(null) }
            return Boolean(ok)
          }}
        />
      )}
    </div>
  )
}

function PODetailModal({ po, onClose, onReceive, onSend, onCancel, onNotify }:
  { po: PO & { items?: POItem[] }; onClose: () => void; onReceive: () => void; onSend: () => void; onCancel: () => void; onNotify: (opts: { openWhatsApp?: boolean; sendEmail?: boolean }) => void }) {
  const { isSupermarket: supermarket } = useBusinessType()
  const [detail, setDetail] = useState(po)
  const [invoice, setInvoice] = useState({ supplier_invoice_number: String(po.supplier_invoice_number || ''), purchase_date: String(po.purchase_date || '').slice(0,10), invoice_date: String(po.invoice_date || '').slice(0,10), paid_amount: Number(po.paid_amount || 0) })
  const saveInvoice = async () => {
    const res = await window.api.purchases.updateInvoice(String(po.id), invoice)
    if (!res.success) return toast.error(res.error || 'Failed to save invoice details')
    setDetail(d => ({ ...d, ...res.data })); toast.success('Supplier invoice details saved')
  }
  const attach = async () => {
    const res = await window.api.purchases.addAttachments(String(po.id))
    if (!res.success) { if (res.error !== 'Cancelled') toast.error(res.error || 'Attachment failed'); return }
    const refreshed=await window.api.purchases.get(String(po.id));if(refreshed.success)setDetail(refreshed.data); toast.success('Invoice attachment saved')
  }
  const removeAttachment = async (id: string) => {
    const reason = window.prompt('Reason for correcting/removing this attachment:')
    if (!reason) return
    const res = await window.api.purchases.removeAttachment(id, reason)
    if (!res.success) return toast.error(res.error || 'Could not remove attachment')
    setDetail(d => ({ ...d, attachments: ((d.attachments as PO[]) || []).filter(a => String(a.id) !== id) })); toast.success('Attachment correction recorded')
  }

  const printPOQuotation = async () => {
    try {
      const settingsRes = await window.api?.settings?.get?.().catch(() => null)
      const settings = settingsRes?.success ? (settingsRes.data as Record<string, unknown>) : {}

      const items = (detail.items || []) as Record<string, unknown>[]
      const printItems: PurchaseQuotationItem[] = items.map(item => ({
        product_name: String(item.product_name || 'Product'),
        sku: String(item.sku || ''),
        barcode: String(item.barcode || ''),
        unit: String(item.unit || 'pcs'),
        quantity: Number(item.quantity || 0),
        unit_cost: Number(item.unit_cost || 0),
        line_total: Number(item.line_total || (Number(item.quantity || 0) * Number(item.unit_cost || 0))),
      }))

      printPurchaseQuotation({
        document_title: detail.purchase_type === 'direct' ? 'STOCK RECEIPT & INVOICE SHEET' : 'SUPPLIER PURCHASE QUOTATION / PO',
        document_number: String(detail.po_number || 'PO'),
        date: String(detail.purchase_date || String(detail.created_at || '').slice(0, 10)),
        expected_date: detail.expected_date ? String(detail.expected_date) : undefined,
        company_name: String(settings.company_name || 'Nature Plantation'),
        company_address: String(settings.company_address || ''),
        company_phone: String(settings.company_phone || ''),
        company_email: String(settings.company_email || ''),
        supplier: {
          name: String(detail.supplier_name || 'Supplier'),
          business_name: detail.business_name ? String(detail.business_name) : undefined,
          phone: detail.phone ? String(detail.phone) : undefined,
          mobile_number: detail.mobile_number ? String(detail.mobile_number) : undefined,
          email: detail.email ? String(detail.email) : undefined,
          address: detail.address ? String(detail.address) : undefined,
          city: detail.city ? String(detail.city) : undefined,
        },
        items: printItems,
        total_amount: Number(detail.total_amount || 0),
        notes: detail.notes ? String(detail.notes) : undefined,
      })
    } catch (err) {
      toast.error('Failed to print quotation: ' + String(err))
    }
  }
  return (
    <Modal title={`PO — ${po.po_number}`} onClose={onClose}>
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3 text-sm">
          <div><p className="text-slate-500">Supplier</p><p className="font-medium">{String(po.supplier_name || '—')}</p></div>
          <div><p className="text-slate-500">Branch</p><p className="font-medium">{String(po.branch_name || '—')}</p></div>
          <div><p className="text-slate-500">Status</p>{statusBadge(String(po.status))}</div>
          <div><p className="text-slate-500">Total</p><p className="font-bold text-brand-400">Rs.{Number(po.total_amount || 0).toLocaleString()}</p></div>
          <div><p className="text-slate-500">Expected</p><p>{po.expected_date ? new Date(String(po.expected_date)).toLocaleDateString() : '—'}</p></div>
          <div><p className="text-slate-500">Notes</p><p className="text-xs">{String(po.notes || '—')}</p></div>
        </div>

        <div hidden={!supermarket} className="rounded-lg border border-slate-700/60 p-3 space-y-3">
          <p className="text-sm font-semibold">Supplier Invoice & Payment</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <input className="input" placeholder="Supplier invoice number" value={invoice.supplier_invoice_number} onChange={e => setInvoice(v => ({ ...v, supplier_invoice_number: e.target.value }))}/>
            <input className="input" type="date" title="Purchase date" value={invoice.purchase_date} onChange={e => setInvoice(v => ({ ...v, purchase_date: e.target.value }))}/>
            <input className="input" type="date" title="Invoice date" value={invoice.invoice_date} onChange={e => setInvoice(v => ({ ...v, invoice_date: e.target.value }))}/>
            <NumberInput className="input" min={0} max={Number(detail.total_amount || 0)} step={0.01} value={invoice.paid_amount} onChange={value => setInvoice(v => ({ ...v, paid_amount: Number(value.target.value) }))}/>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <button className="btn-secondary btn-sm" onClick={saveInvoice}>Save Invoice Details</button>
            <button className="btn-secondary btn-sm gap-1" onClick={attach}><Upload size={12}/>Attach PDF / Image</button>
            <span className="text-slate-400">Status: {String(detail.payment_status || 'unpaid')} · Outstanding Rs.{Number(detail.outstanding_amount ?? detail.total_amount ?? 0).toLocaleString()}</span>
          </div>
          <div className="space-y-1">
            {((detail.attachments as PO[]) || []).map(file => <div key={String(file.id)} className="flex items-center justify-between rounded bg-surface-800 px-2 py-1 text-xs">
              <div className="min-w-0"><button className="text-sky-400 hover:underline" onClick={() => window.api.purchases.openAttachment(String(file.id))}>{String(file.original_name)}</button><p className="text-xs text-slate-400">Uploaded {uploadTime(file.uploaded_at)} by {String(file.uploaded_by_name||'Unknown user')} | {(Number(file.file_size||0)/1024).toFixed(1)} KB</p></div>
              <button className="text-red-400" onClick={() => removeAttachment(String(file.id))}>Correct / Remove</button>
            </div>)}
            {!((detail.attachments as PO[]) || []).length && <p className="text-xs text-slate-500">No invoice attachments.</p>}
          </div>
        </div>

        <div className="bg-surface-800/60 border border-slate-700/60 rounded-lg p-3 flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="text-slate-400">Direct Supplier Communication:</span>
          <div className="flex gap-2">
            <button className="btn-ghost btn-sm text-emerald-400 hover:text-emerald-300 gap-1"
              onClick={() => onNotify({ openWhatsApp: true, sendEmail: false })}>
              <MessageSquare size={12}/> Send WhatsApp
            </button>
            <button className="btn-ghost btn-sm text-sky-400 hover:text-sky-300 gap-1"
              onClick={() => onNotify({ openWhatsApp: false, sendEmail: true })}>
              <Mail size={12}/> Send Email
            </button>
          </div>
        </div>

        <div>
          <p className="text-sm font-semibold mb-2">Items</p>
          <table className="w-full text-sm">
            <thead><tr className="border-b border-slate-700">
              <th className="text-left py-2 text-slate-400 font-normal">Product</th>
              <th className="text-right py-2 text-slate-400 font-normal">Ordered</th>
              <th className="text-right py-2 text-slate-400 font-normal">Received</th>
              <th className="text-right py-2 text-slate-400 font-normal">Unit Cost</th>
              <th className="text-right py-2 text-slate-400 font-normal">Total</th>
            </tr></thead>
            <tbody>{(po.items || []).map((item: POItem) => (
              <tr key={String(item.id)} className="border-b border-slate-800">
                <td className="py-2">{String(item.product_name || '—')}<br/><span className="text-xs text-slate-500">{String(item.sku || '')}</span></td>
                <td className="text-right py-2">{Number(item.quantity)}</td>
                <td className="text-right py-2 text-green-400">{Number(item.received_qty || 0)}</td>
                <td className="text-right py-2">Rs.{Number(item.unit_cost).toLocaleString()}</td>
                <td className="text-right py-2 font-semibold">Rs.{Number(item.line_total).toLocaleString()}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>

        <div className="flex justify-between pt-2">
          <div className="flex gap-2">
            <button className="btn-secondary btn-sm gap-1 text-sky-400 hover:text-sky-300" onClick={printPOQuotation}>
              <Printer size={12}/> Print Quotation Sheet
            </button>
            {po.status === 'DRAFT' && <button className="btn-secondary btn-sm gap-1" onClick={onSend}><Send size={12}/>Send to Supplier</button>}
            {(po.status === 'SENT' || po.status === 'PARTIAL') && <button className="btn-primary btn-sm gap-1" onClick={onReceive}><PackageCheck size={12}/>Receive Items</button>}
            {(po.status === 'DRAFT' || po.status === 'SENT') && <button className="btn-ghost btn-sm text-red-400" onClick={onCancel}><XCircle size={12}/>Cancel PO</button>}
          </div>
          <button className="btn-ghost btn-sm" onClick={onClose}>Close</button>
        </div>
      </div>
    </Modal>
  )
}

function itemPackUom(item: POItem): PackUom | null {
  return item.pack_uom_name && Number(item.pack_conversion_factor) > 1
    ? { uom_name: String(item.pack_uom_name), conversion_factor: Number(item.pack_conversion_factor) }
    : null
}

function ReceivePOModal({ po, onClose, onDone }:
  { po: PO & { items?: POItem[] }; onClose: () => void; onDone: (items: Record<string, unknown>[], token?: string) => Promise<boolean> }) {
  const batchGuard=useBatchGuard()
  const [batchValues,setBatchValues]=useState<Record<string,Record<string,string>>>({})
  const { isSupermarket: supermarket } = useBusinessType()
  const [attachmentToken,setAttachmentToken] = useState('')
  const [saving,setSaving] = useState(false)
  const [purchaseDate, setPurchaseDate] = useState(colomboToday())
  const [prices, setPrices] = useState<Record<string, string>>({})
  const [qtys, setQtys] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {}
    for (const item of po.items || []) {
      const remaining = Number(item.quantity) - Number(item.received_qty || 0)
      init[String(item.id)] = remaining > 0 ? remaining : 0
    }
    return init
  })

  const submit = async () => {
    if(saving) return
    if(supermarket && !attachmentToken && !((po.attachments as PO[]|undefined)?.length)) {toast.error('Upload a supplier bill before receiving stock.');return}
    if (!purchaseDate) { toast.error('Purchase date is required'); return }
    const missingExpiry=(po.items||[]).find((item:POItem)=>Number(item.track_expiry)===1&&(qtys[String(item.id)]||0)>0&&!(batchValues[String(item.id)]?.expiry_date||item.expiry_date))
    if(missingExpiry){toast.error(`Enter the expiry date for ${String(missingExpiry.product_name||'this product')}`);return}
    const items = (po.items || []).map((item: POItem) => ({
      ...item,...batchValues[String(item.id)],
      id: item.id,
      received_qty: qtys[String(item.id)] || 0,
      purchase_date: purchaseDate,
      selling_price: prices[String(item.id)] ?? item.selling_price ?? '',
      ordered_qty: item.quantity,
      already_received: item.received_qty || 0,
    }))
    setSaving(true)
    try {const prepared=await batchGuard.confirm(items.filter(item=>Number(item.received_qty)>0));if(prepared)await onDone(prepared,attachmentToken) } finally { setSaving(false) }
  }

  return (
    <Modal title={`Receive Items — ${po.po_number}`} onClose={onClose} size="xl">
      {batchGuard.dialog}
      <div className="space-y-4">
        <label hidden={!supermarket} className="label">Purchase date<input type="date" className="input" value={purchaseDate} onChange={e => setPurchaseDate(e.target.value)} /></label>
        <p className="text-xs text-slate-400">Enter batch number, manufacture date and expiry date from the delivered goods. They are not needed when placing the order. Leave them blank for non-expiring products.</p>
        <p hidden={!supermarket} className="text-xs text-slate-400">Leave selling price blank to use the product's common price. Enter a price to apply it to this purchase batch.</p>
        {supermarket && <PurchaseBillPicker onChange={setAttachmentToken} disabled={saving} required existingCount={(po.attachments as PO[]|undefined)?.length||0} />}
        <table className="w-full text-sm">
          <thead><tr className="border-b border-slate-700">
            <th className="text-left py-2 text-slate-400 font-normal">Product</th>
            <th className="text-right py-2 text-slate-400 font-normal">Ordered</th>
            <th className="text-right py-2 text-slate-400 font-normal">Already Received</th>
            <th className="text-right py-2 text-slate-400 font-normal">Receiving Now</th><th hidden={!supermarket} className="text-right py-2 text-slate-400 font-normal">Selling Price</th><th className="text-left py-2 pl-3 text-slate-400 font-normal">Batch · MFD · Expiry</th>
          </tr></thead>
          <tbody>
            {(po.items || []).map((item: POItem) => {
              const remaining = Number(item.quantity) - Number(item.received_qty || 0)
              const pack = itemPackUom(item)
              const current = qtys[String(item.id)] ?? 0
              const split = splitQty(current, pack)
              return (
                <tr key={String(item.id)} className="border-b border-slate-800">
                  <td className="py-2 font-medium">{String(item.product_name || '—')}</td>
                  <td className="text-right py-2">{formatQtyWithUom(Number(item.quantity), pack)}</td>
                  <td className="text-right py-2 text-slate-400">{formatQtyWithUom(Number(item.received_qty || 0), pack)}</td>
                  <td className="text-right py-2">
                    {pack ? (
                      <div className="flex items-center justify-end gap-1">
                        <NumberInput
                          min={0}
                          value={split.boxes}
                          onChange={e => {
                            const boxes = Math.max(0, parseFloat(e.target.value) || 0)
                            setQtys(q => ({ ...q, [String(item.id)]: Math.min(remaining, toBaseQty(boxes, split.pieces, pack)) }))
                          }}
                          className="input w-14 text-right py-1 text-sm"
                          disabled={remaining <= 0}
                        />
                        <span className="text-xs text-slate-500">{pack.uom_name}+</span>
                        <NumberInput
                          min={0}
                          value={split.pieces}
                          onChange={e => {
                            const pieces = Math.max(0, parseFloat(e.target.value) || 0)
                            setQtys(q => ({ ...q, [String(item.id)]: Math.min(remaining, toBaseQty(split.boxes, pieces, pack)) }))
                          }}
                          className="input w-14 text-right py-1 text-sm"
                          disabled={remaining <= 0}
                        />
                      </div>
                    ) : (
                      <NumberInput
                        aria-label={`Receive quantity ${String(item.product_name||item.product_id)}`}
                        min={0}
                        max={remaining}
                        value={current}
                        onChange={e => setQtys(q => ({ ...q, [String(item.id)]: Math.min(remaining, Math.max(0, parseFloat(e.target.value) || 0)) }))}
                        className="input w-20 text-right py-1 text-sm"
                        disabled={remaining <= 0}
                      />
                    )}
                  </td>
                  <td hidden={!supermarket}><input aria-label="Batch selling price" className="input w-24" type="number" min="0" step="0.01" placeholder="Common" value={prices[String(item.id)] ?? (item.selling_price == null ? '' : String(item.selling_price))} onChange={e => setPrices(p => ({ ...p, [String(item.id)]: e.target.value }))} /></td>
                  <td className="py-2 pl-3 min-w-[360px]">{remaining>0?<div>{Number(item.track_expiry)===1&&<span className="text-[10px] text-amber-400">Expiry required</span>}<BatchFields value={{...item,...batchValues[String(item.id)]}} onChange={(key,value)=>setBatchValues(old=>({...old,[String(item.id)]:{...old[String(item.id)],[key]:value}}))}/></div>:<span className="text-xs text-slate-500">Fully received</span>}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <div className="flex justify-end gap-3 pt-2">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary gap-1" onClick={submit} disabled={saving || (supermarket && !attachmentToken && !((po.attachments as PO[]|undefined)?.length))}>
            <PackageCheck size={14} /> Confirm Receipt
          </button>
        </div>
      </div>
    </Modal>
  )
}

function CreatePOModal({ onClose, onDone, mode='order' }: { onClose: () => void; onDone: () => void; mode?: 'order'|'direct' }) {
  const batchGuard=useBatchGuard()
  const { isSupermarket: supermarket }=useBusinessType()
  const direct=mode==='direct'
  const [entryId]=useState(()=>crypto.randomUUID())
  const [attachmentToken,setAttachmentToken]=useState('')
  const [suppliers, setSuppliers] = useState<Record<string, unknown>[]>([])
  const [products, setProducts]   = useState<Record<string, unknown>[]>([])
  const [supplierProducts, setSupplierProducts] = useState<Record<string, unknown>[]>([])
  const [onlySupplierProducts, setOnlySupplierProducts] = useState(true)
  const [analyzingStock, setAnalyzingStock] = useState(false)
  const [lowStockCount, setLowStockCount] = useState(0)
  const [sendWhatsApp, setSendWhatsApp] = useState(false)
  const [sendEmail, setSendEmail]       = useState(false)
  const [form, setForm] = useState<{
    supplier_id: string
    expected_date: string
    notes: string
    purchase_date: string
    supplier_invoice_number: string
    items: Array<{
      product_id: string
      quantity: number
      unit_cost: number
      selling_price: string
      entry_unit?:string
      free_quantity?:number;discount_amount?:number;mrp?:string
      batch_number?:string;mfg_date?:string;expiry_date?:string
      current_stock?: number
      min_stock_level?: number
      is_low_stock?: boolean
      is_out_of_stock?: boolean
      product_name?: string
      sku?: string
      barcode?: string
      unit?: string
    }>
  }>({
    supplier_id: '',
    expected_date: '',
    notes: '',
    purchase_date: colomboToday(),
    supplier_invoice_number: '',
    items: [{ product_id: '', quantity: 1, unit_cost: 0, selling_price: '' }]
  })
  const [saving, setSaving] = useState(false)
  const [newProduct, setNewProduct] = useState<{name:string;barcode:string;unit:string;cost_price:string;selling_price:string;track_expiry?:boolean}|null>(null)
  const [creatingProduct,setCreatingProduct]=useState(false)
  const createProduct=async()=>{
    if(!newProduct || creatingProduct) return
    if(!form.supplier_id || !newProduct.name.trim()) {toast.error('Select a supplier and enter a product name');return}
    const cost=Number(newProduct.cost_price),price=Number(newProduct.selling_price)
    if(!Number.isFinite(cost)||cost<=0||!Number.isFinite(price)||price<=0){toast.error('Enter valid purchase and selling prices');return}
    setCreatingProduct(true)
    try {
      const result=await window.api.products.create({...newProduct,name:newProduct.name.trim(),supplier_id:form.supplier_id,cost_price:cost,selling_price:price})
      if(!result.success){toast.error(String(result.error));return}
      const product={...newProduct,id:String(result.data.id),sku:String(result.data.sku||''),supplier_id:form.supplier_id,cost_price:cost,selling_price:price,stock:0,is_active:1}
      setProducts(old=>[...old,product]);setSupplierProducts(old=>[...old,product])
      const row={product_id:product.id,quantity:1,unit_cost:cost,selling_price:String(price),unit:product.unit,current_stock:0,product_name:product.name}
      setForm(old=>({...old,items:old.items.some(item=>!item.product_id)?old.items.map((item,index)=>index===old.items.findIndex(i=>!i.product_id)?row:item):[...old.items,row]}))
      setNewProduct(null);useProductsStore.getState().invalidate();toast.success('Product created and linked to this supplier')
    }catch(error){toast.error(String(error))}finally{setCreatingProduct(false)}
  }

  const selectedSupplier = suppliers.find(s => String(s.id) === form.supplier_id)

  useEffect(() => {
    window.api.admin.suppliers.list().then((r: { success: boolean; data: unknown; error?: string }) => {
      if (r.success) setSuppliers(r.data as Record<string, unknown>[])
      else toast.error(r.error || 'Failed to load suppliers')
    }).catch((err: unknown) => toast.error('Failed to load suppliers: ' + String(err)))
    window.api.products.list({ is_active: true }).then((r: { success: boolean; data: unknown; error?: string }) => {
      if (r.success) setProducts(r.data as Record<string, unknown>[])
      else toast.error(r.error || 'Failed to load products')
    }).catch((err: unknown) => toast.error('Failed to load products: ' + String(err)))
  }, [])

  const analyzeSupplierLowStock = async (supplierId: string) => {
    if (!supplierId) return
    setAnalyzingStock(true)
    try {
      const res = await window.api.purchases.supplierLowStock(supplierId)
      if (res?.success && res.data) {
        const suppProds = (res.data.allSupplierProducts as Record<string, unknown>[]) || []
        const lowStock = (res.data.lowStockItems as Record<string, unknown>[]) || []
        setSupplierProducts(suppProds)
        setLowStockCount(lowStock.length)

        if (suppProds.length > 0) {
          setOnlySupplierProducts(true)
        } else {
          setOnlySupplierProducts(false)
        }

        if (lowStock.length > 0) {
          setForm(f => ({
            ...f,
            supplier_id: supplierId,
            items: lowStock.map(item => ({
              product_id: String(item.product_id),
              product_name: String(item.product_name || ''),
              sku: String(item.sku || ''),
              barcode: String(item.barcode || ''),
              unit: String(item.unit || 'pcs'),
              quantity: Number(item.suggested_qty || item.quantity || 1),
              unit_cost: Number(item.unit_cost || 0),
              selling_price: item.selling_price != null ? String(item.selling_price) : '',
              current_stock: Number(item.current_stock ?? 0),
              min_stock_level: Number(item.min_stock_level ?? 5),
              is_low_stock: true,
              is_out_of_stock: Boolean(item.is_out_of_stock),
            }))
          }))
          toast.success(`⚡ Auto-analyzed: ${lowStock.length} low-stock items loaded into quotation!`, { duration: 4000 })
        } else {
          if (form.items.every(i => !i.product_id)) {
            setForm(f => ({
              ...f,
              supplier_id: supplierId,
              items: [{ product_id: '', quantity: 1, unit_cost: 0, selling_price: '' }]
            }))
          }
          if (suppProds.length > 0) {
            toast(`Supplier selected. ${suppProds.length} products found. All stock levels are currently healthy.`, { icon: 'ℹ️' })
          } else {
            toast(`Supplier selected. No existing products mapped to this supplier yet. You can select products from catalog.`, { icon: 'ℹ️' })
          }
        }
      } else {
        toast.error(res?.error || 'Failed to analyze supplier stock')
      }
    } catch (err) {
      console.error('Failed to analyze supplier stock:', err)
      toast.error('Failed to analyze supplier stock: ' + String(err))
    } finally {
      setAnalyzingStock(false)
    }
  }

  const handleSupplierSelect = (id: string) => {
    setForm(f => ({ ...f, supplier_id: id }))
    if (id) {
      analyzeSupplierLowStock(id)
    } else {
      setSupplierProducts([])
      setLowStockCount(0)
    }
  }

  const activeProducts = (onlySupplierProducts && supplierProducts.length > 0)
    ? supplierProducts
    : products

  const setItem = (index: number, key: string, value: unknown) => {
    setForm(f => ({
      ...f,
      items: f.items.map((item, i) => {
        if (i !== index) return item
        if (key === 'product_id') {
          const prod = activeProducts.find(p => String(p.id) === String(value))
            || products.find(p => String(p.id) === String(value))
          const curStock = prod ? Number(prod.current_stock ?? prod.stock ?? 0) : undefined
          const minStock = prod ? Number(prod.min_stock_level ?? 5) : undefined
          return {
            ...item,
            product_id: String(value),
            product_name: String(prod?.name || ''),
            sku: String(prod?.sku || ''),
            barcode: String(prod?.barcode || ''),
            unit: String(prod?.unit || 'pcs'),
            entry_unit: undefined,
            unit_cost: Number(prod?.cost_price || 0),
            selling_price: prod?.selling_price != null ? String(prod.selling_price) : '',
            current_stock: curStock,
            min_stock_level: minStock,
            is_low_stock: curStock !== undefined && minStock !== undefined && curStock <= minStock,
            is_out_of_stock: curStock !== undefined && curStock <= 0,
          }
        }
        return { ...item, [key]: value }
      })
    }))
  }

  const addItem = () => setForm(f => ({
    ...f,
    items: [...f.items, { product_id: '', quantity: 1, unit_cost: 0, selling_price: '' }]
  }))

  const clearItems = () => setForm(f => ({
    ...f,
    items: [{ product_id: '', quantity: 1, unit_cost: 0, selling_price: '' }]
  }))

  const removeItem = (i: number) => setForm(f => ({ ...f, items: f.items.filter((_, n) => n !== i) }))

  const totalAmount = purchaseMoney(form.items.reduce((s, i) => s + purchaseMoney(i.quantity * i.unit_cost) - (i.discount_amount||0), 0))

  const handlePrintQuotationSheet = async () => {
    if (!selectedSupplier) { toast.error('Select a supplier first'); return }
    const validItems = form.items.filter(i => i.product_id)
    if (validItems.length === 0) { toast.error('Add at least one product to quotation'); return }

    const settingsRes = await window.api?.settings?.get?.().catch(() => null)
    const settings = settingsRes?.success ? (settingsRes.data as Record<string, unknown>) : {}

    const printItems: PurchaseQuotationItem[] = validItems.map(item => {
      const prod = activeProducts.find(p => String(p.id) === String(item.product_id))
        || products.find(p => String(p.id) === String(item.product_id))
      return {
        product_name: item.product_name || String(prod?.name || 'Product'),
        sku: item.sku || String(prod?.sku || ''),
        barcode: item.barcode || String(prod?.barcode || ''),
        unit: item.entry_unit || item.unit || String(prod?.unit || 'pcs'),
        quantity: Number(item.quantity),
        unit_cost: Number(item.unit_cost),
        line_total: purchaseMoney(Number(item.quantity) * Number(item.unit_cost))-(item.discount_amount||0),
        current_stock: item.current_stock,
        min_stock_level: item.min_stock_level,
        is_low_stock: item.is_low_stock,
        is_out_of_stock: item.is_out_of_stock,
      }
    })

    printPurchaseQuotation({
      document_title: direct ? 'DIRECT STOCK RECEIPT ESTIMATE' : 'SUPPLIER PURCHASE QUOTATION / REORDER SHEET',
      document_number: `QUO-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${String(Math.floor(Math.random() * 900) + 100)}`,
      date: form.purchase_date || new Date().toISOString().slice(0, 10),
      expected_date: form.expected_date || undefined,
      company_name: String(settings.company_name || 'Nature Plantation'),
      company_address: String(settings.company_address || ''),
      company_phone: String(settings.company_phone || ''),
      company_email: String(settings.company_email || ''),
      supplier: {
        name: String(selectedSupplier.name || ''),
        business_name: selectedSupplier.business_name ? String(selectedSupplier.business_name) : undefined,
        phone: selectedSupplier.phone ? String(selectedSupplier.phone) : undefined,
        mobile_number: selectedSupplier.mobile_number ? String(selectedSupplier.mobile_number) : undefined,
        email: selectedSupplier.email ? String(selectedSupplier.email) : undefined,
        address: selectedSupplier.address ? String(selectedSupplier.address) : undefined,
        city: selectedSupplier.city ? String(selectedSupplier.city) : undefined,
      },
      items: printItems,
      total_amount: totalAmount,
      notes: form.notes || undefined,
    })
  }

  const save = async () => {
    if(saving||creatingProduct)return
    if (!form.supplier_id) { toast.error('Select a supplier'); return }
    if (form.items.some(i => !i.product_id)) { toast.error('All items need a product'); return }
    if(supermarket && direct && !attachmentToken) {toast.error('Supplier bill upload is required. Upload a PDF or image.');return}
    if(direct) { const missing=form.items.find(item=>item.selling_price==='' && !(Number(products.find(p=>p.id===item.product_id)?.selling_price)>0)); if(missing) { toast.error('Enter a Selling Price: this product has no common selling price yet.'); return } }
    setSaving(true)
    try {
      const prepared=await batchGuard.confirm(form.items);if(!prepared)return
      const res = await window.api.purchases.create({
        ...form,items:prepared,
        purchase_type: mode, entry_id: entryId, attachment_token: attachmentToken,
        open_whatsapp: !direct && sendWhatsApp,
        send_email: !direct && sendEmail,
      })
      if (res.success) {
        const poNum = (res.data as Record<string, unknown>)?.po_number
        let msg = direct ? `Stock received: ${poNum}` : `PO ${poNum} created successfully!`
        if (sendWhatsApp) msg += ' 📱 WhatsApp initiated.'
        if (sendEmail) msg += ' ✉️ Email notification triggered.'
        toast.success(msg)
        onDone()
      } else {
        toast.error(String(res.error))
      }
    } catch (err) {
      toast.error('Failed to create purchase order: ' + String(err))
    } finally {
      setSaving(false)
    }
  }

  useEffect(()=>{
    const handler=(event:KeyboardEvent)=>{
      if(event.ctrlKey&&event.key.toLowerCase()==='s'){event.preventDefault();if(!newProduct)void save()}
      if(event.ctrlKey&&event.key==='Enter'){event.preventDefault();if(!saving&&!newProduct)addItem()}
    }
    window.addEventListener('keydown',handler)
    return()=>window.removeEventListener('keydown',handler)
  },[form,saving,newProduct,attachmentToken])

  return (
    <Modal title={direct ? "Add Received Stock Directly" : "New Purchase Order / Quotation"} onClose={()=>{if(!saving)onClose()}} size="xl" footer={<div className="w-full flex flex-wrap justify-between items-center gap-2">
      <div>{!direct&&<button type="button" className="btn-secondary btn-sm" onClick={handlePrintQuotationSheet} disabled={!form.supplier_id||form.items.every(i=>!i.product_id)}><Printer size={13}/>Print Quotation Sheet</button>}</div>
      <div className="flex gap-2 items-center"><span className="font-semibold mr-2">Rs.{totalAmount.toLocaleString()}</span><button className="btn-ghost" disabled={saving} onClick={onClose}>Cancel</button><button className="btn-primary" onClick={save} disabled={saving||(supermarket&&direct&&!attachmentToken)}>{saving?'Saving...':direct?'Save & Receive Stock':'Create Purchase Order'}</button></div>
    </div>}>{batchGuard.dialog}
      <p className="text-xs mb-3" style={{color:'var(--text-3)'}}>Ctrl+Enter: add item · Ctrl+S: save · {direct?'Leave manufacture and expiry dates empty for non-expiring products.':'Batch, manufacture and expiry dates are entered when the stock is received.'}</p>
      <div className="space-y-3">
        <div className={supermarket?`grid grid-cols-1 sm:grid-cols-2 ${direct?'lg:grid-cols-3':'lg:grid-cols-4'} gap-3`:'grid grid-cols-2 gap-3'}>
          <div>
            <label className="label">Supplier *</label>
            <CreatableSearchSelect
              items={suppliers.map(s => ({ id: String(s.id), label: String(s.name) }))}
              value={form.supplier_id}
              onChange={handleSupplierSelect}
              placeholder="Select supplier..."
              createLabel="Add supplier"
              onCreate={async (name) => {
                const res = await window.api.admin.suppliers.create({ name })
                if (!res.success) { toast.error(res.error || 'Failed to create supplier'); return null }
                const created = { id: String(res.data.id), name }
                setSuppliers(prev => [...prev, created])
                toast.success(`Supplier "${name}" added`)
                return { id: created.id, label: created.name }
              }}
            />
          </div>
          {supermarket&&<><label className="label">{direct?'Stock Received Date':'Purchase Date'}<input aria-label="Purchase date" type="date" className="input" value={form.purchase_date} onChange={e=>setForm(f=>({...f,purchase_date:e.target.value}))}/></label><label className="label">Supplier Bill / Invoice Number<input aria-label="Supplier invoice number" className="input" value={form.supplier_invoice_number} onChange={e=>setForm(f=>({...f,supplier_invoice_number:e.target.value}))}/></label></>}
          <div hidden={direct}>
            <label className="label">{direct ? 'Delivery reference (optional)' : 'Expected Delivery Date'}</label>
            <input type="date" className="input" value={form.expected_date}
              onChange={e => setForm(f => ({ ...f, expected_date: e.target.value }))} />
          </div>
        </div>

        {supermarket && <>
          <PurchaseBillPicker onChange={setAttachmentToken} disabled={saving} required={direct} compact />
          {!direct && <p className="text-sm" style={{color:'var(--text-3)'}}>Supplier bill is optional when placing an order. Send the order by WhatsApp or email, then upload the supplier bill when receiving stock.</p>}
        </>}
        {supermarket && <p className="text-xs" style={{color:'var(--text-3)'}}>Enter prices per selected unit. Free quantity increases stock; line discounts reduce cost. Existing batch prices stay unchanged.</p>}
        {selectedSupplier && (
          <details className="text-xs"><summary className="cursor-pointer">Supplier contact</summary><div className="bg-surface-800/80 border border-slate-700/70 rounded-lg p-2.5 text-xs flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="text-slate-400">Supplier: </span>
              <span className="font-semibold text-white">{String(selectedSupplier.business_name || selectedSupplier.name)}</span>
              {selectedSupplier.city ? <span className="text-slate-400"> ({String(selectedSupplier.city)})</span> : null}
            </div>
            <div className="flex gap-4">
              <span className="text-emerald-400 flex items-center gap-1 font-medium">
                📱 {String(selectedSupplier.mobile_number || selectedSupplier.phone || 'No Phone')}
              </span>
              <span className="text-sky-400 flex items-center gap-1 font-medium">
                ✉️ {String(selectedSupplier.email || 'No Email')}
              </span>
            </div>
          </div></details>
        )}

        <details><summary className="text-xs cursor-pointer">Notes (optional)</summary>
          <textarea className="input resize-none h-16 text-sm" value={form.notes}
            onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional notes..." />
        </details>

        <div>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold">Items ({form.items.length})</p>
              {lowStockCount > 0 && (
                <span className="bg-red-500/20 text-red-300 border border-red-500/30 text-[11px] font-semibold px-2 py-0.5 rounded-full flex items-center gap-1">
                  ⚡ {lowStockCount} Low stock auto-analyzed
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {selectedSupplier && (
                <>
                  <label className="flex items-center gap-1.5 text-xs text-slate-300 hover:text-white cursor-pointer select-none bg-surface-900/60 px-2.5 py-1 rounded border border-slate-700/60" title="Only display products dealing with this supplier">
                    <input
                      type="checkbox"
                      checked={onlySupplierProducts}
                      disabled={supplierProducts.length === 0}
                      onChange={e => setOnlySupplierProducts(e.target.checked)}
                      className="rounded text-brand-500 focus:ring-brand-400 bg-surface-900 border-slate-700"
                    />
                    <span>Only supplier's products ({supplierProducts.length})</span>
                  </label>
                  <button
                    type="button"
                    className="btn-ghost btn-sm text-xs text-sky-400 hover:text-sky-300 gap-1 px-2 py-1"
                    onClick={() => analyzeSupplierLowStock(form.supplier_id)}
                    disabled={analyzingStock}
                    title="Re-analyze low stock for this supplier"
                  >
                    <RefreshCw size={11} className={analyzingStock ? 'animate-spin' : ''} />
                    Re-analyze
                  </button>
                </>
              )}
              {form.items.length > 1 && (
                <button type="button" className="btn-ghost btn-sm text-xs text-slate-400 hover:text-red-300" onClick={clearItems}>
                  Clear all
                </button>
              )}
              <button type="button" className="btn-ghost btn-sm gap-1" onClick={addItem}>
                <Plus size={12}/>Add Item
              </button>
              <button type="button" className="btn-secondary btn-sm" disabled={!form.supplier_id} onClick={()=>setNewProduct({name:'',barcode:'',unit:'pcs',cost_price:'',selling_price:''})}>New product</button>
            </div>
          </div>

          {newProduct && <div className="rounded-lg border p-3 mb-4 space-y-3" style={{borderColor:'var(--border)'}}>
            <p className="text-sm font-semibold">Create product for this supplier</p>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              <label className="text-xs">Product name<input autoFocus className="input mt-1" value={newProduct.name} onChange={e=>setNewProduct({...newProduct,name:e.target.value})}/></label>
              <label className="text-xs">Barcode<input className="input mt-1" value={newProduct.barcode} onChange={e=>setNewProduct({...newProduct,barcode:e.target.value})}/></label>
              <label className="text-xs">Base unit<select aria-label="Base unit" className="input mt-1" value={newProduct.unit} onChange={e=>setNewProduct({...newProduct,unit:e.target.value})}>{['pcs','kg','g','ltr','ml','bag','carton'].map(unit=><option key={unit}>{unit}</option>)}</select></label>
              <label className="text-xs">Purchase price<input className="input mt-1" type="number" min="0.01" step="any" value={newProduct.cost_price} onChange={e=>setNewProduct({...newProduct,cost_price:e.target.value})}/></label>
              <label className="text-xs">Selling price<input className="input mt-1" type="number" min="0.01" step="any" value={newProduct.selling_price} onChange={e=>setNewProduct({...newProduct,selling_price:e.target.value})}/></label>
            </div>
            <div className="flex gap-2"><button type="button" disabled={creatingProduct} className="btn-primary btn-sm" onClick={createProduct}>{creatingProduct?'Creating…':'Create and add'}</button><button type="button" disabled={creatingProduct} className="btn-ghost btn-sm" onClick={()=>setNewProduct(null)}>Cancel</button></div>
            <label className="flex gap-2 text-xs"><input type="checkbox" checked={!!newProduct.track_expiry} onChange={e=>setNewProduct({...newProduct,track_expiry:e.target.checked})}/>Require an expiry date when receiving this product</label>
          </div>}
          {/* Column headers */}
          <div className="grid gap-2 mb-1 px-1" style={{ gridTemplateColumns: supermarket ? 'minmax(170px,1fr) 65px 90px 95px 80px 20px' : '1fr 72px 110px 80px 20px' }}>
            {(supermarket ? ['Product','Qty','Purchase Price','Selling Price','Total',''] : ['Product', 'Qty', 'Unit Cost', 'Total', '']).map((h, i) => (
              <p key={h} className={`text-xs font-medium${i === 0 ? ' min-w-0 truncate' : ''}`} style={{ color: 'var(--text-3)' }}>{h}</p>
            ))}
          </div>

          <div className="space-y-1.5">
            {form.items.map((item, idx) => (
              <div key={idx} className="grid gap-2 items-center rounded-lg px-1 py-1.5"
                style={{ gridTemplateColumns: supermarket ? 'minmax(170px,1fr) 65px 90px 95px 80px 20px' : '1fr 72px 110px 80px 20px', background: 'var(--bg-soft)', minWidth: 0 }}>
                {direct&&<div className="col-span-full order-1"><BatchFields value={item} onChange={(key,value)=>setItem(idx,key,value)}/></div>}
                {supermarket&&<div className="col-span-full order-2 grid grid-cols-3 gap-2">
                  <label className="text-xs">Free quantity<input aria-label={`Free quantity ${idx+1}`} className="input" type="number" min="0" step="any" value={item.free_quantity??0} onChange={e=>setItem(idx,'free_quantity',Number(e.target.value))}/></label>
                  <label className="text-xs">Line discount (Rs.)<input aria-label={`Line discount ${idx+1}`} className="input" type="number" min="0" step="0.01" value={item.discount_amount??0} onChange={e=>setItem(idx,'discount_amount',Number(e.target.value))}/></label>
                  <label className="text-xs">MRP per entry unit (incl. tax)<input aria-label={`MRP ${idx+1}`} className="input" type="number" min="0.01" step="any" value={item.mrp??''} onChange={e=>setItem(idx,'mrp',e.target.value)}/></label>
                </div>}
                {supermarket&&<label className="col-span-full order-2 text-xs flex gap-3 items-center">Entry unit<select aria-label={`Entry unit ${idx+1}`} className="input w-32" value={item.entry_unit||item.unit||'pcs'} onChange={e=>{setItem(idx,'entry_unit',e.target.value);setItem(idx,'quantity',1);setItem(idx,'free_quantity',0);setItem(idx,'discount_amount',0);setItem(idx,'mrp','');setItem(idx,'unit_cost',0);setItem(idx,'selling_price','')}}>{Array.from(new Set([item.unit||'pcs','pcs','kg','g','ltr','ml','bag','carton'])).map(unit=><option key={unit}>{unit}</option>)}</select><span style={{color:'var(--text-3)'}}>Quantities and prices use this unit; inventory is stored in {item.unit||'the product base unit'}.</span></label>}
                <div className="min-w-0">
                  <ProductSearchSelect
                    products={activeProducts}
                    value={item.product_id}
                    onChange={id => setItem(idx, 'product_id', id)}
                  />
                  {item.current_stock !== undefined && (
                    <div className="text-[10px] flex items-center gap-1.5 mt-0.5 px-0.5">
                      {item.is_out_of_stock ? (
                        <span className="text-red-400 font-bold">🚨 Out of stock (0)</span>
                      ) : item.is_low_stock ? (
                        <span className="text-amber-400 font-semibold">⚠️ Low: {item.current_stock} / Min: {item.min_stock_level ?? 5}</span>
                      ) : (
                        <span className="text-emerald-400">Stock: {item.current_stock}</span>
                      )}
                    </div>
                  )}
                </div>
                <NumberInput
                  aria-label={`Paid quantity ${idx+1}`}
                  min={0.000001}
                  step="any"
                  className="input text-sm py-1.5 text-center"
                  value={item.quantity}
                  onChange={e => setItem(idx, 'quantity', Number(e.target.value))}
                />
                <NumberInput
                  aria-label={`Purchase price ${idx+1}`}
                  min={0}
                  className="input text-sm py-1.5"
                  value={item.unit_cost}
                  onChange={e => setItem(idx, 'unit_cost', parseFloat(e.target.value) || 0)}
                />
                {supermarket && <input aria-label={`Selling price ${idx+1}`} type="number" min="0" step="0.01" className="input text-sm" placeholder="Common" value={item.selling_price} onChange={e=>setItem(idx,'selling_price',e.target.value)} />}
                <p className="text-sm font-semibold text-right pr-1">
                  Rs.{(purchaseMoney(item.quantity * item.unit_cost)-(item.discount_amount||0)).toLocaleString()}
                </p>
                <div className="flex justify-center">
                  {form.items.length > 1 && (
                    <button className="text-red-400 hover:text-red-300" onClick={() => removeItem(idx)}>
                      <XCircle size={14}/>
                    </button>
                  )}
                </div>
                {supermarket&&item.product_id&&<PurchasePricingPanel item={item}/>}
              </div>
            ))}
          </div>

          <div className="flex justify-end mt-2 text-sm font-bold">
            Total: Rs.{totalAmount.toLocaleString()}
          </div>
        </div>

        <div hidden={direct} className="bg-surface-800/80 border border-slate-700/60 rounded-lg p-3 space-y-2">
          <p className="text-xs font-semibold text-slate-300">Direct Supplier Notification on Order Creation</p>
          <div className="flex flex-wrap gap-4 text-xs">
            <label className="flex items-center gap-2 cursor-pointer text-slate-300 hover:text-white select-none">
              <input
                type="checkbox"
                checked={sendWhatsApp}
                onChange={e => setSendWhatsApp(e.target.checked)}
                className="rounded text-emerald-500 focus:ring-emerald-400 bg-surface-900 border-slate-700"
              />
              <span className="flex items-center gap-1 text-emerald-400 font-medium">
                📱 Send via WhatsApp (Direct chat / web)
              </span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer text-slate-300 hover:text-white select-none">
              <input
                type="checkbox"
                checked={sendEmail}
                onChange={e => setSendEmail(e.target.checked)}
                className="rounded text-sky-500 focus:ring-sky-400 bg-surface-900 border-slate-700"
              />
              <span className="flex items-center gap-1 text-sky-400 font-medium">
                ✉️ Send via Email (Branded HTML PO)
              </span>
            </label>
          </div>
        </div>

      </div>
    </Modal>
  )
}
