import { useEffect, useMemo, useState } from 'react'
import PageHeader from '@/components/shared/PageHeader'
import { Download, FileSpreadsheet, FileText, RefreshCw, Trash2, Flame } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuthStore } from '@/store/authStore'
import TypeToConfirmModal from '@/components/shared/TypeToConfirmModal'

type Row = Record<string, unknown>
type Column = { key: string; label: string; money?: boolean }

const money = (v: unknown) => Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

type ReportType = 'scheme_summary' | 'members' | 'contributions' | 'winners' | 'branch_performance' | 'commission_ledger' | 'agent_commission' | 'commission_payouts' | 'delayed_claims' | 'wallet' | 'wallet_usage' | 'transfers'

const REPORT_TYPES: { value: ReportType; label: string }[] = [
  { value: 'scheme_summary', label: 'Scheme Summary (Active / Pending / Completed / Cancelled)' },
  { value: 'members', label: 'Scheme Members (incl. Pending Members)' },
  { value: 'contributions', label: 'Payment Collection' },
  { value: 'winners', label: 'Winner / Winner Product Report' },
  { value: 'delayed_claims', label: 'Delayed Claims' },
  { value: 'wallet', label: 'SmartBuy Wallet' },
  { value: 'wallet_usage', label: 'SmartBuy Wallet Usage' },
  { value: 'transfers', label: 'Winner Transfers' },
  { value: 'commission_ledger', label: 'Commission Ledger' },
  { value: 'agent_commission', label: 'Agent Commission Report' },
  { value: 'commission_payouts', label: 'Commission Payout History' },
  { value: 'branch_performance', label: 'Branch Performance' },
]

