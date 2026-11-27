import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import Cart from './Cart'
import { useCartStore } from '@/store/cartStore'
import type { Product } from '@/types'
vi.mock('@/store/authStore', () => ({ useAuthStore: () => ({ user: { role: { permissions: { all: true } } } }) }))
afterEach(() => { cleanup(); useCartStore.getState().clear() })
it('allows Tab to quantity, clears and replaces it without removing the product, and Enter returns to search', async () => {
  useCartStore.getState().addItem({ id: 'tea', name: 'Tea', unit: 'pcs', selling_price: 100, tax_rate: 0 } as Product, 1)
  render(<><input data-pos-search="true" aria-label="Product search" /><Cart onPay={vi.fn()} /></>)
  const keys = userEvent.setup()
  const search = screen.getByLabelText('Product search')
  search.focus()
  await keys.tab() // Cart row
  await keys.keyboard('{Enter}') // Quantity
  expect(screen.getByLabelText('Quantity for Tea')).toHaveFocus()
  await keys.clear(screen.getByLabelText('Quantity for Tea'))
  expect(useCartStore.getState().items).toHaveLength(1)
  await keys.keyboard('12{Enter}')
  expect(useCartStore.getState().items[0].quantity).toBe(12)
  expect(useCartStore.getState().total).toBe(1200)
  expect(search).toHaveFocus()
})
