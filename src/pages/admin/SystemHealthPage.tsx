import { useState, useEffect, useCallback } from 'react'
import PageHeader from '@/components/shared/PageHeader'
import {
  Activity, Database, Cpu, MemoryStick, RefreshCw,
  CheckCircle, AlertTriangle, Zap, HardDrive, Clock
} from 'lucide-react'
import toast from 'react-hot-toast'

interface HealthData {
  db: { sizeBytes: number; sizeMb: string; path: string }
  tables: { name: string; count: number }[]
  sync: { pending: number; failed: number }
  notifications: { unread: number }
  memory: {
    heapUsedMb: string; heapTotalMb: string; rssMb: string
    sysTotalMb: string; sysFreeMb: string; sysUsedPct: string
  }
  system: {
    platform: string; cpuModel: string; cpuCount: number
    appUptimeSeconds: number; nodeVersion: string
  }
}

function fmtUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

function MemBar({ pct }: { pct: number }) {
  const color = pct > 85 ? '#ef4444' : pct > 65 ? '#f59e0b' : '#22c55e'
  return (
    <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
    </div>
  )
}

function MetricCard({
  icon, label, value, sub, color = 'blue'
}: {
  icon: React.ReactNode; label: string; value: string; sub?: string; color?: string
}) {
  const colorMap: Record<string, string> = {
    blue: 'text-blue-400', green: 'text-green-400', yellow: 'text-yellow-400',
    red: 'text-red-400', purple: 'text-purple-400', cyan: 'text-cyan-400',
  }
  return (
    <div className="rounded-xl border p-4" style={{ borderColor: 'var(--border)', background: 'var(--bg-soft)' }}>
      <div className={`flex items-center gap-2 mb-2 ${colorMap[color] || colorMap.blue}`}>
        {icon}
        <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>{label}</span>
      </div>
      <p className="text-xl font-bold" style={{ color: 'var(--text-1)' }}>{value}</p>
      {sub && <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--text-3)' }}>{sub}</p>}
    </div>
  )
}

