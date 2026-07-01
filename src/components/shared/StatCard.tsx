import type { LucideIcon } from 'lucide-react'

interface Props {
  label: string
  value: string | number
  sub?: string
  icon: LucideIcon
  color?: 'brand' | 'blue' | 'green' | 'yellow' | 'red' | 'purple'
  trend?: number
}

const colors: Record<string, string> = {
  blue:   'bg-blue-500/10 text-blue-400',
  green:  'bg-green-500/10 text-green-400',
  yellow: 'bg-yellow-500/10 text-yellow-400',
  red:    'bg-red-500/10 text-red-400',
  purple: 'bg-purple-500/10 text-purple-400',
}

export default function StatCard({ label, value, sub, icon: Icon, color = 'brand', trend }: Props) {
  const isBrand = color === 'brand'
  return (
    <div className="stat-card min-h-32 justify-between">
      <div className="flex items-center justify-between gap-3 mb-3">
        <span className="text-xs font-medium uppercase tracking-wider truncate" style={{ color: 'var(--text-3)' }}>{label}</span>
        <div
          className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${isBrand ? '' : colors[color]}`}
          style={isBrand ? { background: 'color-mix(in srgb, var(--brand-primary) 15%, transparent)', color: 'var(--brand-primary)' } : undefined}
        >
          <Icon size={15} />
        </div>
      </div>
      <p className="text-2xl font-bold" style={{ color: 'var(--text-1)' }}>{value}</p>
      {sub && <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>{sub}</p>}
      {trend !== undefined && (
        <p className={`text-xs mt-1 font-medium ${trend >= 0 ? 'text-green-400' : 'text-red-400'}`}>
          {trend >= 0 ? 'Up' : 'Down'} {Math.abs(trend).toFixed(1)}% vs last period
        </p>
      )}
    </div>
  )
}
