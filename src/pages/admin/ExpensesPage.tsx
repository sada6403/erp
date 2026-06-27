import { useState, useEffect } from 'react'
import PageHeader from '@/components/shared/PageHeader'
import Modal from '@/components/shared/Modal'
import { Plus, Search, RefreshCw, Printer } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuthStore } from '@/store/authStore'

type Expense = Record<string, unknown>
type ExpCat  = Record<string, unknown>

function payStatusBadge(status: string) {
  if (status === 'paid')    return <span className="badge-green">Paid</span>
  if (status === 'partial') return <span className="badge-yellow">Partial</span>
  return <span className="badge-red">Unpaid</span>
}

export default function ExpensesPage() {
  const [expenses, setExpenses]   = useState<Expense[]>([])
  const [categories, setCategories] = useState<ExpCat[]>([])
  const [suppliers, setSuppliers] = useState<Record<string,unknown>[]>([])
  const [filters, setFilters]     = useState({ from_date: '', to_date: '', category_id: '' })
  const [showForm, setShowForm]   = useState(false)
  const [loading, setLoading]     = useState(false)

  const load = async () => {
    setLoading(true)
    const [e, c, s] = await Promise.all([
      window.api.admin.expenses.list(Object.fromEntries(Object.entries(filters).filter(([,v]) => v))),
      window.api.admin.expenseCategories.list(),
      window.api.admin.suppliers.list(),
    ])
    if (e.success) setExpenses(e.data as Expense[])
    if (c.success) setCategories(c.data as ExpCat[])
    if (s.success) setSuppliers(s.data as Record<string,unknown>[])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const totalAmount = expenses.reduce((s, e) => s + Number(e.amount || 0), 0)
  const totalPaid   = expenses.reduce((s, e) => s + Number(e.paid_amount || 0), 0)

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader title="Expenses" subtitle={`${expenses.length} records`}
        actions={
          <div className="flex gap-2">
            <button className="btn-ghost btn-sm gap-1" onClick={load} disabled={loading}>
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''}/> Refresh
            </button>
            <button className="btn-primary btn-sm gap-1" onClick={() => setShowForm(true)}>
              <Plus size={14}/> Add Expense
            </button>
          </div>
        }
      />

      {/* Filters */}
      <div className="flex flex-wrap gap-2 px-6 py-3 border-b border-slate-800">
        <div className="relative min-w-[180px]">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"/>
          <input className="input pl-8 text-sm" placeholder="Enter Keyword..." />
        </div>
        <select className="input w-44 text-sm" value={filters.category_id}
          onChange={e => setFilters(f => ({...f, category_id: e.target.value}))}>
          <option value="">Select Category</option>
          {categories.map(c => <option key={c.id as string} value={c.id as string}>{c.name as string}</option>)}
        </select>
        <div className="flex items-center gap-1">
          <label className="text-xs text-slate-500">From</label>
          <input type="date" className="input text-sm w-36" value={filters.from_date}
            onChange={e => setFilters(f => ({...f, from_date: e.target.value}))} />
        </div>
        <div className="flex items-center gap-1">
          <label className="text-xs text-slate-500">To</label>
          <input type="date" className="input text-sm w-36" value={filters.to_date}
            onChange={e => setFilters(f => ({...f, to_date: e.target.value}))} />
        </div>
        <button className="btn-primary btn-sm gap-1" onClick={load}>Filter</button>
        <button className="btn-secondary btn-sm" onClick={() => { setFilters({ from_date:'', to_date:'', category_id:'' }); load() }}>Reset</button>
      </div>

      {/* Summary */}
      {expenses.length > 0 && (
        <div className="flex gap-4 px-6 py-3 border-b" style={{ borderColor: 'var(--border)', background: 'var(--bg-page)' }}>
          <div className="text-sm"><span style={{ color: 'var(--text-3)' }}>Total Amount: </span><span className="font-bold" style={{ color: 'var(--text-1)' }}>Rs.{totalAmount.toLocaleString()}</span></div>
          <div className="text-sm"><span style={{ color: 'var(--text-3)' }}>Paid: </span><span className="font-bold text-green-500">Rs.{totalPaid.toLocaleString()}</span></div>
          <div className="text-sm"><span style={{ color: 'var(--text-3)' }}>Due: </span><span className="font-bold text-red-500">Rs.{(totalAmount - totalPaid).toLocaleString()}</span></div>
        </div>
      )}

      <div className="flex-1 overflow-auto">
        <table className="w-full">
          <thead className="sticky top-0 z-10" style={{ background: 'var(--bg-page)' }}>
            <tr>
              {['Date', 'Expense Category', 'Amount', 'Paid Amount', 'Location', 'Supplier', 'Payment due', 'Paid By', 'Payment Status', 'Action'].map(h =>
                <th key={h} className="table-header px-4 py-3 text-left text-xs">{h}</th>
              )}
            </tr>
          </thead>
          <tbody>
            {expenses.map(e => (
              <tr key={e.id as string} className="table-row">
                <td className="table-cell text-xs text-slate-400">
                  {e.created_at ? new Date(String(e.created_at)).toLocaleDateString() : '—'}
                </td>
                <td className="table-cell font-medium text-sm">{String(e.category_name || '—')}</td>
                <td className="table-cell font-semibold">Rs.{Number(e.amount||0).toLocaleString()}</td>
                <td className="table-cell text-green-400">Rs.{Number(e.paid_amount||0).toLocaleString()}</td>
                <td className="table-cell text-sm text-slate-400">{String(e.branch_name || '—')}</td>
                <td className="table-cell text-sm text-slate-400">{String(e.supplier_name || '—')}</td>
                <td className="table-cell text-xs text-slate-400">
                  {e.payment_due ? new Date(String(e.payment_due)).toLocaleDateString() : '—'}
                </td>
                <td className="table-cell text-sm text-slate-400">{String(e.paid_by_name || '—')}</td>
                <td className="table-cell">{payStatusBadge(String(e.payment_status || 'unpaid'))}</td>
                <td className="table-cell">
                  <button className="btn-ghost btn-sm p-1.5" title="Print"><Printer size={13}/></button>
                </td>
              </tr>
            ))}
            {expenses.length === 0 && !loading && (
              <tr><td colSpan={10} className="text-center py-16 text-slate-500">No records found</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {showForm && (
        <ExpenseForm
          categories={categories}
          suppliers={suppliers}
          onClose={() => setShowForm(false)}
          onSave={() => { setShowForm(false); load() }}
          onCategoryCreated={(id, name) => setCategories(cats => [...cats, { id, name }])}
        />
      )}
    </div>
  )
}

function ExpenseForm({ categories, suppliers, onClose, onSave, onCategoryCreated }: {
  categories: ExpCat[]
  suppliers: Record<string,unknown>[]
  onClose: () => void
  onSave: () => void
  onCategoryCreated: (id: string, name: string) => void
}) {
  const user = useAuthStore(s => s.user)
  const today = new Date().toISOString().split('T')[0]
  const [form, setForm] = useState({
    category_id: '', supplier_id: '',
    date: today, payment_due: today,
    amount: '', payment_date: today,
    payment_method: '', payment_amount: '',
    paid_by: user?.id || '',
    description: '', notes: '',
  })
  const [showAddCat, setShowAddCat] = useState(false)
  const [newCatName, setNewCatName] = useState('')
  const [saving, setSaving] = useState(false)
  const [users, setUsers] = useState<Record<string,unknown>[]>([])

  useEffect(() => {
    window.api.admin.users.list().then((r: { success: boolean; data: unknown }) => {
      if (r.success) setUsers(r.data as Record<string,unknown>[])
    })
  }, [])

  const f = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }))

  const addCategory = async () => {
    if (!newCatName.trim()) return
    const res = await window.api.admin.expenseCategories.create({ name: newCatName.trim() })
    if (res.success) {
      const id = (res.data as {id: string}).id
      onCategoryCreated(id, newCatName.trim())
      setForm(p => ({...p, category_id: id}))
      setShowAddCat(false)
      setNewCatName('')
      toast.success('Category created')
    } else toast.error(String(res.error))
  }

  const save = async () => {
    if (!form.category_id) { toast.error('Expense category is required'); return }
    if (!form.amount)      { toast.error('Expense amount is required');    return }
    setSaving(true)
    const paidAmt = Number(form.payment_amount) || 0
    const res = await window.api.admin.expenses.create({
      category_id:    form.category_id,
      supplier_id:    form.supplier_id || null,
      amount:         Number(form.amount),
      paid_amount:    paidAmt,
      payment_method: form.payment_method || null,
      payment_date:   form.payment_date || null,
      payment_due:    form.payment_due || null,
      paid_by:        form.paid_by || null,
      description:    form.description || null,
      notes:          form.notes || null,
      created_by:     user?.id || null,
    })
    setSaving(false)
    if (res.success) { toast.success('Expense recorded'); onSave() }
    else toast.error(String(res.error))
  }

  return (
    <Modal title="Create Expense" onClose={onClose} size="lg"
      footer={<>
        <button onClick={onClose} className="btn-secondary">Cancel</button>
        <button onClick={save} disabled={saving} className="btn-primary gap-1">
          <Printer size={13}/> {saving ? 'Saving...' : 'Save & Print'}
        </button>
      </>}>
      <div className="grid grid-cols-2 gap-4">
        {/* Left side */}
        <div className="space-y-3">
          <div>
            <label className="label">Expense Category *</label>
            <div className="flex gap-1.5">
              <select className="input flex-1" value={form.category_id} onChange={f('category_id')}>
                <option value="">Select Expense Category</option>
                {categories.map(c => <option key={c.id as string} value={c.id as string}>{c.name as string}</option>)}
              </select>
              <button onClick={() => setShowAddCat(s => !s)} className="btn-secondary btn-sm w-9 flex items-center justify-center">
                <Plus size={14}/>
              </button>
            </div>
            {showAddCat && (
              <div className="flex gap-2 mt-1.5">
                <input className="input text-sm flex-1" placeholder="Category name..." value={newCatName}
                  onChange={e => setNewCatName(e.target.value)} autoFocus
                  onKeyDown={e => { if (e.key === 'Enter') addCategory() }} />
                <button className="btn-primary btn-sm" onClick={addCategory}>Save</button>
              </div>
            )}
          </div>
          <div>
            <label className="label">Location</label>
            <input className="input bg-surface-700 cursor-not-allowed" value={user?.branch?.name || 'Main Branch'} readOnly />
          </div>
          <div>
            <label className="label">Supplier</label>
            <select className="input" value={form.supplier_id} onChange={f('supplier_id')}>
              <option value="">Select Supplier</option>
              {suppliers.map(s => <option key={s.id as string} value={s.id as string}>{s.name as string}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Date *</label>
            <input type="date" className="input" value={form.date} onChange={f('date')} />
          </div>
          <div>
            <label className="label">Payment due date *</label>
            <input type="date" className="input" value={form.payment_due} onChange={f('payment_due')} />
          </div>
          <div>
            <label className="label">Expense Amount *</label>
            <input type="number" className="input" placeholder="Enter Expense Amount" value={form.amount} onChange={f('amount')} min="0" step="0.01" />
          </div>
          <div>
            <label className="label">Paid By</label>
            <select className="input" value={form.paid_by} onChange={f('paid_by')}>
              <option value="">Select Paid By User</option>
              {users.map(u => <option key={u.id as string} value={u.id as string}>{u.name as string}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Description</label>
            <textarea className="input resize-none h-20 text-sm" placeholder="Type Your Description......"
              value={form.description} onChange={f('description')} />
          </div>
        </div>

        {/* Right side: Add Payments */}
        <div className="space-y-3 rounded-xl p-4" style={{ background: 'var(--bg-page)', border: '1px solid var(--border)' }}>
          <h3 className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>Add Payments</h3>
          <div>
            <label className="label">Payment Date *</label>
            <input type="date" className="input" value={form.payment_date} onChange={f('payment_date')} />
          </div>
          <div>
            <label className="label">Payment Method *</label>
            <select className="input" value={form.payment_method} onChange={f('payment_method')}>
              <option value="">Select Payment Method</option>
              <option value="cash">Cash</option>
              <option value="card">Card</option>
              <option value="bank_transfer">Bank Transfer</option>
              <option value="cheque">Cheque</option>
            </select>
          </div>
          <div>
            <label className="label">Amount *</label>
            <div className="flex">
              <span className="flex items-center px-2.5 rounded-l-lg text-sm" style={{ background: 'var(--bg-page)', border: '1px solid var(--border-2)', borderRight: 'none', color: 'var(--text-3)' }}>Rs.</span>
              <input type="number" className="input rounded-l-none border-l-0" placeholder="Enter Amount"
                value={form.payment_amount} onChange={f('payment_amount')} min="0" step="0.01" />
            </div>
          </div>
          <div>
            <label className="label">Note</label>
            <textarea className="input resize-none h-20 text-sm" placeholder="Type Your Note......"
              value={form.notes} onChange={f('notes')} />
          </div>
        </div>
      </div>
    </Modal>
  )
}
