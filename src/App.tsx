import { useEffect, useState } from 'react'
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import LoginPage from '@/pages/LoginPage'
import AppLayout from '@/components/layout/AppLayout'
import POSPage from '@/pages/pos/POSPage'
import AdminDashboard from '@/pages/admin/AdminDashboard'
import ProductsPage from '@/pages/admin/ProductsPage'
import CustomersPage from '@/pages/admin/CustomersPage'
import InventoryPage from '@/pages/admin/InventoryPage'
import StockIntelligencePage from '@/pages/admin/StockIntelligencePage'
import BranchesPage from '@/pages/admin/BranchesPage'
import UsersPage from '@/pages/admin/UsersPage'
import AgentsPage from '@/pages/admin/AgentsPage'
import SuppliersPage from '@/pages/admin/SuppliersPage'
import AnalyticsPage from '@/pages/admin/AnalyticsPage'
import DeliveriesPage from '@/pages/admin/DeliveriesPage'
import InstallmentsPage from '@/pages/admin/InstallmentsPage'
import AuditLogsPage from '@/pages/admin/AuditLogsPage'
import OperationsHubPage from '@/pages/admin/OperationsHubPage'
import SettingsPage from '@/pages/admin/SettingsPage'
import SyncMonitorPage from '@/pages/admin/SyncMonitorPage'
import CategoriesPage from '@/pages/admin/CategoriesPage'
import StockCountPage from '@/pages/admin/StockCountPage'
import OrdersPage from '@/pages/admin/OrdersPage'
import StockLookupPage from '@/pages/admin/StockLookupPage'
import QuotationsPage from '@/pages/admin/QuotationsPage'
import CreditBillsPage from '@/pages/admin/CreditBillsPage'
import PurchaseOrdersPage from '@/pages/admin/PurchaseOrdersPage'
import ExpensesPage from '@/pages/admin/ExpensesPage'
import RolesPage from '@/pages/admin/RolesPage'
import ReturnsPage from '@/pages/admin/ReturnsPage'
import CashRegisterPage from '@/pages/admin/CashRegisterPage'
import StockRequestsPage from '@/pages/admin/StockRequestsPage'
import StockTransfersPage from '@/pages/admin/StockTransfersPage'
import TrackTransferPage from '@/pages/admin/TrackTransferPage'
import BranchTransfersPage from '@/pages/admin/BranchTransfersPage'
import BranchTransferForm from '@/pages/admin/BranchTransferForm'
import BranchTransferView from '@/pages/admin/BranchTransferView'
import BatchesPage from '@/pages/admin/BatchesPage'
import CouponsPage from '@/pages/admin/CouponsPage'
import CouponReportsPage from '@/pages/admin/CouponReportsPage'
import BackupPage from '@/pages/admin/BackupPage'
import SecurityPage from '@/pages/admin/SecurityPage'
import SystemHealthPage from '@/pages/admin/SystemHealthPage'
import TransactionReportPage from '@/pages/admin/TransactionReportPage'
import AdvancedReportsPage from '@/pages/admin/AdvancedReportsPage'
import ActivationPage from '@/pages/ActivationPage'
import SetupWizardPage from '@/pages/SetupWizardPage'
import { loadAndApplySystemTheme } from '@/lib/systemTheme'
import { getLandingRoute } from '@/lib/sessionRouting'

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuthStore()
  if (isLoading) return <LoadingScreen />
  if (!user) return <Navigate to="/login" replace />
  return <>{children}</>
}

