interface Props {
  title: string
  subtitle?: string
  actions?: React.ReactNode
}

export default function PageHeader({ title, subtitle, actions }: Props) {
  return (
    <div
      className="flex items-center justify-between gap-4 px-5 py-4 flex-shrink-0"
      style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-elevated)', backdropFilter: 'blur(16px)' }}
    >
      <div className="min-w-0">
        <h1 className="text-lg font-bold truncate" style={{ color: 'var(--text-1)' }}>{title}</h1>
        {subtitle && <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>}
    </div>
  )
}
