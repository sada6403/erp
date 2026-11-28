import { render, screen, waitFor, cleanup, fireEvent, act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import POSPage from './POSPage'
import { useCartStore } from '@/store/cartStore'

const soap = { id: 'soap', name: 'SUNLIGHT', sku: 'TKF-002', barcode: '4791034012345', unit: 'pcs', selling_price: 120, cost_price: 90, tax_rate: 0, stock: 50, is_active: 1 }
const rice = { id: 'rice', name: 'KEERI SAMBA', sku: 'TKF-021', barcode: '4791034099999', unit: 'kg', selling_price: 300, cost_price: 250, tax_rate: 0, stock: 80, is_active: 1 }

function apiProxy(overrides: Record<string, unknown>): unknown {
  const handler: ProxyHandler<object> = {
    get(_target, key: string) {
      if (key in overrides) return overrides[key]
      if (key === 'on') return () => () => {}
      if (key === 'then') return undefined
      return new Proxy(() => Promise.resolve({ success: true, data: [] }), handler)
    },
    apply() { return Promise.resolve({ success: true, data: [] }) },
  }
  return new Proxy(() => {}, handler)
}

beforeEach(() => {
  useCartStore.getState().clear()
  ;(window as any).api = apiProxy({
    products: apiProxy({ list: async () => ({ success: true, data: [soap, rice] }) }),
    settings: apiProxy({ get: async () => ({ success: true, data: { business_type: 'supermarket' } }) }),
    invoices: apiProxy({ nextNumber: async () => ({ success: true, data: 'INV-1' }) }),
    keywords: undefined,
  })
})
afterEach(cleanup)

async function scan(input: HTMLElement, code: string, enter = false) {
  // Scanner: every character within a few milliseconds.
  let value = ''
  for (const ch of code) {
    fireEvent.keyDown(input, { key: ch })
    value += ch
    fireEvent.change(input, { target: { value } })
  }
  if (enter) fireEvent.keyDown(input, { key: 'Enter' })
}

describe('POS barcode scanning', { timeout: 15000 }, () => {
  it('adds an exact barcode at once when the scanner sends no Enter', async () => {
    render(<MemoryRouter><POSPage /></MemoryRouter>)
    const search = screen.getByPlaceholderText(/Search name, SKU, barcode/)
    await waitFor(() => expect((window as any).api).toBeDefined())
    await act(async () => { await new Promise(r => setTimeout(r, 50)) })
    await scan(search, soap.barcode)
    await waitFor(() => expect(useCartStore.getState().items.map(i => i.product.id)).toEqual(['soap']))
    expect(search).toHaveValue('')
  })

  it('adds once, not twice, when the scanner also sends Enter', async () => {
    render(<MemoryRouter><POSPage /></MemoryRouter>)
    const search = screen.getByPlaceholderText(/Search name, SKU, barcode/)
    await act(async () => { await new Promise(r => setTimeout(r, 50)) })
    await scan(search, soap.barcode, true)
    await act(async () => { await new Promise(r => setTimeout(r, 200)) })
    fireEvent.keyDown(search, { key: 'Enter' })
    await act(async () => { await new Promise(r => setTimeout(r, 50)) })
    expect(useCartStore.getState().items).toHaveLength(1)
    expect(useCartStore.getState().items[0].quantity).toBe(1)
  })

  it('opens the quantity panel for a weighed product and sends the next keys to it', async () => {
    render(<MemoryRouter><POSPage /></MemoryRouter>)
    const search = screen.getByPlaceholderText(/Search name, SKU, barcode/)
    await act(async () => { await new Promise(r => setTimeout(r, 50)) })
    await scan(search, rice.barcode)
    const qty = await screen.findByLabelText('Quantity in kg')
    expect(useCartStore.getState().items).toHaveLength(0)
    fireEvent.change(qty, { target: { value: '2.5' } })
    fireEvent.submit(qty.closest('form')!)
    await waitFor(() => expect(useCartStore.getState().items[0]).toMatchObject({ quantity: 2.5 }))
  })
  it('does not auto-add while a cashier types a code slowly by hand', async () => {
    render(<MemoryRouter><POSPage /></MemoryRouter>)
    const search = screen.getByPlaceholderText(/Search name, SKU, barcode/)
    await act(async () => { await new Promise(r => setTimeout(r, 50)) })
    let value = ''
    for (const ch of soap.barcode) {
      fireEvent.keyDown(search, { key: ch }); value += ch
      fireEvent.change(search, { target: { value } })
      await act(async () => { await new Promise(r => setTimeout(r, 60)) })
    }
    await act(async () => { await new Promise(r => setTimeout(r, 200)) })
    expect(useCartStore.getState().items).toHaveLength(0)
    fireEvent.keyDown(search, { key: 'Enter' })
    await waitFor(() => expect(useCartStore.getState().items).toHaveLength(1))
  })
})

