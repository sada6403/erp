import { useCallback, useEffect, useState } from 'react'
import { Plus, Trash2, GripVertical } from 'lucide-react'
import Modal from '@/components/shared/Modal'
import { resolveImageSrc } from '@/lib/imageUrl'
import toast from 'react-hot-toast'

// Recommended artwork: 16:7 (1200 x 525 px, minimum 800 x 350), keep text and logos in the central 80%. The app card is screen width minus 32 dp.
const ASPECT = 16 / 7
const LINK_TYPES = [['none', 'No link'], ['product', 'A product'], ['category', 'A category'], ['flash', 'Flash deals'], ['smartbuy', 'Smart Buy'], ['url', 'Web page (https)']] as const
const AUDIENCES = [['all', 'Everyone'], ['guests', 'Guests (not signed in)'], ['customers', 'Signed-in customers (not Smart Buy members)'], ['members', 'Smart Buy members']] as const
const LANGS = [['en', 'English'], ['ta', 'Tamil'], ['si', 'Sinhala']] as const

interface Banner {
  id?: string; title: string; subtitle: string | null; image_url: string | null
  image_en: string | null; image_ta: string | null; image_si: string | null
  link_type: string; link_target: string | null; link_url?: string | null; audience: string
  sort_order: number; is_active: number | boolean; starts_at: string | null; ends_at: string | null
}
interface Stat { impressions: number; taps: number }

const EMPTY: Banner = { title: '', subtitle: '', image_url: '', image_en: '', image_ta: '', image_si: '', link_type: 'none', link_target: '', audience: 'all', sort_order: 0, is_active: 1, starts_at: '', ends_at: '' }

// Stored as Colombo wall time 'YYYY-MM-DD HH:MM:SS'; may come back from the cloud as an ISO string with the same digits.
const wall = (v: string | null | undefined) => (v ? String(v).replace(' ', 'T').slice(0, 16) : '')
const fmtWall = (v: string | null) => (v ? wall(v).replace('T', ' ') : '')

function effectiveType(b: Banner): string {
  if ((!b.link_type || b.link_type === 'none') && b.link_url && /^https:\/\//i.test(b.link_url)) return 'url'
  return b.link_type || 'none'
}
function statusOf(b: Banner): { label: string; cls: string } {
  if (!Number(b.is_active)) return { label: 'Hidden', cls: 'badge-gray' }
  const now = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 16)
  if (b.starts_at && wall(b.starts_at) > now) return { label: 'Scheduled', cls: 'badge-gray' }
  if (b.ends_at && wall(b.ends_at) < now) return { label: 'Ended', cls: 'badge-gray' }
  return { label: 'Live', cls: 'badge-green' }
}

