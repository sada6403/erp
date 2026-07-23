import { useState, useRef, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCartStore } from '@/store/cartStore'
import { useAuthStore } from '@/store/authStore'
import { useKeyboard } from '@/hooks/useKeyboard'
import type { BillType } from '@/store/cartStore'
import {
  X, CreditCard, Banknote, Building2, Calendar, Printer, CheckCircle2,
  Mail, ClipboardList, BadgeDollarSign, AlertCircle, Keyboard, Handshake, UserPlus, Ticket
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
  { value: 'installment',   label: 'Installment',  icon: <Calendar size={18} />,   key: 'Ctrl+4' },
]

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
  const [agentCode, setAgentCode]         = useState('')
  const [agentName, setAgentName]         = useState('')
  const [agentId, setAgentId]             = useState('')
  const [agentPct, setAgentPct]           = useState('')
  const [agentQuery, setAgentQuery]       = useState('')
  const [agentSuggestOpen, setAgentSuggestOpen] = useState(false)
  const [agents, setAgents]               = useState<Record<string, unknown>[]>([])
  const [validUntil, setValidUntil]     = useState(cart.validUntil)
  const [dueDate, setDueDate]           = useState(cart.dueDate)
  const [loading, setLoading]           = useState(false)
  const [done, setDone]                 = useState(false)
  const [printing, setPrinting]         = useState(false)
  const [emailing, setEmailing]         = useState(false)
  const [receiptPayload, setReceiptPayload] = useState<Record<string, unknown> | null>(null)
  const [printDesign, setPrintDesign]   = useState<'dot' | 'thermal' | 'a4'>('thermal')
  // Loyalty
  const [loyaltyBalance, setLoyaltyBalance] = useState<{ points: number; redeem_value: number; config: Record<string,unknown> } | null>(null)
  const [usePoints, setUsePoints]       = useState(false)
  const [redeemPoints, setRedeemPoints] = useState(0)
  const [earnedPoints, setEarnedPoints] = useState(0)
  // Coupon (balance-type gift coupon — validated against the coupons module)
  const [couponCode, setCouponCode]     = useState('')
  const [couponInfo, setCouponInfo]     = useState<Record<string, unknown> | null>(null)
  const [couponAmount, setCouponAmount] = useState('0')
  const [couponChecking, setCouponChecking] = useState(false)
  const receivedRef = useRef<HTMLInputElement>(null)
  const navigate    = useNavigate()
  const [createdInvoiceId, setCreatedInvoiceId] = useState<string | null>(null)

  useEffect(() => {
    receivedRef.current?.focus()
    receivedRef.current?.select()
  }, [])

  useEffect(() => {
    window.api.agents?.list?.({ status: 'active' }).then((r: { success: boolean; data?: Record<string, unknown>[] }) => {
      if (r.success) setAgents(r.data || [])
    })
  }, [])

  const agentMatches = agentQuery.trim()
    ? agents.filter(a =>
        String(a.code || '').toLowerCase().includes(agentQuery.trim().toLowerCase()) ||
        String(a.name || '').toLowerCase().includes(agentQuery.trim().toLowerCase())
      ).slice(0, 8)
    : []

  const selectAgent = (a: Record<string, unknown>) => {
    setAgentCode(String(a.code || ''))
    setAgentName(String(a.name || ''))
    setAgentId(String(a.id || ''))
    setAgentPct(String(a.default_commission_pct ?? ''))
    setAgentQuery(`${a.code} — ${a.name}`)
    setAgentSuggestOpen(false)
  }

  const clearAgent = () => {
    setAgentCode(''); setAgentName(''); setAgentId(''); setAgentQuery('')
  }

  // Installment
  const [plans, setPlans]           = useState<Record<string, unknown>[]>([])
  const [planId, setPlanId]         = useState('')
  const [downPayment, setDownPayment] = useState('')

  const [customers, setCustomers] = useState<Record<string, unknown>[]>([])

  useEffect(() => {
    if (method !== 'installment' || plans.length) return
    window.api.admin.installments.plans().then((r: { success: boolean; data?: Record<string, unknown>[] }) => {
      if (r.success && r.data?.length) { setPlans(r.data); setPlanId(String(r.data[0].id)) }
    })
  }, [method, plans.length])

  // Load customers for the dropdown (refresh when one is added / selection changes)
  useEffect(() => {
    if (method !== 'installment') return
    window.api.customers.list().then((r: { success: boolean; data?: Record<string, unknown>[] }) => {
      if (r.success && r.data) setCustomers(r.data)
    })
  }, [method, cart.customer?.id])

  const onInstallmentCustomerChange = (val: string) => {
    if (val === '__new__') { window.dispatchEvent(new Event('pos:open-customer')); return }
    const c = customers.find(x => String(x.id) === val)
    cart.setCustomer((c ?? null) as typeof cart.customer)
  }

  const selectedPlan = plans.find(p => String(p.id) === planId)
  const planMonths   = Number(selectedPlan?.months || 0)
  const planRate     = Number(selectedPlan?.interest_rate || 0)
  const planType     = String(selectedPlan?.interest_type || 'flat')
  const insFinanced  = Math.max(0, cart.total - Number(downPayment || 0))
  const insInterest  = planType === 'no_interest' || planRate <= 0 ? 0 : insFinanced * (planRate / 100)
  const insMonthly   = planMonths > 0 ? (insFinanced + insInterest) / planMonths : insFinanced

  // Load loyalty balance when customer changes
  useEffect(() => {
    if (!cart.customer?.id) { setLoyaltyBalance(null); setUsePoints(false); setRedeemPoints(0); return }
    window.api.loyalty.getBalance(cart.customer.id).then((r: { success: boolean; points: number; redeem_value: number; config: Record<string,unknown> }) => {
      if (r.success && (r.config?.enabled)) setLoyaltyBalance(r)
      else setLoyaltyBalance(null)
    })
  }, [cart.customer?.id])

  const isQuotation = billType === 'QUOTATION'
  const isCredit    = billType === 'CREDIT'
  const isRetail    = billType === 'RETAIL'

  // Loyalty discount computed from redeemPoints
  const loyaltyCfg          = loyaltyBalance?.config
  const maxRedeemablePoints = loyaltyBalance ? Math.min(loyaltyBalance.points, Math.floor(cart.total / (Number(loyaltyCfg?.redeem_value ?? 10) / Number(loyaltyCfg?.redeem_points ?? 100)))) : 0
  const loyaltyDiscount     = usePoints && redeemPoints > 0 ? (redeemPoints / Number(loyaltyCfg?.redeem_points ?? 100)) * Number(loyaltyCfg?.redeem_value ?? 10) : 0
  const totalAfterLoyalty   = Math.max(0, cart.total - loyaltyDiscount)

  // Coupon (gift voucher) is an optional add-on for any retail payment method
  // except installment — installment sales are created via a separate
  // admin:installments:createSale path (its own invoice/schedule/ledger
  // writes) that doesn't thread a coupon redemption through, so applying one
  // here would show as "applied" without ever actually being redeemed.
  const couponEligible = billType === 'RETAIL' && method !== 'installment'
  const couponBalance  = couponInfo ? Number(couponInfo.balance || 0) : 0
  const couponApplied  = couponEligible && couponInfo
    ? Number(Math.min(Math.max(0, parseFloat(couponAmount) || 0), couponBalance, totalAfterLoyalty).toFixed(2))
    : 0
  const totalAfterCoupon = Math.max(0, Number((totalAfterLoyalty - couponApplied).toFixed(2)))
  const cartCustomerId = (cart.customer as Record<string, unknown> | null)?.id
  const couponCustomerMismatch = Boolean(
    couponInfo?.customer_id && cartCustomerId && String(couponInfo.customer_id) !== String(cartCustomerId)
  )

  const validateCoupon = async () => {
    const code = couponCode.trim()
    if (!code) return
    setCouponChecking(true)
    try {
      const res = await window.api.coupons.validate(code) as { success: boolean; data?: { valid: boolean; reason?: string; coupon?: Record<string, unknown> }; error?: string }
      if (!res.success) { toast.error(res.error || 'Could not check coupon'); return }
      if (!res.data?.valid || !res.data.coupon) {
        setCouponInfo(null)
        toast.error(res.data?.reason || 'Coupon is not valid')
        return
      }
      setCouponInfo(res.data.coupon)
      const balance = Number(res.data.coupon.balance || 0)
      setCouponAmount(String(Math.min(balance, totalAfterLoyalty).toFixed(2)))
      toast.success(`Coupon OK — balance Rs.${balance.toFixed(2)}`)
    } finally { setCouponChecking(false) }
  }

  const clearCoupon = () => { setCouponInfo(null); setCouponCode(''); setCouponAmount('0') }
  const agentCommissionPct  = Math.max(0, Math.min(100, parseFloat(agentPct) || 0))
  const agentCommissionAmount = (agentCode.trim() || agentName.trim()) && agentCommissionPct > 0
    ? (totalAfterLoyalty * agentCommissionPct) / 100
    : 0

  useEffect(() => {
    if (method === 'cash') setReceived(String(totalAfterCoupon.toFixed(2)))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [method, cart.total, loyaltyDiscount, couponApplied])

  const receivedAmount      = parseFloat(received) || 0
  const effectivePaidAmount = isCredit || method === 'installment'
    ? 0
    : receivedAmount + couponApplied
  const change = Math.max(0, receivedAmount - totalAfterCoupon)

  const buildPayments = (): PaymentLine[] | undefined => {
    if (!isRetail || method === 'installment') return undefined
    return [{ method, amount: receivedAmount, reference }]
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
    paid_amount:       method === 'installment' ? Number(downPayment || 0) : effectivePaidAmount,
    change_amount:     change,
    payment_method:    isCredit ? 'credit' : method === 'installment' ? 'installment'
                        : couponApplied > 0 && receivedAmount > 0 ? 'split'
                        : couponApplied > 0 && totalAfterCoupon <= 0 ? 'coupon'
                        : method,
    payment_reference: method === 'installment'
      ? `Down payment — balance Rs.${Math.max(0, cart.total - Number(downPayment || 0)).toFixed(2)}`
      : reference,
    // Print payload only — the coupon line is display-only here; the real
    // payments row is inserted by the main process during invoices:create.
    payments:          method === 'installment'
      ? [{ method: 'installment', amount: Number(downPayment || 0), reference: `Balance Rs.${Math.max(0, cart.total - Number(downPayment || 0)).toFixed(2)}` }]
      : [
          ...(couponApplied > 0 ? [{ method: 'coupon' as PaymentMethod, amount: couponApplied, reference: String(couponInfo?.code || couponCode) }] : []),
          ...(buildPayments() || []),
        ],
    agent_code:        agentCode.trim() || undefined,
    agent_name:        agentName.trim() || undefined,
    agent_id:          agentId || undefined,
    agent_commission_pct: agentCommissionPct,
    agent_commission_amount: agentCommissionAmount,
    valid_until:       isQuotation ? validUntil : undefined,
    due_date:          isCredit    ? dueDate    : undefined,
  })

  const handleConfirm = useCallback(async () => {
    if (loading) return

    // ── Installment sale: needs a registered customer + a plan, then builds a
    //    proper installment account + schedule (not a plain invoice). ──
    if (isRetail && method === 'installment') {
      if (!cart.customer) { toast.error('Installment requires a customer — press F2 to select or add one'); return }
      if (!planId) { toast.error('Select an installment plan'); return }
      const plan = plans.find(p => String(p.id) === planId)
      setLoading(true)
      try {
        const settings = await window.api.settings.get()
        const branchId = user?.branch?.id || (settings.data as { branch_id?: string } | undefined)?.branch_id
        const cust = cart.customer as unknown as Record<string, string>
        const res = await window.api.admin.installments.createSale({
          branch_id:      branchId,
          customer_id:    cust.id,
          customer_name:  cust.name,
          customer_phone: cust.phone,
          cash_price:     cart.total,
          down_payment:   Number(downPayment || 0),
          months:         Number(plan?.months || 0),
          interest_type:  plan?.interest_type,
          interest_rate:  Number(plan?.interest_rate || 0),
          plan_id:        planId,
          grace_period_days: Number(plan?.grace_period_days || 0),
          late_fee:       Number(plan?.late_fee || 0),
          notes:          cart.notes,
          items: cart.items.map(i => ({ product_id: i.product.id, quantity: i.quantity, unit_price: i.unit_price })),
        }) as { success: boolean; data?: { invoice_number?: string }; error?: string }
        if (!res.success) { toast.error(res.error || 'Failed to create installment'); return }
        window.dispatchEvent(new Event('pos:stock-changed'))
        setReceiptPayload(buildPayload(res.data?.invoice_number || invoiceNumber))
        setDone(true)
      } catch (err) { toast.error((err as Error).message) } finally { setLoading(false) }
      return
    }

    if (isRetail && method !== 'installment' && receivedAmount < totalAfterCoupon) {
      toast.error('Insufficient payment amount')
      receivedRef.current?.focus()
      receivedRef.current?.select()
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
        agent_code:      agentCode.trim() || undefined,
        agent_name:      agentName.trim() || undefined,
        agent_id:        agentId || undefined,
        agent_commission_pct: agentCommissionPct,
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
        payment: isRetail && method !== 'installment'
          ? { method, amount: receivedAmount, reference }
          : undefined,
        payments: buildPayments(),
        // Balance-type coupon: the main process validates + redeems this inside
        // the invoice transaction and inserts the payments row itself.
        coupon: couponApplied > 0 && couponInfo
          ? { code: String(couponInfo.code), amount: couponApplied }
          : undefined,
      })

      if (!res.success) {
        toast.error(res.error || 'Failed to create bill')
        return
      }

      const data = res.data as { id: string; invoice_number: string }

      // ── Installment: skip success screen and go straight to plan creation ──
      if (method === 'installment') {
        setCreatedInvoiceId(data.id)
        cart.clear()
        onSuccess()
        navigate(`/admin/installments?invoice_id=${data.id}&invoice_number=${encodeURIComponent(data.invoice_number || invoiceNumber)}&amount=${cart.total}`)
        return
      }

      // Loyalty: redeem points first, then earn on net amount
      if (cart.customer?.id) {
        if (usePoints && redeemPoints > 0) {
          await window.api.loyalty.redeem({ customer_id: cart.customer.id, invoice_id: data.id, points: redeemPoints, created_by: user?.id })
        }
        if (isRetail) {
          const earnRes = await window.api.loyalty.earn({ customer_id: cart.customer.id, invoice_id: data.id, amount: totalAfterLoyalty, created_by: user?.id }) as { success: boolean; points_earned: number }
          if (earnRes.success && earnRes.points_earned > 0) setEarnedPoints(earnRes.points_earned)
        }
      }

      const payload = buildPayload(data.invoice_number || invoiceNumber)
      setReceiptPayload(payload)
      setDone(true)
    } catch (err: unknown) {
      toast.error((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [loading, isRetail, isCredit, isQuotation, method, receivedAmount, reference,
      cart, billType, validUntil, dueDate,
      effectivePaidAmount, invoiceNumber, user, agentCode, agentName, agentCommissionPct, agentCommissionAmount,
      planId, downPayment, plans, couponApplied, couponInfo, totalAfterCoupon])

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
    { key: '4', ctrl: true, handler: () => { if (!done && isRetail) { setMethod('installment');   receivedRef.current?.select() } } },
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

          {/* Loyalty earned badge */}
          {earnedPoints > 0 && (
            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-3 my-2 flex items-center gap-2">
              <span className="text-xl">⭐</span>
              <div>
                <p className="text-sm font-semibold text-yellow-400">+{earnedPoints} Points Earned!</p>
                <p className="text-xs" style={{ color: 'var(--text-3)' }}>Added to customer's loyalty balance</p>
              </div>
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
              Rs.{(couponApplied > 0 ? totalAfterCoupon : totalAfterLoyalty).toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </p>
            {loyaltyDiscount > 0 && (
              <p className="text-xs mt-1 text-green-400">
                Rs.{loyaltyDiscount.toFixed(2)} loyalty discount applied
              </p>
            )}
            {couponApplied > 0 && (
              <p className="text-xs mt-1 text-indigo-400">
                Rs.{couponApplied.toFixed(2)} paid by coupon {String(couponInfo?.code || '')}
              </p>
            )}
          </div>

          <div className="rounded-xl border border-slate-700 p-4" style={{ background: 'var(--bg-soft)' }}>
            <div className="flex items-center gap-2 mb-3">
              <Handshake size={16} className="text-emerald-400" />
              <div>
                <p className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>Agent Commission</p>
                <p className="text-xs" style={{ color: 'var(--text-3)' }}>Optional - enter who brought this customer and their commission percentage.</p>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-[2fr_0.75fr] gap-3">
              <div className="relative">
                <label className="label">Agent</label>
                <input
                  type="text"
                  value={agentQuery}
                  onChange={e => {
                    const v = e.target.value
                    setAgentQuery(v)
                    setAgentSuggestOpen(true)
                    // Typing after a selection (or freehand, for an agent not
                    // yet registered) clears the link — treated as free text.
                    setAgentId('')
                    setAgentCode(v.toUpperCase())
                    setAgentName(v)
                  }}
                  onFocus={() => setAgentSuggestOpen(true)}
                  onBlur={() => setTimeout(() => setAgentSuggestOpen(false), 150)}
                  className="input"
                  placeholder="Search agent by code or name..."
                />
                {agentQuery && (
                  <button
                    type="button"
                    onClick={clearAgent}
                    className="absolute right-2 top-[26px] text-xs"
                    style={{ color: 'var(--text-3)' }}
                  >
                    Clear
                  </button>
                )}
                {agentSuggestOpen && agentMatches.length > 0 && (
                  <div
                    className="absolute z-10 mt-1 w-full rounded-lg border shadow-lg max-h-48 overflow-y-auto"
                    style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}
                  >
                    {agentMatches.map(a => (
                      <button
                        key={String(a.id)}
                        type="button"
                        onMouseDown={() => selectAgent(a)}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-slate-700/40"
                      >
                        <span className="font-mono text-xs font-semibold mr-2">{String(a.code)}</span>
                        <span style={{ color: 'var(--text-2)' }}>{String(a.name)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <label className="label">Commission %</label>
                <input
                  type="number"
                  value={agentPct}
                  onChange={e => setAgentPct(e.target.value)}
                  className="input"
                  min={0}
                  max={100}
                  step="0.01"
                  placeholder="0"
                />
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2">
              <span className="text-xs text-emerald-300">Commission Amount</span>
              <span className="font-bold text-emerald-300">
                Rs.{agentCommissionAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
          </div>

          {/* Loyalty Points Redemption */}
          {loyaltyBalance && loyaltyBalance.points > 0 && isRetail && (
            <div className="rounded-xl border p-3" style={{ borderColor: 'var(--border)', background: 'color-mix(in srgb, #f59e0b 6%, transparent)' }}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-base">⭐</span>
                  <div>
                    <p className="text-xs font-semibold" style={{ color: 'var(--text-1)' }}>Loyalty Points</p>
                    <p className="text-[10px]" style={{ color: 'var(--text-3)' }}>{loyaltyBalance.points} pts available</p>
                  </div>
                </div>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={usePoints} onChange={e => { setUsePoints(e.target.checked); if (!e.target.checked) setRedeemPoints(0) }} className="w-3.5 h-3.5 accent-yellow-500" />
                  <span className="text-xs font-medium text-yellow-500">Use Points</span>
                </label>
              </div>
              {usePoints && (
                <div className="flex items-center gap-2 mt-1">
                  <input
                    type="number"
                    min={Number(loyaltyCfg?.min_redeem ?? 100)}
                    max={maxRedeemablePoints}
                    step={Number(loyaltyCfg?.redeem_points ?? 100)}
                    value={redeemPoints}
                    onChange={e => setRedeemPoints(Math.min(maxRedeemablePoints, Math.max(0, parseInt(e.target.value) || 0)))}
                    className="input py-1 text-sm w-28"
                    placeholder="Points"
                  />
                  <span className="text-xs" style={{ color: 'var(--text-3)' }}>
                    = Rs.{loyaltyDiscount.toFixed(2)} off
                  </span>
                  <button onClick={() => setRedeemPoints(maxRedeemablePoints)} className="text-xs text-yellow-500 underline ml-auto">Max</button>
                </div>
              )}
            </div>
          )}

          {/* Gift Coupon redemption (balance-type, scan or type CPN-…) */}
          {isRetail && couponEligible && (
            <div className="rounded-xl border p-3" style={{ borderColor: 'var(--border)', background: 'color-mix(in srgb, #6366f1 6%, transparent)' }}>
              <div className="flex items-center gap-2 mb-2">
                <Ticket size={15} className="text-indigo-400" />
                <p className="text-xs font-semibold" style={{ color: 'var(--text-1)' }}>Gift Coupon</p>
                {couponInfo && (
                  <button onClick={clearCoupon} className="text-xs text-red-400 underline ml-auto">Remove</button>
                )}
              </div>
              {!couponInfo ? (
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={couponCode}
                    onChange={e => setCouponCode(e.target.value.toUpperCase())}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); validateCoupon() } }}
                    className="input py-1.5 text-sm font-mono flex-1"
                    placeholder="Scan or type CPN-…"
                  />
                  <button onClick={validateCoupon} disabled={couponChecking || !couponCode.trim()}
                    className="btn-secondary btn-sm px-3 disabled:opacity-40">
                    {couponChecking ? 'Checking…' : 'Apply'}
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-mono" style={{ color: 'var(--text-2)' }}>{String(couponInfo.code)}</span>
                    <span style={{ color: 'var(--text-3)' }}>
                      Issued to <b style={{ color: 'var(--text-2)' }}>{String(couponInfo.customer_name || 'Bearer')}</b>
                      {couponInfo.valid_until ? ` · valid till ${String(couponInfo.valid_until).slice(0, 10)}` : ''}
                    </span>
                  </div>
                  {couponCustomerMismatch && (
                    <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 px-2.5 py-1.5 text-xs text-amber-300">
                      ⚠ This coupon was issued to {String(couponInfo.customer_name)} — different from the bill customer.
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      value={couponAmount}
                      onChange={e => setCouponAmount(e.target.value)}
                      className="input py-1 text-sm w-32"
                      min={0}
                      max={Math.min(couponBalance, totalAfterLoyalty)}
                      step="0.01"
                    />
                    <span className="text-xs" style={{ color: 'var(--text-3)' }}>
                      of Rs.{couponBalance.toFixed(2)} balance — applying Rs.{couponApplied.toFixed(2)}
                    </span>
                    <button onClick={() => setCouponAmount(String(Math.min(couponBalance, totalAfterLoyalty).toFixed(2)))}
                      className="text-xs text-indigo-400 underline ml-auto">Max</button>
                  </div>
                </div>
              )}
            </div>
          )}

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
                    Amount Received
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
                    min={totalAfterCoupon}
                    step="0.01"
                    autoFocus
                  />
                </div>
              )}

              {/* Installment: requires a customer + a plan */}
              {method === 'installment' && (
                <div className="space-y-3">
                  <div>
                    <label className="label">Customer <span className="text-red-500">*</span></label>
                    <select
                      className="input"
                      value={(cart.customer as Record<string, string> | null)?.id || ''}
                      onChange={e => onInstallmentCustomerChange(e.target.value)}
                    >
                      <option value="">Select a customer…</option>
                      {customers.map(c => (
                        <option key={String(c.id)} value={String(c.id)}>
                          {String(c.name)}{c.phone ? ` · ${c.phone}` : ''}{c.nic ? ` · ${c.nic}` : ''}
                        </option>
                      ))}
                      <option value="__new__">＋ Add New Customer…</option>
                    </select>
                    {!cart.customer && (
                      <p className="text-xs mt-1 flex items-center gap-1" style={{ color: '#dc2626' }}>
                        <UserPlus size={11} /> Installment requires a customer — pick one above or add new.
                      </p>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="label">Installment Plan</label>
                      <select className="input" value={planId} onChange={e => setPlanId(e.target.value)}>
                        <option value="">Select plan…</option>
                        {plans.map(p => (
                          <option key={String(p.id)} value={String(p.id)}>
                            {String(p.name)} — {String(p.months)}mo{Number(p.interest_rate) > 0 ? ` @ ${p.interest_rate}%` : ' (0%)'}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="label">Down Payment</label>
                      <input type="number" className="input" value={downPayment} onChange={e => setDownPayment(e.target.value)} placeholder="0" min={0} max={cart.total} />
                    </div>
                  </div>
                  {selectedPlan && planMonths > 0 && (
                    <div className="rounded-lg p-3 text-sm" style={{ background: 'var(--bg-soft)' }}>
                      <div className="flex justify-between"><span style={{ color: 'var(--text-3)' }}>Financed</span><span>Rs.{insFinanced.toFixed(2)}</span></div>
                      <div className="flex justify-between"><span style={{ color: 'var(--text-3)' }}>{planMonths} monthly payments</span><strong style={{ color: 'var(--text-1)' }}>Rs.{insMonthly.toFixed(2)}/mo</strong></div>
                    </div>
                  )}
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
              {(method === 'card' || method === 'bank_transfer') && (
                <div>
                  <label className="label">Reference / Approval No.</label>
                  <input type="text" value={reference} onChange={e => setReference(e.target.value)}
                    className="input"
                    placeholder="e.g. AUTH123456"
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleConfirm() } }}
                  />
                </div>
              )}

              {/* Change display */}
              {method === 'cash' && change > 0 && (
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
