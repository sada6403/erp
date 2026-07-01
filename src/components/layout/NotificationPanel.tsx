import { useEffect, useState, useRef } from 'react'
import { Bell, X, Check, CheckCheck, Trash2, Package, CreditCard, RefreshCw, ShieldAlert, Info, ArrowLeftRight } from 'lucide-react'

interface Notification {
  id: string
  type: string
  title: string
  message: string
  is_read: number
  data: string | null
  created_at: string
}

const TYPE_ICON: Record<string, React.ReactNode> = {
  low_stock:            <Package size={14} className="text-yellow-400" />,
  installment_due:      <CreditCard size={14} className="text-blue-400" />,
  installment_overdue:  <CreditCard size={14} className="text-red-400" />,
  sync_failed:          <RefreshCw size={14} className="text-orange-400" />,
  license_expiry:       <ShieldAlert size={14} className="text-red-400" />,
  subscription_grace:   <ShieldAlert size={14} className="text-yellow-400" />,
  subscription_expired: <ShieldAlert size={14} className="text-red-400" />,
  transfer_request:     <ArrowLeftRight size={14} className="text-purple-400" />,
  info:                 <Info size={14} className="text-blue-400" />,
}

function timeAgo(dt: string) {
  const diff = Date.now() - new Date(dt).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1)  return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export default function NotificationPanel() {
  const [open, setOpen]             = useState(false)
  const [items, setItems]           = useState<Notification[]>([])
  const [unread, setUnread]         = useState(0)
  const [loading, setLoading]       = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  const load = async () => {
    setLoading(true)
    const [all, count] = await Promise.all([
      window.api.notifications.getAll() as Promise<Notification[]>,
      window.api.notifications.getUnreadCount() as Promise<number>,
    ])
    setItems(all)
    setUnread(count)
    setLoading(false)
  }

  useEffect(() => {
    load()
    // Refresh notifications every 5 minutes
    const interval = setInterval(() => {
      window.api.notifications.refresh().then(() => load())
    }, 5 * 60 * 1000)
    // Trigger immediate refresh on mount
    window.api.notifications.refresh().then(() => load())
    return () => clearInterval(interval)
  }, [])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const markRead = async (id: string) => {
    await window.api.notifications.markRead(id)
    setItems(prev => prev.map(n => n.id === id ? { ...n, is_read: 1 } : n))
    setUnread(prev => Math.max(0, prev - 1))
  }

  const markAllRead = async () => {
    await window.api.notifications.markRead('all')
    setItems(prev => prev.map(n => ({ ...n, is_read: 1 })))
    setUnread(0)
  }

  const deleteNotif = async (id: string) => {
    await window.api.notifications.delete(id)
    setItems(prev => prev.filter(n => n.id !== id))
    setUnread(prev => items.find(n => n.id === id && !n.is_read) ? Math.max(0, prev - 1) : prev)
  }

  const clearRead = async () => {
    await window.api.notifications.clearAll()
    setItems(prev => prev.filter(n => !n.is_read))
  }

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => { setOpen(o => !o); if (!open) load() }}
        className="relative p-2 rounded-lg hover:bg-[var(--bg-soft)] transition-colors"
        style={{ color: 'var(--text-3)' }}
        title="Notifications"
      >
        <Bell size={16} />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 rounded-full text-white flex items-center justify-center text-[10px] font-bold px-0.5"
            style={{ background: 'var(--brand-primary)' }}>
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 rounded-xl shadow-xl z-50 overflow-hidden"
          style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-lg)' }}>

          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
            <div className="flex items-center gap-2">
              <Bell size={14} style={{ color: 'var(--brand-primary)' }} />
              <span className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>Notifications</span>
              {unread > 0 && (
                <span className="text-xs px-1.5 py-0.5 rounded-full font-bold text-white" style={{ background: 'var(--brand-primary)' }}>
                  {unread}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {unread > 0 && (
                <button onClick={markAllRead} title="Mark all read" className="p-1 rounded hover:bg-[var(--bg-soft)] transition-colors" style={{ color: 'var(--text-3)' }}>
                  <CheckCheck size={13} />
                </button>
              )}
              {items.some(n => n.is_read) && (
                <button onClick={clearRead} title="Clear read" className="p-1 rounded hover:bg-[var(--bg-soft)] transition-colors" style={{ color: 'var(--text-3)' }}>
                  <Trash2 size={13} />
                </button>
              )}
              <button onClick={() => setOpen(false)} className="p-1 rounded hover:bg-[var(--bg-soft)] transition-colors" style={{ color: 'var(--text-3)' }}>
                <X size={13} />
              </button>
            </div>
          </div>

          {/* List */}
          <div className="max-h-96 overflow-y-auto">
            {loading && <div className="px-4 py-8 text-center text-xs" style={{ color: 'var(--text-3)' }}>Loading…</div>}
            {!loading && items.length === 0 && (
              <div className="px-4 py-10 text-center">
                <Bell size={24} className="mx-auto mb-2" style={{ color: 'var(--text-3)' }} />
                <p className="text-sm" style={{ color: 'var(--text-3)' }}>No notifications</p>
              </div>
            )}
            {items.map(n => (
              <div key={n.id}
                className={`flex gap-3 px-4 py-3 border-b transition-colors ${!n.is_read ? '' : 'opacity-60'}`}
                style={{ borderColor: 'var(--border)', background: !n.is_read ? 'color-mix(in srgb, var(--brand-primary) 5%, transparent)' : undefined }}
              >
                <div className="mt-0.5 flex-shrink-0">{TYPE_ICON[n.type] ?? <Info size={14} style={{ color: 'var(--text-3)' }} />}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold truncate" style={{ color: 'var(--text-1)' }}>{n.title}</p>
                  <p className="text-xs mt-0.5 leading-relaxed" style={{ color: 'var(--text-2)' }}>{n.message}</p>
                  <p className="text-[10px] mt-1" style={{ color: 'var(--text-3)' }}>{timeAgo(n.created_at)}</p>
                </div>
                <div className="flex flex-col gap-1 flex-shrink-0">
                  {!n.is_read && (
                    <button onClick={() => markRead(n.id)} className="p-1 rounded hover:bg-[var(--bg-soft)]" title="Mark read" style={{ color: 'var(--text-3)' }}>
                      <Check size={11} />
                    </button>
                  )}
                  <button onClick={() => deleteNotif(n.id)} className="p-1 rounded hover:bg-[var(--bg-soft)] text-red-400" title="Delete">
                    <X size={11} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
