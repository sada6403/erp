import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import Modal from '@/components/shared/Modal'
import StatCard from '@/components/shared/StatCard'
import ProductSearchSelect from '@/components/shared/ProductSearchSelect'
import MemberPaymentHistoryModal from '@/components/shared/MemberPaymentHistoryModal'
import { ArrowLeft, Plus, Upload, FileDown, Users, Coins, Gift, Shuffle, Pencil, Package, Eye, GitBranch, Check, X, CalendarClock, ArrowLeftRight, Undo2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuthStore } from '@/store/authStore'

type Row = Record<string, unknown>

const money = (v: unknown) => Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function ChitSchemeDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user } = useAuthStore()
  // Manual winner override (chits:draws:conduct, method='manual_pick') is
  // Company/Super Admin only server-side (SmartBuy fix audit, HIGH-5) — the
  // option is hidden here for anyone else so a Smart Buy Manager can't fill
  // out a whole manual-pick form only to be rejected after the fact.
  const userPermissions = ((user?.role as Record<string, unknown> | undefined)?.permissions
    || (user as unknown as Record<string, unknown> | undefined)?.permissions) as Record<string, unknown> | undefined
  const isSuperAdmin = Boolean(userPermissions?.all)
  const [scheme, setScheme] = useState<Row | null>(null)
  const [members, setMembers] = useState<Row[]>([])
  const [draws, setDraws] = useState<Row[]>([])
  const [collaborations, setCollaborations] = useState<Row[]>([])
  const [withdrawals, setWithdrawals] = useState<Row[]>([])
  const [branches, setBranches] = useState<Row[]>([])
  const [summary, setSummary] = useState<Row>({})
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'members' | 'draws' | 'branches' | 'withdrawals'>('members')
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
  const [withdrawingMember, setWithdrawingMember] = useState<Row | null>(null)
  const [reviewingWithdrawal, setReviewingWithdrawal] = useState<Row | null>(null)
  const [extendingClaimMember, setExtendingClaimMember] = useState<Row | null>(null)
  const [transferringMember, setTransferringMember] = useState<Row | null>(null)
  const [reversingMember, setReversingMember] = useState<Row | null>(null)
  const [showEdit, setShowEdit] = useState(false)

  const load = async () => {
    if (!id) return
    setLoading(true)
    try {
      const [res, b, w] = await Promise.all([
        window.api.chits.get(id), window.api.admin.branches.list(), window.api.chits.withdrawals.list({ schemeId: id }),
      ])
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
      if (w.success) setWithdrawals(w.data as Row[])
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

  const pendingWithdrawalCount = withdrawals.filter(w => w.status === 'pending').length

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
          <button onClick={() => setTab('withdrawals')} className={tab === 'withdrawals' ? 'btn-primary btn-sm gap-1.5' : 'btn-secondary btn-sm gap-1.5'}>
            <X size={13} /> Withdrawals {pendingWithdrawalCount > 0 && <span className="badge-yellow ml-1">{pendingWithdrawalCount}</span>}
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
                      {m.status === 'redeemed' && !m.redemption_invoice_id && (
                        <button onClick={() => setRedemptionMember(m)} className="btn-ghost btn-sm p-1.5" title="Record Redemption Product"><Package size={13} /></button>
                      )}
                      {m.status === 'redeemed' && !m.redemption_invoice_id && (
                        <button onClick={() => setExtendingClaimMember(m)} className="btn-ghost btn-sm p-1.5" title="Extend Claim Reminder"><CalendarClock size={13} /></button>
                      )}
                      {m.status === 'redeemed' && !m.redemption_invoice_id && isSuperAdmin && (
                        <button onClick={() => setTransferringMember(m)} className="btn-ghost btn-sm p-1.5" title="Transfer Winner Entitlement"><ArrowLeftRight size={13} /></button>
                      )}
                      {m.status === 'redeemed' && Boolean(m.redemption_invoice_id) && isSuperAdmin && (
                        <button onClick={() => setReversingMember(m)} className="btn-ghost btn-sm p-1.5 text-red-400" title="Reverse Redemption"><Undo2 size={13} /></button>
                      )}
                      <button onClick={() => setHistoryMember(m)} className="btn-ghost btn-sm p-1.5" title="Payment History"><Eye size={13} /></button>
                      {m.status === 'active' && (
                        <button onClick={() => setWithdrawingMember(m)} className="btn-ghost btn-sm p-1.5 text-red-400" title="Withdraw">✕</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </>
        ) : tab === 'draws' ? (
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
        ) : (
          <table className="w-full">
            <thead className="sticky top-0 bg-surface-900 z-10">
              <tr>
                {['Member', 'Requested', 'Reason', 'Scheme Active?', 'Status', 'Refund', 'Reviewed By', 'Review Reason', ''].map(h => (
                  <th key={h} className="table-header px-4 py-3 text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {withdrawals.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-16 text-slate-500">No withdrawal requests for this scheme</td></tr>
              ) : withdrawals.map(w => (
                <tr key={w.id as string} className="table-row">
                  <td className="table-cell font-medium">{(w.customer_name as string) || '—'}</td>
                  <td className="table-cell text-xs text-slate-400">{w.requested_at ? new Date(String(w.requested_at)).toLocaleString() : '—'}<br />by {(w.requested_by_name as string) || '—'}</td>
                  <td className="table-cell text-xs text-slate-400 max-w-[12rem] truncate" title={w.reason as string}>{(w.reason as string) || '—'}</td>
                  <td className="table-cell">{w.scheme_was_active ? <span className="badge-blue">Active</span> : <span className="badge-gray">Pre-activation</span>}</td>
                  <td className="table-cell">
                    <span className={w.status === 'approved' ? 'badge-green' : w.status === 'rejected' ? 'badge-red' : 'badge-yellow'}>{w.status as string}</span>
                  </td>
                  <td className="table-cell">{w.refund_amount !== null && w.refund_amount !== undefined ? `Rs.${money(w.refund_amount)}` : '—'}</td>
                  <td className="table-cell text-xs text-slate-400">{(w.reviewed_by_name as string) || '—'}</td>
                  <td className="table-cell text-xs text-slate-400 max-w-[10rem] truncate" title={w.review_reason as string}>{(w.review_reason as string) || '—'}</td>
                  <td className="table-cell">
                    {w.status === 'pending' && isSuperAdmin && (
                      <button onClick={() => setReviewingWithdrawal(w)} className="btn-secondary btn-sm">Review</button>
                    )}
                  </td>
                </tr>
              ))}
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
        <ConductDrawModal schemeId={id!} cycleNo={nextCycle} isFinalCycle={isFinalCycle} isSuperAdmin={isSuperAdmin}
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
        <RecordRedemptionModal member={redemptionMember} schemeChitValue={Number(redemptionMember.entitlement_value ?? scheme.chit_value)} schemeProductId={(scheme.product_id as string) || ''}
          onClose={() => setRedemptionMember(null)} onSave={() => { setRedemptionMember(null); load() }} />
      )}
      {historyMember && (
        <MemberPaymentHistoryModal memberId={historyMember.id as string} onClose={() => setHistoryMember(null)} />
      )}
      {withdrawingMember && (
        <WithdrawMemberModal member={withdrawingMember} schemeActive={scheme.status === 'active'}
          onClose={() => setWithdrawingMember(null)} onSave={() => { setWithdrawingMember(null); load() }} />
      )}
      {reviewingWithdrawal && (
        <ReviewWithdrawalModal withdrawal={reviewingWithdrawal}
          onClose={() => setReviewingWithdrawal(null)} onSave={() => { setReviewingWithdrawal(null); load() }} />
      )}
      {extendingClaimMember && (
        <ExtendClaimModal member={extendingClaimMember}
          onClose={() => setExtendingClaimMember(null)} onSave={() => { setExtendingClaimMember(null); load() }} />
      )}
      {transferringMember && (
        <TransferWinnerModal member={transferringMember}
          onClose={() => setTransferringMember(null)} onSave={() => { setTransferringMember(null); load() }} />
      )}
      {reversingMember && (
        <ReverseRedemptionModal member={reversingMember}
          onClose={() => setReversingMember(null)} onSave={() => { setReversingMember(null); load() }} />
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

const MANUAL_DRAW_MIN_REASON_LENGTH = 10

function ConductDrawModal({ schemeId, cycleNo, isFinalCycle, isSuperAdmin, onClose, onSave }: {
  schemeId: string; cycleNo: number; isFinalCycle: boolean; isSuperAdmin: boolean; onClose: () => void; onSave: () => void
}) {
  const [eligible, setEligible] = useState<Row[]>([])
  const [method, setMethod] = useState<'random' | 'manual_pick'>('random')
  const [winnerId, setWinnerId] = useState('')
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(true)
  const [conducting, setConducting] = useState(false)
  // A real product handout hinges on this call — setConducting(true) alone
  // disables the button, but React state updates aren't guaranteed to be
  // reflected in the DOM before a second, near-simultaneous click event is
  // already dispatched. A plain ref updates synchronously, so it closes
  // that window outright rather than relying on re-render timing.
  const submittingRef = useRef(false)

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
    if (submittingRef.current) return
    if (!isFinalCycle && method === 'manual_pick' && !isSuperAdmin) { toast.error('Only a Company Admin can manually select a winner'); return }
    if (!isFinalCycle && method === 'manual_pick' && !winnerId) { toast.error('Select a member'); return }
    if (!isFinalCycle && method === 'manual_pick' && reason.trim().length < MANUAL_DRAW_MIN_REASON_LENGTH) {
      toast.error(`Enter a reason of at least ${MANUAL_DRAW_MIN_REASON_LENGTH} characters — kept in the Winner Selection Log`)
      return
    }
    submittingRef.current = true
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
      submittingRef.current = false
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
              {/* Manual override is Company Admin only server-side (SmartBuy
                  fix audit, HIGH-5) — hidden here for everyone else so a
                  Smart Buy Manager can't fill out the whole form only to be
                  rejected after the fact. */}
              {isSuperAdmin && (
                <button onClick={() => setMethod('manual_pick')} className={method === 'manual_pick' ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'}>Manual Pick</button>
              )}
            </div>
            {method === 'manual_pick' && isSuperAdmin && (
              <>
                <select value={winnerId} onChange={e => setWinnerId(e.target.value)} className="input">
                  <option value="">— Select winner —</option>
                  {eligible.map(m => <option key={m.id as string} value={m.id as string}>#{m.join_order as number} — {(m.customer_name as string) || m.id as string}</option>)}
                </select>
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">Reason for Manual Pick * (min. {MANUAL_DRAW_MIN_REASON_LENGTH} characters)</label>
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
  // Same synchronous double-submit guard as ConductDrawModal — unlike a
  // draw or redemption, chits:contributions:record has no database-level
  // constraint that would catch two near-identical payments recorded a
  // moment apart, so the frontend is the only line of defense here.
  const submittingRef = useRef(false)

  useEffect(() => {
    window.api.agents.list({}).then((res: { success: boolean; data?: Row[] }) => {
      if (res.success) setAgents(res.data || [])
    }).catch(() => {})
  }, [])

  const save = async () => {
    if (submittingRef.current) return
    if (amount <= 0) { toast.error('Enter a valid amount'); return }
    submittingRef.current = true
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
      submittingRef.current = false
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

function WithdrawMemberModal({ member, schemeActive, onClose, onSave }: {
  member: Row; schemeActive: boolean; onClose: () => void; onSave: () => void
}) {
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const submittingRef = useRef(false)

  const submit = async () => {
    if (submittingRef.current) return
    if (!reason.trim()) { toast.error('A withdrawal reason is required'); return }
    submittingRef.current = true
    setSaving(true)
    try {
      const res = await window.api.chits.withdrawals.request(member.id, reason.trim())
      if (res.success) {
        toast.success(res.data?.status === 'approved'
          ? `Withdrawn — full refund of Rs.${money(res.data.refundAmount)} recorded`
          : 'Withdrawal request submitted — pending Super Admin approval')
        onSave()
      } else {
        toast.error(String(res.error || 'Withdrawal request failed'))
      }
    } catch (err: any) {
      toast.error(err.message || 'Withdrawal request failed')
    } finally {
      submittingRef.current = false
      setSaving(false)
    }
  }

  return (
    <Modal title={`Withdraw — ${(member.customer_name as string) || 'Member'}`} onClose={onClose}
      footer={<><button onClick={onClose} className="btn-secondary">Cancel</button><button onClick={submit} disabled={saving} className="btn-primary">{saving ? 'Submitting...' : schemeActive ? 'Submit Request' : 'Withdraw'}</button></>}>
      <div className="space-y-3">
        {schemeActive ? (
          <p className="text-sm" style={{ color: 'var(--text-2)' }}>
            This scheme is already active. Withdrawal requires Super Admin approval before it takes effect — the member keeps their seat until then. The refund amount is decided by the approver during review, not calculated automatically.
          </p>
        ) : (
          <p className="text-sm" style={{ color: 'var(--text-2)' }}>
            This scheme hasn't activated yet, so withdrawal is immediate and the member's full paid amount (Rs.{money(member.contributions_paid)}) is refunded automatically.
          </p>
        )}
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1">Reason for withdrawal *</label>
          <textarea value={reason} onChange={e => setReason(e.target.value)} className="input h-20 resize-none" placeholder="e.g. relocating, no longer interested, financial hardship..." />
        </div>
      </div>
    </Modal>
  )
}

function ReviewWithdrawalModal({ withdrawal, onClose, onSave }: { withdrawal: Row; onClose: () => void; onSave: () => void }) {
  const [refundAmount, setRefundAmount] = useState(0)
  const [reviewReason, setReviewReason] = useState('')
  const [saving, setSaving] = useState(false)
  const submittingRef = useRef(false)

  const respond = async (action: 'approve' | 'reject') => {
    if (submittingRef.current) return
    if (!reviewReason.trim()) { toast.error(`A${action === 'approve' ? 'n approval' : ' rejection'} reason is required`); return }
    if (action === 'approve' && refundAmount < 0) { toast.error('Refund amount cannot be negative'); return }
    submittingRef.current = true
    setSaving(true)
    try {
      const res = action === 'approve'
        ? await window.api.chits.withdrawals.approve(withdrawal.id, refundAmount, reviewReason.trim())
        : await window.api.chits.withdrawals.reject(withdrawal.id, reviewReason.trim())
      if (res.success) { toast.success(action === 'approve' ? 'Withdrawal approved' : 'Withdrawal rejected'); onSave() }
      else toast.error(String(res.error || 'Failed to process withdrawal review'))
    } catch (err: any) {
      toast.error(err.message || 'Failed to process withdrawal review')
    } finally {
      submittingRef.current = false
      setSaving(false)
    }
  }

  return (
    <Modal title={`Review Withdrawal — ${(withdrawal.customer_name as string) || 'Member'}`} onClose={onClose}
      footer={<>
        <button onClick={onClose} className="btn-secondary">Cancel</button>
        <button onClick={() => respond('reject')} disabled={saving} className="btn-secondary text-red-400">Reject</button>
        <button onClick={() => respond('approve')} disabled={saving} className="btn-primary">Approve</button>
      </>}>
      <div className="space-y-3">
        <p className="text-sm" style={{ color: 'var(--text-2)' }}>
          Member's withdrawal reason: <span className="italic">"{(withdrawal.reason as string) || '—'}"</span>
        </p>
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1">Refund amount (Rs.) — only used if approving</label>
          <input type="number" value={refundAmount} onChange={e => setRefundAmount(parseFloat(e.target.value) || 0)} className="input" min={0} />
          <p className="text-xs text-slate-500 mt-1">No fixed formula — enter whatever the business decides is fair for this case. It cannot exceed the member's net contribution (checked on submit).</p>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1">Approval / rejection reason *</label>
          <textarea value={reviewReason} onChange={e => setReviewReason(e.target.value)} className="input h-20 resize-none" placeholder="Required either way — explain the decision for the audit trail" />
        </div>
      </div>
    </Modal>
  )
}

function RecordRedemptionModal({ member, schemeChitValue, schemeProductId, onClose, onSave }: {
  member: Row; schemeChitValue: number; schemeProductId: string; onClose: () => void; onSave: () => void
}) {
  const [products, setProducts] = useState<Row[]>([])
  const [productId, setProductId] = useState('')
  const [qty, setQty] = useState(1)
  const [substitutionReason, setSubstitutionReason] = useState('')
  const [customerAccepted, setCustomerAccepted] = useState(false)
  const [upgradePaymentMethod, setUpgradePaymentMethod] = useState('cash')
  const [saving, setSaving] = useState(false)
  const alreadyRedeemed = Boolean(member.redemption_invoice_id)
  // Same synchronous double-submit guard as the other SmartBuy action
  // modals — recordRedemption is itself already race-safe at the database
  // level (in-transaction re-check + atomic stock decrement), so this is
  // belt-and-braces UX rather than the only defense, unlike the
  // contribution modal.
  const submittingRef = useRef(false)

  useEffect(() => {
    window.api.products.list({ is_active: true }).then((res: { success: boolean; data?: Row[] }) => {
      if (res.success) setProducts(res.data || [])
    }).catch(() => {})
  }, [])

  const selectedProduct = products.find(p => p.id === productId)
  const unitPrice = Number(selectedProduct?.selling_price || 0)
  const taxRate = Number(selectedProduct?.tax_rate || 0)
  const estimatedTotal = Math.round(unitPrice * qty * (1 + taxRate / 100) * 100) / 100
  const isSubstitution = Boolean(schemeProductId && productId && schemeProductId !== productId)
  const upgradeAmount = Math.max(0, Math.round((estimatedTotal - schemeChitValue) * 100) / 100)
  const walletCreditAmount = Math.max(0, Math.round((schemeChitValue - estimatedTotal) * 100) / 100)

  const save = async () => {
    if (submittingRef.current) return
    if (!productId) { toast.error('Select a product from the catalog'); return }
    if (isSubstitution && !substitutionReason.trim()) { toast.error('Record a substitution reason — this differs from the scheme\'s own product'); return }
    if (isSubstitution && !customerAccepted) { toast.error('Customer acceptance is required before completing a substituted redemption'); return }
    if (upgradeAmount > 0 && !upgradePaymentMethod) { toast.error('Select how the customer paid the upgrade top-up'); return }
    submittingRef.current = true
    setSaving(true)
    try {
      const res = await window.api.chits.members.recordRedemption(member.id, {
        product_id: productId, qty,
        ...(isSubstitution ? { substitution_reason: substitutionReason.trim(), customer_accepted: customerAccepted } : {}),
        ...(upgradeAmount > 0 ? { upgrade_payment_method: upgradePaymentMethod } : {}),
      })
      if (res.success) { toast.success(`Redemption recorded — invoice ${res.data?.invoiceNumber || ''}`); onSave() }
      else toast.error(String(res.error || 'Failed to record redemption'))
    } catch (err: any) {
      toast.error(err.message || 'Failed to record redemption')
    } finally {
      submittingRef.current = false
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

  const canSave = Boolean(productId) && (!isSubstitution || (substitutionReason.trim() && customerAccepted)) && (upgradeAmount === 0 || Boolean(upgradePaymentMethod))

  return (
    <Modal title={`Record Redemption — ${(member.customer_name as string) || 'Member'}`} onClose={onClose}
      footer={<><button onClick={onClose} className="btn-secondary">Cancel</button><button onClick={save} disabled={saving || !canSave} className="btn-primary">{saving ? 'Saving...' : 'Record & Generate Invoice'}</button></>}>
      <div className="space-y-3">
        <p className="text-sm" style={{ color: 'var(--text-2)' }}>Entitled value: <strong>Rs.{money(schemeChitValue)}</strong> — recording this generates a real invoice and decrements stock. A mistake can only be corrected afterward via Super Admin's "Reverse Redemption".</p>
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1">Product *</label>
          <ProductSearchSelect products={products} value={productId} onChange={setProductId} />
        </div>
        <div><label className="block text-xs font-medium text-slate-400 mb-1">Quantity</label><input type="number" value={qty} onChange={e => setQty(Math.max(1, parseInt(e.target.value) || 1))} className="input" min={1} /></div>
        {productId && (
          <p className="text-xs" style={{ color: 'var(--text-3)' }}>
            Unit price Rs.{money(unitPrice)} × {qty} {taxRate > 0 ? `+ ${taxRate}% tax` : ''} = <strong>Rs.{money(estimatedTotal)}</strong>
          </p>
        )}
        {upgradeAmount > 0 && (
          <div className="rounded-lg border p-3 text-xs space-y-2" style={{ borderColor: '#f59e0b', background: 'color-mix(in srgb, #f59e0b 10%, transparent)' }}>
            <p style={{ color: 'var(--text-1)' }}>This product exceeds the entitlement by <strong>Rs.{money(upgradeAmount)}</strong> — a customer top-up payment (not a loan/installment), collected now, as part of this same redemption.</p>
            <div>
              <label className="block font-medium text-slate-400 mb-1">Upgrade payment method *</label>
              <select value={upgradePaymentMethod} onChange={e => setUpgradePaymentMethod(e.target.value)} className="input">
                <option value="cash">Cash</option>
                <option value="card">Card</option>
                <option value="bank_transfer">Bank Transfer</option>
              </select>
            </div>
          </div>
        )}
        {walletCreditAmount > 0 && (
          <div className="rounded-lg border p-3 text-xs" style={{ borderColor: 'var(--brand-primary)', background: 'color-mix(in srgb, var(--brand-primary) 8%, transparent)' }}>
            <p style={{ color: 'var(--text-1)' }}>This product is below the entitlement — the remaining <strong>Rs.{money(walletCreditAmount)}</strong> is carried to the customer's SmartBuy Wallet as credit (never cash) for a future purchase.</p>
          </div>
        )}
        {isSubstitution && (
          <div className="rounded-lg border p-3 text-xs space-y-2" style={{ borderColor: '#ef4444', background: 'color-mix(in srgb, #ef4444 8%, transparent)' }}>
            <p style={{ color: 'var(--text-1)' }}>This differs from the scheme's own product — a substitution reason and customer acceptance are required before this redemption can complete.</p>
            <div>
              <label className="block font-medium text-slate-400 mb-1">Substitution reason *</label>
              <textarea value={substitutionReason} onChange={e => setSubstitutionReason(e.target.value)} className="input h-16 resize-none" placeholder="e.g. original product out of stock" />
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={customerAccepted} onChange={e => setCustomerAccepted(e.target.checked)} className="w-4 h-4" />
              <span style={{ color: 'var(--text-2)' }}>Customer has accepted this substituted product</span>
            </label>
          </div>
        )}
      </div>
    </Modal>
  )
}

function ExtendClaimModal({ member, onClose, onSave }: { member: Row; onClose: () => void; onSave: () => void }) {
  const [newDueDate, setNewDueDate] = useState(() => {
    const base = member.claim_due_date ? new Date(String(member.claim_due_date)) : new Date()
    base.setDate(base.getDate() + 30)
    return base.toISOString().slice(0, 10)
  })
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const submittingRef = useRef(false)

  const save = async () => {
    if (submittingRef.current) return
    if (!reason.trim()) { toast.error('An extension reason is required'); return }
    submittingRef.current = true
    setSaving(true)
    try {
      const res = await window.api.chits.members.extendClaim(member.id, newDueDate, reason.trim())
      if (res.success) { toast.success('Claim reminder date extended'); onSave() }
      else toast.error(String(res.error || 'Failed to extend claim date'))
    } catch (err: any) {
      toast.error(err.message || 'Failed to extend claim date')
    } finally {
      submittingRef.current = false
      setSaving(false)
    }
  }

  return (
    <Modal title={`Extend Claim — ${(member.customer_name as string) || 'Member'}`} onClose={onClose}
      footer={<><button onClick={onClose} className="btn-secondary">Cancel</button><button onClick={save} disabled={saving} className="btn-primary">{saving ? 'Saving...' : 'Extend'}</button></>}>
      <div className="space-y-3">
        <p className="text-sm" style={{ color: 'var(--text-2)' }}>
          The entitlement never expires — this only resets the soft reminder so the claim stops showing as delayed. Current due date: <strong>{member.claim_due_date ? new Date(String(member.claim_due_date)).toLocaleDateString() : '—'}</strong>
        </p>
        <div><label className="block text-xs font-medium text-slate-400 mb-1">New claim due date *</label><input type="date" value={newDueDate} onChange={e => setNewDueDate(e.target.value)} className="input" /></div>
        <div><label className="block text-xs font-medium text-slate-400 mb-1">Extension reason *</label><textarea value={reason} onChange={e => setReason(e.target.value)} className="input h-20 resize-none" placeholder="Required for the audit trail" /></div>
      </div>
    </Modal>
  )
}

function TransferWinnerModal({ member, onClose, onSave }: { member: Row; onClose: () => void; onSave: () => void }) {
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState<Row[]>([])
  const [selectedCustomer, setSelectedCustomer] = useState<Row | null>(null)
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const submittingRef = useRef(false)

  useEffect(() => {
    if (!query.trim() || selectedCustomer) { setMatches([]); return }
    const t = setTimeout(async () => {
      try {
        const res = await window.api.customers.search(query.trim())
        if (res.success) setMatches(res.data as Row[])
      } catch { /* ignore */ }
    }, 300)
    return () => clearTimeout(t)
  }, [query, selectedCustomer])

  const save = async () => {
    if (submittingRef.current) return
    if (!selectedCustomer) { toast.error('Select the recipient customer'); return }
    if (!reason.trim()) { toast.error('A transfer reason is required'); return }
    submittingRef.current = true
    setSaving(true)
    try {
      const res = await window.api.chits.members.transfer(member.id, selectedCustomer.id, reason.trim())
      if (res.success) { toast.success('Winner entitlement transferred'); onSave() }
      else toast.error(String(res.error || 'Failed to transfer winner entitlement'))
    } catch (err: any) {
      toast.error(err.message || 'Failed to transfer winner entitlement')
    } finally {
      submittingRef.current = false
      setSaving(false)
    }
  }

  return (
    <Modal title={`Transfer Winner Entitlement — ${(member.customer_name as string) || 'Original Winner'}`} onClose={onClose}
      footer={<><button onClick={onClose} className="btn-secondary">Cancel</button><button onClick={save} disabled={saving} className="btn-primary">{saving ? 'Transferring...' : 'Approve Transfer'}</button></>}>
      <div className="space-y-3">
        <p className="text-sm" style={{ color: 'var(--text-2)' }}>
          Exceptional, Super Admin-only action. The original winner (<strong>{(member.customer_name as string) || '—'}</strong>), draw history, and scheme winner record are never changed — this only records who will actually claim the product.
        </p>
        {selectedCustomer ? (
          <div className="flex items-center justify-between rounded-lg border p-2" style={{ borderColor: 'var(--border)' }}>
            <span className="text-sm">{selectedCustomer.name as string} — {selectedCustomer.phone as string}</span>
            <button onClick={() => { setSelectedCustomer(null); setQuery('') }} className="btn-ghost btn-sm">Change</button>
          </div>
        ) : (
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Recipient customer *</label>
            <input value={query} onChange={e => setQuery(e.target.value)} className="input" placeholder="Search by name or phone..." />
            {matches.length > 0 && (
              <div className="mt-1 rounded-lg border divide-y max-h-40 overflow-auto" style={{ borderColor: 'var(--border)' }}>
                {matches.map(c => (
                  <button key={c.id as string} onClick={() => { setSelectedCustomer(c); setMatches([]) }} className="w-full text-left px-3 py-2 text-sm hover:bg-white/5">
                    {c.name as string} — {c.phone as string}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <div><label className="block text-xs font-medium text-slate-400 mb-1">Transfer reason *</label><textarea value={reason} onChange={e => setReason(e.target.value)} className="input h-20 resize-none" placeholder="Required for the audit trail" /></div>
      </div>
    </Modal>
  )
}

function ReverseRedemptionModal({ member, onClose, onSave }: { member: Row; onClose: () => void; onSave: () => void }) {
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const submittingRef = useRef(false)

  const save = async () => {
    if (submittingRef.current) return
    if (!reason.trim()) { toast.error('A reversal reason is required'); return }
    submittingRef.current = true
    setSaving(true)
    try {
      const res = await window.api.chits.members.reverseRedemption(member.id, reason.trim())
      if (res.success) { toast.success('Redemption reversed — the member is now won and unclaimed again'); onSave() }
      else toast.error(String(res.error || 'Failed to reverse redemption'))
    } catch (err: any) {
      toast.error(err.message || 'Failed to reverse redemption')
    } finally {
      submittingRef.current = false
      setSaving(false)
    }
  }

  return (
    <Modal title={`Reverse Redemption — ${(member.customer_name as string) || 'Member'}`} onClose={onClose}
      footer={<><button onClick={onClose} className="btn-secondary">Cancel</button><button onClick={save} disabled={saving} className="btn-primary">{saving ? 'Reversing...' : 'Reverse'}</button></>}>
      <div className="space-y-3">
        <p className="text-sm" style={{ color: 'var(--text-2)' }}>
          This voids invoice <strong>{(member.redeemed_product_name as string) || '—'}</strong> × {member.redeemed_qty as number}, reverses the stock deduction, cancels any commission earned on it, and claws back any SmartBuy Wallet credit it created. The member stays a winner — just unclaimed again, so staff can redo the redemption.
        </p>
        <div><label className="block text-xs font-medium text-slate-400 mb-1">Reversal reason *</label><textarea value={reason} onChange={e => setReason(e.target.value)} className="input h-20 resize-none" placeholder="Required for the audit trail" /></div>
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
