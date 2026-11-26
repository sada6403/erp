import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SupplierQuotationModal from './SupplierQuotationModal'
import { buildSupplierRfqHtml } from '@/lib/supplierRfqPrint'

const printed = vi.hoisted(() => ({ payload: null as any }))
vi.mock('@/lib/supplierRfqPrint', async (orig) => ({ ...(await orig<typeof import('@/lib/supplierRfqPrint')>()), printSupplierRfq: (p: unknown) => { printed.payload = p } }))

const plan = {
  rows: [
    { product_id: 'sugar', name: 'Sugar', sku: 'S1', unit: 'kg', current_stock: 2, min_stock_level: 10, max_stock_level: null, incoming_quantity: 0, incoming_orders: [], sold_quantity: 30, last_purchase_price: 240, estimated_cost: 240, recommended_quantity: 22, status: 'low', auto_selected: true },
    { product_id: 'milk', name: 'Milk powder', sku: 'M1', unit: 'pcs', current_stock: 0, min_stock_level: 5, max_stock_level: null, incoming_quantity: 15, incoming_orders: ['PO-7'], sold_quantity: 4, last_purchase_price: 900, estimated_cost: 900, recommended_quantity: 0, status: 'out', auto_selected: false },
    { product_id: 'soap', name: 'Soap', sku: 'P1', unit: 'pcs', current_stock: 50, min_stock_level: 5, max_stock_level: null, incoming_quantity: 0, incoming_orders: [], sold_quantity: 10, last_purchase_price: 90, estimated_cost: 90, recommended_quantity: 0, status: 'ok', auto_selected: false },
  ],
}
let api: any
beforeEach(() => {
  printed.payload = null
  api = {
    admin: { suppliers: { list: async () => ({ success: true, data: [{ id: 'sup', name: 'Lanka Wholesale', mobile_number: '0771234567' }, { id: 'sup2', name: 'Other' }] }) }, branches: { list: async () => ({ success: true, data: [{ id: 'main', name: 'Main Branch' }] }) } },
    products: { list: async () => ({ success: true, data: [{ id: 'dhal', name: 'Mysore Dhal', sku: 'D1', unit: 'kg', stock: 3, cost_price: 300, supplier_id: null, is_active: 1 }] }) },
    settings: { get: async () => ({ success: true, data: { company_name: 'TK Fresh Choice' } }) },
    purchases: {
      reorderPlan: vi.fn(async () => ({ success: true, data: plan })),
      supplierHistory: vi.fn(async () => ({ success: true, data: [] })),
      saveQuotation: vi.fn(async (p: any) => ({ success: true, data: { ...p, id: 'q1', po_number: 'PO-9', quotation_number: 'RFQ-PO-9', purchase_date: '2026-11-26', branch_id: 'main' } })),
      shareQuotation: vi.fn(async () => ({ success: true })),
      get: vi.fn(),
      confirmQuotationPrices: vi.fn(async () => ({ success: true })),
      updateStatus: vi.fn(async () => ({ success: true })),
    },
  }
  ;(window as any).api = api
})
afterEach(cleanup)

async function pickSupplier() {
  const input = await screen.findByLabelText('Supplier search')
  await waitFor(() => expect(input).toHaveFocus())
  fireEvent.change(input, { target: { value: 'lanka' } })
  await screen.findByRole('option', { name: /Lanka Wholesale/ })
  fireEvent.keyDown(input, { key: 'Enter' })
  await screen.findByText('Sugar')
}

