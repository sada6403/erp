import { useRef, useState } from 'react'
import { manualHoldNumber } from '../../../electron/lib/holdNumber'

export default function HoldNumberModal({ onSubmit, onClose }: { onSubmit: (number: string) => Promise<void>; onClose: () => void }) {
  const [number, setNumber] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const submitting = useRef(false)
  const input = useRef<HTMLInputElement>(null)
  return <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/70" role="dialog" aria-modal="true" aria-label="Hold bill">
    <form className="bg-surface-800 rounded-xl p-6 space-y-4 w-full max-w-sm border" style={{ borderColor: 'var(--border)' }}
      onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!submitting.current) onClose() } }}
      onSubmit={async event => {
        event.preventDefault()
        if (submitting.current) return
        try {
          const value = manualHoldNumber(number)
          submitting.current = true; setBusy(true); setError('')
          await onSubmit(value)
        } catch (err) {
          setError((err as Error).message)
          input.current?.focus(); input.current?.select()
        } finally { submitting.current = false; setBusy(false) }
      }}>
      <h2 className="font-semibold text-lg">Hold bill</h2>
      <label htmlFor="cashier-hold-number" className="block">Enter hold number</label>
      <input ref={input} id="cashier-hold-number" autoFocus className="input text-xl" inputMode="numeric" maxLength={12}
        value={number} onChange={event => setNumber(event.target.value)} disabled={busy} placeholder="For example: 25" />
      <p className="text-xs text-slate-400">Use this same number in F5 to resume the bill.</p>
      {error ? <p role="alert" className="text-sm text-red-400">{error}</p> : null}
      <div className="flex gap-2">
        <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Hold (Enter)'}</button>
        <button type="button" className="btn-secondary" disabled={busy} onClick={onClose}>Cancel (Esc)</button>
      </div>
    </form>
  </div>
}