function RequireSuperAdmin({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuthStore()
  if (isLoading) return <LoadingScreen />
  if (!user) return <Navigate to="/login" replace />
  const permissions = (user.role?.permissions ||
    (user as unknown as Record<string, unknown>).permissions) as Record<string, unknown> || {}
  if (!permissions.all) return <Navigate to="/admin" replace />
  return <>{children}</>
}

function LoadingScreen() {
  return (
    <div className="flex items-center justify-center h-screen bg-surface-900">
      <div className="flex flex-col items-center gap-4">
        <div className="w-12 h-12 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-slate-400 text-sm">Loading Enterprise POS ERP...</p>
      </div>
    </div>
  )
}

function SessionLanding() {
  const { user } = useAuthStore()
  return <Navigate to={getLandingRoute(user)} replace />
}

export default function App() {
  const { init } = useAuthStore()
  const navigate   = useNavigate()
  const [activated, setActivated] = useState<boolean | null>(null)

  async function finishActivation() {
    setActivated(true)
    await init()
    const setupRequired = await window.api.admin?.isSetupRequired?.().catch(() => false)
    navigate(setupRequired ? '/setup' : '/login', { replace: true })
  }

  useEffect(() => {
    loadAndApplySystemTheme().catch(() => undefined)
    // In browser (non-Electron) skip activation check
    if (!window.api?.app) { setActivated(true); init(); return }
    window.api.app.isActivated().then(async (ok: boolean) => {
      setActivated(ok)
      if (!ok) return
      // Always init auth store first (sets isLoading = false)
      init()
      // If previous session was wiped (clear-all or cloud deletion), go to setup
      const setupRequired = await window.api.admin?.isSetupRequired?.().catch(() => false)
      if (setupRequired) {
        navigate('/setup', { replace: true })
      }
    })
  }, [init, navigate])

  if (activated === null) return <LoadingScreen />
  if (!activated) return <ActivationPage onActivated={() => { finishActivation().catch(() => navigate('/login', { replace: true })) }} />

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/setup" element={<SetupWizardPage />} />
      <Route element={<RequireAuth><AppLayout /></RequireAuth>}>
        <Route index element={<SessionLanding />} />
        <Route path="/pos" element={<POSPage />} />
        <Route path="/admin" element={<AdminDashboard />} />
        <Route path="/admin/products" element={<ProductsPage />} />
        <Route path="/admin/customers" element={<CustomersPage />} />
        <Route path="/admin/inventory" element={<InventoryPage />} />
        <Route path="/admin/stock-intelligence" element={<StockIntelligencePage />} />
        <Route path="/admin/stock-count" element={<StockCountPage />} />
        <Route path="/admin/batches" element={<BatchesPage />} />
        <Route path="/admin/stock-lookup" element={<StockLookupPage />} />
        <Route path="/admin/orders" element={<OrdersPage />} />
        <Route path="/admin/quotations" element={<QuotationsPage />} />
        <Route path="/admin/credit-bills" element={<CreditBillsPage />} />
        <Route path="/admin/purchase-orders" element={<PurchaseOrdersPage />} />
        <Route path="/admin/expenses" element={<ExpensesPage />} />
        <Route path="/admin/branches" element={<BranchesPage />} />
        <Route path="/admin/users" element={<UsersPage />} />
        <Route path="/admin/agents" element={<AgentsPage />} />
        <Route path="/admin/categories" element={<CategoriesPage />} />
        <Route path="/admin/suppliers" element={<SuppliersPage />} />
        <Route path="/admin/analytics" element={<AnalyticsPage />} />
        <Route path="/admin/deliveries" element={<DeliveriesPage />} />
        <Route path="/admin/installments" element={<InstallmentsPage />} />
        <Route path="/admin/audit-logs" element={<AuditLogsPage />} />
        <Route path="/admin/operations" element={<OperationsHubPage />} />
        <Route path="/admin/sync" element={<SyncMonitorPage />} />
        <Route path="/admin/settings" element={<RequireSuperAdmin><SettingsPage /></RequireSuperAdmin>} />
        <Route path="/admin/roles" element={<RolesPage />} />
        <Route path="/admin/returns" element={<ReturnsPage />} />
        <Route path="/admin/cash-register" element={<CashRegisterPage />} />
        <Route path="/admin/stock-requests" element={<StockRequestsPage />} />
        <Route path="/admin/stock-transfers" element={<StockTransfersPage />} />
        <Route path="/admin/track-transfer" element={<TrackTransferPage />} />
        <Route path="/admin/branch-transfers" element={<BranchTransfersPage />} />
        <Route path="/admin/branch-transfers/new" element={<BranchTransferForm />} />
        <Route path="/admin/branch-transfers/:id" element={<BranchTransferView />} />
        <Route path="/admin/backup"         element={<RequireSuperAdmin><BackupPage /></RequireSuperAdmin>} />
        <Route path="/admin/security"       element={<SecurityPage />} />
        <Route path="/admin/system-health"  element={<RequireSuperAdmin><SystemHealthPage /></RequireSuperAdmin>} />
        <Route path="/admin/transactions"   element={<TransactionReportPage />} />
        <Route path="/admin/reports"        element={<AdvancedReportsPage />} />
        <Route path="/admin/coupons"        element={<CouponsPage />} />
        <Route path="/admin/coupon-reports" element={<CouponReportsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  )
}