export default function BannersTab() {
  const [banners, setBanners] = useState<Banner[]>([])
  const [editing, setEditing] = useState<Banner | null>(null)
  const [stats, setStats] = useState<Record<string, Stat>>({})
  const [statsNote, setStatsNote] = useState('')
  const [dragId, setDragId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await window.api.onlineStore.bannersList()
      if (r.success) setBanners(r.data); else toast.error(r.error || 'Failed to load banners')
    } catch (err) { toast.error('Failed to load banners: ' + String(err)) }
  }, [])
  const loadStats = useCallback(async () => {
    try {
      const r = await window.api.onlineStore.bannerStats()
      if (r.success) {
        const m: Record<string, Stat> = {}
        for (const i of r.data.items) m[i.banner_id] = { impressions: i.impressions, taps: i.taps }
        setStats(m); setStatsNote('')
      } else setStatsNote(r.error || 'Stats unavailable')
    } catch (err) { setStatsNote('Stats unavailable: ' + String(err)) }
  }, [])
  useEffect(() => { void load(); void loadStats() }, [load, loadStats])

  const remove = async (b: Banner) => {
    if (!window.confirm(`Delete this banner${b.title ? ` "${b.title}"` : ''}?`)) return
    try {
      const r = await window.api.onlineStore.bannerDelete(b.id)
      if (r.success) { toast.success('Banner deleted'); void load() } else toast.error(r.error)
    } catch (err) { toast.error('Failed to delete banner: ' + String(err)) }
  }
  const toggle = async (b: Banner) => {
    try {
      const r = await window.api.onlineStore.bannerSetActive(b.id, !Number(b.is_active))
      if (r.success) void load(); else toast.error(r.error)
    } catch (err) { toast.error('Failed: ' + String(err)) }
  }
  const drop = async (targetId: string) => {
    if (!dragId || dragId === targetId) return
    const ids = banners.map(b => b.id as string)
    ids.splice(ids.indexOf(dragId), 1)
    ids.splice(ids.indexOf(targetId), 0, dragId)
    setBanners(ids.map(id => banners.find(b => b.id === id) as Banner))
    setDragId(null)
    try {
      const r = await window.api.onlineStore.bannersReorder(ids)
      if (!r.success) { toast.error(r.error); void load() }
    } catch (err) { toast.error('Failed to reorder: ' + String(err)); void load() }
  }
  const liveCount = banners.filter(b => statusOf(b).label === 'Live').length

  return <div className="p-6 space-y-4">
    <div className="flex items-center gap-3 flex-wrap">
      <button className="btn-primary btn-sm" onClick={() => setEditing({ ...EMPTY })}><Plus size={14} /> New banner</button>
      <p className="text-xs text-slate-500">Recommended image: 16:7, 1200 x 525 px (minimum 800 x 350). Drag rows to change the order. The app shows at most 10 live banners.</p>
    </div>
    {liveCount > 10 && <p className="text-xs text-amber-400">{liveCount} banners are live; the app shows only the first 10.</p>}
    {statsNote && <p className="text-xs text-slate-500">{statsNote} (last 30 days of views and taps needs the cloud connection)</p>}
    <table className="w-full"><thead><tr>{['', 'Image', 'Banner', 'Status', 'Audience', 'Schedule (Colombo)', 'Views / taps', ''].map((h, i) => <th className="table-header px-3 py-3 text-left" key={i}>{h}</th>)}</tr></thead>
      <tbody>{banners.map(b => {
        const st = statusOf(b); const sx = stats[b.id as string]
        return <tr className={`table-row ${dragId === b.id ? 'opacity-50' : ''}`} key={b.id} draggable
          onDragStart={() => setDragId(b.id as string)} onDragOver={e => e.preventDefault()} onDrop={() => void drop(b.id as string)} onDragEnd={() => setDragId(null)}>
          <td className="table-cell cursor-grab text-slate-500"><GripVertical size={16} /></td>
          <td className="table-cell">{b.image_url ? <img src={resolveImageSrc(b.image_url)} alt="" className="h-10 w-20 object-cover rounded" /> : '—'}</td>
          <td className="table-cell"><p className="font-medium">{b.title || <span className="text-slate-500">(image only)</span>}</p><p className="text-xs text-slate-500">{b.subtitle}</p>
            <p className="text-xs text-slate-500">{LINK_TYPES.find(l => l[0] === effectiveType(b))?.[1]}</p></td>
          <td className="table-cell"><button className={st.cls} onClick={() => toggle(b)} title="Click to show / hide">{st.label}</button></td>
          <td className="table-cell text-xs text-slate-400">{AUDIENCES.find(a => a[0] === b.audience)?.[1] ?? 'Everyone'}</td>
          <td className="table-cell text-xs text-slate-400">{b.starts_at ? fmtWall(b.starts_at) : 'Now'} to {b.ends_at ? fmtWall(b.ends_at) : 'no end'}</td>
          <td className="table-cell text-xs">{sx ? `${sx.impressions} / ${sx.taps}${sx.impressions ? ` (${((sx.taps / sx.impressions) * 100).toFixed(1)}%)` : ''}` : '—'}</td>
          <td className="table-cell"><div className="flex gap-2 justify-end">
            <button className="btn-secondary btn-sm" onClick={() => setEditing({ ...EMPTY, ...b, subtitle: b.subtitle ?? '', image_url: b.image_url ?? '', image_en: b.image_en ?? '', image_ta: b.image_ta ?? '', image_si: b.image_si ?? '',
              link_type: effectiveType(b), link_target: b.link_target || b.link_url || '', starts_at: wall(b.starts_at), ends_at: wall(b.ends_at) })}>Edit</button>
            <button className="btn-ghost btn-sm text-red-400" onClick={() => remove(b)}><Trash2 size={14} /></button></div></td>
        </tr>
      })}
        {banners.length === 0 && <tr><td colSpan={8} className="table-cell text-center text-slate-500 py-10">No banners yet. Without banners the app hides the banner section.</td></tr>}</tbody></table>
    {editing && <BannerForm banner={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); void load() }} />}
  </div>
}

