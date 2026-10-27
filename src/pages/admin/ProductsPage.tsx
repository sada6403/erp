import ProductVariantBuilder, { type VariantItem } from '@/components/admin/ProductVariantBuilder'
import { useState, useEffect, useMemo } from 'react'
import PageHeader from '@/components/shared/PageHeader'
import Modal from '@/components/shared/Modal'
import NumberInput from '@/components/shared/NumberInput'
import type { Product, Category, Supplier } from '@/types'
import {
  Plus, Search, Edit2, Package, ToggleLeft, ToggleRight, Upload, X, Download,
  FileSpreadsheet, Trash2, Lock, Calculator, Info, AlertTriangle, RefreshCw, Clock, Printer,
  ShieldCheck, AlertCircle, CheckCircle2, ChevronDown, Settings2, Barcode
} from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuthStore } from '@/store/authStore'
import { useProductsStore } from '@/store/productsStore'
import { resolveImageSrc } from '@/lib/imageUrl'
import { canManageAllBranchStock, canManuallyEditBranchStock, DEFAULT_MAIN_BRANCH_ID, isCompanyAdmin as hasCompanyAdminAccess } from '@/lib/branchAccess'

type UOMRow = { id?: string; uom_name: string; conversion_factor: number; is_base: boolean; wastage: number }
type CatalogAudit = {
  totalProducts: number
  missingSku: number
  duplicateSkuGroups: number
  duplicateSkuProducts: number
  totalCategories: number
  rootCategories: number
  missingShortCodes: number
  nonNormalizedCategories: number
}

interface BranchItem {
  id: string
  name: string
  code?: string
  is_active?: boolean | number
}

const PRODUCT_PAGE_SIZE = 100

