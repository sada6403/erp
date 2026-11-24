import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp } from 'lucide-react'
import toast from 'react-hot-toast'

interface Section { key: string; enabled: boolean }
const LABELS: Record<string, [string, string]> = {
  banners: ['Banners', 'Ad banners at the top of the home page'],
  categories: ['Categories', 'Category shortcuts'],
  flash_deals: ['Flash deals', 'Discounted products with a countdown (set up in Discounts)'],
  smartbuy_promo: ['Smart Buy promo', 'Smart Buy invitation card (hidden when Smart Buy is off for the company)'],
  new_arrivals: ['New arrivals', 'Newest products'],
  featured: ['Featured products', 'Hand-picked products'],
}

export default function HomeLayoutTab() {
  const [sections, setSections] = useState<Section[] | null>(null)
  const [saving, setSaving] = useState(false)
  const [dragKey, setDragKey] = useState<string | null>(null)
  useEffect(() => {
    window.api.onlineStore.homeLayoutGet()
      .then((r: any) => { if (r.success) setSections(r.data); else toast.error(r.error || 'Failed to load') })
      .catch((e: unknown) => toast.error('Failed to load: ' + String(e)))
  }, [])
  if (!sections) return <p className="p-6 text-sm text-slate-500">Loading…</p>
  const move = (i: number, d: -1 | 1) => {
    const j = i + d; if (j < 0 || j >= sections.length) return
    const n = [...sections]; [n[i], n[j]] = [n[j], n[i]]; setSections(n)
  }
  const drop = (target: string) => {
    if (!dragKey || dragKey === target) return
    const n = sections.filter(s => s.key !== dragKey)
    n.splice(n.findIndex(s => s.key === target), 0, sections.find(s => s.key === dragKey) as Section)
    setSections(n); setDragKey(null)
  }
  const save = async () => {
    setSaving(true)
    try {
      const r = await window.api.onlineStore.homeLayoutSave(sections)
      if (r.success) toast.success('Saved. The app picks it up after the next sync.'); else toast.error(r.error)
    } catch (e) { toast.error('Failed to save: ' + String(e)) } finally { setSaving(false) }
  }
  return <div className="p-6 max-w-2xl space-y-4">
    <p className="text-xs text-slate-500">Choose which sections appear on the app home page and in what order. A section with nothing to show (for example no live banners) stays hidden automatically.</p>
    <div className="space-y-2">{sections.map((s, i) => <div key={s.key} draggable onDragStart={() => setDragKey(s.key)} onDragOver={e => e.preventDefault()} onDrop={() => drop(s.key)} onDragEnd={() => setDragKey(null)}
      className={`flex items-center gap-3 rounded-lg bg-surface-800 p-3 ${dragKey === s.key ? 'opacity-50' : ''}`}>
      <span className="text-slate-500 w-5 text-center text-sm">{i + 1}</span>
      <div className="flex-1 min-w-0"><p className="font-medium text-sm">{LABELS[s.key]?.[0] ?? s.key}</p><p className="text-xs text-slate-500">{LABELS[s.key]?.[1]}</p></div>
      <button className="btn-ghost btn-sm" disabled={i === 0} onClick={() => move(i, -1)} title="Move up"><ArrowUp size={14} /></button>
      <button className="btn-ghost btn-sm" disabled={i === sections.length - 1} onClick={() => move(i, 1)} title="Move down"><ArrowDown size={14} /></button>
      <button className={s.enabled ? 'btn-primary btn-sm w-16' : 'btn-secondary btn-sm w-16'} onClick={() => setSections(sections.map(x => x.key === s.key ? { ...x, enabled: !x.enabled } : x))}>{s.enabled ? 'On' : 'Off'}</button>
    </div>)}</div>
    <button className="btn-primary" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save home page'}</button>
  </div>
}
