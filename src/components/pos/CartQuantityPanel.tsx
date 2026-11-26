import { useEffect, useRef, useState } from 'react'
import { Scale, X } from 'lucide-react'
import type { Product } from '@/types'
import { parsePosQuantity } from '@/lib/posQuantity'

/** Quick amounts per base unit. Typed in the product's own unit after conversion. */
const PRESETS: Record<string, string[]> = {
  kg: ['250g', '500g', '1kg', '2kg'],
  g: ['100g', '250g', '500g', '1000g'],
  l: ['250ml', '500ml', '1l', '2l'],
  ml: ['100ml', '250ml', '500ml', '1000ml'],
  m: ['50cm', '1m', '2m', '5m'],
  cm: ['10cm', '50cm', '100cm', '200cm'],
  mm: ['100mm', '250mm', '500mm', '1000mm'],
}

interface Props {
  product: Product
  initialText?: string
  mode: 'add' | 'edit'
  onSubmit: (quantity: number) => void
  onCancel: () => void
}

const round = (value: number) => Math.round(value * 1e6) / 1e6

/**
 * Docked in the cart sidebar so the cashier never loses sight of the bill.
 * Enter = confirm, Esc = cancel, Alt+1..4 = quick amounts.
 */
export default function CartQuantityPanel({ product, initialText = '', mode, onSubmit, onCancel }: Props) {
  const [text, setText] = useState(initialText)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const unit = (product.unit || 'pcs').toLowerCase()
  const presets = PRESETS[unit] || []
  const price = Number(product.selling_price ?? (product as { price?: number }).price ?? 0)

  useEffect(() => {
    setText(initialText); setError('')
    requestAnimationFrame(() => { inputRef.current?.focus(); inputRef.current?.select() })
  }, [product.id, initialText])

  let preview: number | null = null
  try { preview = text.trim() ? parsePosQuantity(text, unit) : null } catch { preview = null }

  const submit = (value = text) => {
    try { onSubmit(round(parsePosQuantity(value, unit))) }
    catch (err) { setError((err as Error).message); inputRef.current?.focus() }
  }

  return (
    <form
      role="dialog"
      aria-label="Product quantity"
      className="mx-3 mt-2 rounded-xl border-2 border-brand-500/60 p-3 space-y-2"
      style={{ background: 'var(--surface-2, rgba(30,41,59,.9))' }}
      onSubmit={e => { e.preventDefault(); submit() }}
    >
      <div className="flex items-center gap-2">
        <Scale size={15} className="text-brand-400 shrink-0" />
        <span className="text-sm font-semibold truncate" style={{ color: 'var(--text-1)' }}>{product.name}</span>
        <span className="text-[11px] px-1.5 py-0.5 rounded bg-surface-700/60 text-slate-300">{unit}</span>
        <button type="button" onClick={onCancel} className="ml-auto p-1 text-[var(--text-3)] hover:text-red-500" title="Cancel (Esc)" aria-label="Cancel quantity">
          <X size={14} />
        </button>
      </div>
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          id="pos-measured-quantity"
          aria-label={`Quantity in ${unit}`}
          className="input flex-1 text-lg font-bold"
          inputMode="decimal"
          autoComplete="off"
          value={text}
          placeholder={presets.length ? `e.g. 1.25 or ${presets[1]}` : 'Quantity'}
          onChange={e => { setText(e.target.value); setError('') }}
          onKeyDown={e => {
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancel(); return }
            if (e.altKey && /^[1-4]$/.test(e.key) && presets[Number(e.key) - 1]) {
              e.preventDefault(); submit(presets[Number(e.key) - 1])
            }
          }}
        />
        <button type="submit" className="btn-primary whitespace-nowrap">{mode === 'edit' ? 'Update' : 'Add'} ⏎</button>
      </div>
      <div className="flex items-center justify-between text-xs" style={{ color: 'var(--text-3)' }}>
        <span>{preview != null ? `${round(preview)} ${unit}` : `Price Rs.${price.toLocaleString()} / ${unit}`}</span>
        {preview != null && <span className="font-semibold" style={{ color: 'var(--text-1)' }}>Rs.{(Math.round(preview * price * 100) / 100).toLocaleString()}</span>}
      </div>
      {presets.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {presets.map((preset, idx) => (
            <button key={preset} type="button" tabIndex={-1} className="btn-secondary btn-sm" onClick={() => submit(preset)}>
              <kbd className="kbd text-[9px] mr-1">Alt+{idx + 1}</kbd>{preset}
            </button>
          ))}
        </div>
      )}
      {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
      <p className="text-[10px]" style={{ color: 'var(--text-3)' }}><kbd className="kbd text-[9px]">Enter</kbd> {mode === 'edit' ? 'update' : 'add'} • <kbd className="kbd text-[9px]">Esc</kbd> cancel</p>
    </form>
  )
}
