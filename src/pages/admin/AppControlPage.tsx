import { Suspense, lazy } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import PageHeader from '@/components/shared/PageHeader'
import BannersTab from './appControl/BannersTab'
import HomeLayoutTab from './appControl/HomeLayoutTab'
import ProductsTab from './appControl/ProductsTab'
import StoreSettingsTab from './appControl/StoreSettingsTab'

const AppAccessPage = lazy(() => import('./AppAccessPage'))
const ReviewsPage = lazy(() => import('./ReviewsPage'))
const AppVersionsPage = lazy(() => import('./AppVersionsPage'))

const TABS = [
  ['banners', 'Banners'], ['home', 'Home page'], ['products', 'Products'], ['store', 'Store settings'],
  ['access', 'App Access'], ['reviews', 'Reviews'], ['versions', 'App Versions'], ['announcements', 'Announcements'],
] as const
type Tab = typeof TABS[number][0]

/** Everything the mobile app shows or does, in one place. Old routes (/admin/online-store, app-access, reviews, app-versions) redirect here. */
export default function AppControlPage() {
  const { tab } = useParams<{ tab?: string }>()
  const navigate = useNavigate()
  if (!tab || !TABS.some(t => t[0] === tab)) return <Navigate to="/admin/app-control/banners" replace />
  const cur = tab as Tab
  return <div className="flex flex-col h-full overflow-hidden">
    <PageHeader title="App Control" subtitle="What customers see and can do in the mobile app" />
    <div className="flex flex-wrap gap-2 px-6 py-3 border-b border-slate-800">
      {TABS.map(([k, label]) =>
        <button key={k} onClick={() => navigate(`/admin/app-control/${k}`)} className={`px-3 py-1.5 rounded-lg text-xs ${cur === k ? 'bg-brand-600 text-white' : 'bg-surface-800 text-slate-400'}`}>{label}</button>)}
    </div>
    <div className="flex-1 overflow-auto">
      <Suspense fallback={<p className="p-6 text-sm text-slate-500">Loading…</p>}>
        {cur === 'banners' && <BannersTab />}
        {cur === 'home' && <HomeLayoutTab />}
        {cur === 'products' && <ProductsTab />}
        {cur === 'store' && <StoreSettingsTab />}
        {cur === 'access' && <AppAccessPage />}
        {cur === 'reviews' && <ReviewsPage />}
        {cur === 'versions' && <AppVersionsPage />}
        {cur === 'announcements' && <div className="p-6 max-w-xl"><p className="font-medium">Announcements</p><p className="text-sm text-slate-400 mt-1">Coming in v1.1.</p></div>}
      </Suspense>
    </div>
  </div>
}
