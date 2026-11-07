import { useCallback, useEffect, useState } from 'react'
import { Plus, Search, Trash2 } from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
import Modal from '@/components/shared/Modal'
import { resolveImageSrc } from '@/lib/imageUrl'
import toast from 'react-hot-toast'

type Tab = 'settings' | 'banners' | 'products'
interface Banner {
  id?: string; title: string; subtitle: string | null; image_url: string | null; link_url: string | null
  sort_order: number; is_active: number | boolean; starts_at: string | null; ends_at: string | null
}
interface Product { id: string; name: string; sku: string; selling_price: number; image_url: string | null; is_online: number }

const EMPTY_BANNER: Banner = { title: '', subtitle: '', image_url: '', link_url: '', sort_order: 0, is_active: 1, starts_at: '', ends_at: '' }

export default function OnlineStorePage() {
  const [tab, setTab] = useState<Tab>('settings')
  return <div className="flex flex-col h-full overflow-hidden">
    <PageHeader title="Online Store" subtitle="What customers see and can do in the mobile app" />
    <div className="flex gap-2 px-6 py-3 border-b border-slate-800">
      {([['settings', 'Ordering & delivery'], ['banners', 'Banners'], ['products', 'Online products']] as const).map(([k, label]) =>
        <button key={k} onClick={() => setTab(k)} className={`px-3 py-1.5 rounded-lg text-xs ${tab === k ? 'bg-brand-600 text-white' : 'bg-surface-800 text-slate-400'}`}>{label}</button>)}
    </div>
    <div className="flex-1 overflow-auto">
      {tab === 'settings' && <SettingsTab />}
      {tab === 'banners' && <BannersTab />}
      {tab === 'products' && <ProductsTab />}
    </div>
  </div>
}

function SettingsTab() {
  const [s, setS] = useState<Record<string, string> | null>(null)
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    window.api.onlineStore.settingsGet()
      .then((r: any) => { if (r.success) setS(r.data); else toast.error(r.error || 'Failed to load settings') })
      .catch((err: unknown) => toast.error('Failed to load settings: ' + String(err)))
  }, [])
  if (!s) return <p className="p-6 text-slate-500 text-sm">Loading…</p>
  const set = (k: string, v: string) => setS({ ...s, [k]: v })
  const save = async () => {
    setSaving(true)
    try {
      const res = await window.api.onlineStore.settingsSave(s)
      if (res.success) toast.success('Saved. Changes reach the app after the next sync.'); else toast.error(res.error)
    } catch (err) {
      toast.error('Failed to save: ' + String(err))
    } finally { setSaving(false) }
  }
  const ordering = s.ordering_enabled === '1'
  return <div className="p-6 max-w-2xl space-y-5">
    <div className="flex items-center justify-between rounded-lg bg-surface-800 p-4">
      <div><p className="font-medium">Accept orders from the app</p><p className="text-xs text-slate-500">Turn off to stop new app orders (browsing still works).</p></div>
      <button className={ordering ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'} onClick={() => set('ordering_enabled', ordering ? '0' : '1')}>{ordering ? 'Ordering ON' : 'Ordering OFF'}</button>
    </div>
    <div><label className="text-xs text-slate-400">Maintenance message (shown in the app when ordering is off)</label>
      <textarea className="input mt-1" rows={2} maxLength={500} value={s.maintenance_message} onChange={e => set('maintenance_message', e.target.value)} /></div>
    <div className="grid grid-cols-2 gap-3">
      <div><label className="text-xs text-slate-400">Delivery fee (Rs.)</label>
        <input className="input mt-1" type="number" min={0} value={s.delivery_flat_fee} onChange={e => set('delivery_flat_fee', e.target.value)} /></div>
      <div><label className="text-xs text-slate-400">Free delivery over (Rs., blank = never)</label>
        <input className="input mt-1" type="number" min={0} value={s.delivery_free_over} onChange={e => set('delivery_free_over', e.target.value)} /></div>
      <div><label className="text-xs text-slate-400">Minimum app version</label>
        <input className="input mt-1" placeholder="1.0.0" value={s.min_app_version} onChange={e => set('min_app_version', e.target.value)} />
        <p className="text-xs text-slate-500 mt-1">Older versions are asked to update before they can continue.</p></div>
      <div><label className="text-xs text-slate-400">App download link (used in invites)</label>
        <input className="input mt-1" placeholder="https://" value={s.download_link} onChange={e => set('download_link', e.target.value)} /></div>
    </div>
    <button className="btn-primary" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save settings'}</button>
  </div>
}

