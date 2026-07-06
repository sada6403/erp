import { useState, useEffect } from 'react'
import { Plus, Search, Eye, Filter } from 'lucide-react'
import { Link } from 'react-router-dom'

interface Transfer {
  id: string
  transfer_number: string
  from_branch_name: string
  to_branch_name: string
  status: string
  created_at: string
}

export default function BranchTransfersPage() {
  const [transfers, setTransfers] = useState<Transfer[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  useEffect(() => {
    loadTransfers()
  }, [])

  async function loadTransfers() {
    try {
      setLoading(true)
      const res = await window.api.branchTransfers.list()
      if (!res.success) throw new Error(res.error)
      setTransfers(res.data)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const filtered = transfers.filter(t => 
    t.transfer_number.toLowerCase().includes(search.toLowerCase()) ||
    t.from_branch_name?.toLowerCase().includes(search.toLowerCase()) ||
    t.to_branch_name?.toLowerCase().includes(search.toLowerCase())
  )

  const getStatusColor = (status: string) => {
    switch(status) {
      case 'draft': return 'bg-slate-500/20 text-slate-400'
      case 'dispatched': return 'bg-blue-500/20 text-blue-400'
      case 'partially_received': return 'bg-amber-500/20 text-amber-400'
      case 'received': return 'bg-emerald-500/20 text-emerald-400'
      case 'discrepancy': 
      case 'under_admin_review': return 'bg-rose-500/20 text-rose-400'
      case 'corrected': return 'bg-purple-500/20 text-purple-400'
      default: return 'bg-slate-500/20 text-slate-400'
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-white">Branch Transfers</h1>
          <p className="text-slate-400 text-sm mt-1">Manage stock transfers between branches</p>
        </div>
        <Link 
          to="/admin/branch-transfers/new"
          className="flex items-center gap-2 bg-brand-600 hover:bg-brand-500 text-white px-4 py-2 rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          <span>New Transfer</span>
        </Link>
      </div>

      <div className="bg-surface-800 rounded-xl border border-surface-700 flex flex-col min-h-[500px]">
        <div className="p-4 border-b border-surface-700 flex gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input 
              type="text" 
              placeholder="Search by transfer number or branch..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full bg-surface-900 border border-surface-600 text-white pl-10 pr-4 py-2 rounded-lg focus:outline-none focus:border-brand-500"
            />
          </div>
          <button className="flex items-center gap-2 px-4 py-2 bg-surface-900 border border-surface-600 rounded-lg text-slate-300 hover:text-white transition-colors">
            <Filter className="w-4 h-4" />
            <span>Filter</span>
          </button>
        </div>

        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <div className="w-8 h-8 border-4 border-brand-500 border-t-transparent rounded-full animate-spin"></div>
            </div>
          ) : error ? (
            <div className="flex items-center justify-center h-full text-rose-400">
              {error}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex items-center justify-center h-full text-slate-400">
              No branch transfers found
            </div>
          ) : (
            <table className="w-full text-left border-collapse min-w-[800px]">
              <thead>
                <tr className="border-b border-surface-700 bg-surface-900/50">
                  <th className="p-4 text-sm font-medium text-slate-400">Transfer No</th>
                  <th className="p-4 text-sm font-medium text-slate-400">Date</th>
                  <th className="p-4 text-sm font-medium text-slate-400">From Branch</th>
                  <th className="p-4 text-sm font-medium text-slate-400">To Branch</th>
                  <th className="p-4 text-sm font-medium text-slate-400">Status</th>
                  <th className="p-4 text-sm font-medium text-slate-400 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-700">
                {filtered.map(t => (
                  <tr key={t.id} className="hover:bg-surface-700/50 transition-colors">
                    <td className="p-4 text-sm text-white font-medium">{t.transfer_number}</td>
                    <td className="p-4 text-sm text-slate-300">{new Date(t.created_at).toLocaleDateString()}</td>
                    <td className="p-4 text-sm text-slate-300">{t.from_branch_name}</td>
                    <td className="p-4 text-sm text-slate-300">{t.to_branch_name}</td>
                    <td className="p-4">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(t.status)}`}>
                        {t.status.replace(/_/g, ' ').toUpperCase()}
                      </span>
                    </td>
                    <td className="p-4 text-right">
                      <Link 
                        to={`/admin/branch-transfers/${t.id}`}
                        className="inline-flex items-center gap-1 text-brand-400 hover:text-brand-300 transition-colors"
                      >
                        <Eye className="w-4 h-4" />
                        <span className="text-sm">View</span>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
