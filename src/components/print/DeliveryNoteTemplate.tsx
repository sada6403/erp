import React, { useState, useEffect } from 'react'
import { format } from 'date-fns'
import QRCode from 'qrcode'

const CODE39_MAP: Record<string, string> = {
  'A': '110101001011', 'B': '100110100101', 'C': '110011010010', 'D': '100101100101',
  'E': '110010110010', 'F': '100110011010', 'G': '100101001101', 'H': '110010100110',
  'I': '100100101101', 'J': '100101001011', 'K': '110101010011', 'L': '100110101001',
  'M': '110011010100', 'N': '100101101001', 'O': '110010110100', 'P': '100110011001',
  'Q': '100101011001', 'R': '110010101100', 'S': '100100101100', 'T': '100101001100',
  'U': '110110101001', 'V': '101100110101', 'W': '110110011010', 'X': '101101101001',
  'Y': '110110110100', 'Z': '101101101100', '-': '101100101011', '.': '110110010101',
  ' ': '101100110100', '*': '101100101100', '$': '101101101101', '/': '101101101101',
  '+': '101101101101', '%': '101101101101', '0': '101001101101', '1': '110100101011',
  '2': '101100101011', '3': '110110010101', '4': '101001101011', '5': '110100110101',
  '6': '101100110101', '7': '101001011011', '8': '110100101101', '9': '101100101101'
}

function Code39Barcode({ value }: { value: string }) {
  const cleanVal = String(value || '').toUpperCase().replace(/[^A-Z0-9\-\.\ \$\/\+\%]/g, '')
  const chars = `*${cleanVal}*`
  let pattern = ''
  for (const c of chars) {
    pattern += (CODE39_MAP[c] || '101100110100') + '0'
  }

  const barWidth = 1.2
  const height = 30
  const totalWidth = pattern.length * barWidth

  return (
    <div className="flex flex-col items-center select-none" style={{ display: 'inline-flex' }}>
      <svg width={totalWidth} height={height}>
        <g fill="black">
          {pattern.split('').map((bit, idx) => {
            if (bit === '1') {
              return <rect key={idx} x={idx * barWidth} y={0} width={barWidth} height={height} />
            }
            return null
          })}
        </g>
      </svg>
      <span className="text-[8px] font-mono mt-0.5 tracking-[2px] text-black">{value}</span>
    </div>
  )
}

function QRCodeImage({ value }: { value: string }) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    QRCode.toDataURL(value, { margin: 1, width: 56 })
      .then(u => setUrl(u))
      .catch(() => undefined)
  }, [value])

  if (!url) return null
  return <img src={url} alt="QR Code" className="w-14 h-14 object-contain" />
}

interface TransferData {
  transfer_number: string
  from_branch_name: string
  from_branch_address: string
  from_branch_phone: string
  to_branch_name: string
  to_branch_address: string
  to_branch_phone: string
  created_at: string
  driver_name: string
  vehicle_number: string
  issuing_officer_name: string
  notes: string
  items: any[]
}

interface DeliveryNoteTemplateProps {
  transfer: TransferData
  companyName: string
  companyLogo?: string
}

