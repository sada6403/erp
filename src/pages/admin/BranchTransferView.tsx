import { useState, useEffect, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, Check, Truck, AlertTriangle, Printer, FileText } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuthStore } from '@/store/authStore'
import { DeliveryNoteTemplate } from '@/components/print/DeliveryNoteTemplate'
import { createPortal } from 'react-dom'

export default function BranchTransferView() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuthStore()
  
  const [transfer, setTransfer] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [settings, setSettings] = useState<any>({})

  // Receive modal states
  const [showReceive, setShowReceive] = useState(false)
  const [receiveItems, setReceiveItems] = useState<any[]>([])
  const [receiveName, setReceiveName] = useState('')
  const [receiveDesig, setReceiveDesig] = useState('')
  const [authorized, setAuthorized] = useState(false)

  // Resolve modal states
  const [showResolve, setShowResolve] = useState(false)
  const [adminReason, setAdminReason] = useState('')
  
  const printRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    loadData()
  }, [id])

  async function loadData() {
    try {
      setLoading(true)
      const [tRes, sRes] = await Promise.all([
        window.api.branchTransfers.getById(id!),
        window.api.settings.get()
      ])
      
      if (sRes.success) setSettings(sRes.data)
      
      if (tRes.success) {
        setTransfer(tRes.data)
        // Initialize receive items
        setReceiveItems(tRes.data.items.map((i: any) => ({
          item_id: i.id,
          product_name: i.product_name,
          sent_qty: i.quantity,
          received_qty: i.quantity,
          damaged_qty: 0,
        })))
      } else {
        toast.error(tRes.error)
      }
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleApprove = async () => {
    try {
      const res = await window.api.branchTransfers.updateStatus(id!, 'approved')
      if (res.success) {
        toast.success('Transfer approved successfully')
        loadData()
      } else throw new Error(res.error)
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  const handleDispatch = async () => {
    try {
      const res = await window.api.branchTransfers.updateStatus(id!, 'dispatched')
      if (res.success) {
        toast.success('Transfer dispatched')
        loadData()
      } else throw new Error(res.error)
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  const handleReceive = async () => {
    try {
      const payload = {
        items: receiveItems,
        received_by_name: receiveName,
        received_designation: receiveDesig,
        notes: `Signed by ${receiveName} (${receiveDesig}).`
      }
      const res = await window.api.branchTransfers.receive(id!, payload)
      if (res.success) {
        toast.success('Transfer received')
        setShowReceive(false)
        setAuthorized(false)
        loadData()
      } else throw new Error(res.error)
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  const handleResolve = async () => {
    try {
      if (!adminReason.trim()) return toast.error('Please enter a resolution reason')
      const res = await window.api.branchTransfers.resolveMismatch(id!, { admin_reason: adminReason })
      if (res.success) {
        toast.success('Mismatch resolved successfully')
        setShowResolve(false)
        setAdminReason('')
        loadData()
      } else throw new Error(res.error)
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  const handlePrint = async () => {
    if (!printRef.current) return
    const content = printRef.current.innerHTML
    const printWindow = window.open('', '_blank', 'width=800,height=600')
    if (!printWindow) return toast.error('Popup blocked')

    printWindow.document.write(`
      <html>
        <head>
          <title>Delivery Note - ${transfer.transfer_number}</title>
          <script src="https://cdn.tailwindcss.com"></script>
          <style>
            @media print {
              body { -webkit-print-color-adjust: exact; }
            }
          </style>
        </head>
        <body onload="window.print(); setTimeout(() => window.close(), 500)">
          ${content}
        </body>
      </html>
    `)
    printWindow.document.close()
    
    // Log print
    await window.api.branchTransfers.logPrint(id!)
    loadData()
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-8 h-8 border-4 border-brand-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    )
  }

  if (!transfer) {
    return <div className="p-6 text-slate-400">Transfer not found</div>
  }

  const isSender = user?.branch?.id === transfer.from_branch_id
  const isReceiver = user?.branch?.id === transfer.to_branch_id
  const isAdmin = user?.role?.permissions?.all

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-4">
          <Link 
            to="/admin/branch-transfers"
            className="p-2 bg-surface-800 hover:bg-surface-700 rounded-lg transition-colors border border-surface-700"
          >
            <ArrowLeft className="w-5 h-5 text-slate-300" />
          </Link>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-white">{transfer.transfer_number}</h1>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-500/20 text-slate-300 uppercase">
                {transfer.status.replace(/_/g, ' ')}
              </span>
            </div>
            <p className="text-slate-400 text-sm mt-1">
              From {transfer.from_branch_name} to {transfer.to_branch_name}
            </p>
          </div>
        </div>
        
        <div className="flex gap-3">
          <button 
            onClick={handlePrint}
            className="flex items-center gap-2 bg-surface-700 hover:bg-surface-600 text-white px-4 py-2 rounded-lg transition-colors"
          >
            <Printer className="w-4 h-4" /> Print Delivery Note
          </button>
          
          {(isAdmin || isSender) && transfer.status === 'draft' && (
            <button 
              onClick={handleApprove}
              className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg transition-colors font-medium text-sm"
            >
              <Check className="w-4 h-4" /> Approve
            </button>
          )}

          {(isAdmin || isSender) && transfer.status === 'approved' && (
            <button 
              onClick={handleDispatch}
              className="flex items-center gap-2 bg-brand-600 hover:bg-brand-500 text-white px-4 py-2 rounded-lg transition-colors font-medium text-sm"
            >
              <Truck className="w-4 h-4" /> Dispatch
            </button>
          )}

          {(isAdmin || isReceiver) && transfer.status === 'dispatched' && (
            <button 
              onClick={() => {
                setAuthorized(false)
                setShowReceive(true)
              }}
              className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg transition-colors font-medium text-sm"
            >
              <Check className="w-4 h-4" /> Receive Items
            </button>
          )}

          {isAdmin && (transfer.status === 'discrepancy' || transfer.status === 'under_admin_review') && (
            <button 
              onClick={() => setShowResolve(true)}
              className="flex items-center gap-2 bg-purple-600 hover:bg-purple-500 text-white px-4 py-2 rounded-lg transition-colors font-medium text-sm"
            >
              <Check className="w-4 h-4" /> Resolve Mismatch
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-surface-800 rounded-xl border border-surface-700 overflow-hidden">
            <div className="p-4 border-b border-surface-700 bg-surface-900/50">
              <h2 className="text-lg font-semibold text-white">Items</h2>
            </div>
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-surface-700 bg-surface-900/30">
                  <th className="p-4 font-medium text-slate-400">Product</th>
                  <th className="p-4 font-medium text-slate-400 text-center">Sent</th>
                  <th className="p-4 font-medium text-slate-400 text-center">Received</th>
                  <th className="p-4 font-medium text-slate-400 text-center">Damaged</th>
                  <th className="p-4 font-medium text-slate-400 text-center">Missing</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-700">
                {transfer.items.map((item: any) => (
                  <tr key={item.id} className="hover:bg-surface-700/30">
                    <td className="p-4">
                      <p className="font-medium text-slate-200">{item.product_name}</p>
                      {item.serial_batch_no && <p className="text-xs text-slate-400 mt-0.5">S/N: {item.serial_batch_no}</p>}
                    </td>
                    <td className="p-4 text-center text-slate-300">{Number(item.quantity)} {item.unit}</td>
                    <td className="p-4 text-center text-emerald-400">{item.received_qty > 0 ? Number(item.received_qty) : '-'}</td>
                    <td className="p-4 text-center text-rose-400">{item.damaged_qty > 0 ? Number(item.damaged_qty) : '-'}</td>
                    <td className="p-4 text-center text-amber-400">{item.missing_qty > 0 ? Number(item.missing_qty) : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          
          {transfer.mismatches?.length > 0 && (
            <div className="bg-rose-950/20 border border-rose-900/50 rounded-xl p-4">
              <div className="flex items-center gap-2 text-rose-400 mb-3">
                <AlertTriangle className="w-5 h-5" />
                <h3 className="font-semibold">Reported Discrepancies</h3>
              </div>
              <div className="space-y-3">
                {transfer.mismatches.map((m: any) => (
                  <div key={m.id} className="bg-surface-900/50 p-3 rounded-lg text-sm">
                    <p className="font-medium text-slate-200">{m.product_name}</p>
                    <p className="text-slate-400 mt-1">Reason: <span className="text-rose-300">{m.reason_category}</span></p>
                    {m.detailed_reason && <p className="text-slate-400 mt-1">Details: {m.detailed_reason}</p>}
                    <div className="flex gap-4 mt-2 text-xs">
                      {m.missing_qty > 0 && <span className="text-amber-400">Missing: {Number(m.missing_qty)}</span>}
                      {m.damaged_qty > 0 && <span className="text-rose-400">Damaged: {Number(m.damaged_qty)}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="space-y-6">
          <div className="bg-surface-800 rounded-xl border border-surface-700 p-6 space-y-4">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-500">Delivery Info</h3>
            
            <div>
              <p className="text-xs text-slate-500">Driver</p>
              <p className="text-sm text-slate-200 font-medium">{transfer.driver_name || 'N/A'}</p>
              {transfer.driver_phone && <p className="text-xs text-slate-400 mt-0.5">{transfer.driver_phone}</p>}
            </div>
            
            <div>
              <p className="text-xs text-slate-500">Vehicle Number</p>
              <p className="text-sm text-slate-200 font-medium">{transfer.vehicle_number || 'N/A'}</p>
            </div>
            
            <div>
              <p className="text-xs text-slate-500">Issuing Officer</p>
              <p className="text-sm text-slate-200 font-medium">{transfer.issuing_officer_name || 'N/A'}</p>
            </div>
            
            {transfer.dispatch_at && (
              <div>
                <p className="text-xs text-slate-500">Dispatched At</p>
                <p className="text-sm text-slate-200">{new Date(transfer.dispatch_at).toLocaleString()}</p>
              </div>
            )}
          </div>

          <div className="bg-surface-800 rounded-xl border border-surface-700 p-6 space-y-4">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-500">Receive Info</h3>
            
            <div>
              <p className="text-xs text-slate-500">Received By</p>
              <p className="text-sm text-slate-200 font-medium">{transfer.received_by_name || 'N/A'}</p>
              {transfer.received_designation && <p className="text-xs text-slate-400 mt-0.5">{transfer.received_designation}</p>}
            </div>
            
            {transfer.actual_delivery_at && (
              <div>
                <p className="text-xs text-slate-500">Received At</p>
                <p className="text-sm text-slate-200">{new Date(transfer.actual_delivery_at).toLocaleString()}</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Hidden print template */}
      <div className="hidden">
        <DeliveryNoteTemplate
          ref={printRef}
          transfer={transfer}
          companyName={settings.company_name || 'Company Name'}
          companyLogo={settings.company_logo_url}
        />
      </div>

      {/* Receive Modal */}
      {showReceive && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-surface-800 border border-surface-700 rounded-2xl p-6 w-full max-w-3xl max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold text-white mb-6">Receive Transfer</h2>
            
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">Receiver Name</label>
                  <input 
                    type="text"
                    value={receiveName}
                    onChange={e => setReceiveName(e.target.value)}
                    className="w-full bg-surface-900 border border-surface-600 text-white px-4 py-2 rounded-lg"
                    placeholder="E.g. John Doe"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">Designation</label>
                  <input 
                    type="text"
                    value={receiveDesig}
                    onChange={e => setReceiveDesig(e.target.value)}
                    className="w-full bg-surface-900 border border-surface-600 text-white px-4 py-2 rounded-lg"
                    placeholder="E.g. Store Manager"
                  />
                </div>
              </div>
              
              <div>
                <h3 className="text-sm font-semibold text-slate-300 mb-3">Verify Items</h3>
                <div className="space-y-3">
                  {receiveItems.map((item, index) => (
                    <div key={item.item_id} className="grid grid-cols-12 gap-3 items-center bg-surface-900/50 p-3 rounded-lg border border-surface-700 text-sm">
                      <div className="col-span-5 font-medium text-slate-200">
                        {item.product_name}
                        <div className="text-xs text-slate-500 mt-0.5">Sent: {item.sent_qty}</div>
                      </div>
                      <div className="col-span-3">
                        <label className="block text-xs text-slate-400 mb-1">Received Good</label>
                        <input 
                          type="number" min="0" max={item.sent_qty}
                          value={item.received_qty}
                          onChange={e => {
                            const val = parseFloat(e.target.value) || 0
                            const newItems = [...receiveItems]
                            newItems[index].received_qty = val
                            if (val + newItems[index].damaged_qty > item.sent_qty) {
                              newItems[index].damaged_qty = item.sent_qty - val
                            }
                            setReceiveItems(newItems)
                          }}
                          className="w-full bg-surface-800 border border-surface-600 text-white px-2 py-1.5 rounded-md"
                        />
                      </div>
                      <div className="col-span-3">
                        <label className="block text-xs text-slate-400 mb-1">Damaged/Spoiled</label>
                        <input 
                          type="number" min="0" max={item.sent_qty}
                          value={item.damaged_qty}
                          onChange={e => {
                            const val = parseFloat(e.target.value) || 0
                            const newItems = [...receiveItems]
                            newItems[index].damaged_qty = val
                            if (val + newItems[index].received_qty > item.sent_qty) {
                              newItems[index].received_qty = item.sent_qty - val
                            }
                            setReceiveItems(newItems)
                          }}
                          className="w-full bg-surface-800 border border-surface-600 text-white px-2 py-1.5 rounded-md"
                        />
                      </div>
                      <div className="col-span-1 text-center">
                        <label className="block text-xs text-slate-400 mb-1">Miss</label>
                        <span className={`font-bold ${item.sent_qty - item.received_qty - item.damaged_qty > 0 ? 'text-amber-400' : 'text-slate-500'}`}>
                          {Math.max(0, item.sent_qty - item.received_qty - item.damaged_qty)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Signature Capture Block */}
              <div className="bg-surface-900/40 p-4 rounded-xl border border-surface-700 space-y-4">
                <label className="block text-sm font-medium text-slate-300">Receiver Digital Signature Verification</label>
                <div className="flex flex-col sm:flex-row gap-4 items-center">
                  <div className="w-full sm:flex-1 h-20 bg-surface-900/60 border border-dashed border-surface-600 rounded-lg flex items-center justify-center text-slate-500 font-mono text-xs select-none">
                    [ DIGITAL SIGNATURE SECURED ]
                  </div>
                  <div className="flex flex-col gap-2 w-full sm:w-auto">
                    <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                      <input 
                        type="checkbox" 
                        checked={authorized}
                        onChange={e => setAuthorized(e.target.checked)}
                        className="rounded bg-surface-900 border-surface-600 text-brand-500 focus:ring-0" 
                      />
                      <span>Sign to confirm physical verification</span>
                    </label>
                    <span className="text-[10px] text-slate-500">
                      IP: Local POS, Time: {new Date().toLocaleString()}
                    </span>
                  </div>
                </div>
              </div>
            </div>
            
            <div className="flex justify-end gap-3 mt-8">
              <button 
                onClick={() => setShowReceive(false)}
                className="px-4 py-2 rounded-lg font-semibold text-slate-300 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={handleReceive}
                disabled={!authorized || !receiveName.trim()}
                className="px-4 py-2 rounded-lg font-semibold text-white bg-emerald-600 hover:bg-emerald-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Confirm Receipt
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Resolve Discrepancy Modal */}
      {showResolve && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-surface-800 border border-surface-700 rounded-2xl p-6 w-full max-w-md overflow-y-auto">
            <h2 className="text-xl font-bold text-white mb-4">Resolve Discrepancy</h2>
            <p className="text-slate-400 text-sm mb-6">
              Enter the administrative decision and correction notes to resolve all mismatches and mark this transfer as corrected.
            </p>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">Administrative Action / Notes</label>
                <textarea 
                  value={adminReason}
                  onChange={e => setAdminReason(e.target.value)}
                  rows={4}
                  className="w-full bg-surface-900 border border-surface-600 text-white px-4 py-2 rounded-lg resize-none text-sm"
                  placeholder="E.g. Verified stock levels. The missing stock has been found at sender branch and corrected in system."
                />
              </div>
            </div>
            
            <div className="flex justify-end gap-3 mt-8">
              <button 
                onClick={() => {
                  setShowResolve(false)
                  setAdminReason('')
                }}
                className="px-4 py-2 rounded-lg font-semibold text-slate-300 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={handleResolve}
                className="px-4 py-2 rounded-lg font-semibold text-white bg-purple-600 hover:bg-purple-500 transition-colors"
              >
                Confirm Resolution
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
