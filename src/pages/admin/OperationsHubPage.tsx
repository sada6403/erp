import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import PageHeader from '@/components/shared/PageHeader'
import { useAuthStore } from '@/store/authStore'
import { BadgeInfo, BellRing, Printer, RefreshCw, ShieldCheck, Wifi, WifiOff, AlertTriangle, ArrowRight, Settings2, Users, GitBranch, ReceiptText } from 'lucide-react'
import { useSyncStatus } from '@/hooks/useSyncStatus'
import toast from 'react-hot-toast'

type NotificationItem = Record<string, unknown>

export default function OperationsHubPage() {
  const { user } = useAuthStore()
  const navigate = useNavigate()
  const { status, triggerSync } = useSyncStatus()
  const [license, setLicense] = useState<Record<string, unknown> | null>(null)
  const [printers, setPrinters] = useState<Record<string, unknown>[]>([])
  const [notifications, setNotifications] = useState<NotificationItem[]>([])
  const [unread, setUnread] = useState(0)
  const [branchCount, setBranchCount] = useState(0)
  const [userCount, setUserCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [printerLoading, setPrinterLoading] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const [licenseRes, deviceRes, notifRes, unreadRes, branchesRes, usersRes] = await Promise.all([
        window.api.license.status().catch(() => null),
        window.api.printer.listDevices().catch(() => []),
        window.api.notifications.getAll().catch(() => []),
        window.api.notifications.getUnreadCount().catch(() => 0),
        window.api.admin.branches.list().catch(() => ({ success: false, data: [] })),
        window.api.admin.users.list().catch(() => ({ success: false, data: [] })),
      ])
      setLicense((licenseRes as { success?: boolean; data?: Record<string, unknown> } | null)?.data ?? null)
      setPrinters((deviceRes as Record<string, unknown>[]) ?? [])
      setNotifications((notifRes as NotificationItem[]) ?? [])
      setUnread(Number(unreadRes || 0))
      const branches = (branchesRes as { success?: boolean; data?: unknown[] })?.data ?? []
      const users = (usersRes as { success?: boolean; data?: unknown[] })?.data ?? []
      setBranchCount(Array.isArray(branches) ? branches.length : 0)
      setUserCount(Array.isArray(users) ? users.length : 0)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function refreshNotifications() {
    await window.api.notifications.refresh().catch(() => undefined)
    await load()
    toast.success('Notifications refreshed')
  }

  async function testPrinter() {
    setPrinterLoading(true)
    try {
      const res = await window.api.printer.test()
      if ((res as { success?: boolean; error?: string })?.success === false) {
        toast.error((res as { error?: string }).error || 'Printer test failed')
      } else {
        toast.success('Printer test sent')
      }
    } catch {
      toast.error('Printer test failed')
    } finally {
      setPrinterLoading(false)
    }
  }

  const licenseActive = Boolean((license as Record<string, unknown> | null)?.active ?? (license as Record<string, unknown> | null)?.is_active)
  const moduleCount = Array.isArray((license as Record<string, unknown> | null)?.modules)
    ? ((license as Record<string, unknown> | null)?.modules as unknown[]).length
    : 0

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader
        title="Operations Hub"
        subtitle="License, printer, notification, and sync control"
        actions={
          <button onClick={load} className="btn-secondary btn-sm gap-1.5">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        }
      />

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
          <div className="card">
            <p className="text-xs" style={{ color: 'var(--text-3)' }}>Sync</p>
            <div className="flex items-center gap-2 mt-2">
              {status.online ? <Wifi size={16} className="text-green-500" /> : <WifiOff size={16} className="text-red-400" />}
              <p className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>
                {status.online ? 'Online' : 'Offline'}
              </p>
            </div>
            <p className="text-xs mt-2" style={{ color: 'var(--text-3)' }}>{status.pending} pending changes</p>
          </div>

          <div className="card">
            <p className="text-xs" style={{ color: 'var(--text-3)' }}>License</p>
            <div className="flex items-center gap-2 mt-2">
              <ShieldCheck size={16} className={licenseActive ? 'text-green-500' : 'text-red-400'} />
              <p className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>
                {licenseActive ? 'Active' : 'Inactive'}
              </p>
            </div>
            <p className="text-xs mt-2" style={{ color: 'var(--text-3)' }}>{moduleCount} modules enabled</p>
          </div>

          <div className="card">
            <p className="text-xs" style={{ color: 'var(--text-3)' }}>Notifications</p>
            <div className="flex items-center gap-2 mt-2">
              <BellRing size={16} className="text-indigo-400" />
              <p className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>{unread} unread</p>
            </div>
            <p className="text-xs mt-2" style={{ color: 'var(--text-3)' }}>{notifications.length} total stored</p>
          </div>

          <div className="card">
            <p className="text-xs" style={{ color: 'var(--text-3)' }}>Printers</p>
            <div className="flex items-center gap-2 mt-2">
              <Printer size={16} className="text-amber-400" />
              <p className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>{printers.length} devices</p>
            </div>
            <button onClick={testPrinter} disabled={printerLoading} className="btn-ghost mt-3 text-xs">
              {printerLoading ? 'Testing…' : 'Print Test'}
            </button>
          </div>

          <div className="card">
            <p className="text-xs" style={{ color: 'var(--text-3)' }}>Branches</p>
            <div className="flex items-center gap-2 mt-2">
              <GitBranch size={16} className="text-cyan-400" />
              <p className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>{branchCount} branches</p>
            </div>
            <button onClick={() => navigate('/admin/branches')} className="btn-ghost mt-3 text-xs">
              Open Branches
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <div className="card xl:col-span-2 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="font-semibold text-sm" style={{ color: 'var(--text-1)' }}>Quick Actions</h3>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>
                  Common operational tasks for {user?.branch?.name || 'this branch'}
                </p>
              </div>
              <button onClick={triggerSync} className="btn-primary btn-sm gap-1.5">
                <ArrowRight size={14} /> Sync Now
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {[
                { title: 'Open Security', desc: 'Password, 2FA, and access controls', href: '/admin/security' },
                { title: 'Open Settings', desc: 'Company, printing, and integration settings', href: '/admin/settings' },
                { title: 'Open Audit Logs', desc: 'Track admin activity and changes', href: '/admin/audit-logs' },
                { title: 'Open Sync Monitor', desc: 'Review queue, failures, and device state', href: '/admin/sync' },
                { title: 'Open Users', desc: 'Manage staff accounts and role assignments', href: '/admin/users' },
                { title: 'Open Installments', desc: 'Review customer installment records', href: '/admin/installments' },
              ].map(card => (
                <button key={card.href} onClick={() => navigate(card.href)} className="text-left rounded-xl border border-gray-800 bg-gray-800/30 px-4 py-3 hover:border-gray-700 transition-colors">
                  <p className="text-sm font-medium text-white">{card.title}</p>
                  <p className="text-xs text-gray-500 mt-1">{card.desc}</p>
                </button>
              ))}
            </div>
          </div>

          <div className="card space-y-3">
            <div className="flex items-center gap-2">
              <Settings2 size={14} className="text-slate-400" />
              <h3 className="font-semibold text-sm" style={{ color: 'var(--text-1)' }}>Recent Notifications</h3>
            </div>
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {notifications.slice(0, 8).map((n, idx) => (
                <div key={String(n.id ?? idx)} className="rounded-lg border border-gray-800 bg-gray-800/30 px-3 py-2">
                  <p className="text-sm text-white">{String(n.title ?? 'Notification')}</p>
                  <p className="text-xs text-gray-500 mt-1 line-clamp-2">{String(n.message ?? '')}</p>
                </div>
              ))}
              {notifications.length === 0 && (
                <div className="text-sm text-gray-500 flex items-center gap-2">
                  <AlertTriangle size={14} className="text-gray-500" />
                  No notifications yet
                </div>
              )}
            </div>
            <button onClick={refreshNotifications} className="btn-ghost w-full text-xs">
              Refresh Notifications
            </button>
          </div>

          <div className="card space-y-3">
            <div className="flex items-center gap-2">
              <Users size={14} className="text-slate-400" />
              <h3 className="font-semibold text-sm" style={{ color: 'var(--text-1)' }}>Tenant Snapshot</h3>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span style={{ color: 'var(--text-3)' }}>Users</span>
                <span style={{ color: 'var(--text-1)' }}>{userCount}</span>
              </div>
              <div className="flex items-center justify-between">
                <span style={{ color: 'var(--text-3)' }}>Branches</span>
                <span style={{ color: 'var(--text-1)' }}>{branchCount}</span>
              </div>
              <div className="flex items-center justify-between">
                <span style={{ color: 'var(--text-3)' }}>Notifications</span>
                <span style={{ color: 'var(--text-1)' }}>{notifications.length}</span>
              </div>
              <div className="flex items-center justify-between">
                <span style={{ color: 'var(--text-3)' }}>Installed Printers</span>
                <span style={{ color: 'var(--text-1)' }}>{printers.length}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