/** Image box in the banner ratio. object-cover shows exactly how the app crops the picture. */
function CropPreview({ src, onRatio }: { src: string; onRatio?: (r: number) => void }) {
  return <div className="relative w-full overflow-hidden rounded-lg bg-surface-800 border border-slate-700" style={{ aspectRatio: String(ASPECT) }}>
    {src ? <img src={resolveImageSrc(src)} alt="" className="absolute inset-0 h-full w-full object-cover" onLoad={e => onRatio?.(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight)} />
      : <div className="absolute inset-0 flex items-center justify-center text-xs text-slate-500">16:7 area, 1200 x 525 px</div>}
    <div className="pointer-events-none absolute border border-dashed border-white/50" style={{ left: '10%', right: '10%', top: '10%', bottom: '10%' }} />
  </div>
}

function ImagePicker({ label, value, onChange, onRatio, compact }: { label: string; value: string; onChange: (v: string) => void; onRatio?: (r: number) => void; compact?: boolean }) {
  const [busy, setBusy] = useState(false)
  const upload = async () => {
    setBusy(true)
    try {
      const r = await window.api.products.selectAndUploadImage() as { success: boolean; data?: string; local_only?: boolean; error?: string }
      if (r.success && r.data) {
        onChange(r.data)
        if (r.local_only) toast('Image saved on this device only. Configure cloud storage so the app can load it.', { duration: 6000 })
      } else if (r.error && r.error !== 'Cancelled') toast.error(r.error)
    } catch (err) { toast.error('Image upload failed: ' + String(err)) } finally { setBusy(false) }
  }
  return <div className="space-y-1">
    <label className="text-xs text-slate-400">{label}</label>
    <div className={compact ? 'w-40' : ''}><CropPreview src={value} onRatio={onRatio} /></div>
    <div className="flex gap-2"><button className="btn-secondary btn-sm" disabled={busy} onClick={upload}>{busy ? 'Uploading…' : value ? 'Replace' : 'Choose image'}</button>
      {value && <button className="btn-ghost btn-sm" onClick={() => onChange('')}>Remove</button>}</div>
  </div>
}

