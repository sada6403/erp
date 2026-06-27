import { useState, useEffect } from 'react'
import PageHeader from '@/components/shared/PageHeader'
import Modal from '@/components/shared/Modal'
import type { Product, Category, Supplier } from '@/types'
import {
  Plus, Search, Edit2, Package, ToggleLeft, ToggleRight, Upload, X, Download,
  FileSpreadsheet, Trash2, Lock, Calculator, Info
} from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuthStore } from '@/store/authStore'

type UOMRow = { id?: string; uom_name: string; conversion_factor: number; is_base: boolean; wastage: number }

export default function ProductsPage() {
  const [products, setProducts]     = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [suppliers, setSuppliers]   = useState<Supplier[]>([])
  const [search, setSearch]         = useState('')
  const [catFilter, setCatFilter]   = useState('')
  const [brandFilter, setBrandFilter] = useState('')
  const [showForm, setShowForm]     = useState(false)
  const [editing, setEditing]       = useState<Product | null>(null)
  const [loading, setLoading]       = useState(true)

  const load = async () => {
    setLoading(true)
    const [p, c, s] = await Promise.all([
      window.api.products.list({}),
      window.api.admin.categories.list(),
      window.api.admin.suppliers.list()
    ])
    if (p.success) setProducts(p.data as Product[])
    if (c.success) setCategories(c.data as Category[])
    if (s.success) setSuppliers(s.data as Supplier[])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const brands = [...new Set(products.map(p => (p as unknown as Record<string,unknown>).brand as string).filter(Boolean))]

  const filtered = products.filter(p => {
    const pr = p as unknown as Record<string,unknown>
    return (
      (!search || p.name.toLowerCase().includes(search.toLowerCase()) || p.sku.toLowerCase().includes(search.toLowerCase())) &&
      (!catFilter || p.category_id === catFilter) &&
      (!brandFilter || pr.brand === brandFilter)
    )
  })

  const handleImportExcel = async () => {
    const res = await window.api.products.importExcel()
    if (!res.success) { if (res.error !== 'Cancelled') toast.error(res.error || 'Import failed'); return }
    const { imported, skipped } = res.data as { imported: number; skipped: number; errors: string[] }
    toast.success(`Imported ${imported} products${skipped ? `, skipped ${skipped}` : ''}`)
    load()
  }

  const handleExportCsv = async () => {
    const res = await window.api.products.exportCsv()
    if (!res.success) { if (res.error !== 'Cancelled') toast.error(res.error || 'Export failed'); return }
    const data = res.data as { exported: number; path: string }
    toast.success(`Exported ${data.exported} products to CSV`)
  }

  const toggleActive = async (p: Product) => {
    await window.api.products.update(p.id, { is_active: p.is_active ? 0 : 1 })
    toast.success(p.is_active ? 'Product deactivated' : 'Product activated')
    load()
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader title="List Products" subtitle={`${filtered.length} of ${products.length} products`}
        actions={
          <div className="flex gap-2">
            <button onClick={handleImportExcel} className="btn-secondary btn-sm gap-1.5">
              <FileSpreadsheet size={14} /> Import CSV / Excel
            </button>
            <button onClick={handleExportCsv} className="btn-secondary btn-sm gap-1.5">
              <Download size={14} /> Export CSV
            </button>
            <button onClick={() => { setEditing(null); setShowForm(true) }} className="btn-primary btn-sm gap-1.5">
              <Plus size={14} /> Add Product
            </button>
          </div>
        }
      />

      {/* Filters */}
      <div className="flex flex-wrap gap-2 px-6 py-3 border-b border-slate-800 flex-shrink-0">
        <div className="relative min-w-[200px] flex-1 max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Enter Keyword..." className="input pl-8 text-sm" />
        </div>
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
        <button className="btn-secondary btn-sm" onClick={() => { setSearch(''); setCatFilter(''); setBrandFilter('') }}>
          Reset
        </button>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full">
          <thead className="sticky top-0 bg-surface-900 z-10">
            <tr>
              {['Image', 'SKU', 'Product', 'Location', 'Unit Cost(Rs.)', 'Unit Price(Rs.)', 'Wholesale(Rs.)', 'Quantity', 'Action'].map(h => (
                <th key={h} className="table-header px-3 py-3 text-left text-xs">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} className="text-center py-16 text-slate-500">Loading...</td></tr>
            ) : filtered.map(p => {
              const pr = p as unknown as Record<string, unknown>
              return (
                <tr key={p.id} className="table-row">
                  <td className="table-cell px-3 py-2">
                    <div className="w-8 h-8 rounded flex items-center justify-center flex-shrink-0 overflow-hidden" style={{ background: 'var(--bg-page)', border: '1px solid var(--border)' }}>
                      {p.image_url
                        ? <img src={p.image_url} className="w-full h-full object-cover" alt="" />
                        : <Package size={14} style={{ color: 'var(--text-3)' }} />}
                    </div>
                  </td>
                  <td className="table-cell px-3 font-mono text-xs text-slate-400">{p.sku}</td>
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
                  <td className="table-cell px-3 text-sm text-brand-400 font-semibold">{p.selling_price.toLocaleString()}</td>
                  <td className="table-cell px-3 text-sm text-slate-400">{Number(pr.wholesale_price || 0).toLocaleString()}</td>
                  <td className="table-cell px-3">
                    <span className={`text-sm font-bold px-2 py-0.5 rounded text-white
                      ${(p.stock ?? 0) <= 0 ? 'bg-red-600' : (p.stock ?? 0) <= p.min_stock_level ? 'bg-yellow-600' : 'bg-green-700'}`}>
                      {p.stock ?? 0} ITEMS
                    </span>
                  </td>
                  <td className="table-cell px-3">
                    <div className="flex gap-1">
                      <button onClick={() => { setEditing(p); setShowForm(true) }}
                        className="btn-ghost btn-sm p-1.5 text-blue-400" title="Edit"><Edit2 size={13} /></button>
                      <button onClick={() => toggleActive(p)} className="btn-ghost btn-sm p-1.5" title={p.is_active ? 'Deactivate' : 'Activate'}>
                        {p.is_active ? <ToggleRight size={14} className="text-green-400" /> : <ToggleLeft size={14} />}
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={9} className="text-center py-16 text-slate-500">No products found</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {showForm && (
        <ProductForm
          product={editing}
          categories={categories}
          suppliers={suppliers}
          onClose={() => setShowForm(false)}
          onSave={() => { setShowForm(false); load() }}
          onCategoryCreated={load}
        />
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
    const res = await window.api.admin.categories.create({
      name: form.name.trim(), short_code: form.short_code || null,
      parent_id: form.parent_id || null, description: form.description || null,
      show_in_menu: form.show_in_menu ? 1 : 0,
    })
    setSaving(false)
    if (res.success) {
      toast.success('Category created')
      onCreated((res.data as { id: string }).id, form.name.trim())
    } else {
      toast.error(String(res.error))
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

// ─── Main Product Form ───────────────────────────────────────────────────────
function ProductForm({ product, categories, suppliers, onClose, onSave, onCategoryCreated }: {
  product: Product | null
  categories: Category[]
  suppliers: Supplier[]
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
    alert_qty:          Number((product as Record<string,unknown> | null)?.alert_qty ?? 5),
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

  const [uoms, setUoms] = useState<UOMRow[]>([{ uom_name: '', conversion_factor: 1, is_base: true, wastage: 0 }])
  const [stockQty, setStockQty]       = useState(0)
  const [saving, setSaving]           = useState(false)
  const [uploading, setUploading]     = useState(false)
  const [showAddCategory, setShowAddCategory] = useState(false)
  const [localCategories, setLocalCategories] = useState(categories)
  const user = useAuthStore(s => s.user)

  useEffect(() => { setLocalCategories(categories) }, [categories])

  useEffect(() => {
    if (product) {
      window.api.stocks.get(product.id).then((res: { success: boolean; data?: unknown }) => {
        if (res.success && res.data) setStockQty((res.data as { quantity: number }).quantity)
      })
      window.api.admin.productUom.list(product.id).then((res: { success: boolean; data?: unknown }) => {
        if (res.success && res.data) {
          const rows = res.data as UOMRow[]
          setUoms(rows.length ? rows : [{ uom_name: '', conversion_factor: 1, is_base: true, wastage: 0 }])
        }
      })
    }
  }, [product])

  const f = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(p => ({ ...p, [k]: e.target.type === 'number' ? parseFloat(e.target.value) || 0 : e.target.value }))

  const uploadImage = async () => {
    setUploading(true)
    try {
      const res = await window.api.products.selectAndUploadImage()
      if (res.success && res.data) setForm(p => ({ ...p, image_url: res.data as string }))
      else if (res.error && res.error !== 'Cancelled') toast.error(res.error)
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
    if (!form.name || !form.sku) { toast.error('Product name and SKU are required'); return }
    setSaving(true)
    try {
      const branchId = user?.branch?.id || 'b1111111-1111-4111-8111-111111111111'
      const payload = {
        ...form,
        not_for_sale:           form.not_for_sale ? 1 : 0,
        enable_emi:             form.enable_emi ? 1 : 0,
        is_manage_stock:        form.is_manage_stock ? 1 : 0,
        fast_product:           form.fast_product ? 1 : 0,
        sale_as_latest_price:   form.sale_as_latest_price ? 1 : 0,
        category_id:            form.category_id || null,
      }
      let productId = ''
      if (product) {
        await window.api.products.update(product.id, payload)
        productId = product.id
        toast.success('Product updated')
      } else {
        const res = await window.api.products.create(payload)
        if (!res.success) { toast.error(res.error || 'Failed'); return }
        productId = (res.data as { id: string }).id
        toast.success('Product created')
      }
      // Save stock and UOMs in parallel
      await Promise.all([
        window.api.stocks.adjust({ product_id: productId, branch_id: branchId, quantity: stockQty, reason: 'Product form update' }),
        window.api.admin.productUom.save(productId, uoms.filter(u => u.uom_name.trim())),
      ])
      onSave()
    } finally { setSaving(false) }
  }

  const check = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(p => ({ ...p, [k]: e.target.checked }))

  return (
    <>
      <Modal title={product ? 'Edit Product' : 'Create New Product'} onClose={onClose} size="xl"
        footer={<>
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={save} disabled={saving} className="btn-primary">{saving ? 'Saving...' : 'Save Product'}</button>
        </>}>
        <div className="space-y-6 max-h-[75vh] overflow-y-auto pr-1">

          {/* ── Section 1: Basic Details ─────────────────────────────── */}
          <div>
            <h3 className="text-sm font-bold underline mb-3" style={{ color: 'var(--text-1)' }}>Product Basic Details</h3>
            <div className="grid grid-cols-4 gap-3">
              <div className="col-span-1">
                <label className="label">Product name *</label>
                <input value={form.name} onChange={f('name')} className="input" placeholder="Product name..." />
              </div>
              <div>
                <label className="label">Sort name</label>
                <input value={form.sort_name} onChange={f('sort_name')} className="input" placeholder="10-100" />
              </div>
              <div className="col-span-2">
                <label className="label">Description</label>
                <textarea value={form.description} onChange={f('description')} className="input resize-none h-9 py-1.5 text-sm" placeholder="Description" />
              </div>

              <div>
                <label className="label">Product SKU (Barcode Number)</label>
                <input value={form.sku} onChange={f('sku')} className="input font-mono" placeholder="SKU (Barcode Number)" />
              </div>
              <div>
                <label className="label">Product ISBN</label>
                <input value={form.isbn} onChange={f('isbn')} className="input" placeholder="ISBN" />
              </div>
              <div>
                <label className="label">Category *</label>
                <div className="flex gap-1.5">
                  <select value={form.category_id} onChange={f('category_id')} className="input flex-1">
                    <option value="">Select category</option>
                    {localCategories.filter(c => c.is_active).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <button onClick={() => setShowAddCategory(true)} className="btn-primary btn-sm w-9 flex items-center justify-center flex-shrink-0" title="Add category">
                    <Plus size={14} />
                  </button>
                </div>
              </div>
              <div>
                <label className="label">Brand</label>
                <input value={form.brand} onChange={f('brand')} className="input" placeholder="Brand name..." />
              </div>

              <div>
                <label className="label">Rack No</label>
                <input value={form.rack_no} onChange={f('rack_no')} className="input" placeholder="A1" />
              </div>
              <div>
                <label className="label">Alert Qty</label>
                <input type="number" value={form.alert_qty} onChange={f('alert_qty')} className="input" min="0" />
              </div>
              <div>
                <label className="label">Weight</label>
                <input type="number" value={form.weight} onChange={f('weight')} className="input" min="0" step="0.01" placeholder="weight" />
              </div>
              <div>
                <label className="label">Base Cost</label>
                <div className="flex">
                  <span className="flex items-center px-2.5 rounded-l-lg text-sm" style={{ background: 'var(--bg-page)', border: '1px solid var(--border-2)', borderRight: 'none', color: 'var(--text-3)' }}>Rs.</span>
                  <input type="number" value={form.cost_price} onChange={f('cost_price')} className="input rounded-l-none border-l-0" min="0" step="0.01" />
                </div>
              </div>

              <div>
                <label className="label">Base Price</label>
                <div className="flex">
                  <span className="flex items-center px-2.5 rounded-l-lg text-sm" style={{ background: 'var(--bg-page)', border: '1px solid var(--border-2)', borderRight: 'none', color: 'var(--text-3)' }}>Rs.</span>
                  <input type="number" value={form.selling_price} onChange={f('selling_price')} className="input rounded-l-none border-l-0" min="0" step="0.01" />
                </div>
              </div>
              <div>
                <label className="label">Wholesale Price</label>
                <div className="flex">
                  <span className="flex items-center px-2.5 rounded-l-lg text-sm" style={{ background: 'var(--bg-page)', border: '1px solid var(--border-2)', borderRight: 'none', color: 'var(--text-3)' }}>Rs.</span>
                  <input type="number" value={form.wholesale_price} onChange={f('wholesale_price')} className="input rounded-l-none border-l-0" min="0" step="0.01" />
                </div>
              </div>
              <div>
                <label className="label">Tax Rate (%)</label>
                <input type="number" value={form.tax_rate} onChange={f('tax_rate')} className="input" min="0" max="100" step="0.5" />
              </div>
              <div>
                <label className="label">Image</label>
                <div className="flex items-center gap-2">
                  <div onClick={uploadImage}
                    className="w-16 h-16 rounded-lg flex flex-col items-center justify-center cursor-pointer hover:border-brand-500 transition-colors flex-shrink-0 overflow-hidden"
                    style={{ background: 'var(--bg-page)', border: '2px dashed var(--border-2)' }}>
                    {form.image_url
                      ? <img src={form.image_url} className="w-full h-full object-cover" alt="" />
                      : <><Package size={16} style={{ color: 'var(--text-3)' }} /><span className="text-[9px] mt-0.5" style={{ color: 'var(--text-3)' }}>NO IMAGE</span></>
                    }
                  </div>
                  <div className="flex flex-col gap-1">
                    <button onClick={uploadImage} disabled={uploading} className="btn-secondary btn-sm gap-1 text-xs">
                      <Upload size={11} />{uploading ? 'Uploading...' : 'Upload'}
                    </button>
                    {form.image_url && <button onClick={() => setForm(p => ({...p, image_url: ''}))} className="btn-ghost btn-sm p-1"><X size={11} /></button>}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ── Section 2: UOM ───────────────────────────────────────── */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-bold underline" style={{ color: 'var(--text-1)' }}>Product Units of Measure (UOM)</h3>
              <button onClick={addUOM} className="btn-primary btn-sm gap-1"><Plus size={12}/> Add UOM</button>
            </div>
            <div className="flex items-center gap-2 bg-cyan-900/30 border border-cyan-700/40 rounded-lg px-3 py-2 mb-3">
              <Info size={13} className="text-cyan-400 flex-shrink-0" />
              <p className="text-xs text-cyan-300">
                <strong>UOM Hierarchy:</strong> Please select UOMs from high to low hierarchy (e.g., KG → G, L → ML, M → CM).
              </p>
            </div>
            <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--border)' }}>
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ background: 'var(--bg-page)' }}>
                    <th className="text-left px-3 py-2 font-medium text-xs" style={{ color: 'var(--text-3)' }}>UOM <span className="text-red-500">*</span></th>
                    <th className="text-left px-3 py-2 font-medium text-xs" style={{ color: 'var(--text-3)' }}>Conversion Factor <span className="text-red-500">*</span></th>
                    <th className="text-center px-3 py-2 font-medium text-xs" style={{ color: 'var(--text-3)' }}>Is Base</th>
                    <th className="text-left px-3 py-2 font-medium text-xs" style={{ color: 'var(--text-3)' }}>Wastage</th>
                    <th className="w-8 px-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {uoms.map((row, i) => (
                    <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                      <td className="px-3 py-2">
                        <div className="flex gap-1">
                          <input value={row.uom_name} onChange={e => setUOM(i, 'uom_name', e.target.value)}
                            className="input text-sm py-1.5" placeholder="e.g. KG, PCS, L..." />
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex gap-1">
                          <input type="number" value={row.conversion_factor}
                            onChange={e => setUOM(i, 'conversion_factor', parseFloat(e.target.value)||1)}
                            className="input text-sm py-1.5 w-24" min="0" step="0.001" />
                          <button className="btn-ghost btn-sm p-1.5" title="Calculator"><Calculator size={12} /></button>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-center">
                        <input type="checkbox" checked={row.is_base}
                          onChange={() => setBaseUOM(i)}
                          className="w-4 h-4 accent-brand-500 cursor-pointer" />
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1">
                          <input type="number" value={row.wastage}
                            onChange={e => setUOM(i, 'wastage', parseFloat(e.target.value)||0)}
                            className="input text-sm py-1.5 w-20" min="0" step="0.1" />
                          <span className="text-xs text-slate-400 whitespace-nowrap">{row.uom_name || 'UOM'}</span>
                        </div>
                      </td>
                      <td className="px-2 py-2">
                        {row.is_base
                          ? <Lock size={13} className="text-slate-600" />
                          : <button onClick={() => removeUOM(i)} className="text-red-400 hover:text-red-300">
                              <Trash2 size={13} />
                            </button>
                        }
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── Section 3: Other Details ──────────────────────────────── */}
          <div>
            <h3 className="text-sm font-bold text-white underline mb-3">Product Other Details</h3>
            <div className="flex flex-wrap gap-x-6 gap-y-2 mb-4">
              {([
                ['not_for_sale',           'Not for sale'],
                ['enable_emi',             'Enable EMI'],
                ['is_manage_stock',        'Manage Stock'],
                ['sale_as_latest_price',   'Sale as Latest price'],
                ['fast_product',           'Fast product'],
              ] as [keyof typeof form, string][]).map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={Boolean(form[key])} onChange={check(key)} className="w-4 h-4 accent-brand-500" />
                  <span className="text-sm text-slate-300">{label}</span>
                </label>
              ))}
            </div>
            <div className="flex items-end gap-3 mb-4">
              <div className="flex-1 max-w-xs">
                <label className="label">Employee Commission</label>
                <div className="flex">
                  <input type="number" value={form.employee_commission} onChange={f('employee_commission')}
                    className="input rounded-r-none border-r-0 w-28" min="0" step="0.01" />
                  <select value={form.commission_type} onChange={f('commission_type')} className="input rounded-l-none border-l-0 w-24">
                    <option value="fixed">Rs</option>
                    <option value="percent">%</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div><label className="label">Custom Field1</label><input value={form.custom_field1} onChange={f('custom_field1')} className="input" placeholder="Custom Field1" /></div>
              <div><label className="label">Custom Field2</label><input value={form.custom_field2} onChange={f('custom_field2')} className="input" placeholder="Custom Field2" /></div>
              <div><label className="label">Custom Field3</label><input value={form.custom_field3} onChange={f('custom_field3')} className="input" placeholder="Custom Field3" /></div>
            </div>
          </div>

          {/* ── Section 4: Product Types ───────────────────────────────── */}
          <div>
            <h3 className="text-sm font-bold text-white underline mb-3">Product Types (Single, Variable or combo)</h3>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="label">Applicable tax</label>
                <select value={form.tax_rate.toString()} onChange={e => setForm(p => ({...p, tax_rate: parseFloat(e.target.value)||0}))} className="input">
                  <option value="0">None (0%)</option>
                  <option value="5">5%</option>
                  <option value="8">8%</option>
                  <option value="10">10%</option>
                  <option value="15">15%</option>
                  <option value="18">18%</option>
                </select>
              </div>
              <div>
                <label className="label">Sale By</label>
                <select value={form.sale_by} onChange={f('sale_by')} className="input">
                  <option value="normal">Normal</option>
                  <option value="weight">Weight</option>
                  <option value="uom">UOM</option>
                </select>
              </div>
              <div>
                <label className="label">Product Type *</label>
                <select value={form.product_type} onChange={f('product_type')} className="input">
                  <option value="single">Single</option>
                  <option value="variable">Variable</option>
                  <option value="combo">Combo</option>
                </select>
              </div>
            </div>
          </div>

          {/* ── Stock ─────────────────────────────────────────────────── */}
          <div>
            <label className="label">{product ? 'Current Stock Qty' : 'Initial Stock Qty'}</label>
            <input type="number" value={stockQty} onChange={e => setStockQty(parseInt(e.target.value)||0)}
              className="input w-40" min="0" />
          </div>

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
