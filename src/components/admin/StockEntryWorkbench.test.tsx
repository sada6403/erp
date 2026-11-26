import { render, screen, waitFor, cleanup, fireEvent, act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import StockEntryWorkbench, { type StockLine } from './StockEntryWorkbench'

const soap = { id: 'soap', name: 'Sunlight Soap', brand: 'Unilever', sku: 'TKF-002', barcode: '4791034012345', unit: 'pcs', cost_price: 90, selling_price: 120, tax_rate: 0, stock: 10, is_active: 1 }
const rice = { id: 'rice', name: 'Keeri Samba', sku: 'TKF-021', barcode: '', unit: 'kg', cost_price: 250, selling_price: 300, tax_rate: 0, stock: 40, is_active: 1, track_expiry: 0 }
const milk = { id: 'milk', name: 'Anchor Milk Powder', sku: 'TKF-050', barcode: '4792024011111', unit: 'pcs', cost_price: 900, selling_price: 1100, tax_rate: 0, stock: 0, is_active: 1, track_expiry: 1 }
const products = [soap, rice, milk]

let pricing: Record<string, any>
function memoryStorage() {
  const data = new Map<string, string>()
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, String(v)) }, removeItem: (k: string) => { data.delete(k) }, clear: () => data.clear(), key: (i: number) => [...data.keys()][i] ?? null, get length() { return data.size } }
}
beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage())
  pricing = {
    soap: { quantity: 10, average_cost: 90, cost_known: true, previous_purchase_price: 88, latest_purchase_price: 90, markup_pct: 0, batches: [{ mrp: 130 }], packs: [{ uom_name: 'Carton', conversion_factor: 24 }] },
    rice: { quantity: 40, average_cost: 250, cost_known: true, previous_purchase_price: null, latest_purchase_price: 250, markup_pct: 0, batches: [], packs: [] },
    milk: { quantity: 0, average_cost: 0, cost_known: true, previous_purchase_price: null, latest_purchase_price: 900, markup_pct: 0, batches: [], packs: [] },
  }
  ;(window as any).api = {
    purchases: { pricingContext: vi.fn(async (id: string) => ({ success: true, data: pricing[id] })) },
    products: { barcodeOwner: vi.fn(async () => ({ success: true, data: null })), generateBarcode: vi.fn(async () => ({ success: true, data: '2800000000017' })) },
    printer: { printLabel: vi.fn(async () => ({ success: true })) },
  }
})
afterEach(cleanup)

function Harness({ direct = true, onConfirm = vi.fn(), initial = [] as StockLine[], onQuickCreate = vi.fn(async () => null), items: spy }: { direct?: boolean; onConfirm?: () => void; initial?: StockLine[]; onQuickCreate?: any; items?: (lines: StockLine[]) => void }) {
  const [items, setItems] = useState<StockLine[]>(initial)
  return <StockEntryWorkbench products={products} items={items} onItemsChange={lines => { setItems(lines); spy?.(lines) }} direct={direct} draftKey="test-draft"
    onQuickCreate={onQuickCreate} onConfirm={onConfirm} onSaveDraft={vi.fn()} />
}

const field = (name: string) => screen.getByLabelText(name) as HTMLInputElement
async function typeAndEnter(name: string, value: string) {
  await waitFor(() => expect(field(name)).not.toBeDisabled())
  fireEvent.change(field(name), { target: { value } })
  fireEvent.keyDown(field(name), { key: 'Enter' })
}

