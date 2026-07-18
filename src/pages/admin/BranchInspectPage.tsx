import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import PageHeader from '@/components/shared/PageHeader'
import { GitBranch, ChevronRight } from 'lucide-react'
import toast from 'react-hot-toast'

type Branch = Record<string, unknown>

export default function BranchInspectPage() {
  const navigate = useNavigate()
  const [branches, setBranches] = useState<Branch[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    (async () => {
      setLoading(true)
      try {
        const res = await window.api.admin.branches.list()
        if (res.success) setBranches(res.data as Branch[])
        else toast.error(res.error || 'Failed to load branches')
      } catch (err) {
        toast.error((err as Error).message || 'Failed to load branches')
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  const isMain = (b: Branch) => b.id === 'b1111111-1111-4111-8111-111111111111'

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader title="Branch Inspect" subtitle="Click a branch to view its live sales, profit, and staff performance" />

      <div className="flex-1 overflow-auto p-6">
        {loading ? (
          <div className="text-center py-16" style={{ color: 'var(--text-3)' }}>Loading…</div>
        ) : branches.length === 0 ? (
          <div className="text-center py-16" style={{ color: 'var(--text-3)' }}>No branches found</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {branches.map(b => (
              <button
                key={b.id as string}
                onClick={() => navigate(`/admin/branch-inspect/${b.id as string}`)}
                className={`card text-left hover:border-slate-600 transition-colors flex items-start justify-between gap-3 ${isMain(b) ? 'border-brand-500/40' : ''}`}
              >
                <div className="flex items-start gap-3 min-w-0">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${isMain(b) ? 'bg-brand-500/30' : 'bg-brand-600/20'}`}>
                    <GitBranch size={18} className="text-brand-400" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-bold truncate" style={{ color: 'var(--text-1)' }}>{b.name as string}</h3>
                      {isMain(b) && <span className="px-1.5 py-0.5 bg-amber-500/20 text-amber-300 text-xs rounded flex-shrink-0">Head Office</span>}
                    </div>
                    <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>
                      Manager: {String(b.manager_name || 'Unassigned')}
                    </p>
                    <p className="text-xs" style={{ color: b.is_active ? 'var(--text-3)' : '#f87171' }}>
                      {b.is_active ? 'Active' : 'Inactive'}
                    </p>
                  </div>
                </div>
                <ChevronRight size={16} className="flex-shrink-0 mt-2" style={{ color: 'var(--text-3)' }} />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
