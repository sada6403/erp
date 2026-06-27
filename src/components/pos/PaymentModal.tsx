import { useState, useRef, useEffect, useCallback } from 'react'
import { useCartStore } from '@/store/cartStore'
import { useAuthStore } from '@/store/authStore'
import { useKeyboard } from '@/hooks/useKeyboard'
import type { BillType } from '@/store/cartStore'
import {
  X, CreditCard, Banknote, Building2, Calendar, Printer, CheckCircle2,
  Mail, ClipboardList, BadgeDollarSign, AlertCircle, Gift, Keyboard
} from 'lucide-react'
import toast from 'react-hot-toast'
import type { PaymentMethod } from '@/types'

interface Props {
  invoiceNumber: string
  billType: BillType
  onClose: () => void
  onSuccess: () => void
}

const PAYMENT_METHODS: { value: PaymentMethod; label: string; icon: React.ReactNode; key: string }[] = [
  { value: 'cash',          label: 'Cash',         icon: <Banknote size={18} />,    key: 'Ctrl+1' },
  { value: 'card',          label: 'Card',         icon: <CreditCard size={18} />,  key: 'Ctrl+2' },
  { value: 'bank_transfer', label: 'Bank',         icon: <Building2 size={18} />,   key: 'Ctrl+3' },
  { value: 'gift_voucher',  label: 'Gift Voucher', icon: <Gift size={18} />,        key: 'Ctrl+4' },
  { value: 'installment',   label: 'Installment',  icon: <Calendar size={18} />,   key: 'Ctrl+5' },
]

type BalancePaymentMethod = Extract<PaymentMethod, 'cash' | 'card' | 'bank_transfer'>

interface PaymentLine {
  method: PaymentMethod
  amount: number
  reference?: string
}

const BILL_TYPE_LABELS: Record<BillType, string> = {
  RETAIL:    'Tax Invoice',
  QUOTATION: 'Quotation',
  CREDIT:    'Credit Sale',
}

// Denomination buttons for cash
const CASH_DENOMS = [500, 1000, 2000, 5000, 10000]

