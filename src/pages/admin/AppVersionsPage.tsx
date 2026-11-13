import { useCallback, useEffect, useState } from 'react'
import { RefreshCw, Save, Hash } from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
import toast from 'react-hot-toast'

type Channel = 'test' | 'production'
interface Dto {
  channel: Channel; latest_version: string; min_version: string; critical: boolean
  release_notes: { en: string; ta: string; si: string }
  update_url: string | null; apk_sha256: string | null; apk_size_bytes: number | null
  updated_at: string | null; updated_by: string | null; configured: boolean
}
interface Form {
  latest_version: string; min_version: string; critical: boolean
  en: string; ta: string; si: string; update_url: string; apk_sha256: string; apk_size_bytes: string
}
const toForm = (d: Dto): Form => ({
  latest_version: d.latest_version, min_version: d.min_version, critical: d.critical,
  en: d.release_notes.en, ta: d.release_notes.ta, si: d.release_notes.si,
  update_url: d.update_url ?? '', apk_sha256: d.apk_sha256 ?? '', apk_size_bytes: d.apk_size_bytes == null ? '' : String(d.apk_size_bytes),
})
const VERSION_RE = /^\d{1,4}\.\d{1,4}\.\d{1,4}(?:-[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?$/

export default function AppVersionsPage() {
  const [tab, setTab] = useState<Channel>('test')
  const [forms, setForms] = useState<Partial<Record<Channel, Form>>>({})
  const [meta, setMeta] = useState<Partial<Record<Channel, Dto>>>({})
  const [hosts, setHosts] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const r = await window.api.appVersions.list()
      if (!r.success) { toast.error(r.error || 'Failed to load app versions'); return }
      const f: Partial<Record<Channel, Form>> = {}
      const m: Partial<Record<Channel, Dto>> = {}
      for (const d of r.data.items as Dto[]) { f[d.channel] = toForm(d); m[d.channel] = d }
      setForms(f); setMeta(m); setHosts(r.data.allowed_hosts || [])
    } catch (err) { toast.error('Failed to load app versions: ' + String(err)) }
  }, [])
  useEffect(() => { void load() }, [load])

  const f = forms[tab]
  const d = meta[tab]
  const set = (k: keyof Form, v: string | boolean) => setForms(p => ({ ...p, [tab]: { ...(p[tab] as Form), [k]: v } }))

  const save = async () => {
    if (!f) return
    if (!VERSION_RE.test(f.latest_version) || !VERSION_RE.test(f.min_version)) { toast.error('Versions look like 1.0.0 or 1.0.0-test.5'); return }
    setBusy(true)
    try {
      const r = await window.api.appVersions.save({
        channel: tab, latest_version: f.latest_version, min_version: f.min_version, critical: f.critical,
        release_notes: { en: f.en, ta: f.ta, si: f.si },
        // a changed URL drops the old hash unless a different one was pasted
        ...(tab === 'test' ? (f.update_url !== (d?.update_url ?? '') && f.apk_sha256 === (d?.apk_sha256 ?? '')
          ? { update_url: f.update_url } : { update_url: f.update_url, apk_sha256: f.apk_sha256, apk_size_bytes: f.apk_size_bytes }) : {}),
      })
      if (r.success) { toast.success('Saved. The app picks it up on its next status check.'); void load() } else toast.error(r.error)
    } catch (err) { toast.error('Failed: ' + String(err)) } finally { setBusy(false) }
  }
  const hash = async () => {
    setBusy(true)
    try {
      const r = await window.api.appVersions.hashApk('test')
      if (r.success) { toast.success('APK downloaded and hashed'); void load() } else toast.error(r.error)
    } catch (err) { toast.error('Failed: ' + String(err)) } finally { setBusy(false) }
  }

  return <div className="flex flex-col h-full overflow-hidden">
    <PageHeader title="App Versions" subtitle="Latest and minimum (force-update) version of the mobile app, per release channel"
      actions={<button className="btn-secondary btn-sm" onClick={load}><RefreshCw size={14} /> Refresh</button>} />
    <div className="flex items-center gap-2 px-6 py-3 border-b border-slate-800">
      {(['test', 'production'] as const).map(k =>
        <button key={k} onClick={() => setTab(k)} className={`px-3 py-1.5 rounded-lg text-xs capitalize ${tab === k ? 'bg-brand-600 text-white' : 'bg-surface-800 text-slate-400'}`}>{k === 'test' ? 'Test (APK)' : 'Production (Play)'}</button>)}
    </div>
    {!f ? <p className="p-6 text-slate-500 text-sm">Loading…</p> : <div className="flex-1 overflow-auto p-6 max-w-3xl space-y-4">
      {!d?.configured && <p className="text-xs text-amber-400">No row saved for this channel yet. The values below come from the old app settings; saving creates the channel row.</p>}
      {tab === 'production' && <p className="text-xs text-slate-400">Production builds update through Google Play. Raising the minimum version blocks older builds with a force-update screen, so only do it after the new build is live on Play.</p>}
      <div className="grid grid-cols-2 gap-4">
        <div><label className="text-xs text-slate-400">Latest version</label>
          <input className="input mt-1" placeholder="1.0.0" value={f.latest_version} onChange={e => set('latest_version', e.target.value.trim())} /></div>
        <div><label className="text-xs text-slate-400">Minimum version (below this = forced update)</label>
          <input className="input mt-1" placeholder="1.0.0" value={f.min_version} onChange={e => set('min_version', e.target.value.trim())} /></div>
      </div>
      <label className="flex items-center gap-2 text-sm text-slate-300"><input type="checkbox" checked={f.critical} onChange={e => set('critical', e.target.checked)} /> Latest is a critical update (immediate update flow)</label>
      {(['en', 'ta', 'si'] as const).map(l =>
        <div key={l}><label className="text-xs text-slate-400">Release notes ({l === 'en' ? 'English' : l === 'ta' ? 'Tamil' : 'Sinhala'})</label>
          <textarea className="input mt-1" rows={3} maxLength={2000} value={f[l]} onChange={e => set(l, e.target.value)} /></div>)}
      {tab === 'test' && <div className="space-y-3 border-t border-slate-800 pt-4">
        <div><label className="text-xs text-slate-400">APK URL (https, on this server{hosts.length ? `: ${hosts.join(', ')}` : ''})</label>
          <input className="input mt-1" placeholder="https://" value={f.update_url} onChange={e => set('update_url', e.target.value.trim())} />
          <p className="text-[11px] text-slate-500 mt-1">Changing the URL clears the stored SHA-256. Save, then press Fetch &amp; hash.</p></div>
        <div className="grid grid-cols-3 gap-4">
          <div className="col-span-2"><label className="text-xs text-slate-400">APK SHA-256 (or paste one)</label>
            <input className="input mt-1 font-mono text-xs" maxLength={64} value={f.apk_sha256} onChange={e => set('apk_sha256', e.target.value.trim().toLowerCase())} /></div>
          <div><label className="text-xs text-slate-400">APK size (bytes)</label>
            <input className="input mt-1" value={f.apk_size_bytes} onChange={e => set('apk_size_bytes', e.target.value.replace(/\D/g, ''))} /></div>
        </div>
        <button className="btn-secondary btn-sm" disabled={busy || !d?.configured || !d?.update_url} onClick={hash} title="Server downloads the saved APK URL (max 120 MB) and stores its SHA-256"><Hash size={14} /> Fetch &amp; hash APK</button>
      </div>}
      <div className="flex items-center gap-3">
        <button className="btn-primary" disabled={busy} onClick={save}><Save size={14} /> Save</button>
        {d?.updated_at && <span className="text-xs text-slate-500">Last saved {new Date(d.updated_at).toLocaleString()}{d.updated_by ? ` by ${d.updated_by}` : ''}</span>}
      </div>
    </div>}
  </div>
}
