import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import CartQuantityPanel from './CartQuantityPanel'
import type { Product } from '@/types'

afterEach(cleanup)
const sugar = { id: 'sugar', name: 'SUGAR', unit: 'kg', selling_price: 300 } as unknown as Product

describe('cart sidebar quantity panel', () => {
  it('focuses the input and adds grams converted to kg on Enter', async () => {
    const submit = vi.fn()
    render(<CartQuantityPanel product={sugar} mode="add" onSubmit={submit} onCancel={vi.fn()} />)
    const input = screen.getByLabelText('Quantity in kg')
    await waitFor(() => expect(input).toHaveFocus())
    await userEvent.setup().type(input, '750g{Enter}')
    expect(submit).toHaveBeenCalledWith(0.75)
  })
  it('shows a live line total while typing', async () => {
    render(<CartQuantityPanel product={sugar} mode="add" onSubmit={vi.fn()} onCancel={vi.fn()} />)
    await userEvent.setup().type(screen.getByLabelText('Quantity in kg'), '1.5')
    expect(screen.getByText('Rs.450')).toBeInTheDocument()
  })
  it('adds a quick amount with Alt+2', async () => {
    const submit = vi.fn()
    render(<CartQuantityPanel product={sugar} mode="add" onSubmit={submit} onCancel={vi.fn()} />)
    const input = screen.getByLabelText('Quantity in kg')
    await waitFor(() => expect(input).toHaveFocus())
    await userEvent.setup().keyboard('{Alt>}2{/Alt}')
    expect(submit).toHaveBeenCalledWith(0.5)
  })
  it('cancels with Escape and rejects an invalid quantity without closing', async () => {
    const submit = vi.fn(), cancel = vi.fn()
    render(<CartQuantityPanel product={sugar} mode="edit" initialText="2" onSubmit={submit} onCancel={cancel} />)
    const user = userEvent.setup()
    const input = screen.getByLabelText('Quantity in kg')
    await user.clear(input)
    await user.type(input, 'abc{Enter}')
    expect(submit).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(cancel).toHaveBeenCalledTimes(1)
  })
})
