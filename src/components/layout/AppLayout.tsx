import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import { useSyncStatus } from '@/hooks/useSyncStatus'
import {
  LayoutDashboard, Package, Users, Warehouse, BarChart3, GitBranch,
  Truck, Settings, LogOut, Wifi, WifiOff, AlertCircle, UserCog,
  FileText, ShoppingCart, Receipt, Sun, Moon, ChevronDown,
  ChevronRight, ShoppingBag, Menu, Building2, type LucideIcon
} from 'lucide-react'
import { useState, useEffect } from 'react'
import toast from 'react-hot-toast'

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
type NavGroup = { label: string; icon: LucideIcon; items: NavItem[]; perm?: string; adminOnly?: boolean }

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Products', icon: Package, perm: 'inventory',
    items: [
      { to: '/admin/products', label: 'List Products', perm: 'inventory' },
      { to: '/admin/categories', label: 'Categories', perm: 'inventory' },
      { to: '/admin/inventory', label: 'Inventory', perm: 'inventory' },
      { to: '/admin/stock-lookup', label: 'Stock Lookup', perm: 'inventory' },
      { to: '/admin/stock-count', label: 'Stock Count', perm: 'inventory' },
    ]
  },
  { label: 'Purchase Orders', icon: ShoppingCart, perm: 'inventory', items: [{ to: '/admin/purchase-orders', label: 'Purchase Orders', perm: 'inventory' }] },
  { label: 'Supplier Management', icon: Users, perm: 'inventory', items: [{ to: '/admin/suppliers', label: 'Supplier List', perm: 'inventory' }] },
  {
    label: 'Customer Management', icon: UserCog, perm: 'customers',
    items: [
      { to: '/admin/customers', label: 'Customers', perm: 'customers' },
      { to: '/admin/installments', label: 'Installments', perm: 'customers' },
    ]
  },
  {
    label: 'Stock Transfers', icon: Warehouse, perm: 'inventory',
    items: [
      { to: '/admin/inventory',       label: 'Stock Transfers', perm: 'inventory' },
      { to: '/admin/stock-requests',  label: 'Stock Requests',  perm: 'inventory' },
    ]
  },
  {
    label: 'Sell', icon: ShoppingBag, perm: 'pos',
    items: [
      { to: '/admin/orders', label: 'Orders', perm: 'pos' },
      { to: '/admin/quotations', label: 'Quotations', perm: 'pos' },
      { to: '/admin/credit-bills', label: 'Credit Bills', perm: 'reports' },
      { to: '/admin/returns', label: 'Returns & Refunds', perm: 'pos' },
      { to: '/admin/cash-register', label: 'Cash Register', perm: 'pos' },
    ]
  },
  { label: 'Deliveries', icon: Truck, perm: 'deliveries', items: [{ to: '/admin/deliveries', label: 'Deliveries', perm: 'deliveries' }] },
  { label: 'Expenses', icon: Receipt, perm: 'expenses', items: [{ to: '/admin/expenses', label: 'Expenses', perm: 'expenses' }] },
  { label: 'Reports', icon: BarChart3, perm: 'reports', items: [{ to: '/admin/analytics', label: 'Analytics', perm: 'reports' }] },
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
]

function canSeeItem(item: NavItem, permissions: Record<string, unknown>, isAdmin: boolean) {
  if (isAdmin) return true
  if (item.adminOnly) return false
  return !item.perm || Boolean(permissions[item.perm])
}

function SidebarGroup({
  group, permissions, isAdmin, collapsed
}: {
  group: NavGroup
  permissions: Record<string, unknown>
  isAdmin: boolean
  collapsed: boolean
}) {
  const [open, setOpen] = useState(false)
  const Icon = group.icon
  const visibleItems = group.items.filter(item => canSeeItem(item, permissions, isAdmin))

  if (!isAdmin && group.adminOnly) return null
  if (!isAdmin && group.perm && !permissions[group.perm] && !visibleItems.length) return null
  if (!visibleItems.length) return null

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
        style={{ color: open ? '#2563eb' : 'var(--text-2)' }}
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
                  isActive ? 'text-blue-600 bg-blue-50 dark:bg-blue-500/10' : 'hover:bg-[var(--bg-soft)]'
                }`
              }
              style={({ isActive }) => isActive ? {} : { color: 'var(--text-3)' }}
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
  const { dark, toggle: toggleTheme } = useTheme()

  const permissions = (user?.role?.permissions ||
    (user as unknown as Record<string, unknown>)?.permissions) as Record<string, unknown> || {}
  const isAdmin = Boolean(permissions.all)
  const roleName = user?.role?.name || 'System User'

  const handleLogout = async () => {
    await logout()
    navigate('/login')
    toast.success('Logged out')
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden" style={{ background: 'var(--bg-page)' }}>
      <header
        className="flex items-center gap-3 px-4 h-14 flex-shrink-0 z-30"
        style={{ background: 'var(--bg-topbar)', borderBottom: '1px solid var(--border)', boxShadow: 'var(--shadow)' }}
      >
        <button onClick={() => setSidebarOpen(o => !o)} className="flex items-center gap-2 flex-shrink-0">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
            <ShoppingBag size={16} className="text-white" />
          </div>
          <span className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>MyPOS</span>
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
              {NAV_GROUPS.map(group => <SidebarGroup key={group.label} group={group} permissions={permissions} isAdmin={isAdmin} collapsed />)}
              {(isAdmin || Boolean(permissions.settings)) && <SidebarLink to="/admin/settings" icon={Settings} label="Settings" collapsed />}
            </div>
          ) : (
            <>
              <div className="px-3 pt-4 pb-2">
                <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-3)' }}>Menu</p>
              </div>
              <nav className="flex-1 overflow-y-auto py-1 px-2 space-y-0.5">
                {(isAdmin || Boolean(permissions.reports)) && <SidebarLink to="/admin" end icon={LayoutDashboard} label="Dashboard" collapsed={false} />}
                {(isAdmin || Boolean(permissions.inventory)) && <SidebarLink to="/admin/purchase-orders" end icon={FileText} label="GRN" collapsed={false} />}
                {NAV_GROUPS.map(group => <SidebarGroup key={group.label} group={group} permissions={permissions} isAdmin={isAdmin} collapsed={false} />)}
                {(isAdmin || Boolean(permissions.settings)) && <SidebarLink to="/admin/settings" icon={Settings} label="Settings" collapsed={false} />}
              </nav>
            </>
          )}
        </aside>

        <main className="relative flex-1 overflow-hidden flex flex-col">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