export default function ProductsPage() {
  const { products, categories, suppliers, loading, load: loadProducts } = useProductsStore()
  const { user: currentUser } = useAuthStore()
  const isCompanyAdmin = hasCompanyAdminAccess(currentUser)
  const canManageAllBranches = canManageAllBranchStock(currentUser)
  const ownBranchId = String(currentUser?.branch?.id || currentUser?.branch_id || '')
  const [search, setSearch]         = useState('')
  const [catFilter, setCatFilter]   = useState('')
  const [brandFilter, setBrandFilter] = useState('')
  const [branchFilter, setBranchFilter] = useState(() => canManageAllBranches ? '' : ownBranchId)
  const [branches, setBranches]     = useState<BranchItem[]>([])
  const [showForm, setShowForm]     = useState(false)
  const [editing, setEditing]       = useState<Product | null>(null)
  const [editRequestId, setEditRequestId] = useState<string | undefined>(undefined)
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null)
  const [deleteReason, setDeleteReason] = useState('')
  const [deleting, setDeleting]     = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [showBulkDelete, setShowBulkDelete] = useState(false)
  const [bulkDeleteReason, setBulkDeleteReason] = useState('')
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [showNormalizeConfirm, setShowNormalizeConfirm] = useState(false)
  const [normalizing, setNormalizing] = useState(false)
  const [audit, setAudit] = useState<CatalogAudit | null>(null)
  const [auditLoading, setAuditLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [showImportModal, setShowImportModal] = useState(false)
  const [duplicateStrategy, setDuplicateStrategy] = useState<'fill_empty' | 'override' | 'skip'>('fill_empty')
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<{
    imported: number
    created?: number
    updated?: number
    skipped: number
    errors: string[]
    warnings?: string[]
  } | null>(null)

  // Post-mutation refresh (create/update/delete/import/normalize) always
  // forces a real refetch — only the initial mount below uses the cache.
  const load = async () => {
    await loadProducts(true)
    const res = await window.api.products.list({
      branch_id: branchFilter || undefined,
      category_id: catFilter || undefined,
      is_active: true,
    }) as { success: boolean; data?: Product[]; error?: string }
    if (res.success && res.data) useProductsStore.setState({ products: res.data })
  }

  const loadAudit = async () => {
    setAuditLoading(true)
    try {
      const res = await window.api.products.catalogAudit() as { success: boolean; data?: CatalogAudit; error?: string }
      if (res.success && res.data) setAudit(res.data)
      else toast.error(res.error || 'Failed to load catalog audit')
    } catch (err) {
      toast.error('Failed to load catalog audit: ' + String(err))
    } finally {
      setAuditLoading(false)
    }
  }

  useEffect(() => {
    loadProducts() // no force — instant if already cached from a prior visit
    loadAudit()
    window.api.admin.branches.list().then((r: { success: boolean; data?: unknown[] }) => {
      if (r.success && r.data) {
        const activeBranches = (r.data as BranchItem[]).filter(branch => Boolean(branch.is_active))
        setBranches(activeBranches)
        setBranchFilter(current => current && !activeBranches.some(branch => branch.id === current)
          ? (canManageAllBranches ? '' : ownBranchId)
          : current)
      }
    }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const categoryPath = (categoryId: string) => {
    const chain: string[] = []
    const visited = new Set<string>()
    let current = categoryId
    while (current && !visited.has(current)) {
      visited.add(current)
      const cat = categories.find(c => c.id === current)
      if (!cat) break
      chain.unshift(cat.name)
      current = cat.parent_id || ''
    }
    return chain.join(' > ')
  }

  useEffect(() => {
    // When branchFilter changes, fetch products with the target branch so stock reflects that branch!
    window.api.products.list({ branch_id: branchFilter || undefined, category_id: catFilter || undefined, is_active: true })
      .then((res: { success: boolean; data?: Product[]; error?: string }) => {
        if (res.success && res.data) {
          useProductsStore.setState({ products: res.data })
        }
      })
      .catch((err: unknown) => console.error('Failed to load branch stock:', err))
  }, [branchFilter, catFilter])

  const brands = useMemo(
    () => [...new Set(products.map(p => (p as unknown as Record<string,unknown>).brand as string).filter(Boolean))],
    [products],
  )

  const filtered = useMemo(() => products.filter(p => {
    const pr = p as unknown as Record<string,unknown>
    return (
      (!search || p.name.toLowerCase().includes(search.toLowerCase()) || p.sku.toLowerCase().includes(search.toLowerCase())) &&
      (!catFilter || p.category_id === catFilter) &&
      (!brandFilter || pr.brand === brandFilter)
    )
  }), [products, search, catFilter, brandFilter])
  const pageCount = Math.max(1, Math.ceil(filtered.length / PRODUCT_PAGE_SIZE))
  const visibleProducts = useMemo(
    () => filtered.slice((page - 1) * PRODUCT_PAGE_SIZE, page * PRODUCT_PAGE_SIZE),
    [filtered, page],
  )

  useEffect(() => { setPage(1) }, [search, catFilter, brandFilter, branchFilter])
  useEffect(() => { if (page > pageCount) setPage(pageCount) }, [page, pageCount])

  const handleImportExcel = async (strategy: 'fill_empty' | 'override' | 'skip' = duplicateStrategy) => {
    setShowImportModal(false)
    setImporting(true)
    try {
      const res = await window.api.products.importExcel({ duplicateStrategy: strategy })
      if (!res.success) { if (res.error !== 'Cancelled') toast.error(res.error || 'Import failed'); return }
      const data = res.data as {
        imported: number
        created?: number
        updated?: number
        skipped: number
        deactivatedDuplicates?: number
        errors: string[]
        warnings?: string[]
        mode?: string
      }
      load()
      loadAudit()
      if ((data.warnings && data.warnings.length > 0) || (data.errors && data.errors.length > 0)) {
        setImportResult(data)
      } else {
        const createdCount = data.created ?? (data.imported - (data.updated ?? 0))
        const updatedCount = data.updated ?? 0
        const detail = ` (${createdCount} new, ${updatedCount} updated${data.skipped ? `, ${data.skipped} skipped` : ''})`
        toast.success(`Import completed: ${data.imported} products processed${detail}`)
      }
    } catch (err) {
      toast.error('Import failed: ' + String(err))
    } finally {
      setImporting(false)
    }
  }

  const handleExportCsv = async () => {
    try {
      const res = await window.api.products.exportCsv()
      if (!res.success) { if (res.error !== 'Cancelled') toast.error(res.error || 'Export failed'); return }
      const data = res.data as { exported: number; path: string }
      toast.success(`Exported ${data.exported} products to CSV`)
    } catch (err) {
      toast.error('Export failed: ' + String(err))
    }
  }

  const handleDownloadTemplate = async () => {
    try {
      const res = await window.api.products.downloadTemplate()
      if (!res.success) { if (res.error !== 'Cancelled') toast.error(res.error || 'Download failed'); return }
      toast.success('Bulk upload template downloaded successfully!')
    } catch (err) {
      toast.error('Download failed: ' + String(err))
    }
  }

  const handleNormalizeCatalog = async () => {
    setNormalizing(true)
    try {
      const res = await window.api.products.normalizeCatalog() as { success: boolean; error?: string; data?: { categoriesUpdated?: number; productsUpdated?: number } }
      if (!res.success) {
        toast.error(res.error || 'Catalog normalization failed')
        return
      }
      toast.success(`Catalog normalized: ${res.data?.categoriesUpdated || 0} categories, ${res.data?.productsUpdated || 0} products updated`)
      load()
      loadAudit()
      setShowNormalizeConfirm(false)
    } catch (err) {
      toast.error('Catalog normalization failed: ' + String(err))
    } finally {
      setNormalizing(false)
    }
  }

  const toggleActive = async (p: Product) => {
    try {
      const res = await window.api.products.update(p.id, { is_active: p.is_active ? 0 : 1 }) as { success: boolean; error?: string }
      if (res.success) {
        toast.success(p.is_active ? 'Product deactivated' : 'Product activated')
        load()
      } else {
        toast.error(res.error || 'Failed to update product')
      }
    } catch (err) {
      toast.error('Failed to update product: ' + String(err))
    }
  }

  const printLabel = async (p: Product) => {
    try {
      const res = await window.api.printer.printLabel({
        product_name: p.name, sku: p.sku, barcode: p.barcode, price: p.selling_price,
      }) as { success: boolean; error?: string }
      if (res.success) toast.success('Label sent to printer')
      else toast.error(res.error || 'Failed to print label')
    } catch (err) {
      toast.error('Failed to print label: ' + String(err))
    }
  }

  const handlePermanentDelete = async () => {
    if (!deleteTarget || !deleteReason.trim()) {
      toast.error('Please provide a reason for deletion')
      return
    }
    setDeleting(true)
    try {
      const res = await window.api.products.permanentDelete(deleteTarget.id, deleteReason.trim()) as { success: boolean; error?: string }
      if (res.success) {
        toast.success(`Product "${deleteTarget.name}" permanently deleted`)
        setDeleteTarget(null)
        setDeleteReason('')
        load()
      } else {
        toast.error(res.error || 'Delete failed')
      }
    } catch (err) {
      toast.error('Delete failed: ' + String(err))
    } finally {
      setDeleting(false)
    }
  }

  const toggleSelected = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  const allVisibleSelected = visibleProducts.length > 0 && visibleProducts.every(p => selectedIds.has(p.id))
  const toggleSelectAllVisible = () => {
    setSelectedIds(prev => {
      if (allVisibleSelected) {
        const next = new Set(prev)
        visibleProducts.forEach(p => next.delete(p.id))
        return next
      }
      const next = new Set(prev)
      visibleProducts.forEach(p => next.add(p.id))
      return next
    })
  }

  // Same per-record IPC (products:permanentDelete) the single-row delete
  // uses — it already correctly enqueues a sync DELETE event (fixed
  // earlier), so each product removed here propagates to the cloud and
  // every other branch exactly like a one-at-a-time delete would. Run
  // sequentially, not Promise.all, so referential-integrity errors on one
  // product don't race with the others and stay attributable per row.
  const handleBulkDelete = async () => {
    if (!bulkDeleteReason.trim()) {
      toast.error('Please provide a reason for deletion')
      return
    }
    setBulkDeleting(true)
    const ids = Array.from(selectedIds)
    let deleted = 0
    const failures: string[] = []
    try {
      for (const id of ids) {
        const p = products.find(x => x.id === id)
        try {
          const res = await window.api.products.permanentDelete(id, bulkDeleteReason.trim()) as { success: boolean; error?: string }
          if (res.success) deleted++
          else failures.push(`${p?.name || id}: ${res.error || 'failed'}`)
        } catch (err) {
          failures.push(`${p?.name || id}: ${String(err)}`)
        }
      }
      if (deleted > 0) toast.success(`${deleted} product(s) permanently deleted`)
      if (failures.length) toast.error(`${failures.length} failed — ${failures.slice(0, 3).join('; ')}${failures.length > 3 ? '…' : ''}`, { duration: 8000 })
      setSelectedIds(new Set())
      setShowBulkDelete(false)
      setBulkDeleteReason('')
      load()
    } finally {
      setBulkDeleting(false)
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader title="List Products" subtitle={`${filtered.length} of ${products.length} products`}
        actions={
          <div className="flex gap-2">
            {isCompanyAdmin && selectedIds.size > 0 && (
              <button onClick={() => setShowBulkDelete(true)} className="btn-sm px-3 py-1.5 rounded-lg text-white text-xs font-semibold gap-1.5 flex items-center"
                style={{ background: 'linear-gradient(135deg,#dc2626,#b91c1c)' }}>
                <Trash2 size={14} /> Delete Selected ({selectedIds.size})
              </button>
            )}
            <button onClick={handleDownloadTemplate} className="btn-secondary btn-sm gap-1.5" title="Download Product Bulk Upload Template">
              <Download size={14} /> Download Template
            </button>
            <button onClick={() => setShowImportModal(true)} disabled={importing} className="btn-secondary btn-sm gap-1.5">
              <FileSpreadsheet size={14} /> Import CSV / Excel
            </button>
            <button onClick={handleExportCsv} className="btn-secondary btn-sm gap-1.5">
              <Download size={14} /> Export CSV
            </button>
            <button onClick={() => setShowNormalizeConfirm(true)} className="btn-secondary btn-sm gap-1.5">
              <RefreshCw size={14} /> Normalize Catalog
            </button>
            <AddProductBtn
              isAdmin={isCompanyAdmin}
              onAdd={(reqId) => { setEditing(null); setEditRequestId(reqId); setShowForm(true) }}
            />
          </div>
        }
      />

      <div className="px-6 pt-4">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { label: 'Missing SKU', value: audit?.missingSku ?? 0, tone: (audit?.missingSku ?? 0) > 0 ? 'text-red-500' : 'text-green-500' },
            { label: 'Duplicate SKU Groups', value: audit?.duplicateSkuGroups ?? 0, tone: (audit?.duplicateSkuGroups ?? 0) > 0 ? 'text-amber-500' : 'text-green-500' },
            { label: 'Category Short Codes', value: `${audit?.totalCategories ?? 0} / ${audit?.missingShortCodes ?? 0}`, tone: 'text-[var(--text-1)]' },
            { label: 'Unnormalized Categories', value: audit?.nonNormalizedCategories ?? 0, tone: (audit?.nonNormalizedCategories ?? 0) > 0 ? 'text-amber-500' : 'text-green-500' },
          ].map(card => (
            <div key={card.label} className="rounded-xl border px-4 py-3" style={{ borderColor: 'var(--border)', background: 'var(--bg-card)' }}>
              <p className="text-xs uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>{card.label}</p>
              <p className={`text-2xl font-bold mt-1 ${card.tone}`}>{card.value}</p>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2 mt-3">
          <button onClick={loadAudit} disabled={auditLoading} className="btn-secondary btn-sm gap-1.5">
            <RefreshCw size={14} className={auditLoading ? 'animate-spin' : ''} />
            Refresh Audit
          </button>
          <p className="text-xs" style={{ color: 'var(--text-3)' }}>
            Audit is read-only. Normalize only after reviewing the counts.
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 px-6 py-3 border-b border-slate-800 flex-shrink-0">
        <div className="relative min-w-[200px] flex-1 max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Enter Keyword..." className="input pl-8 text-sm" />
        </div>
        <select value={branchFilter} onChange={e => setBranchFilter(e.target.value)} className="input w-44 text-sm font-medium" disabled={!canManageAllBranches}>
          {canManageAllBranches && <option value="">All Branches (Stock)</option>}
          {branches.map(b => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        <select value={catFilter} onChange={e => setCatFilter(e.target.value)} className="input w-44 text-sm">
          <option value="">Select product type</option>
          {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={brandFilter} onChange={e => setBrandFilter(e.target.value)} className="input w-36 text-sm">
          <option value="">Select brand</option>
          {brands.map(b => <option key={b} value={b}>{b}</option>)}
        </select>
        <button className="btn-primary btn-sm gap-1" onClick={load}>
          <Search size={13}/> Filter
        </button>
        <button className="btn-secondary btn-sm" onClick={() => { setSearch(''); setCatFilter(''); setBrandFilter(''); setBranchFilter(canManageAllBranches ? '' : ownBranchId) }}>
          Reset
        </button>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full">
          <thead className="sticky top-0 bg-surface-900 z-10">
            <tr>
              {isCompanyAdmin && (
                <th className="table-header px-3 py-3 text-left text-xs w-8">
                  <input type="checkbox" checked={allVisibleSelected} onChange={toggleSelectAllVisible}
                    className="cursor-pointer" title="Select all visible" />
                </th>
              )}
              {['Image', 'SKU', 'Product', 'Location', 'Unit Cost(Rs.)', 'Unit Price(Rs.)', 'Discount (%)', 'Wholesale(Rs.)',
                branchFilter ? `Stock (${branches.find(b => String(b.id) === branchFilter)?.name || 'Branch'})` : 'Stock (Total)',
                'Action'].map(h => (
                <th key={h} className="table-header px-3 py-3 text-left text-xs">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={11} className="text-center py-16 text-slate-500">Loading...</td></tr>
            ) : visibleProducts.map(p => {
              const pr = p as unknown as Record<string, unknown>
              const discPct = Number(p.discount_pct || pr.discount_pct || 0)
              return (
                <tr key={p.id} className="table-row">
                  {isCompanyAdmin && (
                    <td className="table-cell px-3 py-2">
                      <input type="checkbox" checked={selectedIds.has(p.id)} onChange={() => toggleSelected(p.id)}
                        className="cursor-pointer" />
                    </td>
                  )}
                  <td className="table-cell px-3 py-2">
                    <div className="w-8 h-8 rounded flex items-center justify-center flex-shrink-0 overflow-hidden" style={{ background: 'var(--bg-page)', border: '1px solid var(--border)' }}>
                      {p.image_url
                        ? <img src={resolveImageSrc(p.image_url)} className="w-full h-full object-cover" alt=""
                            onError={e => { console.warn('[ProductsPage] Failed to load product image:', p.image_url); e.currentTarget.style.visibility = 'hidden' }} />
                        : <Package size={14} style={{ color: 'var(--text-3)' }} />}
                    </div>
                  </td>
                  <td className="table-cell px-3 font-mono text-xs text-slate-400">
                    {p.sku?.startsWith('NO-SKU-') ? (
                      <span className="text-amber-400 font-sans text-[11px] italic bg-amber-400/10 px-1.5 py-0.5 rounded border border-amber-400/20" title="No SKU provided in import">
                        No SKU
                      </span>
                    ) : (
                      p.sku || '-'
                    )}
                  </td>
                  <td className="table-cell px-3">
                    <div className="flex items-center gap-1.5">
                      <Package size={12} className="text-brand-400 flex-shrink-0" />
                      <div>
                        <p className="font-medium text-sm">{p.name}</p>
                        {Boolean(pr.category_name) && <p className="text-xs text-slate-500">{String(pr.category_name)}</p>}
                      </div>
                    </div>
                  </td>
                  <td className="table-cell px-3 text-xs text-slate-400">{(pr.branch_name as string) || 'All Branches'}</td>
                  <td className="table-cell px-3 text-sm">
                    {p.cost_price.toLocaleString()}
                    {pr.alert_qty ? <span className="text-xs text-slate-500 ml-1">({pr.alert_qty as number})</span> : null}
                  </td>
                  <td className="table-cell px-3 text-sm font-semibold" style={{ color: 'var(--brand-primary)' }}>{p.selling_price.toLocaleString()}</td>
                  <td className="table-cell px-3 text-sm font-medium">
                    {discPct > 0 ? (
                      <span className="inline-block bg-green-500/10 text-green-400 border border-green-500/20 px-2 py-0.5 rounded text-xs">
                        {discPct}% OFF
                      </span>
                    ) : (
                      <span className="text-slate-500 text-xs">0%</span>
                    )}
                  </td>
                  <td className="table-cell px-3 text-sm text-slate-400">{Number(pr.wholesale_price || 0).toLocaleString()}</td>
                  <td className="table-cell px-3 whitespace-nowrap">
                    <span className={`text-sm font-bold px-2 py-0.5 rounded text-white whitespace-nowrap
                      ${(p.stock ?? 0) <= 0 ? 'bg-red-600' : (p.stock ?? 0) <= p.min_stock_level ? 'bg-yellow-600' : 'bg-green-700'}`}>
                      {p.stock ?? 0} ITEMS
                    </span>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      {branchFilter
                        ? (branches.find(b => String(b.id) === branchFilter)?.name || 'Branch')
                        : 'All Branches (Total)'}
                    </p>
                  </td>
                  <td className="table-cell px-3">
                    <div className="flex gap-1">
                      <EditProductBtn
                        product={p}
                        isAdmin={isCompanyAdmin}
                        onEdit={(editRequestId) => { setEditing(p); setEditRequestId(editRequestId); setShowForm(true) }}
                      />
                      <button onClick={() => toggleActive(p)} className="btn-ghost btn-sm p-1.5" title={p.is_active ? 'Deactivate' : 'Activate'}>
                        {p.is_active ? <ToggleRight size={14} className="text-green-400" /> : <ToggleLeft size={14} />}
                      </button>
                      <button onClick={() => printLabel(p)} className="btn-ghost btn-sm p-1.5" title="Print Label">
                        <Printer size={13} />
                      </button>
                      {isCompanyAdmin && (
                        <button onClick={() => { setDeleteTarget(p); setDeleteReason('') }}
                          className="btn-ghost btn-sm p-1.5 text-red-400 hover:text-red-500" title="Permanently delete">
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={10} className="text-center py-16 text-slate-500">No products found</td></tr>
            )}
          </tbody>
        </table>
        {!loading && filtered.length > 0 && (
          <div className="sticky bottom-0 flex items-center justify-between gap-3 border-t px-6 py-3"
            style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}>
            <p className="text-xs" style={{ color: 'var(--text-3)' }}>
              Showing {(page - 1) * PRODUCT_PAGE_SIZE + 1}-{Math.min(page * PRODUCT_PAGE_SIZE, filtered.length)} of {filtered.length}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="btn-secondary btn-sm"
              >
                Previous
              </button>
              <span className="text-xs font-semibold" style={{ color: 'var(--text-2)' }}>
                Page {page} of {pageCount}
              </span>
              <button
                type="button"
                onClick={() => setPage(p => Math.min(pageCount, p + 1))}
                disabled={page === pageCount}
                className="btn-secondary btn-sm"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>


      {showForm && (
        <ProductForm
          product={editing}
          categories={categories}
          suppliers={suppliers}
          stockBranchId={editing && !branchFilter ? undefined : (branchFilter || ownBranchId || DEFAULT_MAIN_BRANCH_ID)}
          stockScopeLabel={branchFilter
            ? (branches.find(b => b.id === branchFilter)?.name || 'Selected Branch')
            : editing ? 'All Branches (calculated total)' : (currentUser?.branch?.name || 'Main Branch')}
          editRequestId={editRequestId}
          onClose={() => { setShowForm(false); setEditRequestId(undefined) }}
          onSave={() => { setShowForm(false); setEditRequestId(undefined); load() }}
          onCategoryCreated={load}
        />
      )}

      {showNormalizeConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}>
          <div className="card w-full max-w-md">
            <h3 className="font-bold text-lg mb-2" style={{ color: 'var(--text-1)' }}>Normalize catalog</h3>
            <p className="text-sm mb-4" style={{ color: 'var(--text-3)' }}>
              This will title-case category names, fill category short codes, and backfill missing product SKUs using the brand + category + sequence rule.
            </p>
            <div className="rounded-lg p-3 mb-4 text-xs" style={{ background: 'var(--bg-soft)', color: 'var(--text-2)' }}>
              It updates existing records in place. Run it only after checking the current catalog.
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowNormalizeConfirm(false)} className="btn-secondary">Cancel</button>
              <button onClick={handleNormalizeCatalog} disabled={normalizing} className="btn-primary gap-1.5">
                <RefreshCw size={14} className={normalizing ? 'animate-spin' : ''} />
                {normalizing ? 'Normalizing...' : 'Normalize'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Permanent Delete Confirmation Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}>
          <div className="card w-full max-w-md" style={{ border: '1px solid #ef4444' }}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center flex-shrink-0">
                <AlertTriangle size={20} className="text-red-400" />
              </div>
              <div>
                <h3 className="font-bold text-base" style={{ color: 'var(--text-1)' }}>Permanently Delete Product</h3>
                <p className="text-xs" style={{ color: 'var(--text-3)' }}>This action cannot be undone</p>
              </div>
            </div>

            <div className="rounded-lg p-3 mb-4 text-sm" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: 'var(--text-2)' }}>
              <p className="font-semibold mb-1" style={{ color: 'var(--text-1)' }}>{deleteTarget.name}</p>
              <p className="text-xs">SKU: {deleteTarget.sku} {deleteTarget.barcode && `| Barcode: ${deleteTarget.barcode}`}</p>
            </div>

            <div className="mb-4">
              <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>
                Reason for Deletion <span className="text-red-400">*</span>
              </label>
              <textarea
                value={deleteReason}
                onChange={e => setDeleteReason(e.target.value)}
                className="input resize-none"
                rows={3}
                placeholder="Enter reason (e.g. wrongly added product, duplicate entry...)"
                maxLength={500}
              />
            </div>

            <div className="flex gap-2 justify-end">
              <button onClick={() => { setDeleteTarget(null); setDeleteReason('') }}
                className="btn-secondary btn-sm">Cancel</button>
              <button onClick={handlePermanentDelete} disabled={deleting || !deleteReason.trim()}
                className="btn-sm px-4 py-2 rounded-lg text-white text-sm font-semibold disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg,#dc2626,#b91c1c)' }}>
                {deleting ? 'Deleting...' : 'Permanently Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Permanent Delete Confirmation Modal */}
      {showBulkDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}>
          <div className="card w-full max-w-md" style={{ border: '1px solid #ef4444' }}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center flex-shrink-0">
                <AlertTriangle size={20} className="text-red-400" />
              </div>
              <div>
                <h3 className="font-bold text-base" style={{ color: 'var(--text-1)' }}>Permanently Delete {selectedIds.size} Product(s)</h3>
                <p className="text-xs" style={{ color: 'var(--text-3)' }}>This action cannot be undone — applies to local and cloud/other branches</p>
              </div>
            </div>

            <div className="rounded-lg p-3 mb-4 text-sm max-h-32 overflow-y-auto" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: 'var(--text-2)' }}>
              {Array.from(selectedIds).map(id => {
                const p = products.find(x => x.id === id)
                return <p key={id} className="text-xs">{p?.name || id} {p?.sku ? `(${p.sku})` : ''}</p>
              })}
            </div>

            <div className="mb-4">
              <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>
                Reason for Deletion <span className="text-red-400">*</span>
              </label>
              <textarea
                value={bulkDeleteReason}
                onChange={e => setBulkDeleteReason(e.target.value)}
                className="input resize-none"
                rows={3}
                placeholder="Enter reason (e.g. test import cleanup, duplicate entries...)"
                maxLength={500}
              />
            </div>

            <div className="flex gap-2 justify-end">
              <button onClick={() => { setShowBulkDelete(false); setBulkDeleteReason('') }}
                className="btn-secondary btn-sm">Cancel</button>
              <button onClick={handleBulkDelete} disabled={bulkDeleting || !bulkDeleteReason.trim()}
                className="btn-sm px-4 py-2 rounded-lg text-white text-sm font-semibold disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg,#dc2626,#b91c1c)' }}>
                {bulkDeleting ? 'Deleting...' : `Permanently Delete ${selectedIds.size}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CSV / Excel Import Options Modal */}
      {showImportModal && (
        <Modal
          title="Import Products (CSV / Excel)"
          onClose={() => setShowImportModal(false)}
          size="md"
          footer={
            <div className="flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setShowImportModal(false)}
                className="btn-secondary btn-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleImportExcel(duplicateStrategy)}
                disabled={importing}
                className="btn-primary btn-sm gap-1.5"
              >
                <Upload size={14} />
                Select File & Import
              </button>
            </div>
          }
        >
          <div className="space-y-4">
            {/* Multi-Branch Stock Import Banner */}
            <div className="rounded-xl border border-sky-500/30 bg-sky-500/10 p-3.5 flex items-start gap-3">
              <Package size={18} className="text-sky-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-sky-300">
                    Multi-Branch Stock Import (அனைத்து கிளைகளின் இருப்பு)
                  </p>
                  <button
                    type="button"
                    onClick={handleDownloadTemplate}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-sky-300 hover:text-white underline hover:no-underline"
                  >
                    <Download size={12} /> Download Template
                  </button>
                </div>
                <p className="text-[11px] text-slate-300 mt-1">
                  You can specify stock counts for each branch in a single file! Use column headers like <code>Stock (Main Branch)</code>, <code>Stock (Branch 2)</code> or <code>Stock - Branch Name</code>.
                </p>
                <p className="text-[10px] text-sky-200/70 mt-0.5 italic">
                  ஒரே CSV கோப்பில் ஒவ்வொரு கிளைக்கும் தனித்தனி Stock நெடுவரிசை அமைத்து அனைத்து கிளைகளின் இருப்பையும் ஒரே நேரத்தில் பதிவேற்றலாம்.
                </p>
              </div>
            </div>

            <div>
              <p className="text-sm font-semibold text-white">
                How should existing products be handled?
              </p>
              <p className="text-xs text-[var(--text-3)] mt-0.5">
                Choose what to do when a product in the file already exists in your inventory.
              </p>
            </div>

            <div className="space-y-2.5">
              {/* Option 1: Fill Empty Fields Only (Recommended) */}
              <div
                onClick={() => setDuplicateStrategy('fill_empty')}
                className={`p-3.5 rounded-xl border cursor-pointer transition-all ${
                  duplicateStrategy === 'fill_empty'
                    ? 'border-emerald-500 bg-emerald-500/10'
                    : 'border-[var(--border)] hover:border-slate-600 bg-[var(--bg-soft)]'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className="mt-0.5">
                    <input
                      type="radio"
                      name="importDuplicateStrategy"
                      checked={duplicateStrategy === 'fill_empty'}
                      onChange={() => setDuplicateStrategy('fill_empty')}
                      className="accent-emerald-500"
                    />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-white">
                        Fill Empty Fields Only
                      </span>
                      <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400">
                        Recommended
                      </span>
                    </div>
                    <p className="text-xs text-[var(--text-2)] mt-1">
                      Preserve existing data. Only fill fields that were previously empty or blank (e.g. barcode, description, category, prices).
                    </p>
                    <p className="text-[11px] text-[var(--text-3)] mt-0.5 italic">
                      பழைய தகவல்களை மாற்றாமல், முந்தைய பதிவில் காலியாக இருந்த விவரங்களை மட்டும் நிரப்பும்.
                    </p>
                  </div>
                </div>
              </div>

              {/* Option 2: Override Existing Data */}
              <div
                onClick={() => setDuplicateStrategy('override')}
                className={`p-3.5 rounded-xl border cursor-pointer transition-all ${
                  duplicateStrategy === 'override'
                    ? 'border-blue-500 bg-blue-500/10'
                    : 'border-[var(--border)] hover:border-slate-600 bg-[var(--bg-soft)]'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className="mt-0.5">
                    <input
                      type="radio"
                      name="importDuplicateStrategy"
                      checked={duplicateStrategy === 'override'}
                      onChange={() => setDuplicateStrategy('override')}
                      className="accent-blue-500"
                    />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-white">
                        Override Existing Data (Update)
                      </span>
                    </div>
                    <p className="text-xs text-[var(--text-2)] mt-1">
                      Update existing products with values from the new file.
                    </p>
                    <p className="text-[11px] text-[var(--text-3)] mt-0.5 italic">
                      ஏற்கனவே உள்ள தயாரிப்புகளின் விவரங்களை புதிய கோப்பின் தகவல்களால் மாற்றி அமைக்கும் (Overwrite).
                    </p>
                  </div>
                </div>
              </div>

              {/* Option 3: Skip Existing */}
              <div
                onClick={() => setDuplicateStrategy('skip')}
                className={`p-3.5 rounded-xl border cursor-pointer transition-all ${
                  duplicateStrategy === 'skip'
                    ? 'border-amber-500 bg-amber-500/10'
                    : 'border-[var(--border)] hover:border-slate-600 bg-[var(--bg-soft)]'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className="mt-0.5">
                    <input
                      type="radio"
                      name="importDuplicateStrategy"
                      checked={duplicateStrategy === 'skip'}
                      onChange={() => setDuplicateStrategy('skip')}
                      className="accent-amber-500"
                    />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-white">
                        Skip Existing Products
                      </span>
                    </div>
                    <p className="text-xs text-[var(--text-2)] mt-1">
                      Leave existing products untouched. Only add completely new products.
                    </p>
                    <p className="text-[11px] text-[var(--text-3)] mt-0.5 italic">
                      ஏற்கனவே இருக்கும் பொருட்களை மாற்றாமல், புதிய பொருட்களை மட்டுமே சேர்க்கும்.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Guarantee Box */}
            <div className="rounded-lg border border-emerald-900/50 bg-emerald-950/20 p-3 flex items-start gap-2.5">
              <ShieldCheck size={18} className="text-emerald-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-emerald-300">
                  Zero Duplicate Guarantee (இரட்டைப் பதிவு தடுப்பு)
                </p>
                <p className="text-[11px] text-slate-300 mt-0.5">
                  Products are automatically matched by <strong>SKU</strong>, <strong>Barcode</strong>, and <strong>Product Name</strong>. Double entries are strictly prevented.
                </p>
              </div>
            </div>
          </div>
        </Modal>
      )}

      {/* Import Result & Warnings Summary Modal */}
      {importResult && (
        <Modal
          title="Import Summary & Warnings (பதிவேற்ற விவரம்)"
          onClose={() => setImportResult(null)}
          size="lg"
          footer={
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setImportResult(null)}
                className="btn-primary btn-sm px-4"
              >
                Close
              </button>
            </div>
          }
        >
          <div className="space-y-4">
            {/* Counts */}
            <div className="grid grid-cols-4 gap-2.5">
              <div className="rounded-xl border p-3 bg-slate-900/60 border-slate-700/60 text-center">
                <p className="text-[11px] text-[var(--text-3)] font-semibold uppercase">Total</p>
                <p className="text-xl font-bold text-white mt-0.5">{importResult.imported}</p>
              </div>
              <div className="rounded-xl border p-3 bg-emerald-950/20 border-emerald-800/40 text-center">
                <p className="text-[11px] text-emerald-400 font-semibold uppercase">Created</p>
                <p className="text-xl font-bold text-emerald-400 mt-0.5">{importResult.created ?? 0}</p>
              </div>
              <div className="rounded-xl border p-3 bg-sky-950/20 border-sky-800/40 text-center">
                <p className="text-[11px] text-sky-400 font-semibold uppercase">Updated</p>
                <p className="text-xl font-bold text-sky-400 mt-0.5">{importResult.updated ?? 0}</p>
              </div>
              <div className="rounded-xl border p-3 bg-amber-950/20 border-amber-800/40 text-center">
                <p className="text-[11px] text-amber-400 font-semibold uppercase">Skipped</p>
                <p className="text-xl font-bold text-amber-400 mt-0.5">{importResult.skipped ?? 0}</p>
              </div>
            </div>

            {/* Warnings: Missing SKU / Barcode */}
            {importResult.warnings && importResult.warnings.length > 0 && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5 space-y-2">
                <div className="flex items-center gap-2">
                  <AlertTriangle size={16} className="text-amber-400 flex-shrink-0" />
                  <span className="text-xs font-bold text-amber-300">
                    Warnings: Missing SKU / Barcode ({importResult.warnings.length})
                  </span>
                </div>
                <p className="text-[11px] text-slate-300">
                  தயாரிப்புகள் அனைத்தும் அவற்றின் இருப்பு (Stock) மற்றும் விவரங்களுடன் வெற்றிகரமாக சேர்க்கப்பட்டன. ஆனால் கீழ்வரும் தயாரிப்புகளுக்கு நீங்கள் கோப்பில் SKU அல்லது Barcode வழங்கவில்லை:
                </p>
                <div className="max-h-48 overflow-y-auto space-y-1 pr-1 text-xs">
                  {importResult.warnings.map((w, idx) => (
                    <div key={idx} className="flex items-start gap-1.5 text-amber-200/90 bg-amber-950/40 px-2.5 py-1 rounded border border-amber-500/20 font-mono text-[11px]">
                      <span>⚠️</span>
                      <span>{w}</span>
                    </div>
                  ))}
                </div>
                <p className="text-[10px] text-amber-300/70 italic">
                  குறிப்பு: ஆட்டோ-ஜெனரேட் செய்யப்படவில்லை. தேவைப்படும் போது தயாரிப்பை Edit செய்து நேரடி SKU / Barcode-ஐ நீங்கள் உள்ளிட்டுக் கொள்ளலாம்.
                </p>
              </div>
            )}

            {/* Errors */}
            {importResult.errors && importResult.errors.length > 0 && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3.5 space-y-2">
                <div className="flex items-center gap-2">
                  <AlertTriangle size={16} className="text-red-400 flex-shrink-0" />
                  <span className="text-xs font-bold text-red-300">
                    Errors ({importResult.errors.length})
                  </span>
                </div>
                <div className="max-h-40 overflow-y-auto space-y-1 pr-1 text-xs">
                  {importResult.errors.map((e, idx) => (
                    <div key={idx} className="text-red-300 bg-red-950/40 px-2.5 py-1 rounded border border-red-500/20 text-[11px]">
                      {e}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}

    </div>
  )
}

// ─── Inline Add Category Mini-Modal ─────────────────────────────────────────
function QuickCategoryModal({ allCategories, onClose, onCreated }: {
  allCategories: Category[]
  onClose: () => void
  onCreated: (id: string, name: string) => void
}) {
  const [form, setForm] = useState({ name: '', short_code: '', parent_id: '', description: '', show_in_menu: true })
  const [saving, setSaving] = useState(false)
  const save = async () => {
    if (!form.name.trim()) { toast.error('Name required'); return }
    setSaving(true)
    try {
      const res = await window.api.admin.categories.create({
        name: form.name.trim(), short_code: form.short_code || null,
        parent_id: form.parent_id || null, description: form.description || null,
        show_in_menu: form.show_in_menu ? 1 : 0,
      })
      if (res.success) {
        toast.success('Category created')
        onCreated((res.data as { id: string }).id, form.name.trim())
      } else {
        toast.error(String(res.error))
      }
    } catch (err) {
      toast.error('Failed to create category: ' + String(err))
    } finally {
      setSaving(false)
    }
  }
  return (
    <Modal title="Create New Category" onClose={onClose}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Category Name *</label>
            <input className="input" placeholder="Enter Category Name" value={form.name}
              onChange={e => setForm(f => ({...f, name: e.target.value}))} autoFocus />
          </div>
          <div>
            <label className="label">Parent Category</label>
            <select className="input" value={form.parent_id} onChange={e => setForm(f => ({...f, parent_id: e.target.value}))}>
              <option value="">Select Category</option>
              {allCategories.filter(c => c.is_active).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Short Code</label>
            <input className="input" placeholder="Enter Short Code" value={form.short_code}
              onChange={e => setForm(f => ({...f, short_code: e.target.value}))} />
          </div>
          <div className="flex items-end gap-4 pb-1">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.show_in_menu}
                onChange={e => setForm(f => ({...f, show_in_menu: e.target.checked}))} className="w-4 h-4 accent-brand-500" />
              <span className="text-sm" style={{ color: 'var(--text-2)' }}>Show in Main Menu</span>
            </label>
          </div>
        </div>
        <div>
          <label className="label">Description</label>
          <textarea className="input resize-none h-20 text-sm" placeholder="Type Your Description......"
            value={form.description} onChange={e => setForm(f => ({...f, description: e.target.value}))} />
        </div>
        <div className="flex justify-end gap-3 pt-1">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary gap-1" onClick={save} disabled={saving}>Save</button>
        </div>
      </div>
    </Modal>
  )
}

// ─── Edit button: admins edit directly, non-admins must request approval ────
function EditProductBtn({ product, isAdmin, onEdit }: {
  product: Product
  isAdmin: boolean
  onEdit: (editRequestId: string | undefined) => void
}) {
  const [checking, setChecking] = useState(false)
  const [requesting, setRequesting] = useState(false)
  const [pending, setPending] = useState(false)
  const [reason, setReason] = useState('')

  const click = async () => {
    if (isAdmin) { onEdit(undefined); return }
    setChecking(true)
    try {
      const res = await window.api.editRequests.checkUnlocked('products', product.id)
      if (!res.success) { toast.error(res.error || 'Failed to check edit permission'); return }
      const data = res.data as { unlocked: boolean; pending: boolean; request_id: string | null }
      if (data.unlocked) { onEdit(data.request_id || undefined); return }
      if (data.pending) { setPending(true); return }
      setRequesting(true)
    } catch (err) {
      toast.error((err as Error).message || 'Failed to check edit permission')
    } finally {
      setChecking(false)
    }
  }

  const submitRequest = async () => {
    if (!reason.trim()) { toast.error('Enter a reason for the request'); return }
    setChecking(true)
    try {
      const res = await window.api.editRequests.create({
        target_table: 'products',
        target_record_id: product.id,
        reason: reason.trim(),
        requested_changes: {},
      })
      if (!res.success) { toast.error(res.error || 'Could not submit request'); return }
      toast.success('Edit request submitted — waiting for admin approval')
      setRequesting(false)
      setPending(true)
    } catch (err) {
      toast.error((err as Error).message || 'Could not submit request')
    } finally {
      setChecking(false)
    }
  }

  if (pending) {
    return (
      <span className="inline-flex items-center gap-1 text-xs px-1.5" style={{ color: 'var(--text-3)' }} title="Waiting for admin approval">
        <Clock size={13} /> Pending
      </span>
    )
  }

  if (requesting) {
    return (
      <Modal title={`Request to edit "${product.name}"`} onClose={() => setRequesting(false)}
        footer={<>
          <button onClick={() => setRequesting(false)} className="btn-secondary">Cancel</button>
          <button onClick={submitRequest} disabled={checking} className="btn-primary">
            {checking ? 'Submitting...' : 'Submit Request'}
          </button>
        </>}>
        <div className="space-y-3">
          <p className="text-sm" style={{ color: 'var(--text-2)' }}>
            Editing this product requires Company Admin approval. Explain what you want to change and why.
          </p>
          <div>
            <label className="label">Purpose / reason for editing *</label>
            <textarea value={reason} onChange={e => setReason(e.target.value)} className="input h-24 resize-none"
              placeholder="e.g. Selling price needs correction, wrong category assigned..." autoFocus />
          </div>
        </div>
      </Modal>
    )
  }

  return (
    <button onClick={click} disabled={checking} className="btn-ghost btn-sm p-1.5" style={{ color: 'var(--brand-primary)' }} title={isAdmin ? 'Edit' : 'Request edit'}>
      {isAdmin ? <Edit2 size={13} /> : <Lock size={13} />}
    </button>
  )
}

// ─── "Add Product" button: admins add directly, non-admins must request ─────
function AddProductBtn({ isAdmin, onAdd }: {
  isAdmin: boolean
  onAdd: (editRequestId: string | undefined) => void
}) {
  const [checking, setChecking] = useState(false)
  const [requesting, setRequesting] = useState(false)
  const [pending, setPending] = useState(false)
  const [reason, setReason] = useState('')

  const click = async () => {
    if (isAdmin) { onAdd(undefined); return }
    setChecking(true)
    try {
      const res = await window.api.editRequests.checkUnlocked('products', 'new')
      if (!res.success) { toast.error(res.error || 'Failed to check permission'); return }
      const data = res.data as { unlocked: boolean; pending: boolean; request_id: string | null }
      if (data.unlocked) { onAdd(data.request_id || undefined); return }
      if (data.pending) { setPending(true); return }
      setRequesting(true)
    } catch (err) {
      toast.error((err as Error).message || 'Failed to check permission')
    } finally {
      setChecking(false)
    }
  }

  const submitRequest = async () => {
    if (!reason.trim()) { toast.error('Enter a reason for the request'); return }
    setChecking(true)
    try {
      const res = await window.api.editRequests.create({
        target_table: 'products',
        target_record_id: 'new',
        reason: reason.trim(),
        requested_changes: {},
      })
      if (!res.success) { toast.error(res.error || 'Could not submit request'); return }
      toast.success('Request submitted — waiting for admin approval')
      setRequesting(false)
      setPending(true)
    } catch (err) {
      toast.error((err as Error).message || 'Could not submit request')
    } finally {
      setChecking(false)
    }
  }

  if (pending) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs px-2 py-1.5" style={{ color: 'var(--text-3)' }} title="Waiting for admin approval">
        <Clock size={14} /> Pending approval
      </span>
    )
  }

  if (requesting) {
    return (
      <Modal title="Request to add a new product" onClose={() => setRequesting(false)}
        footer={<>
          <button onClick={() => setRequesting(false)} className="btn-secondary">Cancel</button>
          <button onClick={submitRequest} disabled={checking} className="btn-primary">
            {checking ? 'Submitting...' : 'Submit Request'}
          </button>
        </>}>
        <div className="space-y-3">
          <p className="text-sm" style={{ color: 'var(--text-2)' }}>
            Adding a new product requires Company Admin approval. Explain what product you want to add and why.
          </p>
          <div>
            <label className="label">Purpose / reason *</label>
            <textarea value={reason} onChange={e => setReason(e.target.value)} className="input h-24 resize-none"
              placeholder="e.g. New chair model arrived from supplier, needs to be listed..." autoFocus />
          </div>
        </div>
      </Modal>
    )
  }

  return (
    <button onClick={click} disabled={checking} className="btn-primary btn-sm gap-1.5">
      {isAdmin ? <Plus size={14} /> : <Lock size={14} />} Add Product
    </button>
  )
}

// ─── Common Units for Clean & Fast Selection ──────────────────────────────
const COMMON_UNITS = [
  { value: 'pcs', label: 'Pieces (எண்ணிக்கை - pcs)' },
  { value: 'kg', label: 'Kilogram (கிலோ - kg)' },
  { value: 'g', label: 'Gram (கிராம் - g)' },
  { value: 'l', label: 'Litre (லீற்றர் - L)' },
  { value: 'ml', label: 'Millilitre (மில்லி - ml)' },
  { value: 'packet', label: 'Packet (பாக்கெட்)' },
  { value: 'box', label: 'Box (பெட்டி)' },
  { value: 'bottle', label: 'Bottle (போத்தல்)' },
  { value: 'can', label: 'Can (ரின்)' },
  { value: 'bundle', label: 'Bundle (கட்டு)' },
  { value: 'meter', label: 'Meter (மீற்றர் - m)' },
  { value: 'custom', label: 'Custom (வேறு அலகு...)' },
]

// ─── Main Product Form ───────────────────────────────────────────────────────
function ProductForm({ product, categories, suppliers, stockBranchId, stockScopeLabel, editRequestId, onClose, onSave, onCategoryCreated }: {
  product: Product | null
  categories: Category[]
  suppliers: Supplier[]
  stockBranchId?: string
  stockScopeLabel: string
  editRequestId?: string
  onClose: () => void
  onSave: () => void
  onCategoryCreated: () => void
}) {
  const [form, setForm] = useState({
    name:               product?.name            || '',
    sort_name:          (product as Record<string,unknown> | null)?.sort_name as string || '',
    sku:                product?.sku              || '',
    isbn:               (product as Record<string,unknown> | null)?.isbn as string || '',
    barcode:            product?.barcode          || '',
    category_id:        product?.category_id      || '',
    brand:              (product as Record<string,unknown> | null)?.brand as string || '',
    description:        product?.description      || '',
    rack_no:            (product as Record<string,unknown> | null)?.rack_no as string || '',
    alert_qty:          Number((product as Record<string,unknown> | null)?.alert_qty ?? product?.min_stock_level ?? 5),
    weight:             Number((product as Record<string,unknown> | null)?.weight    ?? 0),
    cost_price:         product?.cost_price       ?? 0,
    selling_price:      product?.selling_price    ?? 0,
    wholesale_price:    Number((product as Record<string,unknown> | null)?.wholesale_price ?? 0),
    tax_rate:           product?.tax_rate         ?? 0,
    min_stock_level:    product?.min_stock_level  ?? 5,
    image_url:          product?.image_url        || '',
    not_for_sale:       Boolean((product as Record<string,unknown> | null)?.not_for_sale),
    enable_emi:         Boolean((product as Record<string,unknown> | null)?.enable_emi),
    is_manage_stock:    (product as Record<string,unknown> | null)?.is_manage_stock !== 0,
    fast_product:       Boolean((product as Record<string,unknown> | null)?.fast_product),
    sale_as_latest_price: Boolean((product as Record<string,unknown> | null)?.sale_as_latest_price),
    product_type:       (product as Record<string,unknown> | null)?.product_type as string || 'single',
    sale_by:            (product as Record<string,unknown> | null)?.sale_by as string || 'normal',
    employee_commission: Number((product as Record<string,unknown> | null)?.employee_commission ?? 0),
    commission_type:    (product as Record<string,unknown> | null)?.commission_type as string || 'fixed',
    custom_field1:      (product as Record<string,unknown> | null)?.custom_field1 as string || '',
    custom_field2:      (product as Record<string,unknown> | null)?.custom_field2 as string || '',
    custom_field3:      (product as Record<string,unknown> | null)?.custom_field3 as string || '',
  })

  const [formVariants, setFormVariants] = useState<VariantItem[]>([])
  const [uoms, setUoms] = useState<UOMRow[]>([{ uom_name: '', conversion_factor: 1, is_base: true, wastage: 0 }])
  const [stockQty, setStockQty]       = useState(Number(product?.stock ?? 0))
  const [originalStockQty, setOriginalStockQty] = useState(Number(product?.stock ?? 0))
  const [stockReason, setStockReason] = useState('')

  const isKnownUnit = (u?: string) => COMMON_UNITS.some(c => c.value === (u || '').toLowerCase())
  const initialUnit = (product?.unit || 'pcs').toLowerCase()
  const [selectedUnit, setSelectedUnit] = useState<string>(isKnownUnit(initialUnit) ? initialUnit : 'custom')
  const [customUnit, setCustomUnit] = useState<string>(isKnownUnit(initialUnit) ? '' : (product?.unit || ''))

  // Quick per-product discount % — a shortcut that creates/updates a
  // scope:'product', global-branch rule via the same Discounts module used
  // by Admin > Discounts, instead of a separate storage mechanism.
  const [discountPct, setDiscountPct] = useState(product?.discount_pct ?? 0)
  const [existingDiscountId, setExistingDiscountId] = useState<string | null>(null)
  const [saving, setSaving]           = useState(false)
  const [uploading, setUploading]     = useState(false)
  const [showAddCategory, setShowAddCategory] = useState(false)
  const [localCategories, setLocalCategories] = useState(categories)
  const user = useAuthStore(s => s.user)
  const stockIsAggregate = Boolean(product && !stockBranchId)
  const canEditMainBranchStock = canManuallyEditBranchStock(user, stockBranchId
    ? { id: stockBranchId, name: stockScopeLabel }
    : undefined)
  const stockIsReadOnly = stockIsAggregate || !canEditMainBranchStock
  const stockHasChanged = Boolean(product) && stockQty !== originalStockQty

  useEffect(() => { setLocalCategories(categories) }, [categories])

  useEffect(() => {
    if (product) {
      if (product.discount_pct !== undefined) setDiscountPct(product.discount_pct)
      if (product.unit) {
        const u = product.unit.toLowerCase()
        if (isKnownUnit(u)) {
          setSelectedUnit(u)
          setCustomUnit('')
        } else {
          setSelectedUnit('custom')
          setCustomUnit(product.unit)
        }
      }
      // Load variants if editing a variable product
      (window as any).api.products.variants.list(product.id, stockBranchId).then((res: any) => {
        if (res.success && Array.isArray(res.data) && res.data.length > 0) {
          setFormVariants(res.data.map((v: any) => ({
            id: v.id,
            selected: true,
            variant_name: v.variant_name,
            sku: v.sku,
            barcode: v.barcode || '',
            cost_price: Number(v.cost_price || 0),
            selling_price: Number(v.selling_price || 0),
            stock: Number(v.stock || 0),
            attributes: typeof v.attributes === 'object' ? v.attributes : (typeof v.attributes_json === 'string' ? JSON.parse(v.attributes_json || '{}') : (v.attributes_json || {})),
            image_url: v.image_url,
          })))
        }
      }).catch(() => {})

      if (stockBranchId) {
        window.api.stocks.get(product.id, stockBranchId).then((res: { success: boolean; data?: unknown; error?: string }) => {
          if (res.success) {
            const quantity = Number((res.data as { quantity?: number } | undefined)?.quantity || 0)
            setStockQty(quantity)
            setOriginalStockQty(quantity)
          }
          else toast.error(res.error || 'Failed to load stock quantity')
        }).catch((err: unknown) => toast.error('Failed to load stock quantity: ' + String(err)))
      } else {
        const quantity = Number(product.stock || 0)
        setStockQty(quantity)
        setOriginalStockQty(quantity)
      }
      window.api.admin.productUom.list(product.id).then((res: { success: boolean; data?: unknown; error?: string }) => {
        if (res.success && res.data) {
          const rows = res.data as UOMRow[]
          setUoms(rows.length ? rows : [{ uom_name: '', conversion_factor: 1, is_base: true, wastage: 0 }])
        } else if (!res.success) toast.error(res.error || 'Failed to load UOMs')
      }).catch((err: unknown) => toast.error('Failed to load UOMs: ' + String(err)))
      window.api.discounts.list({ productId: product.id }).then((res: { success: boolean; data?: Record<string, unknown>[] }) => {
        if (!res.success || !res.data) return
        const rule = res.data.find(d => d.scope === 'product' && d.type === 'percentage' && !d.branch_id)
        if (rule) { setExistingDiscountId(String(rule.id)); setDiscountPct(Number(rule.value) || 0) }
      }).catch(() => {})
    }
  }, [product, stockBranchId])

  const f = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(p => ({ ...p, [k]: e.target.type === 'number' ? parseFloat(e.target.value) || 0 : e.target.value }))

  const uploadImage = async () => {
    setUploading(true)
    try {
      const res = await window.api.products.selectAndUploadImage() as { success: boolean; data?: string; local_only?: boolean; error?: string }
      if (res.success && res.data) {
        setForm(p => ({ ...p, image_url: res.data as string }))
        if (res.local_only) {
          toast('Image saved on this device only — configure Cloud Sync/S3 in Settings for it to appear on other devices.', { icon: '⚠️', duration: 6000 })
        }
      }
      else if (res.error && res.error !== 'Cancelled') toast.error(res.error)
    } catch (err) {
      toast.error('Image upload failed: ' + String(err))
    } finally { setUploading(false) }
  }

  const addUOM = () => setUoms(u => [...u, { uom_name: '', conversion_factor: 1, is_base: false, wastage: 0 }])
  const removeUOM = (i: number) => setUoms(u => u.filter((_, n) => n !== i))
  const setUOM = (i: number, key: keyof UOMRow, val: unknown) => setUoms(u =>
    u.map((row, n) => n !== i ? row : { ...row, [key]: val })
  )
  const setBaseUOM = (i: number) => setUoms(u =>
    u.map((row, n) => ({ ...row, is_base: n === i }))
  )

  const save = async () => {
    if (!form.name.trim()) { toast.error('Product name is required'); return }
    if (stockHasChanged && !stockReason.trim()) { toast.error('Enter a reason for the stock correction'); return }
    setSaving(true)
    try {
      const branchId = stockBranchId || user?.branch?.id || user?.branch_id || DEFAULT_MAIN_BRANCH_ID
      const finalUnit = selectedUnit === 'custom' ? (customUnit.trim() || 'pcs') : selectedUnit
      const activeUoms = uoms.filter(u => u.uom_name.trim())
      const uomToSave = activeUoms.length > 1
        ? activeUoms
        : [{ uom_name: finalUnit, conversion_factor: 1, is_base: true, wastage: 0 }]
      const varStockTotal = form.product_type === 'variable' ? formVariants.filter(v => v.selected).reduce((acc, v) => acc + Number(v.stock || 0), 0) : stockQty
      const payload = {
        ...form,
        name:                   form.name.trim(),
        unit:                   finalUnit,
        min_stock_level:        form.alert_qty,
        discount_pct:           discountPct,
        not_for_sale:           form.not_for_sale ? 1 : 0,
        enable_emi:             form.enable_emi ? 1 : 0,
        is_manage_stock:        form.is_manage_stock ? 1 : 0,
        fast_product:           form.fast_product ? 1 : 0,
        sale_as_latest_price:   form.sale_as_latest_price ? 1 : 0,
        category_id:            form.category_id || null,
        variants:               form.product_type === 'variable' ? formVariants.filter(v => v.selected) : [],
      }
      let productId = ''
      if (product) {
        const res = await window.api.products.update(product.id, { ...payload, edit_request_id: editRequestId }) as { success: boolean; error?: string }
        if (!res.success) { toast.error(res.error || 'Failed to update product'); return }
        productId = product.id
      } else {
        const res = await window.api.products.create({ ...payload, edit_request_id: editRequestId })
        if (!res.success) { toast.error(res.error || 'Failed'); return }
        productId = (res.data as { id: string }).id
      }
      const stockPromise = stockIsReadOnly
        ? Promise.resolve({ success: true } as { success: boolean; error?: string })
        : product
          ? stockHasChanged
            ? window.api.stocks.adjustCorrection({
                product_id: productId,
                branch_id: String(branchId),
                quantity: stockQty,
                reason: stockReason.trim(),
              }) as Promise<{ success: boolean; error?: string }>
            : Promise.resolve({ success: true } as { success: boolean; error?: string })
          : window.api.stocks.adjust({ product_id: productId, branch_id: String(branchId), quantity: form.product_type === 'variable' ? varStockTotal : stockQty, reason: 'Opening stock for new product' }) as Promise<{ success: boolean; error?: string }>
      const [stockRes, uomRes] = await Promise.all([
        stockPromise,
        window.api.admin.productUom.save(productId, uomToSave) as Promise<{ success: boolean; error?: string }>,
      ])
      if (!stockRes.success) {
        toast.error(`${product ? 'Product details were saved, but' : 'Product was created, but'} stock was not updated: ${stockRes.error || 'Unknown error'}`)
        return
      }
      if (!uomRes.success) { toast.error(uomRes.error || 'Failed to save units of measure'); return }

      if (discountPct > 0) {
        const discountRes = existingDiscountId
          ? await window.api.discounts.update(existingDiscountId, { value: discountPct, is_active: true })
          : await window.api.discounts.create({
              name: `${form.name} discount`, type: 'percentage', value: discountPct,
              scope: 'product', product_id: productId, branch_id: null, is_active: true,
            })
        if (!discountRes.success) toast.error(discountRes.error || 'Failed to save product discount')
      } else if (existingDiscountId) {
        await window.api.discounts.toggleActive(existingDiscountId, false)
      }

      toast.success(product ? 'Product and stock updated' : 'Product created')
      onSave()
    } catch (err) {
      toast.error('Failed to save product: ' + String(err))
    } finally { setSaving(false) }
  }

  const check = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(p => ({ ...p, [k]: e.target.checked }))

  const categoryPath = (categoryId: string) => {
    const chain: string[] = []
    const visited = new Set<string>()
    let current = categoryId
    while (current && !visited.has(current)) {
      visited.add(current)
      const cat = localCategories.find(c => c.id === current)
      if (!cat) break
      chain.unshift(cat.name)
      current = cat.parent_id || ''
    }
    return chain.join(' > ')
  }

  return (
    <>
      <Modal title={product ? 'Edit Product' : 'Create New Product'} onClose={onClose} size="xl"
        footer={<>
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={save} disabled={saving} className="btn-primary">{saving ? 'Saving...' : 'Save Product'}</button>
        </>}>
        <div className="space-y-5 max-h-[78vh] overflow-y-auto pr-1">

          {/* ── Product Structure Toggle ── */}
          <div className="flex items-center justify-between p-3 rounded-xl border border-slate-700/60 bg-slate-900/60">
            <div>
              <p className="text-xs font-bold text-white uppercase tracking-wider">Product Structure (தயாரிப்பு வகை)</p>
              <p className="text-xs text-slate-400">Choose whether this item is a simple single product or has multiple sizes/variants</p>
            </div>
            <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-950 border border-slate-800">
              <button
                type="button"
                onClick={() => setForm(p => ({ ...p, product_type: 'single' }))}
                className={`px-3.5 py-1.5 rounded-md text-xs font-semibold transition-all ${
                  form.product_type === 'single'
                    ? 'bg-brand-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                📦 Simple Product
              </button>
              <button
                type="button"
                onClick={() => setForm(p => ({ ...p, product_type: 'variable' }))}
                className={`px-3.5 py-1.5 rounded-md text-xs font-semibold transition-all ${
                  form.product_type === 'variable'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                ⚡ Variable Product (வகைகள்)
              </button>
            </div>
          </div>

          {/* ── Primary Basic Details (Clear, Simple & Direct) ── */}
          <div className="space-y-3.5">
            {/* Row 1: Name, Category, Brand */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="md:col-span-2">
                <label className="label">Product Name (பொருளின் பெயர்) <span className="text-red-400">*</span></label>
                <input
                  value={form.name}
                  onChange={f('name')}
                  className="input font-medium"
                  placeholder="e.g. Sunsilk Shampoo 180ml, Keeri Samba 5kg, Office Chair..."
                  autoFocus
                />
              </div>
              <div>
                <label className="label">Category (பிரிவு) <span className="text-red-400">*</span></label>
                <div className="flex gap-1.5">
                  <select value={form.category_id} onChange={f('category_id')} className="input flex-1">
                    <option value="">Select category</option>
                    {localCategories.filter(c => c.is_active).map(c => (
                      <option key={c.id} value={c.id}>{categoryPath(c.id) || c.name}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => setShowAddCategory(true)}
                    className="btn-primary btn-sm w-9 flex items-center justify-center flex-shrink-0"
                    title="Add new category"
                  >
                    <Plus size={14} />
                  </button>
                </div>
              </div>
            </div>

            {/* Row 2: Barcode/SKU, Unit of Measure, Brand */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="label">Barcode / SKU (பார்கோடு எண்)</label>
                <div className="relative">
                  <Barcode size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    value={form.sku || form.barcode}
                    onChange={e => {
                      const val = e.target.value
                      setForm(p => ({ ...p, sku: val, barcode: val }))
                    }}
                    className="input pl-9 font-mono text-sm"
                    placeholder="Scan or enter barcode..."
                  />
                </div>
              </div>

              <div>
                <label className="label">Unit of Measure (அளவீட்டு அலகு) <span className="text-red-400">*</span></label>
                <select
                  value={selectedUnit}
                  onChange={e => {
                    const val = e.target.value
                    setSelectedUnit(val)
                    if (val !== 'custom') {
                      setUoms([{ uom_name: val, conversion_factor: 1, is_base: true, wastage: 0 }])
                    }
                  }}
                  className="input"
                >
                  {COMMON_UNITS.map(u => (
                    <option key={u.value} value={u.value}>{u.label}</option>
                  ))}
                </select>
                {selectedUnit === 'custom' && (
                  <input
                    value={customUnit}
                    onChange={e => {
                      setCustomUnit(e.target.value)
                      setUoms([{ uom_name: e.target.value, conversion_factor: 1, is_base: true, wastage: 0 }])
                    }}
                    placeholder="Enter custom unit (e.g. roll, pack)..."
                    className="input mt-1.5 text-xs"
                  />
                )}
              </div>

              <div>
                <label className="label">Brand (பிராண்ட் / நிறுவனம்)</label>
                <input value={form.brand} onChange={f('brand')} className="input" placeholder="e.g. Sunlight, Damro, Anchor..." />
              </div>
            </div>

            {/* Row 3: Pricing (Cost, Selling Price, Wholesale Price, Discount) */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <label className="label">Cost Price (Rs. அடக்க விலை)</label>
                <div className="flex">
                  <span className="flex items-center px-2.5 rounded-l-lg text-xs" style={{ background: 'var(--bg-page)', border: '1px solid var(--border-2)', borderRight: 'none', color: 'var(--text-3)' }}>Rs.</span>
                  <NumberInput value={form.cost_price} onChange={f('cost_price')} className="input rounded-l-none border-l-0 text-sm" min="0" step="0.01" />
                </div>
              </div>

              <div>
                <label className="label">Selling Price (Rs. விற்பனை விலை) <span className="text-red-400">*</span></label>
                <div className="flex">
                  <span className="flex items-center px-2.5 rounded-l-lg text-xs font-semibold text-emerald-400" style={{ background: 'var(--bg-page)', border: '1px solid var(--border-2)', borderRight: 'none' }}>Rs.</span>
                  <NumberInput value={form.selling_price} onChange={f('selling_price')} className="input rounded-l-none border-l-0 font-bold text-sm text-emerald-400" min="0" step="0.01" />
                </div>
              </div>

              <div>
                <label className="label">Wholesale Price (Rs. மொத்த விலை)</label>
                <div className="flex">
                  <span className="flex items-center px-2.5 rounded-l-lg text-xs" style={{ background: 'var(--bg-page)', border: '1px solid var(--border-2)', borderRight: 'none', color: 'var(--text-3)' }}>Rs.</span>
                  <NumberInput value={form.wholesale_price} onChange={f('wholesale_price')} className="input rounded-l-none border-l-0 text-sm" min="0" step="0.01" />
                </div>
              </div>

              <div>
                <label className="label">Discount % (தள்ளுபடி)</label>
                <div className="flex">
                  <NumberInput
                    value={discountPct || ''}
                    onChange={e => setDiscountPct(parseFloat(e.target.value) || 0)}
                    className="input rounded-r-none border-r-0 text-sm"
                    min="0" max="100" step="0.5" placeholder="0"
                  />
                  <span className="flex items-center px-2.5 rounded-r-lg text-xs font-semibold text-amber-400" style={{ background: 'var(--bg-page)', border: '1px solid var(--border-2)', borderLeft: 'none' }}>% OFF</span>
                </div>
              </div>
            </div>

            {/* Row 4: Stock, Low Stock Alert & Image */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-start">
              {form.product_type === 'single' ? (
                <div>
                  <label className="label">{product ? 'Current Stock Qty' : 'Initial Stock Qty (ஆரம்ப கையிருப்பு)'} — {stockScopeLabel}</label>
                  {stockIsReadOnly ? (
                    <div className="rounded-lg border px-3 py-2" style={{ borderColor: 'var(--border)', background: 'var(--bg-soft)' }}>
                      <span className="text-base font-bold" style={{ color: 'var(--text-1)' }}>{stockQty} {selectedUnit !== 'custom' ? selectedUnit : customUnit}</span>
                      <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-3)' }}>
                        {stockIsAggregate ? 'Calculated from all branches' : 'Calculated stock'}
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      <NumberInput value={stockQty} onChange={e => setStockQty(parseInt(e.target.value)||0)} className="input text-sm font-semibold" min="0" />
                      {product && stockHasChanged && (
                        <input
                          value={stockReason}
                          onChange={e => setStockReason(e.target.value)}
                          className="input text-xs"
                          placeholder="Reason for stock correction *"
                        />
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  <label className="label">Variant Stock Total (வகைகளின் மொத்த இருப்பு)</label>
                  <div className="rounded-lg border px-3 py-2 bg-indigo-950/20 border-indigo-900/40">
                    <span className="text-base font-bold text-indigo-300">
                      {formVariants.filter(v => v.selected).reduce((acc, v) => acc + Number(v.stock || 0), 0)} items
                    </span>
                    <p className="text-[11px] mt-0.5 text-slate-400">
                      Calculated automatically from variants table below
                    </p>
                  </div>
                </div>
              )}

              <div>
                <label className="label">Low Stock Alert Qty (குறைந்தபட்ச எச்சரிக்கை அளவு)</label>
                <NumberInput value={form.alert_qty} onChange={f('alert_qty')} className="input text-sm" min="0" placeholder="5" />
              </div>

              <div>
                <label className="label">Product Image (படம்)</label>
                <div className="flex items-center gap-2">
                  <div onClick={uploadImage}
                    className="w-14 h-14 rounded-lg flex flex-col items-center justify-center cursor-pointer hover:border-brand-500 transition-colors flex-shrink-0 overflow-hidden"
                    style={{ background: 'var(--bg-page)', border: '2px dashed var(--border-2)' }}>
                    {form.image_url
                      ? <img src={resolveImageSrc(form.image_url)} className="w-full h-full object-cover" alt=""
                          onError={e => { e.currentTarget.style.visibility = 'hidden' }} />
                      : <><Package size={14} style={{ color: 'var(--text-3)' }} /><span className="text-[8px] mt-0.5 text-slate-400">NO IMAGE</span></>
                    }
                  </div>
                  <div className="flex flex-col gap-1">
                    <button type="button" onClick={uploadImage} disabled={uploading} className="btn-secondary btn-sm gap-1 text-xs py-1">
                      <Upload size={11} />{uploading ? 'Uploading...' : 'Upload'}
                    </button>
                    {form.image_url && (
                      <button type="button" onClick={() => setForm(p => ({...p, image_url: ''}))} className="text-red-400 hover:text-red-300 text-xs flex items-center gap-1">
                        <X size={10} /> Remove
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ── Variable Product Builder (Only if Variable Product is active) ── */}
          {form.product_type === 'variable' && (
            <div className="pt-1">
              <ProductVariantBuilder
                productName={form.name}
                baseSku={form.sku}
                baseCostPrice={form.cost_price}
                baseSellingPrice={form.selling_price}
                categoryId={form.category_id || undefined}
                businessType={user?.business_type === 'supermarket' ? 'supermarket' : 'normal'}
                variants={formVariants}
                onChange={setFormVariants}
              />
            </div>
          )}

          {/* ── Collapsible Advanced Details & Options ── */}
          <details className="group rounded-xl border border-slate-800 bg-slate-900/40 p-3.5 transition-all">
            <summary className="flex items-center justify-between cursor-pointer font-semibold text-xs uppercase tracking-wider text-slate-400 hover:text-white select-none">
              <div className="flex items-center gap-2">
                <Settings2 size={13} className="text-brand-400" />
                <span>Advanced Details & Options (மேம்பட்ட கூடுதல் விவரங்கள்)</span>
                <span className="text-[10px] text-slate-500 normal-case font-normal">(Rack No, Description, Tax, Multi-UOM, Commission)</span>
              </div>
              <ChevronDown size={14} className="group-open:rotate-180 transition-transform text-slate-400" />
            </summary>

            <div className="mt-4 pt-3 border-t border-slate-800/80 space-y-4">
              {/* Description */}
              <div>
                <label className="label">Product Description (விவரக்குறிப்பு)</label>
                <textarea
                  value={form.description}
                  onChange={f('description')}
                  className="input resize-none h-16 py-1.5 text-xs"
                  placeholder="Enter optional product description or notes..."
                />
              </div>

              {/* Rack No, Weight, Tax Rate */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="label">Rack No (ரேக் எண்)</label>
                  <input value={form.rack_no} onChange={f('rack_no')} className="input text-xs" placeholder="e.g. A1, Shelf-3" />
                </div>
                <div>
                  <label className="label">Weight (எடை)</label>
                  <NumberInput value={form.weight} onChange={f('weight')} className="input text-xs" min="0" step="0.01" placeholder="0" />
                </div>
                <div>
                  <label className="label">Applicable Tax (வரி %)</label>
                  <select
                    value={form.tax_rate.toString()}
                    onChange={e => setForm(p => ({ ...p, tax_rate: parseFloat(e.target.value) || 0 }))}
                    className="input text-xs"
                  >
                    <option value="0">None (0%)</option>
                    <option value="5">5%</option>
                    <option value="8">8%</option>
                    <option value="10">10%</option>
                    <option value="15">15%</option>
                    <option value="18">18%</option>
                  </select>
                </div>
              </div>

              {/* Store Flags */}
              <div>
                <label className="label mb-2">Store Preferences & Flags</label>
                <div className="flex flex-wrap gap-x-6 gap-y-2">
                  {([
                    ['is_manage_stock',      'Manage Stock (இருப்பு கண்காணிப்பு)'],
                    ['fast_product',         'Fast Product (விரைவு விற்பனை)'],
                    ['sale_as_latest_price', 'Sale as Latest Price'],
                    ['enable_emi',           'Enable EMI (தவணை முறை)'],
                    ['not_for_sale',         'Not for Sale (விற்பனைக்கு அல்ல)'],
                  ] as [keyof typeof form, string][]).map(([key, label]) => (
                    <label key={key} className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={Boolean(form[key])} onChange={check(key)} className="w-4 h-4 accent-brand-500 rounded" />
                      <span className="text-xs text-slate-300">{label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Employee Commission */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="label">Employee Commission</label>
                  <div className="flex">
                    <NumberInput
                      value={form.employee_commission}
                      onChange={f('employee_commission')}
                      className="input rounded-r-none border-r-0 text-xs"
                      min="0"
                      step="0.01"
                    />
                    <select
                      value={form.commission_type}
                      onChange={f('commission_type')}
                      className="input rounded-l-none border-l-0 w-24 text-xs"
                    >
                      <option value="fixed">Rs</option>
                      <option value="percent">%</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Multi-tier UOM Table */}
              <div className="pt-2 border-t border-slate-800/80">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <h5 className="text-xs font-bold text-slate-300">Multi-UOM Hierarchy & Conversions (கூடுதல் அலகுகள் மாற்றீடு)</h5>
                    <p className="text-[11px] text-slate-500">Only needed if 1 Box contains multiple Packs or Pieces</p>
                  </div>
                  <button type="button" onClick={addUOM} className="btn-secondary btn-sm text-xs gap-1">
                    <Plus size={11} /> Add Secondary UOM
                  </button>
                </div>
                <div className="rounded-lg overflow-hidden border border-slate-800">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-slate-900">
                        <th className="text-left px-3 py-2 font-medium text-slate-400">UOM Name</th>
                        <th className="text-left px-3 py-2 font-medium text-slate-400">Conversion Factor</th>
                        <th className="text-center px-3 py-2 font-medium text-slate-400">Is Base</th>
                        <th className="text-left px-3 py-2 font-medium text-slate-400">Wastage</th>
                        <th className="w-8 px-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {uoms.map((row, i) => (
                        <tr key={i} className="border-t border-slate-800/60">
                          <td className="px-3 py-2">
                            <input
                              value={row.uom_name}
                              onChange={e => setUOM(i, 'uom_name', e.target.value)}
                              className="input text-xs py-1"
                              placeholder="e.g. BOX, CARTON, PACKET..."
                            />
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-1">
                              <NumberInput
                                value={row.conversion_factor}
                                onChange={e => setUOM(i, 'conversion_factor', parseFloat(e.target.value)||1)}
                                className="input text-xs py-1 w-24"
                                min="0"
                                step="0.001"
                              />
                            </div>
                          </td>
                          <td className="px-3 py-2 text-center">
                            <input
                              type="checkbox"
                              checked={row.is_base}
                              onChange={() => setBaseUOM(i)}
                              className="w-4 h-4 accent-brand-500 cursor-pointer"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <NumberInput
                              value={row.wastage}
                              onChange={e => setUOM(i, 'wastage', parseFloat(e.target.value)||0)}
                              className="input text-xs py-1 w-20"
                              min="0"
                              step="0.1"
                            />
                          </td>
                          <td className="px-2 py-2">
                            {row.is_base ? (
                              <Lock size={12} className="text-slate-600" />
                            ) : (
                              <button type="button" onClick={() => removeUOM(i)} className="text-red-400 hover:text-red-300">
                                <Trash2 size={12} />
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Custom Fields */}
              <div className="grid grid-cols-3 gap-3 pt-2 border-t border-slate-800/80">
                <div>
                  <label className="label text-[11px]">Custom Field 1</label>
                  <input value={form.custom_field1} onChange={f('custom_field1')} className="input text-xs" placeholder="Custom Field 1" />
                </div>
                <div>
                  <label className="label text-[11px]">Custom Field 2</label>
                  <input value={form.custom_field2} onChange={f('custom_field2')} className="input text-xs" placeholder="Custom Field 2" />
                </div>
                <div>
                  <label className="label text-[11px]">Custom Field 3</label>
                  <input value={form.custom_field3} onChange={f('custom_field3')} className="input text-xs" placeholder="Custom Field 3" />
                </div>
              </div>
            </div>
          </details>

        </div>
      </Modal>

      {showAddCategory && (
        <QuickCategoryModal
          allCategories={localCategories}
          onClose={() => setShowAddCategory(false)}
          onCreated={(id, name) => {
            setLocalCategories(cats => [...cats, { id, name, parent_id: undefined, description: undefined, sort_order: 0, is_active: true }])
            setForm(p => ({ ...p, category_id: id }))
            setShowAddCategory(false)
            onCategoryCreated()
          }}
        />
      )}

    </>
  )
}
