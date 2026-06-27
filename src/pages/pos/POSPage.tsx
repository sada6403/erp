import { useState, useRef, useEffect, useCallback } from 'react'
import { useCartStore } from '@/store/cartStore'
import { useKeyboard, POS_SHORTCUTS } from '@/hooks/useKeyboard'
import type { Product, Customer } from '@/types'
import type { BillType } from '@/store/cartStore'
import ProductSearch from '@/components/pos/ProductSearch'
import ProductGrid from '@/components/pos/ProductGrid'
import Cart from '@/components/pos/Cart'
import PaymentModal from '@/components/pos/PaymentModal'
import CustomerSearchModal from '@/components/pos/CustomerSearchModal'
import HeldInvoicesModal from '@/components/pos/HeldInvoicesModal'
import {
  ShoppingCart, Search, User, Pause, CreditCard, Plus, FileText,
  Receipt, ClipboardList, BadgeDollarSign, Star, RotateCcw, Keyboard
} from 'lucide-react'
import toast from 'react-hot-toast'

const BILL_TYPES: { value: BillType; label: string; icon: React.ReactNode; key: string }[] = [
  { value: 'RETAIL',    label: 'Retail',    icon: <Receipt size={13} />,      key: 'Ctrl+1' },
  { value: 'QUOTATION', label: 'Quotation', icon: <ClipboardList size={13} />, key: 'Ctrl+2' },
  { value: 'CREDIT',    label: 'Credit',    icon: <BadgeDollarSign size={13} />, key: 'Ctrl+3' },
]

const TYPE_COLORS: Record<BillType, string> = {
  RETAIL:    'bg-blue-600 text-white border-blue-500 shadow-blue-950/30',
  QUOTATION: 'bg-amber-600 text-white border-amber-500 shadow-amber-950/30',
  CREDIT:    'bg-rose-600 text-white border-rose-500 shadow-rose-950/30',
}

const TYPE_META: Record<BillType, { label: string; accent: string; action: string }> = {
  RETAIL:    { label: 'Retail',    accent: 'text-blue-400',  action: 'Payment'   },
  QUOTATION: { label: 'Quotation', accent: 'text-amber-400', action: 'Save Quote'},
  CREDIT:    { label: 'Credit',    accent: 'text-rose-400',  action: 'Credit Bill'},
}

const TYPE_INACTIVE = 'pos-segment-inactive'