export default function PaymentModal({ invoiceNumber, billType, onClose, onSuccess }: Props) {
  const cart = useCartStore()
  const { user } = useAuthStore()
  const [method, setMethod]             = useState<PaymentMethod>('cash')
  const [received, setReceived]         = useState<string>(String(cart.total.toFixed(2)))
  const [reference, setReference]       = useState('')
  const [balanceMethod, setBalanceMethod] = useState<BalancePaymentMethod>('cash')
  const [balanceReceived, setBalanceReceived] = useState<string>('0.00')
  const [balanceReference, setBalanceReference] = useState('')
  const [validUntil, setValidUntil]     = useState(cart.validUntil)
  const [dueDate, setDueDate]           = useState(cart.dueDate)
  const [loading, setLoading]           = useState(false)
  const [done, setDone]                 = useState(false)
  const [printing, setPrinting]         = useState(false)
  const [emailing, setEmailing]         = useState(false)
  const [receiptPayload, setReceiptPayload] = useState<Record<string, unknown> | null>(null)
  const [printDesign, setPrintDesign]   = useState<'dot' | 'thermal' | 'a4'>('thermal')
  const receivedRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    receivedRef.current?.focus()
    receivedRef.current?.select()
  }, [])

  useEffect(() => {
    if (method === 'cash' || method === 'gift_voucher') setReceived(String(cart.total.toFixed(2)))
  }, [method, cart.total])

  const isQuotation = billType === 'QUOTATION'
  const isCredit    = billType === 'CREDIT'
  const isRetail    = billType === 'RETAIL'

  const receivedAmount      = parseFloat(received) || 0
  const voucherApplied      = method === 'gift_voucher' ? Math.min(Math.max(0, receivedAmount), cart.total) : 0
  const voucherBalance      = method === 'gift_voucher' ? Math.max(0, cart.total - voucherApplied) : 0
  const balanceReceivedAmount = parseFloat(balanceReceived) || 0
  const effectivePaidAmount = isCredit || method === 'installment'
    ? 0
    : method === 'gift_voucher'
      ? voucherApplied + balanceReceivedAmount
      : receivedAmount
  const change = method === 'gift_voucher'
    ? Math.max(0, balanceReceivedAmount - voucherBalance)
    : Math.max(0, receivedAmount - cart.total)

  useEffect(() => {
    if (method === 'gift_voucher') setBalanceReceived(voucherBalance.toFixed(2))
  }, [method, voucherBalance])

  const buildPayments = (): PaymentLine[] | undefined => {
    if (!isRetail || method === 'installment') return undefined
    if (method !== 'gift_voucher') return [{ method, amount: receivedAmount, reference }]
    const payments: PaymentLine[] = [{ method: 'gift_voucher', amount: voucherApplied, reference }]
    if (voucherBalance > 0) payments.push({ method: balanceMethod, amount: balanceReceivedAmount, reference: balanceReference })
    return payments
  }

  const buildPayload = (invoiceNum: string) => ({
    invoice_number:    invoiceNum,
    bill_type:         billType,
    bill_type_label:   BILL_TYPE_LABELS[billType],
    invoice_date:      new Date().toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
    cashier_name:      user?.name || '',
    customer_name:     cart.customer?.name || 'Walk-in',
    customer_phone:    (cart.customer as Record<string,string> | null)?.phone   || '',
    customer_email:    (cart.customer as Record<string,string> | null)?.email   || '',
    customer_address:  (cart.customer as Record<string,string> | null)?.address || '',
    items: cart.items.map(i => ({
      product_name:    i.product.name,
      sku:             i.product.sku,
      quantity:        i.quantity,
      unit_price:      i.unit_price,
      discount_amount: i.discount_amount,
      line_total:      i.line_total,
    })),
    subtotal:          cart.subtotal,
    discount_amount:   cart.discountAmount,
    tax_amount:        cart.taxAmount,
    total_amount:      cart.total,
    paid_amount:       effectivePaidAmount,
    change_amount:     change,
    payment_method:    isCredit ? 'credit' : (method === 'gift_voucher' && voucherBalance > 0 ? 'split' : method),
    payment_reference: method === 'gift_voucher' && voucherBalance > 0
      ? `Voucher ${reference}${balanceReference ? ` / ${balanceReference}` : ''}`
      : reference,
    payments:          buildPayments(),
    valid_until:       isQuotation ? validUntil : undefined,
    due_date:          isCredit    ? dueDate    : undefined,
  })

  const handleConfirm = useCallback(async () => {
    if (loading) return
    if (isRetail && method !== 'installment' && method !== 'gift_voucher' && receivedAmount < cart.total) {
      toast.error('Insufficient payment amount')
      receivedRef.current?.focus()
      receivedRef.current?.select()
      return
    }
    if (isRetail && method === 'gift_voucher' && !reference.trim()) {
      toast.error('Gift voucher number is required')
      return
    }
    if (isRetail && method === 'gift_voucher' && voucherApplied <= 0) {
      toast.error('Gift voucher amount must be greater than zero')
      return
    }
    if (isRetail && method === 'gift_voucher' && voucherBalance > 0 && balanceReceivedAmount < voucherBalance) {
      toast.error('Balance payment amount is insufficient')
      return
    }
    if (isRetail && method === 'gift_voucher' && voucherBalance > 0 && balanceMethod !== 'cash' && !balanceReference.trim()) {
      toast.error('Balance payment reference is required')
      return
    }
    if (isCredit && !cart.customer) {
      toast.error('Credit bill requires a customer')
      return
    }

    setLoading(true)
    try {
      const settings = await window.api.settings.get()
      const branchId = user?.branch?.id || (settings.data as { branch_id?: string } | undefined)?.branch_id

      const res = await window.api.invoices.create({
        branch_id:       branchId,
        customer_id:     cart.customer?.id,
        bill_type:       billType,
        valid_until:     isQuotation ? validUntil : undefined,
        due_date:        isCredit    ? dueDate    : undefined,
        subtotal:        cart.subtotal,
        discount_amount: cart.discountAmount,
        tax_amount:      cart.taxAmount,
        total_amount:    cart.total,
        paid_amount:     effectivePaidAmount,
        due_amount:      isCredit ? cart.total : Math.max(0, cart.total - effectivePaidAmount),
        notes:           cart.notes,
        items: cart.items.map(i => ({
          product_id:      i.product.id,
          quantity:        i.quantity,
          unit_price:      i.unit_price,
          discount_pct:    i.discount_pct,
          discount_amount: i.discount_amount,
          tax_rate:        i.product.tax_rate,
          tax_amount:      i.tax_amount,
          line_total:      i.line_total,
        })),
        payment: isRetail && method !== 'installment' && method !== 'gift_voucher'
          ? { method, amount: receivedAmount, reference }
          : undefined,
        payments: buildPayments(),
      })

      if (!res.success) {
        toast.error(res.error || 'Failed to create bill')
        return
      }

      const data = res.data as { id: string; invoice_number: string }
      const payload = buildPayload(data.invoice_number || invoiceNumber)
      setReceiptPayload(payload)
      setDone(true)
    } catch (err: unknown) {
      toast.error((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [loading, isRetail, isCredit, isQuotation, method, receivedAmount, reference, voucherApplied, voucherBalance,
      balanceReceivedAmount, balanceMethod, balanceReference, cart, billType, validUntil, dueDate,
      effectivePaidAmount, invoiceNumber, user])

  const handlePrint = useCallback(async (design: 'dot' | 'thermal' | 'a4' = printDesign) => {
    if (!receiptPayload) return
    setPrinting(true)
    setPrintDesign(design)
    try {
      const res = await window.api.printer.printInvoice({ ...receiptPayload, invoice_design: design })
      if (!(res as { success: boolean }).success) toast.error('Print failed')
      else toast.success(`${design.toUpperCase()} bill printed`)
    } catch { toast.error('Print failed') }
    finally { setPrinting(false) }
  }, [receiptPayload, printDesign])

  const handleEmail = useCallback(async () => {
    if (!receiptPayload) return
    const customerEmail = receiptPayload.customer_email as string
    if (!customerEmail) { toast.error('Customer has no email address'); return }
    setEmailing(true)
    try {
      await window.api.printer.emailInvoice(receiptPayload)
      toast.success('Email client opened')
    } catch { toast.error('Could not open email client') }
    finally { setEmailing(false) }
  }, [receiptPayload])

  // Keyboard shortcuts
  useKeyboard([
    { key: 'Escape', handler: () => done ? onSuccess() : onClose() },
    // Payment method shortcuts (work even when amount input is focused — ctrlKey bypass)
    { key: '1', ctrl: true, handler: () => { if (!done && isRetail) { setMethod('cash');          receivedRef.current?.select() } } },
    { key: '2', ctrl: true, handler: () => { if (!done && isRetail) { setMethod('card');          receivedRef.current?.select() } } },
    { key: '3', ctrl: true, handler: () => { if (!done && isRetail) { setMethod('bank_transfer'); receivedRef.current?.select() } } },
    { key: '4', ctrl: true, handler: () => { if (!done && isRetail) { setMethod('gift_voucher');  receivedRef.current?.select() } } },
    { key: '5', ctrl: true, handler: () => { if (!done && isRetail) { setMethod('installment');   receivedRef.current?.select() } } },
    // Confirm (fires only when NOT in an input — handled directly on input below)
    { key: 'Enter', handler: () => { if (done) onSuccess(); else handleConfirm() } },
    // Success screen print shortcuts
    { key: 'p', handler: () => { if (done) handlePrint('thermal') } },
    { key: 'd', handler: () => { if (done) handlePrint('dot') } },
    { key: 'a', handler: () => { if (done) handlePrint('a4') } },
    { key: 'e', handler: () => { if (done) handleEmail() } },
  ])

  // ── Success screen ──────────────────────────────────────────────────────────
  if (done) {
    const hasEmail        = !!(receiptPayload?.customer_email as string)
    const isPendingApproval = isCredit

    return (
      <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
        <div className="bg-surface-800 rounded-2xl p-8 w-full max-w-md text-center animate-slide-up border border-slate-700">
          <div className={`w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4
            ${isPendingApproval ? 'bg-amber-500/20' : 'bg-green-500/20'}`}>
            {isPendingApproval
              ? <AlertCircle size={40} className="text-amber-400" />
              : <CheckCircle2 size={40} className="text-green-400" />
            }
          </div>

          <h2 className="text-2xl font-bold mb-1" style={{ color: 'var(--text-1)' }}>
            {isQuotation ? 'Quotation Saved!' :
             isCredit    ? 'Credit Bill Created!' :
             'Payment Complete!'}
          </h2>
          <p className="text-sm mb-1 font-mono" style={{ color: 'var(--text-3)' }}>
            {receiptPayload?.invoice_number as string || invoiceNumber}
          </p>

          {isRetail && change > 0 && (
            <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-4 my-4">
              <p className="text-sm" style={{ color: 'var(--text-3)' }}>Change to Return</p>
              <p className="text-4xl font-bold text-green-400">
                Rs.{change.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </p>
            </div>
          )}

          {isCredit && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 my-4 text-left">
              <p className="text-amber-400 text-sm font-semibold mb-1">Pending Manager Approval</p>
              <p className="text-xs" style={{ color: 'var(--text-3)' }}>Go to Credit Bills to approve this sale.</p>
            </div>
          )}

          {isQuotation && (
            <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-4 my-4 text-left">
              <p className="text-blue-400 text-sm font-semibold mb-1">Quotation Valid Until</p>
              <p className="text-sm" style={{ color: 'var(--text-1)' }}>{validUntil}</p>
            </div>
          )}

          {/* Print options */}
          <div className="mt-4 space-y-2">
            <div className="grid grid-cols-3 gap-2">
              <button onClick={() => handlePrint('thermal')} disabled={printing}
                className="btn-secondary gap-1.5 flex-col py-2.5" title="Print thermal (P)">
                <Printer size={15} className={printing ? 'animate-pulse' : ''} />
                <span className="text-xs">Thermal</span>
                <kbd className="kbd text-[9px]">P</kbd>
              </button>
              <button onClick={() => handlePrint('dot')} disabled={printing}
                className="btn-secondary gap-1.5 flex-col py-2.5" title="Print dot matrix (D)">
                <Printer size={15} className={printing ? 'animate-pulse' : ''} />
                <span className="text-xs">Dot</span>
                <kbd className="kbd text-[9px]">D</kbd>
              </button>
              <button onClick={() => handlePrint('a4')} disabled={printing}
                className="btn-secondary gap-1.5 flex-col py-2.5" title="Print A4 (A)">
                <Printer size={15} className={printing ? 'animate-pulse' : ''} />
                <span className="text-xs">A4</span>
                <kbd className="kbd text-[9px]">A</kbd>
              </button>
            </div>
            <button
              onClick={handleEmail} disabled={emailing || !hasEmail}
              title={!hasEmail ? 'No customer email on file' : 'Email invoice (E)'}
              className="btn-secondary w-full gap-1.5 disabled:opacity-40"
            >
              <Mail size={15} className={emailing ? 'animate-pulse' : ''} />
              {emailing ? 'Opening...' : 'Email Invoice'}
              <kbd className="kbd text-[9px] ml-auto">E</kbd>
            </button>
          </div>

          {/* New invoice CTA — primary action */}
          <button onClick={onSuccess} className="btn-primary w-full btn-lg mt-3 gap-2">
            <CheckCircle2 size={16} />
            New Invoice
            <kbd className="kbd text-[9px] ml-auto">Enter</kbd>
          </button>
          <p className="text-xs mt-2" style={{ color: 'var(--text-3)' }}>Press Enter or F1 to start next sale</p>
        </div>
      </div>
    )
  }

  // ── Payment form ────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-surface-800 rounded-2xl w-full max-w-2xl max-h-[92vh] flex flex-col animate-slide-up border border-slate-700">

        {/* Header */}
        <div className={`flex items-center justify-between px-6 py-4 border-b border-slate-700 rounded-t-2xl
          ${isQuotation ? 'bg-amber-900/20' : isCredit ? 'bg-rose-900/20' : ''}`}>
          <div className="flex items-center gap-2">
            {isQuotation ? <ClipboardList size={18} className="text-amber-400" /> :
             isCredit    ? <BadgeDollarSign size={18} className="text-rose-400" /> :
                           <CreditCard size={18} className="text-brand-400" />}
            <h2 className="text-lg font-bold" style={{ color: 'var(--text-1)' }}>{BILL_TYPE_LABELS[billType]}</h2>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs font-mono" style={{ color: 'var(--text-3)' }}>{invoiceNumber}</span>
            <div className="flex items-center gap-1 text-xs" style={{ color: 'var(--text-3)' }}>
              <Keyboard size={11} />
              <span>Ctrl+1-5 = method</span>
            </div>
            <button onClick={onClose} title="Cancel (ESC)">
              <X size={20} className="text-[var(--text-3)] hover:text-[var(--text-1)]" />
            </button>
          </div>
        </div>

        <div className="p-6 space-y-4 overflow-y-auto">
          {/* Total display */}
          <div className="rounded-xl p-4 text-center border border-slate-700" style={{ background: 'var(--bg-soft)' }}>
            <p className="text-sm mb-1" style={{ color: 'var(--text-3)' }}>
              {isQuotation ? 'Quoted Amount' : isCredit ? 'Credit Amount' : 'Total Amount'}
            </p>
            <p className="text-4xl font-bold" style={{ color: 'var(--text-1)' }}>
              Rs.{cart.total.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </p>
          </div>

          {/* QUOTATION: valid until */}
          {isQuotation && (
            <div>
              <label className="label">Valid Until</label>
              <input
                type="date"
                value={validUntil}
                onChange={e => setValidUntil(e.target.value)}
                className="input"
                min={new Date().toISOString().split('T')[0]}
              />
              <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>Stock will NOT be deducted until converted to invoice.</p>
            </div>
          )}

          {/* CREDIT: due date */}
          {isCredit && (
            <>
              <div>
                <label className="label">Payment Due Date</label>
                <input
                  type="date"
                  value={dueDate}
                  onChange={e => setDueDate(e.target.value)}
                  className="input"
                  min={new Date().toISOString().split('T')[0]}
                />
              </div>
              <div className="bg-rose-900/20 border border-rose-700/50 rounded-xl p-3 text-sm text-rose-300">
                <p className="font-semibold mb-0.5">Credit Sale Rules</p>
                <ul className="text-xs text-rose-400 space-y-0.5 list-disc list-inside">
                  <li>Stock deducted immediately on confirm</li>
                  <li>Manager approval required before finalizing</li>
                  <li>Creator cannot self-approve</li>
                </ul>
              </div>
            </>
          )}

          {/* RETAIL: payment method */}
          {isRetail && (
            <>
              <div>
                <label className="label">Payment Method <span className="text-[10px] font-normal ml-1" style={{ color: 'var(--text-3)' }}>(Ctrl+1 to 5)</span></label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {PAYMENT_METHODS.map(m => (
                    <button key={m.value} onClick={() => { setMethod(m.value); receivedRef.current?.select() }}
                      className={`flex flex-col items-center justify-center gap-1.5 p-3 rounded-xl text-xs font-medium transition-all border-2 min-h-[68px] relative
                        ${method === m.value
                          ? 'border-brand-500 bg-brand-500/10 text-brand-400'
                          : 'border-slate-700 bg-surface-900 text-slate-400 hover:border-slate-600'}`}
                      tabIndex={0}
                    >
                      {m.icon}
                      {m.label}
                      <kbd className="kbd text-[8px] absolute top-1.5 right-1.5">{m.key}</kbd>
                    </button>
                  ))}
                </div>
              </div>

              {method !== 'installment' && (
                <div>
                  <label className="label">
                    {method === 'gift_voucher' ? 'Gift Voucher Amount' : 'Amount Received'}
                    <span className="text-[10px] font-normal ml-1" style={{ color: 'var(--text-3)' }}>— press Enter to confirm</span>
                  </label>
                  <input
                    ref={receivedRef}
                    type="number"
                    value={received}
                    onChange={e => setReceived(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        e.stopPropagation()
                        handleConfirm()
                      }
                    }}
                    className="input text-2xl font-bold text-center h-14"
                    min={method === 'gift_voucher' ? 0 : cart.total}
                    step="0.01"
                    autoFocus
                  />
                </div>
              )}

              {/* Quick denomination buttons (cash) */}
              {method === 'cash' && (
                <div>
                  <label className="label">Quick Amount</label>
                  <div className="grid grid-cols-5 gap-1.5">
                    {CASH_DENOMS.map(v => (
                      <button
                        key={v}
                        onClick={() => { setReceived(String(Math.ceil(cart.total / v) * v)); receivedRef.current?.focus() }}
                        tabIndex={0}
                        className={`btn-secondary btn-sm text-center ${
                          Number(received) === Math.ceil(cart.total / v) * v ? 'ring-1 ring-blue-500' : ''
                        }`}
                      >
                        {v >= 1000 ? `${v/1000}k` : v}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Reference field */}
              {(method === 'card' || method === 'bank_transfer' || method === 'gift_voucher') && (
                <div>
                  <label className="label">
                    {method === 'gift_voucher' ? 'Gift Voucher No.' : 'Reference / Approval No.'}
                  </label>
                  <input type="text" value={reference} onChange={e => setReference(e.target.value)}
                    className="input"
                    placeholder={method === 'gift_voucher' ? 'e.g. GV-2026-0001' : 'e.g. AUTH123456'}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleConfirm() } }}
                  />
                </div>
              )}

              {/* Gift voucher balance section */}
              {method === 'gift_voucher' && (
                <div className="rounded-xl p-4 space-y-3 border border-slate-700" style={{ background: 'var(--bg-soft)' }}>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-lg bg-green-500/10 border border-green-500/30 px-3 py-2">
                      <p className="text-xs text-green-300">Voucher Applied</p>
                      <p className="text-xl font-bold text-green-400">Rs.{voucherApplied.toLocaleString(undefined, { maximumFractionDigits: 2 })}</p>
                    </div>
                    <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 px-3 py-2">
                      <p className="text-xs text-amber-300">Balance to Pay</p>
                      <p className="text-xl font-bold text-amber-300">Rs.{voucherBalance.toLocaleString(undefined, { maximumFractionDigits: 2 })}</p>
                    </div>
                  </div>

                  {voucherBalance > 0 && (
                    <>
                      <div>
                        <label className="label">Balance Payment Method</label>
                        <div className="grid grid-cols-3 gap-2">
                          {[
                            { value: 'cash', label: 'Cash', icon: <Banknote size={16} /> },
                            { value: 'card', label: 'Card', icon: <CreditCard size={16} /> },
                            { value: 'bank_transfer', label: 'Bank', icon: <Building2 size={16} /> },
                          ].map(m => (
                            <button key={m.value}
                              onClick={() => setBalanceMethod(m.value as BalancePaymentMethod)}
                              className={`flex items-center justify-center gap-2 p-2.5 rounded-lg text-xs font-medium border
                                ${balanceMethod === m.value
                                  ? 'border-brand-500 bg-brand-500/10 text-brand-300'
                                  : 'border-slate-700 bg-surface-800 text-slate-400 hover:border-slate-600'}`}
                            >{m.icon}{m.label}</button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <label className="label">Balance Amount Received</label>
                        <input
                          type="number"
                          value={balanceReceived}
                          onChange={e => setBalanceReceived(e.target.value)}
                          className="input text-xl font-bold text-center h-12"
                          min={voucherBalance} step="0.01"
                          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleConfirm() } }}
                        />
                      </div>
                      {balanceMethod !== 'cash' && (
                        <div>
                          <label className="label">Balance Reference</label>
                          <input type="text" value={balanceReference} onChange={e => setBalanceReference(e.target.value)}
                            className="input" placeholder="e.g. CARD-AUTH-1234"
                            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleConfirm() } }}
                          />
                        </div>
                      )}
                      {balanceMethod === 'cash' && (
                        <div className="grid grid-cols-4 gap-2">
                          {[1000, 2000, 5000, 10000].map(v => (
                            <button key={v} onClick={() => setBalanceReceived(String(Math.ceil(voucherBalance / v) * v))}
                              className="btn-secondary btn-sm">Rs.{v.toLocaleString()}</button>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* Change display */}
              {(method === 'cash' || (method === 'gift_voucher' && balanceMethod === 'cash')) && change > 0 && (
                <div className="flex justify-between items-center bg-green-500/10 border border-green-500/30 rounded-xl px-4 py-3">
                  <span className="text-green-400 font-medium">Change</span>
                  <span className="text-2xl font-bold text-green-400">
                    Rs.{change.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </span>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 pb-6 flex gap-3">
          <button onClick={onClose} className="btn-secondary flex-1" tabIndex={0}>
            Cancel <kbd className="kbd text-[9px] ml-1">ESC</kbd>
          </button>
          <button
            onClick={handleConfirm}
            disabled={loading || (isCredit && !cart.customer)}
            tabIndex={0}
            className={`flex-1 btn-lg flex items-center justify-center gap-2 font-semibold disabled:opacity-40 rounded-xl transition-all
              ${isQuotation ? 'bg-amber-600 hover:bg-amber-500 text-white' :
                isCredit    ? 'bg-rose-600 hover:bg-rose-500 text-white' :
                'btn-success'}`}
          >
            <CheckCircle2 size={18} />
            {loading ? 'Processing...' :
             isQuotation ? 'Save Quotation' :
             isCredit    ? 'Create Credit Bill' :
             'Confirm Payment'}
            <kbd className="kbd text-[9px] ml-1">Enter</kbd>
          </button>
        </div>
      </div>
    </div>
  )
}
