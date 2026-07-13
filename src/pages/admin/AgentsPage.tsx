import { useEffect, useState } from 'react'
import PageHeader from '@/components/shared/PageHeader'
import Modal from '@/components/shared/Modal'
import StatCard from '@/components/shared/StatCard'
import { Plus, Edit2, Eye, Upload, FileDown, Download, FileSpreadsheet, FileText, Target, DollarSign, Receipt, Search } from 'lucide-react'
import toast from 'react-hot-toast'

type Agent = Record<string, unknown> & { id: string; code: string; name: string; status: string }
type Row = Record<string, unknown>

const money = (v: unknown) => Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function AgentsPage() {
  const [agents, setAgents] = useState<Row[]>([])
  const [branches, setBranches] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [importing, setImporting] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Agent | null>(null)
  const [viewing, setViewing] = useState<Agent | null>(null)
  const [search, setSearch] = useState('')
  const [branchFilter, setBranchFilter] = useState('')

  const load = async (branchId?: string) => {
    setLoading(true)
    const [a, b] = await Promise.all([
      window.api.agents.reportAllSummary({ branchId: branchId || undefined }),
      window.api.admin.branches.list(),
    ])
    if (a.success) setAgents(a.data as Row[])
    if (b.success) setBranches(b.data as Row[])
    setLoading(false)
  }

  useEffect(() => { load(branchFilter) }, [branchFilter]) // eslint-disable-line react-hooks/exhaustive-deps

  const filteredAgents = agents.filter(a => {
    const q = search.trim().toLowerCase()
    if (!q) return true
    return String(a.code || '').toLowerCase().includes(q) || String(a.name || '').toLowerCase().includes(q)
  })

  const downloadTemplate = async () => {
    const res = await window.api.agents.downloadTemplate()
    if (res.success) toast.success('Template saved')
    else if (!res.cancelled) toast.error(res.error || 'Failed to save template')
  }

  const bulkImport = async () => {
    setImporting(true)
    const res = await window.api.agents.importExcel()
    setImporting(false)
    if (res.cancelled) return
    if (!res.success) { toast.error(res.error || 'Import failed'); return }
    if (res.imported) toast.success(`Imported ${res.imported} agent(s)`)
    if (res.skipped) {
      toast.error(`Skipped ${res.skipped} row(s)${res.errors?.[0] ? ` — e.g. ${res.errors[0]}` : ''}`, { duration: 6000 })
    }
    if (res.imported) load(branchFilter)
  }

  const branchName = (id: unknown) => (branches.find(b => b.id === id)?.name as string) || '—'

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader title="Agent Management" subtitle={`${filteredAgents.length} agents`}
        actions={
          <div className="flex gap-2">
            <button onClick={downloadTemplate} className="btn-secondary btn-sm gap-1.5">
              <FileDown size={14} /> Template
            </button>
            <button onClick={bulkImport} disabled={importing} className="btn-secondary btn-sm gap-1.5">
              <Upload size={14} /> {importing ? 'Importing...' : 'Bulk Import'}
            </button>
            <button onClick={() => { setEditing(null); setShowForm(true) }} className="btn-primary btn-sm gap-1.5">
              <Plus size={14} /> Add Agent
            </button>
          </div>
        }
      />

      <div className="flex gap-3 px-6 py-3 border-b border-slate-800 flex-shrink-0">
        <div className="relative flex-1 max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by agent name or code..." className="input pl-8 text-sm" />
        </div>
        <select value={branchFilter} onChange={e => setBranchFilter(e.target.value)} className="input text-sm max-w-xs">
          <option value="">All Branches</option>
          {branches.map(b => <option key={b.id as string} value={b.id as string}>{b.name as string}</option>)}
        </select>
      </div>

      <div className="flex-1 overflow-auto">
        <table className="w-full">
          <thead className="sticky top-0 bg-surface-900 z-10">
            <tr>
              {['Code', 'Name', 'Branch', 'Monthly Target', 'This-Month Sales', 'Commission Earned', 'Target %', 'Status', ''].map(h => (
                <th key={h} className="table-header px-4 py-3 text-left">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} className="text-center py-16 text-slate-500">Loading...</td></tr>
            ) : filteredAgents.length === 0 ? (
              <tr><td colSpan={9} className="text-center py-16 text-slate-500">{agents.length === 0 ? 'No agents yet — add one to get started' : 'No agents match your filters'}</td></tr>
            ) : filteredAgents.map(a => {
              const target = Number(a.monthly_target || 0)
              const pct = target > 0 ? Math.min(999, Math.round((Number(a.sales_total || 0) / target) * 1000) / 10) : 0
              return (
                <tr key={a.id as string} className="table-row">
                  <td className="table-cell font-mono text-xs font-semibold">{a.code as string}</td>
                  <td className="table-cell font-medium">{a.name as string}</td>
                  <td className="table-cell text-slate-400">{branchName(a.branch_id)}</td>
                  <td className="table-cell text-slate-400">Rs.{money(a.monthly_target)}</td>
                  <td className="table-cell">Rs.{money(a.sales_total)}</td>
                  <td className="table-cell text-brand-400 font-semibold">Rs.{money(a.commission_total)}</td>
                  <td className="table-cell">
                    <span className={target > 0 && pct >= 100 ? 'badge-green' : 'badge-blue'}>{target > 0 ? `${pct}%` : '—'}</span>
                  </td>
                  <td className="table-cell">
                    <span className={a.status === 'active' ? 'badge-green' : 'badge-gray'}>{a.status as string}</span>
                  </td>
                  <td className="table-cell">
                    <div className="flex gap-1">
                      <button onClick={() => setViewing(a as Agent)} className="btn-ghost btn-sm p-1.5" title="View Report"><Eye size={13} /></button>
                      <button onClick={() => { setEditing(a as Agent); setShowForm(true) }} className="btn-ghost btn-sm p-1.5" title="Edit"><Edit2 size={13} /></button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {showForm && (
        <AgentForm agent={editing} branches={branches} onClose={() => setShowForm(false)} onSave={() => { setShowForm(false); load() }} />
      )}
      {viewing && (
        <AgentReportModal agent={viewing} onClose={() => setViewing(null)} />
      )}
    </div>
  )
}

function AgentForm({ agent, branches, onClose, onSave }: { agent: Agent | null; branches: Row[]; onClose: () => void; onSave: () => void }) {
  const [form, setForm] = useState({
    code: String(agent?.code || ''),
    name: String(agent?.name || ''),
    phone: String(agent?.phone || ''),
    email: String(agent?.email || ''),
    nic: String(agent?.nic || ''),
    branch_id: String(agent?.branch_id || ''),
    default_commission_pct: Number(agent?.default_commission_pct || 0),
    monthly_target: Number(agent?.monthly_target || 0),
    status: String(agent?.status || 'active'),
    notes: String(agent?.notes || ''),
  })
  const [saving, setSaving] = useState(false)

  const f = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm(p => ({ ...p, [k]: e.target.type === 'number' ? parseFloat(e.target.value) || 0 : e.target.value }))

  const save = async () => {
    if (!form.code.trim()) { toast.error('Agent code is required'); return }
    if (!form.name.trim()) { toast.error('Agent name is required'); return }
    setSaving(true)
    const res = agent
      ? await window.api.agents.update(agent.id, form)
      : await window.api.agents.create(form)
    setSaving(false)
    if (res.success) {
      toast.success(agent ? 'Agent updated' : 'Agent created')
      onSave()
    } else {
      toast.error(String(res.error || 'Save failed'))
    }
  }

  return (
    <Modal title={agent ? 'Edit Agent' : 'Add Agent'} onClose={onClose}
      footer={<><button onClick={onClose} className="btn-secondary">Cancel</button><button onClick={save} disabled={saving} className="btn-primary">{saving ? 'Saving...' : 'Save'}</button></>}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div><label className="block text-xs font-medium text-slate-400 mb-1">Agent Code *</label><input value={form.code} onChange={f('code')} className="input" placeholder="AG-101" /></div>
          <div><label className="block text-xs font-medium text-slate-400 mb-1">Full Name *</label><input value={form.name} onChange={f('name')} className="input" /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="block text-xs font-medium text-slate-400 mb-1">Phone</label><input value={form.phone} onChange={f('phone')} className="input" /></div>
          <div><label className="block text-xs font-medium text-slate-400 mb-1">Email</label><input value={form.email} onChange={f('email')} className="input" /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="block text-xs font-medium text-slate-400 mb-1">NIC</label><input value={form.nic} onChange={f('nic')} className="input" /></div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Branch</label>
            <select value={form.branch_id} onChange={f('branch_id')} className="input">
              <option value="">— Select —</option>
              {branches.map(b => <option key={b.id as string} value={b.id as string}>{b.name as string}</option>)}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="block text-xs font-medium text-slate-400 mb-1">Default Commission %</label><input type="number" value={form.default_commission_pct} onChange={f('default_commission_pct')} className="input" min={0} max={100} step="0.01" /></div>
          <div><label className="block text-xs font-medium text-slate-400 mb-1">Monthly Target (Rs.)</label><input type="number" value={form.monthly_target} onChange={f('monthly_target')} className="input" min={0} /></div>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1">Status</label>
          <select value={form.status} onChange={f('status')} className="input">
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
        <div><label className="block text-xs font-medium text-slate-400 mb-1">Notes</label><textarea value={form.notes} onChange={f('notes')} className="input h-20 resize-none" /></div>
      </div>
    </Modal>
  )
}

function AgentReportModal({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const today = new Date().toISOString().slice(0, 10)
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10)
  const [dateFrom, setDateFrom] = useState(monthStart)
  const [dateTo, setDateTo] = useState(today)
  const [data, setData] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)

  const load = async () => {
    setLoading(true)
    const res = await window.api.agents.report({ agentId: agent.id, dateFrom, dateTo })
    if (res.success) setData(res.data)
    else toast.error(res.error || 'Failed to load report')
    setLoading(false)
  }

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const stats = (data?.stats || {}) as Row
  const target = (data?.targetProgress || {}) as Row
  const products = (data?.products || []) as Row[]
  const invoices = (data?.invoices || []) as Row[]

  const cleanRows = (rows: Row[]) => rows.map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), v ?? ''])))

  const metadata = {
    'Agent': `${agent.code} — ${agent.name}`,
    'Date Range': `${dateFrom} to ${dateTo}`,
    'Generated Time': new Date().toLocaleString(),
  }

  const summary: Array<[string, unknown]> = [
    ['Sales Total', stats.sales_total],
    ['Commission Total', stats.commission_total],
    ['Invoices', stats.invoice_count],
    ['Monthly Target', target.target],
    ['Target Achieved', target.achieved],
  ]

  const exportPdf = async () => {
    setExporting(true)
    await window.api.reports.exportPdf({
      filename: `agent-${agent.code}-${today}`,
      title: `Agent Commission Report — ${agent.name}`,
      metadata, summary,
      sections: [
        { title: 'Products Sold', rows: cleanRows(products) },
        { title: 'Invoices', rows: cleanRows(invoices) },
      ],
    })
    setExporting(false)
  }

  const exportExcel = async () => {
    setExporting(true)
    await window.api.reports.exportExcel({
      filename: `agent-${agent.code}-${today}`,
      sheets: [
        { name: 'Report Info', rows: Object.entries(metadata).map(([Field, Value]) => ({ Field, Value })) },
        { name: 'Products Sold', rows: cleanRows(products) },
        { name: 'Invoices', rows: cleanRows(invoices) },
      ],
    })
    setExporting(false)
  }

  const exportCsv = async () => {
    setExporting(true)
    await window.api.reports.exportCsvRows({
      filename: `agent-${agent.code}-products-${today}`,
      rows: cleanRows(products),
      metadata,
    })
    setExporting(false)
  }

  const pct = Number(target.pct || 0)

  return (
    <Modal title={`${agent.code} — ${agent.name}`} size="xl" onClose={onClose}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs font-semibold text-slate-400">
            From
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="input mt-1" />
          </label>
          <label className="text-xs font-semibold text-slate-400">
            To
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="input mt-1" />
          </label>
          <button onClick={load} disabled={loading} className="btn-primary btn-sm">{loading ? 'Loading...' : 'Refresh'}</button>
          <div className="flex gap-2 ml-auto">
            <button onClick={exportCsv} disabled={exporting} className="btn-secondary btn-sm gap-1.5"><Download size={13} /> CSV</button>
            <button onClick={exportExcel} disabled={exporting} className="btn-secondary btn-sm gap-1.5"><FileSpreadsheet size={13} /> Excel</button>
            <button onClick={exportPdf} disabled={exporting} className="btn-secondary btn-sm gap-1.5"><FileText size={13} /> PDF</button>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <StatCard label="Sales Total" value={`Rs.${money(stats.sales_total)}`} sub={`${stats.invoice_count || 0} invoices`} icon={DollarSign} color="green" />
          <StatCard label="Commission Earned" value={`Rs.${money(stats.commission_total)}`} icon={Receipt} color="blue" />
          <StatCard label="Monthly Target" value={`Rs.${money(target.target)}`} sub={target.target ? `${pct}% achieved this month` : 'No target set'} icon={Target} color="purple" />
        </div>

        {Number(target.target) > 0 && (
          <div className="rounded-lg border p-3" style={{ borderColor: 'var(--border)' }}>
            <div className="flex justify-between text-xs mb-1.5" style={{ color: 'var(--text-3)' }}>
              <span>This month: Rs.{money(target.achieved)} of Rs.{money(target.target)}</span>
              <span>{pct}%</span>
            </div>
            <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-soft)' }}>
              <div className="h-full rounded-full" style={{ width: `${Math.min(100, pct)}%`, background: pct >= 100 ? '#22c55e' : 'var(--brand-primary)' }} />
            </div>
          </div>
        )}

        <div>
          <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--text-1)' }}>Products Sold</h3>
          <div className="overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--border)' }}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: 'var(--bg-soft)' }}>
                  {['Product', 'SKU', 'Qty Sold', 'Sales', 'Commission Allocated'].map(h => (
                    <th key={h} className="px-3 py-2 text-left text-xs font-semibold" style={{ color: 'var(--text-3)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {products.length === 0 ? (
                  <tr><td colSpan={5} className="text-center py-8 text-slate-500">No product sales in this range</td></tr>
                ) : products.map((p, i) => (
                  <tr key={i} className="border-t" style={{ borderColor: 'var(--border)' }}>
                    <td className="px-3 py-2" style={{ color: 'var(--text-1)' }}>{String(p.product_name || '-')}</td>
                    <td className="px-3 py-2 font-mono text-xs" style={{ color: 'var(--text-3)' }}>{String(p.sku || '-')}</td>
                    <td className="px-3 py-2 text-right tabular-nums" style={{ color: 'var(--text-2)' }}>{String(p.qty_sold || 0)}</td>
                    <td className="px-3 py-2 text-right tabular-nums" style={{ color: 'var(--text-2)' }}>Rs.{money(p.line_sales_total)}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold text-brand-400">Rs.{money(p.commission_allocated)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--text-1)' }}>Invoices</h3>
          <div className="overflow-x-auto rounded-lg border max-h-48 overflow-y-auto" style={{ borderColor: 'var(--border)' }}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: 'var(--bg-soft)' }}>
                  {['Bill No', 'Date', 'Branch', 'Customer', 'Total', 'Commission'].map(h => (
                    <th key={h} className="px-3 py-2 text-left text-xs font-semibold" style={{ color: 'var(--text-3)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {invoices.length === 0 ? (
                  <tr><td colSpan={6} className="text-center py-8 text-slate-500">No invoices in this range</td></tr>
                ) : invoices.map((inv, i) => (
                  <tr key={i} className="border-t" style={{ borderColor: 'var(--border)' }}>
                    <td className="px-3 py-2 font-mono text-xs" style={{ color: 'var(--text-1)' }}>{String(inv.invoice_number || '-')}</td>
                    <td className="px-3 py-2 text-xs" style={{ color: 'var(--text-3)' }}>{inv.created_at ? new Date(String(inv.created_at)).toLocaleDateString() : '-'}</td>
                    <td className="px-3 py-2" style={{ color: 'var(--text-2)' }}>{String(inv.branch_name || '-')}</td>
                    <td className="px-3 py-2" style={{ color: 'var(--text-2)' }}>{String(inv.customer_name || 'Walk-in')}</td>
                    <td className="px-3 py-2 text-right tabular-nums" style={{ color: 'var(--text-2)' }}>Rs.{money(inv.total_amount)}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold text-brand-400">Rs.{money(inv.agent_commission_amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Modal>
  )
}
