import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { ArrowLeft, Save, Truck, Plus, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuthStore } from '@/store/authStore'

interface Branch {
  id: string
  name: string
  address: string
}

interface Product {
  id: string
  name: string
  sku: string
  unit: string
}

interface TransferItem {
  id: string // temporary client id
  product_id: string
  product_name: string
  quantity: number
  unit: string
  package_count: number
  serial_batch_no: string
  description: string
}

export default function BranchTransferForm() {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  
  const [branches, setBranches] = useState<Branch[]>([])
  const [products, setProducts] = useState<Product[]>([])
  
  const [loading, setLoading] = useState(false)
  
  const [toBranchId, setToBranchId] = useState('')
  const [items, setItems] = useState<TransferItem[]>([])
  
  const [driverName, setDriverName] = useState('')
  const [vehicleNumber, setVehicleNumber] = useState('')
  const [driverPhone, setDriverPhone] = useState('')
  const [issuingOfficer, setIssuingOfficer] = useState('')
  const [expectedDelivery, setExpectedDelivery] = useState('')
  const [notes, setNotes] = useState('')

  const fromBranchId = user?.branch?.id || ''

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    try {
      // Load branches
      const branchRes = await window.api.admin?.branches?.list?.()
      if (branchRes?.success) {
        setBranches(branchRes.data.filter((b: any) => b.is_active && b.id !== fromBranchId))
      }
      
      // Load products (ideally stocks available in current branch)
      const prodRes = await window.api.products?.list?.({ is_active: 1 })
      if (prodRes?.success) {
        setProducts(prodRes.data)
      }
    } catch (err: any) {
      toast.error('Failed to load form data: ' + err.message)
    }
  }

  const addItem = () => {
    setItems([...items, {
      id: crypto.randomUUID(),
      product_id: '',
      product_name: '',
      quantity: 1,
      unit: '',
      package_count: 0,
      serial_batch_no: '',
      description: ''
    }])
  }

  const updateItem = (id: string, field: keyof TransferItem, value: any) => {
    setItems(items.map(item => {
      if (item.id === id) {
        const updated = { ...item, [field]: value }
        if (field === 'product_id') {
          const p = products.find(prod => prod.id === value)
          if (p) {
            updated.product_name = p.name
            updated.unit = p.unit || ''
          }
        }
        return updated
      }
      return item
    }))
  }

  const removeItem = (id: string) => {
    setItems(items.filter(item => item.id !== id))
  }

  const handleSubmit = async (status: 'draft' | 'dispatched') => {
    if (!toBranchId) return toast.error('Please select a destination branch')
    if (items.length === 0) return toast.error('Please add at least one item')
    
    for (const item of items) {
      if (!item.product_id) return toast.error('Please select a product for all items')
      if (item.quantity <= 0) return toast.error('Quantity must be greater than zero')
    }

    try {
      setLoading(true)
      const payload = {
        from_branch_id: fromBranchId,
        to_branch_id: toBranchId,
        status,
        driver_name: driverName,
        vehicle_number: vehicleNumber,
        driver_phone: driverPhone,
        issuing_officer_name: issuingOfficer,
        expected_delivery_at: expectedDelivery || null,
        notes,
        items
      }
      
      const res = await window.api.branchTransfers.create(payload)
      if (res.success) {
        toast.success(`Transfer ${status === 'dispatched' ? 'dispatched' : 'saved as draft'} successfully`)
        navigate(`/admin/branch-transfers/${res.data.id}`)
      } else {
        throw new Error(res.error)
      }
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Link 
          to="/admin/branch-transfers"
          className="p-2 bg-surface-800 hover:bg-surface-700 rounded-lg transition-colors border border-surface-700"
        >
          <ArrowLeft className="w-5 h-5 text-slate-300" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-white">New Branch Transfer</h1>
          <p className="text-slate-400 text-sm mt-1">Create a stock transfer to another branch</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-surface-800 rounded-xl p-6 border border-surface-700 space-y-4">
            <h2 className="text-lg font-semibold text-white">Transfer Details</h2>
            
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Destination Branch</label>
              <select 
                value={toBranchId}
                onChange={e => setToBranchId(e.target.value)}
                className="w-full bg-surface-900 border border-surface-600 text-white px-4 py-2 rounded-lg focus:outline-none focus:border-brand-500"
              >
                <option value="">Select Destination Branch</option>
                {branches.map(b => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Notes</label>
              <textarea 
                value={notes}
                onChange={e => setNotes(e.target.value)}
                rows={3}
                className="w-full bg-surface-900 border border-surface-600 text-white px-4 py-2 rounded-lg focus:outline-none focus:border-brand-500 resize-none"
                placeholder="Optional notes for this transfer..."
              />
            </div>
          </div>

          <div className="bg-surface-800 rounded-xl p-6 border border-surface-700 space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-semibold text-white">Items</h2>
              <button 
                onClick={addItem}
                className="flex items-center gap-1.5 text-sm text-brand-400 hover:text-brand-300 transition-colors bg-brand-400/10 hover:bg-brand-400/20 px-3 py-1.5 rounded-lg"
              >
                <Plus className="w-4 h-4" /> Add Item
              </button>
            </div>

            {items.length === 0 ? (
              <div className="text-center py-8 text-slate-400 bg-surface-900/50 rounded-lg border border-surface-700 border-dashed">
                No items added yet. Click "Add Item" to begin.
              </div>
            ) : (
              <div className="space-y-4">
                {items.map((item, index) => (
                  <div key={item.id} className="p-4 bg-surface-900 border border-surface-700 rounded-lg flex gap-4">
                    <div className="w-8 flex-shrink-0 text-slate-500 font-medium pt-2">
                      {index + 1}.
                    </div>
                    
                    <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-slate-400 mb-1">Product</label>
                        <select 
                          value={item.product_id}
                          onChange={e => updateItem(item.id, 'product_id', e.target.value)}
                          className="w-full bg-surface-800 border border-surface-600 text-white px-3 py-1.5 rounded-lg focus:outline-none focus:border-brand-500 text-sm"
                        >
                          <option value="">Select Product</option>
                          {products.map(p => (
                            <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>
                          ))}
                        </select>
                      </div>
                      
                      <div className="flex gap-4">
                        <div className="flex-1">
                          <label className="block text-xs font-medium text-slate-400 mb-1">Quantity</label>
                          <div className="flex gap-2">
                            <input 
                              type="number"
                              min="0.01" step="0.01"
                              value={item.quantity || ''}
                              onChange={e => updateItem(item.id, 'quantity', parseFloat(e.target.value))}
                              className="w-full bg-surface-800 border border-surface-600 text-white px-3 py-1.5 rounded-lg focus:outline-none focus:border-brand-500 text-sm"
                            />
                            <span className="inline-flex items-center text-sm text-slate-400">{item.unit || 'units'}</span>
                          </div>
                        </div>
                        <div className="flex-1">
                          <label className="block text-xs font-medium text-slate-400 mb-1">Packages</label>
                          <input 
                            type="number"
                            min="0"
                            value={item.package_count || ''}
                            onChange={e => updateItem(item.id, 'package_count', parseInt(e.target.value))}
                            className="w-full bg-surface-800 border border-surface-600 text-white px-3 py-1.5 rounded-lg focus:outline-none focus:border-brand-500 text-sm"
                            placeholder="e.g. 2 boxes"
                          />
                        </div>
                      </div>

                      <div className="md:col-span-2 flex gap-4">
                        <div className="flex-1">
                          <label className="block text-xs font-medium text-slate-400 mb-1">Serial / Batch No (Optional)</label>
                          <input 
                            type="text"
                            value={item.serial_batch_no}
                            onChange={e => updateItem(item.id, 'serial_batch_no', e.target.value)}
                            className="w-full bg-surface-800 border border-surface-600 text-white px-3 py-1.5 rounded-lg focus:outline-none focus:border-brand-500 text-sm"
                          />
                        </div>
                        <div className="flex-1">
                          <label className="block text-xs font-medium text-slate-400 mb-1">Description (Optional)</label>
                          <input 
                            type="text"
                            value={item.description}
                            onChange={e => updateItem(item.id, 'description', e.target.value)}
                            className="w-full bg-surface-800 border border-surface-600 text-white px-3 py-1.5 rounded-lg focus:outline-none focus:border-brand-500 text-sm"
                          />
                        </div>
                      </div>
                    </div>
                    
                    <div className="pt-6 flex-shrink-0">
                      <button 
                        onClick={() => removeItem(item.id)}
                        className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors"
                        title="Remove Item"
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        
        <div className="space-y-6">
          <div className="bg-surface-800 rounded-xl p-6 border border-surface-700 space-y-4 sticky top-6">
            <h2 className="text-lg font-semibold text-white">Delivery Info</h2>
            
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Issuing Officer</label>
              <input 
                type="text"
                value={issuingOfficer}
                onChange={e => setIssuingOfficer(e.target.value)}
                className="w-full bg-surface-900 border border-surface-600 text-white px-4 py-2 rounded-lg focus:outline-none focus:border-brand-500"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Driver Name</label>
              <input 
                type="text"
                value={driverName}
                onChange={e => setDriverName(e.target.value)}
                className="w-full bg-surface-900 border border-surface-600 text-white px-4 py-2 rounded-lg focus:outline-none focus:border-brand-500"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Vehicle Number</label>
              <input 
                type="text"
                value={vehicleNumber}
                onChange={e => setVehicleNumber(e.target.value)}
                className="w-full bg-surface-900 border border-surface-600 text-white px-4 py-2 rounded-lg focus:outline-none focus:border-brand-500"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Driver Phone</label>
              <input 
                type="text"
                value={driverPhone}
                onChange={e => setDriverPhone(e.target.value)}
                className="w-full bg-surface-900 border border-surface-600 text-white px-4 py-2 rounded-lg focus:outline-none focus:border-brand-500"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Expected Delivery</label>
              <input 
                type="datetime-local"
                value={expectedDelivery}
                onChange={e => setExpectedDelivery(e.target.value)}
                className="w-full bg-surface-900 border border-surface-600 text-white px-4 py-2 rounded-lg focus:outline-none focus:border-brand-500"
              />
            </div>

            <div className="pt-4 border-t border-surface-700 flex flex-col gap-3">
              <button 
                onClick={() => handleSubmit('dispatched')}
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 bg-brand-600 hover:bg-brand-500 text-white px-4 py-3 rounded-lg font-semibold transition-colors disabled:opacity-50"
              >
                <Truck className="w-5 h-5" />
                Submit & Dispatch
              </button>
              
              <button 
                onClick={() => handleSubmit('draft')}
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 bg-surface-700 hover:bg-surface-600 text-white px-4 py-3 rounded-lg font-semibold transition-colors disabled:opacity-50"
              >
                <Save className="w-5 h-5 text-slate-400" />
                Save as Draft
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
