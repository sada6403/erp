// Smart Buy — pending bank-transfer contribution verification.
// Mirrors InstallmentsPage.tsx's BankTransfersTab: same list/verify pattern,
// backed by the already-existing chits:contributions:pendingTransfers /
// chits:contributions:verify handlers (electron/ipc/chits.ts) which already
// handle balance/credit updates, audit logging, and sync — this page just
// wires the UI up to them, no new backend logic.
import { useState, useEffect, useCallback } from 'react'
import PageHeader from '@/components/shared/PageHeader'
import Modal from '@/components/shared/Modal'
import { CheckCircle2, XCircle, Phone, RefreshCw } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuthStore } from '@/store/authStore'

type Row = Record<string, unknown>

const fmt = (n: unknown) => Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const dateFmt = (d: string) => d ? new Date(d).toLocaleString() : '—'

export default function SmartBuyBankTransfersPage() {
  const { user } = useAuthStore()
  const isAdmin = Boolean((user?.role?.permissions as Record<string, unknown>)?.all)

  const [branches, setBranches] = useState<Row[]>([])
  const [branchId, setBranchId] = useState('')
  const [transfers, setTransfers] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [verifying, setVerifying] = useState<{ id: string; action: 'approve' | 'reject' } | null>(null)
  const [notes, setNotes] = useState('')

  useEffect(() => {
    if (!isAdmin) return
    window.api.admin.branches.list().then((r: { success: boolean; data?: Row[] }) => {
      if (r.success) setBranches(r.data || [])
    }).catch(() => {})
  }, [isAdmin])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await window.api.chits.contributions.pendingTransfers(branchId ? { branch_id: branchId } : {})
      if (r.success) setTransfers(r.data as Row[])
      else toast.error(r.error || 'Failed to load pending transfers')
    } catch {
      toast.error('Failed to load pending transfers')
    } finally {
      setLoading(false)
    }
  }, [branchId])

  useEffect(() => { load() }, [load])

  const verify = async () => {
    if (!verifying) return
    try {
      const r = await window.api.chits.contributions.verify(verifying.id, verifying.action, notes)
      if (r.success) {
        toast.success(verifying.action === 'approve' ? 'Payment approved ✅' : 'Payment rejected')
        setVerifying(null); setNotes('')
        load()
      } else {
        toast.error(r.error || 'Failed')
      }
    } catch {
      toast.error('Failed to verify payment')
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader
        title="Smart Buy Bank Transfers"
        subtitle="Confirm or reject pending bank-transfer contributions"
      />

      <div className="flex-1 overflow-auto px-6 py-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>Pending Bank Transfer Verification</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>
              {transfers.length} payment{transfers.length !== 1 ? 's' : ''} awaiting approval
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isAdmin && (
              <select value={branchId} onChange={e => setBranchId(e.target.value)} className="input w-48 text-xs">
                <option value="">All Branches</option>
                {branches.map(b => <option key={b.id as string} value={b.id as string}>{b.name as string}</option>)}
              </select>
            )}
            <button onClick={load} className="btn-secondary gap-1.5 text-xs"><RefreshCw size={12} /> Refresh</button>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-16 text-sm" style={{ color: 'var(--text-3)' }}>Loading…</div>
        ) : transfers.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3" style={{ color: 'var(--text-3)' }}>
            <CheckCircle2 size={40} className="opacity-30 text-green-500" />
            <p className="text-sm">No pending bank transfers</p>
          </div>
        ) : (
          <div className="space-y-3">
            {transfers.map(t => (
              <div key={t.id as string} className="card">
                <div className="flex items-start gap-4">
                  <div className="flex-1 grid grid-cols-5 gap-3">
                    <div>
                      <p className="text-[10px]" style={{ color: 'var(--text-3)' }}>Customer</p>
                      <p className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>{(t.customer_name as string) || '—'}</p>
                      {(t.customer_phone as string) && (
                        <p className="text-[10px] flex items-center gap-1 mt-0.5" style={{ color: 'var(--text-3)' }}>
                          <Phone size={9} />{t.customer_phone as string}
                        </p>
                      )}
                    </div>
                    <div>
                      <p className="text-[10px]" style={{ color: 'var(--text-3)' }}>Scheme</p>
                      <p className="text-xs font-mono text-blue-400">{(t.scheme_name as string) || '—'}</p>
                    </div>
                    <div>
                      <p className="text-[10px]" style={{ color: 'var(--text-3)' }}>Amount</p>
                      <p className="text-base font-black text-green-500">{fmt(t.amount)}</p>
                    </div>
                    <div>
                      <p className="text-[10px]" style={{ color: 'var(--text-3)' }}>Date Submitted</p>
                      <p className="text-xs" style={{ color: 'var(--text-2)' }}>{dateFmt(t.paid_at as string)}</p>
                      {(t.reference as string) && (
                        <p className="text-[10px] mt-0.5 font-mono" style={{ color: 'var(--text-3)' }}>Ref: {t.reference as string}</p>
                      )}
                    </div>
                    <div>
                      <p className="text-[10px]" style={{ color: 'var(--text-3)' }}>Cycle</p>
                      <p className="text-xs" style={{ color: 'var(--text-2)' }}>{t.cycle_no != null ? `#${t.cycle_no}` : '—'}</p>
                    </div>
                  </div>
                  <div className="flex flex-col gap-2 shrink-0">
                    <button
                      onClick={() => { setVerifying({ id: t.id as string, action: 'approve' }); setNotes('') }}
                      className="btn-success btn-sm gap-1 text-xs px-3">
                      <CheckCircle2 size={12} /> Confirm
                    </button>
                    <button
                      onClick={() => { setVerifying({ id: t.id as string, action: 'reject' }); setNotes('') }}
                      className="btn-danger btn-sm gap-1 text-xs px-3">
                      <XCircle size={12} /> Reject
                    </button>
                  </div>
                </div>
                {(t.notes as string) && (
                  <div className="mt-2 pt-2 border-t text-xs" style={{ borderColor: 'var(--border)', color: 'var(--text-3)' }}>
                    Note: {t.notes as string}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {verifying && (
        <Modal
          title={verifying.action === 'approve' ? 'Confirm Bank Transfer' : 'Reject Bank Transfer'}
          onClose={() => setVerifying(null)}
          footer={
            <>
              <button onClick={() => setVerifying(null)} className="btn-secondary">Cancel</button>
              <button onClick={verify} className={verifying.action === 'approve' ? 'btn-success' : 'btn-danger'}>
                {verifying.action === 'approve' ? 'Confirm Received' : 'Confirm Rejection'}
              </button>
            </>
          }>
          <div className="space-y-3">
            <div className={`rounded-lg p-3 text-sm flex items-center gap-2 ${verifying.action === 'approve' ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
              {verifying.action === 'approve'
                ? <><CheckCircle2 size={14} /> This payment will be <strong>confirmed as received</strong> and applied to the member's cycle balance.</>
                : <><XCircle size={14} /> This payment will be marked <strong>rejected / not received</strong>. It stays visible with this reason, not deleted.</>}
            </div>
            <div>
              <label className="label">Notes / Reason {verifying.action === 'reject' ? '(Required)' : '(Optional)'}</label>
              <textarea value={notes} onChange={e => setNotes(e.target.value)}
                className="input w-full resize-none" rows={3}
                placeholder={verifying.action === 'reject' ? 'Reason for rejection…' : 'Optional confirmation notes…'} />
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
