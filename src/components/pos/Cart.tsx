import { useCartStore } from '@/store/cartStore'
import { useAuthStore } from '@/store/authStore'
import { ShoppingCart, Trash2, Plus, Minus, Tag, ChevronDown, AlertTriangle } from 'lucide-react'
import { useState, useEffect } from 'react'
import toast from 'react-hot-toast'

// Legacy fallback for roles nobody has explicitly configured yet via
// Admin → Discounts → Max Discount Limits (role.permissions.max_discount_pct).
function legacyMaxDiscount(roleName: string): number {
  const lower = roleName.toLowerCase()
  if (lower.includes('cashier')) return 5
  if (lower.includes('manager')) return 15
  return 100
}

function getMaxDiscount(user: { role?: { name?: string; permissions?: Record<string, unknown> } } | null): number {
  const roleName = user?.role?.name || 'Cashier'
  const perms = user?.role?.permissions || {}
  if (perms.all) return 100
  return typeof perms.max_discount_pct === 'number' ? perms.max_discount_pct : legacyMaxDiscount(roleName)
}

interface Props {
  focusedIdx?: number
  onFocusIdx?: (idx: number) => void
}

export default function Cart({ focusedIdx = -1, onFocusIdx }: Props) {
  const cart = useCartStore()
  const { user } = useAuthStore()
  const [showDiscount, setShowDiscount] = useState(false)

  const roleName = (user?.role as { name?: string } | null)?.name || 'Cashier'
  const maxDiscount = getMaxDiscount(user as { role?: { name?: string; permissions?: Record<string, unknown> } } | null)

  // Clamp focusedIdx to valid range
  const activeFocusedIdx = focusedIdx >= 0 && focusedIdx < cart.items.length ? focusedIdx : cart.items.length - 1

  useEffect(() => {
    const handler = () => setShowDiscount(true)
    window.addEventListener('pos:openDiscount', handler)
    return () => window.removeEventListener('pos:openDiscount', handler)
  }, [])

  const handleItemDiscount = (productId: string, pct: number) => {
    const item = cart.items.find(i => i.product.id === productId)
    const allowed = Math.max(maxDiscount, item?.auto_discount_pct ?? 0)
    if (pct > allowed) {
      toast.error(`Max ${allowed}% discount allowed for ${roleName}. Ask a manager to override.`)
      cart.setItemDiscount(productId, allowed)
      return
    }
    cart.setItemDiscount(productId, pct)
  }

  const handleGlobalDiscount = (pct: number) => {
    if (pct > maxDiscount) {
      toast.error(`Max ${maxDiscount}% discount allowed for ${roleName}.`)
      cart.setGlobalDiscount(maxDiscount)
      return
    }
    cart.setGlobalDiscount(pct)
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
          const discountExceedsLimit = item.discount_pct > maxDiscount
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
                  <input
                    type="number"
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

                <div className="flex-1">
                  <p className="text-xs" style={{ color: 'var(--text-3)' }}>× Rs.{item.unit_price.toLocaleString()}</p>
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
                <input
                  type="number"
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
                {discountExceedsLimit && <span className="text-xs text-amber-500 ml-auto">Needs approval</span>}
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

      {/* Totals + notes */}
      <div className="pos-cart-total px-4 py-3 space-y-2">
        <button
          onClick={() => setShowDiscount(d => !d)}
          className="flex items-center gap-1 text-xs text-[var(--text-3)] hover:text-[var(--text-1)] transition-colors w-full"
          tabIndex={0}
        >
          <Tag size={12} /> Global Discount <kbd className="kbd text-xs ml-1">F9</kbd>
          <ChevronDown size={12} className={`ml-auto transition-transform ${showDiscount ? 'rotate-180' : ''}`} />
        </button>
        {showDiscount && (
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={cart.globalDiscount}
              onChange={e => handleGlobalDiscount(parseFloat(e.target.value) || 0)}
              className="input py-1.5 text-sm w-24"
              placeholder="%"
              min="0" max={maxDiscount}
            />
            <span className="text-xs" style={{ color: 'var(--text-3)' }}>% (max {maxDiscount}% for {roleName})</span>
          </div>
        )}

        <div className="space-y-1 pt-1">
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
