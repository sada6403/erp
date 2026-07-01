import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import { useSyncStatus } from '@/hooks/useSyncStatus'
import {
  LayoutDashboard, Package, Users, Warehouse, BarChart3, GitBranch,
  Truck, Settings, LogOut, Wifi, WifiOff, AlertCircle, UserCog,
  FileText, ShoppingCart, Receipt, Sun, Moon, ChevronDown,
  ChevronRight, ShoppingBag, Menu, Building2, Shield, HardDrive,
  Activity, Download, RefreshCw, type LucideIcon
} from 'lucide-react'
import { useState, useEffect } from 'react'
import toast from 'react-hot-toast'
import NotificationPanel from './NotificationPanel'

function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))
  useEffect(() => {
    const sync = () => setDark(document.documentElement.classList.contains('dark'))
    window.addEventListener('themechange', sync)
    return () => window.removeEventListener('themechange', sync)
  }, [])
  const toggle = () => {
    const next = !dark
    document.documentElement.classList.toggle('dark', next)
    localStorage.setItem('theme', next ? 'dark' : 'light')
    setDark(next)
    window.dispatchEvent(new Event('themechange'))
  }
  return { dark, toggle }
}

function Clock() {
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  return (
    <span className="hidden lg:inline text-xs tabular-nums" style={{ color: 'var(--text-3)' }}>
      {now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}{' '}
      {now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
    </span>
  )
}

type NavItem = { to: string; label: string; perm?: string; adminOnly?: boolean }
type NavGroup = { label: string; icon: LucideIcon; items: NavItem[]; perm?: string; adminOnly?: boolean; module?: string }

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Products', icon: Package, perm: 'inventory', module: 'inventory',
    items: [
      { to: '/admin/products', label: 'List Products', perm: 'inventory' },
      { to: '/admin/categories', label: 'Categories', perm: 'inventory' },
      { to: '/admin/inventory', label: 'Inventory', perm: 'inventory' },
      { to: '/admin/stock-lookup', label: 'Stock Lookup', perm: 'inventory' },
      { to: '/admin/stock-count', label: 'Stock Count', perm: 'inventory' },
      { to: '/admin/batches',     label: 'Batch / Expiry', perm: 'inventory' },
    ]
  },
  { label: 'Purchase Orders', icon: ShoppingCart, perm: 'inventory', module: 'purchase_orders', items: [{ to: '/admin/purchase-orders', label: 'Purchase Orders', perm: 'inventory' }] },
  { label: 'Supplier Management', icon: Users, perm: 'inventory', module: 'inventory', items: [{ to: '/admin/suppliers', label: 'Supplier List', perm: 'inventory' }] },
  {
    label: 'Customer Management', icon: UserCog, perm: 'customers', module: 'customers',
    items: [
      { to: '/admin/customers', label: 'Customers', perm: 'customers' },
      { to: '/admin/installments', label: 'Installments', perm: 'customers' },
    ]
  },
  {
    label: 'Stock Transfers', icon: Warehouse, perm: 'inventory', module: 'stock_transfers',
    items: [
      { to: '/admin/stock-transfers',  label: 'Stock Transfers', perm: 'inventory' },
      { to: '/admin/stock-requests',  label: 'Stock Requests',  perm: 'inventory' },
    ]
  },
  {
    label: 'Sell', icon: ShoppingBag, perm: 'pos', module: 'pos',
    items: [
      { to: '/admin/orders', label: 'Orders', perm: 'pos' },
      { to: '/admin/quotations', label: 'Quotations', perm: 'pos' },
      { to: '/admin/credit-bills', label: 'Credit Bills', perm: 'reports' },
      { to: '/admin/returns', label: 'Returns & Refunds', perm: 'pos' },
      { to: '/admin/cash-register', label: 'Cash Register', perm: 'pos' },
    ]
  },
  { label: 'Deliveries', icon: Truck, perm: 'deliveries', module: 'deliveries', items: [{ to: '/admin/deliveries', label: 'Deliveries', perm: 'deliveries' }] },
  { label: 'Expenses', icon: Receipt, perm: 'expenses', module: 'expenses', items: [{ to: '/admin/expenses', label: 'Expenses', perm: 'expenses' }] },
  { label: 'Reports', icon: BarChart3, perm: 'reports', module: 'reports_basic', items: [
    { to: '/admin/analytics', label: 'Analytics', perm: 'reports' },
    { to: '/admin/transactions', label: 'Transaction Report', perm: 'reports' },
  ]},
  {
    label: 'Employee Management', icon: UserCog, perm: 'employees',
    items: [
      { to: '/admin/users', label: 'User List', perm: 'employees' },
      { to: '/admin/roles', label: 'Roles & Permissions', perm: 'employees' },
    ]
  },
  {
    label: 'Branches', icon: GitBranch, perm: 'branches',
    items: [
      { to: '/admin/branches', label: 'Branches', perm: 'branches' },
      { to: '/admin/audit-logs', label: 'Audit Logs', perm: 'branches' },
      { to: '/admin/sync', label: 'Sync Monitor', perm: 'branches' },
    ]
  },
  {
    label: 'System', icon: Shield, adminOnly: true,
    items: [
      { to: '/admin/security',      label: 'Security & 2FA',   adminOnly: true },
      { to: '/admin/backup',        label: 'Backup',           adminOnly: true },
      { to: '/admin/system-health', label: 'System Health',    adminOnly: true },
    ]
  },
]

