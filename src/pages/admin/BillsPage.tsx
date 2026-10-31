import { useState, useEffect, useCallback } from 'react'
import {
  Search, Eye, Printer, RefreshCw, ChevronLeft, ChevronRight,
  FileSpreadsheet, Upload, FileDown, CheckCircle2, AlertTriangle, HelpCircle
} from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
import Modal from '@/components/shared/Modal'
import InvoiceDetailModal from '@/components/shared/InvoiceDetailModal'
import { buildInvoicePrintPayload, type InvoiceDetail } from '@/lib/invoicePrint'
import { useAuthStore } from '@/store/authStore'
import toast from 'react-hot-toast'

type Row = Record<string, unknown>

interface ImportResult {
  success: boolean
  filePath?: string
  format?: 'tabular' | 'matrix'
  importedBills?: number
  importedItems?: number
  totalSalesAmount?: number
  skippedCount?: number
  warnings?: string[]
  error?: string
}

const PAGE_SIZE = 50

const STATUS_COLORS: Record<string, string> = {
  completed: 'bg-green-500/10 text-green-400',
  cancelled: 'bg-red-500/10 text-red-400',
  returned: 'bg-orange-500/10 text-orange-400',
}

export default function BillsPage() {
  const { user } = useAuthStore()
  const isAdmin = Boolean((user?.role?.permissions as Record<string, boolean>)?.all)

  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [branchId, setBranchId] = useState('')
  const [branches, setBranches] = useState<Row[]>([])
  const [page, setPage] = useState(0)
  const [total, setTotal] = useState(0)
  const [viewingId, setViewingId] = useState<string | null>(null)
  const [rowPrintingId, setRowPrintingId] = useState<string | null>(null)

  // Export & Import states
  const [exporting, setExporting] = useState(false)
  const [downloadingTemplate, setDownloadingTemplate] = useState(false)
  const [showImportModal, setShowImportModal] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importDeductStock, setImportDeductStock] = useState(false)
  const [importBranchId, setImportBranchId] = useState('')
  const [importResult, setImportResult] = useState<ImportResult | null>(null)

  // Branch filtering is admin-only — non-admins are auto-scoped to their own branch
  useEffect(() => {
    if (!isAdmin) return
    window.api.admin.branches.list().then((res: { success: boolean; data?: Row[]; error?: string }) => {
      if (res.success) setBranches(res.data || [])
      else toast.error(res.error || 'Failed to load branches')
    }).catch((err: Error) => toast.error(err.message || 'Failed to load branches'))
  }, [isAdmin])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await window.api.reports.transactions({
        status: 'completed',
        search: search.trim() || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        branchId: (isAdmin && branchId) || undefined,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      })
      if (res.success) {
        setRows(res.data as Row[])
        setTotal((res.total as number) ?? (res.data as Row[]).length)
      } else {
        toast.error(res.error || 'Failed to load bills')
      }
    } catch (err) {
      toast.error((err as Error).message || 'Failed to load bills')
    } finally {
      setLoading(false)
    }
  }, [search, dateFrom, dateTo, branchId, isAdmin, page])

  useEffect(() => { load() }, [load])

  const quickPrint = async (id: string) => {
    setRowPrintingId(id)
    try {
      const res = await window.api.reports.transactionDetail(id)
      if (!res.success) { toast.error(res.error || 'Failed to load bill'); return }
      const printRes = await window.api.printer.printInvoice(buildInvoicePrintPayload(res.data as InvoiceDetail))
      if (printRes.success) toast.success('Sent to printer')
      else toast.error(printRes.error || 'Failed to print')
    } catch (err) {
      toast.error((err as Error).message || 'Failed to print')
    } finally {
      setRowPrintingId(null)
    }
  }

  // Export bills to formatted multi-tab Excel
  const handleExportExcel = async () => {
    setExporting(true)
    try {
      const res = await window.api.invoices.exportExcel({
        status: 'completed',
        search: search.trim() || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        branchId: (isAdmin && branchId) || undefined,
      })
      if (res.success) {
        toast.success(`Successfully exported ${res.exportedBills} bills (${res.exportedItems} items) to Excel!`)
      } else if (!res.cancelled) {
        toast.error(res.error || 'Failed to export bills to Excel')
      }
    } catch (err) {
      toast.error((err as Error).message || 'Failed to export bills')
    } finally {
      setExporting(false)
    }
  }

  // Download past sales import Excel template
  const handleDownloadTemplate = async () => {
    setDownloadingTemplate(true)
    try {
      const res = await window.api.invoices.downloadTemplate()
      if (res.success) {
        toast.success('Past sales template downloaded successfully')
      } else if (!res.cancelled) {
        toast.error(res.error || 'Failed to download template')
      }
    } catch (err) {
      toast.error((err as Error).message || 'Failed to download template')
    } finally {
      setDownloadingTemplate(false)
    }
  }

  // Import past sales
  const handleImportSales = async () => {
    setImporting(true)
    setImportResult(null)
    try {
      const res = await window.api.invoices.importExcel({
        deductStock: importDeductStock,
        branchId: (isAdmin && importBranchId) || undefined,
      })
      if (res.success) {
        setImportResult(res)
        toast.success(`Successfully imported ${res.importedBills} past bills!`)
        load()
      } else if (!res.cancelled) {
        toast.error(res.error || 'Failed to import past sales')
      }
    } catch (err) {
      toast.error((err as Error).message || 'Failed to import past sales')
    } finally {
      setImporting(false)
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader
        title="Bills"
        subtitle={`${total.toLocaleString()} completed bill(s)`}
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={handleDownloadTemplate}
              disabled={downloadingTemplate}
              className="btn-secondary btn-sm gap-1.5"
              title="Download past sales Excel template with instructions"
            >
              <FileDown size={14} className={downloadingTemplate ? 'animate-bounce' : ''} />
              <span>Template</span>
            </button>

            <button
              onClick={() => {
                setImportResult(null)
                setShowImportModal(true)
              }}
              className="btn-secondary btn-sm gap-1.5"
              title="Import past sales from Excel (.xlsx, .xls, .csv)"
            >
              <Upload size={14} />
              <span>Import Past Sales</span>
            </button>

            <button
              onClick={handleExportExcel}
              disabled={exporting || loading}
              className="btn-primary btn-sm gap-1.5"
              title="Export bills and line items to Excel (.xlsx)"
            >
              <FileSpreadsheet size={14} className={exporting ? 'animate-spin' : ''} />
              <span>{exporting ? 'Exporting...' : 'Export to Excel'}</span>
            </button>

            <button
              onClick={load}
              disabled={loading}
              className="btn-secondary btn-sm gap-1.5"
              title="Refresh bills"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              <span>Refresh</span>
            </button>
          </div>
        }
      />

      {/* Filter toolbar */}
      <div className="flex flex-wrap items-center gap-3 px-6 py-3 border-b border-slate-800 flex-shrink-0">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            value={search}
            onChange={e => { setPage(0); setSearch(e.target.value) }}
            placeholder="Search by bill number or customer..."
            className="input pl-8 text-sm"
          />
        </div>
        {isAdmin && (
          <select
            value={branchId}
            onChange={e => { setPage(0); setBranchId(e.target.value) }}
            className="input text-sm w-auto"
          >
            <option value="">All Branches</option>
            {branches.map(b => (
              <option key={b.id as string} value={b.id as string}>{b.name as string}</option>
            ))}
          </select>
        )}
        <div className="flex items-center gap-2 text-sm">
          <span className="text-slate-500">From</span>
          <input
            type="date"
            value={dateFrom}
            onChange={e => { setPage(0); setDateFrom(e.target.value) }}
            className="input text-sm"
          />
          <span className="text-slate-500">To</span>
          <input
            type="date"
            value={dateTo}
            onChange={e => { setPage(0); setDateTo(e.target.value) }}
            className="input text-sm"
          />
          {(dateFrom || dateTo) && (
            <button
              onClick={() => { setPage(0); setDateFrom(''); setDateTo('') }}
              className="btn-ghost btn-sm"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Bills Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full">
          <thead className="sticky top-0 bg-surface-900 z-10">
            <tr>
              {['Bill #', 'Date', 'Customer', 'Branch', 'Total', 'Payment', 'Status', ''].map(h => (
                <th key={h} className="table-header px-4 py-3 text-left">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="text-center py-16 text-slate-500">Loading bills...</td></tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center py-16 text-slate-500">
                  <p className="text-base font-medium text-slate-400">No bills found</p>
                  <p className="text-xs text-slate-500 mt-1">
                    Try adjusting your filters, or use "Import Past Sales" to load past bills from Excel.
                  </p>
                </td>
              </tr>
            ) : rows.map(r => (
              <tr
                key={r.id as string}
                className="table-row group cursor-pointer"
                onClick={() => setViewingId(r.id as string)}
              >
                <td className="table-cell font-mono text-xs text-amber-400 font-semibold">{r.invoice_number as string}</td>
                <td className="table-cell text-xs text-slate-400 whitespace-nowrap">{new Date(r.created_at as string).toLocaleString()}</td>
                <td className="table-cell">
                  {r.customer_name ? (
                    <div>
                      <p className="text-sm font-medium">{r.customer_name as string}</p>
                      {Boolean(r.customer_phone) && <p className="text-xs text-slate-500">{r.customer_phone as string}</p>}
                    </div>
                  ) : <span className="text-xs text-slate-500">Walk-in</span>}
                </td>
                <td className="table-cell text-slate-400 text-sm">{(r.branch_name as string) || '—'}</td>
                <td className="table-cell font-semibold text-emerald-400">Rs.{Number(r.total_amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                <td className="table-cell text-xs text-slate-400 capitalize">{(r.payment_methods as string) || 'Cash'}</td>
                <td className="table-cell">
                  <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${STATUS_COLORS[r.status as string] || 'bg-slate-500/10 text-slate-400'}`}>
                    {r.status as string}
                  </span>
                </td>
                <td className="table-cell text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    <button
                      onClick={e => { e.stopPropagation(); setViewingId(r.id as string) }}
                      className="flex items-center gap-1 px-2.5 py-1 rounded bg-surface-700 hover:bg-surface-600 text-slate-200 text-xs transition-colors"
                    >
                      <Eye className="w-3.5 h-3.5" /> View
                    </button>
                    <button
                      onClick={e => { e.stopPropagation(); quickPrint(r.id as string) }}
                      disabled={rowPrintingId === r.id}
                      className="flex items-center gap-1 px-2.5 py-1 rounded bg-surface-700 hover:bg-surface-600 text-slate-200 text-xs disabled:opacity-50 transition-colors"
                    >
                      <Printer className="w-3.5 h-3.5" /> {rowPrintingId === r.id ? '…' : 'Print'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="px-6 py-3 border-t border-surface-700 flex items-center justify-between text-sm flex-shrink-0">
          <span className="text-slate-400">
            Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total.toLocaleString()}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(p => p - 1)}
              disabled={page === 0}
              className="p-1.5 rounded hover:bg-surface-700 disabled:opacity-30 text-slate-300"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-slate-300 min-w-[80px] text-center">Page {page + 1} / {totalPages}</span>
            <button
              onClick={() => setPage(p => p + 1)}
              disabled={page >= totalPages - 1}
              className="p-1.5 rounded hover:bg-surface-700 disabled:opacity-30 text-slate-300"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Invoice Detail Modal */}
      {viewingId && (
        <InvoiceDetailModal invoiceId={viewingId} onClose={() => setViewingId(null)} />
      )}

      {/* Import Past Sales Modal */}
      {showImportModal && (
        <Modal
          title="Import Past Sales from Excel"
          size="lg"
          onClose={() => {
            if (!importing) {
              setShowImportModal(false)
              setImportResult(null)
            }
          }}
          footer={
            <div className="flex items-center justify-between w-full">
              <button
                type="button"
                onClick={handleDownloadTemplate}
                disabled={downloadingTemplate || importing}
                className="btn-ghost btn-sm gap-1.5 text-xs text-sky-400 hover:text-sky-300"
              >
                <FileDown size={14} /> Download Sample Template (.xlsx)
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowImportModal(false)}
                  disabled={importing}
                  className="btn-secondary btn-sm"
                >
                  {importResult ? 'Close' : 'Cancel'}
                </button>
                {!importResult && (
                  <button
                    type="button"
                    onClick={handleImportSales}
                    disabled={importing}
                    className="btn-primary btn-sm gap-1.5"
                  >
                    <Upload size={14} className={importing ? 'animate-spin' : ''} />
                    <span>{importing ? 'Importing Sales...' : 'Select Excel File to Import'}</span>
                  </button>
                )}
              </div>
            </div>
          }
        >
          <div className="space-y-4">
            {importResult ? (
              <div className="space-y-4">
                <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-start gap-3">
                  <CheckCircle2 className="w-6 h-6 text-emerald-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <h3 className="text-base font-semibold text-emerald-300">Sales Import Completed Successfully!</h3>
                    <p className="text-xs text-emerald-400/80 mt-0.5">
                      The past sales records have been created in the database and linked with products and customers.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="p-3 rounded-lg bg-surface-800 border border-surface-700">
                    <p className="text-xs text-slate-400">Bills Imported</p>
                    <p className="text-xl font-bold text-slate-100 mt-1">{importResult.importedBills?.toLocaleString()}</p>
                  </div>
                  <div className="p-3 rounded-lg bg-surface-800 border border-surface-700">
                    <p className="text-xs text-slate-400">Items Sold</p>
                    <p className="text-xl font-bold text-sky-400 mt-1">{importResult.importedItems?.toLocaleString()}</p>
                  </div>
                  <div className="p-3 rounded-lg bg-surface-800 border border-surface-700">
                    <p className="text-xs text-slate-400">Total Revenue</p>
                    <p className="text-xl font-bold text-emerald-400 mt-1">Rs. {Number(importResult.totalSalesAmount || 0).toLocaleString()}</p>
                  </div>
                  <div className="p-3 rounded-lg bg-surface-800 border border-surface-700">
                    <p className="text-xs text-slate-400">Skipped / Duplicates</p>
                    <p className="text-xl font-bold text-amber-400 mt-1">{importResult.skippedCount ?? 0}</p>
                  </div>
                </div>

                {importResult.warnings && importResult.warnings.length > 0 && (
                  <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-400">
                      <AlertTriangle size={14} />
                      <span>Notices & Unmatched Columns ({importResult.warnings.length})</span>
                    </div>
                    <ul className="mt-2 text-xs text-amber-300/80 max-h-36 overflow-y-auto space-y-1 pl-4 list-disc">
                      {importResult.warnings.map((w, idx) => (
                        <li key={idx}>{w}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="p-3.5 rounded-xl bg-surface-800 border border-surface-700">
                    <div className="flex items-center gap-2 text-sm font-semibold text-slate-200">
                      <span className="w-6 h-6 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center text-xs">1</span>
                      Standard Tabular Excel
                    </div>
                    <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
                      Columns: <code className="text-amber-400">Bill No</code>, <code className="text-amber-400">Date</code>, <code className="text-amber-400">Customer</code>, <code className="text-amber-400">Product / SKU</code>, <code className="text-amber-400">Qty</code>, <code className="text-amber-400">Price</code>.
                      Multiple items on the same bill are grouped automatically.
                    </p>
                  </div>

                  <div className="p-3.5 rounded-xl bg-surface-800 border border-surface-700">
                    <div className="flex items-center gap-2 text-sm font-semibold text-slate-200">
                      <span className="w-6 h-6 rounded-full bg-purple-500/20 text-purple-400 flex items-center justify-center text-xs">2</span>
                      Food City Matrix Register
                    </div>
                    <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
                      Upload directly from supermarket registers (like Food City Excel) where product names are horizontal column headers and row cells contain quantities.
                    </p>
                  </div>
                </div>

                {isAdmin && (
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1">Target Branch</label>
                    <select
                      value={importBranchId}
                      onChange={e => setImportBranchId(e.target.value)}
                      className="input text-sm w-full"
                    >
                      <option value="">Default Branch</option>
                      {branches.map(b => (
                        <option key={b.id as string} value={b.id as string}>{b.name as string}</option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="p-3 rounded-xl bg-surface-800/80 border border-surface-700">
                  <label className="flex items-start gap-3 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={importDeductStock}
                      onChange={e => setImportDeductStock(e.target.checked)}
                      className="mt-1 rounded bg-surface-700 border-surface-600 text-blue-500 focus:ring-0"
                    />
                    <div>
                      <span className="text-sm font-medium text-slate-200">Deduct physical inventory stock?</span>
                      <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">
                        <strong className="text-slate-300">Default: Off.</strong> Keep this unchecked for historical/past sales records so your current shelf inventory is not altered. Check this only if you want these past sales to reduce current physical stock counts.
                      </p>
                    </div>
                  </label>
                </div>

                <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-start gap-2.5">
                  <HelpCircle size={16} className="text-blue-400 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-blue-300 leading-relaxed">
                    Existing bills with matching Bill Numbers will be safely skipped to avoid duplicate entries. Customers not yet in the system will be automatically registered.
                  </p>
                </div>
              </>
            )}
          </div>
        </Modal>
      )}
    </div>
  )
}