export const DeliveryNoteTemplate = React.forwardRef<HTMLDivElement, DeliveryNoteTemplateProps>(
  ({ transfer, companyName, companyLogo }, ref) => {
    return (
      <div ref={ref} className="p-8 bg-white text-black min-h-screen" style={{ width: '210mm', margin: '0 auto', fontFamily: 'Arial, sans-serif' }}>
        <div className="flex justify-between items-start border-b-2 border-black pb-4 mb-6">
          <div className="flex items-center gap-4">
            {companyLogo && <img src={companyLogo} alt="Logo" className="w-16 h-16 object-contain" onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />}
            <div>
              <h1 className="text-2xl font-bold uppercase m-0">{companyName}</h1>
              <p className="text-sm font-semibold uppercase tracking-widest mt-1">Delivery Note</p>
            </div>
          </div>
          <div className="flex gap-4 items-center">
            <div className="text-right">
              <h2 className="text-xl font-bold m-0 text-slate-800">{transfer.transfer_number}</h2>
              <p className="text-sm mt-1">Date: {format(new Date(transfer.created_at), 'dd MMM yyyy, h:mm a')}</p>
              <div className="mt-1">
                <Code39Barcode value={transfer.transfer_number} />
              </div>
            </div>
            <QRCodeImage value={transfer.transfer_number} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-8 mb-8">
          <div>
            <h3 className="font-bold text-sm uppercase border-b border-black pb-1 mb-2">From (Sender)</h3>
            <p className="font-bold">{transfer.from_branch_name}</p>
            <p className="text-sm whitespace-pre-wrap">{transfer.from_branch_address}</p>
            {transfer.from_branch_phone && <p className="text-sm mt-1">Tel: {transfer.from_branch_phone}</p>}
          </div>
          
          <div>
            <h3 className="font-bold text-sm uppercase border-b border-black pb-1 mb-2">To (Receiver)</h3>
            <p className="font-bold">{transfer.to_branch_name}</p>
            <p className="text-sm whitespace-pre-wrap">{transfer.to_branch_address}</p>
            {transfer.to_branch_phone && <p className="text-sm mt-1">Tel: {transfer.to_branch_phone}</p>}
          </div>
        </div>

        <div className="mb-8 p-4 border border-black rounded bg-slate-50">
          <h3 className="font-bold text-sm uppercase mb-3">Delivery Information</h3>
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <span className="font-bold">Driver Name:</span><br/>
              {transfer.driver_name || '_______________'}
            </div>
            <div>
              <span className="font-bold">Vehicle No:</span><br/>
              {transfer.vehicle_number || '_______________'}
            </div>
            <div>
              <span className="font-bold">Issuing Officer:</span><br/>
              {transfer.issuing_officer_name || '_______________'}
            </div>
          </div>
        </div>

        <table className="w-full text-sm border-collapse mb-8">
          <thead>
            <tr className="bg-slate-100">
              <th className="border border-black p-2 text-center w-12">No</th>
              <th className="border border-black p-2 text-left">Item Description</th>
              <th className="border border-black p-2 text-center w-24">SKU / Code</th>
              <th className="border border-black p-2 text-center w-24">Qty</th>
              <th className="border border-black p-2 text-center w-24">Packages</th>
              <th className="border border-black p-2 text-left w-32">Serial / Batch</th>
            </tr>
          </thead>
          <tbody>
            {transfer.items.map((item, index) => (
              <tr key={item.id}>
                <td className="border border-black p-2 text-center">{index + 1}</td>
                <td className="border border-black p-2 text-left">
                  <span className="font-semibold">{item.product_name}</span>
                  {item.description && <div className="text-xs text-slate-600 mt-1">{item.description}</div>}
                </td>
                <td className="border border-black p-2 text-center">{item.sku}</td>
                <td className="border border-black p-2 text-center font-bold">
                  {item.quantity} {item.unit}
                </td>
                <td className="border border-black p-2 text-center">
                  {item.package_count || '-'}
                </td>
                <td className="border border-black p-2 text-left text-xs">
                  {item.serial_batch_no || '-'}
                </td>
              </tr>
            ))}
            {/* Fill empty rows if few items */}
            {transfer.items.length < 5 && Array.from({ length: 5 - transfer.items.length }).map((_, i) => (
              <tr key={`empty-${i}`}>
                <td className="border border-black p-2 h-8"></td>
                <td className="border border-black p-2"></td>
                <td className="border border-black p-2"></td>
                <td className="border border-black p-2"></td>
                <td className="border border-black p-2"></td>
                <td className="border border-black p-2"></td>
              </tr>
            ))}
          </tbody>
        </table>

        {transfer.notes && (
          <div className="mb-12">
            <h3 className="font-bold text-sm uppercase">Remarks / Notes</h3>
            <p className="text-sm whitespace-pre-wrap">{transfer.notes}</p>
          </div>
        )}

        {/* Signatures Section */}
        <div className="grid grid-cols-3 gap-8 mt-16 pt-8 border-t-2 border-black">
          <div className="text-center">
            <div className="border-b border-black w-full h-8 mb-2"></div>
            <p className="text-xs font-bold uppercase">Issued By</p>
            <p className="text-xs text-slate-500 mt-1">Sender Branch</p>
          </div>
          
          <div className="text-center">
            <div className="border-b border-black w-full h-8 mb-2"></div>
            <p className="text-xs font-bold uppercase">Driver Signature</p>
            <p className="text-xs text-slate-500 mt-1">Transport</p>
          </div>
          
          <div className="text-center">
            <div className="border-b border-black w-full h-8 mb-2"></div>
            <p className="text-xs font-bold uppercase">Received By</p>
            <p className="text-xs text-slate-500 mt-1">Destination Branch</p>
            <p className="text-[10px] text-slate-400 mt-2 text-left">
              Name: ______________________<br/><br/>
              Date: ______________________
            </p>
          </div>
        </div>

      </div>
    )
  }
)
