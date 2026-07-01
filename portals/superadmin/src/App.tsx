import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './store/authStore'
import LoginPage      from './pages/LoginPage'
import Layout         from './pages/Layout'
import DashboardPage  from './pages/DashboardPage'
import CompaniesPage  from './pages/CompaniesPage'
import PackagesPage   from './pages/PackagesPage'
import SettingsPage   from './pages/SettingsPage'
import AuditLogsPage  from './pages/AuditLogsPage'

function RequireAuth({ children }: { children: React.ReactNode }) {
  const user = useAuthStore(s => s.user)
  const loading = useAuthStore(s => s.loading)
  if (loading) return <div className="min-h-screen flex items-center justify-center text-gray-400">Loading…</div>
  if (!user) return <Navigate to="/login" replace />
  return <>{children}</>
}

export default function App() {
  const hydrate = useAuthStore(s => s.hydrate)
  useEffect(() => hydrate(), [hydrate])

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<RequireAuth><Layout /></RequireAuth>}>
          <Route index element={<DashboardPage />} />
          <Route path="companies"  element={<CompaniesPage />} />
          <Route path="packages"   element={<PackagesPage />} />
          <Route path="settings"   element={<SettingsPage />} />
          <Route path="audit"      element={<AuditLogsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