describe('supplier quotation, keyboard only', () => {
  it('loads low stock for the supplier, edits, adds products and saves, then shares on WhatsApp', async () => {
    const onDone = vi.fn()
    render(<SupplierQuotationModal onClose={vi.fn()} onDone={onDone} />)
    await pickSupplier()
    expect(api.purchases.reorderPlan).toHaveBeenCalledWith('sup', expect.anything())
    expect(screen.getByLabelText('Order quantity Sugar')).toHaveValue('22')
    expect(screen.getByLabelText('Include Milk powder')).not.toBeChecked()
    // Edit the selected (first) row quantity with Enter
    await waitFor(() => expect(screen.getByLabelText('Quotation lines')).toHaveFocus())
    fireEvent.keyDown(window, { key: 'Enter' })
    await waitFor(() => expect(screen.getByLabelText('Order quantity Sugar')).toHaveFocus())
    fireEvent.change(screen.getByLabelText('Order quantity Sugar'), { target: { value: '25' } })
    fireEvent.keyDown(screen.getByLabelText('Order quantity Sugar'), { key: 'Enter' })
    fireEvent.keyDown(screen.getByLabelText('Estimated price Sugar'), { key: 'Enter' })
    fireEvent.change(screen.getByLabelText('Remarks Sugar'), { target: { value: '50kg bags' } })
    fireEvent.keyDown(screen.getByLabelText('Remarks Sugar'), { key: 'Enter' })
    // Remove "Soap" (third row) with Delete
    screen.getByLabelText('Quotation lines').focus()
    fireEvent.keyDown(window, { key: 'ArrowDown' })
    fireEvent.keyDown(window, { key: 'ArrowDown' })
    fireEvent.keyDown(window, { key: 'Delete' })
    expect(screen.queryByText('Soap')).not.toBeInTheDocument()
    // F4: add an unlinked product and confirm the permanent supplier link with Y
    fireEvent.keyDown(window, { key: 'F4' })
    const add = await screen.findByLabelText('Add product search')
    fireEvent.change(add, { target: { value: 'mysore' } })
    await screen.findByRole('option', { name: /Mysore Dhal/ })
    fireEvent.keyDown(add, { key: 'Enter' })
    expect(await screen.findByText(/permanently/)).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'y' })
    await waitFor(() => expect(screen.getByLabelText('Order quantity Mysore Dhal')).toHaveFocus())
    fireEvent.change(screen.getByLabelText('Order quantity Mysore Dhal'), { target: { value: '5' } })
    // F4 + unknown name → new product request
    fireEvent.keyDown(window, { key: 'F4' })
    fireEvent.change(await screen.findByLabelText('Add product search'), { target: { value: 'Organic jaggery' } })
    fireEvent.keyDown(screen.getByLabelText('Add product search'), { key: 'Enter' })
    fireEvent.change(await screen.findByLabelText('Request quantity'), { target: { value: '10' } })
    for (const key of ['quantity', 'unit', 'remarks']) fireEvent.keyDown(screen.getByLabelText(`Request ${key}`), { key: 'Enter' })
    expect(await screen.findByText('Organic jaggery')).toBeInTheDocument()
    // Review and finalize
    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true })
    expect(await screen.findByLabelText('Review quotation')).toHaveTextContent('2 product(s) + 1 new item request')
    fireEvent.keyDown(window, { key: 'Enter' })
    await waitFor(() => expect(api.purchases.saveQuotation).toHaveBeenCalled())
    const payload = api.purchases.saveQuotation.mock.calls[0][0]
    expect(payload.lines).toEqual([
      expect.objectContaining({ product_id: 'dhal', quantity: 5, link_supplier: true }),
      expect.objectContaining({ product_id: 'sugar', quantity: 25, remarks: '50kg bags', override_pending: false }),
    ])
    expect(payload.requested_items).toEqual([expect.objectContaining({ name: 'Organic jaggery', quantity: 10 })])
    expect(await screen.findByText(/Send the request to the supplier on WhatsApp/)).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Enter' })
    await waitFor(() => expect(api.purchases.shareQuotation).toHaveBeenCalledWith('q1'))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
  })

  it('marks a product already on a pending order as an override when selected', async () => {
    render(<SupplierQuotationModal onClose={vi.fn()} onDone={vi.fn()} />)
    await pickSupplier()
    screen.getByLabelText('Quotation lines').focus()
    fireEvent.keyDown(window, { key: 'ArrowDown' })
    fireEvent.keyDown(window, { key: ' ' })
    expect(screen.getByLabelText('Include Milk powder')).toBeChecked()
    expect(screen.getByText(/15 \(PO-7\) · override/)).toBeInTheDocument()
  })

  it('prints a supplier RFQ with Ctrl+P that carries no prices', async () => {
    render(<SupplierQuotationModal onClose={vi.fn()} onDone={vi.fn()} />)
    await pickSupplier()
    fireEvent.keyDown(window, { key: 'p', ctrlKey: true })
    await waitFor(() => expect(printed.payload).not.toBeNull())
    expect(printed.payload).toMatchObject({ rfq_number: 'RFQ-PO-9', company: { name: 'TK Fresh Choice' }, items: [{ name: 'Sugar', quantity: 22 }] })
    const html = buildSupplierRfqHtml(printed.payload)
    expect(html).toContain('REQUEST FOR QUOTATION')
    expect(html).not.toMatch(/240|selling|profit|Rs\./i)
  })

  it('records supplier prices and converts the quotation into a purchase order', async () => {
    api.purchases.get.mockResolvedValue({ success: true, data: { id: 'q1', po_number: 'PO-9', quotation_number: 'RFQ-PO-9', supplier_id: 'sup', supplier_name: 'Lanka Wholesale', status: 'DRAFT', is_quotation: 1,
      items: [{ product_id: 'sugar', product_name: 'Sugar', sku: 'S1', product_unit: 'kg', quantity: 25, unit_cost: 240, price_confirmed: 0, remarks: '50kg bags' }] } })
    const onDone = vi.fn()
    render(<SupplierQuotationModal quotationId="q1" mode="prices" onClose={vi.fn()} onDone={onDone} />)
    const price = await screen.findByLabelText('Supplier price Sugar')
    expect(price).toHaveValue('')
    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true })
    expect(await screen.findByText(/Enter the supplier price for Sugar/)).toBeInTheDocument()
    fireEvent.change(price, { target: { value: '235' } })
    fireEvent.keyDown(price, { key: 'Enter' })
    fireEvent.change(screen.getByLabelText('Discount Sugar'), { target: { value: '100' } })
    fireEvent.keyDown(screen.getByLabelText('Discount Sugar'), { key: 'Enter' })
    fireEvent.change(screen.getByLabelText('Free Sugar'), { target: { value: '1' } })
    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true })
    await waitFor(() => expect(api.purchases.confirmQuotationPrices).toHaveBeenCalledWith('q1', [expect.objectContaining({ product_id: 'sugar', quantity: 25, unit_cost: 235, discount_amount: 100, free_quantity: 1 })]))
    expect(await screen.findByText(/Convert this quotation into a purchase order/)).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Enter' })
    await waitFor(() => expect(api.purchases.updateStatus).toHaveBeenCalledWith('q1', 'SENT', expect.anything()))
    expect(onDone).toHaveBeenCalled()
  })
})
