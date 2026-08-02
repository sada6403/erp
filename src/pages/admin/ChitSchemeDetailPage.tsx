import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import Modal from '@/components/shared/Modal'
import StatCard from '@/components/shared/StatCard'
import ProductSearchSelect from '@/components/shared/ProductSearchSelect'
import MemberPaymentHistoryModal from '@/components/shared/MemberPaymentHistoryModal'
import { ArrowLeft, Plus, Upload, FileDown, Users, Coins, Gift, Shuffle, Pencil, Package, Eye, GitBranch, Check, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuthStore } from '@/store/authStore'

type Row = Record<string, unknown>

const money = (v: unknown) => Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function ChitSchemeDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const [scheme, setScheme] = useState<Row | null>(null)
  const [members, setMembers] = useState<Row[]>([])
  const [draws, setDraws] = useState<Row[]>([])
  const [collaborations, setCollaborations] = useState<Row[]>([])
  const [branches, setBranches] = useState<Row[]>([])
  const [summary, setSummary] = useState<Row>({})
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'members' | 'draws' | 'branches'>('members')
  const [importing, setImporting] = useState(false)
  const [showAddMember, setShowAddMember] = useState(false)
  const [showRegisterHistorical, setShowRegisterHistorical] = useState(false)
  const [showDraw, setShowDraw] = useState(false)
  const [showInvite, setShowInvite] = useState(false)
  const [finalClaimsOnly, setFinalClaimsOnly] = useState(false)
  const [payingMember, setPayingMember] = useState<Row | null>(null)
  const [redeemingMember, setRedeemingMember] = useState<Row | null>(null)
  const [redemptionMember, setRedemptionMember] = useState<Row | null>(null)
  const [historyMember, setHistoryMember] = useState<Row | null>(null)
  const [showEdit, setShowEdit] = useState(false)

  const load = async () => {
    if (!id) return
    setLoading(true)
    try {
      const [res, b] = await Promise.all([window.api.chits.get(id), window.api.admin.branches.list()])
      if (res.success) {
        setScheme(res.data.scheme)
        setMembers(res.data.members)
        setDraws(res.data.draws)
        setCollaborations((res.data.collaborations || []) as Row[])
        setSummary(res.data.contributionSummary)
      } else {
        toast.error(res.error || 'Failed to load Smart Buy scheme')
      }
      if (b.success) setBranches(b.data as Row[])
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

  const respondCollaboration = async (collaborationId: string, action: 'approve' | 'reject') => {
    try {
      const res = await window.api.chits.branches.respond(collaborationId, action)
      if (res.success) { toast.success(action === 'approve' ? 'Collaboration approved' : 'Collaboration rejected'); load() }
      else toast.error(res.error || 'Failed to respond')
    } catch (err: any) {
      toast.error(err.message || 'Failed to respond')
    }
  }

  const removeCollaboration = async (collaborationId: string) => {
    if (!confirm('Remove this branch from the collaboration? Already-enrolled members stay in the scheme.')) return
    try {
      const res = await window.api.chits.branches.remove(collaborationId)
      if (res.success) { toast.success('Collaboration removed'); load() }
      else toast.error(res.error || 'Failed to remove')
    } catch (err: any) {
      toast.error(err.message || 'Failed to remove')
    }
  }

  if (loading || !scheme) {
    return <div className="flex items-center justify-center h-full text-slate-500">Loading...</div>
  }

  const nextCycle = draws.length + 1
  const isFinalCycle = nextCycle >= Number(scheme.cycle_count)
  const membersEnrolled = members.filter(m => m.status !== 'withdrawn').length
  const myPermissions = ((user?.role as unknown as Row)?.permissions as Row) || {}
  const isGlobal = Boolean(myPermissions.all)
  const myBranchId = String(user?.branch_id || '')
  const isHomeBranchOrGlobal = isGlobal || myBranchId === String(scheme.branch_id || '')
  const pendingCollabCount = collaborations.filter(c => c.status === 'pending').length
  // Final Month Product Claim — every member settled together on the final
  // cycle (redemption_type='final_batch'); tracked separately from regular
  // draw winners so staff can see at a glance how many still need their
  // product claim processed (chits:members:recordRedemption for each).
  const finalBatchMembers = members.filter(m => m.redemption_type === 'final_batch')
  const finalBatchClaimed = finalBatchMembers.filter(m => m.redemption_invoice_id).length
  const visibleMembers = finalClaimsOnly ? finalBatchMembers.filter(m => !m.redemption_invoice_id) : members

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
        <span className={scheme.status === 'active' ? 'badge-green' : scheme.status === 'pending' ? 'badge-yellow' : 'badge-gray'}>{scheme.status as string}</span>
      </div>

      {showEdit && (
        <EditSchemeModal scheme={scheme} onClose={() => setShowEdit(false)} onSaved={() => { setShowEdit(false); load() }} />
      )}

      {scheme.status === 'pending' && (
        <div className="mx-6 mt-4 rounded-lg border px-4 py-3 text-sm flex-shrink-0" style={{ background: 'color-mix(in srgb, #f59e0b 10%, transparent)', borderColor: '#f59e0b', color: '#a16207' }}>
          <strong>Waiting for Minimum Members</strong> — Need {Math.max(0, Number(scheme.min_members || 0) - membersEnrolled)} More Members.
        </div>
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
          <button onClick={() => setTab('branches')} className={tab === 'branches' ? 'btn-primary btn-sm gap-1.5' : 'btn-secondary btn-sm gap-1.5'}>
            <GitBranch size={13} /> Branches {pendingCollabCount > 0 && <span className="badge-yellow ml-1">{pendingCollabCount}</span>}
          </button>
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
          {tab === 'branches' && isHomeBranchOrGlobal && (
            <button onClick={() => setShowInvite(true)} className="btn-primary btn-sm gap-1.5"><GitBranch size={14} /> Invite Branch</button>
          )}
          {scheme.status === 'active' && (
            <button onClick={() => setShowDraw(true)} className="btn-primary btn-sm gap-1.5"><Shuffle size={14} /> Conduct Draw (Cycle {nextCycle})</button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto px-6 pb-6">
        {tab === 'branches' ? (
          <div className="space-y-3">
            <p className="text-xs" style={{ color: 'var(--text-3)' }}>
              Home branch: <strong>{(scheme.branch_name as string) || '—'}</strong> · Responsible agent: <strong>{(scheme.agent_name as string) || 'None'}</strong> — collaboration only extends which branches may enroll/collect members; scheme control always stays with the home branch.
            </p>
            <table className="w-full">
              <thead className="sticky top-0 bg-surface-900 z-10">
                <tr>
                  {['Branch', 'Status', 'Members Enrolled', 'Requested', 'Responded', ''].map(h => (
                    <th key={h} className="table-header px-4 py-3 text-left">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {collaborations.length === 0 ? (
                  <tr><td colSpan={6} className="text-center py-16 text-slate-500">No collaborating branches yet{isHomeBranchOrGlobal ? ' — invite one if this scheme is short on members' : ''}</td></tr>
                ) : collaborations.map(c => {
                  const canRespond = (isGlobal || myBranchId === String(c.branch_id || '')) && c.status === 'pending'
                  const canRemove = isHomeBranchOrGlobal && c.status === 'active'
                  return (
                    <tr key={c.id as string} className="table-row">
                      <td className="table-cell font-medium">{(c.branch_name as string) || '—'}</td>
                      <td className="table-cell">
                        <span className={c.status === 'active' ? 'badge-green' : c.status === 'pending' ? 'badge-yellow' : c.status === 'rejected' ? 'badge-red' : 'badge-gray'}>{c.status as string}</span>
                      </td>
                      <td className="table-cell">{Number(c.members_enrolled || 0)}</td>
                      <td className="table-cell text-xs text-slate-400">{c.created_at ? new Date(String(c.created_at)).toLocaleDateString() : '—'}</td>
                      <td className="table-cell text-xs text-slate-400">{c.responded_at ? new Date(String(c.responded_at)).toLocaleDateString() : '—'}</td>
                      <td className="table-cell">
                        <div className="flex gap-1">
                          {canRespond && (
                            <>
                              <button onClick={() => respondCollaboration(c.id as string, 'approve')} className="btn-ghost btn-sm p-1.5 text-green-500" title="Approve"><Check size={13} /></button>
                              <button onClick={() => respondCollaboration(c.id as string, 'reject')} className="btn-ghost btn-sm p-1.5 text-red-400" title="Reject"><X size={13} /></button>
                            </>
                          )}
                          {canRemove && (
                            <button onClick={() => removeCollaboration(c.id as string)} className="btn-ghost btn-sm p-1.5 text-red-400" title="Remove collaboration">✕</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : tab === 'members' ? (
          <>
          {finalBatchMembers.length > 0 && (
            <div className="mb-3 rounded-lg border px-4 py-3 text-sm flex items-center justify-between gap-3" style={{ background: 'color-mix(in srgb, var(--brand-primary) 8%, transparent)', borderColor: 'var(--brand-primary)' }}>
              <span style={{ color: 'var(--text-1)' }}>
                <strong>Final Month Product Claim</strong> — {finalBatchClaimed} / {finalBatchMembers.length} settled members have claimed their product.
              </span>
              {finalBatchClaimed < finalBatchMembers.length && (
                <label className="flex items-center gap-1.5 text-xs cursor-pointer flex-shrink-0" style={{ color: 'var(--text-2)' }}>
                  <input type="checkbox" checked={finalClaimsOnly} onChange={e => setFinalClaimsOnly(e.target.checked)} className="w-3.5 h-3.5" />
                  Show only pending claims
                </label>
              )}
            </div>
          )}
          <table className="w-full">
            <thead className="sticky top-0 bg-surface-900 z-10">
              <tr>
                {['#', 'Customer', 'Phone', 'Agent', 'Early?', 'Contributions Paid', 'Status', 'Won Cycle', 'Redeemed Product', ''].map(h => (
                  <th key={h} className="table-header px-4 py-3 text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleMembers.length === 0 ? (
                <tr><td colSpan={10} className="text-center py-16 text-slate-500">{finalClaimsOnly ? 'All final settlement members have claimed their product' : 'No members enrolled yet'}</td></tr>
              ) : visibleMembers.map(m => (
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
                    {m.redeemed_product_name ? (
                      <>
                        {m.redeemed_product_name as string} × {m.redeemed_qty as number}
                        {Boolean(m.redemption_invoice_number) && <span className="badge-blue ml-1">{m.redemption_invoice_number as string}</span>}
                      </>
                    ) : '—'}
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
          </>
        ) : (
          <table className="w-full">
            <thead className="sticky top-0 bg-surface-900 z-10">
              <tr>
                {['Cycle', 'Date & Time', 'Winner', 'Method', 'Selected By', 'Reason', 'Settled', 'Eligible', 'Product Chosen'].map(h => (
                  <th key={h} className="table-header px-4 py-3 text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {draws.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-16 text-slate-500">No draws conducted yet</td></tr>
              ) : draws.map(d => {
                const winnerMember = members.find(m => m.id === d.winner_member_id)
                return (
                <tr key={d.id as string} className="table-row">
                  <td className="table-cell font-semibold">{d.cycle_no as number}</td>
                  <td className="table-cell text-slate-400 text-xs">{d.draw_date ? new Date(String(d.draw_date)).toLocaleString() : '—'}</td>
                  <td className="table-cell">{d.method === 'final_batch' ? `${d.settled_count} members (final settlement)` : (d.winner_name as string) || '—'}</td>
                  <td className="table-cell"><span className={d.method === 'final_batch' ? 'badge-blue' : d.method === 'manual_pick' ? 'badge-purple' : 'badge-green'}>{d.method as string}</span></td>
                  <td className="table-cell text-xs text-slate-400">{(d.conducted_by_name as string) || '—'}</td>
                  <td className="table-cell text-xs text-slate-400">{(d.notes as string) || '—'}</td>
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
        <RecordRedemptionModal member={redemptionMember} schemeChitValue={Number(scheme.chit_value)}
          onClose={() => setRedemptionMember(null)} onSave={() => { setRedemptionMember(null); load() }} />
      )}
      {historyMember && (
        <MemberPaymentHistoryModal memberId={historyMember.id as string} onClose={() => setHistoryMember(null)} />
      )}
      {showInvite && (
        <InviteBranchModal schemeId={id!} schemeBranchId={(scheme.branch_id as string) || ''}
          branches={branches} excludeBranchIds={collaborations.filter(c => c.status !== 'rejected' && c.status !== 'removed').map(c => String(c.branch_id))}
          onClose={() => setShowInvite(false)} onSave={() => { setShowInvite(false); load() }} />
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
  const [reason, setReason] = useState('')
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
    if (!isFinalCycle && method === 'manual_pick' && !reason.trim()) { toast.error('Enter a reason for the manual pick — kept in the Winner Selection Log'); return }
    setConducting(true)
    try {
      const res = await window.api.chits.draws.conduct(schemeId, cycleNo, { method, winnerMemberId: winnerId, reason: reason.trim() || undefined })
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
              <>
                <select value={winnerId} onChange={e => setWinnerId(e.target.value)} className="input">
                  <option value="">— Select winner —</option>
                  {eligible.map(m => <option key={m.id as string} value={m.id as string}>#{m.join_order as number} — {(m.customer_name as string) || m.id as string}</option>)}
                </select>
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">Reason for Manual Pick *</label>
                  <textarea value={reason} onChange={e => setReason(e.target.value)} className="input h-16 resize-none" placeholder="e.g. Customer dispute resolution, loyalty priority, admin override" />
                  <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>Recorded in the Winner Selection Log for transparency.</p>
                </div>
              </>
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
      if (res.success) {
        toast.success(res.data.status === 'approved' ? 'Contribution recorded' : 'Contribution submitted for verification')
        if (Number(res.data.lateFeeApplied || 0) > 0) {
          toast(`Rs.${res.data.lateFeeApplied} late fee added — total collected Rs.${res.data.amount}`, { icon: '⚠️' })
        }
        onSave()
      }
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

function RecordRedemptionModal({ member, schemeChitValue, onClose, onSave }: { member: Row; schemeChitValue: number; onClose: () => void; onSave: () => void }) {
  const [products, setProducts] = useState<Row[]>([])
  const [productId, setProductId] = useState('')
  const [qty, setQty] = useState(1)
  const [saving, setSaving] = useState(false)
  const alreadyRedeemed = Boolean(member.redemption_invoice_id)

  useEffect(() => {
    window.api.products.list({ is_active: true }).then((res: { success: boolean; data?: Row[] }) => {
      if (res.success) setProducts(res.data || [])
    }).catch(() => {})
  }, [])

  const selectedProduct = products.find(p => p.id === productId)
  const unitPrice = Number(selectedProduct?.selling_price || 0)
  const taxRate = Number(selectedProduct?.tax_rate || 0)
  const estimatedTotal = Math.round(unitPrice * qty * (1 + taxRate / 100) * 100) / 100
  const exceedsLimit = estimatedTotal > schemeChitValue + 0.01

  const save = async () => {
    if (!productId) { toast.error('Select a product from the catalog'); return }
    if (exceedsLimit) { toast.error(`Product value Rs.${estimatedTotal} exceeds this scheme's entitled value of Rs.${schemeChitValue}`); return }
    setSaving(true)
    try {
      const res = await window.api.chits.members.recordRedemption(member.id, { product_id: productId, qty })
      if (res.success) { toast.success(`Redemption recorded — invoice ${res.data?.invoiceNumber || ''}`); onSave() }
      else toast.error(String(res.error || 'Failed to record redemption'))
    } catch (err: any) {
      toast.error(err.message || 'Failed to record redemption')
    } finally {
      setSaving(false)
    }
  }

  if (alreadyRedeemed) {
    return (
      <Modal title={`Record Redemption — ${(member.customer_name as string) || 'Member'}`} onClose={onClose} footer={<button onClick={onClose} className="btn-secondary">Close</button>}>
        <p className="text-sm" style={{ color: 'var(--text-2)' }}>
          This member already has a redemption invoice recorded: <strong>{(member.redeemed_product_name as string) || '—'}</strong> × {member.redeemed_qty as number} — Rs.{money(member.redeemed_value)}.
        </p>
      </Modal>
    )
  }

  return (
    <Modal title={`Record Redemption — ${(member.customer_name as string) || 'Member'}`} onClose={onClose}
      footer={<><button onClick={onClose} className="btn-secondary">Cancel</button><button onClick={save} disabled={saving || !productId || exceedsLimit} className="btn-primary">{saving ? 'Saving...' : 'Record & Generate Invoice'}</button></>}>
      <div className="space-y-3">
        <p className="text-sm" style={{ color: 'var(--text-2)' }}>Entitled product value: <strong>Rs.{money(schemeChitValue)}</strong> — recording this generates a real invoice, decrements stock, and cannot be undone from here.</p>
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1">Product *</label>
          <ProductSearchSelect products={products} value={productId} onChange={setProductId} />
        </div>
        <div><label className="block text-xs font-medium text-slate-400 mb-1">Quantity</label><input type="number" value={qty} onChange={e => setQty(Math.max(1, parseInt(e.target.value) || 1))} className="input" min={1} /></div>
        {productId && (
          <p className="text-xs" style={{ color: exceedsLimit ? '#ef4444' : 'var(--text-3)' }}>
            Unit price Rs.{money(unitPrice)} × {qty} {taxRate > 0 ? `+ ${taxRate}% tax` : ''} = <strong>Rs.{money(estimatedTotal)}</strong>
            {exceedsLimit ? ' — exceeds entitled value' : ''}
          </p>
        )}
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

// Invites another branch to enroll members into this scheme (Branch
// Collaboration). Sends a 'pending' request the target branch's own
// manager (or Super Admin) must approve — the inviting (home) branch
// cannot approve its own invite.
function InviteBranchModal({ schemeId, schemeBranchId, branches, excludeBranchIds, onClose, onSave }: {
  schemeId: string; schemeBranchId: string; branches: Row[]; excludeBranchIds: string[]; onClose: () => void; onSave: () => void
}) {
  const eligible = branches.filter(b => String(b.id) !== schemeBranchId && !excludeBranchIds.includes(String(b.id)))
  const [branchId, setBranchId] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  const save = async () => {
    if (!branchId) { toast.error('Select a branch to invite'); return }
    setSaving(true)
    try {
      const res = await window.api.chits.branches.invite(schemeId, branchId, notes.trim() || undefined)
      if (res.success) { toast.success('Invitation sent'); onSave() }
      else toast.error(String(res.error || 'Failed to send invitation'))
    } catch (err: any) {
      toast.error(err.message || 'Failed to send invitation')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title="Invite Branch to Collaborate" onClose={onClose}
      footer={<><button onClick={onClose} className="btn-secondary">Cancel</button><button onClick={save} disabled={saving || !branchId} className="btn-primary">{saving ? 'Sending...' : 'Send Invitation'}</button></>}>
      <div className="space-y-3">
        <p className="text-xs" style={{ color: 'var(--text-3)' }}>
          The invited branch's manager must approve before their staff can enroll members into this scheme. Enrolled members still count toward this scheme's minimum-members activation — the scheme keeps one home branch and one responsible agent.
        </p>
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1">Branch *</label>
          <select value={branchId} onChange={e => setBranchId(e.target.value)} className="input">
            <option value="">— Select a branch —</option>
            {eligible.map(b => <option key={b.id as string} value={b.id as string}>{b.name as string}</option>)}
          </select>
          {eligible.length === 0 && <p className="text-xs text-amber-500 mt-1">No other branches available to invite.</p>}
        </div>
        <div><label className="block text-xs font-medium text-slate-400 mb-1">Notes</label><textarea value={notes} onChange={e => setNotes(e.target.value)} className="input h-16 resize-none" placeholder="Optional message for the receiving branch" /></div>
      </div>
    </Modal>
  )
}
