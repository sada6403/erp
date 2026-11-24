import { useCallback, useEffect, useState } from 'react'
import { Search } from 'lucide-react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'

interface Product { id: string; name: string; sku: string; selling_price: number; image_url: string | null; is_online: number; is_featured: number }
interface Deal { id: string; product_name: string; selling_price: number; deal_price: number; type: string; value: number; valid_until: string }

export default function ProductsTab() {
  return <div className="space-y-2">
    <FlashDeals />
    <OnlineProducts />
  </div>
}

/** Flash deals are the dated product discounts from Discounts. Nothing is priced here. */
function FlashDeals() {
  const [deals, setDeals] = useState<Deal[]>([])
  useEffect(() => { window.api.onlineStore.flashDealsList().then((r: any) => { if (r.success) setDeals(r.data) }).catch(() => {}) }, [])
  return <div className="px-6 pt-6">
    <div className="rounded-lg bg-surface-800 p-4 space-y-2">
      <div className="flex items-center justify-between"><div><p className="font-medium">Flash deals in the app</p>
        <p className="text-xs text-slate-500">A product with an active, dated product discount shows as a flash deal with a countdown. Create or end deals in <Link className="text-brand-400 underline" to="/admin/discounts">Discounts</Link> (the minimum-price rules there apply).</p></div></div>
      {deals.map(d => <div key={d.id} className="flex items-center justify-between text-sm border-t border-slate-700 pt-2">
        <span className="truncate">{d.product_name}</span>
        <span className="text-xs text-slate-400">Rs.{Number(d.selling_price).toLocaleString()} to Rs.{Number(d.deal_price).toLocaleString()} until {String(d.valid_until).slice(0, 16).replace('T', ' ')}</span></div>)}
      {!deals.length && <p className="text-xs text-slate-500">No active flash deals.</p>}
    </div>
  </div>
}

function OnlineProducts() {
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
  const feature = async (ids: string[], on: boolean) => {
    try {
      const r = await window.api.onlineStore.setFeatured(ids, on)
      if (r.success) { toast.success(`${r.data.updated} product(s) ${on ? 'featured' : 'no longer featured'}`); setSel(new Set()); load() } else toast.error(r.error)
    } catch (err) { toast.error('Failed to update products: ' + String(err)) }
  }
  const toggle = (id: string) => setSel(p => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n })
  return <div className="p-6 space-y-4">
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
        <input className="input pl-8 w-60" placeholder="Search name or SKU" value={search} onChange={e => setSearch(e.target.value)} /></div>
      <select className="input w-40" value={online} onChange={e => setOnline(e.target.value as '' | 'on' | 'off')}><option value="">All products</option><option value="on">Online</option><option value="off">Hidden</option></select>
      <button className="btn-secondary btn-sm" disabled={!sel.size} onClick={() => apply(Array.from(sel), true)}>Show selected ({sel.size})</button>
      <button className="btn-secondary btn-sm" disabled={!sel.size} onClick={() => feature(Array.from(sel), true)}>Feature selected</button>
      <button className="btn-secondary btn-sm" disabled={!sel.size} onClick={() => feature(Array.from(sel), false)}>Unfeature</button>
      <button className="btn-secondary btn-sm" disabled={!sel.size} onClick={() => apply(Array.from(sel), false)}>Hide selected</button>
    </div>
    <table className="w-full"><thead><tr><th className="table-header px-4 py-3 w-8"><input type="checkbox" checked={items.length > 0 && items.every(i => sel.has(i.id))} onChange={e => setSel(e.target.checked ? new Set(items.map(i => i.id)) : new Set())} /></th>
      {['Product', 'SKU', 'Price', 'In app', 'Featured'].map(h => <th className="table-header px-4 py-3 text-left" key={h}>{h}</th>)}</tr></thead>
      <tbody>{items.map(p => <tr className="table-row" key={p.id}>
        <td className="table-cell"><input type="checkbox" checked={sel.has(p.id)} onChange={() => toggle(p.id)} /></td>
        <td className="table-cell font-medium">{p.name}</td><td className="table-cell font-mono text-xs text-slate-400">{p.sku}</td>
        <td className="table-cell">Rs.{Number(p.selling_price).toLocaleString()}</td>
        <td className="table-cell"><button className={Number(p.is_online) ? 'badge-green' : 'badge-gray'} onClick={() => apply([p.id], !Number(p.is_online))}>{Number(p.is_online) ? 'Online' : 'Hidden'}</button></td>
        <td className="table-cell"><button className={Number(p.is_featured) ? 'badge-green' : 'badge-gray'} onClick={() => feature([p.id], !Number(p.is_featured))}>{Number(p.is_featured) ? 'Featured' : 'No'}</button></td>
      </tr>)}
        {items.length === 0 && <tr><td colSpan={6} className="table-cell text-center text-slate-500 py-10">No products</td></tr>}</tbody></table>
    {items.length === 500 && <p className="text-xs text-slate-500">Showing the first 500. Use search to narrow down.</p>}
  </div>
}