const COLUMNS: Record<ReportType, Column[]> = {
  scheme_summary: [
    { key: 'scheme_number', label: 'Scheme #' }, { key: 'name', label: 'Name' },
    { key: 'branch_name', label: 'Branch' }, { key: 'agent_name', label: 'Agent' },
    { key: 'status', label: 'Status' },
    { key: 'members_enrolled', label: 'Members' }, { key: 'min_members', label: 'Min Members' },
    { key: 'cycles_completed', label: 'Cycles' }, { key: 'chit_value', label: 'Chit Value', money: true },
    { key: 'contributions_collected', label: 'Collected', money: true },
    { key: 'commission_accrued', label: 'Commission', money: true },
  ],
  members: [
    { key: 'scheme_name', label: 'Scheme' }, { key: 'scheme_number', label: 'Scheme #' },
    { key: 'branch_name', label: 'Branch' }, { key: 'join_order', label: '#' },
    { key: 'customer_name', label: 'Customer' }, { key: 'customer_phone', label: 'Phone' },
    { key: 'agent_name', label: 'Agent' }, { key: 'status', label: 'Status' },
    { key: 'scheme_status', label: 'Scheme Status' },
    { key: 'contributions_paid', label: 'Paid', money: true },
    { key: 'won_cycle_no', label: 'Won Cycle' }, { key: 'redeemed_product_name', label: 'Redeemed Product' },
  ],
  contributions: [
    { key: 'paid_at', label: 'Date' }, { key: 'scheme_name', label: 'Scheme' },
    { key: 'customer_name', label: 'Customer' }, { key: 'agent_name', label: 'Agent' },
    { key: 'branch_name', label: 'Branch' }, { key: 'amount', label: 'Amount', money: true },
    { key: 'method', label: 'Method' }, { key: 'contribution_type', label: 'Type' },
    { key: 'status', label: 'Status' }, { key: 'commission_amount', label: 'Commission', money: true },
  ],
  winners: [
    { key: 'draw_date', label: 'Winning Date' }, { key: 'cycle_no', label: 'Cycle' },
    { key: 'scheme_name', label: 'Scheme' }, { key: 'branch_name', label: 'Branch' },
    { key: 'method', label: 'Method' }, { key: 'winner_name', label: 'Winner' },
    { key: 'claim_status', label: 'Claim Status' }, { key: 'claimed_at', label: 'Claimed Date' },
    { key: 'original_product_name', label: 'Original Product' }, { key: 'redeemed_product_name', label: 'Given Product' },
    { key: 'redeemed_value', label: 'Product Value', money: true }, { key: 'upgrade_amount', label: 'Upgrade Amount', money: true },
    { key: 'wallet_credit_created', label: 'Wallet Credit', money: true },
    { key: 'redemption_invoice_number', label: 'Invoice #' }, { key: 'conducted_by_name', label: 'Selected By' },
    { key: 'reason', label: 'Reason' },
  ],
  delayed_claims: [
    { key: 'customer_name', label: 'Winner' }, { key: 'customer_phone', label: 'Phone' },
    { key: 'scheme_name', label: 'Scheme' }, { key: 'scheme_number', label: 'Scheme #' }, { key: 'branch_name', label: 'Branch' },
    { key: 'won_date', label: 'Won Date' }, { key: 'claim_due_date', label: 'Claim Due Date' },
    { key: 'claim_status', label: 'Status' }, { key: 'days_overdue', label: 'Days Overdue' },
  ],
  wallet: [
    { key: 'customer_name', label: 'Customer' }, { key: 'customer_phone', label: 'Phone' },
    { key: 'opening_balance', label: 'Opening Balance', money: true },
    { key: 'total_credited', label: 'Credit Created', money: true }, { key: 'total_used', label: 'Credit Used', money: true },
    { key: 'balance', label: 'Current Balance', money: true },
  ],
  wallet_usage: [
    { key: 'customer_name', label: 'Customer' }, { key: 'invoice_number', label: 'Invoice' },
    { key: 'amount', label: 'Amount Used', money: true }, { key: 'created_at', label: 'Date' },
    { key: 'staff_name', label: 'Staff' }, { key: 'source', label: 'Source' },
  ],
  transfers: [
    { key: 'created_at', label: 'Date' }, { key: 'scheme_name', label: 'Scheme' }, { key: 'scheme_number', label: 'Scheme #' },
    { key: 'original_customer_name', label: 'Original Winner' }, { key: 'new_customer_name', label: 'Recipient' },
    { key: 'reason', label: 'Reason' }, { key: 'approved_by_name', label: 'Approved By' },
  ],
  commission_ledger: [
    { key: 'created_at', label: 'Date' }, { key: 'scheme_name', label: 'Scheme' },
    { key: 'rule_name', label: 'Rule' }, { key: 'customer_name', label: 'Customer' },
    { key: 'registration_agent_name', label: 'Registration Agent' }, { key: 'registration_commission', label: 'Reg. Commission', money: true },
    { key: 'sales_agent_name', label: 'Sales Agent' }, { key: 'sales_commission', label: 'Sales Commission', money: true },
    { key: 'total_commission', label: 'Total', money: true }, { key: 'status', label: 'Status' },
  ],
  agent_commission: [
    { key: 'code', label: 'Code' }, { key: 'name', label: 'Agent' }, { key: 'branch_name', label: 'Branch' },
    { key: 'members_assigned', label: 'Members' }, { key: 'total_collected', label: 'Total Collected', money: true },
    { key: 'collected_this_month', label: 'This Month', money: true },
    { key: 'commission_earned', label: 'Commission Earned', money: true },
    { key: 'commission_pending', label: 'Pending Approval', money: true },
    { key: 'cash_balance', label: 'Cash Balance', money: true },
  ],
  commission_payouts: [
    { key: 'paid_at', label: 'Date' }, { key: 'agent_name', label: 'Agent' }, { key: 'agent_code', label: 'Code' },
    { key: 'amount', label: 'Amount Paid', money: true }, { key: 'method', label: 'Method' },
    { key: 'reference', label: 'Reference' }, { key: 'entries_count', label: 'Entries Covered' },
    { key: 'paid_by_name', label: 'Paid By' },
  ],
  branch_performance: [
    { key: 'branch_name', label: 'Branch' }, { key: 'manager_name', label: 'SmartBuy Manager' },
    { key: 'scheme_count', label: 'Schemes' },
    { key: 'active_scheme_count', label: 'Active Schemes' }, { key: 'members_enrolled', label: 'Members' },
    { key: 'customers', label: 'Customers' },
    { key: 'contributions_collected', label: 'Collected', money: true },
    { key: 'commission_accrued', label: 'Commission', money: true }, { key: 'draws_conducted', label: 'Draws' },
  ],
}