function canSeeItem(item: NavItem, permissions: Record<string, unknown>, isAdmin: boolean) {
  if (isAdmin) return true
  if (item.adminOnly) return false
  return !item.perm || Boolean(permissions[item.perm])
}

function SidebarGroup({
  group, permissions, isAdmin, collapsed, enabledModules
}: {
  group: NavGroup
  permissions: Record<string, unknown>
  isAdmin: boolean
  collapsed: boolean
  enabledModules: string[] | null
}) {
  const [open, setOpen] = useState(false)
  const Icon = group.icon
  const visibleItems = group.items.filter(item => canSeeItem(item, permissions, isAdmin))

  if (!isAdmin && group.adminOnly) return null
  if (!isAdmin && group.perm && !permissions[group.perm] && !visibleItems.length) return null
  if (!visibleItems.length) return null
  // Module gating: enabledModules null = offline/unknown = show all
  if (group.module && enabledModules && !enabledModules.includes(group.module)) return null

  if (collapsed) {
    return (
      <NavLink
        to={visibleItems[0].to}
        title={group.label}
        className={({ isActive }) =>
          `mx-auto flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
            isActive ? 'bg-blue-600 text-white' : 'hover:bg-[var(--bg-soft)]'
          }`
        }
        style={({ isActive }) => isActive ? {} : { color: 'var(--text-3)' }}
      >
        <Icon size={16} />
      </NavLink>
    )
  }

  return (
    <div>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors duration-150 hover:bg-[var(--bg-soft)]"
        style={{ color: open ? 'var(--brand-primary)' : 'var(--text-2)' }}
      >
        <Icon size={15} className="flex-shrink-0" />
        <span className="flex-1 text-left truncate">{group.label}</span>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </button>
      {open && (
        <div className="ml-4 mt-1 mb-1 space-y-0.5 border-l pl-2" style={{ borderColor: 'var(--border)' }}>
          {visibleItems.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `block px-2 py-1.5 rounded-md text-xs transition-colors duration-100 truncate font-medium ${
                  isActive ? '' : 'hover:bg-[var(--bg-soft)]'
                }`
              }
              style={({ isActive }) => isActive
                ? { color: 'var(--brand-primary)', background: 'color-mix(in srgb, var(--brand-primary) 12%, transparent)' }
                : { color: 'var(--text-3)' }
              }
            >
              {item.label}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  )
}

function SidebarLink({ to, icon: Icon, label, collapsed, end = false }: {
  to: string
  icon: LucideIcon
  label: string
  collapsed: boolean
  end?: boolean
}) {
  return (
    <NavLink
      to={to}
      end={end}
      title={collapsed ? label : undefined}
      className={({ isActive }) =>
        `${collapsed ? 'mx-auto h-9 w-9 justify-center' : 'px-3 py-2'} flex items-center gap-2 rounded-lg text-xs font-medium transition-colors ${
          isActive ? 'bg-blue-600 text-white' : 'hover:bg-[var(--bg-soft)]'
        }`
      }
      style={({ isActive }) => isActive ? {} : { color: 'var(--text-2)' }}
    >
      <Icon size={15} className="flex-shrink-0" />
      {!collapsed && <span className="truncate">{label}</span>}
    </NavLink>
  )
}

export default function AppLayout() {
  const { user, logout } = useAuthStore()
  const { status, triggerSync } = useSyncStatus()
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [branding, setBranding] = useState<Record<string, unknown>>({})
  const [subStatus, setSubStatus] = useState<string | null>(null)
  const [subEndsAt, setSubEndsAt] = useState<string | null>(null)
  const [isLocked, setIsLocked] = useState(false)
  const [lockReason, setLockReason] = useState<'suspended' | 'cancelled' | null>(null)
  const [enabledModules, setEnabledModules] = useState<string[] | null>(null)
  const { dark, toggle: toggleTheme } = useTheme()

  const permissions = (user?.role?.permissions ||
    (user as unknown as Record<string, unknown>)?.permissions) as Record<string, unknown> || {}
  const isAdmin = Boolean(permissions.all)
  const roleName = user?.role?.name || 'System User'

  useEffect(() => {
    const applyColor = (color: string) => {
      document.documentElement.style.setProperty('--brand-primary', color)
      document.documentElement.style.setProperty('--brand-primary-hover', color)
    }

    const loadBranding = async () => {
      const res = await window.api.settings.get() as { success: boolean; data?: unknown }
      if (res.success && res.data) {
        const d = res.data as Record<string, unknown>
        setBranding(d)
        const cached = (d.brand_color as string) || '#2563eb'
        applyColor(cached)

        // Fetch fresh brand from backend so superadmin color changes take effect
        const apiUrl = d.cloud_api_url as string
        const apiKey = d.cloud_api_key as string
        if (apiUrl && apiKey) {
          try {
            const resp = await fetch(`${apiUrl}/api/brand`, { headers: { 'x-api-key': apiKey } })
            if (resp.status === 401) {
              // API key no longer valid — company was permanently deleted by SuperAdmin
              await window.api.admin?.forceReset?.()
              navigate('/setup', { replace: true })
              return
            }
            if (!resp.ok) {
              // 5xx / network error — treat as offline, keep cached settings
              return
            }
            const brand = await resp.json()
            if (brand?.brand_color) {
              applyColor(brand.brand_color)
              setBranding(prev => ({ ...prev, brand_color: brand.brand_color, company_logo_url: brand.brand_logo_url ?? prev.company_logo_url }))
            }
            if (brand?.sub_status) setSubStatus(brand.sub_status)
            if (brand?.sub_ends_at) setSubEndsAt(brand.sub_ends_at)
            if (brand?.is_locked) {
              setIsLocked(Boolean(brand.is_locked))
              if (brand.lock_reason) setLockReason(brand.lock_reason as 'suspended' | 'cancelled')
            }
            if (Array.isArray(brand?.modules)) setEnabledModules(brand.modules as string[])
          } catch { /* offline — cached color stays */ }
        }
      }
    }

    loadBranding()
    // Load cached license immediately for module gating (before async brand fetch)
    window.api.license.status().then((r: { success: boolean; data: { is_locked?: boolean; modules?: string[] } | null }) => {
      if (r.success && r.data) {
        if (r.data.is_locked) setIsLocked(true)
        if (Array.isArray(r.data.modules)) setEnabledModules(r.data.modules)
      }
    })
    window.addEventListener('themechange', loadBranding)
    return () => window.removeEventListener('themechange', loadBranding)
  }, [])

  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false)

  // Auto-updater state
  const [updateInfo,    setUpdateInfo]    = useState<{ version: string } | null>(null)
  const [updateState,   setUpdateState]   = useState<'idle' | 'downloading' | 'ready'>('idle')
  const [downloadPct,   setDownloadPct]   = useState(0)

  useEffect(() => {
    if (!window.api?.on) return
    const off1 = window.api.on('update:available',  (info: unknown) => setUpdateInfo(info as { version: string }))
    const off2 = window.api.on('update:progress',   (p: unknown)    => { setUpdateState('downloading'); setDownloadPct(Math.round((p as { percent: number }).percent)) })
    const off3 = window.api.on('update:downloaded', ()              => setUpdateState('ready'))
    const off4 = window.api.on('update:error',      ()              => { setUpdateState('idle'); setUpdateInfo(null) })
    return () => { off1?.(); off2?.(); off3?.(); off4?.() }
  }, [])

  const handleLogout = () => setShowLogoutConfirm(true)

  const confirmLogout = async () => {
    setShowLogoutConfirm(false)
    await logout()
    navigate('/login')
    toast.success('Logged out successfully')
  }

  if (isLocked) {
    const isCancelled = lockReason === 'cancelled'
    return (
      <div className="flex flex-col h-screen items-center justify-center gap-6" style={{ background: 'var(--bg-page)' }}>
        <div className={`w-16 h-16 rounded-2xl flex items-center justify-center ${isCancelled ? 'bg-gray-700/40' : 'bg-red-600/20'}`}>
          <Shield size={32} className={isCancelled ? 'text-gray-400' : 'text-red-400'} />
        </div>
        <div className="text-center space-y-2 max-w-md px-6">
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-1)' }}>
            {isCancelled ? 'Account Cancelled' : 'Account Suspended'}
          </h1>
          <p className="text-sm" style={{ color: 'var(--text-3)' }}>
            {isCancelled
              ? 'Your company account has been cancelled. All cloud access has been removed. Please contact your service provider if this was a mistake.'
              : 'Your company account has been suspended. Please contact your service provider to restore access.'}
          </p>
          <p className="text-xs mt-2 font-mono px-3 py-1.5 rounded-lg inline-block" style={{ background: 'var(--bg-card)', color: 'var(--text-2)' }}>
            {String(branding.company_name || 'Your Company')}
          </p>
        </div>
        <button onClick={handleLogout} className="btn-secondary gap-2 flex items-center">
          <LogOut size={14} /> Sign Out
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden" style={{ background: 'var(--bg-page)' }}>
      <header
        className="flex items-center gap-3 px-4 h-14 flex-shrink-0 z-30"
        style={{ background: 'var(--bg-topbar)', borderBottom: '1px solid var(--border)', boxShadow: 'var(--shadow)' }}
      >
        <button onClick={() => setSidebarOpen(o => !o)} className="flex items-center gap-2 flex-shrink-0">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center overflow-hidden">
            {branding.company_logo_url
              ? <img src={String(branding.company_logo_url)} alt="" className="w-full h-full object-cover" />
              : <ShoppingBag size={16} className="text-white" />}
          </div>
          <span className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>{String(branding.company_name || 'MyPOS')}</span>
          <Menu size={16} style={{ color: 'var(--text-3)' }} />
        </button>

        <div className="hidden md:flex items-center gap-2 px-2.5 py-1.5 rounded-lg border" style={{ background: 'var(--bg-soft)', borderColor: 'var(--border)', color: 'var(--text-2)' }}>
          <Building2 size={13} />
          <span className="text-xs font-semibold truncate max-w-36">{user?.branch?.name || 'Main Branch'}</span>
        </div>

        <div className="flex-1" />
        <Clock />

        <NavLink to="/pos" className="px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 transition-colors">
          POS
        </NavLink>

        <button onClick={toggleTheme} className="p-2 rounded-lg hover:bg-[var(--bg-soft)] transition-colors" style={{ color: 'var(--text-3)' }} title="Toggle theme">
          {dark ? <Sun size={16} className="text-yellow-500" /> : <Moon size={16} />}
        </button>

        <button onClick={triggerSync} className="relative p-2 rounded-lg hover:bg-[var(--bg-soft)] transition-colors" title={`Sync - ${status.pending} pending`} style={{ color: 'var(--text-3)' }}>
          {status.online ? <Wifi size={16} className="text-green-500" /> : <WifiOff size={16} className="text-red-400" />}
          {status.failed > 0 && <AlertCircle size={12} className="absolute right-0 top-0 text-yellow-400" />}
        </button>

        <NotificationPanel />

        <div className="hidden sm:flex items-center gap-2 px-2 py-1 rounded-lg" style={{ color: 'var(--text-2)' }}>
          <div className="w-7 h-7 bg-blue-600 rounded-full flex items-center justify-center text-white text-xs font-bold">
            {user?.name?.[0]?.toUpperCase() || 'U'}
          </div>
          <div className="leading-tight">
            <p className="text-xs font-semibold truncate max-w-[110px]">{user?.name}</p>
            <p className="text-[10px] uppercase tracking-wide truncate max-w-[110px]" style={{ color: 'var(--text-3)' }}>{roleName}</p>
          </div>
          <ChevronDown size={12} style={{ color: 'var(--text-3)' }} />
        </div>

        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${status.online ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
          {status.online ? 'ONLINE' : 'OFFLINE'}
        </span>

        <button onClick={handleLogout} className="p-2 rounded-lg hover:bg-[var(--bg-soft)] transition-colors" style={{ color: 'var(--text-3)' }} title="Logout">
          <LogOut size={15} />
        </button>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <aside
          className="flex flex-col flex-shrink-0 overflow-hidden z-20 transition-[width] duration-200"
          style={{
            width: sidebarOpen ? 208 : 64,
            background: 'var(--bg-sidebar)',
            borderRight: '1px solid var(--border)',
          }}
        >
          {!sidebarOpen ? (
            <div className="px-2 py-3 space-y-1">
              {(isAdmin || Boolean(permissions.reports)) && <SidebarLink to="/admin" end icon={LayoutDashboard} label="Dashboard" collapsed />}
              {(isAdmin || Boolean(permissions.inventory)) && <SidebarLink to="/admin/purchase-orders" end icon={FileText} label="GRN" collapsed />}
              {NAV_GROUPS.map(group => <SidebarGroup key={group.label} group={group} permissions={permissions} isAdmin={isAdmin} collapsed enabledModules={enabledModules} />)}
              {isAdmin && <SidebarLink to="/admin/settings" icon={Settings} label="Settings" collapsed />}
            </div>
          ) : (
            <>
              <div className="px-3 pt-4 pb-2">
                <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-3)' }}>Menu</p>
              </div>
              <nav className="flex-1 overflow-y-auto py-1 px-2 space-y-0.5">
                {(isAdmin || Boolean(permissions.reports)) && <SidebarLink to="/admin" end icon={LayoutDashboard} label="Dashboard" collapsed={false} />}
                {(isAdmin || Boolean(permissions.inventory)) && <SidebarLink to="/admin/purchase-orders" end icon={FileText} label="GRN" collapsed={false} />}
                {NAV_GROUPS.map(group => <SidebarGroup key={group.label} group={group} permissions={permissions} isAdmin={isAdmin} collapsed={false} enabledModules={enabledModules} />)}
                {isAdmin && <SidebarLink to="/admin/settings" icon={Settings} label="Settings" collapsed={false} />}
              </nav>
            </>
          )}
        </aside>

        <main className="relative flex-1 overflow-hidden flex flex-col">
          {(subStatus === 'grace' || subStatus === 'expired') && (
            <div className={`flex items-center gap-3 px-4 py-2 text-xs font-medium flex-shrink-0 ${subStatus === 'expired' ? 'bg-red-600/20 text-red-300 border-b border-red-600/30' : 'bg-yellow-500/20 text-yellow-300 border-b border-yellow-500/30'}`}>
              <AlertCircle size={13} className="flex-shrink-0" />
              {subStatus === 'expired'
                ? `Subscription expired. Billing operations are disabled. Please renew to continue.`
                : `Subscription ends ${subEndsAt ? new Date(subEndsAt).toLocaleDateString() : 'soon'}. Please renew to avoid interruption.`}
              {isAdmin && (
                <button onClick={() => navigate('/admin/settings')} className="ml-auto underline underline-offset-2">
                  Renew →
                </button>
              )}
            </div>
          )}
          {/* Update notification banner */}
          {updateInfo && updateState !== 'idle' && (
            <div className="flex items-center gap-3 px-4 py-2 text-sm shrink-0"
              style={{ background: updateState === 'ready' ? 'rgba(34,197,94,0.12)' : 'rgba(99,102,241,0.12)', borderBottom: '1px solid var(--border)' }}>
              {updateState === 'downloading' ? (
                <>
                  <RefreshCw size={14} className="animate-spin text-indigo-400 shrink-0" />
                  <span style={{ color: 'var(--text-2)' }}>
                    Downloading update v{updateInfo.version}… <strong>{downloadPct}%</strong>
                  </span>
                  <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
                    <div className="h-full rounded-full bg-indigo-500 transition-all" style={{ width: `${downloadPct}%` }} />
                  </div>
                </>
              ) : (
                <>
                  <Download size={14} className="text-green-400 shrink-0" />
                  <span style={{ color: 'var(--text-2)' }}>
                    Update v{updateInfo.version} ready to install
                  </span>
                  <button
                    onClick={() => window.api.updater?.install()}
                    className="ml-auto px-3 py-1 rounded-lg text-xs font-semibold text-white"
                    style={{ background: '#16a34a' }}
                  >
                    Restart & Install
                  </button>
                  <button onClick={() => setUpdateInfo(null)} className="text-xs" style={{ color: 'var(--text-3)' }}>Later</button>
                </>
              )}
            </div>
          )}

          {updateInfo && updateState === 'idle' && (
            <div className="flex items-center gap-3 px-4 py-2 text-sm shrink-0"
              style={{ background: 'rgba(99,102,241,0.10)', borderBottom: '1px solid var(--border)' }}>
              <Download size={14} className="text-indigo-400 shrink-0" />
              <span style={{ color: 'var(--text-2)' }}>
                Update v{updateInfo.version} available
              </span>
              <button
                onClick={() => { setUpdateState('downloading'); window.api.updater?.download() }}
                className="ml-auto px-3 py-1 rounded-lg text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500"
              >
                Download Update
              </button>
              <button onClick={() => setUpdateInfo(null)} className="text-xs" style={{ color: 'var(--text-3)' }}>Later</button>
            </div>
          )}

          <Outlet />
        </main>
      </div>

      {/* ── Logout Confirmation Modal ── */}
      {showLogoutConfirm && (
        <div className="fixed inset-0 z-[999] flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
          onClick={() => setShowLogoutConfirm(false)}>
          <div className="w-full max-w-sm rounded-2xl p-6 shadow-2xl"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}
            onClick={e => e.stopPropagation()}>
            <div className="flex flex-col items-center text-center gap-3">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center"
                style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)' }}>
                <LogOut size={24} className="text-red-400" />
              </div>
              <div>
                <h3 className="text-base font-bold" style={{ color: 'var(--text-1)' }}>Confirm Logout</h3>
                <p className="text-sm mt-1" style={{ color: 'var(--text-3)' }}>
                  Are you sure you want to log out?<br />
                  Any unsaved changes will be lost.
                </p>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowLogoutConfirm(false)}
                className="flex-1 btn-secondary py-2.5 font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={confirmLogout}
                className="flex-1 py-2.5 rounded-xl font-semibold text-white text-sm transition-all"
                style={{ background: 'linear-gradient(135deg,#dc2626,#b91c1c)', boxShadow: '0 4px 14px rgba(220,38,38,0.35)' }}
              >
                Yes, Logout
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
