import { useCartStore } from '@/store/cartStore'
import { useAuthStore } from '@/store/authStore'
import { ShoppingCart, Trash2, Plus, Minus, Tag, ChevronDown, AlertTriangle } from 'lucide-react'
import { useState, useEffect } from 'react'
import toast from 'react-hot-toast'
import NumberInput from '@/components/shared/NumberInput'

// Same admin-type heuristic already used elsewhere (UsersPage.tsx's
// isAdminRole, electron/services/pinPolicy.ts's isAdminTypeRole) — a plain
// Cashier can't override a product's price at checkout, an admin-tier role
// (Company Admin, Branch Manager, ...) can.
function canEditPrice(user: { role?: { permissions?: Record<string, unknown> } } | null): boolean {
  const perms = user?.role?.permissions || {}
  return Boolean(perms.all || perms.reports || perms.employees || perms.settings || perms.branches)
}

interface DiscountPlan {
  id: string
  name: string
  type: 'percentage' | 'flat'
  value: number
}

interface Props {
  focusedIdx?: number
  onFocusIdx?: (idx: number) => void
  discountPlans?: Record<string, unknown>[]
}

export default function Cart({ focusedIdx = -1, onFocusIdx, discountPlans = [] }: Props) {
  const cart = useCartStore()
  const { user } = useAuthStore()
  const [showDiscount, setShowDiscount] = useState(false)
  const [selectedPlanId, setSelectedPlanId] = useState('')

  const plans = discountPlans as unknown as DiscountPlan[]

  const priceEditable = canEditPrice(user as { role?: { permissions?: Record<string, unknown> } } | null)
  // No more role-tier discount allowance (Admin → Discounts → Max Discount
  // Limits no longer applies here) — a product's own configured discount is
  // the only ceiling, for every role including Company Admin. The whole-bill
  // "Global Discount" isn't tied to one product, so its ceiling is the most
  // restrictive product currently in the cart (mirrors the server-side
  // minAllowedPct logic in electron/ipc/invoices.ts).
  const cartMaxDiscount = cart.items.length
    ? Math.min(...cart.items.map(i => i.auto_discount_pct ?? 0))
    : 0

  // Clamp focusedIdx to valid range
  const activeFocusedIdx = focusedIdx >= 0 && focusedIdx < cart.items.length ? focusedIdx : cart.items.length - 1

  useEffect(() => {
    const handler = () => setShowDiscount(true)
    window.addEventListener('pos:openDiscount', handler)
    return () => window.removeEventListener('pos:openDiscount', handler)
  }, [])

  const handleItemDiscount = (productId: string, pct: number) => {
    const item = cart.items.find(i => i.product.id === productId)
    const allowed = item?.auto_discount_pct ?? 0
    if (pct > allowed) {
      toast.error(
        allowed > 0
          ? `Max ${allowed}% discount allowed for this product.`
          : 'No discount is configured for this product.'
      )
      cart.setItemDiscount(productId, allowed)
      return
    }
    cart.setItemDiscount(productId, pct)
  }

  const handleGlobalDiscount = (pct: number) => {
    if (pct > cartMaxDiscount) {
      toast.error(
        cartMaxDiscount > 0
          ? `Max ${cartMaxDiscount}% discount allowed (most restrictive product in this cart).`
          : 'No discount is configured for one or more products in this cart.'
      )
      cart.setGlobalDiscount(cartMaxDiscount)
      return
    }
    cart.setGlobalDiscount(pct)
  }

  const handlePlanSelect = (planId: string) => {
    setSelectedPlanId(planId)
    if (!planId) return
    const plan = plans.find(p => p.id === planId)
    if (!plan) return
    const pct = plan.type === 'percentage'
      ? plan.value
      : cart.subtotal > 0 ? (plan.value / cart.subtotal) * 100 : 0
    handleGlobalDiscount(pct)
  }

  if (cart.items.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 p-6" style={{ color: 'var(--text-3)' }}>
        <div className="w-16 h-16 pos-empty-icon rounded-full flex items-center justify-center border">
          <ShoppingCart size={28} />
        </div>
        <p className="text-sm" style={{ color: 'var(--text-2)' }}>Cart is empty</p>
        <p className="text-xs text-center">Search products (F6) then press Enter to add</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Cart nav hint */}
      {cart.items.length > 1 && (
        <div className="px-3 pt-1.5 pb-0 flex items-center gap-2 text-xs" style={{ color: 'var(--text-3)' }}>
          <span><kbd className="kbd text-[9px]">Ctrl+↑↓</kbd> navigate • <kbd className="kbd text-[9px]">+/-</kbd> qty • <kbd className="kbd text-[9px]">Del</kbd> remove</span>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
        {cart.items.map((item, idx) => {
          const discountExceedsLimit = item.discount_pct > (item.auto_discount_pct ?? 0)
          const isFocused = idx === activeFocusedIdx

          return (
            <div
              key={item.product.id}
              data-cart-idx={idx}
              onClick={() => onFocusIdx?.(idx)}
              className={`pos-cart-item rounded-lg p-3 border transition-all cursor-pointer
                ${discountExceedsLimit ? 'border-amber-600/60' : ''}
                ${isFocused ? 'ring-2 ring-blue-500/60 border-blue-500/40' : ''}`}
            >
              {/* Row 1: name + focus indicator + remove */}
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    {isFocused && (
                      <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                    )}
                    <p className="text-sm font-medium leading-tight truncate" style={{ color: 'var(--text-1)' }}>
                      {item.product.name}
                    </p>
                  </div>
                  <p className="text-xs font-mono" style={{ color: 'var(--text-3)' }}>{item.product.sku}</p>
                </div>
                <button
                  onClick={e => { e.stopPropagation(); cart.removeItem(item.product.id); toast.success('Removed') }}
                  className="text-[var(--text-3)] hover:text-red-500 transition-colors flex-shrink-0 p-1"
                  title="Remove (Del when selected)"
                  tabIndex={-1}
                >
                  <Trash2 size={13} />
                </button>
              </div>

              {/* Row 2: qty control + price */}
              <div className="flex items-center gap-2 mt-2">
                <div className="pos-qty-control flex items-center rounded-lg border">
                  <button
                    onClick={e => { e.stopPropagation(); cart.updateQty(item.product.id, item.quantity - 1) }}
                    className="w-7 h-7 flex items-center justify-center text-[var(--text-3)] hover:text-[var(--text-1)] transition-colors"
                    title="Decrease (- key when selected)"
                    tabIndex={-1}
                  >
                    <Minus size={12} />
                  </button>
                  <NumberInput
                    value={item.quantity}
                    onChange={e => cart.updateQty(item.product.id, parseInt(e.target.value) || 0)}
                    onClick={e => e.stopPropagation()}
                    className="w-10 text-center bg-transparent text-sm font-bold border-0 outline-none"
                    style={{ color: 'var(--text-1)' }}
                    min="1"
                    tabIndex={-1}
                  />
                  <button
                    onClick={e => { e.stopPropagation(); cart.updateQty(item.product.id, item.quantity + 1) }}
                    className="w-7 h-7 flex items-center justify-center text-[var(--text-3)] hover:text-[var(--text-1)] transition-colors"
                    title="Increase (+ key when selected)"
                    tabIndex={-1}
                  >
                    <Plus size={12} />
                  </button>
                </div>

                <div className="flex-1 flex items-center gap-1" onClick={e => e.stopPropagation()}>
                  <span className="text-xs" style={{ color: 'var(--text-3)' }}>× Rs.</span>
                  {priceEditable ? (
                    <NumberInput
                      value={item.unit_price}
                      onChange={e => cart.updatePrice(item.product.id, parseFloat(e.target.value) || 0)}
                      className="w-20 bg-transparent text-xs border-0 outline-none"
                      style={{ color: 'var(--text-3)' }}
                      title="Edit price"
                      tabIndex={-1}
                    />
                  ) : (
                    <p className="text-xs" style={{ color: 'var(--text-3)' }}>{item.unit_price.toLocaleString()}</p>
                  )}
                </div>

                <div className="text-right">
                  <p className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>
                    Rs.{item.line_total.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </p>
                </div>
              </div>

              {/* Row 3: discount */}
              <div className="mt-1 flex items-center gap-2" onClick={e => e.stopPropagation()}>
                {discountExceedsLimit
                  ? <AlertTriangle size={11} className="text-amber-500" />
                  : <Tag size={11} style={{ color: 'var(--text-3)' }} />
                }
                <NumberInput
                  value={item.discount_pct}
                  onChange={e => handleItemDiscount(item.product.id, parseFloat(e.target.value) || 0)}
                  className={`w-16 bg-transparent text-xs border-0 outline-none ${
                    discountExceedsLimit ? 'text-amber-500' : 'text-[var(--text-3)]'
                  }`}
                  placeholder="Disc %"
                  min="0" max="100"
                  tabIndex={-1}
                />
                <span className="text-xs" style={{ color: 'var(--text-3)' }}>%</span>
                {item.discount_pct > 0 && (
                  <span className={`text-xs ${discountExceedsLimit ? 'text-amber-400' : 'text-green-400'}`}>
                    -Rs.{item.discount_amount.toFixed(2)}
                  </span>
                )}
                {discountExceedsLimit && <span className="text-xs text-amber-500 ml-auto">Exceeds product limit</span>}
              </div>

              {/* Keyboard hint when focused */}
              {isFocused && cart.items.length > 1 && (
                <div className="mt-1.5 flex items-center gap-2 text-[10px]" style={{ color: 'var(--text-3)' }}>
                  <span className="kbd text-[9px]">+/-</span><span>qty</span>
                  <span className="kbd text-[9px]">Del</span><span>remove</span>
                  <span className="kbd text-[9px]">Ctrl+↑↓</span><span>move</span>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Discounts — its own clearly-separated panel, distinct from the bill
          summary below, so discount entry can never be mistaken for a total. */}
      <div className="px-4 pt-3">
        <div className="rounded-lg border" style={{ borderColor: 'var(--border)', background: 'var(--bg-soft)' }}>
          <button
            onClick={() => setShowDiscount(d => !d)}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 w-full text-[var(--text-1)]"
            tabIndex={0}
          >
            <Tag size={12} /> Discounts <kbd className="kbd text-xs ml-1">F9</kbd>
            <ChevronDown size={12} className={`ml-auto transition-transform ${showDiscount ? 'rotate-180' : ''}`} />
          </button>
          {showDiscount && (
            <div className="px-3 pb-3 space-y-1.5 border-t" style={{ borderColor: 'var(--border)' }}>
              <p className="text-xs pt-2" style={{ color: 'var(--text-3)' }}>Global Discount (applies to the whole bill)</p>
              {plans.length > 0 && (
                <select
                  value={selectedPlanId}
                  onChange={e => handlePlanSelect(e.target.value)}
                  className="input py-1.5 text-sm w-full"
                >
                  <option value="">Custom %...</option>
                  {plans.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name} — {p.type === 'percentage' ? `${p.value}%` : `Rs.${p.value}`}
                    </option>
                  ))}
                </select>
              )}
              <div className="flex items-center gap-2">
                <NumberInput
                  value={cart.globalDiscount}
                  onChange={e => { setSelectedPlanId(''); handleGlobalDiscount(parseFloat(e.target.value) || 0) }}
                  className="input py-1.5 text-sm w-24"
                  placeholder="%"
                  min="0" max={cartMaxDiscount}
                />
                <span className="text-xs" style={{ color: 'var(--text-3)' }}>% (max {cartMaxDiscount}% — most restrictive product in cart)</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Bill Summary — totals only, nothing about discount entry */}
      <div className="pos-cart-total px-4 py-3 space-y-2">
        <div className="space-y-1">
          <div className="flex justify-between text-sm" style={{ color: 'var(--text-3)' }}>
            <span>Subtotal</span>
            <span>Rs.{cart.subtotal.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
          </div>
          {cart.discountAmount > 0 && (
            <div className="flex justify-between text-sm text-green-400">
              <span>Discount</span>
              <span>-Rs.{cart.discountAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
            </div>
          )}
          {cart.taxAmount > 0 && (
            <div className="flex justify-between text-sm" style={{ color: 'var(--text-3)' }}>
              <span>Tax</span>
              <span>Rs.{cart.taxAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
            </div>
          )}
          <div className="flex justify-between text-lg font-bold pt-2 border-t" style={{ color: 'var(--text-1)', borderColor: 'var(--border)' }}>
            <span>TOTAL</span>
            <span className="text-blue-400">
              Rs.{cart.total.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </span>
          </div>
        </div>

        <textarea
          value={cart.notes}
          onChange={e => cart.setNotes(e.target.value)}
          placeholder="Invoice notes... (optional)"
          className="input text-xs resize-none h-14"
          tabIndex={0}
        />

        <div className="text-center text-xs" style={{ color: 'var(--text-3)' }}>
          <kbd className="kbd">F12</kbd> to open payment
        </div>
      </div>
    </div>
  )
}
