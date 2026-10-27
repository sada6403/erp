import { useState, useEffect, useMemo } from 'react'
import type { ProductAttribute } from '@/types'
import NumberInput from '@/components/shared/NumberInput'
import { Plus, Trash2, Zap, CheckSquare, Square, Layers, Sparkles, AlertCircle, Tag, ShoppingCart, Armchair } from 'lucide-react'
import toast from 'react-hot-toast'

export interface VariantItem {
  id?: string
  selected: boolean
  variant_name: string
  sku: string
  barcode: string
  cost_price: number
  selling_price: number
  stock: number
  attributes: Record<string, string>
  image_url?: string
}

interface Props {
  productName: string
  baseSku: string
  baseCostPrice: number
  baseSellingPrice: number
  categoryId?: string
  businessType: 'supermarket' | 'normal'
  variants: VariantItem[]
  onChange: (variants: VariantItem[]) => void
}

export default function ProductVariantBuilder({
  productName,
  baseSku,
  baseCostPrice,
  baseSellingPrice,
  categoryId,
  businessType,
  variants,
  onChange,
}: Props) {
  const [availableAttributes, setAvailableAttributes] = useState<ProductAttribute[]>([])
  const [loadingAttrs, setLoadingAttrs] = useState(true)

  // Map of attributeId -> selected string values array
  const [selectedAttributeValues, setSelectedAttributeValues] = useState<Record<string, string[]>>({})
  // Inline new value input per attribute
  const [newValueInputs, setNewValueInputs] = useState<Record<string, string>>({})

  // Quick attribute creator modal/inline
  const [showAddAttribute, setShowAddAttribute] = useState(false)
  const [newAttrName, setNewAttrName] = useState('')
  const [newAttrValues, setNewAttrValues] = useState('')
  const [creatingAttr, setCreatingAttr] = useState(false)

  // Bulk edit states
  const [bulkPrice, setBulkPrice] = useState<string>('')
  const [bulkCost, setBulkCost] = useState<string>('')
  const [bulkStock, setBulkStock] = useState<string>('')

  // Load business-specific attributes
  const loadAttributes = async () => {
    setLoadingAttrs(true)
    try {
      const res = await (window as any).api.products.attributes.list({
        business_type: businessType,
        category_id: categoryId || undefined,
      })
      if (res.success && Array.isArray(res.data)) {
        setAvailableAttributes(res.data)
      }
    } catch (err) {
      console.error('Failed to load attributes:', err)
    } finally {
      setLoadingAttrs(false)
    }
  }

  useEffect(() => {
    loadAttributes()
  }, [businessType, categoryId])

  // Initialize selected attribute values if editing existing variants
  useEffect(() => {
    if (variants.length > 0 && Object.keys(selectedAttributeValues).length === 0) {
      const detectedValues: Record<string, Set<string>> = {}
      for (const v of variants) {
        if (v.attributes && typeof v.attributes === 'object') {
          for (const [attrName, attrVal] of Object.entries(v.attributes)) {
            const attrObj = availableAttributes.find(a => a.name.toLowerCase() === attrName.toLowerCase() || a.slug === attrName.toLowerCase())
            const key = attrObj ? attrObj.id : attrName
            if (!detectedValues[key]) detectedValues[key] = new Set()
            if (attrVal) detectedValues[key].add(String(attrVal))
          }
        }
      }
      const initial: Record<string, string[]> = {}
      for (const [k, set] of Object.entries(detectedValues)) {
        initial[k] = Array.from(set)
      }
      if (Object.keys(initial).length > 0) {
        setSelectedAttributeValues(initial)
      }
    }
  }, [variants, availableAttributes])

  // Toggle selection of an attribute
  const toggleAttribute = (attrId: string) => {
    setSelectedAttributeValues(prev => {
      const next = { ...prev }
      if (next[attrId]) {
        delete next[attrId]
      } else {
        next[attrId] = []
      }
      return next
    })
  }

  // Toggle or add an attribute value
  const toggleValue = (attrId: string, val: string) => {
    const clean = val.trim()
    if (!clean) return
    setSelectedAttributeValues(prev => {
      const current = prev[attrId] || []
      const exists = current.includes(clean)
      const updated = exists ? current.filter(v => v !== clean) : [...current, clean]
      return { ...prev, [attrId]: updated }
    })
  }

  // Add custom value typed into inline input
  const handleAddCustomValue = (attrId: string) => {
    const input = newValueInputs[attrId]?.trim()
    if (!input) return
    toggleValue(attrId, input)
    setNewValueInputs(prev => ({ ...prev, [attrId]: '' }))
  }

  // Quick create a new attribute
  const handleCreateAttribute = async () => {
    if (!newAttrName.trim()) {
      toast.error('Attribute name is required')
      return
    }
    setCreatingAttr(true)
    try {
      const values = newAttrValues.split(',').map(s => s.trim()).filter(Boolean)
      const res = await (window as any).api.products.attributes.create({
        name: newAttrName.trim(),
        business_type: businessType,
        category_id: categoryId || null,
        values,
      })
      if (res.success && res.data) {
        toast.success(`Created attribute "${newAttrName}"`)
        setShowAddAttribute(false)
        setNewAttrName('')
        setNewAttrValues('')
        await loadAttributes()
        // Auto-select the newly created attribute
        setSelectedAttributeValues(prev => ({ ...prev, [res.data.id]: values }))
      } else {
        toast.error(res.error || 'Failed to create attribute')
      }
    } catch (err: any) {
      toast.error(err.message || 'Error creating attribute')
    } finally {
      setCreatingAttr(false)
    }
  }

  // Calculate total combinations possible
  const totalCombinations = useMemo(() => {
    const activeEntries = Object.entries(selectedAttributeValues).filter(([, vals]) => vals.length > 0)
    if (activeEntries.length === 0) return 0
    return activeEntries.reduce((acc, [, vals]) => acc * vals.length, 1)
  }, [selectedAttributeValues])

  // Cartesian Product Generator
  const generateCombinations = () => {
    const activeEntries = Object.entries(selectedAttributeValues).filter(([, vals]) => vals.length > 0)
    if (activeEntries.length === 0) {
      toast.error('Select at least one attribute with at least one value')
      return
    }

    // Convert entries to array of { attrName, values }
    const list = activeEntries.map(([attrId, values]) => {
      const attr = availableAttributes.find(a => a.id === attrId)
      return {
        attrName: attr ? attr.name : attrId,
        values,
      }
    })

    // Cartesian product helper
    const cartesian = (arr: Array<{ attrName: string; values: string[] }>): Array<Record<string, string>> => {
      if (arr.length === 0) return [{}]
      const [first, ...rest] = arr
      const restCombos = cartesian(rest)
      const result: Array<Record<string, string>> = []
      for (const val of first.values) {
        for (const combo of restCombos) {
          result.push({ [first.attrName]: val, ...combo })
        }
      }
      return result
    }

    const combos = cartesian(list)

    // Build or preserve existing variants
    const newVariants: VariantItem[] = combos.map((attrs, idx) => {
      // Check if an existing variant already matches these exact attributes
      const matchExisting = variants.find(v => {
        if (!v.attributes) return false
        return Object.entries(attrs).every(([k, val]) => v.attributes[k] === val)
      })

      const attrSuffix = Object.values(attrs).join(' – ')
      const skuSuffix = Object.values(attrs).map(v => v.replace(/[^A-Za-z0-9]/g, '').slice(0, 4).toUpperCase()).join('-')
      const namePrefix = productName.trim() || 'Product'

      if (matchExisting) {
        return {
          ...matchExisting,
          attributes: attrs,
          variant_name: matchExisting.variant_name || `${namePrefix} – ${attrSuffix}`,
        }
      }

      return {
        selected: true,
        variant_name: `${namePrefix} – ${attrSuffix}`,
        sku: baseSku ? `${baseSku}-${skuSuffix}` : `VAR-${idx + 1}-${skuSuffix}`,
        barcode: '',
        cost_price: baseCostPrice || 0,
        selling_price: baseSellingPrice || 0,
        stock: 0,
        attributes: attrs,
      }
    })

    onChange(newVariants)
    toast.success(`Generated ${newVariants.length} variant combinations!`)
  }

  // Variant row field updater
  const updateVariant = (index: number, key: keyof VariantItem, val: any) => {
    const updated = [...variants]
    updated[index] = { ...updated[index], [key]: val }
    onChange(updated)
  }

  // Remove a variant row
  const removeVariant = (index: number) => {
    onChange(variants.filter((_, i) => i !== index))
  }

  // Toggle select all
  const allSelected = variants.length > 0 && variants.every(v => v.selected)
  const toggleSelectAll = () => {
    const targetState = !allSelected
    onChange(variants.map(v => ({ ...v, selected: targetState })))
  }

  // Bulk Apply Price to selected
  const applyBulkPrice = () => {
    const p = parseFloat(bulkPrice)
    if (isNaN(p) || p < 0) {
      toast.error('Enter a valid price')
      return
    }
    const updated = variants.map(v => v.selected ? { ...v, selling_price: p } : v)
    onChange(updated)
    setBulkPrice('')
    toast.success('Selling price applied to selected variants')
  }

  // Bulk Apply Cost to selected
  const applyBulkCost = () => {
    const c = parseFloat(bulkCost)
    if (isNaN(c) || c < 0) {
      toast.error('Enter a valid cost')
      return
    }
    const updated = variants.map(v => v.selected ? { ...v, cost_price: c } : v)
    onChange(updated)
    setBulkCost('')
    toast.success('Cost price applied to selected variants')
  }

  // Bulk Apply Stock to selected
  const applyBulkStock = () => {
    const s = parseInt(bulkStock, 10)
    if (isNaN(s) || s < 0) {
      toast.error('Enter a valid stock quantity')
      return
    }
    const updated = variants.map(v => v.selected ? { ...v, stock: s } : v)
    onChange(updated)
    setBulkStock('')
    toast.success('Stock applied to selected variants')
  }

  // Delete selected
  const deleteSelected = () => {
    const remaining = variants.filter(v => !v.selected)
    onChange(remaining)
    toast.success('Removed selected variants')
  }

  return (
    <div className="space-y-4 rounded-xl border border-indigo-900/40 bg-indigo-950/20 p-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2 pb-3 border-b border-indigo-900/40">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
            <Layers size={18} />
          </div>
          <div>
            <h4 className="text-sm font-bold text-white">Product Variants (பொருள் வகைகள் & அளவுகள்)</h4>
            <p className="text-xs text-slate-400">
              {businessType === 'supermarket'
                ? 'அளவுகள், சுவைகள் அல்லது வகைகளைத் தேர்ந்தெடுத்து தனித்தனி விலைகளுடன் வகைகளை உருவாக்கவும் (e.g. 100g, 500g, 1kg)'
                : 'நிறங்கள் அல்லது வகைகளைத் தேர்ந்தெடுத்து மாறுபட்ட பொருட்களை உருவாக்கவும் (e.g. Color, Material, Size)'}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setShowAddAttribute(true)}
          className="btn-secondary btn-sm text-xs gap-1.5"
        >
          <Plus size={13} /> Add Custom Attribute
        </button>
      </div>

      {/* Quick Attribute Creator Drawer/Card */}
      {showAddAttribute && (
        <div className="rounded-lg border border-indigo-500/40 bg-slate-900/90 p-3 space-y-3">
          <div className="flex items-center justify-between">
            <h5 className="text-xs font-bold text-indigo-300 uppercase tracking-wide">
              Create New Attribute (புதிய பண்புக்கூறு)
            </h5>
            <button
              type="button"
              onClick={() => setShowAddAttribute(false)}
              className="text-slate-400 hover:text-white text-xs"
            >
              ✕
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label text-xs">Attribute Name *</label>
              <input
                value={newAttrName}
                onChange={e => setNewAttrName(e.target.value)}
                placeholder={businessType === 'supermarket' ? 'e.g. Flavour, Fragrance, Pack Size' : 'e.g. Cushion Type, Fabric, Finish'}
                className="input text-xs"
              />
            </div>
            <div>
              <label className="label text-xs">Preset Values (Comma separated)</label>
              <input
                value={newAttrValues}
                onChange={e => setNewAttrValues(e.target.value)}
                placeholder="e.g. With Cushion, Without Cushion"
                className="input text-xs"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowAddAttribute(false)}
              className="btn-ghost btn-sm text-xs"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleCreateAttribute}
              disabled={creatingAttr}
              className="btn-primary btn-sm text-xs"
            >
              {creatingAttr ? 'Creating...' : 'Save Attribute'}
            </button>
          </div>
        </div>
      )}

      {/* Step 1: Attribute Selection Pills */}
      <div>
        <label className="label text-xs font-bold text-slate-300 uppercase tracking-wider mb-2 flex items-center justify-between">
          <span>1. Select Attributes Applicable for this Product:</span>
          {loadingAttrs && <span className="text-[11px] text-slate-500">Loading attributes...</span>}
        </label>

        <div className="flex flex-wrap gap-2">
          {availableAttributes.map(attr => {
            const isSelected = selectedAttributeValues[attr.id] !== undefined
            return (
              <button
                key={attr.id}
                type="button"
                onClick={() => toggleAttribute(attr.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all flex items-center gap-1.5 ${
                  isSelected
                    ? 'bg-brand-500 text-white border-brand-400 shadow-md shadow-brand-500/20'
                    : 'bg-slate-900/80 text-slate-300 border-slate-700/60 hover:border-slate-500'
                }`}
              >
                <span>{attr.name}</span>
                {isSelected && <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />}
              </button>
            )
          })}
        </div>
      </div>

      {/* Step 2: Configure Values for Selected Attributes */}
      {Object.keys(selectedAttributeValues).length > 0 && (
        <div className="space-y-3 pt-2">
          <label className="label text-xs font-bold text-slate-300 uppercase tracking-wider">
            2. Choose or Add Values for Selected Attributes:
          </label>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {Object.keys(selectedAttributeValues).map(attrId => {
              const attr = availableAttributes.find(a => a.id === attrId)
              const selectedVals = selectedAttributeValues[attrId] || []
              const allPresetVals = (attr?.values || []).map(v => typeof v === 'string' ? v : v.value)

              return (
                <div key={attrId} className="rounded-xl border border-slate-700/60 bg-slate-900/80 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-indigo-300 flex items-center gap-1.5">
                      <Tag size={12} /> {attr?.name || attrId}
                    </span>
                    <span className="text-[11px] text-slate-400">
                      {selectedVals.length} value{selectedVals.length !== 1 ? 's' : ''} selected
                    </span>
                  </div>

                  {/* Preset Values Chips */}
                  <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pr-1">
                    {allPresetVals.map(val => {
                      const isValSelected = selectedVals.includes(val)
                      return (
                        <button
                          key={val}
                          type="button"
                          onClick={() => toggleValue(attrId, val)}
                          className={`text-xs px-2 py-0.5 rounded-md border transition-all ${
                            isValSelected
                              ? 'bg-brand-600/30 text-brand-300 border-brand-500 font-semibold'
                              : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-slate-200'
                          }`}
                        >
                          {val} {isValSelected ? '✓' : '+'}
                        </button>
                      )
                    })}
                  </div>

                  {/* Add inline custom value */}
                  <div className="flex gap-1.5 pt-1">
                    <input
                      type="text"
                      placeholder={`Add new ${attr?.name || 'value'}...`}
                      value={newValueInputs[attrId] || ''}
                      onChange={e => setNewValueInputs(prev => ({ ...prev, [attrId]: e.target.value }))}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          handleAddCustomValue(attrId)
                        }
                      }}
                      className="input text-xs py-1 flex-1 h-7"
                    />
                    <button
                      type="button"
                      onClick={() => handleAddCustomValue(attrId)}
                      className="btn-secondary btn-sm text-xs px-2 py-1 h-7"
                    >
                      + Add
                    </button>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Generate Combinations Button */}
          <div className="pt-2 flex items-center justify-between bg-slate-900/60 rounded-xl p-3 border border-slate-800">
            <div>
              <p className="text-xs font-bold text-white flex items-center gap-1.5">
                <Sparkles size={14} className="text-amber-400" />
                Combination Summary:
              </p>
              <p className="text-xs text-slate-400 mt-0.5">
                {Object.entries(selectedAttributeValues)
                  .filter(([, vals]) => vals.length > 0)
                  .map(([attrId, vals]) => {
                    const attr = availableAttributes.find(a => a.id === attrId)
                    return `${vals.length} ${(attr?.name || attrId)}`
                  })
                  .join(' × ') || '0 selected'}{' '}
                = <strong>{totalCombinations} possible combination{totalCombinations !== 1 ? 's' : ''}</strong>
              </p>
            </div>

            <button
              type="button"
              onClick={generateCombinations}
              disabled={totalCombinations === 0}
              className="btn-primary btn-sm gap-1.5 bg-gradient-to-r from-brand-600 to-indigo-600 hover:from-brand-500 hover:to-indigo-500 font-bold px-4 shadow-lg shadow-indigo-600/30"
            >
              <Zap size={14} /> Generate Combinations
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Variants Table & Bulk Actions */}
      {variants.length > 0 && (
        <div className="space-y-3 pt-3 border-t border-indigo-900/40">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={toggleSelectAll}
                className="btn-secondary btn-sm text-xs gap-1.5"
              >
                {allSelected ? <CheckSquare size={13} /> : <Square size={13} />}
                {allSelected ? 'Deselect All' : 'Select All'}
              </button>
              <span className="text-xs text-slate-400">
                ({variants.filter(v => v.selected).length} of {variants.length} selected)
              </span>
            </div>

            {/* Bulk Toolbar */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <div className="flex items-center">
                <input
                  type="number"
                  placeholder="Price"
                  value={bulkPrice}
                  onChange={e => setBulkPrice(e.target.value)}
                  className="input text-xs w-20 h-7 rounded-r-none border-r-0"
                />
                <button
                  type="button"
                  onClick={applyBulkPrice}
                  className="btn-secondary btn-sm text-xs h-7 rounded-l-none"
                  title="Apply price to selected"
                >
                  Apply Price
                </button>
              </div>

              <div className="flex items-center">
                <input
                  type="number"
                  placeholder="Stock"
                  value={bulkStock}
                  onChange={e => setBulkStock(e.target.value)}
                  className="input text-xs w-16 h-7 rounded-r-none border-r-0"
                />
                <button
                  type="button"
                  onClick={applyBulkStock}
                  className="btn-secondary btn-sm text-xs h-7 rounded-l-none"
                  title="Apply stock to selected"
                >
                  Apply Stock
                </button>
              </div>

              {variants.some(v => v.selected) && (
                <button
                  type="button"
                  onClick={deleteSelected}
                  className="btn-ghost btn-sm text-xs text-red-400 hover:text-red-300 gap-1 h-7"
                >
                  <Trash2 size={12} /> Remove Selected
                </button>
              )}
            </div>
          </div>

          {/* Variants Table */}
          <div className="rounded-xl overflow-hidden border border-slate-700/60 bg-slate-900/90 max-h-80 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-800 text-slate-300 sticky top-0 z-10 font-semibold border-b border-slate-700">
                <tr>
                  <th className="w-8 px-3 py-2 text-center">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleSelectAll}
                      className="accent-brand-500 cursor-pointer"
                    />
                  </th>
                  <th className="text-left px-3 py-2">Variant Title</th>
                  <th className="text-left px-2 py-2">SKU</th>
                  <th className="text-left px-2 py-2">Barcode</th>
                  <th className="text-right px-2 py-2 w-24">Cost (Rs.)</th>
                  <th className="text-right px-2 py-2 w-24">Price (Rs.)</th>
                  <th className="text-right px-2 py-2 w-20">Stock</th>
                  <th className="w-8 px-2 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {variants.map((v, idx) => (
                  <tr
                    key={idx}
                    className={`transition-colors ${v.selected ? 'bg-indigo-950/20' : 'opacity-60 bg-slate-900/40'}`}
                  >
                    <td className="px-3 py-2 text-center">
                      <input
                        type="checkbox"
                        checked={v.selected}
                        onChange={e => updateVariant(idx, 'selected', e.target.checked)}
                        className="accent-brand-500 cursor-pointer"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="text"
                        value={v.variant_name}
                        onChange={e => updateVariant(idx, 'variant_name', e.target.value)}
                        className="input text-xs py-1 h-7 font-medium"
                      />
                    </td>
                    <td className="px-2 py-2">
                      <input
                        type="text"
                        value={v.sku}
                        onChange={e => updateVariant(idx, 'sku', e.target.value)}
                        className="input text-xs py-1 h-7 font-mono w-28"
                        placeholder="SKU"
                      />
                    </td>
                    <td className="px-2 py-2">
                      <input
                        type="text"
                        value={v.barcode}
                        onChange={e => updateVariant(idx, 'barcode', e.target.value)}
                        className="input text-xs py-1 h-7 font-mono w-28"
                        placeholder="Barcode"
                      />
                    </td>
                    <td className="px-2 py-2 text-right">
                      <NumberInput
                        value={v.cost_price}
                        onChange={e => updateVariant(idx, 'cost_price', parseFloat(e.target.value) || 0)}
                        className="input text-xs py-1 h-7 text-right w-24"
                        min="0"
                        step="0.01"
                      />
                    </td>
                    <td className="px-2 py-2 text-right">
                      <NumberInput
                        value={v.selling_price}
                        onChange={e => updateVariant(idx, 'selling_price', parseFloat(e.target.value) || 0)}
                        className="input text-xs py-1 h-7 text-right w-24 font-bold text-brand-300"
                        min="0"
                        step="0.01"
                      />
                    </td>
                    <td className="px-2 py-2 text-right">
                      <NumberInput
                        value={v.stock}
                        onChange={e => updateVariant(idx, 'stock', parseFloat(e.target.value) || 0)}
                        className="input text-xs py-1 h-7 text-right w-20"
                        min="0"
                      />
                    </td>
                    <td className="px-2 py-2 text-center">
                      <button
                        type="button"
                        onClick={() => removeVariant(idx)}
                        className="text-slate-500 hover:text-red-400 transition-colors p-1"
                        title="Remove combination"
                      >
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
