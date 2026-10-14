import { useEffect, useState } from 'react'
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { auth, settings as settingsApi } from '../lib/api'
import {
  ShieldCheck, LogOut, Menu, X, ChevronRight,
  LayoutDashboard, Building2, KeyRound, Package, Sliders, FileText, MoreHorizontal
} from 'lucide-react'

const nav = [
  { to: '/',                   label: 'Dashboard',   icon: LayoutDashboard, desc: 'Realtime stats & overview', end: true },
  { to: '/companies',          label: 'Companies',   icon: Building2,       desc: 'Tenants, branches & limits' },
  { to: '/product-key-access', label: 'Key Access',  icon: KeyRound,        desc: 'Product keys & activations' },
  { to: '/packages',           label: 'Packages',    icon: Package,         desc: 'Plan tiers & device quotas' },
  { to: '/settings',           label: 'Settings',    icon: Sliders,         desc: 'System, cloud & branding' },
  { to: '/audit',              label: 'Audit Logs',  icon: FileText,        desc: 'Security tracking & history' },
]

export default function Layout() {
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()
  const location = useLocation()
  const [branding, setBranding] = useState<{ app_name?: string; logo_url?: string; primary_color?: string }>({})
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  useEffect(() => {
    settingsApi.get().then(s => {
      const b = (s.branding ?? {}) as Record<string, string>
      setBranding(b)
    }).catch(() => {})
  }, [])

  // Close mobile drawer on route change
  useEffect(() => {
    setMobileMenuOpen(false)
  }, [location.pathname])

  const accentColor = branding.primary_color || '#2563eb'
  const appName     = branding.app_name      || 'POS ERP'

  async function handleLogout() {
    try { await auth.logout() } catch { /* ignore */ }
    logout()
    navigate('/login')
  }

  return (
    <div className="flex flex-col md:flex-row h-screen bg-gray-950 text-gray-100 overflow-hidden font-sans">
      {/* ── Mobile Top Header Bar ─────────────────────────────────────────── */}
      <header className="md:hidden sticky top-0 z-30 flex items-center justify-between px-4 py-3 bg-gray-900/95 backdrop-blur-md border-b border-gray-800 flex-shrink-0">
        <div className="flex items-center gap-2.5">
          {branding.logo_url ? (
            <img src={branding.logo_url} alt={appName}
              className="w-8 h-8 rounded-xl object-contain shadow-sm"
              style={{ background: accentColor }}
              onError={e => { (e.target as HTMLImageElement).style.display='none' }} />
          ) : (
            <div className="w-8 h-8 rounded-xl flex items-center justify-center shadow-md shadow-blue-500/20"
              style={{ background: accentColor }}>
              <ShieldCheck className="w-4 h-4 text-white" />
            </div>
          )}
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-bold text-white tracking-tight">{appName}</span>
              <span className="px-1.5 py-0.2 rounded text-[9px] font-semibold tracking-wide bg-blue-500/20 text-blue-400 border border-blue-500/30">
                PRO
              </span>
            </div>
            <p className="text-[10px] text-gray-400 font-medium">SuperAdmin Portal</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setMobileMenuOpen(o => !o)}
            className="p-2 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700 active:scale-95 transition-transform"
            aria-label="Toggle navigation menu"
          >
            {mobileMenuOpen ? <X className="w-5 h-5 text-red-400" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </header>

      {/* ── Mobile Drawer (Slide-out menu) ─────────────────────────────────── */}
      {mobileMenuOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/80 backdrop-blur-sm transition-opacity"
            onClick={() => setMobileMenuOpen(false)}
          />

          {/* Drawer content */}
          <div className="relative w-4/5 max-w-xs bg-gray-900 border-r border-gray-800 h-full flex flex-col z-50 shadow-2xl animate-in slide-in-from-left duration-200">
            {/* Drawer header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800 bg-gray-950/40">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center shadow-lg"
                  style={{ background: accentColor }}>
                  <ShieldCheck className="w-5 h-5 text-white" />
                </div>
                <div>
                  <p className="text-sm font-bold text-white">{appName}</p>
                  <p className="text-[10px] text-gray-400">Control Center</p>
                </div>
              </div>
              <button
                onClick={() => setMobileMenuOpen(false)}
                className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Nav list with Real Icons */}
            <nav className="flex-1 px-3 py-4 space-y-1.5 overflow-y-auto">
              <p className="px-3 text-[10px] uppercase font-bold text-gray-500 tracking-wider mb-2">Navigation</p>
              {nav.map(({ to, label, icon: Icon, desc, end }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={end}
                  className={({ isActive }) =>
                    `group flex items-center justify-between px-3.5 py-3 rounded-xl transition-all ${
                      isActive
                        ? 'bg-blue-600/20 text-white border border-blue-500/40 shadow-sm shadow-blue-500/10'
                        : 'text-gray-300 hover:text-white hover:bg-gray-800/80 border border-transparent'
                    }`
                  }
                  style={({ isActive }) => isActive ? { borderColor: `${accentColor}60`, background: `${accentColor}25` } : {}}
                >
                  <div className="flex items-center gap-3.5">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-gray-800/90 text-gray-300 group-hover:bg-blue-600/20 group-hover:text-blue-400 transition-colors flex-shrink-0">
                      <Icon className="w-4 h-4" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold leading-tight">{label}</p>
                      <p className="text-[10px] text-gray-400 font-normal mt-0.5 leading-tight">{desc}</p>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-gray-500 group-hover:text-gray-300 transition-colors" />
                </NavLink>
              ))}
            </nav>

            {/* User info & Logout */}
            <div className="p-3 border-t border-gray-800 bg-gray-950/60">
              <div className="px-3 py-2 bg-gray-800/60 rounded-xl mb-2 border border-gray-750">
                <p className="text-xs font-semibold text-gray-200 truncate">{user?.name || 'Administrator'}</p>
                <p className="text-[10px] text-gray-400 truncate">{user?.email}</p>
              </div>
              <button
                onClick={handleLogout}
                className="flex items-center justify-center gap-2 w-full px-3 py-2.5 rounded-xl text-sm font-semibold text-red-400 hover:text-white hover:bg-red-900/40 border border-red-800/40 transition-colors"
              >
                <LogOut className="w-4 h-4" />
                <span>Sign Out</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Desktop Sidebar ───────────────────────────────────────────────── */}
      <aside className="hidden md:flex md:w-64 flex-shrink-0 flex-col bg-gray-900 border-r border-gray-800 select-none">
        {/* Logo & Brand Header */}
        <div className="flex items-center gap-3 px-5 py-5 border-b border-gray-800/80 bg-gray-950/20">
          {branding.logo_url ? (
            <img src={branding.logo_url} alt={appName}
              className="w-9 h-9 rounded-xl object-contain shadow-md shadow-blue-500/10"
              style={{ background: accentColor }}
              onError={e => { (e.target as HTMLImageElement).style.display='none' }} />
          ) : (
            <div className="w-9 h-9 rounded-xl flex items-center justify-center shadow-lg shadow-blue-600/20"
              style={{ background: accentColor }}>
              <ShieldCheck className="w-5 h-5 text-white" />
            </div>
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-bold text-white truncate tracking-tight">{appName}</p>
              <span className="px-1.5 py-0.2 rounded text-[9px] font-semibold bg-blue-500/20 text-blue-400 border border-blue-500/30">
                PRO
              </span>
            </div>
            <p className="text-[11px] text-gray-400 font-medium leading-none mt-1">SuperAdmin Portal</p>
          </div>
        </div>

        {/* Navigation List with Professional Lucide Icons */}
        <nav className="flex-1 px-3 py-4 space-y-1.5 overflow-y-auto">
          <p className="px-3 text-[10px] uppercase font-bold text-gray-500 tracking-wider mb-2">Main Menu</p>
          {nav.map(({ to, label, icon: Icon, desc, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `group flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm transition-all ${
                  isActive
                    ? 'font-bold text-white shadow-md shadow-blue-500/10 border'
                    : 'text-gray-400 hover:text-white hover:bg-gray-800/80 border border-transparent'
                }`
              }
              style={({ isActive }) => isActive ? {
                color: '#ffffff',
                borderColor: `${accentColor}50`,
                background: `linear-gradient(135deg, ${accentColor}25, ${accentColor}10)`
              } : {}}
            >
              <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-gray-800/90 text-gray-300 group-hover:bg-blue-600/20 group-hover:text-blue-400 group-hover:scale-105 transition-all flex-shrink-0">
                <Icon className="w-4 h-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold leading-tight text-white group-hover:text-blue-300 transition-colors">
                  {label}
                </p>
                <p className="text-[10px] text-gray-500 group-hover:text-gray-400 font-normal mt-0.5 truncate leading-tight">
                  {desc}
                </p>
              </div>
            </NavLink>
          ))}
        </nav>

        {/* User Card & Logout */}
        <div className="p-3 border-t border-gray-800/80 bg-gray-950/40">
          <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-gray-800/50 border border-gray-800 mb-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-600 to-indigo-700 flex items-center justify-center font-bold text-white text-xs shadow-sm">
              {(user?.name || 'A').charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-gray-200 truncate">{user?.name || 'Admin'}</p>
              <p className="text-[10px] text-gray-500 truncate">{user?.email || 'admin@pos.com'}</p>
            </div>
          </div>

          <button
            onClick={handleLogout}
            className="flex items-center justify-center gap-2 w-full px-3 py-2 rounded-xl text-xs font-semibold text-gray-400 hover:text-red-400 hover:bg-red-950/30 border border-transparent hover:border-red-900/40 transition-all"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* ── Main Content Area ─────────────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto pb-20 md:pb-6 focus:outline-none">
        <Outlet />
      </main>

      {/* ── Mobile Bottom Navigation Bar (Thumb Friendly) ─────────────────── */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-gray-900/95 backdrop-blur-md border-t border-gray-800 px-2 py-1 flex items-center justify-around shadow-2xl">
        {nav.slice(0, 4).map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex flex-col items-center justify-center py-1.5 px-3 rounded-xl transition-all ${
                isActive
                  ? 'text-blue-400 font-bold scale-105'
                  : 'text-gray-400 hover:text-gray-200'
              }`
            }
          >
            <Icon className="w-5 h-5 mb-0.5" />
            <span className="text-[10px] tracking-tight">{label}</span>
          </NavLink>
        ))}

        {/* More / Menu Drawer trigger in bottom bar */}
        <button
          type="button"
          onClick={() => setMobileMenuOpen(true)}
          className="flex flex-col items-center justify-center py-1.5 px-3 rounded-xl text-gray-400 hover:text-gray-200"
        >
          <MoreHorizontal className="w-5 h-5 mb-0.5" />
          <span className="text-[10px] tracking-tight">More</span>
        </button>
      </nav>
    </div>
  )
}
