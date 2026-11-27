import { useRef, useState } from 'react'
import { useCartStore } from '@/store/cartStore'
import { printSavedBill } from './BillRecallPanel'
import type { InvoiceDetail } from '@/lib/invoicePrint'
import toast from 'react-hot-toast'

export default function AppendBillCheckout({ bill, onSuccess, onClose }: { bill: InvoiceDetail; onSuccess: () => void; onClose: () => void }) {
  const cart = useCartStore()
  const [method, setMethod] = useState('cash')
  const [received, setReceived] = useState(cart.total.toFixed(2))
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [change, setChange] = useState(0)
  const lock = useRef(false)
  const save = async () => {
    if (lock.current || saved) return
    lock.current = true; setBusy(true)
    try {
      if (cart.globalDiscount) throw new Error('Use line discounts for extra items')
      const result = await window.api.invoices.appendItems(bill.id, { expected_total: Number(bill.total_amount), expected_item_count: bill.items.length, method, received: Number(received), items: cart.items.map(i => ({ product_id: i.product.id, variant_id: i.variant_id, variant_name: i.variant_name, quantity: i.quantity, unit_price: i.unit_price, discount_pct: i.discount_pct })) })
      if (!result.success) throw new Error(result.error || 'Could not add items')
      setSaved(true); setChange(result.data.change)
      window.dispatchEvent(new Event('pos:catalog-refresh')); window.dispatchEvent(new Event('pos:stock-changed'))
      toast.success('Extra items saved to the same bill')
      try { await printSavedBill(bill.id) } catch (err) { toast.error(`Bill saved. ${(err as Error).message}. Use Reprint.`) }
    } catch (err) { toast.error((err as Error).message) }
    finally { lock.current = false; setBusy(false) }
  }
  return <form className="p-3 border-t space-y-2 shrink-0" style={{ borderColor: 'var(--border)' }} aria-label="Collect extra payment" onSubmit={e => { e.preventDefault(); if (saved) onSuccess(); else void save() }} onKeyDown={e => { if (e.key === 'Escape' && !busy) { e.stopPropagation(); e.preventDefault(); saved ? onSuccess() : onClose() } }}>
    <p className="text-sm font-semibold">{saved ? 'Bill updated' : 'Extra payment'} · {bill.invoice_number}</p>
    {saved ? <>
      <p>Change Rs.{change.toFixed(2)}</p>
      <div className="flex gap-2"><button type="button" disabled={busy} className="btn-secondary" onClick={() => { setBusy(true); void printSavedBill(bill.id).catch(e => toast.error(e.message)).finally(() => setBusy(false)) }}>Reprint</button><button autoFocus className="btn-primary" disabled={busy}>Next bill · Enter</button></div>
    </> : <>
      <div className="flex gap-2"><select aria-label="Extra payment method" className="input flex-1" value={method} onChange={e => setMethod(e.target.value)} disabled={busy}><option value="cash">Cash</option><option value="card">Card</option><option value="bank_transfer">Bank transfer</option></select><input autoFocus aria-label="Amount received for extra items" className="input w-32" inputMode="decimal" value={received} onFocus={e => e.target.select()} onChange={e => setReceived(e.target.value)} disabled={busy} /></div>
      <p className="text-xs">Original Rs.{Number(bill.total_amount).toFixed(2)} + extra Rs.{cart.total.toFixed(2)} = Rs.{(Number(bill.total_amount) + cart.total).toFixed(2)}</p>
      <div className="flex gap-2"><button className="btn-primary flex-1" disabled={busy}>Save & print · Enter</button><button type="button" className="btn-secondary" disabled={busy} onClick={onClose}>Back · Esc</button></div>
    </>}
  </form>
}