function BannersTab() {
  const [banners, setBanners] = useState<Banner[]>([])
  const [editing, setEditing] = useState<Banner | null>(null)
  const load = useCallback(async () => {
    try {
      const r = await window.api.onlineStore.bannersList()
      if (r.success) setBanners(r.data); else toast.error(r.error || 'Failed to load banners')
    } catch (err) { toast.error('Failed to load banners: ' + String(err)) }
  }, [])
  useEffect(() => { load() }, [load])
  const remove = async (b: Banner) => {
    if (!window.confirm(`Delete banner "${b.title}"?`)) return
    try {
      const r = await window.api.onlineStore.bannerDelete(b.id)
      if (r.success) { toast.success('Banner deleted'); load() } else toast.error(r.error)
    } catch (err) { toast.error('Failed to delete banner: ' + String(err)) }
  }
  return <div className="p-6 space-y-4">
    <button className="btn-primary btn-sm" onClick={() => setEditing({ ...EMPTY_BANNER })}><Plus size={14} /> New banner</button>
    <table className="w-full"><thead><tr>{['Image', 'Title', 'Order', 'Active', 'Schedule', ''].map(h => <th className="table-header px-4 py-3 text-left" key={h}>{h}</th>)}</tr></thead>
      <tbody>{banners.map(b => <tr className="table-row" key={b.id}>
        <td className="table-cell">{b.image_url ? <img src={resolveImageSrc(b.image_url)} alt="" className="h-10 w-20 object-cover rounded" /> : '—'}</td>
        <td className="table-cell"><p className="font-medium">{b.title}</p><p className="text-xs text-slate-500">{b.subtitle}</p></td>
        <td className="table-cell">{b.sort_order}</td>
        <td className="table-cell"><span className={Number(b.is_active) ? 'badge-green' : 'badge-gray'}>{Number(b.is_active) ? 'Active' : 'Hidden'}</span></td>
        <td className="table-cell text-xs text-slate-400">{b.starts_at ? new Date(b.starts_at).toLocaleDateString() : 'Now'} to {b.ends_at ? new Date(b.ends_at).toLocaleDateString() : 'no end'}</td>
        <td className="table-cell"><div className="flex gap-2 justify-end">
          <button className="btn-secondary btn-sm" onClick={() => setEditing({ ...b, subtitle: b.subtitle ?? '', image_url: b.image_url ?? '', link_url: b.link_url ?? '', starts_at: b.starts_at ?? '', ends_at: b.ends_at ?? '' })}>Edit</button>
          <button className="btn-ghost btn-sm text-red-400" onClick={() => remove(b)}><Trash2 size={14} /></button></div></td>
      </tr>)}
        {banners.length === 0 && <tr><td colSpan={6} className="table-cell text-center text-slate-500 py-10">No banners yet</td></tr>}</tbody></table>
    {editing && <BannerForm banner={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); load() }} />}
  </div>
}

function BannerForm({ banner, onClose, onDone }: { banner: Banner; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState<Banner>(banner)
  const [uploading, setUploading] = useState(false)
  const upload = async () => {
    setUploading(true)
    try {
      const r = await window.api.products.selectAndUploadImage() as { success: boolean; data?: string; local_only?: boolean; error?: string }
      if (r.success && r.data) {
        setF(p => ({ ...p, image_url: r.data as string }))
        if (r.local_only) toast('Image saved on this device only. Configure cloud storage so the app can load it.', { duration: 6000 })
      } else if (r.error && r.error !== 'Cancelled') toast.error(r.error)
    } catch (err) { toast.error('Image upload failed: ' + String(err)) } finally { setUploading(false) }
  }
  const save = async () => {
    try {
      const r = await window.api.onlineStore.bannerSave({ ...f, is_active: Number(f.is_active) ? 1 : 0 })
      if (r.success) { toast.success('Banner saved'); onDone() } else toast.error(r.error)
    } catch (err) { toast.error('Failed to save banner: ' + String(err)) }
  }
  const day = (v: string | null) => (v ? String(v).slice(0, 10) : '')
  return <Modal title={f.id ? 'Edit banner' : 'New banner'} onClose={onClose}
    footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={save}>Save</button></>}>
    <div className="grid grid-cols-2 gap-3">
      <div className="col-span-2"><label className="text-xs text-slate-400">Title *</label><input className="input mt-1" maxLength={120} value={f.title} onChange={e => setF({ ...f, title: e.target.value })} /></div>
      <div className="col-span-2"><label className="text-xs text-slate-400">Subtitle</label><input className="input mt-1" maxLength={200} value={f.subtitle ?? ''} onChange={e => setF({ ...f, subtitle: e.target.value })} /></div>
      <div className="col-span-2"><label className="text-xs text-slate-400">Image</label>
        <div className="flex items-center gap-3 mt-1">
          {f.image_url && <img src={resolveImageSrc(f.image_url)} alt="" className="h-14 w-28 object-cover rounded" />}
          <button className="btn-secondary btn-sm" disabled={uploading} onClick={upload}>{uploading ? 'Uploading…' : 'Choose image'}</button>
          {f.image_url && <button className="btn-ghost btn-sm" onClick={() => setF({ ...f, image_url: '' })}>Remove</button>}
        </div></div>
      <div className="col-span-2"><label className="text-xs text-slate-400">Link (optional)</label><input className="input mt-1" value={f.link_url ?? ''} onChange={e => setF({ ...f, link_url: e.target.value })} /></div>
      <div><label className="text-xs text-slate-400">Starts</label><input type="date" className="input mt-1" value={day(f.starts_at)} onChange={e => setF({ ...f, starts_at: e.target.value })} /></div>
      <div><label className="text-xs text-slate-400">Ends</label><input type="date" className="input mt-1" value={day(f.ends_at)} onChange={e => setF({ ...f, ends_at: e.target.value })} /></div>
      <div><label className="text-xs text-slate-400">Sort order</label><input type="number" className="input mt-1" value={f.sort_order} onChange={e => setF({ ...f, sort_order: Number(e.target.value) })} /></div>
      <label className="flex items-center gap-2 text-sm mt-6"><input type="checkbox" checked={Boolean(Number(f.is_active))} onChange={e => setF({ ...f, is_active: e.target.checked ? 1 : 0 })} /> Active</label>
    </div>
  </Modal>
}

