import { useState } from 'react'
import Modal from '@/components/shared/Modal'
import toast from 'react-hot-toast'
import type { FieldMapping, FurnitureReview, ImportStrategy, MappingField } from '../../../electron/services/furnitureImportPreview'

interface Columns {
  headers: { index: number; label: string }[]
  fields: MappingField[]
  mapping: FieldMapping
  sample: string[][]
}
export interface FurnitureImportFile extends Columns {
  sessionId: string; fileName: string
  sheets: { name: string; rowCount: number; headerRow: number }[]
  selectedSheet: string; headerRow: number
  branches: { id: string; name: string }[]
}
export default function FurnitureImportPreview({ file, initialStrategy, onClose, onConfirm }: {
  file: FurnitureImportFile; initialStrategy: ImportStrategy; onClose: () => void
  onConfirm: (reviewId: string, strategy: ImportStrategy) => Promise<boolean | undefined>
}) {
  const [sheet, setSheet] = useState(file.selectedSheet)
  const [headerRow, setHeaderRow] = useState(file.headerRow)
  const [headerDraft, setHeaderDraft] = useState(String(file.headerRow + 1))
  const [columns, setColumns] = useState<Columns>(file)
  const [mapping, setMapping] = useState<FieldMapping>(file.mapping)
  const [strategy, setStrategy] = useState(initialStrategy)
  const [defaultBranchId, setDefaultBranchId] = useState('')
  const [review, setReview] = useState<FurnitureReview | null>(null)
  const [busy, setBusy] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)
  const close = () => {
    if (busy) return
    void window.api.products.importPreview.cancel(file.sessionId)
    onClose()
  }
  const readColumns = async (name: string, row: number) => {
    setBusy(true); setReview(null); setAcknowledged(false)
    try {
      const response = await window.api.products.importPreview.describe({ sessionId: file.sessionId, sheetName: name, headerRow: row })
      if (!response.success) { toast.error(response.error || 'Could not read columns'); return }
      setSheet(name); setHeaderRow(row); setHeaderDraft(String(row + 1)); setColumns(response.data); setMapping(response.data.mapping)
    } catch (error) { toast.error(String(error)) } finally { setBusy(false) }
  }
  const inspect = async () => {
    setBusy(true); setAcknowledged(false)
    try {
      const response = await window.api.products.importPreview.review({ sessionId: file.sessionId, sheetName: sheet, headerRow, mapping, duplicateStrategy: strategy, defaultBranchId: defaultBranchId || undefined })
      if (!response.success) { toast.error(response.error || 'Could not preview import'); return }
      setReview(response.data)
    } catch (error) { toast.error(String(error)) } finally { setBusy(false) }
  }
  const confirm = async () => {
    if (!review?.reviewId || review.errors.length || (review.warnings.length && !acknowledged)) return
    setBusy(true)
    try {
      if (await onConfirm(review.reviewId, strategy)) onClose()
      else { setReview(null); setAcknowledged(false) }
    } finally { setBusy(false) }
  }
  const renderMapping = (fields: MappingField[]) => <table className="w-full text-sm">
    <thead><tr className="text-left text-slate-400"><th className="py-2 pr-3">POS field</th><th className="py-2 pr-3">Excel column</th><th className="py-2">First-row value</th></tr></thead>
    <tbody>{fields.map(field => <tr key={field.name} className="border-t border-[var(--border)]">
      <td className="py-2 pr-3">{field.name}{field.required && <span className="text-rose-400"> *</span>}</td>
      <td className="py-2 pr-3"><select aria-label={`Map ${field.name}`} className="input w-full" value={mapping[field.name] ?? -1} disabled={busy} onChange={event => setMapping(current => ({ ...current, [field.name]: Number(event.target.value) }))}>
        <option value={-1}>{field.required ? 'Choose column' : 'Do not import'}</option>
        {columns.headers.map(header => <option key={header.index} value={header.index}>{header.index + 1}. {header.label}</option>)}
      </select></td>
      <td className="py-2 max-w-56 truncate text-slate-400" title={columns.sample[0]?.[mapping[field.name]] || ''}>{columns.sample[0]?.[mapping[field.name]] || '-'}</td>
    </tr>)}</tbody>
  </table>
  const primaryFields = columns.fields.filter((field, index) => index < 14 || field.name.startsWith('Stock ('))
  const extraFields = columns.fields.filter(field => !primaryFields.includes(field))
  const totals = review ? { file: review.branches.reduce((sum, branch) => sum + branch.fileQty, 0), imported: review.branches.reduce((sum, branch) => sum + branch.importQty, 0) } : null
  return <Modal title={review ? 'Review Furniture Import' : 'Map Furniture Excel Fields'} size="xl" onClose={close} footer={<>
    <button className="btn-secondary" disabled={busy} onClick={review ? () => { setReview(null); setAcknowledged(false) } : close}>{review ? 'Back to Mapping' : 'Cancel'}</button>
    {review ? <button className="btn-primary" disabled={busy || !review.reviewId || review.errors.length > 0 || (review.warnings.length > 0 && !acknowledged)} onClick={confirm}>{busy ? 'Importing...' : 'Confirm Import'}</button>
      : <button className="btn-primary" disabled={busy || Number(headerDraft) !== headerRow + 1} onClick={inspect}>{busy ? 'Reading...' : 'Preview Import'}</button>}
  </>}>
    <div className="space-y-5">
      <div><p className="font-medium break-all">{file.fileName}</p><p className="text-sm text-slate-400">{review ? `Sheet: ${sheet}. Review these values before saving to POS.` : 'Choose the data sheet and match its columns to the POS fields.'}</p></div>
      {!review && <>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="text-sm">Worksheet<select aria-label="Worksheet" className="input mt-1 w-full" value={sheet} disabled={busy} onChange={event => { const selected = file.sheets.find(item => item.name === event.target.value)!; void readColumns(selected.name, selected.headerRow) }}>{file.sheets.map(item => <option key={item.name} value={item.name}>{item.name} ({item.rowCount} rows)</option>)}</select></label>
          <div><label className="text-sm" htmlFor="import-header-row">Column headings are on Excel row</label><div className="flex gap-2 mt-1"><input id="import-header-row" className="input w-24" type="number" min={1} value={headerDraft} disabled={busy} onChange={event => setHeaderDraft(event.target.value)} /><button className="btn-secondary" disabled={busy || !Number.isInteger(Number(headerDraft)) || Number(headerDraft) < 1} onClick={() => readColumns(sheet, Number(headerDraft) - 1)}>Read Columns</button></div></div>
          <label className="text-sm">Existing products<select aria-label="Existing products" className="input mt-1 w-full" value={strategy} disabled={busy} onChange={event => setStrategy(event.target.value as ImportStrategy)}><option value="fill_empty">Fill empty fields; preserve existing stock</option><option value="override">Update provided details and stock quantities</option><option value="skip">Skip existing products</option></select></label>
          <label className="text-sm">Default branch for quantity-only rows<select aria-label="Default branch" className="input mt-1 w-full" value={defaultBranchId} disabled={busy} onChange={event => setDefaultBranchId(event.target.value)}><option value="">Use mapped branch / branch stock columns</option>{file.branches.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
        </div>
        <div className="overflow-x-auto">{renderMapping(primaryFields)}</div>
        <details><summary className="cursor-pointer text-sm text-sky-400">More product fields ({extraFields.length})</summary><div className="overflow-x-auto">{renderMapping(extraFields)}</div></details>
      </>}
      {review && <>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">{[['Source rows', review.rowCount], ['New products', review.newProducts], ['Existing products', review.existingProducts], ['Skipped rows', review.skippedRows]].map(([label, value]) => <div key={label} className="border border-[var(--border)] rounded-lg p-3"><p className="text-slate-400">{label}</p><p className="text-xl font-semibold">{value}</p></div>)}</div>
        <p className="text-sm text-slate-400">{strategy === 'fill_empty' ? 'Existing values and positive stock balances will be preserved.' : strategy === 'skip' ? 'Existing products are excluded from the quantities below.' : 'Provided stock quantities will replace existing balances. They are not added to the current balance.'}</p>
        {review.errors.length > 0 && <div className="border border-rose-500/30 rounded-lg p-3"><h3 className="font-semibold text-rose-400">Fix before importing ({review.errors.length})</h3><ul className="text-sm mt-2 space-y-1 max-h-64 overflow-y-auto">{review.errors.map((issue, index) => <li key={index}>{issue.row ? `Excel row ${issue.row}: ` : ''}{issue.message}</li>)}</ul></div>}
        {review.warnings.length > 0 && <div className="border border-amber-500/30 rounded-lg p-3"><h3 className="font-semibold text-amber-400">Review warnings ({review.warnings.length})</h3><ul className="text-sm mt-2 space-y-1 max-h-56 overflow-y-auto">{review.warnings.map((issue, index) => <li key={index}>{issue.row ? `Excel row ${issue.row}: ` : ''}{issue.message}</li>)}</ul></div>}
        <div className="overflow-x-auto"><h3 className="font-semibold mb-2">Branch stock totals</h3><table className="w-full text-sm"><thead><tr className="text-left text-slate-400"><th className="p-2">Branch</th><th className="p-2">Destination</th><th className="p-2 text-right">File units</th><th className="p-2 text-right">Units to set</th><th className="p-2 text-right">Rows preserved</th></tr></thead><tbody>{review.branches.map(branch => <tr key={branch.name} className="border-t border-[var(--border)]"><td className="p-2">{branch.name}</td><td className="p-2">{branch.exists ? 'Existing branch' : 'Pending new branch'}</td><td className="p-2 text-right">{branch.fileQty}</td><td className="p-2 text-right">{branch.importQty}</td><td className="p-2 text-right">{branch.preservedRows}</td></tr>)}</tbody><tfoot><tr className="border-t border-[var(--border)] font-semibold"><td className="p-2" colSpan={2}>Total (excluding skipped rows)</td><td className="p-2 text-right">{totals?.file}</td><td className="p-2 text-right">{totals?.imported}</td><td /></tr></tfoot></table></div>
        <div className="overflow-x-auto"><h3 className="font-semibold mb-2">Mapped sample (first 10 stock/product rows)</h3><table className="w-full text-sm"><thead><tr className="text-left text-slate-400">{['SKU', 'Product Name', 'Branch', 'Qty', 'Cost Price', 'Selling Price', 'Category'].map(field => <th key={field} className="p-2">{field}</th>)}</tr></thead><tbody>{review.sample.map((row, index) => <tr key={index} className="border-t border-[var(--border)]">{['SKU', 'Product Name', 'Branch', 'Qty', 'Cost Price', 'Selling Price', 'Category'].map(field => <td className="p-2" key={field}>{String(row[field] ?? '-')}</td>)}</tr>)}</tbody></table></div>
        {!review.errors.length && review.warnings.length > 0 && <label className="flex items-start gap-2 text-sm"><input className="mt-1" type="checkbox" checked={acknowledged} disabled={busy} onChange={event => setAcknowledged(event.target.checked)} />I have reviewed the warnings, branch destinations and quantities.</label>}
      </>}
    </div>
  </Modal>
}
