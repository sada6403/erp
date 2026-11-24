import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import ProductSearch from './ProductSearch'
import { PosCatalog } from '@/lib/posCatalog'
import type { Product } from '@/types'

vi.mock('@/store/authStore', () => ({ useAuthStore: (selector: (s: unknown) => unknown) => selector({ user: { branch_id: 'B1' } }) }))
const products = ['Milk', 'Milk powder'].map((name, i) => ({ id: String(i), name, sku: String(i), unit: 'kg', is_active: true, selling_price: 100, stock: 10, min_stock_level: 1 } as Product))
afterEach(cleanup)

describe('keyboard suggestions without network', () => {
  it('selects the highlighted result with Enter and ignores other fields', () => {
    const select = vi.fn()
    render(<><input aria-label="Search" data-pos-search="true" /><input aria-label="Tendered" /><ProductSearch query="milk" catalog={new PosCatalog(products)} onSelect={select} /></>)
    const search = screen.getByLabelText('Search')
    fireEvent.keyDown(search, { key: 'ArrowDown' })
    fireEvent.keyDown(search, { key: 'Enter' })
    expect(select).toHaveBeenCalledTimes(1)
    expect(select).toHaveBeenCalledWith(products[1])
    fireEvent.keyDown(screen.getByLabelText('Tendered'), { key: 'Enter' })
    expect(select).toHaveBeenCalledTimes(1)
  })
  it('does not make an IPC product search and displays unit and stock immediately', () => {
    render(<ProductSearch query="milk" catalog={new PosCatalog(products)} onSelect={vi.fn()} />)
    expect(screen.getByText('Milk')).toBeInTheDocument()
    expect(screen.getAllByText(/Stock: 10/)).toHaveLength(2)
    expect(screen.getAllByText(/kg/)).toHaveLength(2)
  })
})