export default function SmartBuyReportsPage() {
  const { user } = useAuthStore()
  const isSuperAdmin = Boolean(((user?.role as unknown as Row)?.permissions as Row)?.all)
  const [reportType, setReportType] = useState<ReportType>('scheme_summary')
  const [branches, setBranches] = useState<Row[]>([])
  const [schemes, setSchemes] = useState<Row[]>([])
  const [agents, setAgents] = useState<Row[]>([])
  const [branchId, setBranchId] = useState('')
  const [schemeId, setSchemeId] = useState('')
  const [agentId, setAgentId] = useState('')
  const [status, setStatus] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [purging, setPurging] = useState<Row | null>(null)

  useEffect(() => {
    Promise.all([window.api.admin.branches.list(), window.api.chits.list(), window.api.agents.list({})]).then(([b, s, a]) => {
      if (b.success) setBranches(b.data as Row[])
      if (s.success) setSchemes(s.data as Row[])
      if (a.success) setAgents(a.data as Row[])
    }).catch(() => {})
  }, [])

  const load = async () => {
    setLoading(true)
    try {
      const branchFilter = branchId || undefined
      const schemeFilter = schemeId || undefined
      const agentFilter = agentId || undefined
      const statusFilter = status || undefined
      const from = dateFrom || undefined
      const to = dateTo || undefined
      let res: { success: boolean; data?: Row[]; error?: string }
      switch (reportType) {
        case 'scheme_summary':
          res = await window.api.chits.reports({ branchId: branchFilter, schemeId: schemeFilter, status: statusFilter, dateFrom: from, dateTo: to })
          break
        case 'members':
          res = await window.api.chits.reportsMembers({ branchId: branchFilter, schemeId: schemeFilter, status: statusFilter })
          break
        case 'contributions':
          res = await window.api.chits.reportsContributions({ branchId: branchFilter, schemeId: schemeFilter, agentId: agentFilter, dateFrom: from, dateTo: to })
          break
        case 'winners':
          res = await window.api.chits.reportsWinners({ branchId: branchFilter, schemeId: schemeFilter, dateFrom: from, dateTo: to })
          break
        case 'delayed_claims':
          res = await window.api.chits.claims.delayed({ branchId: branchFilter })
          break
        case 'wallet':
          res = await window.api.chits.wallet.list({ branchId: branchFilter })
          break
        case 'wallet_usage':
          res = await window.api.chits.wallet.usage({ branchId: branchFilter })
          break
        case 'transfers':
          res = await window.api.chits.transfers.list({ branchId: branchFilter })
          break
        case 'commission_ledger':
          res = await window.api.commissions.ledger.list({ branchId: branchFilter, schemeId: schemeFilter, agentId: agentFilter, status: statusFilter, dateFrom: from, dateTo: to })
          break
        case 'agent_commission':
          res = await window.api.chits.agents.report({ branchId: branchFilter })
          break
        case 'commission_payouts':
          res = await window.api.commissions.payouts.list({ branchId: branchFilter, agentId: agentFilter })
          break
        case 'branch_performance':
          res = await window.api.chits.reportsBranchPerformance()
          break
      }
      if (res.success) setRows(res.data || [])
      else toast.error(res.error || 'Failed to load report')
    } catch (err) {
      toast.error((err as Error)?.message || 'Failed to load report')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [reportType]) // eslint-disable-line react-hooks/exhaustive-deps

  const deleteScheme = async (r: Row) => {
    const hasActivity = Number(r.members_enrolled || 0) > 0 || Number(r.contributions_collected || 0) > 0
    const confirmMsg = hasActivity
      ? `"${r.name}" has enrolled members / collected contributions — it will be marked Cancelled (not removed) so history is preserved. Continue?`
      : `Permanently delete "${r.name}"? This scheme has no members or contributions, so it can be removed outright.`
    if (!confirm(confirmMsg)) return
    try {
      const res = await window.api.chits.delete(r.id as string)
      if (res.success) { toast.success(res.data?.hardDeleted ? 'Scheme deleted' : 'Scheme cancelled'); load() }
      else toast.error(String(res.error || 'Failed to delete scheme'))
    } catch (err) {
      toast.error((err as Error)?.message || 'Failed to delete scheme')
    }
  }

  const purgeScheme = async () => {
    if (!purging) return
    try {
      const res = await window.api.chits.purgeCancelled(purging.id as string)
      if (res.success) { toast.success('Scheme permanently purged'); setPurging(null); load() }
      else toast.error(String(res.error || 'Failed to purge scheme'))
    } catch (err) {
      toast.error((err as Error)?.message || 'Failed to purge scheme')
    }
  }

  const columns = COLUMNS[reportType]
  const reportLabel = REPORT_TYPES.find(r => r.value === reportType)?.label || reportType
  const canDeleteScheme = reportType === 'scheme_summary' && isSuperAdmin

  const formattedRows = useMemo(() => rows.map(r => {
    const out: Record<string, string | number> = {}
    for (const col of columns) {
      const v = r[col.key]
      out[col.label] = col.money ? `Rs.${money(v)}` : (v === null || v === undefined ? '—' : (v as string | number))
    }
    return out
  }), [rows, columns])

  const filename = `smartbuy-${reportType}-${new Date().toISOString().slice(0, 10)}`
  const metadata = {
    'Report': reportLabel,
    'Branch': branches.find(b => b.id === branchId)?.name as string || 'All Branches',
    'Date Range': dateFrom || dateTo ? `${dateFrom || '—'} to ${dateTo || '—'}` : 'All time',
    'Generated': new Date().toLocaleString(),
  }

  const exportPdf = async () => {
    setExporting(true)
    try {
      const res = await window.api.reports.exportPdf({
        filename, title: reportLabel, metadata,
        sections: [{ title: reportLabel, rows: formattedRows }],
      })
      if (res && !res.success && !res.cancelled) toast.error(res.error || 'PDF export failed')
    } catch (err) {
      toast.error((err as Error)?.message || 'PDF export failed')
    } finally {
      setExporting(false)
    }
  }

  const exportExcel = async () => {
    setExporting(true)
    try {
      const res = await window.api.reports.exportExcel({
        filename,
        sheets: [
          { name: 'Report Info', rows: Object.entries(metadata).map(([Field, Value]) => ({ Field, Value })) },
          { name: reportLabel.slice(0, 31), rows: formattedRows },
        ],
      })
      if (res && !res.success && !res.cancelled) toast.error(res.error || 'Excel export failed')
    } catch (err) {
      toast.error((err as Error)?.message || 'Excel export failed')
    } finally {
      setExporting(false)
    }
  }

  const exportCsv = async () => {
    setExporting(true)
    try {
      const res = await window.api.reports.exportCsvRows({ filename, rows: formattedRows, metadata })
      if (res && !res.success && !res.cancelled) toast.error(res.error || 'CSV export failed')
    } catch (err) {
      toast.error((err as Error)?.message || 'CSV export failed')
    } finally {
      setExporting(false)
    }
  }

  const needsScheme = ['scheme_summary', 'members', 'contributions', 'winners', 'commission_ledger'].includes(reportType)
  const needsAgent = ['contributions', 'commission_ledger', 'commission_payouts'].includes(reportType)
  const needsStatus = ['scheme_summary', 'members', 'commission_ledger'].includes(reportType)
  const needsDate = ['scheme_summary', 'contributions', 'winners', 'commission_ledger'].includes(reportType)
  const needsBranch = reportType !== 'branch_performance'

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader title="Smart Buy Reports" subtitle={`${rows.length} row(s) — ${reportLabel}`}
        actions={
          <div className="flex gap-2">
            <button onClick={exportCsv} disabled={exporting || rows.length === 0} className="btn-secondary btn-sm gap-1.5"><Download size={13} /> CSV</button>
            <button onClick={exportExcel} disabled={exporting || rows.length === 0} className="btn-secondary btn-sm gap-1.5"><FileSpreadsheet size={13} /> Excel</button>
            <button onClick={exportPdf} disabled={exporting || rows.length === 0} className="btn-secondary btn-sm gap-1.5"><FileText size={13} /> PDF / Print</button>
          </div>
        }
      />

      <div className="flex flex-wrap items-end gap-3 px-6 py-3 border-b flex-shrink-0" style={{ borderColor: 'var(--border)' }}>
        <label className="text-xs font-semibold text-slate-400">
          Report Type
          <select value={reportType} onChange={e => setReportType(e.target.value as ReportType)} className="input mt-1">
            {REPORT_TYPES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </label>
        {needsBranch && (
          <label className="text-xs font-semibold text-slate-400">
            Branch
            <select value={branchId} onChange={e => setBranchId(e.target.value)} className="input mt-1">
              <option value="">All Branches</option>
              {branches.map(b => <option key={b.id as string} value={b.id as string}>{b.name as string}</option>)}
            </select>
          </label>
        )}
        {needsScheme && (
          <label className="text-xs font-semibold text-slate-400">
            Scheme
            <select value={schemeId} onChange={e => setSchemeId(e.target.value)} className="input mt-1">
              <option value="">All Schemes</option>
              {schemes.map(s => <option key={s.id as string} value={s.id as string}>{s.scheme_number as string} — {s.name as string} ({s.branch_name as string})</option>)}
            </select>
          </label>
        )}
        {needsAgent && (
          <label className="text-xs font-semibold text-slate-400">
            Agent
            <select value={agentId} onChange={e => setAgentId(e.target.value)} className="input mt-1">
              <option value="">All Agents</option>
              {agents.map(a => <option key={a.id as string} value={a.id as string}>{a.name as string}</option>)}
            </select>
          </label>
        )}
        {needsStatus && (
          <label className="text-xs font-semibold text-slate-400">
            Status
            <select value={status} onChange={e => setStatus(e.target.value)} className="input mt-1">
              <option value="">All</option>
              {reportType === 'commission_ledger' ? (
                <>
                  <option value="pending_manager_approval">Pending Manager Approval</option>
                  <option value="pending_admin_approval">Pending Admin Approval</option>
                  <option value="approved_for_payment">Approved for Payment</option>
                  <option value="paid">Paid</option>
                  <option value="rejected">Rejected</option>
                  <option value="cancelled">Cancelled</option>
                </>
              ) : reportType === 'members' ? (
                <>
                  <option value="active">Active</option>
                  <option value="redeemed">Redeemed</option>
                  <option value="withdrawn">Withdrawn</option>
                </>
              ) : (
                <>
                  <option value="pending">Pending</option>
                  <option value="active">Active</option>
                  <option value="completed">Completed</option>
                  <option value="cancelled">Cancelled</option>
                </>
              )}
            </select>
          </label>
        )}
        {needsDate && (
          <>
            <label className="text-xs font-semibold text-slate-400">From<input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="input mt-1" /></label>
            <label className="text-xs font-semibold text-slate-400">To<input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="input mt-1" /></label>
          </>
        )}
        <button onClick={load} disabled={loading} className="btn-primary btn-sm gap-1.5"><RefreshCw size={13} /> {loading ? 'Loading...' : 'Run Report'}</button>
      </div>

      <div className="flex-1 overflow-auto p-6">
        <div className="overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--border)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: 'var(--bg-soft)' }}>
                {columns.map(c => <th key={c.key} className="px-3 py-2 text-left text-xs font-semibold whitespace-nowrap" style={{ color: 'var(--text-3)' }}>{c.label}</th>)}
                {canDeleteScheme && <th className="px-3 py-2 text-left text-xs font-semibold whitespace-nowrap" style={{ color: 'var(--text-3)' }} />}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={columns.length + (canDeleteScheme ? 1 : 0)} className="text-center py-16" style={{ color: 'var(--text-3)' }}>Loading...</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={columns.length + (canDeleteScheme ? 1 : 0)} className="text-center py-16" style={{ color: 'var(--text-3)' }}>No data for the selected filters</td></tr>
              ) : rows.map((r, i) => (
                <tr key={i} className="border-t" style={{ borderColor: 'var(--border)' }}>
                  {columns.map(c => (
                    <td key={c.key} className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--text-2)' }}>
                      {c.money ? `Rs.${money(r[c.key])}` : (r[c.key] === null || r[c.key] === undefined || r[c.key] === '' ? '—' : String(r[c.key]))}
                    </td>
                  ))}
                  {canDeleteScheme && (
                    <td className="px-3 py-2 whitespace-nowrap">
                      {r.status !== 'cancelled' && r.status !== 'completed' && (
                        <button onClick={() => deleteScheme(r)} className="btn-ghost btn-sm p-1.5 hover:text-red-500" title="Delete / cancel scheme">
                          <Trash2 size={13} />
                        </button>
                      )}
                      {r.status === 'cancelled' && (
                        <button onClick={() => setPurging(r)} className="btn-ghost btn-sm p-1.5 hover:text-red-600" title="Permanently purge this cancelled scheme">
                          <Flame size={13} />
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {purging && (
        <TypeToConfirmModal
          title="Permanently Purge Scheme"
          message={`This deletes "${purging.name}" (${purging.scheme_number}) and every member, contribution, draw, and commission record tied to it — for good. This cannot be undone. Only possible because no product was ever actually redeemed through this scheme.`}
          confirmText={String(purging.scheme_number)}
          actionLabel="Purge Permanently"
          onClose={() => setPurging(null)}
          onConfirm={purgeScheme}
        />
      )}
    </div>
  )
}