function ProductsTab() {
  const [items, setItems] = useState<Product[]>([])
  const [search, setSearch] = useState('')
  const [online, setOnline] = useState<'' | 'on' | 'off'>('')
  const [sel, setSel] = useState<Set<string>>(new Set())
  const load = useCallback(async () => {
    try {
      const r = await window.api.onlineStore.productsList({ search, online: online === '' ? undefined : online === 'on' })
      if (r.success) setItems(r.data); else toast.error(r.error || 'Failed to load products')
    } catch (err) { toast.error('Failed to load products: ' + String(err)) }
  }, [search, online])
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t) }, [load])
  const apply = async (ids: string[], on: boolean) => {
    try {
      const r = await window.api.onlineStore.setOnline(ids, on)
      if (r.success) { toast.success(`${r.data.updated} product(s) ${on ? 'shown in' : 'hidden from'} the app`); setSel(new Set()); load() } else toast.error(r.error)
    } catch (err) { toast.error('Failed to update products: ' + String(err)) }
  }
  const toggle = (id: string) => setSel(p => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n })
  return <div className="p-6 space-y-4">
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
        <input className="input pl-8 w-60" placeholder="Search name or SKU" value={search} onChange={e => setSearch(e.target.value)} /></div>
      <select className="input w-40" value={online} onChange={e => setOnline(e.target.value as '' | 'on' | 'off')}><option value="">All products</option><option value="on">Online</option><option value="off">Hidden</option></select>
      <button className="btn-secondary btn-sm" disabled={!sel.size} onClick={() => apply(Array.from(sel), true)}>Show selected ({sel.size})</button>
      <button className="btn-secondary btn-sm" disabled={!sel.size} onClick={() => apply(Array.from(sel), false)}>Hide selected</button>
    </div>
    <table className="w-full"><thead><tr><th className="table-header px-4 py-3 w-8"><input type="checkbox" checked={items.length > 0 && items.every(i => sel.has(i.id))} onChange={e => setSel(e.target.checked ? new Set(items.map(i => i.id)) : new Set())} /></th>
      {['Product', 'SKU', 'Price', 'In app'].map(h => <th className="table-header px-4 py-3 text-left" key={h}>{h}</th>)}</tr></thead>
      <tbody>{items.map(p => <tr className="table-row" key={p.id}>
        <td className="table-cell"><input type="checkbox" checked={sel.has(p.id)} onChange={() => toggle(p.id)} /></td>
        <td className="table-cell font-medium">{p.name}</td><td className="table-cell font-mono text-xs text-slate-400">{p.sku}</td>
        <td className="table-cell">Rs.{Number(p.selling_price).toLocaleString()}</td>
        <td className="table-cell"><button className={Number(p.is_online) ? 'badge-green' : 'badge-gray'} onClick={() => apply([p.id], !Number(p.is_online))}>{Number(p.is_online) ? 'Online' : 'Hidden'}</button></td>
      </tr>)}
        {items.length === 0 && <tr><td colSpan={5} className="table-cell text-center text-slate-500 py-10">No products</td></tr>}</tbody></table>
    {items.length === 500 && <p className="text-xs text-slate-500">Showing the first 500. Use search to narrow down.</p>}
  </div>
}
