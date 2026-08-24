import { useState } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'

// Multi-device forced lock screen (Issue 30). Rendered as a full top-level
// replacement of the entire render tree (see App.tsx) — nothing else
// mounts while this is shown, so there is nothing else in the app for a
// click or keyboard shortcut to reach. Exactly one interactive element by
// design: the Refresh button.
export default function DataClearedLockScreen({ onUnlocked }: { onUnlocked: () => void }) {
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')

  async function handleRefresh() {
    setRefreshing(true)
    setError('')
    try {
      const res = await window.api.app.refreshAfterClear() as { success: boolean; error?: string }
      if (res.success) {
        onUnlocked()
      } else {
        setError(res.error || 'Failed to refresh — please try again')
      }
    } catch (err) {
      setError((err as Error)?.message || 'Failed to refresh — please try again')
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-6" style={{ background: '#0a0e14' }}>
      <div className="w-full max-w-md text-center">
        <div className="mx-auto mb-6 w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center">
          <AlertTriangle size={32} className="text-red-400" />
        </div>
        <h1 className="text-xl font-bold text-white mb-3">Data Was Cleared</h1>
        <p className="text-sm text-slate-400 mb-8 leading-relaxed">
          An administrator cleared all data for this company. This device's local data no longer
          matches the current state and must be refreshed before it can be used again.
        </p>

        {error && (
          <div className="mb-4 px-4 py-3 rounded-lg text-sm text-red-300 bg-red-500/10 border border-red-500/30">
            {error}
          </div>
        )}

        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-lg text-white font-semibold text-sm disabled:opacity-60"
          style={{ background: 'linear-gradient(135deg,#dc2626,#991b1b)' }}
        >
          <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
    </div>
  )
}