export default function SystemHealthPage() {
  const [health, setHealth]       = useState<HealthData | null>(null)
  const [loading, setLoading]     = useState(true)
  const [vacuuming, setVacuuming] = useState(false)
  const [integrity, setIntegrity] = useState<{ passed: boolean; details: string[] } | null>(null)
  const [checkingInt, setCheckingInt] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    const res = await window.api.monitor.health() as { success: boolean; data: HealthData; error?: string }
    if (res.success) { setHealth(res.data); setLastUpdated(new Date()) }
    else toast.error(res.error || 'Failed to load health data')
    setLoading(false)
  }, [])

  useEffect(() => {
    refresh()
    const interval = setInterval(refresh, 30_000) // auto-refresh every 30s
    return () => clearInterval(interval)
  }, [refresh])

  const runVacuum = async () => {
    setVacuuming(true)
    const res = await window.api.monitor.vacuum() as { success: boolean; error?: string }
    setVacuuming(false)
    if (res.success) { toast.success('VACUUM completed — DB optimized'); refresh() }
    else toast.error(res.error || 'VACUUM failed')
  }

  const runIntegrityCheck = async () => {
    setCheckingInt(true)
    const res = await window.api.monitor.integrity() as { success: boolean; data: { passed: boolean; details: string[] } }
    setCheckingInt(false)
    if (res.success) {
      setIntegrity(res.data)
      toast[res.data.passed ? 'success' : 'error'](
        res.data.passed ? 'Integrity check passed ✓' : 'Integrity issues found!'
      )
    }
  }

  const memPct = health ? parseFloat(health.memory.sysUsedPct) : 0
  const heapPct = health
    ? (parseFloat(health.memory.heapUsedMb) / parseFloat(health.memory.heapTotalMb)) * 100
    : 0

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader
        title="System Health"
        subtitle={lastUpdated ? `Last updated: ${lastUpdated.toLocaleTimeString()}` : 'Loading…'}
        actions={
          <div className="flex gap-2">
            <button onClick={runVacuum} disabled={vacuuming || loading} className="btn-secondary btn-sm gap-1.5">
              {vacuuming ? <RefreshCw size={13} className="animate-spin" /> : <Zap size={13} />}
              Optimize DB
            </button>
            <button onClick={runIntegrityCheck} disabled={checkingInt || loading} className="btn-secondary btn-sm gap-1.5">
              {checkingInt ? <RefreshCw size={13} className="animate-spin" /> : <CheckCircle size={13} />}
              Integrity Check
            </button>
            <button onClick={refresh} disabled={loading} className="btn-primary btn-sm gap-1.5">
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
            </button>
          </div>
        }
      />

      {!health ? (
        <div className="flex-1 flex items-center justify-center">
          <RefreshCw size={24} className="animate-spin" style={{ color: 'var(--text-3)' }} />
        </div>
      ) : (
        <div className="flex-1 overflow-auto p-6 space-y-6">

          {/* Integrity check result */}
          {integrity && (
            <div className={`rounded-xl p-3 border flex items-center gap-3 ${
              integrity.passed
                ? 'border-green-500/30 bg-green-500/5'
                : 'border-red-500/30 bg-red-500/5'
            }`}>
              {integrity.passed
                ? <CheckCircle size={16} className="text-green-400" />
                : <AlertTriangle size={16} className="text-red-400" />}
              <p className={`text-sm font-medium ${integrity.passed ? 'text-green-400' : 'text-red-400'}`}>
                {integrity.passed ? 'Database integrity check passed — no issues found' : `Integrity issues: ${integrity.details.join(', ')}`}
              </p>
            </div>
          )}

          {/* Top metrics */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard
              icon={<Database size={16} />}
              label="DB Size"
              value={`${health.db.sizeMb} MB`}
              sub="SQLite database"
              color="blue"
            />
            <MetricCard
              icon={<Activity size={16} />}
              label="Sync Queue"
              value={String(health.sync.pending)}
              sub={health.sync.failed > 0 ? `${health.sync.failed} failed` : 'All clear'}
              color={health.sync.failed > 0 ? 'red' : 'green'}
            />
            <MetricCard
              icon={<Clock size={16} />}
              label="App Uptime"
              value={fmtUptime(health.system.appUptimeSeconds)}
              sub={health.system.nodeVersion}
              color="cyan"
            />
            <MetricCard
              icon={<Cpu size={16} />}
              label="CPU"
              value={`${health.system.cpuCount} cores`}
              sub={health.system.cpuModel.slice(0, 30)}
              color="purple"
            />
          </div>

          {/* Memory */}
          <div className="rounded-xl border p-5" style={{ borderColor: 'var(--border)', background: 'var(--bg-soft)' }}>
            <div className="flex items-center gap-2 mb-4">
              <MemoryStick size={16} style={{ color: 'var(--brand-primary)' }} />
              <span className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>Memory Usage</span>
            </div>
            <div className="grid grid-cols-2 gap-6">
              <div>
                <div className="flex justify-between text-xs mb-1.5">
                  <span style={{ color: 'var(--text-3)' }}>System RAM</span>
                  <span style={{ color: 'var(--text-2)' }}>{health.memory.sysFreeMb} MB free / {health.memory.sysTotalMb} MB</span>
                </div>
                <MemBar pct={memPct} />
                <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>{health.memory.sysUsedPct}% used</p>
              </div>
              <div>
                <div className="flex justify-between text-xs mb-1.5">
                  <span style={{ color: 'var(--text-3)' }}>App Heap</span>
                  <span style={{ color: 'var(--text-2)' }}>{health.memory.heapUsedMb} / {health.memory.heapTotalMb} MB</span>
                </div>
                <MemBar pct={Math.min(heapPct, 100)} />
                <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>RSS: {health.memory.rssMb} MB</p>
              </div>
            </div>
          </div>

          {/* Table counts */}
          <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
            <div className="px-4 py-3 border-b" style={{ background: 'var(--bg-soft)', borderColor: 'var(--border)' }}>
              <span className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>Database Tables</span>
            </div>
            <div className="grid grid-cols-3 gap-0">
              {health.tables.map((t, i) => (
                <div key={t.name}
                  className={`px-4 py-3 flex items-center justify-between ${i % 3 !== 2 ? 'border-r' : ''} ${i < health.tables.length - 3 ? 'border-b' : ''}`}
                  style={{ borderColor: 'var(--border)' }}>
                  <span className="text-xs font-mono" style={{ color: 'var(--text-3)' }}>{t.name}</span>
                  <span className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>{t.count.toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Platform info */}
          <div className="rounded-xl border p-4" style={{ borderColor: 'var(--border)', background: 'var(--bg-soft)' }}>
            <div className="flex items-center gap-2 mb-3">
              <HardDrive size={14} style={{ color: 'var(--brand-primary)' }} />
              <span className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>Platform</span>
            </div>
            <div className="grid grid-cols-2 gap-3 text-xs">
              {[
                ['OS', health.system.platform],
                ['Node.js', health.system.nodeVersion],
                ['DB Path', health.db.path],
                ['Uptime', fmtUptime(health.system.appUptimeSeconds)],
              ].map(([label, value]) => (
                <div key={label}>
                  <span style={{ color: 'var(--text-3)' }}>{label}</span>
                  <p className="font-mono mt-0.5 truncate" style={{ color: 'var(--text-2)' }}>{value}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
