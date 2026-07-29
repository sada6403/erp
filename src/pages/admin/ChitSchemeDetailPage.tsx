import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import Modal from '@/components/shared/Modal'
import StatCard from '@/components/shared/StatCard'
import ProductSearchSelect from '@/components/shared/ProductSearchSelect'
import MemberPaymentHistoryModal from '@/components/shared/MemberPaymentHistoryModal'
import { ArrowLeft, Plus, Upload, FileDown, Users, Coins, Gift, Shuffle, Pencil, Package, Eye } from 'lucide-react'
import toast from 'react-hot-toast'

type Row = Record<string, unknown>

const money = (v: unknown) => Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function ChitSchemeDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [scheme, setScheme] = useState<Row | null>(null)
  const [members, setMembers] = useState<Row[]>([])
  const [draws, setDraws] = useState<Row[]>([])
  const [summary, setSummary] = useState<Row>({})
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'members' | 'draws'>('members')
  const [importing, setImporting] = useState(false)
  const [showAddMember, setShowAddMember] = useState(false)
  const [showRegisterHistorical, setShowRegisterHistorical] = useState(false)
  const [showDraw, setShowDraw] = useState(false)
  const [payingMember, setPayingMember] = useState<Row | null>(null)
  const [redeemingMember, setRedeemingMember] = useState<Row | null>(null)
  const [redemptionMember, setRedemptionMember] = useState<Row | null>(null)
  const [historyMember, setHistoryMember] = useState<Row | null>(null)
  const [showEdit, setShowEdit] = useState(false)

  const load = async () => {
    if (!id) return
    setLoading(true)
    try {
      const res = await window.api.chits.get(id)
      if (res.success) {
        setScheme(res.data.scheme)
        setMembers(res.data.members)
        setDraws(res.data.draws)
        setSummary(res.data.contributionSummary)
      } else {
        toast.error(res.error || 'Failed to load Smart Buy scheme')
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to load Smart Buy scheme')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  const downloadTemplate = async () => {
    try {
      const res = await window.api.chits.members.downloadTemplate()
      if (res.success) toast.success('Template saved')
      else if (!res.cancelled) toast.error(res.error || 'Failed to save template')
    } catch (err: any) {
      toast.error(err.message || 'Failed to save template')
    }
  }

  const bulkImport = async () => {
    if (!id) return
    setImporting(true)
    try {
      const res = await window.api.chits.members.importExcel(id)
      if (res.cancelled) return
      if (!res.success) { toast.error(res.error || 'Import failed'); return }
      if (res.imported) toast.success(`Imported ${res.imported} member(s)`)
      if (res.skipped) toast.error(`Skipped ${res.skipped} row(s)${res.errors?.[0] ? ` — e.g. ${res.errors[0]}` : ''}`, { duration: 6000 })
      if (res.imported) load()
    } catch (err: any) {
      toast.error(err.message || 'Import failed')
    } finally {
      setImporting(false)
    }
  }

  const removeMember = async (memberId: string) => {
    try {
      const res = await window.api.chits.members.remove(memberId)
      if (res.success) { toast.success('Member removed'); load() }
      else toast.error(res.error || 'Could not remove member')
    } catch (err: any) {
      toast.error(err.message || 'Could not remove member')
    }
  }

  if (loading || !scheme) {
    return <div className="flex items-center justify-center h-full text-slate-500">Loading...</div>
  }

  const nextCycle = draws.length + 1
  const isFinalCycle = nextCycle >= Number(scheme.cycle_count)
  const membersEnrolled = members.filter(m => m.status !== 'withdrawn').length

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-3 px-6 py-4 flex-shrink-0" style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-elevated)' }}>
        <button onClick={() => navigate('/admin/chits')} className="btn-ghost btn-sm p-1.5"><ArrowLeft size={16} /></button>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-bold truncate" style={{ color: 'var(--text-1)' }}>{scheme.name as string}</h1>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>{scheme.scheme_number as string} · {(scheme.product_name as string) || 'No product'} · {(scheme.agent_name as string) || 'No agent'}</p>
        </div>
        <button onClick={() => setShowEdit(true)} className="btn-ghost btn-sm p-1.5" title="Edit scheme name / agent / notes">
          <Pencil size={14} />
        </button>
        <span className={scheme.status === 'active' ? 'badge-green' : 'badge-gray'}>{scheme.status as string}</span>
      </div>

      {showEdit && (
        <EditSchemeModal scheme={scheme} onClose={() => setShowEdit(false)} onSaved={() => { setShowEdit(false); load() }} />
      )}

      <div className="grid grid-cols-4 gap-3 px-6 py-4 flex-shrink-0">
        <StatCard label="Members" value={`${membersEnrolled} / ${scheme.member_count}`} icon={Users} color="brand" />
        <StatCard label="Cycles Drawn" value={`${draws.length} / ${scheme.cycle_count}`} icon={Shuffle} color="blue" />
        <StatCard label="Contributions Collected" value={`Rs.${money(summary.total_collected)}`} icon={Coins} color="green" />
        <StatCard label="Agent Commission" value={`Rs.${money(summary.total_commission)}`} icon={Gift} color="purple" />
      </div>

      <div className="flex items-center justify-between px-6 pb-3 flex-shrink-0">
        <div className="flex gap-1">
          <button onClick={() => setTab('members')} className={tab === 'members' ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'}>Members</button>
          <button onClick={() => setTab('draws')} className={tab === 'draws' ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'}>Draw History</button>
        </div>
        <div className="flex gap-2">
          {tab === 'members' && (
            <>
              <button onClick={downloadTemplate} className="btn-secondary btn-sm gap-1.5"><FileDown size={14} /> Template</button>
              <button onClick={bulkImport} disabled={importing} className="btn-secondary btn-sm gap-1.5"><Upload size={14} /> {importing ? 'Importing...' : 'Bulk Import'}</button>
              <button onClick={() => setShowRegisterHistorical(true)} className="btn-secondary btn-sm gap-1.5" title="Digitize a physical ledger/invoice record"><FileDown size={14} /> Register from Paper</button>
              <button onClick={() => setShowAddMember(true)} className="btn-secondary btn-sm gap-1.5"><Plus size={14} /> Add Member</button>
            </>
          )}
          {scheme.status === 'active' && (
            <button onClick={() => setShowDraw(true)} className="btn-primary btn-sm gap-1.5"><Shuffle size={14} /> Conduct Draw (Cycle {nextCycle})</button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto px-6 pb-6">
        {tab === 'members' ? (
          <table className="w-full">
            <thead className="sticky top-0 bg-surface-900 z-10">
              <tr>
                {['#', 'Customer', 'Phone', 'Agent', 'Early?', 'Contributions Paid', 'Status', 'Won Cycle', 'Redeemed Product', ''].map(h => (
                  <th key={h} className="table-header px-4 py-3 text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {members.length === 0 ? (
                <tr><td colSpan={10} className="text-center py-16 text-slate-500">No members enrolled yet</td></tr>
              ) : members.map(m => (
                <tr key={m.id as string} className="table-row">
                  <td className="table-cell text-slate-400">{m.join_order as number}</td>
                  <td className="table-cell font-medium">{(m.customer_name as string) || '—'}</td>
                  <td className="table-cell text-slate-400">{(m.customer_phone as string) || '—'}</td>
                  <td className="table-cell text-slate-400">{(m.member_agent_name as string) || (scheme.agent_name as string) || '—'}</td>
                  <td className="table-cell">{m.is_early_redemption ? <span className="badge-blue">Yes</span> : '—'}</td>
                  <td className="table-cell">Rs.{money(m.contributions_paid)}</td>
                  <td className="table-cell">
                    <span className={m.status === 'redeemed' ? 'badge-green' : m.status === 'withdrawn' ? 'badge-gray' : 'badge-blue'}>{m.status as string}</span>
                  </td>
                  <td className="table-cell text-slate-400">{(m.won_cycle_no as number) || '—'}</td>
                  <td className="table-cell text-xs text-slate-400">
                    {m.redeemed_product_name ? `${m.redeemed_product_name as string} × ${m.redeemed_qty as number}` : '—'}
                  </td>
                  <td className="table-cell">
                    <div className="flex gap-1">
                      {m.status === 'active' && (
                        <button onClick={() => setPayingMember(m)} className="btn-ghost btn-sm p-1.5" title="Record Contribution"><Coins size={13} /></button>
                      )}
                      {m.status === 'active' && Boolean(m.is_early_redemption) && (
                        <button onClick={() => setRedeemingMember(m)} className="btn-ghost btn-sm p-1.5" title="Early Redeem"><Gift size={13} /></button>
                      )}
                      {m.status === 'redeemed' && (
                        <button onClick={() => setRedemptionMember(m)} className="btn-ghost btn-sm p-1.5" title="Record Redemption Product"><Package size={13} /></button>
                      )}
                      <button onClick={() => setHistoryMember(m)} className="btn-ghost btn-sm p-1.5" title="Payment History"><Eye size={13} /></button>
                      {m.status === 'active' && (
                        <button onClick={() => removeMember(m.id as string)} className="btn-ghost btn-sm p-1.5 text-red-400" title="Withdraw">✕</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="w-full">
            <thead className="sticky top-0 bg-surface-900 z-10">
              <tr>
                {['Cycle', 'Date', 'Winner', 'Method', 'Settled Count', 'Eligible Count', 'Product Chosen'].map(h => (
                  <th key={h} className="table-header px-4 py-3 text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {draws.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-16 text-slate-500">No draws conducted yet</td></tr>
              ) : draws.map(d => {
                const winnerMember = members.find(m => m.id === d.winner_member_id)
                return (
                <tr key={d.id as string} className="table-row">
                  <td className="table-cell font-semibold">{d.cycle_no as number}</td>
                  <td className="table-cell text-slate-400">{d.draw_date ? new Date(String(d.draw_date)).toLocaleDateString() : '—'}</td>
                  <td className="table-cell">{d.method === 'final_batch' ? `${d.settled_count} members (final settlement)` : (d.winner_name as string) || '—'}</td>
                  <td className="table-cell"><span className={d.method === 'final_batch' ? 'badge-blue' : 'badge-green'}>{d.method as string}</span></td>
                  <td className="table-cell">{d.settled_count as number}</td>
                  <td className="table-cell text-slate-400">{d.eligible_count as number}</td>
                  <td className="table-cell text-xs text-slate-400">
                    {winnerMember?.redeemed_product_name ? `${winnerMember.redeemed_product_name as string} × ${winnerMember.redeemed_qty as number}` : '—'}
                  </td>
                </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {showAddMember && (
        <AddMemberModal schemeId={id!} defaultAgentId={(scheme.agent_id as string) || ''} schemeBranchId={(scheme.branch_id as string) || ''}
          onClose={() => setShowAddMember(false)} onSave={() => { setShowAddMember(false); load() }} />
      )}
      {showRegisterHistorical && (
        <RegisterHistoricalMemberModal schemeId={id!} defaultAgentId={(scheme.agent_id as string) || ''}
          onClose={() => setShowRegisterHistorical(false)} onSave={() => { setShowRegisterHistorical(false); load() }} />
      )}
      {showDraw && (
        <ConductDrawModal schemeId={id!} cycleNo={nextCycle} isFinalCycle={isFinalCycle}
          onClose={() => setShowDraw(false)} onSave={() => { setShowDraw(false); load() }} />
      )}
      {payingMember && (
        <RecordContributionModal member={payingMember} schemeId={id!}
          onClose={() => setPayingMember(null)} onSave={() => { setPayingMember(null); load() }} />
      )}
      {redeemingMember && (
        <EarlyRedeemModal member={redeemingMember} minAmount={Number(scheme.early_redemption_amount)}
          onClose={() => setRedeemingMember(null)} onSave={() => { setRedeemingMember(null); load() }} />
      )}
      {redemptionMember && (
        <RecordRedemptionModal member={redemptionMember}
          onClose={() => setRedemptionMember(null)} onSave={() => { setRedemptionMember(null); load() }} />
      )}
      {historyMember && (
        <MemberPaymentHistoryModal memberId={historyMember.id as string} onClose={() => setHistoryMember(null)} />
      )}
    </div>
  )
}

function AddMemberModal({ schemeId, defaultAgentId, onClose, onSave }: {
  schemeId: string; defaultAgentId: string; schemeBranchId: string; onClose: () => void; onSave: () => void
}) {
  const [form, setForm] = useState({ customer_name: '', customer_phone: '', customer_email: '', customer_nic: '', customer_address: '' })
  const [saving, setSaving] = useState(false)
  const f = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setForm(p => ({ ...p, [k]: e.target.value }))

  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState<Row[]>([])
  const [searching, setSearching] = useState(false)
  const [selectedCustomer, setSelectedCustomer] = useState<Row | null>(null)

  const [agents, setAgents] = useState<Row[]>([])
  const [agentId, setAgentId] = useState(defaultAgentId || '')

  useEffect(() => {
    window.api.agents.list({}).then((res: { success: boolean; data?: Row[] }) => {
      if (res.success) setAgents(res.data || [])
    }).catch(() => {})
  }, [])

  useEffect(() => {
    if (!query.trim() || selectedCustomer) { setMatches([]); return }
    const t = setTimeout(async () => {
      setSearching(true)
      try {
        const res = await window.api.customers.search(query.trim())
        if (res.success) setMatches(res.data as Row[])
      } catch { /* ignore */ } finally { setSearching(false) }
    }, 300)
    return () => clearTimeout(t)
  }, [query, selectedCustomer])

  const save = async () => {
    if (!selectedCustomer) {
      if (!form.customer_name.trim()) { toast.error('Customer name is required'); return }
      if (!form.customer_phone.trim()) { toast.error('Phone is required'); return }
    }
    setSaving(true)
    const payload = selectedCustomer
      ? { customer_id: selectedCustomer.id, agent_id: agentId || undefined }
      : { ...form, agent_id: agentId || undefined }
    const res = await window.api.chits.members.add(schemeId, payload)
    setSaving(false)
    if (res.success) { toast.success('Member added'); onSave() }
    else toast.error(String(res.error || 'Failed to add member'))
  }

  return (
    <Modal title="Add Smart Buy Member" onClose={onClose}
      footer={<><button onClick={onClose} className="btn-secondary">Cancel</button><button onClick={save} disabled={saving} className="btn-primary">{saving ? 'Saving...' : 'Add Member'}</button></>}>
      <div className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1">Find existing customer (optional)</label>
          {selectedCustomer ? (
            <div className="flex items-center justify-between input">
              <span className="text-sm">{(selectedCustomer.name as string)} — {(selectedCustomer.phone as string) || 'no phone'}</span>
              <button type="button" onClick={() => { setSelectedCustomer(null); setQuery('') }} className="text-xs text-brand-400 hover:underline">Change</button>
            </div>
          ) : (
            <>
              <input value={query} onChange={e => setQuery(e.target.value)} className="input" placeholder="Search by name, phone, NIC..." />
              {searching && <p className="text-xs text-slate-500 mt-1">Searching...</p>}
              {matches.length > 0 && (
                <div className="mt-1 rounded-lg border overflow-hidden max-h-40 overflow-y-auto" style={{ borderColor: 'var(--border)' }}>
                  {matches.map(m => (
                    <button key={m.id as string} type="button"
                      onClick={() => { setSelectedCustomer(m); setMatches([]) }}
                      className="w-full flex items-center justify-between px-3 py-2 hover:bg-[var(--bg-soft)] text-left text-sm">
                      <span>{m.name as string}</span>
                      <span className="text-xs text-slate-500 font-mono">{(m.phone as string) || '—'}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
        {!selectedCustomer && (
          <>
            <p className="text-xs text-slate-500">No match? Enter new customer details below.</p>
            <div><label className="block text-xs font-medium text-slate-400 mb-1">Customer Name *</label><input value={form.customer_name} onChange={f('customer_name')} className="input" /></div>
            <div><label className="block text-xs font-medium text-slate-400 mb-1">Phone *</label><input value={form.customer_phone} onChange={f('customer_phone')} className="input" /></div>
            <div><label className="block text-xs font-medium text-slate-400 mb-1">Email</label><input value={form.customer_email} onChange={f('customer_email')} className="input" /></div>
            <div><label className="block text-xs font-medium text-slate-400 mb-1">NIC</label><input value={form.customer_nic} onChange={f('customer_nic')} className="input" /></div>
            <div><label className="block text-xs font-medium text-slate-400 mb-1">Address</label><input value={form.customer_address} onChange={f('customer_address')} className="input" /></div>
          </>
        )}
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1">Agent (optional — defaults to scheme's agent)</label>
          <select value={agentId} onChange={e => setAgentId(e.target.value)} className="input">
            <option value="">— Use scheme default —</option>
            {agents.map(a => <option key={a.id as string} value={a.id as string}>{(a.code as string)} — {(a.name as string)}</option>)}
          </select>
        </div>
      </div>
    </Modal>
  )
}

// Digitizes a physical paper ledger record (collection book / invoice
// booklet) in one step: enroll + record the initial (possibly backdated)
// payment together, instead of two separate actions with no way to backdate.
function RegisterHistoricalMemberModal({ schemeId, defaultAgentId, onClose, onSave }: {
  schemeId: string; defaultAgentId: string; onClose: () => void; onSave: () => void
}) {
  const [form, setForm] = useState({ customer_name: '', customer_phone: '', customer_email: '', customer_nic: '', customer_address: '' })
  const [paperReferenceCode, setPaperReferenceCode] = useState('')
  const [saving, setSaving] = useState(false)

  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState<Row[]>([])
  const [searching, setSearching] = useState(false)
  const [selectedCustomer, setSelectedCustomer] = useState<Row | null>(null)

  const [agents, setAgents] = useState<Row[]>([])
  const [agentId, setAgentId] = useState(defaultAgentId || '')

  const [initialAmount, setInitialAmount] = useState(0)
  const [method, setMethod] = useState('cash')
  const [receiptNumber, setReceiptNumber] = useState('')
  const [paidAt, setPaidAt] = useState(() => new Date().toISOString().slice(0, 10))

  const f = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setForm(p => ({ ...p, [k]: e.target.value }))

  useEffect(() => {
    window.api.agents.list({}).then((res: { success: boolean; data?: Row[] }) => {
      if (res.success) setAgents(res.data || [])
    }).catch(() => {})
  }, [])

  useEffect(() => {
    if (!query.trim() || selectedCustomer) { setMatches([]); return }
    const t = setTimeout(async () => {
      setSearching(true)
      try {
        const res = await window.api.customers.search(query.trim())
        if (res.success) setMatches(res.data as Row[])
      } catch { /* ignore */ } finally { setSearching(false) }
    }, 300)
    return () => clearTimeout(t)
  }, [query, selectedCustomer])

  const save = async () => {
    if (!selectedCustomer) {
      if (!form.customer_name.trim()) { toast.error('Customer name is required'); return }
      if (!form.customer_phone.trim()) { toast.error('Phone is required'); return }
    }
    setSaving(true)
    try {
      const payload = {
        ...(selectedCustomer ? { customer_id: selectedCustomer.id } : form),
        agent_id: agentId || undefined,
        paper_reference_code: paperReferenceCode || undefined,
        initial_amount: initialAmount || undefined,
        method, receipt_number: receiptNumber || undefined, paid_at: paidAt,
      }
      const res = await window.api.chits.members.registerHistorical(schemeId, payload)
      if (res.success) { toast.success('Member registered from paper record'); onSave() }
      else toast.error(String(res.error || 'Failed to register member'))
    } catch (err: any) {
      toast.error(err.message || 'Failed to register member')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title="Register Historical Member (from paper record)" size="lg" onClose={onClose}
      footer={<><button onClick={onClose} className="btn-secondary">Cancel</button><button onClick={save} disabled={saving} className="btn-primary">{saving ? 'Saving...' : 'Register'}</button></>}>
      <div className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1">Find existing customer (optional)</label>
          {selectedCustomer ? (
            <div className="flex items-center justify-between input">
              <span className="text-sm">{(selectedCustomer.name as string)} — {(selectedCustomer.phone as string) || 'no phone'}</span>
              <button type="button" onClick={() => { setSelectedCustomer(null); setQuery('') }} className="text-xs text-brand-400 hover:underline">Change</button>
            </div>
          ) : (
            <>
              <input value={query} onChange={e => setQuery(e.target.value)} className="input" placeholder="Search by name, phone, NIC..." />
              {searching && <p className="text-xs text-slate-500 mt-1">Searching...</p>}
              {matches.length > 0 && (
                <div className="mt-1 rounded-lg border overflow-hidden max-h-40 overflow-y-auto" style={{ borderColor: 'var(--border)' }}>
                  {matches.map(m => (
                    <button key={m.id as string} type="button"
                      onClick={() => { setSelectedCustomer(m); setMatches([]) }}
                      className="w-full flex items-center justify-between px-3 py-2 hover:bg-[var(--bg-soft)] text-left text-sm">
                      <span>{m.name as string}</span>
                      <span className="text-xs text-slate-500 font-mono">{(m.phone as string) || '—'}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
        {!selectedCustomer && (
          <>
            <p className="text-xs text-slate-500">No match? Enter new customer details below.</p>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="block text-xs font-medium text-slate-400 mb-1">Customer Name *</label><input value={form.customer_name} onChange={f('customer_name')} className="input" /></div>
              <div><label className="block text-xs font-medium text-slate-400 mb-1">Phone *</label><input value={form.customer_phone} onChange={f('customer_phone')} className="input" /></div>
              <div><label className="block text-xs font-medium text-slate-400 mb-1">Email</label><input value={form.customer_email} onChange={f('customer_email')} className="input" /></div>
              <div><label className="block text-xs font-medium text-slate-400 mb-1">NIC</label><input value={form.customer_nic} onChange={f('customer_nic')} className="input" /></div>
            </div>
            <div><label className="block text-xs font-medium text-slate-400 mb-1">Address</label><input value={form.customer_address} onChange={f('customer_address')} className="input" /></div>
          </>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Agent</label>
            <select value={agentId} onChange={e => setAgentId(e.target.value)} className="input">
              <option value="">— Use scheme default —</option>
              {agents.map(a => <option key={a.id as string} value={a.id as string}>{(a.code as string)} — {(a.name as string)}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Paper Reference Code (Customer Code)</label>
            <input value={paperReferenceCode} onChange={e => setPaperReferenceCode(e.target.value)} className="input" placeholder="e.g. 20351" />
          </div>
        </div>

        <hr style={{ borderColor: 'var(--border)' }} />
        <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>Initial Payment (Advance)</p>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="block text-xs font-medium text-slate-400 mb-1">Amount (Rs.)</label><input type="number" value={initialAmount} onChange={e => setInitialAmount(parseFloat(e.target.value) || 0)} className="input" min={0} /></div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Method</label>
            <select value={method} onChange={e => setMethod(e.target.value)} className="input">
              <option value="cash">Cash (Direct Pay)</option>
              <option value="bank_transfer">Bank Receipt</option>
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="block text-xs font-medium text-slate-400 mb-1">Date paid</label><input type="date" value={paidAt} onChange={e => setPaidAt(e.target.value)} className="input" /></div>
          <div><label className="block text-xs font-medium text-slate-400 mb-1">Receipt number</label><input value={receiptNumber} onChange={e => setReceiptNumber(e.target.value)} className="input" placeholder="paper book serial number" /></div>
        </div>
      </div>
    </Modal>
  )
}

function ConductDrawModal({ schemeId, cycleNo, isFinalCycle, onClose, onSave }: {
  schemeId: string; cycleNo: number; isFinalCycle: boolean; onClose: () => void; onSave: () => void
}) {
  const [eligible, setEligible] = useState<Row[]>([])
  const [method, setMethod] = useState<'random' | 'manual_pick'>('random')
  const [winnerId, setWinnerId] = useState('')
  const [loading, setLoading] = useState(true)
  const [conducting, setConducting] = useState(false)

  useEffect(() => {
    window.api.chits.draws.eligible(schemeId, cycleNo).then((res: Row) => {
      if (res.success) setEligible(res.data as Row[])
      else toast.error(String(res.error || 'Failed to load eligible members'))
      setLoading(false)
    }).catch((err: any) => {
      toast.error(err.message || 'Failed to load eligible members')
      setLoading(false)
    })
  }, [schemeId, cycleNo])

  const conduct = async () => {
    if (!isFinalCycle && method === 'manual_pick' && !winnerId) { toast.error('Select a member'); return }
    setConducting(true)
    try {
      const res = await window.api.chits.draws.conduct(schemeId, cycleNo, { method, winnerMemberId: winnerId })
      if (res.success) {
        toast.success(isFinalCycle ? `Final settlement: ${res.data.settledCount} member(s) received their product` : 'Draw completed')
        onSave()
      } else {
        toast.error(String(res.error || 'Draw failed'))
      }
    } catch (err: any) {
      toast.error(err.message || 'Draw failed')
    } finally {
      setConducting(false)
    }
  }

  return (
    <Modal title={`Conduct Draw — Cycle ${cycleNo}${isFinalCycle ? ' (Final Settlement)' : ''}`} onClose={onClose}
      footer={<><button onClick={onClose} className="btn-secondary">Cancel</button><button onClick={conduct} disabled={conducting || loading || eligible.length === 0} className="btn-primary">{conducting ? 'Processing...' : isFinalCycle ? 'Settle All Remaining Members' : 'Draw Winner'}</button></>}>
      <div className="space-y-3">
        {loading ? (
          <p className="text-sm text-slate-500">Loading eligible members...</p>
        ) : eligible.length === 0 ? (
          <p className="text-sm text-slate-500">No eligible members remain for this scheme.</p>
        ) : isFinalCycle ? (
          <p className="text-sm" style={{ color: 'var(--text-2)' }}>
            This is the final cycle. All <strong>{eligible.length}</strong> remaining member(s) will receive their product together in this settlement.
          </p>
        ) : (
          <>
            <p className="text-sm" style={{ color: 'var(--text-2)' }}>{eligible.length} member(s) eligible for this cycle's draw.</p>
            <div className="flex gap-2">
              <button onClick={() => setMethod('random')} className={method === 'random' ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'}>Random Draw</button>
              <button onClick={() => setMethod('manual_pick')} className={method === 'manual_pick' ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'}>Manual Pick</button>
            </div>
            {method === 'manual_pick' && (
              <select value={winnerId} onChange={e => setWinnerId(e.target.value)} className="input">
                <option value="">— Select winner —</option>
                {eligible.map(m => <option key={m.id as string} value={m.id as string}>#{m.join_order as number} — {(m.customer_name as string) || m.id as string}</option>)}
              </select>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}

function RecordContributionModal({ member, schemeId, onClose, onSave }: { member: Row; schemeId: string; onClose: () => void; onSave: () => void }) {
  const [amount, setAmount] = useState(0)
  const [method, setMethod] = useState('cash')
  const [reference, setReference] = useState('')
  const [receiptNumber, setReceiptNumber] = useState('')
  const [paidAt, setPaidAt] = useState(() => new Date().toISOString().slice(0, 10))
  const [agents, setAgents] = useState<Row[]>([])
  const [collectedByAgentId, setCollectedByAgentId] = useState(String(member.agent_id || ''))
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    window.api.agents.list({}).then((res: { success: boolean; data?: Row[] }) => {
      if (res.success) setAgents(res.data || [])
    }).catch(() => {})
  }, [])

  const save = async () => {
    if (amount <= 0) { toast.error('Enter a valid amount'); return }
    setSaving(true)
    try {
      const res = await window.api.chits.contributions.record(member.id, {
        amount, method, reference, receipt_number: receiptNumber || undefined,
        paid_at: paidAt, collected_by_agent_id: collectedByAgentId || null,
      })
      if (res.success) { toast.success(res.data.status === 'approved' ? 'Contribution recorded' : 'Contribution submitted for verification'); onSave() }
      else toast.error(String(res.error || 'Failed to record contribution'))
    } catch (err: any) {
      toast.error(err.message || 'Failed to record contribution')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={`Record Contribution — ${(member.customer_name as string) || 'Member'}`} onClose={onClose}
      footer={<><button onClick={onClose} className="btn-secondary">Cancel</button><button onClick={save} disabled={saving} className="btn-primary">{saving ? 'Saving...' : 'Record Payment'}</button></>}>
      <div className="space-y-3">
        <div><label className="block text-xs font-medium text-slate-400 mb-1">Amount (Rs.) *</label><input type="number" value={amount} onChange={e => setAmount(parseFloat(e.target.value) || 0)} className="input" min={0} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Method</label>
            <select value={method} onChange={e => setMethod(e.target.value)} className="input">
              <option value="cash">Cash (Direct Pay)</option>
              <option value="card">Card</option>
              <option value="bank_transfer">Bank Receipt</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Date paid *</label>
            <input type="date" value={paidAt} onChange={e => setPaidAt(e.target.value)} className="input" />
          </div>
        </div>
        {method === 'bank_transfer' && (
          <div><label className="block text-xs font-medium text-slate-400 mb-1">Reference</label><input value={reference} onChange={e => setReference(e.target.value)} className="input" /></div>
        )}
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1">Receipt number</label>
          <input value={receiptNumber} onChange={e => setReceiptNumber(e.target.value)} className="input" placeholder="e.g. paper book serial number" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1">Collected by (agent)</label>
          <select value={collectedByAgentId} onChange={e => setCollectedByAgentId(e.target.value)} className="input">
            <option value="">— Not applicable / office direct —</option>
            {agents.map(a => <option key={a.id as string} value={a.id as string}>{a.name as string} ({a.code as string})</option>)}
          </select>
        </div>
      </div>
    </Modal>
  )
}

function EarlyRedeemModal({ member, minAmount, onClose, onSave }: { member: Row; minAmount: number; onClose: () => void; onSave: () => void }) {
  const [amount, setAmount] = useState(minAmount)
  const [method, setMethod] = useState('cash')
  const [receiptNumber, setReceiptNumber] = useState('')
  const [paidAt, setPaidAt] = useState(() => new Date().toISOString().slice(0, 10))
  const [agents, setAgents] = useState<Row[]>([])
  const [collectedByAgentId, setCollectedByAgentId] = useState(String(member.agent_id || ''))
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    window.api.agents.list({}).then((res: { success: boolean; data?: Row[] }) => {
      if (res.success) setAgents(res.data || [])
    }).catch(() => {})
  }, [])

  const save = async () => {
    if (amount < minAmount) { toast.error(`Minimum early redemption amount is Rs.${money(minAmount)}`); return }
    setSaving(true)
    try {
      const res = await window.api.chits.members.earlyRedeem(member.id, {
        amount, method, receipt_number: receiptNumber || undefined,
        paid_at: paidAt, collected_by_agent_id: collectedByAgentId || null,
      })
      if (res.success) { toast.success('Product released — remaining balance will be collected via installments'); onSave() }
      else toast.error(String(res.error || 'Early redemption failed'))
    } catch (err: any) {
      toast.error(err.message || 'Early redemption failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={`Early Redemption — ${(member.customer_name as string) || 'Member'}`} onClose={onClose}
      footer={<><button onClick={onClose} className="btn-secondary">Cancel</button><button onClick={save} disabled={saving} className="btn-primary">{saving ? 'Processing...' : 'Release Product'}</button></>}>
      <div className="space-y-3">
        <p className="text-sm" style={{ color: 'var(--text-2)' }}>This member can take the product now by paying at least Rs.{money(minAmount)}. The remaining balance is collected afterward via a normal installment schedule.</p>
        <div><label className="block text-xs font-medium text-slate-400 mb-1">Amount (Rs.) *</label><input type="number" value={amount} onChange={e => setAmount(parseFloat(e.target.value) || 0)} className="input" min={minAmount} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Method</label>
            <select value={method} onChange={e => setMethod(e.target.value)} className="input">
              <option value="cash">Cash (Direct Pay)</option>
              <option value="card">Card</option>
              <option value="bank_transfer">Bank Receipt</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Date paid *</label>
            <input type="date" value={paidAt} onChange={e => setPaidAt(e.target.value)} className="input" />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1">Receipt number</label>
          <input value={receiptNumber} onChange={e => setReceiptNumber(e.target.value)} className="input" placeholder="e.g. paper book serial number" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1">Collected by (agent)</label>
          <select value={collectedByAgentId} onChange={e => setCollectedByAgentId(e.target.value)} className="input">
            <option value="">— Not applicable / office direct —</option>
            {agents.map(a => <option key={a.id as string} value={a.id as string}>{a.name as string} ({a.code as string})</option>)}
          </select>
        </div>
      </div>
    </Modal>
  )
}

function RecordRedemptionModal({ member, onClose, onSave }: { member: Row; onClose: () => void; onSave: () => void }) {
  const [products, setProducts] = useState<Row[]>([])
  const [productId, setProductId] = useState('')
  const [productName, setProductName] = useState(String(member.redeemed_product_name || ''))
  const [qty, setQty] = useState(Number(member.redeemed_qty || 1))
  const [value, setValue] = useState(Number(member.redeemed_value || 0))
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    window.api.products.list({ is_active: true }).then((res: { success: boolean; data?: Row[] }) => {
      if (res.success) setProducts(res.data || [])
    }).catch(() => {})
  }, [])

  const onPickProduct = (id: string) => {
    setProductId(id)
    const p = products.find(x => x.id === id)
    if (p) { setProductName(String(p.name || '')); if (!value) setValue(Number(p.selling_price || 0)) }
  }

  const save = async () => {
    if (!productName.trim()) { toast.error('Product name is required'); return }
    setSaving(true)
    try {
      const res = await window.api.chits.members.recordRedemption(member.id, {
        product_id: productId || undefined, product_name: productName, qty, value,
      })
      if (res.success) { toast.success('Redemption recorded'); onSave() }
      else toast.error(String(res.error || 'Failed to record redemption'))
    } catch (err: any) {
      toast.error(err.message || 'Failed to record redemption')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={`Record Redemption — ${(member.customer_name as string) || 'Member'}`} onClose={onClose}
      footer={<><button onClick={onClose} className="btn-secondary">Cancel</button><button onClick={save} disabled={saving} className="btn-primary">{saving ? 'Saving...' : 'Save'}</button></>}>
      <div className="space-y-3">
        <p className="text-sm" style={{ color: 'var(--text-2)' }}>Paid so far: <strong>Rs.{money(member.contributions_paid)}</strong></p>
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1">Product picked (search catalog, optional)</label>
          <ProductSearchSelect products={products} value={productId} onChange={onPickProduct} />
        </div>
        <div><label className="block text-xs font-medium text-slate-400 mb-1">Product Name *</label><input value={productName} onChange={e => setProductName(e.target.value)} className="input" placeholder="e.g. LED TV 43-inch" /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="block text-xs font-medium text-slate-400 mb-1">Quantity</label><input type="number" value={qty} onChange={e => setQty(Math.max(1, parseInt(e.target.value) || 1))} className="input" min={1} /></div>
          <div><label className="block text-xs font-medium text-slate-400 mb-1">Value (Rs.)</label><input type="number" value={value} onChange={e => setValue(parseFloat(e.target.value) || 0)} className="input" min={0} /></div>
        </div>
      </div>
    </Modal>
  )
}

// Scoped to non-structural fields only — member_count/cycle_count/contribution
// amounts etc. already have live members and draw history riding on them, so
// they're not exposed here to avoid corrupting an in-progress scheme.
function EditSchemeModal({ scheme, onClose, onSaved }: { scheme: Row; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(String(scheme.name || ''))
  const [agentId, setAgentId] = useState(String(scheme.agent_id || ''))
  const [notes, setNotes] = useState(String(scheme.notes || ''))
  const [agents, setAgents] = useState<Row[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    window.api.agents.list({}).then((res: { success: boolean; data?: Row[] }) => {
      if (res.success) setAgents(res.data || [])
    }).catch(() => {})
  }, [])

  const save = async () => {
    if (!name.trim()) { toast.error('Scheme name is required'); return }
    setSaving(true)
    try {
      const res = await window.api.chits.update(String(scheme.id), {
        name: name.trim(), agent_id: agentId || null, notes: notes.trim() || null,
      })
      if (res.success) { toast.success('Scheme updated'); onSaved() }
      else toast.error(String(res.error || 'Failed to update scheme'))
    } catch (err: any) {
      toast.error(err.message || 'Failed to update scheme')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title="Edit Smart Buy Scheme" onClose={onClose}
      footer={<><button onClick={onClose} className="btn-secondary">Cancel</button><button onClick={save} disabled={saving} className="btn-primary">{saving ? 'Saving...' : 'Save'}</button></>}>
      <div className="space-y-3">
        <div><label className="block text-xs font-medium text-slate-400 mb-1">Scheme Name *</label><input value={name} onChange={e => setName(e.target.value)} className="input" /></div>
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1">Agent</label>
          <select value={agentId} onChange={e => setAgentId(e.target.value)} className="input">
            <option value="">— None —</option>
            {agents.map(a => <option key={a.id as string} value={a.id as string}>{(a.code as string)} — {(a.name as string)}</option>)}
          </select>
        </div>
        <div><label className="block text-xs font-medium text-slate-400 mb-1">Notes</label><textarea value={notes} onChange={e => setNotes(e.target.value)} className="input h-20 resize-none" /></div>
        <p className="text-xs" style={{ color: 'var(--text-3)' }}>Member count, cycles, contribution amount, and other financial terms can't be changed here once a scheme is running.</p>
      </div>
    </Modal>
  )
}
