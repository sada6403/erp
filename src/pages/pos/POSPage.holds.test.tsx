import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { afterEach, describe, it, expect, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import POSPage from './POSPage'
import { useCartStore } from '@/store/cartStore'
import type { Product } from '@/types'

vi.mock('@/store/authStore', () => ({ useAuthStore: () => ({ user: { id: 'cashier', name: 'Cashier', branch_id: 'BR01' } }) }))
vi.mock('@/components/pos/Cart', () => ({ default: () => null }))
vi.mock('@/components/pos/ProductGrid', () => ({ default: () => null }))
vi.mock('@/components/pos/ProductSearch', () => ({ default: () => null }))
vi.mock('@/components/pos/BranchHubStatus', () => ({ default: () => null }))
vi.mock('@/components/pos/PaymentModal', () => ({ default: () => null }))
afterEach(() => { cleanup(); useCartStore.getState().clear() })

describe('cashier F4/F5 manual number flow', () => {
  it('asks for the number before holding, then restores the bill with that exact number', async () => {
    let saved: Record<string, unknown> | undefined
    const create = vi.fn(async (payload: Record<string, unknown>) => { saved = payload; return { success: true, data: { id: 'held-id', hold_number: payload.hold_number } } })
    const recall = vi.fn(async (number: string) => number === saved?.hold_number ? { success: true, data: saved } : { success: false, error: 'Not found' })
    Object.defineProperty(window, 'api', { configurable: true, value: {
      products: { list: vi.fn().mockResolvedValue({ success: true, data: [] }) },
      settings: { get: vi.fn().mockResolvedValue({ success: true, data: {} }) },
      discounts: { activeMap: vi.fn().mockResolvedValue({ success: true, data: [] }) },
      admin: { categories: { list: vi.fn().mockResolvedValue({ success: true, data: [] }) } },
      invoices: { nextNumber: vi.fn().mockResolvedValue({ success: true, data: 'INV-PREVIEW' }) },
      holds: { create, recall, list: vi.fn(async () => ({ success: true, data: saved ? [{ ...saved, id: 'held-id', item_count: 1, created_at: new Date().toISOString() }] : [] })) },
      on: () => () => {},
    } })
    useCartStore.getState().addItem({ id: 'milk', sku: 'M', name: 'Milk', unit: 'pcs', selling_price: 100, tax_rate: 0, stock: 10, is_active: true } as Product, 2)
    render(<POSPage />)
    fireEvent.keyDown(window, { key: 'F4' })
    expect(screen.getByRole('dialog', { name: 'Hold bill' })).toBeInTheDocument()
    expect(create).not.toHaveBeenCalled()
    await userEvent.setup().type(screen.getByLabelText('Enter hold number'), '25{Enter}')
    await waitFor(() => expect(useCartStore.getState().items).toHaveLength(0))
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ hold_number: '25', total_amount: 200 }))
    fireEvent.keyDown(window, { key: 'F5' })
    await userEvent.setup().type(screen.getByLabelText('Hold number'), '25{Enter}')
    await waitFor(() => expect(useCartStore.getState().total).toBe(200))
    expect(recall).toHaveBeenCalledWith('25')
    expect(useCartStore.getState().items[0].quantity).toBe(2)
    expect(useCartStore.getState().billType).toBe('RETAIL')
  })
})
