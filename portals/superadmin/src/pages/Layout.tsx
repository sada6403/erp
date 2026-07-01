import { useEffect, useState } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { auth, settings as settingsApi } from '../lib/api'
import {
  LayoutDashboard, Building2, Package, Settings, ScrollText,
  ShieldCheck, LogOut,
} from 'lucide-react'

const nav = [
  { to: '/',          label: 'Dashboard',   icon: LayoutDashboard, end: true },
  { to: '/companies', label: 'Companies',   icon: Building2 },
  { to: '/packages',  label: 'Packages',    icon: Package },
  { to: '/settings',  label: 'Settings',    icon: Settings },
  { to: '/audit',     label: 'Audit Logs',  icon: ScrollText },
]

export default function Layout() {
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()
  const [branding, setBranding] = useState<{ app_name?: string; logo_url?: string; primary_color?: string }>({})

  useEffect(() => {
    settingsApi.get().then(s => {
      const b = (s.branding ?? {}) as Record<string, string>
      setBranding(b)
    }).catch(() => {})
  }, [])

  const accentColor = branding.primary_color || '#2563eb'
  const appName     = branding.app_name      || 'POS ERP'

  async function handleLogout() {
    try { await auth.logout() } catch { /* ignore */ }
    logout()
    navigate('/login')
  }

  return (
    <div className="flex h-screen bg-gray-950 overflow-hidden">
      {/* Sidebar */}
      <aside className="w-56 flex-shrink-0 flex flex-col bg-gray-900 border-r border-gray-800">
        {/* Logo */}
        <div className="flex items-center gap-3 px-4 py-5 border-b border-gray-800">
          {branding.logo_url ? (
            <img src={branding.logo_url} alt={appName}
              className="w-8 h-8 rounded-lg object-contain"
              style={{ background: accentColor }}
              onError={e => { (e.target as HTMLImageElement).style.display='none' }} />
          ) : (
            <div className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ background: accentColor }}>
              <ShieldCheck className="w-4 h-4 text-white" />
            </div>
          )}
          <div>
            <p className="text-xs font-semibold text-white leading-none">{appName}</p>
            <p className="text-[10px] text-gray-500 leading-none mt-0.5">SuperAdmin</p>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-2 py-4 space-y-0.5 overflow-y-auto">
          {nav.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                  isActive
                    ? 'font-medium'
                    : 'text-gray-400 hover:text-white hover:bg-gray-800'
                }`
              }
              style={({ isActive }) => isActive ? { color: accentColor, background: `${accentColor}20` } : {}}
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* User / logout */}
        <div className="px-2 py-3 border-t border-gray-800">
          <div className="px-3 py-2">
            <p className="text-xs font-medium text-gray-200 truncate">{user?.name}</p>
            <p className="text-[10px] text-gray-500 truncate">{user?.email}</p>
          </div>
          <button onClick={handleLogout}
            className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-sm text-gray-400 hover:text-red-400 hover:bg-gray-800 transition-colors">
            <LogOut className="w-4 h-4" />
            Sign out
          </button>
        </div>
      </aside>

      {/* Content */}
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  )
}
