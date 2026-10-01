import { lazy, Suspense, useEffect, useState } from 'react'
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import LoginPage from '@/pages/LoginPage'
import AppLayout from '@/components/layout/AppLayout'
import RequireModule from '@/components/shared/RequireModule'
import ActivationPage from '@/pages/ActivationPage'
import DataClearedLockScreen from '@/pages/DataClearedLockScreen'
import DeviceLockedScreen from '@/pages/DeviceLockedScreen'
import SetupWizardPage from '@/pages/SetupWizardPage'
import { loadAndApplySystemTheme } from '@/lib/systemTheme'
import { getLandingRoute } from '@/lib/sessionRouting'
import { canManageProcurement } from '@/lib/branchAccess'

// Keep the boot/login shell small. Loading every admin, reporting, Smart Buy,
// spreadsheet and chart module up front made Chromium parse the entire ERP
// before it could show the first usable screen. Each page is fetched only when
// its route is opened; Vite caches the chunk after that first visit.
const POSPage = lazy(() => import('@/pages/pos/POSPage'))
const adminPage = (name: string) => lazy(() => import(`./pages/admin/${name}.tsx`))
const AdminDashboard = adminPage('AdminDashboard')
const ProductsPage = adminPage('ProductsPage')
const CustomersPage = adminPage('CustomersPage')
const StockIntelligencePage = adminPage('StockIntelligencePage')
const BranchesPage = adminPage('BranchesPage')
const BranchInspectPage = adminPage('BranchInspectPage')
const BranchInspectDetailPage = adminPage('BranchInspectDetailPage')
const UsersPage = adminPage('UsersPage')
const RegionsPage = adminPage('RegionsPage')
const ZonesPage = adminPage('ZonesPage')
const SuppliersPage = adminPage('SuppliersPage')
const AnalyticsPage = adminPage('AnalyticsPage')
const DeliveriesPage = adminPage('DeliveriesPage')
const InstallmentsPage = adminPage('InstallmentsPage')
const ChitSchemesPage = adminPage('ChitSchemesPage')
const ChitCustomersPage = adminPage('ChitCustomersPage')
const ChitSchemeDetailPage = adminPage('ChitSchemeDetailPage')
const SmartBuyAgentsPage = adminPage('SmartBuyAgentsPage')
const SmartBuyDashboardPage = adminPage('SmartBuyDashboardPage')
const CommissionRulesPage = adminPage('CommissionRulesPage')
const SmartBuyReportsPage = adminPage('SmartBuyReportsPage')
const PaymentRemindersPage = adminPage('PaymentRemindersPage')
const SmartBuyBankTransfersPage = adminPage('SmartBuyBankTransfersPage')
const SmartBuySettingsPage = adminPage('SmartBuySettingsPage')
const SchemeMasterPage = adminPage('SchemeMasterPage')
const SmartBuyAwardWizardPage = adminPage('SmartBuyAwardWizardPage')
const SmartBuySchemeCalculatorPage = adminPage('SmartBuySchemeCalculatorPage')
const AuditLogsPage = adminPage('AuditLogsPage')
const EditRequestsPage = adminPage('EditRequestsPage')
const OperationsHubPage = adminPage('OperationsHubPage')
const SettingsPage = adminPage('SettingsPage')
const InvoiceDesignerPage = adminPage('InvoiceDesignerPage')
const SyncMonitorPage = adminPage('SyncMonitorPage')
const CategoriesPage = adminPage('CategoriesPage')
const StockCountPage = adminPage('StockCountPage')
const OrdersPage = adminPage('OrdersPage')
const StockLookupPage = adminPage('StockLookupPage')
const QuotationsPage = adminPage('QuotationsPage')
const BillsPage = adminPage('BillsPage')
const CreditBillsPage = adminPage('CreditBillsPage')
const PurchaseOrdersPage = adminPage('PurchaseOrdersPage')
const ExpensesPage = adminPage('ExpensesPage')
const RolesPage = adminPage('RolesPage')
const ReturnsPage = adminPage('ReturnsPage')
const CashRegisterPage = adminPage('CashRegisterPage')
const StockRequestsPage = adminPage('StockRequestsPage')
const StockTransfersPage = adminPage('StockTransfersPage')
const TrackTransferPage = adminPage('TrackTransferPage')
const BranchTransfersPage = adminPage('BranchTransfersPage')
const BranchTransferForm = adminPage('BranchTransferForm')
const BranchTransferView = adminPage('BranchTransferView')
const BatchesPage = adminPage('BatchesPage')
const CouponsPage = adminPage('CouponsPage')
const DiscountsPage = adminPage('DiscountsPage')
const CouponReportsPage = adminPage('CouponReportsPage')
const BackupPage = adminPage('BackupPage')
const SecurityPage = adminPage('SecurityPage')
const SystemHealthPage = adminPage('SystemHealthPage')
const TransactionReportPage = adminPage('TransactionReportPage')
const AdvancedReportsPage = adminPage('AdvancedReportsPage')

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

