import { useState, useEffect } from 'react'
import Modal from '@/components/shared/Modal'
import type { ProductAttribute } from '@/types'
import { Plus, Trash2, Edit2, Tag, ShoppingCart, Armchair, Check, Layers, AlertCircle } from 'lucide-react'
import toast from 'react-hot-toast'

interface Props {
  onClose: () => void
  onUpdated?: () => void
  initialBusinessType?: 'supermarket' | 'normal'
}

export default function AttributeManagementModal({ onClose, onUpdated, initialBusinessType = 'supermarket' }: Props) {
  const [activeTab, setActiveTab] = useState<'supermarket' | 'normal'>(initialBusinessType)
  const [attributes, setAttributes] = useState<ProductAttribute[]>([])
  const [loading, setLoading] = useState(true)

  // Form state for creating / editing attribute
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formName, setFormName] = useState('')
  const [formSlug, setFormSlug] = useState('')
  const [formBusinessType, setFormBusinessType] = useState<'supermarket' | 'normal' | 'all'>(initialBusinessType)
  const [formValues, setFormValues] = useState<string[]>([])
  const [inputValue, setInputValue] = useState('')
  const [saving, setSaving] = useState(false)

  const loadAttributes = async () => {
    setLoading(true)
    try {
      const res = await (window as any).api.products.attributes.list({
        business_type: activeTab,
      })
      if (res.success && Array.isArray(res.data)) {
        setAttributes(res.data)
      } else {
        toast.error(res.error || 'Failed to load attributes')
      }
    } catch (err: any) {
      toast.error(err.message || 'Error loading attributes')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadAttributes()
  }, [activeTab])

  const openCreate = () => {
    setEditingId(null)
    setFormName('')
    setFormSlug('')
    setFormBusinessType(activeTab)
    setFormValues([])
    setInputValue('')
    setShowForm(true)
  }

  const openEdit = (attr: ProductAttribute) => {
    setEditingId(attr.id)
    setFormName(attr.name)
    setFormSlug(attr.slug)
    setFormBusinessType(attr.business_type || activeTab)
    const vals = (attr.values || []).map(v => typeof v === 'string' ? v : v.value)
    setFormValues(vals)
    setInputValue('')
    setShowForm(true)
  }

  const handleAddValue = () => {
    const clean = inputValue.trim()
    if (!clean) return
    if (!formValues.includes(clean)) {
      setFormValues(prev => [...prev, clean])
    }
    setInputValue('')
  }

  const handleRemoveValue = (valToRemove: string) => {
    setFormValues(prev => prev.filter(v => v !== valToRemove))
  }

  const handleSave = async () => {
    if (!formName.trim()) {
      toast.error('Attribute name is required')
      return
    }
    setSaving(true)
    try {
      if (editingId) {
        const res = await (window as any).api.products.attributes.update(editingId, {
          name: formName.trim(),
          slug: formSlug.trim() || undefined,
          business_type: formBusinessType,
          values: formValues.map(v => ({ value: v })),
        })
        if (res.success) {
          toast.success('Attribute updated successfully')
          setShowForm(false)
          loadAttributes()
          onUpdated?.()
        } else {
          toast.error(res.error || 'Failed to update attribute')
        }
      } else {
        const res = await (window as any).api.products.attributes.create({
          name: formName.trim(),
          slug: formSlug.trim() || undefined,
          business_type: formBusinessType,
          values: formValues,
        })
        if (res.success) {
          toast.success('Attribute created successfully')
          setShowForm(false)
          loadAttributes()
          onUpdated?.()
        } else {
          toast.error(res.error || 'Failed to create attribute')
        }
      }
    } catch (err: any) {
      toast.error(err.message || 'Error saving attribute')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (attr: ProductAttribute) => {
    if (!window.confirm(`Are you sure you want to remove attribute "${attr.name}"?`)) return
    try {
      const res = await (window as any).api.products.attributes.delete(attr.id)
      if (res.success) {
        toast.success(`Attribute "${attr.name}" deactivated`)
        loadAttributes()
        onUpdated?.()
      } else {
        toast.error(res.error || 'Failed to deactivate attribute')
      }
    } catch (err: any) {
      toast.error(err.message || 'Error deleting attribute')
    }
  }

  return (
    <Modal
      title="Product Variant Attributes Management (பண்புக்கூறுகள் மேலாண்மை)"
      onClose={onClose}
      size="xl"
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-secondary btn-sm px-4">
            Close
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Navigation Tabs */}
        <div className="flex items-center justify-between border-b border-slate-700/60 pb-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => { setActiveTab('supermarket'); setShowForm(false) }}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                activeTab === 'supermarket'
                  ? 'bg-emerald-600 text-white border-emerald-500 shadow-md shadow-emerald-600/20'
                  : 'bg-slate-900 text-slate-400 border-slate-700 hover:text-white'
              }`}
            >
              <ShoppingCart size={13} />
              <span>🛒 Supermarket Attributes</span>
            </button>

            <button
              type="button"
              onClick={() => { setActiveTab('normal'); setShowForm(false) }}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                activeTab === 'normal'
                  ? 'bg-amber-600 text-white border-amber-500 shadow-md shadow-amber-600/20'
                  : 'bg-slate-900 text-slate-400 border-slate-700 hover:text-white'
              }`}
            >
              <Armchair size={13} />
              <span>🛋️ Normal Company (Furniture/Appliances) Attributes</span>
            </button>
          </div>

          {!showForm && (
            <button
              type="button"
              onClick={openCreate}
              className="btn-primary btn-sm text-xs gap-1.5"
            >
              <Plus size={13} /> New Attribute
            </button>
          )}
        </div>

        {/* Create / Edit Form Card */}
        {showForm && (
          <div className="rounded-xl border border-indigo-500/40 bg-slate-900/90 p-4 space-y-4 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <h4 className="text-sm font-bold text-white flex items-center gap-2">
                <Tag size={14} className="text-brand-400" />
                {editingId ? `Edit Attribute: ${formName}` : `Create New ${activeTab === 'supermarket' ? 'Supermarket' : 'Company'} Attribute`}
              </h4>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="text-slate-400 hover:text-white text-xs"
              >
                ✕ Cancel
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="label text-xs">Attribute Name *</label>
                <input
                  type="text"
                  value={formName}
                  onChange={e => setFormName(e.target.value)}
                  placeholder={activeTab === 'supermarket' ? 'e.g. Flavour, Pack Size' : 'e.g. Cushion Type, Fabric, Model'}
                  className="input text-xs"
                  autoFocus
                />
              </div>

              <div>
                <label className="label text-xs">Slug / Identifier</label>
                <input
                  type="text"
                  value={formSlug}
                  onChange={e => setFormSlug(e.target.value)}
                  placeholder="e.g. cushion_type"
                  className="input text-xs font-mono"
                />
              </div>

              <div>
                <label className="label text-xs">Business Type Scope</label>
                <select
                  value={formBusinessType}
                  onChange={e => setFormBusinessType(e.target.value as any)}
                  className="input text-xs"
                >
                  <option value="supermarket">🛒 Supermarket Only</option>
                  <option value="normal">🛋️ Normal Company (Furniture, etc.) Only</option>
                  <option value="all">🌐 Universal (All Company Types)</option>
                </select>
              </div>
            </div>

            {/* Values Management */}
            <div>
              <label className="label text-xs">Predefined Attribute Values</label>
              <div className="flex flex-wrap gap-1.5 p-2 rounded-lg border border-slate-800 bg-slate-950/60 min-h-12 mb-2">
                {formValues.length === 0 ? (
                  <span className="text-xs text-slate-500 italic p-1">No predefined values added yet. Type below and press Enter.</span>
                ) : (
                  formValues.map(v => (
                    <span
                      key={v}
                      className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md bg-brand-600/30 text-brand-300 border border-brand-500/50"
                    >
                      <span>{v}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveValue(v)}
                        className="text-brand-400 hover:text-red-400 font-bold"
                      >
                        ✕
                      </button>
                    </span>
                  ))
                )}
              </div>

              <div className="flex gap-2">
                <input
                  type="text"
                  value={inputValue}
                  onChange={e => setInputValue(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      handleAddValue()
                    }
                  }}
                  placeholder="Type a value and press Enter or click Add (e.g. Aloe Vera, High-Density Foam)..."
                  className="input text-xs flex-1"
                />
                <button
                  type="button"
                  onClick={handleAddValue}
                  className="btn-secondary btn-sm text-xs px-3"
                >
                  + Add Value
                </button>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="btn-ghost btn-sm text-xs"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="btn-primary btn-sm text-xs px-4"
              >
                {saving ? 'Saving...' : editingId ? 'Update Attribute' : 'Save Attribute'}
              </button>
            </div>
          </div>
        )}

        {/* Attribute List */}
        <div className="space-y-3">
          <p className="text-xs text-slate-400">
            {activeTab === 'supermarket'
              ? 'These attributes are available when creating or editing Supermarket products (Sunsilk shampoo, Rice, Biscuits, Milk, etc.).'
              : 'These attributes are available when creating or editing Normal Company products (Furniture, Sofas, Electronics, Refrigerators, etc.).'}
          </p>

          {loading ? (
            <div className="space-y-2 py-4">
              <div className="h-14 rounded-xl pos-skeleton" />
              <div className="h-14 rounded-xl pos-skeleton" />
              <div className="h-14 rounded-xl pos-skeleton" />
            </div>
          ) : attributes.length === 0 ? (
            <div className="text-center py-12 rounded-xl border border-dashed border-slate-800 text-slate-500">
              <Layers size={32} className="mx-auto mb-2 opacity-40" />
              <p className="text-sm">No attributes configured for this business category.</p>
              <button onClick={openCreate} className="mt-3 btn-primary btn-sm text-xs">
                + Create First Attribute
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[50vh] overflow-y-auto pr-1">
              {attributes.map(attr => {
                const vals = (attr.values || []).map(v => typeof v === 'string' ? v : v.value)
                return (
                  <div
                    key={attr.id}
                    className="p-3.5 rounded-xl border border-slate-700/60 bg-slate-900/60 flex flex-col justify-between hover:border-slate-600 transition-colors"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-sm text-white">{attr.name}</span>
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">
                            {attr.slug}
                          </span>
                          {attr.is_system && (
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                              System
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => openEdit(attr)}
                            className="p-1 rounded text-slate-400 hover:text-brand-300 transition-colors"
                            title="Edit Attribute"
                          >
                            <Edit2 size={13} />
                          </button>
                          {!attr.is_system && (
                            <button
                              type="button"
                              onClick={() => handleDelete(attr)}
                              className="p-1 rounded text-slate-400 hover:text-red-400 transition-colors"
                              title="Delete Attribute"
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Values Pills */}
                      <div className="flex flex-wrap gap-1.5 mt-2.5">
                        {vals.length === 0 ? (
                          <span className="text-[11px] text-slate-500 italic">No preset values</span>
                        ) : (
                          vals.map((v, i) => (
                            <span
                              key={i}
                              className="text-[11px] font-medium px-2 py-0.5 rounded-md bg-slate-800/90 text-slate-300 border border-slate-700"
                            >
                              {v}
                            </span>
                          ))
                        )}
                      </div>
                    </div>

                    <div className="mt-3 pt-2 border-t border-slate-800/60 flex items-center justify-between text-[11px] text-slate-500">
                      <span>{vals.length} predefined value{vals.length !== 1 ? 's' : ''}</span>
                      <span className="capitalize">{attr.business_type} Catalog</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}