export default function POSPage() {
  const cart = useCartStore()
  const [searchQuery, setSearchQuery]   = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [showPayment, setShowPayment]   = useState(false)
  const [showCustomer, setShowCustomer] = useState(false)
  const [showHeld, setShowHeld]         = useState(false)
  const [showHelp, setShowHelp]         = useState(false)
  const [invoiceNumber, setInvoiceNumber] = useState<string>('')
  const [categories, setCategories]     = useState<{ id: string; name: string }[]>([])
  const [cartFocusedIdx, setCartFocusedIdx] = useState(-1)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    loadInvoiceNumber(cart.billType)
    loadCategories()
    searchRef.current?.focus()
  }, [])

  // Global: any printable key typed while NOT in an input → redirect to search
  useEffect(() => {
    const captureKey = (e: KeyboardEvent) => {
      if (showPayment || showCustomer || showHeld || showHelp) return
      const target = e.target as HTMLElement
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
      if (e.key.length !== 1) return          // skip arrows, F-keys, ESC, etc.
      if (e.ctrlKey || e.metaKey || e.altKey) return
      // Redirect: focus search and seed it with the pressed character
      setSearchQuery(e.key)
      searchRef.current?.focus()
    }
    window.addEventListener('keydown', captureKey)
    return () => window.removeEventListener('keydown', captureKey)
  }, [showPayment, showCustomer, showHeld, showHelp])

  useEffect(() => {
    loadInvoiceNumber(cart.billType)
  }, [cart.billType])

  // Reset cart focus when items change
  useEffect(() => {
    if (cartFocusedIdx >= cart.items.length) setCartFocusedIdx(cart.items.length - 1)
  }, [cart.items.length])

  const loadInvoiceNumber = async (type: BillType = 'RETAIL') => {
    const res = await window.api.invoices.nextNumber(type)
    if (res.success) setInvoiceNumber(res.data as string)
  }

  const loadCategories = async () => {
    const res = await window.api.admin.categories.list()
    if (res.success) {
      setCategories([
        { id: '', name: 'All' },
        ...(res.data as { id: string; name: string }[]).filter(c => c.id),
      ])
    }
  }

  const newInvoice = useCallback(() => {
    cart.clear()
    setCartFocusedIdx(-1)
    loadInvoiceNumber(cart.billType)
    setSearchQuery('')
    setSelectedCategory(null)
    searchRef.current?.focus()
    toast.success('New invoice started')
  }, [cart])

  const holdInvoice = useCallback(() => {
    if (cart.items.length === 0) { toast.error('Cart is empty'); return }
    toast.success('Invoice held')
    cart.clear()
    setCartFocusedIdx(-1)
    loadInvoiceNumber(cart.billType)
  }, [cart])

  const focusSearch = useCallback(() => {
    searchRef.current?.focus()
    searchRef.current?.select()
  }, [])

  const openDiscount = useCallback(() => {
    window.dispatchEvent(new CustomEvent('pos:openDiscount'))
  }, [])

  const openPayment = useCallback(() => {
    if (cart.items.length > 0) setShowPayment(true)
    else toast.error('Cart is empty')
  }, [cart.items.length])

  const focusProducts = useCallback(() => {
    document.querySelector<HTMLElement>('.pos-product-card')?.focus()
  }, [])

  const cycleCategory = useCallback(() => {
    if (categories.length <= 1) return
    const current = categories.findIndex(c => (selectedCategory || '') === c.id)
    const next = categories[(current + 1 + categories.length) % categories.length]
    setSelectedCategory(next.id || null)
  }, [categories, selectedCategory])

  // Navigate cart items with Ctrl+Arrow
  const navigateCart = useCallback((dir: 1 | -1) => {
    const len = cart.items.length
    if (len === 0) return
    setCartFocusedIdx(prev => {
      const base = prev >= 0 && prev < len ? prev : len - 1
      return Math.max(0, Math.min(len - 1, base + dir))
    })
    // Scroll cart item into view
    setTimeout(() => {
      document.querySelector(`[data-cart-idx="${
        Math.max(0, Math.min(cart.items.length - 1, (cartFocusedIdx >= 0 ? cartFocusedIdx : cart.items.length - 1) + dir))
      }"]`)?.scrollIntoView({ block: 'nearest' })
    }, 30)
  }, [cart.items.length, cartFocusedIdx])

  // +/- affect focused cart item (or last item if none focused)
  const changeItemQty = useCallback((delta: number) => {
    const len = cart.items.length
    if (len === 0) return
    const idx = cartFocusedIdx >= 0 && cartFocusedIdx < len ? cartFocusedIdx : len - 1
    const item = cart.items[idx]
    if (!item) return
    const newQty = item.quantity + delta
    if (newQty <= 0) {
      cart.removeItem(item.product.id)
      setCartFocusedIdx(Math.max(0, idx - 1))
      toast.success(`${item.product.name} removed`)
    } else {
      cart.updateQty(item.product.id, newQty)
    }
  }, [cart, cartFocusedIdx])

  const removeSelectedItem = useCallback(() => {
    const len = cart.items.length
    if (len === 0) return
    const idx = cartFocusedIdx >= 0 && cartFocusedIdx < len ? cartFocusedIdx : len - 1
    const item = cart.items[idx]
    if (!item) return
    cart.removeItem(item.product.id)
    setCartFocusedIdx(Math.max(0, idx - 1))
    toast.success(`${item.product.name} removed`)
  }, [cart, cartFocusedIdx])

  const toggleTheme = useCallback(() => {
    const nextDark = !document.documentElement.classList.contains('dark')
    document.documentElement.classList.toggle('dark', nextDark)
    localStorage.setItem('theme', nextDark ? 'dark' : 'light')
    window.dispatchEvent(new Event('themechange'))
  }, [])

  const handleBillTypeChange = useCallback((type: BillType) => {
    if (cart.items.length > 0) {
      toast.error('Clear cart before changing bill type')
      return
    }
    if (type === 'CREDIT' && !cart.customer) {
      toast('Please select a customer first for credit bills', { icon: '!' })
    }
    cart.setBillType(type)
    toast.success(`Switched to ${type.toLowerCase()} mode`)
  }, [cart])

  useKeyboard([
    { key: 'F1',  handler: newInvoice },
    { key: 'F2',  handler: () => setShowCustomer(true) },
    { key: 'F3',  handler: holdInvoice },
    { key: 'F4',  handler: openPayment },
    { key: 'F5',  handler: openPayment },
    { key: 'F6',  handler: focusSearch },
    { key: 'F7',  handler: focusProducts },
    { key: 'F8',  handler: cycleCategory },
    { key: 'F9',  handler: openDiscount },
    { key: 'F10', handler: () => setShowHelp(h => !h) },
    { key: 'F12', handler: openPayment },
    // Bill type switching
    { key: '1', ctrl: true, handler: () => handleBillTypeChange('RETAIL') },
    { key: '2', ctrl: true, handler: () => handleBillTypeChange('QUOTATION') },
    { key: '3', ctrl: true, handler: () => handleBillTypeChange('CREDIT') },
    // Cart navigation
    { key: 'ArrowUp',   ctrl: true, handler: () => navigateCart(-1) },
    { key: 'ArrowDown', ctrl: true, handler: () => navigateCart(1) },
    // Escape: clear search or focus it
    { key: 'Escape', handler: () => { setSearchQuery(''); focusSearch() } },
    // Qty
    { key: '+', handler: () => changeItemQty(1) },
    { key: '=', handler: () => changeItemQty(1) },
    { key: '-', handler: () => changeItemQty(-1) },
    { key: 'Delete', handler: removeSelectedItem },
    { key: 't', alt: true, handler: toggleTheme },
    { key: 's', ctrl: true, handler: openPayment },
    { key: 'p', ctrl: true, handler: openPayment },
  ])

  const handleProductSelect = useCallback((product: Product) => {
    if (!product.stock || product.stock <= 0) {
      if (cart.billType !== 'QUOTATION') {
        toast.error('Out of stock')
        return
      }
    }
    cart.addItem(product)
    // Auto-focus the newly added item (it will be last)
    setCartFocusedIdx(cart.items.length) // items hasn't updated yet, so this = new last index
    toast.success(`${product.name} added`, { duration: 900, position: 'bottom-right' })
  }, [cart])

  const handleScannerSubmit = async () => {
    const code = searchQuery.trim()
    if (!code) return
    const res = await window.api.products.searchSku(code)
    if (res.success && res.data) {
      const product = res.data as Product
      if ((!product.stock || product.stock <= 0) && cart.billType !== 'QUOTATION') {
        setSearchQuery(product.sku || code)
        toast.error('Out of stock in this branch. Check other branches below.')
        return
      }
      handleProductSelect(product)
      setSearchQuery('')
      searchRef.current?.focus()
      return
    }
    toast.error('Barcode not found')
  }

  const handleCustomerSelect = (customer: Customer) => {
    cart.setCustomer(customer)
    setShowCustomer(false)
    toast.success(`Customer: ${customer.name}`)
    searchRef.current?.focus()
  }

  const meta = TYPE_META[cart.billType]

  return (
    <div className="pos-shell absolute inset-0 flex flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="pos-toolbar flex items-center gap-3 px-4 py-3">
        {/* Bill type selector */}
        <div className="pos-segment flex items-center gap-1 p-1 rounded-lg border">
          {BILL_TYPES.map(bt => (
            <button
              key={bt.value}
              onClick={() => handleBillTypeChange(bt.value)}
              title={`${bt.label} (${bt.key})`}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold border transition-all shadow-sm ${
                cart.billType === bt.value ? TYPE_COLORS[bt.value] : TYPE_INACTIVE
              }`}
            >
              {bt.icon}
              {bt.label}
              <span className="hidden xl:inline kbd text-[9px] ml-0.5 opacity-60">{bt.key}</span>
            </button>
          ))}
        </div>

        <div className="pos-chip hidden xl:flex items-center gap-2 px-3 py-1.5 rounded-lg border">
          <FileText size={14} />
          <span className="text-xs font-mono">{invoiceNumber || 'Generating...'}</span>
        </div>

        {/* Customer button */}
        <button
          onClick={() => setShowCustomer(true)}
          title="Select customer (F2)"
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors border ${
            cart.billType === 'CREDIT' && !cart.customer
              ? 'bg-rose-950/50 border-rose-700 text-rose-200 hover:bg-rose-900/70'
              : 'pos-chip hover:bg-[var(--pos-hover)]'
          }`}
        >
          <User size={14} className={cart.billType === 'CREDIT' ? 'text-rose-400' : 'text-blue-400'} />
          <span className="max-w-40 truncate">
            {cart.customer?.name || (cart.billType === 'CREDIT' ? 'Select Customer' : 'Walk-in')}
          </span>
          <kbd className="kbd text-[9px]">F2</kbd>
          {cart.customer && (
            <button
              onClick={e => { e.stopPropagation(); cart.setCustomer(null) }}
              className="text-[var(--text-3)] hover:text-red-500 ml-0.5"
              title="Clear customer"
            >×</button>
          )}
        </button>

        {cart.billType === 'CREDIT' && cart.customer && <CreditInfoBadge customerId={cart.customer.id} />}

        <div className="flex-1" />

        <div className="hidden lg:flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-3)' }}>
          <Star size={13} className="text-amber-400" />
          <span>Fast sale mode</span>
        </div>

        <button onClick={() => setShowHeld(true)} className="btn-ghost btn-sm gap-1.5" title="View held invoices">
          <Pause size={13} /> Held
        </button>
        <button onClick={newInvoice} className="btn-ghost btn-sm gap-1.5" title="New invoice (F1)">
          <Plus size={13} /> <kbd className="kbd">F1</kbd>
        </button>
        <button onClick={holdInvoice} className="btn-secondary btn-sm gap-1.5" title="Hold invoice (F3)">
          <Pause size={13} /> Hold <kbd className="kbd">F3</kbd>
        </button>
        <button
          onClick={openPayment}
          disabled={cart.items.length === 0}
          title={`${meta.action} (F12)`}
          className={`btn-sm gap-1.5 font-semibold disabled:opacity-40 ${
            cart.billType === 'RETAIL' ? 'btn-primary' :
            cart.billType === 'QUOTATION' ? 'bg-amber-600 hover:bg-amber-500 text-white rounded-lg px-4' :
            'bg-rose-600 hover:bg-rose-500 text-white rounded-lg px-4'
          }`}
        >
          <CreditCard size={13} />
          {meta.action}
          <kbd className="kbd ml-1">F12</kbd>
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left: Search + Product area */}
        <div className="pos-main-pane flex flex-col flex-1 overflow-hidden">
          <div className="pos-searchbar p-3">
            <div className="relative">
              <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-3)' }} />
              <input
                ref={searchRef}
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    e.stopPropagation()
                    handleScannerSubmit()
                  }
                }}
                placeholder="Search by name, SKU or barcode... (F6)"
                className="input pl-11 pr-10 text-base h-12"
                autoFocus
              />
              {searchQuery && (
                <button
                  onClick={() => { setSearchQuery(''); searchRef.current?.focus() }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-3)] hover:text-[var(--text-1)]"
                  title="Clear search (ESC)"
                >
                  <RotateCcw size={15} />
                </button>
              )}
            </div>
          </div>

          {categories.length > 1 && (
            <div className="pos-categorybar flex gap-2 px-3 py-2 overflow-x-auto flex-shrink-0">
              {categories.map(cat => (
                <button
                  key={cat.id}
                  onClick={() => setSelectedCategory(cat.id || null)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all border ${
                    (selectedCategory === cat.id || (!selectedCategory && !cat.id))
                      ? 'bg-blue-600 text-white border-blue-500'
                      : 'pos-category-inactive'
                  }`}
                >
                  {cat.name}
                </button>
              ))}
              <span className="text-xs flex items-center gap-1 ml-2 shrink-0" style={{ color: 'var(--text-3)' }}>
                <kbd className="kbd">F8</kbd> cycle
              </span>
            </div>
          )}

          <div className="flex-1 overflow-y-auto p-4">
            {searchQuery ? (
              <ProductSearch query={searchQuery} onSelect={handleProductSelect} />
            ) : (
              <ProductGrid categoryId={selectedCategory} onSelect={handleProductSelect} />
            )}
          </div>
        </div>

        {/* Right: Cart */}
        <div className="pos-cart-pane w-[420px] max-w-[42vw] min-w-[360px] flex-shrink-0 flex flex-col">
          <div className="pos-cart-head flex items-center gap-2 px-4 py-3">
            <ShoppingCart size={16} className={meta.accent} />
            <span className="font-semibold text-sm">{meta.label} Cart</span>
            <span className="ml-auto text-xs font-mono" style={{ color: 'var(--text-3)' }}>{invoiceNumber || '...'}</span>
            {cart.items.length > 0 && <span className="badge-blue">{cart.items.length} items</span>}
          </div>
          <Cart focusedIdx={cartFocusedIdx} onFocusIdx={setCartFocusedIdx} />
        </div>
      </div>

      {/* Shortcut hint bar */}
      <div className="shortcut-hint">
        {POS_SHORTCUTS.map(s => (
          <span key={s.key} className="flex items-center gap-1 flex-shrink-0">
            <kbd className="kbd">{s.key}</kbd>
            <span>{s.label}</span>
          </span>
        ))}
        <button
          onClick={() => setShowHelp(h => !h)}
          className="ml-auto flex items-center gap-1 hover:text-[var(--text-1)] transition-colors shrink-0"
          title="Keyboard help (F10)"
        >
          <Keyboard size={12} />
          <kbd className="kbd">F10</kbd>
          <span>Help</span>
        </button>
      </div>

      {/* Modals */}
      {showPayment && (
        <PaymentModal
          invoiceNumber={invoiceNumber}
          billType={cart.billType}
          onClose={() => { setShowPayment(false); searchRef.current?.focus() }}
          onSuccess={() => {
            setShowPayment(false)
            cart.clear()
            setCartFocusedIdx(-1)
            loadInvoiceNumber(cart.billType)
            searchRef.current?.focus()
            toast.success(
              cart.billType === 'QUOTATION' ? 'Quotation saved!' :
              cart.billType === 'CREDIT'    ? 'Credit bill created!' :
              'Invoice completed!'
            )
          }}
        />
      )}
      {showCustomer && (
        <CustomerSearchModal
          onSelect={handleCustomerSelect}
          onClose={() => { setShowCustomer(false); searchRef.current?.focus() }}
        />
      )}
      {showHeld && <HeldInvoicesModal onClose={() => setShowHeld(false)} />}
      {showHelp && <KeyboardHelpOverlay onClose={() => setShowHelp(false)} />}
    </div>
  )
}

// ─── Keyboard help overlay ────────────────────────────────────────────────────
function KeyboardHelpOverlay({ onClose }: { onClose: () => void }) {
  useKeyboard([{ key: 'Escape', handler: onClose }, { key: 'F10', handler: onClose }])

  const sections = [
    {
      title: 'Invoice',
      rows: [
        ['F1', 'New Invoice'],
        ['F3', 'Hold Invoice'],
        ['F12 / F4', 'Open Payment'],
        ['Ctrl+1', 'Retail Bill'],
        ['Ctrl+2', 'Quotation'],
        ['Ctrl+3', 'Credit Sale'],
      ],
    },
    {
      title: 'Search & Products',
      rows: [
        ['F6', 'Focus Product Search'],
        ['F7', 'Focus Product Grid'],
        ['F8', 'Cycle Category'],
        ['↑ / ↓', 'Navigate search results'],
        ['Enter', 'Add product to cart'],
        ['ESC', 'Clear search'],
      ],
    },
    {
      title: 'Cart',
      rows: [
        ['Ctrl + ↑', 'Select item above'],
        ['Ctrl + ↓', 'Select item below'],
        ['+  or  =', 'Increase qty (selected item)'],
        ['-', 'Decrease qty (selected item)'],
        ['Delete', 'Remove selected item'],
        ['F9', 'Global discount'],
      ],
    },
    {
      title: 'Customer',
      rows: [
        ['F2', 'Search / select customer'],
        ['↑ / ↓', 'Navigate results'],
        ['Enter', 'Select highlighted customer'],
        ['ESC', 'Close customer search'],
      ],
    },
    {
      title: 'Payment Modal',
      rows: [
        ['Ctrl+1', 'Cash payment'],
        ['Ctrl+2', 'Card payment'],
        ['Ctrl+3', 'Bank transfer'],
        ['Ctrl+4', 'Gift voucher'],
        ['Ctrl+5', 'Installment'],
        ['Enter', 'Confirm payment'],
        ['ESC', 'Cancel'],
      ],
    },
    {
      title: 'After Payment',
      rows: [
        ['Enter / F1', 'New Invoice'],
        ['P', 'Print Thermal bill'],
        ['D', 'Print Dot Matrix'],
        ['A', 'Print A4'],
        ['E', 'Email invoice'],
      ],
    },
  ]

  return (
    <div className="fixed inset-0 bg-black/80 z-[200] flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="rounded-2xl border max-w-4xl w-full max-h-[85vh] overflow-y-auto"
        style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-2">
            <Keyboard size={18} className="text-blue-400" />
            <h2 className="font-bold text-lg" style={{ color: 'var(--text-1)' }}>Keyboard Shortcuts</h2>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs" style={{ color: 'var(--text-3)' }}>Press ESC or F10 to close</span>
            <button onClick={onClose} className="btn-secondary btn-sm">Close</button>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 p-6">
          {sections.map(sec => (
            <div key={sec.title} className="rounded-xl p-4 border" style={{ background: 'var(--bg-soft)', borderColor: 'var(--border)' }}>
              <h3 className="text-xs font-bold uppercase tracking-wide mb-3" style={{ color: 'var(--text-3)' }}>{sec.title}</h3>
              <table className="w-full">
                <tbody>
                  {sec.rows.map(([k, label]) => (
                    <tr key={k}>
                      <td className="py-1 pr-3 align-top">
                        <kbd className="kbd text-[10px] whitespace-nowrap">{k}</kbd>
                      </td>
                      <td className="py-1 text-xs" style={{ color: 'var(--text-2)' }}>{label}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
        <div className="px-6 pb-5 text-center text-xs" style={{ color: 'var(--text-3)' }}>
          Mouse is optional — every action is reachable with the keyboard
        </div>
      </div>
    </div>
  )
}

function CreditInfoBadge({ customerId }: { customerId: string }) {
  const [info, setInfo] = useState<{ credit_limit: number; outstanding_due: number; available_credit: number } | null>(null)

  useEffect(() => {
    window.api.invoices.creditSummary(customerId).then((res: { success: boolean; data: unknown }) => {
      if (res.success) setInfo(res.data as typeof info)
    })
  }, [customerId])

  if (!info) return null

  const isLow = info.available_credit < info.credit_limit * 0.2
  return (
    <div className={`hidden xl:flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs border ${
      isLow ? 'bg-red-950/40 border-red-700 text-red-300' : 'bg-emerald-950/40 border-emerald-700 text-emerald-300'
    }`}>
      <span>Credit: Rs.{info.available_credit.toLocaleString()} available</span>
    </div>
  )
}
