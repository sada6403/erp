import React, { useState, useEffect, useCallback } from 'react'
import { RefreshCw, AlertTriangle, X, CheckCircle, WifiOff } from 'lucide-react'
import toast from 'react-hot-toast'

interface PendingItem {
  id: string
  table_name: string
  record_id: string
  action: string
  record_name?: string
  product_name?: string
  record_sku?: string
  product_sku?: string
  detected_at: string
  deleted_at: string
  status: string
}

export default function ProductSyncModal() {
  const [pendingItems, setPendingItems] = useState<PendingItem[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const [isSnoozed, setIsSnoozed] = useState(false)
  const [syncState, setSyncState] = useState<'IDLE' | 'SYNCING' | 'SUCCESS' | 'FAILED'>('IDLE')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const loadPending = useCallback(async () => {
    try {
      if (!window.api?.sync?.getPendingDeletions) return
      const res = await window.api.sync.getPendingDeletions()
      if (res?.success && Array.isArray(res.data)) {
        const items = res.data.filter((item: PendingItem) => item.status === 'pending')
        setPendingItems(items)
        if (items.length > 0 && !isSnoozed) {
          setIsOpen(true)
        } else if (items.length === 0) {
          setIsOpen(false)
        }
      }
    } catch (err) {
      console.error('Failed to load pending sync deletions:', err)
    }
  }, [isSnoozed])

  useEffect(() => {
    loadPending()

    const unsubs: Array<() => void> = []

    if (window.api?.sync?.onPendingDeletions) {
      const unsub = window.api.sync.onPendingDeletions((item: unknown) => {
        // When new deletion/deactivation arrives from sync service
        setSyncState('IDLE')
        setErrorMessage(null)
        setIsSnoozed(false)
        loadPending()
      })
      if (unsub) unsubs.push(unsub)
    }

    if (window.api?.sync?.onPendingDeletionsUpdated) {
      const unsub = window.api.sync.onPendingDeletionsUpdated(() => {
        loadPending()
      })
      if (unsub) unsubs.push(unsub)
    }

    return () => {
      unsubs.forEach(fn => fn())
    }
  }, [loadPending])

  const handleRefresh = async () => {
    if (syncState === 'SYNCING') return
    setSyncState('SYNCING')
    setErrorMessage(null)

    try {
      const res = await window.api.sync.refreshWithDeletions()
      if (res?.success) {
        setSyncState('SUCCESS')
        toast.success(res.message || 'Synchronization complete.')
        setTimeout(() => {
          setIsOpen(false)
          setSyncState('IDLE')
          loadPending()
        }, 1200)
      } else {
        setSyncState('FAILED')
        const err = res?.error || 'Synchronization failed. Please check network connectivity.'
        setErrorMessage(err)
        toast.error(err)
      }
    } catch (err) {
      setSyncState('FAILED')
      const msg = (err as Error).message || 'Server unavailable or connection timed out.'
      setErrorMessage(msg)
      toast.error(msg)
    }
  }

  const handleLater = () => {
    // Requirement 8 Test B: User clicks Cancel/Later -> local product remains, pending status remembered
    setIsSnoozed(true)
    setIsOpen(false)
  }

  if (!isOpen || pendingItems.length === 0) {
    // If snoozed and has items, show subtle header banner/badge trigger
    if (pendingItems.length > 0 && isSnoozed) {
      return (
        <div
          onClick={() => { setIsSnoozed(false); setIsOpen(true) }}
          className="fixed bottom-4 right-4 z-[990] flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold cursor-pointer shadow-lg transition-transform hover:scale-105"
          style={{
            background: 'var(--bg-card)',
            border: '1px solid #f59e0b',
            color: '#f59e0b',
            boxShadow: '0 4px 14px rgba(245, 158, 11, 0.2)'
          }}
          title="Click to review online changes and synchronize"
        >
          <AlertTriangle size={15} className="animate-pulse" />
          <span>{pendingItems.length} server change(s) pending sync</span>
          <span className="ml-1 underline">Review</span>
        </div>
      )
    }
    return null
  }

  return (
    <div
      className="fixed inset-0 z-[999] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(5px)' }}
    >
      <div
        className="w-full max-w-md rounded-2xl p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-200"
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          color: 'var(--text-1)'
        }}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div
              className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0"
              style={{
                background: 'rgba(245, 158, 11, 0.12)',
                border: '1px solid rgba(245, 158, 11, 0.3)'
              }}
            >
              <AlertTriangle size={24} className="text-amber-500" />
            </div>
            <div>
              <h3 className="text-base font-bold leading-tight" style={{ color: 'var(--text-1)' }}>
                Product Changes Available
              </h3>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>
                Online updates detected from Main Branch / Server
              </p>
            </div>
          </div>
          <button
            onClick={handleLater}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition"
            title="Dismiss for now"
          >
            <X size={16} />
          </button>
        </div>

        {/* Message body */}
        <div className="mt-4 p-3.5 rounded-xl text-sm" style={{ background: 'var(--bg-page)', border: '1px solid var(--border)' }}>
          <p className="text-xs font-medium leading-relaxed" style={{ color: 'var(--text-2)' }}>
            The following product(s) were deleted or deactivated online.
            Please refresh to synchronize the latest data and keep local records consistent.
          </p>

          {/* Affected items list */}
          <div className="mt-3 max-h-40 overflow-y-auto space-y-1.5 pr-1">
            {pendingItems.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between p-2 rounded-lg text-xs"
                style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}
              >
                <div className="truncate mr-2">
                  <span className="font-semibold block truncate" style={{ color: 'var(--text-1)' }}>
                    {item.record_name || item.product_name || 'Unnamed Product'}
                  </span>
                  <span className="text-[10px] font-mono" style={{ color: 'var(--text-3)' }}>
                    SKU: {item.record_sku || item.product_sku || 'N/A'}
                  </span>
                </div>
                <span
                  className="px-2 py-0.5 rounded text-[10px] font-bold shrink-0 uppercase tracking-wider"
                  style={{
                    background: item.action === 'delete' ? 'rgba(239, 68, 68, 0.15)' : 'rgba(245, 158, 11, 0.15)',
                    color: item.action === 'delete' ? '#ef4444' : '#f59e0b',
                    border: `1px solid ${item.action === 'delete' ? 'rgba(239, 68, 68, 0.3)' : 'rgba(245, 158, 11, 0.3)'}`
                  }}
                >
                  {item.action === 'delete' ? 'Deleted Online' : 'Deactivated Online'}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Error notice if refresh failed */}
        {errorMessage && (
          <div
            className="mt-3 p-2.5 rounded-xl text-xs flex items-center gap-2"
            style={{ background: 'rgba(239, 68, 68, 0.12)', border: '1px solid rgba(239, 68, 68, 0.25)', color: '#ef4444' }}
          >
            <WifiOff size={14} className="shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Success confirmation */}
        {syncState === 'SUCCESS' && (
          <div
            className="mt-3 p-2.5 rounded-xl text-xs flex items-center gap-2"
            style={{ background: 'rgba(34, 197, 94, 0.12)', border: '1px solid rgba(34, 197, 94, 0.25)', color: '#22c55e' }}
          >
            <CheckCircle size={14} className="shrink-0" />
            <span>Synchronization successful. Applying latest records...</span>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex items-center gap-3 mt-5">
          <button
            type="button"
            onClick={handleLater}
            disabled={syncState === 'SYNCING'}
            className="flex-1 py-2.5 rounded-xl font-semibold text-xs transition border"
            style={{
              background: 'transparent',
              borderColor: 'var(--border)',
              color: 'var(--text-2)'
            }}
          >
            Cancel / Later
          </button>

          <button
            type="button"
            onClick={handleRefresh}
            disabled={syncState === 'SYNCING'}
            className="flex-1 py-2.5 rounded-xl font-semibold text-xs text-white flex items-center justify-center gap-2 transition"
            style={{
              background: 'linear-gradient(135deg, #4f46e5, #4338ca)',
              boxShadow: '0 4px 12px rgba(79, 70, 229, 0.35)',
              opacity: syncState === 'SYNCING' ? 0.75 : 1
            }}
          >
            <RefreshCw size={14} className={syncState === 'SYNCING' ? 'animate-spin' : ''} />
            <span>{syncState === 'SYNCING' ? 'Synchronizing...' : 'Refresh'}</span>
          </button>
        </div>
      </div>
    </div>
  )
}