function BannerForm({ banner, onClose, onDone }: { banner: Banner; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState<Banner>(banner)
  const [ratio, setRatio] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [hits, setHits] = useState<Array<{ id: string; name: string }>>([])
  const [cats, setCats] = useState<Array<{ id: string; name: string }>>([])
  const [targetName, setTargetName] = useState('')
  const set = (p: Partial<Banner>) => setF(prev => ({ ...prev, ...p }))

  useEffect(() => { window.api.onlineStore.categoriesList().then((r: any) => { if (r.success) setCats(r.data) }).catch(() => {}) }, [])
  useEffect(() => {
    if (f.link_type !== 'product') return
    const t = setTimeout(() => {
      window.api.onlineStore.productsList({ search }).then((r: any) => {
        if (r.success) {
          setHits(r.data.slice(0, 8))
          const cur = r.data.find((p: any) => p.id === f.link_target); if (cur) setTargetName(cur.name)
        }
      }).catch(() => {})
    }, 250)
    return () => clearTimeout(t)
  }, [search, f.link_type, f.link_target])

  const ratioOff = ratio !== null && Math.abs(ratio - ASPECT) / ASPECT > 0.1
  const save = async () => {
    setSaving(true)
    try {
      const r = await window.api.onlineStore.bannerSave({ ...f, is_active: Number(f.is_active) ? 1 : 0 })
      if (r.success) { toast.success('Banner saved. It reaches the app after the next sync.'); onDone() } else toast.error(r.error)
    } catch (err) { toast.error('Failed to save banner: ' + String(err)) } finally { setSaving(false) }
  }
  const previewImg = f.image_en || f.image_url || ''
  return <Modal title={f.id ? 'Edit banner' : 'New banner'} size="xl" onClose={onClose}
    footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</button></>}>
    <div className="grid grid-cols-[1fr_15rem] gap-6">
      <div className="grid grid-cols-2 gap-3 content-start">
        <div className="col-span-2">
          <ImagePicker label="Banner image (default) *" value={f.image_url ?? ''} onChange={v => set({ image_url: v })} onRatio={setRatio} />
          <p className="text-xs text-slate-500 mt-1">Recommended 16:7, 1200 x 525 px (minimum 800 x 350), JPG / PNG / WebP. The box above shows how the app crops it. Keep text and logos inside the central 80% (dashed guide).</p>
          {ratioOff && <p className="text-xs text-amber-400 mt-1">This image is not 16:7, so the app will crop its edges.</p>}
        </div>
        <div className="col-span-2"><p className="text-xs text-slate-400 mb-1">Optional images per language (used instead of the default when the app is in that language)</p>
          <div className="grid grid-cols-3 gap-3">{LANGS.map(([k, name]) =>
            <ImagePicker key={k} compact label={name} value={(f as any)[`image_${k}`] ?? ''} onChange={v => set({ [`image_${k}`]: v } as Partial<Banner>)} />)}</div></div>
        <div className="col-span-2"><label className="text-xs text-slate-400">Title (optional)</label><input className="input mt-1" maxLength={120} value={f.title} onChange={e => set({ title: e.target.value })} /></div>
        <div className="col-span-2"><label className="text-xs text-slate-400">Subtitle (optional)</label><input className="input mt-1" maxLength={200} value={f.subtitle ?? ''} onChange={e => set({ subtitle: e.target.value })} /></div>
        <div><label className="text-xs text-slate-400">When tapped, open</label>
          <select className="input mt-1" value={f.link_type} onChange={e => { set({ link_type: e.target.value, link_target: '' }); setTargetName('') }}>
            {LINK_TYPES.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></div>
        <div>
          {f.link_type === 'url' && <><label className="text-xs text-slate-400">Web address (https only)</label>
            <input className="input mt-1" placeholder="https://" value={f.link_target ?? ''} onChange={e => set({ link_target: e.target.value })} /></>}
          {f.link_type === 'category' && <><label className="text-xs text-slate-400">Category</label>
            <select className="input mt-1" value={f.link_target ?? ''} onChange={e => set({ link_target: e.target.value })}><option value="">Select…</option>{cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></>}
          {f.link_type === 'product' && <><label className="text-xs text-slate-400">Product {f.link_target && targetName ? `: ${targetName}` : ''}</label>
            <input className="input mt-1" placeholder="Search name or SKU" value={search} onChange={e => setSearch(e.target.value)} />
            {search && <div className="mt-1 rounded border border-slate-700 bg-surface-800 max-h-36 overflow-auto">{hits.map(h =>
              <button key={h.id} className={`block w-full text-left px-2 py-1 text-xs hover:bg-slate-700 ${h.id === f.link_target ? 'text-brand-400' : ''}`}
                onClick={() => { set({ link_target: h.id }); setTargetName(h.name); setSearch('') }}>{h.name}</button>)}
              {!hits.length && <p className="px-2 py-1 text-xs text-slate-500">No products found</p>}</div>}</>}
          {(f.link_type === 'flash' || f.link_type === 'smartbuy') && <p className="text-xs text-slate-500 mt-6">No extra choice needed.</p>}
        </div>
        <div className="col-span-2"><label className="text-xs text-slate-400">Show to</label>
          <select className="input mt-1" value={f.audience} onChange={e => set({ audience: e.target.value })}>{AUDIENCES.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></div>
        <div><label className="text-xs text-slate-400">Starts (Sri Lanka time)</label><input type="datetime-local" className="input mt-1" value={wall(f.starts_at)} onChange={e => set({ starts_at: e.target.value })} /></div>
        <div><label className="text-xs text-slate-400">Ends (Sri Lanka time)</label><input type="datetime-local" className="input mt-1" value={wall(f.ends_at)} onChange={e => set({ ends_at: e.target.value })} /></div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(Number(f.is_active))} onChange={e => set({ is_active: e.target.checked ? 1 : 0 })} /> Active</label>
      </div>
      <div>
        <p className="text-xs text-slate-400 mb-2">Phone preview</p>
        <div className="mx-auto w-56 rounded-[1.5rem] border-4 border-slate-600 bg-slate-900 p-2">
          <div className="h-3 w-16 mx-auto rounded-full bg-slate-700 mb-2" />
          <div className="relative overflow-hidden rounded-lg" style={{ aspectRatio: String(ASPECT) }}>
            {previewImg ? <img src={resolveImageSrc(previewImg)} alt="" className="absolute inset-0 h-full w-full object-cover" /> : <div className="absolute inset-0 bg-slate-700" />}
            {(f.title || f.subtitle) && <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-2">
              {f.title && <p className="text-[11px] font-bold text-white leading-tight">{f.title}</p>}
              {f.subtitle && <p className="text-[9px] text-white/80 leading-tight">{f.subtitle}</p>}</div>}
          </div>
          <div className="mt-2 space-y-1.5">{[0, 1, 2].map(i => <div key={i} className="h-3 rounded bg-slate-800" />)}</div>
        </div>
      </div>
    </div>
  </Modal>
}