function RequireSmartBuyAccess({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuthStore()
  if (isLoading) return <LoadingScreen />
  if (!user) return <Navigate to="/login" replace />
  const permissions = (user.role?.permissions ||
    (user as unknown as Record<string, unknown>).permissions) as Record<string, unknown> || {}
  // Requires an EXPLICIT Smart Buy grant ('all' or 'chits'), never
  // 'customers' — matches the backend's canManage()/canViewCommissions()
  // fix (SmartBuy fix audit, HIGH-2). A role that only has 'customers' can
  // no longer reach the Smart Buy screens, since every underlying IPC call
  // would reject it anyway; showing the pages first and 403-ing on every
  // action was the actual bug.
  if (!permissions.all && !permissions.chits) {
    return <Navigate to={getLandingRoute(user)} replace />
  }
  return <>{children}</>
}

function RequirePermission({ permission, children }: { permission: string; children: React.ReactNode }) {
  const { user, isLoading } = useAuthStore()
  if (isLoading) return <LoadingScreen />
  if (!user) return <Navigate to="/login" replace />
  const permissions = (user.role?.permissions || user.permissions || {}) as Record<string, unknown>
  if (!permissions.all && !permissions[permission]) return <Navigate to={getLandingRoute(user)} replace />
  return <>{children}</>
}

function RequireMainBranch({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuthStore()
  if (isLoading) return <LoadingScreen />
  if (!user) return <Navigate to="/login" replace />
  if (!canManageProcurement(user)) return <Navigate to={getLandingRoute(user)} replace />
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
  const { init, refreshSilently } = useAuthStore()
  const navigate   = useNavigate()
  const [activated, setActivated] = useState<boolean | null>(null)
  const [showCompanyActivation, setShowCompanyActivation] = useState(false)
  const [pendingClearEvent, setPendingClearEvent] = useState<{ locked: boolean; eventId: string | null } | null>(null)
  const [deviceLock, setDeviceLock] = useState<{ locked: boolean; reason: string | null; deviceId: string | null }>({ locked: false, reason: null, deviceId: null })

  const checkDeviceLock = () => {
    if (!window.api?.app?.getDeviceLockStatus) return
    window.api.app.getDeviceLockStatus()
      .then((r: { locked: boolean; reason: string | null; deviceId: string | null }) => setDeviceLock(r))
      .catch(() => undefined)
  }

  // Phase 1 device-authorization work — checked once at boot (only
  // meaningful for an already-activated device; a brand-new install goes
  // through the normal ActivationPage instead) and re-polled periodically,
  // since the actual lock decision is made in the main process
  // (licenseService.ts's /api/brand poll, or a DeviceRevokedError caught by
  // SyncService) and only surfaces here on the next check. Purely reads
  // local electron-store state — no network call from the renderer itself.
  useEffect(() => {
    if (activated !== true) return
    checkDeviceLock()
    const interval = setInterval(checkDeviceLock, 30_000)
    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activated])

  // Multi-device forced lock screen (Issue 30) — checked first thing at
  // boot, ahead of the activation/login sequence, purely from local
  // storage (no network needed), so the lock reappears immediately on
  // every relaunch even if this device is offline.
  useEffect(() => {
    if (!window.api?.app?.getPendingClearEvent) { setPendingClearEvent({ locked: false, eventId: null }); return }
    window.api.app.getPendingClearEvent()
      .then((r: { locked: boolean; eventId: string | null }) => setPendingClearEvent(r))
      .catch(() => setPendingClearEvent({ locked: false, eventId: null }))
  }, [])

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
    // Run once on app boot only. `navigate` from useNavigate() is NOT
    // referentially stable across route changes (react-router memoizes it
    // with the current location pathname in its dependency array), so
    // including it here was re-firing this whole activation/init check on
    // every single navigation — which calls init() again, flips
    // authStore.isLoading true->false, and makes RequireAuth swap
    // <LoadingScreen/> in for <AppLayout/>, unmounting and remounting the
    // entire layout (sidebar, logo, scroll position) on every click.
    // `init` is a stable Zustand action reference and does not need to be
    // listed either.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // auth:whoami (electron/ipc/auth.ts) already re-reads the user fresh from
  // local SQLite on every call — role/permissions/branch/is_active, and logs
  // out (data:null) if the account was disabled/deleted — but until now
  // nothing ever called it again after boot/login. That meant a role,
  // branch, or permission change (or a disable/delete) made on another PC
  // only took effect for an already-open session after a manual re-login,
  // even once local sync had caught up. Re-running init() periodically
  // closes that gap using the existing, already-correct backend logic — no
  // new IPC handler needed. Harmless to call while logged out too (whoami
  // just returns data:null again).
  useEffect(() => {
    if (!activated) return
    const interval = setInterval(() => { refreshSilently() }, 60_000)
    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activated])

  if (pendingClearEvent === null) return <LoadingScreen />
  if (pendingClearEvent.locked) {
    return <DataClearedLockScreen onUnlocked={() => setPendingClearEvent({ locked: false, eventId: null })} />
  }

  if (activated === null) return <LoadingScreen />
  if (!activated) return <ActivationPage onActivated={() => { finishActivation().catch(() => navigate('/login', { replace: true })) }} />

  if (showCompanyActivation) {
    return (
      <ActivationPage
        switchingCompany
        onCancel={() => {
          window.api.app.cancelCompanySwitchAccess?.().catch(() => undefined)
          setShowCompanyActivation(false)
        }}
        onActivated={() => {
          setShowCompanyActivation(false)
          finishActivation().catch(() => navigate('/login', { replace: true }))
        }}
      />
    )
  }

  // Phase 1 device-authorization work — a revoked/deactivated device goes
  // straight here, full-stop. No login screen, no dashboard, no cached
  // business data is reachable while this renders (same "nothing else
  // mounts" guarantee as DataClearedLockScreen above).
  if (deviceLock.locked) {
    return (
      <DeviceLockedScreen
        reason={deviceLock.reason}
        deviceId={deviceLock.deviceId}
        onReactivated={() => setDeviceLock({ locked: false, reason: null, deviceId: null })}
      />
    )
  }

  return (
    <Suspense fallback={<LoadingScreen />}>
    <Routes>
      <Route path="/login" element={<LoginPage onChangeCompany={() => setShowCompanyActivation(true)} />} />
      <Route path="/setup" element={<SetupWizardPage />} />
      <Route element={<RequireAuth><AppLayout /></RequireAuth>}>
        <Route index element={<SessionLanding />} />
        <Route path="/pos" element={<POSPage />} />
        <Route path="/admin" element={<AdminDashboard />} />
        <Route path="/admin/products" element={<ProductsPage />} />
        <Route path="/admin/customers" element={<CustomersPage />} />
        <Route path="/admin/stock-intelligence" element={<RequirePermission permission="inventory"><StockIntelligencePage /></RequirePermission>} />
        <Route path="/admin/stock-count" element={<RequirePermission permission="inventory"><StockCountPage /></RequirePermission>} />
        <Route path="/admin/batches" element={<RequirePermission permission="inventory"><BatchesPage /></RequirePermission>} />
        <Route path="/admin/stock-lookup" element={<RequirePermission permission="inventory"><StockLookupPage /></RequirePermission>} />
        <Route path="/admin/bills" element={<BillsPage />} />
        <Route path="/admin/orders" element={<OrdersPage />} />
        <Route path="/admin/quotations" element={<QuotationsPage />} />
        <Route path="/admin/credit-bills" element={<CreditBillsPage />} />
        <Route path="/admin/purchase-orders" element={<RequireMainBranch><RequireModule module="purchase_orders"><PurchaseOrdersPage /></RequireModule></RequireMainBranch>} />
        <Route path="/admin/expenses" element={<RequireModule module="expenses"><ExpensesPage /></RequireModule>} />
        <Route path="/admin/branches" element={<RequireSuperAdmin><BranchesPage /></RequireSuperAdmin>} />
        <Route path="/admin/branch-inspect" element={<RequireSuperAdmin><BranchInspectPage /></RequireSuperAdmin>} />
        <Route path="/admin/branch-inspect/:branchId" element={<RequireSuperAdmin><BranchInspectDetailPage /></RequireSuperAdmin>} />
        <Route path="/admin/users" element={<UsersPage />} />
        {/* Agent is now a tab inside Employee Management, not its own page
            (Issue 17) — redirect any old bookmark/link instead of 404ing. */}
        <Route path="/admin/agents" element={<Navigate to="/admin/users" replace />} />
        <Route path="/admin/regions" element={<RegionsPage />} />
        <Route path="/admin/zones" element={<ZonesPage />} />
        <Route path="/admin/categories" element={<CategoriesPage />} />
        <Route path="/admin/suppliers" element={<RequireMainBranch><SuppliersPage /></RequireMainBranch>} />
        <Route path="/admin/analytics" element={<AnalyticsPage />} />
        <Route path="/admin/deliveries" element={<RequireModule module="deliveries"><DeliveriesPage /></RequireModule>} />
        <Route path="/admin/installments" element={<RequirePermission permission="customers"><RequireModule module="installments"><InstallmentsPage /></RequireModule></RequirePermission>} />
        <Route path="/admin/chits" element={<RequireSmartBuyAccess><ChitSchemesPage /></RequireSmartBuyAccess>} />
        <Route path="/admin/chits/:id" element={<RequireSmartBuyAccess><ChitSchemeDetailPage /></RequireSmartBuyAccess>} />
        <Route path="/admin/chit-customers" element={<RequireSmartBuyAccess><ChitCustomersPage /></RequireSmartBuyAccess>} />
        <Route path="/admin/smart-buy-agents" element={<RequireSmartBuyAccess><SmartBuyAgentsPage /></RequireSmartBuyAccess>} />
        <Route path="/admin/smart-buy" element={<RequireSmartBuyAccess><SmartBuyDashboardPage /></RequireSmartBuyAccess>} />
        <Route path="/admin/smart-buy-award" element={<RequireSmartBuyAccess><SmartBuyAwardWizardPage /></RequireSmartBuyAccess>} />
        <Route path="/admin/smart-buy-calculator" element={<RequireSmartBuyAccess><SmartBuySchemeCalculatorPage /></RequireSmartBuyAccess>} />
        <Route path="/admin/commission-rules" element={<RequireSmartBuyAccess><CommissionRulesPage /></RequireSmartBuyAccess>} />
        <Route path="/admin/smart-buy-reports" element={<RequireSmartBuyAccess><SmartBuyReportsPage /></RequireSmartBuyAccess>} />
        <Route path="/admin/smart-buy-reminders" element={<RequireSmartBuyAccess><PaymentRemindersPage /></RequireSmartBuyAccess>} />
        <Route path="/admin/smart-buy-transfers" element={<RequireSmartBuyAccess><SmartBuyBankTransfersPage /></RequireSmartBuyAccess>} />
        <Route path="/admin/smart-buy-settings" element={<RequireSuperAdmin><SmartBuySettingsPage /></RequireSuperAdmin>} />
        {/* Was RequireSuperAdmin — the menu link now shows for chits users too
            (AppLayout.tsx), and the backend (chits:templates:list) already
            allows chits∨all to view the catalog; only create/update require
            all, which SchemeMasterPage now gates client-side. */}
        <Route path="/admin/scheme-master" element={<RequireSmartBuyAccess><SchemeMasterPage /></RequireSmartBuyAccess>} />
        <Route path="/admin/audit-logs" element={<AuditLogsPage />} />
        <Route path="/admin/edit-requests" element={<RequireSuperAdmin><EditRequestsPage /></RequireSuperAdmin>} />
        <Route path="/admin/operations" element={<OperationsHubPage />} />
        <Route path="/admin/sync" element={<SyncMonitorPage />} />
        <Route path="/admin/settings" element={<RequireSuperAdmin><SettingsPage /></RequireSuperAdmin>} />
        <Route path="/admin/invoice-designer" element={<RequireSuperAdmin><InvoiceDesignerPage /></RequireSuperAdmin>} />
        <Route path="/admin/roles" element={<RolesPage />} />
        <Route path="/admin/returns" element={<ReturnsPage />} />
        <Route path="/admin/cash-register" element={<CashRegisterPage />} />
        <Route path="/admin/stock-requests" element={<RequirePermission permission="inventory"><StockRequestsPage /></RequirePermission>} />
        <Route path="/admin/stock-transfers" element={<RequirePermission permission="inventory"><RequireModule module="stock_transfers"><StockTransfersPage /></RequireModule></RequirePermission>} />
        <Route path="/admin/track-transfer" element={<RequirePermission permission="inventory"><RequireModule module="stock_transfers"><TrackTransferPage /></RequireModule></RequirePermission>} />
        <Route path="/admin/branch-transfers" element={<RequirePermission permission="inventory"><RequireModule module="stock_transfers"><BranchTransfersPage /></RequireModule></RequirePermission>} />
        <Route path="/admin/branch-transfers/new" element={<RequirePermission permission="inventory"><RequireModule module="stock_transfers"><BranchTransferForm /></RequireModule></RequirePermission>} />
        <Route path="/admin/branch-transfers/:id" element={<RequirePermission permission="inventory"><RequireModule module="stock_transfers"><BranchTransferView /></RequireModule></RequirePermission>} />
        <Route path="/admin/backup"         element={<RequireSuperAdmin><BackupPage /></RequireSuperAdmin>} />
        <Route path="/admin/security"       element={<SecurityPage />} />
        <Route path="/admin/system-health"  element={<RequireSuperAdmin><SystemHealthPage /></RequireSuperAdmin>} />
        <Route path="/admin/transactions"   element={<TransactionReportPage />} />
        <Route path="/admin/reports"        element={<AdvancedReportsPage />} />
        <Route path="/admin/coupons"        element={<CouponsPage />} />
        <Route path="/admin/coupon-reports" element={<CouponReportsPage />} />
        <Route path="/admin/discounts"      element={<RequireSuperAdmin><DiscountsPage /></RequireSuperAdmin>} />
      </Route>
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
    </Suspense>
  )
}
