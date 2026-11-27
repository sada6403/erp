import { useEffect, useRef, useState } from 'react'
import { buildInvoicePrintPayload, type InvoiceDetail } from '@/lib/invoicePrint'
import toast from 'react-hot-toast'

async function loadSavedBill(id: string): Promise<InvoiceDetail> {
  const detail = await window.api.reports.transactionDetail(id)
  if (!detail.success || !detail.data) throw new Error(detail.error || 'Could not load bill')
  // The detail IPC returns database column names; the shared printer builder
  // consumes the report view's discount/tax/total aliases.
  return { ...detail.data, items: detail.data.items.map((item: Record<string, any>) => ({ ...item,
    discount: Number(item.discount ?? item.discount_amount ?? 0),
    tax: Number(item.tax ?? item.tax_amount ?? 0),
    total: Number(item.total ?? item.line_total ?? 0),
  })) }
}

export async function printSavedBill(id: string) {
  const detail = await loadSavedBill(id)
  const result = await window.api.printer.printInvoice(buildInvoicePrintPayload(detail))
  if (!result.success) throw new Error(result.error || 'Printing failed')
}

export default function BillRecallPanel({ onAppend, disabled }: { onAppend: (bill: InvoiceDetail) => void; disabled: boolean }) {
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState<InvoiceDetail[]>([])
  const [selected, setSelected] = useState(0)
  const [bill, setBill] = useState<InvoiceDetail | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const lock = useRef(false)
  const open = async (id: string) => {
    setBill(await loadSavedBill(id)); setMatches([])
  }
  const search = async () => {
    if (!query.trim() || lock.current) return
    lock.current = true; setBusy(true); setMessage(''); setBill(null)
    try {
      const result = await window.api.invoices.list({ search: query.trim() })
      if (!result.success) throw new Error(result.error || 'Bill search failed')
      const rows = result.data || []
      const exact = rows.find((row: InvoiceDetail) => row.invoice_number.toLowerCase() === query.trim().toLowerCase())
      if (exact || rows.length === 1) await open((exact || rows[0]).id)
      else { setMatches(rows); setSelected(0); if (!rows.length) setMessage('No bill found. Enter the full bill number or its last digits.') }
    } catch (err) { setMessage((err as Error).message) }
    finally { lock.current = false; setBusy(false) }
  }
  const print = async () => {
    if (!bill || lock.current) return
    lock.current = true; setBusy(true)
    try { await printSavedBill(bill.id); toast.success('Bill sent to printer') }
    catch (err) { toast.error((err as Error).message) }
    finally { lock.current = false; setBusy(false) }
  }
  useEffect(() => {
    const handler = () => { if (bill) void print(); else { const input = document.getElementById('pos-bill-number') as HTMLInputElement; input?.focus(); input?.select() } }
    window.addEventListener('pos:reprint-bill', handler)
    return () => window.removeEventListener('pos:reprint-bill', handler)
  }, [bill, busy])
  return <section className="pos-bill-recall px-3 py-2 border-b shrink-0" style={{ borderColor: 'var(--border)' }} aria-label="Find and reprint bill">
    <form className="flex flex-wrap items-center gap-2" onSubmit={e => { e.preventDefault(); void search() }}>
      <label htmlFor="pos-bill-number" className="text-xs font-semibold">Find bill <kbd className="kbd">Ctrl+B</kbd></label>
      <input id="pos-bill-number" className="input flex-1 min-w-32 py-1.5 text-sm font-mono" placeholder="Bill number / last digits" value={query} onChange={e => { setQuery(e.target.value); setBill(null); setMatches([]); setMessage('') }}
        onKeyDown={e => {
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setBill(null); setMatches([]); document.querySelector<HTMLInputElement>('[data-pos-search]')?.focus() }
          if (matches.length && ['ArrowDown', 'ArrowUp'].includes(e.key)) { e.preventDefault(); setSelected(i => Math.max(0, Math.min(matches.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))) }
          if (matches.length && e.key === 'Enter') { e.preventDefault(); void open(matches[selected].id).catch(err => setMessage(err.message)) }
        }} />
      <button className="btn-secondary btn-sm" disabled={busy || !query.trim()}>Open</button>
      {bill && <>
        <button type="button" className="btn-secondary btn-sm" disabled={busy} onClick={() => void print()}>Reprint · Ctrl+P</button>
        <button type="button" className="btn-primary btn-sm" disabled={disabled || busy || bill.bill_type !== 'RETAIL' || bill.status !== 'completed'} title={disabled ? 'Finish or hold the current cart first' : 'Add extra products to this bill'} onClick={() => onAppend(bill)}>Add items</button>
        <button type="button" className="btn-ghost btn-sm" onClick={() => setBill(null)}>Close</button>
      </>}
    </form>
    {message && <p role="status" className="text-xs text-amber-400 mt-1">{message}</p>}
    {matches.length > 0 && <div className="max-h-32 overflow-y-auto mt-2" role="listbox" aria-label="Matching bills">
      {matches.map((row, i) => <button type="button" role="option" aria-selected={selected === i} key={row.id} className={`flex w-full justify-between gap-3 p-2 text-xs ${selected === i ? 'bg-brand-500/20' : ''}`} onClick={() => void open(row.id).catch(err => setMessage(err.message))}>
        <span className="font-mono">{row.invoice_number}</span><span>{row.customer_name || 'Walk-in'} · Rs.{Number(row.total_amount).toLocaleString()}</span>
      </button>)}
    </div>}
    {bill && <div className="mt-2 text-xs">
      <div className="flex flex-wrap gap-x-5 gap-y-1"><strong className="font-mono">{bill.invoice_number}</strong><span>{bill.customer_name || 'Walk-in'}</span><span>Total Rs.{Number(bill.total_amount).toLocaleString()}</span><span>Paid Rs.{Number(bill.paid_amount).toLocaleString()}</span><span>{bill.status}</span></div>
      <div className="max-h-24 overflow-y-auto mt-1" aria-label="Saved bill items">{bill.items.map(i => <div key={i.id} className="flex justify-between gap-3 py-0.5"><span>{i.product_name} × {i.quantity}</span><span>Rs.{Number(i.total).toLocaleString()}</span></div>)}</div>
      {disabled && <p className="mt-1 text-amber-400">Finish or hold the current cart before adding to this bill.</p>}
    </div>}
  </section>
}
