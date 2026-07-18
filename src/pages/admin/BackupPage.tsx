import { useState, useEffect } from 'react'
import PageHeader from '@/components/shared/PageHeader'
import { HardDrive, RefreshCw, FolderOpen, Download, Trash2, Clock, CheckCircle, AlertTriangle } from 'lucide-react'
import toast from 'react-hot-toast'

interface BackupInfo {
  filename: string
  filepath: string
  size: number
  sizeFormatted: string
  createdAt: string
}

interface BackupStats {
  count: number
  totalSize: number
  latest: BackupInfo | null
  backupDir: string
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString()
}

export default function BackupPage() {
  const [backups, setBackups]   = useState<BackupInfo[]>([])
  const [stats, setStats]       = useState<BackupStats | null>(null)
  const [running, setRunning]   = useState(false)
  const [loading, setLoading]   = useState(true)
  const [deleting, setDeleting] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const [listRes, statsRes] = await Promise.all([
        window.api.backup.list() as Promise<{ success: boolean; data: BackupInfo[] }>,
        window.api.backup.getStats() as Promise<{ success: boolean; data: BackupStats }>,
      ])
      if (listRes.success) setBackups(listRes.data)
      if (statsRes.success) setStats(statsRes.data)
    } catch (err) {
      toast.error((err as Error)?.message || 'Failed to load backups')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const runBackup = async () => {
    setRunning(true)
    try {
      const res = await window.api.backup.run() as {
        success: boolean; filename?: string; error?: string
        s3Url?: string; s3Error?: string
      }
      if (res.success) {
        if (res.s3Url) {
          toast.success(`Backup saved & uploaded to S3 ✓`)
        } else if (res.s3Error) {
          toast.success(`Local backup saved: ${res.filename}`)
          toast.error(`S3 upload failed: ${res.s3Error}`, { duration: 6000 })
        } else {
          toast.success(`Backup saved: ${res.filename}`)
        }
        load()
      } else {
        toast.error(`Backup failed: ${res.error}`)
      }
    } catch (err) {
      toast.error((err as Error)?.message || 'Backup failed')
    } finally {
      setRunning(false)
    }
  }

  const deleteBackup = async (b: BackupInfo) => {
    if (!confirm(`Delete "${b.filename}"?`)) return
    setDeleting(b.filepath)
    try {
      const res = await window.api.backup.delete(b.filepath) as { success: boolean; error?: string }
      if (res.success) { toast.success('Backup deleted'); load() }
      else toast.error(res.error || 'Delete failed')
    } catch (err) {
      toast.error((err as Error)?.message || 'Delete failed')
    } finally {
      setDeleting(null)
    }
  }

  const exportBackup = async (b: BackupInfo) => {
    try {
      const res = await window.api.backup.export(b.filepath) as { success: boolean; error?: string }
      if (res.success) toast.success('Backup exported')
      else if (res.error !== 'Cancelled') toast.error(res.error || 'Export failed')
    } catch (err) {
      toast.error((err as Error)?.message || 'Export failed')
    }
  }

  const openFolder = async () => {
    try {
      await window.api.backup.openFolder()
    } catch (err) {
      toast.error((err as Error)?.message || 'Failed to open folder')
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader
        title="Database Backup"
        subtitle="Automatic daily backups — last 10 kept"
        actions={
          <div className="flex gap-2">
            <button onClick={openFolder} className="btn-secondary btn-sm gap-1.5">
              <FolderOpen size={14} /> Open Folder
            </button>
            <button onClick={runBackup} disabled={running} className="btn-primary btn-sm gap-1.5">
              {running ? <RefreshCw size={14} className="animate-spin" /> : <HardDrive size={14} />}
              {running ? 'Backing up…' : 'Backup Now'}
            </button>
          </div>
        }
      />

      <div className="flex-1 overflow-auto p-6 space-y-6">
        {/* Stats cards */}
        {stats && (
          <div className="grid grid-cols-3 gap-4">
            <StatCard
              icon={<HardDrive size={20} className="text-blue-400" />}
              label="Total Backups"
              value={String(stats.count)}
              sub="stored locally"
            />
            <StatCard
              icon={<Clock size={20} className="text-green-400" />}
              label="Last Backup"
              value={stats.latest ? fmtDate(stats.latest.createdAt) : 'Never'}
              sub={stats.latest ? stats.latest.sizeFormatted : '—'}
            />
            <StatCard
              icon={<HardDrive size={20} className="text-purple-400" />}
              label="Total Size"
              value={formatBytes(backups.reduce((s, b) => s + b.size, 0))}
              sub={`in ${stats.backupDir.split(/[\\/]/).slice(-2).join('/')}`}
            />
          </div>
        )}

        {/* Auto-backup info */}
        <div className="rounded-xl p-4 border flex items-center gap-3" style={{ borderColor: 'var(--border)', background: 'var(--bg-soft)' }}>
          <CheckCircle size={16} className="text-green-400 flex-shrink-0" />
          <div>
            <p className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>Auto-Backup Active</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>
              SQLite database is automatically backed up every 24 hours. Backups are stored at{' '}
              <code className="font-mono text-[10px] px-1 py-0.5 rounded" style={{ background: 'var(--bg)' }}>
                {stats?.backupDir || 'userData/backups'}
              </code>
            </p>
          </div>
        </div>

        {/* Backup list */}
        <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
          <div className="px-4 py-3 border-b flex items-center justify-between" style={{ background: 'var(--bg-soft)', borderColor: 'var(--border)' }}>
            <span className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>Backup History</span>
            <button onClick={load} className="text-xs flex items-center gap-1" style={{ color: 'var(--text-3)' }}>
              <RefreshCw size={11} /> Refresh
            </button>
          </div>

          {loading ? (
            <div className="py-12 text-center text-sm" style={{ color: 'var(--text-3)' }}>Loading…</div>
          ) : backups.length === 0 ? (
            <div className="py-12 text-center">
              <AlertTriangle size={36} className="mx-auto mb-2 text-yellow-400" />
              <p className="text-sm" style={{ color: 'var(--text-3)' }}>No backups yet — click "Backup Now" to create one</p>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr style={{ background: 'var(--bg-soft)' }}>
                  {['Filename', 'Created', 'Size', 'Actions'].map(h => (
                    <th key={h} className="table-header px-4 py-3 text-left text-xs">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {backups.map((b, i) => (
                  <tr key={b.filepath} className="table-row">
                    <td className="table-cell px-4 py-3">
                      <div className="flex items-center gap-2">
                        <HardDrive size={13} style={{ color: 'var(--text-3)' }} />
                        <div>
                          <p className="text-sm font-mono font-medium" style={{ color: 'var(--text-1)' }}>{b.filename}</p>
                          {i === 0 && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/20 text-green-400 font-semibold">Latest</span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="table-cell px-4 py-3 text-sm" style={{ color: 'var(--text-2)' }}>
                      {fmtDate(b.createdAt)}
                    </td>
                    <td className="table-cell px-4 py-3 text-sm font-mono" style={{ color: 'var(--text-3)' }}>
                      {b.sizeFormatted}
                    </td>
                    <td className="table-cell px-4 py-3">
                      <div className="flex gap-2">
                        <button onClick={() => exportBackup(b)} title="Export / Save As"
                          className="p-1.5 rounded-lg hover:bg-[var(--bg-soft)] transition-colors" style={{ color: 'var(--text-3)' }}>
                          <Download size={13} />
                        </button>
                        <button onClick={() => deleteBackup(b)} disabled={deleting === b.filepath}
                          title="Delete" className="p-1.5 rounded-lg hover:bg-red-500/10 text-red-400 transition-colors">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Warning about restore */}
        <div className="rounded-xl p-4 border flex items-start gap-3"
          style={{ borderColor: 'rgba(234,179,8,0.3)', background: 'rgba(234,179,8,0.05)' }}>
          <AlertTriangle size={16} className="text-yellow-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-yellow-400">Restore Instructions</p>
            <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>
              To restore a backup: close the app, copy the desired backup file to the userData directory as <code className="font-mono text-[10px]">pos-erp.db</code>, and restart. Always keep a recent backup before restoring.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

function StatCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl p-4 border" style={{ borderColor: 'var(--border)', background: 'var(--bg-soft)' }}>
      <div className="flex items-center gap-3 mb-2">
        {icon}
        <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>{label}</span>
      </div>
      <p className="text-xl font-bold" style={{ color: 'var(--text-1)' }}>{value}</p>
      <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--text-3)' }}>{sub}</p>
    </div>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}
