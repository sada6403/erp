import { useState, useEffect } from 'react'
import Modal from '@/components/shared/Modal'
import { Printer, FileDown, FileSpreadsheet } from 'lucide-react'
import toast from 'react-hot-toast'
import { buildInvoicePrintPayload, type InvoiceDetail } from '@/lib/invoicePrint'

const fmt = (n: unknown) => Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function InvoiceDetailModal({ invoiceId, onClose }: { invoiceId: string; onClose: () => void }) {
  const [detail, setDetail] = useState<InvoiceDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [printing, setPrinting] = useState(false)
  const [savingPdf, setSavingPdf] = useState(false)
  const [exportingExcel, setExportingExcel] = useState(false)

  useEffect(() => {
    setLoading(true)
    window.api.reports.transactionDetail(invoiceId).then((res: { success: boolean; data?: InvoiceDetail; error?: string }) => {
      if (res.success) setDetail(res.data || null)
      else toast.error(res.error || 'Failed to load details')
    }).catch((err: Error) => toast.error(err.message || 'Failed to load details'))
      .finally(() => setLoading(false))
  }, [invoiceId])

  const docWord = detail?.bill_type === 'QUOTATION' ? 'Quotation' : 'Invoice'

  const handlePrint = async () => {
    if (!detail) return
    setPrinting(true)
    try {
      const res = await window.api.printer.printInvoice(buildInvoicePrintPayload(detail))
      if (res.success) toast.success('Sent to printer')
      else toast.error(res.error || 'Failed to print')
    } catch (err) {
      toast.error((err as Error).message || 'Failed to print')
    } finally {
      setPrinting(false)
    }
  }

  const handleSavePdf = async () => {
    if (!detail) return
    setSavingPdf(true)
    try {
      const res = await window.api.printer.exportInvoicePdf(buildInvoicePrintPayload(detail))
      if (res.success) toast.success('PDF saved')
      else if (!res.cancelled) toast.error(res.error || 'Failed to save PDF')
    } catch (err) {
      toast.error((err as Error).message || 'Failed to save PDF')
    } finally {
      setSavingPdf(false)
    }
  }

  const handleExportExcel = async () => {
    if (!detail) return
    setExportingExcel(true)
    try {
      const rows = detail.items.map(i => ({
        Product: i.product_name, SKU: i.sku, Unit: i.unit, Quantity: i.quantity,
        'Unit Price': i.unit_price, Discount: i.discount, Tax: i.tax, Total: i.total,
      }))
      const res = await window.api.reports.exportExcel({
        filename: `${docWord}-${detail.invoice_number}`,
        sheets: [{ name: detail.invoice_number.slice(0, 31), rows }],
      })
      if (res.success) toast.success('Excel exported')
      else if (!res.cancelled) toast.error(res.error || 'Failed to export Excel')
    } catch (err) {
      toast.error((err as Error).message || 'Failed to export Excel')
    } finally {
      setExportingExcel(false)
    }
  }

  return (
    <Modal title={loading ? 'Loading…' : `${docWord} ${detail?.invoice_number || ''}`} onClose={onClose} size="lg"
      footer={<>
        <button onClick={onClose} className="btn-secondary">Close</button>
        <button onClick={handleExportExcel} disabled={!detail || exportingExcel} className="btn-secondary gap-1.5">
          <FileSpreadsheet size={14} /> {exportingExcel ? 'Exporting…' : 'Export Excel'}
        </button>
        <button onClick={handleSavePdf} disabled={!detail || savingPdf} className="btn-secondary gap-1.5">
          <FileDown size={14} /> {savingPdf ? 'Saving…' : 'Save PDF'}
        </button>
        <button onClick={handlePrint} disabled={!detail || printing} className="btn-primary gap-1.5">
          <Printer size={14} /> {printing ? 'Printing…' : 'Print'}
        </button>
      </>}>
      {loading ? (
        <div className="text-center py-16 text-slate-500">Loading…</div>
      ) : !detail ? (
        <div className="text-center py-16 text-slate-500">Not found</div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
            <div className="card">
              <p className="text-xs text-slate-400 mb-1">Customer</p>
              <p className="font-medium" style={{ color: 'var(--text-1)' }}>{detail.customer_name || 'Walk-in Customer'}</p>
              {detail.customer_phone && <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>{detail.customer_phone}</p>}
            </div>
            <div className="card">
              <p className="text-xs text-slate-400 mb-1">Branch / Cashier</p>
              <p className="font-medium" style={{ color: 'var(--text-1)' }}>{detail.branch_name}</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>{detail.cashier_name}</p>
            </div>
            <div className="card">
              <p className="text-xs text-slate-400 mb-1">Date</p>
              <p className="font-medium" style={{ color: 'var(--text-1)' }}>{new Date(detail.created_at).toLocaleString()}</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>{detail.status}</p>
            </div>
          </div>

          <div>
            <p className="text-xs font-medium text-slate-400 mb-2">Items ({detail.items.length})</p>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b" style={{ borderColor: 'var(--border)' }}>
                  {['Product', 'SKU', 'Qty', 'Unit Price', 'Discount', 'Tax', 'Total'].map(h => (
                    <th key={h} className="py-1.5 pr-3 text-left text-slate-500 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {detail.items.map(item => (
                  <tr key={item.id} className="border-b" style={{ borderColor: 'var(--border)' }}>
                    <td className="py-1.5 pr-3" style={{ color: 'var(--text-1)' }}>{item.product_name}</td>
                    <td className="py-1.5 pr-3 text-slate-400 font-mono">{item.sku || '-'}</td>
                    <td className="py-1.5 pr-3 text-slate-300">{item.quantity} {item.unit || ''}</td>
                    <td className="py-1.5 pr-3 text-slate-300">{fmt(item.unit_price)}</td>
                    <td className="py-1.5 pr-3 text-orange-400">{item.discount > 0 ? `-${fmt(item.discount)}` : '-'}</td>
                    <td className="py-1.5 pr-3 text-slate-400">{item.tax > 0 ? fmt(item.tax) : '-'}</td>
                    <td className="py-1.5 pr-3 font-medium" style={{ color: 'var(--text-1)' }}>{fmt(item.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs font-medium text-slate-400 mb-2">Payments</p>
              <div className="space-y-1">
                {detail.payments.map(p => (
                  <div key={p.id} className="flex justify-between text-xs">
                    <span className="text-slate-300">{p.method}{p.reference ? ` (${p.reference})` : ''}</span>
                    <span className="text-green-400 font-medium">{fmt(p.amount)}</span>
                  </div>
                ))}
                {detail.payments.length === 0 && <p className="text-xs text-slate-500">No payment records</p>}
              </div>
            </div>
            <div className="text-sm space-y-1">
              <div className="flex justify-between"><span className="text-slate-400">Subtotal</span><span>{fmt(detail.subtotal)}</span></div>
              <div className="flex justify-between"><span className="text-slate-400">Discount</span><span className="text-orange-400">{detail.discount_amount > 0 ? `-${fmt(detail.discount_amount)}` : '-'}</span></div>
              <div className="flex justify-between"><span className="text-slate-400">Tax</span><span>{detail.tax_amount > 0 ? fmt(detail.tax_amount) : '-'}</span></div>
              <div className="flex justify-between font-semibold text-base pt-1 border-t" style={{ borderColor: 'var(--border)' }}>
                <span>Total</span><span>{fmt(detail.total_amount)}</span>
              </div>
              {detail.due_amount > 0 && (
                <div className="flex justify-between text-yellow-400 font-medium"><span>Due</span><span>{fmt(detail.due_amount)}</span></div>
              )}
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}
