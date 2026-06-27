import { useState, useEffect } from 'react'
import PageHeader from '@/components/shared/PageHeader'
import Modal from '@/components/shared/Modal'
import { Plus, Edit2, ToggleLeft, ToggleRight, ChevronRight } from 'lucide-react'
import toast from 'react-hot-toast'

type Category = {
  id: string
  parent_id: string | null
  name: string
  description: string | null
  sort_order: number
  is_active: number
}

export default function CategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Category | null>(null)

  const load = async () => {
    const res = await window.api.admin.categories.list()
    if (res.success) setCategories(res.data as Category[])
  }

  useEffect(() => { load() }, [])

  const toggle = async (cat: Category) => {
    const newActive = cat.is_active ? 0 : 1
    await window.api.admin.categories.update(cat.id, { is_active: newActive })
    toast.success(newActive ? 'Category activated' : 'Category deactivated')
    load()
  }

  const parentMap = Object.fromEntries(categories.map(c => [c.id, c.name]))

  // Sort: root categories first, then children under parents
  const roots = categories.filter(c => !c.parent_id).sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
  const children = (parentId: string) => categories.filter(c => c.parent_id === parentId).sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))

  const rows: { cat: Category; depth: number }[] = []
  const flatten = (cats: Category[], depth: number) => {
    for (const cat of cats) {
      rows.push({ cat, depth })
      flatten(children(cat.id), depth + 1)
    }
  }
  flatten(roots, 0)

  const active = categories.filter(c => c.is_active).length

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader
        title="Categories"
        subtitle={`${active} active · ${categories.length} total`}
        actions={
          <button onClick={() => { setEditing(null); setShowForm(true) }} className="btn-primary btn-sm gap-1.5">
            <Plus size={14} /> Add Category
          </button>
        }
      />
      <div className="flex-1 overflow-auto">
        <table className="w-full">
          <thead className="sticky top-0 bg-surface-900 z-10">
            <tr>
              {['Category', 'Parent', 'Description', 'Sort', 'Status', ''].map(h => (
                <th key={h} className="table-header px-4 py-3 text-left">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ cat, depth }) => (
              <tr key={cat.id} className="table-row">
                <td className="table-cell font-medium">
                  <span className="flex items-center gap-1" style={{ paddingLeft: depth * 20 }}>
                    {depth > 0 && <ChevronRight size={12} className="text-slate-600 flex-shrink-0" />}
                    {cat.name}
                  </span>
                </td>
                <td className="table-cell text-slate-400 text-sm">
                  {cat.parent_id ? parentMap[cat.parent_id] || '—' : <span className="text-slate-600 text-xs">Root</span>}
                </td>
                <td className="table-cell text-slate-400 text-sm max-w-xs truncate">{cat.description || '—'}</td>
                <td className="table-cell text-slate-400 font-mono text-xs">{cat.sort_order}</td>
                <td className="table-cell">
                  <span className={cat.is_active ? 'badge-green' : 'badge-gray'}>
                    {cat.is_active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td className="table-cell">
                  <div className="flex items-center gap-1">
                    <button onClick={() => { setEditing(cat); setShowForm(true) }} className="btn-ghost btn-sm p-1.5" title="Edit">
                      <Edit2 size={13} />
                    </button>
                    <button onClick={() => toggle(cat)} className="btn-ghost btn-sm p-1.5" title={cat.is_active ? 'Deactivate' : 'Activate'}>
                      {cat.is_active
                        ? <ToggleRight size={15} className="text-green-400" />
                        : <ToggleLeft size={15} className="text-slate-500" />
                      }
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="table-cell text-center text-slate-500 py-12">
                  No categories yet. Click "Add Category" to get started.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {showForm && (
        <CategoryForm
          category={editing}
          allCategories={categories}
          onClose={() => setShowForm(false)}
          onSave={() => { setShowForm(false); load() }}
        />
      )}
    </div>
  )
}

function CategoryForm({
  category, allCategories, onClose, onSave
}: {
  category: Category | null
  allCategories: Category[]
  onClose: () => void
  onSave: () => void
}) {
  const cat = category as (Category & Record<string,unknown>) | null
  const [form, setForm] = useState({
    name:                   cat?.name              || '',
    short_code:             (cat?.short_code as string) || '',
    description:            cat?.description       || '',
    parent_id:              cat?.parent_id         || '',
    sort_order:             cat?.sort_order        ?? 0,
    show_in_menu:           cat?.show_in_menu !== 0,
    exclude_service_charge: Boolean(cat?.exclude_service_charge),
    issue_token:            Boolean(cat?.issue_token),
    image_url:              (cat?.image_url as string) || '',
  })
  const [saving, setSaving] = useState(false)

  const f = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }))
  const check = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(p => ({ ...p, [k]: e.target.checked }))

  const save = async () => {
    if (!form.name.trim()) { toast.error('Name is required'); return }
    setSaving(true)
    const payload = {
      name:                   form.name.trim(),
      short_code:             form.short_code.trim() || null,
      description:            form.description.trim() || null,
      parent_id:              form.parent_id || null,
      sort_order:             Number(form.sort_order) || 0,
      show_in_menu:           form.show_in_menu ? 1 : 0,
      exclude_service_charge: form.exclude_service_charge ? 1 : 0,
      issue_token:            form.issue_token ? 1 : 0,
      image_url:              form.image_url || null,
    }
    if (category) await window.api.admin.categories.update(category.id, payload)
    else          await window.api.admin.categories.create(payload)
    setSaving(false)
    toast.success('Saved')
    onSave()
  }

  const validParents = allCategories.filter(c => c.id !== category?.id && c.is_active)

  return (
    <Modal
      title={category ? 'Edit Category' : 'Add Category'}
      onClose={onClose}
      footer={<>
        <button onClick={onClose} className="btn-secondary">Cancel</button>
        <button onClick={save} disabled={saving} className="btn-primary">{saving ? 'Saving...' : 'Save'}</button>
      </>}
    >
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Category Name *</label>
          <input value={form.name} onChange={f('name')} className="input" placeholder="Enter Category Name" autoFocus />
        </div>
        <div>
          <label className="label">Parent Category</label>
          <select value={form.parent_id} onChange={f('parent_id')} className="input">
            <option value="">Select Category</option>
            {validParents.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Short Code</label>
          <input value={form.short_code} onChange={f('short_code')} className="input" placeholder="Enter Short Code" />
        </div>
        <div>
          <label className="label">Sort Order</label>
          <input type="number" value={form.sort_order} onChange={f('sort_order')} className="input" min={0} />
        </div>
        <div className="col-span-2">
          <label className="label">Description</label>
          <textarea value={form.description} onChange={f('description')} className="input resize-none h-20" placeholder="Type Your Description......" />
        </div>
        <div className="col-span-2 flex flex-wrap gap-x-6 gap-y-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.show_in_menu} onChange={check('show_in_menu')} className="w-4 h-4 accent-brand-500" />
            <span className="text-sm" style={{ color: 'var(--text-2)' }}>Show in Main Menu</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.exclude_service_charge} onChange={check('exclude_service_charge')} className="w-4 h-4 accent-brand-500" />
            <span className="text-sm" style={{ color: 'var(--text-2)' }}>Exclude from Service Charge</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.issue_token} onChange={check('issue_token')} className="w-4 h-4 accent-brand-500" />
            <span className="text-sm" style={{ color: 'var(--text-2)' }}>Issue Token</span>
          </label>
        </div>
        <div className="col-span-2">
          <label className="label">Upload Category Image URL</label>
          <input value={form.image_url} onChange={f('image_url')} className="input text-sm" placeholder="https://... or leave blank" />
          {form.image_url && (
            <div className="mt-2 w-20 h-20 rounded-lg overflow-hidden" style={{ background: 'var(--bg-page)', border: '1px solid var(--border)' }}>
              <img src={form.image_url} className="w-full h-full object-cover" alt="" />
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}