describe('keyboard-only stock entry', () => {
  it('enters a full line with Enter only, using cartons, a buy X get Y offer and returns to search', async () => {
    const spy = vi.fn()
    render(<Harness items={spy} />)
    const search = field('Product / barcode')
    await waitFor(() => expect(search).toHaveFocus())
    fireEvent.change(search, { target: { value: 'sunl' } })
    expect(await screen.findByRole('option', { name: /Sunlight Soap/ })).toBeInTheDocument()
    fireEvent.keyDown(search, { key: 'Enter' })
    await waitFor(() => expect(field('Quantity')).toHaveFocus())
    await waitFor(() => expect(field('MRP')).toHaveValue('130'))
    await typeAndEnter('Quantity', '2 ctn')
    await waitFor(() => expect(field('Free qty')).toHaveFocus())
    fireEvent.keyDown(field('Free qty'), { key: 'Enter' })
    await typeAndEnter('Purchase price', '2000')
    await typeAndEnter('Supplier offer', '1+1')
    fireEvent.keyDown(field('Selling price'), { key: 'Enter' })
    fireEvent.keyDown(field('MRP'), { key: 'Enter' })
    fireEvent.keyDown(field('Customer offer'), { key: 'Enter' })
    await typeAndEnter('Batch no', 'B-77')
    fireEvent.keyDown(field('MFD'), { key: 'Enter' })
    fireEvent.keyDown(field('Expiry'), { key: 'Enter' })
    await waitFor(() => expect(spy).toHaveBeenCalled())
    const line = spy.mock.calls.at(-1)![0][0] as StockLine
    expect(line).toMatchObject({ product_id: 'soap', quantity: 2, entry_unit: 'carton', factor: 24, free_quantity: 2, unit_cost: 2000, line_total: 4000, stock_quantity: 96, batch_number: 'B-77', selling_price: String(120 * 24) })
    expect(line.effective_unit_cost).toBeCloseTo(4000 / 96)
    await waitFor(() => expect(field('Product / barcode')).toHaveFocus())
    expect(field('Product / barcode')).toHaveValue('')
  })

  it('selects a product immediately from a scanned barcode and shows the comparison panel', async () => {
    render(<Harness />)
    fireEvent.change(field('Product / barcode'), { target: { value: soap.barcode } })
    await waitFor(() => expect(field('Quantity')).toHaveFocus())
    expect(screen.getByLabelText('Stock and price comparison')).toHaveTextContent('Previous purchase')
    await typeAndEnter('Quantity', '10')
    await waitFor(() => expect(screen.getByLabelText('Stock and price comparison')).toHaveTextContent('20 pcs'))
  })

  it('handles loose products in grams, asks for no barcode and computes weighted average', async () => {
    const spy = vi.fn()
    render(<Harness items={spy} direct={false} />)
    fireEvent.change(field('Product / barcode'), { target: { value: 'keeri' } })
    fireEvent.keyDown(field('Product / barcode'), { key: 'Enter' })
    await typeAndEnter('Quantity', '500g')
    await waitFor(() => expect(field('Free qty')).toHaveFocus())
    expect(screen.queryByLabelText('Barcode')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Expiry')).not.toBeInTheDocument()
    fireEvent.keyDown(field('Free qty'), { key: 'Enter' })
    await typeAndEnter('Purchase price', '0.2')
    // 40kg @250 + 0.5kg @200 → (10000 + 100) / 40.5
    await waitFor(() => expect(screen.getByLabelText('Stock and price comparison')).toHaveTextContent('Rs.249.38'))
    fireEvent.keyDown(field('Supplier offer'), { key: 'Enter' })
    fireEvent.keyDown(field('Selling price'), { key: 'Enter' })
    fireEvent.keyDown(field('MRP'), { key: 'Enter' })
    fireEvent.keyDown(field('Customer offer'), { key: 'Enter' })
    await waitFor(() => expect(spy).toHaveBeenCalled())
    expect(spy.mock.calls.at(-1)![0][0]).toMatchObject({ entry_unit: 'g', quantity: 500, stock_quantity: 0.5, line_total: 100 })
  })

  it('blocks a missing expiry for an expiry-tracked product and a selling price above MRP', async () => {
    render(<Harness />)
    fireEvent.change(field('Product / barcode'), { target: { value: milk.barcode } })
    await waitFor(() => expect(field('Quantity')).toHaveFocus())
    await typeAndEnter('Quantity', '5')
    fireEvent.keyDown(field('Free qty'), { key: 'Enter' })
    fireEvent.keyDown(field('Purchase price'), { key: 'Enter' })
    fireEvent.keyDown(field('Supplier offer'), { key: 'Enter' })
    await typeAndEnter('Selling price', '1200')
    await typeAndEnter('MRP', '1150')
    expect(await screen.findByRole('alert')).toHaveTextContent(/MRP/)
    await typeAndEnter('MRP', '1250')
    fireEvent.keyDown(field('Customer offer'), { key: 'Enter' })
    expect(screen.queryByLabelText('Barcode')).not.toBeInTheDocument()
    fireEvent.keyDown(field('Batch no'), { key: 'Enter' })
    fireEvent.keyDown(field('MFD'), { key: 'Enter' })
    fireEvent.keyDown(field('Expiry'), { key: 'Enter' })
    expect(await screen.findByRole('alert')).toHaveTextContent('needs an expiry date')
  })

  it('records a customer offer with dates and a generated barcode', async () => {
    const spy = vi.fn()
    render(<Harness items={spy} direct={false} />)
    fireEvent.change(field('Product / barcode'), { target: { value: soap.barcode } })
    await waitFor(() => expect(field('Quantity')).toHaveFocus())
    await typeAndEnter('Quantity', '12')
    fireEvent.keyDown(field('Free qty'), { key: 'Enter' })
    fireEvent.keyDown(field('Purchase price'), { key: 'Enter' })
    fireEvent.keyDown(field('Supplier offer'), { key: 'Enter' })
    fireEvent.keyDown(field('Selling price'), { key: 'Enter' })
    fireEvent.keyDown(field('MRP'), { key: 'Enter' })
    await typeAndEnter('Customer offer', '110')
    await typeAndEnter('Offer from', '2026-12-01')
    fireEvent.keyDown(window, { key: 'F7' })
    await typeAndEnter('Offer to', '2026-12-31')
    await waitFor(() => expect(field('Barcode')).toHaveFocus())
    fireEvent.keyDown(field('Barcode'), { key: 'g', altKey: true })
    await waitFor(() => expect(field('Barcode')).toHaveValue('2800000000017'))
    fireEvent.keyDown(field('Barcode'), { key: 'Enter' })
    await waitFor(() => expect(spy).toHaveBeenCalled())
    expect(spy.mock.calls.at(-1)![0][0]).toMatchObject({
      customer_offer: { type: 'flat', value: 10, offer_price: 110, from: '2026-12-01', to: '2026-12-31' }, new_barcode: '2800000000017',
    })
  })

  it('edits with F3, undoes with Ctrl+Z, reviews with Ctrl+Enter and confirms with Enter', async () => {
    const onConfirm = vi.fn(), spy = vi.fn()
    const line: StockLine = { key: 'l1', product_id: 'soap', product_name: 'Sunlight Soap', unit: 'pcs', entry_unit: 'pcs', factor: 1, quantity: 5, free_quantity: 0, manual_free: 0, unit_cost: 90, discount_amount: 0, shelf_price: 120, shelf_mrp: null, selling_price: '120', mrp: '', customer_offer: null, line_total: 450, stock_quantity: 5, effective_unit_cost: 90 }
    render(<Harness initial={[line]} onConfirm={onConfirm} items={spy} direct={false} />)
    await waitFor(() => expect(field('Product / barcode')).toHaveFocus())
    fireEvent.keyDown(window, { key: 'F3' })
    await waitFor(() => expect(field('Quantity')).toHaveValue('5'))
    expect(spy.mock.calls.at(-1)![0]).toHaveLength(0)
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(spy.mock.calls.at(-1)![0]).toHaveLength(1))
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
    await waitFor(() => expect(field('Quantity')).toHaveValue('5'))
    fireEvent.keyDown(window, { key: 'F8' })
    await waitFor(() => expect(spy.mock.calls.at(-1)![0]).toHaveLength(1))
    await waitFor(() => expect(field('Product / barcode')).toHaveValue(''))
    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true })
    expect(await screen.findByLabelText('Review stock receipt')).toHaveTextContent('1 line(s)')
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('creates a missing product with F4 without leaving the screen', async () => {
    const created = { id: 'new', name: 'Ponni Rice', sku: 'P1', barcode: '', unit: 'kg', cost_price: 180, selling_price: 220, is_active: 1 }
    const onQuickCreate = vi.fn(async () => created)
    render(<Harness onQuickCreate={onQuickCreate} />)
    fireEvent.change(field('Product / barcode'), { target: { value: 'Ponni Rice' } })
    fireEvent.keyDown(field('Product / barcode'), { key: 'Enter' })
    expect(await screen.findByRole('alert')).toHaveTextContent('F4')
    fireEvent.keyDown(window, { key: 'F4' })
    await waitFor(() => expect(screen.getByLabelText('New product name')).toHaveFocus())
    expect(screen.getByLabelText('New product name')).toHaveValue('Ponni Rice')
    for (const [key, value] of [['name', 'Ponni Rice'], ['barcode', ''], ['unit', 'kg'], ['cost_price', '180'], ['selling_price', '220']]) {
      fireEvent.change(screen.getByLabelText(`New product ${key}`), { target: { value } })
      fireEvent.keyDown(screen.getByLabelText(`New product ${key}`), { key: 'Enter' })
    }
    await waitFor(() => expect(onQuickCreate).toHaveBeenCalledWith(expect.objectContaining({ name: 'Ponni Rice', unit: 'kg', cost_price: '180', selling_price: '220' })))
    await waitFor(() => expect(field('Quantity')).toHaveFocus())
  })

  it('offers to restore an unfinished draft after a crash', async () => {
    const line = { key: 'd1', product_id: 'soap', product_name: 'Sunlight Soap', unit: 'pcs', entry_unit: 'pcs', factor: 1, quantity: 3, free_quantity: 0, unit_cost: 90, discount_amount: 0, shelf_price: null, shelf_mrp: null, selling_price: '', mrp: '', customer_offer: null, line_total: 270, stock_quantity: 3, effective_unit_cost: 90 }
    localStorage.setItem('test-draft', JSON.stringify({ items: [line] }))
    const spy = vi.fn()
    render(<Harness items={spy} />)
    expect(await screen.findByText(/Unfinished stock entry found \(1 line/)).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Enter' })
    await waitFor(() => expect(spy).toHaveBeenCalledWith([expect.objectContaining({ key: 'd1' })]))
  })

  it('stays responsive with a 500-line receiving session', async () => {
    const many: StockLine[] = Array.from({ length: 500 }, (_, i) => ({ key: `k${i}`, product_id: 'soap', product_name: `Item ${i}`, unit: 'pcs', entry_unit: 'pcs', factor: 1, quantity: 1, free_quantity: 0, unit_cost: 10, discount_amount: 0, shelf_price: 12, shelf_mrp: null, selling_price: '12', mrp: '', customer_offer: null, line_total: 10, stock_quantity: 1, effective_unit_cost: 10 }))
    render(<Harness initial={many} direct={false} />)
    expect(screen.getByText('Item 499')).toBeInTheDocument()
    const started = performance.now()
    for (const ch of 'sunlight') {
      await act(async () => { fireEvent.change(field('Product / barcode'), { target: { value: field('Product / barcode').value + ch } }) })
    }
    expect(await screen.findByRole('option', { name: /Sunlight Soap/ })).toBeInTheDocument()
    expect(performance.now() - started).toBeLessThan(2000)
  }, 30000)
})
